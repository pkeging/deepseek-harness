# memory-integrity/ — cross-session memory digest immutability

Ensures that cross-session memory entries are immutable by computing and verifying content-addressed SHA-256 digests.

## Problem

RAG-style memory systems have a fragile assumption: once a fact is stored, it stays the same. But compaction may rewrite summaries, bugs may corrupt storage, and intentional tampering is possible. Without integrity checks, a model recalling a memory cannot know whether the content is the original or a mutated version.

## Solution

Each memory entry stores a `contentDigest` (SHA-256 of the original content at write time). On recall:
- If `verifyOnRecall: true` (default), the digest is recomputed and compared.
- Entries with a mismatched digest are flagged with `integrityVerified: false`.
- The model sees the flag and can decide whether to trust the recalled content.

## Configuration

```yaml
- id: memory-integrity
  name: '@deepseek-ai/dsh-memory-integrity'
  config:
    verifyOnRecall: true    # verify digests on every recall
    includeDigest: true     # store digests with new entries
```

## Integration

Requires `ctx.memory` (from `@deepseek-ai/dsh-memory`). Works transparently with `memory-sqlite` and `memory-hash` backends — the digest is appended to the entry object, not stored separately.

## Model Experience

Recalled entries include `integrityVerified: boolean`. When false, the model should treat the content with suspicion and prefer fresh retrieval or human confirmation.

#### KV Cache effect

None; digests are computed client-side and do not affect request structure.
