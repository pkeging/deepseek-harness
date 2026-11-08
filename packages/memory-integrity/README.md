# memory-integrity/ — cross-session memory digest immutability

Ensures that cross-session memory entries cannot silently change by computing and verifying content-addressed SHA-256 digests.

## Packages

| Package | Role | ctx key |
|---|---|---|
| [`memory-integrity/`](memory-integrity/README.md) | Digest computation + recall-time verification wrapper | — (function plugin) |

## How it works

1. **On store**: computes `SHA-256(content)` and attaches it as `contentDigest` to the entry
2. **On recall**: re-computes the digest and compares against `contentDigest`; sets `integrityVerified: true/false`
3. **On mismatch**: the model sees `integrityVerified: false` and can decide to re-fetch or ask the human

## Configuration

```yaml
- id: memory-integrity
  name: '@deepseek-ai/dsh-memory-integrity'
  config:
    verifyOnRecall: true    # verify digests on every recall
    includeDigest: true     # store digests with new entries
```

## Integration

Works transparently with `memory-sqlite` and `memory-hash` backends. The digest is appended to the entry object, not stored in a separate table.

## Model Experience

Recalled entries include `integrityVerified: boolean`. When `false`, the model should treat the content with suspicion.

#### KV Cache effect

None; digests are client-side computations that don't affect request structure.
