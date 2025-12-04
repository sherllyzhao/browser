# 自定义浏览器

基于 Electron + Chromium 内核的可编程浏览器，支持 JS 注入和页面间通信。

## 功能特性

✅ **Chromium 内核** - 基于最新的 Chromium 引擎
✅ **固定首页** - 默认首页为 http://localhost:5173/
✅ **刷新功能** - 支持页面刷新
✅ **DevTools** - 内置开发者工具
✅ **JS 注入** - 为每个 URL 注入独立的自定义脚本
✅ **脚本隔离** - 每个页面的脚本独立运行，互不影响
✅ **页面通信** - 页面可以与首页自由通信

## 安装依赖

```bash
npm install
```

## 运行

```bash
npm start
```

## 使用说明

### 1. 基本导航

- **🏠 首页** - 返回���页（http://localhost:5173/）
- **◀ ▶** - 后退/前进（暂未实现，可自行扩展）
- **🔄 刷新** - 刷新当前页面
- **DevTools** - 打开开发者工具
- **地址栏** - 输入 URL 并按回车或点击"前往"按钮

### 2. JS 脚本注入

点击右上角的 **"📝 注入脚本"** 按钮打开脚本面板。

#### 脚本功能：
- **每个 URL 独立保存** - 不同页面可以有不同的注入脚本
- **自动注入** - 保存后，每次访问该 URL 都会自动执行脚本
- **立即执行** - 无需刷新，立即在当前页面执行脚本
- **脚本隔离** - 每个页面的脚本运行在独立上下文中

#### 示例脚本：

**修改页面样式**
```javascript
document.body.style.backgroundColor = '#f0f0f0';
document.body.style.filter = 'brightness(0.9)';
```

**添加自定义元素**
```javascript
const banner = document.createElement('div');
banner.textContent = '这是注入的内容！';
banner.style.cssText = `
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: #ff6b6b;
  color: white;
  text-align: center;
  padding: 10px;
  z-index: 999999;
  font-size: 16px;
`;
document.body.appendChild(banner);
```

**自动填充表单**
```javascript
// 等待页面加载完成
setTimeout(() => {
  const usernameInput = document.querySelector('input[name="username"]');
  const passwordInput = document.querySelector('input[name="password"]');

  if (usernameInput) usernameInput.value = 'myusername';
  if (passwordInput) passwordInput.value = 'mypassword';
}, 1000);
```

**监听页面事件**
```javascript
document.addEventListener('click', (e) => {
  console.log('点击了元素:', e.target);
});
```

### 3. 页面间通信

#### 从任意页面发送消息到首页：

在注入的脚本中使用：
```javascript
// 发送消息到首页
window.browserAPI.sendToHome({
  type: 'custom_event',
  data: { message: 'Hello from other page!' }
});
```

#### 在首页监听其他页面的消息：

在首页（http://localhost:5173/）中添加：
```javascript
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FROM_OTHER_PAGE') {
    console.log('收到其他页面的消息:', event.data.data);
    // 处理消息
  }
});
```

#### 完整示例 - 页面数据同步：

**在其他页面注入的脚本：**
```javascript
// 监听按钮点击
document.addEventListener('click', (e) => {
  if (e.target.tagName === 'BUTTON') {
    // 发送按钮点击信息到首页
    window.browserAPI.sendToHome({
      type: 'button_clicked',
      buttonText: e.target.textContent,
      timestamp: Date.now()
    });
  }
});
```

**在首页（http://localhost:5173/）的代码：**
```javascript
// 监听来自其他页面的消息
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FROM_OTHER_PAGE') {
    const { type, buttonText, timestamp } = event.data.data;

    if (type === 'button_clicked') {
      console.log(`按钮被点击: ${buttonText}`);
      console.log(`时间: ${new Date(timestamp).toLocaleString()}`);

      // 可以更新 UI 或执行其他操作
      updateStatistics(buttonText);
    }
  }
});

function updateStatistics(buttonText) {
  // 更新统计数据
  const statsDiv = document.getElementById('stats');
  if (statsDiv) {
    statsDiv.innerHTML += `<p>点击了: ${buttonText}</p>`;
  }
}
```

## 技术架构

- **主进程（main.js）** - 管理窗口、BrowserView、IPC 通信
- **控制面板（index.html + renderer.js）** - 浏览器控制 UI
- **内容页面（BrowserView）** - 显示实际网页内容
- **Preload 脚本** - 安全的页面与主进程通信桥梁

## 注意事项

1. **脚本持久化** - 当前脚本保存在内存中，关闭应用后会丢失。如需持久化，可以将 `injectedScripts` 保存到文件。
2. **脚本安全** - 注入的脚本拥有完整的页面权限，请谨慎使用。
3. **跨域限制** - 页面通信遵循浏览器的安全策略。
4. **首页地址** - 默认首页是 `http://localhost:5173/`，可在 `main.js` 中修改 `HOME_URL` 常量。

## 扩展建议

- 添加历史记录功能
- 实现书签管理
- 支持多标签页
- 脚本持久化存储（保存到文件或数据库）
- 添加脚本模板库
- 实现脚本市场（分享和下载脚本）

## License

MIT
