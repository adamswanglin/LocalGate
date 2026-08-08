# LocalGate

**AI API Proxy Gateway — Unified multi-provider AI interface proxy with real-time logging, cost tracking, and usage analytics.**

[中文文档](README_zh.md)

## Features

- **Multi-Protocol Proxy** — Transparently proxy OpenAI Chat (`/v1/chat/completions`), OpenAI Responses (`/v1/responses`), and Anthropic Messages (`/v1/messages`) through a single gateway
- **Upstream Source Management** — Configure multiple AI providers with independent API keys, protocol endpoints, and model lists
- **Channel Abstraction** — Expose virtual model names to clients, bind multiple upstream sources, and switch active upstreams with one click
- **Real-time Call Logging** — Capture full request/response bodies (including streaming SSE), with token counts, latency, and error details
- **Cost Tracking** — Per-model pricing (input / cached input / output), automatic cost calculation on every call
- **Usage Analytics** — Token trends, stacked charts by source/channel/model, daily/monthly aggregation, and cost breakdowns
- **Access Token Auth** — Optional Bearer token authentication; open access when no tokens are configured
- **Log Management** — Star important logs, tag entries, auto-retention with 10K cap (starred logs are preserved)
- **Desktop App** — Cross-platform Electron app (macOS / Windows / Linux) with native title bar integration
- **Web Dashboard** — Responsive React UI with bilingual support (中文 / English)
- **Zero External Dependencies** — SQLite storage, single-process deployment, no Redis or external database required

## Architecture

```
┌─────────────┐       ┌──────────────────────────────────────────────┐       ┌─────────────────┐
│   Client    │──────▶│              LocalGate Gateway                │──────▶│  Upstream AI    │
│  (any SDK)  │       │                                              │       │  Providers      │
└─────────────┘       │  ┌──────────┐  ┌──────────┐  ┌───────────┐  │       │                 │
                      │  │ Channels │─▶│ Bindings │─▶│  Sources   │  │       │  • OpenAI       │
                      │  └──────────┘  └──────────┘  └───────────┘  │       │  • Anthropic    │
                      │                                              │       │  • Azure OpenAI │
                      │  ┌──────────┐  ┌──────────┐  ┌───────────┐  │       │  • Ollama       │
                      │  │ Call Logs│  │  Tokens  │  │  Stats    │  │       │  • Any OpenAI-  │
                      │  └──────────┘  └──────────┘  └───────────┘  │       │    compatible   │
                      └──────────────────────────────────────────────┘       └─────────────────┘
```

**Core Concepts:**

| Concept | Description |
|---------|-------------|
| **Source** | An upstream AI provider (e.g., OpenAI, Anthropic) with API key, protocol endpoints, and model definitions |
| **Channel** | A virtual API entry point identified by exposed model name + protocol type |
| **Binding** | Links a channel to a specific upstream source model; channels can have multiple bindings and switch between them |
| **Protocol** | API format: `openai_chat`, `openai_response`, or `anthropic` |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | [Hono](https://hono.dev) + Node.js |
| Database | SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) + [Drizzle ORM](https://orm.drizzle.team) |
| Frontend | React 18 + [Tailwind CSS 4](https://tailwindcss.com) + [React Router](https://reactrouter.com) |
| Build | [Vite](https://vite.dev) (frontend) + TypeScript (server) |
| Desktop | [Electron](https://www.electronjs.org) + electron-builder |
| Charts | Custom SVG stacked bar charts |

## Quick Start

### Prerequisites

- Node.js >= 20
- pnpm >= 9

### Run as Server

```bash
# Clone the repository
git clone https://github.com/your-username/localgate.git
cd localgate

# Install dependencies
pnpm install

# Start with one-click script (foreground)
./start.sh

# Or start in background
./start.sh -d
```

The server starts on `http://localhost:8787` by default. Open the URL in your browser to access the Web Dashboard.

### Run as Desktop App

```bash
# Install dependencies
pnpm install

# Rebuild native modules for Electron
pnpm exec electron-rebuild -w better-sqlite3

# Build the project
pnpm run build

# Launch desktop app
make run
```

### Environment Variables

Create a `.env` file (or use defaults):

```env
DB_PATH=.run/agent-proxy.db   # SQLite database path
PORT=8787                      # Server port
```

## Usage

### 1. Add an Upstream Source

Open the Web Dashboard → **Sources** → **New Source**:

- Enter a name (e.g., "OpenAI Official")
- Enter the API Key
- Add protocol endpoints (e.g., `openai_chat` → `https://api.openai.com/v1`)
- Add supported models with optional pricing

### 2. Create a Channel

Go to **Channels** → **New Channel**:

- Set the exposed model name (e.g., `gpt-4o`) — this is what clients will use in `body.model`
- Select the inbound protocol (e.g., `openai_chat`)
- Bind one or more upstream source+model combinations
- Switch active upstream anytime

### 3. Call the Proxy

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Supported API Endpoints

| Protocol | Path | Auth Header |
|----------|------|-------------|
| OpenAI Chat | `POST /v1/chat/completions` | `Authorization: Bearer <token>` |
| OpenAI Responses | `POST /v1/responses` | `Authorization: Bearer <token>` |
| Anthropic Messages | `POST /v1/messages` | `x-api-key: <token>` |

### Access Tokens

- When **no tokens** are configured, the proxy allows open access (empty key works)
- When tokens are configured, clients must provide a valid token via `Authorization: Bearer <token>` or `x-api-key` header
- Tokens can be created, enabled/disabled, and managed from the Web Dashboard

## Build Desktop Packages

```bash
# Build for current platform
make dist

# Build for specific platforms (run on the respective OS)
make dist-mac      # macOS arm64 + x64
make dist-win      # Windows x64 (NSIS installer)
make dist-linux    # Linux x64 (AppImage)
```

Packages are output to the `release/` directory.

## CI/CD

GitHub Actions workflow (`.github/workflows/release.yml`) automatically builds and releases for all platforms when a version tag (`v*`) is pushed:

- **macOS**: arm64 + x64 DMG & ZIP
- **Windows**: x64 NSIS installer
- **Linux**: x64 AppImage

## Project Structure

```
agent-proxy/
├── src/server/           # Backend server
│   ├── db/               # Database schema & migrations
│   ├── lib/              # Protocol definitions, usage normalization, log writer
│   └── routes/           # Proxy routes & admin API
├── web/                  # Frontend (React SPA)
│   └── src/
│       ├── components/   # Shared UI components & charts
│       ├── lib/          # API client, i18n, content helpers
│       └── pages/        # Sources, Channels, Logs, Stats pages
├── electron/             # Electron desktop shell
├── scripts/              # Migration utilities
├── start.sh              # One-click server launcher
├── Makefile              # Build & packaging commands
└── schema.sql            # SQL reference schema
```

## API Reference

### Admin API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings` | Get global settings |
| `PATCH` | `/api/settings` | Update global settings |
| `GET` | `/api/meta` | Get server metadata (port, local IPs) |
| `GET` | `/api/sources` | List upstream sources |
| `POST` | `/api/sources` | Create a source |
| `PATCH` | `/api/sources/:id` | Update a source |
| `DELETE` | `/api/sources/:id` | Delete a source |
| `POST` | `/api/sources/:id/test` | Test source connectivity |
| `GET` | `/api/channels` | List channels |
| `POST` | `/api/channels` | Create a channel |
| `PATCH` | `/api/channels/:id` | Update a channel |
| `PATCH` | `/api/channels/:id/active` | Switch active upstream binding |
| `DELETE` | `/api/channels/:id` | Delete a channel |
| `GET` | `/api/tokens` | List access tokens |
| `POST` | `/api/tokens` | Create a token |
| `PATCH` | `/api/tokens/:id` | Update a token |
| `DELETE` | `/api/tokens/:id` | Delete a token |
| `GET` | `/api/logs` | List call logs (paginated, filterable) |
| `GET` | `/api/logs/:id` | Get log detail |
| `PATCH` | `/api/logs/:id/star` | Star/unstar a log |
| `PATCH` | `/api/logs/:id/tags` | Update log tags |
| `DELETE` | `/api/logs` | Clear non-starred logs |
| `GET` | `/api/stats` | Aggregated usage statistics |
| `GET` | `/api/stats/stacked` | Stacked chart data |

## License

MIT
