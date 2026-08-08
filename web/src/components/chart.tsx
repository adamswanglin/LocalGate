import { useState } from 'react';

/** 通用数字轴格式化：千分位 / k */
export function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 10_000) return (n / 1000).toFixed(0) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
}

interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
}

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#64748b'];

/** 多系列折线图（适合按天/月的时间趋势） */
export function LineChart({ labels, series, height = 260 }: { labels: string[]; series: Series[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 760;
  const h = height;
  const pad = { top: 16, right: 16, bottom: 34, left: 48 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;

  const maxVal = Math.max(1, ...series.flatMap((s) => s.values));
  const n = labels.length;
  const xAt = (i: number) => (n <= 1 ? pad.left + innerW / 2 : pad.left + (innerW * i) / (n - 1));
  const yAt = (v: number) => pad.top + innerH - (innerH * v) / maxVal;

  const gridY = [0, 0.25, 0.5, 0.75, 1].map((p) => maxVal * p);
  const xTickStride = Math.max(1, Math.ceil(n / 8));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {/* y 网格 */}
      {gridY.map((v, i) => (
        <g key={i}>
          <line x1={pad.left} y1={yAt(v)} x2={w - pad.right} y2={yAt(v)} stroke="#f1f5f9" strokeWidth={1} />
          <text x={pad.left - 8} y={yAt(v) + 3} textAnchor="end" className="fill-slate-400" fontSize={10}>{fmtNum(v)}</text>
        </g>
      ))}
      {/* x 轴标签 */}
      {labels.map((lb, i) => (
        i % xTickStride === 0 ? <text key={i} x={xAt(i)} y={h - pad.bottom + 16} textAnchor="middle" className="fill-slate-400" fontSize={10}>{lb}</text> : null
      ))}
      {/* 折线 */}
      {series.map((s) => (
        <g key={s.key}>
          <path
            d={s.values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(v)}`).join(' ')}
            fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
          />
          {s.values.map((v, i) => (
            <circle key={i} cx={xAt(i)} cy={yAt(v)} r={hover === i ? 3.5 : 2} fill={s.color} />
          ))}
        </g>
      ))}
      {/* hover 覆盖区 */}
      {labels.map((_, i) => (
        <rect
          key={i} x={xAt(i) - innerW / (2 * Math.max(1, n - 1))} y={pad.top}
          width={innerW / Math.max(1, n - 1)} height={innerH} fill="transparent"
          onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
        />
      ))}
      {hover != null && (
        <line x1={xAt(hover)} y1={pad.top} x2={xAt(hover)} y2={pad.top + innerH} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3 3" />
      )}
      {/* tooltip */}
      {hover != null && (() => {
        const tipW = 132; const tipH = 18 + series.length * 14;
        let tx = xAt(hover) + 8; if (tx + tipW > w - pad.right) tx = xAt(hover) - tipW - 8;
        const ty = pad.top + 6;
        return (
          <g pointerEvents="none">
            <rect x={tx} y={ty} width={tipW} height={tipH} rx={6} fill="white" stroke="#e2e8f0" />
            <text x={tx + 8} y={ty + 13} className="fill-slate-500" fontSize={10} fontWeight={600}>{labels[hover]}</text>
            {series.map((s, si) => (
              <g key={s.key}>
                <circle cx={tx + 12} cy={ty + 26 + si * 14} r={3} fill={s.color} />
                <text x={tx + 20} y={ty + 29 + si * 14} className="fill-slate-600" fontSize={10}>{s.label} {fmtNum(s.values[hover])}</text>
              </g>
            ))}
          </g>
        );
      })()}
    </svg>
  );
}

/** 多系列柱状图（适合按源/通道/模型的对比） */
export function BarChart({ labels, series, height = 260 }: { labels: string[]; series: Series[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 760;
  const h = height;
  const pad = { top: 16, right: 16, bottom: 50, left: 48 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;

  const maxVal = Math.max(1, ...series.flatMap((s) => s.values));
  const n = labels.length;
  const groupW = n > 0 ? innerW / n : innerW;
  const barW = Math.min(28, (groupW * 0.7) / Math.max(1, series.length));
  const yAt = (v: number) => pad.top + innerH - (innerH * v) / maxVal;
  const gridY = [0, 0.25, 0.5, 0.75, 1].map((p) => maxVal * p);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {gridY.map((v, i) => (
        <g key={i}>
          <line x1={pad.left} y1={yAt(v)} x2={w - pad.right} y2={yAt(v)} stroke="#f1f5f9" strokeWidth={1} />
          <text x={pad.left - 8} y={yAt(v) + 3} textAnchor="end" className="fill-slate-400" fontSize={10}>{fmtNum(v)}</text>
        </g>
      ))}
      {labels.map((lb, i) => {
        const gx = pad.left + groupW * i + groupW / 2;
        const totalBars = series.length;
        const startX = gx - (barW * totalBars) / 2 - (totalBars - 1) * 2 / 2;
        return (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {series.map((s, si) => {
              const v = s.values[i];
              const bx = startX + si * (barW + 2);
              const by = yAt(v);
              return <rect key={s.key} x={bx} y={by} width={barW} height={pad.top + innerH - by} fill={s.color} rx={2} opacity={hover == null || hover === i ? 1 : 0.4} />;
            })}
            <text x={gx} y={h - pad.bottom + 16} textAnchor="middle" className="fill-slate-400" fontSize={10}>{lb.length > 14 ? lb.slice(0, 13) + '…' : lb}</text>
          </g>
        );
      })}
      {/* legend */}
      <g transform={`translate(${pad.left}, ${h - 16})`}>
        {series.map((s, si) => (
          <g key={s.key} transform={`translate(${si * 110}, 0)`}>
            <rect width={10} height={10} rx={2} fill={s.color} />
            <text x={15} y={9} className="fill-slate-500" fontSize={10}>{s.label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

export { COLORS };

/** 多系列堆叠柱状图：同组内各 series 纵向累加。适合「行维度 × 列维度」的构成分析。 */
export function StackedBarChart({ labels, series, height = 300 }: { labels: string[]; series: Series[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 780;
  const h = height;
  const pad = { top: 16, right: 16, bottom: 60, left: 52 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;

  const n = labels.length;
  // 每组的累加值
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] || 0), 0));
  const maxVal = Math.max(1, ...totals);
  const groupW = n > 0 ? innerW / n : innerW;
  const barW = Math.min(40, groupW * 0.6);
  const yAt = (v: number) => pad.top + innerH - (innerH * v) / maxVal;
  const gridY = [0, 0.25, 0.5, 0.75, 1].map((p) => maxVal * p);
  const xTickStride = Math.max(1, Math.ceil(n / 10));
  // 图例最多显示条数（过多时只显示前 N 个）
  const legendMax = Math.min(series.length, 12);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {gridY.map((v, i) => (
        <g key={i}>
          <line x1={pad.left} y1={yAt(v)} x2={w - pad.right} y2={yAt(v)} stroke="#f1f5f9" strokeWidth={1} />
          <text x={pad.left - 8} y={yAt(v) + 3} textAnchor="end" className="fill-slate-400" fontSize={10}>{fmtNum(v)}</text>
        </g>
      ))}
      {labels.map((lb, i) => {
        const gx = pad.left + groupW * i + groupW / 2;
        let acc = 0; // 自下而上累加
        const segs = series.map((s) => {
          const v = s.values[i] || 0;
          const bottom = acc;
          acc += v;
          return { s, v, bottom, top: acc };
        });
        return (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {segs.map((seg, si) => {
              const yTop = yAt(seg.top);
              const yBottom = yAt(seg.bottom);
              const ht = Math.max(0, yBottom - yTop);
              return seg.v > 0 ? (
                <rect key={seg.s.key + si} x={gx - barW / 2} y={yTop} width={barW} height={ht}
                  fill={seg.s.color} rx={1.5}
                  opacity={hover == null || hover === i ? 0.92 : 0.35} />
              ) : null;
            })}
            {i % xTickStride === 0 && (
              <text x={gx} y={h - pad.bottom + 16} textAnchor="middle" className="fill-slate-400" fontSize={10}>
                {String(lb).length > 14 ? String(lb).slice(0, 13) + '…' : String(lb)}
              </text>
            )}
          </g>
        );
      })}
      {/* tooltip */}
      {hover != null && (() => {
        const tipW = 150; const tipH = 20 + Math.min(series.length, 8) * 14;
        let tx = pad.left + groupW * hover + groupW / 2 + 8; if (tx + tipW > w - pad.right) tx = pad.left + groupW * hover + groupW / 2 - tipW - 8;
        const ty = pad.top + 6;
        const shown = series.filter((s) => (s.values[hover] || 0) > 0).slice(0, 8);
        const total = totals[hover];
        return (
          <g pointerEvents="none">
            <rect x={tx} y={ty} width={tipW} height={tipH} rx={6} fill="white" stroke="#e2e8f0" />
            <text x={tx + 8} y={ty + 13} className="fill-slate-500" fontSize={10} fontWeight={600}>{labels[hover]} · {fmtNum(total)}</text>
            {shown.map((s, si) => (
              <g key={s.key}>
                <circle cx={tx + 12} cy={ty + 26 + si * 14} r={3} fill={s.color} />
                <text x={tx + 20} y={ty + 29 + si * 14} className="fill-slate-600" fontSize={10}>{s.label} {fmtNum(s.values[hover])}</text>
              </g>
            ))}
          </g>
        );
      })()}
      {/* legend */}
      <g transform={`translate(${pad.left}, ${h - 18})`}>
        {series.slice(0, legendMax).map((s, si) => (
          <g key={s.key} transform={`translate(${(si % 6) * 120}, ${Math.floor(si / 6) * -14})`}>
            <rect width={10} height={10} rx={2} fill={s.color} />
            <text x={15} y={9} className="fill-slate-500" fontSize={10}>{s.label.length > 12 ? s.label.slice(0, 11) + '…' : s.label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}
