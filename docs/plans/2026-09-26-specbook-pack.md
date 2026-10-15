# specbook 子專案 1：章節資料包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ackb-specbook-pack` to ACKB: it turns the already-normalized PCC spec attachments into `specbook-pack-<YYYYMMDD>.json` (spec §4) and self-checks the result.

**Architecture:** One new module `src/ackb/specbook_pack.py` in the ACKB repo (`/Volumes/AI-Model/ACKB`). It reads only files that already exist: `data/current/pcc-json-code-descriptions-{3,4,5}.json` (catalogs: which PCC file id is `17.zip`, the code tables, the 作業總表) and `data/normalized/pcc-file-<id>-*.json` (text blocks produced by `ackb-convert-pcc`). No network, no textutil calls. Pure parsing functions are unit-tested on synthetic blocks; the CLI runs a self-check against the real data.

**Tech Stack:** Python 3.13 standard library only, `unittest` (repo convention: `.venv/bin/python -m unittest discover -s tests`).

## Global Constraints

- Spec: `/Volumes/AI-Model/specbook/docs/specs/2026-09-26-specbook-design.md` §4 is the contract. Pack keys and slot kinds must match it exactly: `pack_version`, `built_at`, `chapters`, `code_index`, `deleted`; chapter keys `name`, `version`, `announced`, `version_note`, `unmaintained`, `paragraphs`, `slots`, `related`, `mentions`; kinds `default_blank`, `blank`, `optional`, `choice_blank`, `choice`, `malformed`.
- Code, comments and strings in English; user-visible `version_note` text in Traditional Chinese.
- No new dependencies. Surgical changes: only `pyproject.toml` (one script line) is modified outside the new files.
- Output goes to `knowledge/specbook/` (already gitignored via `knowledge/`). Do not commit pack files.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Data facts the code relies on (verified 2026-09-26 on local data)

- `17.zip` is PCC file id `2373498`; its normalized blocks have `locator.member` like `07505v30.odt`, `16510v90.doc`. 314 chapter codes; formats per chapter: doc+odt 230, doc only 58, docx+odt 15, docx only 9, doc+docx+odt 1, odt only 1.
- A block's `text` is one paragraph: `"1.5.2\t保證：…[5][　　]年內…"`. Block 1 is `第07505章V3.0`, block 2 is the chapter name, the chapter ends with `〈本章結束〉`.
- `.doc` members contain page footers anywhere in the text: a block `PAGE` and a block like `07505\t07505- PAGE 1\tV3.0 2011/12/30`.
- 作業總表 (catalog 5, odt files whose name contains `作業總表`) has one table cell per block: `07505`, `屋頂防水層`, `O`, `V3.0 2011/12/30`, `O`, `V7.0 2019/07/26`. The first version cell is the spec, the second the code table; rows with a single version cell are ambiguous. Deleted chapters contain `已刪除`; unmaintained names start with `※`; some dates are ROC years (`112/10/04`).
- Code tables (catalog 4, zips named `CodeNN-table.zip`) have members like `Code07-table/07505_codev70.xls`; the first row that has the code as a tab-separated cell has the chapter name in the next cell.

## File Structure

- Create `src/ackb/specbook_pack.py` — parsing (slots, paragraphs, summary table, versions), chapter assembly, pack assembly, self-check, CLI `main()`.
- Create `tests/test_specbook_pack.py` — unit tests on synthetic blocks.
- Modify `pyproject.toml` — add `ackb-specbook-pack = "ackb.specbook_pack:main"` under `[project.scripts]`.

---

### Task 1: Slot and paragraph parsing

**Files:**
- Create: `src/ackb/specbook_pack.py`
- Test: `tests/test_specbook_pack.py`

**Interfaces:**
- Produces: `split_slots(text: str) -> list[str | list[str]] | None`, `slot_kind(options: list[str]) -> str`, `filled_options(options: list[str]) -> list[str]`, `split_number(text: str) -> tuple[str | None, str]`.

- [ ] **Step 1: Write the failing tests**

```python
from __future__ import annotations

import unittest

from ackb.specbook_pack import filled_options, slot_kind, split_number, split_slots

B = "[　　]"


class SlotParsingTests(unittest.TestCase):
    def test_adjacent_brackets_form_one_group(self) -> None:
        self.assertEqual(split_slots(f"起算，[5]{B}年內"), ["起算，", ["5", "　　"], "年內"])

    def test_text_between_brackets_starts_a_new_group(self) -> None:
        text = "依契約以[一式][實作數量]計價，[備品數量予以計價]。"
        self.assertEqual(split_slots(text), ["依契約以", ["一式", "實作數量"], "計價，", ["備品數量予以計價"], "。"])

    def test_unbalanced_or_nested_brackets_are_malformed(self) -> None:
        self.assertIsNone(split_slots(f"[自正式驗收合格日起保固1年{B}{B}。"))
        self.assertIsNone(split_slots("保固]1年"))
        self.assertIsNone(split_slots("[a[b]]"))

    def test_text_without_brackets_is_one_string(self) -> None:
        self.assertEqual(split_slots("本章說明。"), ["本章說明。"])

    def test_slot_kinds(self) -> None:
        blank = "　　"
        self.assertEqual(slot_kind(["5", blank]), "default_blank")
        self.assertEqual(slot_kind([blank]), "blank")
        self.assertEqual(slot_kind(["  "]), "blank")
        self.assertEqual(slot_kind(["監測位置"]), "optional")
        self.assertEqual(slot_kind(["固定式", "插入式", blank]), "choice_blank")
        self.assertEqual(slot_kind(["一式", "實作數量", "契約數量"]), "choice")

    def test_filled_options_drop_blanks(self) -> None:
        self.assertEqual(filled_options(["CNS 10410", "　　"]), ["CNS 10410"])

    def test_split_number(self) -> None:
        self.assertEqual(split_number("1.5.2\t保證"), ("1.5.2", "保證"))
        self.assertEqual(split_number("1.\t通則"), ("1.", "通則"))
        self.assertEqual(split_number("(2)\t瀝青"), ("(2)", "瀝青"))
        self.assertEqual(split_number("A.\t承載"), ("A.", "承載"))
        self.assertEqual(split_number("本章說明。"), (None, "本章說明。"))
        self.assertEqual(split_number("CNS 6986\t建築防水"), (None, "CNS 6986\t建築防水"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/AI-Model/ACKB && .venv/bin/python -m unittest tests.test_specbook_pack -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'ackb.specbook_pack'`

- [ ] **Step 3: Write minimal implementation**

```python
"""Build the specbook chapter pack from PCC spec attachments already normalized by ackb-convert-pcc.

Spec: /Volumes/AI-Model/specbook/docs/specs/2026-09-26-specbook-design.md section 4.
"""
from __future__ import annotations

import re

BLANK_CHARS = " 　\t"
NUMBER_RE = re.compile(r"^(?:\d+(?:\.\d+)*\.?|\(\d+\)|（\d+）|[A-Za-z]\.)$")


def split_slots(text: str) -> list[str | list[str]] | None:
    """Split text into plain strings and slot groups (adjacent [..] options); None when brackets are unbalanced or nested."""
    parts: list[str | list[str]] = []
    buf = ""
    i = 0
    while i < len(text):
        char = text[i]
        if char == "]":
            return None
        if char != "[":
            buf += char
            i += 1
            continue
        end = text.find("]", i + 1)
        if end == -1 or "[" in text[i + 1:end]:
            return None
        option = text[i + 1:end]
        if not buf and parts and isinstance(parts[-1], list):
            parts[-1].append(option)
        else:
            if buf:
                parts.append(buf)
                buf = ""
            parts.append([option])
        i = end + 1
    if buf:
        parts.append(buf)
    return parts


def filled_options(options: list[str]) -> list[str]:
    return [option for option in options if option.strip(BLANK_CHARS)]


def slot_kind(options: list[str]) -> str:
    filled = filled_options(options)
    has_blank = len(filled) < len(options)
    if not filled:
        return "blank"
    if len(filled) == 1:
        return "default_blank" if has_blank else "optional"
    return "choice_blank" if has_blank else "choice"


def split_number(text: str) -> tuple[str | None, str]:
    head, sep, rest = text.partition("\t")
    if sep and NUMBER_RE.match(head):
        return head, rest
    return None, text
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Volumes/AI-Model/ACKB && .venv/bin/python -m unittest tests.test_specbook_pack -v`
Expected: 7 tests OK

- [ ] **Step 5: Commit**

```bash
cd /Volumes/AI-Model/ACKB
git add src/ackb/specbook_pack.py tests/test_specbook_pack.py
git commit -m "feat(specbook_pack): parse spec bracket slots and paragraph numbers

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 作業總表 parsing and version resolution

**Files:**
- Modify: `src/ackb/specbook_pack.py`
- Test: `tests/test_specbook_pack.py`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `parse_summary(cells: list[str]) -> dict[str, dict]` — per code `{"name": str, "spec": tuple[str, str] | None, "ambiguous": bool, "deleted": bool, "unmaintained": bool}`; `spec` is `(version, "YYYY/MM/DD")` with version like `"3.0"`.
  - `filename_version(digits: str, summary_version: str | None) -> str | None`
  - `resolve_version(header: str | None, footer: tuple[str, str] | None, filename: str | None, summary: dict | None) -> tuple[str | None, str | None, str | None]` returning `(version "V3.0", announced "YYYY/MM/DD", version_note)`.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_specbook_pack.py`, and extend the import line to `from ackb.specbook_pack import filename_version, filled_options, parse_summary, resolve_version, slot_kind, split_number, split_slots`)

```python
class SummaryAndVersionTests(unittest.TestCase):
    CELLS = [
        "章碼", "章名", "07410", "金屬屋面", "O", "V3.0 2007/10/01",
        "07505", "屋頂防水層", "O", "V3.0 2011/12/30", "O", "V7.0 2019/07/26",
        "01556", "※臨時設施", "O", "V2.0 112/10/04", "O", "V4.0 112/10/04",
        "10213", "鋁質百葉窗", "本章已刪除",
    ]

    def test_parse_summary_rows(self) -> None:
        rows = parse_summary(self.CELLS)
        self.assertEqual(rows["07505"], {"name": "屋頂防水層", "spec": ("3.0", "2011/12/30"),
                                         "ambiguous": False, "deleted": False, "unmaintained": False})
        self.assertTrue(rows["07410"]["ambiguous"])
        self.assertIsNone(rows["07410"]["spec"])
        self.assertEqual(rows["01556"]["spec"], ("2.0", "2023/10/04"))
        self.assertTrue(rows["01556"]["unmaintained"])
        self.assertEqual(rows["01556"]["name"], "臨時設施")
        self.assertTrue(rows["10213"]["deleted"])

    def test_filename_version(self) -> None:
        self.assertEqual(filename_version("30", None), "3.0")
        self.assertEqual(filename_version("140", None), "14.0")
        self.assertEqual(filename_version("4", None), "4.0")
        self.assertEqual(filename_version("61", None), "6.1")
        self.assertEqual(filename_version("10", "10.0"), "10.0")
        self.assertEqual(filename_version("10", "1.0"), "1.0")
        self.assertIsNone(filename_version("10", None))

    def test_header_wins_and_agreeing_sources_leave_no_note(self) -> None:
        summary = {"spec": ("3.0", "2011/12/30")}
        self.assertEqual(resolve_version("3.0", ("3.0", "2011/12/30"), "3.0", summary), ("V3.0", "2011/12/30", None))

    def test_announced_falls_back_to_summary_only_when_versions_match(self) -> None:
        self.assertEqual(resolve_version("3.0", None, "3.0", {"spec": ("3.0", "2011/12/30")}), ("V3.0", "2011/12/30", None))
        version, announced, note = resolve_version("8.0", None, "8.0", {"spec": ("7.0", "2020/01/01")})
        self.assertEqual((version, announced), ("V8.0", None))
        self.assertEqual(note, "版次來源不一致：內文表頭 V8.0、檔名 V8.0、作業總表 V7.0")

    def test_footer_then_filename_when_header_missing(self) -> None:
        self.assertEqual(resolve_version(None, ("9.0", "2026/04/14"), "9.0", None), ("V9.0", "2026/04/14", None))
        self.assertEqual(resolve_version(None, None, "9.0", None), ("V9.0", None, None))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/AI-Model/ACKB && .venv/bin/python -m unittest tests.test_specbook_pack -v`
Expected: FAIL with `ImportError: cannot import name 'filename_version'`

- [ ] **Step 3: Write minimal implementation** (append to `src/ackb/specbook_pack.py`)

```python
CODE_RE = re.compile(r"^\d{5}$")
VERSION_CELL_RE = re.compile(r"^V(\d+(?:\.\d+)?)\s+(\d{2,4})/(\d{1,2})/(\d{1,2})$")
SOURCE_LABELS = (("header", "內文表頭"), ("footer", "頁尾"), ("filename", "檔名"), ("summary", "作業總表"))


def _normalize_version(version: str) -> str:
    return version if "." in version else f"{version}.0"


def _normalize_date(year: str, month: str, day: str) -> str:
    number = int(year)
    if number < 1911:  # ROC calendar year
        number += 1911
    return f"{number:04d}/{int(month):02d}/{int(day):02d}"


def parse_summary(cells: list[str]) -> dict[str, dict]:
    """Rows of the 作業總表 table flattened into one cell per item: code, name, then O/version cells."""
    rows: dict[str, dict] = {}
    code = None
    for index, cell in enumerate(cells):
        text = cell.strip()
        if CODE_RE.match(text) and index + 1 < len(cells):
            name = cells[index + 1].strip()
            code = text
            rows[code] = {"name": name.lstrip("※").strip(), "versions": [], "deleted": False,
                          "unmaintained": name.startswith("※")}
            continue
        if code is None:
            continue
        match = VERSION_CELL_RE.match(text)
        if match:
            rows[code]["versions"].append((_normalize_version(match.group(1)), _normalize_date(*match.group(2, 3, 4))))
        elif "已刪除" in text:
            rows[code]["deleted"] = True
    result = {}
    for code, row in rows.items():
        versions = row.pop("versions")
        # Two version cells: spec then code table. One cell: the flattened table no longer says which column it was.
        result[code] = {**row, "spec": versions[0] if len(versions) == 2 else None, "ambiguous": len(versions) == 1}
    return result


def filename_version(digits: str, summary_version: str | None) -> str | None:
    """File names encode versions without the dot (v30 = 3.0, v140 = 14.0, v4 = 4.0); v10 is 1.0 or 10.0."""
    if digits == "10":
        return summary_version if summary_version in ("1.0", "10.0") else None
    if len(digits) == 1:
        return f"{digits}.0"
    return f"{digits[:-1]}.{digits[-1]}"


def resolve_version(
    header: str | None,
    footer: tuple[str, str] | None,
    filename: str | None,
    summary: dict | None,
) -> tuple[str | None, str | None, str | None]:
    summary_spec = summary.get("spec") if summary else None
    sources = {
        "header": header and _normalize_version(header),
        "footer": footer and _normalize_version(footer[0]),
        "filename": filename,
        "summary": summary_spec and summary_spec[0],
    }
    version = sources["header"] or sources["footer"] or sources["filename"]
    if version is None:
        return None, None, "無法判斷版次"
    if footer and sources["footer"] == version:
        announced = footer[1]
    elif summary_spec and summary_spec[0] == version:
        announced = summary_spec[1]
    else:
        announced = None
    present = [(label, sources[key]) for key, label in SOURCE_LABELS if sources[key]]
    note = None
    if len({value for _, value in present}) > 1:
        note = "版次來源不一致：" + "、".join(f"{label} V{value}" for label, value in present)
    return f"V{version}", announced, note
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Volumes/AI-Model/ACKB && .venv/bin/python -m unittest tests.test_specbook_pack -v`
Expected: 12 tests OK

- [ ] **Step 5: Commit**

```bash
cd /Volumes/AI-Model/ACKB
git add src/ackb/specbook_pack.py tests/test_specbook_pack.py
git commit -m "feat(specbook_pack): parse the PCC summary table and resolve chapter versions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Chapter assembly

**Files:**
- Modify: `src/ackb/specbook_pack.py`
- Test: `tests/test_specbook_pack.py`

**Interfaces:**
- Consumes: `split_slots`, `slot_kind`, `filled_options`, `split_number` (Task 1); `resolve_version`, `filename_version` (Task 2).
- Produces: `build_chapter(code: str, member: str, texts: list[str], footer_texts: list[str], summary: dict | None) -> dict` returning the chapter object of spec §4.2 (keys `name`, `version`, `announced`, `version_note`, `unmaintained`, `paragraphs`, `slots`, `related`, `mentions`). `member` is the zip member name (e.g. `07505v30.odt`), `texts` its block texts in order, `footer_texts` the block texts of the chapter's `.doc` member (empty list when there is none).

- [ ] **Step 1: Write the failing tests** (append; add `build_chapter` to the import line)

```python
class BuildChapterTests(unittest.TestCase):
    TEXTS = [
        "第07505章V3.0", "屋頂防水層",
        "1.\t通則",
        "1.3\t相關章節",
        "1.3.1\t第01330章--資料送審",
        "1.3.2\t第01450章--品質管理",
        "PAGE",
        "07505\t07505- PAGE 1\tV3.0 2011/12/30",
        f"1.5.2\t保證：自竣工驗收日起算，[5]{B}年內，承包商須無償負責修護。",
        "2.1.1\t油毛氈：須符合[CNS 10410][　　]之規定，並依第02319章及第07505章辦理。",
        f"(1)\t[自正式驗收合格日起保固1年{B}{B}。",
        "〈本章結束〉",
    ]

    def build(self, **overrides):
        args = {"code": "07505", "member": "07505v30.doc", "texts": self.TEXTS,
                "footer_texts": self.TEXTS, "summary": {"spec": ("3.0", "2011/12/30"), "unmaintained": False}}
        args.update(overrides)
        return build_chapter(**args)

    def test_header_name_version_and_date(self) -> None:
        chapter = self.build()
        self.assertEqual((chapter["name"], chapter["version"], chapter["announced"], chapter["version_note"]),
                         ("屋頂防水層", "V3.0", "2011/12/30", None))
        self.assertFalse(chapter["unmaintained"])

    def test_footer_page_lines_and_end_mark_are_dropped(self) -> None:
        texts = [str(part) for p in self.build()["paragraphs"] for part in p["text"]]
        self.assertFalse(any("PAGE" in t or "〈本章結束〉" in t for t in texts))

    def test_slots_are_numbered_across_the_chapter(self) -> None:
        chapter = self.build()
        para = next(p for p in chapter["paragraphs"] if p["number"] == "1.5.2")
        self.assertEqual(para["text"], ["保證：自竣工驗收日起算，", {"slot": 1}, "年內，承包商須無償負責修護。"])
        self.assertEqual(chapter["slots"]["1"], {"kind": "default_blank", "options": ["5"], "raw": f"[5]{B}"})
        self.assertEqual(chapter["slots"]["2"], {"kind": "default_blank", "options": ["CNS 10410"],
                                                 "raw": "[CNS 10410][　　]"})

    def test_malformed_paragraph_keeps_its_original_text(self) -> None:
        chapter = self.build()
        para = next(p for p in chapter["paragraphs"] if p["number"] == "(1)")
        self.assertEqual(para["text"], [{"slot": 3}])
        self.assertEqual(chapter["slots"]["3"], {"kind": "malformed", "options": [],
                                                 "raw": f"[自正式驗收合格日起保固1年{B}{B}。"})

    def test_related_and_mentions_exclude_self(self) -> None:
        chapter = self.build()
        self.assertEqual(chapter["related"], ["01330", "01450"])
        self.assertEqual(chapter["mentions"], ["02319"])

    def test_bullet_numbering_is_noted(self) -> None:
        texts = ["第02475章V2.0", "名稱", "•\t通則", "〈本章結束〉"]
        chapter = self.build(code="02475", member="02475v20.docx", texts=texts, footer_texts=[], summary=None)
        self.assertEqual(chapter["version_note"], "自動編號遺失，章節編號需人工核對")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/AI-Model/ACKB && .venv/bin/python -m unittest tests.test_specbook_pack -v`
Expected: FAIL with `ImportError: cannot import name 'build_chapter'`

- [ ] **Step 3: Write minimal implementation** (append)

```python
HEADER_RE = re.compile(r"^第(\d{5})章\s*V(\d+(?:\.\d+)?)")
FOOTER_RE = re.compile(r"^\d{5}\t\d{5}-\s*PAGE\s*\d*\tV(\d+(?:\.\d+)?)\s+(\d{2,4})/(\d{1,2})/(\d{1,2})\s*$")
MEMBER_RE = re.compile(r"(?:.*/)?(\d{5})v(\d+)\.(odt|doc|docx)$")
CHAPTER_REF_RE = re.compile(r"第(\d{5})章")
END_MARK = "〈本章結束〉"
BULLET_NOTE = "自動編號遺失，章節編號需人工核對"


def _is_noise(text: str) -> bool:
    stripped = text.strip()
    return not stripped or stripped == "PAGE" or stripped == END_MARK or bool(FOOTER_RE.match(stripped))


def _footer(texts: list[str]) -> tuple[str, str] | None:
    for text in texts:
        match = FOOTER_RE.match(text.strip())
        if match:
            return match.group(1), _normalize_date(*match.group(2, 3, 4))
    return None


def build_chapter(code: str, member: str, texts: list[str], footer_texts: list[str], summary: dict | None) -> dict:
    header_match = HEADER_RE.match(texts[0].strip()) if texts else None
    body = texts[2:] if header_match else texts[1:]
    name = texts[1].strip() if header_match else texts[0].strip()
    summary_version = summary["spec"][0] if summary and summary.get("spec") else None
    member_match = MEMBER_RE.match(member)
    filename = filename_version(member_match.group(2), summary_version) if member_match else None
    version, announced, note = resolve_version(
        header_match.group(2) if header_match else None, _footer(footer_texts), filename, summary)

    paragraphs, slots = [], {}
    for text in body:
        if _is_noise(text):
            continue
        number, content = split_number(text)
        parts = split_slots(content)
        if parts is None:
            slots[str(len(slots) + 1)] = {"kind": "malformed", "options": [], "raw": content}
            paragraphs.append({"number": number, "text": [{"slot": len(slots)}]})
            continue
        segments: list = []
        for part in parts:
            if isinstance(part, str):
                segments.append(part)
            else:
                slots[str(len(slots) + 1)] = {"kind": slot_kind(part), "options": filled_options(part),
                                              "raw": "".join(f"[{option}]" for option in part)}
                segments.append({"slot": len(slots)})
        paragraphs.append({"number": number, "text": segments})

    if any(text.startswith("•") for text in body):
        note = f"{note}；{BULLET_NOTE}" if note else BULLET_NOTE

    related, mentions = set(), set()
    for paragraph in paragraphs:
        plain = "".join(part for part in paragraph["text"] if isinstance(part, str))
        refs = set(CHAPTER_REF_RE.findall(plain)) - {code}
        in_related_list = (paragraph["number"] or "").startswith("1.3.")
        (related if in_related_list else mentions).update(refs)

    return {
        "name": name,
        "version": version,
        "announced": announced,
        "version_note": note,
        "unmaintained": bool(summary and summary.get("unmaintained")),
        "paragraphs": paragraphs,
        "slots": slots,
        "related": sorted(related),
        "mentions": sorted(mentions - related),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Volumes/AI-Model/ACKB && .venv/bin/python -m unittest tests.test_specbook_pack -v`
Expected: 18 tests OK

- [ ] **Step 5: Commit**

```bash
cd /Volumes/AI-Model/ACKB
git add src/ackb/specbook_pack.py tests/test_specbook_pack.py
git commit -m "feat(specbook_pack): assemble a chapter with slots, versions and chapter references

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Pack assembly, self-check and CLI on real data

**Files:**
- Modify: `src/ackb/specbook_pack.py`
- Modify: `pyproject.toml` (`[project.scripts]`, add one line after `ackb-ocr-backfill`)
- Test: `tests/test_specbook_pack.py`

**Interfaces:**
- Consumes: `build_chapter`, `parse_summary` and constants from Tasks 1–3.
- Produces:
  - `build_pack(normalized_dir: Path, current_dir: Path, built_at: str) -> dict` — the spec §4.2 pack.
  - `self_check(pack: dict) -> list[str]` — failure messages, empty when the spec §4.3 checks pass.
  - CLI `ackb-specbook-pack [--output PATH] [--normalized-dir DIR] [--current-dir DIR]`, default output `knowledge/specbook/specbook-pack-<YYYYMMDD>.json`; exits 1 when `self_check` fails.

- [ ] **Step 1: Write the failing tests** (append; add `build_pack, self_check` to the import line; add `import json, shutil, tempfile` and `from pathlib import Path` at the top)

```python
class BuildPackTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = Path(tempfile.mkdtemp())
        self.normalized = self.temp / "normalized"
        self.current = self.temp / "current"
        self.normalized.mkdir()
        self.current.mkdir()
        catalogs = {
            3: [{"download": [{"id": 1, "fileType": "zip", "fileNameOri": "17.zip"}]}],
            4: [{"download": [{"id": 2, "fileType": "zip", "fileNameOri": "Code07-table.zip"}]}],
            5: [{"download": [{"id": 3, "fileType": "odt", "fileNameOri": "07篇(隔熱及防潮)作業總表(共10章).odt"},
                              {"id": 4, "fileType": "doc", "fileNameOri": "07篇(隔熱及防潮)作業總表(共10章).doc"}]}],
        }
        for number, items in catalogs.items():
            (self.current / f"pcc-json-code-descriptions-{number}.json").write_text(json.dumps(items), encoding="utf-8")
        chapter = ["第07505章V3.0", "屋頂防水層", f"1.5.2\t保證：[5]{B}年內。", "〈本章結束〉"]
        self._blocks(1, [("07505v30.odt", t) for t in chapter] + [("07505v30.doc", t) for t in chapter]
                     + [("07505v30.doc", "07505\t07505- PAGE 1\tV3.0 2011/12/30")])
        self._blocks(2, [("Code07-table/07121_codev20.xls", "章碼\t章名"),
                         ("Code07-table/07121_codev20.xls", "07121\t橡化瀝青防水膜\t\t大類別")])
        self._blocks(3, [("", c) for c in ["07505", "屋頂防水層", "O", "V3.0 2011/12/30", "O", "V7.0 2019/07/26",
                                             "10213", "鋁質百葉窗", "本章已刪除"]])

    def tearDown(self) -> None:
        shutil.rmtree(self.temp)

    def _blocks(self, file_id: int, items: list[tuple[str, str]]) -> None:
        blocks = [{"text": text, "locator": {"member": member} if member else {}} for member, text in items]
        path = self.normalized / f"pcc-file-{file_id}-20260912T000000Z-aaaaaaaaaaaa.json"
        path.write_text(json.dumps({"blocks": blocks}, ensure_ascii=False), encoding="utf-8")

    def test_pack_prefers_odt_and_reads_date_from_the_doc_footer(self) -> None:
        pack = build_pack(self.normalized, self.current, "2026-09-26T00:00:00Z")
        self.assertEqual(pack["pack_version"], "20260926")
        chapter = pack["chapters"]["07505"]
        self.assertEqual((chapter["version"], chapter["announced"], chapter["version_note"]), ("V3.0", "2011/12/30", None))
        self.assertEqual(chapter["slots"]["1"]["kind"], "default_blank")
        self.assertEqual(pack["code_index"], {"07121": "橡化瀝青防水膜"})
        self.assertEqual(pack["deleted"], {"10213": "鋁質百葉窗"})

    def test_self_check_reports_failures(self) -> None:
        pack = build_pack(self.normalized, self.current, "2026-09-26T00:00:00Z")
        failures = self_check(pack)
        self.assertTrue(any("314" in failure for failure in failures))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/AI-Model/ACKB && .venv/bin/python -m unittest tests.test_specbook_pack -v`
Expected: FAIL with `ImportError: cannot import name 'build_pack'`

- [ ] **Step 3: Write minimal implementation** (append; move the new imports to the top of the module)

```python
import argparse
import json
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

from .collect import DEFAULT_NORMALIZED_DIR, PROJECT_ROOT

DEFAULT_CURRENT_DIR = PROJECT_ROOT / "data" / "current"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "knowledge" / "specbook"
SPEC_ZIP_NAME = "17.zip"
CODE_TABLE_ZIP_RE = re.compile(r"^Code\d{2}-table\.zip$")
CODE_TABLE_MEMBER_RE = re.compile(r"(\d{5})_codev")
FORMAT_ORDER = ("odt", "doc", "docx")
EXPECTED_CHAPTERS = 314
EXPECTED_SLOTS = 14625  # docs/research/PCC_SPEC_DATA_SURVEY.md section 3


def _catalog_files(current_dir: Path, catalog: int) -> list[dict]:
    items = json.loads((current_dir / f"pcc-json-code-descriptions-{catalog}.json").read_text(encoding="utf-8"))
    return [download for item in items for download in item.get("download") or []]


def _blocks(normalized_dir: Path, file_id: int) -> list[dict]:
    paths = sorted(normalized_dir.glob(f"pcc-file-{file_id}-*.json"))
    if not paths:
        raise FileNotFoundError(f"No normalized file for PCC file {file_id}; run ackb-convert-pcc first.")
    return json.loads(paths[-1].read_text(encoding="utf-8"))["blocks"]


def _texts_by_member(blocks: list[dict]) -> dict[str, list[str]]:
    by_member: dict[str, list[str]] = defaultdict(list)
    for block in blocks:
        by_member[block["locator"].get("member", "")].append(block["text"])
    return by_member


def build_pack(normalized_dir: Path, current_dir: Path, built_at: str) -> dict:
    summary: dict[str, dict] = {}
    for download in _catalog_files(current_dir, 5):
        if download.get("fileType") == "odt" and "作業總表" in download.get("fileNameOri", ""):
            summary.update(parse_summary([block["text"] for block in _blocks(normalized_dir, download["id"])]))

    code_index: dict[str, str] = {}
    for download in _catalog_files(current_dir, 4):
        if not CODE_TABLE_ZIP_RE.match(download.get("fileNameOri", "")):
            continue
        for member, texts in _texts_by_member(_blocks(normalized_dir, download["id"])).items():
            match = CODE_TABLE_MEMBER_RE.search(member)
            if not match or match.group(1) in code_index:
                continue
            for text in texts:
                cells = [cell.strip() for cell in text.split("\t")]
                if match.group(1) in cells[:-1]:
                    code_index[match.group(1)] = cells[cells.index(match.group(1)) + 1]
                    break

    spec_zip = next(d for d in _catalog_files(current_dir, 3) if d.get("fileNameOri") == SPEC_ZIP_NAME)
    members: dict[str, dict[str, str]] = defaultdict(dict)
    by_member = _texts_by_member(_blocks(normalized_dir, spec_zip["id"]))
    for member in by_member:
        match = MEMBER_RE.match(member)
        if match:
            members[match.group(1)][match.group(3)] = member

    chapters = {}
    for code in sorted(members):
        formats = members[code]
        chosen = next(formats[fmt] for fmt in FORMAT_ORDER if fmt in formats)
        footer_texts = by_member[formats["doc"]] if "doc" in formats else []
        chapters[code] = build_chapter(code, chosen, by_member[chosen], footer_texts, summary.get(code))

    return {
        "pack_version": built_at[:10].replace("-", ""),
        "built_at": built_at,
        "chapters": chapters,
        "code_index": dict(sorted(code_index.items())),
        "deleted": {code: row["name"] for code, row in sorted(summary.items()) if row["deleted"]},
    }


def self_check(pack: dict) -> list[str]:
    """Spec section 4.3 checks against the real PCC data; returns failure messages."""
    failures = []
    chapters = pack["chapters"]
    if len(chapters) != EXPECTED_CHAPTERS:
        failures.append(f"expected {EXPECTED_CHAPTERS} chapters, got {len(chapters)}")
    chapter = chapters.get("07505")
    expectations = {"1.5.2": ["5"], "2.1.1": ["CNS 10410"]}
    for number, options in expectations.items():
        paragraph = next((p for p in (chapter or {}).get("paragraphs", []) if p["number"] == number), None)
        slot_ids = [part["slot"] for part in (paragraph or {}).get("text", []) if isinstance(part, dict)]
        slot = chapter["slots"][str(slot_ids[0])] if slot_ids else None
        if slot != {**(slot or {}), "kind": "default_blank", "options": options}:
            failures.append(f"07505 {number}: expected default_blank {options}, got {slot}")
    total = sum(len(c["slots"]) for c in chapters.values())
    if abs(total - EXPECTED_SLOTS) > EXPECTED_SLOTS * 0.01:
        failures.append(f"expected about {EXPECTED_SLOTS} slots (±1%), got {total}")
    return failures


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the specbook chapter pack from normalized PCC spec files.")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--normalized-dir", type=Path, default=DEFAULT_NORMALIZED_DIR)
    parser.add_argument("--current-dir", type=Path, default=DEFAULT_CURRENT_DIR)
    args = parser.parse_args()
    built_at = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    pack = build_pack(args.normalized_dir, args.current_dir, built_at)
    output = args.output or DEFAULT_OUTPUT_DIR / f"specbook-pack-{pack['pack_version']}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    slots = [slot["kind"] for chapter in pack["chapters"].values() for slot in chapter["slots"].values()]
    kinds = {kind: slots.count(kind) for kind in sorted(set(slots))}
    notes = sum(1 for chapter in pack["chapters"].values() if chapter["version_note"])
    print(f"chapters={len(pack['chapters'])} | slots={len(slots)} {kinds} | version_notes={notes} "
          f"| code_index={len(pack['code_index'])} | deleted={len(pack['deleted'])} | output={output}")
    failures = self_check(pack)
    for failure in failures:
        print(f"SELF-CHECK FAILED: {failure}", file=sys.stderr)
    if failures:
        raise SystemExit(1)
```

`pyproject.toml`, under `[project.scripts]` after the `ackb-ocr-backfill` line:

```toml
ackb-specbook-pack = "ackb.specbook_pack:main"
```

- [ ] **Step 4: Run unit tests, then the full suite**

Run: `cd /Volumes/AI-Model/ACKB && .venv/bin/python -m unittest tests.test_specbook_pack -v`
Expected: 20 tests OK

Run: `cd /Volumes/AI-Model/ACKB && .venv/bin/python -m unittest discover -s tests 2>&1 | grep -E "^Ran|^OK|FAILED"`
Expected: `Ran 517 tests` and `OK` (497 before this plan + 20 new)

- [ ] **Step 5: Run on real data (the §4.3 acceptance)**

Run: `cd /Volumes/AI-Model/ACKB && uv sync -q && .venv/bin/ackb-specbook-pack`
Expected: a summary line with `chapters=314`, `slots=` within 14,480–14,771, and exit code 0 (no `SELF-CHECK FAILED`). If the self-check fails, stop and report the exact failure lines and the slot-kind counts; do not loosen `self_check` to make it pass.

Also record, for the report: pack file size (`ls -la knowledge/specbook/`), the `version_notes` count, and 3 sample `version_note` values:

```bash
.venv/bin/python -c "import json,glob; p=json.load(open(sorted(glob.glob('knowledge/specbook/*.json'))[-1])); n=[(c,x['version_note']) for c,x in p['chapters'].items() if x['version_note']]; print(len(n), n[:3])"
```

- [ ] **Step 6: Commit**

```bash
cd /Volumes/AI-Model/ACKB
git add src/ackb/specbook_pack.py tests/test_specbook_pack.py pyproject.toml uv.lock
git commit -m "feat(specbook_pack): build the specbook pack with a self-check (ackb-specbook-pack)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(`uv.lock` only if `uv sync` changed it; check with `git status`.)
