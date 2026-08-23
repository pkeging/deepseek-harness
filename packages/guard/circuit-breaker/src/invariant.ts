/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-circuit-breaker`.
 * @module @deepseek-ai/dsh-circuit-breaker/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-circuit-breaker'

/** Cordis companion plugin name. */
export const name = 'circuit-breaker-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the failure chain is private to post-execute listeners
 * and exposes no package-owned event or snapshot that an independent companion
 * can observe.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
