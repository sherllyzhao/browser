// 这是 short-video/auth 页面注入的脚本
console.log('✅ auth.js 已注入到 short-video/auth 页面');
console.log('[授权页面] 当前 URL:', window.location.href);
console.log('[授权页面] browserAPI 是否可用:', !!window.browserAPI);

// 发送授权成功消息到首页
function sendAuthSuccessMessage() {
  console.log('='.repeat(60));
  console.log('[授权页面] 🚀 准备发送授权成功消息');
  console.log('[授权页面] 当前 URL:', window.location.href);
  console.log('[授权页面] browserAPI 可用性:', {
    browserAPI: !!window.browserAPI,
    sendToHome: !!window.browserAPI?.sendToHome
  });

  // 方式 1: 使用 browserAPI(运营助手浏览器)
  if (window.browserAPI?.sendToHome) {
    try {
      const message = { type: 'auth-success', timestamp: Date.now() };
      console.log('[授权页面] 📤 发送消息内容:', message);
      window.browserAPI.sendToHome(message);
      console.log('[授权页面] ✅ 已通过 browserAPI.sendToHome 发送消息');
    } catch (e) {
      console.error('[授权页面] ❌ browserAPI.sendToHome 失败:', e);
    }
  } else {
    console.warn('[授权页面] ⚠️ browserAPI.sendToHome 不可用');
  }

  // 方式 2: 使用 postMessage (兜底方案)
  try {
    window.parent.postMessage('授权成功', '*');
    console.log('[授权页面] ✅ 已通过 postMessage 发送消息');
  } catch (e) {
    console.error('[授权页面] ❌ postMessage 失败:', e);
  }

  console.log('='.repeat(60));
}

// 示例: 在页面顶部添加一个提示条
(function() {
  const banner = document.createElement('div');
  banner.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 10px;
    text-align: center;
    font-family: Arial, sans-serif;
    z-index: 10000;
    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
  `;
  banner.textContent = '🚀 授权页面已加载 - auth.js';

  // 等待 DOM 加载完成
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.appendChild(banner);
    });
  } else {
    document.body.appendChild(banner);
  }
})();

// 监听授权成功事件
// 你需要根据实际的授权流程来触发 sendAuthSuccessMessage()
// 这里提供几种常见的触发方式:

// 方式1: 监听 URL 变化(如果授权成功后 URL 会变化)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('status') === 'success' || urlParams.get('code')) {
  console.log('[授权页面] 检测到授权成功参数');
  setTimeout(() => {
    sendAuthSuccessMessage();
  }, 500);
}

// 方式2: 监听页面上的特定元素或事件
// 例如: 授权成功后页面会显示特定的元素
const observer = new MutationObserver(() => {
  // 检查是否有授权成功的标识(需要根据实际页面调整选择器)
  const successElement = document.querySelector('.auth-success, .success-message, [data-auth-status="success"]');
  if (successElement) {
    console.log('[授权页面] 检测到授权成功元素:', successElement);
    sendAuthSuccessMessage();
    observer.disconnect(); // 停止观察
  }
});

// 开始观察 DOM 变化
if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
} else {
  window.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

// 方式3: 暴露全局方法供手动调用
window.__sendAuthSuccess__ = sendAuthSuccessMessage;
console.log('[授权页面] 全局方法已暴露: window.__sendAuthSuccess__()');
console.log('[授权页面] 你可以在控制台手动调用此方法来测试发送消息');
