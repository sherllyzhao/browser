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

#### waitForElement(selector, timeout, checkInterval, ele)
等待指定元素出现，返回第一个匹配的元素

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

**特殊语法 - 类名模糊匹配**（用于 CSS Modules 等随机后缀类名）：

```javascript
// class^=prefix  前缀匹配
// 匹配 class="editor_container-abc123" 等以 editor_container 开头的类名
const editor = await waitForElement('class^=editor_container');

// class*=substr  包含匹配
// 匹配 class="xxx-editor-yyy" 等包含 editor 的类名
const editor = await waitForElement('class*=editor');

// class$=suffix  后缀匹配
// 匹配 class="xxx_container" 等以 _container 结尾的类名
const container = await waitForElement('class$=_container');
```

参数：
- `selector` (string | function): CSS 选择器、特殊语法或返回元素的函数
- `timeout` (number): 超时时间（毫秒），默认 30000
- `checkInterval` (number): 检查间隔（毫秒），默认 200
- `ele` (Element): 在哪个元素下查找，默认 document

#### waitForElements(selector, timeout, checkInterval, ele, minCount)
等待指定元素出现，返回所有匹配的元素数组

```javascript
// 返回所有匹配的按钮
const buttons = await waitForElements('.btn');
console.log(buttons); // [button1, button2, button3, ...]

// 使用特殊语法匹配所有带随机后缀的元素
const editors = await waitForElements('class^=editor_container');

// 指定最少需要找到的数量（第5个参数）
// 至少找到 3 个元素才 resolve，否则超时报错
const items = await waitForElements('.list-item', 30000, 200, document, 3);
```

参数：
- `selector` (string | function): CSS 选择器、特殊语法或返回元素数组的函数
- `timeout` (number): 超时时间（毫秒），默认 30000
- `checkInterval` (number): 检查间隔（毫秒），默认 200
- `ele` (Element): 在哪个元素下查找，默认 document
- `minCount` (number): 最少需要找到的元素数量，默认 1

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

#### delay(ms)
延迟执行（Promise 包装的 setTimeout）

```javascript
// 等待 2 秒
await delay(2000);
```

参数：
- `ms` (number): 延迟时间（毫秒）

#### createErrorListener(options)
创建错误监听器实例，用于捕获页面上的错误提示（toast/message 等）

```javascript
// 方式1：使用预定义配置（推荐）
const errorListener = createErrorListener(ERROR_LISTENER_CONFIGS.tengxun);

// 方式2：自定义配置
const errorListener = createErrorListener({
  logPrefix: '[我的平台]',
  selectors: [
    { containerClass: 'my-toast', textSelector: '.toast-text' },
    { containerClass: 'el-message--error', textSelector: '.el-message__content', recursiveSelector: '.el-message.el-message--error' }
  ],
  ignoredMessages: ['正在上传', '加载中', '成功']  // 可选，有默认值
});

// 启动监听
errorListener.start();

// ... 执行操作 ...

// 获取最新的错误信息（已过滤掉成功消息等）
const error = errorListener.getLatestError();
if (error) {
  console.log('发现错误:', error);
}

// 获取所有捕获的错误
const allErrors = errorListener.getErrors();

// 清空错误列表
errorListener.clear();

// 停止监听
errorListener.stop();
```

参数：
- `options.logPrefix` (string): 日志前缀，如 `'[搜狐号发布]'`
- `options.selectors` (Array): 选择器配置数组，每项包含：
  - `containerClass` (string): 容器类名（用于 classList.includes 检测）
  - `textSelector` (string): 文本元素选择器
  - `recursiveSelector` (string): 可选，递归查找的选择器
- `options.ignoredMessages` (Array): 可选，要忽略的消息列表，默认包含 `['正在上传', '加载中', '处理中', '成功', ...]`

返回的实例方法：
- `start()`: 启动监听
- `stop()`: 停止监听
- `getLatestError()`: 获取最新的错误信息（已过滤）
- `getErrors()`: 获取所有捕获的错误
- `clear()`: 清空错误列表

#### ERROR_LISTENER_CONFIGS
预定义的平台错误监听器配置

```javascript
// 可用的配置：
ERROR_LISTENER_CONFIGS.sohu       // 搜狐号
ERROR_LISTENER_CONFIGS.tengxun    // 腾讯号
ERROR_LISTENER_CONFIGS.baijiahao  // 百家号
ERROR_LISTENER_CONFIGS.douyin     // 抖音
ERROR_LISTENER_CONFIGS.xiaohongshu // 小红书
ERROR_LISTENER_CONFIGS.wangyi     // 网易号

// 使用示例
const errorListener = createErrorListener(ERROR_LISTENER_CONFIGS.sohu);
errorListener.start();
// ... 执行操作 ...
const error = errorListener.getLatestError();
errorListener.stop();
```

#### parseMessageData(data, logPrefix)
解析消息数据（字符串或对象均可）

```javascript
// 自动处理字符串和对象格式
const messageData = parseMessageData(message.data, '[搜狐号发布]');
if (!messageData) return; // 解析失败时返回 null
```

参数：
- `data` (Object|string): 消息数据（字符串会自动 JSON.parse）
- `logPrefix` (string): 日志前缀，如 `'[搜狐号发布]'`

返回值：
- 成功：解析后的对象
- 失败：`null`

#### checkWindowIdMatch(message, logPrefix)
检查窗口 ID 是否匹配（防止消息发送到错误的窗口）

```javascript
const isMatch = await checkWindowIdMatch(message, '[搜狐号发布]');
if (!isMatch) return; // 消息不是发给当前窗口的
```

参数：
- `message` (Object): 消息对象，包含 `windowId` 字段
- `logPrefix` (string): 日志前缀

返回值：
- `true`: 匹配（或消息无 windowId 限制）
- `false`: 不匹配

#### restoreSessionAndReload(messageData, logPrefix)
恢复会话数据并刷新页面

```javascript
// 如果 messageData 包含 cookies，会自动恢复并刷新
const needReload = await restoreSessionAndReload(messageData, '[搜狐号发布]');
if (needReload) return; // 已触发刷新，脚本会重新注入
```

参数：
- `messageData` (Object): 发布数据（包含 `cookies` 字段时会触发恢复）
- `logPrefix` (string): 日志前缀

返回值：
- `true`: 已触发刷新，调用方应立即 `return`
- `false`: 未刷新（无 cookies 或恢复失败）

工作流程：
1. 检测是否有 `cookies` 数据
2. 调用 `browserAPI.restoreSessionData` 恢复会话
3. 保存消息数据到全局存储（刷新后继续使用）
4. 触发 `window.location.reload()`

#### loadPublishDataFromGlobalStorage(logPrefix)
从全局存储加载发布数据（刷新页面后使用）

```javascript
// 页面刷新后，从全局存储恢复发布数据
const publishData = await loadPublishDataFromGlobalStorage('[搜狐号发布]');
if (publishData) {
  // 继续处理发布流程
  await fillFormData(publishData);
}
```

参数：
- `logPrefix` (string): 日志前缀

返回值：
- 有数据：发布数据对象（并自动清除存储，避免重复处理）
- 无数据：`null`

#### getCurrentWindowId(logPrefix)
获取当前窗口 ID 并记录日志

```javascript
const windowId = await getCurrentWindowId('[搜狐号发布]');
if (!windowId) {
  console.error('无法获取窗口 ID');
}
```

参数：
- `logPrefix` (string): 日志前缀

返回值：
- 成功：窗口 ID（number 或 string）
- 失败：`null`

### 发布脚本消息处理完整示例

使用上述公共方法后，消息处理代码大幅简化：

```javascript
window.browserAPI.onMessageFromHome(async (message) => {
    if (message.type === 'publish-data') {
        const logPrefix = '[搜狐号发布]';

        // 1. 解析消息数据
        const messageData = parseMessageData(message.data, logPrefix);
        if (!messageData) return;

        // 2. 检查窗口 ID 是否匹配
        const isMatch = await checkWindowIdMatch(message, logPrefix);
        if (!isMatch) return;

        // 3. 恢复会话数据（如需要）
        const needReload = await restoreSessionAndReload(messageData, logPrefix);
        if (needReload) return;

        // 4. 处理发布逻辑
        await fillFormData(messageData);
    }
});

// 页面刷新后恢复数据
const publishData = await loadPublishDataFromGlobalStorage('[搜狐号发布]');
if (publishData) {
    await fillFormData(publishData);
}
```

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
