// 视频号登录脚本 - 保持登录状态

(function() {
  console.log('[Shipinhao Login] 脚本已加载');

  // 监听登录成功事件
  function detectLoginSuccess() {
    // 检查是否已登录（通过检查页面元素或 localStorage）
    const isLoggedIn = () => {
      // 方法1：检查用户信息是否存在
      try {
        const userInfo = localStorage.getItem('user_info');
        if (userInfo) return true;
      } catch (e) {}

      // 方法2：检查页面中是否有用户头像或昵称
      const userElements = document.querySelectorAll('[class*="user"], [class*="avatar"], [class*="profile"]');
      if (userElements.length > 0) return true;

      // 方法3：检查 URL 中是否包含登录后的标记
      if (window.location.href.includes('channels.weixin.qq.com')) {
        return true;
      }

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
