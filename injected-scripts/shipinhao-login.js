// 视频号登录脚本 - 保持登录状态

(function() {
  console.log('[Shipinhao Login] 脚本已加载 v20260601-no-page-reload');

  // 检查是否是新打开的窗口（通过检查是否已经刷新过）
  const REFRESH_FLAG_KEY = '_shipinhao_login_refreshed';
  const RESET_FLAG_KEYS = [
    '_shipinhao_force_reset_login',
    'SHIPINHAO_FORCE_RESET_LOGIN',
    'SHIPINHAO_LOGIN_RESET_REQUESTED'
  ];
  const RESET_URL_PARAMS = [
    'shipinhao_reset_login',
    'shipinhao_force_reset',
    'force_reset',
    'reset_login',
    'clear_login'
  ];
  function isTruthyFlagValue(value) {
    if (value === true) return true;
    if (value === false || value == null) return false;
    return ['1', 'true', 'yes', 'y'].includes(String(value).trim().toLowerCase());
  }

  function safeGetStorageValue(storage, key, storageName) {
    try {
      return storage.getItem(key);
    } catch (e) {
      console.warn(`[Shipinhao Login] 读取 ${storageName}.${key} 失败:`, e);
      return null;
    }
  }

  function safeRemoveStorageValue(storage, key, storageName) {
    try {
      storage.removeItem(key);
    } catch (e) {
      console.warn(`[Shipinhao Login] 删除 ${storageName}.${key} 失败:`, e);
    }
  }

  function hasExplicitLoginResetRequest() {
    let resetFromUrl = false;
    try {
      const params = new URLSearchParams(window.location.search || '');
      resetFromUrl = RESET_URL_PARAMS.some(key => isTruthyFlagValue(params.get(key)));
    } catch (e) {
      console.warn('[Shipinhao Login] 解析 URL 重置参数失败:', e);
    }

    const resetFromSession = RESET_FLAG_KEYS.some(key => isTruthyFlagValue(safeGetStorageValue(sessionStorage, key, 'sessionStorage')));
    const resetFromLocal = RESET_FLAG_KEYS.some(key => isTruthyFlagValue(safeGetStorageValue(localStorage, key, 'localStorage')));

    console.log('[Shipinhao Login] 重置标记检测:', {
      resetFromUrl,
      resetFromSession,
      resetFromLocal
    });

    return resetFromUrl || resetFromSession || resetFromLocal;
  }

  function clearLoginResetRequestFlags() {
    RESET_FLAG_KEYS.forEach(key => {
      safeRemoveStorageValue(sessionStorage, key, 'sessionStorage');
      safeRemoveStorageValue(localStorage, key, 'localStorage');
    });
  }

  async function getWindowContextSafe() {
    if (!window.browserAPI || typeof window.browserAPI.getWindowContext !== 'function') {
      return null;
    }
    try {
      return await window.browserAPI.getWindowContext();
    } catch (e) {
      console.warn('[Shipinhao Login] 获取窗口上下文失败:', e);
      return null;
    }
  }

  async function isPublishFlowWindow(windowContext) {
    if (windowContext && windowContext.purpose === 'publish') {
      return true;
    }
    if (!window.browserAPI
      || typeof window.browserAPI.getWindowId !== 'function'
      || typeof window.browserAPI.getGlobalData !== 'function') {
      return false;
    }

    try {
      const windowId = await window.browserAPI.getWindowId();
      if (!windowId) {
        return false;
      }
      const publishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
      return !!publishData;
    } catch (e) {
      console.warn('[Shipinhao Login] 检测发布流程窗口失败:', e);
      return false;
    }
  }

  function markLoginResetHandledWithoutReload(reason) {
    try {
      sessionStorage.setItem(REFRESH_FLAG_KEY, 'true');
    } catch (e) {
      console.warn('[Shipinhao Login] 写入刷新标记失败:', e);
    }
    clearLoginResetRequestFlags();
    console.log('[Shipinhao Login] 已跳过强制刷新:', reason);
  }

  // 检查是否需要刷新页面（仅对新窗口）
  async function checkAndRefreshIfNeeded() {
    // 检查是否已经刷新过
    const refreshed = safeGetStorageValue(sessionStorage, REFRESH_FLAG_KEY, 'sessionStorage');
    const explicitReset = hasExplicitLoginResetRequest();
    const windowContext = await getWindowContextSafe();
    const publishFlowWindow = await isPublishFlowWindow(windowContext);

    // 登录页脚本不再执行清缓存和 reload。
    // 原因：发布窗口跳到扫码页时，publish-data/windowContext 可能晚于登录脚本到达；
    // 此时如果页面侧先清 cookie 再 reload，就会打断扫码并导致登录态保存不上。
    // 显式 reset 的 cookie 清理统一交给主进程在首包前处理，这里只清掉残留标记。
    if (!refreshed && explicitReset) {
      markLoginResetHandledWithoutReload(publishFlowWindow
        ? '发布窗口登录页只清理 reset 标记，不清 cookie、不 reload，避免打断扫码/重登'
        : '登录页 reset 标记已交给主进程处理，页面侧不再清 cookie、不 reload');
      return false;
    }

    if (!refreshed && !explicitReset) {
      console.log('[Shipinhao Login] 未检测到显式重置标记，跳过清缓存和强制刷新，避免打断扫码授权');
      return false;
    }

    return false; // 表示不需要刷新
  }

  let shipinhaoCookieDedupePending = false;
  let lastShipinhaoCookieDedupeAt = 0;

  async function dedupeShipinhaoCookies(reason) {
    if (!window.browserAPI || typeof window.browserAPI.dedupeShipinhaoCookies !== 'function') {
      return null;
    }

    try {
      const result = await window.browserAPI.dedupeShipinhaoCookies();
      if (result && result.success && result.removedCount > 0) {
        console.log(`[Shipinhao Login] ✅ 已去重同名 cookie (${reason})，清理 ${result.removedCount} 个`);
      }
      return result;
    } catch (e) {
      console.warn(`[Shipinhao Login] cookie 去重失败 (${reason}):`, e);
      return null;
    }
  }

  function scheduleShipinhaoCookieDedupe(reason, delay = 300) {
    if (shipinhaoCookieDedupePending) {
      return;
    }

    const now = Date.now();
    const minInterval = 1500;
    const waitMs = Math.max(delay, minInterval - (now - lastShipinhaoCookieDedupeAt), 0);
    shipinhaoCookieDedupePending = true;

    setTimeout(async () => {
      shipinhaoCookieDedupePending = false;
      lastShipinhaoCookieDedupeAt = Date.now();
      await dedupeShipinhaoCookies(reason);
    }, waitMs);
  }

  // 监听登录成功事件
  function detectLoginSuccess() {
    // 检查是否已登录（通过检查页面元素或 localStorage）
    const isLoggedIn = () => {
      // 如果是登录页面，直接返回 false
      if (window.location.href.includes('/login.html')) {
        return false;
      }

      // 方法1：检查用户信息是否存在
      try {
        const userInfo = localStorage.getItem('user_info');
        if (userInfo) return true;
      } catch (e) {}

      // 方法2：检查页面中是否有用户头像或昵称
      const userElements = document.querySelectorAll('[class*="user"], [class*="avatar"], [class*="profile"]');
      if (userElements.length > 0) return true;

      // 方法3：检查 URL 是否是登录后的页面（排除登录页）
      if (window.location.href.includes('channels.weixin.qq.com/platform')) {
        return true;
      }

      // 方法4：检查页面是否有登录后才有的元素
      const loggedInElements = document.querySelectorAll('[class*="nickname"], [class*="username"], .user-info, .account-info');
      if (loggedInElements.length > 0) return true;

      return false;
    };

    // 如果已登录，保存会话数据
    if (isLoggedIn()) {
      console.log('[Shipinhao Login] ✅ 检测到已登录，准备保存会话数据');
      scheduleShipinhaoCookieDedupe('login-success');
      saveSessionData();
    }
  }

  // 保存会话数据到浏览器
  async function saveSessionData() {
    try {
      await dedupeShipinhaoCookies('before-save-session');

      // 获取用户信息
      const userInfo = {
        timestamp: Date.now(),
        url: window.location.href,
        localStorage: {},
        sessionStorage: {}
      };

      // 保存 localStorage
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          userInfo.localStorage[key] = localStorage.getItem(key);
        }
      } catch (e) {
        console.error('[Shipinhao Login] 获取 localStorage 失败:', e);
      }

      // 保存 sessionStorage
      try {
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          userInfo.sessionStorage[key] = sessionStorage.getItem(key);
        }
      } catch (e) {
        console.error('[Shipinhao Login] 获取 sessionStorage 失败:', e);
      }

      // 通过 browserAPI 保存到全局存储
      if (window.browserAPI && window.browserAPI.setGlobalData) {
        await window.browserAPI.setGlobalData('shipinhao_session', userInfo);
        console.log('[Shipinhao Login] ✅ 会话数据已保存');
      }

      // 同时保存到 localStorage（备份）
      try {
        localStorage.setItem('_shipinhao_session_backup', JSON.stringify(userInfo));
      } catch (e) {
        console.error('[Shipinhao Login] 保存备份失败:', e);
      }
    } catch (error) {
      console.error('[Shipinhao Login] 保存会话数据失败:', error);
    }
  }

  // 恢复会话数据
  async function restoreSessionData() {
    // 如果是登录页面，不恢复会话数据（因为我们刚刚清空了）
    if (window.location.href.includes('/login.html')) {
      console.log('[Shipinhao Login] 登录页面，跳过会话数据恢复');
      return false;
    }

    try {
      if (window.browserAPI && window.browserAPI.getGlobalData) {
        const sessionData = await window.browserAPI.getGlobalData('shipinhao_session');
        if (sessionData) {
          console.log('[Shipinhao Login] 发现已保存的会话数据，准备恢复');

          // 恢复 localStorage
          if (sessionData.localStorage) {
            for (const [key, value] of Object.entries(sessionData.localStorage)) {
              try {
                localStorage.setItem(key, value);
              } catch (e) {
                console.error(`[Shipinhao Login] 恢复 localStorage 失败 (${key}):`, e);
              }
            }
            console.log('[Shipinhao Login] ✅ localStorage 已恢复');
          }

          // 恢复 sessionStorage
          if (sessionData.sessionStorage) {
            for (const [key, value] of Object.entries(sessionData.sessionStorage)) {
              try {
                sessionStorage.setItem(key, value);
              } catch (e) {
                console.error(`[Shipinhao Login] 恢复 sessionStorage 失败 (${key}):`, e);
              }
            }
            console.log('[Shipinhao Login] ✅ sessionStorage 已恢复');
          }

          return true;
        }
      }
    } catch (error) {
      console.error('[Shipinhao Login] 恢复会话数据失败:', error);
    }
    return false;
  }

  // 监听页面变化，检测登录状态
  function setupLoginMonitor() {
    // 方法1：监听 URL 变化
    let lastUrl = window.location.href;
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        console.log('[Shipinhao Login] URL 已变化:', lastUrl);
        scheduleShipinhaoCookieDedupe('url-change');
        setTimeout(detectLoginSuccess, 1000);
      }
    }, 500);

    // 方法2：监听 DOM 变化
    const observer = new MutationObserver(() => {
      scheduleShipinhaoCookieDedupe('dom-change', 800);
      detectLoginSuccess();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-*']
    });

    console.log('[Shipinhao Login] 登录监听已启动');
  }

  // 初始化
  async function init() {
    console.log('[Shipinhao Login] 初始化中...');

    // 首先检查是否需要刷新页面（仅对新窗口）
    if (await checkAndRefreshIfNeeded()) {
      console.log('[Shipinhao Login] 页面正在刷新，跳过后续初始化');
      return;
    }

    console.log('[Shipinhao Login] 页面已刷新过或不需要刷新，继续初始化');

    // 先尝试恢复会话数据
    const restored = await restoreSessionData();
    scheduleShipinhaoCookieDedupe('init', 0);

    // 设置登录监听
    setupLoginMonitor();

    // 检查当前是否已登录
    setTimeout(detectLoginSuccess, 2000);

    console.log('[Shipinhao Login] ✅ 初始化完成');
  }

  // 等待 DOM 准备好后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
