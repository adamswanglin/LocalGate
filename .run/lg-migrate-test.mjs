import Database from 'better-sqlite3';
import { initSchema } from '../dist/server/db/migrate.js';

const sqlite = new Database('/tmp/lg-migrate-test.db');
initSchema(sqlite);
const cols = sqlite.prepare('PRAGMA table_info(t_proxy_channels)').all();
console.log('columns:', cols.map((c) => c.name).join(', '));
console.log('channels:', sqlite.prepare('SELECT id, protocol, exposed_model, source_id, upstream_model FROM t_proxy_channels').all().length);
console.log('bindings:', sqlite.prepare('SELECT count(*) c FROM t_proxy_channel_sources').get().c);
console.log('call_logs sample channel_name:', JSON.stringify(sqlite.prepare('SELECT channel_name FROM t_proxy_call_logs LIMIT 3').all()));
sqlite.close();
console.log('MIGRATION-OK');
