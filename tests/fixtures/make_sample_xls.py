#!/usr/bin/env python3
"""生成 tests/fixtures/sample.xls：手工构造 OLE2 + BIFF8，覆盖 SST CONTINUE、
RK/MULRK/NUMBER/LABEL/LABELSST/FORMULA/BOOLERR、宽/压缩字符串、隐藏工作表。"""
import struct

OUT = "/Users/gdy/Documents/My/App/dyworker/tests/fixtures/sample.xls"
SST_MAX = 8224  # 记录数据上限，超出需拆 CONTINUE


def record(rid, data):
    return struct.pack("<HH", rid, len(data)) + data


def biff8_string(text, wide):
    raw = text.encode("utf-16-le" if wide else "latin-1")
    return struct.pack("<HB", len(text), 1 if wide else 0) + raw


def biff8_short_string(text, wide):
    """BOUNDSHEET 名称：1 字节长度前缀"""
    raw = text.encode("utf-16-le" if wide else "latin-1")
    return struct.pack("<BB", len(text), 1 if wide else 0) + raw


# ---- SST 载荷（含超长宽字符串，触发跨 CONTINUE 分割）----
strings = [
    ("Hello Report", False),          # 压缩编码
    ("L" * 12000, True),              # 超长宽字符串，必然跨记录
    ("数据汇总·2026", True),          # 宽编码中文
    ("summary", False),               # 压缩编码
]


def build_sst(unique):
    chunks = []
    buf = bytearray(struct.pack("<ii", 5, unique))  # total=引用数, unique

    def flush():
        chunks.append(bytes(buf))
        buf.clear()

    for text, wide in strings:
        if len(buf) + 3 > SST_MAX:
            flush()
        buf += struct.pack("<HB", len(text), (1 if wide else 0))
        raw = text.encode("utf-16-le" if wide else "latin-1")
        step = 2 if wide else 1
        while raw:
            space = SST_MAX - len(buf)
            take = (space // step) * step
            if take == 0:
                flush()
                buf += bytes([1 if wide else 0])  # 跨块处补新标志字节
                continue
            buf += raw[:take]
            raw = raw[take:]
    flush()
    return chunks


# ---- 工作表子流 ----
def bof(substream_type):
    return record(0x0809, struct.pack("<HHHHIHH", 0x0600, substream_type, 0x0DB6, 0x07CC, 0, 0x0006, 0))


def number(row, col, value):
    return record(0x0203, struct.pack("<HHHd", row, col, 0, value))


def rk_int(row, col, value):  # 整数 RK：bit1=1
    return record(0x027E, struct.pack("<HHHi", row, col, 0, (value << 2) | 0x02))


def rk_div100(row, col, value):  # 除 100 RK：bit1=1, bit0=1
    return record(0x027E, struct.pack("<HHHi", row, col, 0, (value << 2) | 0x03))


def mulrk(row, first_col, values):
    body = struct.pack("<HH", row, first_col)
    for v in values:
        body += struct.pack("<Hi", 0, (int(v) << 2) | 0x02)
    body += struct.pack("<H", first_col + len(values) - 1)
    return record(0x00BD, body)


def labelsst(row, col, isst):
    return record(0x00FD, struct.pack("<HHHi", row, col, 0, isst))


def label(row, col, text):
    return record(0x0204, struct.pack("<HHH", row, col, 0) + biff8_string(text, True))


def formula_number(row, col, value):
    return record(0x0006, struct.pack("<HHHdHHi", row, col, 0, value, 0, 0, 0))


def formula_bool(row, col, value):
    # 布尔结果：byte0=类型 1，byte2=值（见 MS-XLS Formula Result）
    result = bytes([1, 0, 1 if value else 0, 0, 0, 0, 0xFF, 0xFF])
    return record(0x0006, struct.pack("<HHH", row, col, 0) + result + struct.pack("<HHi", 0, 0, 0))


def boolerr(row, col, value, is_error):
    return record(0x0205, struct.pack("<HHHBB", row, col, 0, value, is_error))


def eof():
    return record(0x000A, b"")


def boundsheet(offset, name, visibility=0, sheet_type=0x00):
    return record(0x0085, struct.pack("<iBB", offset, visibility, sheet_type) + biff8_short_string(name, True))


sheet1 = (bof(0x0010)
          + labelsst(0, 0, 0) + labelsst(0, 1, 1) + labelsst(0, 2, 2)
          + number(0, 3, 3.14159) + number(0, 4, 42)
          + rk_int(0, 5, 1234) + rk_div100(0, 6, 1234)  # 1234 与 12.34
          + mulrk(1, 0, [100, 200, 300])
          + formula_number(1, 3, 99.5)
          + formula_bool(1, 4, True)
          + boolerr(1, 5, 0x07, 1)   # #DIV/0!
          + boolerr(1, 6, 0, 0)      # FALSE
          + label(0, 7, "直书文本")
          + eof())
sheet2 = (bof(0x0010)
          + labelsst(0, 0, 3) + number(0, 1, -5.5)
          + eof())
sheet3 = (bof(0x0010) + labelsst(0, 0, 0) + eof())  # 隐藏表


def build_globals(boundsheets):
    stream = bof(0x0005)
    for bs in boundsheets:
        stream += bs
    for i, chunk in enumerate(sst_chunks):
        stream += record(0x00FC if i == 0 else 0x003C, chunk)
    stream += eof()
    return stream


names = [("数据表", 0), ("Sheet2", 0), ("Hidden", 1)]
sst_chunks = build_sst(len(strings))
offsets = [0, 0, 0]
for _ in range(5):
    bs = [boundsheet(offsets[i], n, v) for i, (n, v) in enumerate(names)]
    g = build_globals(bs)
    o = [len(g), len(g) + len(sheet1), len(g) + len(sheet1) + len(sheet2)]
    if o == offsets:
        break
    offsets = o
bs = [boundsheet(offsets[i], n, v) for i, (n, v) in enumerate(names)]
globals_data = build_globals(bs)
assert offsets[0] == len(globals_data), f"boundsheet 偏移不稳定：{offsets[0]} vs {len(globals_data)}"

stream = globals_data + sheet1 + sheet2 + sheet3

# ---- OLE2 容器 ----
sector_size = 512
data_sectors = (len(stream) + sector_size - 1) // sector_size
padded = stream + b"\x00" * (data_sectors * sector_size - len(stream))
fat_entries = [-3, -2] + [(i + 3 if i + 1 < data_sectors else -2) for i in range(data_sectors)]
fat_entries += [-1] * (sector_size // 4 - len(fat_entries))
fat_sector = b"".join(struct.pack("<i", e) for e in fat_entries)


def dirent(name, etype, first_sid, size, child=-1):
    raw = name.encode("utf-16-le") + b"\x00\x00"
    return (raw + b"\x00" * (64 - len(raw))
            + struct.pack("<H", len(raw)) + bytes([etype, 1])
            + struct.pack("<iii", -1, -1, child)
            + b"\x00" * 36 + struct.pack("<ii", first_sid, size)
            + b"\x00" * 4)


directory = (dirent("Root Entry", 5, -2, 0, child=1)
             + dirent("Workbook", 2, 2, len(stream))
             + dirent("", 0, 0, 0) + dirent("", 0, 0, 0))

header = bytearray(512)
header[0:8] = b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1"
header[28:30] = b"\xFE\xFF"
struct.pack_into("<HH", header, 30, 9, 6)
struct.pack_into("<iii", header, 44, 1, 1, 0)
struct.pack_into("<i", header, 56, 4096)
struct.pack_into("<ii", header, 60, -2, 0)
struct.pack_into("<ii", header, 68, -2, 0)
struct.pack_into("<109i", header, 76, 0, *([-1] * 108))

blob = bytes(header) + fat_sector + directory + padded
with open(OUT, "wb") as f:
    f.write(blob)
print(f"written {OUT}: {len(blob)} bytes, stream {len(stream)} bytes, sectors {data_sectors}")
