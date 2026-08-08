/**
 * 一次性迁移：MySQL → SQLite
 *
 * 用法：
 *   DATABASE_URL='mysql://root@127.0.0.1:2881/test' pnpm db:migrate
 *
 * 行为：
 *   - 从旧 MySQL 读取 t_proxy_sources / t_proxy_channels / t_proxy_call_logs 全量
 *   - 写入 SQLite（DB_PATH，默认 .run/agent-proxy.db；建表由 src/server/db/migrate.ts 完成）
 *   - channels 丢弃 log_io / log_stream_body
 *   - call_logs 用 normalizeUsage 回填 input/cached/output 三列；usage/tags 原样保留
 *   - 按 id 主键迁移，幂等可重跑（INSERT OR REPLACE）
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { db, schema, sqlite } from '../src/server/db/index.js';
import { normalizeUsage } from '../src/server/lib/usage.js';
import type { Protocol } from '../src/server/lib/protocol.js';

const MYSQL_URL = process.env.DATABASE_URL || 'mysql://root@127.0.0.1:2881/test';

function b(v: any): number {
  return v ? 1 : 0;
}

async function main() {
  console.log(`[migrate] MySQL ← ${MYSQL_URL}`);
  const conn = await mysql.createConnection(MYSQL_URL);

  // ---- sources ----
  const [sources] = await conn.query('SELECT * FROM t_proxy_sources ORDER BY id');
  for (const r of sources as any[]) {
    db.insert(schema.sources)
      .values({
        id: r.id,
        name: r.name,
        provider: r.provider,
        baseUrl: r.base_url,
        apiKey: r.api_key,
        enabled: b(r.enabled),
        createdAt: toText(r.created_at),
      })
      .onConflictDoNothing()
      .run();
  }
  console.log(`[migrate] sources: ${(sources as any[]).length}`);

  // ---- channels ----
  const [channels] = await conn.query('SELECT * FROM t_proxy_channels ORDER BY id');
  for (const r of channels as any[]) {
    db.insert(schema.channels)
      .values({
        id: r.id,
        name: r.name,
        protocol: r.protocol,
        sourceId: r.source_id,
        exposedModel: r.exposed_model ?? null,
        upstreamModel: r.upstream_model ?? null,
        enabled: b(r.enabled),
        createdAt: toText(r.created_at),
      })
      .onConflictDoNothing()
      .run();
  }
  console.log(`[migrate] channels: ${(channels as any[]).length}`);

  // ---- call_logs ----
  const [logs] = await conn.query('SELECT * FROM t_proxy_call_logs ORDER BY id');
  let tokCount = 0;
  for (const r of logs as any[]) {
    const protocol = r.protocol as Protocol;
    let usage: any = null;
    if (r.usage) {
      try { usage = typeof r.usage === 'string' ? JSON.parse(r.usage) : r.usage; } catch { usage = null; }
    }
    const norm = normalizeUsage(usage, protocol);
    if (usage) tokCount++;

    let tags: string[] = [];
    if (r.tags) {
      try { tags = typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags; } catch { tags = []; }
    }

    db.insert(schema.callLogs)
      .values({
        id: r.id,
        channelId: r.channel_id ?? null,
        channelName: r.channel_name ?? null,
        sourceId: r.source_id ?? null,
        protocol: r.protocol,
        model: r.model ?? null,
        isStream: b(r.is_stream),
        statusCode: r.status_code ?? null,
        latencyMs: r.latency_ms ?? null,
        requestBody: r.request_body ?? null,
        responseBody: r.response_body ?? null,
        responseChunks: r.response_chunks ?? null,
        usage: usage ?? null,
        inputTokens: norm.inputTokens || null,
        cachedInputTokens: norm.cachedInputTokens || null,
        outputTokens: norm.outputTokens || null,
        error: r.error ?? null,
        aborted: b(r.aborted),
        tags,
        createdAt: toText(r.created_at),
      })
      .onConflictDoNothing()
      .run();
  }
  console.log(`[migrate] call_logs: ${(logs as any[]).length} (with usage: ${tokCount})`);

  // 修正自增起点，避免新插入与迁移的显式 id 冲突
  const fixSeq = (table: string) => {
    const max = sqlite.prepare(`SELECT coalesce(max(id),0) AS m FROM ${table}`).get() as { m: number };
    sqlite.exec(`UPDATE sqlite_sequence SET seq = ${max.m} WHERE name = '${table}'`);
  };
  fixSeq('t_proxy_sources');
  fixSeq('t_proxy_channels');
  fixSeq('t_proxy_call_logs');

  await conn.end();
  console.log('[migrate] done ✓');
}

// MySQL DATETIME/Date → SQLite TEXT 'YYYY-MM-DD HH:MM:SS'
function toText(v: any): string {
  if (!v) return new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  return String(v);
}

main().catch((e) => {
  console.error('[migrate] failed:', e);
  process.exit(1);
});
