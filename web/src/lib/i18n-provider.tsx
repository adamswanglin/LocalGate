// 运行时语言切换：React Context + Provider。
// `t()` / `fmtDate()` 读取 i18n.ts 的模块级镜像；Provider 在 render 期间
// 同步写回镜像，使本次渲染及其子树读到最新 locale。
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  type Locale,
  type LocaleSetting,
  loadLocaleSetting,
  saveLocaleSetting,
  resolveLocale,
  setLocaleMirror,
} from './i18n.js';

type I18nValue = {
  locale: Locale;          // 当前生效语种（'auto' 已解析）
  setting: LocaleSetting;  // 用户选择（可能为 'auto'）
  setLocale: (s: LocaleSetting) => void;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [setting, setSetting] = useState<LocaleSetting>(() => loadLocaleSetting());
  const locale = useMemo<Locale>(() => resolveLocale(setting), [setting]);

  // render 期间同步模块镜像（幂等赋值），保证本次渲染的子树读到最新 locale
  setLocaleMirror(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = (s: LocaleSetting) => {
    saveLocaleSetting(s);
    setSetting(s);
  };

  const value = useMemo<I18nValue>(() => ({ locale, setting, setLocale }), [locale, setting]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
