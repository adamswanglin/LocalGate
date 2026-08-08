# LocalGate

**AI 接口代理网关 — 多模型统一代理，实时日志、费用追踪与用量分析。**

[English](README.md)

## 功能特性

- **多协议代理** — 透明代理 OpenAI Chat (`/v1/chat/completions`)、OpenAI Responses (`/v1/responses`)、Anthropic Messages (`/v1/messages`) 三种协议
- **上游源管理** — 配置多个 AI 服务商，各自独立的 API Key、协议地址与模型列表
- **通道抽象** — 对外暴露虚拟模型名，绑定多个上游源，一键切换生效上游
- **实时调用日志** — 捕获完整请求/响应报文（含流式 SSE），记录 token 计数、耗时与错误详情
- **费用追踪** — 按模型配置输入/缓存输入/输出单价，每次调用自动计算费用
- **用量统计** — Token 趋势图、按上游/通道/模型堆叠分析、按天/月聚合、费用明细
- **访问令牌鉴权** — 可选 Bearer Token 认证；未配置令牌时开放访问，空 key 即可调用
- **日志管理** — 收藏重要日志、标签分类、自动容量保留（1 万条上限，收藏记录永不删除）
- **桌面应用** — 跨平台 Electron 桌面壳（macOS / Windows / Linux），原生标题栏集成
- **Web 管理面板** — React 响应式 UI，内置中英双语支持
- **零外部依赖** — SQLite 本地存储，单进程部署，无需 Redis 或外部数据库

## 架构概览

```
┌─────────────┐       ┌──────────────────────────────────────────────┐       ┌─────────────────┐
│   客户端     │──────▶│              LocalGate 网关                   │──────▶│  上游 AI 服务    │
│  (任意 SDK)  │       │                                              │       │                 │
└─────────────┘       │  ┌──────────┐  ┌──────────┐  ┌───────────┐  │       │  • OpenAI       │
                      │  │  对外通道 │─▶│  上游绑定 │─▶│  上游源    │  │       │  • Anthropic    │
                      │  └──────────┘  └──────────┘  └───────────┘  │       │  • Azure OpenAI │
                      │                                              │       │  • Ollama       │
                      │  ┌──────────┐  ┌──────────┐  ┌───────────┐  │       │  • 任意 OpenAI  │
                      │  │ 调用日志  │  │ 访问令牌  │  │  统计报表  │  │       │    兼容服务     │
                      │  └──────────┘  └──────────┘  └───────────┘  │       │                 │
                      └──────────────────────────────────────────────┘       └─────────────────┘
```

**核心概念：**

| 概念 | 说明 |
|------|------|
| **上游源 (Source)** | 一个外部 AI 服务商（如 OpenAI、Anthropic），包含 API Key、协议地址和模型定义 |
| **对外通道 (Channel)** | 虚拟 API 入口，由对外模型名 + 协议类型唯一标识 |
| **上游绑定 (Binding)** | 将通道关联到具体的上游源模型；通道可有多个绑定，随时切换生效项 |
| **协议 (Protocol)** | API 格式：`openai_chat`、`openai_response` 或 `anthropic` |

## 技术栈

| 层级 | 技术 |
|------|------|
| 服务端 | [Hono](https://hono.dev) + Node.js |
| 数据库 | SQLite（[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)）+ [Drizzle ORM](https://orm.drizzle.team) |
| 前端 | React 18 + [Tailwind CSS 4](https://tailwindcss.com) + [React Router](https://reactrouter.com) |
| 构建 | [Vite](https://vite.dev)（前端）+ TypeScript（服务端） |
| 桌面端 | [Electron](https://www.electronjs.org) + electron-builder |
| 图表 | 自研 SVG 堆叠柱状图 |

## 快速开始

### 前置要求

- Node.js >= 20
- pnpm >= 9

### 作为服务运行

```bash
# 克隆仓库
git clone https://github.com/your-username/localgate.git
cd localgate

# 安装依赖
pnpm install

# 一键启动（前台运行）
./start.sh

# 后台运行
./start.sh -d

# 查看状态 / 停止
./start.sh status
./start.sh stop
```

服务默认监听 `http://localhost:8787`，浏览器打开即可进入管理面板。

### 作为桌面应用运行

```bash
# 安装依赖
pnpm install

# 重编译原生模块为 Electron ABI
pnpm exec electron-rebuild -w better-sqlite3

# 构建项目
pnpm run build

# 启动桌面壳
make run
```

### 环境变量

创建 `.env` 文件（或使用默认值）：

```env
DB_PATH=.run/agent-proxy.db   # SQLite 数据库路径
PORT=8787                      # 服务端口
```

## 使用指南

### 1. 添加上游源

打开管理面板 → **上游源** → **新增源**：

- 填写名称（如 "OpenAI 官方"）
- 填写 API Key
- 添加协议地址（如 `openai_chat` → `https://api.openai.com/v1`）
- 添加支持的模型，可选配置单价（元/百万 token）

### 2. 创建对外通道

进入 **对外通道** → **新增通道**：

- 设置对外模型名（如 `gpt-4o`）— 客户端请求 `body.model` 使用此名称
- 选择入站协议（如 `openai_chat`）
- 绑定一个或多个上游源+模型组合
- 可随时切换当前生效的上游

### 3. 调用代理

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "你好！"}]
  }'
```

### 支持的 API 端点

| 协议 | 路径 | 鉴权方式 |
|------|------|----------|
| OpenAI Chat | `POST /v1/chat/completions` | `Authorization: Bearer <token>` |
| OpenAI Responses | `POST /v1/responses` | `Authorization: Bearer <token>` |
| Anthropic Messages | `POST /v1/messages` | `x-api-key: <token>` |

### 访问令牌

- **未配置令牌**时，代理开放访问，空 key 即可调用
- 配置令牌后，客户端需通过 `Authorization: Bearer <token>` 或 `x-api-key` 请求头携带有效令牌
- 令牌可在管理面板中创建、启用/停用和管理

## 打包桌面应用

```bash
# 打包当前平台
make dist

# 打包指定平台（需在对应操作系统上执行）
make dist-mac      # macOS arm64 + x64
make dist-win      # Windows x64（NSIS 安装包）
make dist-linux    # Linux x64（AppImage）
```

打包产物输出到 `release/` 目录。

## 持续集成

GitHub Actions 工作流（`.github/workflows/release.yml`）在推送版本标签（`v*`）时自动构建并发布全平台产物：

- **macOS**：arm64 + x64 DMG 和 ZIP
- **Windows**：x64 NSIS 安装包
- **Linux**：x64 AppImage

## 项目结构

```
agent-proxy/
├── src/server/           # 后端服务
│   ├── db/               # 数据库 schema 与迁移
│   ├── lib/              # 协议定义、usage 规范化、日志写入
│   └── routes/           # 代理路由 & 管理 API
├── web/                  # 前端（React SPA）
│   └── src/
│       ├── components/   # 通用 UI 组件与图表
│       ├── lib/          # API 客户端、i18n、内容工具
│       └── pages/        # 上游源、通道、日志、统计页面
├── electron/             # Electron 桌面壳
├── scripts/              # 迁移工具
├── start.sh              # 一键启动脚本
├── Makefile              # 构建与打包命令
└── schema.sql            # SQL 参考 schema
```

## 管理 API 参考

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/settings` | 获取全局配置 |
| `PATCH` | `/api/settings` | 更新全局配置 |
| `GET` | `/api/meta` | 获取服务元信息（端口、本机 IP） |
| `GET` | `/api/sources` | 获取上游源列表 |
| `POST` | `/api/sources` | 创建上游源 |
| `PATCH` | `/api/sources/:id` | 更新上游源 |
| `DELETE` | `/api/sources/:id` | 删除上游源 |
| `POST` | `/api/sources/:id/test` | 测试上游连通性 |
| `GET` | `/api/channels` | 获取通道列表 |
| `POST` | `/api/channels` | 创建通道 |
| `PATCH` | `/api/channels/:id` | 更新通道 |
| `PATCH` | `/api/channels/:id/active` | 切换生效的上游绑定 |
| `DELETE` | `/api/channels/:id` | 删除通道 |
| `GET` | `/api/tokens` | 获取访问令牌列表 |
| `POST` | `/api/tokens` | 创建访问令牌 |
| `PATCH` | `/api/tokens/:id` | 更新访问令牌 |
| `DELETE` | `/api/tokens/:id` | 删除访问令牌 |
| `GET` | `/api/logs` | 获取调用日志（分页、可筛选） |
| `GET` | `/api/logs/:id` | 获取日志详情 |
| `PATCH` | `/api/logs/:id/star` | 收藏/取消收藏 |
| `PATCH` | `/api/logs/:id/tags` | 更新日志标签 |
| `DELETE` | `/api/logs` | 清空非收藏日志 |
| `GET` | `/api/stats` | 聚合用量统计 |
| `GET` | `/api/stats/stacked` | 堆叠图表数据 |

## 许可证

MIT
