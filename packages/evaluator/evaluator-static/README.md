# evaluator-static/ — static rule-based evaluator provider

Implements a deterministic rule engine (zero LLM calls) for trajectory evaluation. Three rules:

| Rule | Trigger | Category |
|------|---------|----------|
| High failure ratio | `failures / steps >= threshold` (default 0.5, min 3 steps) | `progress-stalled` |
| Tool-loop detection | Same loop-signal tool called 3+ times consecutively (default: `read`, `grep`, `search`) | `approach-error` |
| Clean progress | All steps succeed with summaries | `progress-ok` |

## Configuration

```yaml
- id: evaluator-static
  name: '@deepseek-ai/dsh-evaluator-static'
  config:
    failureRatioThreshold: 0.5
    minSteps: 3
    loopSignals: ['read', 'grep', 'search']
```

## Invariant

This provider accesses NO live agent state. It receives only the `EvaluationRequest` payload and returns a pure `EvaluationResult`. This is what makes it a valid "external" evaluator.
