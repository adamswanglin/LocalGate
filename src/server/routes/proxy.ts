import { Hono } from 'hono';
import { Agent, ProxyAgent } from 'undici';
import { db, schema, sqlite } from '../db/index.js';
import { eq, and, inArray } from 'drizzle-orm';
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
  routingMode: string;
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
    routingMode: ch.routingMode ?? 'manual',
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

/* ---------------- 编排（orchestration）运行时状态与路由 ---------------- */

/** 连续失败阈值：达到即标记不可用 */
const ORCHESTRATION_FAILURE_THRESHOLD = 3;

export interface BindingRuntimeState {
  consecutiveFailures: number;
  /** epoch ms；> now 表示不可用冷却中 */
  unavailableUntil: number;
  lastFailureAt: number;
}

// 绑定运行时状态（内存，不落库；进程重启即清零）
const bindingRuntime = new Map<number, BindingRuntimeState>();

/** 读取某绑定的运行时健康状态（admin 编排面板用；未记录视为全零） */
export function getBindingRuntime(bindingId: number): BindingRuntimeState {
  const s = bindingRuntime.get(bindingId);
  return s ? { ...s } : { consecutiveFailures: 0, unavailableUntil: 0, lastFailureAt: 0 };
}

/** 清除运行时状态：指定绑定，或整个 Map（channel 删除时清理） */
export function resetBindingRuntime(bindingId?: number) {
  if (bindingId == null) bindingRuntime.clear();
  else bindingRuntime.delete(bindingId);
}

/**
 * 记录一次绑定失败：
 * - immediate（如 429 限流，上游明确表示「别再发了」）：无需累计到阈值，立即进入冷却；
 * - probe（恢复探测 / 强制兜底尝试）失败不延长仍在进行的冷却 —— 否则持续流量会把冷却无限刷新，永远无法恢复；
 * - 普通失败累计 consecutiveFailures，达到阈值后进入冷却。
 */
function recordBindingFailure(
  bindingId: number,
  retryAfterSeconds: number,
  opts: { immediate?: boolean; probe?: boolean } = {},
) {
  const s = bindingRuntime.get(bindingId) || { consecutiveFailures: 0, unavailableUntil: 0, lastFailureAt: 0 };
  const now = Date.now();
  s.consecutiveFailures += 1;
  s.lastFailureAt = now;
  if (opts.immediate || s.consecutiveFailures >= ORCHESTRATION_FAILURE_THRESHOLD) {
    // 探测失败只在不与现有冷却冲突时设置（冷却已过期 → 重新计一轮；进行中 → 保留原截止时间）
    if (!(opts.probe && s.unavailableUntil > now)) {
      s.unavailableUntil = now + Math.max(1, retryAfterSeconds) * 1000;
    }
  }
  bindingRuntime.set(bindingId, s);
}

function recordBindingSuccess(bindingId: number) {
  bindingRuntime.delete(bindingId);
}

/** 编排模式的候选绑定（按固定优先级顺序排列并过滤不可用） */
interface BindingCandidate {
  bindingId: number;
  retryAfterSeconds: number;
  /** 是否为不可用绑定的恢复探测 */
  probe: boolean;
  sourceModel: any;
  source: any;
}

/**
 * 构建编排候选序列：
 * 1. 取加入编排的绑定，按 orch_position 升序（固定顺序，不轮询 -- 避免破坏上游 KV cache）；
 * 2. 过滤不可用绑定，应用恢复探测规则：冷却到期 且 当前流量已降级到该绑定或更靠后的位置；
 * 3. 全部不可用且冷却未到时，忽略冷却按原顺序强制纳入一轮（best-effort，避免服务完全瘫痪）；
 *    探测失败不延长冷却，冷却最终总能到期。
 * 未配置任何编排绑定时回退为全部绑定（按 id 升序），保证编排模式不空转。
 */
async function buildOrchestrationCandidates(channel: ResolvedChannel): Promise<BindingCandidate[]> {
  const bindings = await db.select().from(schema.channelSources)
    .where(eq(schema.channelSources.channelId, channel.id));
  if (!bindings.length) return [];

  const ordered = bindings.filter((b) => b.orchestrated)
    .sort((a, b) => a.orchPosition - b.orchPosition || a.id - b.id);
  const effective = ordered.length ? ordered : [...bindings].sort((a, b) => a.id - b.id);

  const now = Date.now();
  // 运行时可用性：cooling = 冷却中（一律跳过）；expired = 曾不可用但冷却已到期（按探测规则放行）
  const rtOf = (b: typeof bindings[0]) => bindingRuntime.get(b.id) ?? null;
  const isCooling = (b: typeof bindings[0]) => {
    const rt = rtOf(b);
    return !!rt && rt.unavailableUntil > now;
  };
  const wasUnavailable = (b: typeof bindings[0]) => {
    const rt = rtOf(b);
    return !!rt && rt.consecutiveFailures >= ORCHESTRATION_FAILURE_THRESHOLD;
  };

  // firstEligibleIndex：第一个仍可用（非冷却）绑定的序号 = 当前流量实际降级到的位置
  let firstEligibleIndex = -1;
  for (let i = 0; i < effective.length; i++) {
    if (!isCooling(effective[i])) { firstEligibleIndex = i; break; }
  }

  const candidates: BindingCandidate[] = [];
  for (let i = 0; i < effective.length; i++) {
    const b = effective[i];
    if (isCooling(b)) continue; // 冷却中：跳过（全部不可用的兜底在下方处理）
    if (wasUnavailable(b)) {
      // 冷却到期的恢复探测：流量已降级到该位置或更靠后才纳入（firstEligibleIndex >= i）
      if (firstEligibleIndex !== -1 && firstEligibleIndex < i) continue;
      candidates.push({
        bindingId: b.id,
        retryAfterSeconds: b.retryAfterSeconds ?? 300, probe: true,
        sourceModel: null, source: null,
      });
    } else {
      candidates.push({
        bindingId: b.id,
        retryAfterSeconds: b.retryAfterSeconds ?? 300, probe: false,
        sourceModel: null, source: null,
      });
    }
  }

  // 兜底：所有绑定均不可用且冷却未到 -> 忽略冷却按原顺序强制试一轮。
  // 探测失败不延长冷却（见 recordBindingFailure），冷却最终总能到期。
  if (!candidates.length) {
    for (const b of effective) {
      candidates.push({
        bindingId: b.id,
        retryAfterSeconds: b.retryAfterSeconds ?? 300, probe: true,
        sourceModel: null, source: null,
      });
    }
  }

  // 富化 sourceModel / source（缺失保留 null，尝试时按失败处理并计数）
  const smIds = [...new Set(bindings.map((b) => b.sourceModelId))];
  const smRows = await db.select().from(schema.sourceModels).where(inArray(schema.sourceModels.id, smIds));
  const smById = new Map(smRows.map((m) => [m.id, m]));
  const srcIds = [...new Set(smRows.map((m) => m.sourceId))];
  const srcRows = srcIds.length ? await db.select().from(schema.sources).where(inArray(schema.sources.id, srcIds)) : [];
  const srcById = new Map(srcRows.map((s) => [s.id, s]));
  for (const cand of candidates) {
    const sm = smById.get(bindings.find((b) => b.id === cand.bindingId)!.sourceModelId);
    cand.sourceModel = sm ?? null;
    cand.source = sm ? srcById.get(sm.sourceId) ?? null : null;
  }
  return candidates;
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
  // 协议相关头原样透传：
  // - anthropic-beta：Skills（container 字段）/ code execution 等 beta 能力的开关，丢弃会导致上游 400
  // - openai-beta：OpenAI 侧同类 beta 开关
  // - accept：流式请求通常携带 text/event-stream
  for (const k of ['accept', 'anthropic-beta', 'openai-beta']) {
    const v = incoming.get(k);
    if (v) h.set(k, v);
  }
  if (meta.upstreamAuthHeader === 'authorization') {
    h.set('authorization', `Bearer ${apiKey}`);
  } else if (protocol === 'anthropic') {
    // Anthropic 兼容端点的认证头不统一：官方/GLM 接受 x-api-key，
    // 火山 Ark coding 端点只认 Authorization Bearer —— 两个都发，上游各取所需
    h.set('x-api-key', apiKey);
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

  // 路由模式：manual = 现有单绑定逻辑；orchestration = 按固定优先级顺序 + 故障转移
  const isOrch = channel.routingMode === 'orchestration';
  let candidates: BindingCandidate[];
  if (isOrch) {
    candidates = await buildOrchestrationCandidates(channel);
    if (!candidates.length) {
      return c.json({ error: 'entry has no usable upstream binding' }, 404);
    }
  } else {
    const resolved = await resolveActiveBinding(channel);
    if (!resolved) {
      return c.json({ error: 'entry has no usable upstream binding' }, 404);
    }
    candidates = [{
      bindingId: resolved.binding.id,
      retryAfterSeconds: 0, probe: false,
      sourceModel: resolved.sourceModel, source: resolved.source,
    }];
  }

  // 候选尝试序列（写入调用日志 attempts 列，便于排查「为什么轮到了某个模型」）
  const attempts: Array<{ bindingId: number; source: string | null; model: string | null; status: number | null; error: string | null }> = [];
  // 最后一次上游错误响应（全部候选失败时优先透传给客户端）
  let lastErrorRes: { status: number; text: string; headers: Headers } | null = null;
  const isStream = reqObj.stream === true;

  for (let idx = 0; idx < candidates.length; idx++) {
    const cand = candidates[idx];
    const { source, sourceModel } = cand;
    const startedAt = Date.now();

    const attemptBase = {
      bindingId: cand.bindingId,
      source: source?.name ?? null,
      model: sourceModel?.model ?? null,
    };

    // 解析上游配置：源模型 / 源 / 协议端点（缺失按失败计并转下一候选）
    let endpoint: any = null;
    if (sourceModel && source && source.enabled) {
      [endpoint] = await db.select().from(schema.sourceEndpoints)
        .where(and(eq(schema.sourceEndpoints.sourceId, source.id), eq(schema.sourceEndpoints.protocol, protocol)));
    }
    if (!sourceModel || !source || !source.enabled || !endpoint) {
      const msg = !source || !source.enabled
        ? 'upstream source unavailable'
        : !sourceModel ? 'upstream source model missing' : `upstream source has no ${protocol} endpoint`;
      if (isOrch) recordBindingFailure(cand.bindingId, cand.retryAfterSeconds, { probe: cand.probe });
      attempts.push({ ...attemptBase, status: null, error: msg });
      logSystemWarn('proxy', `上游配置不可用 [${exposedModel}]`, {
        protocol, error: msg, source: source?.name ?? null,
      });
      continue;
    }

    const pricing: Pricing = {
      inputPrice: sourceModel.inputPrice ?? null,
      cachedInputPrice: sourceModel.cachedInputPrice ?? null,
      outputPrice: sourceModel.outputPrice ?? null,
    };

    // 完整 JSON 透传：不做预设字段筛选。仅在需要改写 model 时才重新序列化
    // （展开保留全部字段，含 container 等扩展字段）；上游模型名与对外名一致时
    // 直接转发原始请求体字节（连格式都零改动）。
    const upstreamModel = sourceModel.model;
    const outReqBody = upstreamModel === exposedModel ? reqBody : JSON.stringify({ ...reqObj, model: upstreamModel });

    const upstreamUrl = buildUpstreamUrl(endpoint.baseUrl, protocol);
    const upstreamHeaders = buildUpstreamHeaders(protocol, source.apiKey, c.req.raw.headers);

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
      if (isOrch) recordBindingFailure(cand.bindingId, cand.retryAfterSeconds, { probe: cand.probe });
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
      attempts.push({ ...attemptBase, status: 502, error: msg });
      lastErrorRes = null; // 网络错误无上游响应体，最终以 502 JSON 返回
      continue;
    }

    const latency = Date.now() - startedAt;
    const status = upstreamRes.status;

    // 错误响应（>=400）：计失败并转下一候选；手动模式保持原行为直接透传。
    // 400/422 是「请求自身不合法」（如此请求携带的 thinking 块该上游不支持），换绑定时同样会失败，
    // 不计入绑定健康 —— 避免健康的上游被这类请求抹黑进冷却；429 是上游明确限流，立即冷却。
    if (status >= 400) {
      const text = await upstreamRes.text();
      if (isOrch && status !== 400 && status !== 422) {
        recordBindingFailure(cand.bindingId, cand.retryAfterSeconds, { immediate: status === 429, probe: cand.probe });
      }
      recordStats({ channel, source, protocol, model: upstreamModel, isError: true, usage: ZERO_USAGE, costs: null });
      logSystemWarnProxy(protocol, exposedModel, status, upstreamUrl, source.name, upstreamModel, text);
      attempts.push({ ...attemptBase, status, error: text.slice(0, 500) || `HTTP ${status}` });
      if (!isOrch) {
        if (settings.logIo) {
          insertLog(channel, source, protocol, upstreamModel, isStream, status, latency, reqBody, text, null, text, false, null, pricing);
        }
        return new Response(text, { status, headers: forwardHeaders(upstreamRes.headers) });
      }
      lastErrorRes = { status, text, headers: forwardHeaders(upstreamRes.headers) };
      continue;
    }

    // ── 成功：清除失败状态 ──
    if (isOrch) recordBindingSuccess(cand.bindingId);
    attempts.push({ ...attemptBase, status, error: null });

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
        insertLog(channel, source, protocol, upstreamModel, isStream, status, latency, reqBody, text, null, null, false, usage, pricing, attempts);
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
      attempts,
      // 流中断计入失败（编排模式）：首字节已透传后无法再切换上游，仅记数
      orchestration: isOrch
        ? { bindingId: cand.bindingId, retryAfterSeconds: cand.retryAfterSeconds, probe: cand.probe }
        : null,
    }).catch(() => { /* swallow */ });

    const headers = new Headers();
    headers.set('content-type', 'text/event-stream');
    headers.set('cache-control', 'no-cache');
    headers.set('connection', 'keep-alive');
    return new Response(forClient, { status, headers });
  }

  // ── 所有候选耗尽（仅编排模式会走到这里）：透传最后一次上游错误，否则 502 ──
  const lastAttempt = attempts[attempts.length - 1];
  if (lastErrorRes) {
    if (settings.logIo) {
      // 最后一次失败也落日志（用最后候选的上下文）
      const cand = candidates[candidates.length - 1];
      if (cand?.source && cand?.sourceModel) {
        insertLog(channel, cand.source, protocol, cand.sourceModel.model, isStream, lastErrorRes.status, 0, reqBody, lastErrorRes.text, null, lastErrorRes.text, false, null, NULL_PRICING, attempts);
      }
    }
    return new Response(lastErrorRes.text, { status: lastErrorRes.status, headers: lastErrorRes.headers });
  }
  return c.json({
    error: 'all upstream candidates failed',
    detail: lastAttempt?.error ?? 'no candidate',
    attempts,
  }, 502);
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
    attempts?: any[];
    /** 编排模式：流中断计入该绑定失败 */
    orchestration: { bindingId: number; retryAfterSeconds: number; probe: boolean } | null;
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

  // 流中断：编排模式下计入失败（首字节已透传，无法故障转移，仅记连续失败次数）
  if (aborted && ctx.orchestration) {
    recordBindingFailure(ctx.orchestration.bindingId, ctx.orchestration.retryAfterSeconds, {
      probe: ctx.orchestration.probe,
    });
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
      ctx.attempts,
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
  attempts?: any[],
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
    attempts: attempts && attempts.length ? attempts : undefined,
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
