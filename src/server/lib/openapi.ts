// LocalRouter 对外 AI 接口的 OpenAPI 3.1 规格 + Markdown 生成。
// 单点事实来源：`/openapi.json`、`/openapi.md` 与 Web 端「API 文档」页都从这份定义产出。

export interface DocsContext {
  port: number;
  localIPs: string[];
  /** 是否已配置启用中的访问令牌（影响鉴权说明与 security） */
  hasTokens: boolean;
  /** 当前已启用入口的对外模型名（去重） */
  models: string[];
  version: string;
}

type JsonSchema = Record<string, any>;

/* ---------------- 共享 JSON Schema ---------------- */

const MESSAGE: JsonSchema = {
  type: 'object',
  required: ['role'],
  properties: {
    role: {
      type: 'string',
      enum: ['system', 'user', 'assistant', 'tool', 'developer'],
      description: '消息角色',
    },
    content: {
      description: '消息内容：字符串，或多模态内容块数组（图片等）',
      oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'object', additionalProperties: true } }],
    },
    name: { type: 'string', description: '参与者的可选名称' },
    tool_calls: { type: 'array', items: { type: 'object' }, description: 'assistant 消息携带的工具调用列表' },
    tool_call_id: { type: 'string', description: 'tool 角色消息引用的工具调用 ID' },
  },
  additionalProperties: true,
};

const ANTHROPIC_MESSAGE: JsonSchema = {
  type: 'object',
  required: ['role', 'content'],
  properties: {
    role: { type: 'string', enum: ['user', 'assistant'], description: 'Anthropic 消息角色' },
    content: {
      description: '消息内容：字符串或内容块数组',
      oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'object' } }],
    },
  },
  additionalProperties: true,
};

const TOOL: JsonSchema = {
  type: 'object',
  required: ['type', 'function'],
  properties: {
    type: { type: 'string', enum: ['function'] },
    function: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: '函数名' },
        description: { type: 'string', description: '函数用途说明' },
        parameters: { type: 'object', description: '函数参数（JSON Schema 形式）' },
      },
    },
  },
};

const USAGE: JsonSchema = {
  type: 'object',
  properties: {
    prompt_tokens: { type: 'integer', description: '输入 token（OpenAI 风格）' },
    completion_tokens: { type: 'integer', description: '输出 token（OpenAI 风格）' },
    total_tokens: { type: 'integer', description: '总 token（OpenAI 风格）' },
    input_tokens: { type: 'integer', description: '输入 token（Anthropic 风格）' },
    output_tokens: { type: 'integer', description: '输出 token（Anthropic 风格）' },
  },
};

const CHAT_COMPLETION_REQUEST: JsonSchema = {
  type: 'object',
  required: ['model', 'messages'],
  properties: {
    model: { type: 'string', description: '对外暴露的模型名（在「模型入口」中配置，如 gpt-4o）' },
    messages: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/components/schemas/Message' },
      description: '对话消息列表',
    },
    stream: { type: 'boolean', default: false, description: '设为 true 时以 SSE 流式返回' },
    temperature: { type: 'number', description: '采样温度 0~2，默认 1' },
    top_p: { type: 'number', description: '核采样概率，默认 1' },
    max_tokens: { type: 'integer', description: '生成的最大 token 数' },
    stop: {
      description: '停止词：单个字符串或字符串数组',
      oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    },
    presence_penalty: { type: 'number', description: '话题新鲜度惩罚，-2~2' },
    frequency_penalty: { type: 'number', description: '频率惩罚，-2~2' },
    user: { type: 'string', description: '终端用户标识' },
    tools: { type: 'array', items: { $ref: '#/components/schemas/Tool' }, description: '可用的工具（函数）列表' },
    tool_choice: { description: '工具选择策略：string 或对象' },
    response_format: {
      type: 'object',
      description: '如 { "type": "json_object" } 或 { "type": "json_schema", "json_schema": {...} }',
    },
  },
  additionalProperties: true,
};

const CHAT_COMPLETION_RESPONSE: JsonSchema = {
  type: 'object',
  description: '与上游一致的 OpenAI Chat Completions 响应体（非流式）；stream=true 时为 SSE，每帧 data: {...}，结束帧 data: [DONE]',
  properties: {
    id: { type: 'string' },
    object: { type: 'string', enum: ['chat.completion'] },
    created: { type: 'integer' },
    model: { type: 'string' },
    choices: { type: 'array', items: { type: 'object' }, description: '生成结果列表' },
    usage: { $ref: '#/components/schemas/Usage' },
  },
};

const RESPONSES_REQUEST: JsonSchema = {
  type: 'object',
  required: ['model', 'input'],
  properties: {
    model: { type: 'string', description: '对外暴露的模型名' },
    input: {
      description: '提示内容：字符串或输入条目数组',
      oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'object' } }],
    },
    instructions: { type: 'string', description: '系统指令' },
    stream: { type: 'boolean', default: false, description: '设为 true 时以 SSE 流式返回' },
    max_output_tokens: { type: 'integer', description: '生成的最大 token 数' },
    temperature: { type: 'number' },
    top_p: { type: 'number' },
    tools: { type: 'array', items: { $ref: '#/components/schemas/Tool' }, description: '可用的工具（函数）列表' },
    tool_choice: { description: '工具选择策略' },
    store: { type: 'boolean', description: '是否在服务端存储本次会话' },
    previous_response_id: { type: 'string', description: '续接的上一轮响应 ID' },
    user: { type: 'string' },
  },
  additionalProperties: true,
};

const RESPONSES_RESPONSE: JsonSchema = {
  type: 'object',
  description: '与上游一致的 OpenAI Responses 响应体（非流式）；stream=true 时为 SSE',
  properties: {
    id: { type: 'string' },
    object: { type: 'string', enum: ['response'] },
    created_at: { type: 'integer' },
    model: { type: 'string' },
    output: { type: 'array', items: { type: 'object' }, description: '响应输出条目列表' },
    usage: { $ref: '#/components/schemas/Usage' },
  },
};

const MESSAGES_REQUEST: JsonSchema = {
  type: 'object',
  required: ['model', 'max_tokens', 'messages'],
  properties: {
    model: { type: 'string', description: '对外暴露的模型名' },
    max_tokens: { type: 'integer', description: '生成的最大 token 数（必填）' },
    messages: {
      type: 'array',
      items: { $ref: '#/components/schemas/AnthropicMessage' },
      description: '对话消息列表',
    },
    system: { type: 'string', description: '系统提示' },
    stream: { type: 'boolean', default: false, description: '设为 true 时以 SSE 流式返回' },
    temperature: { type: 'number', description: '采样温度 0~1' },
    top_p: { type: 'number' },
    top_k: { type: 'integer' },
    stop_sequences: { type: 'array', items: { type: 'string' } },
    tools: { type: 'array', items: { $ref: '#/components/schemas/Tool' }, description: '可用的工具（函数）列表' },
    tool_choice: { description: '工具选择策略' },
    metadata: { type: 'object', description: '用户自定义元数据' },
  },
  additionalProperties: true,
};

const MESSAGES_RESPONSE: JsonSchema = {
  type: 'object',
  description: '与上游一致的 Anthropic Messages 响应体（非流式）；stream=true 时为 SSE，结束帧 event: message_stop',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['message'] },
    role: { type: 'string', enum: ['assistant'] },
    model: { type: 'string' },
    content: { type: 'array', items: { type: 'object' }, description: '内容块列表' },
    stop_reason: { type: 'string', description: '停止原因（end_sequence / max_tokens / stop_sequence / tool_use）' },
    usage: { $ref: '#/components/schemas/Usage' },
  },
};

const ERROR_BODY: JsonSchema = {
  type: 'object',
  properties: {
    error: { type: 'string', description: '错误信息' },
    detail: { type: 'string', description: '错误详情（上游调用失败时）' },
  },
};

/* ---------------- 构造 OpenAPI 3.1 规格 ---------------- */

export function buildOpenApi(ctx: DocsContext): any {
  const authEnabled = ctx.hasTokens;
  const authNote = authEnabled
    ? '已配置访问令牌：客户端请求必须携带有效令牌，否则返回 401。'
    : '未配置访问令牌：代理开放访问，空 key 即可调用（如需鉴权请在「模型入口 → AccessToken」中创建令牌）。';

  const servers = [
    { url: `http://127.0.0.1:${ctx.port}`, description: '本机' },
    ...ctx.localIPs.map((ip) => ({ url: `http://${ip}:${ctx.port}`, description: '局域网' })),
  ];

  // 未配置令牌时放行空 key，security 置空以免误导客户端必须带鉴权
  const openaiSecurity = authEnabled ? [{ bearerAuth: [] }] : [];
  const anthropicSecurity = authEnabled ? [{ xApiKey: [] }] : [];

  return {
    openapi: '3.1.0',
    info: {
      title: 'LocalRouter API',
      description:
        'LocalRouter 对外 AI 接口定义。统一的 OpenAI / Anthropic 兼容代理入口：客户端以标准协议格式调用，网关按 body.model（对外模型名）路由到已配置的上游并记录日志与用量。',
      version: ctx.version,
    },
    servers,
    'x-models': ctx.models,
    'x-auth': {
      enabled: authEnabled,
      note: authNote,
      methods: [
        {
          name: 'Bearer Token',
          header: 'Authorization',
          value: 'Bearer <token>',
          appliesTo: ['/v1/chat/completions', '/v1/responses'],
        },
        {
          name: 'Anthropic API Key',
          header: 'x-api-key',
          value: '<token>',
          appliesTo: ['/v1/messages'],
          extra: 'anthropic-version: 2023-06-01',
        },
      ],
    },
    paths: {
      '/v1/chat/completions': {
        post: {
          operationId: 'createChatCompletion',
          summary: 'OpenAI Chat Completions（聊天补全）',
          description: `以 OpenAI 官方 Chat Completions 协议调用。网关将 body.model（对外模型名）替换为上游真实模型名后转发。${authNote}`,
          security: openaiSecurity,
          'x-curl': `curl ${servers[0].url}/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer <token>" \\\n  -d '{"model": "<对外模型名>", "messages": [{"role": "user", "content": "你好！"}]}'`,
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ChatCompletionRequest' } },
            },
          },
          responses: {
            '200': {
              description: '成功。非流式返回 OpenAI Chat Completions 响应对象；stream=true 时返回 SSE 流。',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ChatCompletionResponse' } },
                'text/event-stream': { schema: { type: 'string', description: 'SSE 数据流，每帧 data: {...}，结束帧 data: [DONE]' } },
              },
            },
            '400': {
              description: '请求体非法（invalid json body）或缺少 model',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
            },
            '401': {
              description: '令牌缺失或无效（仅在配置令牌后生效）',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
            },
            '404': {
              description: '未找到该对外模型名对应的入口',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
            },
            '502': {
              description: '上游调用失败或上游源不可用',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
            },
          },
        },
      },
      '/v1/responses': {
        post: {
          operationId: 'createResponse',
          summary: 'OpenAI Responses（通用响应）',
          description: `以 OpenAI 官方 Responses 协议调用。网关将 body.model（对外模型名）替换为上游真实模型名后转发。${authNote}`,
          security: openaiSecurity,
          'x-curl': `curl ${servers[0].url}/v1/responses \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer <token>" \\\n  -d '{"model": "<对外模型名>", "input": "你好！"}'`,
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ResponsesRequest' } },
            },
          },
          responses: {
            '200': {
              description: '成功。非流式返回 OpenAI Responses 响应对象；stream=true 时返回 SSE 流。',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ResponsesResponse' } },
                'text/event-stream': { schema: { type: 'string', description: 'SSE 数据流' } },
              },
            },
            '400': {
              description: '请求体非法或缺少 model',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
            },
            '401': {
              description: '令牌缺失或无效（仅在配置令牌后生效）',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
            },
            '404': {
              description: '未找到该对外模型名对应的入口',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
            },
            '502': {
              description: '上游调用失败或上游源不可用',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
            },
          },
        },
      },
      '/v1/messages': {
        post: {
          operationId: 'createMessage',
          summary: 'Anthropic Messages（消息生成）',
          description: `以 Anthropic 官方 Messages 协议调用（需额外携带 anthropic-version 请求头）。网关将 body.model（对外模型名）替换为上游真实模型名后转发。${authNote}`,
          security: anthropicSecurity,
          'x-curl': `curl ${servers[0].url}/v1/messages \\\n  -H "Content-Type: application/json" \\\n  -H "x-api-key: <token>" \\\n  -H "anthropic-version: 2023-06-01" \\\n  -d '{"model": "<对外模型名>", "max_tokens": 1024, "messages": [{"role": "user", "content": "你好！"}]}'`,
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/MessagesRequest' } },
            },
          },
          responses: {
            '200': {
              description: '成功。非流式返回 Anthropic Messages 响应对象；stream=true 时返回 SSE 流。',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/MessagesResponse' } },
                'text/event-stream': { schema: { type: 'string', description: 'SSE 数据流，结束帧 event: message_stop' } },
              },
            },
            '400': {
              description: '请求体非法或缺少必填字段',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
            },
            '401': {
              description: '令牌缺失或无效（仅在配置令牌后生效）',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
            },
            '404': {
              description: '未找到该对外模型名对应的入口',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
            },
            '502': {
              description: '上游调用失败或上游源不可用',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'OpenAI 兼容接口鉴权：Authorization: Bearer <token>',
        },
        xApiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'Anthropic 接口鉴权：x-api-key: <token>，另需 anthropic-version 请求头',
        },
      },
      schemas: {
        Message: MESSAGE,
        AnthropicMessage: ANTHROPIC_MESSAGE,
        Tool: TOOL,
        Usage: USAGE,
        ChatCompletionRequest: CHAT_COMPLETION_REQUEST,
        ChatCompletionResponse: CHAT_COMPLETION_RESPONSE,
        ResponsesRequest: RESPONSES_REQUEST,
        ResponsesResponse: RESPONSES_RESPONSE,
        MessagesRequest: MESSAGES_REQUEST,
        MessagesResponse: MESSAGES_RESPONSE,
        ErrorBody: ERROR_BODY,
      },
    },
  };
}

/* ---------------- 规格 → Markdown ---------------- */

function resolveRef(spec: any, ref: string): any {
  const prefix = '#/components/schemas/';
  if (ref.startsWith(prefix)) return spec.components?.schemas?.[ref.slice(prefix.length)];
  return null;
}

/** JSON Schema 属性 → 类型描述（string / number / Message / string[] 等） */
function propType(prop: any, spec: any): string {
  if (prop.$ref) return prop.$ref.split('/').pop() || 'object';
  if (prop.oneOf || prop.anyOf) {
    return (prop.oneOf || prop.anyOf).map((a: any) => propType(a, spec)).join(' 或 ');
  }
  if (prop.type === 'array') return `${propType(prop.items || {}, spec)}[]`;
  return prop.type || 'any';
}

/** 把 object 类型的 JSON Schema 渲染成 markdown 表格行 */
function schemaToTableRows(schema: any, spec: any): string[] {
  const resolved = schema.$ref ? resolveRef(spec, schema.$ref) : schema;
  if (!resolved || resolved.type !== 'object' || !resolved.properties) return [];
  const required = new Set(Array.isArray(resolved.required) ? resolved.required : []);
  const rows: string[] = [];
  for (const [name, prop] of Object.entries<any>(resolved.properties)) {
    const desc = String(prop.description ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    rows.push(`| \`${name}\` | ${propType(prop, spec)} | ${required.has(name) ? '是' : '否'} | ${desc} |`);
  }
  return rows;
}

export function openApiToMarkdown(spec: any): string {
  const L: string[] = [];
  // 每个参数独占一行；空字符串参数用作空行分隔
  const push = (...xs: Array<string | undefined | null>) => {
    for (const x of xs) {
      if (x === undefined || x === null) continue;
      L.push(x);
    }
  };

  push(`# ${spec.info.title}`, '');
  push(spec.info.description, '');
  push(`- **Base URL**：${spec.servers.map((s: any) => `\`${s.url}\``).join('、')}`);
  push(`- **版本**：${spec.info.version}`);
  if (Array.isArray(spec['x-models']) && spec['x-models'].length) {
    push(`- **当前可用对外模型**：${spec['x-models'].map((m: string) => `\`${m}\``).join('、')}`);
  }

  push('', '## 认证 Authentication', '');
  const auth = spec['x-auth'];
  if (auth) {
    push(auth.note, '');
    if (auth.enabled) {
      push('| 方式 | Header | 值 | 适用接口 |', '|------|--------|----|----------|');
      for (const m of auth.methods) {
        const extra = m.extra ? `（需额外携带 ${m.extra}）` : '';
        push(`| ${m.name} | \`${m.header}\` | \`${m.value}\` | ${m.appliesTo.map((p: string) => `\`${p}\``).join(', ')}${extra} |`);
      }
    }
  }

  push('', '## 接口列表 Endpoints', '');
  for (const [path, pathItem] of Object.entries<any>(spec.paths)) {
    for (const [method, op] of Object.entries<any>(pathItem)) {
      push(`### ${method.toUpperCase()} \`${path}\``, '');
      if (op.summary) push(`**${op.summary}**`, '');
      if (op.description) push(op.description, '');
      if (op['x-curl']) push('```bash', op['x-curl'], '```', '');

      const content = op.requestBody?.content?.['application/json'];
      if (content?.schema) {
        push('**请求体（application/json）：**', '', '| 字段 | 类型 | 必填 | 说明 |', '|------|------|------|------|');
        push(...schemaToTableRows(content.schema, spec));
        push('');
      }

      push('**响应：**', '');
      for (const [status, resp] of Object.entries<any>(op.responses || {})) {
        const cts = resp.content ? Object.keys(resp.content).join(', ') : '';
        push(`- \`${status}\` ${resp.description}${cts ? `（${cts}）` : ''}`);
      }
      push('');
    }
  }

  return L.join('\n');
}
