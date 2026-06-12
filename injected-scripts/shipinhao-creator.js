/**
 * 视频号创作者平台授权脚本
 * 用于处理授权流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
  'use strict';

  function isShipinhaoPublishPage() {
    try {
      return window.location.hostname === 'channels.weixin.qq.com'
        && window.location.pathname.includes('/platform/post/create');
    } catch (_) {
      return String(window.location.href || '').includes('channels.weixin.qq.com/platform/post/create');
    }
  }

  if (isShipinhaoPublishPage()) {
    console.log('[视频号授权] 当前为发布页，跳过授权脚本，避免误触发白屏检测或跳转');
    return;
  }

  // ===========================
  // 防止脚本重复注入（同一页面内）
  // ===========================
  // 注意：扫码后页面会跳转，跳转后算新页面，需要重新注入采集逻辑
  // 所以只阻止同一页面的重复注入，不阻止跳转后的重注入
  if (window.__DOUYIN_SCRIPT_LOADED__) {
    console.log('[视频号授权] ⚠️ 脚本已经加载过，跳过重复注入');
    return;
  }

  // ===========================
  // 页面状态检查 - 防止异常渲染
  // ===========================
  if (typeof window.checkPageStateAndReload === 'function') {
    if (!window.checkPageStateAndReload('视频号授权')) {
      return;
    }
  }

  window.__DOUYIN_SCRIPT_LOADED__ = true;

  // ===========================
  // 🔑 视频号白屏检测和自动恢复（兜底 Win7 等旧系统 GPU 渲染失败的情况）
  // ===========================
  if (typeof window.checkBlankPageAndReload === 'function') {
    window.checkBlankPageAndReload('视频号', [
      '.weui-desktop-account__nickname',
      '.weui-desktop-account__info',
      '.weui-desktop-menu',
      '.account-info',
      '.menu-item'
    ], 3000, 3);
  }

  // 显示操作提示横幅
  if (typeof showOperationBanner === 'function') {
    showOperationBanner('正在自动授权中，请勿操作此页面...');
  }

  console.log('═══════════════════════════════════════');
  console.log('✅ 视频号授权脚本已注入');
  console.log('📍 当前 URL:', window.location.href);
  console.log('🕐 注入时间:', new Date().toLocaleString());
  console.log('═══════════════════════════════════════');

  // 检查 common.js 是否已加载
  if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
    console.error('[视频号授权] ❌ common.js 未加载！脚本可能无法正常工作');
  } else {
    console.log('[视频号授权] ✅ common.js 已加载，工具函数可用');
  }

  // ===========================
  // 1. 从 URL 获取授权数据
  // ===========================

  function dedupeShipinhaoSessionCookies(cookies) {
    if (!Array.isArray(cookies) || cookies.length === 0) {
      return [];
    }

    const criticalNames = new Set(['sessionid', 'wxuin', 'pass_ticket', 'wxsid', 'wxload']);
    const normalizeDomain = (domain) => String(domain || '').toLowerCase().replace(/^\./, '');
    const exactKey = (cookie) => [
      String(cookie?.name || ''),
      String(cookie?.domain || '').toLowerCase(),
      cookie?.path || '/',
      cookie?.secure ? '1' : '0'
    ].join('|');
    const preferByFreshness = (current, candidate) => {
      const currentHasValue = current.cookie.value !== undefined && current.cookie.value !== null && String(current.cookie.value) !== '';
      const candidateHasValue = candidate.cookie.value !== undefined && candidate.cookie.value !== null && String(candidate.cookie.value) !== '';
      if (currentHasValue !== candidateHasValue) return candidateHasValue;
      const currentExpires = Number(current.cookie.expirationDate || 0);
      const candidateExpires = Number(candidate.cookie.expirationDate || 0);
      if (currentExpires !== candidateExpires) return candidateExpires > currentExpires;
      return candidate.index > current.index;
    };
    const domainPriority = (cookie) => {
      const rawDomain = String(cookie?.domain || '').toLowerCase();
      const domain = rawDomain.replace(/^\./, '');
      if (domain === 'channels.weixin.qq.com') return 60;
      if (domain === 'weixin.qq.com') return 45;
      if (domain === 'mp.weixin.qq.com') return 35;
      if (domain === 'wx.qq.com') return 30;
      if (domain === 'qq.com') return 20;
      return 0;
    };

    const exactMap = new Map();
    cookies.forEach((cookie, index) => {
      if (!cookie || !cookie.name || !cookie.domain) return;
      const entry = { cookie: { ...cookie }, index };
      const key = exactKey(entry.cookie);
      const current = exactMap.get(key);
      if (!current || preferByFreshness(current, entry)) {
        exactMap.set(key, entry);
      }
    });

    const grouped = new Map();
    const passthrough = [];
    Array.from(exactMap.values()).forEach(entry => {
      const cookie = entry.cookie;
      const domain = normalizeDomain(cookie.domain);
      if (criticalNames.has(cookie.name)
        && ['channels.weixin.qq.com', 'weixin.qq.com', 'mp.weixin.qq.com', 'wx.qq.com', 'qq.com'].includes(domain)) {
        const groupKey = `${cookie.name}|${cookie.path || '/'}`;
        const current = grouped.get(groupKey);
        if (!current
          || domainPriority(entry.cookie) > domainPriority(current.cookie)
          || (domainPriority(entry.cookie) === domainPriority(current.cookie) && preferByFreshness(current, entry))) {
          grouped.set(groupKey, entry);
        }
      } else {
        passthrough.push(entry);
      }
    });

    const result = passthrough.concat(Array.from(grouped.values()))
      .sort((a, b) => a.index - b.index)
      .map(entry => entry.cookie);
    if (result.length !== cookies.length) {
      console.log(`[视频号授权] 🧹 cookies 去重: ${cookies.length} -> ${result.length}`);
    }
    return result;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const companyId = await window.browserAPI.getGlobalData('company_id');
  const transferId = urlParams.get('transfer_id');

  console.log('[视频号授权] URL 参数:', {
    companyId,
    transferId
  });

  // 存储授权数据到全局
  window.__AUTH_DATA__ = {
    companyId,
    transferId,
    timestamp: Date.now()
  };

  // ===========================
  // 2. 发送消息到父窗口的辅助函数（使用 common.js）
  // ===========================

  // ===========================
  // 3. 暴露全局方法供手动调用
  // ===========================

  window.__DOUYIN_AUTH__ = {
    // 发送授权成功消息
    notifySuccess: () => {
      sendMessageToParent('授权成功');
    },

    // 发送自定义消息
    sendMessage: (message) => {
      sendMessageToParent(message);
    },

    // 获取授权数据
    getAuthData: () => window.__AUTH_DATA__,
  };

  async function migrateShipinhaoCookiesToPersistent(reason = 'auth-local-save') {
    const migrateDomains = ['channels.weixin.qq.com', 'weixin.qq.com', 'mp.weixin.qq.com', 'wx.qq.com', 'qq.com'];
    let totalMigrated = 0;
    const details = [];

    console.log(`[视频号授权] 🔄 开始迁移多域名 Cookies 到持久化 session (${reason})...`, migrateDomains);
    for (const domain of migrateDomains) {
      try {
        const migrateResult = await window.browserAPI.migrateCookiesToPersistent(domain);
        details.push({ domain, ...migrateResult });
        if (migrateResult.success) {
          totalMigrated += migrateResult.migratedCount || 0;
          console.log(`[视频号授权] ✅ ${domain} Cookies 迁移成功，迁移 ${migrateResult.migratedCount || 0} 个`);
        } else {
          console.warn(`[视频号授权] ⚠️ ${domain} Cookies 迁移失败:`, migrateResult.error);
        }
      } catch (e) {
        details.push({ domain, success: false, error: e && e.message });
        console.warn(`[视频号授权] ⚠️ ${domain} Cookies 迁移异常:`, e);
      }
    }

    console.log(`[视频号授权] ✅ 多域名 Cookies 迁移完成 (${reason})，共迁移 ${totalMigrated} 个`);
    return {
      success: totalMigrated > 0,
      totalMigrated,
      details
    };
  }

  // ===========================
  // 4. 显示调试信息横幅
  // ===========================

  // ===========================
  // 5. 接收来自父窗口的消息（必须在发送 页面加载完成 之前注册！）
  // ===========================
  console.log('[视频号授权] 注册消息监听器...');

  // 防重复标志：确保数据只处理一次
  let isProcessing = false;
  let hasProcessed = false;

  // ===========================
  // 核心：采集用户信息并上报
  // 供两处调用：① 收到父窗口 auth-data 消息；② 扫码后重注入时主动检测
  // ===========================
  async function collectAndSubmit(authType) {
    if (isProcessing || hasProcessed) {
      console.warn('[视频号授权] ⚠️ 正在处理或已处理，跳过');
      return;
    }
    isProcessing = true;

    try {
      console.log('[视频号授权] 🚀 collectAndSubmit 开始执行, authType:', authType);
      // ── 用户信息采集：DOM 优先，无昵称则走接口兜底 ──
      const NICK_SEL = '.finder-nickname, .weui-desktop-account__nickname';
      await waitForElement(NICK_SEL, 8000).catch(() => null);
      const nicknameEle = document.querySelector(NICK_SEL);
      if (nicknameEle && !nicknameEle.innerText.trim()) {
        await window.delay(1500);
      }

      let nickname = '', avatar = '', follower_count = '', video = '', uid = '';

      // 尝试 DOM 采集
      const refreshedNickEle = document.querySelector(NICK_SEL);
      if (refreshedNickEle && refreshedNickEle.innerText.trim()) {
        const isFinderPage = !!document.querySelector('.finder-nickname');
        if (isFinderPage) {
          const avatarEle = document.querySelector('.avatar');
          const followerCountEle = document.querySelector('.finder-content-info > div:nth-of-type(2) .finder-info-num');
          const videoCountEle = document.querySelector('.finder-content-info > div:nth-of-type(1) .finder-info-num');
          const uidEle = document.querySelector('.finder-uniq-id');
          nickname = refreshedNickEle.innerText.trim();
          avatar = avatarEle ? avatarEle.getAttribute('src') : '';
          follower_count = followerCountEle ? followerCountEle.innerText : '';
          video = videoCountEle ? videoCountEle.innerText : '';
          uid = uidEle ? uidEle.innerText.trim() : '';
        } else {
          const avatarEle = document.querySelector('.weui-desktop-account__img, .weui-desktop-account__thumb img');
          const uidEle = document.querySelector('.weui-desktop-account__uniqid, .finder-uniq-id');
          nickname = refreshedNickEle.innerText.trim();
          avatar = avatarEle ? (avatarEle.getAttribute('src') || avatarEle.src || '') : '';
          uid = uidEle ? uidEle.innerText.replace(/视频号 ?ID[:：]?\s*/i, '').trim() : '';
        }
        console.log('[视频号授权] 📋 DOM采集:', { nickname, uid });
      }

      // DOM 没拿到昵称 → 调接口兜底
      if (!nickname) {
        console.log('[视频号授权] DOM无昵称，尝试接口采集...');
        try {
          // _aid 在 localStorage，key 可能是 _rx:aid 或 _ml:aid
          const aid = localStorage.getItem('_rx:aid') || localStorage.getItem('_ml:aid') || '';
          // _log_finder_id 在 localStorage，key 是 finder_username
          const logFinderId = localStorage.getItem('finder_username') || '';
          if (aid && logFinderId) {
            const params = new URLSearchParams({
              _aid: aid,
              _rid: String(Date.now()).slice(0, 10),
              _pageUrl: 'https%3A%2F%2Fchannels.weixin.qq.com%2Fplatform'
            });
            const body = {
              timestamp: String(Date.now()),
              _log_finder_id: logFinderId,
              _log_finder_uin: '',
              pluginSessionId: null,
              rawKeyBuff: null,
              reqScene: 7,
              scene: 7
            };
            const apiResp = await fetch(
              `https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data?${params}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                credentials: 'include'
              }
            );
            const apiJson = await apiResp.json();
            console.log('[视频号授权] 接口响应:', JSON.stringify(apiJson).slice(0, 300));
            const d = apiJson && apiJson.data;
            if (d) {
              const finderUser = d.finderUser || {};
              const userAttr = d.userAttr || {};
              nickname = finderUser.nickname || userAttr.nickname || '';
              avatar = finderUser.headImgUrl || userAttr.encryptedHeadImage || '';
              uid = finderUser.finderUsername || logFinderId || '';
              follower_count = String(finderUser.fansCount || '');
              video = String(finderUser.feedsCount || '');
            }
            console.log('[视频号授权] 接口采集:', { nickname, uid });
          } else {
            console.warn('[视频号授权] 缺少 _aid 或 finder_username，接口采集跳过');
          }
        } catch (apiErr) {
          console.warn('[视频号授权] 接口采集失败:', apiErr && apiErr.message);
        }
      }

      console.log('[视频号授权] 📝 采集完成，准备弹窗确认:', { nickname, uid });

      const scanData = {
        data: JSON.stringify({
          nickname,
          avatar,
          follower_count,
          video,
          uid,
          favoriting_count: 0,
          total_favorited: 0,
          company_id: await window.browserAPI.getGlobalData('company_id'),
          auth_type: authType
        })
      };

      // 获取多域名完整会话数据
      console.log('[视频号授权] 📦 正在获取多域名完整会话数据...');
      try {
        const sessionDomains = ['channels.weixin.qq.com', 'weixin.qq.com', 'mp.weixin.qq.com', 'wx.qq.com', 'qq.com'];
        const sessionResults = await Promise.all(
          sessionDomains.map(domain => window.browserAPI.getFullSessionData(domain).catch(err => {
            console.warn(`[视频号授权] ⚠️ 获取 ${domain} 会话数据失败:`, err);
            return { success: false, domain };
          }))
        );

        const mergedData = {
          domains: sessionDomains,
          timestamp: Date.now(),
          cookies: [],
          localStorage: {},
          sessionStorage: {},
          indexedDB: {}
        };

        let totalSize = 0;
        sessionResults.forEach((result, index) => {
          const domain = sessionDomains[index];
          if (result.success && result.data) {
            totalSize += result.size || 0;
            if (Array.isArray(result.data.cookies)) mergedData.cookies.push(...result.data.cookies);
            if (result.data.localStorage && Object.keys(result.data.localStorage).length > 0)
              mergedData.localStorage[domain] = result.data.localStorage;
            if (result.data.sessionStorage && Object.keys(result.data.sessionStorage).length > 0)
              mergedData.sessionStorage[domain] = result.data.sessionStorage;
            if (result.data.indexedDB && Object.keys(result.data.indexedDB).length > 0)
              mergedData.indexedDB[domain] = result.data.indexedDB;
          } else {
            console.warn(`[视频号授权] ⚠️ ${domain} 会话数据获取失败`);
          }
        });

        mergedData.cookies = dedupeShipinhaoSessionCookies(mergedData.cookies);
        if (mergedData.cookies.length > 0) {
          const dataObj = JSON.parse(scanData.data);
          dataObj.cookies = JSON.stringify(mergedData);
          scanData.data = JSON.stringify(dataObj);
          console.log(`[视频号授权] ✅ 多域名会话数据合并完成，共 ${mergedData.cookies.length} 个 cookies，总大小: ${Math.round(totalSize / 1024)} KB`);
        } else {
          console.warn('[视频号授权] ⚠️ 所有域名均无有效会话数据');
        }
      } catch (sessionError) {
        console.error('[视频号授权] ⚠️ 获取会话数据异常:', sessionError);
      }

      const localMigrateResult = await migrateShipinhaoCookiesToPersistent('before-backend-submit');

      let apiResult = null;
      let apiResponseText = '';
      let backendSuccess = false;
      try {
        const apiDomain = await getApiDomain();
        console.log('[视频号授权] 📡 API 地址:', `${apiDomain}/api/mediaauth/sphinfo`);
        const apiResponse = await fetch(`${apiDomain}/api/mediaauth/sphinfo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(scanData)
        });
        apiResponseText = await apiResponse.text();
        try { apiResult = JSON.parse(apiResponseText); } catch (_) { apiResult = null; }
        backendSuccess = apiResponse.ok && apiResult && apiResult.code === 200;
        console.log('[视频号授权] 📥 接口响应:', {
          ok: apiResponse.ok, status: apiResponse.status,
          code: apiResult && apiResult.code, response: apiResponseText.slice(0, 300)
        });
      } catch (apiError) {
        console.warn('[视频号授权] ⚠️ 后台接口不可用，继续使用本地登录态缓存:', apiError && apiError.message);
      }

      if (backendSuccess || localMigrateResult.success) {
        hasProcessed = true;
        try {
          await window.browserAPI.setGlobalData('shipinhao_local_auth_fallback', {
            timestamp: Date.now(), backendSuccess, localMigrateResult,
            apiResult, apiResponse: apiResponseText.slice(0, 500)
          });
        } catch (cacheError) {
          console.warn('[视频号授权] ⚠️ 写入本地授权兜底标记失败:', cacheError);
        }
        sendMessageToParent('授权成功，刷新数据');
        setTimeout(() => window.browserAPI.closeCurrentWindow(), window.getRandomDelayMs(10000));
      } else {
        throw new Error((apiResult && (apiResult.msg || apiResult.message)) || '后台失败且本地登录态迁移失败');
      }
    } finally {
      isProcessing = false;
    }
  }

  if (!window.browserAPI) {
    console.error('[视频号授权] ❌ browserAPI 不可用！');
  } else {
    console.log('[视频号授权] ✅ browserAPI 可用');

    if (!window.browserAPI.onMessageFromHome) {
      console.error('[视频号授权] ❌ browserAPI.onMessageFromHome 不可用！');
    } else {
      console.log('[视频号授权] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

      window.browserAPI.onMessageFromHome(async (message) => {
        try {
          console.log('═══════════════════════════════════════');
          console.log('[视频号授权] 🎉 收到来自父窗口的消息!');
          console.log('[视频号授权] 消息内容:', message);
          console.log('═══════════════════════════════════════');

          if (message.type === 'auth-data') {
            console.log('[视频号授权] ✅ 收到授权数据:', message.data);

            if (message.windowId) {
              const myWindowId = await window.browserAPI.getWindowId();
              if (myWindowId !== message.windowId) {
                console.log('[视频号授权] ⏭️ 消息不是发给我的，跳过');
                return;
              }
            }

            const messageData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
            // 保存 auth_type 供主动采集路径使用
            window.__AUTH_DATA__.auth_type = messageData.auth_type;
            await collectAndSubmit(messageData.auth_type);
          }
        } catch (error) {
          console.error('[视频号授权] ❌ 授权流程出错:', error);
          isProcessing = false;
        }
      });

      console.log('[视频号授权] ✅ 消息监听器注册成功');
    }

    // ===========================
    // 🔑 主动检测：扫码后重注入时，页面已有昵称元素说明已登录
    // 此时父窗口不会再发 auth-data，直接采集上报
    // ===========================
    setTimeout(async () => {
      try {
        if (hasProcessed) return;
        const nicknameEle = document.querySelector('.finder-nickname, .weui-desktop-account__nickname');
        if (!nicknameEle) {
          console.log('[视频号授权] ℹ️ 未检测到昵称元素，等待父窗口消息触发采集');
          return;
        }
        console.log('[视频号授权] 🔍 检测到已登录状态，主动触发采集...', nicknameEle.className);
        const authType = (window.__AUTH_DATA__ && window.__AUTH_DATA__.auth_type) || 1;
        await collectAndSubmit(authType);
      } catch (e) {
        console.error('[视频号授权] ❌ 主动采集失败:', e);
      }
    }, 1500);
  }

  // ===========================
  // 6. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
  // ===========================

  // 页面加载完成后向父窗口发送消息
  console.log('[视频号授权] 页面加载完成，发送 页面加载完成 消息');
  sendMessageToParent('页面加载完成');

  console.log('═══════════════════════════════════════');
  console.log('✅ 视频号授权脚本初始化完成');
  console.log('📝 全局方法: window.__DOUYIN_AUTH__');
  console.log('  - notifySuccess()  : 发送授权成功消息');
  console.log('  - sendMessage(msg) : 发送自定义消息');
  console.log('  - getAuthData()    : 获取授权数据');
  console.log('  - sendAuthCode(code): 发送授权码');
  console.log('═══════════════════════════════════════');

  // ===========================
  // 7. 检查是否有发布数据需要恢复（登录跳转后返回首页的情况）
  // ===========================
  setTimeout(async () => {
    try {
      // 获取当前窗口 ID
      const windowId = await window.browserAPI.getWindowId();
      if (!windowId) {
        console.log('[视频号授权] ℹ️ 无法获取窗口 ID，跳过发布数据检查');
        return;
      }

      // 检查是否有保存的发布数据（表示是从发布流程跳过来的）
      const publishDataKey = `SHIPINHAO_PUBLISH_DATA_${windowId}`;
      const savedPublishData = localStorage.getItem(publishDataKey);

      // 同时检查 globalData 中是否有发布数据
      const globalPublishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);

      // 🔑 检查保存的发布页 URL（优先 localStorage，备选 globalData）
      const publishUrlKey = `SHIPINHAO_PUBLISH_URL_${windowId}`;
      let savedPublishUrl = localStorage.getItem(publishUrlKey);
      if (!savedPublishUrl) {
        savedPublishUrl = await window.browserAPI.getGlobalData(`SHIPINHAO_PUBLISH_URL_${windowId}`);
      }

      console.log('[视频号授权] 🔍 检查发布数据:', {
        localStorage: savedPublishData ? '有' : '无',
        globalData: globalPublishData ? '有' : '无',
        savedPublishUrl: savedPublishUrl || '无',
        windowId
      });

      if (savedPublishData || globalPublishData) {
        console.log('[视频号授权] ✅ 检测到发布数据，这是从发布流程登录后跳回来的');

        // 🔑 增加等待时间，确保登录状态完全生效（从 1 秒增加到 3 秒）
        console.log('[视频号授权] ⏳ 等待 3 秒，确保登录状态完全生效...');
        await window.delay(3000);

        // 🔑 优先使用保存的发布页 URL 直接跳转（更可靠，保留 URL 参数）
        if (savedPublishUrl && savedPublishUrl.includes('/platform/post/create')) {
          console.log('[视频号授权] 🔄 使用保存的发布页 URL 直接跳转:', savedPublishUrl);

          // 🔑 跳转前先隐藏页面，显示 loading 动画，避免用户看到白屏
          if (typeof window.hidePageAndShowMask === 'function') {
            window.hidePageAndShowMask();
          }

          window.location.href = savedPublishUrl;
          return;
        }

        // 🔑 备选方案：跳转到默认发布页
        console.log('[视频号授权] 🔄 没有保存的发布页 URL，跳转到默认发布页...');

        // 跳转前先隐藏页面，显示 loading 动画
        if (typeof window.hidePageAndShowMask === 'function') {
          window.hidePageAndShowMask();
        }

        window.location.href = 'https://channels.weixin.qq.com/platform/post/create';
      } else {
        console.log('[视频号授权] ℹ️ 没有发布数据，这是正常的授权流程');
      }
    } catch (error) {
      console.error('[视频号授权] ❌ 检查发布数据失败:', error);
    }
  }, window.getRandomDelayMs(2000)); // 延迟2秒，等待页面完全加载

})();

