// 共享的 shell 词与复合段解析。只解析文本，不运行命令。
export function shellWords(command) {
  const words = [];
  let current = "";
  let quote = "";
  let escaped = false;
  const backslashEscapes = process.platform !== "win32";
  for (const character of String(command || "")) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'" && backslashEscapes) {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = "";
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s|[|;&<>()]/.test(character)) {
      if (current) words.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (escaped) current += "\\";
  if (current) words.push(current);
  return words;
}


// 只在引号之外拆复合命令，避免把参数里的 "cd x; ..." 当成真实目录切换。
export function shellCommandSegments(command) {
  const segments = [];
  const text = String(command || "");
  let start = 0, quote = "", escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (escaped) { escaped = false; continue; }
    if (char === "\\" && quote !== "'" && process.platform !== "win32") { escaped = true; continue; }
    if (quote) { if (char === quote) quote = ""; continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (!";&|\n".includes(char) || (char === "&" && /[<>]/.test(text[index - 1] || ""))) continue;
    const operator = (char === "&" || char === "|") && text[index + 1] === char ? char + char : char;
    segments.push({ text: text.slice(start, index), operator });
    index += operator.length - 1; start = index + 1;
  }
  segments.push({ text: text.slice(start), operator: "" });
  return segments;
}

