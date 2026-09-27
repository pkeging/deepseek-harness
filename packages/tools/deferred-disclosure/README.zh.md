# @deepseek-ai/dsh-deferred-disclosure

渐进式工具披露。当注册的工具很多时——尤其是 MCP 自动发现的成批工具——每个请求的 tool schema 成本会主导提示词、挤占任务上下文。本插件在模型主动索取前先 withholding（暂缓）工具的参数 schema：模型只看到被延迟工具的名称与一行提示，直到它调用 `tool_search` 加载；加载后该工具在当前 agent scope 的后续请求中保持完整 schema。

它是对 `ctx.tools` 与 `ctx.systemPrompt` 的普通组合插件：注册 `tool_search` 加载器工具，并监听 `system-prompt/assemble` 以剥离匹配工具的参数。它不改变 agent loop，也不改动工具执行管线。

## 配置

```yaml
- name: '@deepseek-ai/dsh-deferred-disclosure'
  config:
    deferPatterns: ['mcp__*']   # 默认延迟的工具名 glob；置空则关闭
```

| 键 | 必填 | 含义 |
|---|---|---|
| `deferPatterns` | 否（默认 `[]`） | 匹配工具名的 glob（支持 `*`），如 `mcp__*`。匹配的工具初始即暂缓参数 schema，模型经 `tool_search` 加载后可见。空列表表示关闭插件：所有 schema 保持可见。`tool_search` 自身永不被延迟。 |

## 工作机制

- 被延迟工具在提示词中仅显示其名称、描述（追加 `[deferred …]` 提示）以及空参数，因此在该工具被揭示前模型无法调用它。
- 调用 `tool_search("<name>")` 返回该工具的完整 `{ name, description, parameters }` schema，并针对该 agent scope 标记该工具为已揭示。
- 该 scope 下一次装配的请求保留该工具的完整 schema，模型自此可正常调用。揭示对该 agent 生命周期内有效；揭示会增加一个 schema，并可能从首个变更的 schema token 起使 KV 缓存复用失效。

## 模型体验

### 被延迟的工具 schema 与加载器

#### 模型看到的内容

在调用 `tool_search` 之前，每个被延迟工具只显示名称、描述以及提示：

```markdown
<tool name> — <description>
[deferred — call tool_search("<tool name>") to load its parameters before using it]
```

`tool_search` 始终以完整形式列出。在模型调用 `tool_search("<tool name>")` 之后，该工具的完整参数 schema 会出现在同一 agent 的每一次后续请求中，如同它从未被延迟。

#### Token 影响

每个被延迟工具每轮只付出「名称 + 简短提示」的成本，而非其完整 JSON Schema——直到它被揭示。工具繁多的部署（许多 MCP 工具）收益最大；一旦揭示，该工具在 agent 余下生命周期内恢复完整每轮成本。

#### KV 缓存影响

揭示一个工具会改变装配出的提示词，因此可能从首个变更的 schema token 起使 KV 缓存复用失效。从未被揭示的被延迟工具永远不会重新引入其参数成本。

### `tool_search` 结果

#### 模型看到的内容

纯文本 JSON 对象：`{ "name", "description", "parameters" }`，即所请求工具的内容。模型据此获知参数，并在下一请求中其 schema 出现后调用该工具。

## 已知限制与延后工作

- **揭示按 scope 而非按轮次**——某工具一旦被某 agent 揭示，在该 agent 生命周期内保持揭示；没有预算驱动的自动重新隐藏。
- **同一轮次内调用仍需下一请求**——`tool_search` 以文本返回 schema，但模型只能在下一装配请求包含其完整 schema 后才能调用该工具，因此首次使用总是跨两轮。
- **空参数仍允许调用**——被延迟工具在请求中保留空参数 schema，因此忽略提示的模型可用无参方式调用它，并得到正常的参数校验错误，而非干净的「未知工具」。
- **不跨 agent 共享**——揭示按调用 agent 限定；不同 agent 需各自重新检索。
- **模式仅按名称匹配**——`deferPatterns` 匹配工具名，而非能力或 provider；按语义分组不在范围内。
