#!/usr/bin/env python3
import html
import re
import struct
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


# ---------------------------------------------------------------------------
# .xls（Excel 97-2003，BIFF8 二进制格式）解析：不依赖 pandas/xlrd，
# 仅用标准库实现 OLE2 复合文档读取 + BIFF 记录解析
# ---------------------------------------------------------------------------

OLE_SIGNATURE = b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1"
OLE_FREE_SID = -1
OLE_END_SID = -2

# BIFF 记录类型
BIFF_BOF = 0x0809
BIFF_BOUNDSHEET = 0x0085
BIFF_CODEPAGE = 0x0042
BIFF_FILEPASS = 0x002F
BIFF_SST = 0x00FC
BIFF_CONTINUE = 0x003C
BIFF_LABELSST = 0x00FD
BIFF_LABEL = 0x0204
BIFF_NUMBER = 0x0203
BIFF_RK = 0x027E
BIFF_MULRK = 0x00BD
BIFF_FORMULA = 0x0006
BIFF_STRING = 0x0207
BIFF_BOOLERR = 0x0205

ERROR_TEXT = {
    0x00: "#NULL!", 0x07: "#DIV/0!", 0x0F: "#VALUE!", 0x17: "#REF!",
    0x1D: "#NAME?", 0x24: "#NUM!", 0x2A: "#N/A", 0x2B: "#GETTING_DATA",
}


def column_name(index):
    """0 起的列号转 A1 引用的列名（0→A，25→Z，26→AA）"""
    letters = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def format_number(value):
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return repr(value) if isinstance(value, float) else str(value)


def rk_value(raw):
    """RK 数值：低 2 位是标志（bit1 整数、bit0 除 100），其余 30 位是数值"""
    flags = raw & 3
    if flags & 2:
        number = float(raw >> 2)  # 有符号 30 位整数
    else:
        number = struct.unpack("<d", struct.pack("<Q", (raw & 0xFFFFFFFC) << 32))[0]
    if flags & 1:
        number = number / 100.0
    return number


def read_ole_stream(mem, fat, sector_size, start_sid, size, base):
    """沿 FAT 链读取一个流；size 为 None 时不截断"""
    chunks = []
    todo = size
    sid = start_sid
    seen = set()
    while sid >= 0 and sid < len(fat) and sid not in seen:
        seen.add(sid)
        offset = base + sid * sector_size
        grab = sector_size if todo is None else min(sector_size, todo)
        chunks.append(mem[offset:offset + grab])
        if todo is not None:
            todo -= grab
            if todo <= 0:
                break
        sid = fat[sid]
    return b"".join(chunks)


def find_ole_workbook(mem):
    """在 OLE2 复合文档中定位 Workbook/Book 流（优先根目录下的直接子流）"""
    if mem[0:8] != OLE_SIGNATURE:
        raise ValueError("不是有效的 .xls 文件（缺少 OLE2 头）")
    sector_shift, mini_shift = struct.unpack("<HH", mem[30:34])
    if sector_shift > 20:
        sector_shift = 9
    sector_size = 1 << sector_shift
    mini_size = 1 << (mini_shift if mini_shift <= sector_shift else 6)
    (fat_sector_count, dir_first_sid, _unused, mini_cutoff,
     minifat_first_sid, minifat_sector_count, difat_first_sid, difat_sector_count) = struct.unpack("<iiiiiiii", mem[44:76])
    # DIFAT：头部 109 项 + 扩展链
    difat = list(struct.unpack("<109i", mem[76:512]))
    sid = difat_first_sid
    for _ in range(difat_sector_count):
        if sid < 0 or sid in (OLE_FREE_SID, OLE_END_SID):
            break
        offset = 512 + sid * sector_size
        entries = struct.unpack("<%di" % (sector_size // 4), mem[offset:offset + sector_size])
        difat.extend(entries[:-1])
        sid = entries[-1]
    # FAT（主扇区分配表）
    fat = []
    for fat_sid in difat:
        if fat_sid in (OLE_FREE_SID, OLE_END_SID) or fat_sid < 0:
            continue
        offset = 512 + fat_sid * sector_size
        fat.extend(struct.unpack("<%di" % (sector_size // 4), mem[offset:offset + sector_size]))
    # 目录流
    directory = read_ole_stream(mem, fat, sector_size, dir_first_sid, None, 512)
    entries = []
    for position in range(0, len(directory), 128):
        dent = directory[position:position + 128]
        if len(dent) < 128:
            break
        name_size = struct.unpack("<H", dent[64:66])[0]
        entry_type = dent[66]
        first_sid, total_size = struct.unpack("<ii", dent[116:124])
        name = dent[:max(0, name_size - 2)].decode("utf-16-le", "replace") if name_size >= 2 else ""
        entries.append((name, entry_type, first_sid, total_size))
    if not entries or entries[0][1] != 5:
        raise ValueError(".xls 目录结构损坏")
    # Mini FAT + 根条目的小流容器（小于 4096 字节的流存放在这里）
    minifat = []
    if minifat_sector_count > 0 and entries[0][3] > 0:
        sid = minifat_first_sid
        for _ in range(minifat_sector_count):
            if sid < 0 or sid >= len(fat):
                break
            offset = 512 + sid * sector_size
            minifat.extend(struct.unpack("<%di" % (sector_size // 4), mem[offset:offset + sector_size]))
            sid = fat[sid]
    mini_stream = (read_ole_stream(mem, fat, sector_size, entries[0][2], entries[0][3], 512)
                   if entries[0][2] >= 0 and entries[0][3] > 0 else b"")
    for name, entry_type, first_sid, total_size in entries:
        if entry_type != 2 or name not in ("Workbook", "Book"):
            continue
        if total_size >= mini_cutoff:
            return read_ole_stream(mem, fat, sector_size, first_sid, total_size, 512)
        return read_ole_stream(mini_stream, minifat, mini_size, first_sid, total_size, 0)
    return None


def parse_sst(chunks):
    """SST 共享字符串表（可能由 CONTINUE 记录拼接，字符跨块处有新的标志字节）"""
    data = chunks[0]
    data_index = 0
    length = len(data)
    position = 8
    try:
        count = struct.unpack("<i", data[4:8])[0]
    except struct.error:
        return []
    strings = []
    for _ in range(max(0, count)):
        try:
            char_count = struct.unpack("<H", data[position:position + 2])[0]
        except struct.error:
            break
        position += 2
        if position >= length:
            break
        options = data[position]
        position += 1
        rich_runs = 0
        phonetic_size = 0
        if options & 0x08:
            rich_runs = struct.unpack("<H", data[position:position + 2])[0]
            position += 2
        if options & 0x04:
            phonetic_size = struct.unpack("<i", data[position:position + 4])[0]
            position += 4
        parts = []
        obtained = 0
        while True:
            need = char_count - obtained
            if options & 0x01:
                available = max(0, min((length - position) >> 1, need))
                parts.append(data[position:position + 2 * available].decode("utf-16-le", "replace"))
                position += 2 * available
            else:
                # 压缩编码是 8 位字符（不是纯 ASCII），按 latin-1 解
                available = max(0, min(length - position, need))
                parts.append(data[position:position + available].decode("latin-1"))
                position += available
            obtained += available
            if obtained == char_count or data_index + 1 >= len(chunks):
                break
            data_index += 1
            data = chunks[data_index]
            length = len(data)
            options = data[0]
            position = 1
        for _run in range(rich_runs):
            if position >= length and data_index + 1 < len(chunks):
                data_index += 1
                data = chunks[data_index]
                length = len(data)
                position = 0
            position += 4
        position += phonetic_size
        if position >= length and data_index + 1 < len(chunks):
            position -= length
            data_index += 1
            data = chunks[data_index]
            length = len(data)
        strings.append("".join(parts))
    return strings


def decode_biff_string(data, position, char_count, wide):
    if wide:
        return data[position:position + 2 * char_count].decode("utf-16-le", "replace")
    return data[position:position + char_count].decode("latin-1")


def xls(path):
    with open(path, "rb") as handle:
        stream = find_ole_workbook(handle.read())
    if stream is None:
        raise ValueError("未找到 Workbook 流，文件可能已加密或损坏")
    # 展开为 (记录起始位置, 记录号, 数据) 列表
    records = []
    position = 0
    total = len(stream)
    while position + 4 <= total:
        record_id, record_len = struct.unpack("<HH", stream[position:position + 4])
        data = stream[position + 4:position + 4 + record_len]
        if len(data) < record_len:
            data += b"\x00" * (record_len - len(data))
        records.append((position, record_id, data))
        position += 4 + record_len
    if not records or records[0][1] != BIFF_BOF:
        raise ValueError("未找到 BIFF 记录流")
    biff8 = struct.unpack("<H", records[0][2][0:2])[0] >= 0x0600
    codepage = "latin-1"
    sheets = []  # (名称, 子流位置, 类型, 可见状态)
    sheet_by_position = {}
    shared = []
    cells = {}  # 工作表序号 → {(行, 列): 文本}

    def put(sheet_index, row, column, value):
        if sheet_index >= 0:
            cells.setdefault(sheet_index, {})[(row, column)] = value

    index = 0
    current = -1
    while index < len(records):
        record_position, record_id, data = records[index]
        if record_id == BIFF_FILEPASS:
            raise ValueError(".xls 文件已加密，无法解析")
        elif record_id == BIFF_CODEPAGE and len(data) >= 2:
            codepage = "cp%d" % struct.unpack("<H", data[:2])[0]
        elif record_id == BIFF_BOUNDSHEET and len(data) >= 8:
            offset, visibility, sheet_type = struct.unpack("<iBB", data[:6])
            char_count = data[6]
            if biff8:
                wide = bool(data[7] & 1)
                name = decode_biff_string(data, 8, char_count, wide)
            else:
                try:
                    name = data[7:7 + char_count].decode(codepage, "replace")
                except LookupError:
                    name = data[7:7 + char_count].decode("latin-1", "replace")
            sheet_by_position[offset] = len(sheets)
            sheets.append((name, offset, sheet_type, visibility))
        elif record_id == BIFF_SST:
            chunks = [data]
            scan = index + 1
            while scan < len(records) and records[scan][1] == BIFF_CONTINUE:
                chunks.append(records[scan][2])
                scan += 1
            shared = parse_sst(chunks)
            index = scan - 1
        elif record_id == BIFF_BOF:
            current = sheet_by_position.get(record_position, -1)
        elif record_id == BIFF_LABELSST and len(data) >= 10 and current >= 0:
            row, column, _xf, string_index = struct.unpack("<HHHi", data[:10])
            put(current, row, column, shared[string_index] if 0 <= string_index < len(shared) else "")
        elif record_id == BIFF_LABEL and len(data) >= 8 and current >= 0:
            row, column, _xf = struct.unpack("<HHH", data[:6])
            char_count = struct.unpack("<H", data[6:8])[0]
            if biff8 and len(data) >= 9:
                put(current, row, column, decode_biff_string(data, 9, char_count, bool(data[8] & 1)))
            else:
                try:
                    put(current, row, column, data[8:8 + char_count].decode(codepage, "replace"))
                except LookupError:
                    put(current, row, column, data[8:8 + char_count].decode("latin-1", "replace"))
        elif record_id == BIFF_NUMBER and len(data) >= 14 and current >= 0:
            row, column, _xf = struct.unpack("<HHH", data[:6])
            put(current, row, column, format_number(struct.unpack("<d", data[6:14])[0]))
        elif record_id == BIFF_RK and len(data) >= 10 and current >= 0:
            row, column, _xf = struct.unpack("<HHH", data[:6])
            put(current, row, column, format_number(rk_value(struct.unpack("<i", data[6:10])[0])))
        elif record_id == BIFF_MULRK and len(data) >= 6 and current >= 0:
            row, first_column = struct.unpack("<HH", data[:4])
            last_column = struct.unpack("<H", data[-2:])[0]
            cursor = 4
            for column in range(first_column, last_column + 1):
                if cursor + 6 > len(data) - 2:
                    break
                put(current, row, column, format_number(rk_value(struct.unpack("<i", data[cursor + 2:cursor + 6])[0])))
                cursor += 6
        elif record_id == BIFF_FORMULA and len(data) >= 14 and current >= 0:
            row, column, _xf = struct.unpack("<HHH", data[:6])
            result = data[6:14]
            if result[6:8] == b"\xff\xff":
                kind = result[0]
                if kind == 0 and index + 1 < len(records) and records[index + 1][1] == BIFF_STRING:
                    string_data = records[index + 1][2]
                    if len(string_data) >= 3:
                        char_count = struct.unpack("<H", string_data[:2])[0]
                        put(current, row, column,
                            decode_biff_string(string_data, 3, char_count, bool(string_data[2] & 1)))
                    index += 1
                elif kind == 1:
                    put(current, row, column, "TRUE" if result[2] else "FALSE")
                elif kind == 2:
                    put(current, row, column, ERROR_TEXT.get(result[2], "#ERR"))
                elif kind == 3:
                    put(current, row, column, "")
            else:
                put(current, row, column, format_number(struct.unpack("<d", result)[0]))
        elif record_id == BIFF_BOOLERR and len(data) >= 8 and current >= 0:
            row, column, _xf, value, is_error = struct.unpack("<HHHBB", data[:8])
            put(current, row, column, ERROR_TEXT.get(value, "#ERR") if is_error else ("TRUE" if value else "FALSE"))
        index += 1

    output = []
    for number, (name, _offset, sheet_type, visibility) in enumerate(sheets, 1):
        label = f"=== 工作表 {number}：{name}" + ("（隐藏）" if visibility else "") + " ==="
        if sheet_type == 0x02:
            output.append(f"{label}\n（图表页，无可提取的文字）")
            continue
        grouped = {}
        for (row, column), value in cells.get(number - 1, {}).items():
            grouped.setdefault(row, []).append((column, value))
        rows = []
        for row in sorted(grouped):
            entries = sorted(grouped[row])
            rows.append("\t".join(f"{column_name(column)}{row + 1}={value}" for column, value in entries))
        output.append(label + "\n" + ("\n".join(rows) if rows else "（空工作表）"))
    return "\n\n".join(output)


def main():
    path = Path(sys.argv[1])
    suffix = path.suffix.lower()
    if suffix == ".xls":
        text = xls(path)
    else:
        with zipfile.ZipFile(path) as archive:
            if suffix in (".docx", ".docm"):
                text = docx(archive)
            elif suffix in (".pptx", ".pptm"):
                text = pptx(archive)
            elif suffix in (".xlsx", ".xlsm"):
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
