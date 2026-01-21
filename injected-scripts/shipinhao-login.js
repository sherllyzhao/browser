// 视频号登录脚本 - 保持登录状态

(function() {
  console.log('[Shipinhao Login] 脚本已加载');

  // 检查是否是新打开的窗口（通过检查是否已经刷新过）
  const REFRESH_FLAG_KEY = '_shipinhao_login_refreshed';
  let hasRefreshed = false;

  // 检查是否需要刷新页面（仅对新窗口）
  function checkAndRefreshIfNeeded() {
    // 检查是否已经刷新过
    const refreshed = sessionStorage.getItem(REFRESH_FLAG_KEY);

    if (!refreshed && !hasRefreshed) {
      console.log('[Shipinhao Login] 检测到新窗口，准备清空缓存并刷新页面');
      hasRefreshed = true;

      // 标记已刷新，防止重复刷新
      sessionStorage.setItem(REFRESH_FLAG_KEY, 'true');

      // 延迟执行清空和刷新操作
      setTimeout(async () => {
        console.log('[Shipinhao Login] 正在清空缓存...');

        // 1. 清空 localStorage（保留必要的数据）
        try {
          const keysToKeep = ['_shipinhao_session_backup']; // 保留会话备份
          const tempData = {};

          // 备份需要保留的数据
          keysToKeep.forEach(key => {
            if (localStorage.getItem(key)) {
              tempData[key] = localStorage.getItem(key);
            }
          });

          // 清空 localStorage
          localStorage.clear();

          // 恢复需要保留的数据
          Object.entries(tempData).forEach(([key, value]) => {
            localStorage.setItem(key, value);
          });

          console.log('[Shipinhao Login] ✅ localStorage 已清空（保留必要数据）');
        } catch (e) {
          console.error('[Shipinhao Login] 清空 localStorage 失败:', e);
        }

        // 2. 清空当前页面的 sessionStorage（除了刷新标记）
        try {
          const refreshFlag = sessionStorage.getItem(REFRESH_FLAG_KEY);
          sessionStorage.clear();
          sessionStorage.setItem(REFRESH_FLAG_KEY, refreshFlag);
          console.log('[Shipinhao Login] ✅ sessionStorage 已清空（保留刷新标记）');
        } catch (e) {
          console.error('[Shipinhao Login] 清空 sessionStorage 失败:', e);
        }

        // 3. 清空视频号相关域名的 Cookies（最重要）
        console.log('[Shipinhao Login] 检查 browserAPI 可用性...');
        console.log('[Shipinhao Login] window.browserAPI:', !!window.browserAPI);
        console.log('[Shipinhao Login] clearDomainCookies:', !!(window.browserAPI && window.browserAPI.clearDomainCookies));

        if (window.browserAPI && window.browserAPI.clearDomainCookies) {
          try {
            // 清空视频号相关的所有域名 Cookie（包括父域名）
            const domains = [
              'channels.weixin.qq.com',
              '.channels.weixin.qq.com',  // 父域名（带点）
              'weixin.qq.com',
              '.weixin.qq.com',           // 父域名（带点）
              'wx.qq.com',
              '.wx.qq.com',               // 父域名（带点）
              'mp.weixin.qq.com',
              '.mp.weixin.qq.com'         // 父域名（带点）
            ];

            console.log('[Shipinhao Login] 开始清空域名 Cookies...');
            for (const domain of domains) {
              console.log(`[Shipinhao Login] 正在清空 ${domain} 的 cookies...`);
              const result = await window.browserAPI.clearDomainCookies(domain);
              if (result.success) {
                console.log(`[Shipinhao Login] ✅ 已清空 ${domain} 的 ${result.deletedCount} 个 cookies`);
              } else {
                console.error(`[Shipinhao Login] ❌ 清空 ${domain} 的 cookies 失败:`, result.error);
              }
            }
            console.log('[Shipinhao Login] ✅ 所有域名的 Cookies 清空完成');
          } catch (e) {
            console.error('[Shipinhao Login] 清空域名 Cookies 失败:', e);
          }
        } else {
          console.warn('[Shipinhao Login] ⚠️ browserAPI.clearDomainCookies 不可用，将使用原生方法清空');
        }

        // 额外的强力清空方法：通过 browserAPI 清空所有 session cookies
        if (window.browserAPI && window.browserAPI.clearAllCookies) {
          try {
            console.log('[Shipinhao Login] 尝试清空所有 session cookies...');
            const result = await window.browserAPI.clearAllCookies();
            if (result.success) {
              console.log(`[Shipinhao Login] ✅ 已清空所有 ${result.deletedCount} 个 session cookies`);
            }
          } catch (e) {
            console.error('[Shipinhao Login] 清空所有 cookies 失败:', e);
          }
        }

        // 原生js清空浏览器cookie（当前域名）
        function clearCookies() {
          console.log('[Shipinhao Login] 开始清空当前域名的 cookies...');
          const cookies = document.cookie.split(';');
          let clearedCount = 0;

          for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i];
            const eqPos = cookie.indexOf('=');
            const name = eqPos > -1 ? cookie.substr(0, eqPos).trim() : cookie.trim();

            if (name) {
              // 清空当前域名的 cookie
              document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
              // 清空父域名的 cookie
              document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.weixin.qq.com`;
              document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.qq.com`;
              clearedCount++;
            }
          }

          console.log(`[Shipinhao Login] ✅ 已清空当前域名的 ${clearedCount} 个 cookies`);
        }

        clearCookies();

        // 4. 通过 browserAPI 清空浏览器缓存（如果可用）
        if (window.browserAPI && window.browserAPI.clearCache) {
          try {
            window.browserAPI.clearCache();
            console.log('[Shipinhao Login] ✅ 浏览器缓存已清空');
          } catch (e) {
            console.error('[Shipinhao Login] 清空浏览器缓存失败:', e);
          }
        }

        await delay(5000);
        // 5. 强制刷新页面（清除缓存）
        console.log('[Shipinhao Login] 正在强制刷新页面...');
        // 使用 location.reload(true) 强制从服务器重新加载，忽略缓存
        window.location.reload(true);
      }, 1000);

      return true; // 表示正在清空和刷新
    }

    return false; // 表示不需要刷新
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
      saveSessionData();
    }
  }

  // 保存会话数据到浏览器
  async function saveSessionData() {
    try {
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
        setTimeout(detectLoginSuccess, 1000);
      }
    }, 500);

    // 方法2：监听 DOM 变化
    const observer = new MutationObserver(() => {
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
    if (checkAndRefreshIfNeeded()) {
      console.log('[Shipinhao Login] 页面正在刷新，跳过后续初始化');
      return;
    }

    console.log('[Shipinhao Login] 页面已刷新过或不需要刷新，继续初始化');

    // 先尝试恢复会话数据
    const restored = await restoreSessionData();

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
