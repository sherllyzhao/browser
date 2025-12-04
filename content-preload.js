const { contextBridge, ipcRenderer } = require('electron');

// 消息回调存储（单例模式 - 只保留最新的回调）
const messageCallbacks = {
  fromHome: null,
  fromOtherPage: null,
  fromMain: null
};

// 全局消息监听器（只注册一次）
window.addEventListener('message', (event) => {
  if (!event.data || !event.data.type) return;

  switch (event.data.type) {
    case 'FROM_HOME':
      if (messageCallbacks.fromHome) {
        console.log('[BrowserAPI] 收到 FROM_HOME 消息:', event.data.data);
        messageCallbacks.fromHome(event.data.data);
      }
      break;
    case 'FROM_OTHER_PAGE':
      if (messageCallbacks.fromOtherPage) {
        console.log('[BrowserAPI] 收到 FROM_OTHER_PAGE 消息:', event.data.data);
        messageCallbacks.fromOtherPage(event.data.data);
      }
      break;
    case 'FROM_MAIN':
      if (messageCallbacks.fromMain) {
        console.log('[BrowserAPI] 收到 FROM_MAIN 消息:', event.data.data);
        messageCallbacks.fromMain(event.data.data);
      }
      break;
  }
});

// 为内容页面提供 API
contextBridge.exposeInMainWorld('browserAPI', {
  // 发送消息到首页
  sendToHome: (message) => {
    console.log('[BrowserAPI] 发送消息到首页:', message);
    ipcRenderer.send('content-to-home', message);
  },

  // 从首页发送消息到其他页面
  sendToOtherPage: (message) => {
    console.log('[BrowserAPI] 发送消息到其他页面:', message);
    ipcRenderer.send('home-to-content', message);
  },

  // 监听来自首页的消息
  onMessageFromHome: (callback) => {
    messageCallbacks.fromHome = callback;
    console.log('[BrowserAPI] onMessageFromHome 监听器已注册/更新');
  },

  // 监听来自其他页面的消息（首页使用）
  onMessageFromOtherPage: (callback) => {
    messageCallbacks.fromOtherPage = callback;
    console.log('[BrowserAPI] onMessageFromOtherPage 监听器已注册/更新');
  },

  // 监听来自控制面板的消息
  onMessageFromMain: (callback) => {
    messageCallbacks.fromMain = callback;
    console.log('[BrowserAPI] onMessageFromMain 监听器已注册/更新');
  },

  // 清除所有监听器（用于组件卸载）
  clearMessageListeners: () => {
    messageCallbacks.fromHome = null;
    messageCallbacks.fromOtherPage = null;
    messageCallbacks.fromMain = null;
    console.log('[BrowserAPI] 所有消息监听器已清除');
  },

  // 导航控制 API
  openNewWindow: (url) => ipcRenderer.invoke('open-new-window', url),
  navigateCurrentWindow: (url) => ipcRenderer.invoke('navigate-current-window', url)
});

// 在页面加载时注入通信代码
window.addEventListener('DOMContentLoaded', () => {
  console.log('BrowserAPI ready:', window.location.href);
});
