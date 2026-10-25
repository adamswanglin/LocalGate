import { useEffect, useMemo, useRef, useState } from 'react';
import { api, OrchestrationBinding, ModelEntry } from '../lib/api.js';
import { Button, Toggle, Badge, Modal } from './ui.js';
import { Trash2, GripVertical, RotateCcw, ArrowUp, ArrowDown, Network } from 'lucide-react';
import { t } from '../lib/i18n.js';

/**
 * 模型编排编辑器：
 * - 编排模式与手动模式（activeIndex 单选）二选一；
 * - 加入编排的绑定可拖拽 / 按钮排序（靠前优先），固定顺序不轮询（保持上游 KV cache 命中）；
 * - 绑定芯片可拖入「加入编排」列表，或拖出回「未加入编排」（编排时不参与路由）；
 * - 每个绑定可设「不可用重试时长」（分钟/小时）；
 * - 实时展示运行时健康状态（正常 / 连续失败 n 次 / 不可用剩余时间），支持一键恢复。
 */

interface RetryInput {
  value: number;
  unit: 'min' | 'hour';
}

type DragPayload = { type: 'binding'; bindingId: number } | null;

function secondsToInput(sec: number): RetryInput {
  if (sec >= 3600 && sec % 3600 === 0) return { value: sec / 3600, unit: 'hour' };
  return { value: Math.max(1, Math.round(sec / 60)), unit: 'min' };
}
function inputToSeconds(r: RetryInput): number {
  const v = Math.max(1, Math.floor(r.value) || 1);
  return r.unit === 'hour' ? v * 3600 : v * 60;
}

export default function OrchestrationEditor({
  open, onClose, channel, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  channel: ModelEntry | null;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<'manual' | 'orchestration'>('manual');
  const [orderedIds, setOrderedIds] = useState<number[]>([]);
  const [retry, setRetry] = useState<Record<number, RetryInput>>({});
  const [healthById, setHealthById] = useState<Record<number, OrchestrationBinding['health']>>({});
  const [drag, setDrag] = useState<DragPayload>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [tick, setTick] = useState(0); // 健康状态剩余时间刷新
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const bindings = channel?.bindings || [];
  const bindingById = useMemo(() => new Map(bindings.map((b) => [b.id, b])), [channel?.id, bindings.length]);

  async function refreshHealth() {
    if (!channel) return;
    try {
      const v = await api.orchestration.get(channel.id);
      const map: Record<number, OrchestrationBinding['health']> = {};
      for (const b of [...v.orchestrated, ...v.excluded]) map[b.id] = b.health;
      setHealthById(map);
    } catch { /* ignore */ }
  }

  // 打开时加载编排配置；未关闭期间轮询健康状态
  useEffect(() => {
    if (!open || !channel) return;
    setLoading(true);
    api.orchestration.get(channel.id).then((v) => {
      setMode(v.routingMode === 'orchestration' ? 'orchestration' : 'manual');
      setOrderedIds(v.orchestrated.map((b) => b.id));
      const map: Record<number, OrchestrationBinding['health']> = {};
      const retryInit: Record<number, RetryInput> = {};
      for (const b of [...v.orchestrated, ...v.excluded]) {
        map[b.id] = b.health;
        retryInit[b.id] = secondsToInput(b.retryAfterSeconds ?? 300);
      }
      setRetry(retryInit); // 整体重置，避免残留上一个入口的绑定 ID
      setHealthById(map);
      setLoading(false);
    }).catch(() => setLoading(false));
    pollRef.current = setInterval(() => { refreshHealth(); setTick((x) => x + 1); }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, channel?.id]);

  if (!channel) return null;

  /* ---------- 编辑操作 ---------- */

  const orderedIdsSet = new Set(orderedIds);
  const excluded = bindings.filter((b) => !orderedIdsSet.has(b.id));

  /** 把绑定移动到有序列表的指定位置（to = null 表示移出编排） */
  function moveBinding(bindingId: number, to: number | null) {
    setOrderedIds((prev) => {
      const without = prev.filter((id) => id !== bindingId);
      if (to == null) return without;
      const idx = Math.max(0, Math.min(to, without.length));
      return [...without.slice(0, idx), bindingId, ...without.slice(idx)];
    });
  }

  function moveOrdered(from: number, to: number) {
    setOrderedIds((prev) => {
      if (to < 0 || to >= prev.length || from === to) return prev;
      const next = [...prev];
      const [id] = next.splice(from, 1);
      next.splice(to, 0, id);
      return next;
    });
  }

  async function resetBinding(bindingId: number) {
    try {
      await api.orchestration.reset(channel.id, bindingId);
      await refreshHealth();
    } catch (e: any) { alert(e.message || 'reset failed'); }
  }

  async function save() {
    setSaving(true);
    try {
      const bindingRetry: Record<number, number> = {};
      const ownIds = new Set(bindings.map((b) => b.id));
      for (const [k, v] of Object.entries(retry)) {
        const id = Number(k);
        if (ownIds.has(id)) bindingRetry[id] = inputToSeconds(v); // 只提交当前入口的绑定
      }
      await api.orchestration.save(channel.id, {
        routingMode: mode,
        order: orderedIds,
        bindingRetry,
      });
      onSaved();
      onClose();
    } catch (e: any) {
      alert(e.message || t('common.saveFailed'));
    }
    setSaving(false);
  }

  /* ---------- 展示 ---------- */

  function healthBadge(b: ModelEntry['bindings'][0]) {
    void tick; // 依赖 tick 重渲染以刷新剩余时间
    const h = healthById[b.id];
    if (!h) return <Badge tone="green">{t('orch.healthOk')}</Badge>;
    if (h.unavailable) {
      const remain = Math.max(0, Math.ceil((h.unavailableUntil - Date.now()) / 1000));
      return (
        <Badge tone="red">
          {t('orch.healthUnavailable')} {remain >= 60 ? `${Math.floor(remain / 60)}m${remain % 60}s` : `${remain}s`}
        </Badge>
      );
    }
    if (h.consecutiveFailures > 0) {
      return <Badge tone="amber">{t('orch.healthFailing', { n: String(h.consecutiveFailures) })}</Badge>;
    }
    return <Badge tone="green">{t('orch.healthOk')}</Badge>;
  }

  function bindingChip(b: ModelEntry['bindings'][0], extra?: React.ReactNode) {
    const r = retry[b.id] ?? secondsToInput(b.retryAfterSeconds ?? 300);
    return (
      <div
        key={b.id}
        draggable
        onDragStart={() => setDrag({ type: 'binding', bindingId: b.id })}
        onDragEnd={() => { setDrag(null); setDropIndex(null); }}
        className="rounded-lg border border-stone-200 bg-white p-2.5 space-y-2 cursor-grab active:cursor-grabbing hover:border-brand-300 transition-colors"
      >
        <div className="flex items-center gap-2">
          <GripVertical size={13} className="text-stone-300 shrink-0" />
          <span className="text-xs font-medium text-stone-700 truncate flex-1">{b.sourceName}</span>
          <span className="text-[11px] font-mono text-stone-400 truncate max-w-[10rem]">{b.model}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {healthBadge(b)}
          {healthById[b.id]?.unavailable && (
            <button
              onClick={() => resetBinding(b.id)}
              className="inline-flex items-center gap-1 text-[11px] text-brand-600 hover:text-brand-700 cursor-pointer"
              title={t('orch.resetBinding')}
            >
              <RotateCcw size={11} /> {t('orch.resetNow')}
            </button>
          )}
          {extra}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-stone-400 whitespace-nowrap">{t('orch.retryAfter')}</span>
          <input
            type="number" min={1}
            value={r.value}
            onChange={(e) => setRetry((prev) => ({ ...prev, [b.id]: { ...r, value: Number(e.target.value) || 1 } }))}
            className="w-16 rounded-md border border-stone-200 px-1.5 py-1 text-xs text-stone-700 focus:outline-none focus:border-brand-500"
          />
          <select
            value={r.unit}
            onChange={(e) => setRetry((prev) => ({ ...prev, [b.id]: { ...r, unit: e.target.value as 'min' | 'hour' } }))}
            className="rounded-md border border-stone-200 px-1 py-1 text-xs text-stone-700 focus:outline-none focus:border-brand-500 cursor-pointer"
          >
            <option value="min">{t('orch.unitMin')}</option>
            <option value="hour">{t('orch.unitHour')}</option>
          </select>
        </div>
      </div>
    );
  }

  /** 有序区中单个插槽：上半空白作为「插入到第 i 位」的落点 */
  function orderedSlot(b: ModelEntry['bindings'][0], i: number) {
    return (
      <div key={b.id}>
        <div
          onDragOver={(e) => { e.preventDefault(); setDropIndex(i); }}
          onDrop={(e) => { e.preventDefault(); if (drag) moveBinding(drag.bindingId, i); setDrag(null); setDropIndex(null); }}
          className={`h-1.5 rounded transition-all ${dropIndex === i ? 'bg-brand-400 h-2.5' : ''}`}
        />
        {bindingChip(b, (
          <span className="inline-flex items-center gap-0.5 ml-auto">
            <Button size="sm" variant="ghost" onClick={() => moveOrdered(i, i - 1)} disabled={i === 0} title={t('orch.moveUp')}><ArrowUp size={13} /></Button>
            <Button size="sm" variant="ghost" onClick={() => moveOrdered(i, i + 1)} disabled={i === orderedIds.length - 1} title={t('orch.moveDown')}><ArrowDown size={13} /></Button>
            <Button size="sm" variant="ghost" onClick={() => moveBinding(b.id, null)} title={t('orch.removeOrch')}><Trash2 size={13} className="text-red-500" /></Button>
          </span>
        ))}
      </div>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={`${t('orch.title')} · ${channel.exposedModel || channel.name}`}>
      {loading ? (
        <p className="text-sm text-stone-400 py-6 text-center">{t('common.loading')}</p>
      ) : (
        <div className="space-y-4">
          {/* 模式开关 */}
          <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-3 flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Network size={14} className="text-brand-600" />
                <span className="text-sm font-medium text-stone-800">{t('orch.modeToggle')}</span>
              </div>
              <p className="text-xs text-stone-400 mt-1">{t('orch.modeHint')}</p>
            </div>
            <Toggle checked={mode === 'orchestration'} onChange={(v) => setMode(v ? 'orchestration' : 'manual')} />
          </div>

          <div className={mode === 'orchestration' ? '' : 'opacity-40 pointer-events-none'}>
            {/* 加入编排（有序） */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDropIndex(orderedIds.length); }}
              onDrop={(e) => { e.preventDefault(); if (drag) moveBinding(drag.bindingId, orderedIds.length); setDrag(null); setDropIndex(null); }}
              className="space-y-0.5"
            >
              <span className="block text-xs font-medium text-stone-500 mb-1">{t('orch.ordered')}</span>
              <p className="text-[11px] text-stone-400 mb-2">{t('orch.orderedHint')}</p>
              {orderedIds.map((id, i) => bindingById.get(id)).filter(Boolean).map((b, i) => orderedSlot(b!, i))}
              <div
                onDragOver={(e) => { e.preventDefault(); setDropIndex(orderedIds.length); }}
                onDrop={(e) => { e.preventDefault(); if (drag) moveBinding(drag.bindingId, orderedIds.length); setDrag(null); setDropIndex(null); }}
                className={`rounded transition-all ${dropIndex === orderedIds.length ? 'border-2 border-dashed border-brand-400 bg-brand-50/50' : 'border-2 border-dashed border-transparent'} ${orderedIds.length === 0 ? 'border-stone-300 p-4' : 'p-1'}`}
              >
                {orderedIds.length === 0 && <p className="text-xs text-stone-300 text-center">{t('orch.orderedEmpty')}</p>}
              </div>
            </div>

            {/* 未加入编排 */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDropIndex(null); }}
              onDrop={(e) => { e.preventDefault(); if (drag) moveBinding(drag.bindingId, null); setDrag(null); setDropIndex(null); }}
              className="mt-3 rounded-xl border border-dashed border-stone-300 bg-stone-50/40 p-3"
            >
              <span className="block text-xs font-medium text-stone-400">{t('orch.excluded')}</span>
              <p className="text-[11px] text-stone-400 mb-2">{t('orch.excludedHint')}</p>
              <div className="grid grid-cols-1 gap-2">
                {excluded.map((b) => bindingChip(b))}
                {excluded.length === 0 && <p className="text-xs text-stone-300 py-2 text-center">{t('orch.excludedEmpty')}</p>}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3">
            <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={save} disabled={saving}>{t('common.save')}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
