const { contextBridge, ipcRenderer } = require('electron');

// 为主窗口（控制面板）提供 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 导航控制
  navigateTo: (url) => ipcRenderer.invoke('navigate-to', url),
  refreshPage: () => ipcRenderer.invoke('refresh-page'),
  openDevTools: () => ipcRenderer.invoke('open-devtools'),
  getCurrentUrl: () => ipcRenderer.invoke('get-current-url'),
  goHome: () => ipcRenderer.invoke('go-home'),
  goBack: () => ipcRenderer.invoke('go-back'),
  goForward: () => ipcRenderer.invoke('go-forward'),

  // 新窗口模式控制
  toggleNewWindowMode: () => ipcRenderer.invoke('toggle-new-window-mode'),
  getNewWindowMode: () => ipcRenderer.invoke('get-new-window-mode'),

  // 脚本注入
  setInjectScript: (url, script) => ipcRenderer.invoke('set-inject-script', url, script),
  getInjectScript: (url) => ipcRenderer.invoke('get-inject-script', url),
  executeScriptNow: (script) => ipcRenderer.invoke('execute-script-now', script),

  // 脚本管理
  getAllScripts: () => ipcRenderer.invoke('get-all-scripts'),
  deleteScript: (url) => ipcRenderer.invoke('delete-script', url),
  clearAllScripts: () => ipcRenderer.invoke('clear-all-scripts'),
  exportScripts: () => ipcRenderer.invoke('export-scripts'),
  importScripts: () => ipcRenderer.invoke('import-scripts'),
  openScriptsFolder: () => ipcRenderer.invoke('open-scripts-folder'),

  // 事件监听
  onUrlChanged: (callback) => ipcRenderer.on('url-changed', (event, url) => callback(url)),

  // 消息通信
  sendToContent: (message) => ipcRenderer.send('main-to-content', message),

  // 通知主进程脚本面板状态变化
  toggleScriptPanel: (isOpen) => ipcRenderer.send('script-panel-toggle', isOpen),

  // Cookie 调试功能
  getCookies: () => ipcRenderer.invoke('get-cookies'),
  flushSession: () => ipcRenderer.invoke('flush-session'),
  getSessionPath: () => ipcRenderer.invoke('get-session-path')
});
