/**
 * 抖音创作者平台授权脚本
 * 用于处理授权流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(function() {
  'use strict';

  console.log('═══════════════════════════════════════');
  console.log('✅ 抖音授权脚本已注入');
  console.log('📍 当前 URL:', window.location.href);
  console.log('🕐 注入时间:', new Date().toLocaleString());
  console.log('═══════════════════════════════════════');

  // 检查 common.js 是否已加载
  if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
    console.error('[抖音授权] ❌ common.js 未加载！脚本可能无法正常工作');
  } else {
    console.log('[抖音授权] ✅ common.js 已加载，工具函数可用');
  }

  // ===========================
  // 1. 从 URL 获取授权数据
  // ===========================

  const urlParams = new URLSearchParams(window.location.search);
  const companyId = urlParams.get('company_id');
  const transferId = urlParams.get('transfer_id');

  console.log('[抖音授权] URL 参数:', {
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
    console.log('[抖音授权] 发送消息到父窗口:', message);

    // 方式 2: 使用 browserAPI (运营助手浏览器)
    if (window.browserAPI?.sendToHome) {
      try {
        window.browserAPI.sendToHome(message);
        console.log('[抖音授权] ✅ 已通过 browserAPI.sendToHome 发送');
        return true;
      } catch (e) {
        console.error('[抖音授权] ❌ browserAPI.sendToHome 失败:', e);
      }
    } else {
      console.warn('[抖音授权] ⚠️ browserAPI 不可用');
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

    // 发送授权码到后端
    sendAuthCode: async (code) => {
      console.log('[抖音授权] 准备发送授权码到后端:', code);

      try {
        // 替换为你的实际后端接口
        const response = await fetch('/api/short-video/auth/callback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            platform: 'douyin',
            code: code,
            company_id: companyId
          })
        });

        const result = await response.json();
        console.log('[抖音授权] 后端响应:', result);

        if (result.success || result.code === 200) {
          console.log('[抖音授权] ✅ 授权成功');
          sendMessageToParent('授权成功');
          return true;
        } else {
          console.error('[抖音授权] ❌ 授权失败:', result.message);
          return false;
        }
      } catch (error) {
        console.error('[抖音授权] ❌ 发送授权码失败:', error);
        return false;
      }
    }
  };

  // ===========================
  // 4. 显示调试信息横幅
  // ===========================

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
      <div>
        🎵 抖音授权脚本已运行 | Company ID: ${companyId || '未知'}
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
  // 5. 接收来自父窗口的消息（必须在发送 PAGE_LOADED 之前注册！）
  // ===========================
  console.log('[抖音授权] 注册消息监听器...');

  if (!window.browserAPI) {
    console.error('[抖音授权] ❌ browserAPI 不可用！');
  } else {
    console.log('[抖音授权] ✅ browserAPI 可用');

    if (!window.browserAPI.onMessageFromHome) {
      console.error('[抖音授权] ❌ browserAPI.onMessageFromHome 不可用！');
    } else {
      console.log('[抖音授权] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

      window.browserAPI.onMessageFromHome(async (message) => {
        console.log('═══════════════════════════════════════');
        console.log('[抖音授权] 🎉 收到来自父窗口的消息!');
        console.log('[抖音授权] 消息类型:', typeof message);
        console.log('[抖音授权] 消息内容:', message);
        console.log('[抖音授权] 消息.type:', message?.type);
        console.log('[抖音授权] 消息.data:', message?.data);
        console.log('═══════════════════════════════════════');

        // 接收完整的授权数据（直接传递，不使用 IndexedDB）
        if (message.type === 'auth-data') {
          console.log('[抖音授权] ✅ 收到授权数据:', message.data);

          // 更新全局变量
          if (message.data) {
            window.__AUTH_DATA__ = {
              ...window.__AUTH_DATA__,
              message: JSON.parse(message.data),
              receivedAt: Date.now()
            };
            console.log('[抖音授权] ✅ 授权数据已更新:', window.__AUTH_DATA__);
            const messageData = JSON.parse(message.data);
            console.log("🚀 ~  ~ messageData: ", messageData);

            // 更新横幅显示
            const banner = document.getElementById('douyin-auth-banner');
            if (banner) {
              // 选中显示信息的第一个 div（在 flex 容器内）
              const companyInfo = banner.querySelector('div > div:first-child');
              if (companyInfo) {
                companyInfo.textContent = `🎵 抖音授权脚本已运行 | Company ID: ${messageData.company_id || '未知'} | Platform: ${messageData.platform_value || '未知'}`;
                console.log('[抖音授权] ✅ 横幅已更新:', companyInfo.textContent);
              } else {
                console.error('[抖音授权] ❌ 未找到横幅信息 div');
              }
            } else {
              console.error('[抖音授权] ❌ 未找到横幅元素');
            }
          }
        }
      });

      console.log('[抖音授权] ✅ 消息监听器注册成功');
    }
  }

  // ===========================
  // 6. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
  // ===========================

  // 页面加载完成后向父窗口发送消息
  console.log('[抖音授权] 页面加载完成，发送 PAGE_LOADED 消息');
  sendMessageToParent('PAGE_LOADED');

  console.log('═══════════════════════════════════════');
  console.log('✅ 抖音授权脚本初始化完成');
  console.log('📝 全局方法: window.__DOUYIN_AUTH__');
  console.log('  - notifySuccess()  : 发送授权成功消息');
  console.log('  - sendMessage(msg) : 发送自定义消息');
  console.log('  - getAuthData()    : 获取授权数据');
  console.log('  - sendAuthCode(code): 发送授权码');
  console.log('═══════════════════════════════════════');

})();

