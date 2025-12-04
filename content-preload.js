const { contextBridge, ipcRenderer } = require('electron');

// 为内容页面提供 API
contextBridge.exposeInMainWorld('browserAPI', {
  // 发送消息到首页
  sendToHome: (message) => ipcRenderer.send('content-to-home', message),

  // 从首页发送消息到其他页面
  sendToOtherPage: (message) => ipcRenderer.send('home-to-content', message),

  // 监听来自首页的消息
  onMessageFromHome: (callback) => {
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'FROM_HOME') {
        callback(event.data.data);
      }
    });
  },

  // 监听来自其他页面的消息（首页使用）
  onMessageFromOtherPage: (callback) => {
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'FROM_OTHER_PAGE') {
        callback(event.data.data);
      }
    });
  },

  // 监听来自控制面板的消息
  onMessageFromMain: (callback) => {
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'FROM_MAIN') {
        callback(event.data.data);
      }
    });
  },

  // 导航控制 API
  openNewWindow: (url) => ipcRenderer.invoke('open-new-window', url),
  navigateCurrentWindow: (url) => ipcRenderer.invoke('navigate-current-window', url)
});

// 在页面加载时注入通信代码
window.addEventListener('DOMContentLoaded', () => {
  console.log('BrowserAPI ready:', window.location.href);
});
