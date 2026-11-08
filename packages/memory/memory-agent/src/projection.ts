/**
 * Session-derived context the memory plugin reads.
 *
 * `Session.eventAt()` and `Session.snapshotEvents()` are deprecated for
 * production callers, so this plugin folds the values it needs into a
 * projection instead: the registry materializes the state from the session log
 * — including after a resume — and then maintains it from newly committed
 * events. Reads stay bounded, and a resumed session behaves like a live one
 * from its first event rather than starting empty.
 *
 * @module @deepseek-ai/dsh-memory-agent/projection
 */

import { z } from 'zod'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

/** Text of the text blocks in one message's content, space-joined. */
function textOf(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join(' ')
}

/** Context the memory plugin reads, folded from one session's committed events. */
export interface MemoryAgentContextState {
  /** Text of the most recent user message; empty before one arrives. */
  userText: string
  /** Text of the most recent assistant message since the last `turn/end`. */
  pendingAssistant: string
  /** Turn number of the last completed turn, or `-1` before one completes. */
  completedTurn: number
  /** Assistant text captured as {@link completedTurn} closed. */
  completedTurnAssistant: string
  /** Provider of the most recent request route; empty before one is recorded. */
  provider: string
  /** Model of the most recent request route; empty before one is recorded. */
  model: string
}

const stateSchema: z.ZodType<MemoryAgentContextState> = z.object({
  userText: z.string(),
  pendingAssistant: z.string(),
  completedTurn: z.number(),
  completedTurnAssistant: z.string(),
  provider: z.string(),
  model: z.string(),
})

/** The context before any event is folded. */
export const EMPTY_MEMORY_AGENT_CONTEXT: MemoryAgentContextState = {
  userText: '',
  pendingAssistant: '',
  completedTurn: -1,
  completedTurnAssistant: '',
  provider: '',
  model: '',
}

/**
 * Fold the context this plugin reads.
 *
 * `completedTurnAssistant` is captured as the turn closes, so a later turn's
 * assistant messages cannot overwrite the transcript of the turn an extraction
 * reports on.
 */
export const memoryAgentContextProjection = {
  key: 'memoryAgentContext',
  stateSchema,
  init: () => EMPTY_MEMORY_AGENT_CONTEXT,
  apply: (state, event) => {
    switch (event.type) {
      case 'user/message':
        return { ...state, userText: textOf(event.data.content) }
      case 'assistant/message':
        return { ...state, pendingAssistant: textOf(event.data.message.content) }
      case 'turn/end':
        return {
          ...state,
          completedTurn: event.data.turn,
          completedTurnAssistant: state.pendingAssistant,
          pendingAssistant: '',
        }
      case 'request/header':
        return {
          ...state,
          provider: event.data.header.config.provider,
          model: event.data.header.config.model,
        }
      default:
        return state
    }
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'memoryAgentContext', MemoryAgentContextState>
