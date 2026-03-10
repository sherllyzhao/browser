/**
 * 视频号创作者平台授权脚本
 * 用于处理授权流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
  'use strict';

  // ===========================
  // 防止脚本重复注入
  // ===========================
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

          // 接收完整的授权数据
          if (message.type === 'auth-data') {
            console.log('[视频号授权] ✅ 收到授权数据:', message.data);

            // 🔑 检查 windowId 是否匹配
            if (message.windowId) {
              const myWindowId = await window.browserAPI.getWindowId();
              if (myWindowId !== message.windowId) {
                console.log('[视频号授权] ⏭️ 消息不是发给我的，跳过');
                return;
              }
            }

            // 防重复检查
            if (isProcessing || hasProcessed) {
              console.warn('[视频号授权] ⚠️ 正在处理或已处理，跳过');
              return;
            }

            isProcessing = true;
            const messageData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;

            // 等待页面元素加载完成
            await waitForElement('.finder-nickname', 15000);

            const nicknameEle = document.querySelector('.finder-nickname');
            if (!nicknameEle || !nicknameEle.innerText) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }

            // 收集用户信息
            const nicknameEleFinal = await waitForElement('.finder-nickname', 5000);
            const avatarEle = await waitForElement('.avatar', 5000);
            const followerCountEle = await waitForElement('.finder-content-info > div:nth-of-type(2) .finder-info-num', 5000);
            const videoCountEle = await waitForElement('.finder-content-info > div:nth-of-type(1) .finder-info-num', 5000);
            const uidEle = await waitForElement('.finder-uniq-id', 5000);

            const scanData = {
              data: JSON.stringify({
                nickname: nicknameEleFinal.innerText,
                avatar: avatarEle.getAttribute('src'),
                follower_count: followerCountEle.innerText,
                video: videoCountEle.innerText,
                uid: uidEle.innerText,
                favoriting_count: 0,
                total_favorited: 0,
                company_id: await window.browserAPI.getGlobalData('company_id'),
                auth_type: messageData.auth_type
              })
            };

            // 🔑 获取完整会话数据（Cookies + Storage + IndexedDB）
            console.log('[视频号授权] 📦 正在获取完整会话数据...');
            try {
              const sessionResult = await window.browserAPI.getFullSessionData('weixin.qq.com');
              if (sessionResult.success) {
                const dataObj = JSON.parse(scanData.data);
                dataObj.cookies = JSON.stringify(sessionResult.data);
                scanData.data = JSON.stringify(dataObj);
                console.log(`[视频号授权] ✅ 会话数据获取成功，大小: ${Math.round(sessionResult.size / 1024)} KB`);
              } else {
                console.warn('[视频号授权] ⚠️ 获取会话数据失败:', sessionResult.error);
              }
            } catch (sessionError) {
              console.error('[视频号授权] ⚠️ 获取会话数据异常:', sessionError);
            }

            // 发送数据到服务器（根据环境选择域名）
            const apiDomain = await getApiDomain();
            console.log('[视频号授权] 📡 API 地址:', `${apiDomain}/api/mediaauth/sphinfo`);
            const apiResponse = await fetch(`${apiDomain}/api/mediaauth/sphinfo`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(scanData)
            });

            if (!apiResponse.ok) {
              throw new Error(`API failed: ${apiResponse.status}`);
            }

            const apiResult = await apiResponse.json();
            console.log('[视频号授权] 📥 接口响应:', apiResult);

            if (apiResult && apiResult.code === 200) {
              hasProcessed = true;

              // 🔑 迁移登录 Cookies 到持久化 session
              // 因为授权窗口使用临时 session，需要把登录状态复制到持久化 session
              // 这样发布时才能用新授权的账号
              try {
                console.log('[视频号授权] 🔄 开始迁移 Cookies 到持久化 session...');
                const migrateResult = await window.browserAPI.migrateCookiesToPersistent('weixin.qq.com');
                if (migrateResult.success) {
                  console.log(`[视频号授权] ✅ Cookies 迁移成功，共迁移 ${migrateResult.migratedCount} 个`);
                } else {
                  console.error('[视频号授权] ⚠️ Cookies 迁移失败:', migrateResult.error);
                }
              } catch (migrateError) {
                console.error('[视频号授权] ⚠️ Cookies 迁移异常:', migrateError);
              }

              sendMessageToParent('授权成功，刷新数据');
              setTimeout(() => window.browserAPI.closeCurrentWindow(), 10000);
            } else {
              throw new Error(apiResult.msg || 'Data collection failed');
            }

            isProcessing = false;
          }
        } catch (error) {
          console.error('[视频号授权] ❌ 授权流程出错:', error);
          isProcessing = false;
        }
      });

      console.log('[视频号授权] ✅ 消息监听器注册成功');
    }
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

        // 等待页面完全加载
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 🔑 优先使用保存的发布页 URL 直接跳转（更可靠，保留 URL 参数）
        if (savedPublishUrl && savedPublishUrl.includes('/platform/post/create')) {
          console.log('[视频号授权] 🔄 使用保存的发布页 URL 直接跳转:', savedPublishUrl);
          window.location.href = savedPublishUrl;
          return;
        }

        // 🔑 备选方案：跳转到默认发布页
        console.log('[视频号授权] 🔄 没有保存的发布页 URL，跳转到默认发布页...');
        window.location.href = 'https://channels.weixin.qq.com/platform/post/create';
      } else {
        console.log('[视频号授权] ℹ️ 没有发布数据，这是正常的授权流程');
      }
    } catch (error) {
      console.error('[视频号授权] ❌ 检查发布数据失败:', error);
    }
  }, 2000); // 延迟2秒，等待页面完全加载

})();

