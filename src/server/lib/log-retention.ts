import { sqlite } from '../db/index.js';

/** 日志总量上限默认值（非收藏记录达到该量级后触发清理）。 */
export const DEFAULT_LOG_CAP = 10000;
/** 配置项允许的上下限。 */
export const MIN_LOG_CAP = 100;
export const MAX_LOG_CAP = 1000000;
/** 检查间隔：不必每次请求清理，定期跑即可。 */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

const capStmt = sqlite.prepare(`SELECT log_cap AS cap FROM t_proxy_settings WHERE id = 1`);
const countStmt = sqlite.prepare(`SELECT count(*) AS n FROM t_proxy_call_logs`);
const starredCountStmt = sqlite.prepare(`SELECT count(*) AS n FROM t_proxy_call_logs WHERE starred = 1`);
// 删除最早的 N 条非收藏日志（starred=0 的记录按 id 升序最旧优先）
const trimStmt = sqlite.prepare(
  `DELETE FROM t_proxy_call_logs
   WHERE id IN (
     SELECT id FROM t_proxy_call_logs
     WHERE starred = 0
     ORDER BY id ASC
     LIMIT ?
   )`,
);

/** 读取已配置的日志上限；缺失或非法时回退默认值。 */
export function getLogCap(): number {
  const row = capStmt.get() as { cap?: number } | undefined;
  const cap = Number(row?.cap);
  if (!Number.isFinite(cap) || cap < MIN_LOG_CAP) return DEFAULT_LOG_CAP;
  return Math.min(cap, MAX_LOG_CAP);
}

/**
 * 清理一次：仅当总量超过 cap 时执行。
 * 收藏记录（starred=1）不计入 cap 配额、也不会被删除；
 * 只删最旧的非收藏日志，直到总量 ≤ cap。
 * cap 省略时读取数据库中当前配置的上限。
 */
export function trimLogsOnce(cap?: number): number {
  if (cap == null) cap = getLogCap();
  const total = (countStmt.get() as { n: number }).n;
  if (total <= cap) return 0;
  const starred = (starredCountStmt.get() as { n: number }).n;
  // 非收藏日志可保留的配额 = cap - starred；超出部分需删除
  const nonStarredQuota = Math.max(0, cap - starred);
  const nonStarredCount = total - starred;
  const toDelete = nonStarredCount - nonStarredQuota;
  if (toDelete <= 0) return 0;
  trimStmt.run(toDelete);
  return toDelete;
}

/** 启动定期清理。返回停止函数（测试用）。每次 tick 都读取最新的配置上限。 */
export function startLogRetention(intervalMs = DEFAULT_INTERVAL_MS): () => void {
  // 启动后立即跑一次，再按间隔执行
  try { trimLogsOnce(); } catch (e) { console.error('[retention] trim failed', e); }
  const timer = setInterval(() => {
    try { trimLogsOnce(); } catch (e) { console.error('[retention] trim failed', e); }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
