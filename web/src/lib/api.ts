const base = '';

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(base + url, {
    headers: { 'content-type': 'application/json', ...(opts?.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = j.error || JSON.stringify(j);
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface SourceModel {
  id: number;
  sourceId: number;
  model: string;
  inputPrice: number | null;
  cachedInputPrice: number | null;
  outputPrice: number | null;
  enabled: boolean;
  createdAt: string;
}

export interface SourceEndpoint {
  id: number;
  sourceId: number;
  protocol: string;
  baseUrl: string;
}

export interface Source {
  id: number;
  name: string;
  apiKey: string;
  enabled: boolean;
  createdAt: string;
  endpoints: SourceEndpoint[];
  models: SourceModel[];
}

export interface ModelEntryBinding {
  id: number;
  channelId: number;
  sourceModelId: number;
  sourceId: number | null;
  sourceName: string;
  model: string;
  inputPrice: number | null;
  cachedInputPrice: number | null;
  outputPrice: number | null;
}

export interface ModelEntry {
  id: number;
  name: string;
  protocol: string;
  sourceId: number;
  upstreamModel: string;
  exposedModel: string;
  enabled: boolean;
  createdAt: string;
  activeBindingId: number | null;
  bindings: ModelEntryBinding[];
}

export interface Token {
  id: number;
  name: string;
  token: string;
  enabled: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface MetaInfo {
  port: number;
  localIPs: string[];
}

export interface Settings {
  logIo: boolean;
  logStreamBody: boolean;
  logCap: number;
  proxyUrl: string;
}

export interface LogRow {
  id: number;
  channelId: number | null;
  sourceId: number | null;
  channelName: string | null;
  protocol: string;
  model: string | null;
  isStream: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  usage: any;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  inputCost: number | null;
  cachedInputCost: number | null;
  outputCost: number | null;
  totalCost: number | null;
  error: string | null;
  aborted: boolean;
  tags: string[];
  starred: boolean;
  createdAt: string;
}

export interface LogDetail extends LogRow {
  sourceId: number | null;
  requestBody: string | null;
  responseBody: string | null;
  responseChunks: string | null;
}

export interface StatRow {
  key: string | number | null;
  label: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  cost: number;
  calls: number;
  errorCalls: number;
}
export interface StatsResult {
  groupBy: string;
  rows: StatRow[];
  totals: { inputTokens: number; cachedInputTokens: number; outputTokens: number; cost: number; calls: number; errorCalls: number };
}

export interface StackedSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}
export interface StackedStatsResult {
  dim: string;
  metric: string;
  labels: string[];
  stacks: StackedSeries[];
}

export interface SyslogEntry {
  id: number;
  ts: string;
  level: 'error' | 'warn';
  source: string;
  message: string;
  detail?: string;
}

export const api = {
  meta: {
    get: () => req<MetaInfo>('/api/meta'),
  },
  sources: {
    list: () => req<Source[]>('/api/sources'),
    create: (b: any) => req<Source>('/api/sources', { method: 'POST', body: JSON.stringify(b) }),
    update: (id: number, b: any) => req<Source>(`/api/sources/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
    remove: (id: number) => req(`/api/sources/${id}`, { method: 'DELETE' }),
    test: (id: number, model: string, protocol?: string) =>
      req<{ protocol: string; ok: boolean; status: number | null; sample?: string; error?: string }>(`/api/sources/${id}/test`, { method: 'POST', body: JSON.stringify({ model, protocol }) }),
  },
  modelEntries: {
    list: () => req<ModelEntry[]>('/api/channels'),
    create: (b: any) => req<ModelEntry>('/api/channels', { method: 'POST', body: JSON.stringify(b) }),
    update: (id: number, b: any) => req<ModelEntry>(`/api/channels/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
    remove: (id: number) => req(`/api/channels/${id}`, { method: 'DELETE' }),
    setActive: (id: number, bindingId: number) => req<ModelEntry>(`/api/channels/${id}/active`, { method: 'PATCH', body: JSON.stringify({ bindingId }) }),
  },
  modelGroups: {
    // 整组（一个 exposedModel 下多协议）原子保存；返回该组的全部 channel。
    // PUT/DELETE 用 body.key 传旧 exposedModel，兼容空/特殊字符
    create: (b: any) => req<ModelEntry[]>('/api/model-groups', { method: 'POST', body: JSON.stringify(b) }),
    update: (key: string, b: any) => req<ModelEntry[]>('/api/model-groups', { method: 'PUT', body: JSON.stringify({ key, ...b }) }),
    remove: (key: string) => req('/api/model-groups', { method: 'DELETE', body: JSON.stringify({ key }) }),
    test: (exposedModel: string, model: string) =>
      req<{ protocol: string; ok: boolean; status?: number; sample?: string; error?: string; results?: any[] }>(
        '/api/model-groups/test', { method: 'POST', body: JSON.stringify({ exposedModel, model }) },
      ),
  },
  tokens: {
    list: () => req<Token[]>('/api/tokens'),
    create: (b: { name: string; token?: string }) => req<Token>('/api/tokens', { method: 'POST', body: JSON.stringify(b) }),
    update: (id: number, b: Partial<Token>) => req<Token>(`/api/tokens/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
    remove: (id: number) => req(`/api/tokens/${id}`, { method: 'DELETE' }),
  },
  settings: {
    get: () => req<Settings>('/api/settings'),
    update: (b: Partial<Settings>) => req<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify(b) }),
  },
  stats: {
    list: (params: Record<string, string>) =>
      req<StatsResult>('/api/stats?' + new URLSearchParams(params).toString()),
    stacked: (params: Record<string, string>) =>
      req<StackedStatsResult>('/api/stats/stacked?' + new URLSearchParams(params).toString()),
  },
  logs: {
    list: (params: Record<string, string | number>) =>
      req<{ rows: LogRow[]; total: number }>('/api/logs?' + new URLSearchParams(params as any).toString()),
    detail: (id: number) => req<LogDetail>(`/api/logs/${id}`),
    clear: () => req('/api/logs', { method: 'DELETE' }),
    tags: () => req<{ name: string; count: number }[]>('/api/logs/tags'),
    setTags: (id: number, tags: string[]) =>
      req<{ id: number; tags: string[] }>(`/api/logs/${id}/tags`, { method: 'PATCH', body: JSON.stringify({ tags }) }),
    setStar: (id: number, starred: boolean) =>
      req<{ id: number; starred: boolean }>(`/api/logs/${id}/star`, { method: 'PATCH', body: JSON.stringify({ starred }) }),
  },
  systemLogs: {
    list: (limit = 200) =>
      req<{ rows: SyslogEntry[] }>(`/api/system-logs?limit=${limit}`),
    clear: () => req('/api/system-logs', { method: 'DELETE' }),
  },
};
