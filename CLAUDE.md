# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

There's a file modification bug in Claude Code. The workaround is: always use complete absolute Windows paths with drive letters and backslashes for ALL file operations. Apply this rule going forward, not just for this file.

父级的授权页面的项目在E:\项目\资海云\视频剪辑\ai-media-edit\src\views\short-video\components\AddAccount.vue
父级的有关视频发布页面的项目在E:\项目\资海云\视频剪辑\ai-media-edit\src\views\short-video\components\PublishVideo.vue
父级的有关文章发布页面的项目在E:\项目\资海云\视频剪辑\ai-media-edit\src\views\short-video\components\PublishArticle.vue

user-agent是对的，不要改

所有带-creator.js的文件是授权的注入脚本
所有带-publish.js的文件是发布的注入脚本

## Project Overview

This is a custom Electron-based programmable browser with Chromium engine, featuring JavaScript injection and inter-page communication capabilities. The browser is designed for automation, testing, and operational tasks with a fixed homepage at `http://localhost:5173/`.

## Common Commands

```bash
# Install dependencies
npm install

# Run the browser
npm start
```

## Architecture

### Multi-Process Structure

The application uses Electron's multi-process architecture:

1. **Main Process** (`main.js`) - Controls the application lifecycle, manages windows, BrowserView, and IPC communication
2. **Control Panel** (`index.html` + `renderer.js`) - The browser UI with navigation controls and script editor
3. **Content Pages** (BrowserView) - Displays actual web pages using persistent session
4. **Preload Scripts** - Security bridges between processes:
   - `preload.js` - Exposes APIs to the control panel (electronAPI)
   - `content-preload.js` - Exposes APIs to content pages (browserAPI)

### Key Components

**Session Persistence** (main.js:84-92)
- Uses `session.fromPartition('persist:browserview')` for persistent cookies and storage
- Custom User-Agent: `zh.Cloud-browse`
- Auto-saves session data every 30 seconds
- Converts session cookies to persistent cookies on window close

**Script Injection System** (script-manager.js)
- Manages JavaScript injection per URL
- Scripts stored in `injected-scripts/` directory
- Supports URL pattern matching with wildcards (e.g., `http://localhost:5173/*`)
- Two loading methods:
  1. Manual: Via browser UI script editor
  2. Automatic: Via `injected-scripts/scripts-config.json` configuration file
- Scripts execute on `did-finish-load` and `did-navigate-in-page` events

**BrowserView Layout** (main.js:170-175)
- Top 60px reserved for toolbar
- Right 400px reserved when script panel is open
- Dynamically adjusts when script panel toggles

## Script Injection Workflow

1. **Configuration Loading** (script-manager.js:39-75)
   - On startup, loads `injected-scripts/scripts-config.json`
   - Maps URLs to script files (e.g., `{"http://localhost:5173/": "auth.js"}`)
   - Scripts from config marked with `source: 'config'`

2. **Script Execution** (main.js:113-140)
   - When page loads, checks URL against saved scripts
   - Supports exact match and wildcard pattern matching
   - Executes via `browserView.webContents.executeJavaScript()`

3. **SPA Routing** (main.js:153-158)
   - Re-injects scripts on `did-navigate-in-page` for hash/path changes
   - Ensures scripts work with single-page applications

## Inter-Page Communication

Three communication channels are available:

### 1. Other Pages → Homepage
```javascript
// From any non-homepage page
window.browserAPI.sendToHome({ type: 'event', data: {...} });

// On homepage (http://localhost:5173/)
window.browserAPI.onMessageFromOtherPage((message) => { ... });
```

### 2. Homepage → Other Pages
```javascript
// From homepage
window.browserAPI.sendToOtherPage({ type: 'config', data: {...} });

// On other pages
window.browserAPI.onMessageFromHome((message) => { ... });
```

### 3. Control Panel → Content Pages
```javascript
// From control panel (renderer.js)
window.electronAPI.sendToContent({ command: 'action' });

// On content pages
window.browserAPI.onMessageFromMain((message) => { ... });
```

**Implementation Note**: Communication uses IPC between processes, then `postMessage` for final delivery to page context. Homepage is identified by exact URL match: `http://localhost:5173/`.

### 4. Cookies 清除事件监听
```javascript
// 监听 Cookies 清除事件（通过 Ctrl+Alt+C 快捷键触发）
window.browserAPI.onCookiesCleared((data) => {
  if (data.type === 'all') {
    // 清除了所有 Cookies
    console.log('所有登录状态已清除');
  } else if (data.type === 'domain') {
    // 清除了指定域名的 Cookies
    console.log(`域名 ${data.domain} 的 ${data.count} 个 cookies 已清除`);
  }
});
```

### 5. 新窗口打开与加载监听
```javascript
// 首页注册监听器，当新窗口页面加载完成时触发
window.browserAPI.onWindowLoaded((data) => {
  console.log('新窗口加载完成:', data.url);
  console.log('窗口ID:', data.windowId);
  console.log('时间戳:', data.timestamp);
});

// 打开新窗口（使用持久化 session，保持登录状态）
const result = await window.browserAPI.openNewWindow('https://example.com');
if (result.success) {
  console.log('窗口创建成功, windowId:', result.windowId);
  // 然后等待 onWindowLoaded 回调被触发
} else {
  console.error('窗口创建失败:', result.error);
}

// 打开新窗口（使用临时 session，不保存登录状态，用于授权页）
const authResult = await window.browserAPI.openNewWindow('https://auth.example.com', {
  useTemporarySession: true  // 窗口关闭后登录状态会丢失
});
```

**参数说明**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | 是 | 要打开的 URL |
| options | object | 否 | 配置选项 |
| options.useTemporarySession | boolean | 否 | 为 true 时使用临时 session，窗口关闭后登录状态丢失（用于授权页） |

**返回值说明**：
| 字段 | 类型 | 说明 |
|------|------|------|
| success | boolean | 窗口是否创建成功 |
| windowId | number | 窗口 ID（成功时返回） |
| error | string | 错误信息（失败时返回） |

**onWindowLoaded 回调参数**：
| 字段 | 类型 | 说明 |
|------|------|------|
| url | string | 加载完成的页面 URL |
| windowId | number | 窗口 ID |
| timestamp | number | 加载完成的时间戳 |

**onSessionUpdated 回调参数**（发布窗口关闭时自动触发）：

浏览器会在多账号模式的发布窗口关闭时**自动保存最新 cookies 到后台**，无需前端处理。

**自动保存逻辑**：
1. 检测是否是多账号模式的窗口（通过 `windowAccountMap`）
2. 获取该窗口 session 的最新平台相关 cookies
3. 从 `publishData` 中获取账号 ID（`element.account_info.id`）
4. 从主窗口 URL 获取后台 API 域名
5. 调用保存接口（见下方配置）

**接口配置**（父页面在 element 中传入，必填）：
```javascript
// 在 element 中指定保存接口路径
element.saveSessionApi = '/api/mediaauth/douyininfo';
// 或
element.save_session_api = '/api/mediaauth/douyininfo';

// 如果不传 saveSessionApi，浏览器不会保存 cookies
```

**请求参数**：
```json
{
  "id": "账号ID（从 publishData.element.account_info.id 获取）",
  "cookies": "{\"cookies\": [...]}"  // JSON 字符串
}
```

**如需监听此事件**（可选）：
```javascript
window.browserAPI.onSessionUpdated((data) => {
  console.log('发布窗口关闭，已自动保存会话数据');
  console.log('平台:', data.platform);
  console.log('账号ID:', data.accountId);
});
```

| 字段 | 类型 | 说明 |
|------|------|------|
| windowId | number | 关闭的窗口 ID |
| platform | string | 平台名称（douyin/xiaohongshu/baijiahao/weixin/shipinhao） |
| accountId | string | 账号 ID（如 douyin_xxx_1） |
| cookies | array | 最新的平台相关 cookies 数组 |
| publishData | object | 发布数据（包含 element 中的账号信息） |
| timestamp | number | 事件触发时间戳 |

**使用场景**：
- 平台可能在发布过程中自动刷新登录凭证（如 token 续期）
- 发布窗口关闭时自动保存最新的 cookies 到后台
- 下次发布时使用最新的登录状态

### 6. 获取窗口 ID 和主窗口 URL
```javascript
// 获取当前窗口的 ID（用于新窗口识别自己，读取对应的发布数据）
const windowId = await window.browserAPI.getWindowId();
console.log('我的窗口 ID:', windowId);
// 返回: number（窗口ID）或 'main'（主窗口BrowserView）或 null（失败）

// 获取主窗口（BrowserView/首页）的 URL 信息（用于动态获取 API 域名）
const mainInfo = await window.browserAPI.getMainUrl();
console.log(mainInfo);
// 返回值示例:
// {
//   success: true,
//   url: "https://dev.china9.cn/aigc_browser/#/xxx",
//   origin: "https://dev.china9.cn",     // 协议+域名，用于构建 API 地址
//   host: "dev.china9.cn",               // 仅域名
//   protocol: "https:"                   // 仅协议
// }

// 使用场景：动态构建 API 地址
if (mainInfo.success) {
  const apiUrl = `${mainInfo.origin}/api/mediaauth/tjlog`;
  await fetch(apiUrl, { method: 'POST', ... });
}
```

**getMainUrl 返回值**：
| 字段 | 类型 | 说明 |
|------|------|------|
| success | boolean | 是否成功 |
| url | string | 完整 URL |
| origin | string | 协议+域名（如 `https://dev.china9.cn`） |
| host | string | 仅域名（如 `dev.china9.cn`） |
| protocol | string | 仅协议（如 `https:`） |

### 7. Session 状态检查
```javascript
// 主动检查 Session 状态（用于检测用户手动删除 UserData 文件夹的情况）
const status = await window.browserAPI.checkSessionStatus();
// 返回值示例:
// {
//   hasSession: true,
//   cookieCount: 100,
//   platforms: {
//     douyin: { count: 17, loggedIn: false },      // count 是 cookie 数量，loggedIn 是是否有有效登录凭证
//     xiaohongshu: { count: 5, loggedIn: true },
//     weixin: { count: 3, loggedIn: false },
//     baijiahao: { count: 2, loggedIn: true }
//   }
// }

// 使用场景：页面加载时检查登录状态
// 注意：要用 loggedIn 判断，不要用 count（cookie 数量不代表登录状态）
if (!status.platforms.douyin.loggedIn) {
  // 抖音未登录或登录已过期，清空授权列表
}
```

**各平台登录凭证 Cookie 名称**（用于判断 `loggedIn` 状态）:

| 平台 | 关键 Cookie 名称 |
|------|-----------------|
| 抖音 | `sessionid`, `sessionid_ss`, `passport_csrf_token`, `sid_guard`, `uid_tt`, `uid_tt_ss` |
| 小红书 | `web_session`, `websectiga`, `sec_poison_id` |
| 微信公众号 | `wxuin`, `pass_ticket` |
| 百家号 | `BDUSS`, `STOKEN` |

> 只要存在上述任一 Cookie，对应平台的 `loggedIn` 就为 `true`。

### 8. 全局数据持久化存储
```javascript
// 存储数据（如 company_id），数据会持久化保存到文件，应用重启后仍然保留
await window.browserAPI.setGlobalData('company_id', '12345');

// 获取数据
const companyId = await window.browserAPI.getGlobalData('company_id');

// 删除单个数据
await window.browserAPI.removeGlobalData('company_id');

// 获取所有数据
const allData = await window.browserAPI.getAllGlobalData();
// 返回: { company_id: '12345', other_key: 'value', ... }

// 清空所有数据
await window.browserAPI.clearGlobalData();
```

**存储位置**:
| 版本 | 文件路径 |
|------|---------|
| 开发环境/安装版 | `%APPDATA%\运营助手\global-storage.json` |
| 便携版 | `%LOCALAPPDATA%\运营助手-Portable\global-storage.json` |

**使用场景**: 登录页存储 `company_id`，授权脚本中获取使用。

### 9. 跨域 Cookie 设置
```javascript
// 通过 Electron session API 设置跨域 Cookie（可设置任意域名）
// 适用于登录后需要在 .china9.cn 所有子域名下共享 Cookie 的场景
await window.browserAPI.setCookie({
  name: 'token',           // Cookie 名称（必填）
  value: 'your_token',     // Cookie 值（必填）
  domain: '.china9.cn',    // 域名（带点表示父域名，所有子域名可用）
  path: '/',               // 路径，默认 '/'
  expirationDate: 1735689600, // 过期时间（秒级时间戳）
  secure: true,            // 仅 HTTPS，默认 true
  httpOnly: false,         // 是否 HttpOnly，默认 false
  sameSite: 'no_restriction' // SameSite 策略，默认 'no_restriction'
});

// 也支持毫秒时间戳或 Date 对象
await window.browserAPI.setCookie({
  name: 'access_token',
  value: 'your_token',
  domain: '.china9.cn',
  expires: Date.now() + 86400000  // 24小时后过期
});
```

**使用场景**:
- 登录页（file:// 协议）设置 Cookie 到 `.china9.cn` 域名
- 跳转到任意 `.china9.cn` 子域名时 Cookie 自动生效

**注意事项**:
- `domain` 以点开头（如 `.china9.cn`）表示所有子域名可用
- `expirationDate` 是秒级时间戳，`expires` 可以是毫秒时间戳

### 10. 清除指定域名的 Cookies
```javascript
// 清除指定域名的登录状态（用于删除授权时清除浏览器登录信息）
const result = await window.browserAPI.clearDomainCookies('douyin.com');
console.log(result);
// 返回值示例:
// { success: true, deletedCount: 17 }
// 或
// { success: false, error: '错误信息' }
```

**平台域名参考**：
| 平台 | 域名 |
|------|------|
| 抖音 | `douyin.com` |
| 小红书 | `xiaohongshu.com` |
| 微信公众号 | `weixin.qq.com`, `mp.weixin.qq.com` |
| 百家号 | `baidu.com`, `baijiahao.baidu.com` |
| 视频号 | `channels.weixin.qq.com` |

**使用场景**：删除授权账号时，同步清除浏览器中该平台的登录 Cookies，防止下次授权时自动登录旧账号。

**示例**（在 auth.vue 中使用）：
```javascript
// 删除授权后清除对应平台的 cookies
const handleDelete = async (row) => {
  await delAccount(row.id);

  // 清除平台登录信息
  if (window?.browserAPI?.clearDomainCookies) {
    const platformDomains = {
      '抖音': ['douyin.com'],
      '小红书': ['xiaohongshu.com'],
      '公众号': ['weixin.qq.com', 'mp.weixin.qq.com'],
    };
    const domains = platformDomains[row.media?.title];
    if (domains) {
      for (const domain of domains) {
        await window.browserAPI.clearDomainCookies(domain);
      }
    }
  }
};
```

### 11. 跳转到本地页面
```javascript
// 跳转到本地 HTML 页面（用于从远程页面跳转到 not-available.html 等本地页面）
// 注意：直接使用 window.location.href = 'not-available.html' 会跳转到远程服务器的路径
// 使用此 API 可以正确跳转到浏览器本地的 HTML 文件
await window.browserAPI.navigateToLocalPage('not-available.html');

// 支持的本地页面：
// - 'not-available.html' - 功能暂未开放页面
// - 'login.html' - 登录页面
```

**使用场景**：当前端在远程服务器（如 `https://dev.china9.cn`）运行时，需要跳转到浏览器本地的 HTML 页面。

### 12. 迁移临时 Session Cookies 到持久化 Session
```javascript
// 用于授权窗口（临时 session）授权成功后，把登录状态复制到持久化 session
// 这样发布时才能用新授权的账号
const result = await window.browserAPI.migrateCookiesToPersistent('baidu.com');
console.log(result);
// 返回值示例:
// { success: true, migratedCount: 15, totalFound: 15 }
// 或
// { success: false, error: '错误信息' }
```

**参数说明**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| domain | string | 是 | 要迁移的域名，如 `baidu.com` |

**返回值说明**：
| 字段 | 类型 | 说明 |
|------|------|------|
| success | boolean | 是否成功 |
| migratedCount | number | 成功迁移的 cookie 数量 |
| totalFound | number | 找到的该域名 cookie 总数 |
| error | string | 错误信息（失败时返回） |

**工作原理**：
1. 从当前窗口的 session（临时 session）中获取指定域名的所有 cookies
2. 清除持久化 session 中该域名的旧 cookies（避免冲突）
3. 将临时 session 的 cookies 复制到持久化 session
4. 设置为持久化 cookie（1年过期）

**使用场景**：授权窗口使用 `useTemporarySession: true` 打开时，授权成功后调用此 API，把新账号的登录状态迁移到持久化 session。这样后续发布时就能用新授权的账号。

**示例**（在授权脚本中使用）：
```javascript
// 授权成功后，迁移 cookies 到持久化 session
if (authSuccess) {
  const result = await window.browserAPI.migrateCookiesToPersistent('baidu.com');
  if (result.success) {
    console.log('Cookies 迁移成功，共迁移', result.migratedCount, '个');
  }
  // 然后通知首页刷新
  sendMessageToParent('授权成功，刷新数据');
  // 最后关闭窗口
  window.browserAPI.closeCurrentWindow();
}
```

### 13. 获取完整会话数据（用于存储到后台）
```javascript
// 获取完整会话数据（Cookies + localStorage + sessionStorage + IndexedDB）
// 用于授权后将完整登录状态存储到后台
const result = await window.browserAPI.getFullSessionData('douyin.com');
console.log(result);
// 返回值示例:
// {
//   success: true,
//   data: {
//     domain: 'douyin.com',
//     timestamp: 1704067200000,
//     cookies: [...],        // Cookie 数组
//     localStorage: {...},   // localStorage 键值对
//     sessionStorage: {...}, // sessionStorage 键值对
//     indexedDB: {...}       // IndexedDB 数据库数据
//   },
//   size: 102400  // 数据大小（字节）
// }
```

**参数说明**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| domain | string | 是 | 要获取的域名，如 `douyin.com` |

**返回值说明**：
| 字段 | 类型 | 说明 |
|------|------|------|
| success | boolean | 是否成功 |
| data.cookies | array | Cookies 数组，包含 name, value, domain, path, secure, httpOnly, sameSite, expirationDate |
| data.localStorage | object | localStorage 键值对 |
| data.sessionStorage | object | sessionStorage 键值对 |
| data.indexedDB | object | IndexedDB 数据库数据（按数据库名分组） |
| size | number | 数据总大小（字节） |

**使用场景**：授权成功后，获取完整的登录状态数据并提交到后台存储，后续发布时可以从后台获取并恢复。

**示例**（在授权脚本中使用）：
```javascript
// 构建提交数据
const scanData = {
  data: JSON.stringify({
    nickname: '用户昵称',
    uid: '用户ID',
    company_id: companyId,
    auth_type: 1
  })
};

// 获取完整会话数据
const sessionResult = await window.browserAPI.getFullSessionData('douyin.com');
if (sessionResult.success) {
  const dataObj = JSON.parse(scanData.data);
  dataObj.cookies = JSON.stringify(sessionResult.data);  // 完整会话数据
  scanData.data = JSON.stringify(dataObj);
}

// 提交到后台
await fetch('https://apidev.china9.cn/api/mediaauth/douyininfo', {
  method: 'POST',
  body: JSON.stringify(scanData)
});
```

### 14. 多账号管理 API

多账号功能允许每个平台保存多个账号的登录状态，每个账号使用独立的 Session 分区存储。

#### 架构说明

```
主窗口 BrowserView
└── session: persist:browserview （独立，仅用于浏览）

平台账号（每个账号独立 session）
├── 抖音
│   ├── 账号A → session: persist:douyin_dy_xxx_1
│   └── 账号B → session: persist:douyin_dy_xxx_2
├── 小红书
│   └── 账号X → session: persist:xiaohongshu_xhs_xxx_3
└── ...
```

#### 数据存储

账号列表元数据存储在 `global-storage.json`：

```json
{
  "platformAccounts": {
    "douyin": [
      {
        "id": "douyin_xxx_1",
        "nickname": "账号昵称",
        "avatar": "头像URL",
        "platformUid": "平台用户ID",
        "createdAt": 1704067200000,
        "lastUsedAt": 1704153600000
      }
    ],
    "xiaohongshu": [],
    "baijiahao": [],
    "weixin": [],
    "shipinhao": []
  }
}
```

#### API 列表

##### 获取账号列表
```javascript
// 获取指定平台的所有账号
const accounts = await window.browserAPI.getAccounts('douyin');
// 返回: [{ id, nickname, avatar, platformUid, createdAt, lastUsedAt }, ...]

// 获取所有平台的所有账号
const allAccounts = await window.browserAPI.getAllAccounts();
// 返回: { douyin: [...], xiaohongshu: [...], baijiahao: [...], ... }
```

##### 添加账号
```javascript
// 授权成功后添加账号
const result = await window.browserAPI.addAccount('douyin', {
  nickname: '账号昵称',
  avatar: '头像URL',
  platformUid: '平台用户ID'  // 用于去重
});
// 返回: { success: true, accountId: 'douyin_xxx_1', isNew: true }
// 如果 platformUid 已存在，返回 isNew: false，表示更新了现有账号
```

##### 删除账号
```javascript
// 删除账号（同时清理对应的 session 数据）
const result = await window.browserAPI.removeAccount('douyin', 'douyin_xxx_1');
// 返回: { success: true }
```

##### 更新账号信息
```javascript
// 更新账号信息
const result = await window.browserAPI.updateAccount('douyin', 'douyin_xxx_1', {
  nickname: '新昵称',
  avatar: '新头像'
});
// 返回: { success: true, account: {...} }
```

##### 检查账号是否存在
```javascript
// 通过平台用户ID检查账号是否已存在
const result = await window.browserAPI.accountExists('douyin', '平台用户ID');
// 返回: { exists: true, accountId: 'douyin_xxx_1', account: {...} }
// 或: { exists: false }
```

##### 获取单个账号信息
```javascript
// 获取指定账号的详细信息
const result = await window.browserAPI.getAccount('douyin', 'douyin_xxx_1');
// 返回: { success: true, account: { id, nickname, avatar, ... } }
```

##### 获取当前窗口账号信息
```javascript
// 在发布脚本中获取当前窗口对应的账号信息
const result = await window.browserAPI.getCurrentAccount();
// 返回: { success: true, platform: 'douyin', accountId: 'douyin_xxx_1', account: {...} }
```

##### 检查账号登录状态
```javascript
// 检查指定账号是否已登录（通过检测关键 Cookie）
const result = await window.browserAPI.checkAccountLoginStatus('douyin', 'douyin_xxx_1');
// 返回: { success: true, isLoggedIn: true, cookieCount: 50 }
```

##### 迁移到新账号（授权窗口使用）
```javascript
// 授权成功后，将临时 session 的 cookies 迁移到新账号
const result = await window.browserAPI.migrateToNewAccount('douyin', {
  nickname: '获取到的昵称',
  avatar: '获取到的头像',
  platformUid: '获取到的平台用户ID'
});
// 返回: { success: true, accountId: 'douyin_xxx_1', isNew: true, migratedCount: 20 }
```

#### 打开账号窗口

```javascript
// 打开指定账号的发布窗口（使用该账号的 session）
// 方式1: 仅打开窗口，使用账号现有的登录信息
const result = await window.browserAPI.openNewWindow(url, {
  platform: 'douyin',
  accountId: 'douyin_xxx_1'
});

// 方式2: 传递会话数据，浏览器自动清空旧登录信息并恢复新登录信息（推荐）
const result = await window.browserAPI.openNewWindow(url, {
  platform: 'douyin',
  accountId: 'douyin_xxx_1',
  sessionData: sessionDataFromBackend  // 从后台获取的会话数据（对象或 JSON 字符串）
});
// 返回: { success: true, windowId: 123 }
```

**参数说明**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | 是 | 要打开的 URL |
| options.platform | string | 多账号模式必填 | 平台名称 |
| options.accountId | string | 多账号模式必填 | 账号 ID |
| options.sessionData | object/string | 否 | 会话数据（getFullSessionData 返回的格式）。如果提供，浏览器会在打开窗口前**自动清空该账号的旧 cookies 并恢复新的会话数据**，无需手动调用 clearAccountCookies 和 restoreAccountSession |
| options.useTemporarySession | boolean | 否 | 为 true 时使用临时 session（授权模式） |

**优先级**：`platform + accountId` > `useTemporarySession` > 默认持久化 session

**注意**：
- 如果不传 `sessionData`，窗口会使用该账号现有的登录信息
- 如果传了 `sessionData`，浏览器会自动完成以下流程：
  1. 清空该账号的所有旧 cookies
  2. 恢复 sessionData 中的新 cookies
  3. 打开窗口
- 这样父页面只需要传递数据，不需要手动调用清空和恢复 API，适合有多个项目的场景

#### 授权流程示例

```javascript
// 1. 用户点击"添加抖音账号"，打开授权窗口（临时 session）
const authResult = await window.browserAPI.openNewWindow(authUrl, {
  useTemporarySession: true
});

// 2. 在授权脚本中，检测登录成功后获取用户信息并迁移
async function onAuthSuccess(userInfo) {
  // 迁移 cookies 到新账号
  const result = await window.browserAPI.migrateToNewAccount('douyin', {
    nickname: userInfo.nickname,
    avatar: userInfo.avatar,
    platformUid: userInfo.uid
  });

  if (result.success) {
    console.log('授权成功，账号ID:', result.accountId);
    // 通知首页刷新账号列表
    window.browserAPI.sendToHome({ type: 'account-added', platform: 'douyin' });
    // 关闭授权窗口
    window.browserAPI.closeCurrentWindow();
  }
}
```

#### 发布流程示例

```javascript
// 1. 首页选择要发布的账号并打开发布窗口
async function publishToAccount(platform, accountId, publishUrl) {
  // 从后台获取该账号的会话数据
  const response = await fetch(`https://apidev.china9.cn/api/mediaauth/get-session/${accountId}`);
  const { sessionData } = await response.json();

  // 打开发布窗口，传入 sessionData 参数
  // 浏览器会自动清空旧 cookies 并恢复新的会话数据
  const result = await window.browserAPI.openNewWindow(publishUrl, {
    platform: platform,
    accountId: accountId,
    sessionData: sessionData  // 浏览器会自动清空并恢复
  });

  if (result.success) {
    // 存储发布数据
    await window.browserAPI.setGlobalData(`publish_data_window_${result.windowId}`, {
      title: '视频标题',
      content: '视频描述'
    });
  }
}

// 2. 在发布脚本中获取账号信息
async function onPublishPageLoaded() {
  // 获取当前窗口的账号信息
  const accountInfo = await window.browserAPI.getCurrentAccount();
  console.log('当前账号:', accountInfo.account?.nickname);

  // 获取发布数据
  const windowId = await window.browserAPI.getWindowId();
  const publishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);

  // 执行发布逻辑...
}
```

**推荐流程**：
1. 父页面从后台获取账号的 `sessionData`
2. 调用 `openNewWindow` 时传入 `sessionData` 参数
3. 浏览器自动完成清空和恢复操作
4. 打开窗口时已经是最新的登录状态

**注意**：
- 如果使用 `sessionData` 参数，无需手动调用 `clearAccountCookies` 和 `restoreAccountSession`
- 这种方式适合多项目场景，所有逻辑由浏览器内部完成，父页面只负责传数据

#### 平台名称对照

| 平台 | platform 值 |
|------|------------|
| 抖音 | `douyin` |
| 小红书 | `xiaohongshu` |
| 百家号 | `baijiahao` |
| 微信公众号 | `weixin` |
| 视频号 | `shipinhao` |

#### 会话数据恢复与清理

##### 恢复账号会话数据（打开窗口前调用）
```javascript
// 从后台获取账号的完整会话数据后，在打开发布窗口之前恢复到账号 session
const result = await window.browserAPI.restoreAccountSession('douyin', 'douyin_xxx_1', sessionData);
// 参数:
//   platform - 平台名称（如 'douyin'）
//   accountId - 账号 ID（如 'douyin_xxx_1'）
//   sessionData - 会话数据对象或 JSON 字符串（getFullSessionData 返回的格式）
// 返回: { success: true, results: { cookies: {restored, failed}, ... } }

// 使用示例：打开发布窗口前恢复会话
async function openPublishWindow(platform, accountId, publishUrl) {
  // 1. 从后台获取账号的会话数据
  const response = await fetch(`https://apidev.china9.cn/api/mediaauth/get-session/${accountId}`);
  const { sessionData } = await response.json();

  // 2. 恢复会话数据到账号 session
  const restoreResult = await window.browserAPI.restoreAccountSession(platform, accountId, sessionData);
  if (restoreResult.success) {
    console.log(`已恢复 ${restoreResult.results.cookies.restored} 个 cookies`);

    // 3. 打开发布窗口（会自动使用该账号的 session）
    const windowResult = await window.browserAPI.openNewWindow(publishUrl, {
      platform: platform,
      accountId: accountId
    });
  }
}
```

##### 清空账号的所有 Cookies
```javascript
// 清空指定账号的所有 cookies（用于发布窗口关闭前清理）
const result = await window.browserAPI.clearAccountCookies('douyin', 'douyin_xxx_1');
// 参数:
//   platform - 平台名称
//   accountId - 账号 ID
// 返回: { success: true, deletedCount: 10 }

// 使用方式 1: 手动调用（在发布脚本中）
async function onPublishComplete() {
  const accountInfo = await window.browserAPI.getCurrentAccount();
  if (accountInfo.success) {
    // 发布完成后清空登录状态
    await window.browserAPI.clearAccountCookies(accountInfo.platform, accountInfo.accountId);
    // 然后关闭窗口
    await window.browserAPI.closeCurrentWindow();
  }
}

// 使用方式 2: 自动清空（在窗口关闭前自动执行）
// 需要在发布脚本的 window.beforeunload 或 pagehide 事件中调用
window.addEventListener('beforeunload', async (e) => {
  const accountInfo = await window.browserAPI.getCurrentAccount();
  if (accountInfo.success) {
    await window.browserAPI.clearAccountCookies(accountInfo.platform, accountInfo.accountId);
  }
});
```

**注意事项**：
1. `restoreAccountSession` 目前只恢复 Cookies，localStorage/sessionStorage/IndexedDB 需要在窗口打开后通过页面脚本恢复（使用 `restoreSessionData`）
2. `clearAccountCookies` 会清空该账号 session 中的所有 cookies，确保下次发布时使用的是从后台恢复的最新会话数据
3. 建议在发布完成或窗口关闭前调用 `clearAccountCookies`，避免登录状态累积

## Script Storage

- **Location**: `injected-scripts/` directory
- **Manifest**: `manifest.json` tracks all scripts with metadata
- **Filename**: MD5 hash of URL (e.g., `a1b2c3d4e5f6.js`)
- **Config File**: `scripts-config.json` for predefined URL→script mappings
- **Dependency Injection**: Supports script dependencies via array notation
- **Import/Export**: Scripts can be exported/imported with original structure

### Script Dependencies

Scripts **cannot use ES6 `import`** because they're injected via `executeJavaScript()`. Instead, use dependency injection:

**Configuration** (`scripts-config.json`):
```json
{
  "scripts": {
    "https://example.com/*": ["common.js", "main.js"]
  }
}
```

**Execution Order**:
1. `common.js` injected first → defines global functions
2. `main.js` injected second → can use functions from `common.js`

**Available in `common.js`**:
- `waitForElement(selector, timeout, checkInterval)` - Wait for element to appear
- `retryOperation(operation, maxRetries, delay)` - Retry failed operations

**Example Usage** in dependent script:
```javascript
// main.js can directly call functions from common.js
waitForElement('.button', 10000)
  .then(btn => btn.click());

retryOperation(async () => await fetch('/api'), 3, 1000);
```

See `如何使用common.js.md` for detailed documentation.

## Development Notes

### Modifying the Homepage URL
Change the `HOME_URL` constant in main.js:9:
```javascript
const HOME_URL = 'http://localhost:5173/';
```

### Adding IPC Handlers
1. Define handler in main.js using `ipcMain.handle()` or `ipcMain.on()`
2. Expose API in appropriate preload script:
   - `preload.js` for control panel APIs
   - `content-preload.js` for content page APIs
3. Call from renderer using exposed API

### Script Injection Debugging
- Main process logs show `[Script Injection]` prefixed messages
- Content page console shows `BrowserAPI ready:` on load
- Use DevTools button to inspect content pages separately from control panel

### Session Data Persistence
- Session path logged on startup
- Cookie count logged during auto-save (every 30 seconds)
- Manual flush available via `window.electronAPI.flushSession()`
- Session cookies converted to persistent (1 year expiration) on window close

### Data Storage Paths

**根目录**：
| 版本 | 数据存储位置 |
|------|-------------|
| 开发环境 | `%APPDATA%\运营助手` |
| 安装版 | `%APPDATA%\运营助手` |
| 便携版 | `%LOCALAPPDATA%\运营助手-Portable` |

便携版使用固定路径，无论 exe 放在哪里数据都不会丢失。

#### 存储结构详解

```
%APPDATA%\运营助手\                          # 根目录（或便携版的 %LOCALAPPDATA%\运营助手-Portable\）
├── global-storage.json                      # 🔑 自己平台登录信息（token、用户信息等）
├── Preferences                              # 应用偏好设置
└── Partitions\
    └── browserview\                         # 🔑 第三方平台登录信息（持久化 Session）
        ├── blob_storage\                    # Blob 存储
        ├── Cache\                           # 网页缓存
        ├── Code Cache\                      # JavaScript 代码缓存
        ├── databases\                       # Web SQL 数据库
        ├── DawnCache\                       # WebGPU Dawn 缓存
        ├── File System\                     # File System API 数据
        ├── GPUCache\                        # GPU 渲染缓存
        ├── IndexedDB\                       # IndexedDB 数据库
        ├── Local Storage\                   # localStorage 数据
        ├── Network\
        │   └── Cookies                      # ⭐ 第三方平台 Cookie（SQLite 数据库）
        ├── Service Worker\                  # Service Worker 缓存
        ├── Session Storage\                 # sessionStorage 数据
        ├── shared_proto_db\                 # 共享 Protocol Buffer 数据库
        ├── VideoDecodeStats\                # 视频解码统计
        └── WebStorage\                      # Web Storage 数据
```

#### 数据分类说明

| 数据类型 | 存储文件 | 说明 |
|---------|---------|------|
| **自己平台登录信息** | `global-storage.json` | token、user_info、company_id、siteInfo 等 |
| **第三方平台登录信息** | `Partitions\browserview\Network\Cookies` | 抖音、小红书、微信、百家号等平台的登录 Cookie |
| **退出时的页面 URL** | `global-storage.json` 中的 `last_page_url` | 用于下次启动时恢复页面 |

#### global-storage.json 存储内容

登录页（login.html）存储的数据：
```json
{
  "login_token": "xxx",           // 登录 token
  "login_expires": 1735689600,    // token 过期时间（秒级时间戳）
  "login_gcc": "xxx",             // gcc 值（如果有）
  "user_info": { ... },           // 完整用户信息对象
  "company_id": "12345",          // 公司 ID
  "siteInfo": { ... },            // 站点信息对象
  "current_site_id": 123,         // 当前站点 ID
  "current_site_name": "xxx",     // 当前站点名称
  "last_page_url": "https://..."  // 退出时的页面 URL（用于恢复）
}
```

#### 第三方平台 Cookie 存储

第三方平台（抖音、小红书、微信、百家号等）的登录 Cookie 存储在：
- **文件路径**: `Partitions\browserview\Network\Cookies`
- **文件格式**: SQLite 数据库
- **持久化方式**: `session.fromPartition('persist:browserview')` (main.js:236)

**注意**: 用户手动删除 `Partitions\browserview` 目录会导致所有第三方平台的登录状态丢失。

## Important Patterns

**URL Pattern Matching** (script-manager.js:161-173)
- Supports `*` wildcard in URL patterns
- Converts pattern to regex for matching
- Useful for SPA routes: `http://localhost:5173/*` matches all paths

**Script Panel Toggle** (renderer.js:139-167)
- Toggles panel position with CSS right property (`0px` / `-400px`)
- Notifies main process to adjust BrowserView bounds
- Prevents content overlap with script editor

**Window Close Handling** (main.js:31-81)
- Prevents immediate close to save session data
- Converts session cookies to persistent
- Flushes storage data before shutdown
- 200ms delay ensures disk write completion

## Known Issues & Solutions

### bitbrowser:// 协议系统弹窗问题

**问题描述**: 某些第三方平台（如抖音）的授权页面会尝试调用 `bitbrowser://` 协议，导致 Windows 弹出 "需要使用新应用以打开此 bitbrowser 链接" 对话框。

**已实施的拦截措施**:
1. `protocol.registerSchemesAsPrivileged()` - 在 app.whenReady() 之前注册协议方案
2. `protocol.registerStringProtocol('bitbrowser', ...)` - 注册协议拦截器
3. `session.webRequest.onBeforeRequest()` - Session 级别拦截
4. `will-navigate` / `will-frame-navigate` 事件拦截
5. `setWindowOpenHandler` 拦截新窗口
6. `app.on('web-contents-created')` 全局拦截
7. 前端 JavaScript 拦截（content-preload.js 和 common.js）

**不要使用的方案**:
```javascript
// ❌ 不要使用 app.setAsDefaultProtocolClient('bitbrowser')
// 这会导致以下错误：
// Error launching app
// Unable to find Electron app at D:\浏览器\运营助手\bitbrowser\cc
// Cannot find module 'D:\浏览器\运营助手\bitbrowser\cc'
```

原因：当 Windows 尝试打开 `bitbrowser://cc` 时，会将 URL 路径作为命令行参数传递给已注册的应用，Electron 会错误地将 `bitbrowser\cc` 解析为应用程序路径。

### Session 状态检测

**场景**: 用户手动删除 UserData 文件夹后，需要清空授权列表。

**解决方案**:
1. 通过快捷键 Ctrl+Alt+C 清除 Cookies 时，会发送 `cookies-cleared` 事件
2. 使用 `window.browserAPI.checkSessionStatus()` 主动检查 Cookie 状态

```javascript
// 监听 Cookies 清除事件（快捷键触发）
window.browserAPI.onCookiesCleared((data) => {
  if (data.type === 'all') {
    // 清空所有授权列表
  } else if (data.type === 'domain') {
    // 刷新指定域名的授权状态
    console.log(`域名 ${data.domain} 的 ${data.count} 个 cookies 已清除`);
  }
});

// 主动检查 Session 状态（用于检测手动删除文件夹的情况）
const status = await window.browserAPI.checkSessionStatus();
// status = { hasSession: true, cookieCount: 100, platforms: { douyin: 10, xiaohongshu: 5, ... } }
```
