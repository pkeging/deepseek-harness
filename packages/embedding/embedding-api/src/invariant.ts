/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-embedding-api`.
 *
 * @module @deepseek-ai/dsh-embedding-api/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-embedding-api'

/** Cordis companion plugin name. */
export const name = 'embedding-api-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the API provider's registration is a pure plug-in
 * to `ctx.embedding` and its HTTP calls are validated by the response parsing.
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
