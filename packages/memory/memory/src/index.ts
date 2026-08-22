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

  abstract store(request: MemoryStoreRequest, signal?: AbortSignal): Promise<MemoryEntry>

  abstract recall(request: MemoryRecallRequest, signal?: AbortSignal): Promise<MemoryRecallResult>

  abstract list(request?: MemoryListRequest, signal?: AbortSignal): Promise<MemoryListResult>

  abstract get(id: MemoryId, signal?: AbortSignal): Promise<MemoryEntry | undefined>

  abstract update(id: MemoryId, updates: Partial<Pick<MemoryStoreRequest, 'content' | 'kind' | 'tags'>>, signal?: AbortSignal): Promise<MemoryEntry>

  abstract delete(id: MemoryId, signal?: AbortSignal): Promise<boolean>

  protected resolveRecallLimit(limit: number | undefined): number {
    return limit !== undefined && limit > 0 ? Math.floor(limit) : this.defaultRecallLimit
  }

  protected resolveRecallThreshold(threshold: number | undefined): number {
    return threshold !== undefined ? threshold : this.defaultRecallThreshold
  }
}

export default MemoryRuntime
