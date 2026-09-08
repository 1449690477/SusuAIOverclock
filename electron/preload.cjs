'use strict';

/**
 * preload.cjs — 受控桥接层
 *
 * 只暴露一组白名单方法。渲染层拿不到 fs / path / child_process，
 * 也没办法传任意路径进来执行 —— 所有路径只能由主进程从 state 或对话框取。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dango', {
  load: () => ipcRenderer.invoke('dango:load'),
  chooseRoot: () => ipcRenderer.invoke('dango:chooseRoot'),
  clearRoot: () => ipcRenderer.invoke('dango:clearRoot'),
  refresh: () => ipcRenderer.invoke('dango:refresh'),
  openRoot: () => ipcRenderer.invoke('dango:openRoot'),
  openPack: (id) => ipcRenderer.invoke('dango:openPack', id),
  captureBaseline: (id) => ipcRenderer.invoke('dango:captureBaseline', id),
  verify: (id) => ipcRenderer.invoke('dango:verify', id),
  clearBaseline: (id) => ipcRenderer.invoke('dango:clearBaseline', id),
  exportReport: () => ipcRenderer.invoke('dango:exportReport'),
  openExternal: (url) => ipcRenderer.invoke('dango:openExternal', url),

  // 部署引擎
  detect: () => ipcRenderer.invoke('dango:detect'),
  getIcon: (id) => ipcRenderer.invoke('dango:getIcon', id),
  verifyBreak: (id) => ipcRenderer.invoke('dango:verifyBreak', id),
  verifyDeep: (id) => ipcRenderer.invoke('dango:verifyDeep', id),
  deploy: (id, action) => ipcRenderer.invoke('dango:deploy', id, action),
  cancelDeploy: () => ipcRenderer.invoke('dango:cancelDeploy'),
  backup: (id) => ipcRenderer.invoke('dango:backup', id),
  restore: (id, name) => ipcRenderer.invoke('dango:restore', id, name),
  listBackups: (id) => ipcRenderer.invoke('dango:listBackups', id),

  // 第三方破甲包导入
  chooseImportPath: (kind) => ipcRenderer.invoke('dango:chooseImportPath', kind),
  analyzeImport: (p) => ipcRenderer.invoke('dango:analyzeImport', p),
  importPackDir: (p, platformId) => ipcRenderer.invoke('dango:importPackDir', p, platformId),
  importSingleFile: (p, platformId) => ipcRenderer.invoke('dango:importSingleFile', p, platformId),
  clearImport: (platformId) => ipcRenderer.invoke('dango:clearImport', platformId),
  listImports: () => ipcRenderer.invoke('dango:listImports'),

  onLog: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('dango:log', listener);
    return () => ipcRenderer.removeListener('dango:log', listener);
  },

  onProgress: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('dango:progress', listener);
    return () => ipcRenderer.removeListener('dango:progress', listener);
  }
});
