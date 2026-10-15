import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chapterTitle, DRAFT_WATERMARK, END_MARK, toDocxModel } from '../index.js';
import { samplePack } from './sample-pack.js';

const decide = (id, choice) => ({ slot: id, chapter_version: 'V3.0', choice, at: 't', by: 'u' });
const complete = {
  '07505': {
    1: decide(1, { option: 0 }), 2: decide(2, { text: '施工說明' }), 3: decide(3, { option: 1 }),
    4: decide(4, { omit: true }), 5: decide(5, { rewrite: '保固2年。' }), 6: decide(6, { option: 0 }),
  },
};

test('chapter titles carry code, name, version and the date when known', () => {
  assert.equal(chapterTitle('07505', samplePack.chapters['07505']), '第07505章 屋頂防水層 V3.0（2011/12/30）');
  assert.equal(chapterTitle('01330', samplePack.chapters['01330']), '第01330章 資料送審 V6.0');
});

test('a formal model has a table of contents, filled paragraphs and the end mark', () => {
  const model = toDocxModel(samplePack, ['07505', '01330'], complete, { draft: false });
  assert.equal(model.draft, false);
  assert.equal(model.watermark, null);
  assert.deepEqual(model.toc, [
    { code: '07505', title: '第07505章 屋頂防水層 V3.0（2011/12/30）' },
    { code: '01330', title: '第01330章 資料送審 V6.0' },
  ]);
  assert.equal(model.chapters[0].paragraphs[0].text, '保證5年內。');
  assert.equal(model.chapters[0].end, END_MARK);
  assert.equal(END_MARK, '〈本章結束〉');
});

test('the formal model is refused while blocking issues remain; a draft is allowed and watermarked', () => {
  assert.throws(() => toDocxModel(samplePack, ['07505'], {}, { draft: false }), /blocking/i);
  const draft = toDocxModel(samplePack, ['07505'], {}, { draft: true });
  assert.equal(draft.watermark, DRAFT_WATERMARK);
  assert.equal(DRAFT_WATERMARK, '草稿，未完成檢查');
  assert.equal(draft.chapters[0].paragraphs[0].text, '保證[5][　　]年內。');
});
