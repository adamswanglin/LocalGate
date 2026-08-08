// LocalGate — Electron 主进程（CommonJS）
// 将 Hono 服务作为子进程启动（ELECTRON_RUN_AS_NODE=1，复用 Electron 内置 Node，
// 与按 Electron ABI 重编的 better-sqlite3 匹配），再用 BrowserWindow 加载同源 React UI。
const { app, BrowserWindow, shell } = require('electron');
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

// ── 单实例 ──────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length) {
      const w = wins[0];
      if (w.isMinimized()) w.restore();
      w.focus();
    }
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
    const isMac = process.platform === 'darwin';
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
  });

  // 工具型应用：关窗即退出，并回收服务子进程
  app.on('window-all-closed', () => {
    stopServer();
    app.quit();
  });

  app.on('before-quit', () => {
    stopServer();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      app.whenReady().then(() => app.emit('ready'));
    }
  });
}
