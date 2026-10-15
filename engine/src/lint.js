import { decisionState } from './decisions.js';

const BLOCKING_RULES = { missing: 'unresolved', stale: 'stale', invalid: 'invalid_choice' };

// Spec §5.3: blocking issues stop the formal DOCX; the rest are listed for review.
// unresolved: unmatched chapter codes still waiting for a manual choice (manual.js resolveManual).
export function lint(pack, chapterCodes, decisionsByChapter, unresolved = []) {
  const issues = unresolved.map((code) => ({ chapter: code, rule: 'manual_unresolved', blocking: true }));
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
