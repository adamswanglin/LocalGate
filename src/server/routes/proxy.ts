import { Hono } from 'hono';
import { Agent, ProxyAgent } from 'undici';
import { db, schema, sqlite } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { Protocol, PROTOCOLS } from '../lib/protocol.js';
import { normalizeUsage, type NormalizedUsage } from '../lib/usage.js';
import { enqueueWrite } from '../lib/log-writer.js';
import { logSystemError, logSystemWarn } from '../lib/syslog.js';

const proxy = new Hono();

/** 上游连接超时（TCP 连接建立阶段）：5s。 */
const CONNECT_TIMEOUT_MS = 5000;

interface ResolvedChannel {
  id: number;
  name: string;
  sourceId: number;
  protocol: string;
  exposedModel: string;
  upstreamModel: string;
  activeBindingId: number | null;
}

interface GlobalSettings {
  logIo: boolean;
  logStreamBody: boolean;
  logCap: number;
  proxyUrl: string;
}

/** 上游模型价格（元/百万 token）；未配置为 null */
interface Pricing {
  inputPrice: number | null;
  cachedInputPrice: number | null;
  outputPrice: number | null;
}

const NULL_PRICING: Pricing = { inputPrice: null, cachedInputPrice: null, outputPrice: null };

const ZERO_USAGE: NormalizedUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };

/* ---------------- 上游 fetch 分发器（连接超时 + 出站代理） ---------------- */

// 根据 settings.proxyUrl 构造 undici 分发器；proxyUrl 变化时重建。
let currentDispatcher: Agent | ProxyAgent | null = null;
let currentProxyUrl = '\0'; // 哨兵：保证首次构造
export function getDispatcher(proxyUrl?: string): Agent | ProxyAgent {
  const p = proxyUrl && proxyUrl.trim() ? proxyUrl.trim() : '';
  if (currentDispatcher && p === currentProxyUrl) return currentDispatcher;
  currentProxyUrl = p;
  currentDispatcher = p
    ? new ProxyAgent({ uri: p, connect: { timeout: CONNECT_TIMEOUT_MS } })
    : new Agent({ connect: { timeout: CONNECT_TIMEOUT_MS } });
  return currentDispatcher;
}

/* ---------------- settings 缓存 ---------------- */

// settings 内存缓存：避免每次代理请求都读一次 DB；admin 端 PATCH 后调用 invalidateSettingsCache()
let settingsCache: GlobalSettings | null = null;
export function invalidateSettingsCache() {
  settingsCache = null;
}
async function loadSettings(): Promise<GlobalSettings> {
  if (settingsCache) return settingsCache;
  const [s] = await db.select().from(schema.settings).where(eq(schema.settings.id, 1));
  settingsCache = {
    logIo: s ? !!s.logIo : true,
    logStreamBody: s ? !!s.logStreamBody : true,
    logCap: s ? s.logCap : 10000,
    proxyUrl: s?.proxyUrl ?? '',
  };
  return settingsCache!;
}

/* ---------------- 访问令牌鉴权 ---------------- */

// 启用 token 缓存：为空 → 放行（未配置 token，空 key 可访问）；admin 端增删改后 invalidateTokensCache()
let tokensCache: Array<{ id: number; token: string }> | null = null;
export function invalidateTokensCache() {
  tokensCache = null;
}
async function loadEnabledTokens(): Promise<Array<{ id: number; token: string }>> {
  if (tokensCache) return tokensCache;
  const rows = await db
    .select({ id: schema.tokens.id, token: schema.tokens.token })
    .from(schema.tokens)
    .where(eq(schema.tokens.enabled, 1));
  tokensCache = rows;
  return tokensCache;
}

// last_used_at 写节流：每个 token 每分钟最多落库一次，避免高频请求刷写
const lastUsedWrites = new Map<number, number>();

function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function checkAuth(headers: Headers): Promise<{ ok: true } | { ok: false; status: number; body: any }> {
  const enabledTokens = await loadEnabledTokens();
  if (!enabledTokens.length) return { ok: true }; // 未配置 token：空 key 放行

  const auth = headers.get('authorization') || '';
  const xkey = headers.get('x-api-key') || '';
  let presented = '';
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (m) presented = m[1].trim();
  if (!presented) presented = xkey.trim();
  if (!presented) return { ok: false, status: 401, body: { error: 'missing token' } };

  const hit = enabledTokens.find((t) => t.token === presented);
  if (!hit) return { ok: false, status: 401, body: { error: 'invalid token' } };

  const now = Date.now();
  const last = lastUsedWrites.get(hit.id) || 0;
  if (now - last >= 60_000) {
    lastUsedWrites.set(hit.id, now);
    const ts = nowLocal();
    enqueueWrite(() => {
      try {
        db.update(schema.tokens).set({ lastUsedAt: ts }).where(eq(schema.tokens.id, hit.id)).run();
      } catch (e) {
        console.error('[last_used update failed]', e);
      }
    });
  }
  return { ok: true };
}

/* ---------------- 入口 / 绑定 / 上游解析 ---------------- */

async function findChannel(exposedModel: string, protocol: Protocol): Promise<ResolvedChannel | null> {
  const rows = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.exposedModel, exposedModel), eq(schema.channels.protocol, protocol), eq(schema.channels.enabled, 1)));
  const ch = rows[0];
  if (!ch) return null;
  return {
    id: ch.id,
    name: ch.name ?? '',
    sourceId: ch.sourceId,
    protocol: ch.protocol,
    exposedModel: ch.exposedModel ?? '',
    upstreamModel: ch.upstreamModel ?? '',
    activeBindingId: ch.activeBindingId,
  };
}

/**
 * 解析入口当前生效的绑定：
 * entry → 绑定（active_binding_id 优先，缺失/无效回退第一个）→ 上游源模型（含价格）→ 上游源。
 * 返回 null 表示入口没有任何可用绑定。
 */
async function resolveActiveBinding(channel: ResolvedChannel) {
  const bindings = await db.select().from(schema.channelSources).where(eq(schema.channelSources.channelId, channel.id));
  if (!bindings.length) return null;
  const binding = bindings.find((b) => b.id === channel.activeBindingId) || bindings[0];
  const [sourceModel] = await db.select().from(schema.sourceModels).where(eq(schema.sourceModels.id, binding.sourceModelId));
  if (!sourceModel) return null;
  const [source] = await db.select().from(schema.sources).where(eq(schema.sources.id, sourceModel.sourceId));
  if (!source) return null;
  return { binding, sourceModel, source };
}

/** 解析请求体；非法 JSON 返回 null */
function parseBody(text: string): Record<string, any> | null {
  try {
    const obj = JSON.parse(text);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

function buildUpstreamUrl(baseUrl: string, _protocol: Protocol): string {
  // source 存的是完整 API 地址，仅去掉尾部斜杠直接使用
  return baseUrl.replace(/\/+$/, '');
}

function buildUpstreamHeaders(protocol: Protocol, apiKey: string, incoming: Headers): Headers {
  const h = new Headers();
  const meta = PROTOCOLS[protocol];
  h.set('content-type', incoming.get('content-type') || 'application/json');
  if (meta.upstreamAuthHeader === 'authorization') {
    h.set('authorization', `Bearer ${apiKey}`);
  } else {
    h.set('x-api-key', apiKey);
  }
  if (protocol === 'anthropic') {
    h.set('anthropic-version', incoming.get('anthropic-version') || '2023-06-01');
  }
  return h;
}

/** 尝试从 SSE 文本里解析 usage 与 chunk 数组 */
function parseSse(raw: string): { chunks: any[]; usage: any | null } {
  const chunks: any[] = [];
  let usage: any | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const obj = JSON.parse(data);
      chunks.push(obj);
      if (obj.usage) usage = obj.usage;
      if (obj.message?.usage) usage = obj.message.usage;
      if (obj.response?.usage) usage = obj.response.usage;
    } catch {
      /* ignore non-json */
    }
  }
  return { chunks, usage };
}

/** 按上游模型价格（元/百万 token）计算费用 */
function computeCost(norm: NormalizedUsage, prices: Pricing) {
  const costOf = (tokens: number, price: number | null) =>
    price != null && price > 0 ? (tokens / 1_000_000) * price : 0;
  const inputCost = costOf(norm.inputTokens, prices.inputPrice);
  const cachedInputCost = costOf(norm.cachedInputTokens, prices.cachedInputPrice);
  const outputCost = costOf(norm.outputTokens, prices.outputPrice);
  return {
    inputCost,
    cachedInputCost,
    outputCost,
    totalCost: inputCost + cachedInputCost + outputCost,
  };
}

async function handleProxy(c: any, protocol: Protocol) {
  // 令牌鉴权（仅代理路由；未配置 token 时空 key 放行）
  const auth = await checkAuth(c.req.raw.headers);
  if (!auth.ok) {
    return c.json(auth.body, auth.status);
  }

  const reqBody = await c.req.raw.text();
  const reqObj = parseBody(reqBody);
  if (!reqObj) {
    return c.json({ error: 'invalid json body' }, 400);
  }

  const settings = await loadSettings();

  // 路由标识：对外模型名 + 协议（来自请求路径）
  const exposedModel = typeof reqObj.model === 'string' ? reqObj.model : '';
  if (!exposedModel) {
    return c.json({ error: 'missing model' }, 400);
  }

  const channel = await findChannel(exposedModel, protocol);
  if (!channel) {
    return c.json({ error: `no entry for model "${exposedModel}" (${protocol})` }, 404);
  }

  // 当前生效绑定 → 上游源模型 → 上游源
  const resolved = await resolveActiveBinding(channel);
  if (!resolved) {
    return c.json({ error: 'entry has no usable upstream binding' }, 404);
  }
  const { sourceModel, source } = resolved;
  if (!source.enabled) {
    return c.json({ error: 'upstream source unavailable' }, 502);
  }
  // 该源需配置了当前协议的地址（一个源可多协议，各自 base_url）
  const [endpoint] = await db.select().from(schema.sourceEndpoints)
    .where(and(eq(schema.sourceEndpoints.sourceId, source.id), eq(schema.sourceEndpoints.protocol, protocol)));
  if (!endpoint) {
    return c.json({ error: `upstream source "${source.name}" has no ${protocol} endpoint` }, 502);
  }

  const pricing: Pricing = {
    inputPrice: sourceModel.inputPrice ?? null,
    cachedInputPrice: sourceModel.cachedInputPrice ?? null,
    outputPrice: sourceModel.outputPrice ?? null,
  };

  // 改写 model：对外模型名 → 上游真实模型名（来自上游源配置）
  // upstreamModel 用于日志/统计记录（入口已由 channel 标识，model 列记真实上游模型）
  const upstreamModel = sourceModel.model;
  reqObj.model = upstreamModel;
  const outReqBody = JSON.stringify(reqObj);

  const upstreamUrl = buildUpstreamUrl(endpoint.baseUrl, protocol);
  const upstreamHeaders = buildUpstreamHeaders(protocol, source.apiKey, c.req.raw.headers);

  const isStream = reqObj.stream === true;
  const startedAt = Date.now();

  let upstreamRes: Response;
  try {
    // dispatcher 提供：连接超时 5s、可选出站代理
    upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: upstreamHeaders,
      body: outReqBody,
      // @ts-expect-error Node 的 fetch（undici）支持 dispatcher 选项
      dispatcher: getDispatcher(settings.proxyUrl),
    });
  } catch (err: any) {
    const latency = Date.now() - startedAt;
    const msg = err?.name === 'HeadersTimeoutError' || /timeout/i.test(err?.name || '')
      ? `upstream connect timeout (${CONNECT_TIMEOUT_MS}ms)`
      : err.message;
    // 统计始终记录（连接失败计 1 次调用 + 1 次错误）
    recordStats({ channel, source, protocol, model: upstreamModel, isError: true, usage: ZERO_USAGE, costs: null });
    logSystemError('proxy', `上游调用失败 [${exposedModel}]`, {
      protocol,
      source: source.name,
      upstreamModel,
      url: upstreamUrl,
      host: safeHost(upstreamUrl),
      error: msg,
      latency,
    });
    if (settings.logIo) {
      insertLog(channel, source, protocol, upstreamModel, isStream, 502, latency, reqBody, null, null, msg, false, null, pricing);
    }
    return c.json({ error: 'upstream fetch failed', detail: msg }, 502);
  }

  const latency = Date.now() - startedAt;
  const status = upstreamRes.status;

  // 错误响应（>=400）：直接透传上游错误（状态码、body、关键 header 原样返回）
  if (status >= 400) {
    const text = await upstreamRes.text();
    recordStats({ channel, source, protocol, model: upstreamModel, isError: true, usage: ZERO_USAGE, costs: null });
    logSystemWarnProxy(protocol, exposedModel, status, upstreamUrl, source.name, upstreamModel, text);
    if (settings.logIo) {
      insertLog(channel, source, protocol, upstreamModel, isStream, status, latency, reqBody, text, null, text, false, null, pricing);
    }
    return new Response(text, { status, headers: forwardHeaders(upstreamRes.headers) });
  }

  // ── 非流式：缓冲完整响应 ──
  if (!isStream || !upstreamRes.body) {
    const text = await upstreamRes.text();
    let usage: any = null;
    try { usage = JSON.parse(text).usage ?? null; } catch { /* ignore */ }
    const norm = normalizeUsage(usage, protocol);
    const costs = computeCost(norm, pricing);

    // 统计始终记录（成功调用）
    recordStats({ channel, source, protocol, model: upstreamModel, isError: false, usage: norm, costs });

    if (settings.logIo) {
      insertLog(channel, source, protocol, upstreamModel, isStream, status, latency, reqBody, text, null, null, false, usage, pricing);
    }

    const headers = new Headers();
    headers.set('content-type', 'application/json');
    return new Response(text, { status, headers });
  }

  // ── 流式：纯透传 ──
  // 始终 tee 一份用于解析 usage、落统计（关闭日志也不影响统计）；
  // 仅在 logIo 开启时才写调用日志。
  const wantBody = settings.logStreamBody;
  const logIo = settings.logIo;
  const [forClient, forLog] = upstreamRes.body.tee();

  collectStream(forLog, {
    channel, source, protocol, model: upstreamModel, status, latency, reqBody, wantBody, logIo, pricing,
  }).catch(() => { /* swallow */ });

  const headers = new Headers();
  headers.set('content-type', 'text/event-stream');
  headers.set('cache-control', 'no-cache');
  headers.set('connection', 'keep-alive');
  return new Response(forClient, { status, headers });
}

/** 从 URL 中提取 host（失败回退原串），用于日志里标识「调了哪个域名」。 */
function safeHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** 截断超长字符串，避免单条日志把环形缓冲撑爆。 */
function truncate(s: string | null | undefined, max = 1000): string | undefined {
  if (!s) return undefined;
  const t = s.length > max ? s.slice(0, max) + `…(+${s.length - max})` : s;
  return t;
}

/** 4xx/5xx 仅告警级系统日志（避免刷屏错误级） */
function logSystemWarnProxy(
  protocol: Protocol,
  model: string,
  status: number,
  url: string,
  sourceName: string,
  upstreamModel: string,
  errorBody: string | null,
) {
  logSystemWarn('proxy', `上游返回 ${status} [${model}]`, {
    protocol,
    status,
    source: sourceName,
    upstreamModel,
    host: safeHost(url),
    url,
    error: truncate(errorBody),
  });
}

function forwardHeaders(h: Headers): Headers {
  const out = new Headers();
  for (const k of ['content-type', 'cache-control', 'connection', 'transfer-encoding', 'x-request-id', 'retry-after']) {
    const v = h.get(k);
    if (v) out.set(k, v);
  }
  return out;
}

async function collectStream(
  stream: ReadableStream<Uint8Array>,
  ctx: {
    channel: ResolvedChannel; source: any; protocol: Protocol; model: string;
    status: number; latency: number; reqBody: string; wantBody: boolean; logIo: boolean;
    pricing: Pricing;
  },
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  let aborted = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch {
    aborted = true;
  }

  const { chunks, usage } = parseSse(raw);
  const norm = normalizeUsage(usage, ctx.protocol);
  const costs = computeCost(norm, ctx.pricing);

  // 统计始终记录（关闭日志不影响）
  recordStats({
    channel: ctx.channel, source: ctx.source, protocol: ctx.protocol, model: ctx.model,
    isError: ctx.status >= 400, usage: norm, costs,
  });

  if (ctx.logIo) {
    insertLog(
      ctx.channel, ctx.source, ctx.protocol, ctx.model, true, ctx.status, ctx.latency,
      ctx.reqBody,
      ctx.wantBody ? raw : null,
      ctx.wantBody && chunks.length ? JSON.stringify(chunks) : null,
      ctx.status >= 400 ? raw : null,
      aborted,
      usage,
      ctx.pricing,
    );
  }
}

/** 统计 upsert 预编译语句（按日落表，独立于日志）。 */
const statsUpsertStmt = sqlite.prepare(
  `INSERT INTO t_proxy_daily_stats
     (stat_date, channel_id, channel_name, source_id, protocol, model,
      calls, error_calls, input_tokens, cached_input_tokens, output_tokens, total_cost)
   VALUES (date('now','localtime'), ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
   ON CONFLICT(stat_date, channel_id, source_id, protocol, model) DO UPDATE SET
     calls = calls + 1,
     error_calls = error_calls + excluded.error_calls,
     input_tokens = input_tokens + excluded.input_tokens,
     cached_input_tokens = cached_input_tokens + excluded.cached_input_tokens,
     output_tokens = output_tokens + excluded.output_tokens,
     total_cost = total_cost + excluded.total_cost,
     channel_name = excluded.channel_name`,
);

/**
 * 每次调用都按日落表累计统计（关闭日志也不影响统计）。
 * 异步落库，不阻塞响应。
 */
function recordStats(ctx: {
  channel: ResolvedChannel; source: any; protocol: Protocol; model: string;
  isError: boolean; usage: NormalizedUsage; costs: { totalCost: number } | null;
}) {
  const channelId = ctx.channel.id;
  const channelName = ctx.channel.name ?? '';
  const sourceId = ctx.source?.id ?? ctx.channel.sourceId;
  const errInc = ctx.isError ? 1 : 0;
  const totalCost = ctx.costs ? ctx.costs.totalCost : 0;
  enqueueWrite(() => {
    try {
      statsUpsertStmt.run(
        channelId, channelName, sourceId, ctx.protocol, ctx.model || null,
        errInc, ctx.usage.inputTokens, ctx.usage.cachedInputTokens, ctx.usage.outputTokens, totalCost,
      );
    } catch (e) {
      logSystemError('proxy', '每日统计落库失败', e instanceof Error ? e.message : e);
    }
  });
}

function insertLog(
  channel: ResolvedChannel,
  source: any,
  protocol: Protocol,
  model: string,
  isStream: boolean,
  status: number | null,
  latency: number,
  reqBody: string | null,
  resBody: string | null,
  resChunks: string | null,
  error: string | null,
  aborted: boolean,
  usage: any = null,
  pricing: Pricing = NULL_PRICING,
) {
  const norm = normalizeUsage(usage, protocol);
  const costs = computeCost(norm, pricing);
  const values = {
    channelId: channel.id,
    channelName: channel.name ?? '',
    sourceId: source?.id ?? channel.sourceId,
    protocol,
    model,
    isStream: isStream ? 1 : 0,
    statusCode: status,
    latencyMs: latency,
    requestBody: reqBody,
    responseBody: resBody,
    responseChunks: resChunks,
    usage: usage ?? undefined,
    inputTokens: norm.inputTokens || null,
    cachedInputTokens: norm.cachedInputTokens || null,
    outputTokens: norm.outputTokens || null,
    inputCost: costs.inputCost,
    cachedInputCost: costs.cachedInputCost,
    outputCost: costs.outputCost,
    totalCost: costs.totalCost,
    error,
    aborted: aborted ? 1 : 0,
  };
  // 异步落库：不阻塞响应返回
  enqueueWrite(() => {
    try {
      db.insert(schema.callLogs).values(values).run();
    } catch (e) {
      logSystemError('proxy', '调用日志写入失败', e instanceof Error ? e.message : e);
    }
  });
}

// 注册三条透传路由
for (const proto of Object.keys(PROTOCOLS) as Protocol[]) {
  const path = PROTOCOLS[proto].path;
  proxy.post(path, (c) => handleProxy(c, proto));
  // 也支持 GET 探活
  proxy.get(path, (c) => c.json({ ok: true, protocol: proto }));
}

export default proxy;
