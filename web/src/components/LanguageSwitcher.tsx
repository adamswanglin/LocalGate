// 侧边栏底部语言切换器：地球图标 + 当前语种，点击弹出菜单。
import { useEffect, useRef, useState } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { useI18n } from '../lib/i18n-provider.js';
import { t, LANGUAGES } from '../lib/i18n.js';

export default function LanguageSwitcher() {
  const { setting, locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // 当前显示名：auto 时用对应语种的「跟随系统」，否则用该语种母语名
  const currentLabel =
    setting === 'auto' ? t('lang.auto') : (LANGUAGES.find((l) => l.value === locale)?.label ?? 'Auto');

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex items-center gap-1 text-[11px] text-stone-400 hover:text-brand-600 transition-colors bg-transparent border-0 cursor-pointer p-0"
        title={t('lang.label')}
      >
        <Globe size={12} />
        <span>{currentLabel}</span>
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1.5 min-w-[140px] rounded-lg border border-stone-200 bg-white shadow-lg py-1 z-50 animate-slide-up">
          {LANGUAGES.map((l) => {
            const active = l.value === setting;
            const label = l.value === 'auto' ? t('lang.auto') : l.label;
            return (
              <button
                key={l.value}
                type="button"
                onClick={() => {
                  setLocale(l.value);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[12px] border-0 cursor-pointer bg-transparent transition-colors ${
                  active ? 'text-brand-700 font-medium' : 'text-stone-600 hover:bg-stone-50'
                }`}
              >
                <span>{label}</span>
                {active && <Check size={12} className="text-brand-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
