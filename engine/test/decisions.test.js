import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyDecisions, chapterDefaults, decisionState, isValidChoice, progress } from '../index.js';
import { samplePack } from './sample-pack.js';

const chapter = samplePack.chapters['07505'];
const slot = (id) => chapter.slots[id];
const decide = (id, choice, version = 'V3.0') => ({ slot: id, chapter_version: version, choice, at: 't', by: 'u' });

test('each choice form is valid only for the slot kinds the spec allows', () => {
  assert.equal(isValidChoice(slot(1), { option: 0 }), true);
  assert.equal(isValidChoice(slot(1), { option: 1 }), false);
  assert.equal(isValidChoice(slot(1), { text: '10' }), true);
  assert.equal(isValidChoice(slot(1), { text: '  ' }), false);
  assert.equal(isValidChoice(slot(2), { option: 0 }), false);
  assert.equal(isValidChoice(slot(2), { text: '施工說明' }), true);
  assert.equal(isValidChoice(slot(3), { option: 1 }), true);
  assert.equal(isValidChoice(slot(4), { omit: true }), true);
  assert.equal(isValidChoice(slot(1), { omit: true }), false);
  assert.equal(isValidChoice(slot(5), { rewrite: '保固2年。' }), true);
  assert.equal(isValidChoice(slot(5), { text: '保固2年。' }), false);
  assert.equal(isValidChoice(slot(6), { text: '一式' }), false);
  assert.equal(isValidChoice(slot(6), { option: 1 }), true);
  assert.equal(isValidChoice(slot(1), { option: 0, via: 'chapter_defaults' }), true);
  assert.equal(isValidChoice(slot(6), { option: 0, via: 'chapter_defaults' }), false);
  assert.equal(isValidChoice(slot(1), null), false);
});

test('decision state distinguishes missing, stale, invalid and ok', () => {
  assert.equal(decisionState(chapter, '1', undefined), 'missing');
  assert.equal(decisionState(chapter, '1', decide(1, { option: 0 }, 'V2.0')), 'stale');
  assert.equal(decisionState(chapter, '6', decide(6, { text: 'x' })), 'invalid');
  assert.equal(decisionState(chapter, '1', decide(1, { option: 0 })), 'ok');
});

test('applying decisions fills slots, drops omitted sentences and keeps undecided or stale slots raw', () => {
  const decisions = {
    1: decide(1, { option: 0 }),
    2: decide(2, { text: '施工說明' }),
    3: decide(3, { option: 1 }),
    4: decide(4, { omit: true }),
    5: decide(5, { rewrite: '保固2年。' }),
    6: decide(6, { option: 0 }),
  };
  const [result] = applyDecisions(samplePack, ['07505'], { '07505': decisions });
  assert.equal(result.name, '屋頂防水層');
  assert.deepEqual(result.paragraphs, [
    { number: '1.5.2', text: '保證5年內。' },
    { number: '1.6', text: '施工說明' },
    { number: '2.1', text: '採用插入式。' },
    { number: '(1)', text: '保固2年。' },
    { number: '4.2.1', text: '依一式計價' },
    { number: '4.3', text: '本條無填空。' },
  ]);

  const [partial] = applyDecisions(samplePack, ['07505'], { '07505': { 1: decide(1, { option: 0 }, 'V2.0') } });
  assert.equal(partial.paragraphs[0].text, '保證[5][　　]年內。');
  assert.equal(partial.paragraphs[3].text, '[單價已包括一切費用]。');
});

test('chapter defaults fill only default_blank and optional slots that have no decision', () => {
  const existing = { 1: decide(1, { text: '10' }) };
  const result = chapterDefaults(samplePack, '07505', existing, { at: 't2', by: 'u2' });
  assert.deepEqual(Object.keys(result).sort(), ['1', '4']);
  assert.deepEqual(result['1'], existing['1']);
  assert.deepEqual(result['4'], { slot: 4, chapter_version: 'V3.0', choice: { option: 0, via: 'chapter_defaults' }, at: 't2', by: 'u2' });
  assert.notEqual(result, existing);
});

test('progress counts only ok decisions', () => {
  const decisions = { 1: decide(1, { option: 0 }), 2: decide(2, { text: 'x' }), 6: decide(6, { text: 'bad' }) };
  assert.deepEqual(progress(samplePack, '07505', decisions), { filled: 2, total: 6 });
});

test('real pack: chapter defaults plus apply produce the 07505 warranty sentence', () => {
  const realPack = JSON.parse(readFileSync(new URL('./fixtures/pack-sample.json', import.meta.url), 'utf8'));
  const decisions = chapterDefaults(realPack, '07505', {}, { at: 't', by: 'u' });
  const [result] = applyDecisions(realPack, ['07505'], { '07505': decisions });
  const warranty = result.paragraphs.find((p) => p.number === '1.5.2');
  assert.match(warranty.text, /自竣工驗收日起算，5年內/);
});

test('only an omitted slot can drop a paragraph, and any leftover without letters or digits counts as empty', () => {
  const pack = structuredClone(samplePack);
  pack.chapters['07505'].paragraphs.push({ number: '4.4', text: [{ slot: 4 }, '：'] });
  const [kept] = applyDecisions(pack, ['07505'], { '07505': { 2: decide(2, { text: '。' }), 4: decide(4, { omit: true }) } });
  assert.deepEqual(kept.paragraphs.find((p) => p.number === '1.6'), { number: '1.6', text: '。' });
  assert.equal(kept.paragraphs.find((p) => p.number === '4.4'), undefined);
});
