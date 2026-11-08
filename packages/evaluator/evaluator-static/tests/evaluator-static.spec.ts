import { describe, expect, it } from 'vitest'
import { EvaluatorStaticProvider } from '@deepseek-ai/dsh-evaluator-static'

function makeProvider(config?: Partial<import('@deepseek-ai/dsh-evaluator-static').Config>) {
  return new EvaluatorStaticProvider({
    failureRatioThreshold: 0.5,
    minSteps: 3,
    loopSignals: ['read'],
    ...config,
  })
}

describe('EvaluatorStaticProvider', () => {
  it('returns uncertain when no steps are provided', async () => {
    const p = makeProvider()
    const r = await p.evaluate({ goal: 'test', steps: [] })
    expect(r.category).toBe('uncertain')
    expect(r.explanation).toContain('No steps')
  })

  it('returns progress-stalled when failure ratio exceeds threshold', async () => {
    const p = makeProvider()
    const r = await p.evaluate({
      goal: 'fix bugs',
      steps: [
        { toolName: 'read', success: false, summary: 'failed' },
        { toolName: 'edit', success: false, summary: 'failed' },
        { toolName: 'bash', success: true, summary: 'ran command' },
      ],
    })
    expect(r.category).toBe('progress-stalled')
    expect(r.progressScore).toBeLessThan(0.5)
  })

  it('returns approach-error on repeated loop-signal tool', async () => {
    const p = makeProvider()
    const r = await p.evaluate({
      goal: 'find the bug',
      steps: [
        { toolName: 'read', success: true, summary: 'read file 1' },
        { toolName: 'read', success: true, summary: 'read file 2' },
        { toolName: 'read', success: true, summary: 'read file 3' },
      ],
    })
    expect(r.category).toBe('approach-error')
    expect(r.suggestion).toBeDefined()
  })

  it('returns progress-ok when all steps succeed with summaries', async () => {
    const p = makeProvider()
    const r = await p.evaluate({
      goal: 'implement feature',
      steps: [
        { toolName: 'read', success: true, summary: 'read spec' },
        { toolName: 'edit', success: true, summary: 'wrote code' },
        { toolName: 'bash', success: true, summary: 'ran tests' },
      ],
    })
    expect(r.category).toBe('progress-ok')
    expect(r.progressScore).toBeGreaterThan(0.8)
  })

  it('forwards abort signal', async () => {
    const p = makeProvider()
    const ac = new AbortController()
    ac.abort()
    await expect(p.evaluate({ goal: 'g', steps: [] }, ac.signal))
      .rejects.toThrow(/abort|cancelled/i)
  })

  it('has stable id', () => {
    expect(makeProvider().id).toBe('static')
  })

  it('does not flag non-loop-signal tools as loops', async () => {
    const p = makeProvider({ loopSignals: ['read'] })
    const r = await p.evaluate({
      goal: 'g',
      steps: [
        { toolName: 'bash', success: true, summary: 'run 1' },
        { toolName: 'bash', success: true, summary: 'run 2' },
        { toolName: 'bash', success: true, summary: 'run 3' },
      ],
    })
    // bash is not a loop signal, so should not trigger approach-error
    expect(r.category).not.toBe('approach-error')
  })
})
