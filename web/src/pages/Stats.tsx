import { useEffect, useState } from 'react';
import { api, Source, Channel, StatsResult, StatRow, StackedStatsResult } from '../lib/api.js';
import { Select, Card, SkeletonRow, EmptyState } from '../components/ui.js';
import { LineChart, BarChart, StackedBarChart, COLORS } from '../components/chart.js';
import { BarChart3, ArrowDownToLine, ArrowUpFromLine, Hash, Database, Calendar, Filter, Coins } from 'lucide-react';
import { t, fmtMoney } from '../lib/i18n.js';

const GROUPS = [
  { v: 'day', key: 'stats.groups.day' },
  { v: 'month', key: 'stats.groups.month' },
  { v: 'source', key: 'stats.groups.source' },
  { v: 'channel', key: 'stats.groups.channel' },
  { v: 'model', key: 'stats.groups.model' },
];

export default function StatsPage() {
  const [data, setData] = useState<StatsResult | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({
    groupBy: 'day',
    dateFrom: '',
    dateTo: '',
    sourceId: '',
    channelId: '',
    model: '',
    protocol: '',
  });

  useEffect(() => {
    api.sources.list().then(setSources).catch(() => {});
    api.channels.list().then(setChannels).catch(() => {});
  }, []);

  async function load() {
    setLoading(true);
    const params: Record<string, string> = { groupBy: f.groupBy };
    if (f.dateFrom) params.dateFrom = f.dateFrom;
    if (f.dateTo) params.dateTo = f.dateTo;
    if (f.sourceId) params.sourceId = f.sourceId;
    if (f.channelId) params.channelId = f.channelId;
    if (f.model) params.model = f.model;
    if (f.protocol) params.protocol = f.protocol;
    try {
      const r = await api.stats.list(params);
      setData(r);
    } catch { setData(null); }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [JSON.stringify(f)]);

  const isTime = f.groupBy === 'day' || f.groupBy === 'month';
  const rows = data?.rows ?? [];
  const totals = data?.totals ?? { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, cost: 0, calls: 0 };

  // 图表数据：输入(非缓存) / 缓存输入 / 输出
  const labels = rows.map((r) => String(r.key ?? '-'));
  const series = [
    { key: 'input', label: t('stats.seriesInput'), color: COLORS[0], values: rows.map((r) => r.inputTokens) },
    { key: 'cached', label: t('stats.seriesCached'), color: COLORS[1], values: rows.map((r) => r.cachedInputTokens) },
    { key: 'output', label: t('stats.seriesOutput'), color: COLORS[2], values: rows.map((r) => r.outputTokens) },
  ];

  function fmtDateLabel(v: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.slice(5); // MM-DD
    return v;
  }

  return (
    <div className="p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 tracking-tight">{t('stats.title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('stats.subtitle')}</p>
        </div>
      </div>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <StatCardEnhanced
          label={t('stats.statInput')}
          value={loading ? '-' : totals.inputTokens}
          icon={<ArrowDownToLine size={18} />}
          accent="#6366f1"
          total={loading ? 0 : totals.inputTokens + totals.cachedInputTokens + totals.outputTokens}
        />
        <StatCardEnhanced
          label={t('stats.statCached')}
          value={loading ? '-' : totals.cachedInputTokens}
          icon={<Database size={18} />}
          accent="#10b981"
          total={loading ? 0 : totals.inputTokens + totals.cachedInputTokens + totals.outputTokens}
        />
        <StatCardEnhanced
          label={t('stats.statOutput')}
          value={loading ? '-' : totals.outputTokens}
          icon={<ArrowUpFromLine size={18} />}
          accent="#f59e0b"
          total={loading ? 0 : totals.inputTokens + totals.cachedInputTokens + totals.outputTokens}
        />
        <StatCardEnhanced
          label={t('stats.statCalls')}
          value={loading ? '-' : totals.calls}
          icon={<Hash size={18} />}
          accent="#64748b"
          total={loading ? 0 : totals.calls}
          isCalls
        />
        <StatCardEnhanced
          label={t('stats.statCost')}
          value={loading ? '-' : totals.cost}
          icon={<Coins size={18} />}
          accent="#8b5cf6"
          total={loading ? 0 : totals.cost}
          money
        />
      </div>

      {/* 筛选 */}
      <Card className="p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={14} className="text-slate-400" />
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">{t('stats.filterTitle')}</span>
        </div>
        
        {/* 分组切换 - 分段控件 */}
        <div className="mb-4">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 gap-1">
            {GROUPS.map((g) => (
              <button
                key={g.v}
                onClick={() => setF({ ...f, groupBy: g.v })}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  f.groupBy === g.v
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t(g.key)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('stats.filterProtocol')}</label>
            <Select value={f.protocol} onChange={(e) => setF({ ...f, protocol: e.target.value })} className="w-full">
              <option value="">{t('stats.filterAllProtocols')}</option>
              <option value="openai_chat">openai_chat</option>
              <option value="openai_response">openai_response</option>
              <option value="anthropic">anthropic</option>
            </Select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('stats.filterSource')}</label>
            <Select value={f.sourceId} onChange={(e) => setF({ ...f, sourceId: e.target.value })} className="w-full">
              <option value="">{t('stats.filterAllSources')}</option>
              {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('stats.filterChannel')}</label>
            <Select value={f.channelId} onChange={(e) => setF({ ...f, channelId: e.target.value })} className="w-full">
              <option value="">{t('stats.filterAllChannels')}</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.exposedModel}</option>)}
            </Select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('stats.filterModel')}</label>
            <input placeholder={t('stats.filterModelPlaceholder')} value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })}
              className="w-full rounded-lg bg-white border border-slate-200 px-2.5 py-2 text-xs text-slate-700 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('stats.filterStart')}</label>
            <input type="date" value={f.dateFrom} onChange={(e) => setF({ ...f, dateFrom: e.target.value })}
              className="w-full rounded-lg bg-white border border-slate-200 px-2.5 py-2 text-xs text-slate-700 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('stats.filterEnd')}</label>
            <input type="date" value={f.dateTo} onChange={(e) => setF({ ...f, dateTo: e.target.value })}
              className="w-full rounded-lg bg-white border border-slate-200 px-2.5 py-2 text-xs text-slate-700 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
          </div>
        </div>
      </Card>

      {/* 图表 */}
      <Card className="p-5 mb-6">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-brand-50">
              <BarChart3 size={16} className="text-brand-600" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-800">{isTime ? t('stats.chartTrend') : t('stats.chartCompare')}</div>
              <div className="text-xs text-slate-500">{isTime ? t('stats.chartTrendDesc') : t('stats.chartCompareDesc')}</div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                <span className="text-slate-600">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="h-[280px] flex items-center justify-center text-slate-300 text-sm">{t('common.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="h-[280px] flex items-center justify-center">
            <EmptyState icon={<BarChart3 size={24} />} title={t('stats.empty')} description={t('stats.emptyDesc')} />
          </div>
        ) : isTime ? (
          <LineChart labels={labels.map(fmtDateLabel)} series={series} height={280} />
        ) : (
          <BarChart labels={rows.map((r) => r.label)} series={series} height={280} />
        )}
      </Card>

      {/* 表格 */}
      <Card className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar size={15} className="text-slate-400" />
              <span className="text-sm font-semibold text-slate-700">{t('stats.tableTitle')}</span>
            </div>
            <span className="text-xs text-slate-500">{t('stats.tableCount', { rows: rows.length })}</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">{t(GROUPS.find((g) => g.v === f.groupBy)?.key ?? 'stats.tableGroup')}</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">{t('stats.tableInput')}</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">{t('stats.tableCached')}</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">{t('stats.tableOutput')}</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">{t('stats.tableCalls')}</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">{t('stats.tableCost')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={6} />)}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6}><EmptyState icon={<BarChart3 size={24} />} title={t('stats.empty')} description="" /></td></tr>
              )}
              {!loading && rows.map((r: StatRow, i) => {
                const maxInput = Math.max(1, ...rows.map((row) => row.inputTokens));
                const maxCached = Math.max(1, ...rows.map((row) => row.cachedInputTokens));
                const maxOutput = Math.max(1, ...rows.map((row) => row.outputTokens));
                const maxCalls = Math.max(1, ...rows.map((row) => row.calls));
                const maxCost = Math.max(1e-6, ...rows.map((row) => row.cost || 0));
                return (
                  <tr key={i} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="px-5 py-3.5">
                      <div className="text-sm font-medium text-slate-800">{r.label}</div>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${(r.inputTokens / maxInput) * 100}%`, backgroundColor: '#6366f1' }} />
                        </div>
                        <span className="text-sm text-slate-700 tabular-nums font-medium min-w-[60px]">{r.inputTokens.toLocaleString()}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${(r.cachedInputTokens / maxCached) * 100}%`, backgroundColor: '#10b981' }} />
                        </div>
                        <span className="text-sm text-slate-700 tabular-nums font-medium min-w-[60px]">{r.cachedInputTokens.toLocaleString()}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${(r.outputTokens / maxOutput) * 100}%`, backgroundColor: '#f59e0b' }} />
                        </div>
                        <span className="text-sm text-slate-700 tabular-nums font-medium min-w-[60px]">{r.outputTokens.toLocaleString()}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${(r.calls / maxCalls) * 100}%`, backgroundColor: '#64748b' }} />
                        </div>
                        <span className="text-sm text-slate-700 tabular-nums font-medium min-w-[60px]">{r.calls.toLocaleString()}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${((r.cost || 0) / maxCost) * 100}%`, backgroundColor: '#8b5cf6' }} />
                        </div>
                        <span className="text-sm text-violet-600 tabular-nums font-medium min-w-[70px]">{fmtMoney(r.cost || 0)}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {!loading && rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-gradient-to-r from-slate-50 to-white">
                  <td className="px-5 py-3.5 text-sm font-bold text-slate-800">{t('stats.total')}</td>
                  <td className="px-5 py-3.5 text-right text-sm font-bold text-indigo-600 tabular-nums">{totals.inputTokens.toLocaleString()}</td>
                  <td className="px-5 py-3.5 text-right text-sm font-bold text-emerald-600 tabular-nums">{totals.cachedInputTokens.toLocaleString()}</td>
                  <td className="px-5 py-3.5 text-right text-sm font-bold text-amber-600 tabular-nums">{totals.outputTokens.toLocaleString()}</td>
                  <td className="px-5 py-3.5 text-right text-sm font-bold text-slate-700 tabular-nums">{totals.calls.toLocaleString()}</td>
                  <td className="px-5 py-3.5 text-right text-sm font-bold text-violet-600 tabular-nums">{fmtMoney(totals.cost || 0)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {/* 堆叠分析 */}
      <StackedPanel sources={sources} sharedDateFrom={f.dateFrom} sharedDateTo={f.dateTo} sharedSourceId={f.sourceId} />
    </div>
  );
}

/* ---------------- 增强版 StatCard ---------------- */

function StatCardEnhanced({
  label,
  value,
  icon,
  accent,
  total,
  isCalls = false,
  money = false,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent: string;
  total: number;
  isCalls?: boolean;
  money?: boolean;
}) {
  const numValue = typeof value === 'number' ? value : 0;
  const percentage = !isCalls && !money && total > 0 ? (numValue / total) * 100 : 0;
  
  return (
    <div className="relative rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow">
      {/* 顶部色条 */}
      <div className="h-1 w-full" style={{ backgroundColor: accent }} />
      
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg" style={{ backgroundColor: `${accent}15` }}>
            <div style={{ color: accent }}>{icon}</div>
          </div>
          {!isCalls && percentage > 0 && (
            <div className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `${accent}15`, color: accent }}>
              {percentage.toFixed(1)}%
            </div>
          )}
        </div>
        
        <div className="text-2xl font-bold text-slate-800 tracking-tight mb-1">
          {money ? fmtMoney(numValue) : (typeof value === 'number' ? value.toLocaleString() : value)}
        </div>
        <div className="text-xs text-slate-500 leading-tight">{label}</div>

        {/* 占比指示条 */}
        {!isCalls && !money && percentage > 0 && (
          <div className="mt-3 h-1 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${percentage}%`, backgroundColor: accent }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- 堆叠柱状图分析 ---------------- */

const STACK_DIMS = [
  { v: 'source_daily', key: 'stats.stackDim1' },
  { v: 'source_model', key: 'stats.stackDim2' },
  { v: 'channel_model', key: 'stats.stackDim3' },
  { v: 'single_source_model', key: 'stats.stackDim4' },
];

function StackedPanel({
  sources, sharedDateFrom, sharedDateTo, sharedSourceId,
}: {
  sources: Source[];
  sharedDateFrom: string;
  sharedDateTo: string;
  sharedSourceId: string;
}) {
  const [data, setData] = useState<StackedStatsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [dim, setDim] = useState('source_daily');
  const [metric, setMetric] = useState<'tokens' | 'calls' | 'cost'>('tokens');
  const [sourceId, setSourceId] = useState('');

  // 单上游维度默认沿用主页选中的 sourceId
  useEffect(() => {
    if (dim === 'single_source_model' && !sourceId && sharedSourceId) setSourceId(sharedSourceId);
  }, [dim, sourceId, sharedSourceId]);

  async function load() {
    setLoading(true);
    const params: Record<string, string> = { dim, metric };
    if (sharedDateFrom) params.dateFrom = sharedDateFrom;
    if (sharedDateTo) params.dateTo = sharedDateTo;
    const sid = dim === 'single_source_model' ? sourceId : (sharedSourceId || sourceId);
    if (sid) params.sourceId = sid;
    try { setData(await api.stats.stacked(params)); } catch { setData(null); }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dim, metric, sourceId, sharedDateFrom, sharedDateTo, sharedSourceId]);

  const labels = data?.labels ?? [];
  const stacks = data?.stacks ?? [];
  const needSource = dim === 'single_source_model';

  return (
    <Card className="mt-6 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r from-brand-50/50 to-white">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 mr-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-brand-50">
              <BarChart3 size={16} className="text-brand-600" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-800">{t('stats.stackTitle')}</div>
              <div className="text-xs text-slate-500">{t('stats.stackDesc')}</div>
            </div>
          </div>
          <Select value={dim} onChange={(e) => setDim(e.target.value)} className="w-64">
            {STACK_DIMS.map((d) => <option key={d.v} value={d.v}>{t(d.key)}</option>)}
          </Select>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 gap-0.5">
            <button
              onClick={() => setMetric('tokens')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                metric === 'tokens' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t('stats.stackToken')}
            </button>
            <button
              onClick={() => setMetric('calls')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                metric === 'calls' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t('stats.stackCalls')}
            </button>
            <button
              onClick={() => setMetric('cost')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                metric === 'cost' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t('stats.stackCost')}
            </button>
          </div>
          {needSource && (
            <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="w-44">
              <option value="">{t('stats.stackPickSource')}</option>
              {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
        </div>
      </div>
      <div className="p-5">
        {loading ? (
          <div className="h-[320px] flex items-center justify-center text-slate-300 text-sm">{t('common.loading')}</div>
        ) : needSource && !sourceId ? (
          <div className="h-[320px] flex items-center justify-center">
            <EmptyState icon={<BarChart3 size={24} />} title={t('stats.stackPickSource')} description={t('stats.stackPickSourceDesc')} />
          </div>
        ) : labels.length === 0 ? (
          <div className="h-[320px] flex items-center justify-center">
            <EmptyState icon={<BarChart3 size={24} />} title={t('stats.empty')} description={t('stats.emptyDesc')} />
          </div>
        ) : (
          <StackedBarChart labels={labels} series={stacks} height={320} />
        )}
      </div>
    </Card>
  );
}

