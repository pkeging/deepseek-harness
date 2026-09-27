/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-compaction-mid-step-pressure`.
 * @module @deepseek-ai/dsh-compaction-mid-step-pressure/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-compaction-mid-step-pressure'

/** Cordis companion plugin name. */
export const name = 'compaction-mid-step-pressure-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the per-agent result counter is private to this
 * package's listeners and owns no event, service, or durable state that an
 * independent companion can observe.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
