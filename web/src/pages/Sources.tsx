import { useEffect, useState } from 'react';
import { api, Source } from '../lib/api.js';
import { Button, Input, Select, Label, Toggle, Badge, Card, Modal, StatCard, SkeletonRow, EmptyState } from '../components/ui.js';
import { Plus, Pencil, Trash2, Zap, Check, X, Server } from 'lucide-react';
import { t } from '../lib/i18n.js';

const PROVIDERS = [
  { v: 'openai_chat', key: 'protocol.chat' },
  { v: 'openai_response', key: 'protocol.response' },
  { v: 'anthropic', key: 'protocol.anthropic' },
];

type ModelRow = { model: string; inputPrice: string; cachedInputPrice: string; outputPrice: string };
type EndpointRow = { protocol: string; baseUrl: string };
type TestResult = { protocol: string; ok: boolean; msg: string };

const empty: any = {
  name: '',
  apiKey: '',
  enabled: true,
  models: [] as ModelRow[],
  endpoints: [{ protocol: 'openai_chat', baseUrl: '' }] as EndpointRow[],
};

export default function SourcesPage() {
  const [rows, setRows] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty);
  const [editId, setEditId] = useState<number | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<Record<number, TestResult[]>>({});

  async function load() {
    setLoading(true);
    setRows(await api.sources.list());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function startCreate() { setForm({ ...empty, models: [], endpoints: [{ protocol: 'openai_chat', baseUrl: '' }] }); setEditId(null); setOpen(true); }
  function startEdit(s: Source) {
    setForm({
      ...s,
      models: (s.models || []).map((m) => ({
        model: m.model,
        inputPrice: m.inputPrice != null ? String(m.inputPrice) : '',
        cachedInputPrice: m.cachedInputPrice != null ? String(m.cachedInputPrice) : '',
        outputPrice: m.outputPrice != null ? String(m.outputPrice) : '',
      })),
      endpoints: (s.endpoints || []).map((e) => ({ protocol: e.protocol, baseUrl: e.baseUrl })),
    });
    setEditId(s.id); setOpen(true);
  }

  async function save() {
    if (!form.name || !form.apiKey) { alert(t('sources.alertNameKey')); return; }
    if (!form.endpoints.length || (form.endpoints as EndpointRow[]).some((e) => !e.protocol || !e.baseUrl.trim())) {
      alert(t('sources.alertEndpoint')); return;
    }
    const payload = {
      name: form.name, apiKey: form.apiKey, enabled: form.enabled,
      endpoints: form.endpoints.map((e: EndpointRow) => ({ protocol: e.protocol, baseUrl: e.baseUrl.trim() })),
      models: form.models.map((m: ModelRow) => ({
        model: m.model,
        inputPrice: toNumOrNull(m.inputPrice),
        cachedInputPrice: toNumOrNull(m.cachedInputPrice),
        outputPrice: toNumOrNull(m.outputPrice),
      })),
    };
    try {
      if (editId) await api.sources.update(editId, payload);
      else await api.sources.create(payload);
    } catch (e: any) { alert(e.message || t('common.saveFailed')); return; }
    setOpen(false);
    load();
  }

  async function remove(id: number) {
    if (!confirm(t('sources.confirmDelete'))) return;
    try { await api.sources.remove(id); load(); }
    catch (e: any) { alert(e.message); }
  }

  async function test(id: number) {
    const src = rows.find((s) => s.id === id);
    const model = window.prompt(t('sources.testPrompt'), 'doubao-seed-2.0-code');
    if (!model || !src) return;
    setTesting(id);
    const results: TestResult[] = [];
    for (const ep of src.endpoints) {
      try {
        const r = await api.sources.test(id, model.trim(), ep.protocol);
        const sample = r.sample ? ` ${r.sample.slice(0, 80)}` : '';
        results.push({
          protocol: ep.protocol,
          ok: r.ok,
          msg: r.ok ? t('sources.testSuccess', { status: String(r.status) }) : (r.error || `HTTP ${r.status}${sample}`),
        });
      } catch (e: any) {
        results.push({ protocol: ep.protocol, ok: false, msg: e.message });
      }
    }
    setTestResult((p) => ({ ...p, [id]: results }));
    setTesting(null);
  }

  const enabledCount = rows.filter((s) => s.enabled).length;

  return (
    <div className="p-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 tracking-tight">{t('sources.title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('sources.subtitle')}</p>
        </div>
        <Button variant="primary" onClick={startCreate}><Plus size={16} /> {t('sources.add')}</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label={t('sources.statTotal')} value={loading ? '-' : rows.length} icon={<Server size={20} />} accent="brand" />
        <StatCard label={t('sources.statEnabled')} value={loading ? '-' : enabledCount} icon={<Check size={20} />} accent="green" />
        <StatCard label={t('sources.statDisabled')} value={loading ? '-' : rows.length - enabledCount} icon={<X size={20} />} accent="slate" />
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{t('sources.colName')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('sources.colEndpoints')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('sources.colApiKey')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('sources.colModels')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('sources.colStatus')}</th>
              <th className="text-right px-4 py-3 font-medium">{t('sources.colActions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} cols={6} />)}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6}><EmptyState icon={<Server size={24} />} title={t('sources.empty')} description={t('sources.emptyDesc')} /></td></tr>
            )}
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50 transition-colors align-middle">
                <td className="px-4 py-3 text-slate-800 font-medium">{s.name}</td>
                <td className="px-4 py-3">
                  <div className="space-y-1">
                    {(s.endpoints || []).map((ep) => (
                      <div key={ep.protocol} className="flex items-center gap-2">
                        <Badge tone="indigo">{ep.protocol}</Badge>
                        <span className="font-mono text-[11px] text-slate-500 truncate max-w-[240px]" title={ep.baseUrl}>{ep.baseUrl}</span>
                      </div>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400 font-mono text-xs">{maskKey(s.apiKey)}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center rounded-md bg-slate-100 text-slate-600 px-2 py-0.5 text-[11px]">
                    {t('sources.modelsCount', { n: (s.models || []).length })}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="space-y-1">
                    {s.enabled ? <Badge tone="green">{t('common.enabled')}</Badge> : <Badge tone="slate">{t('common.disabled')}</Badge>}
                    {testResult[s.id]?.map((r) => (
                      <div key={r.protocol} className={`flex items-center gap-1 text-xs ${r.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                        {r.ok ? <Check size={12} /> : <X size={12} />}
                        <span className="font-mono">{r.protocol}</span> {r.msg}
                      </div>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => test(s.id)} disabled={testing === s.id}><Zap size={13} /> {t('sources.test')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => startEdit(s)}><Pencil size={13} /></Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(s.id)}><Trash2 size={13} className="text-red-500" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={editId ? t('sources.modalEdit') : t('sources.modalCreate')}>
        <div className="space-y-3">
          <div><Label>{t('sources.fieldName')}</Label><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <EndpointsEditor rows={form.endpoints} onChange={(endpoints) => setForm({ ...form, endpoints })} />
          <div><Label>{t('sources.fieldApiKey')}</Label><Input value={form.apiKey || ''} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} /></div>
          <ModelsEditor rows={form.models} onChange={(models) => setForm({ ...form, models })} />
          <div className="flex items-center gap-2 pt-1">
            <Toggle checked={form.enabled ?? true} onChange={(v) => setForm({ ...form, enabled: v })} />
            <span className="text-sm text-slate-600">{t('common.enabled')}</span>
          </div>
          <div className="flex justify-end gap-2 pt-3">
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={save}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ---------------- 协议地址编辑器 ---------------- */

function EndpointsEditor({ rows, onChange }: { rows: EndpointRow[]; onChange: (rows: EndpointRow[]) => void }) {
  const update = (i: number, patch: Partial<EndpointRow>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, { protocol: 'openai_chat', baseUrl: '' }]);

  return (
    <div>
      <Label>{t('sources.endpointsLabel')}</Label>
      {rows.length === 0 && <p className="text-xs text-slate-400 mb-2">{t('sources.endpointsEmpty')}</p>}
      {rows.map((r, i) => (
        <div key={i} className="mb-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2 flex items-center gap-2">
          <Select value={r.protocol} onChange={(e) => update(i, { protocol: e.target.value })} className="w-56 shrink-0">
            {PROVIDERS.map((p) => <option key={p.v} value={p.v}>{t(p.key)}</option>)}
          </Select>
          <Input value={r.baseUrl || ''} onChange={(e) => update(i, { baseUrl: e.target.value })} placeholder={t('sources.placeholderUrl')} />
          <Button size="sm" variant="ghost" onClick={() => remove(i)}><Trash2 size={13} className="text-red-500" /></Button>
        </div>
      ))}
      <Button size="sm" variant="default" onClick={add}><Plus size={13} /> {t('sources.addEndpoint')}</Button>
    </div>
  );
}

/* ---------------- 模型与价格编辑器 ---------------- */

function ModelsEditor({ rows, onChange }: { rows: ModelRow[]; onChange: (rows: ModelRow[]) => void }) {
  const update = (i: number, patch: Partial<ModelRow>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, { model: '', inputPrice: '', cachedInputPrice: '', outputPrice: '' }]);

  return (
    <div>
      <Label>{t('sources.modelsLabel')}</Label>
      {rows.length === 0 && <p className="text-xs text-slate-400 mb-2">{t('sources.modelsEmpty')}</p>}
      {rows.map((r, i) => (
        <div key={i} className="mb-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <Input placeholder={t('sources.placeholderModel')} value={r.model} onChange={(e) => update(i, { model: e.target.value })} />
            <Button size="sm" variant="ghost" onClick={() => remove(i)}><Trash2 size={13} className="text-red-500" /></Button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="text-[10px] text-slate-400 mb-1">{t('sources.priceInput')}</div>
              <Input type="number" step="any" min="0" placeholder={t('sources.placeholderPrice')} value={r.inputPrice} onChange={(e) => update(i, { inputPrice: e.target.value })} />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 mb-1">{t('sources.priceCached')}</div>
              <Input type="number" step="any" min="0" placeholder={t('sources.placeholderPrice')} value={r.cachedInputPrice} onChange={(e) => update(i, { cachedInputPrice: e.target.value })} />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 mb-1">{t('sources.priceOutput')}</div>
              <Input type="number" step="any" min="0" placeholder={t('sources.placeholderPrice')} value={r.outputPrice} onChange={(e) => update(i, { outputPrice: e.target.value })} />
            </div>
          </div>
        </div>
      ))}
      <Button size="sm" variant="default" onClick={add}><Plus size={13} /> {t('sources.addModel')}</Button>
    </div>
  );
}

function toNumOrNull(v: string): number | null {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function maskKey(k: string) {
  if (!k) return '';
  if (k.length <= 8) return k;
  return k.slice(0, 4) + '••••' + k.slice(-4);
}
