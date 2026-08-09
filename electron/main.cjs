// LocalGate — Electron 主进程（CommonJS）
// 将 Hono 服务作为子进程启动（ELECTRON_RUN_AS_NODE=1，复用 Electron 内置 Node，
// 与按 Electron ABI 重编的 better-sqlite3 匹配），再用 BrowserWindow 加载同源 React UI。
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { mkdirSync, appendFileSync } = require('node:fs');
const { createServer } = require('node:net');

const isDev = !app.isPackaged;

// ── 诊断日志（写入 userData，便于排查打包态静默失败） ────────────
const DEBUG_LOG = join(app.getPath('userData'), 'debug.log');
const dlog = (...args) => {
  try { appendFileSync(DEBUG_LOG, `${new Date().toISOString()} [main] ${args.join(' ')}\n`); } catch { /* ignore */ }
};
process.on('uncaughtException', (e) => dlog('uncaughtException:', e?.stack || e));
process.on('unhandledRejection', (e) => dlog('unhandledRejection:', e?.stack || e));

let serverProc = null;
let mainWin = null;     // 主窗口：macOS 关闭时隐藏而不销毁，常驻菜单栏
let tray = null;        // 菜单栏托盘图标
let isQuitting = false; // 真正退出时（Cmd+Q / 托盘菜单退出）才允许窗口关闭
let updateInfo = null;  // 可用更新信息

const isMac = process.platform === 'darwin';

// ── 环境准备（传给子进程，必须在 spawn 之前确定） ──────────────
// 数据库：打包态放 userData（跨版本持久），开发态沿用项目 .run/
const dataDir = isDev
  ? join(__dirname, '..', '.run')
  : join(app.getPath('userData'), 'data');
mkdirSync(dataDir, { recursive: true });
process.env.DB_PATH = join(dataDir, 'agent-proxy.db');

// 端口：优先 8787，被占用则自增找空闲
const BASE_PORT = Number(process.env.PORT) || 8787;

function pickPort(start) {
  return new Promise((resolve) => {
    const tryPort = (p) => {
      const srv = createServer();
      srv.unref();
      srv.on('error', () => tryPort(p + 1));
      srv.listen(p, '127.0.0.1', () => {
        const port = srv.address().port;
        srv.close(() => resolve(port));
      });
    };
    tryPort(start);
  });
}

// 等待 /health 就绪
async function waitHealth(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return true;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// 启动内嵌服务子进程
async function startServer(port) {
  const env = { ...process.env, PORT: String(port), ELECTRON_RUN_AS_NODE: '1' };
  const script = join(__dirname, '..', 'dist', 'server', 'index.js');
  const serverLog = join(dataDir, 'server.log');
  dlog('spawning server:', script, 'port=', port);
  serverProc = spawn(process.execPath, [script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  serverProc.stdout.on('data', (d) => {
    try { appendFileSync(serverLog, d.toString()); } catch { /* ignore */ }
  });
  serverProc.stderr.on('data', (d) => {
    try { appendFileSync(serverLog, d.toString()); } catch { /* ignore */ }
  });
  serverProc.on('exit', (code) => {
    dlog('server child exited, code=', code);
    serverProc = null;
  });
  return waitHealth(port);
}

function stopServer() {
  if (serverProc) {
    try { serverProc.kill(); } catch { /* ignore */ }
    serverProc = null;
  }
}

// 显示并聚焦主窗口（托盘点击 / 停靠栏点击 / 二次启动时复用）
function showWindow() {
  if (!mainWin || mainWin.isDestroyed()) return;
  if (mainWin.isMinimized()) mainWin.restore();
  if (!mainWin.isVisible()) mainWin.show();
  mainWin.focus();
}

// 创建菜单栏托盘图标（template 单色，随浅色/深色菜单栏自动适配）
function createTray() {
  const image = nativeImage.createFromPath(join(__dirname, '..', 'electron', 'trayTemplate.png'));
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip('LocalGate');
  const ctxMenu = Menu.buildFromTemplate([
    { label: '打开 LocalGate', click: showWindow },
    { type: 'separator' },
    {
      label: '退出 LocalGate',
      click: () => {
        isQuitting = true;
        app.quit(); // before-quit 中会回收服务子进程
      },
    },
  ]);
  // 左键点击打开窗口（不用 setContextMenu——它可能让左键也弹菜单而吞掉 click 事件）
  tray.on('click', showWindow);
  // 右键弹出菜单
  tray.on('right-click', () => tray.popUpContextMenu(ctxMenu));
  dlog('tray created');
}

// ── 单实例 ──────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showWindow();
  });

  app.whenReady().then(async () => {
    const PORT = await pickPort(BASE_PORT);
    const ok = await startServer(PORT);
    dlog('health ok =', ok);
    if (!ok) {
      dlog('服务健康检查超时');
      app.quit();
      return;
    }

    // 跨平台窗口选项：macOS 用隐藏标题栏 + 毛玻璃，Win/Linux 用系统标题栏
    const winOptions = {
      width: 1280,
      height: 840,
      minWidth: 960,
      minHeight: 600,
      title: 'LocalGate',
      backgroundColor: '#f6f7fb',
      show: false,
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    };
    if (isMac) {
      Object.assign(winOptions, {
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 18 },
        vibrancy: 'under-window',
        visualEffectState: 'active',
      });
    }

    const win = new BrowserWindow(winOptions);
    mainWin = win;

    win.once('ready-to-show', () => win.show());
    win.loadURL(`http://127.0.0.1:${PORT}/`);

    // 外链在系统浏览器打开
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http')) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });

    // 关闭时隐藏到菜单栏托盘，不退出（真正退出见 before-quit 的 isQuitting）
    if (isMac) {
      win.on('close', (e) => {
        if (!isQuitting) {
          e.preventDefault();
          win.hide();
        }
      });
    }

    createTray();

    // ── 自动更新检查 ──────────────────────────────────────
    autoUpdater.autoDownload = false; // 不自动下载，先通知用户
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      dlog('update available:', info.version);
      updateInfo = { version: info.version, releaseNotes: info.releaseNotes };
      // 通知前端显示更新横幅
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('update-available', { version: info.version });
      }
    });

    autoUpdater.on('update-not-available', () => {
      dlog('no update available');
    });

    autoUpdater.on('error', (err) => {
      dlog('autoUpdater error:', err?.message || err);
    });

    autoUpdater.on('download-progress', (progress) => {
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('update-download-progress', {
          percent: Math.round(progress.percent),
        });
      }
    });

    autoUpdater.on('update-downloaded', () => {
      dlog('update downloaded');
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('update-downloaded');
      }
    });

    // IPC: 前端请求检查更新
    ipcMain.on('check-for-updates', () => {
      dlog('frontend requested check for updates');
      if (!isDev) {
        autoUpdater.checkForUpdates().catch((e) => dlog('check update failed:', e?.message || e));
      }
    });

    // IPC: 前端请求下载更新
    ipcMain.on('download-update', () => {
      dlog('user requested download update');
      autoUpdater.downloadUpdate().catch((e) => dlog('download update failed:', e?.message || e));
    });

    // IPC: 前端请求安装并重启
    ipcMain.on('install-update', () => {
      dlog('user requested install & restart');
      autoUpdater.quitAndInstall();
    });

    // IPC: 同步返回操作系统首选语言列表（用于「跟随系统语言」检测）
    ipcMain.on('get-system-languages', (event) => {
      try {
        event.returnValue = app.getPreferredSystemLanguages();
      } catch (e) {
        dlog('getPreferredSystemLanguages failed:', e?.message || e);
        event.returnValue = [app.getLocale()];
      }
    });
  });

  app.on('window-all-closed', () => {
    // macOS：关窗只是隐藏，应用常驻菜单栏；其余平台保持「关窗即退出」
    if (!isMac) {
      stopServer();
      app.quit();
    }
  });

  app.on('before-quit', () => {
    isQuitting = true; // 允许窗口真正关闭
    stopServer();
  });

  app.on('activate', () => {
    // 点击 Dock 图标时恢复窗口（窗口可能处于隐藏状态）
    showWindow();
  });
}
