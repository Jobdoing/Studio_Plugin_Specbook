const CHAPTER_CODE = /^\d{5}$/;

function add(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function sortedEntries(map) {
  return [...map].sort(([a], [b]) => a.localeCompare(b));
}

function unmatchedReason(code, pack) {
  if (pack.deleted[code]) return 'deleted';
  if (pack.code_index[code]) return 'code_table_only';
  return 'no_spec';
}

// Spec §5.1: the chapter code is the first 5 characters of a PCCES item code.
export function selectChapters(itemCodes, pack) {
  const seen = new Set();
  const found = new Map();
  const missing = new Map();
  const temporary = [];
  const unrecognized = [];
  for (const raw of itemCodes) {
    const item = String(raw).trim().toUpperCase();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    if (item.startsWith('Z')) {
      temporary.push(item);
      continue;
    }
    const code = item.slice(0, 5);
    if (!CHAPTER_CODE.test(code)) {
      unrecognized.push(item);
      continue;
    }
    add(pack.chapters[code] ? found : missing, code, item);
  }

  const suggested = new Map();
  for (const [code] of sortedEntries(found)) {
    for (const ref of pack.chapters[code].related) {
      if (!found.has(ref) && pack.chapters[ref]) add(suggested, ref, code);
    }
  }

  return {
    chapters: sortedEntries(found).map(([code, items]) => ({ code, items })),
    unmatched: sortedEntries(missing).map(([code, items]) => ({ code, items, reason: unmatchedReason(code, pack) })),
    temporary,
    unrecognized,
    suggested: sortedEntries(suggested).map(([code, referencedBy]) => ({ code, referencedBy })),
  };
}
