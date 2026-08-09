import { Hono } from 'hono';
import { db, schema, sqlite } from '../db/index.js';
import { eq, desc, and, sql, or, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { networkInterfaces } from 'node:os';
import { Protocol, PROTOCOLS } from '../lib/protocol.js';
import { invalidateSettingsCache, invalidateTokensCache } from './proxy.js';

const admin = new Hono();

// 堆叠柱状图配色（多系列，与前端 web/src/components/chart.tsx 的 COLORS 保持一致）
const STACK_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#64748b'];

// SQLite 唯一约束冲突错误码（better-sqlite3，可能被 drizzle 包在 cause 里）
function isUniqueViolation(e: any): boolean {
  const code = e?.code ?? e?.cause?.code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT';
}

/** 取指定 source，校验其是否配置了该协议的地址；返回 [source, errorMsg?] */
async function resolveSource(sourceId: number, protocol: Protocol) {
  const [src] = await db.select().from(schema.sources).where(eq(schema.sources.id, sourceId));
  if (!src) return [null, 'upstream source not found'] as const;
  const [ep] = await db.select().from(schema.sourceEndpoints)
    .where(and(eq(schema.sourceEndpoints.sourceId, sourceId), eq(schema.sourceEndpoints.protocol, protocol)));
  if (!ep) return [src, `该上游未配置 ${protocol} 协议地址`] as const;
  return [src, null] as const;
}

/* ---------------- 上游模型 / 入口绑定 辅助 ---------------- */

function toNullableNum(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function maskToken(token: string): string {
  if (!token) return '';
  if (token.length <= 8) return '••••••••';
  return token.slice(0, 4) + '••••' + token.slice(-4);
}

/** 校验并规整前端传入的模型列表（模型名 + 三个价格） */
function normalizeModelsInput(models: any): { value?: any[]; error?: string } {
  if (!Array.isArray(models)) return { error: 'models 必须是数组' };
  const seen = new Set<string>();
  const value: any[] = [];
  for (const m of models) {
    const model = String(m?.model ?? '').trim();
    if (!model) return { error: '每个模型都必须有模型名' };
    if (seen.has(model)) return { error: `模型 "${model}" 重复` };
    seen.add(model);
    value.push({
      model,
      inputPrice: toNullableNum(m.inputPrice),
      cachedInputPrice: toNullableNum(m.cachedInputPrice),
      outputPrice: toNullableNum(m.outputPrice),
      enabled: (m.enabled ?? true) ? 1 : 0,
    });
  }
  return { value };
}

function insertSourceModels(sourceId: number, models: any[]) {
  if (!models.length) return;
  const stmt = sqlite.prepare(
    `INSERT INTO t_proxy_source_models (source_id, model, input_price, cached_input_price, output_price, enabled)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const tx = sqlite.transaction((list: any[]) => {
    for (const m of list) stmt.run(sourceId, m.model, m.inputPrice, m.cachedInputPrice, m.outputPrice, m.enabled ?? 1);
  });
  tx(models);
}

function replaceSourceModels(sourceId: number, models: any[]) {
  const tx = sqlite.transaction((list: any[]) => {
    sqlite.prepare(`DELETE FROM t_proxy_source_models WHERE source_id = ?`).run(sourceId);
    if (list.length) {
      const stmt = sqlite.prepare(
        `INSERT INTO t_proxy_source_models (source_id, model, input_price, cached_input_price, output_price, enabled)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const m of list) stmt.run(sourceId, m.model, m.inputPrice, m.cachedInputPrice, m.outputPrice, m.enabled ?? 1);
    }
  });
  tx(models);
}

/** 该上游的模型地被任一入口绑定引用的列表 */
function referencedModels(sourceId: number): { id: number; model: string }[] {
  return sqlite.prepare(
    `SELECT DISTINCT sm.id, sm.model FROM t_proxy_channel_sources cs
     JOIN t_proxy_source_models sm ON sm.id = cs.source_model_id
     WHERE sm.source_id = ?`,
  ).all(sourceId) as { id: number; model: string }[];
}

/** 该上游被任一入口绑定引用的数量 */
function sourceReferencedByChannels(sourceId: number): number {
  const row = sqlite.prepare(
    `SELECT COUNT(*) AS n FROM t_proxy_channel_sources cs
     JOIN t_proxy_source_models sm ON sm.id = cs.source_model_id
     WHERE sm.source_id = ?`,
  ).get(sourceId) as { n: number };
  return row?.n || 0;
}

/** 给 source 列表附加 models 数组 */
async function attachModels(sources: any[]): Promise<any[]> {
  if (!sources.length) return sources;
  const ids = sources.map((s) => s.id);
  const modelRows = await db.select().from(schema.sourceModels).where(inArray(schema.sourceModels.sourceId, ids));
  const bySource = new Map<number, any[]>();
  for (const m of modelRows) {
    const arr = bySource.get(m.sourceId) || [];
    arr.push(normalizeBool(m));
    bySource.set(m.sourceId, arr);
  }
  return sources.map((s) => ({ ...s, models: bySource.get(s.id) || [] }));
}

async function loadSourceWithModels(sourceId: number): Promise<any | null> {
  const [s] = await db.select().from(schema.sources).where(eq(schema.sources.id, sourceId));
  if (!s) return null;
  const [full] = await attachModels([normalizeBool(s)]);
  const [withEp] = await attachEndpoints([full]);
  return withEp;
}

/* ---------------- 协议地址 endpoints 辅助 ---------------- */

/** 校验并规整前端传入的协议地址列表（协议 + baseUrl） */
function normalizeEndpointsInput(endpoints: any): { value?: { protocol: Protocol; baseUrl: string }[]; error?: string } {
  if (!Array.isArray(endpoints) || !endpoints.length) return { error: '至少配置一个协议地址' };
  const seen = new Set<string>();
  const value: { protocol: Protocol; baseUrl: string }[] = [];
  for (const e of endpoints) {
    const protocol = String(e?.protocol ?? '').trim();
    const baseUrl = String(e?.baseUrl ?? '').trim();
    if (!PROTOCOLS[protocol as Protocol]) return { error: `无效的协议类型 "${protocol}"` };
    if (!baseUrl) return { error: `${protocol} 的 Base URL 不能为空` };
    if (seen.has(protocol)) return { error: `协议 "${protocol}" 的地址重复` };
    seen.add(protocol);
    value.push({ protocol: protocol as Protocol, baseUrl });
  }
  return { value };
}

function replaceSourceEndpoints(sourceId: number, list: { protocol: string; baseUrl: string }[]) {
  const tx = sqlite.transaction((items: { protocol: string; baseUrl: string }[]) => {
    sqlite.prepare(`DELETE FROM t_proxy_source_endpoints WHERE source_id = ?`).run(sourceId);
    const stmt = sqlite.prepare(`INSERT INTO t_proxy_source_endpoints (source_id, protocol, base_url) VALUES (?, ?, ?)`);
    for (const it of items) stmt.run(sourceId, it.protocol, it.baseUrl);
  });
  tx(list);
}

async function loadSourceEndpoints(sourceId: number) {
  return db.select().from(schema.sourceEndpoints).where(eq(schema.sourceEndpoints.sourceId, sourceId));
}

/** 给 source 列表附加 endpoints 数组 */
async function attachEndpoints(sources: any[]): Promise<any[]> {
  if (!sources.length) return sources;
  const ids = sources.map((s) => s.id);
  const rows = await db.select().from(schema.sourceEndpoints).where(inArray(schema.sourceEndpoints.sourceId, ids));
  const bySource = new Map<number, any[]>();
  for (const ep of rows) {
    const arr = bySource.get(ep.sourceId) || [];
    arr.push(ep);
    bySource.set(ep.sourceId, arr);
  }
  return sources.map((s) => ({ ...s, endpoints: bySource.get(s.id) || [] }));
}

/** 绑定该源模型的入口所用协议集合（删除协议地址前检查用） */
function sourceReferencedProtocols(sourceId: number): string[] {
  const rows = sqlite.prepare(
    `SELECT DISTINCT c.protocol AS protocol FROM t_proxy_channel_sources cs
     JOIN t_proxy_source_models sm ON sm.id = cs.source_model_id
     JOIN t_proxy_channels c ON c.id = cs.channel_id
     WHERE sm.source_id = ?`,
  ).all(sourceId) as { protocol: string }[];
  return rows.map((r) => r.protocol).filter(Boolean);
}

/** 校验并规整入口的绑定列表（每项 = 一个上游源模型 id） */
async function normalizeBindingsInput(
  bindings: any,
  protocol: Protocol,
): Promise<{ value?: { sourceModelId: number; sourceId: number; model: string }[]; error?: string }> {
  if (!Array.isArray(bindings) || !bindings.length) return { error: '入口至少需要一个绑定' };
  const value: { sourceModelId: number; sourceId: number; model: string }[] = [];
  const seen = new Set<number>();
  for (const b of bindings) {
    const smId = Number(b?.sourceModelId);
    if (!smId || seen.has(smId)) return { error: '绑定的上游模型无效或重复' };
    seen.add(smId);
    const [sm] = await db.select().from(schema.sourceModels).where(eq(schema.sourceModels.id, smId));
    if (!sm) return { error: `上游模型 #${smId} 不存在` };
    const [, srcErr] = await resolveSource(sm.sourceId, protocol);
    if (srcErr) return { error: `上游模型 "${sm.model}" 的 provider 与入口协议不一致` };
    value.push({ sourceModelId: smId, sourceId: sm.sourceId, model: sm.model });
  }
  return { value };
}

function insertChannelBindings(channelId: number, list: { sourceModelId: number }[]): number[] {
  const stmt = sqlite.prepare(`INSERT INTO t_proxy_channel_sources (channel_id, source_model_id) VALUES (?, ?)`);
  const tx = sqlite.transaction((items: { sourceModelId: number }[]) => {
    const ids: number[] = [];
    for (const it of items) {
      const info = stmt.run(channelId, it.sourceModelId);
      ids.push(Number(info.lastInsertRowid));
    }
    return ids;
  });
  return tx(list);
}

function replaceChannelBindings(channelId: number, list: { sourceModelId: number }[]): number[] {
  const del = sqlite.prepare(`DELETE FROM t_proxy_channel_sources WHERE channel_id = ?`);
  const stmt = sqlite.prepare(`INSERT INTO t_proxy_channel_sources (channel_id, source_model_id) VALUES (?, ?)`);
  const tx = sqlite.transaction((items: { sourceModelId: number }[]) => {
    del.run(channelId);
    const ids: number[] = [];
    for (const it of items) {
      const info = stmt.run(channelId, it.sourceModelId);
      ids.push(Number(info.lastInsertRowid));
    }
    return ids;
  });
  return tx(list);
}

/** 入口的绑定列表（富化：源名 + 模型 + 价格） */
async function loadChannelBindings(channelId: number): Promise<any[]> {
  const bindingRows = await db.select().from(schema.channelSources).where(eq(schema.channelSources.channelId, channelId));
  if (!bindingRows.length) return [];
  const smIds = bindingRows.map((b) => b.sourceModelId);
  const smRows = await db.select().from(schema.sourceModels).where(inArray(schema.sourceModels.id, smIds));
  const smById = new Map(smRows.map((m) => [m.id, m]));
  const srcIds = [...new Set(smRows.map((m) => m.sourceId))];
  const srcRows = srcIds.length ? await db.select().from(schema.sources).where(inArray(schema.sources.id, srcIds)) : [];
  const srcById = new Map(srcRows.map((s) => [s.id, s]));
  return bindingRows.map((b) => enrichBinding(b, smById.get(b.sourceModelId), srcById));
}

function enrichBinding(b: any, sm: any, srcById: Map<number, any>): any {
  const src = sm ? srcById.get(sm.sourceId) : null;
  return normalizeBool({
    id: b.id,
    channelId: b.channelId,
    sourceModelId: b.sourceModelId,
    sourceId: sm?.sourceId ?? null,
    sourceName: src?.name ?? (sm ? `#${sm.sourceId}` : '(unknown)'),
    model: sm?.model ?? '(unknown)',
    inputPrice: sm?.inputPrice ?? null,
    cachedInputPrice: sm?.cachedInputPrice ?? null,
    outputPrice: sm?.outputPrice ?? null,
  });
}

/** 给 entry 列表附加 bindings 数组 */
async function attachBindings(channels: any[]): Promise<any[]> {
  if (!channels.length) return channels;
  const ids = channels.map((c) => c.id);
  const bindingRows = await db.select().from(schema.channelSources).where(inArray(schema.channelSources.channelId, ids));
  if (!bindingRows.length) return channels.map((c) => ({ ...c, bindings: [] }));
  const smIds = [...new Set(bindingRows.map((b) => b.sourceModelId))];
  const smRows = await db.select().from(schema.sourceModels).where(inArray(schema.sourceModels.id, smIds));
  const smById = new Map(smRows.map((m) => [m.id, m]));
  const srcIds = [...new Set(smRows.map((m) => m.sourceId))];
  const srcRows = srcIds.length ? await db.select().from(schema.sources).where(inArray(schema.sources.id, srcIds)) : [];
  const srcById = new Map(srcRows.map((s) => [s.id, s]));
  const byChannel = new Map<number, any[]>();
  for (const b of bindingRows) {
    const item = enrichBinding(b, smById.get(b.sourceModelId), srcById);
    const arr = byChannel.get(b.channelId) || [];
    arr.push(item);
    byChannel.set(b.channelId, arr);
  }
  return channels.map((ch) => ({ ...ch, bindings: byChannel.get(ch.id) || [] }));
}

async function loadChannelWithBindings(channelId: number): Promise<any | null> {
  const [ch] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId));
  if (!ch) return null;
  const [full] = await attachBindings([normalizeBool(ch)]);
  return full;
}

/** 同步反规范化：entries.source_id / upstream_model = 当前生效绑定 */
async function denormalizeChannel(channelId: number) {
  const [ch] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId));
  if (!ch) return;
  const bindings = await loadChannelBindings(channelId);
  if (!bindings.length) return;
  const active = bindings.find((b) => b.id === ch.activeBindingId) || bindings[0];
  await db.update(schema.channels).set({
    sourceId: active.sourceId ?? 0,
    upstreamModel: active.model ?? null,
    activeBindingId: active.id,
  }).where(eq(schema.channels.id, channelId));
}

/* ---------------- 全局配置 settings ---------------- */

admin.get('/api/settings', async (c) => {
  const [s] = await db.select().from(schema.settings).where(eq(schema.settings.id, 1));
  return c.json({
    logIo: s ? !!s.logIo : true,
    logStreamBody: s ? !!s.logStreamBody : true,
  });
});

admin.patch('/api/settings', async (c) => {
  const body = await c.req.json();
  const update: any = {};
  if (typeof body.logIo === 'boolean') update.logIo = body.logIo ? 1 : 0;
  if (typeof body.logStreamBody === 'boolean') update.logStreamBody = body.logStreamBody ? 1 : 0;
  if (Object.keys(update).length) {
    await db.update(schema.settings).set(update).where(eq(schema.settings.id, 1));
    invalidateSettingsCache();
  }
  const [s] = await db.select().from(schema.settings).where(eq(schema.settings.id, 1));
  return c.json({
    logIo: s ? !!s.logIo : true,
    logStreamBody: s ? !!s.logStreamBody : true,
  });
});

/* ---------------- 元信息 meta ---------------- */

admin.get('/api/meta', (c) => {
  const localIPs: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) localIPs.push(i.address);
    }
  }
  return c.json({
    port: Number(process.env.PORT || 8787),
    localIPs: [...new Set(localIPs)],
  });
});

/* ---------------- 上游源 sources ---------------- */

admin.get('/api/sources', async (c) => {
  const rows = await db.select().from(schema.sources).orderBy(desc(schema.sources.createdAt));
  const withModels = await attachModels(rows.map(normalizeBool));
  return c.json(await attachEndpoints(withModels));
});

admin.post('/api/sources', async (c) => {
  const body = await c.req.json();
  const { name, apiKey, enabled } = body;
  if (!name || !apiKey) {
    return c.json({ error: 'missing fields (name, apiKey)' }, 400);
  }
  const endpoints = normalizeEndpointsInput(body.endpoints);
  if (endpoints.error) return c.json({ error: endpoints.error }, 400);
  const models = normalizeModelsInput(body.models);
  if (models.error) return c.json({ error: models.error }, 400);
  const eps = endpoints.value!;
  // provider / base_url 写首个端点做镜像（真实路由读 t_proxy_source_endpoints）
  const [row] = await db.insert(schema.sources).values({
    name,
    provider: eps[0].protocol,
    baseUrl: eps[0].baseUrl,
    apiKey,
    enabled: (enabled ?? true) ? 1 : 0,
  }).returning();
  replaceSourceEndpoints(row.id, eps);
  insertSourceModels(row.id, models.value!);
  const full = await loadSourceWithModels(row.id);
  return c.json(full);
});

admin.patch('/api/sources/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const update: any = {};
  for (const k of ['name', 'apiKey'] as const) {
    if (body[k] !== undefined) update[k] = body[k];
  }
  if (typeof body.enabled === 'boolean') update.enabled = body.enabled ? 1 : 0;
  if (Object.keys(update).length) {
    await db.update(schema.sources).set(update).where(eq(schema.sources.id, id));
  }
  // 可选整体替换协议地址；被对应协议通道绑定的协议不能删
  if (Array.isArray(body.endpoints)) {
    const endpoints = normalizeEndpointsInput(body.endpoints);
    if (endpoints.error) return c.json({ error: endpoints.error }, 400);
    const eps = endpoints.value!;
    const newProtocols = new Set(eps.map((e) => e.protocol));
    const blocked = sourceReferencedProtocols(id).filter((p) => !newProtocols.has(p as Protocol));
    if (blocked.length) {
      return c.json({ error: `协议 "${blocked.join('", "')}" 正被入口绑定使用，请先在入口中解绑` }, 400);
    }
    replaceSourceEndpoints(id, eps);
    // 同步旧列镜像（首个端点）
    await db.update(schema.sources).set({ provider: eps[0].protocol, baseUrl: eps[0].baseUrl }).where(eq(schema.sources.id, id));
  }
  // 可选整体替换模型；被通道绑定的模型不能删除
  if (Array.isArray(body.models)) {
    const models = normalizeModelsInput(body.models);
    if (models.error) return c.json({ error: models.error }, 400);
    const newNames = new Set(models.value!.map((m) => m.model));
    const blocked = referencedModels(id).filter((m) => !newNames.has(m.model));
    if (blocked.length) {
      return c.json({ error: `模型 "${blocked.map((m) => m.model).join('", "')}" 正被入口绑定，请先在入口中解绑` }, 400);
    }
    replaceSourceModels(id, models.value!);
  }
  const full = await loadSourceWithModels(id);
  return c.json(full);
});

admin.delete('/api/sources/:id', async (c) => {
  const id = Number(c.req.param('id'));
  // 检查是否被通道绑定引用（含非当前生效的绑定）
  if (sourceReferencedByChannels(id) > 0) {
    return c.json({ error: '该上游源的模型正被入口绑定使用，请先解绑' }, 400);
  }
  await sqlite.prepare('DELETE FROM t_proxy_source_endpoints WHERE source_id = ?').run(id);
  await sqlite.prepare('DELETE FROM t_proxy_source_models WHERE source_id = ?').run(id);
  await db.delete(schema.sources).where(eq(schema.sources.id, id));
  return c.json({ ok: true });
});

// 测试连通：发最小请求（需提供真实模型名；可指定 protocol 测单个端点，缺省测全部端点）
admin.post('/api/sources/:id/test', async (c) => {
  const id = Number(c.req.param('id'));
  const [src] = await db.select().from(schema.sources).where(eq(schema.sources.id, id));
  if (!src) return c.json({ error: 'not found' }, 404);
  const reqBody = await c.req.json().catch(() => ({}));
  const model = reqBody.model;
  if (!model) {
    return c.json({ ok: false, status: null, error: '请填写一个该上游支持的模型名后再测试（model 不能为空）' }, 200);
  }
  let endpoints = await loadSourceEndpoints(id);
  if (reqBody.protocol) endpoints = endpoints.filter((e) => e.protocol === reqBody.protocol);
  if (!endpoints.length) {
    return c.json({ ok: false, status: null, error: '该上游未配置可测试的协议地址' }, 200);
  }

  const testOne = async (ep: any) => {
    const meta = PROTOCOLS[ep.protocol as Protocol];
    const url = ep.baseUrl.replace(/\/+$/, '') + meta.upstreamSuffix;
    const headers = new Headers({ 'content-type': 'application/json' });
    if (meta.upstreamAuthHeader === 'authorization') headers.set('authorization', `Bearer ${src.apiKey}`);
    else headers.set('x-api-key', src.apiKey);
    if (ep.protocol === 'anthropic') headers.set('anthropic-version', '2023-06-01');
    // max_tokens=1 只为最小化消耗，验证连通与鉴权
    const body = JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] });
    try {
      const res = await fetch(url, { method: 'POST', headers, body });
      const text = await res.text();
      return { protocol: ep.protocol, ok: res.status < 500, status: res.status, sample: text.slice(0, 300) };
    } catch (e: any) {
      return { protocol: ep.protocol, ok: false, error: e.message };
    }
  };

  const results = await Promise.all(endpoints.map(testOne));
  if (results.length === 1) return c.json(results[0]);
  return c.json({ results });
});

/* ---------------- 模型入口 entries ---------------- */

admin.get('/api/channels', async (c) => {
  const rows = await db.select().from(schema.channels).orderBy(desc(schema.channels.createdAt));
  const withBindings = await attachBindings(rows.map(normalizeBool));
  return c.json(withBindings);
});

admin.post('/api/channels', async (c) => {
  const body = await c.req.json();
  const { name, protocol, exposedModel, enabled } = body;
  if (!name || !protocol || !exposedModel) {
    return c.json({ error: 'missing fields (name, protocol, exposedModel)' }, 400);
  }
  if (!PROTOCOLS[protocol as Protocol]) {
    return c.json({ error: 'invalid protocol' }, 400);
  }
  const bindings = await normalizeBindingsInput(body.bindings, protocol as Protocol);
  if (bindings.error) return c.json({ error: bindings.error }, 400);
  const list = bindings.value!;

  let row: any;
  try {
    [row] = await db.insert(schema.channels).values({
      name: String(name).trim(),
      protocol,
      sourceId: list[0].sourceId,
      exposedModel: String(exposedModel).trim(),
      upstreamModel: list[0].model,
      enabled: (enabled ?? true) ? 1 : 0,
    }).returning();
  } catch (e: any) {
    if (isUniqueViolation(e)) {
      return c.json({ error: `对外模型 "${exposedModel}" + ${protocol} 已存在` }, 400);
    }
    throw e;
  }
  const ids = insertChannelBindings(row.id, list);
  const activeIdx = Number.isInteger(body.activeIndex) ? Math.max(0, Number(body.activeIndex)) : 0;
  const activeBindingId = ids[activeIdx] ?? ids[0];
  await db.update(schema.channels).set({ activeBindingId }).where(eq(schema.channels.id, row.id));
  const full = await loadChannelWithBindings(row.id);
  return c.json(full);
});

admin.patch('/api/channels/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const current = (await db.select().from(schema.channels).where(eq(schema.channels.id, id)))[0];
  if (!current) return c.json({ error: 'not found' }, 404);

  const update: any = {};
  for (const k of ['name', 'protocol', 'exposedModel'] as const) {
    if (body[k] !== undefined) update[k] = body[k];
  }
  if (typeof body.enabled === 'boolean') update.enabled = body.enabled ? 1 : 0;
  if (body.activeBindingId !== undefined) update.activeBindingId = Number(body.activeBindingId);
  if (update.protocol !== undefined && !PROTOCOLS[update.protocol as Protocol]) {
    return c.json({ error: 'invalid protocol' }, 400);
  }
  if (update.exposedModel !== undefined) update.exposedModel = String(update.exposedModel).trim();
  const newProtocol = (update.protocol as Protocol) ?? current.protocol;

  // 整体替换绑定
  if (Array.isArray(body.bindings)) {
    const bindings = await normalizeBindingsInput(body.bindings, newProtocol);
    if (bindings.error) return c.json({ error: bindings.error }, 400);
    const list = bindings.value!;
    const ids = replaceChannelBindings(id, list);
    // 生效绑定：优先 activeIndex（0-based）→ 其次 activeBindingId（若仍在）→ 回退第一个
    let active: number;
    if (Number.isInteger(body.activeIndex)) {
      active = ids[Number(body.activeIndex)] ?? ids[0];
    } else if (update.activeBindingId != null && ids.includes(update.activeBindingId)) {
      active = update.activeBindingId;
    } else {
      active = ids[0];
    }
    update.activeBindingId = active;
  } else if (update.activeBindingId != null) {
    // 校验生效绑定属于该入口
    const exists = await db.select({ id: schema.channelSources.id }).from(schema.channelSources)
      .where(and(eq(schema.channelSources.id, update.activeBindingId), eq(schema.channelSources.channelId, id)));
    if (!exists.length) return c.json({ error: 'active binding not in channel' }, 400);
  }

  // 只改协议时，需校验既有绑定仍与新协议匹配
  if (update.protocol && !Array.isArray(body.bindings)) {
    const existing = await loadChannelBindings(id);
    if (!existing.length) return c.json({ error: '入口至少需要一个绑定' }, 400);
    for (const b of existing) {
      if (b.sourceId == null) continue;
      const [, srcErr] = await resolveSource(Number(b.sourceId), newProtocol);
      if (srcErr) return c.json({ error: `绑定 ${b.sourceName}/${b.model} 的上游与协议不匹配` }, 400);
    }
  }

  try {
    await db.update(schema.channels).set(update).where(eq(schema.channels.id, id));
  } catch (e: any) {
    if (isUniqueViolation(e)) {
      return c.json({ error: `对外模型 "${update.exposedModel ?? current.exposedModel}" + ${newProtocol} 已存在` }, 400);
    }
    throw e;
  }
  await denormalizeChannel(id);
  const full = await loadChannelWithBindings(id);
  return c.json(full);
});

// 人工切换当前生效的上游绑定
admin.patch('/api/channels/:id/active', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const bindingId = Number(body.bindingId);
  if (!bindingId) return c.json({ error: 'missing bindingId' }, 400);
  const [b] = await db.select().from(schema.channelSources).where(eq(schema.channelSources.id, bindingId));
  if (!b || b.channelId !== id) return c.json({ error: 'binding not found in channel' }, 400);
  await db.update(schema.channels).set({ activeBindingId: bindingId }).where(eq(schema.channels.id, id));
  await denormalizeChannel(id);
  const full = await loadChannelWithBindings(id);
  return c.json(full);
});

admin.delete('/api/channels/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await sqlite.prepare('DELETE FROM t_proxy_channel_sources WHERE channel_id = ?').run(id);
  await db.delete(schema.channels).where(eq(schema.channels.id, id));
  return c.json({ ok: true });
});

/* ---------------- 模型入口组 model-groups（按 exposedModel 聚合多协议） ---------------- */
// 一个 modelId = 共享同一 exposedModel 的多条 channel（每条一个协议，各自多个上游绑定）。
// 这里提供按 modelId 整组保存的原子接口，便于前端用「一个弹窗管所有协议」。

/** 返回某 exposedModel 下的全部 channel（含 bindings），供组接口回传 */
async function loadGroupChannels(exposedModel: string): Promise<any[]> {
  const rows = await db.select().from(schema.channels)
    .where(eq(schema.channels.exposedModel, exposedModel));
  return attachBindings(rows.map(normalizeBool));
}

/** 校验并规整前端传入的 protocols 数组（每项 = 协议 + 多个上游绑定 + activeIndex） */
async function normalizeGroupProtocols(protocols: any): Promise<{
  value?: Array<{ protocol: Protocol; enabled: number; bindings: { sourceModelId: number; sourceId: number; model: string }[]; activeIndex: number }>;
  error?: string;
}> {
  if (!Array.isArray(protocols) || !protocols.length) return { error: '至少配置一个 API 类型' };
  const seen = new Set<string>();
  const value: any[] = [];
  for (const p of protocols) {
    const protocol = String(p?.protocol ?? '').trim();
    if (!PROTOCOLS[protocol as Protocol]) return { error: `无效的 API 类型 "${protocol}"` };
    if (seen.has(protocol)) return { error: `API 类型 "${protocol}" 重复` };
    seen.add(protocol);
    // 未配置上游的类型：跳过（不落库）—— 前端默认展示全部三类，留空的不保存
    const rawBindings = Array.isArray(p?.bindings) ? p.bindings : [];
    if (!rawBindings.length) continue;
    const bindings = await normalizeBindingsInput(rawBindings, protocol as Protocol);
    if (bindings.error) return { error: bindings.error };
    const activeIndex = Number.isInteger(p?.activeIndex) ? Math.max(0, Number(p.activeIndex)) : 0;
    value.push({
      protocol: protocol as Protocol,
      enabled: (p?.enabled ?? true) ? 1 : 0,
      bindings: bindings.value!,
      activeIndex,
    });
  }
  if (!value.length) return { error: '至少为一个 API 类型配置上游绑定' };
  return { value };
}

// 新建一个 modelId：为每个协议建一条 channel
admin.post('/api/model-groups', async (c) => {
  const body = await c.req.json();
  const exposedModel = String(body?.exposedModel ?? '').trim();
  const name = String(body?.name ?? '').trim() || exposedModel;
  if (!exposedModel) return c.json({ error: 'missing exposedModel' }, 400);
  const protos = await normalizeGroupProtocols(body?.protocols);
  if (protos.error) return c.json({ error: protos.error }, 400);
  const list = protos.value!;

  // (exposedModel, protocol) 不能已存在
  const exist = await db.select({ id: schema.channels.id }).from(schema.channels)
    .where(eq(schema.channels.exposedModel, exposedModel));
  if (exist.length) return c.json({ error: `对外模型 "${exposedModel}" 已存在` }, 400);

  const insCh = sqlite.prepare(
    `INSERT INTO t_proxy_channels (name, protocol, source_id, exposed_model, upstream_model, enabled) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const updActive = sqlite.prepare(`UPDATE t_proxy_channels SET active_binding_id = ? WHERE id = ?`);
  const channelIds: number[] = [];
  try {
    const tx = sqlite.transaction(() => {
      for (const p of list) {
        const info = insCh.run(name, p.protocol, p.bindings[0].sourceId, exposedModel, p.bindings[0].model, p.enabled);
        const chId = Number(info.lastInsertRowid);
        const ids = insertChannelBindings(chId, p.bindings);
        updActive.run(ids[p.activeIndex] ?? ids[0], chId);
        channelIds.push(chId);
      }
    });
    tx();
  } catch (e: any) {
    if (isUniqueViolation(e)) return c.json({ error: `对外模型 "${exposedModel}" 已存在` }, 400);
    throw e;
  }
  for (const id of channelIds) await denormalizeChannel(id);
  return c.json(await loadGroupChannels(exposedModel));
});

// 更新/重命名/重组一个 modelId（body.key = 旧 exposedModel；用 body 而非 URL 段，兼容空/特殊字符）
admin.put('/api/model-groups', async (c) => {
  const body = await c.req.json();
  const oldModel = String(body?.key ?? body?.exposedModel ?? '');
  const newModel = String(body?.exposedModel ?? '').trim();
  const name = String(body?.name ?? '').trim() || newModel;
  if (!newModel) return c.json({ error: 'missing exposedModel' }, 400);
  const protos = await normalizeGroupProtocols(body?.protocols);
  if (protos.error) return c.json({ error: protos.error }, 400);
  const list = protos.value!;

  const oldRows = (await db.select({ id: schema.channels.id, protocol: schema.channels.protocol })
    .from(schema.channels)
    .where(sql`COALESCE(${schema.channels.exposedModel}, '') = ${oldModel}`)) as Array<{ id: number; protocol: string }>;
  if (!oldRows.length) return c.json({ error: 'model not found' }, 404);

  const insCh = sqlite.prepare(
    `INSERT INTO t_proxy_channels (name, protocol, source_id, exposed_model, upstream_model, enabled) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const updCh = sqlite.prepare(
    `UPDATE t_proxy_channels SET name = ?, exposed_model = ?, enabled = ? WHERE id = ?`,
  );
  const updActive = sqlite.prepare(`UPDATE t_proxy_channels SET active_binding_id = ? WHERE id = ?`);
  const delBindings = sqlite.prepare(`DELETE FROM t_proxy_channel_sources WHERE channel_id = ?`);
  const delCh = sqlite.prepare(`DELETE FROM t_proxy_channels WHERE id = ?`);

  const touchedIds: number[] = [];
  try {
    const tx = sqlite.transaction(() => {
      const seen = new Set<string>();
      for (const p of list) {
        const exist = oldRows.find((o) => o.protocol === p.protocol);
        let chId: number;
        if (exist) {
          updCh.run(name, newModel, p.enabled, exist.id);
          chId = exist.id;
          const ids = replaceChannelBindings(chId, p.bindings);
          updActive.run(ids[p.activeIndex] ?? ids[0], chId);
        } else {
          const info = insCh.run(name, p.protocol, p.bindings[0].sourceId, newModel, p.bindings[0].model, p.enabled);
          chId = Number(info.lastInsertRowid);
          const ids = insertChannelBindings(chId, p.bindings);
          updActive.run(ids[p.activeIndex] ?? ids[0], chId);
        }
        seen.add(p.protocol);
        touchedIds.push(chId);
      }
      // 删除 payload 中不再包含的旧协议
      for (const o of oldRows) {
        if (!seen.has(o.protocol)) {
          delBindings.run(o.id);
          delCh.run(o.id);
        }
      }
    });
    tx();
  } catch (e: any) {
    if (isUniqueViolation(e)) {
      return c.json({ error: `对外模型 "${newModel}" + 某协议已存在（可能与其他模型冲突）` }, 400);
    }
    throw e;
  }
  for (const id of touchedIds) await denormalizeChannel(id);
  return c.json(await loadGroupChannels(newModel));
});

// 删除整个 modelId（其全部协议的 channel）；body.key = exposedModel，兼容空/特殊字符
admin.delete('/api/model-groups', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const model = String(body?.key ?? '');
  const rows = await db.select({ id: schema.channels.id }).from(schema.channels)
    .where(sql`COALESCE(${schema.channels.exposedModel}, '') = ${model}`);
  const delBindings = sqlite.prepare(`DELETE FROM t_proxy_channel_sources WHERE channel_id = ?`);
  const tx = sqlite.transaction((ids: number[]) => {
    for (const id of ids) { delBindings.run(id); }
  });
  tx(rows.map((r) => r.id));
  await db.delete(schema.channels).where(sql`COALESCE(${schema.channels.exposedModel}, '') = ${model}`);
  return c.json({ ok: true });
});

/* ---------------- 访问令牌 tokens ---------------- */

admin.get('/api/tokens', async (c) => {
  const rows = await db.select().from(schema.tokens).orderBy(desc(schema.tokens.createdAt));
  return c.json(rows.map((r) => normalizeBool({ ...r, token: maskToken(r.token) })));
});

admin.post('/api/tokens', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name ?? '').trim();
  if (!name) return c.json({ error: 'missing name' }, 400);
  const raw = String(body.token ?? '').trim();
  const token = raw || `ap_${nanoid(24)}`;
  let row: any;
  try {
    [row] = await db.insert(schema.tokens).values({ name, token, enabled: 1 }).returning();
  } catch (e: any) {
    if (isUniqueViolation(e)) return c.json({ error: 'token 已存在' }, 400);
    throw e;
  }
  invalidateTokensCache();
  return c.json(row);
});

admin.patch('/api/tokens/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const update: any = {};
  if (body.name !== undefined) update.name = String(body.name).trim();
  if (typeof body.enabled === 'boolean') update.enabled = body.enabled ? 1 : 0;
  if (body.token !== undefined && String(body.token).trim()) update.token = String(body.token).trim();
  if (Object.keys(update).length) {
    try {
      await db.update(schema.tokens).set(update).where(eq(schema.tokens.id, id));
    } catch (e: any) {
      if (isUniqueViolation(e)) return c.json({ error: 'token 已存在' }, 400);
      throw e;
    }
  }
  invalidateTokensCache();
  const [row] = await db.select().from(schema.tokens).where(eq(schema.tokens.id, id));
  return c.json(normalizeBool(row));
});

admin.delete('/api/tokens/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await db.delete(schema.tokens).where(eq(schema.tokens.id, id));
  invalidateTokensCache();
  return c.json({ ok: true });
});

/* ---------------- 日志 logs ---------------- */

// 把前端传入的时间字符串规整成 SQLite TEXT 可比较的 'YYYY-MM-DD HH:MM:SS'
function normalizeDt(v: string, endOfDay = false): string | null {
  if (!v) return null;
  let s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return endOfDay ? `${s} 23:59:59` : `${s} 00:00:00`;
  s = s.replace('T', ' ');
  return s;
}

admin.get('/api/logs/tags', async (c) => {
  // 聚合最近 5000 条日志的标签，返回去重后的标签及计数
  const rows = await db
    .select({ tags: schema.callLogs.tags })
    .from(schema.callLogs)
    .orderBy(desc(schema.callLogs.id))
    .limit(5000);
  const counter = new Map<string, number>();
  for (const r of rows) {
    const arr = Array.isArray(r.tags) ? r.tags : [];
    for (const t of arr) {
      const key = String(t);
      counter.set(key, (counter.get(key) || 0) + 1);
    }
  }
  return c.json([...counter.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count));
});

admin.get('/api/logs', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') || 50), 200);
  const offset = Number(c.req.query('offset') || 0);
  const channelId = c.req.query('channelId');
  const status = c.req.query('status');
  const protocol = c.req.query('protocol');
  const model = c.req.query('model');
  const tags = c.req.query('tags'); // 逗号分隔，包含任一即命中
  const starred = c.req.query('starred');
  const dateFrom = normalizeDt(c.req.query('dateFrom') || '', false);
  const dateTo = normalizeDt(c.req.query('dateTo') || '', true);

  const conds: any[] = [];
  if (channelId) conds.push(eq(schema.callLogs.channelId, Number(channelId)));
  if (protocol) conds.push(eq(schema.callLogs.protocol, protocol));
  if (model) conds.push(eq(schema.callLogs.model, model));
  if (status === 'error') conds.push(sql`status_code >= 400`);
  if (status === 'ok') conds.push(sql`(status_code < 400)`);
  if (starred === '1') conds.push(eq(schema.callLogs.starred, 1));
  if (dateFrom) conds.push(sql`${schema.callLogs.createdAt} >= ${dateFrom}`);
  if (dateTo) conds.push(sql`${schema.callLogs.createdAt} <= ${dateTo}`);
  if (tags) {
    const list = tags.split(',').map((t) => t.trim()).filter(Boolean);
    // SQLite：用 json_each 精确匹配标签
    const tagConds = list.map((t) => sql`exists (select 1 from json_each(${schema.callLogs.tags}) where value = ${t})`);
    if (tagConds.length === 1) conds.push(tagConds[0]);
    else if (tagConds.length > 1) conds.push(or(...tagConds) as any);
  }

  const rows = await db
    .select({
      id: schema.callLogs.id,
      channelId: schema.callLogs.channelId,
      channelName: schema.callLogs.channelName,
      sourceId: schema.callLogs.sourceId,
      protocol: schema.callLogs.protocol,
      model: schema.callLogs.model,
      isStream: schema.callLogs.isStream,
      statusCode: schema.callLogs.statusCode,
      latencyMs: schema.callLogs.latencyMs,
      usage: schema.callLogs.usage,
      inputTokens: schema.callLogs.inputTokens,
      cachedInputTokens: schema.callLogs.cachedInputTokens,
      outputTokens: schema.callLogs.outputTokens,
      inputCost: schema.callLogs.inputCost,
      cachedInputCost: schema.callLogs.cachedInputCost,
      outputCost: schema.callLogs.outputCost,
      totalCost: schema.callLogs.totalCost,
      error: schema.callLogs.error,
      aborted: schema.callLogs.aborted,
      tags: schema.callLogs.tags,
      starred: schema.callLogs.starred,
      createdAt: schema.callLogs.createdAt,
    })
    .from(schema.callLogs)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.callLogs.id))
    .limit(limit)
    .offset(offset);

  const [total] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.callLogs)
    .where(conds.length ? and(...conds) : undefined);

  return c.json({ rows: rows.map(normalizeBool), total: total.count });
});

admin.patch('/api/logs/:id/tags', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const tags: string[] = Array.isArray(body.tags)
    ? Array.from(new Set(body.tags.map((t: any) => String(t).trim()).filter(Boolean) as string[])).slice(0, 50)
    : [];
  await db.update(schema.callLogs).set({ tags }).where(eq(schema.callLogs.id, id));
  const [row] = await db.select().from(schema.callLogs).where(eq(schema.callLogs.id, id));
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ id: row.id, tags: row.tags });
});

admin.get('/api/logs/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const [row] = await db.select().from(schema.callLogs).where(eq(schema.callLogs.id, id));
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(normalizeBool(row));
});

// 收藏 / 取消收藏
admin.patch('/api/logs/:id/star', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const starred = !!body.starred;
  await db.update(schema.callLogs).set({ starred: starred ? 1 : 0 }).where(eq(schema.callLogs.id, id));
  const [row] = await db.select({ id: schema.callLogs.id, starred: schema.callLogs.starred }).from(schema.callLogs).where(eq(schema.callLogs.id, id));
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ id: row.id, starred: !!row.starred });
});

admin.delete('/api/logs', async (c) => {
  // 清空但不删收藏（starred=1 的记录保留）
  const info = sqlite.prepare(`DELETE FROM t_proxy_call_logs WHERE starred = 0`).run();
  return c.json({ ok: true, deleted: info.changes });
});

/* ---------------- 统计 stats ---------------- */

admin.get('/api/stats', async (c) => {
  const groupBy = (c.req.query('groupBy') || 'day') as 'day' | 'month' | 'source' | 'channel' | 'model';
  const dateFrom = normalizeDt(c.req.query('dateFrom') || '', false);
  const dateTo = normalizeDt(c.req.query('dateTo') || '', true);
  const sourceId = c.req.query('sourceId');
  const channelId = c.req.query('channelId');
  const model = c.req.query('model');
  const protocol = c.req.query('protocol');

  const conds: any[] = [];
  if (dateFrom) conds.push(sql`${schema.callLogs.createdAt} >= ${dateFrom}`);
  if (dateTo) conds.push(sql`${schema.callLogs.createdAt} <= ${dateTo}`);
  if (sourceId) conds.push(eq(schema.callLogs.sourceId, Number(sourceId)));
  if (channelId) conds.push(eq(schema.callLogs.channelId, Number(channelId)));
  if (model) conds.push(eq(schema.callLogs.model, model));
  if (protocol) conds.push(eq(schema.callLogs.protocol, protocol));
  const where = conds.length ? and(...conds) : undefined;

  // 分组键 SQL
  let keyExpr: any;
  if (groupBy === 'day') keyExpr = sql`date(${schema.callLogs.createdAt})`;
  else if (groupBy === 'month') keyExpr = sql`strftime('%Y-%m', ${schema.callLogs.createdAt})`;
  else if (groupBy === 'source') keyExpr = schema.callLogs.sourceId;
  else if (groupBy === 'channel') keyExpr = schema.callLogs.channelId;
  else keyExpr = schema.callLogs.model;

  const rows = await db
    .select({
      key: keyExpr as any,
      inputTokens: sql<number>`coalesce(sum(${schema.callLogs.inputTokens}),0)`,
      cachedInputTokens: sql<number>`coalesce(sum(${schema.callLogs.cachedInputTokens}),0)`,
      outputTokens: sql<number>`coalesce(sum(${schema.callLogs.outputTokens}),0)`,
      cost: sql<number>`coalesce(sum(${schema.callLogs.totalCost}),0)`,
      calls: sql<number>`count(*)`,
    })
    .from(schema.callLogs)
    .where(where)
    .groupBy(keyExpr as any)
    .orderBy(keyExpr as any);

  // 总计
  const [totals] = await db
    .select({
      inputTokens: sql<number>`coalesce(sum(${schema.callLogs.inputTokens}),0)`,
      cachedInputTokens: sql<number>`coalesce(sum(${schema.callLogs.cachedInputTokens}),0)`,
      outputTokens: sql<number>`coalesce(sum(${schema.callLogs.outputTokens}),0)`,
      cost: sql<number>`coalesce(sum(${schema.callLogs.totalCost}),0)`,
      calls: sql<number>`count(*)`,
    })
    .from(schema.callLogs)
    .where(where);

  // 为 source/channel/model 补可读名称
  const result = rows.map((r: any) => ({ ...r, label: String(r.key ?? '-') }));

  if (groupBy === 'source' || groupBy === 'channel') {
    const ids = result.map((r) => Number(r.key)).filter((n) => !Number.isNaN(n) && n > 0);
    const names = new Map<number, string>();
    if (ids.length) {
      const table = groupBy === 'source' ? schema.sources : schema.channels;
      const idCol = groupBy === 'source' ? schema.sources.id : schema.channels.id;
      const nameCol = groupBy === 'source' ? schema.sources.name : schema.channels.name;
      const nameRows = await db.select({ id: idCol, name: nameCol }).from(table);
      for (const nr of nameRows) names.set(nr.id, nr.name ?? '');
    }
    for (const r of result) r.label = names.get(Number(r.key)) || `#${r.key}`;
  }

  return c.json({ groupBy, rows: result, totals });
});

/* ---------------- 统计 stats（堆叠） ---------------- */

type StackDim = 'source_daily' | 'source_model' | 'channel_model' | 'single_source_model';

admin.get('/api/stats/stacked', async (c) => {
  const dim = (c.req.query('dim') || 'source_daily') as StackDim;
  const metric = c.req.query('metric') === 'calls' ? 'calls' : c.req.query('metric') === 'cost' ? 'cost' : 'tokens';
  const dateFrom = normalizeDt(c.req.query('dateFrom') || '', false);
  const dateTo = normalizeDt(c.req.query('dateTo') || '', true);
  const sourceId = c.req.query('sourceId');
  const channelId = c.req.query('channelId');
  const protocol = c.req.query('protocol');

  // single_source_model 必须先选定上游
  if (dim === 'single_source_model' && !sourceId) {
    return c.json({ dim, metric, labels: [], stacks: [] });
  }

  // 维度 → 行/列表达式
  const rowExprByDim: Record<StackDim, string> = {
    source_daily: `date(created_at)`,
    source_model: `source_id`,
    channel_model: `channel_id`,
    single_source_model: `date(created_at)`,
  };
  const stackExprByDim: Record<StackDim, string> = {
    source_daily: `source_id`,
    source_model: `model`,
    channel_model: `model`,
    single_source_model: `model`,
  };
  const rowExpr = rowExprByDim[dim];
  const stackExpr = stackExprByDim[dim];
  const metricExpr = metric === 'calls'
    ? `count(*)`
    : metric === 'cost'
      ? `coalesce(sum(coalesce(total_cost,0)),0)`
      : `coalesce(sum(coalesce(input_tokens,0)+coalesce(cached_input_tokens,0)+coalesce(output_tokens,0)),0)`;

  // WHERE 拼接
  const whereParts: string[] = [];
  const params: any[] = [];
  if (dateFrom) { whereParts.push(`created_at >= ?`); params.push(dateFrom); }
  if (dateTo) { whereParts.push(`created_at <= ?`); params.push(dateTo); }
  if (sourceId) { whereParts.push(`source_id = ?`); params.push(Number(sourceId)); }
  if (channelId) { whereParts.push(`channel_id = ?`); params.push(Number(channelId)); }
  if (protocol) { whereParts.push(`protocol = ?`); params.push(protocol); }
  const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const q = `SELECT ${rowExpr} AS r, ${stackExpr} AS s, ${metricExpr} AS v
             FROM t_proxy_call_logs ${whereSql}
             GROUP BY r, s ORDER BY r, s`;
  const rows = sqlite.prepare(q).all(...params) as Array<{ r: number | string | null; s: number | string | null; v: number }>;

  // 名称解析（source / channel）
  const needSourceNames = dim === 'source_daily' || dim === 'source_model';
  const needChannelNames = dim === 'channel_model';
  const sourceNames = new Map<number, string>();
  const channelNames = new Map<number, string>();
  if (needSourceNames) {
    for (const r of await db.select({ id: schema.sources.id, name: schema.sources.name }).from(schema.sources)) {
      sourceNames.set(r.id, r.name);
    }
  }
  if (needChannelNames) {
    for (const r of await db.select({ id: schema.channels.id, name: schema.channels.name }).from(schema.channels)) {
      channelNames.set(r.id, r.name ?? '');
    }
  }
  function rowLabel(r: any): string {
    if (dim === 'source_daily' || dim === 'single_source_model') return String(r ?? '-');
    if (dim === 'source_model') { const n = Number(r); return sourceNames.get(n) || `#${r}`; }
    if (dim === 'channel_model') { const n = Number(r); return channelNames.get(n) || `#${r}`; }
    return String(r ?? '-');
  }
  const stackLabel = (s: any) => {
    if (dim === 'source_daily') { const n = Number(s); return sourceNames.get(n) || `#${s}`; }
    return String(s ?? '(unknown)');
  };

  // pivot：保持行/列出现顺序
  const rowOrder: string[] = [];
  const rowSeen = new Set<string>();
  const stackOrder: string[] = [];
  const stackSeen = new Set<string>();
  // 单上游模型分布时，行是日期 → 排序成时间；其余维度行也保持查询的 ASC
  for (const row of rows) {
    const rl = rowLabel(row.r);
    if (!rowSeen.has(rl)) { rowSeen.add(rl); rowOrder.push(rl); }
    const sl = stackLabel(row.s);
    if (!stackSeen.has(sl)) { stackSeen.add(sl); stackOrder.push(sl); }
  }
  const matrix = new Map<string, number>(); // `${rowLabel} ${stackLabel}` -> v
  for (const row of rows) {
    matrix.set(`${rowLabel(row.r)} ${stackLabel(row.s)}`, row.v);
  }
  const labels = rowOrder;
  const stacks = stackOrder.map((sl, si) => ({
    key: sl,
    label: sl,
    color: STACK_COLORS[si % STACK_COLORS.length],
    values: labels.map((rl) => matrix.get(`${rl} ${sl}`) ?? 0),
  }));

  return c.json({ dim, metric, labels, stacks });
});

/* ---------------- 工具 ---------------- */

// SQLite 用 integer(0/1) 存布尔；统一转回 boolean（仅影响 enabled/isStream/aborted/logIo 等字段）
function normalizeBool(row: any): any {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  if ('enabled' in out && typeof out.enabled === 'number') out.enabled = !!out.enabled;
  if ('isStream' in out && typeof out.isStream === 'number') out.isStream = !!out.isStream;
  if ('aborted' in out && typeof out.aborted === 'number') out.aborted = !!out.aborted;
  if ('starred' in out && typeof out.starred === 'number') out.starred = !!out.starred;
  if ('logIo' in out && typeof out.logIo === 'number') out.logIo = !!out.logIo;
  if ('logStreamBody' in out && typeof out.logStreamBody === 'number') out.logStreamBody = !!out.logStreamBody;
  return out;
}

export default admin;
