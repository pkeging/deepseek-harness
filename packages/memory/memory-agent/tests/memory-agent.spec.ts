import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import { MessageId } from '@deepseek-ai/dsh-llm'
import type {
  MemoryEntry,
  MemoryId,
} from '@deepseek-ai/dsh-memory'
import {
  formatMemorySection,
  finishError,
  isReviewQuery,
  parseExtractionOutput,
  resolveKind,
} from '../src/index.ts'
import {
  EMPTY_MEMORY_AGENT_CONTEXT,
  memoryAgentContextProjection,
} from '../src/projection.ts'
import type { MemoryAgentContextState } from '../src/projection.ts'

/** Fold the plugin's context projection over one event sequence. */
function foldContext(events: readonly SessionEvent[]): MemoryAgentContextState {
  return events.reduce<MemoryAgentContextState>(
    (state, event) => memoryAgentContextProjection.apply(state, event),
    EMPTY_MEMORY_AGENT_CONTEXT,
  )
}

/** The route the plugin extracts with, or `undefined` when none is recorded. */
function routeOf(state: MemoryAgentContextState): { provider: string; model: string } | undefined {
  return state.provider.length === 0 || state.model.length === 0
    ? undefined
    : { provider: state.provider, model: state.model }
}

// --- Helpers to construct test events ---

let seqCounter = 0
function nextSeq(): number {
  return ++seqCounter
}

function makeEvent<K extends keyof SessionEventMap>(
  type: K,
  data: SessionEventMap[K],
): SessionEvent {
  return {
    type,
    seq: nextSeq(),
    time: Date.now(),
    data,
  } as SessionEvent<K>
}

function makeUserMessageEvent(text: string): SessionEvent {
  return makeEvent('user/message', {
    id: MessageId(`msg-${nextSeq()}`),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

function makeAssistantMessageEvent(turn: number, text: string): SessionEvent {
  return makeEvent('assistant/message', {
    turn,
    step: 0,
    stream: [],
    message: {
      id: MessageId(`msg-${nextSeq()}`),
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'test', model: 'test' },
    },
  })
}

function makeTurnEndEvent(turn: number): SessionEvent {
  return makeEvent('turn/end', {
    turn,
    reason: { kind: 'completed' },
  })
}

function makeRequestHeaderEvent(provider: string, model: string): SessionEvent {
  return makeEvent('request/header', {
    header: {
      config: { provider, model },
    },
    reason: 'initial',
  })
}

function makeMemoryEntry(content: string, kind: 'fact' | 'decision' | 'preference' | 'idea' = 'fact', tags: readonly string[] = []): MemoryEntry {
  return {
    id: `mem-${nextSeq()}` as MemoryId,
    content,
    kind,
    tags,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

// --- Tests ---

describe('isReviewQuery', () => {
  it('detects Chinese review keywords', () => {
    expect(isReviewQuery('我们之前聊过什么？')).toBe(true)
    expect(isReviewQuery('你还记得吗')).toBe(true)
    expect(isReviewQuery('回顾一下我的记忆')).toBe(true)
  })

  it('detects English review keywords', () => {
    expect(isReviewQuery('what did we talk about yesterday?')).toBe(true)
    expect(isReviewQuery('do you remember when we discussed that?')).toBe(true)
    expect(isReviewQuery('tell me about our previous conversations')).toBe(true)
  })

  it('returns false for normal queries', () => {
    expect(isReviewQuery('如何使用 TypeScript？')).toBe(false)
    expect(isReviewQuery('write a function to sort an array')).toBe(false)
  })

  it('is case-insensitive for English keywords', () => {
    expect(isReviewQuery('What Did We Talk About?')).toBe(true)
    expect(isReviewQuery('REMEMBER WHEN')).toBe(true)
  })
})

describe('formatMemorySection', () => {
  it('returns empty string for empty entries', () => {
    expect(formatMemorySection([], 'heading')).toBe('')
  })

  it('formats entries without tags', () => {
    const entries = [makeMemoryEntry('User likes dark mode'), makeMemoryEntry('User uses VSCode')]
    const result = formatMemorySection(entries, 'Relevant memories:')
    expect(result).toBe('Relevant memories:\n- User likes dark mode\n- User uses VSCode')
  })

  it('formats entries with tags', () => {
    const entries = [makeMemoryEntry('User likes dark mode', 'preference', ['ui', 'theme'])]
    const result = formatMemorySection(entries, 'Relevant memories:')
    expect(result).toBe('Relevant memories:\n- User likes dark mode [ui, theme]')
  })
})

describe('memoryAgentContext projection', () => {
  it('reports no user text before one arrives', () => {
    expect(foldContext([makeTurnEndEvent(1)]).userText).toBe('')
  })

  it('keeps the most recent user message text', () => {
    const state = foldContext([
      makeUserMessageEvent('first message'),
      makeUserMessageEvent('latest message'),
    ])
    expect(state.userText).toBe('latest message')
  })

  it('captures the transcript of the turn that just closed', () => {
    const state = foldContext([
      makeUserMessageEvent('user question'),
      makeAssistantMessageEvent(1, 'assistant reply'),
      makeTurnEndEvent(1),
    ])
    expect(state.completedTurn).toBe(1)
    expect(state.userText).toBe('user question')
    expect(state.completedTurnAssistant).toBe('assistant reply')
  })

  it('follows the latest completed turn across two turns', () => {
    const state = foldContext([
      makeUserMessageEvent('turn 1 user'),
      makeAssistantMessageEvent(1, 'turn 1 assistant'),
      makeTurnEndEvent(1),
      makeUserMessageEvent('turn 2 user'),
      makeAssistantMessageEvent(2, 'turn 2 assistant'),
      makeTurnEndEvent(2),
    ])
    expect(state.completedTurn).toBe(2)
    expect(state.userText).toBe('turn 2 user')
    expect(state.completedTurnAssistant).toBe('turn 2 assistant')
  })

  it('keeps the closed turn transcript while the next turn is still open', () => {
    const state = foldContext([
      makeUserMessageEvent('turn 1 user'),
      makeAssistantMessageEvent(1, 'turn 1 assistant'),
      makeTurnEndEvent(1),
      makeUserMessageEvent('turn 2 user'),
      makeAssistantMessageEvent(2, 'turn 2 assistant'),
    ])
    expect(state.completedTurn).toBe(1)
    expect(state.completedTurnAssistant).toBe('turn 1 assistant')
  })

  it('leaves the closed turn assistant empty when that turn produced none', () => {
    const state = foldContext([
      makeUserMessageEvent('user only'),
      makeTurnEndEvent(1),
    ])
    expect(state.userText).toBe('user only')
    expect(state.completedTurnAssistant).toBe('')
  })

  it('reports no route before one is recorded', () => {
    expect(foldContext([makeUserMessageEvent('hello')]).provider).toBe('')
  })

  it('keeps the latest request route', () => {
    const state = foldContext([
      makeRequestHeaderEvent('provider1', 'model1'),
      makeRequestHeaderEvent('provider2', 'model2'),
    ])
    expect(state.provider).toBe('provider2')
    expect(state.model).toBe('model2')
  })
})

describe('finishError', () => {
  it('returns undefined for stop reason', () => {
    expect(finishError({ kind: 'stop' })).toBeUndefined()
  })

  it('returns error for error reason', () => {
    const err = finishError({ kind: 'error', failure: { message: 'test error', code: 'E_TEST' } })
    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toBe('test error')
    expect((err as Error & { code?: string })?.code).toBe('E_TEST')
  })

  it('returns error for aborted reason', () => {
    const err = finishError({ kind: 'aborted', failure: { message: 'aborted', code: 'E_ABORT' } })
    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toBe('aborted')
  })

  it('returns error for max-tokens reason', () => {
    const err = finishError({ kind: 'max-tokens' })
    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toContain('maxTokens')
  })

  it('returns error for tool-calls reason', () => {
    const err = finishError({ kind: 'tool-calls' })
    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toContain('tool')
  })
})

describe('parseExtractionOutput', () => {
  it('returns null for empty input', () => {
    expect(parseExtractionOutput('')).toBeNull()
    expect(parseExtractionOutput('   ')).toBeNull()
  })

  it('returns null for non-JSON input', () => {
    expect(parseExtractionOutput('hello world')).toBeNull()
  })

  it('returns null for non-array JSON', () => {
    expect(parseExtractionOutput('{"key": "value"}')).toBeNull()
  })

  it('parses valid JSON array', () => {
    const result = parseExtractionOutput('[{"content": "test fact", "kind": "fact"}]')
    expect(result).toEqual([{ content: 'test fact', kind: 'fact' }])
  })

  it('extracts content and tags', () => {
    const result = parseExtractionOutput('[{"content": "user likes Python", "kind": "preference", "tags": ["lang", "preference"]}]')
    expect(result).toEqual([{ content: 'user likes Python', kind: 'preference', tags: ['lang', 'preference'] }])
  })

  it('filters invalid items', () => {
    const result = parseExtractionOutput('[null, {}, {"content": "valid"}]')
    expect(result).toEqual([{ content: 'valid' }])
  })

  it('handles markdown code fences', () => {
    const result = parseExtractionOutput('```json\n[{"content": "fenced fact"}]\n```')
    expect(result).toEqual([{ content: 'fenced fact' }])
  })

  it('handles non-json code fences', () => {
    const result = parseExtractionOutput('```\n[{"content": "plain fence fact"}]\n```')
    expect(result).toEqual([{ content: 'plain fence fact' }])
  })

  it('returns null for JSON with no array', () => {
    expect(parseExtractionOutput('{"not": "an array"}')).toBeNull()
  })

  it('handles items with missing kind (defaults to fact)', () => {
    const result = parseExtractionOutput('[{"content": "no kind"}]')
    expect(result).toEqual([{ content: 'no kind' }])
  })
})

describe('resolveKind', () => {
  it('returns valid kinds', () => {
    expect(resolveKind('fact')).toBe('fact')
    expect(resolveKind('decision')).toBe('decision')
    expect(resolveKind('preference')).toBe('preference')
    expect(resolveKind('idea')).toBe('idea')
    expect(resolveKind('note')).toBe('note')
  })

  it('defaults to fact for invalid kinds', () => {
    expect(resolveKind('unknown')).toBe('fact')
    expect(resolveKind('')).toBe('fact')
  })

  it('defaults to fact for undefined', () => {
    expect(resolveKind(undefined)).toBe('fact')
  })
})

describe('findLastRoute', () => {
  it('returns undefined when no request/header event', () => {
    const events: SessionEvent[] = [makeUserMessageEvent('hello')]
    const route = routeOf(foldContext(events))
    expect(route).toBeUndefined()
  })

  it('finds the latest route', () => {
    const events: SessionEvent[] = [
      makeRequestHeaderEvent('provider1', 'model1'),
      makeRequestHeaderEvent('provider2', 'model2'),
    ]
    expect(routeOf(foldContext(events))).toEqual({ provider: 'provider2', model: 'model2' })
  })
})
