// Engine DOCX model (spec §5.4) -> the data shape of templates/specbook.docx (build_template.py).
// Number and text are joined by a full-width space: docxtemplater writes a tab as a raw character, not <w:tab/>.
export function toTemplateData(model) {
  return {
    draftLabel: model.watermark ?? '',
    toc: model.toc.map(({ title }) => ({ title })),
    chapters: model.chapters.map((chapter) => ({
      title: chapter.title,
      paragraphs: chapter.paragraphs.map(({ number, text }) => ({ line: number ? `${number}\u3000${text}` : text })),
      end: chapter.end,
    })),
  };
}
