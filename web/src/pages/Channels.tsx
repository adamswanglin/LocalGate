import { useEffect, useRef, useState } from 'react';
import { api, Channel, ChannelBinding, Source, Token, MetaInfo } from '../lib/api.js';
import { Button, Input, Select, Label, Toggle, Badge, Card, Modal, StatCard, SkeletonRow, CopyButton } from '../components/ui.js';
import { Plus, Pencil, Trash2, Copy, Check, KeyRound, Radio, RadioTower, ArrowUpDown, Globe, Lock, X } from 'lucide-react';
import { t, fmtDate } from '../lib/i18n.js';

const PROTOCOL_TABS = [
  { v: 'openai_chat', key: 'protocol.chat' },
  { v: 'openai_response', key: 'protocol.response' },
  { v: 'anthropic', key: 'protocol.anthropic' },
];

const PROTOCOL_PATHS = ['/v1/chat/completions', '/v1/responses', '/v1/messages'];

type BindingRow = { sourceId: string; sourceModelId: string };

interface FormState {
  protocol: string;
  exposedModel: string;
  enabled: boolean;
  bindings: BindingRow[];
  activeIndex: number;
}

const emptyForm: FormState = { protocol: 'openai_chat', exposedModel: '', enabled: true, bindings: [], activeIndex: 0 };

export default function ChannelsPage() {
  const [rows, setRows] = useState<Channel[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [meta, setMeta] = useState<MetaInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  // 令牌弹窗
  const [tokOpen, setTokOpen] = useState(false);
  const [tokEditId, setTokEditId] = useState<number | null>(null);
  const [tokForm, setTokForm] = useState({ name: '', token: '' });
  const [createdToken, setCreatedToken] = useState<Token | null>(null);
  const [copiedTok, setCopiedTok] = useState<number | null>(null);

  // tab 分组展示
  const [activeTab, setActiveTab] = useState('openai_chat');
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  async function load() {
    setLoading(true);
    const [c, s, t, m] = await Promise.all([
      api.channels.list(),
      api.sources.list(),
      api.tokens.list().catch(() => []),
      api.meta.get().catch(() => null),
    ]);
    setRows(c); setSources(s); setTokens(t); setMeta(m); setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function compatibleSources(protocol: string) {
    return sources.filter((s) => (s.endpoints || []).some((e) => e.protocol === protocol));
  }

  function scrollToTab(v: string) {
    setActiveTab(v);
    sectionRefs.current[v]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function startCreate() {
    setForm({ ...emptyForm, bindings: [] });
    setEditId(null); setOpen(true);
  }
  function startEdit(c: Channel) {
    setForm({
      protocol: c.protocol,
      exposedModel: c.exposedModel,
      enabled: c.enabled,
      bindings: c.bindings.map((b) => ({
        sourceId: b.sourceId != null ? String(b.sourceId) : '',
        sourceModelId: String(b.sourceModelId),
      })),
      activeIndex: Math.max(0, c.bindings.findIndex((b) => b.id === c.activeBindingId)),
    });
    setEditId(c.id); setOpen(true);
  }

  async function save() {
    if (!form.protocol || !form.exposedModel) { alert(t('channels.alertForm')); return; }
    if (form.bindings.length === 0) { alert(t('channels.alertBindings')); return; }
    if (form.bindings.some((b) => !b.sourceId || !b.sourceModelId)) { alert(t('channels.alertBindingRows')); return; }
    const payload = {
      protocol: form.protocol, exposedModel: form.exposedModel,
      enabled: form.enabled,
      bindings: form.bindings.map((b) => ({ sourceModelId: Number(b.sourceModelId) })),
      activeIndex: form.activeIndex,
    };
    try {
      if (editId) await api.channels.update(editId, payload);
      else await api.channels.create(payload);
      setOpen(false); load();
    } catch (e: any) { alert(e.message || t('common.saveFailed')); }
  }

  async function remove(id: number) {
    if (!confirm(t('channels.confirmDelete'))) return;
    await api.channels.remove(id); load();
  }

  async function switchActive(c: Channel, bindingId: number) {
    try {
      const updated = await api.channels.setActive(c.id, bindingId);
      setRows((prev) => prev.map((r) => (r.id === c.id ? updated : r)));
    } catch (e: any) { alert(e.message || t('channels.alertSwitchFailed')); }
  }

  async function switchEnabled(c: Channel, v: boolean) {
    setRows((prev) => prev.map((r) => (r.id === c.id ? { ...r, enabled: v } : r)));
    try {
      const updated = await api.channels.update(c.id, { enabled: v });
      setRows((prev) => prev.map((r) => (r.id === c.id ? updated : r)));
    } catch (e: any) {
      setRows((prev) => prev.map((r) => (r.id === c.id ? { ...r, enabled: !v } : r)));
      alert(e.message || t('common.saveFailed'));
    }
  }

  function copy(id: number, key: string) {
    navigator.clipboard.writeText(key);
    setCopied(id); setTimeout(() => setCopied(null), 1500);
  }
  function copyToken(id: number, key: string) {
    navigator.clipboard.writeText(key);
    setCopiedTok(id); setTimeout(() => setCopiedTok(null), 1500);
  }

  /* ---------- 令牌 ---------- */
  function startTokCreate() { setTokForm({ name: '', token: '' }); setTokEditId(null); setTokOpen(true); }
  function startTokEdit(tk: Token) { setTokForm({ name: tk.name, token: '' }); setTokEditId(tk.id); setTokOpen(true); }
  async function saveToken() {
    if (!tokForm.name.trim()) { alert(t('tokens.alertName')); return; }
    try {
      if (tokEditId) {
        await api.tokens.update(tokEditId, { name: tokForm.name.trim() });
      } else {
        const row = await api.tokens.create({ name: tokForm.name.trim(), token: tokForm.token.trim() || undefined });
        setCreatedToken(row);
      }
    } catch (e: any) { alert(e.message || t('common.saveFailed')); return; }
    setTokOpen(false); load();
  }
  async function removeToken(id: number) {
    if (!confirm(t('tokens.confirmDelete'))) return;
    await api.tokens.remove(id); load();
  }
  async function toggleToken(tk: Token, v: boolean) {
    setTokens((prev) => prev.map((r) => (r.id === tk.id ? { ...r, enabled: v } : r)));
    try { await api.tokens.update(tk.id, { enabled: v }); }
    catch (e: any) { setTokens((prev) => prev.map((r) => (r.id === tk.id ? { ...r, enabled: !v } : r))); alert(e.message || t('common.saveFailed')); }
  }

  const enabledCount = rows.filter((c) => c.enabled).length;
  const baseUrls = meta
    ? [`http://127.0.0.1:${meta.port}`, ...meta.localIPs.map((ip) => `http://${ip}:${meta.port}`)]
    : [];

  return (
    <div className="p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 tracking-tight">{t('channels.title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('channels.subtitle')}</p>
        </div>
        <Button variant="primary" onClick={startCreate}><Plus size={16} /> {t('channels.add')}</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label={t('channels.statTotal')} value={loading ? '-' : rows.length} icon={<KeyRound size={20} />} accent="brand" />
        <StatCard label={t('channels.statEnabled')} value={loading ? '-' : enabledCount} icon={<Radio size={20} />} accent="green" />
        <StatCard label={t('channels.statProtocols')} value={loading ? '-' : new Set(rows.map((c) => c.protocol)).size} icon={<RadioTower size={20} />} accent="amber" />
      </div>

      {/* 接入地址 BaseURL */}
      <Card className="p-4 mb-6">
        <div className="flex items-center gap-2 text-slate-500 mb-2.5">
          <Globe size={15} /><span className="text-xs font-medium uppercase tracking-wider">{t('baseurl.title')}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {baseUrls.length === 0 && <span className="text-xs text-slate-400">{t('common.loading')}</span>}
          {baseUrls.map((u) => (
            <div key={u} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
              <code className="text-xs font-mono text-slate-600">{u}</code>
              <CopyButton text={u} label={t('common.copy')} />
            </div>
          ))}
        </div>
        <div className="mt-2 text-[11px] font-mono text-slate-400 leading-relaxed">
          {t('baseurl.protocolPaths')} {PROTOCOL_PATHS.join(' · ')}
          <br />{t('baseurl.callExample', { url: baseUrls[0] || 'http://127.0.0.1:8787', path: PROTOCOL_PATHS[0] })}
          {tokens.length === 0 && <span className="text-slate-500"> {t('baseurl.noAuth')}</span>}
        </div>
      </Card>

      {/* 访问令牌 */}
      <Card className="overflow-hidden mb-6">
        <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-2 text-slate-500">
            <Lock size={15} /><span className="text-xs font-medium uppercase tracking-wider">{t('tokens.title')}</span>
          </div>
          <Button size="sm" variant="default" onClick={startTokCreate}><Plus size={14} /> {t('tokens.add')}</Button>
        </div>
        <div className="px-4 py-2 text-sm text-slate-500 border-b border-slate-100">
          {tokens.length === 0 ? t('tokens.subtitleNone') : t('tokens.subtitleSome')}
        </div>
        {createdToken && (
          <div className="mx-4 mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-emerald-800 mb-1">{t('tokens.createdBanner')}</div>
                <code className="block rounded-lg bg-white border border-emerald-200 px-3 py-2 text-xs font-mono text-emerald-700 break-all">{createdToken.token}</code>
                <p className="text-xs text-emerald-600 mt-1.5">{t('tokens.exampleCall', { token: createdToken.token })}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <CopyButton text={createdToken.token} label={t('common.copy')} />
                <button onClick={() => setCreatedToken(null)} className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-100 cursor-pointer"><X size={14} /></button>
              </div>
            </div>
          </div>
        )}
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{t('tokens.colName')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('tokens.colToken')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('tokens.colStatus')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('tokens.colCreated')}</th>
              <th className="text-left px-4 py-3 font-medium">{t('tokens.colLastUsed')}</th>
              <th className="text-right px-4 py-3 font-medium">{t('channels.colActions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && Array.from({ length: 2 }).map((_, i) => <SkeletonRow key={i} cols={6} />)}
            {!loading && tokens.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-sm text-slate-400">{t('tokens.empty')} — {t('tokens.emptyDesc')}</td></tr>
            )}
            {tokens.map((tk) => (
              <tr key={tk.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 text-slate-800 font-medium">{tk.name}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <code className="font-mono text-xs text-slate-600">{tk.token}</code>
                    <button className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer" onClick={() => copyToken(tk.id, tk.token)}>
                      {copiedTok === tk.id ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Toggle checked={tk.enabled} onChange={(v) => toggleToken(tk, v)} />
                    {tk.enabled ? <Badge tone="green">{t('common.enabled')}</Badge> : <Badge tone="slate">{t('common.disabled')}</Badge>}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(tk.createdAt)}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{tk.lastUsedAt ? fmtDate(tk.lastUsedAt) : <span className="text-slate-300">{t('tokens.notUsed')}</span>}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => startTokEdit(tk)}><Pencil size={13} /></Button>
                    <Button size="sm" variant="ghost" onClick={() => removeToken(tk.id)}><Trash2 size={13} className="text-red-500" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* 协议 tab 分组展示 */}
      <div className="flex gap-2 mb-4">
        {PROTOCOL_TABS.map((tab) => (
          <button
            key={tab.v}
            onClick={() => scrollToTab(tab.v)}
            className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm transition-colors cursor-pointer ${
              activeTab === tab.v
                ? 'border-brand-300 bg-brand-50 text-brand-700 font-medium'
                : 'border-slate-200 bg-white text-slate-600 hover:text-slate-800'
            }`}
          >
            {t(tab.key)}
            <span className={`rounded-md px-1.5 text-[10px] ${activeTab === tab.v ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
              {rows.filter((c) => c.protocol === tab.v).length}
            </span>
          </button>
        ))}
      </div>

      {PROTOCOL_TABS.map((tab) => {
        const group = rows.filter((c) => c.protocol === tab.v);
        return (
          <div key={tab.v} ref={(el) => { sectionRefs.current[tab.v] = el; }} className="mb-8 scroll-mt-6">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-sm font-semibold text-slate-700">{t(tab.key)}</h2>
              <Badge tone="indigo">{group.length}</Badge>
            </div>
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">{t('channels.colModel')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('channels.colUpstream')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('channels.colPrice')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('channels.colStatus')}</th>
                    <th className="text-right px-4 py-3 font-medium">{t('channels.colActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading && Array.from({ length: 2 }).map((_, i) => <SkeletonRow key={i} cols={5} />)}
                  {!loading && group.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-sm text-slate-400">{t('channels.empty')} — {t('channels.emptyDesc')}</td></tr>
                  )}
                  {group.map((c) => {
                    const active = c.bindings.find((b) => b.id === c.activeBindingId) || c.bindings[0];
                    return (
                      <tr key={c.id} className="hover:bg-slate-50 transition-colors align-middle">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 font-mono text-xs text-slate-700">
                            {c.exposedModel}
                            <button className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer" onClick={() => copy(c.id, c.exposedModel)}>
                              {copied === c.id ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {c.bindings.length > 1 ? (
                            <div className="flex items-center gap-1.5">
                              <ArrowUpDown size={12} className="text-slate-300 shrink-0" />
                              <select
                                value={active?.id ?? ''}
                                onChange={(e) => switchActive(c, Number(e.target.value))}
                                className="rounded-lg bg-white border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:outline-none focus:border-brand-500 cursor-pointer max-w-[16rem]"
                                title={t('channels.switchActive')}
                              >
                                {c.bindings.map((b) => (
                                  <option key={b.id} value={b.id}>{b.sourceName} / {b.model}</option>
                                ))}
                              </select>
                            </div>
                          ) : active ? (
                            <span className="font-mono text-xs text-slate-600">{active.sourceName} / {active.model}</span>
                          ) : (
                            <span className="text-slate-300 text-xs">{t('channels.noBinding')}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">{active ? priceLabel(active) : '-'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Toggle checked={c.enabled} onChange={(v) => switchEnabled(c, v)} />
                            {c.enabled ? <Badge tone="green">{t('common.enabled')}</Badge> : <Badge tone="slate">{t('common.disabled')}</Badge>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => startEdit(c)}><Pencil size={13} /></Button>
                            <Button size="sm" variant="ghost" onClick={() => remove(c.id)}><Trash2 size={13} className="text-red-500" /></Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </div>
        );
      })}

      {/* 通道表单 */}
      <Modal open={open} onClose={() => setOpen(false)} title={editId ? t('channels.modalEdit') : t('channels.modalCreate')}>
        <div className="space-y-3">
          <div><Label>{t('channels.fieldModel')}</Label>
            <Input value={form.exposedModel || ''} onChange={(e) => setForm({ ...form, exposedModel: e.target.value })} placeholder={t('channels.placeholderModel')} />
          </div>
          <div><Label>{t('channels.fieldProtocol')}</Label>
            <Select value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value, bindings: [], activeIndex: 0 })}>
              {PROTOCOL_TABS.map((p) => <option key={p.v} value={p.v}>{t(p.key)}</option>)}
            </Select>
          </div>
          <BindingsEditor
            sources={compatibleSources(form.protocol)}
            rows={form.bindings}
            activeIndex={form.activeIndex}
            onChange={(bindings, activeIndex) => setForm({ ...form, bindings, activeIndex })}
          />
          <div className="flex items-center gap-6 pt-1">
            <label className="flex items-center gap-2 text-sm text-slate-600"><Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} /> {t('common.enabled')}</label>
            <span className="text-xs text-slate-400">{t('sources.modelsLabel')}</span>
          </div>
          <div className="flex justify-end gap-2 pt-3">
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={save}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

      {/* 令牌表单 */}
      <Modal open={tokOpen} onClose={() => setTokOpen(false)} title={tokEditId ? t('tokens.modalEdit') : t('tokens.modalCreate')}>
        <div className="space-y-3">
          <div><Label>{t('tokens.fieldName')}</Label><Input value={tokForm.name} onChange={(e) => setTokForm({ ...tokForm, name: e.target.value })} placeholder={t('tokens.placeholderName')} /></div>
          {!tokEditId && (
            <div>
              <Label>{t('tokens.fieldToken')}</Label>
              <Input value={tokForm.token} onChange={(e) => setTokForm({ ...tokForm, token: e.target.value })} placeholder={t('tokens.placeholderToken')} />
            </div>
          )}
          <p className="text-xs text-slate-400">
            {tokEditId ? t('tokens.hintEdit') : t('tokens.hintCreate')}
          </p>
          <div className="flex justify-end gap-2 pt-3">
            <Button variant="ghost" onClick={() => setTokOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={saveToken}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ---------------- 绑定编辑器 ---------------- */

function BindingsEditor({
  sources, rows, activeIndex, onChange,
}: {
  sources: Source[];
  rows: BindingRow[];
  activeIndex: number;
  onChange: (rows: BindingRow[], activeIndex: number) => void;
}) {
  const update = (i: number, patch: Partial<BindingRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)), activeIndex);
  const remove = (i: number) => {
    const next = rows.filter((_, idx) => idx !== i);
    const nextActive = next.length ? Math.min(activeIndex, next.length - 1) : 0;
    onChange(next, nextActive);
  };
  const add = () => onChange([...rows, { sourceId: '', sourceModelId: '' }], activeIndex);
  const modelsOf = (row: BindingRow): Source['models'] => {
    const src = sources.find((s) => s.id === Number(row.sourceId));
    return (src?.models || []).filter((m) => m.enabled);
  };

  return (
    <div>
      <Label>{t('channels.bindingsLabel')}</Label>
      {sources.length === 0 && (
        <p className="text-xs text-amber-600 mb-2">{t('channels.bindingsWarn')}</p>
      )}
      {rows.length === 0 && <p className="text-xs text-slate-400 mb-2">{t('channels.bindingsEmpty')}</p>}
      {rows.map((r, i) => {
        const models = modelsOf(r);
        const selected = models.find((m) => m.id === Number(r.sourceModelId));
        return (
          <div key={i} className="mb-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <label className={`inline-flex items-center gap-1.5 text-xs cursor-pointer select-none shrink-0 ${activeIndex === i ? 'text-brand-700 font-medium' : 'text-slate-400'}`}>
                <input
                  type="radio"
                  name="active-binding"
                  checked={activeIndex === i}
                  onChange={() => onChange(rows, i)}
                  className="accent-brand-600"
                />
                {t('channels.bindingActive')}
              </label>
              <Select
                value={r.sourceId}
                onChange={(e) => update(i, { sourceId: e.target.value, sourceModelId: '' })}
                className="flex-1"
              >
                <option value="">{t('channels.placeholderSelectSource')}</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
              <Button size="sm" variant="ghost" onClick={() => remove(i)}><Trash2 size={13} className="text-red-500" /></Button>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Select
                  value={r.sourceModelId}
                  onChange={(e) => update(i, { sourceModelId: e.target.value })}
                  disabled={!r.sourceId}
                >
                  <option value="">{r.sourceId ? t('channels.placeholderSelectModel') : t('channels.placeholderSelectSourceFirst')}</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.model}（¥{fmtPrice(m.inputPrice)} / ¥{fmtPrice(m.cachedInputPrice)} / ¥{fmtPrice(m.outputPrice)}）</option>
                  ))}
                </Select>
              </div>
              {selected && (
                <span className="text-[10px] text-slate-400 whitespace-nowrap shrink-0">
                  {t('sources.priceOutput')} ¥{fmtPrice(selected.inputPrice)} / ¥{fmtPrice(selected.cachedInputPrice)} / ¥{fmtPrice(selected.outputPrice)}
                </span>
              )}
            </div>
          </div>
        );
      })}
      <Button size="sm" variant="default" onClick={add}><Plus size={13} /> {t('channels.addBinding')}</Button>
    </div>
  );
}

/* ---------------- 工具 ---------------- */

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return '-';
  return String(v);
}
function priceLabel(b: ChannelBinding): string {
  return `¥${fmtPrice(b.inputPrice)} / ¥${fmtPrice(b.cachedInputPrice)} / ¥${fmtPrice(b.outputPrice)}`;
}
