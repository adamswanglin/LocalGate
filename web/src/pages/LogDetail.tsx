import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, LogDetail } from '../lib/api.js';
import { Button, Badge, Card, prettyJson, CopyButton, Skeleton } from '../components/ui.js';
import { ArrowLeft, FileText, Braces, Tag as TagIcon, X, Star } from 'lucide-react';
import {
  extractRequestMessages, extractRequestMeta, extractResponseText, extractStreamText,
  type Protocol,
} from '../lib/content.js';
import { t, fmtDate, fmtMoney } from '../lib/i18n.js';

const ROLE_TONE: Record<string, 'indigo' | 'emerald' | 'amber' | 'slate'> = {
  system: 'amber', user: 'indigo', assistant: 'emerald', tool: 'slate',
};

export default function LogDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [log, setLog] = useState<LogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [formatted, setFormatted] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try { setLog(await api.logs.detail(Number(id))); } catch {}
      setLoading(false);
    })();
  }, [id]);

  const reqObj = useMemo(() => safeParse(log?.requestBody ?? null), [log]);
  const resObj = useMemo(() => safeParse(log?.responseBody ?? null), [log]);
  const chunkArr = useMemo(() => safeParseArr(log?.responseChunks ?? null), [log]);
  const responseText = useMemo(() => {
    if (!log) return '';
    const p = log.protocol as Protocol;
    if (log.isStream) return extractStreamText(chunkArr, p);
    if (resObj) return extractResponseText(resObj, p);
    return '';
  }, [log, chunkArr, resObj]);

  if (loading) return (
    <div className="p-6 space-y-4 animate-fade-in">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-24 w-full" />
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
  if (!log) return <div className="p-6 text-slate-400">{t('detail.notFound')}</div>;

  return (
    <div className="p-6 max-w-5xl animate-fade-in">
      <Button variant="ghost" size="sm" onClick={() => navigate('/logs')} className="mb-4"><ArrowLeft size={14} /> {t('detail.back')}</Button>

      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-lg font-semibold text-slate-800 tracking-tight">{t('detail.title', { id: log.id })}</h1>
        <button
          onClick={async () => {
            const next = !log.starred;
            setLog({ ...log, starred: next });
            try { await api.logs.setStar(log.id, next); }
            catch { setLog({ ...log, starred: !next }); }
          }}
          title={log.starred ? t('logs.starOn') : t('logs.starOff')}
          className={`cursor-pointer transition-colors ${log.starred ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`}
        >
          <Star size={18} className={log.starred ? 'fill-amber-400' : ''} />
        </button>
        <Badge tone="indigo">{log.protocol}</Badge>
        {log.aborted ? <Badge tone="amber">aborted</Badge>
          : log.statusCode != null && log.statusCode < 400 ? <Badge tone="green">{log.statusCode}</Badge>
          : log.statusCode != null ? <Badge tone="red">{log.statusCode}</Badge> : null}
        {log.isStream && <Badge tone="amber">stream</Badge>}
        <div className="ml-auto inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
          <ToggleBtn active={formatted} onClick={() => setFormatted(true)} icon={<FileText size={13} />} label={t('detail.viewFormatted')} />
          <ToggleBtn active={!formatted} onClick={() => setFormatted(false)} icon={<Braces size={13} />} label={t('detail.viewRaw')} />
        </div>
      </div>

      <TagsEditor log={log} onChange={(tags) => setLog({ ...log, tags })} />

      <Card className="p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-sm">
        <Field label={t('detail.metaChannel')}>{log.channelName || `#${log.channelId}`}</Field>
        <Field label={t('detail.metaModel')}><span className="font-mono text-xs">{log.model || '-'}</span></Field>
        <Field label={t('detail.metaLatency')}>{log.latencyMs != null ? `${log.latencyMs}ms` : '-'}</Field>
        <Field label={t('detail.metaTime')}>{fmtDate(log.createdAt)}</Field>
        <Field label={t('detail.metaReqLog')}>{log.requestBody ? t('common.yes') : t('common.no')}</Field>
        <Field label={t('detail.metaResLog')}>{log.responseBody ? t('common.yes') : t('common.no')}</Field>
        {log.usage && <Field label={t('detail.metaTokens')}><pre className="text-xs text-slate-500 whitespace-pre-wrap">{JSON.stringify(log.usage)}</pre></Field>}
        <Field label={t('detail.metaCost')}>
          {log.totalCost != null ? (
            <span className="font-mono text-xs text-violet-600 font-medium">{fmtMoney(log.totalCost)}</span>
          ) : <span className="text-slate-300">-</span>}
        </Field>
        {log.error && <div className="col-span-full"><Field label={t('detail.metaError')}><pre className="text-xs text-red-700 whitespace-pre-wrap bg-red-50 rounded-lg p-3 border border-red-200">{log.error}</pre></Field></div>}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title={t('detail.sectionRequest')}
          actions={formatted && reqObj
            ? <CopyButton label={t('detail.copyBody')} text={() => dumpMessages(extractRequestMessages(reqObj, log.protocol as Protocol))} />
            : <CopyButton label={t('detail.copyJson')} text={() => prettyJson(log.requestBody)} />}
        >
          {formatted && reqObj ? <FormattedRequest req={reqObj} protocol={log.protocol as Protocol} />
            : <CodeBlock text={prettyJson(log.requestBody)} hint={hintForReq(reqObj, log.protocol)} />}
        </Section>

        <Section title={t('detail.sectionResponse')}
          actions={formatted
            ? <CopyButton label={t('detail.copyBody')} text={responseText} />
            : <CopyButton label={t('detail.copyJson')} text={() => prettyJson(log.isStream ? log.responseChunks : log.responseBody)} />}
        >
          {formatted ? (
            <FormattedResponse protocol={log.protocol as Protocol} resObj={resObj} chunks={chunkArr}
              isStream={log.isStream} rawBody={log.responseBody} rawChunks={log.responseChunks} text={responseText} />
          ) : (
            log.isStream ? (
              <div className="space-y-3">
                {log.responseChunks ? (
                  <details className="rounded-xl bg-slate-50 border border-slate-200">
                    <summary className="px-3 py-2.5 text-xs text-slate-500 cursor-pointer hover:text-slate-700">{t('detail.chunksTitle', { n: chunkArr.length })}</summary>
                    <pre className="px-3 pb-3 text-xs text-emerald-700 overflow-auto max-h-96">{prettyJson(log.responseChunks)}</pre>
                  </details>
                ) : <p className="text-xs text-slate-400 px-1">{t('detail.chunksDisabled')}</p>}
                {log.responseBody && (
                  <details className="rounded-xl bg-slate-50 border border-slate-200">
                    <summary className="px-3 py-2.5 text-xs text-slate-500 cursor-pointer hover:text-slate-700">{t('detail.rawSse')}</summary>
                    <pre className="px-3 pb-3 text-xs text-slate-600 overflow-auto max-h-80 whitespace-pre-wrap">{log.responseBody}</pre>
                  </details>
                )}
              </div>
            ) : <CodeBlock text={prettyJson(log.responseBody)} />
          )}
        </Section>
      </div>
    </div>
  );
}

/* ---------------- 标签编辑 ---------------- */

function TagsEditor({ log, onChange }: { log: LogDetail; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState('');
  const [allTags, setAllTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.logs.tags().then((r) => setAllTags(r.map((x) => x.name))).catch(() => {}); }, []);
  const tags = Array.isArray(log.tags) ? log.tags : [];

  async function persist(next: string[]) {
    setSaving(true);
    try { const r = await api.logs.setTags(log.id, next); onChange(r.tags); } catch { onChange(next); }
    setSaving(false);
  }
  function add(raw: string) {
    const t = raw.trim();
    if (!t || tags.includes(t)) { setInput(''); return; }
    const next = [...tags, t]; onChange(next); setInput(''); persist(next);
  }
  function remove(t: string) { const next = tags.filter((x) => x !== t); onChange(next); persist(next); }
  const suggestions = allTags.filter((t) => !tags.includes(t) && (!input || t.toLowerCase().includes(input.toLowerCase()))).slice(0, 6);

  return (
    <Card className="p-3 mb-4">
      <div className="flex items-start gap-2">
        <div className="flex items-center gap-1.5 text-xs text-slate-400 pt-1.5 shrink-0"><TagIcon size={13} /> {t('detail.tagsLabel')}</div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-md bg-brand-50 text-brand-700 px-2 py-0.5 text-xs">
                {t}
                <button onClick={() => remove(t)} className="text-brand-400 hover:text-brand-700 cursor-pointer"><X size={11} /></button>
              </span>
            ))}
            <input value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); add(input); }
                else if (e.key === 'Backspace' && !input && tags.length) remove(tags[tags.length - 1]);
              }}
              placeholder={tags.length ? t('detail.tagsPlaceholder') : t('detail.tagsPlaceholder2')}
              list="log-tag-suggestions"
              className="flex-1 min-w-[8rem] bg-transparent text-xs text-slate-700 placeholder-slate-400 focus:outline-none py-1"
            />
            {saving && <span className="text-[10px] text-slate-400">{t('detail.tagsSaving')}</span>}
          </div>
          {suggestions.length > 0 && input && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {suggestions.map((s) => (
                <button key={s} onClick={() => add(s)} className="inline-flex items-center gap-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600 px-1.5 py-0.5 text-[11px] cursor-pointer">
                  <TagIcon size={9} /> {s}
                </button>
              ))}
            </div>
          )}
          <datalist id="log-tag-suggestions">{allTags.map((t) => <option key={t} value={t} />)}</datalist>
        </div>
      </div>
    </Card>
  );
}

/* ---------------- 格式化视图 ---------------- */

function FormattedRequest({ req, protocol }: { req: any; protocol: Protocol }) {
  const msgs = extractRequestMessages(req, protocol);
  const meta = extractRequestMeta(req, protocol);
  return (
    <div className="space-y-3">
      {meta.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            {meta.map((m) => (
              <span key={m.k}><span className="text-slate-400">{m.k}:</span> <span className="text-slate-600 font-mono">{m.v}</span></span>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-2.5">
        {msgs.length === 0 && <p className="text-xs text-slate-400 px-1">{t('detail.noMessages')}</p>}
        {msgs.map((m, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-1.5"><Badge tone={ROLE_TONE[m.role] || 'slate'}>{m.role}</Badge></div>
            <MarkdownView>{m.text}</MarkdownView>
          </div>
        ))}
      </div>
    </div>
  );
}

function FormattedResponse({
  isStream, rawBody, rawChunks, text,
}: {
  protocol: Protocol; resObj: any; chunks: any[]; isStream: boolean;
  rawBody: string | null; rawChunks: string | null; text: string;
}) {
  if (!text.trim()) {
    return <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-400">{t('detail.noText')}</div>;
  }
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="mb-1.5"><Badge tone="emerald">assistant</Badge></div>
        <MarkdownView>{text}</MarkdownView>
      </div>
      {isStream && (
        <details className="rounded-xl bg-slate-50 border border-slate-200">
          <summary className="px-3 py-2.5 text-xs text-slate-500 cursor-pointer hover:text-slate-700">{t('detail.rawStream')}</summary>
          <div className="px-3 pb-3 space-y-2">
            {rawChunks && <pre className="text-xs text-emerald-700 overflow-auto max-h-72">{prettyJson(rawChunks)}</pre>}
            {rawBody && <pre className="text-xs text-slate-600 overflow-auto max-h-72 whitespace-pre-wrap">{rawBody}</pre>}
          </div>
        </details>
      )}
    </div>
  );
}

function MarkdownView({ children }: { children: string }) {
  return (
    <div className="prose-invert-logs text-sm text-slate-700 leading-relaxed break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]}
        components={{
          code: ({ className, children: c, ...rest }: any) => {
            const hasLang = className && /language-/.test(className);
            const isBlock = hasLang || /\n/.test(String(c));
            if (isBlock) {
              const lang = hasLang ? className.replace('language-', '') : '';
              return (
                <div className="my-2 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
                  {lang && <div className="px-3 py-1 text-[10px] text-slate-400 bg-slate-100/80 border-b border-slate-200 font-mono uppercase tracking-wide">{lang}</div>}
                  <pre className="overflow-auto p-3 text-xs text-slate-700"><code className={className} {...rest}>{c}</code></pre>
                </div>
              );
            }
            return <code className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[0.85em] text-brand-700 font-mono" {...rest}>{c}</code>;
          },
          a: ({ ...rest }) => <a className="text-brand-600 underline hover:text-brand-500" target="_blank" rel="noreferrer" {...rest} />,
          table: ({ ...rest }) => <div className="my-2 overflow-auto"><table className="border-collapse text-xs w-full" {...rest} /></div>,
          th: ({ ...rest }) => <th className="border border-slate-200 px-2.5 py-1.5 bg-slate-50 text-left font-medium text-slate-600" {...rest} />,
          td: ({ ...rest }) => <td className="border border-slate-200 px-2.5 py-1.5" {...rest} />,
          hr: ({ ...rest }) => <hr className="my-4 border-slate-200" {...rest} />,
        }}
      >{children}</ReactMarkdown>
    </div>
  );
}

function ToggleBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors cursor-pointer ${
        active ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:text-slate-600'
      }`}
    >{icon} {label}</button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-xs text-slate-400 mb-0.5">{label}</div><div className="text-slate-700">{children}</div></div>;
}

function Section({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-slate-400 uppercase tracking-wide">{title}</div>
        {actions}
      </div>
      {children}
    </div>
  );
}

function CodeBlock({ text, hint }: { text: string; hint?: string }) {
  if (!text) return <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-300">{t('detail.emptyCode')}</div>;
  return (
    <div>
      {hint && <div className="text-[11px] text-slate-400 mb-1">{hint}</div>}
      <pre className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700 overflow-auto max-h-[28rem] whitespace-pre-wrap">{text}</pre>
    </div>
  );
}

function hintForReq(reqObj: any, protocol: string) {
  if (!reqObj) return undefined;
  if (protocol === 'anthropic') return t('detail.authAnthropic');
  return t('detail.authOpenai');
}

function dumpMessages(msgs: { role: string; text: string }[]): string {
  return msgs.map((m) => `# ${m.role}\n\n${m.text}`).join('\n\n---\n\n');
}

function safeParse(s: string | null) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
function safeParseArr(s: string | null) { try { return s ? JSON.parse(s) : []; } catch { return []; } }
