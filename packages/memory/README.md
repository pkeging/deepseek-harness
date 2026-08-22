# memory/ — cross-session memory capability family

English | [中文](README.zh.md)

Long-term, cross-session memory: durable storage, semantic recall, and model-facing tools. A session can remember facts, decisions, preferences, and ideas that persist across unrelated conversations.

| Package | Role | ctx key |
|---|---|---|
| [`memory/`](memory/README.md) | Service Definition: `MemoryRuntime`, `MemoryEntry`/`MemoryKind` vocabulary, `MemoryError` taxonomy | `ctx.memory` |
| [`memory-sqlite/`](memory-sqlite/README.md) | SQLite-backed provider: versioned schema, stored embeddings, cosine-similarity recall | registers on `ctx.memory` |
| [`tool-memory/`](tool-memory/README.md) | Model-facing `memory_store`, `memory_recall`, and `memory_list` tools | registers on `ctx.tools` |
