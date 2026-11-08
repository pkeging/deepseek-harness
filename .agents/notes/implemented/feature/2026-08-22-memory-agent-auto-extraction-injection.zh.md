# Agent Note：自动记忆提取与注入

状态：implemented

[English](2026-08-22-memory-agent-auto-extraction-injection.md) | 中文

## 问题

用户的持久事实、偏好、决策和想法在一个会话中出现，又随会话一起消失。memory 能力缝（`@deepseek-ai/dsh-memory`）持久化条目，但写入是手动的：模型必须自己注意到并调用记忆工具，因此除非某一轮恰好提及，否则什么都不会保存。每个新会话都从空开始，"我们之前聊过什么？"这类问题除了模型偶然重建的内容之外没有答案。

## 决策

`@deepseek-ai/dsh-memory-agent` 是建立在 `memory`、`systemPrompt` 和 `llm` 服务之上的组合插件，让记忆保留变得自动且尽力而为：

- **注入。** 一个 `system-prompt/assemble` waterfall 监听器召回与当前用户消息语义最接近的前 `recallLimit` 条（默认 5，阈值 0.3），并以可配置的 `sectionOrder`（默认 150）插入为 `memory:relevant` 区块。该区块是建议性的：标题告诉模型不要直接提及。召回失败或结果为空时，assembly 保持不变。
- **回顾检测。** 匹配回顾关键词（中文和英文的回忆短语）的用户消息将召回上限提高到 `reviewLimit`（默认 12），并切换标题为指示模型根据记忆如实回答，使"我们之前聊过什么？"得到真正的答案。
- **提取。** 在 `agent/turn-stopping` 时，一次辅助 LLM 调用从最近一轮对话的转录中蒸馏值得记住的事实、决策、偏好和想法。提取是 fire-and-forget 的，带有按会话的冷却（`extractCooldownSec`，默认 60）、`deadline` 支撑的超时，以及针对已存储条目的余弦相似度去重（`dedupeThreshold`，默认 0.9）。提取路由来自 `extractProvider`/`extractModel` 配置，或回退到最近的 `request/header` 路由。
- **配置校验。** 每个可调项都是经过校验的 `Config` 字段；`extractProvider` 和 `extractModel` 必须同时提供。无效配置在加载时大声失败，而不是静默。
- **尽力而为契约。** 失败通过 `ctx.logger.warn` 记录，绝不阻塞或在 agent loop 中显现。`autoExtract`（默认 true）可以关闭提取而保留注入。

该包以空 installer 注册其 invariant companion `@deepseek-ai/dsh-memory-agent`：该插件组合了由 memory 和 llm 包所有的契约，因此它不拥有任何跨记录运行时关系。

## 考虑过的替代方案

**仅通过现有记忆工具手动记忆。** 被否决：关键在于保留不应依赖模型注意到并选择保存。agent 插件增加自动化路径，而工具仍用于显式写入。

**每轮都提取且无冷却。** 被否决：辅助 LLM 调用每轮都要花费 token 和延迟。按会话的冷却限制了开销，fire-and-forget 路径使用户的轮次不必等待。

**将全部存储的记忆注入每个请求。** 被否决：token 成本和 prompt 噪音无界增长。带阈值和上限的语义召回使注入保持小而相关，仅在明确的回顾查询时使用更大的预算。

**在 `turn/end` 内同步提取。** 被否决：loop 会在用户可见的边界等待辅助模型调用。`agent/turn-stopping` 触发工作而不等待它。

## 后果

每个模型请求支付一次嵌入召回（受 `recallLimit` 限制，可通过降低阈值或禁用插件跳过）。每一轮可能支付一次用于提取的辅助 LLM 调用，受冷却和去重抑制。

记忆以可移除的命名区块进入 prompt，因此其他 prompt provider 或 preset 可以过滤或重排 `memory:relevant`。回顾关键词列表是固定常量——扩展它是代码变更，而不是配置。

提取质量取决于配置的路由或最近一次请求的路由：从未运行过模型请求的会话没有可提取的转录，会话中途的路由变更跟随最新的 header。
