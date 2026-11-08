import { describe, expect, it } from 'vitest'
import { EvaluatorService } from '@deepseek-ai/dsh-evaluator'
import type { EvaluatorProvider, EvaluationRequest, EvaluationResult } from '@deepseek-ai/dsh-evaluator'

describe('EvaluatorService', () => {
  it('throws when no provider is registered', async () => {
    const { Context } = await import('@deepseek-ai/cordis')
    const ctx = new Context()
    const svc = new EvaluatorService(ctx)
    await expect(svc.evaluate({ goal: 'test', steps: [] }))
      .rejects.toThrow(/no evaluator provider/)
  })

  it('delegates to the registered provider', async () => {
    const { Context } = await import('@deepseek-ai/cordis')
    const ctx = new Context()
    const svc = new EvaluatorService(ctx)

    const provider: EvaluatorProvider = {
      id: 'mock',
      evaluate: async (_req: EvaluationRequest): Promise<EvaluationResult> => ({
        category: 'progress-ok',
        explanation: 'all good',
        progressScore: 1.0,
      }),
    }
    svc.registerProvider(provider)

    const result = await svc.evaluate({ goal: 'fix bugs', steps: [] })
    expect(result.category).toBe('progress-ok')
    expect(result.explanation).toBe('all good')
  })

  it('uses the first registered provider when multiple are present', async () => {
    const { Context } = await import('@deepseek-ai/cordis')
    const ctx = new Context()
    const svc = new EvaluatorService(ctx)

    svc.registerProvider({
      id: 'first',
      evaluate: async () => ({ category: 'progress-stalled', explanation: 'a', progressScore: 0.1 }),
    })
    svc.registerProvider({
      id: 'second',
      evaluate: async () => ({ category: 'goal-drift', explanation: 'b', progressScore: 0.2 }),
    })

    const result = await svc.evaluate({ goal: 'g', steps: [] })
    expect(result.category).toBe('progress-stalled') // first registered provider wins
  })

  it('removes a provider on dispose', async () => {
    const { Context } = await import('@deepseek-ai/cordis')
    const ctx = new Context()
    const svc = new EvaluatorService(ctx)

    const dispose = svc.registerProvider({
      id: 'ephemeral',
      evaluate: async () => ({ category: 'progress-ok', explanation: 'x' }),
    })
    dispose()

    await expect(svc.evaluate({ goal: 'g', steps: [] }))
      .rejects.toThrow(/no evaluator provider/)
  })

  it('cancellation signal is forwarded to the provider', async () => {
    const { Context } = await import('@deepseek-ai/cordis')
    const ctx = new Context()
    const svc = new EvaluatorService(ctx)

    svc.registerProvider({
      id: 'cancellable',
      evaluate: async (_req, signal) => {
        if (signal?.aborted) throw new DOMException('cancelled', 'AbortError')
        return { category: 'progress-ok', explanation: 'ok' }
      },
    })

    const ac = new AbortController()
    ac.abort()
    await expect(svc.evaluate({ goal: 'g', steps: [] }, ac.signal))
      .rejects.toThrow(/cancelled/)
  })
})
