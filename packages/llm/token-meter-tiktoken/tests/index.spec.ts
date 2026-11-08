import { describe, expect, it } from 'vitest'
import { countTokens, tryCountTokens, resolveEncodingForModel, DEFAULT_ENCODING } from '../src/index.ts'

describe('countTokens', () => {
  it('returns 0 for empty text', async () => {
    expect(await countTokens('')).toBe(0)
  })

  it('throws when tiktoken is not available', async () => {
    await expect(countTokens('Hello, world!')).rejects.toThrow('tiktoken is not installed')
  })

  it('throws with encoding parameter when tiktoken is not available', async () => {
    await expect(countTokens('test', DEFAULT_ENCODING)).rejects.toThrow('tiktoken is not installed')
  })
})

describe('tryCountTokens', () => {
  it('returns 0 for empty text', async () => {
    expect(await tryCountTokens('')).toBe(0)
  })

  it('returns undefined when tiktoken is not available', async () => {
    const result = await tryCountTokens('Hello world')
    expect(result).toBeUndefined()
  })
})

describe('resolveEncodingForModel', () => {
  it('maps deepseek models to cl100k_base', () => {
    expect(resolveEncodingForModel('deepseek-chat')).toBe('cl100k_base')
    expect(resolveEncodingForModel('deepseek-coder')).toBe('cl100k_base')
  })

  it('maps GPT-4o/o1/o3 to o200k_base', () => {
    expect(resolveEncodingForModel('gpt-4o')).toBe('o200k_base')
    expect(resolveEncodingForModel('o1-preview')).toBe('o200k_base')
  })

  it('maps GPT-4/GPT-3.5 to cl100k_base', () => {
    expect(resolveEncodingForModel('gpt-4-turbo')).toBe('cl100k_base')
    expect(resolveEncodingForModel('gpt-3.5-turbo')).toBe('cl100k_base')
  })

  it('returns undefined for unknown models', () => {
    expect(resolveEncodingForModel('unknown-model')).toBeUndefined()
  })
})
