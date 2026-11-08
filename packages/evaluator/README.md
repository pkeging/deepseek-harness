# evaluator/ — external evaluator capability family

Provides an **independent** evaluation seam (`ctx.evaluator`) whose providers MUST NOT access the live agent context. This independence is the key invariant: the evaluator's judgment comes from a separate reasoning chain, not from the primary agent's own self-assessment.

## Packages

| Package | Role | `ctx` key |
|---|---|---|
| [`evaluator/`](evaluator/README.md) | Service Definition: `EvaluatorService`, `EvaluationRequest`, `EvaluationResult` | `ctx.evaluator` |
| [`evaluator-static/`](evaluator-static/README.md) | Rule-based provider: deterministic trajectory health check | registers on `ctx.evaluator` |
| [`tool-evaluator/`](tool-evaluator/README.md) | Model-facing `query_evaluator` tool | registers on `ctx.tools` |

## Design invariant

An evaluator provider receives ONLY the explicit `EvaluationRequest` payload — never `ctx.agent`, `ctx.tools`, or any live state. This ensures the evaluation is independent of the primary agent's reasoning chain and cannot be influenced by the agent's own self-presentation.

## Integration

```yaml
- id: evaluator
  name: '@deepseek-ai/dsh-evaluator'

- id: evaluator-static
  name: '@deepseek-ai/dsh-evaluator-static'
  config:
    failureRatioThreshold: 0.5
    minSteps: 3
    loopSignals: ['read', 'grep', 'search']

- id: tool-evaluator
  name: '@deepseek-ai/dsh-tool-evaluator'
```

## Model Experience

The `query_evaluator` tool accepts an array of recent steps and returns a categorized judgment (`progress-ok` | `progress-stalled` | `goal-drift` | `approach-error` | `context-missing` | `uncertain`) with an explanation and optional suggestion.

#### KV Cache effect

None; the tool is a synchronous dispatch to the rule engine (no LLM call in the static provider).

## Known Limitations and Deferred Work

- **Static provider is rule-only**: it detects patterns (repetition loops, high failure ratio) but cannot assess semantic goal alignment — that requires an LLM-based evaluator (deferred).
- **Step history is agent-provided**: the model passes its own recent steps to the tool; a dishonest or confused model could omit relevant failures. Future versions may read steps from the session log directly.
- **No cross-session evaluation**: each evaluation is scoped to the current session's steps.
