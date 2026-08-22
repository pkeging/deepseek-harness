/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-memory-sqlite`.
 *
 * @module @deepseek-ai/dsh-memory-sqlite/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-memory-sqlite'

/** Cordis companion plugin name. */
export const name = 'memory-sqlite-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the store is private to the provider and the
 * embedding service is wired through an internal setter; durable row
 * validation happens at read time inside the provider.
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
