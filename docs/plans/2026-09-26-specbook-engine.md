# specbook 子專案 2：引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `specbook/engine/`, a zero-dependency JavaScript ES module that turns PCCES item codes plus per-slot decisions into chapter lists, lint issues and a DOCX-ready model (spec §5).

**Architecture:** Pure functions over the pack JSON produced by ACKB `ackb-specbook-pack` (spec §4.2). No file, DOM, network or Studio SDK access. Four source files by responsibility (select, decisions, lint, docx-model) re-exported from `engine/index.js`. Tests run with Node's built-in runner against a small synthetic pack and a slice of the real pack.

**Tech Stack:** JavaScript (ES2022 modules), Node 26 built-in `node:test` and `node:assert/strict`. No npm packages.

## Global Constraints

- Spec: `/Volumes/AI-Model/specbook/docs/specs/2026-09-26-specbook-design.md` §5 is the contract. Exact names: `selectChapters`, `applyDecisions`, `lint`, `toDocxModel`; reasons `no_spec`, `code_table_only`, `deleted`; lint rules `unresolved`, `stale`, `invalid_choice` (blocking), `chapter_defaults`, `version_note` (non-blocking); choice forms `{"option": n}`, `{"text": "…"}`, `{"omit": true}`, `{"rewrite": "…"}`, `{"option": 0, "via": "chapter_defaults"}`.
- Chapter title format: `第07505章 屋頂防水層 V3.0（2011/12/30）`; without a date: `第07505章 屋頂防水層 V3.0`. End mark `〈本章結束〉`. Draft header text `草稿，未完成檢查`.
- `toDocxModel` must refuse `draft: false` while any blocking lint issue exists.
- Engine code never reads files, touches the DOM, or calls `studio.*`. Zero dependencies.
- Code, identifiers and comments in English; the user-visible strings above in Traditional Chinese exactly as written.
- Repo: `/Volumes/AI-Model/specbook` (branch `feat/engine`). Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Shared definitions (used by several tasks)

- `pack`: `{pack_version, built_at, chapters: {code: Chapter}, code_index: {code: name}, deleted: {code: name}}`.
- `Chapter`: `{name, version, announced, version_note, unmaintained, paragraphs: [{number, text: [string | {slot: number}]}], slots: {"<n>": {kind, options, raw}}, related, mentions}`.
- `decisionsByChapter`: `{code: {"<slot n>": {slot, chapter_version, choice, at, by}}}`.

## File Structure

- Create `engine/package.json` — module metadata, `npm test` = `node --test`.
- Create `engine/index.js` — re-exports the public API.
- Create `engine/src/select.js` — `selectChapters`.
- Create `engine/src/decisions.js` — `isValidChoice`, `decisionState`, `applyDecisions`, `chapterDefaults`, `progress`.
- Create `engine/src/lint.js` — `lint`, `hasBlocking`.
- Create `engine/src/docx-model.js` — `chapterTitle`, `toDocxModel`, constants.
- Create `engine/test/sample-pack.js` — synthetic pack covering every slot kind.
- Create `engine/test/fixtures/pack-sample.json` — real chapters 07505, 01330, 01450, 02220 plus code_index/deleted extracts.
- Create `engine/test/{select,decisions,lint,docx-model}.test.js`.

---

### Task 1: Scaffold, fixtures and `selectChapters`

**Files:**
- Create: `engine/package.json`, `engine/index.js`, `engine/src/select.js`, `engine/test/sample-pack.js`, `engine/test/fixtures/pack-sample.json`, `engine/test/select.test.js`

**Interfaces:**
- Produces: `selectChapters(itemCodes: string[], pack) -> {chapters: {code, items}[], unmatched: {code, items, reason}[], temporary: string[], unrecognized: string[], suggested: {code, referencedBy}[]}`; `samplePack` exported from `engine/test/sample-pack.js`.

- [ ] **Step 1: Create the branch, package file and fixtures**

```bash
cd /Volumes/AI-Model/specbook && git switch -c feat/engine && mkdir -p engine/src engine/test/fixtures
```

`engine/package.json`:

```json
{
  "name": "specbook-engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": "./index.js",
  "scripts": {
    "test": "node --test"
  }
}
```

Extract the real-data fixture from the pack ACKB built (read-only):

```bash
cd /Volumes/AI-Model/ACKB && .venv/bin/python -c "
import json
p = json.load(open('knowledge/specbook/specbook-pack-20260926.json'))
keep = ['07505', '01330', '01450', '02220']
out = {'pack_version': p['pack_version'], 'built_at': p['built_at'],
       'chapters': {c: p['chapters'][c] for c in keep},
       'code_index': {c: p['code_index'][c] for c in ('02991', '07121', '07505') if c in p['code_index']},
       'deleted': p['deleted']}
json.dump(out, open('/Volumes/AI-Model/specbook/engine/test/fixtures/pack-sample.json', 'w'), ensure_ascii=False, indent=1)
"
```

Expected: file of roughly 25–40 KB; `02991` present in `code_index`.

`engine/test/sample-pack.js`:

```js
// Synthetic pack covering every slot kind; shared by the engine tests.
export const samplePack = {
  pack_version: '20260926',
  built_at: '2026-09-26T00:00:00Z',
  chapters: {
    '07505': {
      name: '屋頂防水層',
      version: 'V3.0',
      announced: '2011/12/30',
      version_note: null,
      unmaintained: false,
      paragraphs: [
        { number: '1.5.2', text: ['保證', { slot: 1 }, '年內。'] },
        { number: '1.6', text: [{ slot: 2 }] },
        { number: '2.1', text: ['採用', { slot: 3 }, '。'] },
        { number: '4.2.2', text: [{ slot: 4 }, '。'] },
        { number: '(1)', text: [{ slot: 5 }] },
        { number: '4.2.1', text: ['依', { slot: 6 }, '計價'] },
        { number: '4.3', text: ['本條無填空。'] },
      ],
      slots: {
        1: { kind: 'default_blank', options: ['5'], raw: '[5][　　]' },
        2: { kind: 'blank', options: [], raw: '[　　]' },
        3: { kind: 'choice_blank', options: ['固定式', '插入式'], raw: '[固定式][插入式][　　]' },
        4: { kind: 'optional', options: ['單價已包括一切費用'], raw: '[單價已包括一切費用]' },
        5: { kind: 'malformed', options: [], raw: '[保固1年[　　]。' },
        6: { kind: 'choice', options: ['一式', '實作數量'], raw: '[一式][實作數量]' },
      },
      related: ['01330', '01450'],
      mentions: [],
    },
    '01330': { name: '資料送審', version: 'V6.0', announced: null, version_note: '版次來源不一致：內文表頭 V6.0、作業總表 V5.0',
      unmaintained: false, paragraphs: [{ number: '1.1', text: ['本章概要。'] }], slots: {}, related: [], mentions: [] },
    '01450': { name: '品質管理', version: 'V8.0', announced: '2023/03/27', version_note: null,
      unmaintained: false, paragraphs: [{ number: '1.1', text: ['本章概要。'] }], slots: {}, related: ['01330'], mentions: [] },
  },
  code_index: { '02991': '工區結構物及設施復原', '07505': '屋頂防水層' },
  deleted: { 10213: '鋁質百葉窗' },
};
```

- [ ] **Step 2: Write the failing tests** — `engine/test/select.test.js`

```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Volumes/AI-Model/specbook/engine && node --test`
Expected: FAIL — `Cannot find module '.../engine/index.js'`

- [ ] **Step 4: Implement** — `engine/src/select.js`

```js
const CHAPTER_CODE = /^\d{5}$/;

function add(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function sortedEntries(map) {
  return [...map].sort(([a], [b]) => a.localeCompare(b));
}

function unmatchedReason(code, pack) {
  if (pack.deleted[code]) return 'deleted';
  if (pack.code_index[code]) return 'code_table_only';
  return 'no_spec';
}

// Spec §5.1: the chapter code is the first 5 characters of a PCCES item code.
export function selectChapters(itemCodes, pack) {
  const seen = new Set();
  const found = new Map();
  const missing = new Map();
  const temporary = [];
  const unrecognized = [];
  for (const raw of itemCodes) {
    const item = String(raw).trim().toUpperCase();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    if (item.startsWith('Z')) {
      temporary.push(item);
      continue;
    }
    const code = item.slice(0, 5);
    if (!CHAPTER_CODE.test(code)) {
      unrecognized.push(item);
      continue;
    }
    add(pack.chapters[code] ? found : missing, code, item);
  }

  const suggested = new Map();
  for (const [code] of sortedEntries(found)) {
    for (const ref of pack.chapters[code].related) {
      if (!found.has(ref) && pack.chapters[ref]) add(suggested, ref, code);
    }
  }

  return {
    chapters: sortedEntries(found).map(([code, items]) => ({ code, items })),
    unmatched: sortedEntries(missing).map(([code, items]) => ({ code, items, reason: unmatchedReason(code, pack) })),
    temporary,
    unrecognized,
    suggested: sortedEntries(suggested).map(([code, referencedBy]) => ({ code, referencedBy })),
  };
}
```

`engine/index.js`:

```js
export { selectChapters } from './src/select.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Volumes/AI-Model/specbook/engine && node --test`
Expected: `# pass 3`, `# fail 0`

- [ ] **Step 6: Commit**

```bash
cd /Volumes/AI-Model/specbook
git add engine
git commit -m "feat(engine): map PCCES item codes to spec chapters

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Decisions — validity, applying, chapter defaults, progress

**Files:**
- Create: `engine/src/decisions.js`, `engine/test/decisions.test.js`
- Modify: `engine/index.js`

**Interfaces:**
- Consumes: `samplePack` (Task 1).
- Produces:
  - `isValidChoice(slot, choice) -> boolean`
  - `decisionState(chapter, slotId: string, decision | undefined) -> 'missing' | 'stale' | 'invalid' | 'ok'`
  - `applyDecisions(pack, chapterCodes: string[], decisionsByChapter) -> {code, name, version, announced, paragraphs: {number, text: string}[]}[]`
  - `chapterDefaults(pack, code, decisions, {at, by}) -> decisions` (new object; existing entries kept)
  - `progress(pack, code, decisions) -> {filled, total}`

- [ ] **Step 1: Write the failing tests** — `engine/test/decisions.test.js`

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/AI-Model/specbook/engine && node --test`
Expected: FAIL — `does not provide an export named 'applyDecisions'`

- [ ] **Step 3: Implement** — `engine/src/decisions.js`

```js
const OPTION_KINDS = new Set(['default_blank', 'optional', 'choice', 'choice_blank']);
const TEXT_KINDS = new Set(['default_blank', 'blank', 'choice_blank']);
const DEFAULT_KINDS = new Set(['default_blank', 'optional']);
// A paragraph whose slots were all omitted and that is left with only spaces or punctuation is dropped.
const EMPTY_AFTER_OMIT = /^[\s　。，；、．.]*$/;

const filled = (value) => typeof value === 'string' && value.trim() !== '';

// Spec §5.2: which choice forms each slot kind accepts.
export function isValidChoice(slot, choice) {
  if (!choice || typeof choice !== 'object') return false;
  if ('option' in choice) {
    const inRange = Number.isInteger(choice.option) && choice.option >= 0 && choice.option < slot.options.length;
    if (!OPTION_KINDS.has(slot.kind) || !inRange) return false;
    if (choice.via === undefined) return true;
    return choice.via === 'chapter_defaults' && DEFAULT_KINDS.has(slot.kind) && choice.option === 0;
  }
  if ('text' in choice) return TEXT_KINDS.has(slot.kind) && filled(choice.text);
  if ('omit' in choice) return slot.kind === 'optional' && choice.omit === true;
  if ('rewrite' in choice) return slot.kind === 'malformed' && filled(choice.rewrite);
  return false;
}

export function decisionState(chapter, slotId, decision) {
  if (!decision) return 'missing';
  if (decision.chapter_version !== chapter.version) return 'stale';
  return isValidChoice(chapter.slots[slotId], decision.choice) ? 'ok' : 'invalid';
}

function slotText(slot, choice) {
  if ('option' in choice) return slot.options[choice.option];
  if ('text' in choice) return choice.text;
  if ('omit' in choice) return '';
  return choice.rewrite;
}

export function applyDecisions(pack, chapterCodes, decisionsByChapter) {
  return chapterCodes.map((code) => {
    const chapter = pack.chapters[code];
    const decisions = decisionsByChapter[code] ?? {};
    const paragraphs = [];
    for (const paragraph of chapter.paragraphs) {
      let hasSlot = false;
      const text = paragraph.text
        .map((part) => {
          if (typeof part === 'string') return part;
          hasSlot = true;
          const id = String(part.slot);
          const decision = decisions[id];
          const slot = chapter.slots[id];
          return decisionState(chapter, id, decision) === 'ok' ? slotText(slot, decision.choice) : slot.raw;
        })
        .join('');
      if (hasSlot && EMPTY_AFTER_OMIT.test(text)) continue;
      paragraphs.push({ number: paragraph.number, text });
    }
    return { code, name: chapter.name, version: chapter.version, announced: chapter.announced, paragraphs };
  });
}

// "本章全部採用預設": keep defaults for default_blank and keep optional sentences; never overwrite a decision.
export function chapterDefaults(pack, code, decisions, { at, by }) {
  const chapter = pack.chapters[code];
  const result = { ...decisions };
  for (const [id, slot] of Object.entries(chapter.slots)) {
    if (!DEFAULT_KINDS.has(slot.kind) || result[id]) continue;
    result[id] = { slot: Number(id), chapter_version: chapter.version, choice: { option: 0, via: 'chapter_defaults' }, at, by };
  }
  return result;
}

export function progress(pack, code, decisions) {
  const chapter = pack.chapters[code];
  const ids = Object.keys(chapter.slots);
  const ok = ids.filter((id) => decisionState(chapter, id, decisions[id]) === 'ok').length;
  return { filled: ok, total: ids.length };
}
```

`engine/index.js` (replace):

```js
export { selectChapters } from './src/select.js';
export { applyDecisions, chapterDefaults, decisionState, isValidChoice, progress } from './src/decisions.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Volumes/AI-Model/specbook/engine && node --test`
Expected: `# pass 9`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
cd /Volumes/AI-Model/specbook
git add engine
git commit -m "feat(engine): validate, apply and default slot decisions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `lint`

**Files:**
- Create: `engine/src/lint.js`, `engine/test/lint.test.js`
- Modify: `engine/index.js`

**Interfaces:**
- Consumes: `decisionState` (Task 2), `samplePack`.
- Produces: `lint(pack, chapterCodes, decisionsByChapter) -> {chapter, slot?, rule, blocking, count?, note?}[]`; `hasBlocking(issues) -> boolean`.

- [ ] **Step 1: Write the failing tests** — `engine/test/lint.test.js`

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/AI-Model/specbook/engine && node --test`
Expected: FAIL — `does not provide an export named 'hasBlocking'`

- [ ] **Step 3: Implement** — `engine/src/lint.js`

```js
import { decisionState } from './decisions.js';

const BLOCKING_RULES = { missing: 'unresolved', stale: 'stale', invalid: 'invalid_choice' };

// Spec §5.3: blocking issues stop the formal DOCX; the rest are listed for review.
export function lint(pack, chapterCodes, decisionsByChapter) {
  const issues = [];
  for (const code of chapterCodes) {
    const chapter = pack.chapters[code];
    const decisions = decisionsByChapter[code] ?? {};
    let viaDefaults = 0;
    for (const id of Object.keys(chapter.slots)) {
      const state = decisionState(chapter, id, decisions[id]);
      if (state === 'ok') {
        if (decisions[id].choice.via === 'chapter_defaults') viaDefaults += 1;
      } else {
        issues.push({ chapter: code, slot: Number(id), rule: BLOCKING_RULES[state], blocking: true });
      }
    }
    if (viaDefaults) issues.push({ chapter: code, rule: 'chapter_defaults', blocking: false, count: viaDefaults });
    if (chapter.version_note) issues.push({ chapter: code, rule: 'version_note', blocking: false, note: chapter.version_note });
  }
  return issues;
}

export const hasBlocking = (issues) => issues.some((issue) => issue.blocking);
```

`engine/index.js` (append):

```js
export { hasBlocking, lint } from './src/lint.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Volumes/AI-Model/specbook/engine && node --test`
Expected: `# pass 12`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
cd /Volumes/AI-Model/specbook
git add engine
git commit -m "feat(engine): lint unresolved, stale and invalid slot decisions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `toDocxModel`

**Files:**
- Create: `engine/src/docx-model.js`, `engine/test/docx-model.test.js`
- Modify: `engine/index.js`

**Interfaces:**
- Consumes: `applyDecisions` (Task 2), `lint`, `hasBlocking` (Task 3).
- Produces: `chapterTitle(code, chapter) -> string`; `toDocxModel(pack, chapterCodes, decisionsByChapter, {draft}) -> {draft, watermark, toc: {code, title}[], chapters: {code, title, paragraphs: {number, text}[], end}[]}`; constants `DRAFT_WATERMARK`, `END_MARK`.

- [ ] **Step 1: Write the failing tests** — `engine/test/docx-model.test.js`

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/AI-Model/specbook/engine && node --test`
Expected: FAIL — `does not provide an export named 'chapterTitle'`

- [ ] **Step 3: Implement** — `engine/src/docx-model.js`

```js
import { applyDecisions } from './decisions.js';
import { hasBlocking, lint } from './lint.js';

export const DRAFT_WATERMARK = '草稿，未完成檢查';
export const END_MARK = '〈本章結束〉';

export function chapterTitle(code, chapter) {
  const date = chapter.announced ? `（${chapter.announced}）` : '';
  return `第${code}章 ${chapter.name} ${chapter.version}${date}`;
}

// Spec §5.4: the data handed to the Studio DOCX helper. The formal document requires a lint with no blocking issue.
export function toDocxModel(pack, chapterCodes, decisionsByChapter, { draft }) {
  if (!draft && hasBlocking(lint(pack, chapterCodes, decisionsByChapter))) {
    throw new Error('Blocking lint issues remain; only a draft can be produced.');
  }
  const chapters = applyDecisions(pack, chapterCodes, decisionsByChapter).map((chapter) => ({
    code: chapter.code,
    title: chapterTitle(chapter.code, pack.chapters[chapter.code]),
    paragraphs: chapter.paragraphs,
    end: END_MARK,
  }));
  return {
    draft,
    watermark: draft ? DRAFT_WATERMARK : null,
    toc: chapters.map(({ code, title }) => ({ code, title })),
    chapters,
  };
}
```

`engine/index.js` (append):

```js
export { chapterTitle, DRAFT_WATERMARK, END_MARK, toDocxModel } from './src/docx-model.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Volumes/AI-Model/specbook/engine && node --test`
Expected: `# pass 15`, `# fail 0`

- [ ] **Step 5: Confirm the engine has no forbidden access**

Run: `cd /Volumes/AI-Model/specbook/engine && grep -rnE "from 'node:|document\.|window\.|studio\.|fetch\(" src index.js`
Expected: no output (only tests may import `node:*`).

- [ ] **Step 6: Commit**

```bash
cd /Volumes/AI-Model/specbook
git add engine
git commit -m "feat(engine): build the DOCX model with draft watermark and formal gate

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
