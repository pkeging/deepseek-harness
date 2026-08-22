# embedding/ — 嵌入能力族

English | [中文](README.zh.md)

为语义搜索、记忆、知识库等相似度消费者提供文本到向量的嵌入。能力缝在执行时选定唯一可用的 Provider；Provider 在缝背后插入。

| 包 | 角色 | ctx key |
|---|---|---|
| [`embedding/`](embedding/README.md) | Service Definition：`EmbeddingRuntime`、Provider 注册表、请求/结果词汇、`EmbeddingError` 类型体系 | `ctx.embedding` |
| [`embedding-hash/`](embedding-hash/README.md) | 零依赖哈希兜底 Provider（FNV-1a 投影、L2 归一化） | 注册到 `ctx.embedding` |
| [`embedding-api/`](embedding-api/README.md) | 远程嵌入 API Provider（OpenAI 兼容端点、DeepSeek `text-embedding-v3`） | 注册到 `ctx.embedding` |
