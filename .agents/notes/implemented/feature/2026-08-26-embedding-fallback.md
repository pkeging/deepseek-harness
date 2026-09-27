# Agent Note: 显式组合式 Embedding Provider（降级阶梯）

状态：已实施

English | [中文](2026-08-26-embedding-fallback.zh.md)

## 问题

embedding seam 已经存在多个后端（`embedding-api` 远端 API、`embedding-hash` 本地 hash、基础 `embedding` 包），但选择器**刻意禁止隐式降级链**：`ctx.embedding` 要求恰好一个可用 provider 或一个显式配置的 id，失败时 loud 抛出。这保护了架构——选择从不依赖注册顺序——但也意味着主后端宕机时没有韧性：跨会话语义记忆会整体不可用。

## 决策

`@deepseek-ai/dsh-embedding-fallback` 注册一个**显式的组合 provider**，由操作员在 `order` 配置中声明降级阶梯（例如 `['api', 'hash']`）。它的关键约束：

- **运行时仍只选一个 provider**——`embeddingProvider: 'fallback'`。组合 provider 的阶梯逻辑在其内部，不改变运行时选择语义。
- **顺序由操作员声明，不是注册顺序**——`order: ['api', 'hash']` 显式编码偏好。
- **不引入隐式链**——`embedding` seam 的 `resolveProvider` 依然严格按单一 provider 决策；本插件是它的 consumer，不是它的修改者。
- **失败时仍 loud**——所有候选都失败时抛 `EMBEDDING_FALLBACK_EXHAUSTED`，不静默降级到空结果。

为支持组合 provider 反向查候选，给 `EmbeddingRuntime` 加了只读 `getProvider(id)` 访问器，不改变 selection 语义。

## 替代方案

**静默自动降级（API→hash 隐藏链）**。否决：违反 embedding seam 已有注释"selection never depends on registration order"和"misconfiguration fails loud"的设计不变量，会把隐式优先级链重新引入 seam。

**让操作员手动切换 `embeddingProvider`**（API 宕机时改配 hash）。否决：人工干预无法应对运行时故障；组合 provider 的阶梯是声明式的运行时决策。

## 后果

每个 `ctx.embedding.embed` 调用现在先尝试 `order[0]`，失败后尝试下一个可用候选。主后端宕机时语义记忆降级到 hash 向量（质量更粗但语义结构保持）。操作员必须显式列出阶梯——这保留了「失败 loud」语义，把韧性决策权交还给部署者。
