import { NavLink, Routes, Route, Navigate } from 'react-router-dom';
import { Plug, KeyRound, ScrollText, BarChart3 } from 'lucide-react';
import { t } from './lib/i18n.js';
import SourcesPage from './pages/Sources.js';
import ChannelsPage from './pages/Channels.js';
import LogsPage from './pages/Logs.js';
import LogDetailPage from './pages/LogDetail.js';
import StatsPage from './pages/Stats.js';

const nav = [
  { to: '/sources', label: 'nav.sources', desc: 'nav.sourcesDesc', icon: Plug },
  { to: '/channels', label: 'nav.channels', desc: 'nav.channelsDesc', icon: KeyRound },
  { to: '/logs', label: 'nav.logs', desc: 'nav.logsDesc', icon: ScrollText },
  { to: '/stats', label: 'nav.stats', desc: 'nav.statsDesc', icon: BarChart3 },
];

const isElectron =
  typeof window !== 'undefined' && (window as any).appNative?.isElectron === true;
const isMac =
  typeof window !== 'undefined' && (window as any).appNative?.platform === 'darwin';

export default function App() {
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
        <aside className="w-60 shrink-0 bg-white border-r border-slate-200 flex flex-col">
          {/* Brand */}
          <div className="px-5 py-5 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-brand-50 text-brand-600">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-800 tracking-tight">{t('app.name')}</div>
                <div className="text-[11px] text-slate-400">{t('app.tagline')}</div>
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
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                    }`}
                  >
                    <n.icon size={17} strokeWidth={1.75} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{t(n.label)}</div>
                      <div className={`text-[11px] truncate ${isActive ? 'text-brand-500' : 'text-slate-400 group-hover:text-slate-400'}`}>{t(n.desc)}</div>
                    </div>
                  </div>
                )}
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto bg-slate-50/50">
          <Routes>
            <Route path="/" element={<Navigate to="/sources" replace />} />
            <Route path="/sources" element={<SourcesPage />} />
            <Route path="/channels" element={<ChannelsPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/logs/:id" element={<LogDetailPage />} />
            <Route path="/stats" element={<StatsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
