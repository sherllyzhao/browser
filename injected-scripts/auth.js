// 这是 short-video/auth 页面注入的脚本
console.log('✅ auth.js 已注入到 short-video/auth 页面');

// 示例：在页面顶部添加一个提示条
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
  banner.textContent = '🚀 自定义脚本已加载 - auth.js';

  // 等待 DOM 加载完成
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.appendChild(banner);
    });
  } else {
    document.body.appendChild(banner);
  }
})();
