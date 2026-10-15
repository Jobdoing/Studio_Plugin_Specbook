# Studio5 SDK research notes — for the `specbook` plugin plan

Source box: `<studio-box>` (read-only). All facts cite `path:line` on that box unless marked
`UNVERIFIED`. Docs read: `/opt/studio5/current/docs/authoring/plugin-onboarding.md`,
`/opt/studio5/current/docs/authoring/guidance/{sdk,data,helpers,layout,templates,box}.md`,
`/opt/studio5/current/docs/authoring/CHANGELOG.md`. Source read where docs were ambiguous:
`/opt/studio5/current/src/studio-plugin.js`, `/opt/studio5/current/src/studio-plugin/helpers/{xlsx,docx}.js`,
`/opt/studio5/current/scripts/lib/blocks/{plugin-install.mjs,zip.mjs,plugin-blocks.mjs}`,
`/opt/studio5/current/scripts/lib/blocks/sample-app-plugin/plugin.json`,
`/opt/studio5/current/public/vendor/docxtemplater/3.x/docxtemplater.js`.
Local convention reference: `/Volumes/AI-Model/ACKB/plugins/studio5-ackb/{app/plugin.json,app/index.html,deploy.sh}`.

說明用繁體中文，程式碼識別字/引用原文保留英文。

---

## 1. `plugin.json` manifest, records collection declaration, project scope

**Required/known fields** (`plugin-onboarding.md:26-33`, confirmed against the real sample manifest
`scripts/lib/blocks/sample-app-plugin/plugin.json:1` = `{"id":"sample-app","title":"表單範例","kind":"app","entry":"index.html"}`):

```json
{ "id": "specbook", "title": "工程規範書", "kind": "app", "version": "0.1.0" }
```

- `id` **MUST equal the directory name** (`plugin-onboarding.md:50`). This is also the root CSS
  class rule (`layout.md:64`): your root `<div class="specbook">` and every other selector scoped
  under it (`.specbook .toolbar`), never a bare top-level class.
- `kind` is always the literal `"app"` for a plugin page (`plugin-onboarding.md:50`).
- `version` is optional but should always be set and bumped (`plugin-onboarding.md:51-55`) — `plugin.mjs upgrade`
  **refuses** an upgrade whose `plugin.json` has no `version` or the same `version` as the currently
  live one, unless `--same-version` is passed (`CHANGELOG.md`, "2026-09-25 — `plugin.mjs check`…").
  `install` (a brand-new id) never has this refusal; a missing version there is silently synthesized
  as `0.0.0-<UTC timestamp>` with a warning (`plugin-onboarding.md:53-55`).
- `entry` — the sample manifest carries an `entry:"index.html"` key, but I found **no code path
  that reads `manifest.entry`** for an app plugin (grepped `plugin-install.mjs`, `plugin-blocks.mjs`,
  the registry loader area) — `index.html` is a **fixed** convention (`plugin-onboarding.md:29`:
  "index.html # entry page (required)"), not configurable. Treat `entry` as a harmless/decorative
  leftover; do not rely on it. UNVERIFIED that Studio ignores it outright (I did not find the
  registry-load file itself, only the install/lint/blocks modules), but no evidence it's honored.
- **Records collections are NOT declared in `plugin.json` at all** — a collection is created
  implicitly the first time your code calls `studio.records.create`/`put`/`createMany` against it.
  The only thing you optionally declare in `plugin.json` is **write permission** on a collection
  name you already use in code:
  ```json
  { "id": "specbook", "title": "工程規範書", "kind": "app",
    "permissions": { "specbook-chapter": { "write": "app-admin" } } }
  ```
  (`data.md:311-325`). Default (no `permissions` entry) = any signed-in company user can read AND
  write. `write` is one of `member` (default) / `app-admin` / `admin`, a strict hierarchy
  (`data.md:317-321`). For `specbook`, §6.2 of the spec doesn't ask for admin-gated writes, so
  **no `permissions` block is needed** — every collection defaults to open read/write for signed-in
  company users, which matches "多人各自編輯不同章".
- **Scope is a per-call parameter, not a manifest declaration**: `scope: "project" | "company" | "user"`
  is passed on every `records.create`/`put`/`list`/`count`/`createMany`/`getByKey` call
  (`data.md:244-256`, `data.md:305-309`). `specbook-project` and `specbook-chapter` (spec §6.2) should
  both be `scope: "project"`.
- **No manifest declaration needed to use `studio.xlsx`/`studio.docx`/`studio.download`/`studio.blob`** —
  every one of these is already exposed on `window.studio` the moment `/studio-plugin.js` is loaded
  (`sdk.md:1-70`, `helpers.md:1-4`: "there is nothing extra to load or install"). The only
  capability that DOES need a manifest declaration is the camera (`"capabilities": ["camera"]` for
  `studio.scan()`, `helpers.md` §"Barcode / QR") — irrelevant to `specbook`.
- **id naming / reserved ids**: `plugin-install.mjs:281` rejects "not a valid or is a reserved
  plugin id" for a zip-derived id — the exact reserved list wasn't read in full (not needed for a
  plugin named `specbook`, which is not one of the reserved names seen elsewhere in this pack:
  `data`/`runtime`/`artifacts`/`experiments`/`api`/`blocks`/`plugins`/`studio`/`smoke-check`, per
  `data.md:749-752`'s blob-key reserved list which reuses the same `safeBlockId` check
  — `plugin-install.mjs` imports `safeBlockId`/`copyDirSafely` from `zip.mjs`).

**How the plugin gets the current project (project scope)** — there is a **host-rendered project
picker outside your iframe**; your plugin never builds one itself:
- `studio.project()` → `Promise<{project_handle,project_key,name}|null>`, "current selected 案場
  (project), fetched fresh from the host each call" (`sdk.md:33`).
- `studio.onProjectChange(fn)` fires on every user project-switch, and once on load with the
  current value (`null` if none picked) — register it in your page's initial synchronous script run
  (`sdk.md:34`; this "initial push on load" bug was fixed 2026-09-26, `CHANGELOG.md` "Fix: the
  initial `onProjectChange` push was lost").
- `studio.projects()` lists every project the user can pick from, if you need your own UI for some
  reason (`sdk.md:35`) — not needed for `specbook`; the shell's own selector is authoritative.
- **Fixed pattern (a)** (`data.md:356-361`): before any `scope:"project"` write, check
  `studio.project()` for `null` and disable saving; pass `project_handle` explicitly on every
  `scope:"project"` call that needs one (`create`, `list`, `count`, `createMany`, `put`,
  `getByKey`, `watch`) — the SDK never attaches it automatically. `update`/`remove`/`get`/`history`
  operate by `record_id` alone and need no `project_handle`.
- Conclusion: **the plugin does not need to run "inside a project" as a hard precondition of
  mounting** — it mounts in the rail like any plugin; it must simply disable the "帶入/儲存" actions
  whenever `studio.project()` is `null`, matching `data.md`'s fixed pattern (a).

---

## 2. `studio.records` — exact API

Full table: `data.md:242-269`. Body shape: `data.md:275-281`. All calls return a `Promise`; on
failure reject `Error(code)` (`data.md:239`) except `VERSION_CONFLICT`, which additionally sets
`err.current` (`data.md:240`, `363-365`).

| Call | Signature | Notes |
|---|---|---|
| `records.create` | `create(collection, {scope, project_handle?, key?, schema?, body})` → `Promise<Record>` | `data.md:244` |
| `records.get` | `get(collection, record_id)` → `Promise<Record\|null>` | `data.md:245` |
| `records.update` | `update(collection, record_id, {version, body, schema?})` → `Promise<Record>` | `data.md:246` — optimistic lock via `version` |
| `records.remove` | `remove(collection, record_id, {version})` → `Promise<Record>` (soft delete) | `data.md:247` |
| `records.restore` | `restore(collection, record_id)` → `Promise<Record>` | `data.md:248` |
| `records.createMany` | `createMany(collection, {scope, project_handle?, items:[{key?,schema?,body}]})` → `Promise<{created, failed_at_batch, records}>` | auto-batches 500 items/8 MiB (`data.md:249`) |
| `records.put` | `put(collection, key, {scope, project_handle?, body, schema?, version?})` → `Promise<Record>` | **upsert by caller-chosen key**; pass `version` for CAS (`data.md:250`) |
| `records.getByKey` | `getByKey(collection, key, {scope, project_handle?})` → `Promise<Record\|null>` | `null`, not 404, when absent (`data.md:251`) |
| `records.list` | `list(collection, {scope, project_handle?, where?, q?, order?, select?, limit?, include_deleted?})` → `Promise<Record[]>` | full scan, no pagination/index (`data.md:252, 285-287`) |
| `records.count` | `count(collection, {scope, project_handle?, where?, q?})` → `Promise<number>` | `data.md:253` |
| `records.history` | `history(collection, record_id)` → `Promise<HistoryEntry[]>` | `data.md:254` |
| `records.watch` | `watch(collection, {scope, project_handle?}, fn)` → `stop()` | polls every 5s; `fn` never fires on the first call, only on later changes (`data.md:256`) |
| `records.publish` | `publish(collection, record_id, {version})` → `Promise<Record>` | snapshot read-only for everyone (`data.md:261, 495-511`) |
| `records.reopen` | `reopen(collection, record_id, {version, reason})` → `Promise<Record>` | editable again, snapshot kept; `reason` required 1–200 chars (`data.md:262, 501-511`) |
| `records.lease.claim/renew/release/onLost` | soft edit-lock, `data.md:257-260, 446-493` | optional — not needed for `specbook` since chapters are already split one-record-per-chapter to avoid collisions (spec §6.2) |

**Can we choose the record id/key — e.g. one record per chapter code?** Yes, exactly the paved
road: `records.put(collection, key, {...})` lets you upsert by a caller-chosen `key` string
(`data.md:250`), and `records.getByKey(collection, key, {...})` reads it back without needing to
know the internal `record_id` (`data.md:251`). For `specbook-chapter`, use `key = chapterCode`
(e.g. `"07505"`) — this is precisely the `list-detail` template's own pattern
("`records.put`/`getByKey` (upsert by a stable key, not an auto id)", `templates.md` §list-detail).
For `specbook-project`, spec §6.2 says "每個 Studio 專案一筆" — use `key = project_handle` (or a
fixed literal key like `"main"` since scope is already project-bound, so there's naturally at most
one record per project per key) with `records.put("specbook-project", project_handle, {scope:
"project", project_handle, body})`.

**`VERSION_CONFLICT` error shape**: `Error("VERSION_CONFLICT")` — a plain `Error` whose `.message`
is the code string `data.md:239, 277 (sdk.md's error table)`, plus a non-standard `err.current`
property holding *the record as it now stands* (`data.md:240, 364`). **Fixed pattern (b)**: never
retry the write with the new version automatically — show the user both versions and let them
choose overwrite/merge/discard (`data.md:363-365`). This is exactly spec §6.2's "衝突的話就重新讀取
並提示使用者".

**Publish/reopen** (spec §6.2's "定稿"): `records.publish(collection, id, {version})` sets
`record.state = 'published'`; further `update`/`remove`/`publish`/`lease.claim` on it get
`Error('PUBLISHED')` (`err.published = {version,at,by,by_name}`) until `records.reopen(collection,
id, {version, reason})` is called, which keeps the old snapshot readable via `{view:'published'}`
(`data.md:495-511`, `sdk.md:265-266` error table). `reopen`'s required role defaults to the
collection's own `write` role, overridable via `permissions.<collection>.reopen`
(`data.md:507-508`).

**Body size limit**: **1 MiB per record** (`data.md:294`). `createMany` batches cap at 500
items/8 MiB (`data.md:294`). Quota: 1 GiB per plugin total, shared by records + full version
history (`data.md:296-297`).

**Listing records of a collection in the current project scope**:
```js
const p = await studio.project();
if (!p) { /* disable save/list actions */ }
const chapters = await studio.records.list("specbook-chapter", {
  scope: "project", project_handle: p.project_handle,
});
```
(pattern from `data.md:244-256` + fixed pattern (a), `data.md:359-361`).

---

## 3. `studio.xlsx` helper

Loading: **nothing to import manually** — `studio.xlsx.read`/`.write` are already on `window.studio`
once `/studio-plugin.js` is loaded; the helper **lazily fetches**
`/vendor/exceljs/4.4/exceljs.min.js` on first call (`helpers.md:21-23`, confirmed in source:
`src/studio-plugin/helpers/xlsx.js:17-32` `loadExcelJS()`).

```js
const input = document.getElementById("file-input"); // <input type=file accept=".xlsx">
const { sheets } = await studio.xlsx.read(input.files[0]);
// sheets = { "預算詳細表": [ [...header row], [...data row], ... ], ... }
```
Signature confirmed in source: `read(file, opts?)` → `Promise<{sheets: {[name]: any[][]}}>`
(`.../xlsx.js:53-77`); `opts.sheet` narrows to one worksheet by name. Rejects
`Error("BODY_TOO_LARGE")` above 20 MiB (`.../xlsx.js:19, 55`) and `Error("ZIP_BOMB_SUSPECTED")`
above 50 MiB decompressed (`.../xlsx.js:65`).

**Can cells be read as text, preserving leading zeros like `0133012004`?** — Source fact
(`.../xlsx.js:57-58, 72-75`): "Cell values are exceljs's own `.value`… passed through as-is, not
stringified." exceljs's `.value` reflects **however the source `.xlsx` file itself stored that
cell** — if the workbook's cell is number-formatted, Excel itself has already discarded any
leading zero before the file was ever saved (native Excel number storage has no leading zeros;
this happens before Studio ever touches the file), and `.value` comes back as a JS `number`. If
the cell is text-formatted (`@` number format) or was entered with a leading apostrophe, Excel
stores it as a genuine string and `.value` comes back as that string, leading zeros intact.
**Studio does no coercion either way** — it is purely "whatever exceljs parses from the XLSX XML."
This directly matches spec §6.4's own risk note ("把「編碼(備註)」欄當文字讀，避免 xlsx 數字格掉前導
0"): the plugin's read code must defensively re-stringify a numeric cell (e.g. `String(v).padStart(5,
'0')` is NOT safe/general — the real fix is: if the source workbook already stores 編碼(備註) as
text (the common case for an "編碼" column in a real 標單), `.value` is already a string and no
special handling is needed; if a given file stores it as a number, the leading zeros are
**already permanently lost inside the .xlsx file itself** before Studio's `xlsx.read` ever runs —
there is no way to recover them client-side. **This is a genuine data-quality risk to flag to the
user at import time** (e.g. detect a bare `Number` value in that column and warn "此欄未以文字格式
儲存，前導 0 可能已遺失，請確認" ) rather than something `studio.xlsx` can fix.

`studio.xlsx.write({sheets, filename})` exists too (not needed for `specbook`'s import-only flow)
— it internally calls `studio.download` with the xlsx mimetype (`.../xlsx.js:100-116`).

---

## 4. `studio.docx.fromTemplate` (docxtemplater)

**Loading**: nothing to import manually — `studio.docx.fromTemplate` is on `window.studio` once
`/studio-plugin.js` is loaded; it lazily fetches `/vendor/pizzip/3.x/pizzip.min.js` +
`/vendor/docxtemplater/3.x/docxtemplater.js` on first call (`helpers.md:33-35`, confirmed in
source `.../docx.js:26-33`).

**Call signature** (confirmed in source, `.../docx.js:52-71`):
```js
studio.docx.fromTemplate(templateFileOrBlobKey, data) // -> Promise<Blob>
```
`templateFileOrBlobKey` accepts, per `.../docx.js:39-49`:
- a `string` → treated as a **blob key**, fetched via `studio.blob.get(key)` (rejects `NOT_FOUND`
  if absent);
- otherwise, anything `toArrayBuffer()` accepts: an `ArrayBuffer`, anything with an
  `.arrayBuffer()` method (a `File`/`Blob`/`Response`), or a `TypedArray`/`DataView`
  (`.../docx.js:29-36`).

**Does a template `.docx` need to live in blob storage, or can it be a static file shipped in the
plugin directory?** — **A static file in the plugin directory works directly**, without ever going
through `studio.blob`. Every file under `blocks/<plugin-id>/` is served at
`/blocks/<plugin-id>/…` (`plugin-onboarding.md:20-21`); `.docx` is not one of the extensions with a
special content type, so it falls to `application/octet-stream` (`plugin-onboarding.md:24`) — which
is exactly fine for `fetch()` + `.arrayBuffer()`/`.blob()`, since `fromTemplate` accepts either
directly:
```js
const res = await fetch("./templates/specbook-template.docx");
const blob = await studio.docx.fromTemplate(await res.blob(), data);
await studio.download("報告.docx", blob,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
```
This is simpler than the `helpers.md:38` example (which uses a live `<input type=file>` File —
fine for a user-supplied template, but `specbook` wants a FIXED template shipped with the plugin).
Template size cap: **20 MiB** (`helpers.md:42`, `.../docx.js:11`), plus a 50 MiB
decompressed zip-bomb guard (`.../docx.js:13-18`).

**Template syntax available (free core only, no paid module)**: `{tag}` for a scalar, `{#rows}…
{/rows}` for a loop (`helpers.md:36-37`). Confirmed in the vendored file itself
(`/opt/studio5/current/public/vendor/docxtemplater/3.x/docxtemplater.js` contains `LoopModule`
bundled directly in the single file, not a separately-licensed/paid module import) — **nested
loops** (chapter → paragraph, which `toDocxModel`/spec §5.4 needs) are standard docxtemplater core
behavior since a loop just re-walks its own scope recursively; I did not find an explicit
Studio-authored test exercising a *nested* loop specifically. **UNVERIFIED at the "Studio-tested"
level** — treat as very likely to work (it's core docxtemplater, not a paid add-on), but write a
one-file smoke test (`{#chapters}{title}{#paragraphs}{text}{/paragraphs}{/chapters}`) as your
NOTE(ceiling)-style self-check before relying on it in the plan.

`nullGetter` is configured to render an empty string for any tag with no matching data key
(`.../docx.js:64-65`) rather than throwing or printing "undefined" — useful for the optional
draft-watermark tag below.

**Table of contents — NOT supported by `studio.docx`/docxtemplater's free core, and NOT mentioned
anywhere in the docs pack** (grepped all guidance files + onboarding + CHANGELOG for "TOC"/"目錄" —
zero hits outside the spec's own `toDocxModel` description). docxtemplater's job is pure
tag/loop substitution across the docx's XML parts (`getTemplatedFiles`/`templatedFiles`, confirmed
present in the vendored bundle) — it has no page-layout or pagination engine, so it cannot compute
real page numbers, and there is no headless/server-side Word rendering available to Studio plugins
for that either (`studio.pdf()` is a *different*, server-rendered HTML→PDF path — `print.md` — not
usable for producing a `.docx`). **Two working alternatives, both doc-allowed**:
1. **A native Word TOC field baked into the template itself**, referencing paragraphs styled
   `Heading1`/`Heading2` — docxtemplater preserves any style/formatting on a repeated paragraph it
   doesn't itself alter (loop repeats the whole paragraph, style included), so if the per-chapter
   title paragraph inside `{#chapters}…{/chapters}` in the *template* already carries `Heading1`
   style, a TOC field placed once at the front of the template will pick up every repeated
   heading and (in real Word) show correct page numbers **once the user opens the file and accepts
   Word's "update fields" prompt** (or has "update fields on open" set) — this is a Word-side
   behavior Studio does not control or guarantee; LibreOffice needs a manual Tools→Update→Fields in
   some versions. **This means "目錄" in the downloaded .docx may show stale/placeholder page
   numbers until the user updates fields** — flag this to the user (e.g. a note near the download
   button) rather than presenting it as fully automatic.
2. **A manually-rendered heading list with no real page numbers** (a plain paragraph per chapter,
   `{#chapters}{title}{/chapters}` inside a non-field TOC section) — guaranteed correct content,
   but never carries a page number, since nothing client-side paginates the document.
   **Recommend this as the default for `specbook`** given spec §5.4 doesn't explicitly require page
   numbers in the TOC, only "目錄" content (chapter code + title) — simplest, most predictable,
   fully within docxtemplater's free core, and avoids Word/LibreOffice-version-dependent field
   update. **This is the one genuine capability gap the plan must call out** (see "Blockers"
   below if the spec turns out to require live page numbers).

**Repeating sections (chapters → paragraphs)** — nested `{#chapters}…{#paragraphs}…{/paragraphs}
…{/chapters}` loops, per above; the data shape from `toDocxModel` (spec §5.4) maps directly onto
this without any extra flattening.

**Page header text for the draft watermark ("草稿，未完成檢查")** — docxtemplater processes every
XML part discoverable via `[Content_Types].xml`, including `word/header*.xml` (confirmed via
`getTemplatedFiles`/`templatedFiles`/`contentTypes` symbols present in the vendored bundle — this
is docxtemplater's standard, documented upstream behavior: it is not limited to `document.xml`).
**Recommended pattern**: put a single `{draftLabel}` tag in the template's header (once — Word
reuses one header definition across pages unless you deliberately set "different first page" /
section breaks, so one tag placement covers "every page"), and pass:
```js
const data = { ..., draftLabel: draft ? "草稿，未完成檢查" : "" };
```
`nullGetter` isn't even needed here since the key is always supplied; when `draft` is false the
tag simply renders empty, giving a header with no watermark — **no docxtemplater conditional module
needed**, sidestepping the fact that `{#if}`-style conditions are a paid module in some
docxtemplater builds (not confirmed present here — this design avoids needing to check).

**If the plan needs the true, official spec §5.4 chapter title format ("第07505章 屋頂防水層
V3.0（2011/12/30）")** — this is a plain scalar tag (`{chapterHeading}`), no special docx feature
needed; format the string in `toDocxModel`, not in the template.

---

## 5. `studio.download(filename, content, mimeType)`

Exact signature confirmed in source (`src/studio-plugin.js:276-296`):
```js
download(filename, content, mimeType?) -> Promise<void>
```
- Host-mediated: posts `{type:'studio.download', requestId, filename, content, mimeType?}` to the
  parent window and awaits resolution; **15-second timeout**, rejects `Error('timeout')`
  (`studio-plugin.js:278-282`).
- `content` can be a `Blob` (what `docx.fromTemplate`/`xlsx.write` produce) or presumably a string
  for text formats (CSV usage in `helpers.md:9`: `studio.download("施工紀錄.csv", csv, "text/csv")`
  where `csv` is a string from `studio.csv.stringify`) — the message is `postMessage`'d as-is, so
  whatever the host's receiving side accepts (not independently re-verified beyond the two usages
  already documented: Blob for xlsx/docx/ics, string for csv).
- `mimeType` is optional (`msg.mimeType` only set `if (mimeType !== undefined)`,
  `studio-plugin.js:294`) — for `specbook`'s docx use
  `"application/vnd.openxmlformats-officedocument.wordprocessingml.document"` (matches
  `helpers.md:39` and `.../docx.js:70`).
- No documented size cap specific to `download()` itself (unlike xlsx/docx's 20 MiB template caps)
  — UNVERIFIED whether the host side enforces one; not expected to matter for a spec-sized `.docx`
  report.

---

## 6. Static files shipped in the plugin directory (data pack + engine ES modules)

- **URL to fetch, relative to `index.html`**: everything under `blocks/<plugin-id>/` is served at
  `/blocks/<plugin-id>/…` (`plugin-onboarding.md:20-21`) — from `index.html`'s own perspective this
  is just a normal relative path, e.g. `fetch("./data/specbook-pack.json")` or
  `import("./engine/select-chapters.js")`, no absolute URL needed.
- **Content-Type table** (`plugin-onboarding.md:23-30`):
  | Extension | Served as |
  |---|---|
  | `.js`, `.mjs` | `text/javascript` — "so `<script type="module" src="./app.mjs">` works" |
  | `.json` | `application/json` |
  | anything else (incl. `.docx`) | `application/octet-stream` |
  Confirms **ES module `import` of files in the plugin directory works** — `.js`/`.mjs` are served
  with the correct `text/javascript` MIME type, which is what the browser module loader requires.
- **Subdirectories are allowed**: install/upgrade copies the plugin directory recursively
  (`copyDirSafely`, `plugin-install.mjs:226` calling into `zip.mjs:74` which recurses into nested
  directories, `zip.mjs:81`), and the served-path table above is extension-based with no
  depth restriction — a `data/specbook-pack.json` and `engine/*.js` layout is fine.
- **Size limits for install/upgrade**: for a **zip** source, `MAX_ZIP_BYTES = 200 * 1024 * 1024`
  (200 MiB) is enforced (`plugin-install.mjs:22`, comment: "T9: the box's disk, not a wall"). For a
  plain **directory** install (the `deploy.sh` convention this repo already uses —
  `runtime/blocks/<id>.upload/` populated via `scp`, then `install`/`upgrade` — see
  `/Volumes/AI-Model/ACKB/plugins/studio5-ackb/deploy.sh:9-14`), I found **no equivalent explicit
  byte cap** in `plugin-install.mjs`'s directory-copy path (`copyDirSafely` recurses with no size
  accounting) — the practical limit is just disk space on the box. A ~6 MB JSON pack + small JS
  modules is trivially within any of these limits either way.
- Dotfiles and secret-looking files (`.env`, `.git/…`, `*.env`, `*.key`, `*.pem`, `*.p12`, `*.pfx`)
  are never served (`plugin-onboarding.md:31`) — irrelevant to `data/`/`engine/`.

---

## 7. Kit lint rules (L1–L7, S1–S5, ST1) and component classes

Full rule list: `layout.md:5-9` (L1–L7), `layout.md:27-51` (S1–S5, ST1). Summary:

| Rule | Severity | What it flags |
|---|---|---|
| L1 | error | `vh`/`dvh`/`svh`/`lvh`/`vw` units |
| L2 | error | large fixed pixel heights |
| L3 | error | `position: fixed` |
| L4 | error | ancestorless `position: absolute` |
| L5 | error | overriding the framework selector (only a real layout property on `html`/`body`/`:root`/`*`) |
| L6 | error | nested (vertical) scroll containers |
| L7 | error | not linking `/studio-kit.css` |
| S1 | warn | hardcoded color literal (`#hex`/`rgb()`/`hsl()`) when the kit is linked |
| S2 | warn | literal `border-radius` other than `0`/`50%`/`999px` |
| S3 | warn | a selector whose subject is a `.kit-*` class (restyling a kit component directly) |
| S4 | info | a top-level selector not scoped under the plugin's own root class |
| S5 | warn | a custom property whose own value is a color literal |
| ST1 | warn (error under `--strict`) | an un-namespaced literal `localStorage`/`sessionStorage` key or `indexedDB` db name |

All non-gating by default; `--strict` (used by this repo's `deploy.sh:14`, matching spec §6.3's
"執行 `developer-op.sh lint --strict`") gates S1/S2/S3/S5/ST1 as install errors, same as L1–L7
(`layout.md:53-56`).

**Kit component classes** for the elements spec §6/§7 need (all from `layout.md`'s snippet block,
lines noted):
- **File input**: `.kit-upload` — `<label class="kit-upload"><input type="file" accept="image/*" hidden />新增照片</label>` (`layout.md:200-203`; swap `accept` for `.xlsx`).
- **Buttons**: `.kit-button`, `.kit-button--secondary`, `.kit-button--danger`, `.kit-button--link` (`layout.md:174` prose + used throughout `helpers.md`/local `index.html` example already in this repo, e.g. `/Volumes/AI-Model/ACKB/plugins/studio5-ackb/app/index.html:35,45-46`).
- **Segmented/choice buttons**: `.kit-segmented` (ONE mutually exclusive choice, `layout.md:140-141`) vs `.kit-chip[aria-pressed]` (MULTI-select filter, `layout.md:213-215`) vs `.kit-tabs` (in-content tab row you render yourself, `layout.md:144-145`).
- **Text input**: plain `<input>` inside `.kit-field` with a sibling `<label for>` (never a wrapping label) — `layout.md`'s "Form markup" rule; for a measured/decimal value use `type="text" inputmode="decimal" pattern="(?:[0-9]+[.]?[0-9]*|[.][0-9]+)"`, never `type="number"` (`layout.md`'s "Measured-value inputs" section, fixed 2026-09-25 per `CHANGELOG.md`).
- **Progress/status line**: `.kit-status-line[aria-live="polite"]` — a fixed-height inline status ("已填 n/m" fits this exactly, `layout.md:184-187`); for a full-region loading/empty/error swap use `.kit-loading`/`.kit-empty`/`.kit-error` instead (`layout.md:189-198`).
- **Callouts**: `.kit-callout[data-status="warning"|"danger"|...]` (`layout.md:154-155`) — for the lint-results panel (spec §6.1 step 4) and per-field errors use `.kit-field-error` instead (small, left-aligned, under one field — `layout.md`'s dedicated snippet).
- **Lists/tables**: `.kit-list`/`.kit-list-item` (used already in this repo's `index.html:43`), `.kit-table`, or `studio.kit.dataTable(host, {columns, rows})` for a sortable table widget (`helpers.md`'s Component Kit widgets section).
- **Headings**: plain `<h1>`/`<h2>`/`<h3>` — the kit sets base typography (font-family/size) for these automatically; never redeclare font-family/size on your own root class (`layout.md`'s type-scale section).

**Naming rule** (`layout.md:64-66`): root element class == `plugin.json` id (`.specbook`), every
other selector scoped under it — never a bare top-level class.

---

## 8. Viewing user's name/id and current-time conventions

- `studio.me()` → `Promise<{userId, company, project, displayName, companyName}>` (`sdk.md:14`) —
  use `displayName` for a human-readable `by` field, `userId` for a stable machine key.
- **Records already auto-track this for you**: every `Record` carries `created_by`,
  `created_by_name`, `updated_by`, `updated_by_name`, `created_at`, `updated_at` (`data.md:275-277`)
  — for spec §5.2's decision shape `{"slot":12,...,"at":"…","by":"…"}`, this is a **field the
  plugin's own engine/UI writes into the record body itself** (per-slot decision provenance is
  finer-grained than the record's own top-level `updated_by`), so still call `studio.me()`
  explicitly when constructing a decision object, e.g. `by: (await studio.me()).displayName`.
- **Current time conventions**: `studio.fmt.datetime(d)` → Asia/Taipei `"YYYY-MM-DD HH:mm"`,
  `studio.fmt.date(d)` → `"YYYY-MM-DD"`, `studio.fmt.rocDate(d)` → ROC-era date (`helpers.md:48-51`,
  the "Formatting" section) — use these for user-facing display. For the decision's own `at` field
  (spec §5.2), a plain `new Date().toISOString()` is the safer machine-readable choice (matches the
  canonical ISO 8601 form Studio's own `records` timestamps use internally, `data.md:671-673`);
  reserve `studio.fmt.*` for what's shown on screen.

---

## 9. Install flow for a NEW plugin id (`specbook`, not an upgrade)

Full detail: `box.md` §2.1 (`plugin.mjs`) and §2.5 (`studio-developer.mjs`, the wrapper this repo's
own `deploy.sh` already uses for `ackb`).

- **`studio-developer.mjs new <id> [--template <name>]`** scaffolds
  `runtime/blocks/<id>.upload/` from a starter template (default `form-app`), rewrites its
  `plugin.json` id to match, writes an `AGENTS.md`, and mints a read-only MCP board token
  (`box.md` §2.5 table, `new` row). **For `specbook` this step can be skipped** if the plugin's own
  files are authored directly (the way `studio5-ackb`'s `deploy.sh` does — it never called `new`;
  it just `scp`s `plugin.json`+`index.html` straight into `runtime/blocks/<id>.upload/` after an
  `rm -rf && mkdir -p`, per `/Volumes/AI-Model/ACKB/plugins/studio5-ackb/deploy.sh:9-14`) — the
  upload-dir convention is what matters, not the scaffolding step.
- **Upload directory convention**: `runtime/blocks/<id>.upload/` (renamed from `<id>.staging` on
  2026-09-25, `CHANGELOG.md` "Developer account: `.upload` dir + wrapper ops") — the `developer` OS
  account populates this directory (via `scp`/`rsync`/direct file write), then runs the wrapper
  commands against it. It is NOT the live path — `runtime/blocks/<id>/` only becomes live after
  `install`/`upgrade` succeeds (`plugin-onboarding.md` §5 "Release notes": "`runtime/blocks/<id>/`
  is the only served (live) directory").
- **`studio-developer.mjs install <id> [--strict]`** — for a **brand-new** id (this is the `specbook`
  case, vs. `ackb`'s `upgrade`): runs `plugin.mjs install` under a locked-down `sudo -u
  <service-user>` wrapper (`box.md` §2.5 `install` row); lints first (layout + `--strict` gates
  S1-S5/ST1 too), then goes live atomically; a lint **error** aborts with nothing changed, exit code
  2 (`box.md` §2.1 `install` row). `.board.token`/stray dotfiles are stripped from the upload dir
  first so no MCP credential leaks into the installed plugin (`box.md` §2.5 `install` row).
- **`studio-developer.mjs check <id>`** — read-only headless-Chromium acceptance check of the
  **upload dir** (not yet installed): boots under `plugin-dev.mjs` with mock data, loads at
  320/375/1024px, reports console errors, failed network/rejected `studio.*` calls, and any
  horizontal overflow/spillover, plus a `lint --strict` summary; never installs anything; exit
  code non-zero on any problem (`box.md` §2.1 `check` row, §2.5 `check` row). This is exactly spec
  §6.3's "驗收前用 `developer-op.sh check specbook`，檢查 320、375、1024 三種寬度" — matches verbatim.
- Deploy order for `specbook` (new id): `install` (not `upgrade` — `upgrade` would refuse with "not
  installed"/fail since there is no existing `specbook` id), i.e. this repo's `deploy.sh` pattern
  should read `$OP install specbook --strict` for the very first deploy and switch to `$OP upgrade
  specbook --strict` (with a bumped `version`) on every subsequent one.

---

## Summary (10 lines)

1. `plugin.json` 只要 `id`/`title`/`kind:"app"`/`version`；records collection 不用宣告，第一次呼叫 `records.*` 時就自動存在，只有要限制寫入角色才加 `permissions` 區塊。
2. 專案（案場）由 Studio 殼層自己提供選擇器，plugin 只需讀 `studio.project()`/`studio.onProjectChange`，沒選專案時要停用儲存動作。
3. `records.put(collection, key, {...})` 可以指定自己的 key（一章一筆用章碼當 key），`getByKey` 讀回；`update`/`put` 用 `version` 做樂觀鎖，衝突丟 `Error("VERSION_CONFLICT")` 並附 `err.current`。
4. `records.publish`/`reopen` 就是「定稿」功能，完全不用自己做審核流程；body 上限 1 MiB。
5. `studio.xlsx.read(file)` 回傳 exceljs 的原始 `.value`，不做任何轉型——編碼欄要保留前導 0，來源檔案本身就要用文字格式存，否則資料在存進 xlsx 時就已經遺失，Studio 無法補救。
6. `studio.docx.fromTemplate` 可以直接吃 `fetch()` 抓回來的靜態範本檔（放在 plugin 目錄下即可，不必先進 `blob`），支援巢狀 `{#chapters}{#paragraphs}` 迴圈（推測為核心功能，建議寫一個煙霧測試驗證）。
7. **目錄（TOC）沒有任何官方支援**：docxtemplater 純粹是文字/迴圈替換，沒有排版引擎，無法算頁碼；建議直接用純文字清單（章碼＋標題，無頁碼），不要指望 Word 欄位自動更新頁碼這件事在下載當下就正確。
8. 草稿浮水印可以用範本頁首放一個 `{draftLabel}` tag，`draft:false` 時傳空字串，不需要用到 docxtemplater 的付費條件模組。
9. 靜態檔案（`data/specbook-pack.json`、`engine/*.js`）可以直接放 plugin 目錄任何子目錄，`.js`/`.mjs` 會用正確的 `text/javascript` MIME type 送出，ES module `import` 沒問題。
10. `specbook` 是全新 id，第一次部署要用 `studio-developer.mjs install specbook --strict`（不是 `upgrade`），驗收前用 `check specbook` 檢查 320/375/1024 三種寬度，跟 ACKB 的流程一致。

## Blockers / gaps for spec §6

1. **No table-of-contents mechanism in Studio's docx pipeline.** `studio.docx.fromTemplate`
   (docxtemplater free core) has no pagination or page-number computation, and Studio has no
   server-side docx-rendering fallback (`studio.pdf()` is HTML→PDF only, not docx). If spec §5.4's
   "目錄" is meant to show real page numbers, that is **not achievable** without relying on Word's
   own field-update behavior at open time (non-deterministic across Word/LibreOffice versions) —
   recommend the plan explicitly scope "目錄" to content-only (chapter code + title list), no page
   numbers, and confirm this reading with the user before implementation.
2. **Nested docxtemplater loops (chapter → paragraph) are asserted core behavior but not confirmed
   by an existing Studio-authored test** — low risk (it's bundled core, not a paid module) but
   should be the plan's first smoke test before building the real template.
3. **Leading-zero loss in "編碼(備註)" is a source-file problem, not something `studio.xlsx` can
   fix** — if a real 標單 stores that column as a number, the zeros are gone before Studio ever
   sees the file. The plan needs a user-facing warning path for this case (spec §6.4 already
   anticipates the risk but frames it as a plugin-side "read as text" fix, which only works when
   the source file cooperates).
