# schema-align/ — schema-contract alignment test harness

Detects silent divergence between a tool's JSON Schema description and its actual runtime behavior. A **ToolContract** captures behavioral semantics that JSON Schema alone cannot express: negative cases (scenarios the tool must NOT succeed in), environmental constraints (preconditions on the host), and semantic descriptions for LLM-based alignment checks.

## Concept

Every tool plugin that registers a `ToolDefinition` SHOULD also register a `ToolContract`:

```ts
import { registerContract } from '@deepseek-ai/dsh-schema-align'

registerContract({
  toolName: 'bash',
  behavioralDescription: 'Executes a shell command in the workspace and returns stdout/stderr. Fails when the command exits non-zero or the sandbox denies execution.',
  negativeCases: [
    {
      scenario: 'command references a path outside the workspace with workspace-write sandbox',
      expectedOutcome: 'must-reject',
      reason: 'sandbox-policy enforces workspace containment',
    },
  ],
  environmentalConstraints: [
    {
      precondition: 'a POSIX shell or PowerShell is installed on the host',
      consequence: 'tool executes but returns an unhelpful error',
      code: 'SHELL_REQUIRED',
    },
  ],
})
```

## CI integration

Run `pnpm run test --filter "@deepseek-ai/dsh-schema-align"` to validate all contracts. The `validateContracts()` function checks that every registered contract has non-empty required fields.

## Migration path for existing tools

Existing tools do NOT need a contract immediately. Add contracts progressively — each PR that modifies a `ToolDefinition` should include the corresponding `registerContract()` call. The `assertContractExists(def)` helper can be called in tool registration code to fail loud at load time when a contract is missing.
