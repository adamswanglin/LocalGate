import { useEffect, useState } from 'react';
import { api, SyslogEntry } from '../lib/api.js';
import { Button, Card, Badge, SkeletonRow, EmptyState } from '../components/ui.js';
import { ShieldAlert, Trash2, RefreshCw } from 'lucide-react';
import { t, fmtDate } from '../lib/i18n.js';

export default function SystemLogsPage() {
  const [rows, setRows] = useState<SyslogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await api.systemLogs.list(500);
      setRows(r.rows);
    } catch {
      setRows([]);
    }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function clearAll() {
    if (!confirm(t('syslogs.confirmClear'))) return;
    await api.systemLogs.clear();
    load();
  }

  return (
    <div className="p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-stone-800 tracking-tight">{t('syslogs.title')}</h1>
          <p className="text-sm text-stone-500 mt-1">{t('syslogs.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => load()} title={t('syslogs.refresh')}><RefreshCw size={14} /> {t('syslogs.refresh')}</Button>
          <Button variant="danger" size="sm" onClick={clearAll}><Trash2 size={14} /> {t('syslogs.clear')}</Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs">
            <tr>
              <th className="text-left px-4 py-3 font-medium whitespace-nowrap">{t('syslogs.colTime')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('syslogs.colLevel')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('syslogs.colSource')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('syslogs.colMessage')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {loading && Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={4} />)}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={4}><EmptyState icon={<ShieldAlert size={24} />} title={t('syslogs.empty')} description={t('syslogs.emptyDesc')} /></td></tr>
            )}
            {rows.map((l) => (
              <tr key={l.id} className="hover:bg-stone-50 align-top transition-colors">
                <td className="px-4 py-3 text-stone-500 whitespace-nowrap text-xs">{fmtDate(l.ts)}</td>
                <td className="px-4 py-3">
                  {l.level === 'error' ? <Badge tone="red">error</Badge> : <Badge tone="amber">warn</Badge>}
                </td>
                <td className="px-4 py-3 text-stone-600 font-mono text-xs whitespace-nowrap">{l.source}</td>
                <td className="px-4 py-3">
                  <div className="text-stone-800 break-all">{l.message}</div>
                  {l.detail && <div className="text-stone-400 font-mono text-xs mt-1 break-all">{l.detail}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
