// MCP 启动参数的分词/回填。
//
// 现场事故：用户把一整条 shell 命令粘进「参数」框（/bin/sh -c "export PATH=…; exec node xxx.mjs"），
// 当时实现是 input.split(" ")，于是参数被拆成十几个碎片，服务器根本起不来，界面上还看不出问题。
import test from "node:test";
import assert from "node:assert/strict";
import { formatMcpArgs, splitMcpArgs } from "../src/mcpArgs.ts";

test("普通参数按空白切分", () => {
  assert.deepEqual(splitMcpArgs("-y @scope/mcp-server --dir /data"), ["-y", "@scope/mcp-server", "--dir", "/data"]);
  assert.deepEqual(splitMcpArgs("  a\tb\nc  "), ["a", "b", "c"]);
  assert.deepEqual(splitMcpArgs(""), []);
  assert.deepEqual(splitMcpArgs("   "), []);
});

test("引号里的空格不再切分（/bin/sh -c 整段脚本）", () => {
  const script = "export PATH=/usr/local/bin:$PATH; exec /usr/local/bin/node /tmp/mcp-server.mjs";
  assert.deepEqual(splitMcpArgs(`-c "${script}"`), ["-c", script]);
  assert.deepEqual(splitMcpArgs(`-c '${script}'`), ["-c", script]);
});

test("双引号内的转义与拼接", () => {
  assert.deepEqual(splitMcpArgs('--msg "say \\"hi\\""'), ["--msg", 'say "hi"']);
  assert.deepEqual(splitMcpArgs('--path "/a b"/c'), ["--path", "/a b/c"]);
  assert.deepEqual(splitMcpArgs('-c "abc'), ["-c", "abc"], "未闭合引号：余下内容算一个参数，不丢");
  assert.deepEqual(splitMcpArgs('"" x'), ["", "x"], "空引号是一个空参数");
});

test("回填与解析往返一致（编辑已有服务器时不能改坏参数）", () => {
  const cases = [
    ["-y", "@scope/mcp-server"],
    ["-c", "export A=1; exec node /x/y.mjs"],
    ["--flag", "a b", 'quote"inside', "plain"],
    [],
    ["$PATH;", "no-quote-needed-here"],
  ];
  for (const args of cases) {
    assert.deepEqual(splitMcpArgs(formatMcpArgs(args)), args, `往返失败：${JSON.stringify(args)}`);
  }
  assert.equal(formatMcpArgs(null), "");
});

test("现场那条被拆坏的配置：按正确写法重新分词后是一整个脚本参数", () => {
  const mangled = splitMcpArgs("-c export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH; export QIAOMU_CODEX_BIN=/Users/gdy/.local/bin/codex; exec /usr/local/bin/node /x/mcp-server.mjs");
  assert.ok(mangled.length > 5, "旧行为会把这条命令拆成很多碎片");
  const fixed = splitMcpArgs('-c "export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH; export QIAOMU_CODEX_BIN=/Users/gdy/.local/bin/codex; exec /usr/local/bin/node /x/mcp-server.mjs"');
  assert.equal(fixed.length, 2);
  assert.equal(fixed[0], "-c");
  assert.match(fixed[1], /^export PATH=.*exec \/usr\/local\/bin\/node/);
});
