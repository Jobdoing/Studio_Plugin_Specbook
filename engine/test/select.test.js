import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectChapters } from '../index.js';
import { samplePack } from './sample-pack.js';

const realPack = JSON.parse(readFileSync(new URL('./fixtures/pack-sample.json', import.meta.url), 'utf8'));

test('groups item codes by chapter and explains every code that does not map to a spec chapter', () => {
  const result = selectChapters(
    ['0750510004', '0750520004', ' 0133012004', '0299110003', '1021300001', 'Z000000001', 'ABCDE12345', '0750510004', '5555500001', ''],
    samplePack,
  );
  assert.deepEqual(result.chapters, [
    { code: '01330', items: ['0133012004'] },
    { code: '07505', items: ['0750510004', '0750520004'] },
  ]);
  assert.deepEqual(result.unmatched, [
    { code: '02991', items: ['0299110003'], reason: 'code_table_only' },
    { code: '10213', items: ['1021300001'], reason: 'deleted' },
    { code: '55555', items: ['5555500001'], reason: 'no_spec' },
  ]);
  assert.deepEqual(result.temporary, ['Z000000001']);
  assert.deepEqual(result.unrecognized, ['ABCDE12345']);
  assert.deepEqual(result.suggested, [{ code: '01450', referencedBy: ['07505'] }]);
});

test('lower-case temporary codes are normalized before classification', () => {
  assert.deepEqual(selectChapters(['z01'], samplePack).temporary, ['Z01']);
});

test('real pack: 02991 is table-only and 07505 suggests its related chapters', () => {
  const result = selectChapters(['0299100001', '0750510004'], realPack);
  assert.deepEqual(result.chapters.map((c) => c.code), ['07505']);
  assert.equal(result.unmatched[0].reason, 'code_table_only');
  assert.deepEqual(result.suggested.map((s) => s.code), ['01330', '01450']);
});

test('real pack: camp-sample codes resolve to their chapters and 02991 is explained', () => {
  // The fixture holds 4 of the camp chapters' neighbours; 01330 and 02220 are camp chapters present in it.
  const result = selectChapters(['0133010004', '0222010004', '0299110004'], realPack);
  assert.deepEqual(result.chapters.map((c) => c.code), ['01330', '02220']);
  assert.deepEqual(result.unmatched, [{ code: '02991', items: ['0299110004'], reason: 'code_table_only' }]);
});
