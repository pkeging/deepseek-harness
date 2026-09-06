/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-embedding-fallback`.
 * @module @deepseek-ai/dsh-embedding-fallback/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-embedding-fallback'

/** Cordis companion plugin name. */
export const name = 'embedding-fallback-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the composite provider composes providers owned by other
 * packages, so it owns no cross-record runtime relationship an independent
 * companion can observe.
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
