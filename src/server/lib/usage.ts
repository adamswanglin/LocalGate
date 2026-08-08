import type { Protocol } from './protocol.js';

/**
 * 规范化 usage：把各协议不同结构的 usage 统一成三个字段，便于聚合统计。
 *  - inputTokens:        输入 token（不含缓存命中部分）
 *  - cachedInputTokens:  输入 token（缓存命中部分）
 *  - outputTokens:       输出 token
 */
export interface NormalizedUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

const ZERO: NormalizedUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };

function num(v: any): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function normalizeUsage(usage: any, protocol: Protocol): NormalizedUsage {
  if (!usage || typeof usage !== 'object') return { ...ZERO };

  if (protocol === 'anthropic') {
    // input_tokens 即非缓存输入；cache_read / cache_creation 计入缓存输入
    const cached = num(usage.cache_read_input_tokens) + num(usage.cache_creation_input_tokens);
    return {
      inputTokens: num(usage.input_tokens),
      cachedInputTokens: cached,
      outputTokens: num(usage.output_tokens),
    };
  }

  if (protocol === 'openai_response') {
    // input_tokens 为总输入；input_tokens_details.cached_tokens 为缓存命中
    const input = num(usage.input_tokens);
    const cached = num(usage.input_tokens_details?.cached_tokens);
    return {
      inputTokens: Math.max(0, input - cached),
      cachedInputTokens: cached,
      outputTokens: num(usage.output_tokens),
    };
  }

  // openai_chat：prompt_tokens 为总输入；prompt_tokens_details.cached_tokens 为缓存命中
  const prompt = num(usage.prompt_tokens);
  const cached = num(usage.prompt_tokens_details?.cached_tokens);
  return {
    inputTokens: Math.max(0, prompt - cached),
    cachedInputTokens: cached,
    outputTokens: num(usage.completion_tokens),
  };
}
