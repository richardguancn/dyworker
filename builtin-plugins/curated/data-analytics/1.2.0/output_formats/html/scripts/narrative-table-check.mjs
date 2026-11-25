import { dirname, join, resolve } from "node:path";

// Recognize a table header plus delimiter, not arbitrary pipes. Code examples
// remain prose: ignore fenced/indented code and inline code spans.
export function narrativeTableLine(markdown) {
  let fence;
  const itemStarts = new Set();
  let text = String(markdown).split(/\r?\n/u).map((line, index) => {
    const container = /^ {0,3}(?:> ?|(?:[-+*]|\d{1,9}[.)])[ \t]+)/u;
    for (let prefix; (prefix = container.exec(line));) {
      if (prefix[0].trim() !== ">") itemStarts.add(index);
      line = line.slice(prefix[0].length);
    }
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      return "";
    }
    if (marker && (marker[1][0] === "~" || !marker[2].includes("`"))) { fence = marker[1]; return ""; }
    if (/^(?: {4}|\t)/u.test(line)) return "";
    return line;
  }).join("\n");
  // Only matched runs open inline code; an unmatched backtick is plain text.
  const runs = [...text.matchAll(/(?<!\\)`+/gu)];
  for (let index = 0; index < runs.length; index++) {
    const start = runs[index], endIndex = runs.findIndex((run, next) => next > index && run[0].length === start[0].length
      && !/\n[ \t]*\n/u.test(text.slice(start.index, run.index)));
    if (endIndex === -1) continue;
    const end = runs[endIndex], stop = end.index + end[0].length;
    // Keep UTF-16 offsets stable for subsequent backtick runs, including emoji.
    text = text.slice(0, start.index) + text.slice(start.index, stop).replace(/[^\n]/gu, character => "x".repeat(character.length)) + text.slice(stop);
    index = endIndex;
  }
  const lines = text.split("\n");
  const cells = line => {
    const parts = [""];
    let pipes = 0;
    const tokens = line.trim().match(/\\.|[^\\]/gu) ?? [];
    for (const token of tokens) {
      if (token === "|") { parts.push(""); pipes++; }
      else parts[parts.length - 1] += token;
    }
    if (!parts[0]?.trim()) parts.shift();
    if (!parts.at(-1)?.trim()) parts.pop();
    return { values: parts.map(cell => cell.trim()), pipes };
  };
  for (let index = 1; index < lines.length; index++) {
    if (itemStarts.has(index)) continue; // Separate list items are separate blocks.
    const header = cells(lines[index - 1]), delimiter = cells(lines[index]);
    if ((header.pipes || delimiter.pipes) && header.values.some(Boolean) && header.values.length === delimiter.values.length
      && delimiter.values.every(cell => /^:?-+:?$/u.test(cell))) return index; // 1-based header line
  }
  return null;
}

const unknown = () => [{ text: "\uFFFC", dynamic: true }];

/** Bounded static inspection; never evaluates authored JavaScript. Follow const
 * data, imports, object/tuple members and literal-array map bindings. Arbitrary
 * helpers, runtime data and edits stay explicitly unverified.
 */
export function inspectNarrativeTables({ ts, createTypeScriptProgram, sources, projectRoot, resolvedImports = {} }) {
  const resolutions = Object.fromEntries(Object.entries(resolvedImports).map(([filename, imports]) => [join(projectRoot, filename),
    Object.fromEntries(Object.entries(imports).map(([specifier, target]) => [specifier, join(projectRoot, target)]))]));
  const program = createTypeScriptProgram({ files: Object.fromEntries(sources), resolutions });
  const checker = program.getTypeChecker(), diagnostics = [];
  const unwrap = input => {
    while (input && (ts.isParenthesizedExpression(input) || ts.isAsExpression(input)
      || ts.isTypeAssertionExpression(input) || ts.isNonNullExpression(input) || ts.isSatisfiesExpression(input))) input = input.expression;
    return input;
  };
  const declarations = node => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.declarations ?? [];
  };
  let remaining;
  function origins(input, seen = new Set()) {
    const node = unwrap(input);
    if (!node || seen.has(node) || seen.size > 32 || --remaining < 0) return [undefined];
    seen = new Set(seen).add(node);
    if (ts.isIdentifier(node)) {
      const values = declarations(node).flatMap(declaration => {
        if (ts.isVariableDeclaration(declaration) && declaration.initializer
          && (declaration.parent.flags & ts.NodeFlags.Const)) return origins(declaration.initializer, seen);
        if (ts.isBindingElement(declaration)) return bindingOrigins(declaration, seen);
        if (ts.isExportAssignment(declaration)) return origins(declaration.expression, seen);
        return [undefined];
      });
      return values.length ? values : [undefined];
    }
    if (ts.isPropertyAccessExpression(node)) return select(origins(node.expression, seen), node.name.text, seen);
    if (ts.isElementAccessExpression(node) && node.argumentExpression
      && (ts.isStringLiteral(node.argumentExpression) || ts.isNumericLiteral(node.argumentExpression)))
      return select(origins(node.expression, seen), node.argumentExpression.text, seen);
    if (ts.isConditionalExpression(node)) return [...origins(node.whenTrue, seen), ...origins(node.whenFalse, seen)];
    return [node];
  }
  function select(nodes, key, seen) {
    return nodes.flatMap(node => {
      if (!node) return [undefined];
      if (ts.isArrayLiteralExpression(node)) return origins(node.elements[Number(key)], seen);
      if (ts.isObjectLiteralExpression(node)) {
        // Spreads/computed keys may replace the selected member. Do not invent
        // a value from only the statically visible portion of an object.
        if (node.properties.some(property => ts.isSpreadAssignment(property) || (property.name && ts.isComputedPropertyName(property.name)))) return [undefined];
        const property = node.properties.findLast(property => property.name?.text === key);
        if (property && ts.isPropertyAssignment(property)) return origins(property.initializer, seen);
        if (property && ts.isShorthandPropertyAssignment(property)) {
          const symbol = checker.getShorthandAssignmentValueSymbol(property);
          return (symbol?.declarations ?? []).flatMap(declaration => declaration.initializer ? origins(declaration.initializer, seen) : [undefined]);
        }
      }
      return [undefined];
    });
  }
  function bindingOrigins(binding, seen) {
    const path = [];
    let owner = binding;
    while (ts.isBindingElement(owner)) {
      if (owner.dotDotDotToken) return [undefined];
      const pattern = owner.parent;
      path.unshift(ts.isArrayBindingPattern(pattern) ? String(pattern.elements.indexOf(owner)) : (owner.propertyName ?? owner.name).text);
      owner = pattern.parent;
    }
    let nodes;
    if (ts.isVariableDeclaration(owner) && owner.initializer && owner.parent.flags & ts.NodeFlags.Const)
      nodes = origins(owner.initializer, seen);
    else if (ts.isParameter(owner)) {
      const callback = owner.parent, call = callback.parent;
      if (!ts.isCallExpression(call) || call.arguments[0] !== callback || callback.parameters[0] !== owner
        || !ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "map") return [undefined];
      nodes = origins(call.expression.expression, seen).flatMap(node => node && ts.isArrayLiteralExpression(node)
        ? node.elements.flatMap(element => origins(element, seen)) : [undefined]);
    } else return [undefined];
    for (const key of path) nodes = select(nodes, key, seen);
    return nodes;
  }
  function combine(left, right) {
    if (left.length * right.length > 64) return unknown();
    return left.flatMap(a => right.map(b => ({ text: a.text + b.text, dynamic: a.dynamic || b.dynamic })));
  }
  function read(input, seen = new Set()) {
    const node = unwrap(input);
    if (!node || seen.has(node) || seen.size > 32 || --remaining < 0) return unknown();
    seen = new Set(seen).add(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [{ text: node.text, dynamic: false }];
    if (ts.isTemplateExpression(node)) {
      let values = [{ text: node.head.text, dynamic: false }];
      for (const span of node.templateSpans) values = combine(combine(values, read(span.expression, seen)), [{ text: span.literal.text, dynamic: false }]);
      return values;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
      return combine(read(node.left, seen), read(node.right, seen));
    const resolved = origins(node).filter(origin => origin !== node);
    if (resolved.length > 64) return unknown();
    const values = resolved.flatMap(origin => read(origin, seen));
    return values.length ? values : unknown();
  }
  for (const filename of sources.keys()) {
    const source = program.getSourceFile(filename);
    if (!source) continue;
    const names = new Set(), namespaces = new Set();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (specifier !== "@openai/data-app" && (!specifier.startsWith(".")
        || resolve(dirname(filename), specifier) !== join(projectRoot, "src/data-app-public.jsx"))) continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const entry of bindings.elements) {
        if ((entry.propertyName ?? entry.name).text === "RichNarrative") names.add(checker.getSymbolAtLocation(entry.name));
      }
      else if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(checker.getSymbolAtLocation(bindings.name));
    }
    const visit = node => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName;
        const narrative = ts.isIdentifier(tag) ? names.has(checker.getSymbolAtLocation(tag))
          : ts.isPropertyAccessExpression(tag) && tag.name.text === "RichNarrative"
            && namespaces.has(checker.getSymbolAtLocation(tag.expression));
        if (narrative) {
          let value;
          let spread = false;
          for (const attribute of node.attributes.properties) {
            if (ts.isJsxSpreadAttribute(attribute)) { value = undefined; spread = true; }
            else if (attribute.name.text === "value") { value = attribute; spread = false; }
          }
          remaining = 10_000;
          const values = value?.initializer ? read(ts.isJsxExpression(value.initializer) ? value.initializer.expression : value.initializer) : unknown();
          const bad = values.find(value => narrativeTableLine(value.text) !== null);
          const position = source.getLineAndCharacterOfPosition((value ?? node).getStart(source));
          if (bad || values.some(value => value.dynamic) || spread) {
            diagnostics.push({ severity: bad ? "error" : "warning", code: bad ? "DATA_NARRATIVE_TABLE" : "DATA_NARRATIVE_DYNAMIC",
              file: filename, line: position.line + 1, column: position.character + 1,
              message: bad
                ? "RichNarrative contains an unsupported Markdown pipe table. Move its headers and rows into DataTable (also exported as Table), inside DataComponent or ReportSection for Sources; keep prose in RichNarrative. Worked scorecard: output_formats/html/docs/components/tables/tables.md#report-scorecard."
                : "RichNarrative includes dynamic content that cannot be fully checked for pipe tables offline. Render representative values and verify table headers/cells; use DataTable for tabular content." });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return diagnostics;
}
