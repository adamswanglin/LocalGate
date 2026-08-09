// LocalGate — preload（CommonJS）
// 向渲染层暴露「是否运行在桌面壳内」的最小标识，用于启用原生样式（拖拽区、让位红绿灯）。
// 同时暴露自动更新相关的 IPC 通道，供前端触发检查 / 下载 / 安装。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appNative', {
  isElectron: true,
  platform: process.platform,
  version: process.env.npm_package_version || '',
  // 操作系统首选语言列表（用于跟随系统语言；不受 Electron 打包 locale 影响）
  systemLanguages: () => ipcRenderer.sendSync('get-system-languages'),
});

// 自动更新 API：前端通过 window.updateAPI 调用
contextBridge.exposeInMainWorld('updateAPI', {
  // 触发检查更新
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  // 触发下载更新
  downloadUpdate: () => ipcRenderer.send('download-update'),
  // 安装并重启
  installUpdate: () => ipcRenderer.send('install-update'),

  // 监听更新事件
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, data) => cb(data)),
  onUpdateDownloadProgress: (cb) => ipcRenderer.on('update-download-progress', (_, data) => cb(data)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', () => cb()),
});
