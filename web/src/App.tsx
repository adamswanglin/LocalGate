import { useState, useEffect } from 'react';
import { NavLink, Routes, Route, Navigate } from 'react-router-dom';
import { Plug, KeyRound, ScrollText, BarChart3, ExternalLink, Download, RefreshCw, X, Github } from 'lucide-react';
import { t } from './lib/i18n.js';
import { useI18n } from './lib/i18n-provider.js';
import LanguageSwitcher from './components/LanguageSwitcher.js';
import SourcesPage from './pages/Sources.js';
import ModelEntriesPage from './pages/ModelEntries.js';
import LogsPage from './pages/Logs.js';
import LogDetailPage from './pages/LogDetail.js';
import StatsPage from './pages/Stats.js';

const nav = [
  { to: '/sources', label: 'nav.sources', desc: 'nav.sourcesDesc', icon: Plug },
  { to: '/model-entries', label: 'nav.modelEntries', desc: 'nav.modelEntriesDesc', icon: KeyRound },
  { to: '/logs', label: 'nav.logs', desc: 'nav.logsDesc', icon: ScrollText },
  { to: '/stats', label: 'nav.stats', desc: 'nav.statsDesc', icon: BarChart3 },
];

const isElectron =
  typeof window !== 'undefined' && (window as any).appNative?.isElectron === true;
const isMac =
  typeof window !== 'undefined' && (window as any).appNative?.platform === 'darwin';

type UpdateState =
  | { status: 'idle' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; percent: number }
  | { status: 'downloaded' };

export default function App() {
  const { locale } = useI18n();
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' });

  useEffect(() => {
    if (!isElectron || !(window as any).updateAPI) return;
    const api = (window as any).updateAPI;
    api.onUpdateAvailable(({ version }: { version: string }) => {
      setUpdate({ status: 'available', version });
    });
    api.onUpdateDownloadProgress(({ percent }: { percent: number }) => {
      setUpdate({ status: 'downloading', percent });
    });
    api.onUpdateDownloaded(() => {
      setUpdate({ status: 'downloaded' });
    });
  }, []);

  const handleCheckUpdate = () => {
    if ((window as any).updateAPI) {
      (window as any).updateAPI.checkForUpdates();
    }
  };

  const handleDownload = () => {
    if ((window as any).updateAPI) {
      (window as any).updateAPI.downloadUpdate();
    }
  };

  const handleInstall = () => {
    if ((window as any).updateAPI) {
      (window as any).updateAPI.installUpdate();
    }
  };

  return (
    <div className={`flex flex-col h-screen ${isElectron ? 'is-electron' : ''} ${isMac ? 'is-mac' : ''}`}>
      {/* 桌面壳：macOS 用自定义可拖拽标题栏，Win/Linux 用系统标题栏 */}
      {isElectron && isMac && (
        <div className="title-bar">
          <span className="title-bar__title">{t('app.name')}</span>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-60 shrink-0 bg-white border-r border-stone-200 flex flex-col">
          {/* Brand */}
          <div className="px-5 py-5 border-b border-stone-100">
            <div className="flex items-center gap-2.5">
              <img src="/favicon.svg" alt="" className="w-8 h-8 rounded-lg" />
              <div>
                <div className="text-sm font-semibold text-stone-800 tracking-tight">{t('app.name')}</div>
                <div className="text-[11px] text-stone-400">{t('app.tagline')}</div>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to}>
                {({ isActive }) => (
                  <div
                    className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-150 cursor-pointer no-underline ${
                      isActive
                        ? 'bg-brand-50 text-brand-700'
                        : 'text-stone-500 hover:bg-stone-50 hover:text-stone-700'
                    }`}
                  >
                    <n.icon size={17} strokeWidth={1.75} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{t(n.label)}</div>
                      <div className={`text-[11px] truncate ${isActive ? 'text-brand-500' : 'text-stone-400 group-hover:text-stone-400'}`}>{t(n.desc)}</div>
                    </div>
                  </div>
                )}
              </NavLink>
            ))}
          </nav>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-stone-100 space-y-2">
            <div className="flex items-center justify-between">
              <a
                href="https://github.com/adamswanglin/LocalGate"
                target="_blank"
                rel="noreferrer"
                className="group flex items-center text-stone-400 hover:text-brand-600 transition-colors no-underline"
                title="github.com/adamswanglin/LocalGate"
              >
                <Github size={16} />
              </a>
              <div className="flex items-center gap-3">
                <LanguageSwitcher />
                {isElectron && (
                  <button
                    onClick={handleCheckUpdate}
                    className="group flex items-center gap-1 text-[11px] text-stone-400 hover:text-brand-600 transition-colors no-underline bg-transparent border-0 cursor-pointer p-0"
                    title={t('update.checking')}
                  >
                    <RefreshCw size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto bg-stone-50/50 flex flex-col">
          {/* Update banner */}
          {isElectron && update.status !== 'idle' && (
            <UpdateBanner state={update} onDownload={handleDownload} onInstall={handleInstall} onDismiss={() => setUpdate({ status: 'idle' })} />
          )}
          <div className="flex-1 overflow-auto">
          <Routes key={locale}>
            <Route path="/" element={<Navigate to="/sources" replace />} />
            <Route path="/sources" element={<SourcesPage />} />
            <Route path="/model-entries" element={<ModelEntriesPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/logs/:id" element={<LogDetailPage />} />
            <Route path="/stats" element={<StatsPage />} />
          </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

function UpdateBanner({
  state,
  onDownload,
  onInstall,
  onDismiss,
}: {
  state: UpdateState;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  if (state.status === 'available') {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-brand-50 border-b border-brand-200 text-sm animate-slide-up">
        <Download size={15} className="text-brand-600 shrink-0" />
        <span className="text-brand-800 flex-1">{t('update.available', { version: state.version })}</span>
        <button onClick={onDownload} className="px-2.5 py-1 rounded-md bg-brand-600 text-white text-xs font-medium hover:bg-brand-700 transition-colors border-0 cursor-pointer">
          {t('update.download')}
        </button>
        <button onClick={onDismiss} className="p-1 rounded hover:bg-brand-100 text-brand-500 transition-colors border-0 bg-transparent cursor-pointer">
          <X size={14} />
        </button>
      </div>
    );
  }

  if (state.status === 'downloading') {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-brand-50 border-b border-brand-200 text-sm">
        <RefreshCw size={15} className="text-brand-600 shrink-0 animate-spin" />
        <span className="text-brand-800 flex-1">{t('update.downloading', { percent: state.percent })}</span>
        <div className="w-24 h-1.5 bg-brand-200 rounded-full overflow-hidden">
          <div className="h-full bg-brand-600 rounded-full transition-all duration-300" style={{ width: `${state.percent}%` }} />
        </div>
      </div>
    );
  }

  if (state.status === 'downloaded') {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-emerald-50 border-b border-emerald-200 text-sm animate-slide-up">
        <RefreshCw size={15} className="text-emerald-600 shrink-0" />
        <span className="text-emerald-800 flex-1">{t('update.ready')}</span>
        <button onClick={onInstall} className="px-2.5 py-1 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors border-0 cursor-pointer">
          {t('update.install')}
        </button>
        <button onClick={onDismiss} className="p-1 rounded hover:bg-emerald-100 text-emerald-500 transition-colors border-0 bg-transparent cursor-pointer">
          <X size={14} />
        </button>
      </div>
    );
  }

  return null;
}
