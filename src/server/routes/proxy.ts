import { Hono } from 'hono';
import { db, schema } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { Protocol, PROTOCOLS } from '../lib/protocol.js';
import { normalizeUsage, type NormalizedUsage } from '../lib/usage.js';
import { enqueueWrite } from '../lib/log-writer.js';

const proxy = new Hono();

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
}

/** 上游模型价格（元/百万 token）；未配置为 null */
interface Pricing {
  inputPrice: number | null;
  cachedInputPrice: number | null;
  outputPrice: number | null;
}

const NULL_PRICING: Pricing = { inputPrice: null, cachedInputPrice: null, outputPrice: null };

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

function buildUpstreamUrl(baseUrl: string, protocol: Protocol): string {
  const base = baseUrl.replace(/\/+$/, '');
  return base + PROTOCOLS[protocol].upstreamSuffix;
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
  reqObj.model = sourceModel.model;
  const outReqBody = JSON.stringify(reqObj);

  const upstreamUrl = buildUpstreamUrl(endpoint.baseUrl, protocol);
  const upstreamHeaders = buildUpstreamHeaders(protocol, source.apiKey, c.req.raw.headers);

  const isStream = reqObj.stream === true;
  const startedAt = Date.now();

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: upstreamHeaders,
      body: outReqBody,
    });
  } catch (err: any) {
    const latency = Date.now() - startedAt;
    if (settings.logIo) {
      insertLog(channel, source, protocol, exposedModel, isStream, 502, latency, reqBody, null, null, err.message, false, null, pricing);
    }
    return c.json({ error: 'upstream fetch failed', detail: err.message }, 502);
  }

  const latency = Date.now() - startedAt;
  const status = upstreamRes.status;

  // 错误响应（>=400）：直接透传上游错误
  if (status >= 400) {
    const text = await upstreamRes.text();
    if (settings.logIo) {
      insertLog(channel, source, protocol, exposedModel, isStream, status, latency, reqBody, text, null, text, false, null, pricing);
    }
    return new Response(text, { status, headers: forwardHeaders(upstreamRes.headers) });
  }

  // ── 非流式：缓冲完整响应 ──
  if (!isStream || !upstreamRes.body) {
    const text = await upstreamRes.text();
    let usage: any = null;
    try { usage = JSON.parse(text).usage ?? null; } catch { /* ignore */ }

    if (settings.logIo) {
      insertLog(channel, source, protocol, exposedModel, isStream, status, latency, reqBody, text, null, null, false, usage, pricing);
    }

    const headers = new Headers();
    headers.set('content-type', 'application/json');
    return new Response(text, { status, headers });
  }

  // ── 流式：纯透传 ──
  const wantBody = settings.logStreamBody;
  const [forClient, forLog] = upstreamRes.body.tee();

  if (settings.logIo) {
    collectAndLog(forLog, {
      channel, source, protocol, model: exposedModel, isStream: true, status, latency, reqBody, wantBody, pricing,
    }).catch(() => { /* swallow */ });
  } else {
    forLog.cancel().catch(() => {});
  }

  const headers = new Headers();
  headers.set('content-type', 'text/event-stream');
  headers.set('cache-control', 'no-cache');
  headers.set('connection', 'keep-alive');
  return new Response(forClient, { status, headers });
}

function forwardHeaders(h: Headers): Headers {
  const out = new Headers();
  for (const k of ['content-type', 'cache-control', 'connection', 'transfer-encoding', 'x-request-id']) {
    const v = h.get(k);
    if (v) out.set(k, v);
  }
  return out;
}

async function collectAndLog(
  stream: ReadableStream<Uint8Array>,
  ctx: {
    channel: ResolvedChannel; source: any; protocol: Protocol; model: string;
    isStream: boolean; status: number; latency: number; reqBody: string; wantBody: boolean;
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
      console.error('[log insert failed]', e);
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
