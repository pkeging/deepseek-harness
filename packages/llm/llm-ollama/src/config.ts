/**
 * Configuration for the Ollama adapter.
 *
 * @module @deepseek-ai/dsh-llm-ollama/config
 */

import z from '@deepseek-ai/schemastery'

/** Where a stock Ollama daemon listens. */
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'

/** Plugin configuration for the local Ollama provider. */
export interface Config {
  /** Daemon base URL. Defaults to {@link DEFAULT_OLLAMA_BASE_URL}. */
  baseURL?: string
  /** Model served by the daemon; Ollama's own default is `llama3.2`. */
  model?: string
  /** Per-request deadline in milliseconds, covering the whole streamed response. */
  timeoutMs?: number
  /** Default output-token cap when a request carries none. */
  maxTokens?: number
  /**
   * How long the daemon keeps the model resident after a request. Ollama's
   * duration string, e.g. `5m`; `0` unloads immediately.
   */
  keepAlive?: string
}

export const Config: z<Config> = z.object({
  baseURL: z.string(),
  model: z.string(),
  timeoutMs: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  keepAlive: z.string(),
})

/** Fully defaulted connection facts one adapter instance serves. */
export interface ResolvedConfig {
  readonly baseURL: string
  readonly model: string
  readonly timeoutMs: number
  readonly maxTokens: number | undefined
  readonly keepAlive: string | undefined
}

/**
 * Apply documented defaults to one validated config.
 * @param config - the plugin's validated configuration.
 * @returns the connection facts the adapter serves every request with.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  return {
    baseURL: normalizeBaseURL(config.baseURL ?? DEFAULT_OLLAMA_BASE_URL),
    model: config.model ?? 'llama3.2',
    timeoutMs: config.timeoutMs ?? 120_000,
    maxTokens: config.maxTokens,
    keepAlive: config.keepAlive,
  }
}

/**
 * Trim one configured base URL to a form endpoint paths can be appended to.
 * @param baseURL - the configured daemon URL.
 * @returns the URL without a trailing slash.
 * @throws when the value is not an absolute http(s) URL.
 */
function normalizeBaseURL(baseURL: string): string {
  let parsed: URL
  try {
    parsed = new URL(baseURL)
  } catch {
    throw new Error(`llm-ollama: baseURL "${baseURL}" is not an absolute URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`llm-ollama: baseURL "${baseURL}" must use http or https`)
  }
  return parsed.toString().replace(/\/$/, '')
}
