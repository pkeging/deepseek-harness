# 52kg Harness - 多用户代理

基于 deepseek-harness 的多用户代理原型（路径 A）：通过反向代理 + 每用户独立 dsh 进程实现多用户数据隔离。

## 架构

```
浏览器 → [代理服务器:4000] → JWT 认证 → 按用户路由 → [dsh-web:随机端口]
                                            ↓
                                     每用户独立 DSH_HOME
```

## 特性

- 用户注册/登录（JWT + SQLite，首用户自动 admin）
- 每个用户独立 dsh-web 进程（独立端口 + 独立数据目录）
- HTTP + WebSocket 双向代理
- 用户间数据完全隔离（进程级 + 文件系统级）
- 零外部依赖（纯 Node.js 内置模块）

## 快速开始

### Windows

```powershell
cd multiuser-proxy
.\start.ps1
```

打开 http://127.0.0.1:4000 ，第一个注册的用户自动成为管理员。

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DSH_ROOT` | `..` | deepseek-harness 根目录（用于运行 dsh） |
| `DSH_MULTIUSER_DATA` | `./data` | 数据目录（用户数据库 + 各用户 DSH_HOME） |
| `DSH_MULTIUSER_HOST` | `127.0.0.1` | 代理监听地址 |
| `DSH_MULTIUSER_PORT` | `4000` | 代理监听端口 |
| `DSH_MULTIUSER_SECRET` | 自动生成 | JWT 签名密钥（不设则存 data/secret.key） |

## 目录结构

```
multiuser-proxy/
├── src/
│   ├── index.js           # 入口
│   ├── server.js          # HTTP 服务器 + 反向代理 + WebSocket 代理
│   ├── auth.js            # 用户认证（SQLite + JWT + PBKDF2）
│   ├── process-manager.js # dsh 进程管理（每用户独立进程）
│   ├── websocket.js       # WebSocket 服务器实现
│   └── static.js          # 静态文件服务
├── public/
│   ├── login.html         # 登录页
│   └── register.html      # 注册页
├── data/                  # 运行时数据（自动创建）
│   ├── users.db           # 用户数据库
│   ├── secret.key         # JWT 密钥
│   └── users/
│       ├── user_1/        # 用户 1 的 DSH_HOME
│       └── user_2/        # 用户 2 的 DSH_HOME
├── start.ps1              # Windows 启动脚本
└── package.json
```

## 验证多用户隔离

1. 浏览器 A 注册用户 alice，创建几个会话
2. 浏览器 B（或隐私模式）注册用户 bob
3. 检查 `data/users/` 下有两个独立目录，各自数据互不可见

## 管理 API（仅 admin）

- `GET /api/admin/processes` — 查看当前活跃的 dsh 进程列表

## 局限性（原型阶段）

- 进程没有空闲回收（长时间不活动也占着端口和内存）
- 没有并发限流（同一用户可开无限进程）
- 没有配额/计费
- WebSocket 帧解析只支持基本文本/二进制帧（不支持分片、扩展）
- 密码重置需要手动操作数据库
- 仅支持 HTTP，生产环境需套 TLS
