---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-08-fork-auxiliary-plugin-source

[English](2026-11-08-fork-auxiliary-plugin-source.md) | 中文

## 概述

本 fork 的辅助调用插件在上游按生产者划分的 source 之外，额外贡献一个共享的 `plugin` 消息来源种类。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

该联合成员是增量添加：既有 `user`、`model`、`tool`、`system-prompt` 来源语义不变，原有变体字段也没有改动。读取方按 `kind` 分派并对未知种类走默认分支，因此上游读取方会把 `plugin` 来源视为未识别生产者而不是拒绝该事件；fork 内的读取方本就认识该种类，回退依然安全。没有判别值会与新成员混淆，故 `SESSION_FORMAT_VERSION` 保持 4。

<a id="verification"></a>
## 验证

pnpm run typecheck：5/5 个 gate 通过。pnpm exec vitest run packages/memory/memory-agent packages/evaluation/llm-judge packages/guard/circuit-breaker：60 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
