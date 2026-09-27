/**
 * Local Ollama provider plugin.
 *
 * Registers one `llm` adapter route so a daemon-served model becomes selectable
 * exactly like a hosted provider. Mounting the plugin is the opt-in: the route
 * name and the daemon URL come from this entry's config.
 *
 * @module @deepseek-ai/dsh-llm-ollama
 */

import type { Context } from '@deepseek-ai/cordis'
import { OllamaAdapter } from './adapter.ts'
import { resolveConfig } from './config.ts'
import type { Config } from './config.ts'

export { OllamaAdapter } from './adapter.ts'
export { DEFAULT_OLLAMA_BASE_URL, Config, resolveConfig } from './config.ts'
export type { Config as OllamaConfig, ResolvedConfig } from './config.ts'
export type { OllamaChatMessage, OllamaChatChunk, OllamaToolCall } from './wire.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'llm-ollama'

/** The provider route this plugin owns. */
export const OLLAMA_PROVIDER = 'ollama'

/** Services this plugin injects. */
export const inject = ['llm']

/**
 * Register the local daemon as one `llm` route.
 * @param ctx - plugin context supplying the LLM registry.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.llm.registerAdapter([OLLAMA_PROVIDER], new OllamaAdapter(resolveConfig(config)))
}
