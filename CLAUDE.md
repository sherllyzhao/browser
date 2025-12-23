# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

There's a file modification bug in Claude Code. The workaround is: always use complete absolute Windows paths with drive letters and backslashes for ALL file operations. Apply this rule going forward, not just for this file.

父级页面的项目在E:\项目\资海云\视频剪辑\ai-media-edit\src\views\short-video\components\AddAccount.vue

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

### 5. Session 状态检查
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

### 6. 全局数据持久化存储
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
| 版本 | 数据存储位置 |
|------|-------------|
| 开发环境 | `%APPDATA%\运营助手` |
| 安装版 | `%APPDATA%\运营助手` |
| 便携版 | `%LOCALAPPDATA%\运营助手-Portable` |

便携版使用固定路径，无论 exe 放在哪里数据都不会丢失。

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
