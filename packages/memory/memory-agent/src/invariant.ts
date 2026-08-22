/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-memory-agent`.
 *
 * @module @deepseek-ai/dsh-memory-agent/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-memory-agent'

/** Cordis companion plugin name. */
export const name = 'memory-agent-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the agent plugin is a pure composition of the memory
 * service's store/recall and the LLM service's stream; both contracts are
 * owned and checked by their own packages. Best-effort failure handling is
 * observable behavior covered by unit tests, not a cross-record relationship
 * this package owns.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
