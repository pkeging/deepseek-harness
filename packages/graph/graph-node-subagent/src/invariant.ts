/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-graph-node-subagent`.
 * @module @deepseek-ai/dsh-graph-node-subagent/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-graph-node-subagent'

/** Cordis companion plugin name. */
export const name = 'graph-node-subagent-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package delegates all execution to the subagent
 * seam and the graph seam. The subagent seam owns its own start/end pairing
 * invariant; the graph seam owns its own node-start/node-end pairing invariant.
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
