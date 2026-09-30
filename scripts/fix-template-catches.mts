// 修复盲改 codemod 的误伤：catch-any 注解被写进了「生成给浏览器执行的脚本文本」
// （模板字符串）里，产生非法 JS。用编译器定位所有模板字符串字面量，
// 只把字面量文本内部的 `catch (x: any)` 还原为 `catch (x)`。真实代码里的注解不动。
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const files = execFileSync("git", ["ls-files", "electron/*.mts", "electron/**/*.mts"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const spans = [];
  const visit = (node) => {
    if (!node) return;
    if (
      node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    ) {
      const text = node.getText(sf);
      const inner = text.replace(/^[`"']|[`"']$/g, "");
      if (/catch \([a-zA-Z_]\w*: any\)/.test(inner)) spans.push({ start: node.getStart(sf), end: node.getEnd() });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!spans.length) continue;
  let out = source;
  for (const s of [...spans].sort((a, b) => b.start - a.start)) {
    const fixed = out.slice(s.start, s.end).replace(/(catch \([a-zA-Z_]\w*): any\)/g, "$1)");
    out = out.slice(0, s.start) + fixed + out.slice(s.end);
  }
  writeFileSync(file, out);
  console.log(`${file}: fixed ${spans.length} template literal(s)`);
}
