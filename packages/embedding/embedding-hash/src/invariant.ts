/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-embedding-hash`.
 *
 * @module @deepseek-ai/dsh-embedding-hash/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-embedding-hash'

/** Cordis companion plugin name. */
export const name = 'embedding-hash-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the hash provider is stateless, has no external
 * dependencies, and its registration is a pure plug-in to `ctx.embedding`.
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
