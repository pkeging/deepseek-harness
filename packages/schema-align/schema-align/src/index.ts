/**
 * Schema-align test harness: defines ToolContract per tool and runs
 * alignment checks at load time and in CI.
 *
 * A ToolContract captures the behavioral semantics that a JSON Schema
 * alone cannot express: negative cases, environmental constraints, and
 * preconditions that must hold for the tool to behave as documented.
 *
 * @module @deepseek-ai/dsh-schema-align
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Stable error class for schema-align violations. */
export class SchemaAlignError extends HarnessError {}

/** One negative case: a scenario the tool MUST NOT succeed in. */
export interface NegativeCase {
  /** Human-readable scenario description. */
  readonly scenario: string
  /** Expected outcome: hard reject or graceful failure. */
  readonly expectedOutcome: 'must-reject' | 'must-fail-gracefully'
  /** One-sentence reason why this scenario should not succeed. */
  readonly reason: string
}

/** One environmental constraint: a precondition on the host. */
export interface EnvironmentalConstraint {
  /** What must be true for the tool to work. */
  readonly precondition: string
  /** What happens if the precondition is not met. */
  readonly consequence: string
  /** Stable code for programmatic checking. */
  readonly code: string
}

/**
 * The semantic contract for one tool. Attached alongside the ToolDefinition
 * during registration; read by the align-checker at load and in CI.
 */
export interface ToolContract {
  /** Tool name (must match ToolDefinition.name). */
  readonly toolName: string
  /** One-paragraph behavioral description for LLM comparison. */
  readonly behavioralDescription: string
  /** Scenarios where the tool must NOT produce a successful result. */
  readonly negativeCases: NegativeCase[]
  /** Preconditions on the execution environment. */
  readonly environmentalConstraints?: EnvironmentalConstraint[]
}

/**
 * Registry of all ToolContracts in the current composition.
 * Populated by individual tool plugins via `registerContract()`.
 */
export const contracts = new Map<string, ToolContract>()

/**
 * Register one ToolContract. Called by tool definition plugins at load time.
 * @param contract - the contract to register.
 * @throws SchemaAlignError if a contract for the same tool already exists.
 */
export function registerContract(contract: ToolContract): void {
  if (contracts.has(contract.toolName)) {
    throw new SchemaAlignError(
      `schema-align: duplicate contract for tool "${contract.toolName}" — only one contract per tool is allowed`,
      'SCHEMA_ALIGN_DUPLICATE_CONTRACT',
    )
  }
  contracts.set(contract.toolName, contract)
}

/**
 * Read the contract for one tool. Returns undefined if no contract is registered.
 * @param toolName - name of the registered tool.
 * @returns the registered contract, or `undefined` when the tool has none.
 */
export function getContract(toolName: string): ToolContract | undefined {
  return contracts.get(toolName)
}

/**
 * Get all registered contracts. Used by CI and the align-check plugin.
 * @returns a read-only view of every registered contract keyed by tool name.
 */
export function getAllContracts(): ReadonlyMap<string, ToolContract> {
  return contracts
}

/**
 * Assert that a ToolDefinition has a matching contract.
 * Useful in tool-registration code to fail loud at load if the contract is missing.
 * @param def - the tool definition to check.
 * @throws SchemaAlignError if no contract exists for this tool name.
 */
export function assertContractExists(def: { name: string }): void {
  if (!contracts.has(def.name)) {
    throw new SchemaAlignError(
      `schema-align: no contract registered for tool "${def.name}" — add a registerContract() call in this tool's apply()`,
      'SCHEMA_ALIGN_MISSING_CONTRACT',
    )
  }
}

/**
 * Run a basic contract validation pass.
 * Checks that every registered contract has non-empty required fields.
 * @returns array of violations (empty when all contracts are valid).
 */
export function validateContracts(): readonly { toolName: string; violation: string }[] {
  const violations: { toolName: string; violation: string }[] = []
  for (const [name, contract] of contracts) {
    if (!contract.toolName || contract.toolName.trim().length === 0) {
      violations.push({ toolName: name, violation: 'toolName is empty' })
    }
    if (!contract.behavioralDescription || contract.behavioralDescription.trim().length === 0) {
      violations.push({ toolName: name, violation: 'behavioralDescription is empty' })
    }
    if (!Array.isArray(contract.negativeCases) || contract.negativeCases.length === 0) {
      violations.push({ toolName: name, violation: 'negativeCases is empty or missing' })
    }
  }
  return violations
}

export default { contracts, registerContract, getContract, getAllContracts, assertContractExists, validateContracts }
