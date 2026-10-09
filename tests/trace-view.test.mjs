// 轨迹视图（对齐 DSH 官方「轨迹」观感）的结构契约。
//
// 为什么用源码文本钉：这些是"看着就不对"的观感契约——工具栏只有三个开关、时间条是三道泳道、
// 检查面板是三页签且带请求计时。改动时先在这里看清单，别把官方那套结构改散了。
// 依赖注入式的 DOM 测试在这套仓库里没有基建（没有 jsdom/react-dom），文本层面够用。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

const view = read("../src/TraceView.tsx");
const css = read("../src/styles.css");
const model = read("../src/traceModel.ts");

/** 取出某个选择器的规则体（源码文本层面，够用且不依赖 CSS 解析器） */
function rule(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start > 0, `styles.css 里应有 ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

test("轨迹工具栏：三个开关（时长 / 轮次 / 调用）+ 搜索，按钮语义照官方", () => {
  for (const label of ["时长", "轮次", "调用"]) {
    assert.match(view, new RegExp(`label: "${label}"`), `工具栏要有「${label}」开关`);
  }
  assert.match(view, /placeholder: "搜索"/, "搜索框占位符是「搜索」");
  assert.match(view, /ariaLabel: "使用实际时长"/, "「时长」的 aria-label 恒为「使用实际时长」");
  assert.match(view, /ariaLabel: turnsCollapsed \? "展开所有轮次" : "收起所有轮次"/);
  assert.match(view, /ariaLabel: callsCollapsed \? "展开所有调用" : "收起所有调用"/);
  // 折叠摘要用官方那两句文案，不再是「N 行已收起」
  assert.match(view, /个步骤 · \$\{turn\.toolCount\} 个工具调用/);
  assert.match(view, /个工具调用 · \$\{\[\.\.\.new Set/);
});

test("轨迹时间条：三道泳道（输入 / 模型 / 工具），块是 8px 细条", () => {
  const lanes = view.slice(view.indexOf("const LANES"), view.indexOf("const BADGE"));
  assert.deepEqual(
    [...lanes.matchAll(/label: "(输入|模型|工具)"/g)].map((match) => match[1]),
    ["输入", "模型", "工具"],
    "泳道顺序照官方：输入 / 模型 / 工具",
  );
  assert.match(view, /data-lane/, "块要带 data-lane，样式才分得开");
  assert.match(view, /data-error/, "失败的工具块要标数据属性");
  assert.match(view, /data-current/, "选中块要能画蓝环");
  assert.match(view, /data-match/, "搜索未命中的块要压暗");
  assert.match(view, /--trv-ttft/, "模型块两段色靠首 token 比例");
  assert.match(rule(".trv-trace-span"), /height:\s*8px/, "官方块高 8px");
  assert.match(rule(".trv-trace-timeline"), /height:\s*50px/, "官方时间条整体 50px");
  assert.match(css, /\.trv-trace-span\[data-lane="tool"\] \{ background: #e8930c/, "工具=警示橙");
  assert.match(css, /\.trv-trace-span\[data-error="true"\] \{ background: #e04b4b/, "失败=红");
  assert.match(css, /\.trv-trace-span\[data-match="false"\] \{ opacity: 0\.14/, "未命中压暗到 0.14（官方同值）");
  // 旧的「每轮一根时长柱」不该回来
  assert.doesNotMatch(css, /\.trv-trace-bar/, "旧的竖直时长柱已删除，别再混进来");
});

test("轨迹台账：轮次头 + 用户 / 助手 / 工具 / 标记行，工具行是 name args → result", () => {
  assert.match(view, /第 \$\{turn\.turn\} 轮/, "轮次头写「第 N 轮」");
  assert.match(view, /input: "用户"/, "用户行徽标");
  assert.match(view, /assistant: "助手"/, "助手行徽标");
  assert.match(view, /tool: "工具"/, "工具行徽标");
  assert.match(view, /trv-trace-row-arrow" \}, "→"/, "结果前有 → 分隔");
  assert.match(view, /call\.result \? firstLine\(call\.result, 110\) : call\.endedAt \? "无输出" : "等待中"/, "工具没输出/还在跑要有官方兜底文案");
  assert.match(view, /（仅工具调用）/, "只有工具调用的助手行照官方写「（仅工具调用）」");
});

test("轨迹检查面板：概述 / 预览 / 原始内容三页签 + 请求计时五项", () => {
  for (const label of ["概述", "预览", "原始内容"]) {
    assert.match(view, new RegExp(`\\["(summary|preview|raw)", "${label}"\\]`), `缺页签「${label}」`);
  }
  assert.match(view, /助手 第 \$\{request\.turn\} 轮 · 第 \$\{request\.step \+ 1\} 步/, "标题格式「助手 第 N 轮 · 第 M 步」（步号按 1 基显示）");
  for (const label of ["开始时间", "总时长", "首 token 延迟", "生成", "吞吐量"]) {
    assert.match(view, new RegExp(`label: "${label}"`), `请求计时缺「${label}」`);
  }
  // 缺数据的兜底文案照官方，不编数
  assert.match(view, /"首 token 时间不可用"/);
  assert.match(view, /"输出 token 数不可用"/);
  assert.match(view, /"时长过短"/);
  assert.match(view, /等待中/);
  assert.match(view, /title: "思考", defaultOpen: false/, "思考默认折叠，挂在预览下面");
  assert.match(css, /\.trv-trace-inspector \{[^}]*width: clamp\(320px, 38%, 440px\)/, "检查面板宽度照官方 clamp");
});

test("轨迹数据层：首 token 参与建模，时间条跨度可回放历史会话", () => {
  assert.match(model, /export interface TraceSpan/);
  assert.match(model, /spans: TraceSpan\[\]/);
  assert.match(model, /firstTokenMs/);
  assert.match(model, /generationMs/);
  assert.match(model, /throughput/);
  assert.match(model, /userMessageTimesOf/, "输入道要靠会话消息的 createdAt 定位");
  assert.match(model, /"model-first-token"/, "首 token 事件是计时拆分的唯一来源");
});
