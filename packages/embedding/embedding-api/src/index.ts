/**
 * API-based embedding provider for `ctx.embedding`.
 * Calls a remote embedding API (e.g. DeepSeek embeddings endpoint) to produce
 * semantic vector embeddings. Requires an API key and endpoint configuration.
 *
 * @module @deepseek-ai/dsh-embedding-api
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-embedding'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import {
  ApiEmbeddingProvider,
  DEFAULT_API_BASE_URL,
  DEFAULT_EMBEDDING_MODEL,
} from './provider.ts'
import type { ApiEmbeddingProviderConfig } from './provider.ts'

export {
  ApiEmbeddingProvider,
  API_PROVIDER_ID,
  DEFAULT_API_BASE_URL,
  DEFAULT_EMBEDDING_MODEL,
} from './provider.ts'
export type { ApiEmbeddingProviderConfig } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'embedding-api'

/** The embedding seam this provider registers into. */
export const inject = ['embedding']

const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each request; defaults to `DEEPSEEK_API_KEY`. */
  apiKeyEnv?: string
  /** Embedding API base URL. Defaults to DeepSeek's endpoint. */
  baseURL?: string
  /** Embedding model name. Defaults to `text-embedding-v3`. */
  model?: string
  /** Output vector dimension (for models that support it). */
  dimensions?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  model: z.string().default(DEFAULT_EMBEDDING_MODEL),
  dimensions: z.number().step(1).min(1),
})

/**
 * Environment variable naming this provider's endpoint. Deliberately distinct
 * from the chat-completions base URL, matching the pattern used by search.
 */
const EMBEDDING_BASE_URL_ENV = 'DEEPSEEK_EMBEDDING_BASE_URL'

/**
 * Project one resolved section into the options the provider serves its next
 * embedding with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 *
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one embedding request.
 */
function resolveOptions(ctx: Context, config: Config): ApiEmbeddingProviderConfig {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  const result: ApiEmbeddingProviderConfig = {
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    baseURL: config.baseURL
      ?? launchEnvironmentOf(ctx).get(EMBEDDING_BASE_URL_ENV)?.value
      ?? DEFAULT_API_BASE_URL,
    model: config.model ?? DEFAULT_EMBEDDING_MODEL,
  }
  if (literalApiKey !== undefined) {
    result.apiKey = literalApiKey
  }
  if (config.dimensions !== undefined) {
    result.dimensions = config.dimensions
  }
  return result
}

/** Register the API embedding provider with `ctx.embedding`. */
export function apply(ctx: Context, config: Config): void {
  ctx.embedding.registerProvider(new ApiEmbeddingProvider(() => resolveOptions(ctx, config)))
}
