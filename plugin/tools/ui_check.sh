#!/usr/bin/env bash
# Stage plugin/app + engine like deploy.sh does, then drive app.js/fill.js with a stub DOM and FakeStudio.
# Stage dir is disposable: /Volumes/Vibe-Temp/specbook/ui-check (re-created every run).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGE=/Volumes/Vibe-Temp/specbook/ui-check
rm -rf "$STAGE"; mkdir -p "$STAGE/engine"
cp -R "$ROOT/plugin/app/." "$STAGE/"
cp "$ROOT/engine/index.js" "$STAGE/engine/" && cp -R "$ROOT/engine/src" "$STAGE/engine/src"
cp "$ROOT/plugin/test/fake-studio.js" "$ROOT/plugin/test/manual-pack.js" "$ROOT/engine/test/sample-pack.js" "$STAGE/"
echo '{"type":"module"}' > "$STAGE/package.json"
cp "$ROOT/plugin/tools/ui_check.mjs" "$STAGE/check.mjs" && node "$STAGE/check.mjs"
