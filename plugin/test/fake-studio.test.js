import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStudio } from './fake-studio.js';

test('fake studio.draft behaves like the SDK store: clones, null when absent, clear, reserved prefixes', async () => {
  const { draft } = new FakeStudio();
  assert.equal(await draft.load('manual-a'), null);
  const value = { manual: { '02495': { choice: 'special', text: '條款' } }, base_version: 2 };
  await draft.save('manual-a', value);
  value.manual['02495'].text = 'changed after save';
  const loaded = await draft.load('manual-a');
  assert.deepEqual(loaded, { manual: { '02495': { choice: 'special', text: '條款' } }, base_version: 2 });
  loaded.base_version = 9;
  assert.equal((await draft.load('manual-a')).base_version, 2, 'load hands out a copy');
  assert.deepEqual(await draft.keys(), ['manual-a']);
  await draft.clear('manual-a');
  assert.equal(await draft.load('manual-a'), null);
  for (const key of ['unsaved:x', 'conflict:x']) await assert.rejects(draft.save(key, {}), /RESERVED_KEY/);
});
