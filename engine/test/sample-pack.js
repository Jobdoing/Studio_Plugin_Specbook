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
