# embedding/ — embedding capability family

English | [中文](README.zh.md)

Text-to-vector embeddings for semantic search, memory, knowledge bases, and other similarity consumers. The seam selects exactly one usable provider at execution time; providers plug in behind it.

| Package | Role | ctx key |
|---|---|---|
| [`embedding/`](embedding/README.md) | Service Definition: `EmbeddingRuntime`, provider registry, request/result vocabulary, `EmbeddingError` taxonomy | `ctx.embedding` |
| [`embedding-hash/`](embedding-hash/README.md) | Zero-dependency hash fallback provider (FNV-1a projection, L2-normalized) | registers on `ctx.embedding` |
| [`embedding-api/`](embedding-api/README.md) | Remote embedding API provider (OpenAI-compatible endpoints, DeepSeek `text-embedding-v3`) | registers on `ctx.embedding` |
