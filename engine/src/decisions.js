const OPTION_KINDS = new Set(['default_blank', 'optional', 'choice', 'choice_blank']);
const TEXT_KINDS = new Set(['default_blank', 'blank', 'choice_blank']);
const DEFAULT_KINDS = new Set(['default_blank', 'optional']);
// A paragraph where a slot was omitted and no letter or digit remains is dropped.
const EMPTY_AFTER_OMIT = /^[^\p{L}\p{N}]*$/u;

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

// Text a decided slot contributes to its paragraph ('' for an omitted optional sentence).
export function slotText(slot, choice) {
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
      let omitted = false;
      const text = paragraph.text
        .map((part) => {
          if (typeof part === 'string') return part;
          const id = String(part.slot);
          const decision = decisions[id];
          const slot = chapter.slots[id];
          if (decisionState(chapter, id, decision) !== 'ok') return slot.raw;
          if ('omit' in decision.choice) omitted = true;
          return slotText(slot, decision.choice);
        })
        .join('');
      if (omitted && EMPTY_AFTER_OMIT.test(text)) continue;
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
