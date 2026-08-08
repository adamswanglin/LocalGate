// LocalGate — preload（CommonJS）
// 向渲染层暴露「是否运行在桌面壳内」的最小标识，用于启用原生样式（拖拽区、让位红绿灯）。
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('appNative', {
  isElectron: true,
  platform: process.platform,
  version: process.env.npm_package_version || '',
});
