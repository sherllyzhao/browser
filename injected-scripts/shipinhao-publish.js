let introFilled = false; // 标记 intro 是否已填写
let fillFormRunning = false; // 标记 fillFormData 是否正在执行
let publishRunning = false; // 标记发布是否正在执行，防止重复点击

// 防重复标志：确保数据只处理一次
let isProcessing = false;
let hasProcessed = false;

/**
 * 视频号创作者平台发布脚本
 * 用于处理发布流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
  'use strict';

  // ===========================
  // 防止脚本重复注入
  // ===========================
  if (window.__SHIPINHAO_SCRIPT_LOADED__) {
    console.log('[视频号发布] ⚠️ 脚本已经加载过，跳过重复注入');
    return;
  }

  // ===========================
  // 页面状态检查 - 防止异常渲染
  // ===========================
  if (typeof window.checkPageStateAndReload === 'function') {
    if (!window.checkPageStateAndReload('视频号发布')) {
      return;
    }
  }

  window.__SHIPINHAO_SCRIPT_LOADED__ = true;

  console.log('═══════════════════════════════════════');
  console.log('✅ 视频号发布脚本已注入');
  console.log('📍 当前 URL:', window.location.href);
  console.log('🕐 注入时间:', new Date().toLocaleString());
  console.log('═══════════════════════════════════════');

  // 检查 common.js 是否已加载
  if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
    console.error('[视频号发布] ❌ common.js 未加载！脚本可能无法正常工作');
  } else {
    console.log('[视频号发布] ✅ common.js 已加载，工具函数可用');
  }

  // ===========================
  // 1. 从 URL 获取发布数据
  // ===========================

  const urlParams = new URLSearchParams(window.location.search);
  const companyId = await window.browserAPI.getGlobalData('company_id');
  const transferId = urlParams.get('transfer_id');

  // 获取当前窗口 ID（用于窗口专属的 localStorage key，避免多窗口冲突）
  let currentWindowId = null;
  try {
    currentWindowId = await window.browserAPI.getWindowId();
    console.log('[视频号发布] 当前窗口 ID:', currentWindowId);
  } catch (e) {
    console.error('[视频号发布] ❌ 获取窗口 ID 失败:', e);
  }

  // 获取窗口专属的 localStorage key
  const getPublishDataKey = () => `SHIPINHAO_PUBLISH_DATA_${currentWindowId || 'default'}`;
  const getPublishUrlKey = () => `SHIPINHAO_PUBLISH_URL_${currentWindowId || 'default'}`;

  console.log('[视频号发布] URL 参数:', {
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

  window.__SHIPINHAO_AUTH__ = {
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
  console.log('[视频号发布] 注册消息监听器...');

  if (!window.browserAPI) {
    console.error('[视频号发布] ❌ browserAPI 不可用！');
  } else {
    console.log('[视频号发布] ✅ browserAPI 可用');

    if (!window.browserAPI.onMessageFromHome) {
      console.error('[视频号发布] ❌ browserAPI.onMessageFromHome 不可用！');
    } else {
      console.log('[视频号发布] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

      window.browserAPI.onMessageFromHome(async (message) => {
        try {
          console.log('═══════════════════════════════════════');
          console.log('[视频号发布] 🎉 收到来自父窗口的消息!');
          console.log('[视频号发布] 消息类型:', typeof message);
          console.log('[视频号发布] 消息内容:', message);
          console.log('[视频号发布] 消息.type:', message?.type);
          console.log('[视频号发布] 消息.data:', message?.data);
          console.log('═══════════════════════════════════════');

          // 接收完整的发布数据（直接传递，不使用 IndexedDB）
          if (message.type === 'publish-data') {
            console.log('[视频号发布] ✅ 收到发布数据:', message.data);

            // 🔑 检查 windowId 是否匹配（如果消息带有 windowId）
            if (message.windowId) {
              const myWindowId = await window.browserAPI.getWindowId();
              console.log('[视频号发布] 我的窗口 ID:', myWindowId, '消息目标窗口 ID:', message.windowId);
              if (myWindowId !== message.windowId) {
                console.log('[视频号发布] ⏭️ 消息不是发给我的，跳过');
                return;
              }
              console.log('[视频号发布] ✅ windowId 匹配，处理消息');
            }

            // 防重复检查
            if (isProcessing) {
              console.warn('[视频号发布] ⚠️ 正在处理中，忽略重复消息');
              return;
            }
            if (hasProcessed) {
              console.warn('[视频号发布] ⚠️ 已经处理过，忽略重复消息');
              return;
            }

            // 标记为正在处理
            isProcessing = true;

            // 更新全局变量
            if (message.data) {
              // 兼容处理：message.data 可能是字符串或对象
              let messageData;
              try {
                messageData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
              } catch (parseError) {
                console.error('[视频号发布] ❌ 解析消息数据失败:', parseError);
                console.error('[视频号发布] 原始数据:', message.data);
                isProcessing = false;
                return;
              }
              console.log("🚀 ~  ~ messageData: ", messageData);
              window.__AUTH_DATA__ = {
                ...window.__AUTH_DATA__,
                message: messageData,
                receivedAt: Date.now()
              };
              console.log('[视频号发布] ✅ 发布数据已更新:', window.__AUTH_DATA__);

              // 💾 保存数据到 localStorage（用于授权跳转后恢复）
              try {
                // 确保存储的是 JSON 字符串，避免对象直接存储变成 "[object Object]"
                const dataToStore = typeof messageData === 'string' ? messageData : JSON.stringify(messageData);
                localStorage.setItem(getPublishDataKey(), dataToStore);
                console.log('[视频号发布] 💾 数据已保存到 localStorage, key:', getPublishDataKey());
              } catch (e) {
                console.error('[视频号发布] ❌ 保存数据失败:', e);
              }

              // 🔖 保存当前发布页URL（用于授权跳转后返回）
              try {
                localStorage.setItem(getPublishUrlKey(), window.location.href);
                console.log('[视频号发布] 🔖 已保存发布页URL:', window.location.href, 'key:', getPublishUrlKey());
              } catch (e) {
                console.error('[视频号发布] ❌ 保存发布页URL失败:', e);
              }

              // 等待wujie-app元素
              const wujieApp = await waitForElement("wujie-app", 15000);
              if (wujieApp) {
                // 检测视频是否已经上传完成
                let videoAlreadyUploaded = false;
                try {
                  const fullScreenVideo = wujieApp.shadowRoot?.querySelector('#fullScreenVideo');
                  if (fullScreenVideo && fullScreenVideo.src) {
                    videoAlreadyUploaded = true;
                  }
                  // 如果视频已上传，跳过上传流程
                  if (!videoAlreadyUploaded) {
                    // 方式1: 先尝试点击上传按钮（在Shadow DOM中）
                    try {
                      if (wujieApp && wujieApp.shadowRoot) {
                        // 在Shadow DOM中查找上传按钮
                        const uploadButtonSelectors = [
                          '.upload-wrapper button',
                          '.upload-btn',
                          'button.upload',
                          '.video-upload-btn',
                          '[class*="upload"] button',
                          'button[class*="upload"]'
                        ];

                        let uploadButtonClicked = false;
                        for (const selector of uploadButtonSelectors) {
                          try {
                            const uploadButton = wujieApp.shadowRoot.querySelector(selector);
                            if (uploadButton) {
                              //alert(`找到上传按钮: ${selector}`);
                              uploadButton.click();
                              uploadButtonClicked = true;
                              await new Promise(resolve => setTimeout(resolve, 1000));
                              break;
                            }
                          } catch (error) {
                            // 继续尝试下一个选择器
                          }
                        }

                        if (!uploadButtonClicked) {
                          //alert('未在Shadow DOM中找到上传按钮，直接查找input元素');
                        }
                      }
                    } catch (error) {
                      //alert('点击上传按钮失败: ' + error.message);
                    }

                    // 方式2: 查找并设置input元素
                    let uploadInput = null;
                    let retryCount = 0;
                    const maxRetries = 20; // 最大重试20次

                    // alert(`Starting upload input search in Shadow DOM. Will retry up to ${maxRetries} times.`);

                    while (!uploadInput && retryCount < maxRetries) {
                      const currentAttempt = retryCount + 1;
                      // alert(`=== ATTEMPT ${currentAttempt}/${maxRetries} ===
                      // Searching for upload input in Shadow DOM...`);

                      try {
                        // 复用外层的 wujieApp 变量
                        if (!wujieApp.shadowRoot) {
                          // alert('wujie-app has no shadow root, trying to access iframe directly');
                          // 如果没有Shadow DOM，尝试直接查找iframe
                          uploadInput = await waitForElement('input[type="file"]', 3000);
                        } else {
                          // 深入Shadow DOM查找
                          uploadInput = await deepShadowSearch(wujieApp, 'input[type="file"]', 3);
                        }

                        if (uploadInput) {
                          break; // 找到元素后退出循环
                        }
                      } catch (error) {
                        // 超时错误是预期的，继续重试
                        // alert(`❌ ATTEMPT ${currentAttempt} FAILED
                        // Error: ${error.message}
                        // Will retry in 2 seconds...`);
                      }

                      // 只有在未找到元素时才增加重试计数和等待
                      if (!uploadInput) {
                        retryCount++;
                        if (retryCount < maxRetries) {
                          // alert(`🔄 RETRYING... (${retryCount}/${maxRetries})
                          // Waiting 2 seconds before next attempt`);
                          await new Promise(resolve => setTimeout(resolve, 2000)); // 重试前等待2秒
                        } else {
                          // alert(`❌ MAX RETRIES REACHED
                          // Failed to find upload input after ${maxRetries} attempts`);
                        }
                      }
                    }

                    if (!uploadInput) {
                      console.log('未找到上传input元素');
                    } else {
                      // 执行文件上传
                      await uploadVideo(messageData, wujieApp.shadowRoot);
                    }
                  }
                } catch (error) {
                  // 忽略检测错误，继续正常流程
                  console.log('[视频号发布] ❌ 检测视频是否已经上传完成失败:', error);
                }
              } else {
                // wujieApp 不存在，直接上传视频（不使用 Shadow DOM）
                await uploadVideo(messageData);
              }
              try {
                await retryOperation(async () => await fillFormData(messageData), 3, 2000);
              } catch (e) {
                console.log('[视频号发布] ❌ 填写表单数据失败:', e);
              }

              console.log('[视频号发布] 📤 准备发送数据到接口...');
              console.log('[视频号发布] ✅ 发布流程已启动，等待 publishApi 完成...');
              // 注意：不在这里关闭窗口，因为 publishApi 内部有异步的统计接口调用
              // 窗口会在 publishApi 完成后自动关闭
            }

            // 重置处理标志（无论成功或失败）
            isProcessing = false;
            console.log('[视频号发布] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
          }
        } catch (error) {
          console.error('[视频号发布] ❌ 消息处理出错，但不影响页面渲染:', error);
          isProcessing = false; // 重置标志
        }
      });

      console.log('[视频号发布] ✅ 消息监听器注册成功');
    }
  }

  // ===========================
  // 6. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
  // ===========================

  // 页面加载完成后向父窗口发送消息
  console.log('[视频号发布] 页面加载完成，发送 页面加载完成 消息');
  sendMessageToParent('页面加载完成');

  console.log('═══════════════════════════════════════');
  console.log('✅ 视频号发布脚本初始化完成');
  console.log('📝 全局方法: window.__SHIPINHAO_AUTH__');
  console.log('  - notifySuccess()  : 发送发布成功消息');
  console.log('  - sendMessage(msg) : 发送自定义消息');
  console.log('  - getAuthData()    : 获取发布数据');
  console.log('═══════════════════════════════════════');

  // ===========================
  // 7. 检查是否有保存的发布数据（授权跳转恢复）
  // ===========================
  setTimeout(async () => {
    try {
      const savedData = localStorage.getItem(getPublishDataKey());
      console.log('[视频号发布] 🔍 检查恢复数据, key:', getPublishDataKey(), ', 数据:', savedData ? '有' : '无');

      // 跳过恢复：如果已经在处理或已处理完成
      if (isProcessing || hasProcessed) {
        console.log('[视频号发布] ℹ️ 已在处理中或已完成，跳过恢复');
        return;
      }

      if (savedData) {
        // 验证数据格式：必须是有效的 JSON 且不是 "[object Object]"
        if (savedData === '[object Object]' || savedData.startsWith('[object ')) {
          console.warn('[视频号发布] ⚠️ 检测到无效的旧数据，清除并跳过恢复');
          localStorage.removeItem(getPublishDataKey());
          return;
        }

        console.log('[视频号发布] 🔄 检测到保存的发布数据，准备恢复...');
        const messageData = JSON.parse(savedData);

        // 额外验证：检查解析后的数据是否有必要字段
        if (!messageData || typeof messageData !== 'object') {
          console.warn('[视频号发布] ⚠️ 恢复的数据无效，清除并跳过');
          localStorage.removeItem(getPublishDataKey());
          return;
        }

        console.log('[视频号发布] 📦 恢复的数据:', messageData);

        // 标记为正在处理
        isProcessing = true;

        // 更新全局变量
        window.__AUTH_DATA__ = {
          ...window.__AUTH_DATA__,
          message: messageData,
          recoveredAt: Date.now()
        };

        // 执行上传流程（复制原来的上传逻辑）
        const wujieApp = await waitForElement("wujie-app", 15000);
        if (wujieApp) {
          let videoAlreadyUploaded = false;
          try {
            const fullScreenVideo = wujieApp.shadowRoot?.querySelector('#fullScreenVideo');
            if (fullScreenVideo && fullScreenVideo.src) {
              videoAlreadyUploaded = true;
            }
            if (!videoAlreadyUploaded) {
              await uploadVideo(messageData, wujieApp.shadowRoot);
            }
          } catch (error) {
            console.log('[视频号发布] ❌ 检测视频是否已经上传完成失败:', error);
          }
        } else {
          await uploadVideo(messageData);
        }

        try {
          await retryOperation(async () => await fillFormData(messageData), 3, 2000);
        } catch (e) {
          console.log('[视频号发布] ❌ 填写表单数据失败:', e);
        }

        console.log('[视频号发布] 📤 恢复数据后准备发送数据到接口...');
        console.log('[视频号发布] ✅ 发布流程已启动，等待 publishApi 完成...');

        // 重置处理标志
        isProcessing = false;
      } else {
        console.log('[视频号发布] ℹ️ 没有需要恢复的数据');
      }
    } catch (error) {
      console.error('[视频号发布] ❌ 恢复数据失败:', error);
      // 如果是 JSON 解析错误，清除无效数据
      if (error instanceof SyntaxError) {
        console.warn('[视频号发布] ⚠️ 数据格式错误，清除无效数据');
        try {
          localStorage.removeItem(getPublishDataKey());
        } catch (e) {
          // 忽略
        }
      }
      isProcessing = false;
    }
  }, 2000); // 延迟2秒，等待页面完全加载

})();

// ===========================
// 7. 发布视频到视频号
// ===========================
async function publishApi(dataObj) {
  // 防止重复执行
  if (publishRunning) {
    return;
  }

  const publishId = dataObj.video.dyPlatform.id;

  // 🔑 提前获取窗口ID和存储key，供整个函数使用
  let myWindowId = null;
  try {
    myWindowId = await window.browserAPI.getWindowId();
  } catch (e) {
    console.error('[视频号发布] ❌ 获取窗口ID失败:', e);
  }
  const storageKey = myWindowId ? `PUBLISH_SUCCESS_DATA_${myWindowId}` : 'PUBLISH_SUCCESS_DATA';
  const publishDataKey = myWindowId ? `SHIPINHAO_PUBLISH_DATA_${myWindowId}` : 'SHIPINHAO_PUBLISH_DATA_default';

  try {
    // 标记发布正在进行
    publishRunning = true;

    // ===========================
    // 检测视频是否上传完成
    // ===========================
    console.log('[视频号发布] 🎬 开始检测视频上传状态...');

    const videoReady = await retryOperation(async () => {
      // 在 Shadow DOM 中查找视频元素
      const video = await waitForShadowElement("wujie-app", "#fullScreenVideo", 5000);

      if (!video) {
        throw new Error('Video element #fullScreenVideo not found');
      }

      console.log('[视频号发布] 📹 视频状态 - src:', video.src ? '有' : '无', ', readyState:', video.readyState, ', duration:', video.duration);

      // 检查视频是否有 src
      if (!video.src) {
        throw new Error('Video has no src, still uploading');
      }

      // 检查视频是否可以播放 (readyState >= 2 表示有足够数据可以播放)
      if (video.readyState < 2) {
        throw new Error('Video not ready to play, readyState=' + video.readyState);
      }

      // 检查视频时长是否有效
      if (isNaN(video.duration) || video.duration <= 0) {
        throw new Error('Video duration invalid: ' + video.duration);
      }

      console.log('[视频号发布] ✅ 视频已上传完成，可以播放');
      return true;
    }, 30, 3000); // 最多重试30次，每次间隔3秒（共90秒超时）

    if (!videoReady) {
      throw new Error('视频上传未完成，无法发布');
    }

    console.log('[视频号发布] ✅ 视频检测通过，继续发布流程...');

    // 等待发布按钮可用
    const publishBtn = await retryOperation(async () => {
      const btn = await waitForShadowElement("wujie-app", ".form-btns .weui-desktop-popover__wrp:nth-last-of-type(1) .weui-desktop-btn", 5000);

      if (!btn) {
        throw new Error('Publish button not found');
      }

      if (btn.classList && btn.classList.contains("weui-desktop-btn_disabled")) {
        throw new Error('Publish button is disabled');
      }

      return btn;
    }, 10, 2000);

    // 等待按钮事件绑定完成
    await delay(800);

    // 🔑 视频号成功后会直接跳转页面，必须在点击前保存数据
    // 否则跳转后 publishApi 的后续代码不会执行
    try {
      localStorage.setItem(storageKey, JSON.stringify({ publishId: publishId }));
      console.log('[视频号发布] 💾 已提前保存 publishId 到 localStorage:', publishId, 'key:', storageKey);
    } catch (e) {
      console.error('[视频号发布] ❌ 保存 publishId 失败:', e);
    }

    // 🚨 开发环境检测：使用 browserAPI.isProduction 判断
    // 默认策略：无法确定环境时，执行点击（安全优先）
    let isDevEnvironment = false;

    if (window.browserAPI) {
      isDevEnvironment = window.browserAPI.isProduction === false;
      console.log('[视频号发布] 环境检测:', {
        hasBrowserAPI: true,
        isProduction: window.browserAPI.isProduction,
        isDevEnvironment: isDevEnvironment
      });
    } else {
      console.warn('[视频号发布] ⚠️ browserAPI 不可用，默认执行发布（生产模式）');
    }


    // 生产环境：必须点击发布按钮
    console.log('[视频号发布] ✅ 生产环境确认，准备点击发布按钮...');

    const clickResult = await clickWithRetry(publishBtn, 3, 500, true); // 启用消息捕获

    if (!clickResult.success) {
      console.log('[视频号发布] ❌ 点击发布按钮失败:', clickResult.message);
      // 清除提前保存的数据
      localStorage.removeItem('PUBLISH_SUCCESS_DATA');
      // 发送失败统计
      await sendStatisticsError(publishId, clickResult.message || '点击发布按钮失败', '视频号发布');
      publishRunning = false;
      throw new Error('发布按钮点击失败: ' + clickResult.message);
    }

    // 点击成功
    console.log('[视频号发布] ✅ 发布按钮已点击');
    console.log('[视频号发布] 📨 平台提示:', clickResult.message);

    // 开发环境弹窗显示平台提示信息
    if (window.browserAPI && window.browserAPI.isProduction === false) {
      alert(`视频号发布结果：\n\n${clickResult.message}`);
    }

    // 视频号：只要页面跳转就是成功，不需要检测提示内容
    // 点击后直接进入等待页面跳转的逻辑

    // 等待页面跳转到成功页，超时 30 秒
    console.log('[视频号发布] ⏳ 等待跳转到成功页（30秒超时）...');
    const currentUrl = window.location.href;
    const startTime = Date.now();
    const timeout = 30000; // 30秒
    // 🔑 用 clickResult.message 作为初始值，避免超时时丢失已捕获的提示
    let lastToastMessage = clickResult.message || '';

    while (Date.now() - startTime < timeout) {
      await delay(2000); // 每 2 秒检查一次

      // 检查 URL 是否变化（页面跳转 = 发布成功）
      if (window.location.href !== currentUrl) {
        console.log('[视频号发布] ✅ 检测到页面跳转，发布成功');
        // 清除发布数据
        localStorage.removeItem(publishDataKey);
        // 标记已完成
        hasProcessed = true;
        publishRunning = false;
        return; // 页面已跳转，由 publish-success.js 处理统计接口
      }

      // 检查 PUBLISH_SUCCESS_DATA 是否已被 publish-success.js 删除
      if (!localStorage.getItem(storageKey)) {
        console.log('[视频号发布] ✅ 数据已被成功页处理，跳过后续检测');
        hasProcessed = true;
        publishRunning = false;
        return;
      }

      // 检测是否出现提示，记录消息内容（用于超时后的错误信息）
      try {
        const toptipSpan = await waitForShadowElement("wujie-app", ".toptip-content span", 500);
        if (toptipSpan) {
          const text = (toptipSpan.textContent || '').trim();
          if (text) {
            lastToastMessage = text;
            console.log('[视频号发布] 📨 检测到提示:', text);
          }
        }
      } catch (e) {
        // 忽略检测错误
      }
    }

    // 超时未跳转 - 再次检查是否已被 publish-success.js 处理
    if (!localStorage.getItem(storageKey)) {
      console.log('[视频号发布] ✅ 超时但数据已被成功页处理，跳过错误统计');
      hasProcessed = true;
      publishRunning = false;
      return;
    }

    // 真正的超时失败
    console.log('[视频号发布] ❌ 等待超时（30秒），判定发布失败');
    localStorage.removeItem(storageKey);
    localStorage.removeItem(publishDataKey);
    hasProcessed = true;
    publishRunning = false;
    await sendStatisticsError(publishId, lastToastMessage || '发布超时，未跳转到成功页', '视频号发布');
    await closeWindowWithMessage('发布失败，刷新数据', 1000);

  } catch (error) {
    console.log('[视频号发布] publishApi 错误:', error);
    // 清除提前保存的数据
    localStorage.removeItem(storageKey);
    // 发送失败统计
    await sendStatisticsError(publishId, error.message || '发布过程出错', '视频号发布');
    publishRunning = false;
    // 即使出错也尝试关闭窗口
    await closeWindowWithMessage('发布失败，刷新数据', 1000);
  }
}

// 填写表单数据
async function fillFormData(dataObj) {
    console.log("🚀 ~ fillFormData ~ dataObj: ", dataObj);
  // 防止并发执行
  if (fillFormRunning) {
    // alert('⚠️ fillFormData already running, skipping');
    return;
  }

  fillFormRunning = true;

  try {
    const titleAndIntro = dataObj.video.video.sendlog;
    // alert(JSON.stringify(titleAndIntro));

    // 等待wujie-app
    const wujieApp = await waitForElement("wujie-app", 10000);

    // 填写简介 - 针对可编辑div的特殊处理
    try {
      // 首先检查是否已经填写过（通过全局标记）
      if (introFilled) {
        // alert('✅ Intro already filled (by flag), skipping');
        // 直接跳过，不再查找元素或进行任何操作
      } else {
        const introInput = await waitForShadowElement("wujie-app", ".input-editor", 5000);
        const targetIntro = titleAndIntro.intro || '';
        const targetContent = targetIntro.trim();

        // alert(`Filling intro: ${titleAndIntro.intro || ''}`);

        // 调试：检查元素类型
        // alert(`introInput type check:
        // - Element: ${introInput ? 'exists' : 'null'}
        // - nodeType: ${introInput?.nodeType}
        // - tagName: ${introInput?.tagName}
        // - dispatchEvent: ${typeof introInput?.dispatchEvent}
        // - innerHTML: ${typeof introInput?.innerHTML}`);

        // 确保是真实的DOM元素
        if (!introInput || typeof introInput.dispatchEvent !== 'function') {
          throw new Error('Invalid introInput element');
        }

        // 检查实际内容
        const currentContent = (introInput.textContent || introInput.innerText || '').trim();

        // 只有在标记未设置且内容不同时才填写
        if (currentContent !== targetContent) {
          // 立即标记为已填写（在任何操作之前，防止并发）
          introFilled = true;

          // 先触发focus事件
          if (typeof introInput.focus === 'function') {
            introInput.focus();
          } else {
            introInput.dispatchEvent(new Event('focus', { bubbles: true }));
          }

          // 延迟执行，让React状态稳定
          await new Promise(resolve => setTimeout(resolve, 300));

          // 清空现有内容，避免累积
          introInput.innerHTML = '';

          // 使用execCommand模拟真实用户输入（更可靠）
          if (titleAndIntro.intro) {
            let success = false;

            // 方法1: 尝试使用execCommand插入文本（最接近真实用户输入）
            try {
              // 设置选区到元素内部
              const selection = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(introInput);
              range.collapse(false); // 移动到末尾
              selection.removeAllRanges();
              selection.addRange(range);

              // 使用execCommand插入文本
              success = document.execCommand('insertText', false, titleAndIntro.intro);
            } catch (e) {
              // execCommand可能失败，继续尝试其他方法
            }

            // 方法2: 如果execCommand失败，使用innerHTML（参考xhs.js的做法）
            if (!success) {
              try {
                introInput.innerHTML = '<p>' + titleAndIntro.intro + '</p>';
              } catch (e) {
                // 如果innerHTML也失败，使用textContent作为最后手段
                introInput.textContent = titleAndIntro.intro;
              }
            }
          }

          // 等待内容设置完成
          await new Promise(resolve => setTimeout(resolve, 100));

          // 触发完整的事件序列（关键！）
          // beforeinput事件
          introInput.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: titleAndIntro.intro || ''
          }));

          // input事件（最重要）
          introInput.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: titleAndIntro.intro || ''
          }));

          // change事件
          introInput.dispatchEvent(new Event('change', { bubbles: true }));

          // 触发composition事件（某些编辑器需要）
          introInput.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
          introInput.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: titleAndIntro.intro || '' }));
          introInput.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: titleAndIntro.intro || '' }));

          // 再次触发input事件确保React捕获到变化
          await new Promise(resolve => setTimeout(resolve, 100));
          introInput.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: titleAndIntro.intro || ''
          }));

          // 延迟后触发blur事件
          await new Promise(resolve => setTimeout(resolve, 300));
          if (typeof introInput.blur === 'function') {
            introInput.blur();
          } else {
            introInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
          }

          // 最后再延迟确保所有事件都被处理
          await new Promise(resolve => setTimeout(resolve, 200));

          // alert('✅ introInput filled successfully');
        } else {
          // 内容已经正确，也标记为已填写
          introFilled = true;
          // alert('✅ Intro content already correct, marking as filled');
        }
      }
    } catch (error) {
      // alert('⚠️ introInput handling failed: ' + error.message);
    }

    // 填写标题 - 参考xhs.js的方法
    const titleInput = await waitForShadowElement("wujie-app", ".post-short-title-wrap input", 5000);
    // alert(`Filling title: ${titleAndIntro.title || ''}`);

    try {
      // 调试：检查元素类型
      // alert(`titleInput type check:
      // - Element: ${titleInput ? 'exists' : 'null'}
      // - nodeType: ${titleInput?.nodeType}
      // - tagName: ${titleInput?.tagName}
      // - type: ${titleInput?.type}
      // - dispatchEvent: ${typeof titleInput?.dispatchEvent}
      // - value: ${typeof titleInput?.value}`);

      // 确保是真实的DOM元素
      if (!titleInput || typeof titleInput.dispatchEvent !== 'function') {
        throw new Error('Invalid titleInput element');
      }

      // 先触发focus事件
      if (typeof titleInput.focus === 'function') {
        titleInput.focus();
      } else {
        titleInput.dispatchEvent(new Event('focus', { bubbles: true }));
      }

      // 延迟执行，让React状态稳定（关键！）
      await new Promise(resolve => setTimeout(resolve, 300));

      // 使用setNativeValue设置值
      setNativeValue(titleInput, titleAndIntro.title || '');

      // 额外触发input事件（xhs.js的做法）
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));

      // alert('✅ Title filled successfully');

    } catch (error) {
      // alert('❌ Title setting failed: ' + error.message);
    }

    // 设置发布时间
    const publishTime = dataObj.video.formData.send_set;
    if (+publishTime === 2) {
      try {
        // 定时发布
        const immediateRadio = await waitForShadowElement("wujie-app", ".post-time-wrap .weui-desktop-radio-group input[type='radio'][value='0']", 3000);
        const scheduleRadio = await waitForShadowElement("wujie-app", ".post-time-wrap .weui-desktop-radio-group input[type='radio'][value='1']", 3000);

        setNativeValue(immediateRadio, false);
        setNativeValue(scheduleRadio, true);

        // 设置日期时间
        await new Promise(resolve => setTimeout(resolve, 500));
        const dateInput = await waitForShadowElement("wujie-app", ".post-time-wrap .weui-desktop-picker__date input", 3000);

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
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 发布
    await publishApi(dataObj);

  } catch (error) {
    console.error('[视频号发布] fillFormData 错误:', error);
    // 发送错误上报
    const publishId = dataObj?.video?.dyPlatform?.id;
    if (publishId) {
      await sendStatisticsError(publishId, error.message || '填写表单失败', '视频号发布');
    }
    // 填写表单失败也要关闭窗口，不阻塞下一个任务
    await closeWindowWithMessage('填写表单失败，刷新数据', 1000);
  } finally {
    // 无论成功还是失败，都重置标记
    fillFormRunning = false;
  }
}

