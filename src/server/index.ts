import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import proxy from './routes/proxy.js';
import admin from './routes/admin.js';
import { startLogRetention } from './lib/log-retention.js';

const app = new Hono();
const __dirname = dirname(fileURLToPath(import.meta.url));
const webDist = join(__dirname, '../../web/dist');

app.get('/health', (c) => c.json({ ok: true }));

// 代理路由（最高优先级）
app.route('/', proxy);
// 管理 API
app.route('/', admin);

// 静态资源（绝对路径，保证打包态 cwd 不确定时仍可解析）
app.use('/assets/*', serveStatic({ root: webDist }));
app.use('/favicon.ico', serveStatic({ root: webDist }));

// SPA fallback：非 API/非 v1 路径返回 index.html
app.get('*', (c) => {
  const indexPath = join(webDist, 'index.html');
  if (existsSync(indexPath)) {
    const html = readFileSync(indexPath, 'utf-8');
    return c.html(html);
  }
  return c.json({
    name: 'localgate',
    note: 'web UI not built. run `pnpm dev:web` to develop, or `pnpm build:web` then restart.',
    endpoints: ['/v1/chat/completions', '/v1/responses', '/v1/messages', '/api/*'],
  });
});

const port = Number(process.env.PORT || 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`LocalGate listening on http://localhost:${info.port}`);
});

// 启动日志容量保留：定期把非收藏日志总量收敛到 1W 以内
startLogRetention();
