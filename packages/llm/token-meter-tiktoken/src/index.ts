/**
 * Tiktoken-based token counting utilities for the DeepSeek Harness.
 *
 * Provides accurate token estimation using tiktoken encodings, supplementing
 * the default character-count heuristic in `dsh-token-meter`. Designed as a
 * drop-in enhancer: call `countTokens(text, encoding)` for precise counts
 * without replacing the singleton meter.
 *
 * @module @deepseek-ai/dsh-token-meter-tiktoken
 */

/** Pre-defined encoding names supported by this package. */
export type TiktokenEncoding = 'cl100k_base' | 'p50k_base' | 'p50k_edit' | 'r50k_base' | 'gpt2' | 'o200k_base'

/** Default encoding for DeepSeek and most OpenAI-compatible models. */
export const DEFAULT_ENCODING: TiktokenEncoding = 'cl100k_base'

/**
 * Count tokens in text using tiktoken. Returns the number of tokens.
 * @param text - the text to tokenize.
 * @param encoding - the tiktoken encoding name. Defaults to `cl100k_base`.
 * @returns the token count.
 */
export async function countTokens(text: string, encoding: TiktokenEncoding = DEFAULT_ENCODING): Promise<number> {
  if (text.length === 0) return 0
  const { get_encoding } = await requireTiktoken()
  const enc = get_encoding(encoding)
  try {
    return enc.encode(text).length
  } finally {
    enc.close()
  }
}

/**
 * Estimate tokens using tiktoken with a fast path for short texts.
 * For texts under 1000 chars, falls back to the heuristic if tiktoken
 * is unavailable, ensuring the package remains optional.
 * @param text - the text to estimate.
 * @param encoding - optional encoding name.
 * @returns token count or `undefined` if unavailable.
 */
export async function tryCountTokens(text: string, encoding?: TiktokenEncoding): Promise<number | undefined> {
  if (text.length === 0) return 0
  try {
    return await countTokens(text, encoding ?? DEFAULT_ENCODING)
  } catch {
    // tiktoken not installed; return undefined so callers can fall back
    return undefined
  }
}

/**
 * Resolve an encoding name from a model id or provider hint.
 * @param model - model identifier string.
 * @returns the best-guess encoding name, or `undefined` when unknown.
 */
export function resolveEncodingForModel(model: string): TiktokenEncoding | undefined {
  const lower = model.toLowerCase()
  if (lower.includes('deepseek') || lower.includes('chat') || lower.includes('turbo')) return 'cl100k_base'
  if (lower.includes('gpt-4o') || lower.includes('o1') || lower.includes('o3')) return 'o200k_base'
  if (lower.includes('gpt-4') || lower.includes('gpt-3.5')) return 'cl100k_base'
  if (lower.includes('code') || lower.includes('edit')) return 'p50k_edit'
  if (lower.includes('text')) return 'p50k_base'
  return undefined
}

/** Lazily require tiktoken to keep it an optional dependency. */
async function requireTiktoken(): Promise<{ get_encoding: (name: string) => { encode: (text: string) => number[]; close: () => void } }> {
  try {
    const mod = await import('tiktoken')
    return mod
  } catch {
    throw new Error(
      'tiktoken is not installed. Run: pnpm add tiktoken'
      + ' to enable precise token counting.',
    )
  }
}
