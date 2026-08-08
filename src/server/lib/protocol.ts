export type Protocol = 'openai_chat' | 'openai_response' | 'anthropic';

export interface ProtocolMeta {
  // 客户端请求路径
  path: string;
  // 上游路径后缀（拼到 source.baseUrl 后面）
  upstreamSuffix: string;
  // 转发给上游时使用的 header
  upstreamAuthHeader: 'authorization' | 'x-api-key';
}

export const PROTOCOLS: Record<Protocol, ProtocolMeta> = {
  openai_chat: {
    path: '/v1/chat/completions',
    upstreamSuffix: '/chat/completions',
    upstreamAuthHeader: 'authorization',
  },
  openai_response: {
    path: '/v1/responses',
    upstreamSuffix: '/responses',
    upstreamAuthHeader: 'authorization',
  },
  anthropic: {
    path: '/v1/messages',
    upstreamSuffix: '/v1/messages',
    upstreamAuthHeader: 'x-api-key',
  },
};

export const PROTOCOL_LIST: Protocol[] = ['openai_chat', 'openai_response', 'anthropic'];

export function isProtocol(v: string): v is Protocol {
  return (PROTOCOL_LIST as string[]).includes(v);
}

/** 从请求路径反推协议 */
export function protocolFromPath(pathname: string): Protocol | null {
  for (const p of PROTOCOL_LIST) {
    if (PROTOCOLS[p].path === pathname) return p;
  }
  return null;
}
