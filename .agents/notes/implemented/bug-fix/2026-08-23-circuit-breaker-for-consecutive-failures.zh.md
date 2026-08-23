# Agent Note: 熔断器用于连续失败检测

Status: proposed

## 问题

当 agent 陷入逻辑循环时（如反复使用错误的变量名 `_OO_MODELS_TTL` 而非 `_OC_MODELS_TTL`），现有的 `repeat-tool-reminder` guard 只发出 advisory 警告，无法**阻止**进一步执行。经过约 20 次失败尝试后，agent 浪费 token 和时间却毫无进展。

反馈循环显示：
1. Agent 尝试用错误的变量名 Edit
2. Edit 失败："old_string was not found"
3. Agent 读取文件，看到正确名称 `_OC_MODELS_TTL`
4. Agent 下次尝试仍然输入 `_OO_MODELS_TTL`
5. 循环重复约 20 次直到外部干预

`repeat-tool-reminder` 检测**相同的工具调用**，但不检测**带变化参数的重复失败**。这个空白导致逻辑循环未被检测。

## 提案

添加新的 guard 插件 `circuit-breaker`：

1. **追踪连续失败**：按 agent 统计，不仅统计重复调用
2. **熔断**：失败次数超过阈值时（默认：5）
3. **阻止进一步工具调用**：直到策略改变
4. **成功时重置**：或用户介入时重置

### 配置

```yaml
plugins:
  circuit-breaker:
    failureThreshold: 5  # 停止前的连续失败次数
    windowSize: 10       # 考虑的步数
    include: []          # 工具模式（空 = 全部）
    exclude: []          # 要忽略的工具模式
```

### 行为

| 状态 | 动作 |
|------|------|
| 闭合（正常） | 计数失败，在阈值/2 时发出提醒 |
| 打开（熔断） | 阻止所有工具调用，强制改变策略 |
| 半开（用户输入后） | 重置并允许测试新方法 |

### 实现

- 位置：`packages/guard/circuit-breaker/`
- 监听 `tools/post-execute` 检测失败
- 监听 `agent/pre-step` 处理用户介入重置
- 使用 `WeakMap<Agent, ChainState>` 存储 per-agent 状态
- 当熔断器打开时，发出阻塞决策并强制上下文切换

### 关键设计决策

1. **阻止而非仅警告**：与 `repeat-tool-reminder` 不同，此插件在达到阈值时返回 `{ kind: 'block' }`
2. **失败检测**：基于 `result.isError === true`，而非仅重复调用
3. **窗口计数**：只计算近期失败（可配置 `windowSize`）
4. **用户重置**：任何用户消息都会清除失败链，允许恢复

## 考虑的替代方案

### 为什么不扩展 `repeat-tool-reminder`？

`repeat-tool-reminder` 设计用于**相同调用检测**（相同工具，相同参数）。扩展它以检测失败会：
- 混合两个不同关注点（重复 vs 失败）
- 将其语义从"advisory"改为"blocking"
- 破坏依赖非阻塞行为现有部署

独立插件保持关注点清晰，允许独立配置。

### 为什么不向 agent-loop 添加 max-turns 限制？

全局 max-turns 限制会：
- 阻止合法的长运行任务
- 无法区分进展和循环
- 是粗糙工具而非精确检测

Circuit breaker 更精确：它检测**无进展**循环，而非仅长运行。

### 为什么不使用 subagent 委托？

Subagent 委托可以隔离失败但：
- 增加复杂性（新会话，上下文传输）
- 不能阻止父 agent 犯同样错误
- circuit-breaker 更简单更直接

## 验收标准

- [ ] 插件通过 `pnpm run build` 编译
- [ ] 插件注册在 `packages/guard/README.md`
- [ ] 配置 schema 在加载时 fail-loud 验证
- [ ] 连续失败 N 次后熔断器打开（默认 5）
- [ ] 熔断器打开时工具调用被阻止
- [ ] 成功的工具调用后熔断器重置
- [ ] 用户消息注入后熔断器重置
- [ ] 单元测试覆盖所有状态转换
- [ ] 快照测试验证阻止行为

## 风险

| 风险 | 缓解措施 |
|------|----------|
| 误报：合法重试被计为失败 | 窗口计数 + 用户重置 |
| 破坏现有部署 | opt-in 插件，默认不启用 |
| Agent 卡在半开状态 | 基于超时的自动重置（未来） |
| 配置复杂性 | 合理默认值，最小配置需求 |
