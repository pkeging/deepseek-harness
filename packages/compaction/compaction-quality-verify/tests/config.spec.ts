import { describe, expect, it } from 'vitest'
import { resolveConfig, DEFAULTS } from '../src/config.ts'

describe('resolveConfig', () => {
  it('returns defaults for empty config', () => {
    expect(resolveConfig({})).toEqual(DEFAULTS)
  })

  it('merges provided values with defaults', () => {
    const config = resolveConfig({
      minSummaryLength: 32,
      maxMissingFactRatio: 0.5,
      enabled: false,
    })
    expect(config.minSummaryLength).toBe(32)
    expect(config.maxMissingFactRatio).toBe(0.5)
    expect(config.enabled).toBe(false)
    expect(config.factCategories).toEqual(DEFAULTS.factCategories)
  })

  it('rejects unknown keys', () => {
    expect(() => resolveConfig({ unknownKey: true } as never)).toThrow('unknown key')
  })

  it('rejects invalid minSummaryLength', () => {
    expect(() => resolveConfig({ minSummaryLength: 0 })).toThrow()
    expect(() => resolveConfig({ minSummaryLength: -1 })).toThrow()
  })

  it('rejects invalid fact categories', () => {
    expect(() => resolveConfig({ factCategories: ['invalid'] as never[] })).toThrow()
  })
})
