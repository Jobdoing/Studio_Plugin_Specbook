import { chapterDefaults, decisionState, hasBlocking, lint, NO_CODE_NAME, progress, resolveManual, selectChapters, slotText, toDocxModel } from './engine/index.js';
import { applyReadOnly, el, errorText, notice, showStep, state, stepHandlers } from './app.js';
import { toTemplateData } from './lib/docx-data.js';
import { CHAPTER, PROJECT } from './lib/store.js';

const $ = (id) => document.getElementById(id);
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const RULES = { unresolved: '尚未填寫', stale: '規範已改版，請重選', invalid_choice: '選項不適用，請重選', manual_unresolved: '需人工指定' };
// Radio labels per slot kind (§5.2); malformed has no radios (handled separately as a rewrite textarea).
const OPTION_LABELS = {
  optional: () => [['0', '保留此句'], ['omit', '刪除此句']],
  default_blank: (slot) => [['0', `採用預設「${slot.options[0]}」`]],
  choice: (slot) => slot.options.map((text, index) => [String(index), text]),
  choice_blank: (slot) => slot.options.map((text, index) => [String(index), text]),
};
const TEXT_LABELS = { blank: '填寫內容', default_blank: '或自行填寫', choice_blank: '或自行填寫' };
const PREV_IDS = ['prev-chapter-top', 'prev-chapter-bottom'];
const NEXT_IDS = ['next-chapter-top', 'next-chapter-bottom'];
const chapters = new Map(); // code -> {decisions, version, recordId, state}
const opened = new Set(); // chapters whose open sequence (resumeConflict) already ran for this project
const saving = new Map(); // code -> tail of that chapter's save chain (never rejects)
let current = null;
let hideFilled = false; // "只顯示未填" toggle

// Every path that can throw (PUBLISHED, DISK_LOW, network errors, etc.) must surface via notice()
// instead of becoming an unhandled rejection that silently drops the user's input.
const guard = (fn) => (...args) => fn(...args).catch((error) => notice(`操作失敗：${errorText(error)}`));

async function ensureChapter(code) {
  if (!chapters.has(code)) {
    const store = state.store;
    const record = (await store.loadChapter(code)) ?? { decisions: {}, version: undefined };
    if (state.store !== store) throw new Error('案場已切換，請重新操作');
    chapters.set(code, record);
  }
  return chapters.get(code);
}

// Waits for queued saves, then drops the cache so the next reads get the records as stored now.
async function dropCache() {
  await Promise.all(saving.values());
  chapters.clear();
}

const decision = (chapter, id, choice) => ({
  slot: Number(id), chapter_version: chapter.version, choice, at: new Date().toISOString(), by: state.me.displayName,
});

// Saves of one chapter run one after another, and each builds its decisions from the latest cached ones
// (next: decisions -> decisions), so a radio click right after a text-field blur keeps both choices.
// A refused save is settled by the host's conflict dialog inside store.saveChapter: 'mine' and 'theirs'
// leave the stored version in the cache; 'later' (only offered for a published chapter, as no lease is
// used) keeps my decisions on screen, read-only.
// NOTE(ceiling): text fields save on 'change' (blur/Enter); what is typed but not yet committed is lost on
// a hard tab close. Upgrade path: studio.draft.save on a 400 ms input debounce, restored and submitted at
// the end of openChapter (Studio data.md §2.4(b) step 5).
function save(code, next) {
  const store = state.store;
  const step = (saving.get(code) ?? Promise.resolve()).then(async () => {
    if (state.store !== store) return; // project switched while queued
    const record = await ensureChapter(code);
    if (record.state === 'published') return; // a queued save would only be refused again
    const decisions = next(record.decisions);
    const result = await store.saveChapter(code, decisions, record);
    if (state.store !== store) return;
    if (result.choice === 'later') chapters.set(code, { ...record, decisions, state: 'published' });
    else chapters.set(code, result.record ?? { decisions: {}, version: undefined });
    if (current === code) renderProgress(code);
  });
  saving.set(code, step.catch(() => {}));
  return step;
}

// Re-renders the whole chapter after a successful save so every block's sentence reflects the latest
// decisions (a slot's chosen text can appear in several blocks when its paragraph has more than one
// slot) and radios for a slot are unchecked once its text field is filled instead. Scroll position is
// restored (window is absent in the Node test harness, hence the guard).
async function reopenPreservingScroll(code) {
  const y = typeof window !== 'undefined' ? window.scrollY : 0;
  await openChapter(code);
  if (typeof window !== 'undefined') window.scrollTo(0, y);
}

async function saveAndRerender(code, next) {
  await save(code, next);
  if (current === code) await reopenPreservingScroll(code);
}

function renderProgress(code) {
  const { filled, total } = progress(state.pack, code, chapters.get(code).decisions);
  $('progress').textContent = `已填 ${filled}/${total}`;
  $('chapter-done').hidden = !(total > 0 && filled === total);
}

function renderChapterPick(selected) {
  const pick = $('chapter-pick');
  pick.replaceChildren(...state.chosen.map((code) => {
    const base = `${code} ${state.pack.chapters[code].name}`;
    const cached = chapters.get(code);
    const label = cached ? `${base}（${progress(state.pack, code, cached.decisions).filled}/${progress(state.pack, code, cached.decisions).total}）` : base;
    return el('option', { value: code }, label);
  }));
  pick.value = selected;
}

function neighborChapter(offset) {
  const index = state.chosen.indexOf(current);
  return index === -1 ? null : (state.chosen[index + offset] ?? null);
}

function updateChapterNav() {
  const prev = neighborChapter(-1);
  const next = neighborChapter(1);
  for (const id of PREV_IDS) $(id).disabled = !prev;
  for (const id of NEXT_IDS) $(id).disabled = !next;
}

function statusTag(status) {
  return el('span', { class: 'sb-meta' }, status === 'ok' ? '已填' : '未填');
}

// The text a slot currently contributes to its sentence (mirrors decisions.js's private slotText):
// the decided value when the decision is valid for this chapter version, otherwise the raw bracket text.
function decidedText(chapter, decisions, slotId) {
  const record = decisions[slotId];
  if (decisionState(chapter, slotId, record) !== 'ok') return chapter.slots[slotId].raw;
  return slotText(chapter.slots[slotId], record.choice);
}

function sentence(chapter, decisions, paragraph, slotId) {
  const p = el('p', { class: 'sb-sentence' }, paragraph.number ? `${paragraph.number}　` : '');
  for (const part of paragraph.text) {
    if (typeof part === 'string') p.append(part);
    else if (String(part.slot) === slotId) p.append(el('mark', {}, decidedText(chapter, decisions, String(part.slot))));
    else p.append(decidedText(chapter, decisions, String(part.slot)));
  }
  return p;
}

// A chapter can be published while the project record is not yet (publish goes chapter by chapter).
const locked = (code) => state.readOnly || chapters.get(code)?.state === 'published';

function controls(code, chapter, slotId, decisions) {
  const slot = chapter.slots[slotId];
  const record = decisions[slotId];
  const status = decisionState(chapter, slotId, record);
  const choose = guard((choice) => saveAndRerender(code, (decisions) => ({ ...decisions, [slotId]: decision(chapter, slotId, choice) })));
  const wrap = el('div', { class: 'sb-group' });
  if (status === 'stale' || status === 'invalid') wrap.append(el('p', { class: 'kit-field-error' }, status === 'stale' ? '規範已改版，請重選。' : '原本的選擇不適用，請重選。'));
  const picked = status === 'ok' ? record.choice : null;

  if (slot.kind === 'malformed') {
    const area = el('textarea', { 'aria-label': '改寫整段', disabled: locked(code) ? '' : null });
    area.value = picked?.rewrite ?? slot.raw;
    area.addEventListener('change', () => area.value.trim() && choose({ rewrite: area.value }));
    wrap.append(el('p', { class: 'sb-meta' }, '此段括號不成對，請直接改寫整段。'), area);
    return wrap;
  }
  const labels = OPTION_LABELS[slot.kind]?.(slot) ?? [];
  if (labels.length) {
    const group = el('fieldset', { class: 'sb-options' }, el('legend', { class: 'kit-sr-only' }, '選項'));
    for (const [value, text] of labels) {
      const input = el('input', { type: 'radio', name: `slot-${code}-${slotId}`, value, disabled: locked(code) ? '' : null });
      input.checked = picked ? (value === 'omit' ? picked.omit === true : picked.option === Number(value)) : false;
      input.addEventListener('change', () => choose(value === 'omit' ? { omit: true } : { option: Number(value) }));
      group.append(el('label', {}, input, text));
    }
    wrap.append(group);
  }
  const textLabel = TEXT_LABELS[slot.kind];
  if (textLabel) {
    const id = `text-${code}-${slotId}`;
    const input = el('input', { id, type: 'text', disabled: locked(code) ? '' : null });
    input.value = picked?.text ?? '';
    input.addEventListener('change', () => input.value.trim() && choose({ text: input.value.trim() }));
    wrap.append(el('div', { class: 'kit-field' }, el('label', { for: id }, textLabel), input));
  }
  return wrap;
}

// The first open of a chapter (per project) reads it fresh and runs the resume step; a saved conflict
// goes to the host dialog before the chapter is rendered, so nothing is editable while it is undecided.
async function openChapter(code) {
  current = code;
  if (!opened.has(code)) {
    const store = state.store;
    await saving.get(code);
    const record = await store.openChapter(code);
    if (state.store !== store) throw new Error('案場已切換，請重新操作');
    chapters.set(code, record ?? { decisions: {}, version: undefined });
    opened.add(code);
  }
  const record = await ensureChapter(code);
  const chapter = state.pack.chapters[code];
  renderChapterPick(code);
  const decisions = record.decisions;
  const slots = [];
  for (const paragraph of chapter.paragraphs) {
    for (const part of paragraph.text) {
      if (typeof part === 'string') continue;
      const slotId = String(part.slot);
      const status = decisionState(chapter, slotId, decisions[slotId]);
      const node = el('div', { class: 'sb-slot' }, statusTag(status), sentence(chapter, decisions, paragraph, slotId), controls(code, chapter, slotId, decisions));
      slots.push({ status, node });
    }
  }
  const shown = hideFilled ? slots.filter((s) => s.status !== 'ok') : slots;
  $('slots').replaceChildren(...(slots.length ? shown.map((s) => s.node) : [el('p', { class: 'sb-meta' }, '本章沒有需要填寫的括號。')]));
  $('defaults').disabled = locked(code);
  renderProgress(code);
  updateChapterNav();
  showStep(3);
}

async function applyDefaults() {
  const code = current;
  await save(code, (decisions) => chapterDefaults(state.pack, code, decisions, { at: new Date().toISOString(), by: state.me.displayName }));
  await reopenPreservingScroll(code);
}

async function allDecisions() {
  const result = {};
  for (const code of state.chosen) result[code] = (await ensureChapter(code)).decisions;
  return result;
}

// Item 8: a "版次來源不一致" note is rephrased into a plain sentence with the raw detail kept in a
// smaller, muted span; any other version_note (e.g. the bullet-numbering one) is shown as is.
function versionNoteParts(note) {
  if (!note.startsWith('版次來源不一致')) return [note];
  return ['本章版次有疑義，請與工程會公告核對（詳細：', el('span', { class: 'sb-meta' }, note), '）'];
}

// Manual choices for the unmatched codes of the saved item codes (the same saved body state.chosen comes from).
function manualState() {
  const body = state.projectRecord?.body ?? {};
  const codes = selectChapters(body.item_codes ?? [], state.pack).unmatched.map((u) => u.code);
  return resolveManual(state.pack, codes, body.manual);
}

async function renderLint() {
  await dropCache();
  const decisions = await allDecisions();
  const issues = lint(state.pack, state.chosen, decisions, manualState().unresolved);
  const blocking = hasBlocking(issues);
  const byChapter = new Map();
  for (const issue of issues) {
    if (!byChapter.has(issue.chapter)) byChapter.set(issue.chapter, []);
    byChapter.get(issue.chapter).push(issue);
  }
  // A compact table (one row per chapter) instead of kit-list-item rows, whose touch-sized padding made the list tall.
  const rows = [...byChapter].map(([code, list]) => {
    const counts = {};
    for (const i of list.filter((x) => x.blocking)) counts[i.rule] = (counts[i.rule] ?? 0) + 1;
    const pending = Object.entries(counts).map(([rule, n]) => (rule === 'manual_unresolved' ? RULES[rule] : `${RULES[rule]} ${n} 格`)).join('；');
    const manual = !state.pack.chapters[code]; // an unmatched code: its choice is made in step 2
    const notes = [];
    list.filter((x) => !x.blocking).forEach((x, i) => {
      if (i > 0) notes.push('；');
      notes.push(...(x.rule === 'chapter_defaults' ? [`${x.count} 格以「全部採用預設」帶入`] : versionNoteParts(x.note)));
    });
    return el('tr', {},
      el('td', {}, `${code} ${manual ? state.pack.code_index[code] ?? NO_CODE_NAME : state.pack.chapters[code].name}`),
      el('td', {}, pending || '—'),
      el('td', {}, ...(notes.length ? notes : ['—'])),
      el('td', {}, el('button', { class: 'kit-button kit-button--link', type: 'button', on: { click: manual ? () => stepHandlers[2]() : guard(() => openChapter(code)) } }, '前往')));
  });
  const table = el('table', { class: 'kit-table' },
    el('thead', {}, el('tr', {}, el('th', {}, '章節'), el('th', {}, '未完成'), el('th', {}, '備註'), el('th', {}, el('span', { class: 'kit-sr-only' }, '操作')))),
    el('tbody', {}, ...rows));
  $('lint').replaceChildren(
    el('div', { class: 'kit-callout', 'data-status': blocking ? 'warning' : 'success' }, blocking ? '還有未完成的格子或需人工指定的工項碼，只能下載草稿。' : '全部格子都已處理，可以下載正式版。'),
    ...(rows.length ? [el('div', { class: 'sb-table-wrap' }, table)] : []),
  );
  $('download-final').disabled = blocking;
  $('publish').disabled = blocking || state.readOnly;
  $('publish').hidden = state.readOnly;
  $('reopen').hidden = !state.readOnly;
  showStep(4);
}

async function download(draft) {
  await dropCache();
  const { specials, unresolved } = manualState();
  const model = toDocxModel(state.pack, state.chosen, await allDecisions(), { draft, specials, unresolved });
  const template = await (await fetch('./templates/specbook.docx')).blob();
  const blob = await studio.docx.fromTemplate(template, toTemplateData(model));
  const name = `${state.project?.name ?? '施工規範'}${draft ? '-草稿' : ''}.docx`;
  await studio.download(name, blob, DOCX_MIME);
  notice(null); // item 2: a successful download clears any stale error notice
}

const projectEntry = () => ({ collection: PROJECT, recordId: state.projectRecord.recordId, version: state.projectRecord.version, body: state.projectRecord.body });

// Chapter records in the given state (fresh from the server), so a retry after a partial publish/reopen
// skips the ones already done.
async function chapterEntries(published) {
  await dropCache();
  const list = [];
  for (const code of state.chosen) {
    const record = await ensureChapter(code);
    if (record.recordId && (record.state === 'published') === published) list.push({ collection: CHAPTER, recordId: record.recordId, version: record.version, body: { decisions: record.decisions } });
  }
  return list;
}

// Publish/reopen bump versions server-side and may stop part way: always reload the project record and
// take read-only from its state, so the page matches what is stored.
async function reloadAfterStateChange() {
  state.projectRecord = await state.store.loadProject();
  state.readOnly = state.projectRecord?.state === 'published';
  // Item 1: publish/reopen only re-render step 4 below; step 2's checkboxes/save buttons were rendered
  // earlier (possibly while the project was still editable) and are not touched by renderLint(), so
  // their disabled state must be re-asserted explicitly here or it would keep reflecting the old state.
  applyReadOnly();
  await renderLint();
}

// The project record goes last: the page stays editable until every chapter is published.
async function publish() {
  if (!(await studio.confirm('定稿後所有人都不能再修改，確定？', { confirmLabel: '定稿' }))) return;
  try {
    if (!(await state.store.publishAll([...(await chapterEntries(false)), projectEntry()]))) return; // the host dialog settled a refusal
    studio.notify('已定稿');
    notice(null); // item 2: a successful publish clears any stale error notice
  } finally {
    await reloadAfterStateChange();
  }
}

// The project record goes first: the page unlocks as soon as reopening starts.
async function reopen() {
  const reason = await studio.prompt('解除定稿的原因（1–200 字）');
  if (!reason) return;
  try {
    await state.store.reopenAll([projectEntry(), ...(await chapterEntries(true))], reason.slice(0, 200));
    notice(null); // item 2: a successful reopen clears any stale error notice
  } finally {
    await reloadAfterStateChange();
  }
}

// Project switch: nothing cached or shown for the old project may be used against the new one.
stepHandlers.reset = () => {
  chapters.clear(); opened.clear(); saving.clear(); current = null; hideFilled = false;
  $('hide-filled').checked = false;
};
stepHandlers[3] = guard(() => openChapter(current && state.chosen.includes(current) ? current : state.chosen[0]));
stepHandlers[4] = guard(renderLint);
const gotoPrevChapter = guard(async () => { const code = neighborChapter(-1); if (code) await openChapter(code); });
const gotoNextChapter = guard(async () => { const code = neighborChapter(1); if (code) await openChapter(code); });
$('chapter-pick').addEventListener('change', guard((event) => openChapter(event.target.value)));
$('defaults').addEventListener('click', guard(applyDefaults));
$('hide-filled').addEventListener('change', guard(async (event) => { hideFilled = event.target.checked; if (current) await openChapter(current); }));
for (const id of PREV_IDS) $(id).addEventListener('click', gotoPrevChapter);
for (const id of NEXT_IDS) $(id).addEventListener('click', gotoNextChapter);
for (const id of ['goto-check', 'goto-check-top']) $(id).addEventListener('click', () => { notice(null); stepHandlers[4](); });
$('download-draft').addEventListener('click', guard(() => download(true)));
$('download-final').addEventListener('click', guard(() => download(false)));
$('publish').addEventListener('click', guard(publish));
$('reopen').addEventListener('click', guard(reopen));
