import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { initSchema } from './migrate.js';

// SQLite 数据库文件路径（默认 .run/agent-proxy.db）
const dbPath = resolve(process.env.DB_PATH || '.run/agent-proxy.db');

// 确保目录存在
mkdirSync(dirname(dbPath), { recursive: true });

export const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// 启动期建表 + 种子数据（幂等）
initSchema(sqlite);

export const db = drizzle(sqlite, { schema });
export { schema };
export default db;
