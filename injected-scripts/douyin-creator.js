/**
 * 抖音创作者平台授权脚本
 * 用于处理授权流程和数据传输
 */

(function() {
  'use strict';

  console.log('═══════════════════════════════════════');
  console.log('✅ 抖音授权脚本已注入');
  console.log('📍 当前 URL:', window.location.href);
  console.log('🕐 注入时间:', new Date().toLocaleString());
  console.log('═══════════════════════════════════════');

  // ===========================
  // 1. 获取传递的数据
  // ===========================

  const urlParams = new URLSearchParams(window.location.search);
  const companyId = urlParams.get('company_id');
  const transferId = urlParams.get('transfer_id');
  const platform = urlParams.get('platform');

  console.log('[抖音授权] 接收到的参数:');
  console.log('  - Company ID:', companyId);
  console.log('  - Transfer ID:', transferId);
  console.log('  - Platform:', platform);

  // 存储到全局变量
  window.__AUTH_DATA__ = {
    company_id: companyId,
    transfer_id: transferId,
    platform: platform
  };

  // 如果有 transferId，尝试从 IndexedDB 获取完整数据
  if (transferId && window.indexedDB) {
    // 这里可以使用 dataTransfer 工具获取大数据
    console.log('[抖音授权] 检测到 Transfer ID，可以获取完整数据');
  }

  // ===========================
  // 2. 发送消息到父窗口的辅助函数
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
  // 5. 页面加载完成向父窗口发送消息
  // ===========================

  // 页面加载完成后向父窗口发送消息
  console.log('[抖音授权] 页面加载完成，发送 PAGE_LOADED 消息');
  sendMessageToParent('PAGE_LOADED');

  // ===========================
  // 6. 接收来自父窗口的消息
  // ===========================

  window.addEventListener('message', (event) => {
    // 安全检查：只接受来自 localhost:5173 的消息
    const allowedOrigins = ['http://localhost:5173', 'https://localhost:5173'];

    if (!allowedOrigins.includes(event.origin)) {
      return;
    }

    console.log('[抖音授权] 收到父窗口消息:', event.data);

    // 处理不同类型的消息
    if (event.data && typeof event.data === 'object') {
      switch (event.data.type) {
        case 'CHECK_STATUS':
          // 父窗口询问状态
          sendMessageToParent({
            type: 'STATUS_RESPONSE',
            authorized: !!urlParams.get('code')
          });
          break;

        case 'CLOSE_WINDOW':
          // 父窗口要求关闭
          window.close();
          break;
      }
    }
  });

  console.log('═══════════════════════════════════════');
  console.log('✅ 抖音授权脚本初始化完成');
  console.log('📝 全局方法: window.__DOUYIN_AUTH__');
  console.log('  - notifySuccess()  : 发送授权成功消息');
  console.log('  - sendMessage(msg) : 发送自定义消息');
  console.log('  - getAuthData()    : 获取授权数据');
  console.log('  - sendAuthCode(code): 发送授权码');
  console.log('═══════════════════════════════════════');

})();

