let introFilled = false; // 标记 intro 是否已填写
let fillFormRunning = false; // 标记 fillFormData 是否正在执行
let publishRunning = false; // 标记发布是否正在执行，防止重复点击

/**
 * 抖音创作者平台发布脚本
 * 用于处理发布流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(function() {
  'use strict';

  // ===========================
  // 防止脚本重复注入
  // ===========================
  if (window.__DOUYIN_SCRIPT_LOADED__) {
    console.log('[抖音发布] ⚠️ 脚本已经加载过，跳过重复注入');
    return;
  }
  window.__DOUYIN_SCRIPT_LOADED__ = true;

  console.log('═══════════════════════════════════════');
  console.log('✅ 抖音发布脚本已注入');
  console.log('📍 当前 URL:', window.location.href);
  console.log('🕐 注入时间:', new Date().toLocaleString());
  console.log('═══════════════════════════════════════');

  // 检查 common.js 是否已加载
  if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
    console.error('[抖音发布] ❌ common.js 未加载！脚本可能无法正常工作');
  } else {
    console.log('[抖音发布] ✅ common.js 已加载，工具函数可用');
  }

  // ===========================
  // 1. 从 URL 获取发布数据
  // ===========================

  const urlParams = new URLSearchParams(window.location.search);
  const companyId = urlParams.get('company_id');
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

  // 先删除旧的横幅（如果存在）
  const oldBanner = document.getElementById('douyin-auth-banner');
  if (oldBanner) {
    console.log('[抖音发布] 删除旧的横幅');
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
        🎵 抖音发布脚本已运行 | Company ID: ${companyId || '未知'}
      </div>
      <div>
        <button onclick="window.__DOUYIN_AUTH__.notifySuccess()" style="
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
      console.log('[抖音发布] ✅ document.body 存在，立即添加横幅');
      document.body.appendChild(banner);
    } else {
      console.log('[抖音发布] ⚠️ document.body 不存在，等待 DOM 加载');
      document.addEventListener('DOMContentLoaded', () => {
        console.log('[抖音发布] ✅ DOMContentLoaded 触发，添加横幅');
        if (document.body) {
          document.body.appendChild(banner);
        }
      });
      // 如果 DOMContentLoaded 已经触发过，用定时器重试
      setTimeout(() => {
        if (document.body && !document.getElementById('douyin-auth-banner')) {
          console.log('[抖音发布] ✅ 使用定时器添加横幅');
          document.body.appendChild(banner);
        }
      }, 100);
    }
  }

  addBannerToPage();

  // ===========================
  // 5. 接收来自父窗口的消息（必须在发送 页面加载完成 之前注册！）
  // ===========================
  console.log('[抖音发布] 注册消息监听器...');

  // 防重复标志：确保数据只处理一次
  let isProcessing = false;
  let hasProcessed = false;

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
        if (message.type === 'auth-data') {
          console.log('[抖音发布] ✅ 收到发布数据:', message.data);

          // 防重复检查
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

          // 更新全局变量
          if (message.data) {
            window.__AUTH_DATA__ = {
              ...window.__AUTH_DATA__,
              message: JSON.parse(message.data),
              receivedAt: Date.now()
            };
            console.log('[抖音发布] ✅ 发布数据已更新:', window.__AUTH_DATA__);
            const messageData = JSON.parse(message.data);
            console.log("🚀 ~  ~ messageData: ", messageData);

            // 更新横幅显示
            const infoDisplay = document.getElementById('auth-info-display');
            console.log('[抖音发布] 查找横幅元素 #auth-info-display:', infoDisplay);

            if (infoDisplay) {
              console.log('[抖音发布] 更新前的内容:', infoDisplay.textContent);

              const newContent = `🎵 ���音发布脚本已运行 | Company ID: ${messageData.company_id || '未知'} | Platform: ${messageData.platform_value || '未知'}`;
              console.log('[抖音发布] 准备更新为:', newContent);

              // 使用 textContent 更新
              infoDisplay.textContent = newContent;

              // 强制刷新样式
              infoDisplay.style.display = 'none';
              infoDisplay.offsetHeight; // 触发重排
              infoDisplay.style.display = 'block';

              console.log('[抖音发布] 更新后的内容:', infoDisplay.textContent);
              console.log('[抖音发布] ✅ 横幅已更新');

              await uploadVideo(messageData);
              try{
                await retryOperation(async () => await fillFormData(messageData), 3, 2000);
              }catch (e){
                console.log('[抖音发布] ❌ 填写表单数据失败:', e);
              }

              console.log('[抖音发布] 📤 准备发送数据到接口...');
              /* const publishId = messageData.video.dyPlatform.id;
              const scanData = { data: JSON.stringify({ id: publishId }) };
              // 发送数据到服务器
              const apiResponse = await fetch('https://apidev.china9.cn/api/mediaauth/tjlog', {
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

              // 安全解析JSON响应
              const responseText = await apiResponse.text();
              console.log('[抖音发布] 📥 接口原始响应:', responseText);

              let apiResult = null;
              if (responseText && responseText.trim()) {
                try {
                  apiResult = JSON.parse(responseText);
                  console.log('[抖音发布] 📥 接口解析后:', apiResult);
                } catch (e) {
                  console.warn('[抖音发布] ⚠️ 响应不是有效的JSON:', e.message);
                }
              } else {
                console.warn('[抖音发布] ⚠️ 响应为空');
              }

              if (apiResult && 'code' in apiResult && apiResult.code === 200) {
                console.log('[抖音发布] ✅ 数据发送成功');

                // 标记已完成（防止重复发送）
                hasProcessed = true;

                // API 成功后通知父页面刷新
                sendMessageToParent('发布成功，刷新数据');

                // 统计接口成功后关闭弹窗
                setTimeout(() => {
                  window.browserAPI.closeCurrentWindow();
                }, 1000);
              } else {
                throw new Error(apiResult?.msg || apiResult?.message || 'Data collection failed');
              } */
            } else {
              console.error('[抖音发布] ❌ 未找���横幅信息元素 #auth-info-display');
              console.log('[抖音发布] 尝试查找 banner...');
              const banner = document.getElementById('douyin-auth-banner');
              console.log('[抖音发布] banner 元素:', banner);
              if (banner) {
                console.log('[抖音发布] banner.innerHTML:', banner.innerHTML.substring(0, 200));
              }
            }
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
  console.log('  - sendAuthCode(code): 发送发布码');
  console.log('═══════════════════════════════════════');

})();

// ===========================
// 7. 发布视频到抖音
// ===========================
async function publishApi(dataObj) {
    console.log("🚀 ~ publishApi ~ dataObj: ", dataObj);
  // 保存当前URL，用于后续判断
  const currentUrl = window.location.href;

  // 防止重复执行
  if (publishRunning) {
     console.log('Publish is already running, skipping duplicate call');
    return;
  }

  try {
    // 标记发布正在进行
    publishRunning = true;
    // 等待发布按钮可用
    const publishBtn = await retryOperation(async () => {
      const btn = document.querySelector(".button-dhlUZE");

      // 先检查按钮是否存在
      if (!btn) {
        throw new Error('Publish button not found');
      }

      return btn;
    }, 10, 2000); // 最多重试10次,每次间隔2秒

    // 等待按钮事件绑定完成
    await new Promise(resolve => setTimeout(resolve, 800));

    // 先发送统计接口（在点击发布按钮前，确保能发出去）
    const publishId = dataObj.video.dyPlatform.id;
    const scanData = { data: JSON.stringify({ id: publishId }) };
    try {
      await fetch("https://apidev.china9.cn/api/mediaauth/tjlog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scanData),
      });
    } catch (e) {
        console.log("🚀 ~ publishApi ~ e: ", e);
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
          if (publishBtn.offsetParent !== null && !publishBtn.disabled) {
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
      console.log('All click attempts failed');
    }

    // 点击后等待一会，如果页面没跳转就关闭
    await new Promise(resolve => setTimeout(() => {
      if (window.location.href === currentUrl) {
        window.browserAPI.closeCurrentWindow();
      }
    }, 10000));
    publishRunning = false;

  } catch (error) {
      console.log("🚀 ~ publishApi ~ error: ", error);
    publishRunning = false;
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

    // 填写标题
    const titleInput = await waitForElement('.editor-kit-root-container .semi-input', 5000);
    // alert(`Filling title: ${titleAndIntro.title || ''}`);

    try {
      // 先触发focus事件
      if (typeof titleInput.focus === 'function') {
        titleInput.focus();
      } else {
        titleInput.dispatchEvent(new Event('focus', { bubbles: true }));
      }

      // 延迟执行，让React状态稳定
      await new Promise(resolve => setTimeout(resolve, 300));

      // 使用setNativeValue设置值
      setNativeValue(titleInput, titleAndIntro.title || '');

      // 额外触发input事件
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));

      // alert('✅ Title filled successfully');

    } catch (error) {
      // alert('❌ Title setting failed: ' + error.message);
    }

    // 填写简介
    try {
      // 首先检查是否已经填写过（通过全局标记）
      if (introFilled) {
        // alert('Intro already filled, introFilled=' + introFilled);
        // 直接跳过，不再查找元素或进行任何操作
      } else {
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

        const targetContent = cleanedText;

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

          // alert('After clear, innerHTML: ' + JSON.stringify(introInput.innerHTML));

          // 先触发focus事件
          if (typeof introInput.focus === 'function') {
            introInput.focus();
          } else {
            introInput.dispatchEvent(new Event('focus', { bubbles: true }));
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
          introInput.dispatchEvent(new Event('input', { bubbles: true }));

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

          // if (removedCount > 0) {
          //   alert('Removed ' + removedCount + ' empty ace-line elements');
          // } else {
          //   alert('No empty ace-line elements found');
          // }

          // 再次检查是否还有开头空行
          // alert('After cleanup:\nHTML: ' + JSON.stringify(introInput.innerHTML) + '\nText: ' + JSON.stringify(introInput.textContent));

          // 延迟后触发blur事件
          await new Promise(resolve => setTimeout(resolve, 200));
          if (typeof introInput.blur === 'function') {
            introInput.blur();
          } else {
            introInput.dispatchEvent(new Event('blur', { bubbles: true }));
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
      }

    } catch (error) {
      // alert('⚠️ Intro handling failed: ' + error.message);
    }

    // 设置发布时间
    const publishTime = dataObj.video.formData.send_set;
    if (+publishTime === 2) {
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
    }

    // 等待表单填写完成
    await new Promise(resolve => setTimeout(resolve, 15000));

    // 设置封面
    try {
      console.log('[封面设置] 开始设置封面...');

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
    } catch (error) {
      console.log('[封面设置] ⚠️ 封面设置失败:', error.message);
    }

    // 检查是否通过检测 - 持续等待直到检测完成
    try {
      console.log('[检测结果] 等待检测元素出现...');
      // 设置较长的超时时间（5分钟），持续等待检测完成
      const checkElement = await waitForElement('.detectItemTitle-X5pTL9', 300000);

      console.log('[检测结果] ✅ 检测元素已出现');
      console.log('[检测结果] 检测元素内容:', checkElement.textContent);

      if (checkElement.textContent.includes('作品未见异常')) {
        console.log('[检测结果] ✅ 检测通过，准备发布');
        // 发布
        await publishApi(dataObj);
      } else {
        console.log('[检测结果] ⚠️ 检测未通过，不执行发布');
        console.log('[检测结果] 内容:', checkElement.textContent);
      }
    } catch (error) {
      console.log('[检测结果] ❌ 等待检测元素超时（5分钟）:', error.message);
      // 超时不执行发布，避免发布失败
      throw new Error('检测超时，取消发布');
    }

  } finally {
    // 无论成功还是失败，都重置标记
    fillFormRunning = false;
  }
}
