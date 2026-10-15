import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractItemCodes } from '../app/lib/codes.js';

const camp = JSON.parse(readFileSync(new URL('./fixtures/camp-detail-sheet.json', import.meta.url), 'utf8'));

test('real camp sample: 32 item codes, flags after the comma are dropped', () => {
  const result = extractItemCodes({ 預算詳細表: camp });
  assert.equal(result.error, null);
  assert.equal(result.codes.length, 32);
  assert.ok(result.codes.includes('015831000A'));
  assert.ok(result.codes.includes('0299100004'));
  assert.equal(new Set(result.codes.map((c) => c.slice(0, 5))).size, 16);
  assert.deepEqual(result.warnings, []);
});

test('numeric cells are reported, not guessed; remarks and duplicates are skipped', () => {
  const rows = [
    ['項 次', '項  目  及  說  明', '編碼(備註)'],
    ['1', 'a', '0133012004,*'],
    ['2', 'b', 133051004],
    ['3', 'c', '另詳圖說'],
    ['4', 'd', { richText: [{ text: '0222031142' }] }],
    ['5', 'e', '0133012004'],
    ['6', 'f', ''],
  ];
  const result = extractItemCodes({ 預算詳細表: rows });
  assert.deepEqual(result.codes, ['0133012004', '0222031142']);
  assert.deepEqual(result.warnings, ['第 3 列的編碼是數字格式（133051004），開頭的 0 可能已遺失，已略過，請改用文字格式或手動加章。']);
});

test('missing sheet or column is an explicit error', () => {
  assert.equal(extractItemCodes({ 其他: [] }).error, '找不到「預算詳細表」工作表。');
  assert.equal(extractItemCodes({ 預算詳細表: [['項次', '說明']] }).error, '「預算詳細表」沒有「編碼(備註)」欄。');
});

test('a numeric formula result is reported like a plain numeric cell, not silently accepted', () => {
  const rows = [
    ['項 次', '項  目  及  說  明', '編碼(備註)'],
    ['1', 'a', { formula: 'A1', result: 133051004 }],
  ];
  const result = extractItemCodes({ 預算詳細表: rows });
  assert.deepEqual(result.codes, []);
  assert.deepEqual(result.warnings, ['第 2 列的編碼是數字格式（133051004），開頭的 0 可能已遺失，已略過，請改用文字格式或手動加章。']);
});

test('a full-width parenthesis header is recognized', () => {
  const rows = [
    ['項 次', '項  目  及  說  明', '編碼（備註）'],
    ['1', 'a', '0133012004'],
  ];
  const result = extractItemCodes({ 預算詳細表: rows });
  assert.equal(result.error, null);
  assert.deepEqual(result.codes, ['0133012004']);
});
