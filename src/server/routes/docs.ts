import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { buildOpenApi, openApiToMarkdown } from '../lib/openapi.js';

const docs = new Hono();

// 读一次包版本（打包态与开发态都从项目根 package.json 解析）
let pkgVersion = '';
try {
  pkgVersion = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as { version?: string }).version || '';
} catch {
  pkgVersion = '';
}

function getLocalIPs(): string[] {
  const ips: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
    }
  }
  return [...new Set(ips)];
}

/** 收集生成 OpenAPI 所需上下文（端口 / 局域网 IP / 令牌 / 已启用对外模型） */
async function buildDocsSpec() {
  const [tokens] = await db
    .select({ n: schema.tokens.id })
    .from(schema.tokens)
    .where(eq(schema.tokens.enabled, 1));
  const modelRows = await db
    .select({ m: schema.channels.exposedModel })
    .from(schema.channels)
    .where(eq(schema.channels.enabled, 1));
  const models = [...new Set(modelRows.map((r) => r.m).filter((m): m is string => !!m))];

  return buildOpenApi({
    port: Number(process.env.PORT || 8787),
    localIPs: getLocalIPs(),
    hasTokens: !!tokens,
    models,
    version: pkgVersion || '1.1.2',
  });
}

// OpenAPI 3.1 JSON（机器可读，供 Swagger 工具 / AI 直接消费）
docs.get('/openapi.json', async (c) => {
  const spec = await buildDocsSpec();
  return c.json(spec);
});

// 同一个规格的 Markdown 文档（供 AI 直接抓取 / 复制）
docs.get('/openapi.md', async (c) => {
  const spec = await buildDocsSpec();
  return c.text(openApiToMarkdown(spec), 200, { 'content-type': 'text/markdown; charset=utf-8' });
});

export default docs;
