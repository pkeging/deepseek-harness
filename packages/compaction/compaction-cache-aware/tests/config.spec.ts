import { describe, expect, it } from 'vitest'
import { resolveConfig, DEFAULTS } from '../src/config.ts'

describe('resolveConfig', () => {
  it('returns defaults for empty config', () => {
    expect(resolveConfig({})).toEqual(DEFAULTS)
  })

  it('merges provided values with defaults', () => {
    const config = resolveConfig({
      enableCacheOptimization: false,
      cachePreservationPriority: 0.5,
      minCacheReuseRatio: 0.3,
      enabled: false,
    })
    expect(config.enableCacheOptimization).toBe(false)
    expect(config.cachePreservationPriority).toBe(0.5)
    expect(config.minCacheReuseRatio).toBe(0.3)
    expect(config.enabled).toBe(false)
  })

  it('rejects unknown keys', () => {
    expect(() => resolveConfig({ unknownKey: true } as never)).toThrow('unknown key')
  })

  it('rejects invalid cachePreservationPriority', () => {
    expect(() => resolveConfig({ cachePreservationPriority: -0.1 })).toThrow()
    expect(() => resolveConfig({ cachePreservationPriority: 1.1 })).toThrow()
  })

  it('rejects invalid minCacheReuseRatio', () => {
    expect(() => resolveConfig({ minCacheReuseRatio: -0.1 })).toThrow()
    expect(() => resolveConfig({ minCacheReuseRatio: 1.1 })).toThrow()
  })
})
