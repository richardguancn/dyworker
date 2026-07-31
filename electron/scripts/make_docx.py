#!/usr/bin/env python3
"""最小 OOXML .docx 生成器（DYWorker 公文导出）。

版面近似 GB/T 9704 公文：标题二号字居中（方正小标宋简体）、正文三号仿宋、
首行缩进两字符、行距固定 28 磅。字体未安装时由办公软件自行回退。
从 stdin 读取 JSON：{"path": 输出文件, "title": 标题, "paragraphs": [段落…]}
"""
import json
import sys
import zipfile
from xml.sax.saxutils import escape

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""

RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""


def paragraph(text, *, font, size, bold=False, center=False, indent=False, align_right=False):
    jc = ""
    if center:
        jc = '<w:jc w:val="center"/>'
    elif align_right:
        jc = '<w:jc w:val="right"/>'
    ind = '<w:ind w:firstLineChars="200" w:firstLine="640"/>' if indent else ""
    b = "<w:b/>" if bold else ""
    spacing = '<w:spacing w:line="560" w:lineRule="exact"/>'
    return (
        "<w:p><w:pPr>" + spacing + jc + ind + "</w:pPr><w:r><w:rPr>"
        + f'<w:rFonts w:ascii="{font}" w:eastAsia="{font}" w:hAnsi="{font}"/>' + b
        + f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/></w:rPr>'
        + f'<w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>'
    )


def looks_like_date(line):
    """成文日期行（如 2024年3月5日）右对齐。"""
    stripped = line.strip()
    return stripped.endswith("日") and "年" in stripped and "月" in stripped and len(stripped) <= 14


def build_document(title, paragraphs):
    body = []
    if title:
        body.append(paragraph(title, font="方正小标宋简体", size=44, center=True))
        body.append(paragraph("", font="仿宋_GB2312", size=32))
    for line in paragraphs:
        text = line.strip()
        if not text:
            body.append(paragraph("", font="仿宋_GB2312", size=32))
        elif looks_like_date(text):
            body.append(paragraph(text, font="仿宋_GB2312", size=32, align_right=True))
        else:
            body.append(paragraph(text, font="仿宋_GB2312", size=32, indent=True))
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
        + "".join(body)
        + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        + '<w:pgMar w:top="2098" w:right="1474" w:bottom="1985" w:left="1588" w:header="851" w:footer="992" w:gutter="0"/>'
        + "</w:sectPr></w:body></w:document>"
    )


def main():
    payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    document = build_document(payload.get("title") or "", payload.get("paragraphs") or [])
    with zipfile.ZipFile(payload["path"], "w", zipfile.ZIP_DEFLATED) as docx:
        docx.writestr("[Content_Types].xml", CONTENT_TYPES)
        docx.writestr("_rels/.rels", RELS)
        docx.writestr("word/document.xml", document)


if __name__ == "__main__":
    main()
