let introFilled = false; // 标记 intro 是否已填写
let fillFormRunning = false; // 标记 fillFormData 是否正在执行
let publishRunning = false; // 标记发布是否正在执行，防止重复点击

// 防重复标志：记录已处理的视频 ID
let isProcessing = false;
let processedVideoIds = new Set(); // 改为 Set 存储已处理的视频 ID

/**
 * 小红书创作者平台发布脚本
 * 用于处理发布流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
  'use strict';

  // ===========================
  // 防止脚本重复注入
  // ===========================
  if (window.__XHS_SCRIPT_LOADED__) {
    console.log('[小红书发布] ⚠️ 脚本已经加载过，跳过重复注入');
    return;
  }

  // ===========================
  // 页面状态检查 - 防止异常渲染
  // ===========================
  if (typeof window.checkPageStateAndReload === 'function') {
    if (!window.checkPageStateAndReload('小红书发布')) {
      return;
    }
  }

  window.__XHS_SCRIPT_LOADED__ = true;

  console.log('═══════════════════════════════════════');
  console.log('✅ 小红书发布脚本已注入');
  console.log('📍 当前 URL:', window.location.href);
  console.log('🕐 注入时间:', new Date().toLocaleString());
  console.log('═══════════════════════════════════════');

  // 检查 common.js 是否已加载（延迟检查，给 common.js 时间执行）
  setTimeout(() => {
    if (!window.__COMMON_JS_LOADED__) {
      console.error('[小红书发布] ❌ common.js 未加载！');
    } else if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined' || typeof uploadVideo === 'undefined') {
      console.error('[小红书发布] ❌ common.js 加载不完整！缺少必需函数');
      console.error('[小红书发布] waitForElement:', typeof waitForElement);
      console.error('[小红书发布] retryOperation:', typeof retryOperation);
      console.error('[小红书发布] uploadVideo:', typeof uploadVideo);
      console.error('[小红书发布] sendStatistics:', typeof sendStatistics);
      console.error('[小红书发布] clickWithRetry:', typeof clickWithRetry);
      console.error('[小红书发布] closeWindowWithMessage:', typeof closeWindowWithMessage);
      console.error('[小红书发布] delay:', typeof delay);
    } else {
      console.log('[小红书发布] ✅ common.js 已完整加载，所有工具函数可用');
    }
  }, 100); // 延迟 100ms 检查

  // ===========================
  // 1. 从 URL 获取发布数据
  // ===========================

  const urlParams = new URLSearchParams(window.location.search);
  const companyId = await window.browserAPI.getGlobalData('company_id');
  const transferId = urlParams.get('transfer_id');

  console.log('[小红书发布] URL 参数:', {
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

  window.__XHS_AUTH__ = {
    // 发送发布成功消息
    notifySuccess: () => {
      sendMessageToParent('发布成功');
    },
  };

  // ===========================
  // 4. 显示调试信息横幅
  // ===========================

  // ===========================
  // 5. 接收来自父窗口的消息（必须在发送 页面加载完成 之前注册！）
  // ===========================
  console.log('[小红书发布] 注册消息监听器...');

  if (!window.browserAPI) {
    console.error('[小红书发布] ❌ browserAPI 不可用！');
  } else {
    console.log('[小红书发布] ✅ browserAPI 可用');

    if (!window.browserAPI.onMessageFromHome) {
      console.error('[小红书发布] ❌ browserAPI.onMessageFromHome 不可用！');
    } else {
      console.log('[小红书发布] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

      window.browserAPI.onMessageFromHome(async (message) => {
        console.log('═══════════════════════════════════════');
        console.log('[小红书发布] 🎉 收到来自父窗口的消息!');
        console.log('[小红书发布] 消息类型:', typeof message);
        console.log('[小红书发布] 消息内容:', message);
        console.log('[小红书发布] 消息.type:', message?.type);
        console.log('[小红书发布] 消息.data:', message?.data);
        console.log('═══════════════════════════════════════');

        // 接收完整的发布数据（直接传递，不使用 IndexedDB）
        if (message.type === 'publish-data') {
          console.log('[小红书发布] ✅ 收到发布数据:', message.data);

          // 🔑 检查 windowId 是否匹配（如果消息带有 windowId）
          if (message.windowId) {
            const myWindowId = await window.browserAPI.getWindowId();
            console.log('[小红书发布] 我的窗口 ID:', myWindowId, '消息目标窗口 ID:', message.windowId);
            if (myWindowId !== message.windowId) {
              console.log('[小红书发布] ⏭️ 消息不是发给我的，跳过');
              return;
            }
            console.log('[小红书发布] ✅ windowId 匹配，处理消息');
          }

          // 防重复检查
          if (isProcessing) {
            console.warn('[小红书发布] ⚠️ 正在处理中，忽略重复消息');
            return;
          }

          // 解析数据获取视频 ID（兼容字符串和对象）
          let messageData;
          try {
            messageData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
          } catch (parseError) {
            console.error('[小红书发布] ❌ 解析消息数据失败:', parseError);
            console.error('[小红书发布] 原始数据:', message.data);
            return;
          }
          const videoId = messageData?.video?.dyPlatform?.id;

          if (!videoId) {
            console.error('[小红书发布] ❌ 视频 ID 不存在，无法处理');
            return;
          }

          // 检查是否已处理过这个视频
          if (processedVideoIds.has(videoId)) {
            console.warn('[小红书发布] ⚠️ 视频已处理过，忽略重复消息. Video ID:', videoId);
            return;
          }

          // 标记为正在处理
          isProcessing = true;
          console.log('[小红书发布] 📝 开始处理视频 ID:', videoId);

          // 更新全局变量
          if (message.data) {
            window.__AUTH_DATA__ = {
              ...window.__AUTH_DATA__,
              message: messageData,
              receivedAt: Date.now()
            };
            console.log('[小红书发布] ✅ 发布数据已更新:', window.__AUTH_DATA__);
            console.log("🚀 ~  ~ messageData: ", messageData);

            // 💾 保存数据到 localStorage（用于授权跳转后恢复）
            /* try {
              localStorage.setItem('XHS_PUBLISH_DATA', message.data);
              console.log('[小红书发布] 💾 数据已保存到 localStorage');
            } catch (e) {
              console.error('[小红书发布] ❌ 保存数据失败:', e);
            }

            // 🔖 保存当前发布页URL（用于授权跳转后返回）
            try {
              localStorage.setItem('XHS_PUBLISH_URL', window.location.href);
              console.log('[小红书发布] 🔖 已保存发布页URL:', window.location.href);
            } catch (e) {
              console.error('[小红书发布] ❌ 保存发布页URL失败:', e);
            } */

            // 查找是否有提示消息
            const tipsEle = document.querySelector('.progetto-sugger-warn .tips');
            if(tipsEle){
              const tipsText = tipsEle.textContent.trim();
              console.log('[小红书发布] ✅ 提示消息:', tipsText);
              const canToError = tipsText.includes('未绑定手机号');
              if(canToError){
                console.log('[小红书发布] ✅ 提示消息包含未绑定手机号，跳转到错误页面');
                const publishId = messageData?.video?.dyPlatform?.id;
                await sendStatisticsError(publishId, '未绑定手机号', '小红书发布');
                await closeWindowWithMessage('发布失败，刷新数据', 1000);
                return;
              }
            }

            await uploadVideo(messageData);
            try {
              await retryOperation(async () => await fillFormData(messageData), 3, 2000);
            } catch (e) {
              console.log('[小红书发布] ❌ 填写表单数据失败:', e);
            }

            console.log('[小红书发布] 📤 准备发送数据到接口...');
            console.log('[小红书发布] ✅ 发布流程已启动，等待 publishApi 完成...');
            // 注意：不在这里关闭窗口，因为 publishApi 内部有异步的统计接口调用
            // 窗口会在 publishApi 完成后自动关闭
          }

          // 标记视频已处理（成功或失败都记录）
          processedVideoIds.add(videoId);

          // 重置处理标志
          isProcessing = false;
          console.log('[小红书发布] 处理完成，已处理视频数:', processedVideoIds.size);
        }
      });

      console.log('[小红书发布] ✅ 消息监听器注册成功');
    }
  }

  // ===========================
  // 6. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
  // ===========================

  // 页面加载完成后向父窗口发送消息
  console.log('[小红书发布] 页面加载完成，发送 页面加载完成 消息');
  sendMessageToParent('页面加载完成');

  console.log('═══════════════════════════════════════');
  console.log('✅ 小红书发布脚本初始化完成');
  console.log('📝 全局方法: window.__XHS_AUTH__');
  console.log('  - notifySuccess()  : 发送发布成功消息');
  console.log('  - sendMessage(msg) : 发送自定义消息');
  console.log('  - getAuthData()    : 获取发布数据');
  console.log('═══════════════════════════════════════');

  // ===========================
  // 7. 检查是否有保存的发布数据（授权跳转恢复）
  // ===========================
  /* setTimeout(async () => {
    try {
      const savedData = localStorage.getItem('XHS_PUBLISH_DATA');
      if (savedData && !isProcessing && !hasProcessed) {
        console.log('[小红书发布] 🔄 检测到保存的发布数据，准备恢复...');
        const messageData = JSON.parse(savedData);
        console.log('[小红书发布] 📦 恢复的数据:', messageData);

        // 标记为正在处理
        isProcessing = true;

        // 更新全局变量
        window.__AUTH_DATA__ = {
          ...window.__AUTH_DATA__,
          message: messageData,
          recoveredAt: Date.now()
        };

        // 执行上传流程
        await uploadVideo(messageData);
        try {
          await retryOperation(async () => await fillFormData(messageData), 3, 2000);
        } catch (e) {
          console.log('[小红书发布] ❌ 填写表单数据失败:', e);
        }

        console.log('[小红书发布] 📤 恢复数据后准备发送数据到接口...');
        console.log('[小红书发布] ✅ 发布流程已启动，等待 publishApi 完成...');

        // 重置处理标志
        isProcessing = false;
      } else {
        console.log('[小红书发布] ℹ️ 没有需要恢复的数据');
      }
    } catch (error) {
      console.error('[小红书发布] ❌ 恢复数据失败:', error);
      isProcessing = false;
    }
  }, 2000); // 延迟2秒，等待页面完全加载 */

})();

// ===========================
// 7. 发布视频到小红书
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
    console.log('[小红书发布] 当前窗口 ID:', windowId);
  } catch (e) {
    console.error('[小红书发布] ❌ 获取窗口 ID 失败:', e);
  }

  try {
    // 标记发布正在进行
    publishRunning = true;

    // 等待发布按钮可用
    const publishBtn = await retryOperation(async () => {
      const btn = document.querySelector(".submit > .custom-button.red");
      if (!btn) {
        throw new Error('发布按钮未找到');
      }
      return btn;
    }, 10, 2000);

    // 等待按钮事件绑定完成
    await delay(800);

    // 🔑 小红书成功后会直接跳转页面，必须在点击前保存数据
    // 否则跳转后 publishApi 的后续代码不会执行
    // 使用窗口 ID 作为 key，避免多窗口并发时数据覆盖
    try {
      const storageKey = windowId ? `PUBLISH_SUCCESS_DATA_${windowId}` : 'PUBLISH_SUCCESS_DATA';
      localStorage.setItem(storageKey, JSON.stringify({ publishId: publishId }));
      console.log('[小红书发布] 💾 已提前保存 publishId 到 localStorage:', publishId, 'key:', storageKey);
    } catch (e) {
      console.error('[小红书发布] ❌ 保存 publishId 失败:', e);
    }

    // 🚨 开发环境检测：使用 browserAPI.isProduction 判断
    // 默认策略：无法确定环境时，执行点击（安全优先）
    let isDevEnvironment = false;

    if (window.browserAPI) {
      isDevEnvironment = window.browserAPI.isProduction === false;
      console.log('[小红书发布] 环境检测:', {
        hasBrowserAPI: true,
        isProduction: window.browserAPI.isProduction,
        isDevEnvironment: isDevEnvironment
      });
    } else {
      console.warn('[小红书发布] ⚠️ browserAPI 不可用，默认执行发布（生产模式）');
    }


    // 生产环境：必须点击发布按钮
    console.log('[小红书发布] ✅ 生产环境确认，准备点击发布按钮...');

    const clickResult = await clickWithRetry(publishBtn, 3, 500, true); // 启用消息捕获

    if (!clickResult.success) {
      console.error('[小红书发布] ❌ 所有点击尝试均失败:', clickResult.message);
      // 清除提前保存的数据（使用窗口专属 key 和通用 key，确保兼容性）
      if (windowId) {
        localStorage.removeItem(`PUBLISH_SUCCESS_DATA_${windowId}`);
      }
      localStorage.removeItem('PUBLISH_SUCCESS_DATA');
      // 发送失败统计
      await sendStatisticsError(publishId, clickResult.message || '点击发布按钮失败', '小红书发布');
      publishRunning = false;
      throw new Error('发布按钮点击失败: ' + clickResult.message);
    }

    console.log('[小红书发布] ✅ 发布按钮已点击');
    console.log('[小红书发布] 📨 平台提示:', clickResult.message);

    // 开发环境弹窗显示平台提示信息
    if (window.browserAPI && window.browserAPI.isProduction === false) {
      alert(`小红书发布结果：\n\n${clickResult.message}`);
    }

    // 等待页面稳定
    await delay(2000);

    // 点击成功后，不再判断 toast 消息（因为各平台提示词不统一，无法准确判断）
    // 直接认为发布已提交，等待页面跳转到成功页
    // 成功统计由 publish-success.js 在成功页发送
    console.log('[小红书发布] ✅ 发布已提交，消息:', clickResult.message);

    // 标记已完成
    hasProcessed = true;
    publishRunning = false;

    // 等待页面跳转到成功页，超时 30 秒
    console.log('[小红书发布] ⏳ 等待跳转到成功页（30秒超时）...');
    const currentUrl = window.location.href;
    const startTime = Date.now();
    const timeout = 30000; // 30秒
    // 🔑 用 clickResult.message 作为初始值，避免超时时丢失已捕获的提示
    let lastToastMessage = clickResult.message || '';

    while (Date.now() - startTime < timeout) {
      await delay(2000); // 每 2 秒检查一次

      // 检查 URL 是否变化
      if (window.location.href !== currentUrl) {
        console.log('[小红书发布] ✅ 检测到页面跳转，发布成功');
        return; // 页面已跳转，由 publish-success.js 处理
      }

      // 检查 PUBLISH_SUCCESS_DATA 是否已被 publish-success.js 删除（检查窗口专属 key 和通用 key）
      const windowKey = windowId ? `PUBLISH_SUCCESS_DATA_${windowId}` : null;
      const hasWindowData = windowKey ? localStorage.getItem(windowKey) : false;
      const hasGenericData = localStorage.getItem('PUBLISH_SUCCESS_DATA');
      if (!hasWindowData && !hasGenericData) {
        console.log('[小红书发布] ✅ 数据已被成功页处理，跳过后续检测');
        return;
      }

      // 检测是否出现 toast 提示，记录消息内容
      // 🔑 过滤掉成功消息，避免将成功消息作为错误信息上报
      const successKeywords = ['成功', '发布成功', '提交成功', '上传成功'];
      try {
        const toastEl = document.querySelector('.d-toast-description');
        if (toastEl) {
          const text = (toastEl.textContent || '').trim();
          const isSuccess = successKeywords.some(keyword => text.includes(keyword));
          if (text && !isSuccess) {
            lastToastMessage = text;
            console.log('[小红书发布] 📨 检测到提示:', text);
          } else if (isSuccess) {
            console.log('[小红书发布] ✅ 检测到成功提示，忽略:', text);
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
      console.log('[小红书发布] ✅ 超时但数据已被成功页处理，跳过错误统计');
      return;
    }

    // 真正的超时失败
    console.log('[小红书发布] ❌ 等待超时（30秒），判定发布失败');
    // 清除数据（窗口专属 key 和通用 key）
    if (windowId) {
      localStorage.removeItem(`PUBLISH_SUCCESS_DATA_${windowId}`);
    }
    localStorage.removeItem('PUBLISH_SUCCESS_DATA');
    await sendStatisticsError(publishId, lastToastMessage || '发布超时，未跳转到成功页', '小红书发布');
    await closeWindowWithMessage('发布失败，刷新数据', 1000);

  } catch (error) {
    console.log("🚀 ~ publishApi ~ error: ", error);
    // 清除提前保存的数据（窗口专属 key 和通用 key）
    if (windowId) {
      localStorage.removeItem(`PUBLISH_SUCCESS_DATA_${windowId}`);
    }
    localStorage.removeItem('PUBLISH_SUCCESS_DATA');
    // 发送失败统计
    await sendStatisticsError(publishId, error.message || '发布过程出错', '小红书发布');
    publishRunning = false;
    // 即使出错也尝试关闭窗口
    await closeWindowWithMessage('发布失败，刷新数据', 1000);
  }
}

// 填写表单数据
async function fillFormData(dataObj) {
  // 防止重复执行
  if (fillFormRunning) {
    return;
  }
  fillFormRunning = true;

  try {
    const titleAndIntro = dataObj.video.video.sendlog;
    // alert(JSON.stringify(titleAndIntro));

    // 填写标题 - 尝试多个可能的选择器
    let titleInput = null;
    const titleSelectors = [
      ".d-input-wrapper .d-input input"
    ];

    // alert('Searching for title input...');
    for (const selector of titleSelectors) {
      try {
        // alert(`Trying selector: ${selector}`);
        titleInput = await waitForElement(selector, 2000);
        if (titleInput) {
          // alert(`✅ Found title input with selector: ${selector}`);
          break;
        }
      } catch (error) {
        // alert(`❌ Selector ${selector} not found, trying next...`);
      }
    }

    if (!titleInput) {
      // alert('⚠️ Title input not found with any selector, skipping title...');
    } else {
      // alert(`Filling title: ${titleAndIntro.title || ''}`);

      try {
        // 先触发focus事件
        if (typeof titleInput.focus === 'function') {
          titleInput.focus();
        } else {
          titleInput.dispatchEvent(new Event('focus', { bubbles: true }));
        }

        // 延迟执行，让React状态稳定
        await new Promise(resolve => setTimeout(resolve, 200));

        // 使用setNativeValue设置值
        setNativeValue(titleInput, titleAndIntro.title || '');

        // 额外触发input事件
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));

        // alert('✅ Title filled successfully');

      } catch (error) {
        // alert('❌ Title setting failed: ' + error.message);
      }
    }

    // 填写简介 - 尝试多个可能的选择器
    try {
      // 首先检查是否已经填写过（通过全局标记）
      if (introFilled) {
        // alert('✅ Intro already filled (by flag), skipping');
        // 直接跳过，不再查找元素或进行任何操作
      } else {
        let introInput = null;
        const introSelectors = [
          ".tiptap-container .ProseMirror"
        ];

        // alert('Searching for intro input...');
        for (const selector of introSelectors) {
          try {
            // alert(`Trying selector: ${selector}`);
            introInput = await waitForElement(selector, 2000);
            if (introInput) {
              // alert(`✅ Found intro input with selector: ${selector}`);
              break;
            }
          } catch (error) {
            // alert(`❌ Selector ${selector} not found, trying next...`);
          }
        }

        if (!introInput) {
          // alert('⚠️ Intro input not found with any selector, skipping intro...');
        } else {
          const targetIntro = titleAndIntro.intro || '';
          const targetContent = targetIntro.trim();

          // 检查实际内容
          const currentContent = (introInput.textContent || introInput.innerText || '').trim();

          // 只有在标记未设置且内容不同时才填写
          if (currentContent !== targetContent) {
            // 立即标记为已填写（在任何操作之前，防止并发）
            introFilled = true;

            // alert(`Filling intro: ${titleAndIntro.intro || ''}`);

            // 清空现有内容，避免累积
            introInput.innerHTML = '';
            if (titleAndIntro.intro) {
              introInput.innerHTML = '<p>' + titleAndIntro.intro + '</p>';
            }

            // 触发input事件
            if (typeof introInput.dispatchEvent === 'function') {
              introInput.dispatchEvent(new Event('input', { bubbles: true }));
            }

            // alert('✅ Intro filled successfully');
          } else {
            // 内容已经正确，也标记为已填写
            introFilled = true;
            // alert('✅ Intro content already correct, marking as filled');
          }
        }
      }
    } catch (error) {
      // alert('⚠️ Intro handling failed: ' + error.message);
    }

    // 设置发布时间
    const publishTime = dataObj.video.formData.send_set;
    if (+publishTime === 2) {
      try {
        // 定时发布
        const immediateRadio = await waitForElement(".formbox > .flexbox:nth-of-type(3) .el-radio-group input[type='radio'][value='0']", 3000);
        const scheduleRadio = await waitForElement(".formbox > .flexbox:nth-of-type(3) .el-radio-group input[type='radio'][value='1']", 3000);
        // alert(immediateRadio, 'immediateRadio');

        setNativeValue(immediateRadio, false);
        setNativeValue(scheduleRadio, true);

        // 设置日期时间
        await new Promise(resolve => setTimeout(resolve, 500));
        const dateInput = await waitForElement(".formbox > .flexbox:nth-of-type(3) .date-picker input", 3000);

        // 多次设置确保生效
        for (let i = 0; i < 2; i++) {
          if (setNativeValue(dateInput, dataObj.video.dyPlatform.send_time)) {
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      } catch (error) {
        // alert('⚠️ Schedule time setting failed: ' + error.message);
      }
    }

    // 等待表单填写完成
    await new Promise(resolve => setTimeout(resolve, 6000));

    // 发布
    await publishApi(dataObj);

  } catch (error) {
    console.error('[小红书发布] fillFormData 错误:', error);
    // 发送错误上报
    const publishId = dataObj?.video?.dyPlatform?.id;
    if (publishId) {
      await sendStatisticsError(publishId, error.message || '填写表单失败', '小红书发布');
    }
    // 填写表单失败也要关闭窗口，不阻塞下一个任务
    await closeWindowWithMessage('填写表单失败，刷新数据', 1000);
  } finally {
    // 无论成功还是失败，都重置标记
    fillFormRunning = false;
  }
}
