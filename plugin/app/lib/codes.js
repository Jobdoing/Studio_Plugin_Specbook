const SHEET = '預算詳細表';
const HEADER = '編碼(備註)';
const ITEM_CODE = /^[0-9A-Z]{5,}$/;

const compact = (value) => String(value ?? '').replace(/\s+/g, '').replace(/[（）]/g, (m) => (m === '（' ? '(' : ')'));

// Formula cells store their effective value in `result` (exceljs); plain cells are the value itself.
const effectiveValue = (cell) => (cell && typeof cell === 'object' && 'result' in cell ? cell.result : cell);

// exceljs cell values: string, number, {richText:[{text}]}, or {formula, result}.
function cellText(value) {
  if (value && typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    if ('result' in value) return cellText(value.result);
    return '';
  }
  return String(value ?? '');
}

// Item codes from the PCCES detail sheet's 編碼(備註) column. Flags after a comma (",#,*") are dropped;
// numeric cells are reported instead of guessed because Excel already removed their leading zeros.
export function extractItemCodes(sheets) {
  const rows = sheets[SHEET];
  if (!rows) return { codes: [], warnings: [], error: `找不到「${SHEET}」工作表。` };
  let headerRow = -1;
  let column = -1;
  for (let r = 0; r < rows.length && column < 0; r += 1) {
    column = (rows[r] ?? []).findIndex((cell) => compact(cellText(cell)) === HEADER);
    headerRow = r;
  }
  if (column < 0) return { codes: [], warnings: [], error: `「${SHEET}」沒有「${HEADER}」欄。` };

  const codes = [];
  const warnings = [];
  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const cell = (rows[r] ?? [])[column];
    const value = effectiveValue(cell);
    if (typeof value === 'number') {
      warnings.push(`第 ${r + 1} 列的編碼是數字格式（${value}），開頭的 0 可能已遺失，已略過，請改用文字格式或手動加章。`);
      continue;
    }
    const code = cellText(cell).split(',')[0].trim().toUpperCase();
    if (ITEM_CODE.test(code) && !codes.includes(code)) codes.push(code);
  }
  return { codes, warnings, error: null };
}
