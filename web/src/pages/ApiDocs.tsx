import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { Button, Card, Badge, CopyButton, Skeleton } from '../components/ui.js';
import { BookOpen, Braces, FileText, Globe, Lock, Layers, Terminal } from 'lucide-react';
import { t } from '../lib/i18n.js';

/* ---------------- OpenAPI 解析辅助 ---------------- */

function resolveSchemaRef(spec: any, schema: any): any | null {
  if (!schema) return null;
  if (schema.$ref?.startsWith('#/components/schemas/')) {
    const name = schema.$ref.slice('#/components/schemas/'.length);
    return spec.components?.schemas?.[name] || null;
  }
  return schema;
}

function fieldTypeLabel(prop: any, spec: any): string {
  if (prop.$ref) return prop.$ref.split('/').pop() || 'object';
  if (prop.oneOf || prop.anyOf) {
    return (prop.oneOf || prop.anyOf).map((a: any) => fieldTypeLabel(a, spec)).join(' / ');
  }
  if (prop.type === 'array') {
    const inner = prop.items?.$ref
      ? prop.items.$ref.split('/').pop()
      : prop.items?.type || 'any';
    return `${inner}[]`;
  }
  return prop.type || 'any';
}

/** object 类型 JSON Schema → 字段行（解析 $ref） */
function schemaFields(spec: any, schema: any): Array<{ name: string; type: string; required: boolean; desc: string }> {
  const resolved = resolveSchemaRef(spec, schema);
  if (!resolved || resolved.type !== 'object' || !resolved.properties) return [];
  const required = new Set<string>(Array.isArray(resolved.required) ? resolved.required : []);
  return Object.entries<any>(resolved.properties).map(([name, prop]) => ({
    name,
    type: fieldTypeLabel(prop, spec),
    required: required.has(name),
    desc: String(prop.description ?? ''),
  }));
}

/* ---------------- 页面 ---------------- */

export default function ApiDocsPage() {
  const [spec, setSpec] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mdCopied, setMdCopied] = useState(false);
  const [jsonCopied, setJsonCopied] = useState(false);

  async function load() {
    setError(null);
    try {
      setSpec(await api.docs.openapi());
    } catch (e: any) {
      setError(e.message || t('docs.loadFailed'));
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const endpoints = useMemo(() => {
    if (!spec?.paths) return [];
    const list: Array<{ path: string; method: string; op: any }> = [];
    for (const [path, pathItem] of Object.entries<any>(spec.paths)) {
      for (const [method, op] of Object.entries<any>(pathItem)) {
        list.push({ path, method, op });
      }
    }
    return list;
  }, [spec]);

  const baseUrls = useMemo(() => (spec?.servers || []).map((s: any) => s.url), [spec]);
  const models: string[] = spec?.['x-models'] || [];
  const auth: any = spec?.['x-auth'];

  async function copyMarkdown() {
    try {
      const md = await api.docs.markdown();
      await navigator.clipboard.writeText(md);
      setMdCopied(true);
      setTimeout(() => setMdCopied(false), 1500);
    } catch {
      alert(t('docs.copyFailed'));
    }
  }
  async function copyOpenapi() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(spec, null, 2));
      setJsonCopied(true);
      setTimeout(() => setJsonCopied(false), 1500);
    } catch {
      alert(t('docs.copyFailed'));
    }
  }

  return (
    <div className="p-6 animate-fade-in">
      {/* 标题 + 操作 */}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-stone-800 tracking-tight">{t('docs.title')}</h1>
          <p className="text-sm text-stone-500 mt-1">{t('docs.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="default" onClick={copyMarkdown}>
            {mdCopied ? <FileText size={14} className="text-emerald-500" /> : <FileText size={14} />}
            {mdCopied ? t('common.copied') : t('docs.copyMarkdown')}
          </Button>
          <Button size="sm" variant="default" onClick={copyOpenapi}>
            {jsonCopied ? <Braces size={14} className="text-emerald-500" /> : <Braces size={14} />}
            {jsonCopied ? t('common.copied') : t('docs.copyOpenapi')}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="p-6 mb-4 text-sm text-red-600">{error}</Card>
      )}

      {!spec && !error && (
        <Card className="p-6">
          <div className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-4 w-56" />
          </div>
        </Card>
      )}

      {spec && (
        <div className="space-y-4">
          {/* 接入地址 */}
          <Card className="p-4">
            <div className="flex items-center gap-2 text-stone-500 mb-2.5">
              <Globe size={15} /><span className="text-xs font-medium uppercase tracking-wider">{t('docs.baseUrls')}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {baseUrls.map((u: string) => (
                <div key={u} className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5">
                  <code className="text-xs font-mono text-stone-600">{u}</code>
                  <CopyButton text={u} label={t('common.copy')} />
                </div>
              ))}
            </div>
            <div className="mt-2 text-[11px] font-mono text-stone-400">
              <span className="text-stone-500">{t('docs.specEndpoints')}：</span>
              <a className="underline hover:text-brand-600" href="/openapi.json">/openapi.json</a>
              <span className="mx-1">·</span>
              <a className="underline hover:text-brand-600" href="/openapi.md">/openapi.md</a>
            </div>
          </Card>

          {/* 认证 */}
          <Card className="p-4">
            <div className="flex items-center gap-2 text-stone-500 mb-2.5">
              <Lock size={15} /><span className="text-xs font-medium uppercase tracking-wider">{t('docs.auth')}</span>
            </div>
            <p className="text-sm text-stone-600 leading-relaxed">{auth?.note || t('docs.authLoading')}</p>
            {auth?.enabled && auth?.methods?.length > 0 && (
              <table className="w-full text-sm mt-3">
                <thead className="bg-stone-50 text-stone-500 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">{t('docs.method')}</th>
                    <th className="text-left px-3 py-2 font-medium">{t('docs.header')}</th>
                    <th className="text-left px-3 py-2 font-medium">{t('docs.value')}</th>
                    <th className="text-left px-3 py-2 font-medium">{t('docs.appliesTo')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {auth.methods.map((m: any, i: number) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-stone-700">{m.name}</td>
                      <td className="px-3 py-2"><code className="font-mono text-xs text-stone-600">{m.header}</code></td>
                      <td className="px-3 py-2"><code className="font-mono text-xs text-stone-600">{m.value}</code></td>
                      <td className="px-3 py-2 text-xs text-stone-500">
                        {m.appliesTo?.map((p: string) => <code key={p} className="font-mono text-stone-500 mr-1.5">{p}</code>)}
                        {m.extra && <span className="text-amber-600">{m.extra}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {/* 当前可用对外模型 */}
          {models.length > 0 && (
            <Card className="p-4">
              <div className="flex items-center gap-2 text-stone-500 mb-2.5">
                <Layers size={15} /><span className="text-xs font-medium uppercase tracking-wider">{t('docs.models')}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {models.map((m: string) => (
                  <Badge key={m} tone="indigo"><code className="font-mono">{m}</code></Badge>
                ))}
              </div>
            </Card>
          )}

          {/* 接口列表 */}
          <div className="flex items-center gap-2 text-stone-500 pt-1">
            <BookOpen size={15} /><span className="text-xs font-medium uppercase tracking-wider">{t('docs.endpoints')}</span>
          </div>
          {endpoints.map(({ path, method, op }) => (
            <EndpointCard key={`${method}-${path}`} path={path} method={method} op={op} spec={spec} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- 单个接口卡片 ---------------- */

function EndpointCard({ path, method, op, spec }: { path: string; method: string; op: any; spec: any }) {
  const bodySchema = op.requestBody?.content?.['application/json']?.schema;
  const bodyFields = bodySchema ? schemaFields(spec, bodySchema) : [];
  const responses: Array<[string, any]> = Object.entries<any>(op.responses || {});

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-stone-100">
        <div className="flex items-start gap-3 min-w-0">
          <span className="mt-0.5 inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
            {method.toUpperCase()}
          </span>
          <div className="min-w-0">
            <code className="text-sm font-mono text-stone-800 break-all">{path}</code>
            {op.summary && <div className="text-sm text-stone-700 font-medium mt-0.5">{op.summary}</div>}
          </div>
        </div>
        {op['x-curl'] && <CopyButton text={op['x-curl']} label={t('docs.copyCurl')} className="shrink-0" />}
      </div>

      <div className="px-5 py-4 space-y-5">
        {op.description && (
          <p className="text-sm text-stone-600 leading-relaxed">{op.description}</p>
        )}

        {op['x-curl'] && (
          <div>
            <SectionTitle icon={<Terminal size={13} />}>{t('docs.curl')}</SectionTitle>
            <pre className="rounded-xl bg-stone-900 text-stone-100 text-xs font-mono p-4 overflow-x-auto whitespace-pre leading-relaxed">{op['x-curl']}</pre>
          </div>
        )}

        {bodyFields.length > 0 && (
          <div>
            <SectionTitle>{t('docs.requestBody')}</SectionTitle>
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-stone-500 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">{t('docs.field')}</th>
                  <th className="text-left px-3 py-2 font-medium">{t('docs.type')}</th>
                  <th className="text-left px-3 py-2 font-medium">{t('docs.required')}</th>
                  <th className="text-left px-3 py-2 font-medium">{t('docs.desc')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {bodyFields.map((f) => (
                  <tr key={f.name} className="align-top">
                    <td className="px-3 py-2"><code className="font-mono text-xs text-stone-700">{f.name}</code></td>
                    <td className="px-3 py-2"><code className="font-mono text-xs text-stone-400">{f.type}</code></td>
                    <td className="px-3 py-2 text-xs text-stone-500">{f.required ? t('common.yes') : t('common.no')}</td>
                    <td className="px-3 py-2 text-xs text-stone-500 leading-relaxed">{f.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {responses.length > 0 && (
          <div>
            <SectionTitle>{t('docs.responses')}</SectionTitle>
            <ul className="space-y-1.5">
              {responses.map(([status, resp]) => {
                const cts: string[] = resp.content ? Object.keys(resp.content) : [];
                return (
                  <li key={status} className="flex items-start gap-2 text-sm text-stone-600">
                    <Badge tone={status.startsWith('2') ? 'green' : status.startsWith('4') ? 'amber' : 'slate'}>{status}</Badge>
                    <span className="leading-tight">{resp.description}</span>
                    {cts.length > 0 && <span className="text-stone-400 text-xs leading-tight">（{cts.join(', ')}）</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function SectionTitle({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-stone-400 text-[11px] font-semibold uppercase tracking-wider mb-2">
      {icon}{children}
    </div>
  );
}
