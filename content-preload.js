const { contextBridge, ipcRenderer, webFrame } = require('electron');

// 🔑 搜狐号 toPath 处理 - 在页面脚本执行之前注入
// 这必须在最开始执行，因为搜狐号的页面代码会在加载时读取 toPath
(function injectSohuToPathFix() {
  try {
    // 检查当前 URL 是否是搜狐号
    // 注意：preload 脚本执行时 window.location 可能还不可用，所以我们无条件注入
    // 脚本内部会检查域名
    const sohuToPathScript = `
      (function() {
        'use strict';
        // 只在搜狐号域名下执行
        if (!window.location.href.includes('mp.sohu.com')) {
          return;
        }

        console.log('[搜狐号-preload] 🛡️ 在页面脚本执行之前设置 toPath');

        try {
          const PUBLISH_PAGE_PATH = '/contentManagement/news/addarticle';
          const currentToPath = localStorage.getItem('toPath');
          console.log('[搜狐号-preload] 当前 toPath:', currentToPath);

          // 🔑 关键修复：无论当前 toPath 是什么值，都强制设置为发布页路径
          // 这样可以确保第一次打开发布窗口时直接进入发布页
          if (currentToPath !== PUBLISH_PAGE_PATH) {
            console.log('[搜狐号-preload] ⚠️ toPath 不是发布页路径，强制设置');
            localStorage.setItem('toPath', PUBLISH_PAGE_PATH);
            console.log('[搜狐号-preload] ✅ 已设置 toPath 为发布页路径:', PUBLISH_PAGE_PATH);
          } else {
            console.log('[搜狐号-preload] ✅ toPath 已经是发布页路径，无需修改');
          }

          // 🔑 劫持 localStorage.getItem，确保读取 toPath 时始终返回发布页路径
          const originalGetItem = localStorage.getItem.bind(localStorage);
          localStorage.getItem = function(key) {
            if (key === 'toPath') {
              console.log('[搜狐号-preload] 🔄 拦截读取 toPath，返回发布页路径');
              return PUBLISH_PAGE_PATH;
            }
            return originalGetItem(key);
          };
          console.log('[搜狐号-preload] ✅ 已劫持 localStorage.getItem');
        } catch (e) {
          console.error('[搜狐号-preload] ❌ 处理 toPath 失败:', e);
        }
      })();
    `;

    // 使用 webFrame 在主世界中执行脚本（在页面脚本之前）
    webFrame.executeJavaScript(sohuToPathScript);
    console.log('[content-preload] ✅ 已注入搜狐号 toPath 修复脚本');
  } catch (e) {
    console.error('[content-preload] ❌ 注入搜狐号 toPath 修复脚本失败:', e);
  }
})();

// 配置（内联，因为 preload 脚本沙盒环境不能使用 path 模块）
const config = {
  platformPublishUrls: {
    dy: 'https://creator.douyin.com/creator-micro/content/upload',
    xhs: 'https://creator.xiaohongshu.com/publish/publish?from=homepage&target=video&openFilePicker=true',
    sph: 'https://channels.weixin.qq.com/platform/post/create',
    bjh: 'https://baijiahao.baidu.com/builder/rc/edit?type=news&is_from_cms=1',
    wyh: 'https://mp.163.com/subscribe_v4/index.html#/article-publish',
    shh: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle',
    txh: 'https://om.qq.com/main/creation/article'
  },
  platformIdMap: {
    1: 'dy',    // 抖音
    4: 'bjh',   // 百家号
    6: 'xhs',   // 小红书
    7: 'sph',   // 视频号
    8: 'wyh',   // 网易号
    9: 'shh',   // 搜狐号
    10: 'txh'   // 腾讯号
  },
  platformNameMap: {
    'dy': 'douyin',
    'xhs': 'xiaohongshu',
    'sph': 'shipinhao',
    'bjh': 'baijiahao',
    'wx': 'weixin',
    'wyh': 'wangyihao',
    'shh': 'sohuhao',
    'txh': 'tengxunhao'
  }
};

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

console.log('[content-preload] 环境检测:', {
  isProduction,
  defaultApp: process.defaultApp,
  execPath: process.execPath,
  resourcesPath: process.resourcesPath
});

// 消息回调存储（单例模式 - 只保留最新的回调）
const messageCallbacks = {
  fromHome: null,
  fromOtherPage: null,
  fromMain: null
};

// 防重复发布标志
let isPublishing = false;

// 待发送的消息队列（按 windowId 存储，等窗口加载完成后发送）
const pendingMessages = new Map();

// 监听窗口加载完成事件（在这里发送消息，替代 setTimeout 延时）
ipcRenderer.on('window-loaded', (event, data) => {
  console.log('[BrowserAPI] 🔔 收到 window-loaded 事件:', data);
  const { windowId, url } = data;

  // 检查是否有待发送的消息
  if (pendingMessages.has(windowId)) {
    const messageData = pendingMessages.get(windowId);
    pendingMessages.delete(windowId);

    // 发送消息到目标窗口
    setTimeout(() => {
      ipcRenderer.send('home-to-content', messageData);
      console.log(`[BrowserAPI] 📤 窗口加载完成，已发送消息, windowId: ${windowId}, url: ${url}`);
    }, 6000)
  }
  // 没有待发送消息时不再输出日志，减少干扰
});

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

    // 处理发布数据
    if (message.type === 'publish-data' && message.data) {
      const dataObj = JSON.parse(message.data);
      console.log("🚀 ~ sendToOtherPage ~ dataObj: ", dataObj);

      // 统一转换为数组处理（兼容单个对象和数组）
      const dataArray = Array.isArray(dataObj) ? dataObj : [dataObj];

      console.log('[BrowserAPI] 🔍 数据类型:', Array.isArray(dataObj) ? '数组' : '对象');
      console.log('[BrowserAPI] 🔍 dataArray 长度:', dataArray.length);

      // 存储完整发布数据到全局存储
      ipcRenderer.invoke('global-storage-set', 'publish_data', message.data);
      console.log('[BrowserAPI] ✅ 已存储 publish_data 到全局存储');
      console.log(`[BrowserAPI] 📋 共有 ${dataArray.length} 篇文章待发布`);

      // 使用配置文件中的映射
      const urlMap = config.platformPublishUrls;
      const platformMap = config.platformIdMap;
      const platformFullNameMap = config.platformNameMap;

      // 使用立即执行的异步函数 + for...of 确保顺序执行
      (async () => {
        for (let index = 0; index < dataArray.length; index++) {
          const element = dataArray[index];
          const platform = platformMap[element.account_info.media.id];
          const platformFullName = platformFullNameMap[platform];
          const url = urlMap[platform];
          console.log(`🚀 [${index + 1}/${dataArray.length}] platform: ${platform}, url: ${url}`);

          // 构建 openNewWindow 的 options
          // 如果有 cookies 数据，传入 sessionData 让浏览器自动清空并恢复
          const openOptions = {};

          // 🔑 多账号模式开关
          // true: 每个窗口使用独立 session，从父页面传入的 cookies 恢复登录状态
          // false: 所有窗口使用共享 session（persist:browserview）
          const ENABLE_MULTI_ACCOUNT = true;

          // 解析 element.cookies（格式: {domain, timestamp, cookies: [...]} 或 JSON 字符串）
          let cookiesData = null;
          let cookiesArray = [];
          if (element.cookies) {
            try {
              cookiesData = typeof element.cookies === 'string' ? JSON.parse(element.cookies) : element.cookies;
              // cookiesData 可能是 {domain, cookies: [...]} 或直接是数组
              if (Array.isArray(cookiesData)) {
                cookiesArray = cookiesData;
              } else if (cookiesData.cookies && Array.isArray(cookiesData.cookies)) {
                cookiesArray = cookiesData.cookies;
              }
              console.log("🚀 ~ element.cookies 解析成功, cookies 数量:", cookiesArray.length);
            } catch (e) {
              console.error("🚀 ~ element.cookies 解析失败:", e);
            }
          }

          // 🔑 关键判断：只要 element.cookies 存在（即使内部 cookies 数组为空），就使用多账号模式
          // 这样每个账号窗口使用独立 session，避免登录状态互相干扰
          if (ENABLE_MULTI_ACCOUNT && element.cookies) {
            // 多账号模式：为每个窗口创建唯一的 session ID
            const uniqueSessionId = `${platformFullName}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            if (platformFullName) {
              openOptions.platform = platformFullName;
              openOptions.accountId = uniqueSessionId;
              console.log(`[BrowserAPI] 📋 多账号模式，使用独立 session: platform=${platformFullName}, accountId=${uniqueSessionId}`);
            }
            openOptions.sessionData = element.cookies;  // 传原始数据，main.js 会解析
            console.log(`[BrowserAPI] 📋 检测到 cookies 数据，共 ${cookiesArray.length} 个`);
          } else {
            // 普通模式：使用共享 session，保持现有登录状态
            if (element.cookies) {
              console.log(`[BrowserAPI] 📋 检测到 cookies 数据，但多账号模式已禁用，使用共享 session`);
            } else {
              console.log(`[BrowserAPI] 📋 普通模式（无 cookies 数据），使用共享 session（persist:browserview）`);
            }
          }

          // 打开新窗口，获取窗口 ID
          console.log('[BrowserAPI] 📋 openOptions:', JSON.stringify(openOptions, null, 2));
          const result = await ipcRenderer.invoke('open-new-window', url, openOptions);
          if (!result.success) {
            console.error(`❌ [${index + 1}] 打开窗口失败: ${result.error}`);
            continue; // 继续下一个，不要 return
          }

          const windowId = result.windowId;
          console.log(`✅ [${index + 1}] 窗口创建成功, windowId: ${windowId}`);

          // 用窗口 ID 作为 key 存储数据，避免多窗口冲突
          const publishData = {
            element,
            platform,
            windowId,
            video: {
              formData: element.formData || { title: element.title, send_set: 1 },
              video: {
                cover: element.image,
                title: element.title,
                intro: element.intro,
                content: element.content,
                url: element.url,
                sendlog: element.sendlog || {
                  title: element.title,
                  intro: element.intro,
                }
              },
              dyPlatform: element.dyPlatform || { id: element.id }
            },
          };
          await ipcRenderer.invoke('global-storage-set', `publish_data_window_${windowId}`, publishData);
          console.log(`[BrowserAPI] ✅ 已存储 publish_data_window_${windowId}`);

          // 存储待发送的消息，等窗口加载完成事件触发后发送（替代 setTimeout 延时）
          pendingMessages.set(windowId, {
            type: 'publish-data',
            platform: platform,
            windowId: windowId,
            data: publishData
          });
          console.log(`[BrowserAPI] 📋 已存储待发送消息, windowId: ${windowId}, 等待窗口加载完成...`);

          // 每个窗口之间稍微延迟，避免同时创建太多
          if (index < dataArray.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        console.log(`[BrowserAPI] ✅ 所有 ${dataArray.length} 个窗口已创建完成`);
      })();

      // publish-data 类型的消息已经在循环中处理，不需要再次发送
      return;
    }

    // 其他类型的消息正常发送
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

  // 监听 Cookies 清除事件（首页使用，用于清空授权列表）
  onCookiesCleared: (callback) => {
    ipcRenderer.on('cookies-cleared', (event, data) => {
      console.log('[BrowserAPI] 收到 cookies-cleared 事件:', data);
      callback(data);
    });
    console.log('[BrowserAPI] onCookiesCleared 监听器已注册');
  },

  // 监听新窗口加载完成事件（首页使用，用于知道新窗口何时准备好）
  onWindowLoaded: (callback) => {
    ipcRenderer.on('window-loaded', (event, data) => {
      console.log('[BrowserAPI] 收到 window-loaded 事件:', data);
      callback(data);
    });
    console.log('[BrowserAPI] onWindowLoaded 监听器已注册');
  },

  // 监听会话更新事件（首页使用，用于保存发布窗口关闭时的最新 cookies）
  // data: { windowId, platform, accountId, cookies, publishData, timestamp }
  onSessionUpdated: (callback) => {
    ipcRenderer.on('session-updated', (event, data) => {
      console.log('[BrowserAPI] 收到 session-updated 事件:', data);
      callback(data);
    });
    console.log('[BrowserAPI] onSessionUpdated 监听器已注册');
  },

  // 清除所有监听器（用于组件卸载）
  clearMessageListeners: () => {
    messageCallbacks.fromHome = null;
    messageCallbacks.fromOtherPage = null;
    messageCallbacks.fromMain = null;
    console.log('[BrowserAPI] 所有消息监听器已清除');
  },

  // 导航控制 API
  // options: {
  //   useTemporarySession: boolean - 为 true 时使用临时 session（不保存登录状态，用于授权页）
  //   platform: string - 平台名称（多账号模式必填）
  //   accountId: string - 账号 ID（多账号模式必填）
  //   sessionData: object | string - 会话数据（可选）。如果提供，浏览器会在打开窗口前自动清空旧登录信息并恢复此数据
  // }
  openNewWindow: (url, options) => ipcRenderer.invoke('open-new-window', url, options),
  navigateCurrentWindow: (url) => ipcRenderer.invoke('navigate-current-window', url),
  closeCurrentWindow: () => ipcRenderer.invoke('close-current-window'),
  goBack: () => ipcRenderer.invoke('content-go-back'),
  goForward: () => ipcRenderer.invoke('content-go-forward'),
  refresh: () => ipcRenderer.invoke('content-refresh'),
  canGoBack: () => ipcRenderer.invoke('content-can-go-back'),
  canGoForward: () => ipcRenderer.invoke('content-can-go-forward'),
  openDevTools: () => ipcRenderer.invoke('content-open-devtools'),

  // 获取当前窗口 ID（用于新窗口识别自己，读取对应的发布数据）
  getWindowId: () => ipcRenderer.invoke('get-window-id').then(r => r.success ? r.windowId : null),

  // 获取主窗口（BrowserView/首页）的 URL 信息（用于动态获取 API 域名）
  getMainUrl: () => ipcRenderer.invoke('get-main-url'),

  // 视频下载 API（通过主进程绕过跨域限制）
  downloadVideo: (url) => ipcRenderer.invoke('download-video', url),

  // 图片下载 API（通过主进程绕过跨域限制）
  downloadImage: (url) => ipcRenderer.invoke('download-image', url),

  // 触发文件下载（会弹出保存对话框）
  triggerDownload: (url) => ipcRenderer.invoke('trigger-download', url),

  // 清除指定域名的 Cookies（用于退出登录）
  clearDomainCookies: (domain) => ipcRenderer.invoke('clear-domain-cookies', domain),

  // 迁移临时 Session 的 Cookies 到持久化 Session
  // 用于授权窗口（临时session）授权成功后，把登录状态复制到持久化session
  // 参数: domain - 要迁移的域名，如 'baidu.com'
  // 返回: { success: true, migratedCount: 10 } 或 { success: false, error: '错误信息' }
  migrateCookiesToPersistent: (domain) => ipcRenderer.invoke('migrate-cookies-to-persistent', domain),

  // 检查 Session 状态（用于检测登录状态是否被清除）
  checkSessionStatus: () => ipcRenderer.invoke('check-session-status'),

  // 设置 Cookie（跨域支持，用于登录后设置 .china9.cn 等父域名的 Cookie）
  // 参数: { name, value, domain, path, expires, secure, httpOnly, sameSite }
  // 示例: setCookie({ name: 'token', value: 'xxx', domain: '.china9.cn', expires: Date.now() + 86400000 })
  setCookie: (cookieData) => ipcRenderer.invoke('set-cookie', cookieData),

  // 跳转到本地 HTML 页面（用于跳转到 not-available.html 等本地页面）
  // 参数: pageName - 页面文件名，如 'not-available.html'、'login.html'
  navigateToLocalPage: (pageName) => ipcRenderer.invoke('navigate-to-local-page', pageName),

  // 获取指定域名的所有 Cookies（包括 HttpOnly）
  // 参数: domain - 域名，如 'baidu.com'
  // 返回: { success: true, cookies: 'cookie_string' } 或 { success: false, error: '错误信息' }
  getDomainCookies: (domain) => ipcRenderer.invoke('get-domain-cookies', domain),

  // 获取完整会话数据（Cookies + localStorage + sessionStorage + IndexedDB）
  // 用于授权后将完整登录状态存储到后台
  // 参数: domain - 域名，如 'baidu.com'
  // 返回: { success: true, data: { cookies, localStorage, sessionStorage, indexedDB }, size: 数据大小 }
  getFullSessionData: (domain) => ipcRenderer.invoke('get-full-session-data', domain),

  // 恢复完整会话数据（Cookies + localStorage + sessionStorage + IndexedDB）
  // 用于发布时从后台获取的会话数据恢复到当前窗口
  // 参数: sessionData - 会话数据对象或 JSON 字符串（与 getFullSessionData 返回的 data 格式相同）
  // 返回: { success: true, results: { cookies, localStorage, sessionStorage, indexedDB } }
  restoreSessionData: (sessionData) => ipcRenderer.invoke('restore-session-data', sessionData),

  // ========== 全局数据存储 API（用于跨页面数据传递） ==========
  // 存储数据（如 company_id）
  setGlobalData: (key, value) => ipcRenderer.invoke('global-storage-set', key, value),
  // 获取数据
  getGlobalData: (key) => ipcRenderer.invoke('global-storage-get', key).then(r => r.value),
  // 删除数据
  removeGlobalData: (key) => ipcRenderer.invoke('global-storage-remove', key),
  // 获取所有数据
  getAllGlobalData: () => ipcRenderer.invoke('global-storage-get-all').then(r => r.data),
  // 清空所有数据
  clearGlobalData: () => ipcRenderer.invoke('global-storage-clear'),

  // ========== 多账号管理 API ==========
  // 获取指定平台的所有账号
  // 参数: platform - 平台名称，如 'douyin', 'xiaohongshu', 'baijiahao', 'weixin', 'shipinhao'
  // 返回: { success: true, accounts: [...] }
  getAccounts: (platform) => ipcRenderer.invoke('get-accounts', platform).then(r => r.accounts || []),

  // 获取所有平台的所有账号
  // 返回: { douyin: [...], xiaohongshu: [...], ... }
  getAllAccounts: () => ipcRenderer.invoke('get-all-accounts').then(r => r.platformAccounts || {}),

  // 添加账号（授权成功后调用）
  // 参数: platform - 平台名称
  //       accountInfo - { nickname, avatar, platformUid, id? }
  // 返回: { success: true, accountId: 'xxx', isNew: true/false }
  addAccount: (platform, accountInfo) => ipcRenderer.invoke('add-account', platform, accountInfo),

  // 删除账号（同时清理对应 session 数据）
  // 参数: platform - 平台名称
  //       accountId - 账号 ID
  // 返回: { success: true }
  removeAccount: (platform, accountId) => ipcRenderer.invoke('remove-account', platform, accountId),

  // 更新账号信息
  // 参数: platform - 平台名称
  //       accountId - 账号 ID
  //       updates - { nickname?, avatar?, platformUid? }
  // 返回: { success: true, account: {...} }
  updateAccount: (platform, accountId, updates) => ipcRenderer.invoke('update-account', platform, accountId, updates),

  // 检查账号是否已存在（通过平台用户 ID 判断）
  // 参数: platform - 平台名称
  //       platformUid - 平台用户 ID
  // 返回: { exists: true, accountId: 'xxx', account: {...} } 或 { exists: false }
  accountExists: (platform, platformUid) => ipcRenderer.invoke('account-exists', platform, platformUid),

  // 获取账号信息
  // 参数: platform - 平台名称
  //       accountId - 账号 ID
  // 返回: { success: true, account: {...} }
  getAccount: (platform, accountId) => ipcRenderer.invoke('get-account', platform, accountId),

  // 获取当前窗口的账号信息（在发布脚本中使用）
  // 返回: { success: true, platform: 'xxx', accountId: 'xxx', account: {...} }
  getCurrentAccount: () => ipcRenderer.invoke('get-current-account'),

  // 迁移临时 Session 到新账号（授权窗口使用）
  // 用于授权成功后，将临时 session 的 cookies 迁移到新账号的持久化 session
  // 参数: platform - 平台名称
  //       accountInfo - { nickname, avatar, platformUid }
  // 返回: { success: true, accountId: 'xxx', isNew: true/false, migratedCount: 10 }
  migrateToNewAccount: (platform, accountInfo) => ipcRenderer.invoke('migrate-to-new-account', platform, accountInfo),

  // 检查账号登录状态
  // 参数: platform - 平台名称
  //       accountId - 账号 ID
  // 返回: { success: true, isLoggedIn: true/false, cookieCount: 10 }
  checkAccountLoginStatus: (platform, accountId) => ipcRenderer.invoke('check-account-login-status', platform, accountId),

  // 恢复账号会话数据（在打开窗口之前调用）
  // 用于从后台获取的会话数据恢复到指定账号的 session
  // 参数: platform - 平台名称（如 'douyin', 'xiaohongshu'）
  //       accountId - 账号 ID（如 'douyin_xxx_1'）
  //       sessionData - 会话数据对象或 JSON 字符串（getFullSessionData 返回的格式）
  // 返回: { success: true, results: { cookies, localStorage, sessionStorage, indexedDB } }
  restoreAccountSession: (platform, accountId, sessionData) => ipcRenderer.invoke('restore-account-session', platform, accountId, sessionData),

  // 清空账号的所有 Cookies（在窗口关闭前调用）
  // 用于清空发布窗口对应账号的登录状态
  // 参数: platform - 平台名称
  //       accountId - 账号 ID
  // 返回: { success: true, deletedCount: 10 }
  clearAccountCookies: (platform, accountId) => ipcRenderer.invoke('clear-account-cookies', platform, accountId),

  // 手动保存会话数据到后台（开发调试用）
  // 在不关闭窗口的情况下保存最新 cookies 到后台
  // 返回: { success: true, cookieCount: 10, response: '...' }
  saveSessionToBackend: () => ipcRenderer.invoke('save-session-to-backend')
});

// 在页面加载时注入通信代码和协议拦截
window.addEventListener('DOMContentLoaded', () => {
  console.log('BrowserAPI ready:', window.location.href);

  // 注入协议拦截代码到页面上下文
  const script = document.createElement('script');
  script.textContent = `
    (function() {
      // 阻止的协议列表
      const blockedProtocols = ['bitbrowser:', 'mqqwpa:', 'weixin:', 'alipays:', 'tbopen:'];

      function isBlockedProtocol(url) {
        if (!url || typeof url !== 'string') return false;
        const lowerUrl = url.toLowerCase();
        return blockedProtocols.some(function(protocol) { return lowerUrl.startsWith(protocol); });
      }

      // 拦截链接点击
      document.addEventListener('click', function(e) {
        var target = e.target;
        while (target && target !== document) {
          if (target.tagName === 'A' && target.href && isBlockedProtocol(target.href)) {
            console.log('[ProtocolBlock] 阻止链接点击:', target.href);
            e.preventDefault();
            e.stopPropagation();
            return false;
          }
          target = target.parentElement;
        }
      }, true);

      // 拦截 window.open
      var originalOpen = window.open;
      window.open = function(url) {
        if (isBlockedProtocol(url)) {
          console.log('[ProtocolBlock] 阻止 window.open:', url);
          return null;
        }
        return originalOpen.apply(window, arguments);
      };

      // 拦截 location.assign
      var originalAssign = window.location.assign;
      if (originalAssign) {
        window.location.assign = function(url) {
          if (isBlockedProtocol(url)) {
            console.log('[ProtocolBlock] 阻止 location.assign:', url);
            return;
          }
          return originalAssign.call(window.location, url);
        };
      }

      // 拦截 location.replace
      var originalReplace = window.location.replace;
      if (originalReplace) {
        window.location.replace = function(url) {
          if (isBlockedProtocol(url)) {
            console.log('[ProtocolBlock] 阻止 location.replace:', url);
            return;
          }
          return originalReplace.call(window.location, url);
        };
      }

      console.log('[ProtocolBlock] 前端协议拦截已启用');
    })();
  `;
  document.documentElement.appendChild(script);
  script.remove(); // 注入后立即移除 script 标签
});
