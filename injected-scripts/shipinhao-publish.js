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

(function() {
  'use strict';

  // ===========================
  // 防止脚本重复注入
  // ===========================
  if (window.__SHIPINHAO_SCRIPT_LOADED__) {
    console.log('[视频号发布] ⚠️ 脚本已经加载过，跳过重复注入');
    return;
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
  const companyId = urlParams.get('company_id');
  const transferId = urlParams.get('transfer_id');

  console.log('[视频号发布] URL 参数:', {
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

  // 先删除旧的横幅（如果存在）
  const oldBanner = document.getElementById('douyin-auth-banner');
  if (oldBanner) {
    console.log('[视频号发布] 删除旧的横幅');
    oldBanner.remove();
  }

  const banner = document.createElement('div');
  banner.id = 'douyin-auth-banner';
  banner.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: linear-gradient(135deg, #ee0a24 0%, #ff6034 100%);
    color: white;
    padding: 12px 20px;
    text-align: center;
    font-family: Arial, sans-serif;
    z-index: 999999;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    font-size: 14px;
  `;
  banner.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; max-width: 1200px; margin: 0 auto;">
      <div id="auth-info-display">
        🎵 视频号发布脚本已运行 | Company ID: ${companyId || '未知'}
      </div>
      <div>
        <button onclick="window.__SHIPINHAO_AUTH__.notifySuccess()" style="
          background: rgba(255,255,255,0.2);
          border: 1px solid rgba(255,255,255,0.5);
          color: white;
          padding: 6px 16px;
          border-radius: 4px;
          cursor: pointer;
          margin-left: 10px;
          font-size: 13px;
        ">测试发送消息</button>
        <button onclick="this.parentElement.parentElement.parentElement.remove()" style="
          background: rgba(255,255,255,0.2);
          border: 1px solid rgba(255,255,255,0.5);
          color: white;
          padding: 6px 16px;
          border-radius: 4px;
          cursor: pointer;
          margin-left: 10px;
          font-size: 13px;
        ">关闭</button>
      </div>
    </div>
  `;

  // 添加横幅到页面
  function addBannerToPage() {
    if (document.body) {
      console.log('[视频号发布] ✅ document.body 存在，立即添加横幅');
      document.body.appendChild(banner);
    } else {
      console.log('[视频号发布] ⚠️ document.body 不存在，等待 DOM 加载');
      document.addEventListener('DOMContentLoaded', () => {
        console.log('[视频号发布] ✅ DOMContentLoaded 触发，添加横幅');
        if (document.body) {
          document.body.appendChild(banner);
        }
      });
      // 如果 DOMContentLoaded 已经触发过，用定时器重试
      setTimeout(() => {
        if (document.body && !document.getElementById('douyin-auth-banner')) {
          console.log('[视频号发布] ✅ 使用定时器添加横幅');
          document.body.appendChild(banner);
        }
      }, 100);
    }
  }

  addBannerToPage();

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
        console.log('═══════════════════════════════════════');
        console.log('[视频号发布] 🎉 收到来自父窗口的消息!');
        console.log('[视频号发布] 消息类型:', typeof message);
        console.log('[视频号发布] 消息内容:', message);
        console.log('[视频号发布] 消息.type:', message?.type);
        console.log('[视频号发布] 消息.data:', message?.data);
        console.log('═══════════════════════════════════════');

        // 接收完整的发布数据（直接传递，不使用 IndexedDB）
        if (message.type === 'auth-data') {
          console.log('[视频号发布] ✅ 收到发布数据:', message.data);

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
            window.__AUTH_DATA__ = {
              ...window.__AUTH_DATA__,
              message: JSON.parse(message.data),
              receivedAt: Date.now()
            };
            console.log('[视频号发布] ✅ 发布数据已更新:', window.__AUTH_DATA__);
            const messageData = JSON.parse(message.data);
            console.log("🚀 ~  ~ messageData: ", messageData);

            // 更新横幅显示
            const infoDisplay = document.getElementById('auth-info-display');
            console.log('[视频号发布] 查找横幅元素 #auth-info-display:', infoDisplay);

            if (infoDisplay) {
              console.log('[视频号发布] 更新前的内容:', infoDisplay.textContent);

              const newContent = `🎵 视频号发布脚本已运行 | Company ID: ${messageData.company_id || '未知'} | Platform: ${messageData.platform_value || '未知'}`;
              console.log('[视频号发布] 准备更新为:', newContent);

              // 使用 textContent 更新
              infoDisplay.textContent = newContent;

              // 强制刷新样式
              infoDisplay.style.display = 'none';
              infoDisplay.offsetHeight; // 触发重排
              infoDisplay.style.display = 'block';

              console.log('[视频号发布] 更新后的内容:', infoDisplay.textContent);
              console.log('[视频号发布] ✅ 横幅已更新');

              // 等待wujie-app元素
              const wujieApp = await waitForElement("wujie-app", 15000);
              if(wujieApp){
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
                      const wujieApp = await waitForElement("wujie-app", 5000);

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
                        // 首先检查wujie-app的Shadow DOM
                        const wujieApp = await waitForElement("wujie-app", 5000);

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
              }else{
                // wujieApp 不存在，直接上传视频（不使用 Shadow DOM）
                await uploadVideo(messageData);
              }
              try{
                await retryOperation(async () => await fillFormData(messageData), 3, 2000);
              }catch (e){
                console.log('[视频号发布] ❌ 填写表单数据失败:', e);
              }

              console.log('[视频号发布] 📤 准备发送数据到接口...');
              console.log('[视频号发布] ✅ 发布流程已启动，等待 publishApi 完成...');
              // 注意：不在这里关闭窗口，因为 publishApi 内部有异步的统计接口调用
              // 窗口会在 publishApi 完成后自动关闭
            } else {
              console.error('[视频号发布] ❌ 未找���横幅信息元素 #auth-info-display');
              console.log('[视频号发布] 尝试查找 banner...');
              const banner = document.getElementById('douyin-auth-banner');
              console.log('[视频号发布] banner 元素:', banner);
              if (banner) {
                console.log('[视频号发布] banner.innerHTML:', banner.innerHTML.substring(0, 200));
              }
            }
          }

          // 重置处理标志（无论成功或失败）
          isProcessing = false;
          console.log('[视频号发布] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
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

})();

// ===========================
// 7. 发布视频到视频号
// ===========================
async function publishApi(dataObj) {
  // 防止重复执行
  if (publishRunning) {
    // alert('Publish is already running, skipping duplicate call');
    return;
  }

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

      console.log('[视频号发布] 📹 找到视频元素:', video);
      console.log('[视频号发布] 📹 视频状态 - src:', video.src ? '有' : '无');
      console.log('[视频号发布] 📹 视频状态 - readyState:', video.readyState);
      console.log('[视频号发布] 📹 视频状态 - duration:', video.duration);

      // 检查视频是否有 src
      if (!video.src) {
        throw new Error('Video has no src, still uploading');
      }

      // 检查视频是否可以播放 (readyState >= 2 表示有足够数据可以播放)
      // readyState: 0=HAVE_NOTHING, 1=HAVE_METADATA, 2=HAVE_CURRENT_DATA, 3=HAVE_FUTURE_DATA, 4=HAVE_ENOUGH_DATA
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

      // 先检查按钮是否存在
      if (!btn) {
        throw new Error('Publish button not found');
      }

      // 再检查按钮是否被禁用
      if (btn.classList && btn.classList.contains("weui-desktop-btn_disabled")) {
        throw new Error('Publish button is disabled');
      }

      return btn;
    }, 10, 2000); // 最多重试10次,每次间隔2秒

    // 等待按钮事件绑定完成
    await new Promise(resolve => setTimeout(resolve, 800));

    let apiResponse = null;
    let apiCallSuccess = false;

    // 先发送统计接口（在点击发布按钮前，确保能发出去）
    const publishId = dataObj.video.dyPlatform.id;
    const scanData = { data: JSON.stringify({ id: publishId }) };
    try {
      apiResponse = await fetch("https://apidev.china9.cn/api/mediaauth/tjlog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scanData),
      });
      apiCallSuccess = true;
      console.log('[视频号发布] ✅ 统计接口请求成功');
    } catch (e) {
      console.log('[视频号发布] ❌ 统计接口请求失败:', e);
    }

    // 多次尝试点击发布按钮
    let clickSuccess = false;
    for (let i = 0; i < 3; i++) {
      try {
        if (typeof publishBtn.click === 'function') {
          publishBtn.click();
          clickSuccess = true;
          await new Promise(resolve => setTimeout(resolve, 500));

          // check if button still enabled means click may not work
          if (!publishBtn.classList.contains("weui-desktop-btn_disabled")) {
            // try trigger mouse events manually
            const mouseDownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
            const mouseUpEvent = new MouseEvent('mouseup', { bubbles: true, cancelable: true });
            const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
            publishBtn.dispatchEvent(mouseDownEvent);
            publishBtn.dispatchEvent(mouseUpEvent);
            publishBtn.dispatchEvent(clickEvent);
            await new Promise(resolve => setTimeout(resolve, 300));
          } else {
            break;
          }
        }
      } catch (clickError) {
        console.log('Click attempt ' + (i + 1) + ' failed: ' + clickError.message);
      }
    }

    if (!clickSuccess) {
      console.log('[视频号发布] ❌ 点击发布按钮失败');
    } else {
      // 点击成功后立即发送消息（因为页面可能会跳转，后面的代码可能不会执行）
      console.log('[视频号发布] ✅ 发布按钮已点击，发送成功消息...');
      sendMessageToParent('发布成功，刷新数据');
      hasProcessed = true;
    }

    // 点击后等待一会，然后关闭窗口
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 如果页面没跳转，尝试关闭窗口
    console.log('[视频号发布] 尝试关闭窗口...');
    publishRunning = false;
    try {
      await window.browserAPI.closeCurrentWindow();
    } catch (e) {
      console.log('[视频号发布] 关闭窗口失败:', e);
    }
  } catch (error) {
    console.log('[视频号发布] publishApi 错误:', error);
    publishRunning = false;
  }
}

// 填写表单数据
async function fillFormData(dataObj) {
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

  } finally {
    // 无论成功还是失败，都重置标记
    fillFormRunning = false;
  }
}

