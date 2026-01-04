/**
 * 百家号创作者平台发布脚本
 * 用于处理发布流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
  'use strict';

  // ===========================
  // 防止脚本重复注入
  // ===========================
  if (window.__BJH_SCRIPT_LOADED__) {
    console.log('[百家号发布] ⚠️ 脚本已经加载过，跳过重复注入');
    return;
  }

  // ===========================
  // 页面状态检查 - 防止异常渲染
  // ===========================
  if (typeof window.checkPageStateAndReload === 'function') {
    if (!window.checkPageStateAndReload('百家号发布')) {
      return;
    }
  }

  window.__BJH_SCRIPT_LOADED__ = true;

  // 变量声明（放在防重复检查之后）
  let introFilled = false; // 标记 intro 是否已填写
  let fillFormRunning = false; // 标记 fillFormData 是否正在执行
  let publishRunning = false; // 标记发布是否正在执行，防止重复点击

  // 防重复标志：确保数据只处理一次
  let isProcessing = false;
  let hasProcessed = false;

  // 保存收到的父窗口消息（用于备用方案）
  let receivedMessageData = null;

  // 当前窗口 ID（用于构建窗口专属的 localStorage key，避免多窗口冲突）
  let currentWindowId = null;

  // 获取窗口专属的发布成功数据 key
  const getPublishSuccessKey = () => {
    const key = `PUBLISH_SUCCESS_DATA_${currentWindowId || 'default'}`;
    console.log('[百家号发布] 🔑 使用 localStorage key:', key);
    return key;
  };

  console.log('═══════════════════════════════════════');
  console.log('✅ 百家号发布脚本已注入');
  console.log('📍 当前 URL:', window.location.href);
  console.log('🕐 注入时间:', new Date().toLocaleString());
  console.log('═══════════════════════════════════════');

  // 检查 common.js 是否已加载
  if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
    console.error('[百家号发布] ❌ common.js 未加载！脚本可能无法正常工作');
  } else {
    console.log('[百家号发布] ✅ common.js 已加载，工具函数可用');
  }

  // ===========================
  // 🔴 重要：先注册消息监听器，再执行任何 await 操作！
  // 否则消息可能在 await 期间到达，但回调还没注册
  // ===========================
  console.log('[百家号发布] 注册消息监听器...');

  if (!window.browserAPI) {
    console.error('[百家号发布] ❌ browserAPI 不可用！');
  } else {
    console.log('[百家号发布] ✅ browserAPI 可用');

    if (!window.browserAPI.onMessageFromHome) {
      console.error('[百家号发布] ❌ browserAPI.onMessageFromHome 不可用！');
    } else {
      console.log('[百家号发布] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

      window.browserAPI.onMessageFromHome(async (message) => {
        console.log('═══════════════════════════════════════');
        console.log('[百家号发布] 🎉 收到来自父窗口的消息!');
        console.log('[百家号发布] 消息类型:', typeof message);
        console.log('[百家号发布] 消息内容:', message);
        console.log('[百家号发布] 消息.type:', message?.type);
        console.log('[百家号发布] 消息.windowId:', message?.windowId);
        console.log('═══════════════════════════════════════');

        // 接收完整的发布数据（直接传递，不使用 IndexedDB）
        // 兼容 publish-data 和 auth-data 两种消息类型
        if (message.type === 'publish-data') {
          let messageData;
          try {
            messageData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
          } catch (parseError) {
            console.error('[百家号发布] ❌ 解析消息数据失败:', parseError);
            console.error('[百家号发布] 原始数据:', message.data);
            return;
          }

          // 🔑 先检查 windowId 是否匹配（在保存数据之前！避免串数据）
          if (message.windowId) {
            const myWindowId = await window.browserAPI.getWindowId();
            console.log('[百家号发布] 我的窗口 ID:', myWindowId, '消息目标窗口 ID:', message.windowId);
            if (myWindowId !== message.windowId) {
              console.log('[百家号发布] ⏭️ 消息不是发给我的，跳过（不保存数据）');
              return;
            }
            console.log('[百家号发布] ✅ windowId 匹配，处理消息');
          }

          // windowId 匹配后才保存消息数据
          receivedMessageData = messageData;
          console.log('[百家号发布] 💾 已保存收到的消息数据到 receivedMessageData');

          console.log('[百家号发布] ✅ 收到发布数据:', messageData);

          // 防重复检查
          if (isProcessing) {
            console.warn('[百家号发布] ⚠️ 正在处理中，忽略重复消息');
            return;
          }
          if (hasProcessed) {
            console.warn('[百家号发布] ⚠️ 已经处理过，忽略重复消息');
            return;
          }

          // 标记为正在处理
          isProcessing = true;

          // 更新全局变量
          if (messageData) {
            window.__AUTH_DATA__ = {
              ...window.__AUTH_DATA__,
              message: messageData,
              receivedAt: Date.now()
            };
            console.log('[百家号发布] ✅ 发布数据已更新:', window.__AUTH_DATA__);
            console.log("🚀 ~  ~ messageData: ", messageData);

            try {
              await retryOperation(async () => await fillFormData(messageData), 3, 2000);
            } catch (e) {
              console.log('[百家号发布] ❌ 填写表单数据失败:', e);
            }

            console.log('[百家号发布] 📤 准备发送数据到接口...');
            console.log('[百家号发布] ✅ 发布流程已启动，等待 publishApi 完成...');
          }

          // 重置处理标志（无论成功或失败）
          isProcessing = false;
          console.log('[百家号发布] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
        }
      });

      console.log('[百家号发布] ✅ 消息监听器注册成功');
    }
  }

  // ===========================
  // 1. 从 URL 获取发布数据（在消息监听器注册之后）
  // ===========================

  const urlParams = new URLSearchParams(window.location.search);
  const companyId = await window.browserAPI.getGlobalData('company_id');
  const transferId = urlParams.get('transfer_id');

  // 获取当前窗口 ID（用于窗口专属的 localStorage key）
  try {
    currentWindowId = await window.browserAPI.getWindowId();
    console.log('[百家号发布] 当前窗口 ID:', currentWindowId);
  } catch (e) {
    console.error('[百家号发布] ❌ 获取窗口 ID 失败:', e);
  }

  console.log('[百家号发布] URL 参数:', {
    companyId,
    transferId,
    windowId: currentWindowId
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

  window.__BJH_AUTH__ = {
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
  // 3. 显示调试信息横幅
  // ===========================

  // ===========================
  // 4. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
  // ===========================

  // 页面加载完成后向父窗口发送消息
  console.log('[百家号发布] 页面加载完成，发送 页面加载完成 消息');
  sendMessageToParent('页面加载完成');

  console.log('═══════════════════════════════════════');
  console.log('✅ 百家号发布脚本初始化完成');
  console.log('📝 全局方法: window.__BJH_AUTH__');
  console.log('  - notifySuccess()  : 发送发布成功消息');
  console.log('  - sendMessage(msg) : 发送自定义消息');
  console.log('  - getAuthData()    : 获取发布数据');
  console.log('═══════════════════════════════════════');

  // ===========================
  // 7. 从全局存储读取发布数据（备用方案，不依赖消息）
  // ===========================
  /* setTimeout(async () => {
    // 如果已经在处理或已处理完成，跳过
    if (isProcessing || hasProcessed) {
      console.log('[百家号发布] ⏭️ 已在处理中或已完成，跳过全局存储读取');
      return;
    }

    try {
      // 获取当前窗口 ID
      const windowId = await window.browserAPI.getWindowId();
      console.log('[百家号发布] 当前窗口 ID:', windowId);

      if (!windowId) {
        console.log('[百家号发布] ❌ 无法获取窗口 ID');
        return;
      }

      // 用窗口 ID 读取对应的发布数据
      const publishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
      console.log('[百家号发布] 📦 从全局存储读取 publish_data_window_' + windowId + ':', publishData);

      if (publishData && !isProcessing && !hasProcessed) {
        console.log('[百家号发布] ✅ 从全局存储获取到发布数据，开始处理...');

        // 标记为正在处理
        isProcessing = true;

        // 更新全局变量
        window.__AUTH_DATA__ = {
          ...window.__AUTH_DATA__,
          message: publishData,
          source: 'globalStorage',
          windowId: windowId,
          receivedAt: Date.now()
        };

        try {
          await retryOperation(async () => await fillFormData(publishData), 3, 2000);
        } catch (e) {
          console.log('[百家号发布] ❌ 填写表单数据失败:', e);
        }

        console.log('[百家号发布] 📤 准备发送数据到接口...');
        console.log('[百家号发布] ✅ 发布流程已启动，等待 publishApi 完成...');

        // 清除已使用的数据，避免重复处理
        await window.browserAPI.removeGlobalData(`publish_data_window_${windowId}`);
        console.log('[百家号发布] 🗑️ 已清除 publish_data_window_' + windowId);

        isProcessing = false;
      } else {
        console.log('[百家号发布] ℹ️ 全局存储中没有 publish_data_window_' + windowId + ' 数据');

        // 检查是否有收到过父窗口的消息数据
        if (receivedMessageData && !isProcessing && !hasProcessed) {
          console.log('[百家号发布] ✅ 使用之前收到的父窗口消息数据');

          // 标记为正在处理
          isProcessing = true;

          // 更新全局变量
          window.__AUTH_DATA__ = {
            ...window.__AUTH_DATA__,
            message: receivedMessageData,
            source: 'receivedMessage',
            windowId: windowId,
            receivedAt: Date.now()
          };

          try {
            await retryOperation(async () => await fillFormData(receivedMessageData), 3, 2000);
          } catch (e) {
            console.log('[百家号发布] ❌ 填写表单数据失败:', e);
          }

          console.log('[百家号发布] 📤 准备发送数据到接口...');
          console.log('[百家号发布] ✅ 发布流程已启动，等待 publishApi 完成...');

          isProcessing = false;
        } else {
          console.log('[百家号发布] ⚠️ 没有可用的发布数据（全局存储为空，也没有收到父窗口消息）');
        }
      }
    } catch (error) {
      console.error('[百家号发布] ❌ 从全局存储读取数据失败:', error);
      isProcessing = false;
    }
  }, 5000); // 延迟 5 秒，给消息监听一些时间先处理 */

  // ===========================
  // 8. 检查是否有保存的发布数据（授权跳转恢复）
  // ===========================

  // ===========================
  // 9. 发布视频到百家号（移到 IIFE 内部以访问变量）
  // ===========================
  async function publishApi(dataObj) {
  console.log("🚀 ~ publishApi ~ dataObj: ", dataObj);

  // 防止重复执行
  if (publishRunning) {
    console.log('Publish is already running, skipping duplicate call');
    return;
  }

  const publishId = dataObj.video.dyPlatform.id;

  try {
    // 标记发布正在进行
    publishRunning = true;

    // 等待发布按钮可用
    const publishBtn = await retryOperation(async () => {
      const btn = document.querySelector(".cheetah-modal-confirm-btns .cheetah-btn-primary");
      if (!btn) {
        throw new Error('Publish button not found');
      }
      return btn;
    }, 10, 2000);

    // 等待按钮事件绑定完成
    await delay(800);

    // 🔑 百家号成功后会直接跳转页面，必须在点击前保存数据
    try {
      localStorage.setItem(getPublishSuccessKey(), JSON.stringify({ publishId: publishId }));
      console.log('[百家号发布] 💾 已提前保存 publishId 到 localStorage:', publishId);
    } catch (e) {
      console.error('[百家号发布] ❌ 保存 publishId 失败:', e);
    }

    // 🚨 开发环境检测：使用 browserAPI.isProduction 判断
    let isDevEnvironment = false;

    if (window.browserAPI) {
      isDevEnvironment = window.browserAPI.isProduction === false;
      console.log('[百家号发布] 环境检测:', {
        hasBrowserAPI: true,
        isProduction: window.browserAPI.isProduction,
        isDevEnvironment: isDevEnvironment
      });
    } else {
      console.warn('[百家号发布] ⚠️ browserAPI 不可用，默认执行发布（生产模式）');
    }

    // 生产环境：必须点击发布按钮
    console.log('[百家号发布] ✅ 生产环境确认，准备点击发布按钮...');

    const clickResult = await clickWithRetry(publishBtn, 3, 500, true); // 启用消息捕获

    if (!clickResult.success) {
      console.error('[百家号发布] ❌ 所有点击尝试均失败:', clickResult.message);
      // 清除提前保存的数据
      localStorage.removeItem(getPublishSuccessKey());
      // 发送失败统计
      await sendStatisticsError(publishId, clickResult.message || '点击发布按钮失败', '百家号发布');
      publishRunning = false;
      throw new Error('发布按钮点击失败: ' + clickResult.message);
    }

    console.log('[百家号发布] ✅ 发布按钮已点击');
    console.log('[百家号发布] 📨 平台提示:', clickResult.message);

    // 开发环境弹窗显示平台提示信息
    if (window.browserAPI && window.browserAPI.isProduction === false) {
      alert(`百家号发布结果：\n\n${clickResult.message}`);
    }

    // 等待页面稳定
    await delay(2000);

    // 百家号特定：检测失败提示元素
    // 注意：百家号的错误提示结构是 <span>图标</span><span>错误文本</span>，需要用 :last-child 选择文本
    let failureMessage = null;
    try {
      const errorSpan = document.querySelector('.cheetah-message-custom-content.cheetah-message-error span:last-child');
      if (errorSpan) {
        const text = (errorSpan.textContent || '').trim();
        if (text) {
          failureMessage = text;
          console.log('[百家号发布] ⚠️ 检测到错误提示:', failureMessage);
        }
      }
    } catch (e) {
      console.log('[百家号发布] ✅ 未检测到失败提示');
    }

    // 如果检测到失败提示
    if (failureMessage) {
      console.log('[百家号发布] ❌ 发布失败:', failureMessage);
      localStorage.removeItem(getPublishSuccessKey());
      await sendStatisticsError(publishId, failureMessage, '百家号发布');
      hasProcessed = true;
      publishRunning = false;
      await closeWindowWithMessage('发布失败，刷新数据', 1000);
      return;
    }

    // 没有失败提示，认为发布已提交
    console.log('[百家号发布] ✅ 发布已提交，消息:', clickResult.message);

    // 🗑️ 清除平台特定数据（但保留 PUBLISH_SUCCESS_DATA 让 publish-success.js 来删除）
    try {
      localStorage.removeItem('BJH_PUBLISH_DATA');
      console.log('[百家号发布] 🗑️ 已清除 BJH_PUBLISH_DATA');
    } catch (e) {
      console.error('[百家号发布] ❌ 清除数据失败:', e);
    }

    sendMessageToParent('发布成功，刷新数据');
    hasProcessed = true;
    publishRunning = false;

    // 等待页面跳转到成功页，超时 30 秒
    console.log('[百家号发布] ⏳ 等待跳转到成功页（30秒超时）...');
    const currentUrl = window.location.href;
    const startTime = Date.now();
    const timeout = 30000; // 30秒
    // 🔑 用 clickResult.message 作为初始值，避免超时时丢失已捕获的提示
    let lastErrorMessage = clickResult.message || '';

    while (Date.now() - startTime < timeout) {
      await delay(2000); // 每 2 秒检查一次

      // 检查 URL 是否变化（跳转到成功页）
      if (window.location.href !== currentUrl) {
        console.log('[百家号发布] ✅ 检测到页面跳转，发布成功');
        return; // 页面已跳转，由 publish-success.js 处理
      }

      // 检查窗口专属的 PUBLISH_SUCCESS_DATA 是否已被 publish-success.js 删除
      if (!localStorage.getItem(getPublishSuccessKey())) {
        console.log('[百家号发布] ✅ 数据已被成功页处理，跳过后续检测');
        return;
      }

      // 检测是否出现错误提示，记录消息内容
      try {
        const errorSpan = document.querySelector('.cheetah-message-custom-content.cheetah-message-error span:last-child');
        if (errorSpan) {
          const text = (errorSpan.textContent || '').trim();
          if (text) {
            lastErrorMessage = text;
            console.log('[百家号发布] 📨 检测到错误提示:', text);
          }
        }
      } catch (e) {
        // 忽略检测错误
      }
    }

    // 超时未跳转 - 再次检查是否已被 publish-success.js 处理
    if (!localStorage.getItem(getPublishSuccessKey())) {
      console.log('[百家号发布] ✅ 超时但数据已被成功页处理，跳过错误统计');
      return;
    }

    // 真正的超时失败
    console.log('[百家号发布] ❌ 等待超时（30秒），判定发布失败');
    localStorage.removeItem(getPublishSuccessKey());
    await sendStatisticsError(publishId, lastErrorMessage || '发布超时，未跳转到成功页', '百家号发布');
    await closeWindowWithMessage('发布失败，刷新数据', 1000);

  } catch (error) {
    console.log("🚀 ~ publishApi ~ error: ", error);
    // 发送失败统计
    await sendStatisticsError(publishId, error.message || '发布过程出错', '百家号发布');
    publishRunning = false;
    // 即使出错也尝试关闭窗口
    await closeWindowWithMessage('发布失败，刷新数据', 1000);
  }
}

  /**
   * 等待封面图片上传完成并显示
   * @param {number} timeout 超时时间（毫秒）
   * @returns {Promise<boolean>}
   */
  async function waitForCoverImage(timeout = 60000) {
    const startTime = Date.now();
    const checkInterval = 500; // 每500ms检查一次

    while (Date.now() - startTime < timeout) {
      // 方法1：检查"选择封面"文字是否消失（上传成功后会变成图片预览）
      const selectCoverText = Array.from(document.querySelectorAll('div, span'))
          .find(el => el.textContent.trim() === '选择封面' && el.children.length === 0);

      // 如果"选择封面"文字不存在了，说明可能已上传成功
      if (!selectCoverText) {
        console.log('[百家号发布] ✅ "选择封面"文字已消失，封面可能已上传');
        // 再等待一下确保渲染完成
        await delay(500);
        return true;
      }

      // 方法2：检查是否有封面预览图片（通过 background-image 或 img 标签）
      // 查找封面区域内的图片元素
      const coverArea = document.querySelector('[class*="cover"], [class*="image-box"], .bjh-image-box');
      if (coverArea) {
        // 检查 img 标签
        const imgEle = coverArea.querySelector('img[src]:not([src=""])');
        if (imgEle && imgEle.src && !imgEle.src.includes('data:') && imgEle.naturalWidth > 0) {
          console.log('[百家号发布] ✅ 封面图片已加载(img标签):', imgEle.src.substring(0, 100) + '...');
          return true;
        }

        // 检查 background-image
        const allDivs = coverArea.querySelectorAll('div');
        for (const div of allDivs) {
          const style = window.getComputedStyle(div);
          const bgImage = style.backgroundImage;
          if (bgImage && bgImage !== 'none' && bgImage.includes('url(')) {
            console.log('[百家号发布] ✅ 封面图片已加载(背景图):', bgImage.substring(0, 100) + '...');
            return true;
          }
        }
      }

      // 方法3：全局检查是否有新上传的图片预览
      const previewImages = document.querySelectorAll('[class*="preview"] img, [class*="thumbnail"] img');
      for (const img of previewImages) {
        if (img.src && !img.src.includes('data:') && img.naturalWidth > 0) {
          console.log('[百家号发布] ✅ 封面图片已加载(预览图):', img.src.substring(0, 100) + '...');
          return true;
        }
      }

      await delay(checkInterval);
    }

    throw new Error('等待封面图片显示超时');
  }

  function getOptions(ele, value) {
    if (ele) {
      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window });
      ele.dispatchEvent(event);
      setTimeout(() => {
        // 获取所有下拉菜单
        const dropdowns = document.querySelectorAll(".cheetah-select-dropdown");
        if (dropdowns && dropdowns.length) {
          // 取最后一个（最新弹出的）
          const currentDropdown = dropdowns[dropdowns.length - 1];
          // 找到你想选的那个选项，比如 value=2
          const targetOption = Array.from(currentDropdown.querySelectorAll(".cheetah-select-item-option-content")).find(
              el => {
                const text = el.innerText.replace(/[\u4e00-\u9fa5]/g, "").trim();
                return text === value;
              }
          );
          if (targetOption) {
            targetOption.click();
          }
        }
      }, 200); // 200ms 视实际弹出速度调整
    }
  }

  // 填写表单数据
  async function fillFormData(dataObj) {
      console.log("🚀 ~ fillFormData ~ dataObj: ", dataObj);
    // 防止重复执行
    if (fillFormRunning) {
      return;
    }
    fillFormRunning = true;

    try {
      const pathImage = dataObj?.video?.video?.cover;
      if (!pathImage) {
        // alert('No cover image found');
        fillFormRunning = false;
        return;
      }

      setTimeout(async () => {
        // 标题
        const hasTitleEle = await waitForElement(".client_components_titleInput .input-container .input-box textarea");
        if (hasTitleEle) {
          const titleEle = document.querySelector(".client_components_titleInput .input-container .input-box textarea");
          setNativeValue(titleEle, dataObj.video.video.title);
        }

        // 设置封面为单图模式
        const hasSettingsWrapEle = await waitForElement("#bjhEditWrapSet");
        if (hasSettingsWrapEle) {
          const settingsWrapEle = document.querySelector("#bjhEditWrapSet");
          const hasCoverRadioEle = await waitForElement("#bjhNewsCover");
          if (hasCoverRadioEle) {
            const coverRadioWrapEle = settingsWrapEle.querySelector("#bjhNewsCover");
            const hasSingleRadioEle = await waitForElement('input[type="radio"]');
            if (hasSingleRadioEle) {
              const singleRadioEle = coverRadioWrapEle.querySelector('input[type="radio"][value="one"]');
              const threeRadioEle = coverRadioWrapEle.querySelector('input[type="radio"][value="three"]');
              setNativeValue(singleRadioEle, true);
              setNativeValue(threeRadioEle, false);
            }
          }

          //设置简介
          try {
            // 首先检查是否已经填写过（通过全局标记）
            if (introFilled) {
              console.log('[百家号发布] 简介已填写过，跳过');
            } else {
              console.log('[百家号发布] 开始填写简介...');
              const hasIntroEle = await waitForElement(".news_abstract_form_item textarea");
              console.log('[百家号发布] 简介元素是否存在:', hasIntroEle);
              if (hasIntroEle) {
                // 使用 document.querySelector 而不是 settingsWrapEle.querySelector，因为元素可能不在 settingsWrapEle 内
                const introEle = document.querySelector(".news_abstract_form_item textarea");
                console.log('[百家号发布] 简介输入框元素:', introEle);
                const targetIntro = dataObj.video.video.intro || '';
                const targetContent = targetIntro.trim();
                console.log('[百家号发布] 目标简介内容:', targetContent);

                // 检查实际内容
                const currentContent = (introEle?.value || '').trim();
                console.log('[百家号发布] 当前简介内容:', currentContent);

                // 只有在标记未设置且内容不同时才填写
                if (introEle && currentContent !== targetContent) {
                  // 立即标记为已填写（在任何操作之前，防止并发）
                  introFilled = true;
                  console.log('[百家号发布] 正在填写简介...');
                  setNativeValue(introEle, dataObj.video.video.intro);
                  console.log('[百家号发布] ✅ 简介填写完成');
                } else if (!introEle) {
                  console.log('[百家号发布] ❌ 简介输入框元素为空');
                } else {
                  // 内容已经正确，也标记为已填写
                  introFilled = true;
                  console.log('[百家号发布] 简介内容已正确，无需修改');
                }
              } else {
                console.log('[百家号发布] ❌ 未找到简介元素 .news_abstract_form_item textarea');
              }
            }
          } catch (error) {
            console.log('[百家号发布] ❌ 简介填写失败:', error.message);
          }

          // 内容（带重试）
          setTimeout(async () => {
            try {
              await retryOperation(async () => {
                const hasIframeEle = await waitForElement("iframe");
                if (!hasIframeEle) {
                  throw new Error('iframe 未找到');
                }
                const editorIframeEle = document.querySelector("iframe");
                const editorEle = editorIframeEle.contentWindow.document.querySelector(".news-editor-pc");
                if (!editorEle) {
                  throw new Error('编辑器元素 .news-editor-pc 未找到');
                }
                editorEle.innerHTML = dataObj.video.video.content;
                editorEle.dispatchEvent(new Event("input", { bubbles: true }));
                console.log('[百家号发布] ✅ 内容填写完成');
              }, 3, 1000);
            } catch (e) {
              console.log('[百家号发布] ❌ 内容填写失败:', e.message);
            }
          }, 200);

          // ===========================
          // 🔴 全局错误监听器 - 在上传图片之前就开始监听
          // ===========================
          const capturedErrors = []; // 收集所有捕获的错误信息
          let errorObserver = null;

          // 启动错误监听
          const startErrorListener = () => {
            console.log('[百家号发布] 🔍 启动全局错误监听器...');

            errorObserver = new MutationObserver((mutations) => {
              for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                  if (node.nodeType === 1) {
                    const element = node;
                    const classList = element.classList ? Array.from(element.classList).join(' ') : '';

                    // 检测百家号的错误提示
                    if (classList.includes('cheetah-message') || classList.includes('message')) {
                      // 百家号错误提示结构：<span>图标</span><span>错误文本</span>
                      const errorSpan = element.querySelector('.cheetah-message-error span:last-child') ||
                                        element.querySelector('.cheetah-message-custom-content span:last-child');
                      if (errorSpan) {
                        const text = (errorSpan.textContent || '').trim();
                        if (text && !capturedErrors.includes(text)) {
                          capturedErrors.push(text);
                          console.log('[百家号发布] 📨 捕获到错误信息:', text);
                        }
                      }
                    }

                    // 递归检查子元素
                    const errorElements = element.querySelectorAll('.cheetah-message-error span:last-child, .cheetah-message-custom-content span:last-child');
                    for (const el of errorElements) {
                      const text = (el.textContent || '').trim();
                      if (text && !capturedErrors.includes(text)) {
                        capturedErrors.push(text);
                        console.log('[百家号发布] 📨 捕获到错误信息（子元素）:', text);
                      }
                    }
                  }
                }
              }
            });

            errorObserver.observe(document.body, {
              childList: true,
              subtree: true
            });

            console.log('[百家号发布] ✅ 全局错误监听器已启动');
          };

          // 停止错误监听
          const stopErrorListener = () => {
            if (errorObserver) {
              errorObserver.disconnect();
              errorObserver = null;
              console.log('[百家号发布] 🛑 全局错误监听器已停止');
            }
          };

          // 获取最新的错误信息
          const getLatestError = () => {
            // 优先返回最后一条非中间状态的错误
            const ignoredMessages = ['正在上传', '加载中', '处理中'];
            for (let i = capturedErrors.length - 1; i >= 0; i--) {
              const msg = capturedErrors[i];
              const isIgnored = ignoredMessages.some(ignored => msg.includes(ignored));
              if (!isIgnored) {
                return msg;
              }
            }
            return capturedErrors.length > 0 ? capturedErrors[capturedErrors.length - 1] : null;
          };

          // 立即启动错误监听
          startErrorListener();

          // 设置封面（使用主进程下载绕过跨域）
          await (async () => {
            try {
              const {blob, contentType} = await downloadFile(pathImage, 'image/png');
              var file = new File([blob], dataObj?.video?.formData?.title + ".png", {type: contentType || "image/png"});

              setTimeout(async () => {
                // 选中本地上传（点击"选择封面"按钮）
                setTimeout(async () => {
                  // 通过文字内容查找"选择封面"按钮
                  const findElementByText = (text, el = document, isIncludes = false) => {
                    const allElements = el.querySelectorAll('div, span');
                    for (const el of allElements) {
                      console.log("🚀 ~ findElementByText ~ el.textContent: ", el.textContent);
                      // 精确匹配文字内容
                      const check = isIncludes ? el.textContent.trim().includes(text) : el.textContent.trim() === text;
                      if (check && el.children.length === 0) {
                        console.log("🚀 ~ findElementByText ~ el: ", el);
                        // 返回可点击的父级容器
                        return el.closest('[class*="content"]') || el.parentElement || el;
                      }
                    }
                    return null;
                  };

                  // 等待封面选择区域出现
                  await waitForElement(".cheetah-spin-container, [class*='cover']");
                  await delay(500); // 等待渲染完成

                  // 查找并点击"选择封面"按钮
                  const coverBtn = findElementByText('选择封面');
                  console.log("🚀 ~  ~ coverBtn: ", coverBtn);
                  if (coverBtn) {
                    coverBtn.click();
                    console.log('[百家号发布] ✅ 已点击"选择封面"按钮');
                  } else {
                    //检查是否已经有图片
                    const coverWrapperEle = document.querySelector("[class*='-coverWrapper']");
                    const coverEle = document.querySelector("[class*='-coverWrapper'] img");
                    if(coverEle){
                      if(coverEle.getAttribute('src')){
                        const changeBtnEles = coverWrapperEle.querySelectorAll('button');
                        let changeBtnEle = null;
                        if(changeBtnEles.length){
                          for (const btn of changeBtnEles) {
                            if (btn.textContent.trim().includes('更换')) {
                              changeBtnEle = btn;
                            }
                          }
                        }
                        changeBtnEle && changeBtnEle.click();
                      }
                    }
                  }
                  await delay(1000); // 等待渲染完成

                  // 封面上传弹窗弹出后选中还有本地上传的tab
                  const uploadTabs = document.querySelectorAll('.cheetah-tabs-tab-btn');
                  console.log("🚀 ~  ~ uploadTabs: ", uploadTabs);
                  let uploadFromLocalTab = null;
                  if (uploadTabs.length) {
                    for (const tab of uploadTabs) {
                      if (tab.textContent.trim().includes('本地')) {
                        uploadFromLocalTab = tab;
                      }
                    }
                  }
                  await delay(1000); // 等待渲染完成
                  console.log("🚀 ~  ~ uploadFromLocalTab: ", uploadFromLocalTab);
                  if (uploadFromLocalTab) {
                    uploadFromLocalTab.click();
                  } else {
                    console.log('找不到本地上传tab');
                  }

                    setTimeout(async () => {
                      // 使用原生选择器获取元素
                      const hasInputEle = await waitForElement(".cheetah-upload input");
                      if (hasInputEle) {
                        const input = document.querySelector(".cheetah-upload input");
                        const dataTransfer = new DataTransfer();
                        // 创建 DataTransfer 对象模拟文件上传
                        dataTransfer.items.add(file);
                        input.files = dataTransfer.files;
                        const event = new Event("change", {bubbles: true});
                        input.dispatchEvent(event);

                        // 封装上传检测与重试逻辑
                        const tryUploadImage = async (retryCount = 0) => {
                          const maxRetries = 3;

                          // 🔴 自定义等待逻辑：同时检查图片元素和错误信息
                          const waitForImageOrError = async (timeout = 10000) => {
                            const startTime = Date.now();
                            const checkInterval = 300; // 每300ms检查一次

                            while (Date.now() - startTime < timeout) {
                              // 1. 先检查是否有错误信息（优先级更高）
                              const errorMsg = getLatestError();
                              if (errorMsg) {
                                return { type: 'error', message: errorMsg };
                              }

                              // 2. 再检查图片元素是否出现
                              const imageEle = document.querySelector("[class*='-imglist'] [class*='-selectedItem']");
                              console.log("🚀 ~ waitForImageOrError ~ imageEle: ", imageEle);
                              if (imageEle) {
                                const imgEle = imageEle.querySelector('img');
                                if(imgEle && imgEle.getAttribute('src')){
                                  // 🔑 检测到图片元素后，再等待 500ms 确认是否有错误
                                  // 因为 MutationObserver 是异步的，错误信息可能还在路上
                                  console.log('[百家号发布] 🔍 检测到图片元素，等待 500ms 确认是否有错误...');
                                  await delay(500);
                                  const confirmError = getLatestError();
                                  if (confirmError) {
                                    console.log('[百家号发布] ⚠️ 确认期间检测到错误:', confirmError);
                                    return { type: 'error', message: confirmError };
                                  }
                                  return { type: 'success', element: imageEle };
                                }

                                // 等待下一次检查
                                await delay(checkInterval);
                              }

                              // 等待下一次检查
                              await delay(checkInterval);
                            }

                            // 超时，再检查一次错误信息
                            const finalError = getLatestError();
                            if (finalError) {
                              return { type: 'error', message: finalError };
                            }

                            return { type: 'timeout' };
                          };

                          const result = await waitForImageOrError(10000);
                          const myWindowId = await window.browserAPI.getWindowId();

                          // 🔴 检测到错误信息，直接上报失败
                          if (result.type === 'error') {
                            console.log(`[百家号发布] [窗口${myWindowId}] ❌ 检测到错误信息，直接上报失败: ${result.message}`);
                            stopErrorListener();
                            const publishId = dataObj.video?.dyPlatform?.id;
                            if (publishId) {
                              await sendStatisticsError(publishId, result.message, '百家号发布');
                            }
                            await closeWindowWithMessage('发布失败，刷新数据', 1000);
                            return; // 不再继续
                          }

                          if (result.type === 'success') {
                            console.log('[百家号发布] ✅ 图片上传成功');

                            await delay(2000); // 等待渲染完成
                            const submitCoverBtns = document.querySelectorAll('.cheetah-btn-primary');
                            console.log("🚀 ~ tryUploadImage ~ submitCoverBtns: ", submitCoverBtns);
                            let submitCoverBtn = null;
                            let publishBtn = null;
                            // 点击确定按钮
                            if (submitCoverBtns.length) {
                              for (const btn of submitCoverBtns) {
                                if (btn.textContent.trim().includes('确定')) {
                                  submitCoverBtn = btn;
                                }else if(btn.textContent.trim().includes('发布')){
                                  publishBtn = btn;
                                }
                              }
                              console.log("🚀 ~ tryUploadImage ~ submitCoverBtn: ", submitCoverBtn);
                              console.log("🚀 ~ tryUploadImage ~ publishBtn: ", publishBtn);
                              // 使用模拟真实鼠标事件，确保点击生效
                              const clickEvent = new MouseEvent('click', {
                                view: window,
                                bubbles: true,
                                cancelable: true
                              });
                              submitCoverBtn.dispatchEvent(clickEvent);
                              console.log('[百家号发布] ✅ 已点击确定（模拟鼠标事件）');
                              // 等待编辑器关闭和图片保存
                              await delay(2000);
                            } else {
                              console.error('[百家号发布] ❌ 找不到提交图片按钮，上报失败');
                              stopErrorListener();
                              const publishId = dataObj.video?.dyPlatform?.id;
                              if (publishId) {
                                await sendStatisticsError(publishId, '找不到提交图片按钮', '百家号发布');
                              }
                              await closeWindowWithMessage('发布失败，刷新数据', 1000);
                              return;
                            }
                            await delay(2000);
                          //  点击发布按钮
                            if(publishBtn){
                              // 🔑 在点击发布前保存 publishId，让 publish-success.js 可以调用统计接口
                              const publishId = dataObj.video?.dyPlatform?.id;
                              if (publishId) {
                                try {
                                  localStorage.setItem(getPublishSuccessKey(), JSON.stringify({ publishId: publishId }));
                                  console.log('[百家号发布] 💾 已保存 publishId 到 localStorage:', publishId);
                                } catch (e) {
                                  console.error('[百家号发布] ❌ 保存 publishId 失败:', e);
                                }
                              } else {
                                console.log('[百家号发布] ℹ️ 没有 publishId，跳过统计接口');
                              }

                              const clickEvent = new MouseEvent('click', {
                                view: window,
                                bubbles: true,
                                cancelable: true
                              });
                              publishBtn.dispatchEvent(clickEvent);
                              console.log('[百家号发布] ✅ 已点击发布（模拟鼠标事件）');

                              // 🔴 点击发布后，等待并检测是否有错误信息
                              console.log('[百家号发布] ⏳ 等待 5 秒检测发布结果...');
                              await delay(5000);

                              // 检查是否有错误信息
                              const publishErrorMsg = getLatestError();
                              if (publishErrorMsg) {
                                console.log('[百家号发布] ❌ 检测到发布错误:', publishErrorMsg);
                                stopErrorListener();
                                const publishId = dataObj.video?.dyPlatform?.id;
                                if (publishId) {
                                  console.log('[百家号发布] 📤 调用失败接口...');
                                  await sendStatisticsError(publishId, publishErrorMsg, '百家号发布');
                                }
                                await closeWindowWithMessage('发布失败，刷新数据', 1000);
                                return;
                              } else {
                                console.log('[百家号发布] ✅ 未检测到错误，等待页面跳转（由 publish-success.js 处理）');
                                stopErrorListener();
                              }
                            }else{
                              console.error('[百家号发布] ❌ 找不到提交图片按钮，上报失败');
                              stopErrorListener();
                              const publishId = dataObj.video?.dyPlatform?.id;
                              if (publishId) {
                                await sendStatisticsError(publishId, '发布按钮不可用', '百家号发布');
                              }
                              await closeWindowWithMessage('发布失败，刷新数据', 1000);
                              return;
                            }
                          } else {
                            // 图片上传失败（timeout），检查是否有错误信息
                            const myWindowId = await window.browserAPI.getWindowId();
                            console.log(`[百家号发布] [窗口${myWindowId}] ❌ 图片上传失败，重试次数: ${retryCount}/${maxRetries}`);

                            // 优先使用全局错误监听器捕获的错误
                            const errorMessage = getLatestError();
                            console.log(`[百家号发布] [窗口${myWindowId}] 📋 当前捕获的所有错误:`, capturedErrors);
                            console.log(`[百家号发布] [窗口${myWindowId}] 📨 最新错误信息:`, errorMessage);

                            // 🔴 有错误信息就直接走失败接口，不再重试
                            if (errorMessage) {
                              console.log(`[百家号发布] [窗口${myWindowId}] ❌ 检测到错误信息，直接上报失败，不再重试`);
                              stopErrorListener(); // 停止监听
                              const publishId = dataObj.video?.dyPlatform?.id;
                              console.log(`[百家号发布] [窗口${myWindowId}] 📋 publishId:`, publishId);
                              console.log(`[百家号发布] [窗口${myWindowId}] 📋 dataObj:`, dataObj);
                              if (publishId) {
                                console.log(`[百家号发布] [窗口${myWindowId}] 📤 调用 sendStatisticsError...`);
                                await sendStatisticsError(publishId, errorMessage, '百家号发布');
                                console.log(`[百家号发布] [窗口${myWindowId}] ✅ sendStatisticsError 完成`);
                              } else {
                                console.error(`[百家号发布] [窗口${myWindowId}] ❌ publishId 为空，无法调用失败接口！`);
                              }
                              await closeWindowWithMessage('发布失败，刷新数据', 1000);
                              return; // 不再继续
                            }

                            // 没有错误信息才重试
                            if (retryCount < maxRetries) {
                              console.log(`[百家号发布] 🔄 ${2}秒后重新上传图片...`);
                              await delay(2000);

                              // 重新触发文件上传
                              const input = document.querySelector(".cheetah-upload input");
                              if (input) {
                                input.files = dataTransfer.files;
                                const event = new Event("change", {bubbles: true});
                                input.dispatchEvent(event);
                                console.log('[百家号发布] 🔄 已重新触发上传');

                                // 递归重试
                                await delay(2000);
                                await tryUploadImage(retryCount + 1);
                              } else {
                                console.error('[百家号发布] ❌ 无法找到上传输入框，无法重试');
                                stopErrorListener();
                                const publishId = dataObj.video?.dyPlatform?.id;
                                if (publishId) {
                                  await sendStatisticsError(publishId, '图片上传失败，无法找到上传输入框', '百家号发布');
                                }
                                await closeWindowWithMessage('图片上传失败，刷新数据', 1000);
                              }
                            } else {
                              // 超过最大重试次数
                              console.error('[百家号发布] ❌ 图片上传重试次数已用尽');
                              stopErrorListener();
                              const publishId = dataObj.video?.dyPlatform?.id;
                              if (publishId) {
                                await sendStatisticsError(publishId, '图片上传失败，重试次数已用尽', '百家号发布');
                              }
                              await closeWindowWithMessage('图片上传失败，刷新数据', 1000);
                            }
                          }
                        };

                        // 启动上传检测（延迟2秒等待上传开始）
                        setTimeout(async () => {
                          await tryUploadImage(0);
                        }, 2000);
                      }
                    }, 1000);
                }, 2000);
              }, 1000);
            } catch (error) {
              console.log('[百家号发布] ❌ 封面下载失败:', error);
              stopErrorListener();
              const publishId = dataObj?.video?.dyPlatform?.id;
              if (publishId) {
                await sendStatisticsError(publishId, error.message || '封面下载失败', '百家号发布');
              }
              await closeWindowWithMessage('封面下载失败，刷新数据', 1000);
              return;
            }
          })();
        }

        fillFormRunning = false;
        // alert('Automation process completed');
      }, 10000);

    } catch (error) {
      // 捕获填写表单过程中的任何错误（仅捕获 setTimeout 调度前的同步错误）
      console.error('[百家号发布] fillFormData 错误:', error);
      // 发送错误上报
      const publishId = dataObj?.video?.dyPlatform?.id;
      if (publishId) {
        await sendStatisticsError(publishId, error.message || '填写表单失败', '百家号发布');
      }
      // 同步错误时重置标记
      fillFormRunning = false;
      // 填写表单失败也要关闭窗口，不阻塞下一个任务
      await closeWindowWithMessage('填写表单失败，刷新数据', 1000);
    }
    // 注意：不在 finally 中重置 fillFormRunning
    // 因为 setTimeout 是异步的，finally 会立即执行
    // fillFormRunning 的重置在 setTimeout 回调内部完成（line 974）
  }
})(); // IIFE 结束
