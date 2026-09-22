// 解析 GFM 表格源码为结构化数据（表头/对齐/数据行），供即时渲染编辑器把表格源码
// 替换为真实表格。分隔行（| --- | :--: | ---: |）决定对齐；单元格内的 `\|` 转义不拆列。
export function parseMarkdownTable(source: string) {
  const rows = String(source || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const splitRow = (line: string) =>
    line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split(/(?<!\\)\|/)
      .map((cell) => cell.trim().replace(/\\\|/g, "|"));
  const isDelimiterRow = (line: string) => line.includes("-") && /^\|?[\s:|-]+\|?$/.test(line);
  const delimiterIndex = rows.findIndex(isDelimiterRow);
  const alignments = delimiterIndex >= 0
    ? splitRow(rows[delimiterIndex]).map((cell) =>
        /^:.*:$/.test(cell) ? "center" : /:$/.test(cell) ? "right" : "left")
    : [];
  if (!rows.length) return { header: [] as string[], alignments, body: [] as string[][] };
  return {
    header: splitRow(rows[0]),
    alignments,
    body: rows.slice(delimiterIndex >= 0 ? delimiterIndex + 1 : 1).map(splitRow),
  };
}
