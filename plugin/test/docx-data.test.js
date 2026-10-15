import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDocxModel } from '../../engine/index.js';
import { samplePack } from '../../engine/test/sample-pack.js';
import { toTemplateData } from '../app/lib/docx-data.js';

test('draft model maps to template data with the watermark and numbered lines', () => {
  const data = toTemplateData(toDocxModel(samplePack, ['07505', '01330'], {}, { draft: true }));
  assert.equal(data.draftLabel, '草稿，未完成檢查');
  assert.deepEqual(data.toc, [{ title: '第07505章 屋頂防水層 V3.0（2011/12/30）' }, { title: '第01330章 資料送審 V6.0' }]);
  assert.equal(data.chapters[0].paragraphs[0].line, '1.5.2\u3000保證[5][　　]年內。');
  assert.equal(data.chapters[0].end, '〈本章結束〉');
});

test('paragraphs without a number keep only their text; the formal model has an empty draft label', () => {
  const pack = structuredClone(samplePack);
  pack.chapters['01330'].paragraphs = [{ number: null, text: ['本章概要。'] }];
  const data = toTemplateData(toDocxModel(pack, ['01330'], {}, { draft: false }));
  assert.equal(data.draftLabel, '');
  assert.deepEqual(data.chapters[0].paragraphs, [{ line: '本章概要。' }]);
});
