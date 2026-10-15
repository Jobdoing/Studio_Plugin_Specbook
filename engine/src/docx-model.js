import { applyDecisions } from './decisions.js';
import { hasBlocking, lint } from './lint.js';

export const DRAFT_WATERMARK = '草稿，未完成檢查';
export const END_MARK = '〈本章結束〉';

export function chapterTitle(code, chapter) {
  const date = chapter.announced ? `（${chapter.announced}）` : '';
  return `第${code}章 ${chapter.name} ${chapter.version}${date}`;
}

// Spec §5.4: the data handed to the Studio DOCX helper. The formal document requires a lint with no blocking issue.
// specials: special provisions ({code, name, text}) written as their own chapters, one paragraph per
// non-empty line, each placed before the first chapter with a larger code (chapterCodes keep their order);
// unresolved: see lint.
export function toDocxModel(pack, chapterCodes, decisionsByChapter, { draft, specials = [], unresolved = [] }) {
  if (!draft && hasBlocking(lint(pack, chapterCodes, decisionsByChapter, unresolved))) {
    throw new Error('Blocking lint issues remain; only a draft can be produced.');
  }
  const chapters = applyDecisions(pack, chapterCodes, decisionsByChapter).map((chapter) => ({
    code: chapter.code,
    title: chapterTitle(chapter.code, pack.chapters[chapter.code]),
    paragraphs: chapter.paragraphs,
    end: END_MARK,
  }));
  for (const { code, name, text } of specials) {
    const paragraphs = text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => ({ number: null, text: line }));
    const at = chapters.findIndex((chapter) => chapter.code > code);
    chapters.splice(at === -1 ? chapters.length : at, 0, { code, title: `第${code}章 ${name}`, paragraphs, end: END_MARK });
  }
  return {
    draft,
    watermark: draft ? DRAFT_WATERMARK : null,
    toc: chapters.map(({ code, title }) => ({ code, title })),
    chapters,
  };
}
