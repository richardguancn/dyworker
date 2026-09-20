# Skill Evals

参考 OpenAI《用 Evals 系统化测试 Agent Skills》为 DYWorker 的技能（Skill）建立的评测闭环：

```
Prompt 集（CSV）→ 无头运行 Agent + 落盘 JSONL trace → 确定性检查 → 可选模型 rubric 评分 → 汇总
```

## 运行

```bash
export DYWORKER_EVAL_ENDPOINT=https://api.deepseek.com/responses
export DYWORKER_EVAL_API_KEY=sk-...
export DYWORKER_EVAL_MODEL=deepseek-v4-flash

npm run eval:skills -- setup-demo-app            # 跑全部用例
npm run eval:skills -- setup-demo-app --case test-01   # 只跑指定用例
npm run eval:skills -- setup-demo-app --rubric   # 追加第二轮只读的模型 rubric 评分
```

每个用例在临时工作区中运行，`trace` 事件写入 `evals/artifacts/<skill>/<case>.jsonl`，rubric 结果写入 `<case>.style.json`。任一必过项失败时进程退出码为 1。

## 目录结构

- `fixtures/skills/<name>/SKILL.md` — 被测技能（运行时装进临时工作区的 `.agents/skills/`）
- `skills/<name>.prompts.csv` — 评测用例：`id,should_trigger,prompt`，至少保留一条 `should_trigger=false` 的负向对照
- `skills/<name>.checks.mjs` — 该技能的确定性检查，导出 `checks: [{id, run(ctx)}]`，可选导出 `rubricPrompt`
- `style-rubric.schema.json` — rubric 评分输出结构
- `lib/runner.mjs` — 运行器（CSV 解析 / runAgent 无头运行 / 确定性检查 / 模型评分 / 汇总）

## 约定

- 触发判定：trace 中出现以该技能 `skill_id` 为参数的 `load_skill` 工具调用。
- 通用检查：`status-done`、`skill-triggered`、`command-count`（防命令空转，默认上限 60）、`token-budget`。
- 离线自测（不需要 API key）：`npm run test:evals`。
- 每次手动修复过的问题，都应该变成 CSV 或 checks 里的一行，让回归可持续被发现。
