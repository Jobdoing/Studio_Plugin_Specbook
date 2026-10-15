import { NO_CODE_NAME, relatedChapters, selectChapters } from './engine/index.js';
import { extractItemCodes } from './lib/codes.js';
import { createStore } from './lib/store.js';

const $ = (id) => document.getElementById(id);
const REASONS = { no_spec: '規範與編碼表都沒有此章', code_table_only: '只有編碼表，工程會沒有訂規範本文', deleted: '工程會已刪除此章' };
const STEPS = ['帶入', '章節', '填寫', '檢查'];

export const state = {
  pack: null, project: null, store: null, me: null,
  itemCodes: [], extraChapters: [], selection: null, chosen: [],
  projectRecord: null, step: 1, readOnly: false,
};

// The engine's blocking-lint error is matched by its message text (engine/src/docx-model.js); if that
// text changes, the English message is shown as is.
const ERRORS = {
  PUBLISHED: '已定稿，請先解除定稿再修改',
  VERSION_CONFLICT: '資料已被他人更新，請重新載入',
  KEY_CONFLICT: '這筆資料已經存在，請重新整理頁面',
  timeout: '連線逾時，請再試一次',
  DISK_LOW: '伺服器空間不足，請聯絡管理員',
  UNAUTHENTICATED: '登入已過期，請重新整理頁面並重新登入；已填的內容都已存在伺服器，不會遺失',
  FORBIDDEN: '沒有權限執行這個操作，請聯絡管理員',
  READ_ONLY_ACCESS: '你在這個案場是唯讀身分，不能修改；請聯絡案場管理者',
  STUDIO_NO_PROJECT_ACCESS: '你沒有這個案場的使用權限，請聯絡管理員',
  'Blocking lint issues remain; only a draft can be produced.': '還有未完成的格子，只能下載草稿',
};
export const errorText = (error) => ERRORS[error.message] ?? error.message;

export function notice(message) {
  $('notice').textContent = message ?? '';
  $('notice').hidden = !message;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'on') for (const [event, fn] of Object.entries(value)) node.addEventListener(event, fn);
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}
export { el };

export function showStep(step) {
  state.step = step;
  for (let n = 1; n <= 4; n += 1) $(`step-${n}`).hidden = n !== step;
  const nav = $('steps');
  nav.replaceChildren(...STEPS.map((label, index) => {
    const input = el('input', { type: 'radio', name: 'step', value: String(index + 1) });
    input.checked = index + 1 === step;
    input.disabled = index + 1 > 1 && !state.chosen.length;
    // A user-initiated step switch clears any stale notice from an earlier, unrelated action (item 2);
    // renders triggered by app logic itself (e.g. onProject) set their own notice afterward if needed.
    input.addEventListener('change', () => { notice(null); stepHandlers[index + 1](); });
    return el('label', {}, input, `${index + 1}. ${label}`);
  }));
}
export const stepHandlers = { 1: () => showStep(1), 2: () => renderStep2() };

// Elements whose disabled state must track state.readOnly even when they were rendered earlier and are
// not re-rendered by the action that changed readOnly (item 1: publish/reopen only re-render step 4).
let stepTwoInputs = [];
let manualRows = []; // step 2 "需人工指定" rows: {code, radios, select, area, areaBox}, read by saveChapters
let restoredNote = null; // step 2's "restored from draft" note, shown by restoreDraft
export function applyReadOnly() {
  const ro = state.readOnly;
  $('xlsx').disabled = ro || !state.project;
  for (const input of stepTwoInputs) input.disabled = ro;
  for (const button of document.querySelectorAll('#chapter-groups button[data-bulk]')) button.disabled = ro;
  for (const id of ['save-chapters', 'save-chapters-top']) $(id).disabled = ro || !state.store;
}

async function loadPack() {
  const response = await fetch('./data/specbook-pack.json');
  state.pack = await response.json();
  const count = Object.keys(state.pack.chapters).length;
  $('pack-meta').textContent = `工程會綱要規範 ${count} 章 · 資料版本 ${state.pack.pack_version}`;
}

async function onProject(project) {
  flushDraft(); // a pending draft is saved under the project it was typed in
  notice(null); // item 2: a stale notice from the previous project must not leak into the new one
  $('xlsx-status').textContent = ''; // item 6: an imported-file name from the previous project must not leak into the new one
  stepHandlers.reset?.();
  state.project = project;
  state.store = project ? createStore(studio, project.project_handle) : null;
  $('no-project').hidden = Boolean(project);
  $('project-name').textContent = project ? `案場：${project.name}` : '';
  $('steps').hidden = !project;
  if (!project) {
    applyReadOnly();
    for (let n = 1; n <= 4; n += 1) $(`step-${n}`).hidden = true;
    return;
  }
  const projectRecord = await state.store.openProject();
  if (state.project !== project) return; // a newer project switch finished first
  showProject(projectRecord);
}

// Takes the project record as stored (after a load, or the version the conflict dialog kept).
function showProject(projectRecord) {
  state.projectRecord = projectRecord;
  const body = state.projectRecord?.body;
  const inPack = (code) => Boolean(state.pack.chapters[code]);
  state.itemCodes = body?.item_codes ?? [];
  state.extraChapters = (body?.extra_chapters ?? []).filter(inPack);
  state.chosen = (body?.chapters ?? []).filter(inPack);
  const dropped = [...new Set([...(body?.chapters ?? []), ...(body?.extra_chapters ?? [])])].filter((code) => !inPack(code));
  if (dropped.length) notice(`新版規範資料已沒有以下章節，已從清單移除：${dropped.join('、')}`);
  state.readOnly = state.projectRecord?.state === 'published';
  applyReadOnly();
  if (state.chosen.length) renderStep2(); else showStep(1);
}

async function onFile(event) {
  const file = event.target.files[0];
  if (!file || !state.store) return;
  try {
    const { sheets } = await studio.xlsx.read(file);
    const { codes, warnings, error } = extractItemCodes(sheets);
    $('import-warnings').replaceChildren(...warnings.map((w) => el('li', {}, w)));
    if (error) return notice(error);
    notice(null);
    state.itemCodes = codes;
    $('xlsx-status').textContent = `已匯入：${file.name}`;
    renderStep2();
  } catch (error) {
    notice(`讀取失敗：${errorText(error)}`);
  } finally {
    event.target.value = '';
  }
}

function onSearch() {
  const q = $('search').value.trim();
  const box = $('search-results');
  if (!q) return box.replaceChildren();
  const hits = Object.entries(state.pack.chapters)
    .filter(([code, chapter]) => code.startsWith(q) || chapter.name.includes(q))
    .slice(0, 20);
  box.replaceChildren(...hits.map(([code, chapter]) => el('div', { class: 'kit-list-item sb-row' },
    el('span', {}, `${code} ${chapter.name}`),
    el('button', { class: 'kit-button kit-button--link', type: 'button', disabled: state.readOnly ? '' : null, on: { click: () => {
      if (!state.extraChapters.includes(code)) state.extraChapters.push(code);
      renderStep2();
    } } }, '加入'))));
}

function checkbox(code, label, checked, title) {
  const input = el('input', { type: 'checkbox', value: code, 'data-chapter': code });
  input.checked = checked;
  input.disabled = state.readOnly;
  stepTwoInputs.push(input);
  const node = el('label', { class: 'sb-check', title }, input, label);
  node.input = input;
  return node;
}

// Partial-draft variant of Studio data.md §2.4(b), accepted by the platform 2026-10-02: restored into the form, never
// auto-submitted on open; cleared only after the save settles; key stays project-scoped (manual-<project_key>).
// In-progress 需人工指定 choices go to studio.draft on a 400 ms debounce, keyed per project (Studio data.md
// §2.4(b)); step 2 restores them and 確定章節 clears them once the save is settled. The draft carries
// base_version, the project record version these edits started from: a draft restored over a newer record
// is saved against that older version, so it meets the host's conflict dialog instead of silently
// overwriting someone else's save. Key and value are taken at input time, so a pending save from one
// project can never be written under another project's key.
// NOTE(ceiling): what is typed in the last ~400 ms before a hard tab close is still lost (the same ceiling
// as any debounced autosave; no pagehide write, by design). The chapter checkboxes are not in the draft.
const draftKey = () => `manual-${state.project.project_key}`;
let draftBase; // version of the project record the current step-2 edits started from
let draftTimer = null;
let pendingDraft = null; // {key, value} waiting for the debounce

function scheduleDraft() {
  pendingDraft = { key: draftKey(), value: { manual: manualChoices(), base_version: draftBase } };
  clearTimeout(draftTimer);
  draftTimer = setTimeout(flushDraft, 400);
}

function flushDraft() {
  clearTimeout(draftTimer);
  if (!pendingDraft) return;
  const { key, value } = pendingDraft;
  pendingDraft = null;
  studio.draft.save(key, value).catch((error) => notice(`暫存失敗：${errorText(error)}`));
}

async function restoreDraft() {
  const rows = manualRows;
  if (!rows.length || state.readOnly) return;
  const draft = await studio.draft.load(draftKey());
  if (!draft || rows !== manualRows) return; // nothing saved, or step 2 was rendered again meanwhile
  for (const row of rows) if (draft.manual[row.code]) setChoice(row, draft.manual[row.code]);
  draftBase = draft.base_version;
  restoredNote.hidden = false;
}

function setChoice({ radios, select, area, areaBox }, saved) {
  for (const [value, input] of Object.entries(radios)) input.checked = saved?.choice === value;
  select.value = saved?.choice === 'related' ? saved.chapter ?? '' : '';
  area.value = saved?.text ?? '';
  areaBox.hidden = !radios.special.checked;
}

// One unmatched chapter code with its three choices; the saved entry (project body.manual) is shown back.
function manualRow(u, saved) {
  const name = state.pack.code_index[u.code] ?? NO_CODE_NAME;
  const related = relatedChapters(state.pack, u.code);
  const radio = (value) => {
    const input = el('input', { type: 'radio', name: `manual-${u.code}`, value });
    if (value !== 'related' || related.length) stepTwoInputs.push(input); else input.disabled = true;
    return input;
  };
  const radios = { related: radio('related'), special: radio('special'), exclude: radio('exclude') };
  const select = el('select', { 'aria-label': `${u.code} 相近章` }, el('option', { value: '' }, '請選擇章節'),
    ...related.map((code) => el('option', { value: code }, `${code} ${state.pack.chapters[code].name}`)));
  const area = el('textarea', { 'aria-label': `${u.code} 特訂條款內容` });
  const areaBox = el('div', { class: 'sb-group' }, area, el('p', { class: 'sb-meta' }, '按「確定章節」才會儲存。'));
  const row = { code: u.code, radios, select, area, areaBox };
  setChoice(row, saved);
  for (const input of Object.values(radios)) input.addEventListener('change', () => { areaBox.hidden = !radios.special.checked; scheduleDraft(); });
  select.addEventListener('change', () => { if (select.value) radios.related.checked = true; areaBox.hidden = !radios.special.checked; scheduleDraft(); });
  area.addEventListener('input', scheduleDraft);
  if (related.length) stepTwoInputs.push(select);
  else select.disabled = true;
  stepTwoInputs.push(area);
  const node = el('div', { class: 'sb-slot', 'data-manual': u.code },
    el('p', { class: 'sb-sentence' }, `${u.code} ${name}：${REASONS[u.reason]}，工項 ${u.items.join('、')}`),
    el('fieldset', { class: 'sb-options' }, el('legend', { class: 'kit-sr-only' }, `${u.code} 處理方式`),
      el('div', { class: 'sb-row' }, el('label', {}, radios.related, '套用相近章'), select,
        ...(related.length ? [] : [el('span', { class: 'sb-meta' }, '沒有前 4 碼相同的章')])),
      el('label', {}, radios.special, '撰寫特訂條款'),
      areaBox,
      el('label', {}, radios.exclude, '不納入')));
  row.node = node;
  return row;
}

// The saved form of each row's choice; rows without a choice are left out (still unresolved).
function manualChoices() {
  const manual = {};
  for (const { code, radios, select, area } of manualRows) {
    if (radios.related.checked) manual[code] = { choice: 'related', chapter: select.value };
    else if (radios.special.checked) manual[code] = { choice: 'special', text: area.value };
    else if (radios.exclude.checked) manual[code] = { choice: 'exclude' };
  }
  return manual;
}

export function renderStep2() {
  state.selection = selectChapters(state.itemCodes, state.pack);
  const chosen = new Set(state.chosen.length ? state.chosen : state.selection.chapters.map((c) => c.code));
  const savedExtras = state.projectRecord?.body?.extra_chapters ?? [];
  const addedNow = (code) => state.extraChapters.includes(code) && !savedExtras.includes(code); // added via search, not saved yet
  const name = (code) => `${code} ${state.pack.chapters[code].name}`;
  const groups = [];
  stepTwoInputs = [];
  const found = [...state.selection.chapters.map((c) => c.code), ...state.extraChapters.filter((code) => !state.selection.chapters.some((c) => c.code === code))];
  const foundLabels = found.map((code) => checkbox(code, name(code), chosen.has(code) || addedNow(code)));
  groups.push(
    el('div', { class: 'sb-row' },
      el('h3', {}, `可收錄的章（${found.length}）`),
      el('button', { class: 'kit-button kit-button--link', type: 'button', 'data-bulk': '', on: { click: () => { for (const l of foundLabels) l.input.checked = true; } } }, '全選'),
      el('button', { class: 'kit-button kit-button--link', type: 'button', 'data-bulk': '', on: { click: () => { for (const l of foundLabels) l.input.checked = false; } } }, '全不選'),
    ),
    ...foundLabels,
  );
  // Sort suggested chapters by how many selected chapters reference them (descending, then code) —
  // the full referencing-code list moves into the checkbox label's title tooltip (item 4).
  const suggested = state.selection.suggested
    .filter((s) => !found.includes(s.code))
    .sort((a, b) => b.referencedBy.length - a.referencedBy.length || a.code.localeCompare(b.code));
  if (suggested.length) {
    const suggestedLabels = suggested.map((s) => checkbox(s.code, `${name(s.code)}（${s.referencedBy.length} 章引用）`, chosen.has(s.code), s.referencedBy.join('、')));
    groups.push(
      el('div', { class: 'sb-row' },
        el('h3', {}, '建議一起收錄（被上列章節列為相關章節）'),
        el('button', { class: 'kit-button kit-button--link', type: 'button', 'data-bulk': '', on: { click: () => {
          for (const [index, s] of suggested.entries()) if (s.referencedBy.length >= 3) suggestedLabels[index].input.checked = true;
        } } }, '勾選被 3 章以上引用的建議章'),
      ),
      ...suggestedLabels,
    );
  }
  manualRows = state.selection.unmatched.map((u) => manualRow(u, state.projectRecord?.body?.manual?.[u.code]));
  draftBase = state.projectRecord?.version;
  restoredNote = el('p', { class: 'sb-meta', role: 'status' }, '已還原上次未儲存的內容');
  restoredNote.hidden = true;
  if (manualRows.length) {
    groups.push(el('h3', {}, `需人工指定（${manualRows.length}）`),
      el('p', { class: 'sb-meta' }, '以下工項碼沒有對應的規範章，請逐一選擇；未選完仍可下載草稿，但不能下載正式版。'),
      restoredNote,
      ...manualRows.map((row) => row.node));
  }
  if (state.selection.temporary.length) groups.push(el('h3', {}, 'Z 開頭暫用碼（沒有對應章節）'), el('p', { class: 'sb-meta' }, state.selection.temporary.join('、')));
  if (state.selection.unrecognized.length) groups.push(el('h3', {}, '無法辨識的編碼'), el('p', { class: 'sb-meta' }, state.selection.unrecognized.join('、')));
  $('chapter-groups').replaceChildren(...groups);
  applyReadOnly();
  showStep(2);
  restoreDraft().catch((error) => notice(`還原暫存失敗：${errorText(error)}`));
}

async function saveChapters() {
  const manual = manualChoices();
  const picked = Object.values(manual).filter((m) => m.choice === 'related' && m.chapter).map((m) => m.chapter);
  const checked = [...document.querySelectorAll('#chapter-groups input[data-chapter]:checked')].map((i) => i.value);
  const codes = [...new Set([...checked, ...picked])].sort();
  if (!codes.length) return notice('請至少勾選一章。');
  const body = { item_codes: state.itemCodes, extra_chapters: state.extraChapters, chapters: codes, manual, pack_version: state.pack.pack_version };
  const project = state.project;
  const key = draftKey();
  flushDraft(); // if the save throws, the draft still holds the latest edits
  // The edits started from draftBase: an older version than the loaded record meets the conflict dialog;
  // no version at all (the record did not exist then) takes the create path and meets KEY_CONFLICT.
  const known = draftBase === state.projectRecord?.version ? state.projectRecord
    : draftBase === undefined ? null : { ...state.projectRecord, version: draftBase };
  const result = await state.store.saveProject(body, known);
  // Saved, or settled in the host's conflict dialog ('later' keeps its own copy of the body): the draft is done.
  await studio.draft.clear(key);
  if (state.project !== project) return; // the project was switched while saving
  if (!result.ok) {
    // The host's conflict dialog already told the user what happened. 'theirs': show the stored list;
    // 'later' (published): read-only, and the saved edit is asked about again the next time this project is opened.
    notice(null);
    if (result.choice === 'theirs') showProject(result.record);
    else { state.readOnly = true; applyReadOnly(); }
    return;
  }
  state.projectRecord = result.record;
  draftBase = result.record.version;
  if (pendingDraft) pendingDraft.value.base_version = draftBase; // typed during the save: it now starts from this version
  state.chosen = codes;
  notice(null);
  studio.notify('章節已儲存');
  stepHandlers[3]?.();
}

const ready = (async () => {
  await loadPack();
  state.me = await studio.me();
  $('xlsx').addEventListener('change', onFile);
  $('search').addEventListener('input', onSearch);
  const onSaveChapters = () => saveChapters().catch((error) => notice(`儲存失敗：${errorText(error)}`));
  for (const id of ['save-chapters', 'save-chapters-top']) $(id).addEventListener('click', onSaveChapters);
})();
ready.catch((error) => notice(`初始化失敗：${errorText(error)}`));

// Registered synchronously so the host's initial push on load is not missed (SDK notes §1). A failed
// init is already shown above, so a project change then does nothing.
studio.onProjectChange((project) => {
  ready.then(() => onProject(project), () => {}).catch((error) => notice(`載入失敗：${errorText(error)}`));
});

import('./fill.js').catch((error) => notice(`載入填寫模組失敗：${errorText(error)}`));
