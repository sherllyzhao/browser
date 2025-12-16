const { contextBridge, ipcRenderer } = require('electron');

// 检测是否为生产环境（打包后运行）
const isProduction = process.resourcesPath && process.resourcesPath.includes('app.asar');

// 消息回调存储（单例模式 - 只保留最新的回调）
const messageCallbacks = {
  fromHome: null,
  fromOtherPage: null,
  fromMain: null
};

// 全局消息监听器（只注册一次）
window.addEventListener('message', (event) => {
  // 只处理字符串类型的 type（过滤掉抖音等第三方消息）
  if (!event.data || typeof event.data.type !== 'string') {
    // 不再输出干扰日志
    return;
  }

  console.log('[BrowserAPI] ✅ 收到有效 postMessage:', {
    origin: event.origin,
    type: event.data.type,
    data: event.data.data
  });

  switch (event.data.type) {
    case 'FROM_HOME':
      console.log('[BrowserAPI] 检测到 FROM_HOME 消息');
      if (messageCallbacks.fromHome) {
        console.log('[BrowserAPI] 调用 fromHome 回调，数据:', event.data.data);
        messageCallbacks.fromHome(event.data.data);
      } else {
        console.warn('[BrowserAPI] ⚠️ fromHome 回调未注册！');
      }
      break;
    case 'FROM_OTHER_PAGE':
      console.log('[BrowserAPI] 检测到 FROM_OTHER_PAGE 消息');
      if (messageCallbacks.fromOtherPage) {
        console.log('[BrowserAPI] 调用 fromOtherPage 回调');
        messageCallbacks.fromOtherPage(event.data.data);
      } else {
        console.warn('[BrowserAPI] ⚠️ fromOtherPage 回调未注册！');
      }
      break;
    case 'FROM_MAIN':
      console.log('[BrowserAPI] 检测到 FROM_MAIN 消息');
      if (messageCallbacks.fromMain) {
        console.log('[BrowserAPI] 调用 fromMain 回调');
        messageCallbacks.fromMain(event.data.data);
      } else {
        console.warn('[BrowserAPI] ⚠️ fromMain 回调未注册！');
      }
      break;
    default:
      console.log('[BrowserAPI] 未知消息类型:', event.data.type);
  }
});

// 为内容页面提供 API
contextBridge.exposeInMainWorld('browserAPI', {
  // 环境信息
  isProduction: isProduction,

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
  navigateCurrentWindow: (url) => ipcRenderer.invoke('navigate-current-window', url),
  closeCurrentWindow: () => ipcRenderer.invoke('close-current-window'),

  // 视频下载 API（通过主进程绕过跨域限制）
  downloadVideo: (url) => ipcRenderer.invoke('download-video', url)
});

// 在页面加载时注入通信代码
window.addEventListener('DOMContentLoaded', () => {
  console.log('BrowserAPI ready:', window.location.href);
});
