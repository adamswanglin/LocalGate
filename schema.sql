-- agent-proxy schema (SQLite)
-- 启动时由 src/server/db/migrate.ts 自动建表；此处仅作参考。

CREATE TABLE IF NOT EXISTS t_proxy_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,                 -- openai_chat | openai_response | anthropic
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS t_proxy_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL,                 -- openai_chat | openai_response | anthropic
  source_id INTEGER NOT NULL,
  exposed_model TEXT,                     -- 对外暴露模型名
  upstream_model TEXT,                    -- 转发上游实际模型名
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_exposed_model_protocol
  ON t_proxy_channels (exposed_model, protocol);

CREATE TABLE IF NOT EXISTS t_proxy_call_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER,
  channel_name TEXT,
  source_id INTEGER,
  protocol TEXT NOT NULL,
  model TEXT,
  is_stream INTEGER NOT NULL DEFAULT 0,
  status_code INTEGER,
  latency_ms INTEGER,
  request_body TEXT,
  response_body TEXT,
  response_chunks TEXT,
  usage TEXT,                             -- 原始 usage JSON（各协议格式不同）
  input_tokens INTEGER,                   -- 规范化：输入 token（不含缓存）
  cached_input_tokens INTEGER,            -- 规范化：输入 token（缓存命中）
  output_tokens INTEGER,                  -- 规范化：输出 token
  error TEXT,
  aborted INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]',        -- JSON 数组
  starred INTEGER NOT NULL DEFAULT 0,     -- 是否收藏（清理时保护）
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_call_channel ON t_proxy_call_logs (channel_id);
CREATE INDEX IF NOT EXISTS idx_call_source  ON t_proxy_call_logs (source_id);
CREATE INDEX IF NOT EXISTS idx_call_created ON t_proxy_call_logs (created_at);

-- 全局配置（单行，固定 id=1）
CREATE TABLE IF NOT EXISTS t_proxy_settings (
  id INTEGER PRIMARY KEY,
  log_io INTEGER NOT NULL DEFAULT 1,
  log_stream_body INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO t_proxy_settings (id, log_io, log_stream_body) VALUES (1, 1, 1);
