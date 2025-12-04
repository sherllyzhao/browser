# 如何在注入脚本中使用 common.js

## 概述

由于注入脚本**不能使用 ES6 的 `import`**，我们通过**依赖注入**的方式来共享代码：

1. `common.js` 会**先**注入到页面中
2. 其他脚本（如 `douyin-creator.js`）**后**注入
3. 后注入的脚本可以直接使用 `common.js` 中定义的**全局函数**

## 配置方法

### 1. 修改 `scripts-config.json`

```json
{
  "scripts": {
    "https://creator.douyin.com/*": ["common.js", "douyin-creator.js"]
  }
}
```

**数组顺序很重要！** 前面的脚本会先注入，后面的脚本可以使用前面脚本定义的函数。

### 2. `common.js` 中可用的函数

#### waitForElement(selector, timeout, checkInterval)
等待指定元素出现

```javascript
// 示例：等待登录按钮出现
waitForElement('.login-button', 30000, 200)
  .then(button => {
    console.log('按钮找到了!', button);
    button.click();
  })
  .catch(err => {
    console.error('按钮没找到:', err);
  });

// 也支持函数选择器
waitForElement(() => {
  return document.querySelector('.dynamic-element');
}, 10000);
```

参数：
- `selector` (string | function): CSS 选择器或返回元素的函数
- `timeout` (number): 超时时间（毫秒），默认 30000
- `checkInterval` (number): 检查间隔（毫秒），默认 200

#### retryOperation(operation, maxRetries, delay)
重试机制，自动重试失败的操作

```javascript
// 示例：重试 API 请求
async function fetchData() {
  const response = await fetch('/api/data');
  if (!response.ok) throw new Error('请求失败');
  return response.json();
}

retryOperation(fetchData, 3, 1000)
  .then(data => console.log('数据获取成功:', data))
  .catch(err => console.error('重试 3 次后仍失败:', err));
```

参数：
- `operation` (function): 要执行的异步函数
- `maxRetries` (number): 最大重试次数，默认 3
- `delay` (number): 每次重试的延迟（毫秒），默认 1000（会递增）

## 使用示例

### 示例 1: 等待授权按钮并点击

```javascript
// douyin-creator.js

(function() {
  'use strict';

  // 检查 common.js 是否加载
  if (typeof waitForElement === 'undefined') {
    console.error('common.js 未加载！');
    return;
  }

  console.log('开始等待授权按钮...');

  waitForElement('.auth-confirm-button', 10000)
    .then(button => {
      console.log('找到授权按钮，准备点击');
      button.click();

      // 等待授权成功提示
      return waitForElement('.success-message', 5000);
    })
    .then(successMsg => {
      console.log('授权成功!');
      window.browserAPI.sendToHome({ type: 'auth-success' });
    })
    .catch(err => {
      console.error('授权流程失败:', err);
    });
})();
```

### 示例 2: 重试网络请求

```javascript
// douyin-creator.js

(function() {
  'use strict';

  // 发送授权码到后端
  async function sendAuthCode(code) {
    const response = await fetch('/api/douyin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  }

  // 从 URL 获取 code 参数
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');

  if (code) {
    console.log('检测到授权码:', code);

    // 使用 retryOperation 重试发送（最多重试 3 次）
    retryOperation(() => sendAuthCode(code), 3, 2000)
      .then(result => {
        console.log('授权码发送成功:', result);
        window.browserAPI.sendToHome({ type: 'auth-success' });
      })
      .catch(err => {
        console.error('发送授权码失败（已重试 3 次）:', err);
        window.browserAPI.sendToHome({ type: 'auth-failed', error: err.message });
      });
  }
})();
```

### 示例 3: 组合使用

```javascript
// douyin-creator.js

(function() {
  'use strict';

  // 授权流程
  async function doAuth() {
    // 1. 等待登录按钮出现
    console.log('[1/4] 等待登录按钮...');
    const loginBtn = await waitForElement('.login-button', 10000);
    loginBtn.click();

    // 2. 等待用户名输入框
    console.log('[2/4] 等待输入框...');
    const usernameInput = await waitForElement('input[name="username"]', 5000);
    usernameInput.value = 'test@example.com';

    // 3. 提交表单
    console.log('[3/4] 提交表单...');
    const submitBtn = await waitForElement('button[type="submit"]', 3000);
    submitBtn.click();

    // 4. 等待授权成功
    console.log('[4/4] 等待授权结果...');
    await waitForElement('.success-indicator', 10000);

    console.log('✅ 授权成功!');
    return true;
  }

  // 启动授权流程（带重试）
  retryOperation(doAuth, 2, 3000)
    .then(() => {
      window.browserAPI.sendToHome({ type: 'auth-success' });
    })
    .catch(err => {
      console.error('授权失败:', err);
      window.browserAPI.sendToHome({ type: 'auth-failed', error: err.message });
    });
})();
```

## 添加新的公共函数

如果你想在 `common.js` 中添加新的工具函数：

```javascript
// common.js

// 添加新函数
function clickElement(selector) {
  return waitForElement(selector).then(el => {
    el.click();
    console.log('已点击:', selector);
    return el;
  });
}

function fillInput(selector, value) {
  return waitForElement(selector).then(input => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    console.log('已填充:', selector, '=', value);
    return input;
  });
}
```

然后在其他脚本中直接使用：

```javascript
// douyin-creator.js

clickElement('.agree-checkbox')
  .then(() => fillInput('#username', 'test@example.com'))
  .then(() => clickElement('.submit-button'))
  .then(() => console.log('操作完成'));
```

## 调试技巧

### 1. 检查脚本加载顺序

在页面控制台查看：

```javascript
// 应该先看到 common.js 的日志
// ===== common.js =====
// 然后看到
// ===== douyin-creator.js =====
```

### 2. 验证函数可用性

```javascript
// 在 douyin-creator.js 中添加检查
if (typeof waitForElement === 'undefined') {
  console.error('❌ common.js 未加载！');
} else {
  console.log('✅ common.js 已加载');
  console.log('可用函数:', typeof waitForElement, typeof retryOperation);
}
```

### 3. 查看注入的脚本内容

主进程日志会显示：

```
[ScriptManager] 加载脚本: ['common.js', 'douyin-creator.js']
[ScriptManager] ✓ 已加载: common.js (2462 chars)
[ScriptManager] ✓ 已加载: douyin-creator.js (5127 chars)
```

## 常见问题

### Q: 为什么不能用 `import`？

A: 注入脚本是通过 `executeJavaScript()` 执行的普通脚本，不是 ES6 模块。ES6 的 `import` 只能在 `<script type="module">` 中使用。

### Q: 可以使用多个依赖吗？

A: 可以！在配置文件中使用数组：

```json
{
  "scripts": {
    "https://example.com/*": ["utils.js", "common.js", "main.js"]
  }
}
```

它们会按顺序注入。

### Q: 依赖脚本可以相互调用吗？

A: 可以！只要确保被调用的脚本在前面注入：

```json
["base-utils.js", "advanced-utils.js", "main.js"]
```

- `advanced-utils.js` 可以使用 `base-utils.js` 的函数
- `main.js` 可以使用前两个脚本的所有函数

## 总结

✅ **推荐方案**：使用脚本数组配置，自动按顺序注入依赖
- 修改 `scripts-config.json` 使用数组格式
- 无需修改代码，直接使用全局函数
- 易于维护和扩展

❌ **不推荐**：
- 复制粘贴代码到每个文件（难以维护）
- 使用 `import`（不支持）
- 手动合并文件（容易出错）
