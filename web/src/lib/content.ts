// 从请求 / 响应 / 流式 chunk 中提取“人类可读的对话文本”，供格式化视图渲染 markdown。

export type Protocol = 'openai_chat' | 'openai_response' | 'anthropic';

export interface Msg {
  role: string;
  text: string;
}

const isEmpty = (s: string | null | undefined): s is '' => !s || !s.trim();

/** 把 OpenAI 风格的 content（string 或 parts 数组）拍平成纯文本 */
function flattenOpenAiContent(content: any): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p: any) => {
        if (p == null) return '';
        if (typeof p === 'string') return p;
        if (p.type === 'text' || p.type === 'input_text' || p.type === 'output_text') return p.text || '';
        if (p.type === 'image_url' || p.type === 'image') return `![image](${typeof p.image_url === 'string' ? p.image_url : p.image_url?.url ?? ''})`;
        if (p.text) return p.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return String(content);
}

/** Anthropic content 数组（含 tool_use / tool_result）拍平成文本 */
function flattenAnthropicContent(content: any): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content);
  return content
    .map((b: any) => {
      if (b == null) return '';
      if (typeof b === 'string') return b;
      switch (b.type) {
        case 'text':
          return b.text || '';
        case 'tool_use':
          return `\`\`\`json\n// tool_use: ${b.name}\n${JSON.stringify(b.input ?? {}, null, 2)}\n\`\`\``;
        case 'tool_result': {
          const inner = typeof b.content === 'string' ? b.content : flattenAnthropicContent(b.content);
          return `> **tool_result**\n>\n> ${inner.split('\n').join('\n> ')}`;
        }
        case 'image':
          return `![image]`;
        default:
          return b.text || '';
      }
    })
    .filter(Boolean)
    .join('\n\n');
}

/** 从请求体解析出消息列表（含 system） */
export function extractRequestMessages(req: any, protocol: Protocol): Msg[] {
  if (!req || typeof req !== 'object') return [];
  const msgs: Msg[] = [];

  if (protocol === 'anthropic') {
    if (req.system != null) {
      const sys = typeof req.system === 'string' ? req.system : flattenAnthropicContent(req.system);
      if (!isEmpty(sys)) msgs.push({ role: 'system', text: sys });
    }
    for (const m of Array.isArray(req.messages) ? req.messages : []) {
      const text = flattenAnthropicContent(m.content);
      if (!isEmpty(text)) msgs.push({ role: m.role || 'user', text });
    }
    return msgs;
  }

  if (protocol === 'openai_response') {
    if (req.instructions != null && !isEmpty(String(req.instructions))) {
      msgs.push({ role: 'system', text: String(req.instructions) });
    }
    const input = req.input;
    if (typeof input === 'string') {
      if (!isEmpty(input)) msgs.push({ role: 'user', text: input });
    } else if (Array.isArray(input)) {
      for (const m of input) {
        if (m == null) continue;
        const role = m.role || 'user';
        if (typeof m.content === 'string') {
          if (!isEmpty(m.content)) msgs.push({ role, text: m.content });
        } else if (Array.isArray(m.content)) {
          const text = flattenOpenAiContent(m.content);
          if (!isEmpty(text)) msgs.push({ role, text });
        } else if (typeof m.text === 'string') {
          msgs.push({ role, text: m.text });
        }
      }
    }
    return msgs;
  }

  // openai_chat (default)
  for (const m of Array.isArray(req.messages) ? req.messages : []) {
    const text = flattenOpenAiContent(m.content);
    if (!isEmpty(text)) msgs.push({ role: m.role || 'user', text });
  }
  return msgs;
}

/** 请求体里的“其他字段”——除 messages/system/input 之外的可调参数，做成 key-value 展示 */
export function extractRequestMeta(req: any, protocol: Protocol): { k: string; v: string }[] {
  if (!req || typeof req !== 'object') return [];
  const ignore = new Set(['messages', 'system', 'input', 'instructions', 'stream']);
  const out: { k: string; v: string }[] = [];
  for (const [k, v] of Object.entries(req)) {
    if (ignore.has(k)) continue;
    if (v == null) continue;
    let s: string;
    if (typeof v === 'string') s = v;
    else if (typeof v === 'number' || typeof v === 'boolean') s = String(v);
    else s = JSON.stringify(v);
    if (s.length > 200) s = s.slice(0, 200) + '…';
    out.push({ k, v: s });
  }
  return out;
}

/** 非流式响应体中提取最终文本 */
export function extractResponseText(res: any, protocol: Protocol): string {
  if (!res || typeof res !== 'object') return '';
  if (protocol === 'anthropic') {
    return flattenAnthropicContent(res.content);
  }
  if (protocol === 'openai_response') {
    if (typeof res.output_text === 'string' && res.output_text) return res.output_text;
    if (Array.isArray(res.output)) {
      return res.output
        .map((o: any) => {
          if (o == null) return '';
          if (typeof o.content === 'string') return o.content;
          if (Array.isArray(o.content)) return flattenOpenAiContent(o.content);
          if (typeof o.text === 'string') return o.text;
          return '';
        })
        .filter(Boolean)
        .join('\n\n');
    }
    return '';
  }
  // openai_chat
  const choice = Array.isArray(res.choices) ? res.choices[0] : null;
  if (choice?.message) return flattenOpenAiContent(choice.message.content);
  return '';
}

/** 把流式 chunk 数组拼成最终文本 */
export function extractStreamText(chunks: any[], protocol: Protocol): string {
  if (!Array.isArray(chunks) || !chunks.length) return '';
  if (protocol === 'anthropic') {
    return chunks
      .map((c) => {
        if (c?.type === 'content_block_delta' && c.delta?.type === 'text_delta') return c.delta.text || '';
        if (c?.type === 'message_delta' && typeof c.delta?.text === 'string') return c.delta.text;
        return '';
      })
      .join('');
  }
  if (protocol === 'openai_response') {
    return chunks
      .map((c) => {
        if (c?.type === 'response.output_text.delta' && typeof c.delta === 'string') return c.delta;
        if (typeof c?.text === 'string') return c.text;
        return '';
      })
      .join('');
  }
  // openai_chat
  return chunks
    .map((c) => c?.choices?.[0]?.delta?.content || '')
    .join('');
}
