---
description: "面向 harness LLM 服务的本地 Ollama provider：一行 cordis.yml 即把守护进程提供的模型变成一条普通的文本与工具调用路由，无需 API key。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-ollama

[English](README.md) | 中文

## 概要

挂载本插件，即可把 harness 的提示词发给本地 Ollama 守护进程，而不是托管 API。一行 `cordis.yml` 写清守护进程地址与默认模型，此后该守护进程的模型就像其他路由一样可被选择。请求携带系统提示词、对话文本与工具声明；回答按 harness 自身的 chunk 词汇回流，并带有推理、token 计数、结束原因与工具调用。思考可以按会话关闭。附件会变成占位文本而不是被丢弃，这条路由也永远不需要凭据。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把插件挂在 LLM runtime 旁边，在会话中选择它的路由。插件为路由名 `ollama` 注册一个适配器；只有请求的 `provider` 是该名字时，请求才会到达守护进程。

### 何时选择它

当组合必须在没有托管 provider 的情况下工作时选择它：离线机器、禁止把提示词发往 API 的隐私边界，或只存在于本地守护进程中的模型。托管 DeepSeek 模型请选 `@deepseek-ai/dsh-llm-deepseek`；一个组合要共享多个 provider 时请选 `@deepseek-ai/dsh-llm-pi-ai`。本插件从不回退到其他路由，守护进程没运行时请求会失败，而不是从别处得到回答。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-llm-ollama'
  config:
    model: qwen3.5:latest
```

| 配置项 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | `http://127.0.0.1:11434` | 守护进程基址；必须是绝对的 `http` 或 `https` URL。 |
| `model` | `llama3.2` | 请求未指定模型时使用的守护进程模型。 |
| `timeoutMs` | `120000` | 覆盖整段流式响应的截止时间。 |
| `maxTokens` | 守护进程默认值 | 请求未带 `maxTokens` 时作为 `num_predict` 发送的输出上限。 |
| `keepAlive` | 守护进程默认值 | 守护进程在请求后保留模型驻留多久，例如 `5m`；`0` 表示立即卸载。 |

本包属于本地部署，因此生成的[配置目录](../../../docs/config-catalog.zh.md)不会收录它；上表就是全部可接受字段。

### 路由守护进程的模型

`ctx.llm.listModels('ollama')` 请求守护进程的 `/api/tags`，为每个已安装模型返回一条记录，并在显示名后附上报出的参数量。每条记录都只声明文本输入，因为本适配器不发送附件字段。

路由上的每个模型另外声明两档思考设置：`off` 发送 `think: false`，`default` 完全不发送 thinking 字段，把深度交给守护进程与模型决定。`default` 是本路由的默认档，因此从不触碰该设置的会话会保持守护进程自身的行为。

### 读懂失败

守护进程会报告传输与生成两类失败，适配器把每一类归入稳定的机器码：401 与 403 归 `AUTH`，404 归 `INVALID_REQUEST`，429 归 `RATE_LIMIT`，5xx 以及"流本身成功但夹带错误行"归 `SERVER`，其余归 `HTTP_<status>`。失败永远不会从流里抛出：它以 LLM 服务定义的终止 `error` finish chunk 形式到达，并带上守护进程自己的消息与状态码。把它上抛、重试、上报，是循环与 `@deepseek-ai/dsh-llm-retry` 的职责。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

适配器是一个类，持有单条路由所需的全部连接事实，并在 harness 的 block 词汇与 Ollama 的扁平消息记录之间双向翻译。

请求由 `GenerateOptions` 组装：一次性的 `system` 文本成为开头的 system 消息；每条历史消息成为一条记录，其角色为 `system`、`user`、`assistant` 或 `tool`；文本消息贡献其内容块拼接后的文本。assistant 消息的工具调用通过守护进程原生的 `tool_calls` 字段回放，其参数按守护进程要求是 JSON，而不是 harness 原始的参数字符串。工具声明映射到守护进程的 `tools` 字段，harness 携带的生成参数映射到 `options` 里的 `temperature`、`num_predict` 与 `stop`，而唯一有 wire 含义的推理档会在 `options` 之外补上 `think: false`。

响应是按行分隔的 JSON：每行一条部分消息，最后一行携带 `done`。读取器把推理片段与文本片段分别变成围绕一个块的 `reasoning-delta` 与 `text-delta` chunk，把工具调用累积成 tool-call 块，并以守护进程的 token 计数与结束原因收尾：回复含调用时为 `tool-calls`，守护进程因长度停止时为 `max-tokens`，其余为 `stop`。各块按到达顺序开启，因此 thinking 模型的推理索引低于其后的回答。由于守护进程不发出调用 id，适配器按块序号合成一个。

两个方向都容忍恶意输入。不是 JSON 对象的流式行会抛错，而不是被当作空 chunk 读掉；无法解码的工具调用参数字符串按原始字符串转发，而不是被丢弃。

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 插件入口：name、`ollama` 路由、`inject` 与适配器注册。 |
| `src/config.ts` | 配置校验、默认值与基址规范化。 |
| `src/adapter.ts` | 请求组装、响应翻译、模型列表、推理档声明与失败分类。 |
| `src/wire.ts` | Ollama wire 类型与流式响应体的分行解码器。 |
| `tests/daemon.ts` | 记录路径、请求体与请求头的脚本化守护进程替身。 |
| `tests/ollama.spec.ts` | 基于脚本化守护进程的免密钥行为测试。 |
| `tests/ollama.e2e.ts` | 真实守护进程测试；仅当 `DSH_OLLAMA_E2E_MODEL` 指定了已安装模型时才运行。 |

不发布不变量伴生插件，因为本适配器不拥有任何可供独立检查者观察的关系：它的路由注册、请求组装与流翻译都能通过所有适配器共用的 `llm` seam 观察到。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [LLM 服务](../llm/README.zh.md)——本插件实现的适配器接口，以及它产出的 chunk 词汇。
- [LLM 流式](../../../docs/subsystems/llm-streaming.zh.md)——流式回复如何变成被记录的会话事件。
- [DeepSeek 路由](../llm-deepseek/README.zh.md)——可用来对照失败与 token 处理的托管适配器。
- [pi-ai 路由](../llm-pi-ai/README.zh.md)——本包刻意不做的多 provider 路由与凭据处理。
- [重试](../llm-retry/README.zh.md)——负责重试本适配器所报失败的包。
- [新增工作区包](../../../docs/cookbook/adding-a-package.zh.md)——新 provider 要走的清单。

-----

<a id="model-experience"></a>
## 模型体验

### 经 Ollama 发出的 provider 请求

#### 模型看到的内容

守护进程收到的第一条是作为 system 消息的系统提示词，随后每条历史消息一条记录：`system` 与 `developer` 消息用守护进程的 `system` 角色，用户消息用 `user`，工具结果用 `tool`，assistant 消息用 `assistant` 并带上其文本与原生 `tool_calls` 数组。文本块以换行拼接，reasoning 块不贡献任何内容，image 或 file 块贡献字面量占位符 `[attachment omitted: this route carries text and tool calls only]`。工具声明出现在守护进程的 `tools` 字段里。选择 `off` 推理档会补上 `think: false`；其他档位不发送任何 thinking 字段。

#### Token 影响

按消息替换。一条消息的结构化块折叠成单个文本字段，因此 harness 记录的块间分隔符不会到达守护进程；reasoning 块不花 token；一个附件只花占位符的几个 token，而不是图片按 provider 计价的那部分。系统提示词每次请求都发送一次，适配器不做缓存。

#### KV Cache 影响

在一次会话内是追加式的，且本包自身不会使任何缓存失效：每次请求都逐字节重发同样的较早记录，因此守护进程自身的 prompt cache 可以复用已经算过的前缀。改动 `baseURL`、`model` 或 `keepAlive` 会开启不同的守护进程侧会话，可能错过复用；关闭思考只改动了请求末尾的一个字段，但守护进程仍可能给出不同回答，并在请求之间卸载模型或驱逐缓存。

### Provider 响应

#### 模型看到的内容

thinking 模型的推理以 `reasoning` 块到达，回答以另一个文本块到达，因此后续请求与会话记录同时携带两者。流式内容成为一个 assistant 文本块，守护进程的工具调用成为 tool-call 块，其参数保持原始 JSON 字符串。harness 把守护进程的 `prompt_eval_count` 与 `eval_count` 作为本次请求的输入与输出 token 上报，并把 `done_reason: length` 映射为 `max-tokens` 结束。

#### Token 影响

是上报而非计算：计数来自守护进程本身，因此本路由上的 harness token 计量与压缩预算都采用守护进程的账。输出 token 包含守护进程生成的推理，这也是 thinking 模型可能在给出任何回答文本之前就把很小的 `maxTokens` 用光的原因。

#### KV Cache 影响

相互独立。响应只是会话尾部新增的一段，不改变任何较早记录，因此可复用的请求前缀不受影响。一次因长度而停止、随后以更大 `num_predict` 重试的请求会复用同一前缀。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本路由在哪些方面不是托管适配器的等价替代；它们是本包当前的约束。

- **附件不会被发送** —— image 或 file 块变成占位文本；守护进程的 `images` 字段未被使用，因此即便守护进程模型具备视觉能力，它也收不到图片；而且即使守护进程声明了 vision 能力，`listModels` 对所有模型仍只报文本输入。
- **思考没有档位** —— 只有 `off` 会以 `think: false` 到达 wire；选择档位不会发送任何内容，因此守护进程与模型保持自己的默认深度，而且本包在为所有模型声明这两档时并不查询守护进程 `/api/tags` 中的 thinking 能力。
- **上下文窗口仍由守护进程决定** —— 从不发送 `num_ctx`，因此守护进程配置的窗口与 harness 的上下文预算可能不一致，模型的真实窗口也不会报给 `listModels`。
- **一个组合只能有一个守护进程** —— 两个实例会注册同一个 `ollama` 路由，导致插件加载失败；要服务两个守护进程，需要第二个包或可配置的路由名。
- **没有认证** —— 适配器不发送凭据，因此需要授权头的远程或代理守护进程无法访问。
- **工具调用 id 是合成的** —— 守护进程不发出调用 id，因此调用 id 只在产生它的那一次响应内有意义。
- **真实守护进程覆盖是选择性开启的** —— 仅当 `DSH_OLLAMA_E2E_MODEL` 指定了守护进程已提供的模型时 e2e 套件才运行，因此默认的 `pnpm run test:e2e` 并不能证明本机上守护进程的任何行为。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>给维护者的工作上下文——点击展开</summary>

- **路由注册是唯一的耦合点** —— 适配器不读取任何引擎内部实现，因此图片支持与 `num_ctx` 可以作为 wire 字段的补充，落在 `src/adapter.ts` 与对应 wire 类型之内。
- **wire 覆盖由脚本化守护进程负责** —— `tests/daemon.ts` 是分帧、推理顺序、工具调用、状态码分类、模型列表与思考开关的确定性证据；真实守护进程套件只用于验证对真实守护进程的传输，不复证映射。
- **`timeoutMs` 覆盖整段流** —— 该截止时间也会中止流中途的停滞，因此慢机器上的长本地生成可能需要调高它，而不是重试。
- **thinking 模型可能把很小的上限全用在推理上** —— 这里实测的 thinking 模型在 `off` 下 427 毫秒给出回答，而保持思考时耗时数秒；因此 `maxTokens` 偏紧的会话可能看到 `max-tokens` 结束而没有任何回答文本。

</details>
