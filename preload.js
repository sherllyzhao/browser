const { contextBridge, ipcRenderer } = require('electron');

// 检测是否为生产环境（打包后运行）
// 使用多种方式判断，确保准确
const isProduction = (() => {
  // 方法1：检查 process.defaultApp（开发环境为 true）
  if (process.defaultApp) {
    return false;
  }

  // 方法2：检查执行路径是否包含 electron（开发环境特征）
  const execPath = process.execPath.toLowerCase();
  if (execPath.includes('electron')) {
    return false;
  }

  // 方法3：检查 resourcesPath 是否包含 app.asar
  if (process.resourcesPath && process.resourcesPath.includes('app.asar')) {
    return true;
  }

  // 方法4：检查 resourcesPath 是否在 node_modules 中（开发环境特征）
  if (process.resourcesPath && process.resourcesPath.includes('node_modules')) {
    return false;
  }

  // 默认认为是生产环境（安全起见）
  return true;
})();

console.log('[preload] 环境检测:', {
  isProduction,
  defaultApp: process.defaultApp,
  execPath: process.execPath,
  resourcesPath: process.resourcesPath
});

// 为主窗口（控制面板）提供 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 环境信息
  isProduction: isProduction,

  // 导航控制
  navigateTo: (url) => ipcRenderer.invoke('navigate-to', url),
  navigateToLogin: () => ipcRenderer.invoke('navigate-to-login'),
  refreshPage: () => ipcRenderer.invoke('refresh-page'),
  openDevTools: () => ipcRenderer.invoke('open-devtools'),
  openMainDevTools: () => ipcRenderer.invoke('open-main-devtools'),
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
  onToggleHeader: (callback) => ipcRenderer.on('toggle-header', (event, show) => callback(show)),

  // 消息通信
  sendToContent: (message) => ipcRenderer.send('main-to-content', message),

  // 通知主进程脚本面板状态变化
  toggleScriptPanel: (isOpen) => ipcRenderer.send('script-panel-toggle', isOpen),

  // 通知主进程站点下拉菜单状态变化
  toggleSiteDropdown: (isOpen) => ipcRenderer.send('site-dropdown-toggle', isOpen),

  // 显示站点选择原生菜单（悬浮在所有内容之上）
  showSiteMenu: (sites, currentSiteId) => ipcRenderer.invoke('show-site-menu', sites, currentSiteId),

  // Cookie 功能
  getCookies: () => ipcRenderer.invoke('get-cookies'),
  setCookie: (cookieDetails) => ipcRenderer.invoke('set-cookie', cookieDetails),
  flushSession: () => ipcRenderer.invoke('flush-session'),
  getSessionPath: () => ipcRenderer.invoke('get-session-path'),

  // 全局数据存储（用于站点切换等场景）
  setGlobalData: (key, value) => ipcRenderer.invoke('global-storage-set', key, value),
  getGlobalData: (key) => ipcRenderer.invoke('global-storage-get', key).then(r => r.value),
  removeGlobalData: (key) => ipcRenderer.invoke('global-storage-remove', key),
  getAllGlobalData: () => ipcRenderer.invoke('global-storage-get-all').then(r => r.data)
});
