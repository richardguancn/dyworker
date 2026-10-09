// MCP 启动参数的解析与回填。
//
// 为什么单独成一个小模块：分词规则写错，影响的是子进程真正收到的参数，很难从界面上看出来。
// 之前是 `input.split(" ")`——用户把一整条 shell 命令粘进「参数」框时会被拆成十几个碎片：
//   /bin/sh -c "export PATH=…; exec node xxx.mjs"
//   → ["-c", "export", "PATH=…;", "exec", …]
// 服务器自然起不来。现在按 shell 风格分词：支持单/双引号，双引号内支持 \" 转义。
// 注意这里只做分词，不做变量展开和通配符——参数是直接交给 spawn 的数组，不经过 shell。

export function splitMcpArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | "" = "";
  let started = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) {
        quote = "";
      } else if (char === "\\" && quote === '"' && index + 1 < input.length) {
        index += 1;
        current += input[index];
      } else {
        current += char;
      }
      started = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      if (started) {
        args.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }
  if (started) args.push(current);
  return args;
}

// 编辑已有服务器时把参数数组回填成可编辑文本：含空白或引号的参数用 JSON 引号包起来，
// 保证再经过 splitMcpArgs 能原样还原（往返一致）。
export function formatMcpArgs(args: string[] | null | undefined): string {
  return (Array.isArray(args) ? args : [])
    .map((arg) => {
      const text = String(arg);
      return /[\s"']/.test(text) ? JSON.stringify(text) : text;
    })
    .join(" ");
}
