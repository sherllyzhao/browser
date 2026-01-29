# 运营助手浏览器

基于 Electron + Chromium 内核的可编程浏览器，支持 JS 注入、页面间通信和多账号管理，专为自媒体运营场景设计。

## 功能特性

- **Chromium 内核** - 基于最新的 Chromium 引擎
- **Session 持久化** - 登录状态自动保存，重启后保持登录
- **JS 注入** - 根据 URL 自动注入自定义脚本
- **页面通信** - 首页与子窗口双向通信
- **多账号管理** - 每个平台支持多账号独立 Session
- **全局数据存储** - 跨页面持久化数据存储

## 支持平台

| 平台 | 授权 | 发布 |
|------|------|------|
| 抖音 | ✅ | ✅ |
| 小红书 | ✅ | ✅ |
| 视频号 | ✅ | ✅ |
| 百家号 | ✅ | ✅ |
| 网易号 | ✅ | ✅ |
| 腾讯内容开放平台 | ✅ | ✅ |
| 搜狐号 | ✅ | ✅ |
| 知乎 | ✅ | ✅ |

## 安装与运行

```bash
# 安装依赖
npm install

# 开发环境运行（需要先启动父级 Vue 项目）
npm start

# 打包生产版本
npm run build

# 打包便携版
npm run build:portable
```

## 环境区分

| 环境 | 判断条件 | 首页地址 |
|------|----------|----------|
| 开发环境 | `npm start` 运行 | `http://localhost:5173/` |
| 生产环境 | 打包后运行 | `https://dev.china9.cn/aigc_browser/` |

## 目录结构

```
D:\浏览器\运营助手\
├── main.js                 # 主进程
├── preload.js              # 控制面板预加载脚本
├── content-preload.js      # 内容页面预加载脚本（暴露 browserAPI）
├── index.html              # 控制面板界面
├── login.html              # 登录页面
├── not-available.html      # 功能未开放页面
├── script-manager.js       # 脚本管理器
└── injected-scripts/       # 注入脚本目录
    ├── scripts-config.json # URL → 脚本映射配置
    ├── common.js           # 公共工具函数
    ├── *-creator.js        # 各平台授权脚本
    └── *-publish.js        # 各平台发布脚本
```

## 数据存储路径

| 版本 | 存储位置 |
|------|----------|
| 开发/安装版 | `%APPDATA%\运营助手\` |
| 便携版 | `%LOCALAPPDATA%\运营助手-Portable\` |

```
运营助手\
├── global-storage.json              # 全局数据（token、用户信息等）
└── Partitions\browserview\          # 持久化 Session
    ├── Network\Cookies              # 第三方平台 Cookies
    ├── Local Storage\               # localStorage 数据
    └── IndexedDB\                   # IndexedDB 数据
```

## 核心 API

所有 API 通过 `window.browserAPI` 调用。

### 页面通信

```javascript
// 子窗口 → 首页
window.browserAPI.sendToHome({ type: 'event', data: {...} });

// 首页监听子窗口消息
window.browserAPI.onMessageFromOtherPage((message) => { ... });

// 首页 → 子窗口
window.browserAPI.sendToOtherPage({ type: 'config', data: {...} });

// 子窗口监听首页消息
window.browserAPI.onMessageFromHome((message) => { ... });
```

### 窗口管理

```javascript
// 打开新窗口（持久化 Session）
const result = await window.browserAPI.openNewWindow('https://example.com');

// 打开授权窗口（临时 Session）
const result = await window.browserAPI.openNewWindow(url, {
  useTemporarySession: true
});

// 打开多账号发布窗口
const result = await window.browserAPI.openNewWindow(url, {
  platform: 'douyin',
  accountId: 'douyin_xxx_1',
  sessionData: sessionDataFromBackend  // 可选，自动恢复会话
});

// 获取窗口 ID
const windowId = await window.browserAPI.getWindowId();

// 关闭当前窗口
await window.browserAPI.closeCurrentWindow();

// 监听窗口加载完成
window.browserAPI.onWindowLoaded((data) => {
  console.log('窗口加载完成:', data.url, data.windowId);
});
```

### 全局数据存储

```javascript
// 存储数据（持久化到文件）
await window.browserAPI.setGlobalData('key', value);

// 获取数据
const value = await window.browserAPI.getGlobalData('key');

// 删除数据
await window.browserAPI.removeGlobalData('key');

// 获取所有数据
const allData = await window.browserAPI.getAllGlobalData();
```

### Session 管理

```javascript
// 检查 Session 状态
const status = await window.browserAPI.checkSessionStatus();
// 返回: { hasSession, cookieCount, platforms: { douyin: { count, loggedIn }, ... } }

// 获取完整会话数据（用于存储到后台）
const result = await window.browserAPI.getFullSessionData('douyin.com');

// 迁移临时 Session 到持久化（授权成功后调用）
await window.browserAPI.migrateCookiesToPersistent('douyin.com');

// 清除指定域名 Cookies
await window.browserAPI.clearDomainCookies('douyin.com');

// 设置跨域 Cookie
await window.browserAPI.setCookie({
  name: 'token',
  value: 'xxx',
  domain: '.china9.cn',
  expirationDate: Math.floor(Date.now() / 1000) + 86400
});
```

### 多账号管理

```javascript
// 获取账号列表
const accounts = await window.browserAPI.getAccounts('douyin');

// 添加账号
const result = await window.browserAPI.addAccount('douyin', {
  nickname: '昵称',
  avatar: '头像URL',
  platformUid: '平台用户ID'
});

// 删除账号
await window.browserAPI.removeAccount('douyin', 'douyin_xxx_1');

// 检查账号登录状态
const status = await window.browserAPI.checkAccountLoginStatus('douyin', 'douyin_xxx_1');

// 获取当前窗口账号信息（发布脚本中使用）
const info = await window.browserAPI.getCurrentAccount();
```

### 其他 API

```javascript
// 获取主窗口 URL（用于构建 API 地址）
const mainInfo = await window.browserAPI.getMainUrl();
// 返回: { success, url, origin, host, protocol }

// 跳转到本地页面
await window.browserAPI.navigateToLocalPage('not-available.html');

// 监听 Cookies 清除事件
window.browserAPI.onCookiesCleared((data) => { ... });
```

## 脚本注入

### 配置文件

`injected-scripts/scripts-config.json`:

```json
{
  "scripts": {
    "https://creator.douyin.com/creator-micro/home": ["common.js", "douyin-creator.js"],
    "https://www.example.com/*": ["common.js", "example.js"]
  }
}
```

- URL 支持 `*` 通配符
- 数组中的脚本按顺序注入，前面的可被后面的调用

### common.js 工具函数

```javascript
// 等待元素出现
await waitForElement('.button', 10000);

// 等待多个元素
await waitForElements(['.btn1', '.btn2'], 10000);

// 重试操作
await retryOperation(async () => await fetch('/api'), 3, 1000);

// 发送消息到父窗口
sendMessageToParent('授权成功');

// 上传文件到 input
await uploadFileToInput(fileInput, file);

// 延迟
await delay(1000);
```

## 授权流程示例

```javascript
// 1. 父窗口打开授权窗口
const result = await window.browserAPI.openNewWindow(authUrl, {
  useTemporarySession: true
});

// 2. 授权脚本检测登录成功后
const sessionData = await window.browserAPI.getFullSessionData('douyin.com');
await window.browserAPI.migrateCookiesToPersistent('douyin.com');
sendMessageToParent('授权成功，刷新数据');
window.browserAPI.closeCurrentWindow();
```

## 发布流程示例

```javascript
// 1. 父窗口打开发布窗口
const result = await window.browserAPI.openNewWindow(publishUrl, {
  platform: 'douyin',
  accountId: 'douyin_xxx_1',
  sessionData: sessionDataFromBackend
});

// 存储发布数据
await window.browserAPI.setGlobalData(`publish_data_window_${result.windowId}`, publishData);

// 2. 发布脚本读取数据
const windowId = await window.browserAPI.getWindowId();
const publishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
```

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Alt+C` | 清除所有 Cookies |

## 常见问题

### 页面空白

删除缓存目录后重启：
```
%APPDATA%\运营助手\Partitions\browserview\Cache
```

### Electron 安装失败

```bash
rm -rf node_modules
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

### 开发环境需要先启动 Vue 项目

```bash
cd E:\项目\资海云\视频剪辑\ai-media-edit
npm run dev
```

## License

MIT
