# Agent Note: 渐进式工具披露（延迟 tool_search）

Status: implemented
Archived: 2026-11-08

[English](2026-08-26-deferred-tool-disclosure.md) | 中文

## 问题

当注册的工具很多时——尤其是 MCP 自动发现、成批到来的工具——每个请求的工具 schema 成本会主导提示词，挤占任务上下文。每个 agent 轮次都要为所有可见工具支付完整 JSON Schema 的开销，哪怕模型根本不会调用其中大多数。`tools` 能力已支持展示模式（`native`/`code`/`both`）和作用域限制，但都是静态的：工具要么完全可见，要么隐藏，缺少一种「可发现但延迟其参数开销、直到模型真正需要」的中间态。

## 决策

`@deepseek-ai/dsh-deferred-disclosure` 是一个基于 `ctx.tools` 与 `ctx.systemPrompt` 的组合插件，在模型主动索取前先 withholding 工具的参数 schema：

- **加载工具。** 注册始终完全可见的 `tool_search(name)`，返回目标工具的完整 `{ name, description, parameters }` schema，并针对调用 agent 的 scope 揭示该工具。
- **装配转换。** 一个 `system-prompt/assemble` 瀑布监听器，将名称匹配 `deferPatterns` 通配符（`*` 通配，如 `mcp__*`）的工具的 `parameters` 剥离，替换为空参数 schema，并在描述中追加 `[deferred …]` 提示。`tool_search` 自身永不被延迟。
- **按 scope 粘性揭示。** 揭示以 agent 的 `ScopeKey` 为键（通过 `scopeOf(agent.ctx)` 取得，与监听器收到的 `context.scope` 同一键），因此工具一旦被加载，在该 agent 生命周期内保持完整。该 scope 后续装配的请求保留完整 schema，模型从下一轮起即可调用该工具。
- **默认关闭。** `deferPatterns` 默认为 `[]`；空列表使插件成为空操作（所有 schema 保持可见），但仍注册 `tool_search`。
- **不改 loop。** 该插件是纯展示层：既不改动 `tools/pre-execute`/`tools/execute`，也不改动 agent loop。工具调用仍走正常管线；被延迟的工具只是在某次请求中缺少 schema，直到被揭示。

该插件在其 invariant companion `@deepseek-ai/dsh-deferred-disclosure` 下注册了一个空安装器：揭示状态仅私属于一个 assemble 监听器与一个工具，因此不拥有任何跨记录的运行期关系。

## 考虑的替代方案

**始终展示全部 schema（现状）。** 否决：对工具繁多的部署，schema 成本随工具数线性增长，挤占模型真正需要的上下文。

**完全隐藏被延迟工具（从 bind_tools 中移除）。** 否决：那样模型甚至无法发现工具存在、也无法用其名称调用 `tool_search`；保留名称+提示才能维持可发现性。

**按模型上一条消息动态披露。** 否决：这会引入每轮依赖提示词的抖动与 KV 缓存失效，而按需揭示是一次有界的单次提升。

**用计时器或预算而非 `tool_search` 来揭示。** 否决：只有模型自己知道何时需要某工具的参数；外部启发式要么过度披露（成本），要么披露不足（调用被阻）。

## 后果

每个被延迟工具在揭示前每轮只付出「名称 + 简短提示」的成本，而非完整 JSON Schema。被揭示的工具在该 agent 余下生命周期内恢复完整每轮成本。揭示会改变装配出的提示词，因此可能从首个变更的 schema token 起使 KV 缓存复用失效。

该机制基于名称：`deferPatterns` 匹配工具名，而非能力或 provider。不支持跨 agent 共享——不同 agent 需各自重新检索。被延迟工具在请求中仍保留空参数 schema，因此忽略提示的模型仍可用无参方式调用它，并得到正常的参数校验错误，而非干净的「未知工具」。
