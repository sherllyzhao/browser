let introFilled = false; // 标记 intro 是否已填写
let fillFormRunning = false; // 标记 fillFormData 是否正在执行
let publishRunning = false; // 标记发布是否正在执行，防止重复点击

// 防重复标志：确保数据只处理一次
let isProcessing = false;
let hasProcessed = false;

// 抖音页面需要保留原有上传/成功回执逻辑，仅把 AI 能力当作表单填写器使用
window.__AI_PUBLISH_DISABLE_AUTO_START__ = true;

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
            console.log('[抖音发布] 🚦 准备开始视频上传');
            await uploadVideo(messageData);
            console.log('[抖音发布] ✅ 视频上传步骤结束，准备进入 AI/旧逻辑 决策');
            await fillFormWithBestStrategy(messageData);

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
        console.log('[抖音发布] 🚦 准备开始视频上传');
        await uploadVideo(publishData);
        console.log('[抖音发布] ✅ 视频上传步骤结束，准备进入 AI/旧逻辑 决策');
        await fillFormWithBestStrategy(publishData);

        console.log('[抖音发布] 📤 准备发送数据到接口...');
        console.log('[抖音发布] ✅ 发布流程已启动，等待 publishApi 完成...');

        isProcessing = false;
      }
    } catch (error) {
      console.error('[抖音发布] ❌ 从全局存储读取数据失败:', error);
    }
  })();
})();

async function fillFormWithBestStrategy(dataObj) {
  console.log('[抖音发布] 🧭 进入 AI 填表决策流程');

  let aiDecision = null;
  try {
    aiDecision = await tryFillFormWithCloudflareAI(dataObj);
  } catch (error) {
    aiDecision = {
      success: false,
      stage: 'decision',
      reason: error.message || 'AI 决策流程异常'
    };
  }

  logAiFillDecision(aiDecision);

  if (aiDecision.success) {
    if (aiDecision.publishButton) {
      console.log('[抖音发布] ✅ 已选择 Cloudflare AI 填表 + AI 点击按钮路径');
      await publishWithAiButton(dataObj, aiDecision.publishButton);
      return;
    }

    console.log('[抖音发布] ⚠️ AI 未返回 publishButton，回退到原发布按钮点击逻辑');
    await publishApi(dataObj);
    return;
  }

  console.log(`[抖音发布] ↩️ 回退到原表单填写逻辑，原因: ${aiDecision.reason}`);
  try {
    await retryOperation(async () => await fillFormData(dataObj), 3, 2000);
  } catch (e) {
    console.log('[抖音发布] ❌ 填写表单数据失败:', e);
  }
}

async function tryFillFormWithCloudflareAI(dataObj) {
  const aiConfig = await getAiConfigSafe();
  if (!aiConfig?.apiKey) {
    return {
      success: false,
      stage: 'config',
      reason: '未检测到 AI API Key 配置'
    };
  }

  if (aiConfig.provider !== 'cloudflare') {
    return {
      success: false,
      stage: 'config',
      reason: `当前 AI provider 为 ${aiConfig.provider || 'unknown'}，不是 cloudflare`
    };
  }

  if (!aiConfig.accountId) {
    return {
      success: false,
      stage: 'config',
      reason: 'Cloudflare Account ID 未配置'
    };
  }

  const aiAgent = await waitForAiAgent();
  if (!aiAgent) {
    return {
      success: false,
      stage: 'bootstrap',
      reason: 'ai-publish.js 未在超时时间内就绪'
    };
  }

  try {
    console.log(`[抖音发布] 🤖 命中 Cloudflare AI 填表路径，模型: ${aiConfig.model || '@cf/meta/llama-3.1-8b-instruct'}`);
    const analyzeResult = await aiAgent.analyze(dataObj);
    if (!analyzeResult?.success) {
      return {
        success: false,
        stage: 'publish',
        reason: analyzeResult?.error || 'AI 页面分析失败',
        rawResult: analyzeResult
      };
    }

    const aiResult = analyzeResult.result || {};
    if (!aiResult.isForm) {
      return {
        success: false,
        stage: 'publish',
        reason: `AI 未识别为表单页面: ${aiResult.reason || 'unknown'}`
      };
    }

    const safePlan = buildDouyinSafeAiPlan(aiResult.actions || [], dataObj);
    console.log(`[抖音发布] 🤖 AI 原始动作数=${(aiResult.actions || []).length}，安全放行动作数=${safePlan.safeActions.length}，忽略动作数=${safePlan.ignoredActions.length}`);

    for (const ignored of safePlan.ignoredActions) {
      console.log(`[抖音发布] ⛔ 忽略 AI 动作: ${ignored.action} | ${ignored.description || ignored.selector || 'no-desc'} | reason=${ignored.ignoreReason || 'no-reason'}`);
    }

    const executedResults = [];
    for (const action of safePlan.safeActions) {
      const execResult = await aiAgent.exec(action);
      executedResults.push({ ...action, ...execResult });
      if (!execResult?.success) {
        return {
          success: false,
          stage: 'publish',
          reason: execResult?.error || `AI 执行动作失败: ${action.description || action.action}`,
          rawResult: executedResults
        };
      }
    }

    const executedCount = executedResults.filter(action => action && action.success).length;
    return {
      success: true,
      stage: 'publish',
      reason: 'Cloudflare AI 已完成表单填写',
      executedCount,
      publishButton: safePlan.publishButton?.selector || null
    };
  } catch (error) {
    return {
      success: false,
      stage: 'publish',
      reason: error.message || 'Cloudflare AI 调用异常'
    };
  }
}

function buildDouyinSafeAiPlan(actions, dataObj) {
  const safeActions = [];
  const ignoredActions = [];
  let publishButton = null;
  const allowedActions = new Set(['fill', 'fill_rich', 'select', 'check']);
  const payload = getDouyinAiPayload(dataObj);

  for (const action of actions || []) {
    if (!action || !action.action) continue;

    if (action.action === 'publish' && !publishButton) {
      publishButton = action;
      continue;
    }

    if (allowedActions.has(action.action)) {
      const matchResult = matchDouyinActionToPayload(action, payload);
      if (matchResult.allowed) {
        safeActions.push(action);
      } else {
        ignoredActions.push({ ...action, ignoreReason: matchResult.reason });
      }
      continue;
    }

    ignoredActions.push({ ...action, ignoreReason: '抖音 AI 安全策略不允许执行该动作类型' });
  }

  return { safeActions, ignoredActions, publishButton };
}

function getDouyinAiPayload(dataObj) {
  const sendlog = dataObj?.video?.video?.sendlog || {};
  const formData = dataObj?.video?.formData || {};
  const dyPlatform = dataObj?.video?.dyPlatform || {};

  const title = String(sendlog.title || formData.title || dataObj?.element?.title || '').trim();
  const intro = String(sendlog.intro || dataObj?.video?.video?.intro || dataObj?.video?.video?.content || '').trim();
  const sendSet = Number(formData.send_set || 1);
  const sendTime = String(dyPlatform.send_time || '').trim();

  return {
    title,
    intro,
    scheduleEnabled: sendSet === 2 && !!sendTime,
    sendTime,
  };
}

function matchDouyinActionToPayload(action, payload) {
  const haystack = [
    action.description,
    action.selector,
    action.field,
    action.value,
  ].filter(Boolean).join(' ').toLowerCase();

  const actionValue = String(action.value || '').trim();
  const titleValue = String(payload.title || '').trim();
  const introValue = String(payload.intro || '').trim();
  const sendTimeValue = String(payload.sendTime || '').trim();

  if (
    /标题|title/.test(haystack) ||
    (action.action === 'fill' && titleValue && actionValue === titleValue)
  ) {
    return titleValue
      ? { allowed: true, reason: '标题参数已提供' }
      : { allowed: false, reason: '标题参数为空，跳过对应 DOM 操作' };
  }

  if (
    /简介|正文|描述|内容|intro|content|rich/.test(haystack) ||
    (action.action === 'fill_rich' && introValue && actionValue === introValue)
  ) {
    return introValue
      ? { allowed: true, reason: '正文参数已提供' }
      : { allowed: false, reason: '正文参数为空，跳过对应 DOM 操作' };
  }

  if (/定时|发布时间|时间|schedule|time/.test(haystack)) {
    return payload.scheduleEnabled
      ? { allowed: true, reason: '定时发布参数已提供' }
      : { allowed: false, reason: '未配置定时发布时间，跳过对应 DOM 操作' };
  }

  if (/标签|话题|分类|topic|tag|category/.test(haystack)) {
    return { allowed: false, reason: '当前抖音发布数据未提供对应标签/分类参数' };
  }

  if (action.action === 'fill' || action.action === 'fill_rich') {
    if (titleValue && actionValue === titleValue) {
      return { allowed: true, reason: '根据 action.value 匹配到标题参数' };
    }
    if (introValue && actionValue === introValue) {
      return { allowed: true, reason: '根据 action.value 匹配到正文参数' };
    }
  }

  if ((action.action === 'select' || action.action === 'check') && payload.scheduleEnabled && sendTimeValue) {
    return { allowed: true, reason: '保守放行定时相关选择动作' };
  }

  return { allowed: false, reason: '未匹配到对应入参，跳过该 DOM 操作' };
}

function logAiFillDecision(decision) {
  const finalDecision = decision || {
    success: false,
    stage: 'unknown',
    reason: '未拿到 AI 决策结果'
  };

  window.__DOUYIN_AI_FILL_STATUS__ = {
    ...finalDecision,
    timestamp: Date.now()
  };

  if (finalDecision.success) {
    console.log(`[抖音发布] 🧭 AI 填表决策: HIT_CLOUDFLARE_AI | stage=${finalDecision.stage} | reason=${finalDecision.reason}`);
    console.log(`[抖音发布] 🧾 AI 填表详情: executedCount=${finalDecision.executedCount || 0}, publishButton=${finalDecision.publishButton || 'none'}`);
    return;
  }

  console.log(`[抖音发布] 🧭 AI 填表决策: FALLBACK_LEGACY_FORM | stage=${finalDecision.stage} | reason=${finalDecision.reason}`);
}

async function getAiConfigSafe() {
  try {
    if (!window.browserAPI?.aiGetConfig) {
      return null;
    }
    const result = await window.browserAPI.aiGetConfig();
    return result?.success ? result.config : null;
  } catch (error) {
    console.warn('[抖音发布] ⚠️ 读取 AI 配置失败:', error.message);
    return null;
  }
}

async function waitForAiAgent(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (window.__AI_AGENT__?.publish) {
      return window.__AI_AGENT__;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return null;
}

async function prepareDouyinPublishContext(dataObj) {
  const publishId = dataObj.video.dyPlatform.id;
  const context = {
    publishId,
    windowId: null,
    coverCheckPassed: false,
    coverCheckStatusText: ''
  };

  if (publishRunning) {
    throw new Error('Publish is already running, skipping duplicate call');
  }

  try {
    context.windowId = await window.browserAPI.getWindowId();
    console.log('[抖音发布] 当前窗口 ID:', context.windowId);
  } catch (e) {
    console.error('[抖音发布] ❌ 获取窗口 ID 失败:', e);
  }

  publishRunning = true;

  await delay(2000);

  try {
    const storageKey = context.windowId ? `PUBLISH_SUCCESS_DATA_${context.windowId}` : 'PUBLISH_SUCCESS_DATA';
    localStorage.setItem(storageKey, JSON.stringify({ publishId }));
    console.log('[抖音发布] 💾 已提前保存 publishId 到 localStorage:', publishId, 'key:', storageKey);

    if (window.browserAPI && window.browserAPI.setGlobalData) {
      await window.browserAPI.setGlobalData(`PUBLISH_SUCCESS_DATA_${context.windowId}`, { publishId });
      console.log('[抖音发布] 💾 已保存 publishId 到 globalData');
    }
  } catch (e) {
    console.error('[抖音发布] ❌ 保存 publishId 失败:', e);
  }

  console.log('[抖音发布] ⏳ 等待视频上传完成...');
  await retryOperation(async () => {
    const percentEle = document.querySelector('[class*="upload-progress-style"] [class*="text-"]');
    if (percentEle) {
      const percentText = percentEle.textContent || '';
      throw new Error('视频正在上传中: ' + percentText);
    }
    console.log('[抖音发布] ✅ 检测到视频上传完成（进度元素已消失）');
    return true;
  }, 150, 2000);

  console.log('[抖音发布] ⏳ 等待封面检测通过...');
  const coverCheckStartTime = Date.now();
  const coverCheckTimeout = 120000;
  const coverCheckInterval = 2000;
  const maxCoverRetries = 30;
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
      context.coverCheckPassed = true;
      break;
    }

    context.coverCheckStatusText = currentText;

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

  if (!context.coverCheckPassed) {
    console.log('[抖音发布] ⚠️ 封面检测未确认通过，继续提交流程');
  }

  console.log('[抖音发布] ✅ 封面检测完成，准备点击发布按钮');
  await delay(1000);
  return context;
}

async function handleDouyinPublishSubmitted(context, clickMessage = '') {
  console.log('[抖音发布] ✅ 发布按钮已点击');
  console.log('[抖音发布] 📨 平台提示:', clickMessage);

  await delay(2000);
  console.log('[抖音发布] ✅ 发布已提交，消息:', clickMessage);

  hasProcessed = true;
  publishRunning = false;

  console.log('[抖音发布] ⏳ 等待跳转到成功页（30秒超时）...');
  const currentUrl = window.location.href;
  const startTime = Date.now();
  const timeout = 30000;
  let lastToastMessage = clickMessage || '';

  while (Date.now() - startTime < timeout) {
    await delay(2000);

    if (window.location.href !== currentUrl) {
      console.log('[抖音发布] ✅ 检测到页面跳转，发布成功');
      return;
    }

    const windowKey = context.windowId ? `PUBLISH_SUCCESS_DATA_${context.windowId}` : null;
    const hasWindowData = windowKey ? localStorage.getItem(windowKey) : false;
    const hasGenericData = localStorage.getItem('PUBLISH_SUCCESS_DATA');
    if (!hasWindowData && !hasGenericData) {
      console.log('[抖音发布] ✅ 数据已被成功页处理，跳过后续检测');
      return;
    }

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

  const finalWindowKey = context.windowId ? `PUBLISH_SUCCESS_DATA_${context.windowId}` : null;
  const finalHasWindowData = finalWindowKey ? localStorage.getItem(finalWindowKey) : false;
  const finalHasGenericData = localStorage.getItem('PUBLISH_SUCCESS_DATA');
  if (!finalHasWindowData && !finalHasGenericData) {
    console.log('[抖音发布] ✅ 超时但数据已被成功页处理，跳过错误统计');
    return;
  }

  console.log('[抖音发布] ❌ 等待超时（30秒），判定发布失败');
  if (context.windowId) {
    localStorage.removeItem(`PUBLISH_SUCCESS_DATA_${context.windowId}`);
  }
  localStorage.removeItem('PUBLISH_SUCCESS_DATA');

  let errorMessage = lastToastMessage;
  if (!errorMessage && !context.coverCheckPassed && context.coverCheckStatusText) {
    errorMessage = '封面检测未通过: ' + context.coverCheckStatusText;
    console.log('[抖音发布] ⚠️ 封面检测未通过，作为错误信息上报:', context.coverCheckStatusText);
  }
  if (!errorMessage) {
    errorMessage = '发布超时，未跳转到成功页';
  }
  await sendStatisticsError(context.publishId, errorMessage, '抖音发布');
  await closeWindowWithMessage('发布失败，刷新数据', 1000);
}

async function handleDouyinPublishFailure(context, error) {
  console.log('[抖音发布] ❌ 发布过程出错:', error);
  if (context?.windowId) {
    localStorage.removeItem(`PUBLISH_SUCCESS_DATA_${context.windowId}`);
  }
  localStorage.removeItem('PUBLISH_SUCCESS_DATA');
  await sendStatisticsError(context?.publishId, error.message || '发布过程出错', '抖音发布');
  publishRunning = false;
  await closeWindowWithMessage('发布失败，刷新数据', 1000);
}

async function publishWithAiButton(dataObj, publishButtonSelector) {
  const context = await prepareDouyinPublishContext(dataObj);

  try {
    const aiAgent = await waitForAiAgent();
    if (!aiAgent) {
      throw new Error('ai-publish.js 未就绪，无法执行 AI 按钮点击');
    }

    console.log('[抖音发布] 🤖 准备使用 AI 识别到的发布按钮点击:', publishButtonSelector);
    const clickResult = await aiAgent.exec({
      step: 'AI',
      action: 'click',
      selector: publishButtonSelector,
      description: '点击发布按钮'
    });

    if (!clickResult?.success) {
      throw new Error(clickResult?.error || `AI 点击发布按钮失败: ${publishButtonSelector}`);
    }

    await handleDouyinPublishSubmitted(context, `AI点击选择器: ${publishButtonSelector}`);
  } catch (error) {
    await handleDouyinPublishFailure(context, error);
  }
}

// ===========================
// 7. 发布视频到抖音
// ===========================
async function publishApi(dataObj) {
  console.log("🚀 ~ publishApi ~ dataObj: ", dataObj);
  let context = null;

  try {
    context = await prepareDouyinPublishContext(dataObj);
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
    await delay(800);
    console.log('[抖音发布] ✅ 生产环境确认，准备点击发布按钮...');
    const clickResult = await clickWithRetry(publishBtn, 3, 500, true); // 启用消息捕获

    if (!clickResult.success) {
      console.error('[抖音发布] ❌ 所有点击尝试均失败:', clickResult.message);
      throw new Error('发布按钮点击失败: ' + clickResult.message);
    }
    await handleDouyinPublishSubmitted(context, clickResult.message);

  } catch (error) {
    await handleDouyinPublishFailure(context, error);
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
    // 发送错误上报
    const publishId = dataObj?.video?.dyPlatform?.id;
    if (publishId) {
      await sendStatisticsError(publishId, error.message || '填写表单失败', '抖音发布');
    }
    // 填写表单失败也要关闭窗口，不阻塞下一个任务
    await closeWindowWithMessage('填写表单失败，刷新数据', 1000);
  } finally {
    // 无论成功还是失败，都重置标记
    fillFormRunning = false;
  }
}
