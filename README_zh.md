<p align="center">
  <img src="build/icon.svg" width="128" height="128" alt="LocalGate">
</p>

# LocalGate

**100% 本地运行的 AI 接口代理网关 — 完全跑在你自己的机器上，无需上云、无需注册。多模型统一代理，实时日志、费用追踪与用量分析。**

[English](README.md)

## 为什么需要 LocalGate？

当你同时使用多个 AI 服务商（OpenAI、Anthropic、Azure、Ollama 等），通常会遇到这些问题：

- 每家 API 格式和鉴权方式不同，客户端要分别适配
- 切换服务商需要改代码
- 无法直观看到 token 消耗和费用
- 出问题时无从排查请求内容

LocalGate 用一个本地网关解决所有问题。你的应用只需对接 LocalGate，后续的服务商管理、模型切换、路由调整全部在可视化面板中完成——**无需改代码**。

## 功能特性

- **统一接口** — OpenAI、Anthropic 及所有 OpenAI 兼容服务，统一走同一套端点
- **模型别名** — 对外暴露虚拟模型名（如 `gpt-4o`），实际路由到任意上游
- **一键切换** — 入口可绑定多个上游，随时切换生效项，适合容灾和 A/B 测试
- **完整日志** — 捕获每次请求/响应的完整报文，含流式 SSE 内容
- **费用追踪** — 按模型配置单价，每次调用自动计算费用
- **用量统计** — Token 趋势、按上游/入口/模型拆分、按天/月聚合
- **访问控制** — 可选令牌鉴权；不配置则开放访问
- **桌面应用** — macOS、Windows、Linux 原生桌面客户端

## 快速开始

### 下载桌面应用

前往 [GitHub Releases](../../releases) 下载最新版：

- **macOS**：`.dmg`（arm64 适配 Apple Silicon，x64 适配 Intel）
- **Windows**：`.exe` 安装包（x64）
- **Linux**：`.AppImage`（x64）

或从源码构建：

```bash
pnpm install
pnpm exec electron-rebuild -w better-sqlite3
pnpm run build
make run
```

### 作为服务运行

```bash
git clone https://github.com/your-username/localgate.git
cd localgate
pnpm install
./start.sh          # 前台运行（Ctrl+C 停止）
./start.sh -d       # 后台运行
```

浏览器打开 `http://localhost:8787` 即可进入管理面板。

## 使用指南

### 第一步：添加上游源

进入 **上游源** → **新增源**，配置一个 AI 服务商：

![上游源](examples/sources.jpg)

- **名称**：便于识别的标签（如 "OpenAI 官方"、"本地 Ollama"）
- **API Key**：服务商的密钥（同一源的所有协议地址共用）
- **协议地址**：添加一个或多个协议端点，填写**完整的 API 地址**（含路径，不要只填到 `/v1`）：
  - `openai_chat` → `https://api.openai.com/v1/chat/completions`
  - `openai_response` → `https://api.openai.com/v1/responses`
  - `anthropic` → `https://api.anthropic.com/v1/messages`
- **模型与价格**：添加支持的模型，可选配置单价（元/百万 token）

**常见上游源配置参考：**

| 服务商 | 协议 | 完整 API 地址 |
|--------|------|----------|
| OpenAI | openai_chat | `https://api.openai.com/v1/chat/completions` |
| Anthropic | anthropic | `https://api.anthropic.com/v1/messages` |
| Azure OpenAI | openai_chat | `https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions` |
| Ollama（本地） | openai_chat | `http://localhost:11434/v1/chat/completions` |
| DeepSeek | openai_chat | `https://api.deepseek.com/v1/chat/completions` |
| 其他兼容服务 | openai_chat | 视具体服务而定 |

### 第二步：创建模型入口

进入 **模型入口** → **新增入口**，创建一个虚拟 API 入口：

![模型入口](examples/model_entry.jpg)

- **对外模型名**：客户端请求中使用的名称（如 `gpt-4o`、`my-model`）
- **入站协议**：接受哪种 API 格式（`openai_chat`、`openai_response` 或 `anthropic`）
- **上游绑定**：选择一个或多个「源 + 模型」组合

同一个入口可以绑定多个上游，随时切换——非常适合容灾切换或对比测试。

### 第三步：调用代理

在请求中使用对外模型名即可，LocalGate 自动完成路由：

```bash
# OpenAI Chat 格式
curl http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "你好！"}]}'

# Anthropic 格式
curl http://localhost:8787/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_TOKEN" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model": "claude-3", "max_tokens": 1024, "messages": [{"role": "user", "content": "你好！"}]}'
```

**直接对接 OpenAI SDK** — 只需改 base URL：

```python
# Python
import openai
client = openai.OpenAI(
    base_url="http://localhost:8787/v1",
    api_key="YOUR_TOKEN"
)
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "你好！"}]
)
```

```javascript
// JavaScript
import OpenAI from 'openai';
const client = new OpenAI({
  baseURL: 'http://localhost:8787/v1',
  apiKey: 'YOUR_TOKEN',
});
const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: '你好！' }],
});
```

### 支持的 API 端点

| 协议 | 路径 | 鉴权方式 |
|------|------|----------|
| OpenAI Chat | `POST /v1/chat/completions` | `Authorization: Bearer <token>` |
| OpenAI Responses | `POST /v1/responses` | `Authorization: Bearer <token>` |
| Anthropic Messages | `POST /v1/messages` | `x-api-key: <token>` |

所有协议均支持流式响应（`"stream": true`）。

### 访问令牌

- **未配置令牌** → 代理开放访问，空 key 即可调用
- **配置令牌后** → 客户端需通过 `Authorization: Bearer <token>` 或 `x-api-key` 请求头携带有效令牌
- 在管理面板中创建、启用/停用令牌，查看最近使用时间

### 调用日志与调试

![调用日志](examples/calllogs.jpg)

每次代理请求都会自动记录：

- 完整的请求和响应报文（含流式 SSE 内容）
- Token 计数（输入、缓存命中、输出）
- 耗时、状态码、错误详情
- 基于上游模型单价的自动费用计算

你可以**收藏**重要日志、**打标签**便于筛选，在详情页查看格式化或原始报文。

### 用量统计

![用量统计](examples/statistics.jpg)

管理面板提供多种统计视图：

- **Token 趋势** — 按天/月查看输入输出 token 变化
- **堆叠图表** — 按上游、入口或模型拆分占比
- **费用追踪** — 总费用及各上游/模型的消耗明细
- **多维筛选** — 按时间范围、协议、上游、入口或模型过滤

### 日志自动保留

日志总量自动控制在 1 万条以内。达到上限时，最旧的非收藏日志会被清理。**收藏的日志永远不会被删除。**

## 配置项

创建 `.env` 文件自定义：

```env
DB_PATH=.run/agent-proxy.db   # SQLite 数据库路径
PORT=8787                      # 服务端口
```

数据库首次启动时自动创建，所有数据存储在本地单个 SQLite 文件中。

## 许可证

MIT
