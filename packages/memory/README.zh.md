# memory/ — 跨会话记忆能力族

English | [中文](README.zh.md)

长期、跨会话的记忆：持久化存储、语义召回和面向模型的工具。一个会话可以记住跨无关对话持续存在的事实、决策、偏好和想法。

| 包 | 角色 | ctx key |
|---|---|---|
| [`memory/`](memory/README.md) | Service Definition：`MemoryRuntime`、`MemoryEntry`/`MemoryKind` 词汇、`MemoryError` 类型体系 | `ctx.memory` |
| [`memory-sqlite/`](memory-sqlite/README.md) | SQLite 后端 Provider：版本化 schema、存储向量、余弦相似度召回 | 注册到 `ctx.memory` |
| [`tool-memory/`](tool-memory/README.md) | 面向模型的 `memory_store`、`memory_recall`、`memory_list` 工具 | 注册到 `ctx.tools` |
