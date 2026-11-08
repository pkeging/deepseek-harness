/**
 * Service Definition for the embedding capability seam (`ctx.embedding`):
 * provider registry and provider-selecting execution for text-to-vector embeddings.
 * Duplicate ids are rejected. At execution time, a configured provider must exist and
 * be usable; without one, exactly one usable provider is required, so selection never
 * depends on registration order.
 *
 * @module @deepseek-ai/dsh-embedding
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResult,
} from './types.ts'
import { EmbeddingError } from './types.ts'

export {
  EmbeddingError,
} from './types.ts'
export type {
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResult,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    embedding: EmbeddingRuntime
  }
}

/** Selection inputs for execution-time provider resolution. */
interface Selection<P> {
  /** The configured provider id for this capability, if any. */
  readonly configuredId?: string
  /** Providers registered for this capability kind. */
  readonly providers: ReadonlyMap<string, P>
}

/**
 * Config for the embedding seam. `embeddingProvider` pins which provider wins;
 * it is optional (a single registered usable provider auto-selects). Operational
 * overrides such as environment variables must feed these same fields rather than
 * introduce a hidden priority chain.
 */
export interface EmbeddingRuntimeConfig {
  /** Explicit embedding provider id. Omitted = auto-select when exactly one usable. */
  readonly embeddingProvider?: string
}

/**
 * The embedding service. Registered as `ctx.embedding` (one instance per context).
 *
 * Selection semantics (resolved at execution time, never order-dependent):
 * - A configured id that is registered and `available()` → that provider.
 * - A configured id not registered → `EMBEDDING_PROVIDER_CONFIGURED_MISSING`.
 * - A configured id registered but unavailable →
 *   `EMBEDDING_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - No id configured, exactly one registered usable provider → that provider.
 * - No id configured, multiple usable providers → `EMBEDDING_PROVIDER_AMBIGUOUS`.
 * - No id configured, no usable provider → `EMBEDDING_PROVIDER_UNAVAILABLE`.
 */
export class EmbeddingRuntime extends Service {
  /**
   * Provider selection config. Operational env overrides feed the SAME fields:
   * `$DSH_EMBEDDING_PROVIDER` is equivalent to `embeddingProvider` and is NOT a
   * hidden priority chain.
   */
  static Config: z<EmbeddingRuntimeConfig> = z.object({
    embeddingProvider: z.string(),
  })

  private _providers = new Map<string, EmbeddingProvider>()
  private readonly providerId: string | undefined

  /** Read-only view of registered providers. */
  readonly providers: ReadonlyMap<string, EmbeddingProvider> = this._providers

  constructor(ctx: Context, config: EmbeddingRuntimeConfig = {}) {
    super(ctx, 'embedding')
    this.providerId = config.embeddingProvider ?? process.env.DSH_EMBEDDING_PROVIDER
  }

  /**
   * Register an embedding provider. Throws {@link EmbeddingError}
   * `EMBEDDING_DUPLICATE_PROVIDER` if its id is already registered.
   * Returns a disposer; disposed with the calling fiber.
   *
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerProvider(provider: EmbeddingProvider): () => void {
    if (this._providers.has(provider.id)) {
      throw new EmbeddingError(
        `an embedding provider with id "${provider.id}" is already registered`,
        'EMBEDDING_DUPLICATE_PROVIDER',
      )
    }
    const store = this._providers
    const dispose = this.ctx.effect(function* () {
      store.set(provider.id, provider)
      yield () => store.delete(provider.id)
    }, 'embedding.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is
    // synchronous fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /**
   * Run one or more embeddings through the selected provider. Resolves the provider
   * at call time with the selection rules above; throws {@link EmbeddingError}
   * when the capability cannot run. The seam ensures the returned vectors count
   * matches the input texts count.
   *
   * @param request - the texts to embed.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the embedding vectors, one per input text.
   */
  async embed(request: EmbeddingRequest, signal?: AbortSignal): Promise<EmbeddingResult> {
    const provider = resolveProvider({
      providers: this.providers,
      ...this.providerId !== undefined ? { configuredId: this.providerId } : {},
    })
    const result = await provider.embed(request, signal)
    return capVectors(result, request.texts.length)
  }
}

interface ResolvableProvider {
  readonly id: string
  available(): boolean
}

/** Resolve the selected provider or throw the matching {@link EmbeddingError}. */
function resolveProvider<P extends ResolvableProvider>(selection: Selection<P>): P {
  const { configuredId, providers } = selection
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) {
      throw new EmbeddingError(
        `configured embedding provider "${configuredId}" is not registered`,
        'EMBEDDING_PROVIDER_CONFIGURED_MISSING',
      )
    }
    if (!provider.available()) {
      throw new EmbeddingError(
        `configured embedding provider "${configuredId}" is registered but unavailable`,
        'EMBEDDING_PROVIDER_CONFIGURED_UNAVAILABLE',
      )
    }
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const [single] = usable
  if (single === undefined) {
    throw new EmbeddingError(
      'no usable embedding provider is registered',
      'EMBEDDING_PROVIDER_UNAVAILABLE',
    )
  }
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).join(', ')
    throw new EmbeddingError(
      `multiple usable embedding providers are registered (${ids}); configure one explicitly`,
      'EMBEDDING_PROVIDER_AMBIGUOUS',
    )
  }
  return single
}

/** Enforce vector count: if the provider under-or-over-returns, pad/truncate and flag. */
function capVectors(result: EmbeddingResult, expectedCount: number): EmbeddingResult {
  if (result.vectors.length === expectedCount) return { ...result, truncated: result.truncated }
  const vectors: Float32Array[] = []
  for (let i = 0; i < expectedCount; i++) {
    const vector = result.vectors[i]
    if (vector !== undefined) {
      vectors.push(vector)
    } else {
      // Provider under-returned: supply a zero vector of the same dimension
      const sampleDim = result.vectors[0]?.length ?? 0
      vectors.push(new Float32Array(sampleDim))
    }
  }
  return { vectors, truncated: true }
}

export default EmbeddingRuntime
