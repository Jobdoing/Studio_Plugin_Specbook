// Minimal in-memory stand-in for studio.records and studio.sync's online-conflict flow (Studio
// src/studio-plugin.js resolveConflict/savedConflict/resumeConflict, data.md §2.4(b)).
// Same rule as Studio's records-http.mjs COLLECTION_RE: lowercase letters, digits and hyphens only.
const COLLECTION_RE = /^[a-z0-9-]{1,40}$/;
const checkCollection = (collection) => {
  if (!COLLECTION_RE.test(collection)) throw new Error('INVALID_COLLECTION');
};
// Which choices the host dialog offers per code (Studio SyncConflictDialog.tsx, online conflicts).
const CHOICES = { VERSION_CONFLICT: ['mine', 'theirs'], PUBLISHED: ['later', 'theirs'], LEASE_HELD: ['later', 'theirs'], DELETED: ['theirs'] };
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class FakeStudio {
  constructor() {
    this.rows = new Map(); // record_id ("collection/key") -> record
    this.calls = [];
    this.unsaved = new Map(); // "collection/record_id" -> write-ahead or conflict entry (the SDK's unsaved: drafts)
    this.dialogs = []; // every host conflict dialog shown: {code, record_id, resumed}
    this.conflictChoice = null; // the user's answer to the next dialog; a test sets it before a conflict

    // A by-id refusal carries collection/record_id/version, as the SDK's trackWrite attaches them.
    const refuse = (code, collection, recordId, version, current) => Object.assign(
      new Error(code), { collection, record_id: recordId, version }, current ? { current: structuredClone(current) } : {});
    const write = (collection, recordId, version, body) => {
      const current = this.rows.get(recordId);
      if (!current) throw new Error('NOT_FOUND');
      if (current.state === 'published') throw refuse('PUBLISHED', collection, recordId, version);
      if (version !== current.version) throw refuse('VERSION_CONFLICT', collection, recordId, version, current);
      Object.assign(current, { body, version: current.version + 1, updated_by_name: 'tester' });
      return structuredClone(current);
    };

    this.records = {
      getByKey: async (collection, key, opts) => {
        checkCollection(collection);
        this.calls.push(['getByKey', collection, key, opts]);
        return structuredClone(this.rows.get(`${collection}/${key}`) ?? null);
      },
      // Studio: create with a key that already exists rejects KEY_CONFLICT (no err.current).
      create: async (collection, { scope, project_handle, key, body }) => {
        checkCollection(collection);
        this.calls.push(['create', collection, key, { scope, project_handle }]);
        const id = `${collection}/${key}`;
        if (this.rows.has(id)) throw new Error('KEY_CONFLICT');
        const next = { record_id: id, collection, key, body, version: 1, state: 'draft', updated_by_name: 'tester' };
        this.rows.set(id, next);
        return structuredClone(next);
      },
      // Studio's update keeps a write-ahead entry while the write is in flight: cleared on success,
      // turned into a conflict entry on a refusal.
      update: async (collection, recordId, { version, body }) => {
        checkCollection(collection);
        this.calls.push(['update', collection, recordId, version]);
        const uKey = `${collection}/${recordId}`;
        this.unsaved.set(uKey, { state: 'inflight', body, base_version: version });
        try {
          const record = write(collection, recordId, version, body);
          this.unsaved.delete(uKey);
          return record;
        } catch (error) {
          if (error.message !== 'NOT_FOUND') this.unsaved.set(uKey, { state: 'conflict', code: error.message, body, base_version: version });
          throw error;
        }
      },
      publish: async (collection, recordId, { version }) => {
        checkCollection(collection);
        this.calls.push(['publish', collection, recordId, version]);
        const current = this.rows.get(recordId);
        if (current.state === 'published') throw refuse('PUBLISHED', collection, recordId, version);
        if (version !== current.version) throw refuse('VERSION_CONFLICT', collection, recordId, version, current);
        current.version += 1;
        current.state = 'published';
        return structuredClone(current);
      },
      reopen: async (collection, recordId, { version, reason }) => {
        checkCollection(collection);
        this.calls.push(['reopen', collection, recordId, version, reason]);
        const current = this.rows.get(recordId);
        if (version !== current.version) throw Object.assign(new Error('VERSION_CONFLICT'), { current: structuredClone(current) });
        current.version += 1;
        current.state = 'reopened';
        return structuredClone(current);
      },
    };

    // runConflictFlow: identical bodies need no dialog; otherwise the answer (conflictChoice) must be one
    // the host offers for that code. 'mine' writes over the current version; 'theirs' drops the entry and
    // returns the current record (undefined when the refusal carried none); 'later' keeps the entry.
    const flow = async ({ code, collection, recordId, current }, mine, resumed) => {
      const uKey = `${collection}/${recordId}`;
      const shown = current === null || current?.deleted_at ? 'DELETED' : code;
      if (shown === 'VERSION_CONFLICT' && current && sameJson(current.body, mine)) {
        this.unsaved.delete(uKey);
        return { choice: 'mine', record: current };
      }
      this.dialogs.push({ code: shown, record_id: recordId, resumed });
      const choice = this.conflictChoice;
      if (!CHOICES[shown].includes(choice)) throw Object.assign(new Error('INVALID_CHOICE'), { allowed: CHOICES[shown] });
      if (choice === 'later') return { choice };
      const record = choice === 'mine' ? write(collection, recordId, current.version, mine) : current ?? undefined;
      this.unsaved.delete(uKey);
      return { choice, record };
    };

    // studio.draft (Studio src/studio-plugin.js saveDraft/loadDraft/clearDraft/draftKeys): one store per
    // plugin and device, not per project; values are structured clones both ways, load of a missing key is
    // null, and save refuses the platform's own unsaved:/conflict: prefixes. NOTE(ceiling): the real store
    // also holds the SDK's unsaved: entries (kept in this.unsaved here), so keys() lists fewer keys.
    this.drafts = new Map();
    this.draft = {
      save: async (key, data) => {
        if (key.startsWith('unsaved:') || key.startsWith('conflict:')) throw Object.assign(new Error('RESERVED_KEY'), { code: 'RESERVED_KEY' });
        this.drafts.set(key, structuredClone(data));
      },
      load: async (key) => (this.drafts.has(key) ? structuredClone(this.drafts.get(key)) : null),
      clear: async (key) => { this.drafts.delete(key); },
      keys: async () => [...this.drafts.keys()],
    };

    this.sync = {
      // Takes a refused update/publish Error, or the plain-object form {current, collection, record_id, version?}.
      resolveConflict: async (err, { mine }) => {
        const collection = err.collection ?? err.current?.collection;
        const recordId = err.record_id ?? err.current?.record_id;
        this.calls.push(['resolveConflict', err instanceof Error ? err.message : 'object', recordId]);
        if (!mine || !collection || !recordId) throw new Error('INVALID_ARGUMENT');
        const code = err instanceof Error ? err.message : 'VERSION_CONFLICT';
        this.unsaved.set(`${collection}/${recordId}`, { state: 'conflict', code, body: mine, base_version: err.version });
        return flow({ code, collection, recordId, current: err.current }, mine, false);
      },
      savedConflict: async (collection, recordId) => structuredClone(this.unsaved.get(`${collection}/${recordId}`) ?? null),
      // The code comes from `current` only: a published record offers later/theirs, otherwise mine/theirs.
      resumeConflict: async (collection, recordId, { current }) => {
        this.calls.push(['resumeConflict', collection, recordId]);
        const saved = this.unsaved.get(`${collection}/${recordId}`);
        if (!saved) return null;
        const code = current?.state === 'published' ? 'PUBLISHED' : 'VERSION_CONFLICT';
        return flow({ code, collection, recordId, current }, saved.body, true);
      },
    };
  }
}
