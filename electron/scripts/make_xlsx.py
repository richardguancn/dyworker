#!/usr/bin/env python3
"""最小 OOXML .xlsx 生成器（DYWorker 统计表导出）。

不依赖第三方库，生成 WPS 表格 / Microsoft Excel 可直接打开的 .xlsx。
从 stdin 读取 JSON：{"path": 输出文件, "sheets": [{"name": 工作表名, "rows": [[单元格…], …]}, …]}
数字单元格写成数值，其余写成内联字符串；列宽自动按内容估算。
"""
import json
import re
import sys
import zipfile
from xml.sax.saxutils import escape

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  {sheet_overrides}
</Types>"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"""

WORKBOOK = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>{sheets}</sheets>
</workbook>"""

WORKBOOK_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  {rels}
</Relationships>"""

INVALID_SHEET_CHARS = re.compile(r"[\\/*?:\[\]]")


def column_name(index):
    """0 起列号转 Excel 列名（A、B、…、Z、AA）。"""
    name = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def cell_xml(row_index, column_index, value):
    ref = f"{column_name(column_index)}{row_index + 1}"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f'<c r="{ref}"><v>{value}</v></c>'
    text = escape(str(value if value is not None else ""))
    return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{text}</t></is></c>'


def sheet_xml(rows):
    body = []
    width = {}
    for row_index, row in enumerate(rows):
        cells = []
        for column_index, value in enumerate(row):
            cells.append(cell_xml(row_index, column_index, value))
            # 中文按 2 个宽度估算列宽
            text_width = sum(2 if ord(ch) > 0x2E7F else 1 for ch in str(value if value is not None else ""))
            width[column_index] = max(width.get(column_index, 8), min(text_width + 2, 60))
        body.append(f'<row r="{row_index + 1}">{"".join(cells)}</row>')
    columns = "".join(
        f'<col min="{index + 1}" max="{index + 1}" width="{size}" customWidth="1"/>'
        for index, size in sorted(width.items())
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"<cols>{columns}</cols><sheetData>{''.join(body)}</sheetData></worksheet>"
    )


def main():
    payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    sheets = payload.get("sheets") or []
    if not sheets:
        raise SystemExit("sheets 不能为空")
    sheet_entries = []
    rel_entries = []
    overrides = []
    parts = {}
    for index, sheet in enumerate(sheets, start=1):
        name = INVALID_SHEET_CHARS.sub(" ", str(sheet.get("name") or f"Sheet{index}"))[:31]
        rows = sheet.get("rows") or []
        sheet_entries.append(f'<sheet name="{escape(name, {chr(34): "&quot;"})}" sheetId="{index}" r:id="rId{index}"/>')
        rel_entries.append(
            f'<Relationship Id="rId{index}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            f'Target="worksheets/sheet{index}.xml"/>'
        )
        overrides.append(
            f'<Override PartName="/xl/worksheets/sheet{index}.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )
        parts[f"xl/worksheets/sheet{index}.xml"] = sheet_xml(rows)
    parts["[Content_Types].xml"] = CONTENT_TYPES.format(sheet_overrides="".join(overrides))
    parts["_rels/.rels"] = ROOT_RELS
    parts["xl/workbook.xml"] = WORKBOOK.format(sheets="".join(sheet_entries))
    parts["xl/_rels/workbook.xml.rels"] = WORKBOOK_RELS.format(rels="".join(rel_entries))
    with zipfile.ZipFile(payload["path"], "w", zipfile.ZIP_DEFLATED) as archive:
        for part_name, content in parts.items():
            archive.writestr(part_name, content)


if __name__ == "__main__":
    main()
