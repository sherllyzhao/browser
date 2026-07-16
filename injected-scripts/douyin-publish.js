let introFilled = false; // 标记 intro 是否已填写
let fillFormRunning = false; // 标记 fillFormData 是否正在执行
let publishRunning = false; // 标记发布是否正在执行，防止重复点击

// 防重复标志：确保数据只处理一次
let isProcessing = false;
let hasProcessed = false;

/**
 * 抖音创作者平台发布脚本
 * 用于处理发布流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
  'use strict';

  // ===========================
  // 🔑 检查 common.js 依赖并提供降级实现
  // ===========================
  if (typeof window.getRandomDelayMs !== "function") {
    console.warn("[抖音发布] ⚠️ common.js 未正确加载，使用降级实现");
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
    console.log('[抖音发布] ⚠️ 脚本已经加载过，跳过重复注入');
    return;
  }

  // ===========================
  // 页面状态检查 - 防止异常渲染
  // ===========================
  if (typeof window.checkPageStateAndReload === 'function') {
    if (!window.checkPageStateAndReload('抖音发布')) {
      return;
    }
  }

  window.__DOUYIN_SCRIPT_LOADED__ = true;

  // ===========================
  // 🔑 抖音白屏检测和自动恢复（使用公共函数）
  // ===========================
  if (typeof window.checkBlankPageAndReload === 'function') {
    window.checkBlankPageAndReload('抖音发布', [
      '.editor-kit-root-container',
      '.semi-input',
      '.button-dhlUZE'
    ], 3000, 3);
  }

  // 显示操作提示横幅
  if (typeof showOperationBanner === 'function') {
    showOperationBanner('正在自动发布中，请勿操作此页面...');
  }

  console.log('═══════════════════════════════════════');
  console.log('✅ 抖音发布脚本已注入');
  console.log('📍 当前 URL:', window.location.href);
  console.log('🕐 注入时间:', new Date().toLocaleString());
  console.log('═══════════════════════════════════════');

  // 检查 common.js 是否已加载（延迟检查，给 common.js 时间执行）
  setTimeout(() => {
    if (!window.__COMMON_JS_LOADED__) {
      console.error('[抖音发布] ❌ common.js 未加载！');
    } else if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined' || typeof uploadVideo === 'undefined') {
      console.error('[抖音发布] ❌ common.js 加载不完整！缺少必需函数');
      console.error('[抖音发布] waitForElement:', typeof waitForElement);
      console.error('[抖音发布] retryOperation:', typeof retryOperation);
      console.error('[抖音发布] uploadVideo:', typeof uploadVideo);
      console.error('[抖音发布] sendStatistics:', typeof sendStatistics);
      console.error('[抖音发布] clickWithRetry:', typeof clickWithRetry);
      console.error('[抖音发布] closeWindowWithMessage:', typeof closeWindowWithMessage);
      console.error('[抖音发布] delay:', typeof delay);
    } else {
      console.log('[抖音发布] ✅ common.js 已完整加载，所有工具函数可用');
    }
  }, window.getRandomDelayMs(100)); // 延迟 100ms 检查

  // ===========================
  // 1. 从 URL 获取发布数据
  // ===========================

  const urlParams = new URLSearchParams(window.location.search);
  const companyId = await window.browserAPI.getGlobalData('company_id');
  const transferId = urlParams.get('transfer_id');

  console.log('[抖音发布] URL 参数:', {
    companyId,
    transferId
  });

  // 存储发布数据到全局
  window.__AUTH_DATA__ = {
    companyId,
    transferId,
    timestamp: Date.now()
  };

  // ===========================
  // 2. 暴露全局方法供手动调用
  // ===========================

  window.__DOUYIN_AUTH__ = {
    // 发送发布成功消息
    notifySuccess: () => {
      sendMessageToParent('发布成功');
    },

    // 发送自定义消息
    sendMessage: (message) => {
      sendMessageToParent(message);
    },

    // 获取发布数据
    getAuthData: () => window.__AUTH_DATA__,
  };

  // ===========================
  // 4. 显示调试信息横幅
  // ===========================

  // ===========================
  // 5. 接收来自父窗口的消息（必须在发送 页面加载完成 之前注册！）
  // ===========================
  console.log('[抖音发布] 注册消息监听器...');

  if (!window.browserAPI) {
    console.error('[抖音发布] ❌ browserAPI 不可用！');
  } else {
    console.log('[抖音发布] ✅ browserAPI 可用');

    if (!window.browserAPI.onMessageFromHome) {
      console.error('[抖音发布] ❌ browserAPI.onMessageFromHome 不可用！');
    } else {
      console.log('[抖音发布] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

      window.browserAPI.onMessageFromHome(async (message) => {
        console.log('═══════════════════════════════════════');
        console.log('[抖音发布] 🎉 收到来自父窗口的消息!');
        console.log('[抖音发布] 消息类型:', typeof message);
        console.log('[抖音发布] 消息内容:', message);
        console.log('[抖音发布] 消息.type:', message?.type);
        console.log('[抖音发布] 消息.data:', message?.data);
        console.log('═══════════════════════════════════════');

        // 接收完整的发布数据（直接传递，不使用 IndexedDB）
        if (message.type === 'publish-data') {
          console.log('[抖音发布] ✅ 收到发布数据:', message.data);
          console.log('[抖音发布] ✅✅✅ 进入处理逻辑 ✅✅✅');

          // 使用公共方法检查 windowId 是否匹配
          const isMatch = await checkWindowIdMatch(message, '[抖音发布]');
          if (!isMatch) return;

          // 使用公共方法解析消息数据
          const messageData = parseMessageData(message.data, '[抖音发布]');
          if (!messageData) return;

          // 使用公共方法恢复会话数据
          const needReload = await restoreSessionAndReload(messageData, '[抖音发布]');
          if (needReload) return; // 已触发刷新，脚本会重新注入

          // 防重复检查
          console.log('[抖音发布] 🔍 检查防重复标志: isProcessing=', isProcessing, ', hasProcessed=', hasProcessed);
          if (isProcessing) {
            console.warn('[抖音发布] ⚠️ 正在处理中，忽略重复消息');
            return;
          }
          if (hasProcessed) {
            console.warn('[抖音发布] ⚠️ 已经处理过，忽略重复消息');
            return;
          }

          // 标记为正在处理
          isProcessing = true;
          console.log('[抖音发布] 🔄 已标记为正在处理');

          // 更新全局变量
          console.log('[抖音发布] 🔍 检查 message.data:', !!message.data);
          if (message.data) {
            console.log("🚀 ~  ~ messageData: ", messageData);

            window.__AUTH_DATA__ = {
              ...window.__AUTH_DATA__,
              message: messageData,
              receivedAt: Date.now()
            };
            console.log('[抖音发布] ✅ 发布数据已更新:', window.__AUTH_DATA__);

            // 💾 保存数据到 localStorage（用于授权跳转后恢复）
            /* try {
              localStorage.setItem('DOUYIN_PUBLISH_DATA', message.data);
              console.log('[抖音发布] 💾 数据已保存到 localStorage');
            } catch (e) {
              console.error('[抖音发布] ❌ 保存数据失败:', e);
            }

            // 🔖 保存当前发布页URL（用于授权跳转后返回）
            try {
              localStorage.setItem('DOUYIN_PUBLISH_URL', window.location.href);
              console.log('[抖音发布] 🔖 已保存发布页URL:', window.location.href);
            } catch (e) {
              console.error('[抖音发布] ❌ 保存发布页URL失败:', e);
            } */

            console.log("🚀 ~  ~ messageData: ", messageData);
            await uploadVideo(messageData);
            try {
              await retryOperation(async () => await fillFormData(messageData), 3, 2000);
            } catch (e) {
              console.log('[抖音发布] ❌ 填写表单数据失败:', e);
            }

            console.log('[抖音发布] 📤 准备发送数据到接口...');
            console.log('[抖音发布] ✅ 发布流程已启动，等待 publishApi 完成...');
            // 注意：不在这里关闭窗口，因为 publishApi 内部有异步的统计接口调用
            // 窗口会在 publishApi 完成后自动关闭
          }

          // 重置处理标志（无论成功或失败）
          isProcessing = false;
          console.log('[抖音发布] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
        }
      });

      console.log('[抖音发布] ✅ 消息监听器注册成功');
    }
  }

  // ===========================
  // 6. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
  // ===========================

  // 页面加载完成后向父窗口发送消息
  console.log('[抖音发布] 页面加载完成，发送 页面加载完成 消息');
  sendMessageToParent('页面加载完成');

  console.log('═══════════════════════════════════════');
  console.log('✅ 抖音发布脚本初始化完成');
  console.log('📝 全局方法: window.__DOUYIN_AUTH__');
  console.log('  - notifySuccess()  : 发送发布成功消息');
  console.log('  - sendMessage(msg) : 发送自定义消息');
  console.log('  - getAuthData()    : 获取发布数据');
  console.log('═══════════════════════════════════════');

  // ===========================
  // 7. 检查是否是恢复 cookies 后的刷新（立即执行）
  // ===========================
  await (async () => {
    // 如果已经在处理或已处理完成，跳过
    if (isProcessing || hasProcessed) {
      console.log('[抖音发布] ⏭️ 已在处理中或已完成，跳过全局存储读取');
      return;
    }

    try {
      // 获取当前窗口 ID
      const windowId = await window.browserAPI.getWindowId();
      console.log('[抖音发布] 检查全局存储，窗口 ID:', windowId);

      if (!windowId) {
        console.log('[抖音发布] ❌ 无法获取窗口 ID');
        return;
      }

      // 检查是否有恢复 cookies 后保存的发布数据
      const publishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
      console.log('[抖音发布] 📦 从全局存储读取 publish_data_window_' + windowId + ':', publishData ? '有数据' : '无数据');

      if (publishData && !isProcessing && !hasProcessed) {
        console.log('[抖音发布] ✅ 检测到恢复 cookies 后的数据，开始处理...');

        // 🔑 不再立即删除数据，改为在发布完成后删除
        // 这样如果登录跳转后跳回来，数据仍然可用
        // 使用 hasProcessed 标记防止重复处理
        console.log('[抖音发布] 📝 保留 publish_data_window_' + windowId + ' 数据，待发布完成后清理');

        // 标记为正在处理
        isProcessing = true;

        // 更新全局变量
        window.__AUTH_DATA__ = {
          ...window.__AUTH_DATA__,
          message: publishData,
          source: 'cookieRestore',
          windowId: windowId,
          receivedAt: Date.now()
        };

        console.log("🚀 ~  ~ publishData: ", publishData);
        await uploadVideo(publishData);
        try {
          await retryOperation(async () => await fillFormData(publishData), 3, 2000);
        } catch (e) {
          console.log('[抖音发布] ❌ 填写表单数据失败:', e);
        }

        console.log('[抖音发布] 📤 准备发送数据到接口...');
        console.log('[抖音发布] ✅ 发布流程已启动，等待 publishApi 完成...');

        isProcessing = false;
      }
    } catch (error) {
      console.error('[抖音发布] ❌ 从全局存储读取数据失败:', error);
    }
  })();
})();

// ===========================
// 7. 发布视频到抖音
// ===========================
function isDouyinLoginExpiredMessage(message) {
  const text = String(message || '').trim().toLowerCase();
  if (!text) {
    return false;
  }

  const loginExpiredKeywords = [
    '登录过期',
    '登录已过期',
    '登陆过期',
    '需要重新登录',
    'login expired',
    'need to login',
    'please login',
    '授权已过期',
    '权限已过期',
    '会话已过期'
  ];

  return loginExpiredKeywords.some(keyword => text.includes(keyword));
}

// ===========================
// 🔐 登录过期停窗等待：检测到登录过期时不再上报失败关窗，
// 停在当前窗口等用户手动登录，登录成功后 reload 让脚本重新注入，
// 从 publish_data_window_${windowId} 恢复发布数据继续发布；
// 主进程「登录页→业务页」导航检测会自动保存新登录态到后台。
// 抖音掉登录常为同页弹登录框（URL 不变），所以用接口探测登录态而非 URL 判断。
// ===========================
function showDouyinLoginWaitTip() {
  try {
    if (document.getElementById('__douyin_login_wait_tip__')) {
      return;
    }
    const tip = document.createElement('div');
    tip.id = '__douyin_login_wait_tip__';
    tip.textContent = '抖音登录已失效，请在本窗口重新登录，登录成功后将自动继续发布';
    tip.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:10px 16px;background:#fff7e6;color:#d46b08;border-bottom:1px solid #ffd591;font-size:14px;font-weight:600;text-align:center;pointer-events:none;';
    (document.body || document.documentElement).appendChild(tip);
  } catch (e) {
    console.warn('[抖音发布] ⚠️ 显示登录提示条失败:', e.message);
  }
}

function startDouyinPublishLoginWatch() {
  if (window.__douyinPublishLoginWatcher__) {
    return;
  }
  console.log('[抖音发布] 👀 开始探测登录态，用户重新登录成功后将自动刷新继续发布');
  if (typeof hideOperationBanner === 'function') {
    hideOperationBanner();
  }
  showDouyinLoginWaitTip();
  window.__douyinPublishLoginWatcher__ = setInterval(async () => {
    try {
      const response = await fetch('https://creator.douyin.com/web/api/media/user/info/', {
        method: 'get'
      });
      if (!response.ok) {
        return;
      }
      const apiData = await response.json();
      if (apiData?.user && 'nickname' in apiData.user) {
        clearInterval(window.__douyinPublishLoginWatcher__);
        window.__douyinPublishLoginWatcher__ = null;
        console.log('[抖音发布] 🔄 检测到已重新登录，刷新页面以继续发布流程');
        window.location.reload();
      }
    } catch (_) {
      // 未登录 / 网络抖动，继续探测
    }
  }, 3000);
}

function isDouyinNetworkErrorMessage(message) {
  const text = String(message || '').trim().toLowerCase();
  if (!text) {
    return false;
  }

  const networkErrorKeywords = [
    '网络错误',
    'network error',
    'net::',
    'failed to fetch',
    '连接失败',
    '请求失败',
    'timeout',
    '超时'
  ];

  return networkErrorKeywords.some(keyword => text.includes(keyword));
}

function isDouyinPublishSuccessMessage(message) {
  const text = String(message || '').trim();
  if (!text) {
    return false;
  }
  const successKeywords = ['发布成功', '提交成功', '上传成功', '成功'];
  const failureKeywords = ['失败', '错误', '异常', '不可用', '未找到', '超时', '审核未通过'];
  return successKeywords.some(keyword => text.includes(keyword))
    && !failureKeywords.some(keyword => text.includes(keyword));
}

function isDouyinNeutralPublishMessage(message) {
  const text = String(message || '').trim();
  if (!text) {
    return true;
  }

  const exactNeutralMessages = ['点击完成', '点击成功'];
  const pendingKeywords = ['正在发布', '正在提交', '正在上传', '加载中', '处理中'];
  const failureKeywords = ['失败', '错误', '异常', '不可用', '未找到', '超时', '审核未通过'];
  if (failureKeywords.some(keyword => text.includes(keyword))) {
    return false;
  }

  return exactNeutralMessages.includes(text)
    || pendingKeywords.some(keyword => text.includes(keyword));
}

function getDouyinTimeoutFailureMessage(lastToastMessage, clickMessage) {
  const toastText = String(lastToastMessage || '').trim();
  if (toastText && !isDouyinNeutralPublishMessage(toastText)) {
    return toastText;
  }

  const clickText = String(clickMessage || '').trim();
  if (clickText && !isDouyinNeutralPublishMessage(clickText)) {
    return clickText;
  }

  return '发布超时，未跳转到成功页（点击已触发，但未捕获平台成功或失败提示）';
}

async function clickDouyinPublishButton(publishBtn) {
  let trustedResult = null;
  if (typeof clickWithTrustedRetry === 'function') {
    trustedResult = await clickWithTrustedRetry(publishBtn, 3, 500, true, '');
    if (trustedResult?.success) {
      return {
        ...trustedResult,
        clickMode: 'trusted',
      };
    }

    console.warn('[抖音发布] ⚠️ 可信点击失败，准备回退普通点击:', trustedResult);
  } else {
    console.warn('[抖音发布] ⚠️ clickWithTrustedRetry 不可用，准备回退普通点击');
  }

  if (typeof clickWithRetry === 'function') {
    const fallbackResult = await clickWithRetry(publishBtn, 3, 500, true, '');
    return {
      ...fallbackResult,
      clickMode: 'js-fallback',
      trustedMessage: trustedResult?.message || '',
    };
  }

  return {
    success: false,
    message: trustedResult?.message || '点击工具不可用',
    clickMode: 'none',
  };
}

function normalizeDouyinPublishText(message) {
  return String(message || '').replace(/\s+/g, ' ').trim();
}

function isDouyinPhoneVerifyMessage(message) {
  const text = normalizeDouyinPublishText(message);
  if (!text) {
    return false;
  }

  const keywords = [
    '接收短信验证码',
    '短信验证码',
    '手机号验证',
    '验证手机号',
    '选择其他验证方式',
    '当前手机号',
  ];

  return keywords.some(keyword => text.includes(keyword));
}

function getDouyinPhoneVerifyMessage() {
  // 🔑 扩展选择器列表，覆盖更多弹窗变体
  const selectors = [
    '#uc-second-verify',
    '.uc-ui-verify-sms-verify',
    '.second-verify-panel',           // 新增：主弹窗容器
    '.uc-ui-layout_content',          // 新增：布局容器
    '.uc-ui-verify-new_header',       // 新增：弹窗标题
    '[class*="second-verify"]',       // 新增：通配符匹配
    '[class*="sms-verify"]',          // 新增：通配符匹配
  ];
  const bodyText = normalizeDouyinPublishText(document.body?.innerText || document.body?.textContent || '');

  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      if (!element) {
        continue;
      }

      const rect = element.getBoundingClientRect?.();
      const isVisible = element.offsetParent !== null || (rect && rect.width > 0 && rect.height > 0);
      if (!isVisible) {
        continue;
      }

      const text = normalizeDouyinPublishText(element.textContent || element.innerText || '');
      if (text && isDouyinPhoneVerifyMessage(text)) {
        console.log('[抖音发布] 🔍 通过选择器检测到手机验证弹窗:', selector, '内容:', text.substring(0, 100));
        return text;
      }
    }
  }

  // 🔑 回退方案：检查整个 body 文本
  if (isDouyinPhoneVerifyMessage(bodyText)) {
    console.log('[抖音发布] 🔍 通过 body 文本检测到手机验证弹窗:', bodyText.substring(0, 100));
    return bodyText;
  }

  return '';
}

async function clearDouyinPublishSuccessData(windowId) {
  if (windowId) {
    localStorage.removeItem(`PUBLISH_SUCCESS_DATA_${windowId}`);
    await window.browserAPI?.removeGlobalData?.(`PUBLISH_SUCCESS_DATA_${windowId}`);
    await window.browserAPI?.removeGlobalData?.(`publish_data_window_${windowId}`);
  }
  localStorage.removeItem('PUBLISH_SUCCESS_DATA');
}

async function reportDouyinPublishSuccess(publishId, windowId, reason = 'success-toast') {
  if (!publishId) {
    console.error('[抖音发布] ❌ publishId 为空，无法上报成功统计');
    return false;
  }

  console.log('[抖音发布] 📤 发送成功统计:', { publishId, reason });
  let result = null;
  if (typeof sendStatistics === 'function') {
    result = await sendStatistics(publishId, '抖音发布');
  } else if (typeof window.sendStatistics === 'function') {
    result = await window.sendStatistics(publishId, '抖音发布');
  } else {
    const scanData = typeof window.buildStatisticsRequestData === 'function'
      ? await window.buildStatisticsRequestData(publishId, '抖音发布')
      : { data: JSON.stringify({ id: publishId }) };
    const url = typeof getStatisticsUrl === 'function'
      ? await getStatisticsUrl(false)
      : await window.getStatisticsUrl(false);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scanData),
      keepalive: true,
    });
    result = { success: response.ok, response };
  }

  if (result?.success) {
    await clearDouyinPublishSuccessData(windowId);
    console.log('[抖音发布] ✅ 成功统计已上报，发布标记已清理:', result);
    return true;
  }

  console.error('[抖音发布] ❌ 成功统计上报失败:', result);
  return false;
}

async function publishApi(dataObj) {
  console.log("🚀 ~ publishApi ~ dataObj: ", dataObj);

  // 防止重复执行
  if (publishRunning || hasProcessed) {
    console.log('Publish is already running or processed, skipping duplicate call');
    return;
  }

  const publishId = dataObj.video.dyPlatform.id;

  // 获取窗口 ID（用于多窗口并发发布时区分数据）
  let windowId = null;
  try {
    windowId = await window.browserAPI.getWindowId();
    console.log('[抖音发布] 当前窗口 ID:', windowId);
  } catch (e) {
    console.error('[抖音发布] ❌ 获取窗口 ID 失败:', e);
  }

  try {
    // 标记发布正在进行
    publishRunning = true;
    let phoneVerifyReported = false;

    const reportDouyinPhoneVerifyFailure = async (reason = 'phone-verify', rawMessage = '') => {
      if (phoneVerifyReported) {
        // 🔑 已上报过手机验证错误，返回 false 让轮询继续（不退出）
        console.log('[抖音发布] ⚠️ 手机验证错误已上报过，跳过重复上报，继续监听后续错误');
        return false;
      }

      // 🔑 先检查用户是否正在操作，如果是就等他停下来
      if (typeof window.checkUserActivity === 'function') {
        console.log('[抖音发布] 🔍 检测到手机验证弹窗，先检查用户是否正在操作...');
        await window.checkUserActivity();
        console.log('[抖音发布] ✅ 用户操作检查完成，继续处理验证弹窗');
      }

      phoneVerifyReported = true;
      // 🔑 不要设置 hasProcessed = true，让轮询可以继续检测后续错误
      const normalizedRawMessage = normalizeDouyinPublishText(rawMessage);
      console.warn('[抖音发布] 📱 检测到手机号认证弹窗，准备上报失败:', {
        reason,
        rawMessage: normalizedRawMessage,
      });

      // 🔑 显示醒目的横幅提示（红色警告）
      if (typeof showOperationBanner === 'function') {
        showOperationBanner('⚠️ 需要输入手机验证码，请完成验证后手动点击发布。窗口将保持打开，请勿关闭！', 'error');
      }

      // 🔑 立即上报错误（让后台知道卡在这里了）
      try {
        await sendStatisticsError(publishId, '需要手机号认证，请手动完成', '抖音发布');
        console.log('[抖音发布] 📤 手机验证错误已上报');
      } catch (reportError) {
        console.error('[抖音发布] ❌ 手机号认证失败上报异常:', reportError);
      }

      // 🔑 保存 publishId 到 localStorage，供 publish-success.js 使用
      if (publishId) {
        try {
          const windowKey = windowId ? `PUBLISH_SUCCESS_DATA_${windowId}` : 'PUBLISH_SUCCESS_DATA';
          localStorage.setItem(windowKey, JSON.stringify({ publishId: publishId }));
          console.log('[抖音发布] 💾 已保存 publishId 到 localStorage:', windowKey);

          // 同时保存到 globalData
          if (window.browserAPI && window.browserAPI.setGlobalData) {
            await window.browserAPI.setGlobalData(`PUBLISH_SUCCESS_DATA_${windowId}`, {publishId: publishId});
            console.log('[抖音发布] 💾 已保存 publishId 到 globalData');
          }
        } catch (e) {
          console.error('[抖音发布] ❌ 保存 publishId 失败:', e);
        }
      }

      // 🔑 不设置 publishRunning = false，让脚本保持运行状态

      // 🔑 不关闭窗口，让轮询继续运行，监听用户手动发布后的错误
      console.log('[抖音发布] 🛑 暂停自动发布流程，但继续监听后续错误');
      console.log('[抖音发布] 💡 用户需要：1) 完成手机验证 2) 手动点击发布按钮');
      console.log('[抖音发布] 📌 轮询继续运行，如果发布失败会检测到新错误并上报');
      console.log('[抖音发布] 📌 如果发布成功，publish-success.js 会自动上报成功状态覆盖此错误');

      // 🔑 返回 false 表示"不要退出轮询"
      return false;
    };

    const publishHelperStatus = {
      isDouyinPublishSuccessMessage: typeof isDouyinPublishSuccessMessage,
      isDouyinPhoneVerifyMessage: typeof isDouyinPhoneVerifyMessage,
      getDouyinPhoneVerifyMessage: typeof getDouyinPhoneVerifyMessage,
      clearDouyinPublishSuccessData: typeof clearDouyinPublishSuccessData,
      reportDouyinPublishSuccess: typeof reportDouyinPublishSuccess,
      reportDouyinPhoneVerifyFailure: typeof reportDouyinPhoneVerifyFailure,
      clickDouyinPublishButton: typeof clickDouyinPublishButton,
    };
    const missingPublishHelpers = Object.entries(publishHelperStatus)
      .filter(([, value]) => value !== 'function')
      .map(([key]) => key);
    if (missingPublishHelpers.length > 0) {
      throw new Error(`publishApi 依赖缺失: ${missingPublishHelpers.join(', ')}`);
    }

    // 等待页面稳定
    await delay(2000);

    // 等待发布按钮可用
    const publishBtn = await retryOperation(async () => {
      const btn = document.querySelector(".button-dhlUZE");
      if (!btn) {
        throw new Error('发布按钮未找到');
      }
      // 🔑 检查按钮是否 disabled
      if (btn.disabled || btn.classList.contains('disabled') || btn.getAttribute('disabled') !== null) {
        throw new Error('发布按钮当前不可用(disabled)，可能不符合发布要求');
      }
      return btn;
    }, 10, 2000);

    // 等待按钮事件绑定完成
    await delay(800);

    // 🔑 抖音成功后会直接跳转页面，必须在点击前保存数据
    // 否则跳转后 publishApi 的后续代码不会执行
    // 使用窗口 ID 作为 key，避免多窗口并发时数据覆盖
    try {
      const storageKey = windowId ? `PUBLISH_SUCCESS_DATA_${windowId}` : 'PUBLISH_SUCCESS_DATA';
      localStorage.setItem(storageKey, JSON.stringify({ publishId: publishId }));
      console.log('[抖音发布] 💾 已提前保存 publishId 到 localStorage:', publishId, 'key:', storageKey);

      // 🔑 同时保存到 globalData（更可靠，不受域名隔离限制）
      if (window.browserAPI && window.browserAPI.setGlobalData) {
        await window.browserAPI.setGlobalData(`PUBLISH_SUCCESS_DATA_${windowId}`, {publishId: publishId});
        console.log('[抖音发布] 💾 已保存 publishId 到 globalData');
      }
    } catch (e) {
      console.error('[抖音发布] ❌ 保存 publishId 失败:', e);
    }

    // 生产环境：必须点击发布按钮
    console.log('[抖音发布] ✅ 生产环境确认，准备点击发布按钮...');

    // 检测视频是否上传完成
    console.log('[抖音发布] ⏳ 等待视频上传完成...');
    await retryOperation(async () => {
      const percentEle = document.querySelector('[class*="upload-progress-style"] [class*="text-"]');
      if (percentEle) {
        const percentText = percentEle.textContent || '';
        throw new Error('视频正在上传中: ' + percentText);
      }
      console.log('[抖音发布] ✅ 检测到视频上传完成（进度元素已消失）');
      return true;
    }, 150, 2000); // 最多重试 150 次，每次间隔 2 秒，共 5 分钟

    // 检测封面是否通过检测
    console.log('[抖音发布] ⏳ 等待封面检测通过...');
    const coverCheckStartTime = Date.now();
    const coverCheckTimeout = 120000; // 2分钟超时
    const coverCheckInterval = 2000;
    const maxCoverRetries = 30; // 🔑 最大重试次数（30次 * 2秒 = 60秒内尝试设置封面）
    let coverRetryCount = 0;

    while (Date.now() - coverCheckStartTime < coverCheckTimeout && coverRetryCount < maxCoverRetries) {
      coverRetryCount++;
      let checkElement = null;
      try {
        checkElement = await waitForElement('.cover-check [class*="title-"]', 10000); // 🔑 增加到 10 秒
      } catch (e) {
        console.log('[封面检测] ⚠️ 未找到检测元素，继续等待...');
        await delay(coverCheckInterval);
        continue;
      }

      const currentText = checkElement.textContent || '';
      console.log('[封面检测] 当前状态:', currentText);

      if (currentText.includes('封面检测通过')) {
        console.log('[封面检测] ✅ 检测通过');
        break;
      }

      // 尝试设置封面
      console.log('[封面检测] ⚠️ 未通过，尝试设置封面...');
      try {
        let coverInput = null;
        const selectors = [
          '[class*="recommendCover-"]:nth-child(1)',
          '[class*="recommendCover-"]:first-child',
          '[class*="recommendCover-"]'
        ];

        for (const selector of selectors) {
          try {
            coverInput = await waitForElement(selector, 10000); // 🔑 增加到 10 秒
            if (coverInput) {
              console.log(`[封面设置] ✅ 找到封面元素: ${selector}`);
              break;
            }
          } catch (e) {
            // 继续尝试下一个选择器
          }
        }

        if (coverInput) {
          const rect = coverInput.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;

          const mouseEventOptions = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y,
            button: 0
          };

          coverInput.dispatchEvent(new MouseEvent('mouseover', mouseEventOptions));
          await delay(50);
          coverInput.dispatchEvent(new MouseEvent('mousedown', mouseEventOptions));
          await delay(50);
          coverInput.dispatchEvent(new MouseEvent('mouseup', mouseEventOptions));
          await delay(50);
          coverInput.dispatchEvent(new MouseEvent('click', mouseEventOptions));

          console.log('[封面设置] ✅ 已触发封面点击');
          await delay(1000);

          // 尝试确认弹窗
          try {
            const confirmDialog = await waitForElement('.semi-modal-content.semi-modal-content-animate-show', 3000);
            const confirmBtn = await waitForElement('.semi-button.semi-button-primary', 3000, 200, confirmDialog);
            confirmBtn.dispatchEvent(new Event('click', { bubbles: true }));
            console.log('[封面设置] ✅ 已确认弹窗');
          } catch (dialogError) {
            console.log('[封面设置] ⚠️ 未找到确认弹窗');
          }

          await delay(3000);
        }
      } catch (coverError) {
        console.log('[封面设置] ❌ 设置封面失败:', coverError.message);
      }

      await delay(coverCheckInterval);
    }

    // 🔑 检查退出原因
    if (coverRetryCount >= maxCoverRetries) {
      console.log(`[抖音发布] ⚠️ 封面设置重试次数已达上限(${maxCoverRetries}次)，继续发布流程`);
    }

    console.log('[抖音发布] ✅ 封面检测完成，准备点击发布按钮');
    await delay(1000);

    const clickResult = await clickDouyinPublishButton(publishBtn); // 优先可信点击，失败时回退普通点击

    if (!clickResult.success) {
      console.error('[抖音发布] ❌ 所有点击尝试均失败:', clickResult.message);
      // 清除提前保存的数据（使用窗口专属 key 和通用 key，确保兼容性）
      await clearDouyinPublishSuccessData(windowId);
      // 发送失败统计
      await sendStatisticsError(publishId, clickResult.message || '点击发布按钮失败', '抖音发布');
      publishRunning = false;
      throw new Error('发布按钮点击失败: ' + clickResult.message);
    }

    console.log('[抖音发布] ✅ 发布按钮已点击');
    // 🚀 点击发布成功 → 立即乐观上报一次成功（GEO 由 sendOptimisticSuccess 内部跳过；不 await 避免阻塞发布流程）
    if (publishId) { window.sendOptimisticSuccess(publishId, '抖音发布').catch(() => {}); }
    console.log('[抖音发布] 📨 平台提示:', {
      message: clickResult.message,
      clickMode: clickResult.clickMode || '',
      trustedMessage: clickResult.trustedMessage || '',
    });

    // 等待页面稳定
    await delay(2000);

    const initialPhoneVerifyMessage =
      getDouyinPhoneVerifyMessage() ||
      (isDouyinPhoneVerifyMessage(clickResult.message) ? clickResult.message : '');
    if (initialPhoneVerifyMessage) {
      console.log('[抖音发布] 📱 点击后检测到手机号认证弹窗:', initialPhoneVerifyMessage);
      const shouldExit = await reportDouyinPhoneVerifyFailure('post-click', initialPhoneVerifyMessage);
      // 🔑 如果返回 true，说明需要退出（旧逻辑兼容）；如果返回 false，继续轮询
      if (shouldExit) {
        return;
      }
      // 如果返回 false，不 return，继续执行后续的轮询逻辑
      console.log('[抖音发布] 📱 手机验证错误已上报，继续轮询监听后续错误...');
    }

    // 开发环境弹窗显示平台提示信息
    if (window.browserAPI && window.browserAPI.isProduction === false) {
      alert(`抖音发布结果：\n\n${clickResult.message}`);
    }

    // 点击成功后，不再判断 toast 消息（因为各平台提示词不统一，无法准确判断）
    // 直接认为发布已提交，等待页面跳转到成功页
    // 成功统计由 publish-success.js 在成功页发送
    console.log('[抖音发布] ✅ 发布已提交，消息:', clickResult.message);

    // 🔑 捕获登录过期：不上报失败、不关窗，停窗等待用户手动登录后自动续发
    if (isDouyinLoginExpiredMessage(clickResult.message)) {
      console.warn('[抖音发布] 🔐 检测到登录过期消息，暂停发布流程等待用户手动登录:', clickResult.message);
      publishRunning = false;
      startDouyinPublishLoginWatch();
      return;
    }

    if (isDouyinNetworkErrorMessage(clickResult.message)) {
      console.error('[抖音发布] 🚨 检测到网络错误消息:', clickResult.message);
      const reported = await sendStatisticsError(publishId, '检测到网络错误提示：' + clickResult.message, '抖音发布');
      publishRunning = false;
      if (reported) {
        await closeWindowWithMessage('网络错误，请检查网络连接', 2000);
        return;
      }
    }

    // 标记已完成
    hasProcessed = true;

    if (isDouyinPublishSuccessMessage(clickResult.message)) {
      console.log('[抖音发布] ✅ 捕获到成功提示，直接上报成功统计:', clickResult.message);
      const reported = await reportDouyinPublishSuccess(publishId, windowId, 'click-success-message');
      publishRunning = false;
      if (reported) {
        await closeWindowWithMessage('发布成功，刷新数据', 1000);
        return;
      }
    }

    // 等待页面跳转到成功页，超时 30 秒
    console.log('[抖音发布] ⏳ 等待跳转到成功页（90秒超时）...');
    const currentUrl = window.location.href;
    const startTime = Date.now();
    const timeout = 90000; // 90秒：对齐全平台，网慢兜底（配合点击乐观上报，避免误报超时失败）
    // 🔑 只保留真实平台提示，避免把“点击完成/点击成功”这类中性状态当失败原因上报
    let lastToastMessage = !isDouyinPublishSuccessMessage(clickResult.message)
      && !isDouyinNeutralPublishMessage(clickResult.message)
      ? (clickResult.message || '')
      : '';

    while (Date.now() - startTime < timeout) {
      await delay(2000); // 每 2 秒检查一次

      const phoneVerifyMessage = getDouyinPhoneVerifyMessage();
      if (phoneVerifyMessage) {
        console.log('[抖音发布] 📱 轮询检测到手机号认证弹窗:', phoneVerifyMessage);
        const shouldExit = await reportDouyinPhoneVerifyFailure('polling', phoneVerifyMessage);
        // 🔑 如果返回 true，说明需要退出（旧逻辑兼容）；如果返回 false，继续轮询
        if (shouldExit) {
          return;
        }
        // 如果返回 false（手机验证已上报），继续轮询监听后续错误
        console.log('[抖音发布] 📱 继续轮询，监听用户手动发布后的错误...');
      }

      // 检查 URL 是否变化
      if (window.location.href !== currentUrl) {
        console.log('[抖音发布] ✅ 检测到页面跳转，发布成功');
        return; // 页面已跳转，由 publish-success.js 处理
      }

      // 检查 PUBLISH_SUCCESS_DATA 是否已被 publish-success.js 删除（检查窗口专属 key 和通用 key）
      const windowKey = windowId ? `PUBLISH_SUCCESS_DATA_${windowId}` : null;
      const hasWindowData = windowKey ? localStorage.getItem(windowKey) : false;
      const hasGenericData = localStorage.getItem('PUBLISH_SUCCESS_DATA');
      if (!hasWindowData && !hasGenericData) {
        console.log('[抖音发布] ✅ 数据已被成功页处理，跳过后续检测');
        return;
      }

      // 检测是否出现 toast 提示，记录消息内容
      // 🔑 过滤掉成功消息，避免将成功消息作为错误信息上报
      try {
        const toastEl = document.querySelector('.semi-toast-content-text');
        if (toastEl) {
          const text = (toastEl.textContent || '').trim();
          const isSuccess = isDouyinPublishSuccessMessage(text);
          if (text && !isSuccess && !isDouyinNeutralPublishMessage(text)) {
            lastToastMessage = text;
            console.log('[抖音发布] 📨 检测到提示:', text);
          } else if (text && isDouyinNeutralPublishMessage(text)) {
            console.log('[抖音发布] 📨 检测到中性提示，暂不作为失败原因:', text);
          } else if (isSuccess) {
            console.log('[抖音发布] ✅ 检测到成功提示，直接上报:', text);
            const reported = await reportDouyinPublishSuccess(publishId, windowId, 'poll-success-toast');
            publishRunning = false;
            if (reported) {
              await closeWindowWithMessage('发布成功，刷新数据', 1000);
              return;
            }
          }
        }
      } catch (e) {
        // 忽略检测错误
      }
    }

    // 超时未跳转 - 再次检查是否已被 publish-success.js 处理（检查窗口专属 key 和通用 key）
    const finalWindowKey = windowId ? `PUBLISH_SUCCESS_DATA_${windowId}` : null;
    const finalHasWindowData = finalWindowKey ? localStorage.getItem(finalWindowKey) : false;
    const finalHasGenericData = localStorage.getItem('PUBLISH_SUCCESS_DATA');
    if (!finalHasWindowData && !finalHasGenericData) {
      console.log('[抖音发布] ✅ 超时但数据已被成功页处理，跳过错误统计');
      return;
    }

    // 🔑 超时无明确失败提示 → 视为发布成功（范式对齐小红书：点击已提交、平台未跳转但也无任何失败提示）
    //    抖音轮询中只把「真实平台失败提示」记入 lastToastMessage（成功/中性提示已被过滤排除），
    //    故 lastToastMessage 为空 = 全程未捕获明确失败 → 判成功，避免把「发成功了只是没跳转」误报为失败。
    if (!lastToastMessage) {
      console.log('[抖音发布] ✅ 超时未捕获任何失败提示，点击发布已提交，视为发布成功');
      await reportDouyinPublishSuccess(publishId, windowId, 'timeout-no-failure');
      publishRunning = false;
      await closeWindowWithMessage('发布成功，刷新数据', 1000);
      return;
    }

    // 真正的超时失败
    const timeoutFailureMessage = getDouyinTimeoutFailureMessage(lastToastMessage, clickResult.message);
    console.log('[抖音发布] ❌ 等待超时（90秒），判定发布失败:', {
      timeoutFailureMessage,
      lastToastMessage,
      clickMessage: clickResult.message || '',
      clickMode: clickResult.clickMode || '',
      startUrl: currentUrl,
      currentUrl: window.location.href,
      hasWindowSuccessData: !!finalHasWindowData,
      hasGenericSuccessData: !!finalHasGenericData,
    });
    // 清除数据（窗口专属 key 和通用 key）
    await clearDouyinPublishSuccessData(windowId);
    await sendStatisticsError(publishId, timeoutFailureMessage, '抖音发布', new Error(timeoutFailureMessage));
    publishRunning = false;
    await closeWindowWithMessage('发布失败，刷新数据', 1000);

  } catch (error) {
    console.log("🚀 ~ publishApi ~ error: ", error);
    // 清除提前保存的数据（窗口专属 key 和通用 key）
    await clearDouyinPublishSuccessData(windowId);

    // 🔴 识别按钮 disabled 错误，补充诊断信息
    let errorDetail = error.message || '发布过程出错';
    if (errorDetail.includes('发布按钮') && errorDetail.includes('不可用')) {
      console.log('[抖音发布] 🔍 检测到按钮 disabled 错误，尝试诊断...');
      try {
        const publishBtn = document.querySelector(".button-dhlUZE");

        // 🔴 收集表单诊断信息
        const formDiagnostics = typeof window.collectFormDiagnostics === 'function' ?
          window.collectFormDiagnostics({
            platform: 'douyin',
            selectors: {
              title: '.editor-kit-root-container .semi-input',
              content: '.zone-container',
              video: '[class*="upload-progress-style"]',
            },
            required: {
              title: true,
              content: false,
              video: true,
            }
          }) : null;

        // 🔴 诊断按钮 disabled 原因
        const buttonDiagnosis = typeof window.diagnoseButtonDisabled === 'function' ?
          window.diagnoseButtonDisabled(publishBtn, formDiagnostics, []) : null;

        console.log('[抖音发布] 📋 表单诊断结果:', formDiagnostics);
        console.log('[抖音发布] 📋 按钮诊断结果:', buttonDiagnosis);

        // 🔴 使用诊断生成的人类可读原因（如果有）
        if (buttonDiagnosis && buttonDiagnosis.recommendation) {
          errorDetail = buttonDiagnosis.recommendation;
        }
      } catch (diagError) {
        console.warn('[抖音发布] ⚠️ 诊断异常，使用原始错误:', diagError.message);
      }
    }

    // 发送失败统计
    await sendStatisticsError(publishId, errorDetail, '抖音发布');
    publishRunning = false;
    // 即使出错也尝试关闭窗口
    await closeWindowWithMessage('发布失败，刷新数据', 1000);
  }
}

// 填写表单数据
async function fillFormData(dataObj) {
  // 防止并发执行
  if (fillFormRunning) {
      console.log("🚀 ~ fillFormData ~ fillFormRunning: ", fillFormRunning);
    // alert('fillFormData already running, skip');
    return;
  }

  fillFormRunning = true;

  // 🔴 将所有核心填表逻辑包装在一个函数中，便于外层兜底重试
  const executeAllFormSteps = async () => {
    const titleAndIntro = dataObj.video.video.sendlog;
    // alert(JSON.stringify(titleAndIntro));
    await retryOperation(async () => {
      // 填写标题
      const titleInput = await waitForElement('.editor-kit-root-container .semi-input', 10000); // 🔑 增加到 10 秒

      // 先触发focus事件
      if (typeof titleInput.focus === 'function') {
        titleInput.focus();
      } else {
        titleInput.dispatchEvent(new Event('focus', {bubbles: true}));
      }

      // 延迟执行，让React状态稳定
      await window.delay(300);

      // 使用setNativeValue设置值
      const targetTitle = titleAndIntro.title || '';
      setNativeValue(titleInput, targetTitle);

      // 额外触发input事件
      titleInput.dispatchEvent(new Event('input', {bubbles: true}));

      // 等待 React 更新
      await window.delay(200);

      // 🔑 验证是否成功设置（清除前后空格后比较）
      const currentValue = (titleInput.value || '').trim();
      const expectedValue = targetTitle.trim();
      if (currentValue !== expectedValue) {
        throw new Error(`标题设置失败: 期望"${expectedValue}", 实际"${currentValue}"`);
      }

      console.log('[抖音发布] ✅ 标题设置成功:', currentValue);
    }, 5, 1000)
    // alert(`Filling title: ${titleAndIntro.title || ''}`);
    // 设置发布时间
    const publishTime = dataObj.video.formData.send_set;
    if (+publishTime === 2) {
      await retryOperation(async () => {
        try {
          // 定时发布
          const publishSection = await waitForElement('.container-EMGgQp:nth-of-type(3) .content-obt4oA.new-layout-sLYOT6:nth-of-type(4)', 3000);

          const immediatePublish = publishSection.querySelector('input[type="checkbox"][value="0"]');
          const scheduledPublish = publishSection.querySelector('input[type="checkbox"][value="1"]');

          if (immediatePublish && scheduledPublish) {
            setNativeValue(immediatePublish, false);
            setNativeValue(scheduledPublish, true);

            // 设置日期时间
            await window.delay(500);
            const dateInput = await waitForElement('.date-picker-ioPchj input', 3000);

            // 多次设置确保生效
            for (let i = 0; i < 2; i++) {
              if (setNativeValue(dateInput, dataObj.video.dyPlatform.send_time)) {
                break;
              }
              await window.delay(300);
            }
          }
        } catch (error) {
          // alert('⚠️ Schedule time setting failed: ' + error.message);
        }
      }, 5, 1000)
    }

    // 填写简介
    try {
      // 首先检查是否已经填写过（通过全局标记）
      if (introFilled) {
        // alert('Intro already filled, introFilled=' + introFilled);
        // 直接跳过，不再查找元素或进行任何操作
      } else {
        await retryOperation(async () => {
          // alert('Intro not filled yet, starting to fill, introFilled=' + introFilled);
          const introInput = await waitForElement('.editor-kit-root-container .editor-kit-container.editor', 10000); // 🔑 增加到 10 秒
          const targetIntro = titleAndIntro.intro || '';

          // Debug: Show original intro
          // alert('Original intro length: ' + targetIntro.length + '\nJSON: ' + JSON.stringify(targetIntro));

          // 超强清理换行符逻辑:使用split/filter彻底清除空行
          // 1. 将所有HTML标签和换行符统一转为换行符
          // 2. 分割成行数组
          // 3. 过滤掉所有空行
          // 4. 重新组装
          let cleanedText = targetIntro
              .replace(/<br\s*\/?>/gi, '\n')              // 将<br>转为换行符
              .replace(/<\/?(p|div|span)[^>]*>/gi, '\n')  // 将块级元素转为换行符
              .replace(/<[^>]+>/g, '')                    // 移除所有其他HTML标签
              .replace(/&nbsp;/g, ' ')                    // 将&nbsp;转为空格
              .split('\n')                                // 按换行符分割成数组
              .map(line => line.trim())                   // 每行去除首尾空格
              .filter(line => line.length > 0)            // 过滤掉空行
              .join('\n')                                 // 用单个换行符重新连接
              .trim();

          // Debug: Show cleaned text
          // alert('Cleaned text length: ' + cleanedText.length + '\nJSON: ' + JSON.stringify(cleanedText));

          // 对当前页面内容进行同样的清理,确保比较标准一致
          const currentRawContent = (introInput.textContent || introInput.innerText || '');
          const currentContent = currentRawContent
              .split('\n')
              .map(line => line.trim())
              .filter(line => line.length > 0)
              .join('\n')
              .trim();

          let targetContent = cleanedText;

          // Debug: Show current vs target
          // alert('Current content: ' + JSON.stringify(currentContent) + '\nTarget: ' + JSON.stringify(targetContent) + '\nEqual: ' + (currentContent === targetContent));

          // 只有在标记未设置且内容不同时才填写
          if (currentContent !== targetContent) {
            // 立即标记为已填写（在任何操作之前，防止并发）
            introFilled = true;

            // 清空现有内容，避免累积
            introInput.innerHTML = '';

            // 额外清理：移除可能存在的占位符或空节点
            while (introInput.firstChild) {
              introInput.removeChild(introInput.firstChild);
            }

            // 检测内容是否有#并且其后跟有文字
            const topicList = extractAfterHash(targetContent, {all: true, includeHash: true});
            console.log("🚀 ~ fillFormData ~ topicList: ", topicList);
            if (topicList.length > 0) {
              //  删除掉所有话题
              cleanedText = removeHashTags(targetContent);
            }

            // 先触发focus事件
            if (typeof introInput.focus === 'function') {
              introInput.focus();
            } else {
              introInput.dispatchEvent(new Event('focus', {bubbles: true}));
            }

            // 延迟执行，让React状态稳定
            await window.delay(300);

            // 使用简单的方式填充内容
            const lines = cleanedText.split('\n').filter(line => line.trim());
            const fragment = document.createDocumentFragment();

            lines.forEach((line, index) => {
              const textNode = document.createTextNode(line);
              fragment.appendChild(textNode);
              // 不是最后一行才加<br>
              if (index < lines.length - 1) {
                const br = document.createElement('br');
                fragment.appendChild(br);
              }
            });

            introInput.innerHTML = '';
            introInput.appendChild(fragment);

            // 只触发一次input事件
            introInput.dispatchEvent(new Event('input', {bubbles: true}));

            // 延迟后检查编辑器是否自动添加了额外内容
            await window.delay(100);
            // alert('After input event:\nHTML: ' + JSON.stringify(introInput.innerHTML) + '\nText: ' + JSON.stringify(introInput.textContent));

            // 清理所有空的 ace-line 元素（编辑器可能在开头自动添加）
            const aceLines = introInput.querySelectorAll('.ace-line');
            // alert('Found ace-line elements: ' + aceLines.length);

            let removedCount = 0;
            aceLines.forEach((line, idx) => {
              const text = (line.textContent || '').trim();
              // 移除所有空白字符和零宽字符（\u200B-\u200D, \uFEFF）
              const cleanText = text.replace(/[\s\u200B-\u200D\uFEFF]/g, '');
              // alert('ace-line[' + idx + '] text: "' + text + '" clean: "' + cleanText + '" length: ' + cleanText.length);
              if (!cleanText || cleanText.length === 0) {
                line.remove();
                removedCount++;
              }
            });

            // 单独处理话题（添加防重复标记）
            // 🔑 使用窗口专属标记，避免多窗口并发时冲突
            const topicWindowId = await window.browserAPI.getWindowId();
            const topicFilledKey = `__TOPIC_FILLED_${topicWindowId || 'default'}__`;
            if (topicList.length > 0 && !window[topicFilledKey]) {
              window[topicFilledKey] = true; // 标记话题已处理

              const introInput = await waitForElement('.editor-kit-root-container .editor-kit-container.editor', 10000); // 🔑 增加到 10 秒
              for (let topicListElement of topicList) {
                console.log('🏷️ 开始处理话题:', topicListElement);

                // 聚焦编辑器
                introInput.focus();

                // 将光标移到末尾
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(introInput);
                range.collapse(false); // false = 折叠到末尾
                selection.removeAllRanges();
                selection.addRange(range);

                // 使用 execCommand 模拟真实输入（这会触发编辑器的话题检测）
                document.execCommand('insertText', false, topicListElement);

                // 触发 input 事件确保编辑器识别变化
                introInput.dispatchEvent(new InputEvent('input', {
                  inputType: 'insertText',
                  data: topicListElement,
                  bubbles: true,
                }));

                // 等待话题建议列表出现（使用 waitForElement）
                try {
                  const mentionSuggest = await waitForElement('.mention-suggest-mount-dom', 3000);
                  console.log('🏷️ 话题建议列表已出现');

                  if (mentionSuggest) {
                    // 轮询等待话题选项出现（因为选项是异步接口返回的）
                    let firstOption = null;
                    const maxRetries = 30; // 最多等待3秒（30 * 100ms）
                    let retryCount = 0;

                    while (!firstOption && retryCount < maxRetries) {
                      // 根据截图的实际 DOM 结构，使用精确的选择器
                      const selectors = [
                        // 方式1: 直接找第一个 mention-suggest-item-container
                        '[class*="mention-suggest-item-container"]:first-of-type',
                        // 方式2: 通过层级关系找
                        '.mention-suggest-mount-dom > div > [class*="mention-suggest-item-container"]:first-child',
                        // 方式3: 找任意一个 item-container
                        '[class*="mention-suggest-item-container"]',
                        // 方式4: 更深层的结构
                        '.mention-suggest-mount-dom [class*="mention-suggest-item-container"] > div:first-child'
                      ];

                      for (const selector of selectors) {
                        const options = mentionSuggest.querySelectorAll('[class*="mention-suggest-item-container-"] [class*="tag-"]');
                        if (options.length > 0) {
                          firstOption = options[0];
                          console.log('🏷️ 找到话题选项，选择器:', selector, '共', options.length, '个选项');
                          console.log('🏷️ 选项文本:', firstOption.textContent?.trim().substring(0, 50));
                          break;
                        }
                      }

                      // 如果还没找到，每10次重试打印 DOM 结构
                      if (!firstOption) {
                        if (retryCount % 10 === 0) {
                          console.log('🏷️ 重试', retryCount, '次，当前DOM:', mentionSuggest.innerHTML.substring(0, 500));
                        }
                        await window.delay(100);
                        retryCount++;
                      }
                    }

                    if (firstOption) {
                      // 确保元素可见
                      firstOption.scrollIntoView({ block: 'nearest' });
                      await window.delay(100);

                      // 尝试多种点击方式
                      console.log('🏷️ 准备点击话题选项');

                      // 方式1: 模拟完整的鼠标事件
                      const rect = firstOption.getBoundingClientRect();
                      const clickX = rect.left + rect.width / 2;
                      const clickY = rect.top + rect.height / 2;

                      firstOption.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: clickX, clientY: clickY }));
                      await window.delay(50);

                      firstOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: clickX, clientY: clickY }));
                      await window.delay(50);

                      firstOption.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: clickX, clientY: clickY }));
                      await window.delay(50);

                      firstOption.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: clickX, clientY: clickY }));

                      // 方式2: 原生点击（作为兜底）
                      await window.delay(50);
                      firstOption.click();

                      console.log('🏷️ 已点击话题选项');
                      await window.delay(500);
                    } else {
                      console.log('🏷️ 未找到话题选项（已重试', retryCount, '次）');
                      console.log('🏷️ 完整DOM:', mentionSuggest.innerHTML);
                    }
                  }
                } catch (e) {
                  console.log('🏷️ 话题建议列表未出现:', e.message);
                }
              }
            }

            // 延迟后触发blur事件
            await window.delay(200);
            if (typeof introInput.blur === 'function') {
              introInput.blur();
            } else {
              introInput.dispatchEvent(new Event('blur', {bubbles: true}));
            }

            // 最后再检查一次
            await window.delay(100);
            // alert('After blur event:\nHTML: ' + JSON.stringify(introInput.innerHTML) + '\nText: ' + JSON.stringify(introInput.textContent));

            // alert('✅ Intro filled successfully');
          } else {
            // 内容已经正确，也标记为已填写
            introFilled = true;
            // alert('✅ Intro content already correct, marking as filled');
          }
        }, 5, 1000)
      }
    } catch (error) {
      // alert('⚠️ Intro handling failed: ' + error.message);
    }

    // 设置封面
    try {
      console.log('[封面设置] 开始设置封面...');

      await retryOperation(async () => {
        // 尝试多种选择器策略
        let coverInput = null;
        const selectors = [
          '.recommendCover-vWWsHB:nth-child(1)',
          '.recommendCover-vWWsHB:first-child',
          '.recommendCover-vWWsHB'
        ];

        for (const selector of selectors) {
          try {
            coverInput = await waitForElement(selector, 10000); // 🔑 增加到 10 秒
            if (coverInput) {
              console.log(`[封面设置] ✅ 找到封面元素: ${selector}`);
              break;
            }
          } catch (e) {
            console.log(`[封面设置] ⚠️ 未找到: ${selector}`);
          }
        }

        if (!coverInput) {
          throw new Error('未找到任何封面元素');
        }

        console.log("🚀 ~ fillFormData ~ coverInput: ", coverInput);

        // 模拟完整的鼠标点击事件序列（更接近真实用户行为）
        const rect = coverInput.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        const mouseEventOptions = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y,
          screenX: x,
          screenY: y,
          button: 0
        };

        // 完整的鼠标事件序列
        coverInput.dispatchEvent(new MouseEvent('mouseover', mouseEventOptions));
        await window.delay(50);

        coverInput.dispatchEvent(new MouseEvent('mousedown', mouseEventOptions));
        await window.delay(50);

        coverInput.dispatchEvent(new MouseEvent('mouseup', mouseEventOptions));
        await window.delay(50);

        coverInput.dispatchEvent(new MouseEvent('click', mouseEventOptions));

        console.log('[封面设置] ✅ 已触发完整点击事件序列');

        await window.delay(1000);

        // 尝试查找并确认弹窗（如果没有弹窗也没关系）
        try {
          const confirmDialog = await waitForElement('.semi-modal-content.semi-modal-content-animate-show', 3000);
          const confirmBtn = await waitForElement('.semi-button.semi-button-primary', 3000, 200, confirmDialog);
          confirmBtn.dispatchEvent(new Event('click', { bubbles: true }));
          console.log('[封面设置] ✅ 已确认弹窗');
        } catch (dialogError) {
          console.log('[封面设置] ⚠️ 未找到确认弹窗，可能封面已自动设置:', dialogError.message);
        }
      }, 5, 1000);
    } catch (error) {
      console.log('[封面设置] ⚠️ 封面设置失败:', error.message);
    }

    // 等待表单填写完成
    await window.delay(5000);

    // 直接调用发布（封面检测移到 publishApi 中，在视频上传完成后进行）
    await publishApi(dataObj);
  };
  // ===== 原有逻辑结束 =====

  // 🔴 最外层兜底重试：即使单步骤重试都失败，外层还会重试整个流程2次
  try {
    await retryOperation(executeAllFormSteps, 2, 3000);
    console.log('[抖音发布] ✅ 所有表单填写完成');
  } catch (finalError) {
    console.error('[抖音发布] ❌ 填表流程失败（外层重试2次后）:', finalError);
    stopErrorListener?.();
    const publishId = dataObj?.video?.dyPlatform?.id;
    if (publishId) {
      await sendStatisticsError(publishId, finalError.message || '填写表单失败', '抖音发布');
    }
    await closeWindowWithMessage('填写表单失败，刷新数据', 1000);
  } finally {
    // 无论成功还是失败，都重置标记
    fillFormRunning = false;
  }
}
