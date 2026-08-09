import { sqliteTable, text, integer, real, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// 上游真实 AI 源（外部服务）
// provider / base_url 为「首个端点」的反规范化镜像（保留旧列满足 NOT NULL），真实路由读 t_proxy_source_endpoints
export const sources = sqliteTable('t_proxy_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  // openai_chat | openai_response | anthropic（镜像首个端点协议）
  provider: text('provider').notNull(),
  // 镜像首个端点的 base_url
  baseUrl: text('base_url').notNull(),
  apiKey: text('api_key').notNull(),
  enabled: integer('enabled').default(1).notNull(),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`).notNull(),
});

// 上游源的协议地址（一个源可配多个协议，各自独立的 base_url；共用源的 api_key）
export const sourceEndpoints = sqliteTable('t_proxy_source_endpoints', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id').notNull(),
  // openai_chat | openai_response | anthropic
  protocol: text('protocol').notNull(),
  baseUrl: text('base_url').notNull(),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`).notNull(),
}, (t) => [
  // 每个源同一协议只能有一个地址
  uniqueIndex('ux_source_endpoint_protocol').on(t.sourceId, t.protocol),
]);

// 上游源的模型与价格（模型/价格归属地；元/百万 token）
export const sourceModels = sqliteTable('t_proxy_source_models', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id').notNull(),
  // 上游模型名（转发给上游时 body.model 用它）
  model: text('model').notNull(),
  // 非缓存输入价格（元/百万 token）
  inputPrice: real('input_price'),
  // 缓存输入价格（元/百万 token）
  cachedInputPrice: real('cached_input_price'),
  // 输出价格（元/百万 token）
  outputPrice: real('output_price'),
  enabled: integer('enabled').default(1).notNull(),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`).notNull(),
}, (t) => [
  uniqueIndex('ux_source_model').on(t.sourceId, t.model),
]);

// 对外暴露的模型入口
// 路由标识 = (对外模型名, API类型/协议)
// 入口本身不配价格；可绑定多个「上游源模型」，人工切换当前生效的绑定
export const channels = sqliteTable('t_proxy_channels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // 入口显示名称（客户端 body.model 用 exposed_model，name 仅作标识/统计）
  name: text('name').notNull(),
  // 入站协议 = 上游 provider: openai_chat | openai_response | anthropic
  protocol: text('protocol').notNull(),
  // 当前生效绑定 id（t_proxy_channel_sources.id）
  activeBindingId: integer('active_binding_id'),
  // ↓ 旧列保留并反规范化当前生效绑定（源 / 上游模型名），真实路由逻辑只读绑定
  sourceId: integer('source_id').notNull(),
  // 对外暴露给客户端的模型名（客户端请求 body.model 用这个）
  exposedModel: text('exposed_model'),
  // 转发给上游时实际使用的模型名（反规范化当前生效绑定的模型）
  upstreamModel: text('upstream_model'),
  enabled: integer('enabled').default(1).notNull(),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`).notNull(),
}, (t) => [
  // (对外模型名, 协议) 联合唯一
  uniqueIndex('ux_exposed_model_protocol').on(t.exposedModel, t.protocol),
]);

// 模型入口↔上游绑定（选中一个上游源模型）
export const channelSources = sqliteTable('t_proxy_channel_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  channelId: integer('channel_id').notNull(),
  sourceModelId: integer('source_model_id').notNull(),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`).notNull(),
}, (t) => [
  uniqueIndex('ux_channel_source_model').on(t.channelId, t.sourceModelId),
]);

// 调用日志
export const callLogs = sqliteTable('t_proxy_call_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  channelId: integer('channel_id'),
  channelName: text('channel_name'),
  sourceId: integer('source_id'),
  protocol: text('protocol').notNull(),
  // 记录对外模型名（用户视角标识）
  model: text('model'),
  isStream: integer('is_stream').default(0).notNull(),
  statusCode: integer('status_code'),
  latencyMs: integer('latency_ms'),
  requestBody: text('request_body'),
  responseBody: text('response_body'),
  responseChunks: text('response_chunks'),
  usage: text('usage', { mode: 'json' }).$type<any>(),
  // 规范化后的 token 计数（便于聚合统计）
  inputTokens: integer('input_tokens'), // 输入 token（不含缓存）
  cachedInputTokens: integer('cached_input_tokens'), // 输入 token（缓存命中）
  outputTokens: integer('output_tokens'), // 输出 token
  // 调用时按上游模型价格计算的费用（元）
  inputCost: real('input_cost'),
  cachedInputCost: real('cached_input_cost'),
  outputCost: real('output_cost'),
  totalCost: real('total_cost'),
  error: text('error'),
  aborted: integer('aborted').default(0).notNull(),
  // 用户给这条日志打的标签（JSON 字符串数组）
  tags: text('tags', { mode: 'json' }).$type<string[]>().default([]).notNull(),
  // 是否收藏（容量清理时保护 starred=1 的记录）
  starred: integer('starred').default(0).notNull(),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`).notNull(),
});

// 访问令牌（不配置任何 token 时，代理放行空 key 访问）
export const tokens = sqliteTable('t_proxy_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  token: text('token').notNull(),
  enabled: integer('enabled').default(1).notNull(),
  lastUsedAt: text('last_used_at'),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`).notNull(),
}, (t) => [
  uniqueIndex('ux_token').on(t.token),
]);

// 全局配置（单行，固定 id=1）
export const settings = sqliteTable('t_proxy_settings', {
  id: integer('id').primaryKey(),
  // 是否记录出入参（全局开关）
  logIo: integer('log_io').default(1).notNull(),
  // 流式响应是否捕获完整 body（全局开关）
  logStreamBody: integer('log_stream_body').default(1).notNull(),
});

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type SourceEndpoint = typeof sourceEndpoints.$inferSelect;
export type NewSourceEndpoint = typeof sourceEndpoints.$inferInsert;
export type SourceModel = typeof sourceModels.$inferSelect;
export type NewSourceModel = typeof sourceModels.$inferInsert;
export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
export type ChannelSource = typeof channelSources.$inferSelect;
export type NewChannelSource = typeof channelSources.$inferInsert;
export type CallLog = typeof callLogs.$inferSelect;
export type Token = typeof tokens.$inferSelect;
export type NewToken = typeof tokens.$inferInsert;
export type Settings = typeof settings.$inferSelect;
