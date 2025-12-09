/**
 * 百家号创作者平台授权脚本
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
    console.log('[百家号授权] ⚠️ 脚本已经加载过，跳过重复注入');
    return;
  }
  window.__DOUYIN_SCRIPT_LOADED__ = true;

  console.log('═══════════════════════════════════════');
  console.log('✅ 百家号授权脚本已注入');
  console.log('📍 当前 URL:', window.location.href);
  console.log('🕐 注入时间:', new Date().toLocaleString());
  console.log('═══════════════════════════════════════');

  // 检查 common.js 是否已加载
  if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
    console.error('[百家号授权] ❌ common.js 未加载！脚本可能无法正常工作');
  } else {
    console.log('[百家号授权] ✅ common.js 已加载，工具函数可用');
  }

  // ===========================
  // 1. 从 URL 获取授权数据
  // ===========================

  const urlParams = new URLSearchParams(window.location.search);
  const companyId = urlParams.get('company_id');
  const transferId = urlParams.get('transfer_id');

  console.log('[百家号授权] URL 参数:', {
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

  function sendMessageToParent(message) {
    console.log('[百家号授权] 发送消息到父窗口:', message);

    // 方式 2: 使用 browserAPI (运营助手浏览器)
    if (window.browserAPI?.sendToHome) {
      try {
        window.browserAPI.sendToHome(message);
        console.log('[百家号授权] ✅ 已通过 browserAPI.sendToHome 发送');
        return true;
      } catch (e) {
        console.error('[百家号授权] ❌ browserAPI.sendToHome 失败:', e);
      }
    } else {
      console.warn('[百家号授权] ⚠️ browserAPI 不可用');
    }

    return false;
  }

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

  // 先删除旧的横幅（如果存在）
  const oldBanner = document.getElementById('douyin-auth-banner');
  if (oldBanner) {
    console.log('[百家号授权] 删除旧的横幅');
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
        🎵 百家号授权脚本已运行 | Company ID: ${companyId || '未知'}
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

  if (document.body) {
    document.body.appendChild(banner);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.appendChild(banner);
    });
  }

  // ===========================
  // 5. 接收来自父窗口的消息（必须在发送 页面加载完成 之前注册！）
  // ===========================
  console.log('[百家号授权] 注册消息监听器...');

  // 防重复标志：确保数据只处理一次
  let isProcessing = false;
  let hasProcessed = false;

  if (!window.browserAPI) {
    console.error('[百家号授权] ❌ browserAPI 不可用！');
  } else {
    console.log('[百家号授权] ✅ browserAPI 可用');

    if (!window.browserAPI.onMessageFromHome) {
      console.error('[百家号授权] ❌ browserAPI.onMessageFromHome 不可用！');
    } else {
      console.log('[百家号授权] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

      window.browserAPI.onMessageFromHome(async (message) => {
        console.log('═══════════════════════════════════════');
        console.log('[百家号授权] 🎉 收到来自父窗口的消息!');
        console.log('[百家号授权] 消息类型:', typeof message);
        console.log('[百家号授权] 消息内容:', message);
        console.log('[百家号授权] 消息.type:', message?.type);
        console.log('[百家号授权] 消息.data:', message?.data);
        console.log('═══════════════════════════════════════');

        // 接收完整的授权数据（直接传递，不使用 IndexedDB）
        if (message.type === 'auth-data') {
          console.log('[百家号授权] ✅ 收到授权数据:', message.data);

          // 防重复检查
          if (isProcessing) {
            console.warn('[百家号授权] ⚠️ 正在处理中，忽略重复消息');
            return;
          }
          if (hasProcessed) {
            console.warn('[百家号授权] ⚠️ 已经处理过，忽略重复消息');
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
            console.log('[百家号授权] ✅ 授权数据已更新:', window.__AUTH_DATA__);
            const messageData = JSON.parse(message.data);
            console.log("🚀 ~  ~ messageData: ", messageData);

            // 更新横幅显示
            const infoDisplay = document.getElementById('auth-info-display');
            console.log('[百家号授权] 查找横幅元素 #auth-info-display:', infoDisplay);

            if (infoDisplay) {
              console.log('[百家号授权] 更新前的内容:', infoDisplay.textContent);

              const newContent = `🎵 ���音授权脚本已运行 | Company ID: ${messageData.company_id || '未知'} | Platform: ${messageData.platform_value || '未知'}`;
              console.log('[百家号授权] 准备更新为:', newContent);

              // 使用 textContent 更新
              infoDisplay.textContent = newContent;

              // 强制刷新样式
              infoDisplay.style.display = 'none';
              infoDisplay.offsetHeight; // 触发重排
              infoDisplay.style.display = 'block';

              console.log('[百家号授权] 更新后的内容:', infoDisplay.textContent);
              console.log('[百家号授权] ✅ 横幅已更新');

              // 获取用户信息
              const response = await fetch('https://baijiahao.baidu.com/builder/app/appinfo', {
                method: 'get'
              });

              if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
              }

              const result = await response.json();
              const {user} = result.data;

              if (!user) {
                throw new Error('User data not found in response');
              }

              const scanData = {
                data: JSON.stringify({
                  nickname: user.name,
                  avatar: user.avatar,
                  follow: 0,
                  follower_count: user.ability.total_fans,
                  video: user.ability.publish_num,
                  uid: user.id,
                  favoriting_count: 0,
                  total_favorited: 0,
                  company_id: messageData.company_id
                })
              };

              // 发送数据到服务器
              const apiResponse = await fetch('https://apidev.china9.cn/api/mediaauth/bjhinfo', {
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
              console.log('[百家号授权] 📥 接口响应:', apiResult);

              if (apiResult && 'code' in apiResult && apiResult.code === 200) {
                console.log('[百家号授权] ✅ 数据发送成功');

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
            } else {
              console.error('[百家号授权] ❌ 未找���横幅信息元素 #auth-info-display');
              console.log('[百家号授权] 尝试查找 banner...');
              const banner = document.getElementById('douyin-auth-banner');
              console.log('[百家号授权] banner 元素:', banner);
              if (banner) {
                console.log('[百家号授权] banner.innerHTML:', banner.innerHTML.substring(0, 200));
              }
            }
          }

          // 重置处理标志（无论成功或失败）
          isProcessing = false;
          console.log('[百家号授权] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
        }
      });

      console.log('[百家号授权] ✅ 消息监听器注册成功');
    }
  }

  // ===========================
  // 6. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
  // ===========================

  // 页面加载完成后向父窗口发送消息
  console.log('[百家号授权] 页面加载完成，发送 页面加载完成 消息');
  sendMessageToParent('页面加载完成');

  console.log('═══════════════════════════════════════');
  console.log('✅ 百家号授权脚本初始化完成');
  console.log('📝 全局方法: window.__DOUYIN_AUTH__');
  console.log('  - notifySuccess()  : 发送授权成功消息');
  console.log('  - sendMessage(msg) : 发送自定义消息');
  console.log('  - getAuthData()    : 获取授权数据');
  console.log('  - sendAuthCode(code): 发送授权码');
  console.log('═══════════════════════════════════════');

})();

