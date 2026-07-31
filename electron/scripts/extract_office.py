#!/usr/bin/env python3
import html
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


def natural_key(value):
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", value)]


def xml_text(data):
    root = ET.fromstring(data)
    lines = []
    for paragraph in root.iter():
        tag = paragraph.tag.rsplit("}", 1)[-1]
        if tag in ("p", "row"):
            text = "".join(node.text or "" for node in paragraph.iter()
                           if node.tag.rsplit("}", 1)[-1] in ("t", "v"))
            if text.strip():
                lines.append(html.unescape(text.strip()))
    if lines:
        return "\n".join(lines)
    return " ".join(html.unescape(node.text or "") for node in root.iter()
                    if node.tag.rsplit("}", 1)[-1] == "t").strip()


def docx(archive):
    return xml_text(archive.read("word/document.xml"))


def pptx(archive):
    slides = sorted((name for name in archive.namelist()
                     if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)), key=natural_key)
    output = []
    for number, name in enumerate(slides, 1):
        output.append(f"=== 第 {number} 页 ===\n{xml_text(archive.read(name))}")
    return "\n\n".join(output)


def xlsx(archive):
    shared = []
    if "xl/sharedStrings.xml" in archive.namelist():
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
        for item in root:
            shared.append("".join(node.text or "" for node in item.iter()
                                  if node.tag.rsplit("}", 1)[-1] == "t"))
    sheets = sorted((name for name in archive.namelist()
                     if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name)), key=natural_key)
    output = []
    for sheet_number, name in enumerate(sheets, 1):
        root = ET.fromstring(archive.read(name))
        rows = []
        for row in (node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "row"):
            cells = []
            for cell in (node for node in row if node.tag.rsplit("}", 1)[-1] == "c"):
                reference = cell.attrib.get("r", "")
                cell_type = cell.attrib.get("t", "")
                value_node = next((node for node in cell.iter()
                                   if node.tag.rsplit("}", 1)[-1] in ("v", "t")), None)
                value = value_node.text if value_node is not None and value_node.text is not None else ""
                if cell_type == "s" and value.isdigit() and int(value) < len(shared):
                    value = shared[int(value)]
                cells.append(f"{reference}={value}")
            if cells:
                rows.append("\t".join(cells))
        output.append(f"=== 工作表 {sheet_number} ===\n" + "\n".join(rows))
    return "\n\n".join(output)


def main():
    path = Path(sys.argv[1])
    with zipfile.ZipFile(path) as archive:
        suffix = path.suffix.lower()
        if suffix == ".docx":
            text = docx(archive)
        elif suffix == ".pptx":
            text = pptx(archive)
        elif suffix == ".xlsx":
            text = xlsx(archive)
        else:
            raise ValueError("不支持的办公文档格式")
    print(text)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"无法解析办公文档：{exc}", file=sys.stderr)
        raise SystemExit(2)
