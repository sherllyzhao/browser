var introFilled = false; // 标记 intro 是否已填写
var fillFormRunning = false; // 标记 fillFormData 是否正在执行
var publishRunning = false; // 标记发布是否正在执行，防止重复点击
var aiFallbackRunning = false; // 标记 AI 主链路是否正在执行，防止重复触发
var FORCE_SIMULATE_DOUYIN_FAIL = true; // 抖音已切到纯 AI 主链路：默认直接交给 AI 发布

// 防重复标志：确保数据只处理一次
var isProcessing = false;
var hasProcessed = false;

/**
 * 抖音创作者平台发布脚本
 * 用于处理发布流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
  'use strict';

  // ===========================
  // 防止脚本重复注入
  // ===========================
  if (window.__DOUYIN_PUBLISH_SCRIPT_LOADED__) {
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

  window.__DOUYIN_PUBLISH_SCRIPT_LOADED__ = true;

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
  }, 100); // 延迟 100ms 检查

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

          await processPublishData(messageData, 'message');
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

        await processPublishData(publishData, 'cookieRestore', { windowId });
      }
    } catch (error) {
      console.error('[抖音发布] ❌ 从全局存储读取数据失败:', error);
    }
  })();
})();

async function processPublishData(dataObj, source = 'unknown', extraMeta = {}) {
  // 标记为正在处理
  isProcessing = true;
  console.log('[抖音发布] 🔄 已标记为正在处理, source=', source);

  try {
    window.__AUTH_DATA__ = {
      ...window.__AUTH_DATA__,
      message: dataObj,
      source,
      ...extraMeta,
      receivedAt: Date.now()
    };
    console.log('[抖音发布] ✅ 发布数据已更新:', window.__AUTH_DATA__);

    const shouldSimulateFailure = await shouldSimulatePrimaryFlowFailure();
    if (shouldSimulateFailure) {
      console.warn('[抖音发布] 🤖 当前为纯 AI 发布模式：跳过抖音专用上传/填表');
      updateAiFallbackBanner('当前模式：纯 AI 发布\n行为：上传/标题/简介/封面/发布均由 AI 接管');

      const aiResult = await runAiFallback(
        dataObj,
        '抖音已切换为纯 AI 发布模式'
      );

      if (!aiResult || !aiResult.success) {
        const publishId = dataObj?.video?.dyPlatform?.id;
        if (publishId) {
          await sendStatisticsError(
            publishId,
            `纯 AI 发布失败: ${aiResult?.error || 'unknown error'}`,
            '抖音发布'
          );
        }
        await closeWindowWithMessage('AI 接管失败，刷新数据', 1000);
      }
      return;
    }
  } finally {
    isProcessing = false;
    console.log('[抖音发布] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
  }
}

// ===========================
// 7. 发布视频到抖音
// ===========================
async function publishApi(dataObj) {
  console.log("🚀 ~ publishApi ~ dataObj: ", dataObj);

  // 防止重复执行
  if (publishRunning) {
    console.log('Publish is already running, skipping duplicate call');
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
        checkElement = await waitForElement('.cover-check [class*="title-"]', 5000);
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
            coverInput = await waitForElement(selector, 3000);
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

    const clickResult = await clickWithRetry(publishBtn, 3, 500, true); // 启用消息捕获

    if (!clickResult.success) {
      console.error('[抖音发布] ❌ 所有点击尝试均失败:', clickResult.message);
      // 清除提前保存的数据（使用窗口专属 key 和通用 key，确保兼容性）
      if (windowId) {
        localStorage.removeItem(`PUBLISH_SUCCESS_DATA_${windowId}`);
      }
      localStorage.removeItem('PUBLISH_SUCCESS_DATA');
      // 发送失败统计
      await sendStatisticsError(publishId, clickResult.message || '点击发布按钮失败', '抖音发布');
      publishRunning = false;
      throw new Error('发布按钮点击失败: ' + clickResult.message);
    }

    console.log('[抖音发布] ✅ 发布按钮已点击');
    console.log('[抖音发布] 📨 平台提示:', clickResult.message);

    // 开发环境弹窗显示平台提示信息
    if (window.browserAPI && window.browserAPI.isProduction === false) {
      alert(`抖音发布结果：\n\n${clickResult.message}`);
    }

    // 等待页面稳定
    await delay(2000);

    // 点击成功后，不再判断 toast 消息（因为各平台提示词不统一，无法准确判断）
    // 直接认为发布已提交，等待页面跳转到成功页
    // 成功统计由 publish-success.js 在成功页发送
    console.log('[抖音发布] ✅ 发布已提交，消息:', clickResult.message);

    // 标记已完成
    hasProcessed = true;
    publishRunning = false;

    // 等待页面跳转到成功页，超时 30 秒
    console.log('[抖音发布] ⏳ 等待跳转到成功页（30秒超时）...');
    const currentUrl = window.location.href;
    const startTime = Date.now();
    const timeout = 30000; // 30秒
    // 🔑 用 clickResult.message 作为初始值，避免超时时丢失已捕获的提示
    let lastToastMessage = clickResult.message || '';

    while (Date.now() - startTime < timeout) {
      await delay(2000); // 每 2 秒检查一次

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
      const successKeywords = ['成功', '发布成功', '提交成功', '上传成功'];
      try {
        const toastEl = document.querySelector('.semi-toast-content-text');
        if (toastEl) {
          const text = (toastEl.textContent || '').trim();
          const isSuccess = successKeywords.some(keyword => text.includes(keyword));
          if (text && !isSuccess) {
            lastToastMessage = text;
            console.log('[抖音发布] 📨 检测到提示:', text);
          } else if (isSuccess) {
            console.log('[抖音发布] ✅ 检测到成功提示，忽略:', text);
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

    // 真正的超时失败
    console.log('[抖音发布] ❌ 等待超时（30秒），判定发布失败');
    // 清除数据（窗口专属 key 和通用 key）
    if (windowId) {
      localStorage.removeItem(`PUBLISH_SUCCESS_DATA_${windowId}`);
    }
    localStorage.removeItem('PUBLISH_SUCCESS_DATA');
    await sendStatisticsError(publishId, lastToastMessage || '发布超时，未跳转到成功页', '抖音发布');
    await closeWindowWithMessage('发布失败，刷新数据', 1000);

  } catch (error) {
    console.log("🚀 ~ publishApi ~ error: ", error);
    // 清除提前保存的数据（窗口专属 key 和通用 key）
    if (windowId) {
      localStorage.removeItem(`PUBLISH_SUCCESS_DATA_${windowId}`);
    }
    localStorage.removeItem('PUBLISH_SUCCESS_DATA');
    // 发送失败统计
    await sendStatisticsError(publishId, error.message || '发布过程出错', '抖音发布');
    publishRunning = false;
    // 即使出错也尝试关闭窗口
    await closeWindowWithMessage('发布失败，刷新数据', 1000);
  }
}

async function runAiFallback(dataObj, reason = '') {
  if (aiFallbackRunning) {
    console.warn('[抖音发布] ⚠️ AI 兜底已在执行中，跳过重复触发');
    return { success: false, error: 'AI 兜底已在执行中' };
  }

  if (!window.__AI_AGENT__ || typeof window.__AI_AGENT__.publish !== 'function') {
    console.warn('[抖音发布] ⚠️ AI 兜底不可用，未注入 __AI_AGENT__');
    return { success: false, error: 'AI 兜底不可用' };
  }

  aiFallbackRunning = true;
  console.log('[抖音发布] 🤖 启动 AI 兜底流程，原因:', reason || '主链路失败');
  updateAiFallbackBanner(`当前模式：AI 兜底接管中\n原因：${reason || '主链路失败'}`);

  try {
    const aiResult = await window.__AI_AGENT__.publish(dataObj, {
      autoPublish: true,
      autoDetectResult: true,
    });
    console.log('[抖音发布] 🤖 AI 兜底结果:', aiResult);
    if (aiResult?.success) {
      updateAiFallbackBanner('当前模式：AI 兜底执行完成\n结果：已提交发布流程');
    } else {
      updateAiFallbackBanner(`当前模式：AI 兜底执行失败\n原因：${aiResult?.error || '未知错误'}`);
    }
    return aiResult;
  } catch (error) {
    console.error('[抖音发布] ❌ AI 兜底执行失败:', error);
    updateAiFallbackBanner(`当前模式：AI 兜底执行失败\n原因：${error.message || '未知错误'}`);
    return { success: false, error: error.message };
  } finally {
    aiFallbackRunning = false;
  }
}

async function shouldSimulatePrimaryFlowFailure() {
  try {
    if (FORCE_SIMULATE_DOUYIN_FAIL) {
      return true;
    }

    let flag = null;

    if (window.browserAPI && typeof window.browserAPI.getGlobalData === 'function') {
      try {
        flag = await window.browserAPI.getGlobalData('SIMULATE_DOUYIN_FAIL');
      } catch (globalError) {
        console.warn('[抖音发布] ⚠️ 读取全局 SIMULATE_DOUYIN_FAIL 失败:', globalError);
      }
    }

    if (flag == null) {
      flag = localStorage.getItem('SIMULATE_DOUYIN_FAIL');
    }

    const normalized = String(flag || '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  } catch (error) {
    console.warn('[抖音发布] ⚠️ 读取 SIMULATE_DOUYIN_FAIL 失败:', error);
    return false;
  }
}

function updateAiFallbackBanner(message) {
  try {
    const id = '__douyin_ai_fallback_banner__';
    let banner = document.getElementById(id);

    if (!banner) {
      banner = document.createElement('div');
      banner.id = id;
      banner.style.cssText = [
        'position:fixed',
        'top:16px',
        'right:16px',
        'z-index:2147483647',
        'max-width:360px',
        'padding:10px 14px',
        'border-radius:10px',
        'background:rgba(17,24,39,0.92)',
        'color:#fff',
        'font-size:13px',
        'line-height:1.5',
        'box-shadow:0 8px 24px rgba(0,0,0,0.28)',
        'pointer-events:none',
        'white-space:pre-wrap',
      ].join(';');
      document.documentElement.appendChild(banner);
    }

    banner.textContent = message;
  } catch (error) {
    console.warn('[抖音发布] ⚠️ 更新 AI 接管横幅失败:', error);
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

  try {
    const shouldSimulateFailure = await shouldSimulatePrimaryFlowFailure();

    if (shouldSimulateFailure) {
      updateAiFallbackBanner('当前模式：已开启主链路失效模拟\n下一步将切换到 AI 兜底');
    }

    if (shouldSimulateFailure) {
      throw new Error('模拟主链路失效: SIMULATE_DOUYIN_FAIL 已开启');
    }

    const titleAndIntro = dataObj.video.video.sendlog;
    // alert(JSON.stringify(titleAndIntro));
    await retryOperation(async () => {
      // 填写标题
      const titleInput = await waitForElement('.editor-kit-root-container .semi-input', 5000);

      // 先触发focus事件
      if (typeof titleInput.focus === 'function') {
        titleInput.focus();
      } else {
        titleInput.dispatchEvent(new Event('focus', {bubbles: true}));
      }

      // 延迟执行，让React状态稳定
      await new Promise(resolve => setTimeout(resolve, 300));

      // 使用setNativeValue设置值
      const targetTitle = titleAndIntro.title || '';
      setNativeValue(titleInput, targetTitle);

      // 额外触发input事件
      titleInput.dispatchEvent(new Event('input', {bubbles: true}));

      // 等待 React 更新
      await new Promise(resolve => setTimeout(resolve, 200));

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
            await new Promise(resolve => setTimeout(resolve, 500));
            const dateInput = await waitForElement('.date-picker-ioPchj input', 3000);

            // 多次设置确保生效
            for (let i = 0; i < 2; i++) {
              if (setNativeValue(dateInput, dataObj.video.dyPlatform.send_time)) {
                break;
              }
              await new Promise(resolve => setTimeout(resolve, 300));
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
          const introInput = await waitForElement('.editor-kit-root-container .editor-kit-container.editor', 5000);
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
            await new Promise(resolve => setTimeout(resolve, 300));

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
            await new Promise(resolve => setTimeout(resolve, 100));
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

              const introInput = await waitForElement('.editor-kit-root-container .editor-kit-container.editor', 5000);
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
                        await new Promise(resolve => setTimeout(resolve, 100));
                        retryCount++;
                      }
                    }

                    if (firstOption) {
                      // 确保元素可见
                      firstOption.scrollIntoView({ block: 'nearest' });
                      await new Promise(resolve => setTimeout(resolve, 100));

                      // 尝试多种点击方式
                      console.log('🏷️ 准备点击话题选项');

                      // 方式1: 模拟完整的鼠标事件
                      const rect = firstOption.getBoundingClientRect();
                      const clickX = rect.left + rect.width / 2;
                      const clickY = rect.top + rect.height / 2;

                      firstOption.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: clickX, clientY: clickY }));
                      await new Promise(resolve => setTimeout(resolve, 50));

                      firstOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: clickX, clientY: clickY }));
                      await new Promise(resolve => setTimeout(resolve, 50));

                      firstOption.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: clickX, clientY: clickY }));
                      await new Promise(resolve => setTimeout(resolve, 50));

                      firstOption.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: clickX, clientY: clickY }));

                      // 方式2: 原生点击（作为兜底）
                      await new Promise(resolve => setTimeout(resolve, 50));
                      firstOption.click();

                      console.log('🏷️ 已点击话题选项');
                      await new Promise(resolve => setTimeout(resolve, 500));
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
            await new Promise(resolve => setTimeout(resolve, 200));
            if (typeof introInput.blur === 'function') {
              introInput.blur();
            } else {
              introInput.dispatchEvent(new Event('blur', {bubbles: true}));
            }

            // 最后再检查一次
            await new Promise(resolve => setTimeout(resolve, 100));
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
            coverInput = await waitForElement(selector, 3000);
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
        await new Promise(resolve => setTimeout(resolve, 50));

        coverInput.dispatchEvent(new MouseEvent('mousedown', mouseEventOptions));
        await new Promise(resolve => setTimeout(resolve, 50));

        coverInput.dispatchEvent(new MouseEvent('mouseup', mouseEventOptions));
        await new Promise(resolve => setTimeout(resolve, 50));

        coverInput.dispatchEvent(new MouseEvent('click', mouseEventOptions));

        console.log('[封面设置] ✅ 已触发完整点击事件序列');

        await new Promise(resolve => setTimeout(resolve, 1000));

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
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 直接调用发布（封面检测移到 publishApi 中，在视频上传完成后进行）
    await publishApi(dataObj);

  } catch (error) {
    // 捕获填写表单过程中的任何错误（封面检测之前的错误）
    console.error('[抖音发布] fillFormData 错误:', error);
    const aiResult = await runAiFallback(dataObj, error.message || '填写表单失败');
    if (!aiResult || !aiResult.success) {
      // 发送错误上报
      const publishId = dataObj?.video?.dyPlatform?.id;
      if (publishId) {
        await sendStatisticsError(
          publishId,
          `填写表单失败，且 AI 兜底失败: ${aiResult?.error || error.message || 'unknown error'}`,
          '抖音发布'
        );
      }
      // 填写表单失败也要关闭窗口，不阻塞下一个任务
      await closeWindowWithMessage('填写表单失败，刷新数据', 1000);
    }
  } finally {
    // 无论成功还是失败，都重置标记
    fillFormRunning = false;
  }
}
