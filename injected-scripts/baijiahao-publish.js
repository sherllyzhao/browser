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

  // ===========================
  // 🔴 使用公共错误监听器（来自 common.js）
  // ===========================
  let errorListener = null;

  // 初始化错误监听器
  const initErrorListener = () => {
    if (typeof createErrorListener === 'function' && ERROR_LISTENER_CONFIGS?.baijiahao) {
      errorListener = createErrorListener(ERROR_LISTENER_CONFIGS.baijiahao);
      console.log('[百家号发布] ✅ 使用公共错误监听器配置');
    } else {
      // 回退方案：使用本地配置
      errorListener = createErrorListener({
        logPrefix: '[百家号发布]',
        selectors: [
          { containerClass: 'cheetah-message-error', textSelector: 'span:last-child', recursiveSelector: '.cheetah-message.cheetah-message-error' },
          { containerClass: 'cheetah-message', textSelector: '.cheetah-message-custom-content span:last-child' }
        ]
      });
      console.log('[百家号发布] ⚠️ 使用本地错误监听器配置');
    }
  };

  // 兼容旧代码的函数别名
  const startErrorListener = () => {
    if (!errorListener) initErrorListener();
    errorListener.start();
  };
  const stopErrorListener = () => errorListener?.stop();
  const getLatestError = () => errorListener?.getLatestError() || null;

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
          // 使用公共方法解析消息数据
          const messageData = parseMessageData(message.data, '[百家号发布]');
          if (!messageData) return;

          // 使用公共方法检查 windowId 是否匹配
          const isMatch = await checkWindowIdMatch(message, '[百家号发布]');
          if (!isMatch) return;

          // 使用公共方法恢复会话数据
          const needReload = await restoreSessionAndReload(messageData, '[百家号发布]');
          if (needReload) return; // 已触发刷新，脚本会重新注入

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
  // 7. 检查是否是恢复 cookies 后的刷新（立即执行）
  // ===========================
  await (async () => {
    // 如果已经在处理或已处理完成，跳过
    if (isProcessing || hasProcessed) {
      console.log('[百家号发布] ⏭️ 已在处理中或已完成，跳过全局存储读取');
      return;
    }

    try {
      // 获取当前窗口 ID
      const windowId = await window.browserAPI.getWindowId();
      console.log('[百家号发布] 检查全局存储，窗口 ID:', windowId);

      if (!windowId) {
        console.log('[百家号发布] ❌ 无法获取窗口 ID');
        return;
      }

      // 检查是否有恢复 cookies 后保存的发布数据
      const publishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
      console.log('[百家号发布] 📦 从全局存储读取 publish_data_window_' + windowId + ':', publishData ? '有数据' : '无数据');

      if (publishData && !isProcessing && !hasProcessed) {
        console.log('[百家号发布] ✅ 检测到恢复 cookies 后的数据，开始处理...');

        // 清除已使用的数据，避免重复处理
        await window.browserAPI.removeGlobalData(`publish_data_window_${windowId}`);
        console.log('[百家号发布] 🗑️ 已清除 publish_data_window_' + windowId);

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

        try {
          await retryOperation(async () => await fillFormData(publishData), 3, 2000);
        } catch (e) {
          console.log('[百家号发布] ❌ 填写表单数据失败:', e);
        }

        console.log('[百家号发布] 📤 准备发送数据到接口...');
        console.log('[百家号发布] ✅ 发布流程已启动，等待 publishApi 完成...');

        isProcessing = false;
      }
    } catch (error) {
      console.error('[百家号发布] ❌ 从全局存储读取数据失败:', error);
    }
  })();

  // ===========================
  // 7. 从全局存储读取发布数据（备用方案，不依赖消息）
  // ===========================

  // ===========================
  // 8. 检查是否有保存的发布数据（授权跳转恢复）
  // ===========================

  // ===========================
  // 9. 发布视频到百家号（移到 IIFE 内部以访问变量）
  // ===========================

  // 填写表单数据
  async function fillFormData(dataObj) {
      console.log("🚀 ~ fillFormData ~ dataObj: ", dataObj);
    console.log("🚀 ~ fillFormData ~ fillFormRunning: ", fillFormRunning);
    // 防止重复执行
    if (fillFormRunning) {
      return;
    }
    fillFormRunning = true;

    try {
      const pathImage = dataObj?.video?.video?.cover;
      console.log("🚀 ~ fillFormData ~ pathImage: ", pathImage);
      if (!pathImage) {
        // alert('No cover image found');
        fillFormRunning = false;
        return;
      }

      setTimeout(async () => {
        await retryOperation (async () => {
          const tourBtn = await waitForElement('.cheetah-tour-close', 5000, 1000);
          if (tourBtn) {
            tourBtn.click()
          }
        }, 5, 1000)
        // 标题（带重试和验证）
        await retryOperation(async () => {
          const titleEle = await waitForElement(".client_components_titleInput .input-container .input-box textarea", 5000);

          // 先触发focus事件
          if (typeof titleEle.focus === 'function') {
            titleEle.focus();
          } else {
            titleEle.dispatchEvent(new Event('focus', { bubbles: true }));
          }

          // 延迟执行，让React状态稳定
          await new Promise(resolve => setTimeout(resolve, 300));

          const targetTitle = dataObj.video.video.title || '';
          setNativeValue(titleEle, targetTitle);

          // 额外触发input事件
          titleEle.dispatchEvent(new Event('input', { bubbles: true }));

          // 等待 React 更新
          await new Promise(resolve => setTimeout(resolve, 200));

          // 🔑 验证是否成功设置
          const currentValue = (titleEle.value || '').trim();
          const expectedValue = targetTitle.trim();
          if (currentValue !== expectedValue) {
            throw new Error(`标题设置失败: 期望"${expectedValue}", 实际"${currentValue}"`);
          }

          console.log('[百家号发布] ✅ 标题设置成功:', currentValue);
        }, 5, 1000);

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

          //设置简介（带重试）
          try {
            await retryOperation(async () => {
              // 首先检查是否已经填写过（通过全局标记）
              if (introFilled) {
                console.log('[百家号发布] 简介已填写过，跳过');
                return; // 跳过重试
              }

              console.log('[百家号发布] 开始填写简介...');
              const introEle = await waitForElement(".news_abstract_form_item textarea", 5000);
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

                // 先触发focus事件
                if (typeof introEle.focus === 'function') {
                  introEle.focus();
                } else {
                  introEle.dispatchEvent(new Event('focus', { bubbles: true }));
                }

                // 延迟执行，让React状态稳定
                await new Promise(resolve => setTimeout(resolve, 300));

                setNativeValue(introEle, dataObj.video.video.intro);

                // 额外触发input事件
                introEle.dispatchEvent(new Event('input', { bubbles: true }));

                // 等待 React 更新
                await new Promise(resolve => setTimeout(resolve, 200));

                // 🔑 验证是否成功设置
                const updatedValue = (introEle.value || '').trim();
                if (updatedValue !== targetContent) {
                  throw new Error(`简介设置失败: 期望"${targetContent.substring(0, 50)}...", 实际"${updatedValue.substring(0, 50)}..."`);
                }

                console.log('[百家号发布] ✅ 简介填写完成');
              } else if (!introEle) {
                throw new Error('简介输入框元素为空');
              } else {
                // 内容已经正确，也标记为已填写
                introFilled = true;
                console.log('[百家号发布] 简介内容已正确，无需修改');
              }
            }, 5, 1000);
          } catch (error) {
            console.log('[百家号发布] ❌ 简介填写失败:', error.message);
          }

          // 内容（带重试）
          setTimeout(async () => {
            try {
              await retryOperation(async () => {
                const hasIframeEle = await waitForElement("iframe", 10000); // 🔑 增加等待时间
                if (!hasIframeEle) {
                  throw new Error('iframe 未找到');
                }
                const editorIframeEle = document.querySelector("iframe");

                // 🔑 等待 iframe 完全加载
                await new Promise(resolve => setTimeout(resolve, 500));

                const iframeWin = editorIframeEle.contentWindow;
                if (!iframeWin) {
                  throw new Error('iframe contentWindow 不可访问');
                }

                const iframeDoc = iframeWin.document;
                if (!iframeDoc || iframeDoc.readyState !== 'complete') {
                  throw new Error('iframe 文档未完全加载，状态: ' + (iframeDoc?.readyState || 'null'));
                }

                // 🔑 额外等待编辑器初始化
                await new Promise(resolve => setTimeout(resolve, 300));

                const editorEle = iframeDoc.querySelector(".news-editor-pc");
                if (!editorEle) {
                  throw new Error('编辑器元素 .news-editor-pc 未找到');
                }

                let htmlContent = dataObj.video.video.content;

                // 解析 HTML 中的图片，通过百家号 dumpproxy 接口上传
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = htmlContent;
                const images = tempDiv.querySelectorAll('img');

                console.log('[百家号发布] 🖼️ 发现', images.length, '张图片需要处理');

                for (const img of images) {
                  const originalSrc = img.src;
                  if (!originalSrc || originalSrc.startsWith('data:')) {
                    continue; // 跳过空 src 或 base64 图片
                  }

                  // 如果已经是百家号的图片，跳过
                  if (originalSrc.includes('baijiahao.baidu.com') || originalSrc.includes('mmbiz.qpic.cn')) {
                    console.log('[百家号发布] ⏭️ 跳过已有图片:', originalSrc.substring(0, 50));
                    continue;
                  }

                  try {
                    console.log('[百家号发布] 📤 上传图片:', originalSrc.substring(0, 200));

                    // 调用百家号图片代理接口
                    const response = await fetch('https://baijiahao.baidu.com/pcui/picture/dumpproxy', {
                      method: 'POST',
                      body: new URLSearchParams({
                        usage: 'content',
                        article_type: 'news',
                        is_waterlog: '1',
                        url: originalSrc
                      }),
                      credentials: 'include' // 带上 cookies
                    });

                    const result = await response.json();
                    console.log('[百家号发布] 📥 上传结果:', result);

                    if (result.errno === 0 && result.data && result.data.bos_url) {
                      // 替换为百家号服务器的图片地址
                      img.src = result.data.bos_url;
                      console.log('[百家号发布] ✅ 图片替换成功:', result.data.src.substring(0, 50));
                    } else {
                      console.log('[百家号发布] ⚠️ 图片上传失败，保留原地址');
                    }
                  } catch (e) {
                    console.error('[百家号发布] ❌ 图片上传异常:', e.message);
                  }
                }

                // 获取处理后的 HTML
                htmlContent = tempDiv.innerHTML;

                // 使用 innerHTML 赋值
                editorEle.innerHTML = htmlContent;

                // 触发 input 事件
                editorEle.dispatchEvent(new iframeWin.Event("input", { bubbles: true }));

                console.log('[百家号发布] ✅ 内容填写完成');
              }, 3, 1000);
            } catch (e) {
              console.log('[百家号发布] ❌ 内容填写失败:', e.message);
            }
          }, 200);

          // 🔴 启动全局错误监听器（已在 IIFE 顶层定义）
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
                        return el.parentElement || el;
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
                            const publishTime = dataObj.video.formData.send_set;
                            if (+publishTime === 2) {
                              const outlineFootBtns = document.querySelectorAll('.op-list-wrap-news .cheetah-btn-outlined');
                              let scheduledReleasesBtn = null;

                              if (outlineFootBtns.length) {
                                for (const btn of outlineFootBtns) {
                                  if (btn.textContent.trim().includes('定时发布')) {
                                    scheduledReleasesBtn = btn;
                                  }
                                }
                                console.log("🚀 ~ tryUploadImage ~ scheduledReleasesBtn: ", scheduledReleasesBtn);
                                if (scheduledReleasesBtn) {
                                  const clickEvent = new MouseEvent('click', {
                                    view: window,
                                    bubbles: true,
                                    cancelable: true
                                  });
                                  scheduledReleasesBtn.dispatchEvent(clickEvent);
                                  console.log('[百家号发布] ✅ 已点击定时发布（模拟鼠标事件）');
                                  await delay(2000);
                                  // 检测有没有动态发布
                                  await checkPublishResult(dataObj, true);
                                  await delay(2000);
                                //  检测有没有定时发布弹窗
                                  const scheduledReleasesModal = document.querySelector('.cheetah-modal-content');
                                  if (scheduledReleasesModal) {
                                    console.log('[百家号发布] ✅ 检测到定时发布弹窗');

                                    // 解析定时发布时间
                                    const sendTime = dataObj.video?.formData?.send_time;
                                    if (sendTime) {
                                      console.log('[百家号发布] ⏰ 开始选择定时发布时间:', sendTime);

                                      const timeConfig = parseSendTime(sendTime);
                                      if (!timeConfig) {
                                        console.error('[百家号发布] ❌ 解析定时时间失败');
                                        stopErrorListener();
                                        await closeWindowWithMessage('定时时间解析失败', 1000);
                                        return;
                                      }

                                      // 调用选择时间函数
                                      const timeSelectSuccess = await selectScheduledTime(
                                        timeConfig.dateIndex,
                                        timeConfig.hour,
                                        timeConfig.minute
                                      );

                                      if (!timeSelectSuccess) {
                                        console.error('[百家号发布] ❌ 时间选择失败');
                                        stopErrorListener();
                                        await closeWindowWithMessage('定时时间选择失败', 1000);
                                        return;
                                      }

                                      // 点击确定发布按钮
                                      await delay(500);
                                      const confirmBtn = Array.from(document.querySelectorAll('.cheetah-btn-primary'))
                                        .find(btn => btn.textContent.trim() === '定时发布');

                                      if (confirmBtn) {
                                        console.log('[百家号发布] ✅ 点击确定定时发布');

                                        // 🔑 在点击定时发布前保存 publishId，让 publish-success.js 可以调用统计接口
                                        const publishId = dataObj.video?.dyPlatform?.id;
                                        if (publishId) {
                                          try {
                                            localStorage.setItem(getPublishSuccessKey(), JSON.stringify({ publishId: publishId }));
                                            console.log('[百家号发布] 💾 已保存 publishId 到 localStorage:', publishId);

                                            // 🔑 同时保存到 globalData（更可靠，不受域名隔离限制）
                                            if (window.browserAPI && window.browserAPI.setGlobalData) {
                                              await window.browserAPI.setGlobalData(`PUBLISH_SUCCESS_DATA_${currentWindowId}`, {publishId: publishId});
                                              console.log('[百家号发布] 💾 已保存 publishId 到 globalData');
                                            }
                                          } catch (e) {
                                            console.error('[百家号发布] ❌ 保存 publishId 失败:', e);
                                          }
                                        }

                                        confirmBtn.click();

                                        // 定时发布点击后会立即跳转到成功页，由 publish-success.js 处理
                                        console.log('[百家号发布] ✅ 等待页面跳转到成功页（由 publish-success.js 处理）');
                                        stopErrorListener();
                                      } else {
                                        console.error('[百家号发布] ❌ 未找到确定按钮');
                                      }
                                    } else {
                                      console.warn('[百家号发布] ⚠️ 未传入定时发布时间');
                                    }
                                  }
                                }
                              }
                            }else{
                              //  点击发布按钮
                              if(publishBtn){
                                // 🔑 检查发布按钮是否 disabled
                                if (publishBtn.disabled || publishBtn.classList.contains('cheetah-btn-disabled') || publishBtn.getAttribute('disabled') !== null) {
                                  console.error('[百家号发布] ❌ 发布按钮不可用(disabled)');
                                  stopErrorListener();
                                  const publishIdForError = dataObj.video?.dyPlatform?.id;
                                  if (publishIdForError) {
                                    await sendStatisticsError(publishIdForError, '发布按钮不可用，可能不符合发布要求', '百家号发布');
                                  }
                                  await closeWindowWithMessage('发布失败，刷新数据', 1000);
                                  return;
                                }
                                // 🔑 在点击发布前保存 publishId，让 publish-success.js 可以调用统计接口
                                const publishId = dataObj.video?.dyPlatform?.id;
                                if (publishId) {
                                  try {
                                    localStorage.setItem(getPublishSuccessKey(), JSON.stringify({ publishId: publishId }));
                                    console.log('[百家号发布] 💾 已保存 publishId 到 localStorage:', publishId);

                                    // 🔑 同时保存到 globalData（更可靠，不受域名隔离限制）
                                    if (window.browserAPI && window.browserAPI.setGlobalData) {
                                      await window.browserAPI.setGlobalData(`PUBLISH_SUCCESS_DATA_${currentWindowId}`, {publishId: publishId});
                                      console.log('[百家号发布] 💾 已保存 publishId 到 globalData');
                                    }
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
                                await checkPublishResult(dataObj, true);
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

  /**
   * 检查发布结果（通用方法）
   * @param {object} dataObj - 发布数据对象
   * @param {boolean} handleExtraButtons - 是否处理额外的确认按钮（立即发布需要，定时发布不需要）
   * @returns {Promise<boolean>} 是否成功（无错误）
   */
  async function checkPublishResult(dataObj, handleExtraButtons = true) {
    console.log('[百家号发布] ⏳ 等待检测发布结果...');
    await delay(1000);

    if (handleExtraButtons) {
      try {
        const transferDynamic = document.querySelectorAll('.cheetah-btn-default');
        if (transferDynamic && transferDynamic.length) {
          for (const btn of transferDynamic) {
            if (btn.textContent.trim().includes('保持图文发布')) {
              btn.click();
            }
          }
        }
        const continueBtn = document.querySelectorAll('.cheetah-btn-primary');
        if (continueBtn && continueBtn.length) {
          for (const btn of continueBtn) {
            if (btn.textContent.trim().includes('确定')) {
              btn.click();
            }
          }
        }
      } catch (e) {
        console.log(e);
      }
    }

    await delay(5000);

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
      return false;
    } else {
      console.log('[百家号发布] ✅ 未检测到错误，等待页面跳转（由 publish-success.js 处理）');
      stopErrorListener();
      return true;
    }
  }
})(); // IIFE 结束

/**
 * 解析定时发布时间
 * @param {string} sendTimeStr - 时间字符串，格式："2026-01-21 00:00:00"
 * @returns {object} { dateIndex, hour, minute } 或 null
 */
function parseSendTime(sendTimeStr) {
    try {
        // 解析时间字符串
        const [dateStr, timeStr] = sendTimeStr.split(' ');
        const [year, month, day] = dateStr.split('-').map(Number);
        const [hour, minute] = timeStr.split(':').map(Number);

        // 计算相对于今天的天数差
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const sendDate = new Date(year, month - 1, day);
        sendDate.setHours(0, 0, 0, 0);

        const dayDiff = Math.floor((sendDate - today) / (1000 * 60 * 60 * 24));

        console.log('[百家号发布] 📅 解析定时时间:', {
            原始时间: sendTimeStr,
            日期: `${year}-${month}-${day}`,
            时间: `${hour}:${minute}`,
            相对天数: dayDiff
        });

        return {
            dateIndex: dayDiff,
            hour: hour,
            minute: minute
        };
    } catch (error) {
        console.error('[百家号发布] ❌ 解析定时时间失败:', error);
        return null;
    }
}

/**
 * 选择虚拟列表中的选项
 * @param {HTMLElement} selectElement - select 组件的容器
 * @param {string|number} targetValue - 要选择的值（显示文本）
 * @param targetIndex - 要选择的索引（默认0）
 * @param {number} timeout - 超时时间（毫秒）
 */
async function selectFromVirtualList(selectElement, targetValue, targetIndex = 0, timeout = 10000) {
    try {
        console.log('[百家号发布] 🔍 准备选择:', targetValue);

        // 1. 找到触发器并点击打开下拉
        const selectTrigger = selectElement.querySelector('.cheetah-select-selector');
        console.log("🚀 ~ selectFromVirtualList ~ selectTrigger: ", selectTrigger);
        if (!selectTrigger) {
            console.error('[百家号发布] ❌ 找不到 select 触发器');
            return false;
        }

        console.log('[百家号发布] ✅ 找到触发器，点击打开下拉列表');
        selectTrigger.dispatchEvent(new Event('mousedown', { bubbles: true }));

        // 等待下拉出现 - 增加等待时间到 1000ms
        await new Promise(r => setTimeout(r, 1000));

        // 2. 查找虚拟列表容器（可能有多个位置）
        const startTime = Date.now();
        let virtualList = null;
        let options = [];

        while (Date.now() - startTime < timeout) {
            // 尝试多种选择器找虚拟列表
            virtualList = document.querySelectorAll('.rc-virtual-list-holder') ||
                         document.querySelectorAll('.cheetah-select-dropdown .rc-virtual-list') ||
                         document.querySelectorAll('[role="listbox"]') ||
                         document.querySelectorAll('.cheetah-select-dropdown');

            if (virtualList && virtualList.length > 0) {
                console.log('[百家号发布] 📍 找到虚拟列表容器:', virtualList[targetIndex].className);

                // 查找所有可见的选项 - 尝试多种选择器
                let allOptions = Array.from(
                    virtualList[targetIndex].querySelectorAll('[role="option"], .cheetah-select-item-option, .rc-virtual-list-holder-inner [class*="option"]')
                );

                // 如果还是没找到，尝试所有 div
                if (allOptions.length === 0) {
                    allOptions = Array.from(virtualList[targetIndex].querySelectorAll('div')).filter(el => {
                        const text = el.textContent.trim();
                        // 过滤掉空的和太长的（可能是容器）
                        return text && text.length < 20 && el.children.length === 0;
                    });
                }

              // 滚动到最顶部
              virtualList[targetIndex].scrollTo(0, 0);
              await new Promise(r => setTimeout(r, 300));

                options = allOptions.filter(el => el.offsetParent !== null);

                if (options.length > 0) {
                    console.log('[百家号发布] ✅ 找到虚拟列表，有', options.length, '个选项');
                    break;
                } else {
                    console.log('[百家号发布] ⏳ 虚拟列表已打开但选项还未渲染，等待中...');
                }
            } else {
                console.log('[百家号发布] ⏳ 虚拟列表还未出现，等待中...');
            }

            await new Promise(r => setTimeout(r, 200));
        }

        if (options.length === 0) {
            console.error('[百家号发布] ❌ 未找到任何选项');
            return false;
        }

        // 3. 滚动搜索匹配项
        const targetStr = String(targetValue).trim();
        let foundOption = null;
        const seenTexts = new Set();
        const scrollStep = 100;
        let currentScroll = 0;

        while (true) {
            // 获取当前可见选项
            const currentOptions = Array.from(
                virtualList[targetIndex].querySelectorAll('[role="option"], .cheetah-select-item-option, .rc-virtual-list-holder-inner [class*="option"]')
            ).filter(el => el.offsetParent !== null);

            // 检查当前可见选项
            for (const option of currentOptions) {
                const optionText = option.textContent.trim();
                seenTexts.add(optionText);

                if (optionText === targetStr) {
                    foundOption = option;
                    console.log('[百家号发布] ✅ 找到匹配的选项:', optionText);
                    break;
                }
            }

            if (foundOption) break;

            // 检查是否到底
            const scrollHeight = virtualList[targetIndex].scrollHeight;
            const clientHeight = virtualList[targetIndex].clientHeight;
            currentScroll += scrollStep;

            if (currentScroll >= scrollHeight - clientHeight) {
                console.log('[百家号发布] 📍 已滚动到底部');
                break;
            }

            // 向下滚动
            virtualList[targetIndex].scrollTo(0, currentScroll);
            await new Promise(r => setTimeout(r, 200));
        }

        if (!foundOption) {
            console.error('[百家号发布] ❌ 未找到目标选项:', targetStr);
            console.log('[百家号发布] 📋 已扫描选项数:', seenTexts.size);
            return false;
        }

        // 4. 滚动到视图并点击
        foundOption.scrollIntoView({ behavior: 'auto', block: 'nearest' });
        await new Promise(r => setTimeout(r, 300));

        console.log('[百家号发布] 🖱️ 点击选项:', foundOption.textContent.trim());
        console.log("🚀 ~ selectFromVirtualList ~ foundOption: ", foundOption);
        foundOption.querySelector('.cheetah-select-item-option-content').dispatchEvent(new Event('click', { bubbles: true }));

        // 等待下拉关闭
        await new Promise(r => setTimeout(r, 500));

        console.log('[百家号发布] ✅ 选项选择完成');
        return true;

    } catch (error) {
        console.error('[百家号发布] ❌ selectFromVirtualList 错误:', error);
        return false;
    }
}

/**
 * 选择定时发布的日期和时间
 * @param {number} dateIndex - 日期索引（0=今天, 1=明天等）
 * @param {number} hour - 小时（0-23）
 * @param {number} minute - 分钟（0-59）
 */
async function selectScheduledTime(dateIndex, hour, minute) {
    try {
        // 1. 找到定时发布弹窗的三个 select 组件
        const modal = document.querySelector('.cheetah-modal-wrap');
        if (!modal) {
            console.error('[百家号发布] ❌ 找不到定时发布弹窗');
            return false;
        }

        const selectElements = modal.querySelectorAll('.select-wrap');
        if (selectElements.length < 3) {
            console.error('[百家号发布] ❌ 找不到三个 select 组件，找到:', selectElements.length);
            return false;
        }

        const dateSelect = selectElements[0]; // 日期
        const hourSelect = selectElements[1]; // 小时
        const minuteSelect = selectElements[2]; // 分钟

        console.log('[百家号发布] 🔧 开始选择定时发布时间...');

        // 2. 获取日期选项的显示文本
        let dateText = '';
        const date = new Date();
        date.setDate(date.getDate() + dateIndex);

        // 格式：M月D日 或 MM月DD日
        const month = date.getMonth() + 1; // getMonth() 返回 0-11
        const day = date.getDate();
        dateText = `${month}月${day}日`;

        // 3. 依次选择日期、小时、分钟
        console.log('[百家号发布] 📅 选择日期:', dateText);
        if (!await selectFromVirtualList(dateSelect, dateText, 0)) {
            return false;
        }

        await new Promise(r => setTimeout(r, 300));

        const hourText = `${hour}点`;
        console.log('[百家号发布] 🕐 选择小时:', hourText);
        if (!await selectFromVirtualList(hourSelect, hourText, 1)) {
            return false;
        }

        await new Promise(r => setTimeout(r, 300));

        const minuteText = `${minute}分`;
        console.log('[百家号发布] ⏱️ 选择分钟:', minuteText);
        if (!await selectFromVirtualList(minuteSelect, minuteText, 2)) {
            return false;
        }

        console.log('[百家号发布] ✅ 定时发布时间选择完成');
        return true;

    } catch (error) {
        console.error('[百家号发布] ❌ selectScheduledTime 错误:', error);
        return false;
    }
}
