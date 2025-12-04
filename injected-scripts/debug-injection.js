/**
 * 调试脚本 - 用于测试脚本注入是否成功
 * 这个脚本会在页面加载时显示一个明显的提示
 */

(function() {
  console.log('═══════════════════════════════════════');
  console.log('🎯 调试脚本已成功注入！');
  console.log('📍 当前 URL:', window.location.href);
  console.log('🕐 注入时间:', new Date().toLocaleString());
  console.log('═══════════════════════════════════════');

  // 在页面上显示一个明显的提示框
  const debugDiv = document.createElement('div');
  debugDiv.id = 'script-injection-debug';
  debugDiv.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 15px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    z-index: 999999;
    font-family: 'Consolas', monospace;
    font-size: 14px;
    max-width: 400px;
  `;
  debugDiv.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 8px;">✅ 脚本注入成功</div>
    <div style="font-size: 12px; opacity: 0.9;">
      <div>URL: ${window.location.hostname}</div>
      <div>时间: ${new Date().toLocaleTimeString()}</div>
    </div>
    <button onclick="this.parentElement.remove()" style="
      margin-top: 10px;
      background: rgba(255,255,255,0.2);
      border: 1px solid rgba(255,255,255,0.3);
      color: white;
      padding: 5px 15px;
      border-radius: 4px;
      cursor: pointer;
    ">关闭</button>
  `;

  // 等待 DOM 加载完成再插入
  if (document.body) {
    document.body.appendChild(debugDiv);
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      document.body.appendChild(debugDiv);
    });
  }

  // 3 秒后自动隐藏
  setTimeout(() => {
    if (debugDiv.parentElement) {
      debugDiv.style.opacity = '0.3';
      debugDiv.style.transition = 'opacity 0.5s';
    }
  }, 3000);

  // 检查 URL 参数
  const urlParams = new URLSearchParams(window.location.search);
  console.log('📋 URL 参数:');
  for (const [key, value] of urlParams.entries()) {
    console.log(`  ${key}: ${value}`);
  }

  // 检查 browserAPI 是否可用
  if (window.browserAPI) {
    console.log('✅ browserAPI 可用');
    console.log('  - openNewWindow:', typeof window.browserAPI.openNewWindow);
    console.log('  - sendToHome:', typeof window.browserAPI.sendToHome);
  } else {
    console.log('❌ browserAPI 不可用');
  }

})();
