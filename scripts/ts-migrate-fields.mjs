// 一次性迁移 codemod（.mjs→.mts 后的推断缺口修复）：
// 1) 类构造函数里 this.x = ... 的赋值不会生成字段声明（TS2339 主因），
//    为每个类补上无类型的字段声明（strictPropertyInitialization 关闭时合法且类型为 any）。
// 2) 形参默认值 `{}` 会被收窄成 `{}` 类型导致属性访问报错，改写为 `{} as any`
//    （运行时语义完全不变，as 断言可擦除）。
// 依赖本地 typescript 编译器 API，只做语法级改写，不做语义重构。
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const files = execFileSync("git", ["ls-files", "electron/*.mts", "electron/**/*.mts"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const changes = [];

  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt) || !stmt.name) continue;
    const memberNames = new Set(
      stmt.members
        .filter(ts.isClassElement)
        .map((m) => (m.name && ts.isIdentifier(m.name) ? m.name.text : null))
        .filter(Boolean),
    );
    const fields = [];
    const collect = (node) => {
      if (!node) return;
      if (ts.isBinaryExpression(node)) {
        // TS 5.8+ BinaryExpression 用 left/right；旧版用 expression
        const lhs = node.left ?? node.expression;
        if (lhs && lhs.kind === ts.SyntaxKind.PropertyAccessExpression && lhs.expression && lhs.expression.kind === ts.SyntaxKind.ThisKeyword) {
          const name = lhs.name.text;
          if (!memberNames.has(name) && !fields.includes(name)) fields.push(name);
        }
      }
      ts.forEachChild(node, collect);
    };
    for (const member of stmt.members) {
      if (ts.isConstructorDeclaration(member) && member.body) collect(member.body);
    }
    if (!fields.length) continue;
    const openBrace = stmt.members.length ? stmt.members[0].getStart(sf) : stmt.getEnd() - 1;
    const indentMatch = /(?:^|\n)([ \t]*)\S/.exec(source.slice(stmt.getStart(sf), openBrace));
    const indent = indentMatch ? indentMatch[1] : "  ";
    const decls = fields.map((f) => `${indent}${f};\n`).join("");
    changes.push({ pos: openBrace, text: decls });
  }

  for (const stmt of sf.statements) {
    const visit = (node) => {
      if (!node) return;
      if (ts.isParameter(node) && node.initializer && node.initializer.kind === ts.SyntaxKind.ObjectLiteralExpression) {
        const literal = node.initializer;
        if (literal.properties.length === 0) {
          changes.push({ pos: literal.getEnd(), text: " as any" });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(stmt);
  }

  if (!changes.length) continue;
  changes.sort((a, b) => b.pos - a.pos);
  let out = source;
  for (const c of changes) out = out.slice(0, c.pos) + c.text + out.slice(c.pos);
  writeFileSync(file, out);
  console.log(`${file}: +${changes.length} edits`);
}
