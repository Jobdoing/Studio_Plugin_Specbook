export const PROJECT = 'specbook-project';
export const CHAPTER = 'specbook-chapter';
const PROJECT_KEY = 'main';
const REFUSED = ['VERSION_CONFLICT', 'LEASE_HELD', 'PUBLISHED'];

// One project record (key "main") and one record per chapter (key = chapter code), all scope "project"
// (spec §6.2). A refused write goes to the host's one conflict dialog (studio.sync.resolveConflict,
// Studio data.md §2.4(b)); the user's choice comes back as {ok, choice, record} and is never retried here.
// NOTE(ceiling): no lease.claim step, so two people can still edit one chapter at once and meet in the
// conflict dialog; upgrade path: lease.claim in openProject/openChapter plus an onCanClose release.
export function createStore(studio, projectHandle) {
  const scoped = { scope: 'project', project_handle: projectHandle };
  const shape = (raw) => raw && { body: raw.body, version: raw.version, recordId: raw.record_id, state: raw.state };
  const chapterShape = (raw) => raw && { decisions: raw.body.decisions, version: raw.version, recordId: raw.record_id, state: raw.state };

  // 'theirs' after a PUBLISHED/LEASE_HELD refusal carries no record (that refusal has no err.current),
  // so the stored one is read back.
  async function settle(conflict, mine, collection, key, label) {
    const result = await studio.sync.resolveConflict(conflict, { mine, label });
    if (result.choice === 'later') return { ok: false, choice: 'later', record: null };
    const record = result.record ?? (result.choice === 'theirs' ? await studio.records.getByKey(collection, key, scoped) : null);
    return { ok: result.choice === 'mine', choice: result.choice, record };
  }

  // A first write (no recordId) uses create with the key: put without a version would overwrite an
  // existing key silently. Later writes use update by record_id, so the SDK keeps a write-ahead entry
  // and tags a refusal with collection/record_id for resolveConflict (a put's PUBLISHED refusal has neither).
  // KEY_CONFLICT (someone else created the key first) is not a resolveConflict code and has no
  // err.current: the winner is read back and handed over as {current, collection, record_id}, the
  // SDK's plain-object form, so the user decides in the same host dialog.
  // NOTE(ceiling): that plain-object form is covered by the Studio SDK and mock tests but not listed in
  // the author docs; if Studio drops it, rethrow KEY_CONFLICT (errorText) and reload the winner instead.
  async function write(collection, key, body, known, label) {
    try {
      const record = known?.recordId === undefined
        ? await studio.records.create(collection, { ...scoped, key, body, label })
        : await studio.records.update(collection, known.recordId, { version: known.version, body, label });
      return { ok: true, record };
    } catch (error) {
      if (error.message === 'KEY_CONFLICT') {
        const current = await studio.records.getByKey(collection, key, scoped);
        if (!current) throw error;
        return settle({ current, collection, record_id: current.record_id }, body, collection, key, label);
      }
      if (!REFUSED.includes(error.message)) throw error;
      return settle(error, body, collection, key, label);
    }
  }

  // Open-a-record sequence (data.md §2.4(b)) minus the lease step: get, then ask again about a
  // saved-but-undecided write before the record is shown. Without leases 'later' is only offered for a
  // published record, which the caller shows read-only from its state.
  async function open(collection, key) {
    const raw = await studio.records.getByKey(collection, key, scoped);
    if (!raw || !(await studio.sync.savedConflict(collection, raw.record_id))) return raw;
    const result = await studio.sync.resumeConflict(collection, raw.record_id, { current: raw });
    return !result || result.choice === 'later' ? raw : result.record;
  }

  return {
    loadProject: async () => shape(await studio.records.getByKey(PROJECT, PROJECT_KEY, scoped)),
    openProject: async () => shape(await open(PROJECT, PROJECT_KEY)),
    async saveProject(body, known) {
      const result = await write(PROJECT, PROJECT_KEY, body, known, '章節清單');
      return { ...result, record: shape(result.record) };
    },
    loadChapter: async (code) => chapterShape(await studio.records.getByKey(CHAPTER, code, scoped)),
    openChapter: async (code) => chapterShape(await open(CHAPTER, code)),
    async saveChapter(code, decisions, known) {
      const result = await write(CHAPTER, code, { decisions }, known, `第 ${code} 章`);
      return { ...result, record: chapterShape(result.record) };
    },
    // Stops at the first refused publish and returns false; that refusal goes to the conflict dialog
    // (mine = the body as read just before publishing). Nothing is published again on its own.
    async publishAll(entries) {
      for (const { collection, recordId, version, body } of entries) {
        try {
          await studio.records.publish(collection, recordId, { version });
        } catch (error) {
          if (!REFUSED.includes(error.message)) throw error;
          await studio.sync.resolveConflict(error, { mine: body });
          return false;
        }
      }
      return true;
    },
    async reopenAll(entries, reason) {
      for (const { collection, recordId, version } of entries) await studio.records.reopen(collection, recordId, { version, reason });
    },
  };
}
