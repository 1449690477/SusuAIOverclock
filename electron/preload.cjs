'use strict';

/**
 * preload.cjs — 受控桥接层
 *
 * 只暴露一组白名单方法。渲染层拿不到 fs / path / child_process，
 * 导入路径与历史 state 都是不可信输入；主进程在载荷操作前检查
 * 发布隔离策略和实际来源，不依赖 UI 禁用状态作为安全边界。
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
  setConsent: (id, granted) => ipcRenderer.invoke('dango:setConsent', id, Boolean(granted)),
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

  // 词库 v2（智汇AI 提示词库）
  libraryList: () => ipcRenderer.invoke('dango:libraryList'),
  libraryStats: () => ipcRenderer.invoke('dango:libraryStats'),
  libraryDetail: (index) => ipcRenderer.invoke('dango:libraryDetail', index),
  libraryTargets: () => ipcRenderer.invoke('dango:libraryTargets'),
  libraryImport: (args) => ipcRenderer.invoke('dango:libraryImport', args),
  libraryImportBatch: (args) => ipcRenderer.invoke('dango:libraryImportBatch', args),
  libraryInjections: (platformId) => ipcRenderer.invoke('dango:libraryInjections', platformId),
  libraryInjectionsAll: () => ipcRenderer.invoke('dango:libraryInjectionsAll'),
  libraryVerify: (args) => ipcRenderer.invoke('dango:libraryVerify', args),
  libraryRemove: (args) => ipcRenderer.invoke('dango:libraryRemove', args),
  libraryClearPlatform: (platformId) => ipcRenderer.invoke('dango:libraryClearPlatform', platformId),
  libraryOpenDest: (args) => ipcRenderer.invoke('dango:libraryOpenDest', args),
  copyText: (text) => ipcRenderer.invoke('dango:copyText', text),

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
