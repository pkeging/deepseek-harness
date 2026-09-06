# intent-guard/ — intent drift detection capability family

English | [中文](README.zh.md)

Detects when an agent's step sequence is drifting away from its declared goal. Two layers:

| Layer | Detection | Mechanism |
|-------|-----------|-----------|
| **L1** | Tool repetition, consecutive failures | Pattern matching on `tools/post-execute` |
| **L2** | Semantic divergence from goal | Cosine similarity on embeddings, sampled every N steps |

When drift exceeds the configured threshold, a `DriftSignal` is injected into the next step's context as a model-visible notice. The service does NOT block steps — it enriches, never vetos.

## Packages

| Package | Role | `ctx` key |
|---|---|---|
| [`intent-guard/`](intent-guard/README.md) | Service Definition: `IntentGuardService`, `DriftSignal`, `StepRecord` | `ctx.intentGuard` |
| [`intent-guard-checker/`](intent-guard-checker/README.md) | L1 + L2 provider: registers on `ctx.intentGuard` | — |
| [`tool-intent-guard/`](tool-intent-guard/README.md) | Model-facing `intent_guard` tool | registers on `ctx.tools` |

## Integration

Mount in `cordis.yml`:

```yaml
- id: intent-guard
  name: '@deepseek-ai/dsh-intent-guard'

- id: intent-guard-checker
  name: '@deepseek-ai/dsh-intent-guard-checker'
  config:
    repetitionThreshold: 3
    failureThreshold: 5
    semanticDivergenceThreshold: 0.65
    embedSamplingInterval: 5

- id: tool-intent-guard
  name: '@deepseek-ai/dsh-tool-intent-guard'
```

Requires `ctx.embedding` (install `@deepseek-ai/dsh-embedding-api` for L2 support) and `ctx.goals` (installed by `dsh-base` bundle).

## Model Experience

The `intent_guard` tool returns a structured JSON report with `drift_detected`, `drift_kind`, `drift_severity`, and `recommendation`. When L2 drift fires, a model-visible notice is also injected at the next turn boundary with the similarity score and a prompt to reassess.

#### KV Cache effect

None directly; the checker observes step history but does not modify the request prefix.

## Known Limitations and Deferred Work

- **L2 requires `ctx.embedding`**: without an embedding provider, only L1 (pattern) detection is active.
- **Embedding cost**: L2 samples every N steps (configurable); a low `embedSamplingInterval` increases API calls.
- **Goal dependency**: drift detection against a goal requires an active `goal` — agents without goals only get L1 repetition/failure signals.
