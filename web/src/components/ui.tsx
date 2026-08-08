import React, { useState } from 'react';
import { Copy, Check, X } from 'lucide-react';
import { t } from '../lib/i18n.js';

/* ───────────── Button ───────────── */

export function Button({
  children,
  variant = 'default',
  size = 'md',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
}) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none cursor-pointer select-none';
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-4 py-2 text-sm' };
  const variants = {
    default: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm',
    primary: 'bg-brand-600 hover:bg-brand-500 text-white shadow-sm shadow-brand-600/20',
    danger: 'bg-red-600 hover:bg-red-500 text-white shadow-sm shadow-red-600/20',
    ghost: 'bg-transparent hover:bg-slate-100 text-slate-500 hover:text-slate-700',
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]}`} {...props}>
      {children}
    </button>
  );
}

/* ───────────── Input ───────────── */

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className="w-full rounded-lg bg-white border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-colors"
      {...props}
    />
  );
}

/* ───────────── Select ───────────── */

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className="w-full rounded-lg bg-white border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-colors appearance-none cursor-pointer"
      {...props}
    />
  );
}

/* ───────────── Label ───────────── */

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-slate-500 mb-1.5">{children}</label>;
}

/* ───────────── Toggle ───────────── */

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${checked ? 'bg-brand-600' : 'bg-slate-300'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
    </button>
  );
}

/* ───────────── Badge ───────────── */

export function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'green' | 'red' | 'indigo' | 'amber' | 'emerald' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600 border-slate-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    indigo: 'bg-brand-50 text-brand-700 border-brand-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  return <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-tight ${tones[tone]}`}>{children}</span>;
}

/* ───────────── Card ───────────── */

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

/* ───────────── StatCard ───────────── */

export function StatCard({
  label,
  value,
  icon,
  accent = 'brand',
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent?: 'brand' | 'green' | 'amber' | 'slate';
}) {
  const accents = {
    brand: 'text-brand-600 bg-brand-50',
    green: 'text-emerald-600 bg-emerald-50',
    amber: 'text-amber-600 bg-amber-50',
    slate: 'text-slate-500 bg-slate-100',
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 flex items-center gap-3.5">
      <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${accents[accent]}`}>
        {icon}
      </div>
      <div>
        <div className="text-2xl font-semibold text-slate-800 tracking-tight">{value}</div>
        <div className="text-xs text-slate-500 mt-0.5">{label}</div>
      </div>
    </div>
  );
}

/* ───────────── Skeleton ───────────── */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function SkeletonRow({ cols = 5 }: { cols?: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="skeleton h-4" style={{ width: `${50 + Math.random() * 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

/* ───────────── Modal ───────────── */

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 backdrop-blur-sm p-4 pt-[10vh] animate-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">
          {children}
        </div>
      </div>
    </div>
  );
}

/* ───────────── EmptyState ───────────── */

export function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-slate-100 text-slate-400 mb-3">
        {icon}
      </div>
      <div className="text-sm font-medium text-slate-500">{title}</div>
      {description && <div className="text-xs text-slate-400 mt-1 max-w-[28ch]">{description}</div>}
    </div>
  );
}

/* ───────────── Helpers ───────────── */

export function prettyJson(s: string | null): string {
  if (!s) return '';
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

export function CopyButton({
  text,
  label,
  size = 13,
  className = '',
}: {
  text: string | (() => string);
  label?: string;
  size?: number;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function onCopy(e: React.MouseEvent) {
    e.stopPropagation();
    const value = typeof text === 'function' ? text() : text;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      type="button"
      onClick={onCopy}
      title={label || t('common.copy')}
      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer ${className}`}
    >
      {copied ? <Check size={size} className="text-emerald-500" /> : <Copy size={size} />}
      {label && <span>{copied ? t('common.copied') : label}</span>}
    </button>
  );
}
