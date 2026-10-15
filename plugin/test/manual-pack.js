// Slice of specbook-pack-20260926.json (real codes and names) for the "需人工指定" cases from the owner's
// budget: 10 codes only in the coding table, 02890/10103 in neither.
const chapter = (name, version) => ({ name, version, announced: null, version_note: null, unmaintained: false,
  paragraphs: [{ number: '1.1', text: [`${name}概要。`] }], slots: {}, related: [], mentions: [] });

export const manualPack = {
  pack_version: '20260926',
  chapters: {
    '01521': chapter('施工中安全網', 'V5.0'), '01523': chapter('施工安全衛生及管理', 'V5.0'), '01564': chapter('施工圍籬', 'V7.0'),
    '02320': chapter('不適用材料', 'V5.0'), '02323': chapter('棄土', 'V5.0'), '02492': chapter('預力地錨', 'V6.0'),
    '02601': chapter('排水管溝', 'V5.0'), '02931': chapter('植樹', 'V5.0'), '02936': chapter('現地植栽保護', 'V5.0'),
    '07900': chapter('填縫料', 'V4.0'), '07921': chapter('填縫材', 'V5.0'),
  },
  code_index: {
    '01522': '工地臨時建築設施', '01540': '施工輔助設施', '01560': '施工護欄及圍籬', '02321': '基地及路幅開挖', '02495': '監測儀器',
    '02609': '排水工程', '02935': '植栽維護', '05060': '金屬材料', '05500': '金屬製品', '07920': '填縫劑及填縫料',
  },
  deleted: {},
};
export const TABLE_ONLY = ['01522', '01540', '01560', '02321', '02495', '02609', '02935', '05060', '05500', '07920'];
export const NOWHERE = ['02890', '10103'];
