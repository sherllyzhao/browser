/**
 * 抖音创作者平台授权脚本
 * 用于处理授权流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
  'use strict';

  // ===========================
  // 🔑 检查 common.js 依赖并提供降级实现
  // ===========================
  if (typeof window.getRandomDelayMs !== "function") {
    console.warn("[抖音授权] ⚠️ common.js 未正确加载，使用降级实现");
    window.getRandomDelayMs = function (ms, jitterMs) {
      const baseMs = Number.isFinite(Number(ms)) ? Math.max(0, Math.floor(Number(ms))) : 0;
      const hasCustomJitter = jitterMs !== null && typeof jitterMs !== "undefined" && Number.isFinite(Number(jitterMs));
      const resolvedJitterMs = hasCustomJitter
        ? Math.max(0, Math.floor(Number(jitterMs)))
        : Math.max(80, Math.round(baseMs * 0.35));
      return baseMs + Math.floor(Math.random() * (resolvedJitterMs + 1));
    };
  }

  // ===========================
  // 防止脚本重复注入
  // ===========================
  if (window.__DOUYIN_SCRIPT_LOADED__) {
    console.log('[抖音授权] ⚠️ 脚本已经加载过，跳过重复注入');
    return;
  }

  // ===========================
  // 页面状态检查 - 防止异常渲染
  // ===========================
  if (typeof window.checkPageStateAndReload === 'function') {
    if (!window.checkPageStateAndReload('抖音授权')) {
      return;
    }
  }

  window.__DOUYIN_SCRIPT_LOADED__ = true;

  // 显示操作提示横幅
  if (typeof showOperationBanner === 'function') {
    showOperationBanner('正在自动授权中，请勿操作此页面...');
  }

  console.log('═══════════════════════════════════════');
  console.log('✅ 抖音授权脚本已注入');
  console.log('📍 当前 URL:', window.location.href);
  console.log('🕐 注入时间:', new Date().toLocaleString());
  console.log('═══════════════════════════════════════');

  // 检查 common.js 是否已加载
  if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
    console.error('[抖音授权] ❌ common.js 未加载！脚本可能无法正常工作');
  } else {
    console.log('[抖音授权] ✅ common.js 已加载，工具函数可用');
  }

  // ===========================
  // 1. 从 URL 获取授权数据
  // ===========================

  const urlParams = new URLSearchParams(window.location.search);
  const companyId = await window.browserAPI.getGlobalData('company_id');
  const transferId = urlParams.get('transfer_id');
  const authType = urlParams.get('auth_type') || 1;  // 从 URL 获取 auth_type，默认为 1

  console.log('[抖音授权] URL 参数:', {
    companyId,
    transferId,
    authType
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
  console.log('[抖音授权] 注册消息监听器...');

  // 防重复标志：确保数据只处理一次
  let isProcessing = false;
  let hasProcessed = false;

  // 窗口类型判定：子窗口一律授权（管他从哪进来的），主窗口浏览不触发
  // 授权窗口标志仅用于决定"授权完成后是否自动关窗"
  let isChildWindow = false;
  let isAuthModeWindow = false;
  let hasPublishData = false;
  try {
    const detectedWindowId = await window.browserAPI?.getWindowId();
    isChildWindow = typeof detectedWindowId === 'number';
    if (isChildWindow) {
      isAuthModeWindow = !!(await window.browserAPI.getGlobalData(`auth_mode_window_${detectedWindowId}`));
      // 发布窗口不触发授权兜底（避免发布中途上报+通知父页面刷新干扰发布流程）
      hasPublishData = !!(await window.browserAPI.getGlobalData(`publish_data_window_${detectedWindowId}`));
    }
    console.log('[抖音授权] 窗口 ID:', detectedWindowId, '子窗口:', isChildWindow, '授权窗口标志:', isAuthModeWindow, '发布窗口:', hasPublishData);
  } catch (e) {
    console.warn('[抖音授权] ⚠️ 读取窗口信息失败:', e.message);
  }

  // ===========================
  // 🔐 授权登录守望
  // 场景：授权窗口打开时账号未登录（或登录态失效），父页面发来 auth-data 后
  // 拉用户信息接口失败，流程就此中断；抖音登录常为同页弹框/SPA 跳转，
  // window 不销毁、脚本不会重注入，父页面也只在收到『页面加载完成』时才发 auth-data，
  // 授权第一次就卡死，用户只能关窗重开。
  // 这里改为每 3s 探测一次登录态，登录成功后 reload 让脚本干净地重新注入：
  // 重注入后重新发送『页面加载完成』，父页面会重发 auth-data 继续授权。
  // 整页跳转登录的场景本身就能自愈，守望定时器随 window 销毁，无副作用。
  // ===========================
  function startDouyinAuthLoginWatch() {
    if (window.__douyinAuthLoginWatcher__ || hasProcessed) {
      return;
    }
    console.log('[抖音授权] 👀 用户尚未登录，开始探测登录态，登录成功后将自动刷新继续授权');
    window.__douyinAuthLoginWatcher__ = setInterval(async () => {
      if (hasProcessed) {
        clearInterval(window.__douyinAuthLoginWatcher__);
        window.__douyinAuthLoginWatcher__ = null;
        return;
      }
      try {
        const response = await fetch('https://creator.douyin.com/web/api/media/user/info/', {
          method: 'get'
        });
        if (!response.ok) {
          return;
        }
        const apiData = await response.json();
        if (apiData?.user && 'nickname' in apiData.user) {
          clearInterval(window.__douyinAuthLoginWatcher__);
          window.__douyinAuthLoginWatcher__ = null;
          console.log('[抖音授权] 🔄 检测到已登录，刷新页面让授权脚本重新注入继续授权');
          window.location.reload();
        }
      } catch (_) {
        // 未登录 / 网络抖动，继续探测
      }
    }, 3000);
  }

  if (!window.browserAPI) {
    console.error('[抖音授权] ❌ browserAPI 不可用！');
  } else {
    console.log('[抖音授权] ✅ browserAPI 可用');

    if (!window.browserAPI.onMessageFromHome) {
      console.error('[抖音授权] ❌ browserAPI.onMessageFromHome 不可用！');
    } else {
      console.log('[抖音授权] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

      // ===========================
      // 核心授权流程（消息模式与兜底模式共用）
      // ===========================
      async function processAuthorization(messageData) {
        if (isProcessing) {
          console.warn('[抖音授权] ⚠️ 正在处理中，忽略重复调用');
          return;
        }
        if (hasProcessed) {
          console.warn('[抖音授权] ⚠️ 已经处理过，忽略重复调用');
          return;
        }
        isProcessing = true;
        try {
              // 获取用户信息（带重试机制）
              const user = await retryOperation(async () => {
                const response = await fetch('https://creator.douyin.com/web/api/media/user/info/', {
                  method: 'get'
                });

                if (!response.ok) {
                  throw new Error(`HTTP error! status: ${response.status}`);
                }

                const apiData = await response.json();
                const {user} = apiData;

                if (!user || !('nickname' in user) || !('follower_count' in user) || !('following_count' in user) || !('aweme_count' in user) || !('avatar_thumb' in user) || !('url_list' in user.avatar_thumb) || !user.avatar_thumb.url_list[0]) {
                  throw new Error('Incomplete user data received');
                }

                return user;
              }, 3, 2000);

              const scanData = {
                data: JSON.stringify({
                  nickname: user.nickname,
                  avatar: user.avatar_thumb.url_list[0],
                  follow: user.following_count,
                  follower_count: user.follower_count, // 我关注别人的关注数
                  video: user.aweme_count,
                  uid: user.uid,
                  favoriting_count: user.favoriting_count,
                  total_favorited: user.total_favorited,
                  company_id: await window.browserAPI.getGlobalData('company_id'),
                  auth_type: messageData?.auth_type ?? authType
                })
              };

              // 🔑 获取完整会话数据（Cookies + Storage + IndexedDB）
              console.log('[抖音授权] 📦 正在获取完整会话数据...');
              try {
                const sessionResult = await window.browserAPI.getFullSessionData('douyin.com');
                if (sessionResult.success) {
                  // 将会话数据添加到提交数据中
                  const dataObj = JSON.parse(scanData.data);
                  dataObj.cookies = JSON.stringify(sessionResult.data);
                  scanData.data = JSON.stringify(dataObj);
                  console.log(`[抖音授权] ✅ 会话数据获取成功，大小: ${Math.round(sessionResult.size / 1024)} KB`);
                } else {
                  console.warn('[抖音授权] ⚠️ 获取会话数据失败:', sessionResult.error);
                }
              } catch (sessionError) {
                console.error('[抖音授权] ⚠️ 获取会话数据异常:', sessionError);
              }

              console.log('[抖音授权] 📤 准备发送数据到接口...');
              // 发送数据到服务器（根据环境选择域名）
              const apiDomain = await getApiDomain();
              console.log('[抖音授权] 📡 API 地址:', `${apiDomain}/api/mediaauth/douyininfo`);
              const apiResponse = await fetch(`${apiDomain}/api/mediaauth/douyininfo`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(scanData)
              });

              // 检查响应状态
              if (!apiResponse.ok) {
                throw new Error(`Statistics API failed with status: ${apiResponse.status}`);
              }

              const apiResult = await apiResponse.json();
              console.log('[抖音授权] 📥 接口响应:', apiResult);

              if (apiResult && 'code' in apiResult && apiResult.code === 200) {
                console.log('[抖音授权] ✅ 数据发送成功');

                // 标记已完成（防止重复发送）
                hasProcessed = true;
                try { sessionStorage.setItem('douyin_auth_reported', '1'); } catch (e) { }

                // 🔑 迁移登录 Cookies 到持久化 session
                // 因为授权窗口使用临时 session，需要把登录状态复制到持久化 session
                // 这样发布时才能用新授权的账号
                try {
                  console.log('[抖音授权] 🔄 开始迁移 Cookies 到持久化 session...');
                  const migrateResult = await window.browserAPI.migrateCookiesToPersistent('douyin.com');
                  if (migrateResult.success) {
                    console.log(`[抖音授权] ✅ Cookies 迁移成功，共迁移 ${migrateResult.migratedCount} 个`);
                  } else {
                    console.error('[抖音授权] ⚠️ Cookies 迁移失败:', migrateResult.error);
                  }
                } catch (migrateError) {
                  console.error('[抖音授权] ⚠️ Cookies 迁移异常:', migrateError);
                }

                // API 成功后通知父页面刷新
                sendMessageToParent('授权成功，刷新数据');

                // 统计接口成功后关闭弹窗（仅授权窗口自动关，其他入口保留窗口）
                if (isAuthModeWindow) {
                  setTimeout(() => {
                    window.browserAPI.closeCurrentWindow();
                  }, window.getRandomDelayMs(10000));
                } else {
                  console.log('[抖音授权] ℹ️ 非授权窗口，授权完成后保留窗口');
                }
              } else {
                throw new Error(apiResult.msg || apiResult.message || 'Data collection failed');
              }
        } catch (error) {
          console.error('[抖音授权] ❌ 处理授权数据出错:', error);
          // 🔑 处理失败多为未登录（拉用户信息接口失败），启动登录守望等待用户登录后自动续走
          startDouyinAuthLoginWatch();
        } finally {
          isProcessing = false;
          console.log('[抖音授权] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
        }
      }

      // ===========================
      // 消息模式：监听父窗口 auth-data（windowId 强校验后调用核心流程）
      // ===========================
      window.browserAPI.onMessageFromHome(async (message) => {
        try {
          console.log('═══════════════════════════════════════');
          console.log('[抖音授权] 🎉 收到来自父窗口的消息!');
          console.log('[抖音授权] 消息类型:', typeof message);
          console.log('[抖音授权] 消息内容:', message);
          console.log('[抖音授权] 消息.type:', message?.type);
          console.log('[抖音授权] 消息.data:', message?.data);
          console.log('═══════════════════════════════════════');

          // 接收完整的授权数据
          if (message.type === 'auth-data') {
            console.log('[抖音授权] ✅ 收到授权数据:', message.data);

            // 🔑 强制检查 windowId（必须匹配，否则立即返回）
            const myWindowId = await window.browserAPI.getWindowId();
            console.log('[抖音授权] 我的窗口 ID:', myWindowId, '消息目标窗口 ID:', message.windowId);

            if (!message.windowId) {
              console.error('[抖音授权] ❌ 收到的 auth-data 消息缺少 windowId，这不应该发生！已拒绝处理');
              return;
            }

            if (myWindowId !== message.windowId) {
              console.warn('[抖音授权] ⚠️ 消息不是发给我的（我是 ' + myWindowId + '，消息发给 ' + message.windowId + '），拒绝处理');
              return;
            }

            console.log('[抖音授权] ✅ windowId 匹配，安全处理消息');

            // 更新全局变量
            if (message.data) {
              const messageData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
              window.__AUTH_DATA__ = {
                ...window.__AUTH_DATA__,
                message: messageData,
                receivedAt: Date.now()
              };
              console.log('[抖音授权] ✅ 授权数据已更新:', window.__AUTH_DATA__);
              await processAuthorization(messageData);
            }
          }
        } catch (error) {
          console.error('[抖音授权] ❌ 消息处理出错:', error);
        }
      });

      console.log('[抖音授权] ✅ 消息监听器注册成功');

      // ===========================
      // 兜底模式：子窗口必须完成授权（管他从哪进来的；auth-data 丢失/一次性失败时接口轮询）
      // ===========================
      (async () => {
        try {
          if (!isChildWindow) {
            console.log('[抖音授权] ℹ️ 主窗口浏览，不启动兜底授权');
            return;
          }
          if (hasPublishData) {
            console.log('[抖音授权] ℹ️ 发布窗口，不启动兜底授权');
            return;
          }
          // 本窗口已成功上报过就不再兜底（上报失败不置位，下次导航可重试）
          try {
            if (sessionStorage.getItem('douyin_auth_reported') === '1') {
              console.log('[抖音授权] ℹ️ 本窗口已完成过授权上报，兜底不启动');
              return;
            }
          } catch (dedupError) { }

          // 给正常 auth-data 消息 15 秒到达时间
          await new Promise(resolve => setTimeout(resolve, 15000));
          if (hasProcessed) {
            console.log('[抖音授权] ℹ️ 消息模式已完成授权，兜底退出');
            return;
          }

          console.log('[抖音授权] 🚀 启动兜底授权：轮询用户信息接口等待登录...');
          const startTime = Date.now();
          const maxWaitMs = 5 * 60 * 1000;
          let attempt = 0;
          while (Date.now() - startTime < maxWaitMs) {
            if (hasProcessed) {
              console.log('[抖音授权] ℹ️ 授权已完成，兜底轮询退出');
              return;
            }
            if (isProcessing) {
              // 消息模式正在处理，等它结束再看结果
              await new Promise(resolve => setTimeout(resolve, 3000));
              continue;
            }
            attempt++;
            try {
              const probe = await fetch('https://creator.douyin.com/web/api/media/user/info/', {
                method: 'get'
              });
              if (probe.ok) {
                const probeResult = await probe.json();
                if (probeResult?.user && 'nickname' in probeResult.user) {
                  console.log(`[抖音授权] ✅ 兜底第 ${attempt} 次轮询检测到已登录，执行授权流程`);
                  await processAuthorization({ auth_type: authType });
                  if (hasProcessed) {
                    return;
                  }
                  // 上报失败，10 秒后重试
                  await new Promise(resolve => setTimeout(resolve, 10000));
                  continue;
                }
              }
              if (attempt === 1 || attempt % 10 === 0) {
                console.log(`[抖音授权] ⏳ 兜底第 ${attempt} 次轮询：未登录，等待扫码...`);
              }
            } catch (probeError) {
              if (attempt === 1 || attempt % 10 === 0) {
                console.warn(`[抖音授权] ⏳ 兜底第 ${attempt} 次轮询异常:`, probeError.message);
              }
            }
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
          console.error('[抖音授权] ❌ 兜底轮询超时（5分钟），未完成授权');
        } catch (fallbackError) {
          console.error('[抖音授权] ❌ 兜底授权异常:', fallbackError);
        }
      })();
    }
  }

  // ===========================
  // 6. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
  // ===========================

  // 页面加载完成后向父窗口发送消息
  console.log('[抖音授权] 页面加载完成，发送 页面加载完成 消息');
  sendMessageToParent('页面加载完成');

  console.log('═══════════════════════════════════════');
  console.log('✅ 抖音授权脚本初始化完成');
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
      const windowId = await window.browserAPI.getWindowId();
      if (!windowId) {
        console.log('[抖音授权] ℹ️ 无法获取窗口 ID，跳过发布数据检查');
        return;
      }

      const globalPublishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
      console.log('[抖音授权] 🔍 检查发布数据:', {
        globalData: globalPublishData ? '有' : '无',
        windowId
      });

      if (!globalPublishData) {
        console.log('[抖音授权] ℹ️ 没有发布数据，这是正常的授权流程');
        return;
      }

      const isAuthWindow = await window.browserAPI.getGlobalData(`auth_mode_window_${windowId}`);
      if (isAuthWindow) {
        console.log('[抖音授权] ℹ️ 授权窗口保留发布数据，继续正常授权流程');
        return;
      }

      console.log('[抖音授权] ✅ 检测到发布数据，这是从发布流程登录后跳回来的');
      console.log('[抖音授权] 🔄 准备自动跳转到发布页...');

      await window.delay(1000);

      const publishUrl = 'https://creator.douyin.com/creator-micro/content/upload';
      console.log('[抖音授权] 🔗 跳转到发布页:', publishUrl);
      window.location.href = publishUrl;
    } catch (error) {
      console.error('[抖音授权] ❌ 检查发布数据失败:', error);
    }
  }, window.getRandomDelayMs(2000));

})();

