import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chapterDefaults, hasBlocking, lint } from '../index.js';
import { samplePack } from './sample-pack.js';

const decide = (id, choice, version = 'V3.0') => ({ slot: id, chapter_version: version, choice, at: 't', by: 'u' });

test('every slot without a decision is a blocking unresolved issue', () => {
  const issues = lint(samplePack, ['07505'], {});
  assert.deepEqual(issues.map((i) => [i.slot, i.rule, i.blocking]), [
    [1, 'unresolved', true], [2, 'unresolved', true], [3, 'unresolved', true],
    [4, 'unresolved', true], [5, 'unresolved', true], [6, 'unresolved', true],
  ]);
  assert.equal(hasBlocking(issues), true);
});

test('stale and invalid decisions are blocking; chapter defaults and version notes are not', () => {
  let decisions = chapterDefaults(samplePack, '07505', {}, { at: 't', by: 'u' });
  decisions = {
    ...decisions,
    2: decide(2, { text: 'x' }, 'V2.0'),
    3: decide(3, { option: 0 }),
    5: decide(5, { rewrite: '保固2年。' }),
    6: decide(6, { text: 'bad' }),
  };
  const issues = lint(samplePack, ['07505', '01330'], { '07505': decisions });
  assert.deepEqual(issues, [
    { chapter: '07505', slot: 2, rule: 'stale', blocking: true },
    { chapter: '07505', slot: 6, rule: 'invalid_choice', blocking: true },
    { chapter: '07505', rule: 'chapter_defaults', blocking: false, count: 2 },
    { chapter: '01330', rule: 'version_note', blocking: false, note: '版次來源不一致：內文表頭 V6.0、作業總表 V5.0' },
  ]);
});

test('a fully and validly decided chapter has no blocking issue', () => {
  const decisions = {
    1: decide(1, { option: 0 }), 2: decide(2, { text: 'x' }), 3: decide(3, { option: 1 }),
    4: decide(4, { omit: true }), 5: decide(5, { rewrite: 'y' }), 6: decide(6, { option: 0 }),
  };
  assert.deepEqual(lint(samplePack, ['07505'], { '07505': decisions }), []);
  assert.equal(hasBlocking([]), false);
});
