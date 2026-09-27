/**
 * Automatic memory injection and extraction for agent sessions.
 *
 * Two capabilities:
 * - **Injection**: before each model call, semantically relevant memories are
 *   added to the prompt assembly so the model can draw on long-term user state.
 * - **Extraction**: after each turn, an auxiliary LLM call distills memorable
 *   facts, decisions, preferences, and ideas from the turn transcript,
 *   deduplicates against existing memories, and stores the new ones.
 *
 * Both are best-effort: failures are logged but never surface to the user or
 * block the agent loop.
 *
 * @module @deepseek-ai/dsh-memory-agent
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A message this plugin synthesizes for its own auxiliary model call. */
    plugin: { kind: 'plugin'; plugin: string }
  }
}
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type {
  FinishReason,
  GenerateOptions,
  LlmRuntime,
  Message,
} from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  MemoryEntry,
  MemoryKind,
  MemoryRuntime,
  MemoryStoreRequest,
} from '@deepseek-ai/dsh-memory'
import { deadline, MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'

export const name = 'memory-agent'

export const inject = ['memory', 'systemPrompt', 'llm']

export interface MemoryAgentConfig {
  readonly recallLimit?: number
  readonly recallThreshold?: number
  readonly reviewLimit?: number
  readonly autoExtract?: boolean
  readonly extractCooldownSec?: number
  readonly extractMaxTokens?: number
  readonly extractTimeoutMs?: number
  readonly extractProvider?: string
  readonly extractModel?: string
  readonly dedupeThreshold?: number
  readonly sectionOrder?: number
}

export const Config: z<MemoryAgentConfig> = z.object({
  recallLimit: z.number().default(5),
  recallThreshold: z.number().default(0.3),
  reviewLimit: z.number().default(12),
  autoExtract: z.boolean().default(true),
  extractCooldownSec: z.number().default(60),
  extractMaxTokens: z.number().default(512),
  extractTimeoutMs: z.number().default(30000),
  extractProvider: z.string(),
  extractModel: z.string(),
  dedupeThreshold: z.number().default(0.9),
  sectionOrder: z.number().default(150),
})

const EXTRACT_SYSTEM_PROMPT = `You are a memory extractor. Below is a transcript of one turn of an AI conversation.
Extract facts, decisions, preferences, and ideas that are worth remembering long-term about the user, the project, or the context.
Focus on:
- User identity, background, habits, and preferences
- Project facts, architecture decisions, and agreed-upon plans
- Important dates, people, and relationships the user mentions
- Ideas or insights the user expressed

Ignore small talk, process details, tool output, and things you already remember.

Return ONLY a JSON array, with no other text, no markdown, no code fences. Each element:
{"content": "one complete specific sentence in the language of the conversation", "kind": "fact | decision | preference | idea", "tags": ["optional", "tags"]}
If nothing is worth remembering, return [].`

const REVIEW_KEYWORDS: readonly string[] = [
  '聊过什么', '聊了什么', '说过什么', '说过的话', '之前说过', '之前聊', '我们聊',
  '回顾', '我的记忆', '记得吗', '还记得', '我们讨论过', '我们谈过', '之前讨论',
  '了解我', '我的信息', '我跟你聊', '我和你说过', '我们一起聊',
  'what did we talk', 'remember when', 'do you remember', 'what we discussed',
  'recall our', 'our previous conversations', 'what we said', 'tell me about',
]

interface ExtractedMemoryItem {
  readonly content: string
  kind?: string
  tags?: readonly string[]
}

interface PerSessionState {
  lastExtractAt: number
}

export function isReviewQuery(text: string): boolean {
  const lower = text.toLowerCase()
  return REVIEW_KEYWORDS.some(keyword => lower.includes(keyword.toLowerCase()))
}

export function formatMemorySection(entries: readonly MemoryEntry[], heading: string): string {
  if (entries.length === 0) return ''
  const lines = [heading]
  for (const entry of entries) {
    const tagPart = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : ''
    lines.push(`- ${entry.content}${tagPart}`)
  }
  return lines.join('\n')
}

export function lastUserMessageText(events: readonly SessionEvent[]): string {
  for (const event of events.toReversed()) {
    if (event.type !== 'user/message') continue
    const msg = event.data
    const parts: string[] = []
    for (const block of msg.content) {
      if (block.type === 'text') parts.push(block.text)
    }
    return parts.join(' ')
  }
  return ''
}

export function latestTurnTranscript(
  events: readonly SessionEvent[],
): { user: string; assistant: string } {
  let latestTurn = -1
  for (const event of events.toReversed()) {
    if (event.type === 'turn/end') {
      latestTurn = event.data.turn
      break
    }
  }
  if (latestTurn < 0) return { user: '', assistant: '' }

  // Find the most recent user message (the input for this turn, before turn/end)
  let userText = ''
  for (const event of events.toReversed()) {
    if (event.type === 'user/message') {
      const msg = event.data
      userText = msg.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join(' ')
      break
    }
  }

  // Find the latest assistant message with matching turn
  let assistantText = ''
  for (const event of events.toReversed()) {
    if (event.type === 'assistant/message' && event.data.turn === latestTurn) {
      const msg = event.data.message
      assistantText = msg.content
        .filter((b): b is Extract<(typeof msg.content)[number], { type: 'text' }> => b.type === 'text')
        .map(b => b.text)
        .join(' ')
      break
    }
  }

  return { user: userText, assistant: assistantText }
}

export function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens':
      return new Error('memory extract: output reached maxTokens')
    case 'tool-calls':
      return new Error('memory extract: model unexpectedly requested tools')
    default:
      return new Error(`memory extract: unsupported finish reason "${String((finish as { kind?: unknown }).kind)}"`)
  }
}

export function parseExtractionOutput(text: string): ExtractedMemoryItem[] | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  let jsonStr = trimmed
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(jsonStr)
  if (fenceMatch !== null) {
    const inner = fenceMatch[1]
    if (inner !== undefined) jsonStr = inner
  }
  const arrayMatch = /\[[\s\S]*\]/.exec(jsonStr)
  if (arrayMatch === null) return null
  try {
    const parsed: unknown = JSON.parse(arrayMatch[0])
    if (!Array.isArray(parsed)) return null
    const results: ExtractedMemoryItem[] = []
    for (const raw of parsed) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
      const item = raw as Record<string, unknown>
      const content = typeof item.content === 'string' ? item.content.trim() : ''
      if (content.length === 0) continue
      const entry: ExtractedMemoryItem = { content }
      if (typeof item.kind === 'string') entry.kind = item.kind
      if (Array.isArray(item.tags) && item.tags.every((t): t is string => typeof t === 'string')) {
        entry.tags = item.tags
      }
      results.push(entry)
    }
    return results
  } catch {
    return null
  }
}

const VALID_KINDS: ReadonlySet<string> = new Set(['fact', 'decision', 'preference', 'idea', 'note'])

export function resolveKind(raw: string | undefined): MemoryKind {
  if (raw !== undefined && VALID_KINDS.has(raw)) return raw as MemoryKind
  return 'fact'
}

interface MemoryAgentServices {
  readonly memory: MemoryRuntime
  readonly llm: LlmRuntime
}

export function findLastRoute(events: readonly SessionEvent[]): { provider: string; model: string } | undefined {
  for (const event of events.toReversed()) {
    if (event.type !== 'request/header') continue
    const header = event.data.header
    return { provider: header.config.provider, model: header.config.model }
  }
  return undefined
}

async function checkDuplicate(
  content: string,
  threshold: number,
  memory: MemoryRuntime,
): Promise<boolean> {
  try {
    const result = await memory.recall({
      query: content,
      limit: 1,
      threshold,
    })
    const topScore = result.scores[0]
    return result.entries.length > 0 && topScore !== undefined && topScore >= threshold
  } catch {
    return false
  }
}

export function apply(ctx: Context & MemoryAgentServices, config: MemoryAgentConfig): void {
  const recallLimit = config.recallLimit ?? 5
  const recallThreshold = config.recallThreshold ?? 0.3
  const reviewLimit = config.reviewLimit ?? 12
  const autoExtract = config.autoExtract ?? true
  const extractCooldownMs = (config.extractCooldownSec ?? 60) * 1000
  const extractMaxTokens = config.extractMaxTokens ?? 512
  const extractTimeoutMs = config.extractTimeoutMs ?? 30000
  const dedupeThreshold = config.dedupeThreshold ?? 0.9
  const sectionOrder = config.sectionOrder ?? 150

  if (!Number.isFinite(recallLimit) || recallLimit < 1) {
    throw new Error('memory-agent: recallLimit must be a positive integer')
  }
  if (!Number.isFinite(recallThreshold) || recallThreshold < 0 || recallThreshold > 1) {
    throw new Error('memory-agent: recallThreshold must be between 0 and 1')
  }
  if (!Number.isFinite(reviewLimit) || reviewLimit < 1) {
    throw new Error('memory-agent: reviewLimit must be a positive integer')
  }
  if (!Number.isFinite(extractMaxTokens) || extractMaxTokens < 1) {
    throw new Error('memory-agent: extractMaxTokens must be a positive integer')
  }
  if (!Number.isFinite(extractTimeoutMs) || extractTimeoutMs < 1 || extractTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`memory-agent: extractTimeoutMs must be between 1 and ${MAX_TIMER_DELAY_MS}`)
  }
  if (!Number.isFinite(dedupeThreshold) || dedupeThreshold < 0 || dedupeThreshold > 1) {
    throw new Error('memory-agent: dedupeThreshold must be between 0 and 1')
  }
  const hasProvider = config.extractProvider !== undefined
  const hasModel = config.extractModel !== undefined
  if (hasProvider !== hasModel) {
    throw new Error('memory-agent: extractProvider and extractModel must be supplied together')
  }
  if (hasProvider
    && (typeof config.extractProvider !== 'string' || config.extractProvider.length === 0
      || typeof config.extractModel !== 'string' || config.extractModel.length === 0)) {
    throw new Error('memory-agent: extractProvider and extractModel must be non-empty strings')
  }

  const perSession = new WeakMap<object, PerSessionState>()

  ctx.on('system-prompt/assemble', async (
    _assembly: PromptAssembly,
    context: AssembleContext,
    next: () => Promise<PromptAssembly>,
  ): Promise<PromptAssembly> => {
    const downstream = await next()
    const agent = context.agent
    if (agent === undefined) return downstream
    const userText = lastUserMessageText(agent.session.snapshotEvents())
    if (userText.length === 0) return downstream

    const review = isReviewQuery(userText)
    const limit = review ? reviewLimit : recallLimit
    let recalled: readonly MemoryEntry[] = []
    try {
      const result = await ctx.memory.recall({
        query: userText,
        limit,
        threshold: recallThreshold,
      }, context.signal)
      recalled = result.entries
    } catch (error) {
      ctx.logger.warn('memory-agent: recall failed for injection: %o', error)
      return downstream
    }

    if (recalled.length === 0) return downstream

    const heading = review
      ? 'The user is asking about previous conversations. Here are relevant long-term memories (facts, preferences, decisions, ideas) — use them to answer truthfully:'
      : 'Relevant long-term memories about this user and context (for reference, do not mention directly):'

    const memorySection = {
      name: 'memory:relevant',
      text: formatMemorySection(recalled, heading),
    }
    const otherSections = downstream.sections.filter(section => section.name !== 'memory:relevant')
    const ordered: Array<{ section: { name: string; text: string }; order: number }> = [
      ...otherSections.map(section => ({ section, order: sectionOrder - 1 })),
      { section: memorySection, order: sectionOrder },
    ]
    ordered.sort((a, b) => a.order - b.order)

    return {
      ...downstream,
      sections: ordered.map(item => item.section),
    }
  })

  if (!autoExtract) return

  ctx.on('agent/turn-stopping', ({ agent, signal }: { agent: Agent; signal: AbortSignal }) => {
    if (signal.aborted) return
    void extractFromLatestTurn(agent)
  })

  async function extractFromLatestTurn(agent: Agent): Promise<void> {
    try {
      const sessionObj = agent.session as unknown as object
      const state = perSession.get(sessionObj)
      const now = Date.now()
      if (state !== undefined && now - state.lastExtractAt < extractCooldownMs) return
      perSession.set(sessionObj, { lastExtractAt: now })

      const transcript = latestTurnTranscript(agent.session.snapshotEvents())
      if (transcript.user.length === 0 && transcript.assistant.length === 0) return

      let provider: string
      let model: string
      if (config.extractProvider !== undefined && config.extractModel !== undefined) {
        provider = config.extractProvider
        model = config.extractModel
      } else {
        const route = findLastRoute(agent.session.snapshotEvents())
        if (route === undefined) return
        provider = route.provider
        model = route.model
      }

      const framedInput = `Transcript of the latest conversation turn:\nuser: ${transcript.user}\nassistant: ${transcript.assistant}`
      const messages: Message[] = [createUserMessage({
        content: [{ type: 'text', text: framedInput }],
        source: { kind: 'plugin', plugin: 'dsh-memory-agent' },
      })]

      let storedCount = 0
      try {
        const extractSignal = new AbortController().signal
        using callDeadline = deadline(extractSignal, extractTimeoutMs, 'MEMORY_EXTRACT_TIMEOUT')
        const options = deepFreeze({
          provider,
          model,
          messages,
          system: EXTRACT_SYSTEM_PROMPT,
          maxTokens: extractMaxTokens,
          sessionId: agent.id,
          purpose: 'session-title' as const,
          signal: callDeadline.signal,
        }) satisfies GenerateOptions
        const assembler = new BlockAssembler()
        for await (const chunk of ctx.llm.stream(options)) {
          callDeadline.signal.throwIfAborted()
          assembler.push(chunk)
        }
        callDeadline.signal.throwIfAborted()
        const terminalError = finishError(assembler.finish)
        if (terminalError !== undefined) throw terminalError
        const blocks = assembler.blocks()
        if (blocks.some(block => block.type === 'tool-call')) {
          throw new Error('memory extract: output must contain text only')
        }
        const text = blocks
          .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
          .map(block => block.text)
          .join(' ')
        const items = parseExtractionOutput(text)
        if (items === null || items.length === 0) return

        for (const item of items) {
          const kind = resolveKind(item.kind)
          const duplicate = await checkDuplicate(item.content, dedupeThreshold, ctx.memory)
          if (duplicate) continue
          const storeRequest: MemoryStoreRequest = item.tags !== undefined
            ? { content: item.content, kind, tags: item.tags, source: `session: ${agent.id}` }
            : { content: item.content, kind, source: `session: ${agent.id}` }
          await ctx.memory.store(storeRequest)
          storedCount++
        }
      } catch (error) {
        ctx.logger.warn('memory-agent: extraction LLM call failed: %o', error)
        return
      }

      if (storedCount > 0) {
        ctx.logger.info('memory-agent: extracted %d new memories for session %s', storedCount, agent.id)
      }
    } catch (error) {
      ctx.logger.warn('memory-agent: extractFromLatestTurn failed: %o', error)
    }
  }
}
