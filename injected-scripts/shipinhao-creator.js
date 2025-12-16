/**
 * 视频号创作者平台授权脚本
 * 用于处理授权流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(function() {
  'use strict';

  // ===========================
  // 防止脚本重复注入
  // ===========================
  if (window.__DOUYIN_SCRIPT_LOADED__) {
    console.log('[视频号授权] ⚠️ 脚本已经加载过，跳过重复注入');
    return;
  }
  window.__DOUYIN_SCRIPT_LOADED__ = true;

  console.log('═══════════════════════════════════════');
  console.log('✅ 视频号授权脚本已注入');
  console.log('📍 当前 URL:', window.location.href);
  console.log('🕐 注入时间:', new Date().toLocaleString());
  console.log('═══════════════════════════════════════');

  // 检查 common.js 是否已加载
  if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
    console.error('[视频号授权] ❌ common.js 未加载！脚本可能无法正常工作');
  } else {
    console.log('[视频号授权] ✅ common.js 已加载，工具函数可用');
  }

  // ===========================
  // 1. 从 URL 获取授权数据
  // ===========================

  const urlParams = new URLSearchParams(window.location.search);
  const companyId = urlParams.get('company_id');
  const transferId = urlParams.get('transfer_id');

  console.log('[视频号授权] URL 参数:', {
    companyId,
    transferId
  });

  // 存储授权数据到全局
  window.__AUTH_DATA__ = {
    companyId,
    transferId,
    timestamp: Date.now()
  };

  // ===========================
  // 2. 发送消息到父窗口的辅助函数（使用 common.js）
  // ===========================

  // ===========================
  // 3. 暴露全局方法供手动调用
  // ===========================

  window.__DOUYIN_AUTH__ = {
    // 发送授权成功消息
    notifySuccess: () => {
      sendMessageToParent('授权成功');
    },

    // 发送自定义消息
    sendMessage: (message) => {
      sendMessageToParent(message);
    },

    // 获取授权数据
    getAuthData: () => window.__AUTH_DATA__,
  };

  // ===========================
  // 4. 显示调试信息横幅
  // ===========================

  // ===========================
  // 5. 接收来自父窗口的消息（必须在发送 页面加载完成 之前注册！）
  // ===========================
  console.log('[视频号授权] 注册消息监听器...');

  // 防重复标志：确保数据只处理一次
  let isProcessing = false;
  let hasProcessed = false;

  if (!window.browserAPI) {
    console.error('[视频号授权] ❌ browserAPI 不可用！');
  } else {
    console.log('[视频号授权] ✅ browserAPI 可用');

    if (!window.browserAPI.onMessageFromHome) {
      console.error('[视频号授权] ❌ browserAPI.onMessageFromHome 不可用！');
    } else {
      console.log('[视频号授权] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

      window.browserAPI.onMessageFromHome(async (message) => {
        console.log('═══════════════════════════════════════');
        console.log('[视频号授权] 🎉 收到来自父窗口的消息!');
        console.log('[视频号授权] 消息类型:', typeof message);
        console.log('[视频号授权] 消息内容:', message);
        console.log('[视频号授权] 消息.type:', message?.type);
        console.log('[视频号授权] 消息.data:', message?.data);
        console.log('═══════════════════════════════════════');

        // 接收完整的授权数据（直接传递，不使用 IndexedDB）
        if (message.type === 'auth-data') {
          console.log('[视频号授权] ✅ 收到授权数据:', message.data);

          // 防重复检查
          if (isProcessing) {
            console.warn('[视频号授权] ⚠️ 正在处理中，忽略重复消息');
            return;
          }
          if (hasProcessed) {
            console.warn('[视频号授权] ⚠️ 已经处理过，忽略重复消息');
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
            console.log('[视频号授权] ✅ 授权数据已更新:', window.__AUTH_DATA__);
            const messageData = JSON.parse(message.data);
            console.log("🚀 ~  ~ messageData: ", messageData);

            // 等待页面元素加载完成
            await waitForElement('.finder-nickname', 15000);

            // 检查昵称元素是否有内容
            const nicknameEle = document.querySelector('.finder-nickname');
            if (!nicknameEle || !nicknameEle.innerText) {
              // alert('Nickname element not ready, waiting...');
              await new Promise(resolve => setTimeout(resolve, 2000));
            }

            // 检查是否还在加载中 - 更宽松的检查
            const loadingEle = document.querySelector('#container-wrap .wrap');
            const isLoading = loadingEle && loadingEle.style.display !== 'none';

            // 如果页面还在加载，等待一段时间再继续
            if (isLoading) {
              // alert('Page is still loading, waiting...');
              await new Promise(resolve => setTimeout(resolve, 2000));

              // 再次检查，如果还在加载则继续等待
              const stillLoading = loadingEle && loadingEle.style.display !== 'none';
              if (stillLoading) {
                // alert('Page still loading, continuing anyway...');
              }
            }

            // 收集用户信息
            const nicknameEleFinal = await waitForElement('.finder-nickname', 5000);
            const avatarEle = await waitForElement('.avatar', 5000);
            const followerCountEle = await waitForElement('.finder-content-info > div:nth-of-type(2) .finder-info-num', 5000);
            const videoCountEle = await waitForElement('.finder-content-info > div:nth-of-type(1) .finder-info-num', 5000);
            const uidEle = await waitForElement('.finder-uniq-id', 5000);

            const scanData = {
              data: JSON.stringify({
                nickname: nicknameEleFinal.innerText,
                avatar: avatarEle.getAttribute('src'),
                follower_count: followerCountEle.innerText,
                video: videoCountEle.innerText,
                uid: uidEle.innerText,
                favoriting_count: 0,
                total_favorited: 0,
                company_id: messageData.company_id
              })
            };

            // 发送数据到服务器
            const apiResponse = await fetch('https://apidev.china9.cn/api/mediaauth/sphinfo', {
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

            const apiResult = await apiResponse.json();
            console.log('[视频号授权] 📥 接口响应:', apiResult);

            if (apiResult && 'code' in apiResult && apiResult.code === 200) {
              console.log('[视频号授权] ✅ 数据发送成功');

              // 标记已完成（防止重复发送）
              hasProcessed = true;

              // API 成功后通知父页面刷新
              sendMessageToParent('授权成功，刷新数据');

              // 统计接口成功后关闭弹窗
              setTimeout(() => {
                window.browserAPI.closeCurrentWindow();
              }, 1000);
            } else {
              throw new Error(apiResult.msg || apiResult.message || 'Data collection failed');
            }
          }

          // 重置处理标志（无论成功或失败）
          isProcessing = false;
          console.log('[视频号授权] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
        }
      });

      console.log('[视频号授权] ✅ 消息监听器注册成功');
    }
  }

  // ===========================
  // 6. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
  // ===========================

  // 页面加载完成后向父窗口发送消息
  console.log('[视频号授权] 页面加载完成，发送 页面加载完成 消息');
  sendMessageToParent('页面加载完成');

  console.log('═══════════════════════════════════════');
  console.log('✅ 视频号授权脚本初始化完成');
  console.log('📝 全局方法: window.__DOUYIN_AUTH__');
  console.log('  - notifySuccess()  : 发送授权成功消息');
  console.log('  - sendMessage(msg) : 发送自定义消息');
  console.log('  - getAuthData()    : 获取授权数据');
  console.log('  - sendAuthCode(code): 发送授权码');
  console.log('═══════════════════════════════════════');

})();

