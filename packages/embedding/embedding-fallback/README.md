# @deepseek-ai/dsh-embedding-fallback

English | [中文](README.zh.md)

An explicit composite embedding provider. It registers a single `EmbeddingProvider` that tries its configured candidate providers **in a fixed, operator-authored order**, so an operator can declare a degrade path (for example `['api', 'hash']`) without the embedding seam growing a hidden priority chain.

The embedding seam deliberately fails loud on missing or ambiguous providers and never selects by registration order. This plugin honors that: the runtime still picks exactly one provider (`embeddingProvider: 'fallback'`); the ladder lives inside that provider, ordered by the operator's own `order` config — not by registration order — so nothing about selection becomes implicit.

## Config

```yaml
- name: '@deepseek-ai/dsh-embedding-fallback'
  config:
    order: ['api', 'hash']   # candidate provider ids, tried in this exact order
    id: 'fallback'           # composite provider id registered into ctx.embedding
```

| Key | Required | Meaning |
|---|---|---|
| `order` | yes (non-empty) | Candidate provider ids, in preference order. The first available candidate is tried; on a runtime failure, the next available candidate is tried, until one succeeds or the list is exhausted. |
| `id` | no (default `fallback`) | The composite provider's id in `ctx.embedding`. Pin `embeddingProvider` to this id to select it. |

## How it works

- `available()` returns true when at least one configured candidate is currently available.
- `embed()` walks `order`, skipping unavailable candidates, and returns the first candidate's result; if a candidate throws, it records the error and tries the next. When every candidate fails, it throws `EMBEDDING_FALLBACK_EXHAUSTED` (wrapping the last error when it was an `EmbeddingError`).

## Model Experience

This plugin is not model-facing; it changes only how `ctx.embedding.embed` resolves a backend. Downstream consumers (semantic memory, knowledge bases) see the same `EmbeddingResult` regardless of which candidate produced it. A degrade from a remote API to a local/hash backend changes vector quality, not the contract — semantic recall may become coarser, which callers should expect when the primary backend is down.

## Known Limitations and Deferred Work

- The ladder is **operator-authored and explicit** — there is no automatic "best backend" discovery. An operator who wants API quality with offline resilience must list `['api', 'hash']` themselves.
- Every candidate is still a separately registered provider; this plugin composes them, it does not implement any backend.
- Failure of a candidate is caught per call; a candidate that hangs (rather than throws) is bounded only by the forwarded `signal`, not by this plugin.
