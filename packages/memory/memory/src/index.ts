import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  MemoryEntry,
  MemoryId,
  MemoryListRequest,
  MemoryListResult,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryStoreRequest,
} from './types.ts'

export { MemoryError, MemoryId } from './types.ts'
export type {
  MemoryEntry,
  MemoryKind,
  MemoryListRequest,
  MemoryListResult,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryStoreRequest,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryRuntime
  }
}

export interface MemoryRuntimeConfig {
  readonly defaultRecallLimit?: number
  readonly defaultRecallThreshold?: number
}

/**
 * Durable long-term memory behind `ctx.memory`. A provider implements the six
 * operations below; the base owns the default recall limit and threshold that a
 * request carrying no values of its own falls back to.
 */
export abstract class MemoryRuntime extends Service {
  static Config: z<MemoryRuntimeConfig> = z.object({
    defaultRecallLimit: z.number().step(1).min(1).default(10),
    defaultRecallThreshold: z.number().min(0).max(1).default(0.5),
  })

  protected readonly defaultRecallLimit: number
  protected readonly defaultRecallThreshold: number

  constructor(ctx: Context, config: MemoryRuntimeConfig = {}) {
    super(ctx, 'memory')
    this.defaultRecallLimit = config.defaultRecallLimit ?? 10
    this.defaultRecallThreshold = config.defaultRecallThreshold ?? 0.5
  }

  /**
   * Store one new memory entry.
   * @param request - content, kind, and tags for the entry to create.
   * @param signal - optional cancellation for a provider that waits on I/O.
   * @returns the stored entry, including the identity assigned to it.
   */
  abstract store(request: MemoryStoreRequest, signal?: AbortSignal): Promise<MemoryEntry>

  /**
   * Retrieve the entries related to one query, best match first.
   * @param request - query text with an optional limit and similarity threshold;
   *   omitted values fall back to this runtime's configured defaults.
   * @param signal - optional cancellation for a provider that waits on I/O.
   * @returns the matching entries and their similarity scores.
   */
  abstract recall(request: MemoryRecallRequest, signal?: AbortSignal): Promise<MemoryRecallResult>

  /**
   * List stored entries without a query.
   * @param request - optional paging and filtering for the listing.
   * @param signal - optional cancellation for a provider that waits on I/O.
   * @returns the selected entries and the total count before paging.
   */
  abstract list(request?: MemoryListRequest, signal?: AbortSignal): Promise<MemoryListResult>

  /**
   * Read one entry by identity.
   * @param id - identity of the entry to read.
   * @param signal - optional cancellation for a provider that waits on I/O.
   * @returns the entry, or `undefined` when no entry carries that identity.
   */
  abstract get(id: MemoryId, signal?: AbortSignal): Promise<MemoryEntry | undefined>

  /**
   * Replace the mutable fields of one entry.
   * @param id - identity of the entry to change.
   * @param updates - content, kind, and tags to write; omitted fields keep their stored values.
   * @param signal - optional cancellation for a provider that waits on I/O.
   * @returns the entry as stored after the update.
   */
  abstract update(id: MemoryId, updates: Partial<Pick<MemoryStoreRequest, 'content' | 'kind' | 'tags'>>, signal?: AbortSignal): Promise<MemoryEntry>

  /**
   * Remove one entry.
   * @param id - identity of the entry to remove.
   * @param signal - optional cancellation for a provider that waits on I/O.
   * @returns `true` when an entry was removed, `false` when none carried that identity.
   */
  abstract delete(id: MemoryId, signal?: AbortSignal): Promise<boolean>

  protected resolveRecallLimit(limit: number | undefined): number {
    return limit !== undefined && limit > 0 ? Math.floor(limit) : this.defaultRecallLimit
  }

  protected resolveRecallThreshold(threshold: number | undefined): number {
    return threshold !== undefined ? threshold : this.defaultRecallThreshold
  }
}

export default MemoryRuntime
