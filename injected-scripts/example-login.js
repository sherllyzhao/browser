// 这是 example.com/login 页面注入的脚本示例
console.log('✅ example-login.js 已注入到登录页');

// 示例：自动填充登录表单
(function() {
  console.log('正在查找登录表单...');

  // 等待页面加载完成
  const autoFillLogin = () => {
    // 查找用户名和密码输入框
    const usernameInput = document.querySelector('input[name="username"], input[type="email"], input[id*="username"], input[id*="email"]');
    const passwordInput = document.querySelector('input[type="password"]');

    if (usernameInput && passwordInput) {
      console.log('找到登录表单');

      // 添加一个自动填充按钮
      const fillButton = document.createElement('button');
      fillButton.textContent = '🔧 自动填充测试数据';
      fillButton.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        padding: 10px 20px;
        background: #4CAF50;
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        z-index: 10000;
        font-size: 14px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      `;

      fillButton.onclick = () => {
        usernameInput.value = 'test@example.com';
        passwordInput.value = 'test123456';
        console.log('已填充测试数据');
      };

      document.body.appendChild(fillButton);
    } else {
      console.log('未找到登录表单');
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoFillLogin);
  } else {
    autoFillLogin();
  }
})();
