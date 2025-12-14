let introFilled = false; // 标记 intro 是否已填写
let fillFormRunning = false; // 标记 fillFormData 是否正在执行
let publishRunning = false; // 标记发布是否正在执行，防止重复点击

// 防重复标志：确保数据只处理一次
let isProcessing = false;
let hasProcessed = false;

/**
 * 小红书创作者平台发布脚本
 * 用于处理发布流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(function() {
  'use strict';

  // ===========================
  // 防止脚本重复注入
  // ===========================
  if (window.__XHS_SCRIPT_LOADED__) {
    console.log('[小红书发布] ⚠️ 脚本已经加载过，跳过重复注入');
    return;
  }
  window.__XHS_SCRIPT_LOADED__ = true;

  console.log('═══════════════════════════════════════');
  console.log('✅ 小红书发布脚本已注入');
  console.log('📍 当前 URL:', window.location.href);
  console.log('🕐 注入时间:', new Date().toLocaleString());
  console.log('═══════════════════════════════════════');

  // 检查 common.js 是否已加载
  if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
    console.error('[小红书发布] ❌ common.js 未加载！脚本可能无法正常工作');
  } else {
    console.log('[小红书发布] ✅ common.js 已加载，工具函数可用');
  }

  // ===========================
  // 1. 从 URL 获取发布数据
  // ===========================

  const urlParams = new URLSearchParams(window.location.search);
  const companyId = urlParams.get('company_id');
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
    console.log('[小红书发布] 删除旧的横幅');
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
        🎵 小红书发布脚本已运行 | Company ID: ${companyId || '未知'}
      </div>
      <div>
        <button onclick="window.__XHS_AUTH__.notifySuccess()" style="
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
      console.log('[小红书发布] ✅ document.body 存在，立即添加横幅');
      document.body.appendChild(banner);
    } else {
      console.log('[小红书发布] ⚠️ document.body 不存在，等待 DOM 加载');
      document.addEventListener('DOMContentLoaded', () => {
        console.log('[小红书发布] ✅ DOMContentLoaded 触发，添加横幅');
        if (document.body) {
          document.body.appendChild(banner);
        }
      });
      // 如果 DOMContentLoaded 已经触发过，用定时器重试
      setTimeout(() => {
        if (document.body && !document.getElementById('douyin-auth-banner')) {
          console.log('[小红书发布] ✅ 使用定时器添加横幅');
          document.body.appendChild(banner);
        }
      }, 100);
    }
  }

  addBannerToPage();

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
        if (message.type === 'auth-data') {
          console.log('[小红书发布] ✅ 收到发布数据:', message.data);

          // 防重复检查
          if (isProcessing) {
            console.warn('[小红书发布] ⚠️ 正在处理中，忽略重复消息');
            return;
          }
          if (hasProcessed) {
            console.warn('[小红书发布] ⚠️ 已经处理过，忽略重复消息');
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
            console.log('[小红书发布] ✅ 发布数据已更新:', window.__AUTH_DATA__);
            const messageData = JSON.parse(message.data);
            console.log("🚀 ~  ~ messageData: ", messageData);

            // 更新横幅显示
            const infoDisplay = document.getElementById('auth-info-display');
            console.log('[小红书发布] 查找横幅元素 #auth-info-display:', infoDisplay);

            if (infoDisplay) {
              console.log('[小红书发布] 更新前的内容:', infoDisplay.textContent);

              const newContent = `🎵 小红书发布脚本已运行 | Company ID: ${messageData.company_id || '未知'} | Platform: ${messageData.platform_value || '未知'}`;
              console.log('[小红书发布] 准备更新为:', newContent);

              // 使用 textContent 更新
              infoDisplay.textContent = newContent;

              // 强制刷新样式
              infoDisplay.style.display = 'none';
              infoDisplay.offsetHeight; // 触发重排
              infoDisplay.style.display = 'block';

              console.log('[小红书发布] 更新后的内容:', infoDisplay.textContent);
              console.log('[小红书发布] ✅ 横幅已更新');

              await uploadVideo(messageData);
              try{
                await retryOperation(async () => await fillFormData(messageData), 3, 2000);
              }catch (e){
                console.log('[小红书发布] ❌ 填写表单数据失败:', e);
              }

              console.log('[小红书发布] 📤 准备发送数据到接口...');
              console.log('[小红书发布] ✅ 发布流程已启动，等待 publishApi 完成...');
              // 注意：不在这里关闭窗口，因为 publishApi 内部有异步的统计接口调用
              // 窗口会在 publishApi 完成后自动关闭
            } else {
              console.error('[小红书发布] ❌ 未找���横幅信息元素 #auth-info-display');
              console.log('[小红书发布] 尝试查找 banner...');
              const banner = document.getElementById('douyin-auth-banner');
              console.log('[小红书发布] banner 元素:', banner);
              if (banner) {
                console.log('[小红书发布] banner.innerHTML:', banner.innerHTML.substring(0, 200));
              }
            }
          }

          // 重置处理标志（无论成功或失败）
          isProcessing = false;
          console.log('[小红书发布] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
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

  try {
    // 标记发布正在进行
    publishRunning = true;
    // 等待发布按钮可用
    const publishBtn = await retryOperation(async () => {
      const btn = document.querySelector(".submit > .custom-button.red");

      // 先检查按钮是否存在
      if (!btn) {
        throw new Error('Publish button not found');
      }

      return btn;
    }, 10, 2000); // 最多重试10次,每次间隔2秒

    // 等待按钮事件绑定完成
    await new Promise(resolve => setTimeout(resolve, 800));

    // 先点击发布按钮（避免后续 fetch 请求被页面跳转中断）
    let clickSuccess = false;
    for (let i = 0; i < 3; i++) {
      try {
        if (typeof publishBtn.click === 'function') {
          publishBtn.click();
          clickSuccess = true;
          console.log('[小红书发布] ✅ 发布按钮点击成功 (尝试 ' + (i + 1) + ')');
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
            console.log('[小红书发布] ✅ 按钮已禁用，点击生效');
            break;
          }
        }
      } catch (clickError) {
        console.error('[小红书发布] ❌ 点击失败 (尝试 ' + (i + 1) + '):', clickError.message);
      }
    }

    if (!clickSuccess) {
      console.error('[小红书发布] ❌ 所有点击尝试均失败');
      publishRunning = false;
      throw new Error('发布按钮点击失败');
    }

    // 等待页面状态稳定后再发送统计接口（避免请求被中断）
    console.log('[小红书发布] ⏳ 等待页面稳定...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 发送统计接口
    const publishId = dataObj.video.dyPlatform.id;
    const scanData = { data: JSON.stringify({ id: publishId }) };
    let apiResponse;
    let apiCallSuccess = false;

    try {
      console.log('[小红书发布] 📤 发送统计接口，数据:', scanData);
      apiResponse = await fetch("https://apidev.china9.cn/api/mediaauth/tjlog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scanData),
      });
      apiCallSuccess = true;
      console.log('[小红书发布] ✅ 统计接口请求成功');
    } catch (e) {
      console.error("🚀 ~ publishApi ~ fetch error: ", e);
      console.error('[小红书发布] ❌ 统计接口请求失败，但发布已完成');
      // 发布已完成，统计失败不影响主流程
      publishRunning = false;
      sendMessageToParent('发布成功（统计接口失败），刷新数据');
      return; // 直接返回，不再继续处理
    }

    // 处理 API 响应
    if (apiCallSuccess && apiResponse) {
      try {
        // 检查响应状态
        if (!apiResponse.ok) {
          console.error(`[小红书发布] ❌ 统计接口返回错误状态: ${apiResponse.status}`);
          throw new Error(`Statistics API failed with status: ${apiResponse.status}`);
        }

        // 安全解析JSON响应
        const responseText = await apiResponse.text();
        console.log('[小红书发布] 📥 接口原始响应:', responseText);

        let apiResult = null;
        if (responseText && responseText.trim()) {
          try {
            apiResult = JSON.parse(responseText);
            console.log('[小红书发布] 📥 接口解析后:', apiResult);
          } catch (e) {
            console.warn('[小红书发布] ⚠️ 响应不是有效的JSON:', e.message);
          }
        } else {
          console.warn('[小红书发布] ⚠️ 响应为空');
        }


        console.log('[小红书发布] ✅ 数据发送成功');

        // 标记已完成（防止重复发送）
        hasProcessed = true;

        // API 成功后通知父页面刷新
        sendMessageToParent('发布成功，刷新数据');

        // 统计接口成功后关闭弹窗
        publishRunning = false;
      } catch (error) {
        console.error('[小红书发布] ❌ 处理API响应时出错:', error);
        publishRunning = false;
        // 发布已完成，统计失败不应阻止流程
        sendMessageToParent('发布成功（统计处理失败），刷新数据');
        setTimeout(() => {
          window.browserAPI.closeCurrentWindow();
        }, 1000);
      }
    } else {
      // API 调用失败，但发布已完成
      console.warn('[小红书发布] ⚠️ 统计接口未成功调用，但发布已完成');
      publishRunning = false;
      sendMessageToParent('发布成功（统计接口失败），刷新数据');
      setTimeout(() => {
        window.browserAPI.closeCurrentWindow();
      }, 1000);
    }
  } catch (error) {
      console.log("🚀 ~ publishApi ~ error: ", error);
    publishRunning = false;
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

  } finally {
    // 无论成功还是失败，都重置标记
    fillFormRunning = false;
  }
}
