# @deepseek-ai/dsh-embedding-fallback

English | [中文](README.zh.md)

显式的组合式 embedding provider。它注册一个单一的 `EmbeddingProvider`，按**固定且由操作员编写的**顺序尝试其配置的候选 provider——这样操作员可以声明一条降级路径（例如 `['api', 'hash']`），而 embedding seam 不会因此长出一条隐式的优先级链。

embedding seam 刻意地在 provider 缺失或存在歧义时「fail loud」，且从不按注册顺序选择。本插件尊重这一点：运行时仍然只选一个 provider（`embeddingProvider: 'fallback'`）；降级阶梯存在于该 provider 内部，由操作员自己的 `order` 配置排序——而非注册顺序——因此选择过程没有任何隐式部分。

## 配置

```yaml
- name: '@deepseek-ai/dsh-embedding-fallback'
  config:
    order: ['api', 'hash']   # 候选 provider id，按此确切顺序尝试
    id: 'fallback'           # 注册进 ctx.embedding 的组合 provider id
```

| 键 | 必填 | 含义 |
|---|---|---|
| `order` | 是（非空） | 候选 provider id，按偏好顺序。先尝试第一个可用候选；若运行时失败，则尝试下一个可用候选，直到某个成功或列表耗尽。 |
| `id` | 否（默认 `fallback`） | 组合 provider 在 `ctx.embedding` 中的 id。将 `embeddingProvider` 指向它即可选中。 |

## 工作机制

- `available()` 在至少一个配置的候选当前可用时返回 true。
- `embed()` 遍历 `order`，跳过不可用的候选，返回第一个候选的结果；若某候选抛错，则记录错误并尝试下一个。当所有候选都失败时，抛出 `EMBEDDING_FALLBACK_EXHAUSTED`（若最后错误是 `EmbeddingError` 则包装它）。

## 模型体验

本插件不面向模型；它只改变 `ctx.embedding.embed` 如何选择后端。下游消费者（语义记忆、知识库）看到的 `EmbeddingResult` 与具体由哪个候选产生无关。从远端 API 降级到本地/hash 后端会改变向量质量而非契约——主后端宕机时语义召回可能变粗，调用方应有此预期。

## 已知限制与延后工作

- 降级阶梯是**操作员显式编写**的——没有自动「选最优后端」的发现机制。想要「API 质量 + 离线兜底」的操作员必须自己列出 `['api', 'hash']`。
- 每个候选仍是各自独立注册的 provider；本插件只是组合它们，并不实现任何后端。
- 对单个候选的失败按调用捕获；会挂起（而非抛错）的候选只由转发的 `signal` 约束，本插件不另设超时。
