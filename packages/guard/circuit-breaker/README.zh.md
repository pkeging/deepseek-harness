# Circuit Breaker Guard

中文 | [English](README.md)

检测连续失败模式并强制改变策略或停止循环。

## 问题

`repeat-tool-reminder` 包只提供 advisory 提醒，无法**阻止**重复失败。当 agent 陷入逻辑循环时（如反复使用错误的变量名），需要硬停止，而不只是提示。

## 解决方案

本插件实现**熔断器**模式：

1. **追踪失败**：统计每个 agent 的连续工具调用失败次数
2. **熔断**：失败次数超过阈值时，阻止进一步调用
3. **成功重置**：成功的调用关闭熔断器
4. **用户输入重置**：用户介入清除失败链

## 配置

```yaml
plugins:
  circuit-breaker:
    failureThreshold: 5  # 连续失败多少次后停止（默认 5）
    windowSize: 10       # 考虑多少步（默认 10）
    include: []          # 追踪的工具模式（空 = 全部）
    exclude: []          # 忽略的工具模式
```

## 行为

| 状态 | 动作 |
|------|------|
| 闭合（正常） | 计数失败，在阈值/2 时发出提醒 |
| 打开（熔断） | 阻止所有工具调用，强制改变策略 |
| 半开（用户输入后） | 重置并允许测试新方法 |

## 集成

在 `cordis.yml` 中注册：

```yaml
plugins:
  - name: circuit-breaker
    config:
      failureThreshold: 5
      windowSize: 10
```

## 与 repeat-tool-reminder 的区别

| 方面 | repeat-tool-reminder | circuit-breaker |
|------|---------------------|-----------------|
| 动作 | 仅 advisory | 可阻止调用 |
| 触发 | 重复相同调用 | 连续失败 |
| 重置 | 在不同调用时 | 成功或用户输入时 |
| 严重性 | 警告 | 强制停止 + 上下文切换 |

两者配合使用：`repeat-tool-reminder` 用于早期检测，`circuit-breaker` 用于硬停止。
