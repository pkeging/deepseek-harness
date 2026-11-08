/**
 * Package directories this workspace adds on top of the product.
 *
 * The generated catalogs (`docs/subsystems/*.md`, `docs/config-catalog.md`,
 * `docs/tool-catalog.md`) document the shipped harness. A private deployment's
 * packages are not shipped, so their services, events, config declarations, and
 * tool schemas stay out of those catalogs rather than acquiring a product
 * classification for every type they expose.
 *
 * Every entry must name a package the product does not have: listing a product
 * package here silently removes it from the catalog. The companion spec asserts
 * the shape, the existence, and that no entry appears in a product bundle's
 * dependency set.
 *
 * @module scripts/private-packages
 */

/** `packages/<group>/<package>/` prefixes excluded from the generated catalogs. */
export const PRIVATE_PACKAGE_DIRECTORIES: readonly string[] = [
  'packages/compaction/compaction-cache-aware/',
  'packages/compaction/compaction-mid-step-pressure/',
  'packages/compaction/compaction-quality-verify/',
  'packages/embedding/embedding/',
  'packages/embedding/embedding-api/',
  'packages/embedding/embedding-fallback/',
  'packages/embedding/embedding-hash/',
  'packages/eval/judge/',
  'packages/evaluation/llm-judge/',
  'packages/evaluator/evaluator/',
  'packages/evaluator/evaluator-static/',
  'packages/evaluator/tool-evaluator/',
  'packages/graph/graph/',
  'packages/graph/graph-node-subagent/',
  'packages/guard/circuit-breaker/',
  'packages/intent-clarify/intent-clarify/',
  'packages/intent-guard/intent-guard/',
  'packages/intent-guard/intent-guard-checker/',
  'packages/intent-guard/tool-intent-guard/',
  'packages/llm/llm-ollama/',
  'packages/llm/token-meter-tiktoken/',
  'packages/memory/memory/',
  'packages/memory/memory-agent/',
  'packages/memory/memory-sqlite/',
  'packages/memory/tool-memory/',
  'packages/memory-integrity/memory-integrity/',
  'packages/schema-align/schema-align/',
]
