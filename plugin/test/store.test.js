import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTER, createStore, PROJECT } from '../app/lib/store.js';
import { FakeStudio } from './fake-studio.js';

const C1 = 'specbook-chapter/07505';
const writes = (studio) => studio.calls.filter((c) => ['create', 'update', 'publish'].includes(c[0])).map((c) => c[0]);

test('project and chapter records are project-scoped and keyed by main / chapter code', async () => {
  const studio = new FakeStudio();
  const store = createStore(studio, 'p-1');
  assert.equal(await store.loadProject(), null);
  const saved = await store.saveProject({ item_codes: ['0750510004'], chapters: ['07505'], pack_version: '20260926' }, null);
  assert.equal(saved.ok, true);
  assert.deepEqual((await store.loadProject()).body.chapters, ['07505']);
  const again = await store.saveProject({ item_codes: [], chapters: ['07505', '01330'], pack_version: '20260926' }, saved.record);
  assert.equal(again.record.version, 2, 'a known record is updated by record_id, not created again');
  await store.saveChapter('07505', { 1: { slot: 1 } }, undefined);
  assert.deepEqual((await store.loadChapter('07505')).decisions, { 1: { slot: 1 } });
  const creates = studio.calls.filter((c) => c[0] === 'create');
  assert.deepEqual(creates.map((c) => [c[1], c[2], c[3].scope, c[3].project_handle]), [
    [PROJECT, 'main', 'project', 'p-1'],
    [CHAPTER, '07505', 'project', 'p-1'],
  ]);
  assert.deepEqual(studio.calls.filter((c) => c[0] === 'update').map((c) => c.slice(1)), [[PROJECT, 'specbook-project/main', 1]]);
});

// Two tabs: mine saved version 1, theirs already moved the chapter to version 2.
async function staleSetup() {
  const studio = new FakeStudio();
  const store = createStore(studio, 'p-1');
  const first = await store.saveChapter('07505', { 1: { slot: 1, choice: { option: 0 } } }, undefined);
  await store.saveChapter('07505', { 1: { slot: 1, choice: { text: '10' } } }, first.record);
  return { studio, store, stale: first.record };
}

test('stale version, user picks theirs: the other writer\'s decisions come back and nothing is overwritten', async () => {
  const { studio, store, stale } = await staleSetup();
  studio.conflictChoice = 'theirs';
  const result = await store.saveChapter('07505', { 1: { slot: 1, choice: { text: '20' } } }, stale);
  assert.deepEqual(studio.dialogs, [{ code: 'VERSION_CONFLICT', record_id: C1, resumed: false }]);
  assert.equal(result.ok, false);
  assert.equal(result.choice, 'theirs');
  assert.deepEqual(result.record.decisions, { 1: { slot: 1, choice: { text: '10' } } });
  assert.equal(result.record.version, 2);
  assert.deepEqual((await store.loadChapter('07505')).decisions, { 1: { slot: 1, choice: { text: '10' } } });
  assert.equal(await studio.sync.savedConflict(CHAPTER, C1), null, 'theirs discards my saved edit');
});

test('stale version, user picks mine: my decisions are written once over the current version', async () => {
  const { studio, store, stale } = await staleSetup();
  studio.conflictChoice = 'mine';
  const result = await store.saveChapter('07505', { 1: { slot: 1, choice: { text: '20' } } }, stale);
  assert.equal(result.ok, true);
  assert.equal(result.choice, 'mine');
  assert.deepEqual(result.record.decisions, { 1: { slot: 1, choice: { text: '20' } } });
  assert.equal(result.record.version, 3);
  assert.deepEqual(writes(studio), ['create', 'update', 'update'], 'the refused update is not retried by the store');
  assert.equal(await studio.sync.savedConflict(CHAPTER, C1), null);
});

test('a stale version is never decided without the user: no dialog answer, no write', async () => {
  const { studio, store, stale } = await staleSetup();
  await assert.rejects(store.saveChapter('07505', { 1: { slot: 1, choice: { text: '20' } } }, stale), /INVALID_CHOICE/);
  assert.deepEqual((await store.loadChapter('07505')).decisions, { 1: { slot: 1, choice: { text: '10' } } });
});

test('other errors are not swallowed', async () => {
  const studio = new FakeStudio();
  studio.records.create = async () => { throw new Error('DISK_LOW'); };
  await assert.rejects(createStore(studio, 'p-1').saveChapter('07505', {}, undefined), /DISK_LOW/);
  assert.equal(studio.calls.some((c) => c[0] === 'resolveConflict'), false);
});

test('publishAll and reopenAll pass versions and the reason through', async () => {
  const studio = new FakeStudio();
  const store = createStore(studio, 'p-1');
  const saved = await store.saveChapter('07505', {}, undefined);
  const publishEntries = [{ collection: CHAPTER, recordId: saved.record.recordId, version: saved.record.version, body: { decisions: {} } }];
  assert.equal(await store.publishAll(publishEntries), true);
  const published = await store.loadChapter('07505');
  const reopenEntries = [{ collection: CHAPTER, recordId: published.recordId, version: published.version }];
  await store.reopenAll(reopenEntries, '補充第 1.5 節');
  assert.deepEqual(studio.calls.filter((c) => !['create', 'update', 'getByKey'].includes(c[0])).map((c) => c.slice(0, 5)), [
    ['publish', CHAPTER, C1, 1],
    ['reopen', CHAPTER, C1, 2, '補充第 1.5 節'],
  ]);
});

test('a refused publish goes to the dialog, stops the run and is not published again', async () => {
  const studio = new FakeStudio();
  const store = createStore(studio, 'p-1');
  const a = await store.saveChapter('07505', { 1: { slot: 1 } }, undefined);
  const b = await store.saveChapter('01330', {}, undefined);
  await store.saveChapter('07505', { 1: { slot: 2 } }, a.record); // someone saved after the entries were read
  studio.conflictChoice = 'theirs';
  const done = await store.publishAll([
    { collection: CHAPTER, recordId: a.record.recordId, version: a.record.version, body: { decisions: a.record.decisions } },
    { collection: CHAPTER, recordId: b.record.recordId, version: b.record.version, body: { decisions: {} } },
  ]);
  assert.equal(done, false);
  assert.deepEqual(studio.dialogs.map((d) => d.code), ['VERSION_CONFLICT']);
  assert.deepEqual(writes(studio).filter((w) => w === 'publish'), ['publish']);
  assert.equal((await store.loadChapter('07505')).state, 'draft');
  assert.equal((await store.loadChapter('01330')).state, 'draft');
  assert.deepEqual((await store.loadChapter('07505')).decisions, { 1: { slot: 2 } }, 'theirs keeps the newer save');
});

async function publishedSetup() {
  const studio = new FakeStudio();
  const store = createStore(studio, 'p-1');
  const saved = await store.saveChapter('07505', { 1: { slot: 1 } }, undefined);
  await store.publishAll([{ collection: CHAPTER, recordId: saved.record.recordId, version: saved.record.version, body: { decisions: {} } }]);
  return { studio, store, record: await store.loadChapter('07505') };
}

test('saving a published chapter, user picks later: nothing written, the edit stays saved for later', async () => {
  const { studio, store, record } = await publishedSetup();
  studio.conflictChoice = 'later';
  const result = await store.saveChapter('07505', { 1: { slot: 9 } }, record);
  assert.deepEqual(result, { ok: false, choice: 'later', record: null });
  assert.deepEqual(studio.dialogs, [{ code: 'PUBLISHED', record_id: C1, resumed: false }]);
  assert.deepEqual((await studio.sync.savedConflict(CHAPTER, C1)).body, { decisions: { 1: { slot: 9 } } });
});

test('saving a published chapter, user picks theirs: the stored chapter is read back (the refusal has no current)', async () => {
  const { studio, store, record } = await publishedSetup();
  studio.conflictChoice = 'theirs';
  const result = await store.saveChapter('07505', { 1: { slot: 9 } }, record);
  assert.equal(result.choice, 'theirs');
  assert.equal(result.record.state, 'published');
  assert.deepEqual(result.record.decisions, { 1: { slot: 1 } });
  assert.equal(await studio.sync.savedConflict(CHAPTER, C1), null);
});

test('resume on open: an edit kept with later is asked about again once the chapter is reopened', async () => {
  const { studio, store, record } = await publishedSetup();
  studio.conflictChoice = 'later';
  await store.saveChapter('07505', { 1: { slot: 9 } }, record);
  const stillPublished = await store.openChapter('07505');
  assert.equal(stillPublished.state, 'published', 'later again while it is still published');
  assert.deepEqual(studio.dialogs.map((d) => [d.code, d.resumed]), [['PUBLISHED', false], ['PUBLISHED', true]]);
  await store.reopenAll([{ collection: CHAPTER, recordId: stillPublished.recordId, version: stillPublished.version }], '修正');
  studio.conflictChoice = 'mine';
  const opened = await store.openChapter('07505');
  assert.deepEqual(studio.dialogs.at(-1), { code: 'VERSION_CONFLICT', record_id: C1, resumed: true });
  assert.deepEqual(opened.decisions, { 1: { slot: 9 } });
  assert.deepEqual((await store.loadChapter('07505')).decisions, { 1: { slot: 9 } });
  assert.equal(await studio.sync.savedConflict(CHAPTER, C1), null);
});

test('resume on open: a write that landed before the tab closed clears without a dialog', async () => {
  const studio = new FakeStudio();
  const store = createStore(studio, 'p-1');
  await store.saveChapter('07505', { 1: { slot: 1 } }, undefined);
  studio.unsaved.set(`${CHAPTER}/${C1}`, { state: 'inflight', body: { decisions: { 1: { slot: 1 } } }, base_version: 0 });
  const opened = await store.openChapter('07505');
  assert.deepEqual(opened.decisions, { 1: { slot: 1 } });
  assert.deepEqual(studio.dialogs, []);
  assert.equal(await studio.sync.savedConflict(CHAPTER, C1), null);
});

test('resume on open: a write that never landed is asked about; theirs shows the stored chapter', async () => {
  const studio = new FakeStudio();
  const store = createStore(studio, 'p-1');
  await store.saveChapter('07505', { 1: { slot: 1 } }, undefined);
  studio.unsaved.set(`${CHAPTER}/${C1}`, { state: 'inflight', body: { decisions: { 1: { slot: 5 } } }, base_version: 1 });
  studio.conflictChoice = 'theirs';
  const opened = await store.openChapter('07505');
  assert.deepEqual(studio.dialogs, [{ code: 'VERSION_CONFLICT', record_id: C1, resumed: true }]);
  assert.deepEqual(opened.decisions, { 1: { slot: 1 } });
  assert.equal(await studio.sync.savedConflict(CHAPTER, C1), null);
});

test('open without a saved edit asks nothing; a missing chapter opens as null', async () => {
  const studio = new FakeStudio();
  const store = createStore(studio, 'p-1');
  assert.equal(await store.openChapter('07505'), null);
  await store.saveChapter('07505', { 1: { slot: 1 } }, undefined);
  assert.deepEqual((await store.openChapter('07505')).decisions, { 1: { slot: 1 } });
  assert.equal(await store.openProject(), null);
  assert.equal(studio.calls.some((c) => c[0] === 'resumeConflict'), false);
});

test('two first writes of the same chapter (KEY_CONFLICT): the second writer decides in the same dialog', async () => {
  for (const choice of ['theirs', 'mine']) {
    const studio = new FakeStudio();
    const alice = createStore(studio, 'p-1');
    const bob = createStore(studio, 'p-1');
    const first = await alice.saveChapter('07505', { 1: { slot: 1, choice: { option: 0 } } }, undefined);
    assert.equal(first.ok, true);
    studio.conflictChoice = choice;
    const second = await bob.saveChapter('07505', { 1: { slot: 1, choice: { option: 1 } } }, undefined);
    assert.deepEqual(studio.dialogs, [{ code: 'VERSION_CONFLICT', record_id: C1, resumed: false }], choice);
    const expected = choice === 'mine' ? { option: 1 } : { option: 0 };
    assert.equal(second.ok, choice === 'mine');
    assert.deepEqual(second.record.decisions[1].choice, expected);
    assert.deepEqual((await alice.loadChapter('07505')).decisions[1].choice, expected);
  }
});

test('two first writes with the same content: no dialog, the stored record is kept', async () => {
  const studio = new FakeStudio();
  await createStore(studio, 'p-1').saveProject({ chapters: ['07505'] }, null);
  const second = await createStore(studio, 'p-1').saveProject({ chapters: ['07505'] }, null);
  assert.equal(second.ok, true);
  assert.equal(second.record.version, 1);
  assert.deepEqual(studio.dialogs, []);
});
