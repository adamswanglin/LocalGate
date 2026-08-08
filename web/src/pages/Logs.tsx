import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, LogRow, Settings } from '../lib/api.js';
import { Button, Input, Select, Badge, Card, StatCard, SkeletonRow, EmptyState, Toggle } from '../components/ui.js';
import { Trash2, ChevronLeft, ChevronRight, Tag as TagIcon, X, Filter, ScrollText, Clock, Zap, Settings as Cog, Star } from 'lucide-react';
import { t, fmtDate } from '../lib/i18n.js';

const PAGE = 25;

export default function LogsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [f, setF] = useState({ protocol: '', status: '', channelId: '', tags: [] as string[], starred: false, dateFrom: '', dateTo: '' });
  const [allTags, setAllTags] = useState<{ name: string; count: number }[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [savingSetting, setSavingSetting] = useState(false);

  useEffect(() => { api.settings.get().then(setSettings).catch(() => {}); }, []);
  async function toggleSetting(key: 'logIo' | 'logStreamBody', v: boolean) {
    setSavingSetting(true);
    try {
      const updated = await api.settings.update({ [key]: v });
      setSettings(updated);
    } catch (e: any) { alert(e.message || t('logs.alertSaveFailed')); }
    setSavingSetting(false);
  }

  async function load() {
    setLoading(true);
    const params: any = { limit: PAGE, offset };
    if (f.protocol) params.protocol = f.protocol;
    if (f.status) params.status = f.status;
    if (f.channelId) params.channelId = f.channelId;
    if (f.tags.length) params.tags = f.tags.join(',');
    if (f.starred) params.starred = 1;
    if (f.dateFrom) params.dateFrom = f.dateFrom;
    if (f.dateTo) params.dateTo = f.dateTo;
    const r = await api.logs.list(params);
    setRows(r.rows); setTotal(r.total); setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [offset]);
  const filterKey = `${f.protocol}|${f.status}|${f.channelId}|${f.tags.join(',')}|${f.starred}|${f.dateFrom}|${f.dateTo}`;
  useEffect(() => { setOffset(0); load(); /* eslint-disable-next-line */ }, [filterKey]);
  useEffect(() => { api.logs.tags().then(setAllTags).catch(() => {}); }, [total]);

  function toggleTag(t: string) {
    setF((prev) => ({ ...prev, tags: prev.tags.includes(t) ? prev.tags.filter((x) => x !== t) : [...prev.tags, t] }));
  }

  const hasFilter = f.protocol || f.status || f.channelId || f.tags.length || f.starred || f.dateFrom || f.dateTo;
  async function clearAll() {
    if (!confirm(t('logs.confirmClear'))) return;
    await api.logs.clear(); load();
  }
  async function toggleStar(l: LogRow, e: React.MouseEvent) {
    e.stopPropagation();
    const next = !l.starred;
    setRows((prev) => prev.map((r) => (r.id === l.id ? { ...r, starred: next } : r)));
    try { await api.logs.setStar(l.id, next); }
    catch (e: any) { setRows((prev) => prev.map((r) => (r.id === l.id ? { ...r, starred: !next } : r))); alert(e.message || t('logs.alertStarFailed')); }
  }

  const avgLatency = rows.length > 0
    ? Math.round(rows.reduce((sum, r) => sum + (r.latencyMs ?? 0), 0) / rows.filter((r) => r.latencyMs != null).length || 1)
    : 0;
  const errorCount = rows.filter((r) => r.statusCode != null && r.statusCode >= 400).length;

  return (
    <div className="p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 tracking-tight">{t('logs.title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('logs.total', { total })}</p>
        </div>
        <Button variant="danger" size="sm" onClick={clearAll}><Trash2 size={14} /> {t('logs.clear')}</Button>
      </div>

      {/* 全局日志配置 */}
      <Card className="flex items-center gap-6 px-4 py-3 mb-6">
        <div className="flex items-center gap-2 text-slate-500"><Cog size={15} /><span className="text-xs font-medium uppercase tracking-wider">{t('logs.globalConfig')}</span></div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <Toggle disabled={!settings || savingSetting} checked={!!settings?.logIo} onChange={(v) => toggleSetting('logIo', v)} /> {t('logs.logIo')}
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <Toggle disabled={!settings || savingSetting} checked={!!settings?.logStreamBody} onChange={(v) => toggleSetting('logStreamBody', v)} /> {t('logs.logStreamBody')}
        </label>
        {!settings && <span className="text-xs text-slate-400">{t('common.loading')}</span>}
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label={t('logs.statTotal')} value={total} icon={<ScrollText size={20} />} accent="brand" />
        <StatCard label={t('logs.statAvgLatency')} value={loading ? '-' : `${avgLatency}ms`} icon={<Clock size={20} />} accent="amber" />
        <StatCard label={t('logs.statErrors')} value={loading ? '-' : errorCount} icon={<Zap size={20} />} accent={errorCount > 0 ? 'amber' : 'green'} />
        <StatCard label={t('logs.statPage')} value={rows.length} icon={<ScrollText size={20} />} accent="slate" />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Select value={f.protocol} onChange={(e) => setF({ ...f, protocol: e.target.value })} className="w-44">
          <option value="">{t('logs.filterProtocol')}</option>
          <option value="openai_chat">openai_chat</option>
          <option value="openai_response">openai_response</option>
          <option value="anthropic">anthropic</option>
        </Select>
        <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className="w-40">
          <option value="">{t('logs.filterStatus')}</option>
          <option value="ok">{t('logs.filterOk')}</option>
          <option value="error">{t('logs.filterError')}</option>
        </Select>
        <Input placeholder="Channel ID" value={f.channelId} onChange={(e) => setF({ ...f, channelId: e.target.value })} className="w-36" />
        <button
          onClick={() => setF({ ...f, starred: !f.starred })}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs transition-colors cursor-pointer ${
            f.starred ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-800'
          }`}
        >
          <Star size={13} className={f.starred ? 'fill-amber-400 text-amber-500' : ''} /> {t('logs.filterStarred')}
        </button>
        <TagFilterPicker allTags={allTags} selected={f.tags} onToggle={toggleTag} onClear={() => setF({ ...f, tags: [] })} />
        <div className="flex items-center gap-1.5">
          <input type="datetime-local" value={f.dateFrom} onChange={(e) => setF({ ...f, dateFrom: e.target.value })}
            className="rounded-lg bg-white border border-slate-200 px-2.5 py-2 text-xs text-slate-700 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
          <span className="text-slate-400 text-xs">~</span>
          <input type="datetime-local" value={f.dateTo} onChange={(e) => setF({ ...f, dateTo: e.target.value })}
            className="rounded-lg bg-white border border-slate-200 px-2.5 py-2 text-xs text-slate-700 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
        </div>
        {hasFilter && (
          <Button size="sm" variant="ghost" onClick={() => setF({ protocol: '', status: '', channelId: '', tags: [], starred: false, dateFrom: '', dateTo: '' })}>
            <X size={13} /> {t('logs.clearFilters')}
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{t('logs.colTime')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('logs.colStar')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('logs.colChannel')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('logs.colProtocol')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('logs.colModel')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('logs.colTags')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('logs.colStream')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('logs.colStatus')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('logs.colLatency')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('logs.colTokens')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={10} />)}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={10}><EmptyState icon={<ScrollText size={24} />} title={t('logs.empty')} description={t('logs.emptyDesc')} /></td></tr>
            )}
            {rows.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => navigate(`/logs/${l.id}`)}>
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">{fmtDate(l.createdAt)}</td>
                <td className="px-4 py-3">
                  <button onClick={(e) => toggleStar(l, e)} title={l.starred ? t('logs.starOn') : t('logs.starOff')}
                    className={`cursor-pointer transition-colors ${l.starred ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`}>
                    <Star size={15} className={l.starred ? 'fill-amber-400' : ''} />
                  </button>
                </td>
                <td className="px-4 py-3 text-slate-700 font-medium">{l.channelName || `#${l.channelId}`}</td>
                <td className="px-4 py-3"><Badge tone="indigo">{l.protocol}</Badge></td>
                <td className="px-4 py-3 text-slate-500 font-mono text-xs">{l.model || '-'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1 max-w-[14rem]">
                    {(l.tags || []).map((t) => (
                      <span key={t} className="inline-flex items-center gap-0.5 rounded-md bg-slate-100 text-slate-600 px-1.5 py-0.5 text-[10px]">
                        <TagIcon size={9} />{t}
                      </span>
                    ))}
                    {(!l.tags || l.tags.length === 0) && <span className="text-slate-300 text-xs">-</span>}
                  </div>
                </td>
                <td className="px-4 py-3">{l.isStream ? <Badge tone="amber">stream</Badge> : <span className="text-slate-300 text-xs">-</span>}</td>
                <td className="px-4 py-3">
                  {l.aborted ? <Badge tone="amber">aborted</Badge>
                    : l.statusCode == null ? <Badge tone="slate">-</Badge>
                    : l.statusCode < 400 ? <Badge tone="green">{l.statusCode}</Badge>
                    : <Badge tone="red">{l.statusCode}</Badge>}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs tabular-nums">{l.latencyMs != null ? `${l.latencyMs}ms` : '-'}</td>
                <td className="px-4 py-3 text-slate-500 text-xs tabular-nums">{tok(l)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center justify-between mt-4">
        <span className="text-xs text-slate-400 tabular-nums">{total ? `${offset + 1}–${Math.min(offset + PAGE, total)}` : '0'} / {total}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}><ChevronLeft size={14} /> {t('logs.prev')}</Button>
          <Button size="sm" variant="ghost" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>{t('logs.next')} <ChevronRight size={14} /></Button>
        </div>
      </div>
    </div>
  );
}

function TagFilterPicker({
  allTags, selected, onToggle, onClear,
}: {
  allTags: { name: string; count: number }[];
  selected: string[];
  onToggle: (t: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs transition-colors cursor-pointer ${
          selected.length ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-800'
        }`}
      >
        <Filter size={13} /> {t('logs.tagsLabel')} {selected.length > 0 && <span className="rounded-md bg-brand-600 px-1.5 text-[10px] text-white">{selected.length}</span>}
      </button>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {selected.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-md bg-brand-100 text-brand-700 px-1.5 py-0.5 text-[11px]">
              {t}
              <button onClick={(e) => { e.stopPropagation(); onToggle(t); }} className="hover:text-brand-900 cursor-pointer"><X size={10} /></button>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div className="absolute z-30 mt-1 w-56 rounded-xl border border-slate-200 bg-white shadow-lg p-2 animate-scale-in">
          <div className="flex items-center justify-between px-1 pb-1.5">
            <span className="text-[11px] text-slate-400">{t('logs.tagsPick')}</span>
            {selected.length > 0 && <button onClick={onClear} className="text-[11px] text-slate-500 hover:text-slate-700 cursor-pointer">{t('logs.tagsClear')}</button>}
          </div>
          <div className="max-h-60 overflow-auto">
            {allTags.length === 0 && <div className="px-2 py-3 text-xs text-slate-400 text-center">{t('logs.tagsNone')}</div>}
            {allTags.map((t) => {
              const active = selected.includes(t.name);
              return (
                <button key={t.name} onClick={() => onToggle(t.name)}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors cursor-pointer ${
                    active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'
                  }`}>
                  <span className="inline-flex items-center gap-1.5"><TagIcon size={11} /> {t.name}</span>
                  <span className="text-[10px] text-slate-400">{t.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function tok(l: LogRow) {
  const inT = l.inputTokens ?? 0;
  const cached = l.cachedInputTokens ?? 0;
  const outT = l.outputTokens ?? 0;
  if (!inT && !cached && !outT) {
    // 回退到原始 usage
    const u = l.usage;
    if (!u) return '-';
    const t = u.total_tokens ?? (u.input_tokens ?? u.prompt_tokens) ?? null;
    return t != null ? String(t) : '-';
  }
  return `${inT + cached}/${outT}`;
}
