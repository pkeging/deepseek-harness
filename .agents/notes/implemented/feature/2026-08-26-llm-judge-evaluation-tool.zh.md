# Agent Note: LLM 即裁判评估工具

状态：已实施

[English](2026-08-26-llm-judge-evaluation-tool.md) | 中文

**日期：** 2026-08-26 · **包：** `packages/evaluation/llm-judge` (`@deepseek-ai/dsh-llm-judge`)

## 为什么

`tool-ralph` 的 README 明确标注完成状态为"工人自我声明"，没有独立评估器。仓库中整个评估能力缺失——零评估代码。本插件添加了首个 LLM-as-judge 工具，填补这一空白。

## 构建内容

一个新 leaf 包：`@deepseek-ai/dsh-llm-judge`。

注册一个 `judge` 工具：

- **输入：** `objective`（字符串）、`evidence`（字符串，提示中截断至 4 000 字符）、`rubric`（字符串）。
- **分发：** 一次辅助 LLM 调用，携带固定系统提示（`"You are an objective evaluator. Return only valid JSON."`）和帧化用户提示。
- **JSON 提取：** 裸 JSON、markdown 围栏 JSON（` ```json … ``` `）或首个 `{…}` 片段——三阶段策略。
- **验证：** `score` 整数 1–10，`pass` 布尔值，`reasoning` 非空字符串。任何违规以工具错误形式暴露。
- **超时：** 可配置的 `timeoutMs`（默认 30 000），通过 `@deepseek-ai/dsh-timeout` 的 `deadline()` 强制执行。
- **配置：** `timeoutMs`、`maxOutputTokens`、可选的 `provider`/`model` 覆盖（回退到 `deepseek`/`deepseek-chat`）。
- **展示：** `generic` 调用卡；结果卡显示 `Score: N/10 · PASS/FAIL · reasoning`。

## 架构决策

1. **工具，非插件钩子。** 裁判不监听 `agent-loop` 或 `tools/post-execute`。它是操作员在需要裁决时调用的普通模型可见工具。符合"不改变编排"原则：评估器是能力接缝，不是 loop 拦截器。
2. **`type: 'json'` 输出 schema。** 值 schema DSL 不支持根级别的 `minimum`/`maximum`/`required`。使用 `type: 'json'` 绕过 DSL 限制，让工具在解析后自行验证。
3. **`deadline()` 而非 `AbortController`。** 使用仓库标准超时原语（`@deepseek-ai/dsh-timeout`），使超时行为与其他辅助调用插件（session-title、memory-agent）一致。
4. **无自动降级。** 与 `embedding-fallback` 不同，裁判使用单一固定 provider/model。操作者通过重新配置插件切换 provider，而非运行时降级。

## 覆盖

- **20 个测试**，全部通过：配置验证（4）、基础通过/失败（2）、JSON 提取（4）、裁决验证（4）、参数验证（4）、模型集成（2）。
- **类型检查** 通过（`tsc -b` 退出 0）。
- **Lint** 通过（`oxlint` 退出 0）。
- **不变量** 已注册（空安装器——无可观察的运行时间不变量）。

## 文件

```
packages/evaluation/llm-judge/
  package.json
  tsconfig.json
  src/index.ts          # apply() + judge tool
  src/invariant.ts      # invariant companion
  tests/llm-judge.spec.ts
  README.md
  README.zh.md
```

## 仓库注册

- `tsconfig.base.json`：在 `@deepseek-ai/dsh-*` 通配符列表中添加 `"./packages/evaluation/*/src"`。
- `tsconfig.host.json`：添加 `{ "path": "./packages/evaluation/llm-judge" }`。

## 门禁

- `tsc -b` 退出 0
- `oxlint` 退出 0
- `vitest run` 20/20 通过



## 已知缺口

- 仅单次调用；无多轮辩论或 deliberation。
- 依赖 JSON——拒绝输出 JSON 的模型产生错误，而非尽力裁决。
- 无工作区或会话状态访问；工具除了三个参数外无状态。
- 不自动集成到 `tool-ralph`——操作者负责连接。
