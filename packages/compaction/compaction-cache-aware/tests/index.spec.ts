import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CacheAwareCompaction } from '../src/index.ts'
import type { CacheAwareConfig } from '../src/types.ts'

function createPlugin(config: CacheAwareConfig = {}): CacheAwareCompaction {
  const ctx = new Context()
  return new CacheAwareCompaction(ctx, config)
}

describe('CacheAwareCompaction', () => {
  it('creates with default config', () => {
    const plugin = createPlugin()
    expect(plugin.config.enabled).toBe(true)
    expect(plugin.config.enableCacheOptimization).toBe(true)
  })

  it('respects disabled config', () => {
    const plugin = createPlugin({ enabled: false })
    expect(plugin.config.enabled).toBe(false)
  })
})

describe('estimateCacheReuseRatio', () => {
  it('returns undefined when cache optimization is disabled', () => {
    const plugin = createPlugin({ enableCacheOptimization: false })
    const result = plugin.estimateCacheReuseRatio({
      requestHeader: () => undefined,
    } as never)
    expect(result).toBeUndefined()
  })

  it('returns undefined when no request header', () => {
    const plugin = createPlugin()
    const result = plugin.estimateCacheReuseRatio({
      requestHeader: () => undefined,
    } as never)
    expect(result).toBeUndefined()
  })

  it('returns ratio when header has config', () => {
    const plugin = createPlugin()
    const result = plugin.estimateCacheReuseRatio({
      requestHeader: () => ({
        config: { provider: 'test', model: 'test' },
        system: 'System prompt text',
        tools: [],
      }),
    } as never)
    expect(typeof result).toBe('number')
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(1)
  })
})

describe('isCacheFriendly', () => {
  it('returns true when cache analysis unavailable', () => {
    const plugin = createPlugin()
    const result = plugin.isCacheFriendly({
      requestHeader: () => undefined,
    } as never)
    expect(result).toBe(true)
  })
})
