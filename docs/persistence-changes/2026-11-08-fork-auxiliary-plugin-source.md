---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-08-fork-auxiliary-plugin-source

English | [中文](2026-11-08-fork-auxiliary-plugin-source.zh.md)

## Summary

The fork's auxiliary-call plugins contribute one shared `plugin` message source kind on top of upstream's per-producer kinds.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-08-fork-auxiliary-plugin-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-27-retry-control-input"
    after: "1cf4f9ba187d86fdece7b9fe51485dc41d9bd6eba6b97bc11e0b499fb265eb30"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-27-retry-control-input"
    after: "f8fe2f78e06ea1090277ccb40679ffc98911e2be4fe5312aaebd3926a2137437"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-27-retry-control-input"
    after: "9eb9bd06d69d84ac1af88c4d9e4271d07b8076c42fb8d7a57ad4afed3c10477b"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-27-retry-control-input"
    after: "1414891fffab97ed5d396af0af46ebfa0570052242431afb3e33c8f6aa52fd4b"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The new union member is additive: existing `user`, `model`, `tool`, and `system-prompt` sources keep their meaning, and no field of an existing variant changed. Readers switch on `kind` and fall through unknown kinds, so an upstream reader treats a `plugin` source as an unrecognised producer instead of rejecting the event; fork readers already understood this kind, so a downgrade inside the fork stays safe. No discriminator can confuse the new member with an upstream one, so `SESSION_FORMAT_VERSION` stays at 4.

<a id="verification"></a>
## Verification

pnpm run typecheck: 5 of 5 gates passed. pnpm exec vitest run packages/memory/memory-agent packages/evaluation/llm-judge packages/guard/circuit-breaker: 60 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
