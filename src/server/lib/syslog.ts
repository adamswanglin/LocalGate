/**
 * 轻量系统日志：环形缓冲（内存）保存最近的错误 / 告警事件。
 *
 * 用于「系统日志」页查看近期问题（如上游模型调用失败、连接超时、写库失败等）。
 * 仅存最近 N 条，进程重启后清空（非持久化，定位现场问题足够）。
 * 同时把 error 级别打到 stdout，便于 Electron 日志文件捕获。
 */
export type SyslogLevel = 'error' | 'warn';

export interface SyslogEntry {
  id: number;
  ts: string; // 'YYYY-MM-DD HH:MM:SS'（本地时区）
  level: SyslogLevel;
  /** 来源标识：proxy / retention / log-writer / db … */
  source: string;
  message: string;
  /** 可选附加详情（如状态码、模型名、原始错误信息） */
  detail?: string;
}

const MAX = 500;
const buffer: SyslogEntry[] = [];
let counter = 0;

function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function toDetail(detail?: unknown): string | undefined {
  if (detail == null) return undefined;
  if (typeof detail === 'string') return detail || undefined;
  try {
    const s = JSON.stringify(detail);
    return s && s !== '{}' ? s : undefined;
  } catch {
    return String(detail);
  }
}

function push(level: SyslogLevel, source: string, message: string, detail?: unknown) {
  const entry: SyslogEntry = { id: ++counter, ts: nowLocal(), level, source, message, detail: toDetail(detail) };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
  if (level === 'error') console.error(`[${source}] ${message}`, detail ?? '');
  else console.warn(`[${source}] ${message}`, detail ?? '');
}

/** 记录一条错误级系统日志（如上游调用失败、连接超时）。 */
export function logSystemError(source: string, message: string, detail?: unknown): void {
  push('error', source, message, detail);
}

/** 记录一条告警级系统日志。 */
export function logSystemWarn(source: string, message: string, detail?: unknown): void {
  push('warn', source, message, detail);
}

/** 取最近 limit 条系统日志（倒序：最新在前）。 */
export function getSyslogs(limit = 200): SyslogEntry[] {
  const n = Math.min(limit, buffer.length);
  return buffer.slice(buffer.length - n).reverse();
}

/** 清空系统日志。 */
export function clearSyslogs(): void {
  buffer.length = 0;
}
