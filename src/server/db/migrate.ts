import type { Database as BetterSqlite3Db } from 'better-sqlite3';

/**
 * 启动期建表 / 种子数据。幂等：全部使用 IF NOT EXISTS / INSERT OR IGNORE。
 * 与 src/server/db/schema.ts 的 Drizzle 定义保持一致。
 */
const DDL = [
  `CREATE TABLE IF NOT EXISTS t_proxy_sources (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     provider TEXT NOT NULL,
     base_url TEXT NOT NULL,
     api_key TEXT NOT NULL,
     enabled INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
   )`,
  `CREATE TABLE IF NOT EXISTS t_proxy_source_models (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     source_id INTEGER NOT NULL,
     model TEXT NOT NULL,
     input_price REAL,
     cached_input_price REAL,
     output_price REAL,
     enabled INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_source_model ON t_proxy_source_models (source_id, model)`,
  `CREATE TABLE IF NOT EXISTS t_proxy_source_endpoints (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     source_id INTEGER NOT NULL,
     protocol TEXT NOT NULL,
     base_url TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_source_endpoint_protocol
     ON t_proxy_source_endpoints (source_id, protocol)`,
  `CREATE TABLE IF NOT EXISTS t_proxy_channels (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     protocol TEXT NOT NULL,
     source_id INTEGER NOT NULL,
     exposed_model TEXT,
     upstream_model TEXT,
     enabled INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_exposed_model_protocol
     ON t_proxy_channels (exposed_model, protocol)`,
  `CREATE TABLE IF NOT EXISTS t_proxy_channel_sources (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     channel_id INTEGER NOT NULL,
     source_model_id INTEGER NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_channel_source_model
     ON t_proxy_channel_sources (channel_id, source_model_id)`,
  `CREATE TABLE IF NOT EXISTS t_proxy_tokens (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     token TEXT NOT NULL UNIQUE,
     enabled INTEGER NOT NULL DEFAULT 1,
     last_used_at TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
   )`,
  `CREATE TABLE IF NOT EXISTS t_proxy_call_logs (
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
     usage TEXT,
     input_tokens INTEGER,
     cached_input_tokens INTEGER,
     output_tokens INTEGER,
     input_cost REAL,
     cached_input_cost REAL,
     output_cost REAL,
     total_cost REAL,
     error TEXT,
     aborted INTEGER NOT NULL DEFAULT 0,
     tags TEXT NOT NULL DEFAULT '[]',
     starred INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_call_channel ON t_proxy_call_logs (channel_id)`,
  `CREATE INDEX IF NOT EXISTS idx_call_source ON t_proxy_call_logs (source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_call_created ON t_proxy_call_logs (created_at)`,
  `CREATE TABLE IF NOT EXISTS t_proxy_settings (
     id INTEGER PRIMARY KEY,
     log_io INTEGER NOT NULL DEFAULT 1,
     log_stream_body INTEGER NOT NULL DEFAULT 1,
     log_cap INTEGER NOT NULL DEFAULT 10000,
     proxy_url TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS t_proxy_daily_stats (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     stat_date TEXT NOT NULL,
     channel_id INTEGER,
     channel_name TEXT,
     source_id INTEGER,
     protocol TEXT NOT NULL,
     model TEXT,
     calls INTEGER NOT NULL DEFAULT 0,
     error_calls INTEGER NOT NULL DEFAULT 0,
     input_tokens INTEGER NOT NULL DEFAULT 0,
     cached_input_tokens INTEGER NOT NULL DEFAULT 0,
     output_tokens INTEGER NOT NULL DEFAULT 0,
     total_cost REAL NOT NULL DEFAULT 0
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_daily_stats
     ON t_proxy_daily_stats (stat_date, channel_id, source_id, protocol, model)`,
  `CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON t_proxy_daily_stats (stat_date)`,
];

/** 给历史表补列（从旧版本升级时调用；新建库无副作用） */
const ADD_COLUMN: Array<[table: string, col: string, def: string]> = [
  ['t_proxy_call_logs', 'input_tokens', 'INTEGER'],
  ['t_proxy_call_logs', 'cached_input_tokens', 'INTEGER'],
  ['t_proxy_call_logs', 'output_tokens', 'INTEGER'],
  ['t_proxy_call_logs', 'starred', 'INTEGER NOT NULL DEFAULT 0'],
  ['t_proxy_call_logs', 'input_cost', 'REAL'],
  ['t_proxy_call_logs', 'cached_input_cost', 'REAL'],
  ['t_proxy_call_logs', 'output_cost', 'REAL'],
  ['t_proxy_call_logs', 'total_cost', 'REAL'],
  ['t_proxy_channels', 'active_binding_id', 'INTEGER'],
  ['t_proxy_settings', 'log_cap', 'INTEGER NOT NULL DEFAULT 10000'],
  ['t_proxy_settings', 'proxy_url', 'TEXT'],
];

/**
 * 旧库回填：把 sources 的旧 provider/base_url 单协议配置回填为 t_proxy_source_endpoints。
 * 幂等：仅对「没有任何端点」的源插入一条 (source_id, provider, base_url)。
 */
function backfillSourceEndpoints(sqlite: BetterSqlite3Db) {
  const hasEndpoint = sqlite.prepare(
    `SELECT id FROM t_proxy_source_endpoints WHERE source_id = ? LIMIT 1`,
  );
  const insEndpoint = sqlite.prepare(
    `INSERT OR IGNORE INTO t_proxy_source_endpoints (source_id, protocol, base_url) VALUES (?, ?, ?)`,
  );
  const sources = sqlite.prepare(
    `SELECT id, provider, base_url FROM t_proxy_sources`,
  ).all() as Array<{ id: number; provider: string; base_url: string }>;
  for (const s of sources) {
    if (!hasEndpoint.get(s.id)) {
      insEndpoint.run(s.id, s.provider, s.base_url);
    }
  }
}

/**
 * 旧库回填：旧通道是「源 + 单模型」直绑（source_id + upstream_model）。
 * 迁移为新的「上游源模型 + 通道绑定」模型：
 *   1. 为每个 (source_id, upstream_model) upsert 一条 t_proxy_source_models（价格留空）；
 *   2. 插入 t_proxy_channel_sources 绑定；
 *   3. channels.active_binding_id 指向新绑定。
 */
// 老库 t_proxy_channels 曾含 name 列（现以 exposed_model 为唯一标识），幂等删除
function backfillLegacyChannels(sqlite: BetterSqlite3Db) {
  const channels = sqlite.prepare(
    `SELECT id, source_id, upstream_model FROM t_proxy_channels WHERE source_id IS NOT NULL AND upstream_model IS NOT NULL`,
  ).all() as Array<{ id: number; source_id: number; upstream_model: string }>;
  if (!channels.length) return;

  const insModel = sqlite.prepare(
    `INSERT OR IGNORE INTO t_proxy_source_models (source_id, model) VALUES (?, ?)`,
  );
  const findModel = sqlite.prepare(
    `SELECT id FROM t_proxy_source_models WHERE source_id = ? AND model = ?`,
  );
  const hasBinding = sqlite.prepare(
    `SELECT id FROM t_proxy_channel_sources WHERE channel_id = ? AND source_model_id = ?`,
  );
  const insBinding = sqlite.prepare(
    `INSERT INTO t_proxy_channel_sources (channel_id, source_model_id) VALUES (?, ?)`,
  );
  const updActive = sqlite.prepare(
    `UPDATE t_proxy_channels SET active_binding_id = ? WHERE id = ?`,
  );

  for (const ch of channels) {
    insModel.run(ch.source_id, ch.upstream_model);
    const sm = findModel.get(ch.source_id, ch.upstream_model) as { id: number } | undefined;
    if (!sm) continue;
    const existing = hasBinding.get(ch.id, sm.id) as { id: number } | undefined;
    if (existing) continue;
    const info = insBinding.run(ch.id, sm.id);
    const bindingId = Number(info.lastInsertRowid);
    updActive.run(bindingId, ch.id);
  }
}

/**
 * 历史数据迁移：旧的 base_url 存的是「去掉路径后缀的 Base URL」（路由再拼 upstreamSuffix）。
 * 现改为存「完整 API 地址」，故把每个端点的 base_url 补上对应协议的完整路径。
 * 幂等：若 base_url 已以完整路径结尾则跳过。
 */
function migrateEndpointsToFullUrl(sqlite: BetterSqlite3Db) {
  const SUFFIX: Record<string, string> = {
    openai_chat: '/chat/completions',
    openai_response: '/responses',
    anthropic: '/v1/messages',
  };
  const rows = sqlite.prepare(
    `SELECT id, protocol, base_url FROM t_proxy_source_endpoints`,
  ).all() as Array<{ id: number; protocol: string; base_url: string }>;
  if (!rows.length) return;

  const updEndpoint = sqlite.prepare(
    `UPDATE t_proxy_source_endpoints SET base_url = ? WHERE id = ?`,
  );
  for (const r of rows) {
    const suffix = SUFFIX[r.protocol];
    if (!suffix) continue;
    const base = r.base_url.replace(/\/+$/, '');
    if (!base || base.endsWith(suffix)) continue; // 已是完整地址
    updEndpoint.run(base + suffix, r.id);
  }

  // 同步 t_proxy_sources 的镜像列 base_url（取同协议端点的完整地址）
  sqlite.exec(
    `UPDATE t_proxy_sources SET base_url = COALESCE(
       (SELECT base_url FROM t_proxy_source_endpoints
        WHERE source_id = t_proxy_sources.id AND protocol = t_proxy_sources.provider
        LIMIT 1),
       base_url
     )`,
  );
}

export function initSchema(sqlite: BetterSqlite3Db) {
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const stmt of DDL) sqlite.exec(stmt);

  // 兼容老库：补加新列（列已存在则忽略）
  for (const [table, col, def] of ADD_COLUMN) {
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === col)) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  }

  // 老源回填协议地址（多协议改造：旧 provider/base_url → 一条端点）
  backfillSourceEndpoints(sqlite);

  // 旧 base_url（Base URL）迁移为完整 API 地址
  migrateEndpointsToFullUrl(sqlite);

  // 老通道迁移为新绑定模型
  backfillLegacyChannels(sqlite);

  // 种子全局配置行
  sqlite.exec(`INSERT OR IGNORE INTO t_proxy_settings (id, log_io, log_stream_body, log_cap) VALUES (1, 1, 1, 10000)`);
}
