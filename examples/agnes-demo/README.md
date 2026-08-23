# Agnes 2.0 Flash 配置指南

## 概述

本示例演示如何在 DeepSeek Harness (dsh) 中配置 Agnes 2.0 Flash 模型。

Agnes AI 提供 OpenAI 兼容的 API 端点，因此使用 `llm-pi-ai` 插件（通用适配器）而非专用的 `llm-deepseek` 插件。

## 架构选择

### 为什么使用 llm-pi-ai？

| 特性     | llm-deepseek      | llm-pi-ai                               |
| -------- | ----------------- | --------------------------------------- |
| 适用场景 | DeepSeek 官方 API | OpenAI 兼容 API（包括 Agnes）           |
| 协议支持 | DeepSeek 专有 SSE | openai-completions, openai-responses 等 |
| 配置方式 | 单一 provider     | 多 provider dict                        |
| 热重载   | 支持              | 支持                                    |

Agnes API 端点 `https://apihub.agnes-ai.cn/v1` 完全兼容 OpenAI 协议，因此使用 `llm-pi-ai`。

## 文件说明

```
examples/agnes-demo/
├── cordis.yml              # 主配置文件
├── .credentials.yaml.example # 凭证文件示例（复制后使用）
├── .env                    # 环境变量（可选）
└── README.md               # 本文件
```

## 配置步骤

### 方式一：使用凭证文件（推荐）

1. 复制凭证示例文件：

```bash
cp .credentials.yaml.example .credentials.yaml
```

2. 编辑 `.credentials.yaml`，填入真实 API Key：

```yaml
version: 1

refs:
  AGNES_API_KEY: "sk-your-agnes-api-key-here"
```

3. 设置 DSH_HOME 并运行：

```bash
export DSH_HOME=~/.dsh-agnes
dsh web --cordis examples/agnes-demo/cordis.yml
```

### 方式二：使用环境变量

1. 设置环境变量：

```bash
# Windows (PowerShell)
$env:AGNES_API_KEY = "sk-your-agnes-api-key-here"

# Linux/macOS
export AGNES_API_KEY="sk-your-agnes-api-key-here"
```

2. 运行：

```bash
dsh web --cordis examples/agnes-demo/cordis.yml
```

## 安全说明

### 密钥安全层次

dsh 的凭证系统提供四层优先级（从高到低）：

1. **进程环境变量** - 启动时继承，不可修改
2. **`.credentials.yaml`** - 热重载，可编辑
3. **项目 `.env`** - 启动时加载
4. **`$DSH_HOME/.env`** - 用户级环境变量

环境变量优先级最高，因此推荐：

- 生产环境：使用进程环境变量或 CI/CD 密钥管理
- 开发环境：使用 `.credentials.yaml`

### 文件权限

凭证文件自动设置为：

- 目录：`0700`（仅所有者可访问）
- 文件：`0600`（仅所有者可读写）

### 密钥不出现在配置文件中

注意 `cordis.yml` 中只引用 `apiKeyEnv: AGNES_API_KEY`，不包含实际密钥。密钥通过凭证服务在每次请求时解析。

## 模型能力

| 模型            | 上下文窗口 | 最大输出 | 输入模态   |
| --------------- | ---------- | -------- | ---------- |
| agnes-2.0-flash | 512K       | 64K      | 文本、图片 |
| agnes-2.5-flash | 512K       | 64K      | 文本、图片 |

## 动态配置

通过 `$DSH_HOME/settings.yaml` 可以热重载配置，无需重启：

```yaml
# $DSH_HOME/settings.yaml
llm-pi-ai:
  providers:
    agnes:
      # 可以覆盖任意字段
      baseURL: https://apihub.agnes-ai.cn/v1
      models:
        - id: agnes-2.0-flash
          contextWindow: 524288
```

## 切换模型

在对话中使用 `/model` 命令切换：

```
/model agnes/agnes-2.0-flash
/model agnes/agnes-2.5-flash
```

## 故障排查

### 错误：MISSING_CREDENTIAL

原因：未找到 API Key
解决：

1. 检查环境变量 `AGNES_API_KEY` 是否设置
2. 或检查 `.credentials.yaml` 是否存在且有效

### 错误：TRANSPORT

原因：网络连接问题
解决：

1. 检查能否访问 `https://apihub.agnes-ai.cn/v1`
2. 检查防火墙/代理设置

### 错误：AUTH

原因：API Key 无效
解决：

1. 检查 Key 是否正确
2. 确认 Key 未过期

## 参考

- [dsh-llm-pi-ai 文档](../../packages/llm/llm-pi-ai/README.md)
- [dsh-credentials-local 文档](../../packages/credentials/credentials-local/README.md)
- [Cordis 配置系统](../../docs/architecture.md)
