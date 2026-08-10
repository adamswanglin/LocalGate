import { useEffect, useState } from 'react';
import { api, ModelEntry, Source, Token, MetaInfo } from '../lib/api.js';
import { Button, Input, Select, Label, Toggle, Badge, Card, Modal, SkeletonRow, CopyButton } from '../components/ui.js';
import { Plus, Pencil, Trash2, Copy, Check, KeyRound, Globe, Lock, X, Layers, Zap } from 'lucide-react';
import { t, fmtDate } from '../lib/i18n.js';

const PROTOCOL_TABS = [
  { v: 'openai_chat', key: 'protocol.chat' },
  { v: 'openai_response', key: 'protocol.response' },
  { v: 'anthropic', key: 'protocol.anthropic' },
];

const PROTOCOL_PATHS = ['/v1/chat/completions', '/v1/responses', '/v1/messages'];

type BindingRow = { sourceId: string; sourceModelId: string };

interface ProtocolSection {
  protocol: string;
  enabled: boolean;
  bindings: BindingRow[];
  activeIndex: number;
}

interface GroupFormState {
  exposedModel: string;
  name: string;
  protocols: ProtocolSection[];
}

const emptyGroupForm: GroupFormState = {
  exposedModel: '',
  name: '',
  protocols: PROTOCOL_TABS.map((p) => ({ protocol: p.v, enabled: true, bindings: [], activeIndex: 0 })),
};

export default function ModelEntriesPage() {
  const [rows, setRows] = useState<ModelEntry[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [meta, setMeta] = useState<MetaInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // 顶层子标签页
  const [mainTab, setMainTab] = useState<'tokens' | 'models'>('models');

  // 模型组弹窗
  const [open, setOpen] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null); // 编辑时的旧 exposedModel
  const [form, setForm] = useState<GroupFormState>(emptyGroupForm);
  const [copied, setCopied] = useState<string | null>(null);

  // 令牌弹窗
  const [tokOpen, setTokOpen] = useState(false);
  const [tokEditId, setTokEditId] = useState<number | null>(null);
  const [tokForm, setTokForm] = useState({ name: '', token: '' });
  const [createdToken, setCreatedToken] = useState<Token | null>(null);
  const [copiedTok, setCopiedTok] = useState<number | null>(null);

  // 测试连通
  const [testingGroup, setTestingGroup] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult[]>>({});

  type TestResult = { protocol: string; ok: boolean; msg: string };

  async function load() {
    setLoading(true);
    const [c, s, t, m] = await Promise.all([
      api.modelEntries.list(),
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

  function modelNameById(id: string | number): string | null {
    const n = Number(id);
    if (!Number.isFinite(n)) return null;
    for (const s of sources) for (const m of s.models || []) if (m.id === n) return m.model;
    return null;
  }

  // 按 exposedModel 分组：一个 modelId 一组（含多个协议的 channel）
  const groups: { model: string; channels: ModelEntry[] }[] = (() => {
    const map = new Map<string, ModelEntry[]>();
    for (const c of rows) {
      const key = c.exposedModel ?? '';
      const arr = map.get(key) || [];
      arr.push(c);
      map.set(key, arr);
    }
    return [...map.entries()].map(([model, channels]) => ({ model, channels }));
  })();

  /* ---------- 模型组：新建 / 编辑 ---------- */
  function startCreate() {
    setForm({
      exposedModel: '',
      name: '',
      protocols: PROTOCOL_TABS.map((p) => ({ protocol: p.v, enabled: true, bindings: [], activeIndex: 0 })),
    });
    setEditKey(null); setOpen(true);
  }
  function startEditGroup(model: string) {
    const channels = groups.find((g) => g.model === model)?.channels || [];
    const byProto = new Map(channels.map((c) => [c.protocol, c]));
    setForm({
      exposedModel: model,
      name: channels[0]?.name || '',
      // 默认展示全部三类 API；已配置的回填，未配置的留空
      protocols: PROTOCOL_TABS.map((p) => {
        const c = byProto.get(p.v);
        return c ? {
          protocol: c.protocol,
          enabled: c.enabled,
          bindings: c.bindings.map((b) => ({
            sourceId: b.sourceId != null ? String(b.sourceId) : '',
            sourceModelId: String(b.sourceModelId),
          })),
          activeIndex: Math.max(0, c.bindings.findIndex((b) => b.id === c.activeBindingId)),
        } : { protocol: p.v, enabled: true, bindings: [], activeIndex: 0 };
      }),
    });
    setEditKey(model); setOpen(true);
  }
  function onSectionChange(i: number, bindings: BindingRow[], activeIndex: number) {
    const protocols = form.protocols.map((p, idx) => (idx === i ? { ...p, bindings, activeIndex } : p));
    const next: GroupFormState = { ...form, protocols };
    // 对外模型 ID 默认取首个选中上游模型名
    if (!form.exposedModel.trim()) {
      outer: for (const sec of protocols) {
        for (const b of sec.bindings) {
          if (b.sourceModelId) {
            const m = modelNameById(b.sourceModelId);
            if (m) { next.exposedModel = m; break outer; }
          }
        }
      }
    }
    setForm(next);
  }

  async function saveGroup() {
    if (!form.exposedModel.trim()) { alert(t('modelEntries.alertForm')); return; }
    // 只取填了完整上游的协议；留空的类型不保存。至少需要一个。
    const filled = form.protocols.filter((p) => p.bindings.length > 0 && p.bindings.every((b) => b.sourceId && b.sourceModelId));
    if (filled.length === 0) { alert(t('modelEntries.alertBindingRows')); return; }
    const payload = {
      exposedModel: form.exposedModel.trim(),
      name: form.name.trim(),
      protocols: filled.map((p) => ({
        protocol: p.protocol,
        enabled: p.enabled,
        bindings: p.bindings.map((b) => ({ sourceModelId: Number(b.sourceModelId) })),
        activeIndex: p.activeIndex,
      })),
    };
    try {
      if (editKey != null) await api.modelGroups.update(editKey, payload);
      else await api.modelGroups.create(payload);
      setOpen(false); load();
    } catch (e: any) { alert(e.message || t('common.saveFailed')); }
  }

  async function removeGroup(model: string) {
    if (!confirm(t('modelEntries.confirmDeleteGroup'))) return;
    await api.modelGroups.remove(model); load();
  }

  /* ---------- 行内：切生效上游 / 启停 ---------- */
  async function switchActive(c: ModelEntry, bindingId: number) {
    try {
      const updated = await api.modelEntries.setActive(c.id, bindingId);
      setRows((prev) => prev.map((r) => (r.id === c.id ? updated : r)));
    } catch (e: any) { alert(e.message || t('modelEntries.alertSwitchFailed')); }
  }
  async function switchEnabled(c: ModelEntry, v: boolean) {
    setRows((prev) => prev.map((r) => (r.id === c.id ? { ...r, enabled: v } : r)));
    try {
      const updated = await api.modelEntries.update(c.id, { enabled: v });
      setRows((prev) => prev.map((r) => (r.id === c.id ? updated : r)));
    } catch (e: any) {
      setRows((prev) => prev.map((r) => (r.id === c.id ? { ...r, enabled: !v } : r)));
      alert(e.message || t('common.saveFailed'));
    }
  }

  function copy(key: string) {
    navigator.clipboard.writeText(key);
    setCopied(key); setTimeout(() => setCopied(null), 1500);
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

  async function testGroup(model: string) {
    const modelName = window.prompt(t('modelEntries.testPrompt'), 'doubao-seed-2.0-code');
    if (!modelName) return;
    setTestingGroup(model);
    try {
      const r = await api.modelGroups.test(model, modelName.trim());
      const items = r.results || [r];
      const results: TestResult[] = items.map((item: any) => ({
        protocol: item.protocol,
        ok: item.ok,
        msg: item.ok
          ? t('sources.testSuccess', { status: String(item.status ?? '?') })
          : (item.error || (item.sample ? item.sample.slice(0, 80) : 'unknown error')),
      }));
      setTestResults((p) => ({ ...p, [model]: results }));
    } catch (e: any) {
      setTestResults((p) => ({ ...p, [model]: [{ protocol: '-', ok: false, msg: e.message }] }));
    }
    setTestingGroup(null);
  }

  const baseUrls = meta
    ? [`http://127.0.0.1:${meta.port}`, ...meta.localIPs.map((ip) => `http://${ip}:${meta.port}`)]
    : [];

  const subTabCls = (active: boolean) =>
    `inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm transition-colors cursor-pointer ${
      active ? 'border-brand-300 bg-brand-50 text-brand-700 font-medium' : 'border-stone-200 bg-white text-stone-600 hover:text-stone-800'
    }`;

  return (
    <div className="p-6 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-stone-800 tracking-tight">{t('modelEntries.title')}</h1>
        <p className="text-sm text-stone-500 mt-1">{t('modelEntries.subtitle')}</p>
      </div>

      {/* 接入地址 BaseURL */}
      <Card className="p-4 mb-6">
        <div className="flex items-center gap-2 text-stone-500 mb-2.5">
          <Globe size={15} /><span className="text-xs font-medium uppercase tracking-wider">{t('baseurl.title')}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {baseUrls.length === 0 && <span className="text-xs text-stone-400">{t('common.loading')}</span>}
          {baseUrls.map((u) => (
            <div key={u} className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5">
              <code className="text-xs font-mono text-stone-600">{u}</code>
              <CopyButton text={u} label={t('common.copy')} />
            </div>
          ))}
        </div>
        <div className="mt-2 text-[11px] font-mono text-stone-400 leading-relaxed">
          {t('baseurl.protocolPaths')} {PROTOCOL_PATHS.join(' · ')}
          <br />{t('baseurl.callExample', { url: baseUrls[0] || 'http://127.0.0.1:8787', path: PROTOCOL_PATHS[0] })}
          {tokens.length === 0 && <span className="text-stone-500"> {t('baseurl.noAuth')}</span>}
        </div>
      </Card>

      {/* 子标签页：AccessToken / Model */}
      <div className="flex gap-2 mb-4">
        <button className={subTabCls(mainTab === 'tokens')} onClick={() => setMainTab('tokens')}>
          <Lock size={15} /> {t('modelEntries.tabTokens')}
        </button>
        <button className={subTabCls(mainTab === 'models')} onClick={() => setMainTab('models')}>
          <Layers size={15} /> {t('modelEntries.tabModel')}
        </button>
      </div>

      {/* ── AccessToken ── */}
      {mainTab === 'tokens' && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between border-b border-stone-100">
            <div className="flex items-center gap-2 text-stone-500">
              <KeyRound size={15} /><span className="text-xs font-medium uppercase tracking-wider">{t('tokens.title')}</span>
            </div>
            <Button size="sm" variant="default" onClick={startTokCreate}><Plus size={14} /> {t('tokens.add')}</Button>
          </div>
          <div className="px-4 py-2 text-sm text-stone-500 border-b border-stone-100">
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
            <thead className="bg-stone-50 text-stone-500 text-xs">
              <tr>
                <th className="text-left px-4 py-3 font-medium">{t('tokens.colName')}</th>
                <th className="text-left px-4 py-3 font-medium">{t('tokens.colToken')}</th>
                <th className="text-left px-4 py-3 font-medium">{t('tokens.colStatus')}</th>
                <th className="text-left px-4 py-3 font-medium">{t('tokens.colCreated')}</th>
                <th className="text-left px-4 py-3 font-medium">{t('tokens.colLastUsed')}</th>
                <th className="text-right px-4 py-3 font-medium">{t('modelEntries.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading && Array.from({ length: 2 }).map((_, i) => <SkeletonRow key={i} cols={6} />)}
              {!loading && tokens.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-sm text-stone-400">{t('tokens.empty')} — {t('tokens.emptyDesc')}</td></tr>
              )}
              {tokens.map((tk) => (
                <tr key={tk.id} className="hover:bg-stone-50 transition-colors">
                  <td className="px-4 py-3 text-stone-800 font-medium">{tk.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <code className="font-mono text-xs text-stone-600">{tk.token}</code>
                      <button className="text-stone-400 hover:text-stone-600 transition-colors cursor-pointer" onClick={() => copyToken(tk.id, tk.token)}>
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
                  <td className="px-4 py-3 text-stone-500 text-xs">{fmtDate(tk.createdAt)}</td>
                  <td className="px-4 py-3 text-stone-500 text-xs">{tk.lastUsedAt ? fmtDate(tk.lastUsedAt) : <span className="text-stone-300">{t('tokens.notUsed')}</span>}</td>
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
      )}

      {/* ── Model ── */}
      {mainTab === 'models' && (
        <div>
          <div className="flex justify-end mb-3">
            <Button variant="primary" onClick={startCreate}><Plus size={16} /> {t('modelEntries.newModel')}</Button>
          </div>

          {loading && (
            <Card className="overflow-hidden p-4">
              {Array.from({ length: 2 }).map((_, i) => <SkeletonRow key={i} cols={4} />)}
            </Card>
          )}

          {!loading && groups.length === 0 && (
            <Card className="p-10 text-center">
              <p className="text-sm text-stone-400">{t('modelEntries.empty')} — {t('modelEntries.emptyDesc')}</p>
            </Card>
          )}

          <div className="space-y-4">
            {groups.map((g) => (
              <Card key={g.model} className="overflow-hidden">
                {/* 组头：对外模型名（主）+ 操作 */}
                <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-stone-100">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="mt-1 h-8 w-1 rounded-full bg-brand-500 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">{t('modelEntries.fieldModel')}</div>
                      {g.model ? (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[15px] font-semibold text-stone-900 tracking-tight truncate">{g.model}</span>
                          <button className="text-stone-400 hover:text-stone-600 transition-colors cursor-pointer shrink-0" onClick={() => copy(g.model)}>
                            {copied === g.model ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                          </button>
                        </div>
                      ) : (
                        <span className="text-stone-400 italic text-xs">{t('modelEntries.legacyNoName')}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => testGroup(g.model)} disabled={testingGroup === g.model}><Zap size={13} /> {t('sources.test')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => startEditGroup(g.model)}><Pencil size={13} /> {t('modelEntries.editGroup')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => removeGroup(g.model)}><Trash2 size={13} className="text-red-500" /></Button>
                  </div>
                </div>
                {/* 测试结果 */}
                {testResults[g.model] && (
                  <div className="px-5 py-2 border-b border-stone-100 flex flex-wrap gap-3">
                    {testResults[g.model].map((r) => (
                      <div key={r.protocol} className={`flex items-center gap-1 text-xs ${r.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                        {r.ok ? <Check size={12} /> : <X size={12} />}
                        <span className="font-mono">{r.protocol}</span> {r.msg}
                      </div>
                    ))}
                  </div>
                )}
                {/* 组体：每个协议一行（次级信息） */}
                <table className="w-full text-sm">
                  <thead className="text-stone-400 text-[11px]">
                    <tr className="border-b border-stone-100">
                      <th className="text-left px-5 py-2 font-medium uppercase tracking-wide">{t('modelEntries.fieldApiTypes')}</th>
                      <th className="text-left px-5 py-2 font-medium uppercase tracking-wide">{t('modelEntries.colUpstream')}</th>
                      <th className="text-left px-5 py-2 font-medium uppercase tracking-wide">{t('modelEntries.colPrice')}</th>
                      <th className="text-left px-5 py-2 font-medium uppercase tracking-wide">{t('modelEntries.colStatus')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {g.channels.map((c) => {
                      const active = c.bindings.find((b) => b.id === c.activeBindingId) || c.bindings[0];
                      return (
                        <tr key={c.id} className="align-middle">
                          <td className="px-5 py-3"><Badge tone="indigo">{t(protocolKey(c.protocol))}</Badge></td>
                          <td className="px-5 py-3">
                            {c.bindings.length > 1 ? (
                              <div className="flex items-center gap-1.5">
                                <select
                                  value={active?.id ?? ''}
                                  onChange={(e) => switchActive(c, Number(e.target.value))}
                                  className="rounded-lg bg-white border border-stone-200 px-2 py-1 text-xs text-stone-700 focus:outline-none focus:border-brand-500 cursor-pointer max-w-[16rem]"
                                  title={t('modelEntries.switchActive')}
                                >
                                  {c.bindings.map((b) => (
                                    <option key={b.id} value={b.id}>{b.sourceName} / {b.model}</option>
                                  ))}
                                </select>
                              </div>
                            ) : active ? (
                              <span className="text-xs text-stone-700">
                                <span className="font-medium">{active.sourceName}</span>
                                <span className="text-stone-400"> / </span>
                                <span className="font-mono text-stone-500">{active.model}</span>
                              </span>
                            ) : (
                              <span className="text-stone-300 text-xs">{t('modelEntries.noBinding')}</span>
                            )}
                          </td>
                          <td className="px-5 py-3 font-mono text-xs text-stone-400">{active ? priceLabel(active) : '-'}</td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <Toggle checked={c.enabled} onChange={(v) => switchEnabled(c, v)} />
                              {c.enabled ? <Badge tone="green">{t('common.enabled')}</Badge> : <Badge tone="slate">{t('common.disabled')}</Badge>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* 模型组弹窗（统一管理多协议） */}
      <Modal open={open} onClose={() => setOpen(false)} title={editKey ? t('modelEntries.modalEdit') : t('modelEntries.modalCreate')}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t('modelEntries.fieldModel')}</Label>
              <Input value={form.exposedModel} onChange={(e) => setForm({ ...form, exposedModel: e.target.value })} placeholder={t('modelEntries.placeholderModel')} />
            </div>
            <div><Label>{t('modelEntries.fieldName')}</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('modelEntries.placeholderName')} />
            </div>
          </div>

          <div className="pt-1">
            <Label>{t('modelEntries.fieldApiTypes')}</Label>
            <p className="text-xs text-stone-400 mb-2">{t('modelEntries.fieldApiTypesHint')}</p>
            {form.protocols.map((sec, i) => (
              <div key={sec.protocol} className="mb-3 rounded-xl border border-stone-200 bg-stone-50/60 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Badge tone="indigo">{t(protocolKey(sec.protocol))}</Badge>
                  <label className="flex items-center gap-1.5 text-xs text-stone-500 cursor-pointer select-none">
                    <Toggle checked={sec.enabled} onChange={(v) => setForm({ ...form, protocols: form.protocols.map((p, idx) => (idx === i ? { ...p, enabled: v } : p)) })} />
                    {t('common.enabled')}
                  </label>
                  {sec.bindings.length === 0 && (
                    <span className="text-[11px] text-stone-400">{t('modelEntries.typeUnconfigured')}</span>
                  )}
                </div>
                <BindingsEditor
                  sources={compatibleSources(sec.protocol)}
                  rows={sec.bindings}
                  activeIndex={sec.activeIndex}
                  onChange={(bindings, activeIndex) => onSectionChange(i, bindings, activeIndex)}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-3">
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={saveGroup}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

      {/* 令牌弹窗 */}
      <Modal open={tokOpen} onClose={() => setTokOpen(false)} title={tokEditId ? t('tokens.modalEdit') : t('tokens.modalCreate')}>
        <div className="space-y-3">
          <div><Label>{t('tokens.fieldName')}</Label><Input value={tokForm.name} onChange={(e) => setTokForm({ ...tokForm, name: e.target.value })} placeholder={t('tokens.placeholderName')} /></div>
          {!tokEditId && (
            <div>
              <Label>{t('tokens.fieldToken')}</Label>
              <Input value={tokForm.token} onChange={(e) => setTokForm({ ...tokForm, token: e.target.value })} placeholder={t('tokens.placeholderToken')} />
            </div>
          )}
          <p className="text-xs text-stone-400">
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

function protocolKey(v: string): string {
  return PROTOCOL_TABS.find((p) => p.v === v)?.key || 'protocol.chat';
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
      {sources.length === 0 && (
        <p className="text-xs text-amber-600 mb-2">{t('modelEntries.bindingsWarn')}</p>
      )}
      {rows.length === 0 && <p className="text-xs text-stone-400 mb-2">{t('modelEntries.bindingsEmpty')}</p>}
      {rows.map((r, i) => {
        const models = modelsOf(r);
        const selected = models.find((m) => m.id === Number(r.sourceModelId));
        return (
          <div key={i} className="mb-2 rounded-lg border border-stone-200 bg-white p-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <label className={`inline-flex items-center gap-1.5 text-xs cursor-pointer select-none shrink-0 ${activeIndex === i ? 'text-brand-700 font-medium' : 'text-stone-400'}`}>
                <input
                  type="radio"
                  name={`active-binding-${i}`}
                  checked={activeIndex === i}
                  onChange={() => onChange(rows, i)}
                  className="accent-brand-600"
                />
                {t('modelEntries.bindingActive')}
              </label>
              <Select
                value={r.sourceId}
                onChange={(e) => update(i, { sourceId: e.target.value, sourceModelId: '' })}
                className="flex-1"
              >
                <option value="">{t('modelEntries.placeholderSelectSource')}</option>
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
                  <option value="">{r.sourceId ? t('modelEntries.placeholderSelectModel') : t('modelEntries.placeholderSelectSourceFirst')}</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.model}（${fmtPrice(m.inputPrice)} / ${fmtPrice(m.cachedInputPrice)} / ${fmtPrice(m.outputPrice)}）</option>
                  ))}
                </Select>
              </div>
              {selected && (
                <span className="text-[10px] text-stone-400 whitespace-nowrap shrink-0">
                  {t('sources.priceOutput')} ${fmtPrice(selected.inputPrice)} / ${fmtPrice(selected.cachedInputPrice)} / ${fmtPrice(selected.outputPrice)}
                </span>
              )}
            </div>
          </div>
        );
      })}
      <Button size="sm" variant="default" onClick={add}><Plus size={13} /> {t('modelEntries.addBinding')}</Button>
    </div>
  );
}

/* ---------------- 工具 ---------------- */

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return '-';
  return String(v);
}
function priceLabel(b: { inputPrice: number | null; cachedInputPrice: number | null; outputPrice: number | null }): string {
  return `$${fmtPrice(b.inputPrice)} / $${fmtPrice(b.cachedInputPrice)} / $${fmtPrice(b.outputPrice)}`;
}
