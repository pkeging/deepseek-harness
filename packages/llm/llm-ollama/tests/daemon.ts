/**
 * Local Ollama daemon stand-in for the adapter's behavior suite.
 *
 * The daemon is the external service here, so the suite scripts it instead of
 * mocking the adapter's own code: each request consumes one scripted behavior,
 * and the recorded paths, bodies, and headers are what the assertions read.
 *
 * @module @deepseek-ai/dsh-llm-ollama/tests/daemon
 */
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

/** One scripted answer for one request. */
export interface DaemonBehavior {
  /** Lines streamed for `/api/chat`, newline-terminated; an omitted list answers with `body`. */
  readonly events?: readonly string[]
  /** Non-200 status; the response body is `body` or an empty JSON object. */
  readonly status?: number
  /** Whole response body, sent as-is with a JSON content type. */
  readonly body?: string
}

/** A running daemon stand-in and everything it recorded. */
export interface FakeDaemon {
  /** Base URL to configure the adapter with. */
  readonly url: string
  /** Request targets, in arrival order. */
  readonly paths: string[]
  /** Parsed request bodies, in arrival order. */
  readonly requests: unknown[]
  /** Request headers, in arrival order. */
  readonly headers: IncomingMessage['headers'][]
}

const daemons: Server[] = []

/** Close every daemon opened since the last call; run from each spec's `afterEach`. */
export async function closeDaemons(): Promise<void> {
  await Promise.all(daemons.splice(0).map(server => new Promise(resolve => server.close(resolve))))
}

/**
 * One complete streamed assistant text reply, framed as the daemon sends it.
 * @param deltas - content fragments, one streamed line each.
 * @returns newline-terminated lines, ending with the `done` summary line.
 */
export function textLines(...deltas: readonly string[]): string[] {
  return [
    ...deltas.map(delta => `${JSON.stringify({ message: { role: 'assistant', content: delta }, done: false })}\n`),
    `${JSON.stringify({
      message: { role: 'assistant', content: '' },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 7,
      eval_count: deltas.length,
    })}\n`,
  ]
}

/** One streamed line carrying assistant tool calls. */
export function toolCallLine(calls: readonly { name: string; arguments: unknown }[]): string {
  return `${JSON.stringify({
    message: {
      role: 'assistant',
      content: '',
      tool_calls: calls.map(call => ({ function: { name: call.name, arguments: call.arguments } })),
    },
    done: false,
  })}\n`
}

/**
 * One thinking model's reply, framed as the daemon sends it: reasoning lines
 * carrying only `thinking`, then content lines, then the `done` summary.
 * @param reasoning - reasoning fragments, one streamed line each.
 * @param content - answer fragments, one streamed line each.
 * @returns newline-terminated lines, ending with the `done` summary line.
 */
export function thinkingLines(reasoning: readonly string[], content: readonly string[]): string[] {
  return [
    ...reasoning.map(text => `${JSON.stringify({ message: { role: 'assistant', content: '', thinking: text }, done: false })}\n`),
    ...content.map(text => `${JSON.stringify({ message: { role: 'assistant', content: text }, done: false })}\n`),
    `${JSON.stringify({
      message: { role: 'assistant', content: '' },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 11,
      eval_count: 5,
    })}\n`,
  ]
}

/**
 * Start a daemon that answers each request with the next scripted behavior.
 * @param script - behaviors consumed in arrival order; an exhausted script answers 500.
 * @returns the running daemon and its recordings.
 */
export async function daemon(script: readonly DaemonBehavior[] = []): Promise<FakeDaemon> {
  const pending = [...script]
  const paths: string[] = []
  const requests: unknown[] = []
  const headers: IncomingMessage['headers'][] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    request.on('end', () => {
      paths.push(request.url ?? '')
      requests.push(body.length === 0 ? undefined : JSON.parse(body))
      headers.push(request.headers)
      const behavior = pending.shift() ?? { status: 500, body: '{"error":"script exhausted"}' }
      if (behavior.body !== undefined) {
        response.writeHead(behavior.status ?? 200, { 'content-type': 'application/json' })
        response.end(behavior.body)
        return
      }
      if (behavior.status !== undefined && behavior.status !== 200) {
        response.writeHead(behavior.status, { 'content-type': 'application/json' })
        response.end('{"error":"scripted failure"}')
        return
      }
      response.writeHead(200, { 'content-type': 'application/x-ndjson' })
      for (const line of behavior.events ?? []) response.write(line)
      response.end()
    })
  })
  daemons.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('daemon: no port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    paths,
    requests,
    headers,
  }
}
