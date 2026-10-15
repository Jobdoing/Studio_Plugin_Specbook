#!/usr/bin/env bash
# Render plugin/app/templates/specbook.docx with Studio's vendored docxtemplater in headless Chrome.
# Vendor files are cached under /Volumes/Vibe-Temp/specbook/vendor (re-downloadable from m2).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
CACHE=/Volumes/Vibe-Temp/specbook/vendor
mkdir -p "$CACHE"
[ -f "$CACHE/docxtemplater.js" ] || scp -q <studio-box>:/opt/studio5/current/public/vendor/docxtemplater/3.x/docxtemplater.js "$CACHE/"
[ -f "$CACHE/pizzip.min.js" ] || scp -q <studio-box>:/opt/studio5/current/public/vendor/pizzip/3.x/pizzip.min.js "$CACHE/"
python3 "$HERE/tools/build_template.py" >/dev/null
B64="$(base64 -i "$HERE/app/templates/specbook.docx" | tr -d '\n')"
cat > "$CACHE/smoke.html" <<HTML
<html><body><pre id="out">pending</pre>
<script src="pizzip.min.js"></script><script src="docxtemplater.js"></script>
<script>
try {
  var bin = atob("$B64"), buf = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  var doc = new docxtemplater(new PizZip(buf.buffer), { paragraphLoop: true, linebreaks: true, nullGetter: function () { return ''; } });
  doc.render({ draftLabel: '草稿，未完成檢查', toc: [{ title: 'T1' }, { title: 'T2' }],
    chapters: [{ title: 'T1', end: '〈本章結束〉', paragraphs: [{ line: '1.1\u3000P1a' }, { line: 'P1b' }] },
               { title: 'T2', end: '〈本章結束〉', paragraphs: [{ line: 'P2a' }] }] });
  var zip = doc.getZip(), text = function (x) { return x.replace(/<w:p[ >]/g, '\n<w:p ').replace(/<[^>]+>/g, ''); };
  document.getElementById('out').textContent = 'HEADER:' + text(zip.file('word/header1.xml').asText()) + '\nBODY:' + text(zip.file('word/document.xml').asText());
} catch (e) { document.getElementById('out').textContent = 'ERROR ' + e.message; }
</script></body></html>
HTML
# Headless Chrome keeps running after --dump-dom, so the timeout always fires; judge by the dumped text instead.
OUT="$(timeout 60 "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --no-first-run \
  --no-default-browser-check --disable-extensions --allow-file-access-from-files --virtual-time-budget=5000 \
  --user-data-dir="$CACHE/chrome-profile" --dump-dom "file://$CACHE/smoke.html" 2>/dev/null || true)"
TEXT="$(printf '%s' "$OUT" | sed -n '/<pre/,/<\/pre>/p' | sed 's/<[^>]*>//g' | grep -v '^\s*$')"
printf '%s\n' "$TEXT"
if ! grep -q '^BODY:' <<<"$TEXT" || grep -q '^ERROR' <<<"$TEXT"; then echo "SMOKE FAILED" >&2; exit 1; fi
echo "SMOKE OK"
