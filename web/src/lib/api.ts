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

export interface ChannelBinding {
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

export interface Channel {
  id: number;
  protocol: string;
  sourceId: number;
  upstreamModel: string;
  exposedModel: string;
  enabled: boolean;
  createdAt: string;
  activeBindingId: number | null;
  bindings: ChannelBinding[];
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
}
export interface StatsResult {
  groupBy: string;
  rows: StatRow[];
  totals: { inputTokens: number; cachedInputTokens: number; outputTokens: number; cost: number; calls: number };
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
  channels: {
    list: () => req<Channel[]>('/api/channels'),
    create: (b: any) => req<Channel>('/api/channels', { method: 'POST', body: JSON.stringify(b) }),
    update: (id: number, b: any) => req<Channel>(`/api/channels/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
    remove: (id: number) => req(`/api/channels/${id}`, { method: 'DELETE' }),
    setActive: (id: number, bindingId: number) => req<Channel>(`/api/channels/${id}/active`, { method: 'PATCH', body: JSON.stringify({ bindingId }) }),
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
};
