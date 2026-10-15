// Behaviour check for the UI (project switch, save order, publish, errors): stub DOM + FakeStudio, real app.js/fill.js/engine.
import assert from 'node:assert/strict';
import { FakeStudio } from './fake-studio.js';
import { samplePack } from './sample-pack.js';
import { manualPack } from './manual-pack.js';

class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.hidden = false; this.disabled = false; this.checked = false; this.value = ''; this._text = ''; }
  set textContent(v) { this._text = v; this.children = []; }
  get textContent() { return this._text + this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'value') this.value = String(v); if (k === 'disabled') this.disabled = true; }
  getAttribute(k) { return this.attrs[k]; }
  append(...c) { this.children.push(...c); }
  replaceChildren(...c) { this.children = c; this._text = ''; }
  addEventListener(e, fn) { (this.listeners[e] ??= []).push(fn); }
  fire(e) { for (const fn of this.listeners[e] ?? []) fn({ target: this }); }
  *walk() { for (const c of this.children) if (typeof c !== 'string') { yield c; yield* c.walk(); } }
}
const byId = new Map();
globalThis.document = {
  getElementById: (id) => { if (!byId.has(id)) byId.set(id, new Node('div')); return byId.get(id); },
  createElement: (tag) => new Node(tag),
  querySelectorAll: () => [...document.getElementById('chapter-groups').walk()].filter((n) => n.tagName === 'input' && n.attrs['data-chapter'] && n.checked),
};
const $ = document.getElementById;
globalThis.fetch = async () => ({ json: async () => structuredClone(samplePack), blob: async () => 'template' });
let docxData = null; // template data handed to studio.docx.fromTemplate by the last download
const downloads = [];

const fakes = { 'p-1': new FakeStudio(), 'p-2': new FakeStudio() };
const device = new FakeStudio(); // studio.draft is one store per plugin and device, shared by every project
const delay = { 'p-1': 0, 'p-2': 0 };
let active = 'p-1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const route = (h) => fakes[h ?? active];
let projectListener;
globalThis.studio = {
  me: async () => ({ displayName: '我' }),
  onProjectChange: (fn) => { projectListener = fn; },
  notify: () => {}, confirm: async () => true, prompt: async () => '補充',
  docx: { fromTemplate: async (template, data) => { docxData = data; return 'docx'; } },
  download: async (name) => { downloads.push(name); },
  records: {
    getByKey: async (c, k, o) => { await sleep(delay[o.project_handle]); return route(o.project_handle).records.getByKey(c, k, o); },
    create: (c, o) => route(o.project_handle).records.create(c, o),
    update: (...a) => route().records.update(...a),
    publish: (...a) => route().records.publish(...a),
    reopen: (...a) => route().records.reopen(...a),
  },
  draft: device.draft,
  sync: {
    resolveConflict: (...a) => route().sync.resolveConflict(...a),
    savedConflict: (...a) => route().sync.savedConflict(...a),
    resumeConflict: (...a) => route().sync.resumeConflict(...a),
  },
};
assert.ok(projectListener === undefined);
const app = await import('./app.js');
assert.equal(typeof projectListener, 'function', 'item 8: onProjectChange registered synchronously');
const { state, stepHandlers, errorText, notice } = app;
const tick = () => sleep(20);
const switchTo = async (h) => { active = h; projectListener(h && { project_handle: h, project_key: `k-${h}`, name: h }); await tick(); await tick(); };
const boxes = () => [...$('chapter-groups').walk()].filter((n) => n.attrs['data-chapter']);

// item 2: extra_chapters filtered against the pack, dropped extras in the notice
await fakes['p-1'].records.create('specbook-project', { key: 'main', body: { item_codes: ['0750510004'], extra_chapters: ['99999', '01330'], chapters: ['07505', '88888'] } });
await switchTo('p-1');
assert.deepEqual(state.extraChapters, ['01330']);
assert.match($('notice').textContent, /88888/); assert.match($('notice').textContent, /99999/);

// item 2: a stale error notice is cleared by a later successful save
const chapterBox = () => boxes().find((n) => n.value === '07505');
chapterBox().checked = false;
$('save-chapters').fire('click'); await tick();
assert.equal($('notice').textContent, '請至少勾選一章。', 'item2: save validation sets an error notice');
chapterBox().checked = true;
$('save-chapters').fire('click'); await tick();
assert.equal($('notice').textContent, '', 'item2: a later successful save clears the stale error notice');

// item 3: a suggested chapter added via search renders once, checked
state.chosen = ['07505']; state.projectRecord.body.extra_chapters = [];
app.renderStep2();
assert.equal(boxes().filter((n) => n.value === '01330').length, 1, 'no duplicate checkbox');
assert.equal(boxes().find((n) => n.value === '01330').checked, true, 'added via search is checked');
state.chosen = ['07505']; state.extraChapters = [];

// item 4: radio click right after a text blur keeps both choices, no self-conflict
await stepHandlers[3](); await tick();
const inputs = () => [...$('slots').walk()].filter((n) => n.tagName === 'input');
const text1 = inputs().find((n) => n.attrs.id === 'text-07505-1');
const radio3 = inputs().find((n) => n.attrs.name === 'slot-07505-3' && n.value === '1');
text1.value = '7'; text1.fire('change');
radio3.checked = true; radio3.fire('change');
await tick(); await tick();
const saved = fakes['p-1'].rows.get('specbook-chapter/07505').body.decisions;
assert.deepEqual(saved[1].choice, { text: '7' }); assert.deepEqual(saved[3].choice, { option: 1 });
assert.deepEqual(fakes['p-1'].dialogs, [], 'no self-conflict');

// Conflicts go to the host's dialog (studio.sync.resolveConflict); the plugin draws no conflict box.
const p1 = fakes['p-1'];
const row = () => p1.rows.get('specbook-chapter/07505');
const textInput = () => inputs().find((n) => n.attrs.id === 'text-07505-1');
// theirs: someone else saved after this page read the chapter -> the stored text is shown
Object.assign(row(), { body: { decisions: { ...row().body.decisions, 1: { ...row().body.decisions[1], choice: { text: '99' } } } }, version: row().version + 1 });
p1.conflictChoice = 'theirs';
textInput().value = '8'; textInput().fire('change'); await tick(); await tick();
assert.deepEqual(p1.dialogs.map((d) => d.code), ['VERSION_CONFLICT']);
assert.equal(textInput().value, '99', 'theirs: the stored text is shown');
assert.deepEqual(row().body.decisions[1].choice, { text: '99' });
// later: the chapter was published meanwhile -> my edit is kept aside, the chapter turns read-only
Object.assign(row(), { state: 'published', version: row().version + 1 });
p1.conflictChoice = 'later';
textInput().value = '6'; textInput().fire('change'); await tick(); await tick();
assert.deepEqual(p1.dialogs.map((d) => d.code), ['VERSION_CONFLICT', 'PUBLISHED']);
assert.equal(textInput().disabled, true, 'later: the chapter is read-only');
assert.equal($('defaults').disabled, true, 'later: 全部採用預設 disabled too');
// resume on open: after a reload (a project switch here) the kept edit is asked about again before the
// chapter is shown; the chapter was reopened meanwhile, so mine writes it
Object.assign(row(), { state: 'reopened', version: row().version + 1 });
p1.conflictChoice = 'mine';
await switchTo('p-1');
state.chosen = ['07505'];
await stepHandlers[3](); await tick();
assert.deepEqual(p1.dialogs.at(-1), { code: 'VERSION_CONFLICT', record_id: 'specbook-chapter/07505', resumed: true });
assert.deepEqual(row().body.decisions[1].choice, { text: '6' });
assert.equal(textInput().value, '6', 'resume mine: my kept text is shown');
assert.equal(textInput().disabled, false, 'resume mine: editable again');
await stepHandlers[3](); await tick();
assert.equal(p1.dialogs.length, 3, 'a later render of an opened chapter asks nothing');

// item 1: project switch clears the chapter cache; out-of-order completion keeps the newest project
await fakes['p-2'].records.create('specbook-project', { key: 'main', body: { item_codes: ['0750510004'], extra_chapters: [], chapters: ['07505'] } });
delay['p-1'] = 60; // p-1's load finishes after p-2's
active = 'p-1'; projectListener({ project_handle: 'p-1', project_key: 'k-p-1' });
await tick();
active = 'p-2'; projectListener({ project_handle: 'p-2', project_key: 'k-p-2' });
await sleep(120);
assert.equal(state.project.project_handle, 'p-2'); assert.equal(state.store !== null, true);
await stepHandlers[3](); await tick();
assert.equal($('progress').textContent, '已填 0/6', 'p-2 shows its own (empty) chapter, not p-1 cache');
delay['p-1'] = 0;

// item 6: partial publish (project record fails) leaves the page editable; retry publishes the rest
const realPublish = fakes['p-2'].records.publish;
fakes['p-2'].records.publish = async (c, id, o) => { if (c === 'specbook-project') throw new Error('timeout'); return realPublish(c, id, o); };
text1.value = '1'; // make sure the chapter record exists in p-2
const t = inputs().find((n) => n.attrs.id === 'text-07505-1'); t.value = '3'; t.fire('change'); await tick();
$('publish').fire('click'); await tick(); await tick();
assert.equal(fakes['p-2'].rows.get('specbook-chapter/07505').state, 'published');
assert.equal(state.readOnly, false, 'project not published -> still editable');
assert.equal($('notice').textContent, '操作失敗：連線逾時，請再試一次', 'item 10 mapping via guard');
fakes['p-2'].records.publish = realPublish;
$('publish').fire('click'); await tick(); await tick();
assert.equal(fakes['p-2'].rows.get('specbook-project/main').state, 'published');
assert.equal(state.readOnly, true, 'retry skipped the published chapter and published the project');
assert.equal($('notice').textContent, '', 'item2: notice cleared after a successful publish');
// item 1: step-2's checkboxes/save buttons were rendered while p-2 was still editable (during the
// switchTo above) and are never re-rendered by publish (only step 4 is) — they must still end up
// disabled, proving the fix does not depend on the user happening to revisit step 2.
assert.ok(boxes().length > 0, 'sanity: step-2 checkboxes exist from the earlier render');
assert.ok(boxes().every((n) => n.disabled), 'item1: step-2 checkboxes disabled after publish, without a re-render');
assert.equal($('save-chapters').disabled, true, 'item1: bottom save button disabled after publish');
assert.equal($('save-chapters-top').disabled, true, 'item1: top save button disabled after publish');
$('reopen').fire('click'); await tick(); await tick();
assert.equal(state.readOnly, false);
assert.equal(fakes['p-2'].rows.get('specbook-chapter/07505').state, 'reopened');
assert.equal($('notice').textContent, '', 'item2: notice cleared after a successful reopen');
assert.ok(boxes().every((n) => !n.disabled), 'item1: step-2 checkboxes re-enabled after reopen, without a re-render');
assert.equal($('save-chapters').disabled, false, 'item1: bottom save button re-enabled after reopen');

// item 10
assert.equal(errorText(new Error('PUBLISHED')), '已定稿，請先解除定稿再修改');
assert.equal(errorText(new Error('Blocking lint issues remain; only a draft can be produced.')), '還有未完成的格子，只能下載草稿');
assert.equal(errorText(new Error('其他')), '其他');

// 只顯示未填 hides a filled block (p-2/07505 has slot 1 filled from item 6 above, 5 more unfilled)
await stepHandlers[3](); await tick();
const slotBlocks = () => [...$('slots').walk()].filter((n) => n.attrs.class === 'sb-slot');
assert.equal(slotBlocks().length, 6, '只顯示未填 off: all 6 slot blocks shown');
$('hide-filled').checked = true;
$('hide-filled').fire('change'); await tick(); await tick();
assert.equal(slotBlocks().length, 5, '只顯示未填 on: the filled block is hidden');
$('hide-filled').checked = false;
$('hide-filled').fire('change'); await tick(); await tick();

// 下一章 opens the next chapter in state.chosen order, and nav buttons disable at the ends
state.chosen = ['07505', '01330'];
await stepHandlers[3](); await tick();
assert.equal($('chapter-pick').value, '07505');
assert.equal($('prev-chapter-bottom').disabled, true, 'disabled at the start');
assert.equal($('next-chapter-bottom').disabled, false);
$('next-chapter-bottom').fire('click'); await tick(); await tick();
assert.equal($('chapter-pick').value, '01330', '下一章 opens the next chosen chapter');
assert.equal($('prev-chapter-bottom').disabled, false);
assert.equal($('next-chapter-bottom').disabled, true, 'disabled at the end');

// item 4/5: suggested chapters sorted+counted with a title tooltip, threshold button, and 全選/全不選
// for 可收錄的章 (a 4th fake chapter is added in-memory to the loaded pack so 3 selected chapters can
// reference the same suggested one; no fixture file is touched).
state.pack.chapters['09999'] = { name: '測試假章', related: [], mentions: [], paragraphs: [], slots: {}, version_note: null, unmaintained: false };
for (const code of ['07505', '01330', '01450']) state.pack.chapters[code].related.push('09999');
state.itemCodes = ['0750510004', '0133010001', '0145010001'];
state.extraChapters = [];
state.chosen = [];
app.renderStep2();
const labelFor = (code) => [...$('chapter-groups').walk()].find((n) => n.tagName === 'label' && n.children.some((c) => typeof c !== 'string' && c.value === code));
const suggestedLabel = labelFor('09999');
const suggestedCheckbox = () => boxes().find((n) => n.value === '09999');
const foundInputs = () => boxes().filter((n) => ['07505', '01330', '01450'].includes(n.value));
assert.ok(foundInputs().every((n) => n.checked), 'baseline: 可收錄的章 default-checked');
assert.equal(suggestedCheckbox().checked, false, 'baseline: 建議章節 default-unchecked');
assert.match(suggestedLabel.textContent, /（3 章引用）/, 'item4: suggested chapter shows a reference count, not the full code list');
assert.equal(suggestedLabel.attrs.title, '01330、01450、07505', 'item4: full referencing chapter list kept in the title attribute');
const thresholdButton = () => [...$('chapter-groups').walk()].find((n) => n.tagName === 'button' && n.textContent === '勾選被 3 章以上引用的建議章');
thresholdButton().fire('click');
assert.equal(suggestedCheckbox().checked, true, 'item4: threshold button checks a suggested chapter referenced by >=3 selected chapters');
const selectAllButton = () => [...$('chapter-groups').walk()].find((n) => n.tagName === 'button' && n.textContent === '全選');
const selectNoneButton = () => [...$('chapter-groups').walk()].find((n) => n.tagName === 'button' && n.textContent === '全不選');
selectNoneButton().fire('click');
assert.ok(foundInputs().every((n) => !n.checked), 'item5: 全不選 unchecks every 可收錄的章 checkbox');
assert.equal(suggestedCheckbox().checked, true, 'item5: 全不選 does not touch a suggested chapter checkbox');
suggestedCheckbox().checked = false;
selectAllButton().fire('click');
assert.ok(foundInputs().every((n) => n.checked), 'item5: 全選 checks every 可收錄的章 checkbox');
assert.equal(suggestedCheckbox().checked, false, 'item5: 全選 does not touch a suggested chapter checkbox');
state.chosen = ['07505']; state.itemCodes = ['0750510004']; state.extraChapters = [];

// 需人工指定: each unmatched code gets related / special / exclude in step 2; the choices are saved in
// the project record, block the formal document while unresolved and shape the DOCX.
Object.assign(state.pack.chapters, manualPack.chapters);
Object.assign(state.pack.code_index, manualPack.code_index);
const p2 = fakes['p-2'];
const projectRow = () => p2.rows.get('specbook-project/main');
const manualNode = (code) => [...$('chapter-groups').walk()].find((n) => n.attrs['data-manual'] === code);
const radioOf = (code, value) => [...manualNode(code).walk()].find((n) => n.attrs.type === 'radio' && n.value === value);
const selectOf = (code) => [...manualNode(code).walk()].find((n) => n.tagName === 'select');
const areaOf = (code) => [...manualNode(code).walk()].find((n) => n.tagName === 'textarea');
// Like a browser radio group: checking one unchecks the others of that code.
const pick = (code, value) => {
  for (const v of ['related', 'special', 'exclude']) radioOf(code, v).checked = v === value;
  radioOf(code, value).fire('change');
};
state.itemCodes = ['0750510004', '0154000001', '0156000001', '0249500001', '0550000001', '1010300001'];
state.extraChapters = []; state.chosen = ['07505'];
app.renderStep2();
const manualHeading = [...$('chapter-groups').walk()].find((n) => n.tagName === 'h3' && n.textContent.startsWith('需人工指定'));
assert.equal(manualHeading.textContent, '需人工指定（5）');
assert.equal(radioOf('01540', 'related').disabled, true, 'no same-prefix chapter: 套用相近章 disabled');
assert.match(manualNode('01540').textContent, /沒有前 4 碼相同的章/);
assert.deepEqual(selectOf('01560').children.map((o) => o.value), ['', '01564'], 'same-prefix chapters offered, nothing auto-picked');
assert.equal(radioOf('01560', 'related').checked, false);
assert.match(manualNode('10103').textContent, /10103 （編碼表無此碼）/);
selectOf('01560').value = '01564'; selectOf('01560').fire('change');
assert.equal(radioOf('01560', 'related').checked, true, 'picking a chapter selects 套用相近章');
const areaBox = (code) => [...manualNode(code).walk()].find((n) => n.children.includes(areaOf(code)));
assert.equal(areaBox('02495').hidden, true, 'text box hidden until 撰寫特訂條款 is chosen');
pick('02495', 'special');
assert.equal(areaBox('02495').hidden, false);
areaOf('02495').value = '一、監測頻率每週一次。\n二、異常時通知監造。';
pick('05500', 'exclude');
pick('10103', 'special'); areaOf('10103').value = '依契約辦理。';
boxes().find((n) => n.value === '07505').checked = false; // keep the check below free of 07505's unfilled slots
$('save-chapters').fire('click'); await tick(); await tick();
assert.deepEqual(projectRow().body.manual, {
  '01560': { choice: 'related', chapter: '01564' },
  '02495': { choice: 'special', text: '一、監測頻率每週一次。\n二、異常時通知監造。' },
  '05500': { choice: 'exclude' },
  '10103': { choice: 'special', text: '依契約辦理。' },
}, '01540 has no choice and is not saved');
assert.deepEqual(projectRow().body.chapters, ['01564'], 'the related chapter joins the chapter list');
assert.deepEqual(state.chosen, ['01564']);
// step 4: 01540 is still unresolved -> blocking, only a draft
await stepHandlers[4](); await tick();
const lintRow = (code) => [...$('lint').walk()].find((n) => n.tagName === 'tr' && n.children[0].textContent.startsWith(code));
assert.equal(lintRow('01540').children[0].textContent, '01540 施工輔助設施');
assert.equal(lintRow('01540').children[1].textContent, '需人工指定');
assert.equal($('download-final').disabled, true, 'unresolved code blocks the formal document');
assert.equal($('publish').disabled, true, 'unresolved code blocks publishing');
$('download-draft').fire('click'); await tick();
assert.match(downloads.at(-1), /-草稿\.docx$/);
assert.deepEqual(docxData.toc.map((t) => t.title), ['第01564章 施工圍籬 V7.0', '第02495章 監測儀器', '第10103章 （編碼表無此碼）']);
assert.deepEqual(docxData.chapters[1].paragraphs, [{ line: '一、監測頻率每週一次。' }, { line: '二、異常時通知監造。' }]);
assert.equal(JSON.stringify(docxData).includes('05500') || JSON.stringify(docxData).includes('金屬製品'), false, 'excluded code is nowhere');
// 前往 on an unresolved code goes back to step 2, where the saved choices are shown again
[...lintRow('01540').walk()].find((n) => n.tagName === 'button').fire('click'); await tick();
assert.equal($('step-2').hidden, false);
assert.equal(selectOf('01560').value, '01564'); assert.equal(radioOf('01560', 'related').checked, true);
assert.equal(areaOf('02495').value, '一、監測頻率每週一次。\n二、異常時通知監造。'); assert.equal(areaBox('02495').hidden, false);
assert.equal(radioOf('05500', 'exclude').checked, true);
// conflict: someone else changed the choices meanwhile; theirs shows their choices
Object.assign(projectRow(), { body: { ...projectRow().body, manual: { ...projectRow().body.manual, '05500': { choice: 'special', text: '他人寫的條款' } } }, version: projectRow().version + 1 });
p2.conflictChoice = 'theirs';
pick('01540', 'exclude');
$('save-chapters').fire('click'); await tick(); await tick();
assert.equal(p2.dialogs.at(-1).code, 'VERSION_CONFLICT');
assert.equal(radioOf('05500', 'special').checked, true, 'theirs: the other writer\'s choice is shown');
assert.equal(areaOf('05500').value, '他人寫的條款');
assert.equal(radioOf('01540', 'exclude').checked, false, 'theirs: my unsaved choice is dropped');
// resolve the rest; reload (project switch) restores every choice from the record
pick('01540', 'exclude'); pick('05500', 'exclude');
$('save-chapters').fire('click'); await tick(); await tick();
assert.deepEqual(projectRow().body.manual['01540'], { choice: 'exclude' });
await switchTo('p-2');
assert.equal(radioOf('01540', 'exclude').checked, true, 'reload: choice restored');
assert.equal(areaOf('10103').value, '依契約辦理。', 'reload: special text restored');
await stepHandlers[4](); await tick();
assert.equal(lintRow('01540'), undefined);
assert.equal($('download-final').disabled, false, 'all codes resolved: the formal document is allowed');
$('download-final').fire('click'); await tick();
assert.equal(docxData.draftLabel, '');
assert.deepEqual(docxData.toc.map((t) => t.title), ['第01564章 施工圍籬 V7.0', '第02495章 監測儀器', '第10103章 （編碼表無此碼）']);
assert.equal(await device.draft.load('manual-k-p-2'), null, 'every save above settled, so no draft is left');

// 需人工指定 draft (Studio data.md §2.4(b)): typing is kept in studio.draft on a 400 ms debounce, per project.
const stepRadio = (n) => [...$('steps').walk()].find((i) => i.attrs.name === 'step' && i.value === String(n));
const gotoStep = async (n) => { stepRadio(n).fire('change'); await tick(); await tick(); };
const restoredNote = () => [...$('chapter-groups').walk()].find((n) => n.textContent === '已還原上次未儲存的內容');
const type = (code, text) => { areaOf(code).value = text; areaOf(code).fire('input'); };
// typing, then switching step and back, restores the text with a note
await gotoStep(2);
assert.equal(restoredNote().hidden, true, 'no draft: no note');
type('02495', '草稿一');
await sleep(450);
await gotoStep(3);
await gotoStep(2);
assert.equal(areaOf('02495').value, '草稿一', 'switching step and back keeps the typed text');
assert.equal(restoredNote().hidden, false, 'restored: the note is shown');
assert.equal(areaBox('02495').hidden, false);
assert.equal(projectRow().body.manual['02495'].text, '一、監測頻率每週一次。\n二、異常時通知監造。', 'the draft is not a save');
// a project switch shows only that project's own draft, and a pending draft is saved under the project it was typed in
Object.assign(fakes['p-1'].rows.get('specbook-project/main').body, { item_codes: state.itemCodes, chapters: ['01564'] });
type('02495', '草稿二'); // switched away before the debounce fires
await switchTo('p-1');
assert.equal(areaOf('02495').value, '', 'p-2 draft is not shown in p-1');
assert.equal(restoredNote().hidden, true);
await sleep(450);
assert.equal(await device.draft.load('manual-k-p-1'), null, 'nothing written under p-1');
assert.equal((await device.draft.load('manual-k-p-2')).manual['02495'].text, '草稿二', 'the pending draft went to p-2');
pick('02495', 'special'); type('02495', 'p-1 的條款'); await sleep(450);
await switchTo('p-2');
assert.equal(areaOf('02495').value, '草稿二', 'p-2 gets its own draft back, not p-1\'s');
// a successful 確定章節 saves the restored text and clears the draft
$('save-chapters').fire('click'); await tick(); await tick();
assert.equal(projectRow().body.manual['02495'].text, '草稿二');
assert.equal(await device.draft.load('manual-k-p-2'), null, 'saved: the draft is cleared');
assert.equal((await device.draft.load('manual-k-p-1')).manual['02495'].text, 'p-1 的條款', 'p-1 draft untouched');
// someone else saves while a draft sits: the restored draft meets the conflict dialog, never a silent overwrite
await gotoStep(2);
type('02495', '草稿三'); await sleep(450);
Object.assign(projectRow(), { body: { ...projectRow().body, manual: { ...projectRow().body.manual, '02495': { choice: 'special', text: '他人新版' } } }, version: projectRow().version + 1 });
await switchTo('p-2'); // reload: the newer record is read, then the older draft is restored over it
assert.equal(areaOf('02495').value, '草稿三');
const dialogsBefore = p2.dialogs.length;
p2.conflictChoice = 'theirs';
$('save-chapters').fire('click'); await tick(); await tick();
assert.equal(p2.dialogs.length, dialogsBefore + 1); assert.equal(p2.dialogs.at(-1).code, 'VERSION_CONFLICT');
assert.equal(projectRow().body.manual['02495'].text, '他人新版', 'theirs: the other save stays');
assert.equal(areaOf('02495').value, '他人新版', 'theirs: the stored text is shown');
assert.equal(await device.draft.load('manual-k-p-2'), null, 'the user\'s conflict choice clears the draft');
// typing while 確定章節 is being saved: that draft starts from the saved version, so restoring it asks nothing
await gotoStep(2);
$('save-chapters').fire('click'); // the save is now in flight
type('02495', '存檔中打的字');
await tick(); await tick(); await sleep(450);
assert.equal((await device.draft.load('manual-k-p-2')).base_version, projectRow().version, 'the draft carries the version the save returned');
await gotoStep(2);
assert.equal(areaOf('02495').value, '存檔中打的字');
const dialogsBeforeOwn = p2.dialogs.length;
$('save-chapters').fire('click'); await tick(); await tick();
assert.equal(p2.dialogs.length, dialogsBeforeOwn, 'no conflict with my own save');
assert.equal(projectRow().body.manual['02495'].text, '存檔中打的字');
assert.equal(await device.draft.load('manual-k-p-2'), null);
state.chosen = ['07505']; state.itemCodes = ['0750510004']; state.extraChapters = [];

// item 2: a stale error notice is cleared by a project switch
notice('測試用錯誤，應該在切換案場後消失');
assert.notEqual($('notice').textContent, '', 'sanity: notice set before the switch');

// No project: the callout shows and the step nav + all four step sections are hidden
await switchTo(null);
assert.equal($('notice').textContent, '', 'item2: notice cleared by a project switch');
assert.equal($('no-project').hidden, false, 'callout shown with no project');
assert.equal($('steps').hidden, true, 'step nav hidden with no project');
for (let n = 1; n <= 4; n += 1) assert.equal($(`step-${n}`).hidden, true, `step-${n} hidden with no project`);

console.log('UI CHECK OK');
