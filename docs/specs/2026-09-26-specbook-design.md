# specbook 第一期設計

狀態：設計已確認（2026-09-26），待寫實作計畫
依據：`ACKB/docs/research/PCC_SPEC_EDITING_RECON.md`、`ACKB/docs/research/PCC_SPEC_DATA_SURVEY.md`

## 1. 目標

讓使用者在 Studio5 上完成一份工程的施工規範書，流程是：從 PCCES 預算書帶出章節、逐格處理方括號、
檢查，然後下載 DOCX。

驗收用的真實樣本是 Quotation 的營區案預算書
（`Quotation/artifacts/pcces-real-camp-uat-20260813/pcces-camp-project-test-r1.xlsx`）：
預算詳細表「編碼(備註)」欄有 32 個工項碼（部分帶 `,#,*` 註記，取逗號前的碼），收斂成 16 章，其中 14 章在規範中找得到，`01560`、`02991` 只有編碼表、沒有規範本文。

## 2. 範圍

| 做 | 不做（第一期） |
|---|---|
| ACKB 產出章節資料包 | 接進 Quotation |
| specbook 引擎（純 JS） | 儲存成機關或工程類別範本、跨案重用 |
| Studio plugin `specbook` | 改版時逐條比對新舊條文 |
| 方括號填寫、括號不成對整句改寫 | 修改方括號以外的條文（見 §6.4） |
| 草稿／正式 DOCX | 工項細目碼編訂表的內容（只用到章碼和章名索引） |

## 3. 組成與交接

```
ACKB  ackb-specbook-pack  ──(specbook-pack-<YYYYMMDD>.json)──►  specbook/plugin/data/
                                                                   │
specbook/engine/*.js  ◄── import ── specbook/plugin/app/index.html ┘
```

- 三者之間唯一的交接點是資料包檔案。引擎不讀檔、不碰 DOM、不呼叫 Studio SDK，全部是純函式。
- 資料包的來源是工程會的規範檔，授權為政府資料開放授權 v1，所以可以隨 plugin 一起散布。
- 資料包約 20–40 MB，不 commit 進 git（加入 `.gitignore`），部署時才複製進 plugin 目錄。

## 4. 章節資料包（ACKB：`ackb-specbook-pack`）

### 4.1 輸入

ACKB 已收集的工程會附件：規範本文 `17.zip`（314 章）、各篇作業總表、工項細目碼編訂表（只取章碼和章名）。

### 4.2 格式

```json
{
  "pack_version": "20260926",
  "built_at": "2026-09-26T00:00:00Z",
  "chapters": {
    "07505": {
      "name": "屋頂防水層",
      "version": "V3.0",
      "announced": "2011/12/30",
      "version_note": null,
      "unmaintained": false,
      "paragraphs": [
        {"number": "1.5.2", "text": ["自竣工驗收日起算，", {"slot": 12}, "年內，承包商須無償負責修護…"]}
      ],
      "slots": {"12": {"kind": "default_blank", "options": ["5"], "raw": "[5][　　]"}},
      "related": ["01330", "01450"],
      "mentions": ["02319"]
    }
  },
  "code_index": {"07121": "橡化瀝青防水膜"},
  "deleted": {"10213": "鋁質百葉窗"}
}
```

### 4.3 規則

- **來源格式**：有 odt 就用 odt（保留結構）。只有 doc 的章，用 textutil 轉出的文字並去掉頁尾（格式為「版次＋公告日」那一行）。docx 自動編號變成「•」的 3 章，`version_note` 要記下「編號遺失」。
- **版次**：依序採用內文表頭 `第07505章V3.0`、doc 頁尾、檔名，第一個有值的就用。檔名 `v10` 有歧義，改用作業總表判斷。這幾個來源互相不一致時，把不一致的內容寫進 `version_note`，不自動挑一個。
- **公告日**：日期必須屬於採用的那個版次。doc 頁尾的版次與採用版次相同時用頁尾日期；否則，若作業總表的版次和本文相同，就用作業總表的日期；兩者都沒有就填 `null`。
- **方括號（slot）**：同一行連續的 `[..]` 算一組；兩個 `[..]` 之間只隔著空白（全形或半形空格）也算連續，例如 `[45cm] [　　]`。內容只有全形或半形空白的選項，算「空白」。

| kind | 判斷 | 例 |
|---|---|---|
| `default_blank` | 1 個非空白選項＋空白 | `[5][　　]` |
| `blank` | 只有空白 | `[　　]` |
| `optional` | 1 個非空白選項，沒有空白 | `[監測位置：…]` |
| `choice_blank` | 2 個以上非空白選項＋空白 | `[固定式][插入式][　　]` |
| `choice` | 2 個以上非空白選項，沒有空白 | `[一式][實作數量][契約數量]` |
| `malformed` | 括號不成對或巢狀 | `[自正式驗收合格日起保固1年[　　][　　]。` |

- `malformed` 的組要保留 `raw`，而且整段 paragraph 的 `text` 就是原文。
- **slot 編號**：章內從 1 開始流水編號。編號只在同一版次內穩定，所以每個決定都要記下版次（§5.3）。
- **related**：取「1.3 相關章節」清單裡的 `第\d{5}章`。**mentions**：取本文其他位置的引用。兩者都排除本章自己。
- **自我檢查**：用 07505 建一個固定的測試案例，檢查三件事：
  - 1.5.2 的 slot 是 `default_blank` 且選項是 `["5"]`；
  - 2.1.1 的 `[CNS 10410][　　]` 被正確解析；
  - 全部 314 章的 slot 總數和盤點結果（14,625）相差不超過 1%。

## 5. 引擎（`specbook/engine/`，純 JS ES module，零依賴）

### 5.1 `selectChapters(itemCodes, pack)`

- 章碼就是工項碼的前 5 碼。
- 回傳：
  - `chapters`：`{code, items}`，規範中找得到的章。
  - `unmatched`：`{code, items, reason}`，reason 是下列其中一種：
    - `no_spec`：規範和編碼表都沒有；
    - `code_table_only`：只有編碼表；
    - `deleted`：已刪除。
  - `temporary`：Z 開頭的工項碼。
  - `unrecognized`：不是 Z 開頭、但前 5 碼不是數字。
  - `suggested`：`{code, referencedBy}`，已選章節的 `related` 中還沒被選的章。

### 5.2 決定（decision）的格式

```json
{"slot": 12, "chapter_version": "V3.0", "choice": {"option": 0}, "at": "…", "by": "…"}
```

`choice` 有以下幾種：

| choice | 意義 | 適用 kind |
|---|---|---|
| `{"option": n}` | 選第 n 個選項 | `default_blank`、`optional`、`choice*` |
| `{"text": "…"}` | 自己填寫 | 有空白的 kind |
| `{"omit": true}` | 刪除這一句 | 只有 `optional` |
| `{"rewrite": "…"}` | 整段改寫 | 只有 `malformed` |
| `{"option": 0, "via": "chapter_defaults"}` | 用「本章全部採用預設」按鈕帶入 | `default_blank`、`optional` |

- 「本章全部採用預設」只處理 `default_blank`（採用預設值）和 `optional`（保留這一句）。`blank`、`choice`、`choice_blank`、`malformed` 仍然要一格一格處理。

### 5.3 `applyDecisions(pack, chapterCodes, decisionsByChapter)` 與 `lint(...)`

- `applyDecisions` 會把每一格換成決定好的文字，還沒決定的格保留原本的 `raw`。
- `lint` 回傳 `{chapter, slot?, rule, blocking}` 的清單：

| rule | blocking | 條件 |
|---|---|---|
| `unresolved` | 是 | slot 沒有決定 |
| `stale` | 是 | 決定的 `chapter_version` 和資料包目前的版次不同 |
| `invalid_choice` | 是 | choice 不適用於這一格的 kind（例如 `choice` 卻填 `text`） |
| `chapter_defaults` | 否 | 本章有格子是透過「本章全部採用預設」帶入的，列出來供人查看 |
| `version_note` | 否 | 本章在資料包裡有版次疑義 |

### 5.4 `toDocxModel(pack, chapterCodes, decisionsByChapter, {draft})`

- 輸出交給 `studio.docx` 的資料，內容包括：
  - 目錄；
  - 章標題，格式為「第07505章 屋頂防水層 V3.0（2011/12/30）」；
  - 保留原編號的段落；
  - 每章結尾的〈本章結束〉。
- `draft: true` 時，每一頁的頁首加上「草稿，未完成檢查」。
- 有 blocking 的 lint 問題時，引擎拒絕產出 `draft: false` 的版本。

### 5.5 測試

用 `node --test` 執行，測試資料取自真實資料包的片段（07505 等），以及營區案的 32 個工項碼。每條規則都要有一個「拿掉就會失敗」的案例。

## 6. Studio plugin `specbook`

### 6.1 四步流程

1. **帶入**
   - 用 `<input type=file>` 選 xlsx，由 `studio.xlsx` 在瀏覽器本機解析，找「預算詳細表」工作表的「編碼(備註)」欄。
   - 找不到這張工作表或這個欄位時，直接告訴使用者，不猜測。
   - 使用者也可以手動搜尋章碼或章名來加章。
2. **確認章節**：分組顯示 `chapters`、`unmatched`（附原因）、`temporary`、`unrecognized`、`suggested`，用勾選決定要收哪些章。
3. **填寫**
   - 一章一頁，上方顯示「已填 n/m」。
   - 每一格都顯示所在的整句，並提供選項按鈕、自填欄；`optional` 另有「刪除此句」。
   - 「本章全部採用預設」按鈕的處理範圍依 §5.2。
4. **檢查並產出**
   - 列出 lint 結果。
   - 「下載草稿」隨時可以按。「下載正式版」要等 blocking 問題清零才能按。
   - 下載透過 `studio.download`。

### 6.2 儲存（`studio.records`，project scope）

- 共兩個 collection：
  - `specbook-project`：每個 Studio 專案一筆，記錄輸入的工項碼、勾選的章、`pack_version`。
  - `specbook-chapter`：每一章一筆，記錄這一章所有格子的決定。每章分開存，這樣不同人同時編輯不同章時不會衝突；寫入時帶 version，衝突的話就重新讀取並提示使用者。
- 「定稿」直接使用 Studio 的 publish／reopen 功能。

### 6.3 部署

- 流程和 `studio5-ackb` 一樣：上傳到 developer 帳號，執行 `developer-op.sh lint --strict`，再 `upgrade`。
- 驗收前用 `developer-op.sh check specbook`，檢查 320、375、1024 三種寬度。
- `.wasm` 用不到。

### 6.4 已知限制

- `NOTE(ceiling)`：第一期只處理方括號，以及括號不成對時的整段改寫。方括號以外的條文要增刪，只能下載 DOCX 後再自己改。
  - 升級方向：讓 paragraph 也能有 `rewrite` 決定，並列入 lint 的 `chapter_defaults` 類清單。
- `NOTE(ceiling)`：`optional` 的「刪除此句」實作為刪除那一格。真實資料有 919 段是選填格嵌在句子中、150 段是「、」「及」串起來的清單，刪除後可能留下 `、、`、`及之` 這類多餘標點，目前 lint 不會提醒。
  - 升級方向：lint 加一條不阻擋的規則，偵測刪除後的連續標點或以標點開頭的段落。
- 「本章全部採用預設」不覆蓋已有的決定，包括舊版次（stale）或不合法的決定；這些格仍由 lint 擋下，要逐格重選。
- plugin 必須先把 `pack.chapters` 沒有的章碼濾掉再呼叫引擎（換新資料包後某章可能消失），並把「編碼(備註)」欄當文字讀，避免 xlsx 數字格掉前導 0。
- 資料包中約 1/3 段落的 `number` 為 `null`（部分編號仍留在內文），DOCX 產出必須能處理沒有編號的段落。

## 7. 驗收（在 m2 上看得到）

1. 在 Studio 開 `specbook`，上傳營區案 xlsx，看到 14 章可收錄，`01560`、`02991` 列在 `unmatched`，原因為「只有編碼表」。
2. 勾選建議的 `01330`、`01450`，打開一章逐格填寫，重新整理頁面後，已填的決定還在。
3. 還有未填的格子時，「下載正式版」按不下去；下載草稿可以用 Word 或 LibreOffice 開啟，每一頁都看得到浮水印。
4. 填完一章後，只收這一章，下載正式版，目錄、章標題、版次和〈本章結束〉都正確。

## 8. 子專案順序

1. ACKB `ackb-specbook-pack`，驗收方式是 §4.3 的自我檢查。
2. `specbook/engine`，驗收方式是 §5.5 的測試。
3. `specbook/plugin`，驗收方式是 §7。
