/**
 * Intent-guard tool invariant companion.
 * @module @deepseek-ai/dsh-tool-intent-guard/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-intent-guard'
export const name = 'tool-intent-guard-invariant'
export const inject = ['invariants'] as const

/** No runtime invariant: the tool is a thin wrapper over ctx.intentGuard.observe(). */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
