// Unmatched chapter codes are resolved by hand, never auto-mapped: a chapter of the pack that shares the
// first 4 digits ('related'), a special provision written by the user ('special'), or 'exclude'.
export const NO_CODE_NAME = '（編碼表無此碼）';

export const relatedChapters = (pack, code) => Object.keys(pack.chapters).filter((c) => c.slice(0, 4) === code.slice(0, 4)).sort();

export const specialName = (pack, code) => pack.code_index[code] ?? NO_CODE_NAME;

function resolved(pack, code, entry) {
  if (entry?.choice === 'related') return relatedChapters(pack, code).includes(entry.chapter);
  if (entry?.choice === 'special') return typeof entry.text === 'string' && entry.text.trim() !== '';
  return entry?.choice === 'exclude';
}

// codes: the unmatched chapter codes; manual: {code: {choice, chapter?, text?}} as saved in the project.
// A related pick or a blank special provision counts as unresolved until it is complete.
export function resolveManual(pack, codes, manual = {}) {
  const done = codes.filter((code) => resolved(pack, code, manual[code]));
  const pick = (choice) => done.filter((code) => manual[code].choice === choice);
  return {
    unresolved: codes.filter((code) => !done.includes(code)),
    related: pick('related').map((code) => manual[code].chapter),
    specials: pick('special').map((code) => ({ code, name: specialName(pack, code), text: manual[code].text })),
  };
}
