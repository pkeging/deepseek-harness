/** Non-default package roles retained outside the experimental group. */

/** Product role that does not require a default runtime mount. */
export type ProductPackageCategory = 'optional' | 'sdk' | 'build' | 'test' | 'web-distribution' | 'declarations'

/** One explicitly maintained package role and its reason. */
export interface ProductPackagePolicy {
  /** Why this package remains outside the experimental group. */
  readonly reason: string
  /** The supported product role checked against its directory. */
  readonly category: ProductPackageCategory
}

/**
 * Exceptions to default runtime reachability, keyed by repository-relative package directory.
 * Optional integrations may be reached by an optional bundle without becoming default capabilities.
 */
export const PRODUCT_PACKAGE_POLICY: Readonly<Record<string, ProductPackagePolicy>> = {
  'packages/core/agent-tool-presentation': { category: 'optional', reason: 'Deprecated selector retained for existing executor configurations.' },
  'packages/browser-use/browser-use': { category: 'optional', reason: 'Service definition used by explicitly selected browser providers.' },
  'packages/computer-use/computer-use': { category: 'optional', reason: 'Service definition used by explicitly selected computer providers.' },
  'packages/lsp/lsp': { category: 'optional', reason: 'Service definition for deployment-configured language servers.' },
  'packages/lsp/lsp-stdio': { category: 'optional', reason: 'Requires an explicit server list and language-server executables.' },
  'packages/lsp/tool-lsp': { category: 'optional', reason: 'Model tools selected together with a configured LSP provider.' },
  'packages/ssh/ssh': { category: 'optional', reason: 'Explicit remote connection and helper configuration.' },
  'packages/ssh/ssh-helper-runtime': { category: 'optional', reason: 'Private executable carrier for explicitly configured SSH connections.' },
  'packages/ssh/fs-ssh': { category: 'optional', reason: 'Remote filesystem provider selected in an SSH composition.' },
  'packages/ssh/sandbox-ssh': { category: 'optional', reason: 'Remote confinement provider selected in an SSH composition.' },
  'packages/ssh/subprocess-ssh': { category: 'optional', reason: 'Remote process provider selected in an SSH composition.' },
  'packages/storage/storage-sqlite': { category: 'optional', reason: 'Persistent storage requires an explicit database path and backend selection.' },
  'packages/subagent/subagent-acp': { category: 'optional', reason: 'Requires a configured external ACP agent command.' },
  'packages/subagent/subagent-claude-code': { category: 'optional', reason: 'Separately installed native Claude Code agent integration.' },
  'packages/subagent/subagent-codex': { category: 'optional', reason: 'Separately installed native Codex agent integration.' },
  'packages/subagent/subagent-dsh-sdk': { category: 'optional', reason: 'Requires an explicitly configured external DSH home.' },
  'packages/context/tmux-context': { category: 'optional', reason: 'Context contribution requiring a tmux pane.' },
  'packages/fs/tool-str-replace-editor': { category: 'optional', reason: 'Explicit alternative to the default filesystem editing tools.' },
  'packages/fs/fs-observation-policy': { category: 'optional', reason: 'Read-before-mutation guard that a deployment enables on the disabled dsh-base row.' },
  'packages/sdk/client': { category: 'sdk', reason: 'Published TypeScript embedding client runs in the consumer process.' },
  'packages/typert/generator': { category: 'build', reason: 'Build-time generation of type metadata.' },
  'packages/test-support/agent-loop-testkit': { category: 'test', reason: 'Published agent-loop test harness.' },
  'packages/test-support/tool-testkit': { category: 'test', reason: 'Shared tool definition and execution fixtures for tests and benchmarks.' },
  'packages/test-support/client-runtime': { category: 'test', reason: 'Published browser plugin test harness.' },
  'packages/test-support/llm-mock-server': { category: 'test', reason: 'Published model-provider test server.' },
  'packages/test-support/llm-replay': { category: 'test', reason: 'Published recorded-model replay harness.' },
  'packages/test-support/loader-smoke': { category: 'test', reason: 'Published plugin Loader smoke-test harness.' },
  'packages/test-support/remote-mock': { category: 'test', reason: 'Published typed Remote test proxies.' },
  'packages/test-support/session-snapshot': { category: 'test', reason: 'Published Session snapshot replay harness.' },
  'packages/client/web': { category: 'web-distribution', reason: 'Browser boot kernel bundled into the Web distribution.' },
  'packages/client/ui-dockkit': { category: 'web-distribution', reason: 'Layout library bundled into the Web distribution.' },
  'packages/util/package-manifest': { category: 'declarations', reason: 'Shared package metadata declarations have no runtime mount.' },
  // Fork-maintained private packages: optional capabilities mounted only by explicit compositions.
  'packages/compaction/compaction-cache-aware': { category: 'optional', reason: 'Cache-aware compaction strategy selected by an explicit compaction composition.' },
  'packages/compaction/compaction-mid-step-pressure': { category: 'optional', reason: 'Mid-step context-pressure policy selected by an explicit compaction composition.' },
  'packages/compaction/compaction-quality-verify': { category: 'optional', reason: 'Post-compaction quality check selected by an explicit compaction composition.' },
  'packages/embedding/embedding': { category: 'optional', reason: 'Embedding service definition consumed by explicitly selected embedding providers.' },
  'packages/embedding/embedding-api': { category: 'optional', reason: 'API-backed embedding provider selected in deployment configuration.' },
  'packages/embedding/embedding-fallback': { category: 'optional', reason: 'Fallback embedding provider selected in deployment configuration.' },
  'packages/embedding/embedding-hash': { category: 'optional', reason: 'Deterministic hash embedding provider used as an offline fallback.' },
  'packages/eval/judge': { category: 'optional', reason: 'Judge service definition consumed by explicitly configured evaluation runs.' },
  'packages/evaluator/evaluator': { category: 'optional', reason: 'Evaluator service definition consumed by explicitly selected evaluator providers.' },
  'packages/evaluator/evaluator-static': { category: 'optional', reason: 'Static evaluator selected by an explicit evaluation composition.' },
  'packages/evaluator/tool-evaluator': { category: 'optional', reason: 'Evaluation model tool enabled by an explicit evaluation composition.' },
  'packages/evaluation/llm-judge': { category: 'optional', reason: 'Model-judged evaluator selected by an explicit evaluation composition.' },
  'packages/graph/graph': { category: 'optional', reason: 'Graph DAG service definition consumed by explicitly selected node providers.' },
  'packages/graph/graph-node-subagent': { category: 'optional', reason: 'Graph node provider requiring an explicitly mounted subagent runtime.' },
  'packages/guard/circuit-breaker': { category: 'optional', reason: 'Guard plugin enabled by an explicit agent-loop composition.' },
  'packages/intent-clarify/intent-clarify': { category: 'optional', reason: 'Clarification helper enabled by an explicit composition.' },
  'packages/intent-guard/intent-guard': { category: 'optional', reason: 'Intent-guard service definition consumed by explicitly selected checkers.' },
  'packages/intent-guard/intent-guard-checker': { category: 'optional', reason: 'Intent checker selected by an explicit composition.' },
  'packages/intent-guard/tool-intent-guard': { category: 'optional', reason: 'Intent-guard model tool enabled by an explicit composition.' },
  'packages/llm/llm-ollama': { category: 'optional', reason: 'Local Ollama provider selected in deployment configuration.' },
  'packages/llm/token-meter-tiktoken': { category: 'optional', reason: 'tiktoken token-meter provider selected in deployment configuration.' },
  'packages/memory/memory': { category: 'optional', reason: 'Cross-session memory service definition consumed by explicitly selected providers.' },
  'packages/memory/memory-agent': { category: 'optional', reason: 'Memory extraction agent selected by an explicit memory composition.' },
  'packages/memory/memory-sqlite': { category: 'optional', reason: 'SQLite memory store selected in deployment configuration.' },
  'packages/memory/tool-memory': { category: 'optional', reason: 'Memory model tool enabled by an explicit memory composition.' },
  'packages/memory-integrity/memory-integrity': { category: 'optional', reason: 'Memory integrity checker enabled by an explicit memory composition.' },
  'packages/schema-align/schema-align': { category: 'optional', reason: 'Schema-alignment model tool enabled by an explicit composition.' },
}
