import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasBlocking, lint, NO_CODE_NAME, relatedChapters, resolveManual, selectChapters, specialName, toDocxModel } from '../../engine/index.js';
import { toTemplateData } from '../app/lib/docx-data.js';
import { manualPack as pack, NOWHERE, TABLE_ONLY } from './manual-pack.js';

test('budget codes without a spec chapter are unmatched: table-only vs in neither', () => {
  const { unmatched, chapters } = selectChapters([...TABLE_ONLY, ...NOWHERE].map((c) => `${c}00001`), pack);
  assert.deepEqual(chapters, []);
  assert.deepEqual(unmatched.filter((u) => u.reason === 'code_table_only').map((u) => u.code), TABLE_ONLY);
  assert.deepEqual(unmatched.filter((u) => u.reason === 'no_spec').map((u) => u.code), NOWHERE);
});

test('related chapters share the first 4 digits; no mapping table', () => {
  assert.deepEqual(relatedChapters(pack, '07920'), ['07921'], '07900 (prefix 0790) is not offered');
  assert.deepEqual(relatedChapters(pack, '01560'), ['01564']);
  assert.deepEqual(relatedChapters(pack, '01522'), ['01521', '01523']);
  assert.deepEqual(relatedChapters(pack, '02609'), ['02601']);
  assert.deepEqual(relatedChapters(pack, '02495'), ['02492']);
  for (const code of ['01540', '05060', '05500', '10103']) assert.deepEqual(relatedChapters(pack, code), [], code);
});

test('a special provision is named from the coding table, or marked as missing from it', () => {
  assert.equal(specialName(pack, '02495'), '監測儀器');
  assert.equal(specialName(pack, '02890'), NO_CODE_NAME);
  assert.equal(specialName(pack, '10103'), '（編碼表無此碼）');
});

test('each choice resolves; missing, incomplete and wrong-prefix choices stay unresolved', () => {
  const codes = ['01522', '01540', '02495', '02609', '05060', '07920', '10103'];
  const manual = {
    '01522': { choice: 'related', chapter: '01523' },
    '01540': { choice: 'special', text: '  ' }, // blank text
    '02495': { choice: 'special', text: '監測頻率每週一次。' },
    '02609': { choice: 'related', chapter: '' }, // no chapter picked yet
    '05060': { choice: 'exclude' },
    '07920': { choice: 'related', chapter: '07900' }, // not a same-prefix chapter
  };
  assert.deepEqual(resolveManual(pack, codes, manual), {
    unresolved: ['01540', '02609', '07920', '10103'],
    related: ['01523'],
    specials: [{ code: '02495', name: '監測儀器', text: '監測頻率每週一次。' }],
  });
});

test('unresolved codes block the formal document; a draft is still produced', () => {
  const unresolved = ['10103'];
  const issues = lint(pack, ['01564'], {}, unresolved);
  assert.deepEqual(issues, [{ chapter: '10103', rule: 'manual_unresolved', blocking: true }]);
  assert.equal(hasBlocking(issues), true);
  assert.equal(hasBlocking(lint(pack, ['01564'], {}, [])), false);
  assert.throws(() => toDocxModel(pack, ['01564'], {}, { draft: false, unresolved }), /blocking/i);
  const draft = toDocxModel(pack, ['01564'], {}, { draft: true, unresolved });
  assert.deepEqual(draft.toc.map((t) => t.code), ['01564'], 'an unresolved code is not written');
});

test('DOCX: related chapters are normal chapters, specials are own chapters in code order, excluded codes appear nowhere', () => {
  const codes = ['01560', '02495', '05500', '10103'];
  const manual = {
    '01560': { choice: 'related', chapter: '01564' },
    '02495': { choice: 'special', text: '一、監測頻率每週一次。\n\n二、異常時通知監造。 ' },
    '05500': { choice: 'exclude' },
    '10103': { choice: 'special', text: '依契約辦理。' },
  };
  const { related, specials, unresolved } = resolveManual(pack, codes, manual);
  assert.deepEqual(unresolved, []);
  const chosen = ['02320', ...related].sort();
  const data = toTemplateData(toDocxModel(pack, chosen, {}, { draft: false, specials, unresolved }));
  assert.deepEqual(data.toc.map((t) => t.title), ['第01564章 施工圍籬 V7.0', '第02320章 不適用材料 V5.0', '第02495章 監測儀器', '第10103章 （編碼表無此碼）']);
  assert.deepEqual(data.chapters[2].paragraphs, [{ line: '一、監測頻率每週一次。' }, { line: '二、異常時通知監造。' }]);
  assert.equal(data.chapters[2].end, '〈本章結束〉');
  assert.deepEqual(data.chapters[3].paragraphs, [{ line: '依契約辦理。' }]);
  const text = JSON.stringify(data);
  assert.equal(text.includes('05500'), false);
  assert.equal(text.includes('金屬製品'), false);
});
