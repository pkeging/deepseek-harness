import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MemoryRuntime, type MemoryRuntimeConfig } from '@deepseek-ai/dsh-memory'
import type {
  MemoryEntry,
  MemoryId,
  MemoryListRequest,
  MemoryListResult,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryStoreRequest,
} from '@deepseek-ai/dsh-memory'
import type {} from '@deepseek-ai/dsh-embedding'
import { SqliteMemoryStore } from './store.ts'

export { SqliteMemoryStore } from './store.ts'
export type { SqliteMemoryStoreConfig } from './store.ts'

export const name = 'memory-sqlite'

export const inject = ['embedding']

export interface Config extends MemoryRuntimeConfig {
  /** SQLite file backing this store. Omit to keep the database in memory. */
  readonly databasePath?: string
  /** Milliseconds a statement waits on a locked database before it fails. Defaults to `5000`. */
  readonly busyTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  databasePath: z.string(),
  busyTimeoutMs: z.number().step(1).min(100).default(5000),
  defaultRecallLimit: z.number().step(1).min(1).default(10),
  defaultRecallThreshold: z.number().min(0).max(1).default(0.5),
})

export function apply(ctx: Context, config: Config): void {
  new SqliteMemoryRuntime(ctx, config)
}

class SqliteMemoryRuntime extends MemoryRuntime {
  static inject = ['embedding']

  private readonly storage: SqliteMemoryStore
  private readonly ready: Promise<void>

  constructor(ctx: Context, config: Config) {
    super(ctx, {
      defaultRecallLimit: config.defaultRecallLimit ?? 10,
      defaultRecallThreshold: config.defaultRecallThreshold ?? 0.5,
    })
    this.storage = new SqliteMemoryStore({
      databasePath: config.databasePath ?? ':memory:',
      busyTimeoutMs: config.busyTimeoutMs ?? 5000,
    })
    this.ready = this.storage.open()
    // Mark the promise handled so a failed open does not crash the process
    // with an unhandled rejection; the stored rejection still surfaces on the
    // first operation via `await this.ready`.
    this.ready.catch(() => {})
    const storage = this.storage
    const ready = this.ready
    ctx.effect(function* () {
      yield async () => {
        try {
          await ready
        } catch {
          // Open failed before anything was created; nothing to close.
          return
        }
        storage.close()
      }
    }, 'memory-sqlite.close()')
    ctx.effect(function* () {
      storage.setEmbeddingService({
        embed: (texts: string[], signal?: AbortSignal) => ctx.embedding.embed({ texts }, signal),
      })
      yield () => {
        storage.setEmbeddingService(null)
      }
    }, 'memory-sqlite.bindEmbedding()')
  }

  async store(request: MemoryStoreRequest, signal?: AbortSignal): Promise<MemoryEntry> {
    await this.ready
    return await this.storage.store(request, signal)
  }

  async recall(request: MemoryRecallRequest, signal?: AbortSignal): Promise<MemoryRecallResult> {
    await this.ready
    return await this.storage.recall({
      ...request,
      limit: this.resolveRecallLimit(request.limit),
      threshold: this.resolveRecallThreshold(request.threshold),
    }, signal)
  }

  async list(request: MemoryListRequest = {}): Promise<MemoryListResult> {
    await this.ready
    return this.storage.list(request)
  }

  async get(id: MemoryId): Promise<MemoryEntry | undefined> {
    await this.ready
    return this.storage.get(id)
  }

  async update(
    id: MemoryId,
    updates: Partial<Pick<MemoryStoreRequest, 'content' | 'kind' | 'tags'>>,
    signal?: AbortSignal,
  ): Promise<MemoryEntry> {
    await this.ready
    return await this.storage.update(id, updates, signal)
  }

  async delete(id: MemoryId): Promise<boolean> {
    await this.ready
    return this.storage.delete(id)
  }
}
