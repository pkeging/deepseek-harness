# Agent Note: Graph DAG seam（`ctx.graphEngine`）

Status: implemented

[English](2026-08-26-graph-dag-seam.md) | 中文

## 问题

仓库中有三种执行模型，每种针对特定的工作形状设计：

- **轮次/步骤 loop**——一个 agent、一个 session、线性对话。`agent-loop` 驱动单个 agent 执行模型调用和工具调用，直到模型停止请求工具为止。
- **工作流**——一个脚本按序或扇出地调用 subagent。脚本显式控制流程。即使调用了 `parallel()`，它在控制结构上仍然是线性的。
- **同会话目标**——一个目标在当前 session transcript 中允许多次续行。

这些模型都无法表达一个通用 DAG。需要如下结构的调用方：
- 两个独立任务并行执行，
- 第三个任务依赖前两个的结果，
- 第四个任务只依赖其中一个

无法用工作流脚本建模，除非脚本本身*隐式*编码了 DAG。脚本即图，意味着图不是数据，而是代码。

这导致：
- UI 无法独立于脚本体渲染实际的依赖结构。
- 部分重执行不可行：如果节点 B 失败，引擎无法判断节点 C（依赖 A 和 B）是否仍可以用仅 A 的结果继续运行。
- 无法与现有消费方组合：图节点可以是任意 provider，不限于 subagent 或 workflow 步骤。

因此仓库需要一个 seam，其中拓扑是声明式数据，调度器从 DAG 推导执行顺序，而非从命令式代码推导。

## 决策

在 `ctx.graphEngine`（`@deepseek-ai/dsh-graph`）新增一个能力 seam，包含四个生命周期事件和一个 provider 注册表。该 seam 拥有：

1. **拓扑作为数据**：`GraphTopology` 声明节点和边。引擎负责验证和调度。
2. **Provider 注册表**：`ctx.graphEngine.graphNodeProviders` 是一个 per-fiber `Map<string, GraphNodeProvider>`。引擎在调度时查找每个节点的 `provider` 名称；缺失名称在节点启动前即为致命错误。
3. **节点级失败模式**：每个节点声明 `failureMode`（`isolate` / `propagate` / `continue`）。节点失败时引擎应用该模式。
4. **不变量**：每个 `graph/node-start` 有且仅有一个匹配的 `graph/node-end`；每个 `graph/end` 报告的节点计数与观察到的 start 和 outcome 一致。

该 seam 仅为 Service Definition。不发货任何 provider。`subagent` provider、`function` provider、`workflow` provider 延期至后续包。

### 包拓扑

| 包 | 角色 |
|---|---|
| `graph/graph/` | Service Definition：`GraphEngine`、`GraphNodeProviderRegistry`、`GraphError`、类型 |
| `graph/graph-node-subagent/` | 延期——subagent 驱动节点 provider |
| `graph/graph-node-function/` | 延期——纯函数节点 provider |
| `graph/graph-node-workflow/` | 延期——workflow 驱动节点 provider |

### 事件约定

| 事件 | 模式 | 载荷 |
|---|---|---|
| `graph/run-start` | `emit` | `(info: GraphRunInfo)` |
| `graph/node-start` | `emit` | `(info: GraphRunInfo, node: GraphNodeStartInfo)` |
| `graph/node-end` | `emit` | `(info: GraphRunInfo, node: GraphNodeEndInfo)` |
| `graph/end` | `emit` | `(info: GraphRunInfo, result: GraphRunResult)` |

### 失败模式语义

- **`isolate`**（默认）：失败节点标记为失败；所有入边均来自失败节点的下游节点被跳过。独立分支继续运行。
- **`propagate`**：失败节点终止整个 run。运行中的节点被取消；未启动的节点被跳过。
- **`continue`**：失败节点标记为失败；下游节点继续，输入键下收到 `null`。下游 provider 必须处理缺失输入。

### Service Definition 形态

```typescript
declare module '@deepseek-ai/cordis' {
  interface Context {
    graphEngine: GraphEngine
  }
}

abstract class GraphEngine extends Service {
  readonly graphNodeProviders: GraphNodeProviderRegistry
  abstract start(request: GraphStartRequest): GraphRun
}

class GraphNodeProviderRegistry {
  register(name: string, provider: GraphNodeProvider): () => void
  get(name: string): GraphNodeProvider | null
}
```

`GraphStartRequest` 携带 `topology`、可选 `args`、`parent: Agent` 和可选 `signal`。`GraphRun` 携带 `id`、`topology`、`result: Promise<GraphRunResult>`、`cancel()` 和 `dispose()`。

## 后果

- **拓扑可见，不隐藏在代码中**。UI 可以独立于脚本体渲染依赖图。调用方可以检查 DAG 以决定是否提交。
- **失败默认局部化**。`isolate` 模式匹配标准 DAG 语义：一个分支失败不会杀死独立分支。
- **没有新的 loop 核心**。调度器位于 `GraphEngine.start()` 内部，不在 `agent-loop` 中。轮次/步骤 loop 仍是默认产品 loop。
- **暂无面向模型的 tool**。该 seam 已准备好 tool 消费方（`dsh-tool-graph`），但未发货。模型不能直接调用 graph run；调用方通过代码或未来的 tool 编排和启动。
- **KV cache 影响是间接的**。每个 subagent 驱动的节点创建一个全新子 session，使该子 session 的 KV cache 复用失效。Graph seam 本身不产生模型可见输入。
- **该 seam 是基础，不是产品**。无拓扑验证器、无并发上限、无持久化 run、无 UI 渲染。这些均在已知限制中明确声明。

## 考虑过的替代方案

- **扩展 `workflow/` 支持 DAG**——不予采纳，因为 workflow 引擎在 worker 线程中运行 JS 脚本体。在脚本体中添加 DAG 语义会使脚本成为图本身，而非拓扑数据。两种执行模型（脚本驱动 vs. 数据驱动）会被混淆。
- **在 `agent-loop` 中添加 `GraphDriver`**——不予采纳，因为图执行是与轮次/步骤 loop 不同的生命周期。图 run 有独立的取消机制、独立的结果 promise、独立的节点 outcome。将其混入 loop 会使 loop 承担 DAG 调度职责，这是不同的关注点。
- **直接复用 `subagent`，不通过 graph seam**——不予采纳，因为 subagent seam 建模的是树（父 → 子），而非具有 fan-in 的一般 DAG。两个独立 subagent 都向第三个消费方汇聚的情况在 subagent seam 中没有位置。
- **在同一包中发货 `subagent` provider**——不予采纳，因为 provider 引入了对 `dsh-subagent` 和 subagent 生命周期约定的依赖。seam 应保持 provider 无关；后续包可以引入带有自身 `inject` 列表的 subagent provider。
- **将 `graphNodeProviders` 设为顶级 `ctx` 属性**——不予采纳，因为 Cordis 不允许在未声明 injection 的情况下向 `Context` 设置任意属性。将注册表存储在 engine 实例上使其保持 fiber 作用域，且无需破坏 Context proxy 约定即可访问。

## 已知限制与暂缓事项

- **无拓扑验证器**：环检测、不可达边检查、重复边检测均未实现。调度器接受任意 `GraphTopology`，调用方负责无环性。
- **无并发上限**：所有就绪节点同时启动。没有 `maxParallelism` 或背压机制。
- **无持久化图 run**：图 run 是进程本地的。重启不会恢复待处理的 run；调用方必须重建并重启动拓扑。
- **无内置节点 provider**：不发货任何 `subagent`、`function` 或 `workflow` provider。调用方必须注册自己的 provider 或使用后续包。
- **无图 UI**：`graph/*` 事件可用于 UI 消费，但无 trajectory 或 chat view 渲染它们。
- **无 fan-in 输入合并策略**：当节点有两条入边携带不同类型输出时，provider 收到一个单一的 `inputs` map。如何将两个不同类型输出合并为一个 map 由 provider 定义，而非引擎定义。
- **无节点级重试**：失败节点是终态。没有每节点重试计数或退避。`continue` 模式的失败不重试，向下游传递 `null`。
