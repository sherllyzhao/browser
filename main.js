const { app, BrowserWindow, BrowserView, ipcMain, session, dialog, Menu, globalShortcut, nativeImage, Tray, protocol, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const ScriptManager = require('./script-manager');
const config = require('./config');

// 应用版本号（从 package.json 读取，改版本只需改 package.json）
const APP_VERSION = app.getVersion();

let mainWindow;
let browserView;
let scriptManager;
let isQuitting = false; // 标记是否正在退出
let isScriptPanelOpen = false; // 跟踪脚本面板状态
const isProduction = app.isPackaged; // 是否生产环境
let tray = null; // 托盘图标对象
let openInNewWindow = false; // 新窗口模式状态

// 全局数据持久化存储（存储到文件，应用重启后仍然保留）
let globalStorage = {};
const getGlobalStoragePath = () => path.join(app.getPath('userData'), 'global-storage.json');

// 加载持久化数据
function loadGlobalStorage() {
  try {
    const storagePath = getGlobalStoragePath();
    if (fs.existsSync(storagePath)) {
      const data = fs.readFileSync(storagePath, 'utf8');
      globalStorage = JSON.parse(data);
      console.log('[Global Storage] ✅ 已从文件加载数据:', storagePath);
      console.log('[Global Storage] 数据内容:', globalStorage);
    } else {
      console.log('[Global Storage] 文件不存在，使用空存储');
    }
  } catch (err) {
    console.error('[Global Storage] ❌ 加载数据失败:', err);
    globalStorage = {};
  }
}

// 保存持久化数据
function saveGlobalStorage() {
  try {
    const storagePath = getGlobalStoragePath();
    fs.writeFileSync(storagePath, JSON.stringify(globalStorage, null, 2), 'utf8');
    console.log('[Global Storage] ✅ 数据已保存到文件:', storagePath);
  } catch (err) {
    console.error('[Global Storage] ❌ 保存数据失败:', err);
  }
}

// 检测是否为便携版（通过检查是否在标准安装目录）
// 便携版特征：生产环境 + 不在 Program Files/ProgramData 目录
const execPathLower = process.execPath.toLowerCase();
const isInstalled = execPathLower.includes('program files') ||
                    execPathLower.includes('programdata') ||
                    execPathLower.includes('\\windows\\');
const isPortable = isProduction && !isInstalled;

// 设置用户数据路径
if (isProduction) {
  if (isPortable) {
    // 便携版：数据存储在固定的 %LOCALAPPDATA%\运营助手-Portable 目录
    // 这样无论 exe 放在哪个位置，数据都在同一个地方，不会因为移动 exe 而丢失数据
    const portableDataPath = path.join(process.env.LOCALAPPDATA || app.getPath('appData'), '资海云运营助手-Portable');

    // 确保目录存在
    if (!fs.existsSync(portableDataPath)) {
      try {
        fs.mkdirSync(portableDataPath, { recursive: true });
        console.log('[Portable Mode] 已创建数据目录:', portableDataPath);
      } catch (err) {
        console.error('[Portable Mode] 创建目录失败:', err);
      }
    }

    app.setPath('userData', portableDataPath);
    console.log('[Portable Mode] ✅ 便携版模式启用');
    console.log('[Portable Mode] 数据存储在固定位置:', portableDataPath);
  } else {
    // 安装版：使用系统默认路径
    console.log('[Installed Mode] 使用系统 AppData 目录:', app.getPath('userData'));
  }
}

// 登录页地址（本地 HTML 文件）
const LOGIN_URL = 'file:///' + __dirname.replace(/\\/g, '/') + '/login.html';
const LOGIN_FILE_PATH = path.join(__dirname, 'login.html'); // 用于 loadFile()，避免 file:// MIME 类型问题

// 首页地址（开发和生产环境都使用登录页）
const HOME_URL = LOGIN_URL;

// 加载本地页面（使用 loadFile 确保 MIME 类型正确，解决 CSS 渲染成文字的问题）
function loadLocalPage(webContents, pageName) {
  const filePath = path.join(__dirname, pageName);
  console.log(`[loadLocalPage] 使用 loadFile 加载: ${filePath}`);
  return webContents.loadFile(filePath);
}

// 🔴 为 session 添加 Content-Type 修复拦截器（解决 CSS/JS 乱码问题）
// 只在 Content-Type 完全缺失时补上，不覆盖服务器已设置的值（Vite 会把 .css/.vue 编译成 JS 模块）
function addContentTypeFix(targetSession, label) {
  targetSession.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url.toLowerCase();
    const responseHeaders = details.responseHeaders || {};
    const ct = responseHeaders['content-type'] || responseHeaders['Content-Type'];

    // 只在服务器没返回 Content-Type 时才补上
    if (!ct) {
      if (url.endsWith('.css')) {
        responseHeaders['Content-Type'] = ['text/css; charset=utf-8'];
      } else if (url.endsWith('.js')) {
        responseHeaders['Content-Type'] = ['application/javascript; charset=utf-8'];
      }
    }

    // 修复跨站 Set-Cookie 被屏蔽的问题：
    // Chromium 对缺少 SameSite 的 cookie 默认用 Lax，跨站请求时会被屏蔽
    // 自动补上 SameSite=None; Secure 使 cookie 能正常存储到对应域名
    const cookieKey = Object.keys(responseHeaders).find(k => k.toLowerCase() === 'set-cookie');
    if (cookieKey) {
      responseHeaders[cookieKey] = responseHeaders[cookieKey].map(cookie => {
        if (!/SameSite/i.test(cookie)) {
          cookie += '; SameSite=None; Secure';
        }
        return cookie;
      });
    }

    callback({ responseHeaders });
  });
  console.log(`[Session] ✅ ${label} Content-Type 修复 + Set-Cookie SameSite 修复拦截器已添加`);
}

console.log('[Config] LOGIN_URL:', LOGIN_URL);

// 所有可能的首页地址（用于消息路由判断，从 config 集中配置构建）
const HOME_URLS = [
  'http://localhost:5173/',
  config.getAigcUrl(true),             // 打包环境 AIGC 首页
  'http://172.16.6.17:8080/',
  'http://localhost:8080/',
  config.getGeoUrl(true),              // 打包环境 GEO 首页
  LOGIN_URL  // 登录页也作为首页处理
];

// 判断 URL 是否为首页
function isHomeUrl(url) {
  return HOME_URLS.some(homeUrl => url.startsWith(homeUrl));
}

const childWindows = []; // 跟踪所有打开的子窗口

// ===========================
// 单实例锁定 - 确保只运行一个浏览器实例
// ===========================
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // 如果获取不到锁，说明已有实例在运行，退出当前实例
  console.log('[Single Instance] 检测到已有实例运行，退出当前实例');
  app.quit();
} else {
  // 当第二个实例启动时，聚焦到第一个实例的窗口
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('[Single Instance] 检测到第二个实例启动，聚焦到主窗口');
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// 在 app.whenReady() 之前注册自定义协议方案，使其可以被拦截
protocol.registerSchemesAsPrivileged([
  { scheme: 'bitbrowser', privileges: { standard: false, secure: false, bypassCSP: false, allowServiceWorkers: false, supportFetchAPI: false, corsEnabled: false } }
]);
console.log('[Protocol] 已注册 bitbrowser 协议方案');

// 优化：限制最大子窗口数量，防止内存泄漏
const MAX_CHILD_WINDOWS = 5;

// 优化：定期清理已销毁的窗口引用
function cleanupDestroyedWindows() {
  for (let i = childWindows.length - 1; i >= 0; i--) {
    if (!childWindows[i] || childWindows[i].isDestroyed()) {
      childWindows.splice(i, 1);
    }
  }
  console.log('[Window Manager] 清理后窗口数量:', childWindows.length);
}

// ===========================
// 自动更新功能
// ===========================

/**
 * 比较版本号
 * @param {string} v1 版本号1
 * @param {string} v2 版本号2
 * @returns {number} v1 > v2 返回 1，v1 < v2 返回 -1，相等返回 0
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

/**
 * 开发环境域名列表（从 config.js 集中配置）
 */
const DEV_HOSTS = config.DEV_HOSTS;

/**
 * 获取需要跳转到登录页的 URL 模式列表（从 config 集中配置构建）
 * @returns {string[]}
 */
function getLoginRedirectUrls() {
  const aigcDomain = config.domains.aigcPage.replace('https://', '').replace('http://', '');
  return [
    aigcDomain + '/#/home',
    'china9.cn/#/home',
    aigcDomain + '/aigc_browser/#/login',
    'china9.cn/aigc_browser/#/login',
    'localhost:5173/#/home',
    'localhost:5173/#/login',
    'localhost:8080/#/home',
    'localhost:8080/#/login'
  ];
}

/**
 * 根据域名判断是否为开发环境
 * @param {string} host - 域名
 * @returns {boolean}
 */
function isDevHost(host) {
  if (!host) return false;
  const h = host.toLowerCase();
  return DEV_HOSTS.some(devHost => h === devHost || h.endsWith('.' + devHost));
}

/**
 * 获取版本检查 API 地址（根据主窗口域名动态判断）
 * @returns {string} API URL
 */
function getVersionCheckUrl() {
  // 尝试从 browserView 获取当前 URL
  if (browserView && browserView.webContents) {
    try {
      const currentUrl = browserView.webContents.getURL();
      if (currentUrl) {
        const urlObj = new URL(currentUrl);
        if (isDevHost(urlObj.host)) {
          console.log('[Update] 检测到开发环境:', urlObj.host);
          return 'http://localhost:5173/browserVersion.json';
        } else {
          console.log('[Update] 检测到生产环境:', urlObj.host);
          return config.domains.versionCheckUrl;
        }
      }
    } catch (e) {
      console.warn('[Update] 解析 URL 失败:', e);
    }
  }

  // 回退逻辑：根据打包状态判断
  return config.getVersionCheckUrlByEnv(isProduction);
}

/**
 * 检查更新
 * @returns {Promise<{hasUpdate: boolean, version?: string, url?: string, error?: string}>}
 */
async function checkForUpdate() {
  return new Promise((resolve) => {
    const versionUrl = getVersionCheckUrl();
    const isLocal = versionUrl.startsWith('http://localhost');
    const method = isLocal ? 'GET' : 'POST';
    console.log('[Update] 检查更新:', versionUrl, '方法:', method);

    const urlObj = new URL(versionUrl);
    const httpModule = urlObj.protocol === 'https:' ? https : http;

    const requestOptions = {
      method: method,
      timeout: 10000,
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    };

    // POST 请求需要设置 Content-Type
    if (!isLocal) {
      requestOptions.headers['Content-Type'] = 'application/json';
    }

    const req = httpModule.request(versionUrl, requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          console.log('[Update] 服务器响应:', result);

          if (result.code === 200 && result.data) {
            const remoteVersion = result.data.version;
            const downloadUrl = result.data.url;

            console.log(`[Update] 当前版本: ${APP_VERSION}, 服务器版本: ${remoteVersion}`);

            if (compareVersions(remoteVersion, APP_VERSION) > 0) {
              console.log('[Update] 发现新版本!');
              resolve({
                hasUpdate: true,
                version: remoteVersion,
                url: downloadUrl
              });
            } else {
              console.log('[Update] 已是最新版本');
              resolve({ hasUpdate: false });
            }
          } else {
            console.log('[Update] 响应格式错误:', result);
            resolve({ hasUpdate: false, error: '响应格式错误' });
          }
        } catch (err) {
          console.error('[Update] 解析响应失败:', err.message);
          resolve({ hasUpdate: false, error: err.message });
        }
      });
    });

    req.on('error', (err) => {
      console.error('[Update] 请求失败:', err.message);
      resolve({ hasUpdate: false, error: err.message });
    });

    req.on('timeout', () => {
      console.error('[Update] 请求超时');
      req.destroy();
      resolve({ hasUpdate: false, error: '请求超时' });
    });

    // http.request() 需要手动调用 end()（http.get() 会自动调用）
    req.end();
  });
}

/**
 * 显示更新对话框
 * @param {string} newVersion 新版本号
 * @param {string} downloadUrl 下载地址
 */
async function showUpdateDialog(newVersion, downloadUrl) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.log('[Update] 主窗口不可用，无法显示更新对话框');
    return;
  }

  console.log('[Update] 显示更新对话框, 新版本:', newVersion);

  const result = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    buttons: ['稍后更新', '立即下载'],
    defaultId: 1,
    cancelId: 0,
    title: '发现新版本',
    message: `发现新版本 v${newVersion}`,
    detail: `当前版本: v${APP_VERSION}\n新版本: v${newVersion}\n\n点击"立即下载"将在浏览器中打开下载链接。\n下载完成后请手动安装新版本。`
  });

  if (result.response === 1) {
    // 用户选择立即下载
    console.log('[Update] 用户选择下载, URL:', downloadUrl);

    // 使用系统默认浏览器打开下载链接
    shell.openExternal(downloadUrl);

    // 提示用户
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['确定'],
      title: '下载已开始',
      message: '下载链接已在浏览器中打开',
      detail: '下载完成后，请关闭当前程序并运行新版本安装包进行更新。'
    });
  } else {
    console.log('[Update] 用户选择稍后更新');
  }
}

/**
 * 启动时检查更新（延迟执行，避免影响启动速度）
 */
function scheduleUpdateCheck() {
  // 延迟 5 秒后检查更新，避免影响启动速度
  setTimeout(async () => {
    console.log('[Update] 开始检查更新...');
    const updateInfo = await checkForUpdate();

    if (updateInfo.hasUpdate && updateInfo.version && updateInfo.url) {
      await showUpdateDialog(updateInfo.version, updateInfo.url);
    }
  }, 5000);
}

// 简易文件日志（用于打包后调试 fetchSiteInfo）
const geoLogPath = path.join(app.getPath('userData'), 'geo-check.log');
function geoLog(msg) {
  const timestamp = new Date().toLocaleString('zh-CN');
  const line = `[${timestamp}] ${msg}\n`;
  console.log('[fetchSiteInfo]', msg);
  try { fs.appendFileSync(geoLogPath, line, 'utf8'); } catch (e) { /* ignore */ }
}

/**
 * 获取建站通站点信息（从服务器获取最新数据）
 * 每次导航到 GEO 页面前调用，确保 is_geo 状态为最新
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
async function fetchSiteInfo() {
  geoLog('🚀 开始获取站点信息...');
  const userInfo = globalStorage.user_info;
  const companyUniqueId = userInfo?.company?.unique_id;
  geoLog('company_unique_id: ' + (companyUniqueId || '无'));

  if (!companyUniqueId) {
    geoLog('⚠️ 无 company_unique_id，无法获取站点信息');
    return { success: false, error: '无 company_unique_id' };
  }

  const apiBaseUrl = config.domains.geoPage;
  const requestUrl = `${apiBaseUrl}/newapi/site/info?company_unique_id=${companyUniqueId}`;
  geoLog('🌐 请求: ' + requestUrl + ' (ENV=' + config.ENV + ')');

  // 使用 Electron net 模块发请求（走 Chromium 网络栈，与普通浏览器行为一致）
  // 手动从 persist:browserview session 获取 cookies 并附加到请求头
  async function doRequest() {
    // 先从 session 获取对应域名的 cookies
    const ses = session.fromPartition('persist:browserview');
    const urlObj = new URL(requestUrl);
    const domain = urlObj.hostname;
    let cookieString = '';
    try {
      const allCookies = await ses.cookies.get({});
      const domainCookies = allCookies.filter(cookie => {
        const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
        return cookieDomain.includes(domain) || domain.includes(cookieDomain);
      });
      cookieString = domainCookies.map(c => {
        const value = /[^\x00-\xff]/.test(c.value) ? encodeURIComponent(c.value) : c.value;
        return `${c.name}=${value}`;
      }).join('; ');
      geoLog('🍪 cookies: ' + domainCookies.length + ' 个, cookieString: ' + cookieString.substring(0, 200));
      // 同步发送到 renderer 控制台
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('main-log', '[fetchSiteInfo] 🍪 cookies: ' + domainCookies.length + ' 个, cookieString: ' + cookieString.substring(0, 200));
      }
    } catch (cookieErr) {
      geoLog('⚠️ 获取 cookies 失败: ' + cookieErr.message);
    }

    return new Promise((resolve) => {
      try {
        const request = net.request({
          method: 'GET',
          url: requestUrl,
          partition: 'persist:browserview'
        });

        request.setHeader('Accept', 'application/json, text/plain, */*');
        request.setHeader('User-Agent', 'Mozilla/5.0 zh.Cloud-browse');
        if (cookieString) {
          request.setHeader('Cookie', cookieString);
        }

        let responseData = '';
        let timeoutId = setTimeout(() => {
          geoLog('❌ 请求超时 (10秒)');
          request.abort();
          resolve({ success: false, error: '请求超时' });
        }, 10000);

        request.on('response', (response) => {
          geoLog('📥 响应状态码: ' + response.statusCode);
          response.on('data', (chunk) => {
            responseData += chunk.toString();
          });
          response.on('end', () => {
            clearTimeout(timeoutId);
            try {
              const result = JSON.parse(responseData);
              if (result.data) {
                resolve({ success: true, data: result.data });
              } else {
                geoLog('⚠️ 响应无 data 字段: ' + JSON.stringify(result).substring(0, 200));
                resolve({ success: false, error: '响应无 data 字段' });
              }
            } catch (err) {
              geoLog('❌ 解析响应失败: ' + err.message);
              resolve({ success: false, error: err.message });
            }
          });
        });

        request.on('error', (err) => {
          clearTimeout(timeoutId);
          geoLog('❌ 请求失败: ' + err.message);
          resolve({ success: false, error: err.message });
        });

        request.end();
      } catch (err) {
        geoLog('❌ 创建请求失败: ' + err.message);
        resolve({ success: false, error: err.message });
      }
    });
  }

  // 带重试逻辑：如果返回的 is_geo 为 null 且无 web_name，视为不完整数据，最多重试 2 次
  const MAX_RETRIES = 2;
  let lastResult = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      geoLog('🔄 第 ' + attempt + ' 次重试（上次返回 is_geo 为 null）...');
      await new Promise(r => setTimeout(r, 1000)); // 重试间隔 1 秒
    }

    lastResult = await doRequest();

    if (!lastResult.success) {
      geoLog('❌ 第 ' + (attempt + 1) + ' 次请求失败: ' + lastResult.error);
      continue;
    }

    const data = lastResult.data;
    geoLog('📦 第 ' + (attempt + 1) + ' 次响应: is_geo=' + data.is_geo + ', web_name=' + (data.web_name || '无') + ', id=' + (data.id || '无'));

    // 如果返回了完整数据（有 id 和 web_name），立即使用
    if (data.id && data.web_name) {
      geoLog('✅ 获取到完整站点数据');
      globalStorage.siteInfo = data;
      saveGlobalStorage();
      geoLog('💾 已更新 globalStorage.siteInfo');
      return { success: true, data: data };
    }

    // 如果 is_geo 不为 null（即明确为 0 或 1），也可以使用（可能是部分数据但权限字段有效）
    if (data.is_geo !== null && data.is_geo !== undefined) {
      geoLog('✅ is_geo 有明确值: ' + data.is_geo + '（数据不完整但权限字段有效）');
      globalStorage.siteInfo = data;
      saveGlobalStorage();
      geoLog('💾 已更新 globalStorage.siteInfo');
      return { success: true, data: data };
    }

    // is_geo 为 null 且无完整数据，继续重试
    geoLog('⚠️ 返回数据不完整 (is_geo=null, 无id/web_name)，可能命中了数据不全的节点');
  }

  // 所有重试完毕，使用最后一次的结果
  if (lastResult && lastResult.success) {
    geoLog('⚠️ 重试 ' + MAX_RETRIES + ' 次后仍返回不完整数据，使用最后一次结果');
    globalStorage.siteInfo = lastResult.data;
    saveGlobalStorage();
    return { success: true, data: lastResult.data };
  }

  geoLog('❌ 所有请求均失败');
  return lastResult || { success: false, error: '所有请求均失败' };
}

function createWindow() {
  // 使用 nativeImage 创建图标（支持高 DPI）
  const appIcon = nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));

  // 创建主窗口
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: '资海云运营助手',
    show: false, // 先隐藏窗口，等内容准备好再显示
    autoHideMenuBar: isProduction, // 生产环境自动隐藏菜单栏
    backgroundColor: '#f2f7fa', // 设置背景色避免白闪
    icon: appIcon, // 使用 nativeImage 加载的图标
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  // 窗口准备好后立即显示
  let windowShown = false;
  const showWindow = () => {
    if (!windowShown) {
      windowShown = true;
      mainWindow.show();
    }
  };
  mainWindow.once('ready-to-show', showWindow);
  // 保险措施：最多等待 2 秒后强制显示
  setTimeout(showWindow, 2000);

  // 为主窗口打开开发者工具（用于调试控制面板）
  // mainWindow.webContents.openDevTools();

  // 加载浏览器控制界面
  mainWindow.loadFile('index.html');

  // 监听窗口即将关闭事件，保存 session 数据
  mainWindow.on('close', async (e) => {
    if (!isQuitting) {
      e.preventDefault();
      isQuitting = true;

      console.log('========================================');
      console.log('[Window Close] 窗口关闭，正在保存 Session 数据...');

      if (browserView) {
        try {
          // 🔑 只保存项目类型（aigc/geo），不保存具体页面URL
          const currentUrl = browserView.webContents.getURL();
          if (currentUrl && !currentUrl.includes('login.html')) {
            // 判断是哪个项目
            if (currentUrl.includes('aigc_browser') || currentUrl.includes('localhost:5173')) {
              globalStorage.last_project = 'aigc';
              console.log('[Window Close] 💾 记录项目类型: aigc');
            } else if (currentUrl.includes('jzt_all') || currentUrl.includes('geo') ||
                       currentUrl.includes('localhost:8080') || currentUrl.includes('172.16.6.17:8080')) {
              globalStorage.last_project = 'geo';
              console.log('[Window Close] 💾 记录项目类型: geo');
            } else {
              // 第三方平台页面，不记录
              console.log('[Window Close] 第三方平台页面，不记录项目类型');
            }
            // 清除旧的 last_page_url（如果存在）
            delete globalStorage.last_page_url;
          } else {
            // 如果在登录页退出，不保存
            delete globalStorage.last_project;
            delete globalStorage.last_page_url;
            console.log('[Window Close] 在登录页退出，不保存项目类型');
          }
          saveGlobalStorage();

          const ses = browserView.webContents.session;
          const cookies = await ses.cookies.get({});
          console.log(`[Window Close] 当前共有 ${cookies.length} 个 cookies`);

          // 将所有会话 Cookie 转换为持久化 Cookie（设置 1 年过期时间）
          const oneYearFromNow = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);
          let convertedCount = 0;

          for (const cookie of cookies) {
            if (cookie.session) {
              // 会话 Cookie，需要转换为持久化 Cookie
              const persistentCookie = {
                url: `${cookie.secure ? 'https' : 'http'}://${cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain}${cookie.path}`,
                name: cookie.name,
                value: cookie.value,
                domain: cookie.domain,
                path: cookie.path,
                secure: cookie.secure,
                httpOnly: cookie.httpOnly,
                expirationDate: oneYearFromNow,
                sameSite: cookie.sameSite
              };

              await ses.cookies.set(persistentCookie);
              convertedCount++;
            }
          }

          console.log(`[Window Close] ✅ 转换了 ${convertedCount} 个会话 Cookie 为持久化 Cookie`);

          await ses.flushStorageData();
          console.log('[Window Close] ✅ Session 数据已写入磁盘');
          if (isPortable) {
            console.log(`[Window Close] 💾 便携版数据已保存到: ${app.getPath('userData')}`);
          }
          console.log('========================================');
        } catch (err) {
          console.error('[Window Close] ❌ 保存 Session 数据失败:', err);
        }
      }

      setTimeout(() => {
        mainWindow.destroy();
      }, 200); // 给更多时间确保数据写入磁盘
    }
  });

  // 获取或创建持久化 session（禁用 HTTP 缓存，只保留 cookies 和 storage）
  const persistentSession = session.fromPartition('persist:browserview', { cache: false });

  // 🔑 启动时彻底清理可能残留的缓存文件（解决 CSS 渲染成文字的问题）
  // 添加 5 秒超时保护，防止 clearCache 在某些电脑上挂起导致页面永远不加载
  let cacheCleared = false;
  const clearCachePromise = Promise.race([
    (async () => {
      try {
        // 清理 HTTP 缓存
        await persistentSession.clearCache();
        console.log('[Session] ✅ HTTP 缓存已清理');

        // 清理 Code Cache（JavaScript 编译缓存）
        await persistentSession.clearCodeCaches({});
        console.log('[Session] ✅ Code Cache 已清理');

        cacheCleared = true;
      } catch (err) {
        console.error('[Session] ⚠️ 清理缓存失败:', err);
        cacheCleared = true; // 即使失败也继续
      }
    })(),
    new Promise((resolve) => {
      setTimeout(() => {
        if (!cacheCleared) {
          console.warn('[Session] ⚠️ 清理缓存超时（5秒），跳过继续加载页面');
          cacheCleared = true;
        }
        resolve();
      }, 5000);
    })
  ]);

  // 在 session 级别拦截自定义协议请求（如 bitbrowser://）
  // 使用 <all_urls> 拦截所有请求
  persistentSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    // 检测非标准协议
    if (url && url.toLowerCase().startsWith('bitbrowser:')) {
      console.log('[WebRequest] ❌ Blocked bitbrowser protocol:', url);
      callback({ cancel: true });
      return;
    }
    callback({});
  });
  console.log('[Session] ✅ 已添加 webRequest 协议拦截器');

  // 🔴 修复外部页面 CSS/JS 乱码
  addContentTypeFix(persistentSession, '持久化 session');

  // 打印 session 存储路径
  console.log('========================================');
  console.log('[Session] Session 配置信息:');
  console.log('[Session] userData 路径:', app.getPath('userData'));
  console.log('[Session] Session 存储路径:', persistentSession.getStoragePath());
  console.log('[Session] 是否便携版:', isPortable);
  if (isPortable) {
    console.log('[Session] 💾 便携版模式 - 数据将保存到应用程序目录');
  }
  console.log('========================================');

  // 设置自定义 User-Agent（保持标准格式，避免某些网站解析错误）
  const customUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 zh.Cloud-browse/1.0';
  persistentSession.setUserAgent(customUA);
  console.log('User-Agent set to:', customUA);

  // 监听下载事件
  persistentSession.on('will-download', (event, item, webContents) => {
    const url = item.getURL();
    const filename = item.getFilename();
    console.log('[Download] 开始下载:', url);
    console.log('[Download] 文件名:', filename);

    // 让用户选择保存位置（使用默认文件名）
    const savePath = dialog.showSaveDialogSync(mainWindow, {
      title: '保存文件',
      defaultPath: filename,
      filters: [
        { name: '所有文件', extensions: ['*'] }
      ]
    });

    if (savePath) {
      item.setSavePath(savePath);
      console.log('[Download] 保存到:', savePath);

      item.on('updated', (event, state) => {
        if (state === 'progressing') {
          if (!item.isPaused()) {
            const received = item.getReceivedBytes();
            const total = item.getTotalBytes();
            const percent = total > 0 ? Math.round(received / total * 100) : 0;
            console.log(`[Download] 进度: ${percent}% (${received}/${total})`);
          }
        }
      });

      item.once('done', (event, state) => {
        if (state === 'completed') {
          console.log('[Download] ✅ 下载完成:', savePath);
          dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '下载完成',
            message: '文件下载成功',
            detail: `保存位置: ${savePath}`,
            buttons: ['确定']
          });
        } else {
          console.log('[Download] ❌ 下载失败:', state);
          dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: '下载失败',
            message: '文件下载失败',
            detail: `状态: ${state}`,
            buttons: ['确定']
          });
        }
      });
    } else {
      // 用户取消了保存
      console.log('[Download] 用户取消保存');
      item.cancel();
    }
  });

  // 创建 BrowserView 用于显示网页内容
  browserView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'content-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // 禁用沙箱以支持 window.opener
      webSecurity: false, // 禁用跨域限制，允许下载外部视频资源
      session: persistentSession, // 直接使用 session 对象
      backgroundThrottling: false, // 禁用后台节流，防止视频被暂停
      autoplayPolicy: 'no-user-gesture-required' // 允许自动播放视频
    }
  });

  // 设置背景色避免白屏
  browserView.setBackgroundColor('#f2f7fa');

  // 🔍 P3: 渲染进程崩溃监听 - 方便远程排查白屏问题
  browserView.webContents.on('render-process-gone', (event, details) => {
    console.error('[BrowserView] ❌ 渲染进程已退出！');
    console.error('[BrowserView] 退出原因:', details.reason);
    console.error('[BrowserView] 退出码:', details.exitCode);
    // 尝试重新加载
    if (details.reason !== 'killed') {
      console.log('[BrowserView] 🔄 尝试重新加载页面...');
      setTimeout(() => {
        if (browserView && !browserView.webContents.isDestroyed()) {
          loadLocalPage(browserView.webContents, 'login.html').catch(err => {
            console.error('[BrowserView] ❌ 重新加载失败:', err);
          });
        }
      }, 1000);
    }
  });

  browserView.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[BrowserView] ❌ 页面加载失败！');
    console.error('[BrowserView] 错误码:', errorCode);
    console.error('[BrowserView] 错误描述:', errorDescription);
    console.error('[BrowserView] 失败 URL:', validatedURL);
  });

  browserView.webContents.on('unresponsive', () => {
    console.warn('[BrowserView] ⚠️ 页面无响应！');
  });

  browserView.webContents.on('responsive', () => {
    console.log('[BrowserView] ✅ 页面已恢复响应');
  });

  mainWindow.setBrowserView(browserView);
  updateBrowserViewBounds();

  // 监听窗口大小变化
  mainWindow.on('resize', () => {
    updateBrowserViewBounds(isScriptPanelOpen);
  });

  // 等待 BrowserView 完全附加到窗口后再加载 URL
  // 使用 process.nextTick 确保 BrowserView 已经完全准备好
  process.nextTick(async () => {
    console.log('=== 首页加载开始 ===');
    console.log(`[BrowserView] isProduction: ${isProduction}`);

    // 🔑 等待缓存清理完成
    console.log('[BrowserView] 等待缓存清理完成...');
    await clearCachePromise;
    console.log('[BrowserView] ✅ 缓存清理完成，开始加载页面');

    // 检查是否有保存的登录 token
    const savedToken = globalStorage.login_token;
    const savedExpires = globalStorage.login_expires;
    const now = Math.floor(Date.now() / 1000);

    let startUrl = LOGIN_URL;

    if (savedToken && savedExpires && savedExpires > now) {
      // 有有效的 token，恢复 Cookie 并跳转到首页
      console.log('[BrowserView] 发现有效的登录 token，正在恢复登录状态...');
      console.log('[BrowserView] Token 过期时间:', new Date(savedExpires * 1000).toLocaleString());

      try {
        // 恢复 Cookie 到 session
        const ses = persistentSession;

        // 为 localhost 设置 Cookie
        await ses.cookies.set({
          url: 'http://localhost:5173/',
          name: 'token',
          value: savedToken,
          path: '/',
          expirationDate: savedExpires,
          secure: false,
          sameSite: 'lax'
        });
        await ses.cookies.set({
          url: 'http://localhost:5173/',
          name: 'access_token',
          value: savedToken,
          path: '/',
          expirationDate: savedExpires,
          secure: false,
          sameSite: 'lax'
        });

        // 为 .china9.cn 设置 Cookie
        await ses.cookies.set({
          url: config.getCookieUrl(),
          name: 'token',
          value: savedToken,
          domain: config.getCookieDomain(),
          path: '/',
          expirationDate: savedExpires,
          secure: true
        });
        await ses.cookies.set({
          url: config.getCookieUrl(),
          name: 'access_token',
          value: savedToken,
          domain: config.getCookieDomain(),
          path: '/',
          expirationDate: savedExpires,
          secure: true
        });

        // 恢复 gcc Cookie（如果有）
        if (globalStorage.login_gcc) {
          await ses.cookies.set({
            url: 'http://localhost:5173/',
            name: 'gcc',
            value: globalStorage.login_gcc,
            path: '/',
            expirationDate: savedExpires,
            secure: false,
            sameSite: 'lax'
          });
          await ses.cookies.set({
            url: config.getCookieUrl(),
            name: 'gcc',
            value: globalStorage.login_gcc,
            domain: config.getCookieDomain(),
            path: '/',
            expirationDate: savedExpires,
            secure: true
          });
        }

        // 恢复 site_id、china_site_id、company_unique_id、unique_id Cookie
        const siteInfo = globalStorage.siteInfo;
        const userInfo = globalStorage.user_info;
        if (siteInfo && siteInfo.id) {
          const siteIdStr = String(siteInfo.id);
          // site_id
          await ses.cookies.set({ url: 'http://localhost:5173/', name: 'site_id', value: siteIdStr, path: '/', secure: false, sameSite: 'lax' });
          await ses.cookies.set({ url: 'http://localhost:8080/', name: 'site_id', value: siteIdStr, path: '/', secure: false, sameSite: 'lax' });
          await ses.cookies.set({ url: config.getCookieUrl(), name: 'site_id', value: siteIdStr, domain: config.getCookieDomain(), path: '/', secure: true });
          // china_site_id
          await ses.cookies.set({ url: 'http://localhost:5173/', name: 'china_site_id', value: siteIdStr, path: '/', secure: false, sameSite: 'lax' });
          await ses.cookies.set({ url: 'http://localhost:8080/', name: 'china_site_id', value: siteIdStr, path: '/', secure: false, sameSite: 'lax' });
          await ses.cookies.set({ url: config.getCookieUrl(), name: 'china_site_id', value: siteIdStr, domain: config.getCookieDomain(), path: '/', secure: true });
          console.log('[BrowserView] ✅ site_id/china_site_id Cookie 已恢复:', siteIdStr);
        }
        if (userInfo && userInfo.company && userInfo.company.unique_id) {
          const uniqueId = String(userInfo.company.unique_id);
          // company_unique_id
          await ses.cookies.set({ url: 'http://localhost:5173/', name: 'company_unique_id', value: uniqueId, path: '/', secure: false, sameSite: 'lax' });
          await ses.cookies.set({ url: 'http://localhost:8080/', name: 'company_unique_id', value: uniqueId, path: '/', secure: false, sameSite: 'lax' });
          await ses.cookies.set({ url: config.getCookieUrl(), name: 'company_unique_id', value: uniqueId, domain: config.getCookieDomain(), path: '/', secure: true });
          // unique_id
          await ses.cookies.set({ url: 'http://localhost:5173/', name: 'unique_id', value: uniqueId, path: '/', secure: false, sameSite: 'lax' });
          await ses.cookies.set({ url: 'http://localhost:8080/', name: 'unique_id', value: uniqueId, path: '/', secure: false, sameSite: 'lax' });
          await ses.cookies.set({ url: config.getCookieUrl(), name: 'unique_id', value: uniqueId, domain: config.getCookieDomain(), path: '/', secure: true });
          console.log('[BrowserView] ✅ company_unique_id/unique_id Cookie 已恢复:', uniqueId);
        }

        await ses.flushStorageData();
        console.log('[BrowserView] ✅ 登录状态已恢复');

        // 🔑 根据上次退出的项目类型，跳转到对应首页
        const savedProject = globalStorage.last_project;
        if (savedProject === 'geo') {
          // 先调 API 获取最新 siteInfo，检查 is_geo
          console.log('[BrowserView] 📍 上次退出时在 geo 项目，重新检查 geo 权限...');
          const siteResult = await fetchSiteInfo();
          const siteInfo = siteResult.success ? siteResult.data : globalStorage.siteInfo;

          if (siteInfo && siteInfo.is_geo === 1) {
            // geo 权限通过，跳转到 geo 首页
            startUrl = config.getGeoUrl(isProduction);
            console.log('[BrowserView] ✅ geo 权限通过，恢复到 geo 项目首页:', startUrl);
          } else {
            // geo 权限不通过，跳转到未购买页面（使用特殊标记，后续用 loadFile 加载）
            console.log('[BrowserView] ⚠️ geo 权限不通过 (is_geo:', siteInfo?.is_geo, ')，跳转到未购买页面');
            startUrl = '__LOCAL_NOT_PURCHASE_GEO__';
          }
        } else {
          // 默认 aigc 项目首页
          startUrl = config.getAigcUrl(isProduction);
          console.log('[BrowserView] 📍 恢复到 aigc 项目首页:', startUrl);
        }
      } catch (err) {
        console.error('[BrowserView] ❌ 恢复登录状态失败:', err);
        startUrl = LOGIN_URL;
      }
    } else {
      console.log('[BrowserView] 没有有效的登录 token，显示登录页');
      if (savedToken && savedExpires) {
        console.log('[BrowserView] Token 已过期，过期时间:', new Date(savedExpires * 1000).toLocaleString());
        // 清除过期的 token
        delete globalStorage.login_token;
        delete globalStorage.login_expires;
        delete globalStorage.login_gcc;
        saveGlobalStorage();
      }
    }

    console.log(`[BrowserView] 准备加载: ${startUrl}`);
    console.log('===================');

    // 根据初始 URL 设置头部显示状态
    isHeaderHidden = startUrl.includes('login.html');
    updateBrowserViewBounds(isScriptPanelOpen);

    // 🔴 本地文件使用 loadFile，远程URL使用 loadURL（避免 file:// MIME 类型问题）
    let loadPage;
    if (startUrl === '__LOCAL_NOT_PURCHASE_GEO__') {
      // GEO 权限不通过，使用 loadFile + query 参数正确加载本地页面
      loadPage = browserView.webContents.loadFile(path.join(__dirname, config.placeholderPages.notPurchase), { query: { system: 'geo' } });
    } else if (startUrl.startsWith('file://')) {
      loadPage = loadLocalPage(browserView.webContents, path.basename(startUrl));
    } else {
      loadPage = browserView.webContents.loadURL(startUrl);
    }

    loadPage
      .then(() => {
        console.log('[BrowserView] ✅ 页面加载调用成功');
        // 🔍 白屏检测：loadFile 可能回调成功但 GPU 渲染失败导致页面实际为空
        // 10秒后检查页面是否有内容，没有则重新加载
        setTimeout(async () => {
          if (!browserView || browserView.webContents.isDestroyed()) return;
          try {
            const bodyHTML = await browserView.webContents.executeJavaScript(
              'document.body ? document.body.innerHTML.trim().length : 0'
            );
            if (bodyHTML === 0) {
              console.warn('[BrowserView] ⚠️ 白屏检测：页面加载成功但内容为空，尝试重新加载');
              loadLocalPage(browserView.webContents, 'login.html').catch(err => {
                console.error('[BrowserView] ❌ 白屏恢复重载失败:', err);
              });
            } else {
              console.log('[BrowserView] ✅ 白屏检测：页面内容正常，长度:', bodyHTML);
            }
          } catch (e) {
            console.warn('[BrowserView] ⚠️ 白屏检测执行失败（渲染进程可能已崩溃）:', e.message);
          }
        }, 10000);
      })
      .catch(err => {
        console.error('[BrowserView] ❌ 页面加载失败:', err);
        // 失败后3秒重试一次
        setTimeout(() => {
          console.log('[BrowserView] 🔄 3秒后重试加载...');
          const retryLoad = startUrl.startsWith('file://')
            ? loadLocalPage(browserView.webContents, path.basename(startUrl))
            : browserView.webContents.loadURL(startUrl);
          retryLoad.catch(e => {
            console.error('[BrowserView] ❌ 重试失败:', e);
          });
        }, 3000);
      });
  });

  // 脚本注入函数（提取为公共函数，可复用）
  const injectScriptForUrl = async (webContents, url, retryCount = 0) => {
    // 检查 webContents 是否已销毁
    if (!webContents || webContents.isDestroyed()) {
      return;
    }

    // 获取窗口 ID 用于调试
    const windowId = webContents.id;
    const isNewWindow = !childWindows.some(win => win?.webContents?.id === windowId) && browserView?.webContents?.id !== windowId;

    console.log('==================================================');
    console.log(`[Script Injection] Window ID: ${windowId} ${isNewWindow ? '(New Window)' : '(Main/BrowserView)'}`);
    console.log('[Script Injection] Checking URL:', url);

    // 页面状态预检查脚本 - 检测CSS代码是否被当作文本显示
    // 如果异常，保持隐藏状态；如果正常，移除预防性隐藏样式
    const pageCheckScript = `
      (function() {
        if (!document.body) return { ready: false, reason: 'no body' };

        // 🔑 跳过包含富文本编辑器的页面（TinyMCE, CKEditor, Quill, wangEditor 等）
        const richEditorSelectors = [
          '.tiny-textarea', '.tox', '.tox-tinymce', '.mce-container', '.mce-content-body',
          '.ck-editor', '.ck-content', '[data-tiny-editor]',
          '.ql-editor', '.ql-container', '.quill',
          '.w-e-text', '.w-e-toolbar', '[data-wangeditor]',
          '.CodeMirror', '.monaco-editor',
          '[contenteditable="true"]',
          'iframe[id*="editor"]', 'iframe[id*="tinymce"]'
        ];
        const hasRichEditor = richEditorSelectors.some(sel => document.querySelector(sel));

        // 🔑 检查 URL 路径，跳过可能包含编辑器的页面
        const editorPaths = ['/edit', '/editor', '/publish', '/create', '/write', '/article', '/content'];
        const isEditorPage = editorPaths.some(p => window.location.pathname.includes(p) || window.location.hash.includes(p));

        if (hasRichEditor || isEditorPage) {
          console.log('[Page Check] 检测到富文本编辑器或编辑页面，跳过CSS检测');
          const preHideStyle = document.getElementById('__pre_hide_style__');
          if (preHideStyle) preHideStyle.remove();
          if (document.body) {
            document.body.style.visibility = '';
            document.body.style.opacity = '';
          }
          return { ready: true, reason: 'editor-detected' };
        }

        const bodyText = document.body.innerText || '';
        const cssPatterns = [
          'text-decoration:none',
          'background-color:transparent',
          'cursor:pointer',
          'border-radius:',
          'display:block',
          'position:absolute',
          ':hover{',
          '@media '
        ];

        let cssMatchCount = 0;
        for (const pattern of cssPatterns) {
          if (bodyText.includes(pattern)) cssMatchCount++;
        }

        if (cssMatchCount >= 3) {
          // 页面异常，保持隐藏状态，添加遮罩 + loading动画
          if (!document.getElementById('__page_loading_mask__')) {
            const mask = document.createElement('div');
            mask.id = '__page_loading_mask__';
            mask.innerHTML = '<style>@keyframes __loading_spin__{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style><div style="width:40px;height:40px;border:3px solid #f3f3f3;border-top:3px solid #3498db;border-radius:50%;animation:__loading_spin__ 1s linear infinite;"></div>';
            mask.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#fff;z-index:999999;display:flex;align-items:center;justify-content:center;';
            document.documentElement.appendChild(mask);
          }

          return { ready: false, reason: 'css-as-text', matchCount: cssMatchCount };
        }

        // 页面正常，移除预防性隐藏样式
        const preHideStyle = document.getElementById('__pre_hide_style__');
        if (preHideStyle) preHideStyle.remove();
        if (document.body) {
          document.body.style.visibility = '';
          document.body.style.opacity = '';
        }

        return { ready: true };
      })()
    `;

    // 🔑 页面状态检测 - 只在登录页和首页检测 CSS 渲染异常
    // 其他页面（可能包含富文本编辑器）跳过检测，避免白屏问题
    const safeCheckUrls = ['login.html', '/#/', '/aigc_browser/', '/jzt_all/', 'localhost:5173/', 'localhost:8080/'];
    const shouldCheckPage = safeCheckUrls.some(pattern => url.includes(pattern)) &&
                            !url.includes('/edit') && !url.includes('/publish') &&
                            !url.includes('/create') && !url.includes('/article');

    if (shouldCheckPage) {
      try {
        // 先检查页面状态
        const pageState = await webContents.executeJavaScript(pageCheckScript);

        if (!pageState.ready) {
          console.log(`[Script Injection] ⚠️ 页面状态异常: ${pageState.reason}，已隐藏页面内容`);

          // 最多重试2次，每次间隔1.5秒，然后刷新
          if (retryCount < 2) {
            console.log(`[Script Injection] ⏳ ${1.5}秒后重试 (第${retryCount + 1}次)...`);
            setTimeout(() => {
              injectScriptForUrl(webContents, url, retryCount + 1);
            }, 1500);
            return;
          } else {
            console.log('[Script Injection] ❌ 页面持续异常，刷新页面...');
            webContents.reload();
            return;
          }
        }
      } catch (checkErr) {
        // 检查脚本执行失败，可能页面还没准备好
        if (!checkErr.message.includes('destroyed')) {
          console.log('[Script Injection] ⚠️ 页面检查失败:', checkErr.message);
          if (retryCount < 2) {
            setTimeout(() => {
              injectScriptForUrl(webContents, url, retryCount + 1);
            }, 1000);
            return;
          }
        }
      }
    }

    // 注入公共头（已移至浏览器级别 index.html，不再每页注入）
    // 保留此注释以便将来参考，公共头现在固定在 index.html 中，不会随页面切换而闪烁

    // 注入对应的自定义脚本
    const script = await scriptManager.getScript(url);

    if (script) {
      // 再次检查（异步操作后可能已销毁）
      if (webContents.isDestroyed()) {
        return;
      }
      console.log('[Script Injection] Script found! Total length:', script.length);
      console.log('[Script Injection] Preview:', script.substring(0, 150) + '...');
      console.log('✅ [Script Injection] Executing...');
      try {
        const result = await webContents.executeJavaScript(script);
        console.log('✅ [Script Injection] Script executed successfully!');
        console.log('[Script Injection] Execution result:', result);
      } catch (err) {
        // 忽略窗口销毁导致的错误
        if (!err.message.includes('destroyed')) {
          console.error('❌ [Script Injection] Script execution error:', err);
        }
      }
    } else {
      // 没有脚本时，只显示简单的调试信息
      console.log('ℹ️ [Script Injection] No script configured for this URL');
    }
    console.log('==================================================');
  };

  // BrowserView 的脚本注入函数
  const injectScriptForCurrentPage = async () => {
    // 检查 webContents 是否已销毁
    if (!browserView || browserView.webContents.isDestroyed()) {
      return;
    }
    const currentURL = browserView.webContents.getURL();
    console.log(`[Navigation] 页面加载完成 → ${currentURL}`);
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send('url-changed', currentURL);
    await injectScriptForUrl(browserView.webContents, currentURL);
  };

  // 拦截导航请求，阻止自定义协议（如 bitbrowser://）触发系统对话框
  browserView.webContents.on('will-navigate', (event, url) => {
    if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
      console.log('[Navigation] ❌ Blocked non-http protocol:', url);
      event.preventDefault();
    }
  });

  // 拦截 iframe 导航请求，阻止自定义协议
  browserView.webContents.on('will-frame-navigate', (event) => {
    const url = event.url;
    if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
      console.log('[Frame Navigation] ❌ Blocked non-http protocol:', url);
      event.preventDefault();
    }
  });

  // 预防性隐藏脚本 - 在导航开始时立即隐藏页面，防止用户看到异常内容
  const preHideScript = `
    (function() {
      // 立即注入隐藏样式（比 DOM 操作更早生效）
      if (!document.getElementById('__pre_hide_style__')) {
        const style = document.createElement('style');
        style.id = '__pre_hide_style__';
        style.textContent = 'body { visibility: hidden !important; opacity: 0 !important; }';
        document.head ? document.head.appendChild(style) : document.documentElement.appendChild(style);
      }
    })()
  `;

  // 🔑 记录跳转到无权限页面前的 URL（用于保持 header 选中状态）
  let lastValidUrl = null;
  let pendingNavigationUrl = null;  // 记录用户点击的原始目标 URL

  // 监听用户点击链接（在导航开始前触发，可捕获原始目标 URL）
  browserView.webContents.on('will-navigate', (event, url) => {
    console.log(`[Navigation] 用户点击链接 → ${url}`);
    // 记录用户点击的目标 URL（即使会被重定向）
    if (!url.includes(config.domains.authRedirect) && !url.startsWith('file://')) {
      pendingNavigationUrl = url;
    }
  });

  // 监听 hash 路由变化（Vue 前端路由跳转）
  browserView.webContents.on('did-navigate-in-page', (event, url) => {
    console.log(`[Navigation] Hash 路由变化 → ${url}`);
    // 记录 hash 路由变化的 URL（前端路由跳转到的目标页面）
    if (!url.includes(config.domains.authRedirect) && !url.startsWith('file://') && !url.includes(config.placeholderPages.notAvailable)) {
      pendingNavigationUrl = url;
      lastValidUrl = url;
    }
  });

  // 监听页面导航开始
  browserView.webContents.on('did-start-navigation', (event, url) => {
    console.log(`[Navigation] 导航开始 → ${url}`);

    // 🔑 提前拦截 account.china9.cn/login，阻止页面显示
    if (url.includes(config.domains.authRedirect + '/login')) {
      console.log('[Navigation] ⚠️ 检测到统一登录页，停止导航');
      console.log('[Navigation] pendingNavigationUrl:', pendingNavigationUrl);
      console.log('[Navigation] lastValidUrl:', lastValidUrl);

      // 延迟执行，避免在导航事件中直接触发新导航导致浏览器崩溃
      setImmediate(() => {
        if (browserView && !browserView.webContents.isDestroyed()) {
          // 优先使用 pendingNavigationUrl（用户点击的原始目标），其次使用 lastValidUrl
          const urlToSend = pendingNavigationUrl || lastValidUrl;

          // 根据目标 URL 判断系统类型，传递给 not-available.html
          let systemParam = 'aigc';
          if (urlToSend) {
            const urlLower = urlToSend.toLowerCase();
            if (urlLower.includes(':8080') ||
                urlLower.includes('/geo/') ||
                urlLower.includes('/jzt_all/') ||
                urlLower.includes('jzt_dev') ||
                urlLower.includes('zhjzt')) {
              systemParam = 'geo';
            }
          }
          console.log('[Navigation] 系统类型:', systemParam);

          // 加载占位页，带上 system 参数
          browserView.webContents.loadFile(path.join(__dirname, config.placeholderPages.notAuth), { query: { system: systemParam } });

          // 🔑 发送目标页面 URL 给 renderer，保持 header 选中状态
          if (mainWindow && !mainWindow.isDestroyed() && urlToSend) {
            console.log('[Navigation] 发送 URL 到 renderer:', urlToSend);
            mainWindow.webContents.send('url-changed', urlToSend);
          }
        }
        // 清空 pendingNavigationUrl
        pendingNavigationUrl = null;
      });
      return;
    }

    // 记录有效的 URL（排除本地文件和特殊页面）
    if (!url.includes(config.domains.authRedirect) && !url.startsWith('file://') && (!url.includes(config.placeholderPages.notAvailable) && !url.includes(config.placeholderPages.notAuth))) {
      lastValidUrl = url;
    }
    // 清空 pendingNavigationUrl（导航成功开始）
    pendingNavigationUrl = null;

    // 【已禁用】预防性隐藏脚本 - 会导致 TinyMCE 白屏且对 CSS 渲染异常无效
    // if (browserView && !browserView.webContents.isDestroyed()) {
    //   browserView.webContents.executeJavaScript(preHideScript).catch(() => {});
    // }
  });

  // 监听页面导航完成
  browserView.webContents.on('did-navigate', async (event, url) => {
    console.log(`[Navigation] 导航完成 → ${url}`);
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('url-changed', url);
    // 根据 URL 判断是否需要隐藏公共头部
    updateHeaderVisibility(url);

    // 🔑 检查是否是需要跳转登录页的特定 URL
    const loginRedirectUrls = getLoginRedirectUrls();

    // account.china9.cn/login 已在 did-start-navigation 中提前拦截

    const shouldRedirectToLogin = loginRedirectUrls.some(pattern => url.includes(pattern));
    if (shouldRedirectToLogin) {
      console.log('[Auth Check] ⚠️ 检测到登录/首页重定向URL，跳转到本地登录页');
      delete globalStorage.login_token;
      delete globalStorage.login_expires;
      delete globalStorage.login_gcc;
      saveGlobalStorage();
      loadLocalPage(browserView.webContents, 'login.html');
      return;
    }

    // 🔑 检查登录状态（Cookie 中的 token, access_token, PHPSESSID）
    // 排除：登录页、本地文件、第三方平台授权页
    const shouldCheckAuth = url.startsWith('http://') || url.startsWith('https://');
    const isLoginPage = url.includes('login.html') || url.includes('/login');
    const isLocalFile = url.startsWith('file://');
    const isThirdPartyAuth = url.includes('douyin.com') || url.includes('xiaohongshu.com') ||
                             url.includes('baidu.com') || url.includes('weixin.qq.com') ||
                             url.includes('channels.weixin.qq.com');

    if (shouldCheckAuth && !isLoginPage && !isLocalFile && !isThirdPartyAuth) {
      try {
        const ses = browserView.webContents.session;
        const cookies = await ses.cookies.get({});

        // 检查必要的 Cookie 是否存在
        // 注意：只检查 token 和 access_token，不检查 PHPSESSID
        // PHPSESSID 是服务器端设置的会话 Cookie，首次访问时还没有
        const hasToken = cookies.some(c => c.name === 'token' && c.value);
        const hasAccessToken = cookies.some(c => c.name === 'access_token' && c.value);

        console.log(`[Auth Check] token: ${hasToken}, access_token: ${hasAccessToken}`);

        if (!hasToken || !hasAccessToken) {
          console.log('[Auth Check] ⚠️ 缺少登录凭证，跳转到登录页');
          // 清除过期的登录信息
          delete globalStorage.login_token;
          delete globalStorage.login_expires;
          delete globalStorage.login_gcc;
          saveGlobalStorage();
          // 跳转到登录页
          loadLocalPage(browserView.webContents, 'login.html');
          return;
        }
      } catch (err) {
        console.error('[Auth Check] 检查 Cookie 失败:', err);
      }
    }
  });

  // 🔑 监听页面 DOM 准备完成（刷新页面时也会触发）
  browserView.webContents.on('dom-ready', async () => {
    const url = browserView.webContents.getURL();
    console.log(`[DOM Ready] 页面准备完成 → ${url}`);

    // 🔑 检查是否是需要跳转登录页的特定 URL
    const loginRedirectUrls = getLoginRedirectUrls();

    // account.china9.cn/login 已在 did-start-navigation 中提前拦截

    const shouldRedirectToLogin = loginRedirectUrls.some(pattern => url.includes(pattern));
    if (shouldRedirectToLogin) {
      console.log('[Auth Check - DOM Ready] ⚠️ 检测到登录/首页重定向URL，跳转到本地登录页');
      delete globalStorage.login_token;
      delete globalStorage.login_expires;
      delete globalStorage.login_gcc;
      saveGlobalStorage();
      loadLocalPage(browserView.webContents, 'login.html');
      return;
    }

    // 检查登录状态（与 did-navigate 相同的逻辑）
    const shouldCheckAuth = url.startsWith('http://') || url.startsWith('https://');
    const isLoginPage = url.includes('login.html') || url.includes('/login');
    const isLocalFile = url.startsWith('file://');
    const isThirdPartyAuth = url.includes('douyin.com') || url.includes('xiaohongshu.com') ||
                             url.includes('baidu.com') || url.includes('weixin.qq.com') ||
                             url.includes('channels.weixin.qq.com');

    if (shouldCheckAuth && !isLoginPage && !isLocalFile && !isThirdPartyAuth) {
      try {
        const ses = browserView.webContents.session;
        const cookies = await ses.cookies.get({});

        const hasToken = cookies.some(c => c.name === 'token' && c.value);
        const hasAccessToken = cookies.some(c => c.name === 'access_token' && c.value);

        console.log(`[Auth Check - DOM Ready] token: ${hasToken}, access_token: ${hasAccessToken}`);

        if (!hasToken || !hasAccessToken) {
          console.log('[Auth Check - DOM Ready] ⚠️ 缺少登录凭证，跳转到登录页');
          delete globalStorage.login_token;
          delete globalStorage.login_expires;
          delete globalStorage.login_gcc;
          saveGlobalStorage();
          loadLocalPage(browserView.webContents, 'login.html');
          return;
        }
      } catch (err) {
        console.error('[Auth Check - DOM Ready] 检查 Cookie 失败:', err);
      }
    }
  });

  // 页面异常检测脚本（在 dom-ready 时尽早执行）
  const earlyPageCheckScript = `
    (function() {
      // 延迟一小段时间等待内容渲染
      setTimeout(() => {
        if (!document.body) return;

        // 跳过包含富文本编辑器的页面（TinyMCE, CKEditor 等）
        const hasRichEditor = document.querySelector('.tiny-textarea, .tox, .tox-tinymce, .mce-container, .ck-editor, [data-tiny-editor]');
        if (hasRichEditor) {
          console.log('[Early Check] 检测到富文本编辑器，跳过CSS检测');
          const preHideStyle = document.getElementById('__pre_hide_style__');
          if (preHideStyle) preHideStyle.remove();
          if (document.body) {
            document.body.style.visibility = '';
            document.body.style.opacity = '';
          }
          return;
        }

        const bodyText = document.body.innerText || '';
        const cssPatterns = [
          'text-decoration:none',
          'background-color:transparent',
          'cursor:pointer',
          'border-radius:',
          'display:block',
          'position:absolute',
          ':hover{',
          '@media '
        ];

        let cssMatchCount = 0;
        for (const pattern of cssPatterns) {
          if (bodyText.includes(pattern)) cssMatchCount++;
        }

        if (cssMatchCount >= 3) {
          console.error('[Early Check] 检测到页面渲染异常，准备刷新页面');
          // 保持隐藏状态，添加 loading 遮罩
          if (!document.getElementById('__page_loading_mask__')) {
            const mask = document.createElement('div');
            mask.id = '__page_loading_mask__';
            mask.innerHTML = '<style>@keyframes __loading_spin__{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style><div style="width:40px;height:40px;border:3px solid #f3f3f3;border-top:3px solid #3498db;border-radius:50%;animation:__loading_spin__ 1s linear infinite;"></div>';
            mask.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#fff;z-index:999999;display:flex;align-items:center;justify-content:center;';
            document.documentElement.appendChild(mask);
          }
          // 1.5秒后刷新页面
          setTimeout(() => window.location.reload(), 1500);
        } else {
          // 页面正常，移除预防性隐藏样式，显示页面
          console.log('[Early Check] 页面渲染正常，显示页面');
          const preHideStyle = document.getElementById('__pre_hide_style__');
          if (preHideStyle) preHideStyle.remove();
          // 确保 body 可见
          if (document.body) {
            document.body.style.visibility = '';
            document.body.style.opacity = '';
          }
        }
      }, 100); // 增加延迟到100ms，确保内容渲染完成
    })()
  `;

  // 【临时禁用】在 dom-ready 时尽早检测页面状态（比 did-finish-load 更早）
  // browserView.webContents.on('dom-ready', () => {
  //   console.log('[Navigation] DOM Ready，执行早期页面检测...');
  //   if (browserView && !browserView.webContents.isDestroyed()) {
  //     browserView.webContents.executeJavaScript(earlyPageCheckScript).catch(() => {});
  //   }
  // });

  // 监听页面内导航（如 hash 变化）- 单页应用路由切换
  browserView.webContents.on('did-navigate-in-page', async (event, url) => {
    console.log(`[Navigation] 页面内跳转 → ${url}`);
    if (!mainWindow || mainWindow.isDestroyed()) return;

    // 检测远程登录页，自动跳转到本地登录页
    if (url.includes('dev.china9.cn/aigc_browser/#/login') ||
        (url.includes('china9.cn') && url.includes('#/login'))) {
      console.log('[Navigation] 🔄 检测到远程登录页，跳转到本地登录页...');
      loadLocalPage(browserView.webContents, 'login.html');
      return;
    }

    // 🔑 优先检测 token 有效性（登录检查优先于权限检查）
    // 仅在访问自己平台时检测，不影响第三方平台
    const isOwnPlatform = url.includes('china9.cn') || url.includes('localhost:5173') || url.includes('localhost:8080');
    if (isOwnPlatform && !url.includes('login.html') && !url.includes('#/login')) {
      const savedToken = globalStorage.login_token;
      const savedExpires = globalStorage.login_expires;
      const now = Math.floor(Date.now() / 1000);

      if (!savedToken || !savedExpires || savedExpires <= now) {
        console.log('[Navigation] ⚠️ Token 无效或已过期，跳转到登录页...');
        // 清除过期数据
        delete globalStorage.login_token;
        delete globalStorage.login_expires;
        delete globalStorage.login_gcc;
        saveGlobalStorage();
        loadLocalPage(browserView.webContents, 'login.html');
        return;
      }
    }

    // 🔑 已登录状态下，检查 geo 页面权限（仅真正的 GEO 域名才检查）
    const geoHost = config.domains.geoPage.replace('https://', '').replace('http://', '');
    if (url.includes(':8080') || url.includes(geoHost)) {
      console.log('[Geo Auth Check] 检测到 geo 页面，重新获取站点信息...');
      const siteResult = await fetchSiteInfo();
      const siteInfo = siteResult.success ? siteResult.data : globalStorage.siteInfo;
      geoLog('[did-navigate-in-page] URL: ' + url);
      geoLog('[did-navigate-in-page] siteResult.success=' + siteResult.success + ', is_geo=' + siteInfo?.is_geo);

      if (!siteInfo || !siteInfo.is_geo || siteInfo.is_geo !== 1) {
        console.log('[Geo Auth Check] ⚠️ 未购买 geo 产品，跳转到未购买页面');
        const notPurchaseUrl = 'file:///' + __dirname.replace(/\\/g, '/') + '/' + config.placeholderPages.notPurchase + '?system=geo';
        browserView.webContents.loadURL(notPurchaseUrl);
        // 通知 renderer 更新 Tab 选中状态为 GEO
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('url-changed', notPurchaseUrl);
        }
        return;
      }
      console.log('[Geo Auth Check] ✅ geo 权限检查通过');
    }

    mainWindow.webContents.send('url-changed', url);
    // 根据 URL 判断是否需要隐藏公共头部
    updateHeaderVisibility(url);
    console.log('[SPA Navigation] Hash/path changed, injecting script...');
    // 单页应用路由切换时也需要注入脚本
    await injectScriptForCurrentPage();
  });

  // 监听页面加载完成，注入自定义脚本
  browserView.webContents.on('did-finish-load', injectScriptForCurrentPage);

  // 监听完整页面导航，检测远程登录页和 token 有效性
  browserView.webContents.on('did-navigate', (event, url) => {
    console.log(`[Navigation] 页面导航 → ${url}`);

    // 检测远程登录页，自动跳转到本地登录页
    if (url.includes('dev.china9.cn/aigc_browser/#/login') ||
        (url.includes('china9.cn') && url.includes('#/login'))) {
      console.log('[Navigation] 🔄 检测到远程登录页，跳转到本地登录页...');
      loadLocalPage(browserView.webContents, 'login.html');
      return;
    }

    // 🔑 优先检测 token 有效性（登录检查优先于权限检查）
    // 仅在访问自己平台时检测，不影响第三方平台
    const isOwnPlatform = url.includes('china9.cn') || url.includes('localhost:5173') || url.includes('localhost:8080');
    if (isOwnPlatform && !url.includes('login.html') && !url.includes('#/login')) {
      const savedToken = globalStorage.login_token;
      const savedExpires = globalStorage.login_expires;
      const now = Math.floor(Date.now() / 1000);

      if (!savedToken || !savedExpires || savedExpires <= now) {
        console.log('[Navigation] ⚠️ Token 无效或已过期，跳转到登录页...');
        // 清除过期数据
        delete globalStorage.login_token;
        delete globalStorage.login_expires;
        delete globalStorage.login_gcc;
        saveGlobalStorage();
        loadLocalPage(browserView.webContents, 'login.html');
        return;
      }
    }

    // 🔑 已登录状态下，检查 geo 页面权限（仅真正的 GEO 域名才检查）
    const geoHost = config.domains.geoPage.replace('https://', '').replace('http://', '');
    if (url.includes(':8080') || url.includes(geoHost)) {
      console.log('[Geo Auth Check - did-navigate] 检测到 geo 页面，先用缓存检查，同时后台刷新...');
      const siteInfo = globalStorage.siteInfo;
      console.log('[Geo Auth Check - did-navigate] is_geo:', siteInfo?.is_geo);

      if (!siteInfo || !siteInfo.is_geo || siteInfo.is_geo !== 1) {
        console.log('[Geo Auth Check - did-navigate] ⚠️ 缓存显示未购买 geo 产品，跳转到未购买页面');
        const notPurchaseUrl = 'file:///' + __dirname.replace(/\\/g, '/') + '/' + config.placeholderPages.notPurchase + '?system=geo';
        browserView.webContents.loadURL(notPurchaseUrl);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('url-changed', notPurchaseUrl);
        }
        return;
      }
      console.log('[Geo Auth Check - did-navigate] ✅ 缓存显示 geo 权限通过');

      // 后台异步刷新 siteInfo 缓存（不阻塞导航）
      fetchSiteInfo().then(result => {
        if (result.success && result.data && (!result.data.is_geo || result.data.is_geo !== 1)) {
          console.log('[Geo Auth Check - did-navigate] ⚠️ 最新数据显示 geo 权限已失效，跳转到未购买页面');
          const notPurchaseUrl = 'file:///' + __dirname.replace(/\\/g, '/') + '/' + config.placeholderPages.notPurchase + '?system=geo';
          browserView.webContents.loadURL(notPurchaseUrl);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('url-changed', notPurchaseUrl);
          }
        }
      }).catch(() => {});
    }
  });

  // 监听新窗口请求 - 默认行为：总是打开新窗口（类似正常浏览器）
  browserView.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[Window Open] Request to open:', url);

    // 过滤自定义协议（如 bitbrowser://），阻止系统弹出"需要使用新应用"对话框
    if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
      console.log('[Window Open] ❌ Blocked non-http protocol:', url);
      return { action: 'deny' };
    }

    // 检测下载 URL（包含 /download 或 /api/bucket/download 等）
    if (url && (url.includes('/api/bucket/download') || url.includes('/download?') || url.includes('/download/'))) {
      console.log('[Window Open] 📥 检测到下载链接:', url);

      // 尝试从 URL 参数中提取实际的文件 URL
      let actualUrl = url;
      try {
        const urlObj = new URL(url);
        const fileUrl = urlObj.searchParams.get('url');
        if (fileUrl) {
          actualUrl = fileUrl;
          console.log('[Window Open] 📥 提取到实际文件 URL:', actualUrl);
        }
      } catch (e) {
        console.log('[Window Open] ⚠️ URL 解析失败，使用原始 URL');
      }

      // 异步触发下载，不阻塞
      setImmediate(() => {
        browserView.webContents.downloadURL(actualUrl);
      });

      return { action: 'deny' }; // 阻止打开新窗口
    }

    console.log('[Window Open] ✅ Opening new window for:', url);

    // 使用 allow 模式，保持 window.opener 引用
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 1200,
        height: 800,
        webPreferences: {
          preload: path.join(__dirname, 'content-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false, // 禁用沙箱以支持 window.opener
          session: browserView.webContents.session, // 使用相同的 session
          backgroundThrottling: false, // 禁用后台节流，防止视频被暂停
          autoplayPolicy: 'no-user-gesture-required' // 允许自动播放视频
        }
      }
    };
  });

  // 监听新窗口创建完成（用于添加脚本注入等功能）
  browserView.webContents.on('did-create-window', (newWindow) => {
    console.log('[Window Created] New window created');

    // 添加到子窗口列表
    childWindows.push(newWindow);

    // 拦截子窗口的导航请求，阻止自定义协议（如 bitbrowser://）触发系统对话框
    newWindow.webContents.on('will-navigate', (event, url) => {
      if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
        console.log('[New Window] ❌ Blocked non-http protocol:', url);
        event.preventDefault();
      }
    });

    // 拦截子窗口 iframe 导航请求，阻止自定义协议
    newWindow.webContents.on('will-frame-navigate', (event) => {
      const url = event.url;
      if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
        console.log('[New Window Frame] ❌ Blocked non-http protocol:', url);
        event.preventDefault();
      }
    });

    // 拦截子窗口重定向请求，阻止自定义协议
    newWindow.webContents.on('will-redirect', (event, url) => {
      console.log('[New Window Redirect] 检测到重定向:', url);
      if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
        console.log('[New Window Redirect] ❌ Blocked non-http protocol:', url);
        event.preventDefault();
      }
    });

    // 监听子窗口导航开始（用于调试）
    newWindow.webContents.on('did-start-navigation', (event, url, isInPlace, isMainFrame) => {
      console.log('[New Window Navigation] 导航开始:', url, 'isMainFrame:', isMainFrame);
      if (url && url.toLowerCase().startsWith('bitbrowser:')) {
        console.log('[New Window Navigation] ⚠️ 检测到 bitbrowser 协议导航!');
      }
      // 【已禁用】预防性隐藏脚本 - 会干扰正常页面渲染
      // if (newWindow && !newWindow.isDestroyed() && !newWindow.webContents.isDestroyed()) {
      //   newWindow.webContents.executeJavaScript(preHideScript).catch(() => {});
      // }
    });

    // 拦截子窗口打开新窗口的请求，阻止自定义协议
    newWindow.webContents.setWindowOpenHandler(({ url }) => {
      console.log('[New Window Open] Request to open:', url);

      // 过滤自定义协议（如 bitbrowser://）
      if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
        console.log('[New Window Open] ❌ Blocked non-http protocol:', url);
        return { action: 'deny' };
      }

      console.log('[New Window Open] ✅ Allowing:', url);
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1200,
          height: 800,
          webPreferences: {
            preload: path.join(__dirname, 'content-preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            session: browserView.webContents.session,
            backgroundThrottling: false, // 禁用后台节流，防止视频被暂停
            autoplayPolicy: 'no-user-gesture-required' // 允许自动播放视频
          }
        }
      };
    });

    // 忽略页面的 beforeunload 事件，允许直接关闭窗口
    newWindow.webContents.on('will-prevent-unload', (event) => {
      console.log('[Window Manager] 忽略页面的 beforeunload 事件，强制关闭窗口');
      event.preventDefault();
    });

    // 保存窗口 ID
    const windowId = newWindow.id;
    // 标记是否正在保存中（防止重复触发）
    let isSavingSession = false;

    // 🔑 监听窗口关闭前事件，尝试保存登录信息（如果是多账号模式窗口）
    newWindow.on('close', async (e) => {
      console.log('[did-create-window] ========== 窗口关闭前 ==========');
      console.log('[did-create-window] windowId:', windowId);
      console.log('[did-create-window] URL:', newWindow.webContents.getURL());

      // 防止重复触发
      if (isSavingSession) {
        console.log('[did-create-window] 正在保存中，忽略重复触发');
        return;
      }

      // 检查是否是多账号模式的窗口（虽然 did-create-window 创建的窗口通常不是）
      const accountInfo = windowAccountMap.get(windowId);
      if (accountInfo) {
        // 阻止窗口立即关闭，等待保存完成
        e.preventDefault();
        isSavingSession = true;

        console.log('[did-create-window] 发现多账号映射，等待保存会话数据完成后再关闭');

        try {
          // 调用公共函数保存登录信息
          const result = await saveWindowSessionToBackend(newWindow, windowId);
          console.log('[did-create-window] 保存结果:', result);

          // 通知首页：会话数据已更新
          if (browserView && !browserView.webContents.isDestroyed() && result.success) {
            const publishDataKey = `publish_data_window_${windowId}`;
            const publishData = globalStorage[publishDataKey];
            browserView.webContents.send('session-updated', {
              windowId: windowId,
              platform: accountInfo.platform,
              accountId: accountInfo.accountId,
              success: result.success,
              cookieCount: result.cookieCount,
              publishData: publishData,
              timestamp: Date.now()
            });
            console.log('[did-create-window] ✅ 已通知首页会话数据已更新');
          }
        } catch (err) {
          console.error('[did-create-window] ❌ 保存会话数据时出错:', err);
        } finally {
          // 保存完成（无论成功失败），销毁窗口
          console.log('[did-create-window] 保存完成，销毁窗口');
          newWindow.destroy();
        }
      } else {
        console.log('[did-create-window] 非多账号模式窗口，直接关闭');
      }
    });

    // 监听窗口关闭事件
    newWindow.on('closed', () => {
      const index = childWindows.indexOf(newWindow);
      if (index > -1) {
        childWindows.splice(index, 1);
        console.log('[Window Manager] 窗口已关闭，当前窗口数量:', childWindows.length);
      }
    });

    // 开发环境自动打开 DevTools
    if (!isProduction) {
      newWindow.webContents.openDevTools();
    }

    // 【已禁用】新窗口早期页面检测 - 会误判正常页面导致不必要的刷新
    // newWindow.webContents.on('dom-ready', () => {
    //   console.log('[New Window] DOM Ready，执行早期页面检测...');
    //   if (newWindow && !newWindow.isDestroyed() && !newWindow.webContents.isDestroyed()) {
    //     newWindow.webContents.executeJavaScript(earlyPageCheckScript).catch(() => {});
    //   }
    // });

    // 为新窗口添加脚本注入
    newWindow.webContents.on('did-finish-load', async () => {
      const currentURL = newWindow.webContents.getURL();
      console.log('[New Window] Page loaded:', currentURL);
      await injectScriptForUrl(newWindow.webContents, currentURL);
    });

    // 监听新窗口内的导航（SPA 路由）
    newWindow.webContents.on('did-navigate-in-page', async (event, url) => {
      console.log('[New Window] SPA Navigation:', url);
      await injectScriptForUrl(newWindow.webContents, url);
    });
  });
}

// 是否隐藏公共头部（登录页时隐藏）
let isHeaderHidden = false;

function updateBrowserViewBounds(scriptPanelOpen = false) {
  const { width, height } = mainWindow.getContentBounds();
  // 公共头部高度 50px（登录页时隐藏）
  // 开发工具栏已移除，统一使用公共头部
  const headerHeight = isHeaderHidden ? 0 : 50;
  const toolbarHeight = 0; // 工具栏已移除
  const totalTopOffset = headerHeight + toolbarHeight;
  const viewWidth = scriptPanelOpen ? width - 400 : width;
  browserView.setBounds({ x: 0, y: totalTopOffset, width: viewWidth, height: height - totalTopOffset });
}

// 根据 URL 判断是否需要隐藏公共头部
function updateHeaderVisibility(url) {
  const isLoginPage = url && url.includes('login.html');
  const shouldHideHeader = isLoginPage;

  if (isHeaderHidden !== shouldHideHeader) {
    isHeaderHidden = shouldHideHeader;
    // 通知渲染进程隐藏/显示头部
    mainWindow.webContents.send('toggle-header', !isHeaderHidden);
    // 更新 BrowserView 边界
    updateBrowserViewBounds(isScriptPanelOpen);
    console.log('[Header] 公共头部:', isHeaderHidden ? '隐藏' : '显示');
  }
}

// 启动时检查并清理损坏的数据
async function validateAndCleanupUserData() {
  const fs = require('fs').promises;
  const fsSync = require('fs');
  const userDataPath = app.getPath('userData');
  const sessionPath = path.join(userDataPath, 'Partitions', 'persist_browserview');
  const firstRunMarker = path.join(userDataPath, '.first_run_completed');

  console.log('[Startup] 检查用户数据完整性...');
  console.log('[Startup] 用户数据路径:', userDataPath);

  // 检查是否是首次运行（仅开发环境）
  if (!isProduction && !fsSync.existsSync(firstRunMarker)) {
    console.log('[Startup] 🆕 检测到首次运行（开发环境），清除旧的用户数据...');

    try {
      // 删除整个 Session 目录
      if (fsSync.existsSync(sessionPath)) {
        fsSync.rmSync(sessionPath, { recursive: true, force: true });
        console.log('[Startup] ✅ 已清除旧的 Session 数据');
      }

      // 创建首次运行标记
      await fs.writeFile(firstRunMarker, new Date().toISOString());
      console.log('[Startup] ✅ 已创建首次运行标记');

      return true;
    } catch (err) {
      console.error('[Startup] ⚠️ 清除数据失败:', err);
    }
  }

  // 💡 开发提示：如需重新清除所有数据，请删除文件：
  // Windows: %APPDATA%\运营助手\.first_run_completed
  // 或直接删除整个目录：%APPDATA%\运营助手
  console.log('[Startup] 💡 如需清除所有数据，请删除:', firstRunMarker);

  try {
    // 检查 Session 目录是否存在
    try {
      await fs.access(sessionPath);
    } catch (err) {
      console.log('[Startup] ✅ Session 目录不存在（首次运行）');
      return true;
    }

    // 检查 Cookies 文件
    const cookiesFile = path.join(sessionPath, 'Cookies');
    const cookiesJournalFile = path.join(sessionPath, 'Cookies-journal');

    try {
      await fs.access(cookiesFile);
      const stats = await fs.stat(cookiesFile);

      // 检查文件大小是否异常（小于 100 字节可能损坏）
      if (stats.size < 100) {
        console.log('[Startup] ⚠️ Cookies 文件大小异常:', stats.size, 'bytes');
        throw new Error('Cookies file corrupted');
      }

      // 检查是否存在 journal 文件（表示上次未正常关闭）
      try {
        await fs.access(cookiesJournalFile);
        console.log('[Startup] ⚠️ 检测到 Cookies-journal 文件，上次可能未正常关闭');
        // 删除 journal 文件，让 SQLite 自动修复
        await fs.unlink(cookiesJournalFile);
        console.log('[Startup] ✅ 已删除 Cookies-journal 文件');
      } catch (err) {
        // journal 文件不存在是正常的
      }

      console.log('[Startup] ✅ 用户数据检查通过');
      return true;
    } catch (err) {
      console.error('[Startup] ❌ 检测到数据损坏:', err.message);

      // 备份损坏的数据
      const backupPath = path.join(userDataPath, `Backup_${Date.now()}`);
      try {
        const fsSync = require('fs');
        fsSync.cpSync(sessionPath, backupPath, { recursive: true });
        console.log('[Startup] 📦 已备份损坏数据到:', backupPath);
      } catch (backupErr) {
        console.error('[Startup] ⚠️ 备份失败:', backupErr.message);
      }

      // 删除损坏的数据
      const fsSync = require('fs');
      fsSync.rmSync(sessionPath, { recursive: true, force: true });
      console.log('[Startup] 🔧 已清理损坏数据，将重新初始化');

      return true;
    }
  } catch (err) {
    console.error('[Startup] 数据检查失败:', err);
    return false;
  }
}

// createTray 创建托盘图标
function createTray() {
  const icon = path.join(__dirname, 'icon.ico')
  tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => win.show()
    },
    {
      label: '退出',
      click: () => app.quit()
    }
  ])

  tray.setToolTip('应用名称')
  tray.setContextMenu(contextMenu)
}

// 🖥️ 禁用 GPU 硬件加速 - 解决某些电脑因显卡驱动不兼容导致的白屏问题
// 必须在 app.whenReady() 之前调用
app.disableHardwareAcceleration();
console.log('[GPU] ✅ 已禁用 GPU 硬件加速（防止白屏）');

// 🛡️ 反自动化检测 - 在 app.whenReady() 之前设置
// 禁用 Blink 的 AutomationControlled 特征，避免被网站检测为自动化浏览器
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
// 禁用自动化扩展
app.commandLine.appendSwitch('disable-extensions');
// 使用正常的渲染模式
app.commandLine.appendSwitch('disable-dev-shm-usage');
// 禁用沙箱 - 防止某些企业安全策略或杀毒软件拦截渲染进程
app.commandLine.appendSwitch('no-sandbox');
// 🛡️ 安全软件兼容性优化（电脑管家/360等）
// 禁用渲染进程代码完整性检查 - 防止安全软件的DLL注入校验导致renderer崩溃
app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity');
// GPU进程合并到主进程 - 已禁用硬件加速，独立GPU进程无意义，减少进程数降低安全软件误报
app.commandLine.appendSwitch('in-process-gpu');
// 防止后台窗口被节流 - 避免安全软件的"性能优化"功能干扰发布窗口
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
console.log('[AntiDetection] ✅ 已禁用 AutomationControlled 特征');
console.log('[Sandbox] ✅ 已添加 no-sandbox fallback');
console.log('[Compatibility] ✅ 已添加安全软件兼容性优化（RendererCodeIntegrity禁用/GPU合并/防后台节流）');

app.whenReady().then(async () => {
  // ⚠️ 不要使用 app.setAsDefaultProtocolClient('bitbrowser')
  // 这会导致错误: "Unable to find Electron app at D:\浏览器\运营助手\bitbrowser\cc"
  // 原因: Windows 会将 bitbrowser://cc 的路径部分作为命令行参数传递给应用

  // 移除之前错误注册的协议处理程序（清理注册表）
  if (process.platform === 'win32') {
    app.removeAsDefaultProtocolClient('bitbrowser');
    console.log('[Protocol] 已移除 bitbrowser:// 协议注册');
  }

  // 注册自定义协议拦截器，阻止 bitbrowser:// 等协议触发系统对话框
  protocol.registerStringProtocol('bitbrowser', (request, callback) => {
    console.log('[Protocol] ❌ Blocked bitbrowser:// protocol request:', request.url);
    callback(''); // 返回空内容
  });
  console.log('[Protocol] ✅ 已注册 bitbrowser:// 协议拦截器');

  // 全局拦截所有 webContents 的协议导航
  app.on('web-contents-created', (event, webContents) => {
    // 为每个 webContents 添加协议拦截
    webContents.on('will-navigate', (event, url) => {
      if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:') && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('file:')) {
        console.log('[Global] ❌ Blocked non-http navigation:', url);
        event.preventDefault();
      }
    });

    webContents.on('will-frame-navigate', (event) => {
      const url = event.url;
      if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:') && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('file:')) {
        console.log('[Global Frame] ❌ Blocked non-http navigation:', url);
        event.preventDefault();
      }
    });

    webContents.setWindowOpenHandler(({ url }) => {
      if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
        console.log('[Global WindowOpen] ❌ Blocked non-http:', url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });
  });
  console.log('[App] ✅ 已添加全局 webContents 协议拦截');

  // 设置 Windows 任务栏应用程序用户模型 ID（确保任务栏图标正确显示）
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.zhcloud.browser');
    console.log('[App] 已设置 AppUserModelId: com.zhcloud.browser');
  }

  // 设置日志文件（便携版和生产环境）
  if (isProduction) {
    const logPath = path.join(app.getPath('userData'), 'app.log');
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    // 保存原始 console 方法
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    // 重定向 console 输出到文件和控制台
    console.log = function(...args) {
      const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
      logStream.write(`[LOG ${new Date().toLocaleString()}] ${msg}\n`);
      originalLog.apply(console, args);
    };

    console.error = function(...args) {
      const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
      logStream.write(`[ERROR ${new Date().toLocaleString()}] ${msg}\n`);
      originalError.apply(console, args);
    };

    console.warn = function(...args) {
      const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
      logStream.write(`[WARN ${new Date().toLocaleString()}] ${msg}\n`);
      originalWarn.apply(console, args);
    };

    console.log('=================================');
    console.log('📝 日志文件已启用');
    console.log('📂 日志路径:', logPath);
    console.log('=================================');
  }

  console.log('=================================');
  console.log('应用启动 - Cookie 持久化已启用');
  console.log(`app.isPackaged: ${app.isPackaged}`);
  console.log(`isProduction: ${isProduction}`);
  console.log(`isPortable: ${isPortable}`);
  console.log(`环境: ${isProduction ? '生产环境' : '开发环境'}`);
  console.log(`首页URL: ${HOME_URL}`);
  console.log(`execPath: ${process.execPath}`);
  console.log(`userData路径: ${app.getPath('userData')}`);
  console.log('=================================');

  // 启动时验证数据完整性
  await validateAndCleanupUserData();

  // 加载全局持久化数据（如 company_id）
  loadGlobalStorage();

  // 生产环境立即移除菜单（必须在创建窗口之前）
  if (isProduction) {
    Menu.setApplicationMenu(null);
    console.log('[Menu] ✅ 生产环境菜单已完全移除');
  }

  // 初始化脚本管理器
  // 生产环境使用 app.asar.unpacked 路径，开发环境使用 __dirname
  let scriptsBaseDir = __dirname;
  if (app.isPackaged) {
    scriptsBaseDir = __dirname.replace('app.asar', 'app.asar.unpacked');
  }
  console.log('Scripts base dir:', scriptsBaseDir);
  scriptManager = new ScriptManager(scriptsBaseDir);

  createWindow();
  createTray();

  // 启动后检查更新（延迟执行，避免影响启动速度）
  scheduleUpdateCheck();

  // 注册全局快捷键：只打开公共头部（主窗口）的 DevTools (Ctrl+Shift+F11)
  globalShortcut.register('CommandOrControl+Shift+F11', () => {
    console.log('[DevTools] 公共头部 DevTools 快捷键触发');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // 注册全局快捷键后门打开 DevTools (Ctrl+Shift+F12)
  globalShortcut.register('CommandOrControl+Shift+F12', () => {
    console.log('[DevTools] 后门快捷键触发');
    // 打开当前聚焦窗口的 DevTools
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.webContents.toggleDevTools();
    }
    // 也打开 BrowserView 的 DevTools
    if (browserView && !browserView.webContents.isDestroyed()) {
      browserView.webContents.toggleDevTools();
    }
  });

  // 注册全局快捷键后门清除指定域名的 Cookies (Ctrl+Alt+C)
  console.log('[Main] 尝试注册清除 Cookies 快捷键: Ctrl+Alt+C');
  const registerResult = globalShortcut.register('CommandOrControl+Alt+C', async () => {
    console.log('[Clear Cookies] ========== 后门快捷键触发 ==========');

    // 使用 Electron 的对话框让用户输入域名
    const { dialog } = require('electron');

    console.log('[Clear Cookies] 显示选择对话框...');
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['取消', '清除所有登录状态', '清除指定域名'],
      defaultId: 2,
      title: '清除 Cookies',
      message: '选择要清除的范围：',
      detail: '清除所有：删除所有网站的登录状态\n清除指定域名：删除特定网站的登录状态（如：douyin.com）'
    });

    console.log('[Clear Cookies] 用户选择:', result.response);

    if (result.response === 0) {
      // 取消
      console.log('[Clear Cookies] 用户取消操作');
      return;
    }

    if (result.response === 1) {
      // 清除所有
      console.log('[Clear Cookies] 开始清除所有登录状态...');
      if (browserView && !browserView.webContents.isDestroyed()) {
        const ses = browserView.webContents.session;
        const cookiesBefore = await ses.cookies.get({});
        console.log(`[Clear Cookies] 清除前有 ${cookiesBefore.length} 个 cookies`);

        // 先导航到空白页，避免页面正在使用存储数据导致冲突卡死
        console.log('[Clear Cookies] 先导航到空白页...');
        await browserView.webContents.loadURL('about:blank');
        // 等待一小段时间确保页面完全卸载
        await new Promise(resolve => setTimeout(resolve, 100));

        await ses.clearStorageData({
          storages: ['cookies', 'localstorage', 'sessionstorage']
        });

        const cookiesAfter = await ses.cookies.get({});
        console.log(`[Clear Cookies] 清除后有 ${cookiesAfter.length} 个 cookies`);
        console.log('[Clear Cookies] ✅ 已清除所有登录状态');

        // 清除完成后导航回首页
        console.log('[Clear Cookies] 导航回首页...');
        browserView.webContents.loadURL(HOME_URL);

        await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: '清除成功',
          message: '已清除所有网站的登录状态',
          detail: `删除了 ${cookiesBefore.length} 个 cookies\n\n页面将自动刷新`,
          buttons: ['确定']
        });
      }
      return;
    }

    if (result.response === 2) {
      // 清除指定域名
      console.log('[Clear Cookies] 用户选择清除指定域名，准备显示输入窗口...');

      // 直接使用简化的prompt对话框
      const { BrowserWindow } = require('electron');
      const appIcon = nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));

      const inputWindow = new BrowserWindow({
        width: 500,
        height: 220,
        parent: mainWindow,
        modal: true,
        show: false,
        autoHideMenuBar: true,
        icon: appIcon, // 使用 nativeImage 加载的图标
        webPreferences: {
          nodeIntegration: true,  // 启用nodeIntegration以便使用ipcRenderer
          contextIsolation: false  // 关闭上下文隔离
        }
      });

      console.log('[Clear Cookies] 输入窗口已创建');

      // 监听来自输入窗口的域名
      let receivedDomain = null;
      ipcMain.once('submit-domain', async (event, domain) => {
        console.log('[Clear Cookies] 收到域名:', domain);
        receivedDomain = domain;

        if (domain && browserView && !browserView.webContents.isDestroyed()) {
          console.log('[Clear Cookies] 开始清除域名:', domain);

          const ses = browserView.webContents.session;
          const cookies = await ses.cookies.get({});
          console.log(`[Clear Cookies] 当前共有 ${cookies.length} 个 cookies`);

          let deletedCount = 0;
          for (const cookie of cookies) {
            // 匹配域名（包括子域名）
            const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
            const shouldDelete = cookieDomain.includes(domain) || domain.includes(cookieDomain);

            if (shouldDelete) {
              const cookieUrl = `${cookie.secure ? 'https' : 'http'}://${cookieDomain}${cookie.path}`;
              try {
                await ses.cookies.remove(cookieUrl, cookie.name);
                deletedCount++;
                console.log(`[Clear Cookies] ✓ 删除: ${cookie.name} @ ${cookie.domain}`);
              } catch (err) {
                console.error(`[Clear Cookies] ✗ 删除失败: ${cookie.name} @ ${cookie.domain}`, err.message);
              }
            }
          }

          console.log(`[Clear Cookies] ========== 清除完成 ==========`);
          console.log(`[Clear Cookies] ✅ 共删除 ${deletedCount} 个 cookies`);

          // 通知首页刷新指定域名的授权状态
          browserView.webContents.send('cookies-cleared', { type: 'domain', domain: domain, count: deletedCount });
          console.log('[Clear Cookies] 📤 已通知首页刷新授权状态');

          await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '清除成功',
            message: `已清除域名 "${domain}" 的登录状态`,
            detail: `共删除 ${deletedCount} 个 cookies\n\n刷新页面即可看到效果`,
            buttons: ['确定']
          });
        } else {
          console.log('[Clear Cookies] 域名为空或browserView不可用');
        }
      });

      inputWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>清除指定域名的 Cookies</title>
          <style>
            body {
              font-family: 'Microsoft YaHei', Arial, sans-serif;
              padding: 30px;
              background: #f5f5f5;
              margin: 0;
            }
            .container {
              background: white;
              padding: 25px;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h3 {
              margin: 0 0 15px 0;
              color: #333;
              font-size: 16px;
            }
            input {
              width: 100%;
              padding: 10px;
              border: 2px solid #ddd;
              border-radius: 4px;
              font-size: 14px;
              box-sizing: border-box;
              font-family: 'Microsoft YaHei', Arial, sans-serif;
            }
            input:focus {
              outline: none;
              border-color: #ee0a24;
            }
            .buttons {
              margin-top: 20px;
              display: flex;
              gap: 10px;
              justify-content: flex-end;
            }
            button {
              padding: 10px 24px;
              border: none;
              border-radius: 4px;
              cursor: pointer;
              font-size: 14px;
              font-family: 'Microsoft YaHei', Arial, sans-serif;
            }
            .cancel {
              background: #e0e0e0;
              color: #333;
            }
            .submit {
              background: #ee0a24;
              color: white;
            }
            .cancel:hover {
              background: #d0d0d0;
            }
            .submit:hover {
              background: #d00a20;
            }
            .hint {
              font-size: 12px;
              color: #666;
              margin-top: 10px;
              line-height: 1.5;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h3>🔑 输入要清除的域名</h3>
            <input type="text" id="domain" placeholder="例如: douyin.com 或 creator.douyin.com" autofocus />
            <div class="hint">💡 提示: 只输入主域名(如 douyin.com)将清除所有相关子域名的登录状态</div>
            <div class="buttons">
              <button class="cancel" onclick="window.close()">取消</button>
              <button class="submit" onclick="submit()">清除</button>
            </div>
          </div>
          <script>
            const { ipcRenderer } = require('electron');
            console.log('输入窗口脚本已加载');

            document.getElementById('domain').focus();
            document.getElementById('domain').addEventListener('keypress', (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            });

            function submit() {
              const domain = document.getElementById('domain').value.trim();
              console.log('用户输入域名:', domain);
              if (domain) {
                console.log('发送域名到主进程:', domain);
                ipcRenderer.send('submit-domain', domain);
                window.close();
              } else {
                alert('请输入域名！');
              }
            }
          </script>
        </body>
        </html>
      `)}`);

      inputWindow.once('ready-to-show', () => {
        console.log('[Clear Cookies] 输入窗口准备完成，显示窗口');
        inputWindow.show();
      });

      inputWindow.on('close', () => {
        console.log('[Clear Cookies] 输入窗口已关闭');
      });
    }
  });

  if (registerResult) {
    console.log('[Main] ✅ 清除 Cookies 快捷键注册成功 (Ctrl+Alt+C)');
  } else {
    console.error('[Main] ❌ 清除 Cookies 快捷键注册失败，可能被占用');
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      isQuitting = false; // 重置标志
      createWindow();
    }
  });

  // 定期保存 session 数据（每 30 秒）
  const saveInterval = setInterval(async () => {
    if (browserView && !browserView.webContents.isDestroyed()) {
      try {
        const ses = browserView.webContents.session;
        const cookies = await ses.cookies.get({});
        await ses.flushStorageData();
        console.log(`[Auto-Save] ✅ Session 数据已保存 - ${cookies.length} 个 cookies`);
        if (isPortable) {
          console.log(`[Auto-Save] 便携版数据路径: ${app.getPath('userData')}`);
        }
      } catch (err) {
        console.error('[Auto-Save] ❌ 保存失败:', err);
      }
    }
  }, 30000);

  // 优化：定期清理已销毁的窗口引用（每 60 秒）
  setInterval(() => {
    cleanupDestroyedWindows();
    // 强制垃圾回收（如果可用）
    if (global.gc) {
      global.gc();
      console.log('[Memory] 强制垃圾回收完成');
    }
  }, 60000);
});

app.on('window-all-closed', function () {
  // 注销所有全局快捷键
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC 处理程序

// 🔑 获取域名配置（供渲染进程使用）
ipcMain.handle('get-domain-config', () => {
  return {
    ENV: config.ENV,
    isProduction: isProduction,
    domains: config.domains,
    // 便捷 URL（已根据 isProduction 计算好）
    aigcUrl: config.getAigcUrl(isProduction),
    geoUrl: config.getGeoUrl(isProduction),
    apiDomain: config.getApiDomainUrl(),
    cookieUrl: config.getCookieUrl(),
    cookieDomain: config.getCookieDomain(),
    DEV_HOSTS: config.DEV_HOSTS
  };
});

// 获取当前应用版本
ipcMain.handle('get-app-version', () => {
  return APP_VERSION;
});

// 手动检查更新（可由前端触发）
ipcMain.handle('check-for-update', async () => {
  const updateInfo = await checkForUpdate();

  if (updateInfo.hasUpdate && updateInfo.version && updateInfo.url) {
    // 显示更新对话框
    await showUpdateDialog(updateInfo.version, updateInfo.url);
  }

  return updateInfo;
});

// 获取新窗口模式状态
ipcMain.handle('get-new-window-mode', () => {
  return { openInNewWindow };
});

// 切换新窗口模式
ipcMain.handle('toggle-new-window-mode', () => {
  openInNewWindow = !openInNewWindow;
  return { openInNewWindow };
});

// 检查 Session 状态（用于检测登录状态是否被清除）
ipcMain.handle('check-session-status', async () => {
  try {
    if (!browserView || browserView.webContents.isDestroyed()) {
      return { hasSession: false, cookieCount: 0, reason: 'browserView不可用' };
    }

    const ses = browserView.webContents.session;
    const cookies = await ses.cookies.get({});

    // 检查特定平台的登录凭证 cookies（不只是数量，而是关键的登录 cookie）
    const douyinCookies = cookies.filter(c => c.domain.includes('douyin.com'));
    const xiaohongshuCookies = cookies.filter(c => c.domain.includes('xiaohongshu.com'));
    const weixinCookies = cookies.filter(c => c.domain.includes('weixin.qq.com'));
    const baijiahaoCookies = cookies.filter(c => c.domain.includes('baidu.com'));

    // 检查关键登录凭证（这些 cookie 存在才表示真正登录）
    // 扩大检测范围，避免漏检
    const douyinLoggedIn = douyinCookies.some(c =>
      c.name === 'sessionid' ||
      c.name === 'sessionid_ss' ||
      c.name === 'passport_csrf_token' ||
      c.name === 'sid_guard' ||
      c.name === 'uid_tt' ||
      c.name === 'uid_tt_ss' ||
      c.name === 'ttwid' ||
      c.name === 'passport_auth_status'
    );

    const xiaohongshuLoggedIn = xiaohongshuCookies.some(c =>
      c.name === 'web_session' ||
      c.name === 'websectiga' ||
      c.name === 'sec_poison_id' ||
      c.name === 'a1' ||
      c.name === 'webId'
    );

    const weixinLoggedIn = weixinCookies.some(c =>
      c.name === 'wxuin' ||
      c.name === 'pass_ticket' ||
      c.name === 'slave_user' ||
      c.name === 'slave_sid'
    );

    const baijiahaoLoggedIn = baijiahaoCookies.some(c =>
      c.name === 'BDUSS' ||
      c.name === 'STOKEN' ||
      c.name === 'BAIDUID' ||
      c.name === 'BIDUPSID'
    );

    const platformStatus = {
      douyin: { count: douyinCookies.length, loggedIn: douyinLoggedIn },
      xiaohongshu: { count: xiaohongshuCookies.length, loggedIn: xiaohongshuLoggedIn },
      weixin: { count: weixinCookies.length, loggedIn: weixinLoggedIn },
      baijiahao: { count: baijiahaoCookies.length, loggedIn: baijiahaoLoggedIn }
    };

    console.log('[Session Check] Cookie 统计:', {
      total: cookies.length,
      douyin: `${douyinCookies.length} cookies, loggedIn: ${douyinLoggedIn}`,
      xiaohongshu: `${xiaohongshuCookies.length} cookies, loggedIn: ${xiaohongshuLoggedIn}`,
      weixin: `${weixinCookies.length} cookies, loggedIn: ${weixinLoggedIn}`,
      baijiahao: `${baijiahaoCookies.length} cookies, loggedIn: ${baijiahaoLoggedIn}`
    });

    return {
      hasSession: cookies.length > 0,
      cookieCount: cookies.length,
      platforms: platformStatus
    };
  } catch (err) {
    console.error('[Session Check] 检查失败:', err);
    return { hasSession: false, cookieCount: 0, error: err.message };
  }
});

// 原生鼠标点击（通过 CDP 发送可信事件，用于自动化点击 Vue 组件等场景）
ipcMain.handle('native-click', async (event, x, y) => {
  try {
    const webContents = event.sender;
    if (!webContents || webContents.isDestroyed()) {
      return { success: false, error: 'webContents 不可用' };
    }

    const xi = Math.round(x);
    const yi = Math.round(y);

    // 使用 Chrome DevTools Protocol 发送鼠标事件（最可靠的方式）
    const dbg = webContents.debugger;
    try { dbg.attach('1.3'); } catch (e) { /* 可能已 attach */ }

    await dbg.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: xi, y: yi
    });
    await dbg.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: xi, y: yi, button: 'left', clickCount: 1
    });
    await dbg.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: xi, y: yi, button: 'left', clickCount: 1
    });

    try { dbg.detach(); } catch (e) { /* ignore */ }

    return { success: true, x: xi, y: yi };
  } catch (err) {
    console.error('[Native Click] 失败:', err);
    return { success: false, error: err.message };
  }
});

// 导航到指定 URL（BrowserView）
ipcMain.handle('navigate-to', async (event, url) => {
  if (browserView) {
    browserView.webContents.loadURL(url);
  }
});

// 导航到登录页
ipcMain.handle('navigate-to-login', async () => {
  if (browserView) {
    console.log('[Main] 导航到登录页:', LOGIN_URL);

    // 🔑 退出登录时清除所有登录相关数据
    console.log('[Main] 清除退出登录数据...');

    // 1. 清除 globalStorage 中的登录数据
    delete globalStorage.last_page_url;
    delete globalStorage.login_token;
    delete globalStorage.login_expires;
    delete globalStorage.login_gcc;
    delete globalStorage.company_id;
    delete globalStorage.user_info;
    delete globalStorage.siteInfo;
    delete globalStorage.current_site;
    delete globalStorage.current_site_id;
    delete globalStorage.current_site_name;
    saveGlobalStorage();
    console.log('[Main] ✅ 已清除 globalStorage 数据');

    // 2. 清除 Cookies（token, access_token, site_id 等）
    try {
      const ses = browserView.webContents.session;
      const cookies = await ses.cookies.get({});
      console.log(`[Main] 当前有 ${cookies.length} 个 cookies，开始清除登录相关 cookies...`);

      // 需要清除的 cookie 名称列表
      const cookiesToClear = ['token', 'access_token', 'gcc', 'site_id'];

      let deletedCount = 0;
      for (const cookie of cookies) {
        if (cookiesToClear.includes(cookie.name)) {
          const cookieUrl = `${cookie.secure ? 'https' : 'http'}://${cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain}${cookie.path}`;
          try {
            await ses.cookies.remove(cookieUrl, cookie.name);
            deletedCount++;
            console.log(`[Main] ✓ 删除 Cookie: ${cookie.name} @ ${cookie.domain}`);
          } catch (err) {
            console.error(`[Main] ✗ 删除 Cookie 失败: ${cookie.name} @ ${cookie.domain}`, err.message);
          }
        }
      }

      // 也清除 localhost 的 cookies
      await ses.cookies.remove('http://localhost:5173/', 'token').catch(() => {});
      await ses.cookies.remove('http://localhost:5173/', 'access_token').catch(() => {});
      await ses.cookies.remove('http://localhost:5173/', 'gcc').catch(() => {});
      await ses.cookies.remove('http://localhost:5173/', 'site_id').catch(() => {});

      await ses.flushStorageData();
      console.log(`[Main] ✅ 已清除 ${deletedCount} 个登录相关 cookies`);
    } catch (err) {
      console.error('[Main] ❌ 清除 cookies 失败:', err);
    }

    loadLocalPage(browserView.webContents, 'login.html');
  }
});

// 跳转到本地 HTML 页面（用于从远程页面跳转到 not-available.html 等本地页面）
ipcMain.handle('navigate-to-local-page', async (event, pageName) => {
  if (browserView) {
    // 解析 query 参数（如 'not-purchase.html?system=geo'）
    const [baseName, queryString] = pageName.split('?');
    const query = {};
    if (queryString) {
      queryString.split('&').forEach(pair => {
        const [key, val] = pair.split('=');
        if (key) query[key] = val || '';
      });
    }

    // 安全检查：只允许跳转到指定的本地页面
    const allowedPages = Object.values(config.placeholderPages);
    if (!allowedPages.includes(baseName)) {
      console.log('[Main] ❌ 不允许跳转到未知页面:', baseName);
      return { success: false, error: '不允许跳转到该页面' };
    }

    console.log('[Main] 跳转到本地页面:', baseName, 'query:', query);
    if (Object.keys(query).length > 0) {
      browserView.webContents.loadFile(path.join(__dirname, baseName), { query });
    } else {
      loadLocalPage(browserView.webContents, baseName);
    }
    return { success: true };
  }
  return { success: false, error: 'browserView 不可用' };
});

// 获取指定域名的所有 Cookies（包括 HttpOnly）
ipcMain.handle('get-domain-cookies', async (event, domain) => {
  try {
    if (!browserView || browserView.webContents.isDestroyed()) {
      return { success: false, error: 'browserView 不可用' };
    }

    const ses = browserView.webContents.session;
    const cookies = await ses.cookies.get({});

    // 过滤指定域名的 cookies
    const domainCookies = cookies.filter(cookie => {
      const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
      return cookieDomain.includes(domain) || domain.includes(cookieDomain);
    });

    // 转换为 cookie 字符串格式：name=value; name2=value2
    // 对包含非 ISO-8859-1 字符的值进行编码，避免 fetch header 报错
    const cookieString = domainCookies.map(c => {
      const value = /[^\x00-\xff]/.test(c.value) ? encodeURIComponent(c.value) : c.value;
      return `${c.name}=${value}`;
    }).join('; ');

    console.log(`[Get Cookies] 获取 ${domain} 的 cookies: ${domainCookies.length} 个`);
    return { success: true, cookies: cookieString, count: domainCookies.length };
  } catch (err) {
    console.error('[Get Cookies] 获取失败:', err);
    return { success: false, error: err.message };
  }
});

// 代理 fetch 请求（自动带上 BrowserView session 的 cookies）
ipcMain.handle('proxy-fetch', async (event, url, options = {}) => {
  try {
    if (!browserView) {
      return { success: false, error: 'BrowserView 不存在' };
    }

    const ses = browserView.webContents.session;

    // 从 session 获取该 URL 对应域名的 cookies（除非 withCookies 为 false）
    const urlObj = new URL(url);
    let cookieString = '';
    if (options.withCookies !== false) {
      const allCookies = await ses.cookies.get({});
      const domain = urlObj.hostname;
      const domainCookies = allCookies.filter(cookie => {
        const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
        return cookieDomain.includes(domain) || domain.includes(cookieDomain);
      });
      cookieString = domainCookies.map(c => {
        const value = /[^\x00-\xff]/.test(c.value) ? encodeURIComponent(c.value) : c.value;
        return `${c.name}=${value}`;
      }).join('; ');
      console.log(`[Proxy Fetch] ${options.method || 'GET'} ${url}, cookies: ${domainCookies.length} 个`);
    } else {
      console.log(`[Proxy Fetch] ${options.method || 'GET'} ${url}, cookies: skipped`);
    }

    // 合并 headers，加上 Cookie 和 User-Agent
    const headers = { ...(options.headers || {}) };
    if (cookieString) {
      headers['Cookie'] = cookieString;
    }
    if (!headers['User-Agent']) {
      headers['User-Agent'] = 'zh.Cloud-browse';
    }

    // 使用 Node.js http/https 发请求
    const result = await new Promise((resolve, reject) => {
      const mod = urlObj.protocol === 'https:' ? https : http;
      const req = mod.request(url, {
        method: options.method || 'GET',
        headers: headers,
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let jsonData;
          try {
            jsonData = JSON.parse(data);
          } catch (e) {
            jsonData = data;
          }
          resolve({
            success: true,
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            data: jsonData,
            cookieString: cookieString || ''
          });
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });

    console.log(`[Proxy Fetch] 响应状态: ${result.status}`);
    return result;
  } catch (err) {
    console.error('[Proxy Fetch] 请求失败:', err);
    return { success: false, error: err.message };
  }
});

// 刷新页面
ipcMain.handle('refresh-page', async () => {
  if (browserView) {
    browserView.webContents.reload();
  }
});

// 显示全局加载遮罩（隐藏 BrowserView）
ipcMain.handle('show-global-loading', async () => {
  if (browserView && mainWindow) {
    // 将 BrowserView 移出可视区域
    browserView.setBounds({ x: 0, y: -10000, width: 0, height: 0 });
    console.log('[Loading] 显示全局加载遮罩，隐藏 BrowserView');
    return { success: true };
  }
  return { success: false };
});

// 隐藏全局加载遮罩（恢复 BrowserView）
ipcMain.handle('hide-global-loading', async () => {
  if (browserView && mainWindow) {
    // 恢复 BrowserView 位置
    updateBrowserViewBounds(isScriptPanelOpen);
    console.log('[Loading] 隐藏全局加载遮罩，恢复 BrowserView');
    return { success: true };
  }
  return { success: false };
});

// 打开 DevTools
ipcMain.handle('open-devtools', async () => {
  if (browserView) {
    browserView.webContents.openDevTools();
  }
});

// 打开主窗口（公共头部）的 DevTools
ipcMain.handle('open-main-devtools', async () => {
  if (mainWindow) {
    mainWindow.webContents.openDevTools();
  }
});

// 获取当前 URL
ipcMain.handle('get-current-url', async () => {
  if (browserView) {
    return browserView.webContents.getURL();
  }
  return '';
});

// 返回首页
ipcMain.handle('go-home', async () => {
  if (browserView) {
    browserView.webContents.loadURL(HOME_URL);
  }
});

// 后退
ipcMain.handle('go-back', async () => {
  if (browserView && browserView.webContents.canGoBack()) {
    browserView.webContents.goBack();
  }
});

// 前进
ipcMain.handle('go-forward', async () => {
  if (browserView && browserView.webContents.canGoForward()) {
    browserView.webContents.goForward();
  }
});

// 从内容页面触发后退（支持 BrowserView 和子窗口）
ipcMain.handle('content-go-back', async (event) => {
  try {
    // 检查是否来自 BrowserView
    if (browserView && event.sender === browserView.webContents) {
      if (browserView.webContents.canGoBack()) {
        browserView.webContents.goBack();
        return { success: true };
      }
      return { success: false, error: 'Cannot go back' };
    }

    // 检查是否来自子窗口
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && senderWindow.webContents.canGoBack()) {
      senderWindow.webContents.goBack();
      return { success: true };
    }

    return { success: false, error: 'Cannot go back' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 从内容页面触发前进（支持 BrowserView 和子窗口）
ipcMain.handle('content-go-forward', async (event) => {
  try {
    // 检查是否来自 BrowserView
    if (browserView && event.sender === browserView.webContents) {
      if (browserView.webContents.canGoForward()) {
        browserView.webContents.goForward();
        return { success: true };
      }
      return { success: false, error: 'Cannot go forward' };
    }

    // 检查是否来自子窗口
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && senderWindow.webContents.canGoForward()) {
      senderWindow.webContents.goForward();
      return { success: true };
    }

    return { success: false, error: 'Cannot go forward' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 从内容页面触发刷新（支持 BrowserView 和子窗口）
ipcMain.handle('content-refresh', async (event) => {
  try {
    // 检查是否来自 BrowserView
    if (browserView && event.sender === browserView.webContents) {
      browserView.webContents.reload();
      return { success: true };
    }

    // 检查是否来自子窗口
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && !senderWindow.isDestroyed()) {
      senderWindow.webContents.reload();
      return { success: true };
    }

    return { success: false, error: 'Cannot refresh' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 检查是否能后退（支持 BrowserView 和子窗口）
ipcMain.handle('content-can-go-back', async (event) => {
  try {
    // 检查是否来自 BrowserView
    if (browserView && event.sender === browserView.webContents) {
      return { canGoBack: browserView.webContents.canGoBack() };
    }

    // 检查是否来自子窗口
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && !senderWindow.isDestroyed()) {
      return { canGoBack: senderWindow.webContents.canGoBack() };
    }

    return { canGoBack: false };
  } catch (err) {
    return { canGoBack: false };
  }
});

// 检查是否能前进（支持 BrowserView 和子窗口）
ipcMain.handle('content-can-go-forward', async (event) => {
  try {
    // 检查是否来自 BrowserView
    if (browserView && event.sender === browserView.webContents) {
      return { canGoForward: browserView.webContents.canGoForward() };
    }

    // 检查是否来自子窗口
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && !senderWindow.isDestroyed()) {
      return { canGoForward: senderWindow.webContents.canGoForward() };
    }

    return { canGoForward: false };
  } catch (err) {
    return { canGoForward: false };
  }
});

// 打开 DevTools（支持 BrowserView 和子窗口）
ipcMain.handle('content-open-devtools', async (event) => {
  try {
    // 检查是否来自 BrowserView
    if (browserView && event.sender === browserView.webContents) {
      browserView.webContents.openDevTools();
      return { success: true };
    }

    // 检查是否来自子窗口
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && !senderWindow.isDestroyed()) {
      senderWindow.webContents.openDevTools();
      return { success: true };
    }

    return { success: false, error: 'Cannot open DevTools' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 设置注入脚本
ipcMain.handle('set-inject-script', async (event, url, script) => {
  return await scriptManager.saveScript(url, script);
});

// 获取已保存的脚本
ipcMain.handle('get-inject-script', async (event, url) => {
  return await scriptManager.getScript(url);
});

// 立即执行脚本（用于测试）
ipcMain.handle('execute-script-now', async (event, script) => {
  if (browserView && script) {
    try {
      await browserView.webContents.executeJavaScript(script);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: 'No script provided' };
});

// 从内容页面发送消息到首页
ipcMain.on('content-to-home', (event, message) => {
  console.log('[IPC] 收到 content-to-home 消息:', message);
  console.log('[IPC] HOME_URLS:', HOME_URLS);

  const messageStr = JSON.stringify(message);

  // 向 BrowserView 发送消息（无论当前是否为首页，让页面自行判断）
  if (browserView && !browserView.webContents.isDestroyed()) {
    browserView.webContents.executeJavaScript(`
      (function() {
        const homeUrls = ${JSON.stringify(HOME_URLS)};
        const currentUrl = window.location.href;
        const isHome = homeUrls.some(url => currentUrl.startsWith(url));
        console.log('[Main→BrowserView] HOME_URLS:', homeUrls);
        console.log('[Main→BrowserView] currentUrl:', currentUrl);
        console.log('[Main→BrowserView] isHome:', isHome);
        if (isHome) {
          console.log('[Main→BrowserView] ✅ 向首页发送消息:', ${messageStr});
          window.postMessage({ type: 'FROM_OTHER_PAGE', data: ${messageStr} }, '*');
        }
      })();
    `).catch(err => console.error('[Main] Failed to send message to home (BrowserView):', err));
  }

  // 同时向所有子窗口广播，让首页自行接收
  childWindows.forEach((childWindow, index) => {
    if (childWindow && !childWindow.isDestroyed()) {
      childWindow.webContents.executeJavaScript(`
        (function() {
          const homeUrls = ${JSON.stringify(HOME_URLS)};
          const currentUrl = window.location.href;
          const isHome = homeUrls.some(url => currentUrl.startsWith(url));
          console.log('[Main→ChildWindow${index}] currentUrl:', currentUrl, 'isHome:', isHome);
          if (isHome) {
            console.log('[Main→ChildWindow${index}] ✅ 向首页发送消息:', ${messageStr});
            window.postMessage({ type: 'FROM_OTHER_PAGE', data: ${messageStr} }, '*');
          }
        })();
      `).catch(err => console.error(`[Main] Failed to send message to child window ${index}:`, err));
    }
  });
});

// 从首页发送消息到其他页面
ipcMain.on('home-to-content', (event, message) => {
  console.log('[IPC] 收到 home-to-content 消息:', message);
  console.log('[IPC] 当前打开的子窗口数量:', childWindows.length);

  // 序列化消息一次，用于日志和传输
  const messageStr = JSON.stringify(message);

  // 向 BrowserView 中的非首页发送消息
  if (browserView) {
    browserView.webContents.executeJavaScript(`
      (function() {
        const isHome = window.location.href.startsWith('${HOME_URL}');
        console.log('[Main] 检查是否为首页:', window.location.href, 'isHome:', isHome);
        if (!isHome) {
          const messageData = ${messageStr};
          console.log('[Main] 向其他页面发送消息:', messageData);
          window.postMessage({ type: 'FROM_HOME', data: messageData }, '*');
        }
      })();
    `).catch(err => console.error('[Main] Failed to send message to BrowserView:', err));
  }

  // 向所有子窗口广播消息
  childWindows.forEach((childWindow, index) => {
    if (childWindow && !childWindow.isDestroyed()) {
      console.log(`[IPC] 向子窗口 ${index} 发送消息`);
      childWindow.webContents.executeJavaScript(`
        (function() {
          const messageData = ${messageStr};
          console.log('[Child Window] 收到来自首页的消息:', messageData);
          window.postMessage({ type: 'FROM_HOME', data: messageData }, '*');
        })();
      `).catch(err => console.error(`[Main] Failed to send message to child window ${index}:`, err));
    }
  });
});

// 从控制面板转发消息到当前页面
ipcMain.on('main-to-content', (event, message) => {
  if (browserView) {
    browserView.webContents.executeJavaScript(`
      window.postMessage({ type: 'FROM_MAIN', data: ${JSON.stringify(message)} }, '*');
    `).catch(err => console.error('Failed to send message to content:', err));
  }
});

// 调整 BrowserView 大小以适应脚本面板
ipcMain.on('script-panel-toggle', (event, isOpen) => {
  isScriptPanelOpen = isOpen;
  updateBrowserViewBounds(isOpen);
});

// ========== 站点选择弹窗（自定义样式，悬浮在所有内容之上） ==========
let siteMenuWindow = null;

ipcMain.handle('show-site-menu', async (event, sites, currentSiteId) => {
  // 如果已有菜单窗口，先关闭
  if (siteMenuWindow && !siteMenuWindow.isDestroyed()) {
    siteMenuWindow.close();
    siteMenuWindow = null;
    return { selected: false };
  }

  return new Promise((resolve) => {
    // 获取主窗口的内容区域位置（屏幕坐标）
    const contentBounds = mainWindow.getContentBounds();
    const menuWidth = 280;
    const menuHeight = Math.min(sites.length * 56 + 16, 400);

    // 计算菜单位置：对齐站点选择器，header 下方
    const menuX = contentBounds.x + contentBounds.width - menuWidth - 160; // 往左移对齐站点选择器
    const menuY = contentBounds.y + 55; // header 高度 50px + 5px 间距

    console.log('[Site Menu] Creating menu window at:', menuX, menuY);
    console.log('[Site Menu] Content bounds:', contentBounds);

    siteMenuWindow = new BrowserWindow({
      width: menuWidth,
      height: menuHeight,
      x: menuX,
      y: menuY,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true, // 始终在最上层，避免被 BrowserView 挡住
      show: false, // 先不显示，等加载完成后再显示
      parent: mainWindow,
      modal: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    // 加载完成后显示并聚焦
    siteMenuWindow.once('ready-to-show', () => {
      if (siteMenuWindow && !siteMenuWindow.isDestroyed()) {
        siteMenuWindow.show();
        siteMenuWindow.focus();
        console.log('[Site Menu] Window shown');
      }
    });

    // 点击窗口外部时关闭
    siteMenuWindow.on('blur', () => {
      if (siteMenuWindow && !siteMenuWindow.isDestroyed()) {
        siteMenuWindow.close();
        siteMenuWindow = null;
        resolve({ selected: false });
      }
    });

    siteMenuWindow.on('closed', () => {
      siteMenuWindow = null;
    });

    // 监听站点选择
    ipcMain.once('site-selected', (e, siteId, siteName) => {
      if (siteMenuWindow && !siteMenuWindow.isDestroyed()) {
        siteMenuWindow.close();
        siteMenuWindow = null;
      }
      resolve({ selected: true, siteId, siteName });
    });

    // 生成菜单 HTML（过滤无效站点数据）
    const validSites = sites.filter(s => s && typeof s === 'object' && (s.web_name || s.name));
    const sitesJson = JSON.stringify(validSites);
    const menuHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body {
            background: transparent !important;
            overflow: hidden;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
          }
          .menu {
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            padding: 8px 0;
            max-height: 304px;
            overflow-y: auto;
          }
          .menu-item {
            display: flex;
            align-items: center;
            padding: 12px 16px;
            cursor: pointer;
            transition: background 0.15s;
          }
          .menu-item:hover {
            background: #F5F7FA;
          }
          .menu-item.active {
            background: #ECF5FF;
          }
          .site-icon {
            width: 28px;
            height: 28px;
            border-radius: 6px;
            background: #E4E7ED;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
            color: #909399;
            margin-right: 12px;
            flex-shrink: 0;
          }
          .menu-item.active .site-icon {
            background: #409EFF;
            color: #fff;
          }
          .site-name {
            flex: 1;
            font-size: 14px;
            color: #303133;
            word-break: break-all;
          }
          .menu-item.active .site-name {
            color: #409EFF;
            font-weight: 500;
          }
          .check-icon {
            width: 16px;
            height: 16px;
            margin-left: 8px;
            opacity: 0;
          }
          .menu-item.active .check-icon {
            opacity: 1;
          }
        </style>
      </head>
      <body>
        <div class="menu" id="menu"></div>
        <script>
          const { ipcRenderer } = require('electron');
          const sites = ${sitesJson};
          console.log("🚀 ~  ~ sites: ", sites);
          const currentSiteId = ${JSON.stringify(currentSiteId)};

          const menu = document.getElementById('menu');
          sites.forEach(site => {
            const item = document.createElement('div');
            item.className = 'menu-item' + (site.id === currentSiteId ? ' active' : '');
            const siteName = site.web_name || site.name || '';
            item.innerHTML = \`
              <div class="site-icon">\${siteName.charAt(0)}</div>
              <span class="site-name" title="\${siteName}">\${siteName}</span>
              <svg class="check-icon" viewBox="0 0 1024 1024" fill="#409EFF">
                <path d="M912 190h-69.9c-9.8 0-19.1 4.5-25.1 12.2L404.7 724.5 207 474a32 32 0 0 0-25.1-12.2H112c-6.7 0-10.4 7.7-6.3 12.9l273.9 347c12.8 16.2 37.4 16.2 50.3 0l488.4-618.9c4.1-5.1.4-12.8-6.3-12.8z"/>
              </svg>
            \`;
            item.onclick = () => {
              ipcRenderer.send('site-selected', site.id, siteName);
            };
            menu.appendChild(item);
          });
        </script>
      </body>
      </html>
    `;

    siteMenuWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(menuHtml)}`);
  });
});

// 用户菜单窗口
let userMenuWindow = null;

ipcMain.handle('show-user-menu', async (event) => {
  // 如果已有菜单窗口，先关闭
  if (userMenuWindow && !userMenuWindow.isDestroyed()) {
    userMenuWindow.close();
    userMenuWindow = null;
    return { selected: false };
  }

  return new Promise((resolve) => {
    const contentBounds = mainWindow.getContentBounds();
    const menuWidth = 140;
    const menuHeight = 50;

    // 计算菜单位置：对齐用户信息区域右侧
    const menuX = contentBounds.x + contentBounds.width - menuWidth - 12;
    const menuY = contentBounds.y + 55;

    console.log('[User Menu] Creating menu window at:', menuX, menuY);

    userMenuWindow = new BrowserWindow({
      width: menuWidth,
      height: menuHeight,
      x: menuX,
      y: menuY,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      parent: mainWindow,
      modal: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    userMenuWindow.once('ready-to-show', () => {
      if (userMenuWindow && !userMenuWindow.isDestroyed()) {
        userMenuWindow.show();
        userMenuWindow.focus();
      }
    });

    userMenuWindow.on('blur', () => {
      if (userMenuWindow && !userMenuWindow.isDestroyed()) {
        userMenuWindow.close();
        userMenuWindow = null;
        resolve({ selected: false, action: null });
      }
    });

    userMenuWindow.on('closed', () => {
      userMenuWindow = null;
    });

    ipcMain.once('user-menu-action', (e, action) => {
      if (userMenuWindow && !userMenuWindow.isDestroyed()) {
        userMenuWindow.close();
        userMenuWindow = null;
      }
      resolve({ selected: true, action });
    });

    const menuHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body { background: transparent !important; overflow: hidden; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
          .menu {
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            padding: 6px 0;
          }
          .menu-item {
            display: flex;
            align-items: center;
            padding: 10px 16px;
            cursor: pointer;
            transition: background 0.15s;
            font-size: 14px;
            color: #F56C6C;
            gap: 8px;
          }
          .menu-item:hover { background: #FEF0F0; }
          .menu-item svg { width: 16px; height: 16px; }
        </style>
      </head>
      <body>
        <div class="menu">
          <div class="menu-item" id="logout">
            <svg viewBox="0 0 1024 1024" fill="#F56C6C">
              <path d="M868.352 495.616l-160-160a32 32 0 0 0-45.248 45.248L761.376 479.136l-409.376 0a32 32 0 0 0 0 64l409.376 0-98.272 98.272a32 32 0 1 0 45.248 45.248l160-160a32 32 0 0 0 0-45.248z"/>
              <path d="M448 800 224 800 224 224l224 0a32 32 0 0 0 0-64L192 160a32 32 0 0 0-32 32l0 640a32 32 0 0 0 32 32l256 0a32 32 0 0 0 0-64z"/>
            </svg>
            <span>退出登录</span>
          </div>
        </div>
        <script>
          const { ipcRenderer } = require('electron');
          document.getElementById('logout').onclick = () => {
            ipcRenderer.send('user-menu-action', 'logout');
          };
        </script>
      </body>
      </html>
    `;

    userMenuWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(menuHtml)}`);
  });
});

// 公司切换菜单窗口
let companyMenuWindow = null;

ipcMain.handle('show-company-menu', async (event, companies, currentUniqueId) => {
  // 如果已有菜单窗口，先关闭
  if (companyMenuWindow && !companyMenuWindow.isDestroyed()) {
    companyMenuWindow.close();
    companyMenuWindow = null;
    return { selected: false };
  }

  return new Promise((resolve) => {
    const contentBounds = mainWindow.getContentBounds();
    const menuWidth = 320;
    const menuHeight = Math.min(companies.length * 56 + 16, 400);

    // 计算菜单位置：对齐公司切换按钮
    const menuX = contentBounds.x + contentBounds.width - menuWidth - 300;
    const menuY = contentBounds.y + 55;

    console.log('[Company Menu] Creating menu window at:', menuX, menuY);

    companyMenuWindow = new BrowserWindow({
      width: menuWidth,
      height: menuHeight,
      x: menuX,
      y: menuY,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      parent: mainWindow,
      modal: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    companyMenuWindow.once('ready-to-show', () => {
      if (companyMenuWindow && !companyMenuWindow.isDestroyed()) {
        companyMenuWindow.show();
        companyMenuWindow.focus();
        console.log('[Company Menu] Window shown');
      }
    });

    companyMenuWindow.on('blur', () => {
      if (companyMenuWindow && !companyMenuWindow.isDestroyed()) {
        companyMenuWindow.close();
        companyMenuWindow = null;
        resolve({ selected: false });
      }
    });

    companyMenuWindow.on('closed', () => {
      companyMenuWindow = null;
    });

    ipcMain.once('company-selected', (e, uniqueId, companyName) => {
      if (companyMenuWindow && !companyMenuWindow.isDestroyed()) {
        companyMenuWindow.close();
        companyMenuWindow = null;
      }
      resolve({ selected: true, uniqueId, companyName });
    });

    const validCompanies = companies.filter(c => c && typeof c === 'object' && (c.name || c.abbreviation));
    const companiesJson = JSON.stringify(validCompanies);
    const menuHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body {
            background: transparent !important;
            overflow: hidden;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
          }
          .menu {
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            padding: 8px 0;
            max-height: 384px;
            overflow-y: auto;
          }
          .menu-item {
            display: flex;
            align-items: center;
            padding: 12px 16px;
            cursor: pointer;
            transition: background 0.15s;
          }
          .menu-item:hover {
            background: #F5F7FA;
          }
          .menu-item.active {
            background: #FFF7ED;
          }
          .company-logo {
            width: 28px;
            height: 28px;
            border-radius: 6px;
            background: #E4E7ED;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
            color: #909399;
            margin-right: 12px;
            flex-shrink: 0;
            overflow: hidden;
          }
          .company-logo img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }
          .menu-item.active .company-logo {
            background: #FF8C00;
            color: #fff;
          }
          .company-name {
            flex: 1;
            font-size: 14px;
            color: #303133;
            word-break: break-all;
          }
          .menu-item.active .company-name {
            color: #FF8C00;
            font-weight: 500;
          }
          .check-icon {
            width: 16px;
            height: 16px;
            margin-left: 8px;
            opacity: 0;
          }
          .menu-item.active .check-icon {
            opacity: 1;
          }
        </style>
      </head>
      <body>
        <div class="menu" id="menu"></div>
        <script>
          const { ipcRenderer } = require('electron');
          const companies = ${companiesJson};
          const currentUniqueId = ${JSON.stringify(currentUniqueId)};

          const menu = document.getElementById('menu');
          companies.forEach(company => {
            const item = document.createElement('div');
            item.className = 'menu-item' + (company.unique_id === currentUniqueId ? ' active' : '');
            const displayName = company.abbreviation || company.name || '';
            const logoHtml = company.logo
              ? '<img src="' + company.logo + '" alt="">'
              : displayName.charAt(0);
            item.innerHTML =
              '<div class="company-logo">' + logoHtml + '</div>' +
              '<span class="company-name" title="' + (company.name || '') + '">' + displayName + '</span>' +
              '<svg class="check-icon" viewBox="0 0 1024 1024" fill="#FF8C00">' +
                '<path d="M912 190h-69.9c-9.8 0-19.1 4.5-25.1 12.2L404.7 724.5 207 474a32 32 0 0 0-25.1-12.2H112c-6.7 0-10.4 7.7-6.3 12.9l273.9 347c12.8 16.2 37.4 16.2 50.3 0l488.4-618.9c4.1-5.1.4-12.8-6.3-12.8z"/>' +
              '</svg>';
            item.onclick = () => {
              ipcRenderer.send('company-selected', company.unique_id, displayName);
            };
            menu.appendChild(item);
          });
        </script>
      </body>
      </html>
    `;

    companyMenuWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(menuHtml));
  });
});

// 从内容页面打开新窗口（始终创建新窗口，不受模式影响）
// options.useTemporarySession: true 时使用临时 session（不保存登录状态，用于授权页）
// options.platform + options.accountId: 使用指定账号的持久化 session（多账号模式）
ipcMain.handle('open-new-window', async (event, url, options = {}) => {
  if (!url) {
    return { success: false, error: 'No URL provided' };
  }

  try {
    const appIcon = nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));

    // 根据参数决定使用哪个 session
    // 优先级：platform + accountId > useTemporarySession > 默认持久化 session
    let windowSession;
    let sessionType = 'default';

    // 调试日志：打印完整的 options
    console.log('[Window Manager] ========== 收到 open-new-window 请求 ==========');
    console.log('[Window Manager] URL:', url);
    console.log('[Window Manager] options:', JSON.stringify(options, null, 2));
    console.log('[Window Manager] options.platform:', options.platform);
    console.log('[Window Manager] options.accountId:', options.accountId);
    console.log('[Window Manager] options.sessionData:', options.sessionData ? '有数据' : '无数据');

    if (options.platform && options.accountId) {
      // 多账号模式：使用指定账号的持久化 session
      windowSession = getAccountSession(options.platform, options.accountId);
      sessionType = 'account';
      console.log(`[Window Manager] 使用账号 session: ${options.platform}/${options.accountId}`);
      console.log(`[Window Manager] options.sessionData 存在: ${!!options.sessionData}`);
      console.log(`[Window Manager] options.sessionData 类型: ${typeof options.sessionData}`);
      if (options.sessionData) {
        console.log(`[Window Manager] options.sessionData 是数组: ${Array.isArray(options.sessionData)}`);
        if (Array.isArray(options.sessionData)) {
          console.log(`[Window Manager] options.sessionData 长度: ${options.sessionData.length}`);
        }
      }

      // 如果提供了 sessionData，先清空旧的 cookies，再恢复新的会话数据
      if (options.sessionData) {
        console.log('[Window Manager] ========== 检测到 sessionData，开始自动清空并恢复会话数据 ==========');

        try {
          // 1. 清空该账号的所有 cookies
          const cookies = await windowSession.cookies.get({});
          console.log(`[Window Manager] 找到 ${cookies.length} 个旧 cookies，开始清空...`);

          let deletedCount = 0;
          for (const cookie of cookies) {
            try {
              const protocol = cookie.secure ? 'https' : 'http';
              const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
              const cookieUrl = `${protocol}://${domain}${cookie.path || '/'}`;
              await windowSession.cookies.remove(cookieUrl, cookie.name);
              deletedCount++;
            } catch (err) {
              console.error(`[Window Manager] 删除 cookie 失败 (${cookie.name}):`, err.message);
            }
          }
          console.log(`[Window Manager] ✅ 清空完成，删除了 ${deletedCount} 个 cookies`);

          // 2. 恢复新的会话数据
          // 支持多种数据格式：
          // - 格式1: {cookies: [{...}, ...]} - getFullSessionData 返回的格式
          // - 格式2: [{...}, ...] - 直接的 cookies 数组
          // - 格式3: ["{...}", ...] - JSON 字符串数组（每个字符串是一个 cookie）
          // - 格式4: ["{domain, timestamp, cookies: [...]}"] - 包装的 session 数据（element.cookies 的实际格式）
          let sessionData = options.sessionData;

          // 如果是字符串，先尝试解析（可能需要解析多次，因为可能有双重 JSON 编码）
          if (typeof sessionData === 'string') {
            console.log('[Window Manager] sessionData 是字符串，长度:', sessionData.length);
            console.log('[Window Manager] sessionData 前100字符:', sessionData.substring(0, 100));
            try {
              sessionData = JSON.parse(sessionData);
              // 检查是否还是字符串（双重编码）
              if (typeof sessionData === 'string') {
                console.log('[Window Manager] 检测到双重 JSON 编码，再次解析...');
                sessionData = JSON.parse(sessionData);
              }
            } catch (parseErr) {
              console.error('[Window Manager] ❌ sessionData 解析失败:', parseErr.message);
              throw new Error('会话数据解析失败: ' + parseErr.message);
            }
          }

          console.log('[Window Manager] 解析后 sessionData 类型:', typeof sessionData);
          console.log('[Window Manager] 解析后 sessionData 是数组:', Array.isArray(sessionData));
          if (sessionData && typeof sessionData === 'object' && !Array.isArray(sessionData)) {
            console.log('[Window Manager] sessionData keys:', Object.keys(sessionData));
            console.log('[Window Manager] sessionData.domain:', sessionData.domain);
            console.log('[Window Manager] sessionData.cookies 存在:', !!sessionData.cookies);
            console.log('[Window Manager] sessionData.cookies 是数组:', Array.isArray(sessionData.cookies));
            if (Array.isArray(sessionData.cookies)) {
              console.log('[Window Manager] sessionData.cookies 长度:', sessionData.cookies.length);
            }
          }

          // 获取 cookies 数组
          let cookiesArray = [];

          if (Array.isArray(sessionData)) {
            console.log('[Window Manager] sessionData 是数组，长度:', sessionData.length);

            // 检查数组第一个元素来判断格式
            if (sessionData.length > 0) {
              let firstItem = sessionData[0];

              // 如果第一个元素是字符串，先解析
              if (typeof firstItem === 'string') {
                try {
                  firstItem = JSON.parse(firstItem);
                  console.log('[Window Manager] 解析后的第一个元素 keys:', Object.keys(firstItem));
                } catch (e) {
                  console.error('[Window Manager] 第一个元素解析失败');
                }
              }

              // 格式4: 解析后的对象包含 cookies 字段（这是 element.cookies 的实际格式）
              if (firstItem && firstItem.cookies && Array.isArray(firstItem.cookies)) {
                console.log('[Window Manager] 检测到数据格式4: [{domain, timestamp, cookies: [...]}]');
                // 遍历所有元素，提取 cookies
                for (let item of sessionData) {
                  let parsed = item;
                  if (typeof item === 'string') {
                    try {
                      parsed = JSON.parse(item);
                    } catch (e) {
                      continue;
                    }
                  }
                  if (parsed.cookies && Array.isArray(parsed.cookies)) {
                    cookiesArray = cookiesArray.concat(parsed.cookies);
                  }
                }
                console.log(`[Window Manager] 从格式4提取到 ${cookiesArray.length} 个 cookies`);
              }
              // 格式2/3: 第一个元素是 cookie 对象（有 name 和 domain 字段）
              else if (firstItem && firstItem.name && firstItem.domain) {
                console.log('[Window Manager] 检测到数据格式: 直接的 cookies 数组');
                // 需要解析每个元素
                for (let item of sessionData) {
                  if (typeof item === 'string') {
                    try {
                      cookiesArray.push(JSON.parse(item));
                    } catch (e) {
                      continue;
                    }
                  } else {
                    cookiesArray.push(item);
                  }
                }
              }
              else {
                console.warn('[Window Manager] ⚠️ 无法识别的数组元素格式:', firstItem);
              }
            }
          } else if (sessionData && sessionData.cookies && Array.isArray(sessionData.cookies)) {
            // 格式1：包含 cookies 字段
            cookiesArray = sessionData.cookies;
            console.log('[Window Manager] 检测到数据格式: {cookies: [...]}');
          } else if (sessionData && typeof sessionData === 'object' && !Array.isArray(sessionData)) {
            // 格式5：多域名格式 {".163.com": {cookies: [...]}, "mp.163.com": {cookies: [...]}}
            // 网易号等平台使用多域名存储 cookies
            const keys = Object.keys(sessionData);
            let isMultiDomain = false;
            for (const key of keys) {
              const val = sessionData[key];
              if (val && typeof val === 'object' && val.cookies && Array.isArray(val.cookies)) {
                isMultiDomain = true;
                cookiesArray = cookiesArray.concat(val.cookies);
                console.log(`[Window Manager] 从域名 ${key} 提取到 ${val.cookies.length} 个 cookies`);
              }
            }
            if (isMultiDomain) {
              console.log(`[Window Manager] 检测到数据格式5（多域名）: 共 ${cookiesArray.length} 个 cookies`);
            } else {
              console.warn('[Window Manager] ⚠️ 无法识别的 sessionData 格式, keys:', keys);
            }
          } else {
            console.warn('[Window Manager] ⚠️ 无法识别的 sessionData 格式');
          }

          if (cookiesArray.length > 0) {
            console.log(`[Window Manager] 开始恢复 ${cookiesArray.length} 个新 cookies...`);

            let restoredCount = 0;
            for (let cookieItem of cookiesArray) {
              try {
                // 如果是字符串，需要先解析（格式3）
                let cookie = cookieItem;
                if (typeof cookieItem === 'string') {
                  try {
                    cookie = JSON.parse(cookieItem);
                  } catch (e) {
                    console.error('[Window Manager] Cookie 解析失败:', cookieItem.substring(0, 50));
                    continue;
                  }
                }

                // 检查必要字段
                if (!cookie.name || !cookie.domain) {
                  console.warn('[Window Manager] Cookie 缺少必要字段:', cookie);
                  continue;
                }

                const protocol = cookie.secure ? 'https' : 'http';
                const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
                const cookieUrl = `${protocol}://${domain}${cookie.path || '/'}`;

                const cookieDetails = {
                  url: cookieUrl,
                  name: cookie.name,
                  value: cookie.value || '',
                  domain: cookie.domain,
                  path: cookie.path || '/',
                  secure: cookie.secure || false,
                  httpOnly: cookie.httpOnly || false,
                  sameSite: cookie.sameSite || 'no_restriction'
                };

                // 设置过期时间
                if (cookie.expirationDate) {
                  cookieDetails.expirationDate = cookie.expirationDate;
                } else {
                  cookieDetails.expirationDate = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
                }

                await windowSession.cookies.set(cookieDetails);
                restoredCount++;
              } catch (cookieErr) {
                console.error(`[Window Manager] Cookie 恢复失败:`, cookieErr.message);
              }
            }
            console.log(`[Window Manager] ✅ 恢复完成，成功恢复 ${restoredCount} 个 cookies`);
          }

          // 🔑 强制刷新到磁盘，确保数据完全持久化
          console.log('[Window Manager] ⏳ 正在刷新 Session 数据到磁盘...');
          await windowSession.flushStorageData();
          console.log('[Window Manager] ✅ Session 数据已刷新到磁盘');

          // 🔑 延迟 500ms，确保数据完全写入后再创建窗口
          console.log('[Window Manager] ⏳ 等待 500ms 确保数据持久化...');
          await new Promise(resolve => setTimeout(resolve, 500));
          console.log('[Window Manager] ✅ 等待完成，准备创建窗口');

          console.log('[Window Manager] ========== 会话数据处理完成 ==========');
        } catch (err) {
          console.error('[Window Manager] ❌ 会话数据处理失败:', err);
          // 不影响窗口创建，继续执行
        }
      }
    } else if (options.useTemporarySession) {
      // 创建一个唯一的临时 session（不持久化，窗口关闭后数据丢失）
      const tempSessionId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      windowSession = session.fromPartition(tempSessionId, { cache: false }); // 禁用缓存，避免 CSS 渲染异常
      sessionType = 'temporary';
      console.log('[Window Manager] 使用临时 session:', tempSessionId);

      // 为临时 session 配置相同的 User-Agent（与持久化 session 保持一致）
      const customUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 zh.Cloud-browse/1.0';
      windowSession.setUserAgent(customUA);
      console.log('[Window Manager] 临时 session User-Agent 已设置');

      // 为临时 session 添加 webRequest 拦截器（阻止 bitbrowser:// 等协议）
      windowSession.webRequest.onBeforeRequest((details, callback) => {
        const reqUrl = details.url;
        if (reqUrl && reqUrl.toLowerCase().startsWith('bitbrowser:')) {
          console.log('[Temp Session WebRequest] ❌ Blocked bitbrowser protocol:', reqUrl);
          callback({ cancel: true });
          return;
        }
        callback({});
      });
      console.log('[Window Manager] 临时 session webRequest 拦截器已添加');
      addContentTypeFix(windowSession, '临时 session');
    } else {
      // 使用与主 BrowserView 相同的持久化 session
      windowSession = browserView.webContents.session;
      sessionType = 'persistent';
      console.log('[Window Manager] 使用持久化 session');
    }

    const newWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      icon: appIcon, // 使用 nativeImage 加载的图标
      webPreferences: {
        preload: path.join(__dirname, 'content-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        session: windowSession,
        backgroundThrottling: false, // 禁用后台节流，防止视频被暂停
        autoplayPolicy: 'no-user-gesture-required' // 允许自动播放视频
      }
    });

    // 添加到子窗口列表
    childWindows.push(newWindow);
    console.log('[Window Manager] 新窗口已添加，当前窗口数量:', childWindows.length);

    // 如果是多账号模式，记录窗口和账号的映射关系
    if (sessionType === 'account' && options.platform && options.accountId) {
      windowAccountMap.set(newWindow.id, {
        platform: options.platform,
        accountId: options.accountId
      });
      console.log(`[Window Manager] 记录窗口账号映射: windowId=${newWindow.id}, platform=${options.platform}, accountId=${options.accountId}`);
    }

    // 忽略页面的 beforeunload 事件，允许直接关闭窗口
    newWindow.webContents.on('will-prevent-unload', (event) => {
      console.log('[Window Manager] 忽略页面的 beforeunload 事件，强制关闭窗口');
      event.preventDefault();
    });

    // 保存窗口 ID，避免在 closed 事件中访问已销毁的窗口对象
    const windowId = newWindow.id;

    // 标记是否正在保存中（防止重复触发）
    let isSavingSession = false;

    // 🔑 监听窗口关闭前事件，保存最新会话数据到后台
    // 使用 e.preventDefault() 阻止立即关闭，等待保存完成后再销毁窗口
    newWindow.on('close', async (e) => {
      console.log('[Window Manager] ========== 窗口关闭前 ==========');
      console.log('[Window Manager] windowId:', windowId);

      // 防止重复触发
      if (isSavingSession) {
        console.log('[Window Manager] 正在保存中，忽略重复触发');
        return;
      }

      // 检查是否是多账号模式的窗口，需要保存登录信息
      const accountInfo = windowAccountMap.get(windowId);
      if (accountInfo) {
        // 阻止窗口立即关闭，等待保存完成
        e.preventDefault();
        isSavingSession = true;

        console.log('[Window Manager] 多账号模式窗口，等待保存会话数据完成后再关闭');

        try {
          // 调用公共函数保存登录信息
          const result = await saveWindowSessionToBackend(newWindow, windowId);
          console.log('[Window Manager] 保存结果:', result);

          // 通知首页：会话数据已更新
          if (browserView && !browserView.webContents.isDestroyed() && result.success) {
            const publishDataKey = `publish_data_window_${windowId}`;
            const publishData = globalStorage[publishDataKey];
            browserView.webContents.send('session-updated', {
              windowId: windowId,
              platform: accountInfo.platform,
              accountId: accountInfo.accountId,
              success: result.success,
              cookieCount: result.cookieCount,
              publishData: publishData,
              timestamp: Date.now()
            });
            console.log('[Window Manager] ✅ 已通知首页会话数据已更新');
          }
        } catch (err) {
          console.error('[Window Manager] ❌ 保存会话数据时出错:', err);
        } finally {
          // 保存完成（无论成功失败），销毁窗口
          console.log('[Window Manager] 保存完成，销毁窗口');
          newWindow.destroy();
        }
      }
      // 非多账号模式窗口直接关闭，不做处理
    });

    // 监听窗口关闭事件
    newWindow.on('closed', () => {
      const index = childWindows.indexOf(newWindow);
      if (index > -1) {
        childWindows.splice(index, 1);
        console.log('[Window Manager] 窗口已关闭，当前窗口数量:', childWindows.length);
      }
      // 清理窗口账号映射
      if (windowAccountMap.has(windowId)) {
        windowAccountMap.delete(windowId);
        console.log(`[Window Manager] 清理窗口账号映射: windowId=${windowId}`);
      }
      // 清理授权窗口标记
      const authFlagKey = `auth_mode_window_${windowId}`;
      if (globalStorage[authFlagKey]) {
        delete globalStorage[authFlagKey];
        saveGlobalStorage();
        console.log(`[Window Manager] 🏷️ 已清理授权窗口标记: ${authFlagKey}`);
      }
    });

    // 开发环境自动打开 DevTools
    if (!isProduction) {
      newWindow.webContents.openDevTools();
    }

    // 🔧 HTTP→HTTPS 升级：163.com 的 subscribe_v3 会 302 到 http://mp.163.com/subscribe_v4
    // HTTP 页面拿不到 Secure cookies → 以为没登录 → 跳登录页 → 死循环
    // 方案：三重拦截
    //   1. will-navigate：拦截页面 JS 发起的 HTTP 导航
    //   2. did-navigate：拦截服务端 302 重定向落地的 HTTP 页面（will-navigate 抓不到 302）
    //   3. onBeforeRequest：网络层拦截所有 HTTP 子请求（API 调用等），解决 Mixed Content
    newWindow.webContents.on('will-navigate', (event, navUrl) => {
      if (navUrl.startsWith('http://mp.163.com/')) {
        const httpsUrl = navUrl.replace('http://mp.163.com/', 'https://mp.163.com/');
        console.log(`[Window Nav] 🔒 HTTP→HTTPS (will-navigate): ${navUrl} → ${httpsUrl}`);
        event.preventDefault();
        newWindow.webContents.loadURL(httpsUrl);
      }
    });
    newWindow.webContents.on('did-navigate', (event, navUrl) => {
      // 302 重定向落地后立刻跳 HTTPS，防止页面 JS 在 HTTP 下执行并触发登录循环
      if (navUrl.startsWith('http://mp.163.com/')) {
        const httpsUrl = navUrl.replace('http://mp.163.com/', 'https://mp.163.com/');
        console.log(`[Window Nav] 🔒 HTTP→HTTPS (did-navigate 302 落地): ${navUrl} → ${httpsUrl}`);
        newWindow.webContents.loadURL(httpsUrl);
      }
    });

    // 🔧 163.com Mixed Content 修复：session 网络层拦截所有 HTTP 请求，升级为 HTTPS
    // 页面在 HTTPS 上运行，但 163.com 自己的 JS 发 HTTP API 请求（如 navinfo.do）被 Mixed Content 拦截
    // 仅对非共享 session 设置（避免影响主窗口 BrowserView 的其他页面）
    if (sessionType !== 'persistent') {
      windowSession.webRequest.onBeforeRequest((details, callback) => {
        const reqUrl = details.url;
        // 阻止 bitbrowser:// 协议
        if (reqUrl && reqUrl.toLowerCase().startsWith('bitbrowser:')) {
          console.log('[Window WebRequest] ❌ Blocked bitbrowser:', reqUrl);
          callback({ cancel: true });
          return;
        }
        // HTTP→HTTPS 升级：163.com 的所有请求（主页面 + API 子请求）
        if (reqUrl && reqUrl.startsWith('http://mp.163.com/')) {
          const httpsUrl = reqUrl.replace('http://mp.163.com/', 'https://mp.163.com/');
          console.log(`[Window WebRequest] 🔒 HTTP→HTTPS: ${reqUrl}`);
          callback({ redirectURL: httpsUrl });
          return;
        }
        callback({});
      });
    }

    // 🔧 授权窗口标记：供注入脚本区分「授权流程」vs「发布掉登录恢复」
    // 临时 session = 授权窗口，窗口 ID 可能复用导致残留 publish_data 被误读
    if (sessionType === 'temporary') {
      const authFlagKey = `auth_mode_window_${newWindow.id}`;
      globalStorage[authFlagKey] = true;
      saveGlobalStorage();
      console.log(`[Window Manager] 🏷️ 已标记授权窗口: ${authFlagKey}`);
    }

    // 🔑 为新窗口添加脚本注入（使用 dom-ready 而不是 did-finish-load，更早注入）
    // dom-ready 在 DOM 准备好但在 DOMContentLoaded 之前触发，可以更早执行脚本
    newWindow.webContents.on('dom-ready', async () => {
      const currentURL = newWindow.webContents.getURL();
      console.log('[New Window API] DOM ready:', currentURL);

      // 🔑 优先注入脚本（越早越好，防止页面 JS 先执行导致跳转问题）
      await scriptManager.getScript(currentURL).then(async (script) => {
        if (script) {
          console.log('[New Window API] Injecting script on dom-ready...');
          try {
            await newWindow.webContents.executeJavaScript(script);
            console.log('[New Window API] Script injected successfully');
          } catch (err) {
            console.error('[New Window API] Script injection error:', err);
          }
        }
      });
    });

    // 页面完全加载后通知首页 + 补充脚本注入（作为 dom-ready 的保底机制）
    newWindow.webContents.on('did-finish-load', async () => {
      const currentURL = newWindow.webContents.getURL();
      console.log('[New Window API] Page loaded:', currentURL);

      // 通知首页：新窗口页面加载完成
      if (browserView && !browserView.webContents.isDestroyed()) {
        browserView.webContents.send('window-loaded', {
          url: currentURL,
          windowId: newWindow.id,
          timestamp: Date.now()
        });
        console.log('[New Window API] 已通知首页窗口加载完成');
      }

      // 🔑 补充脚本注入（与 did-create-window 保持一致）
      // dom-ready 可能因远程脚本拉取延迟导致注入失败，did-finish-load 作为保底
      await injectScriptForUrl(newWindow.webContents, currentURL);
    });

    // 监听新窗口内的导航（SPA 路由）
    newWindow.webContents.on('did-navigate-in-page', async (event, navUrl) => {
      console.log('[New Window API] SPA Navigation:', navUrl);
      const script = await scriptManager.getScript(navUrl);
      if (script) {
        try {
          await newWindow.webContents.executeJavaScript(script);
          console.log('[New Window API] Script re-injected on navigation');
        } catch (err) {
          console.error('[New Window API] Script re-injection error:', err);
        }
      }
      await injectScriptForUrl(newWindow.webContents, navUrl);
    });

    // 🔑 检查是否需要预设 localStorage（解决搜狐号等平台首次打开跳转首页的问题）
    // 问题原因：页面脚本在 dom-ready 前就执行，读取了旧的 localStorage 值
    // 解决方案：先加载 about:blank，设置 localStorage，再导航到目标 URL
    let localStorageData = null;

    if (options.sessionData) {
      let sessionData = options.sessionData;
      // 解析 sessionData
      if (typeof sessionData === 'string') {
        try {
          sessionData = JSON.parse(sessionData);
          if (typeof sessionData === 'string') {
            sessionData = JSON.parse(sessionData);
          }
        } catch (e) {
          // 忽略解析错误
        }
      }

      // 检查是否有 localStorage 数据
      if (sessionData && typeof sessionData === 'object' && sessionData.localStorage) {
        localStorageData = sessionData.localStorage;
        console.log('[Window Manager] 🔑 检测到 localStorage 数据:', Object.keys(localStorageData));
      }
    }

    // 如果有 localStorage 数据需要预设，先加载 about:blank
    if (localStorageData && Object.keys(localStorageData).length > 0) {
      console.log('[Window Manager] 🔄 预设 localStorage，先加载 about:blank...');

      // 获取目标域名（用于设置 localStorage）
      const targetUrl = new URL(url);
      const targetOrigin = targetUrl.origin;

      // 先加载一个同域的空白页（about:blank 不能设置 localStorage，需要用目标域）
      // 使用一个简单的 data URL 或者目标域的任意页面
      await newWindow.loadURL(`${targetOrigin}/favicon.ico`).catch(() => {
        // favicon 可能不存在，忽略错误
      });

      // 等待页面加载
      await new Promise(resolve => setTimeout(resolve, 100));

      // 设置 localStorage
      const localStorageScript = `
        (function() {
          const data = ${JSON.stringify(localStorageData)};
          console.log('[预设 localStorage] 开始设置...', Object.keys(data));
          for (const key in data) {
            try {
              localStorage.setItem(key, data[key]);
              console.log('[预设 localStorage] 已设置:', key, '=', data[key]);
            } catch (e) {
              console.error('[预设 localStorage] 设置失败:', key, e);
            }
          }
          console.log('[预设 localStorage] 完成');
        })();
      `;

      try {
        await newWindow.webContents.executeJavaScript(localStorageScript);
        console.log('[Window Manager] ✅ localStorage 预设完成');
      } catch (err) {
        console.error('[Window Manager] ❌ localStorage 预设失败:', err.message);
      }

      // 等待一下确保 localStorage 写入
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // 加载目标 URL
    newWindow.loadURL(url);
    return { success: true, windowId: newWindow.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 从内容页面在当前窗口打开 URL
ipcMain.handle('navigate-current-window', async (event, url) => {
  if (!url) {
    return { success: false, error: 'No URL provided' };
  }

  try {
    if (browserView) {
      browserView.webContents.loadURL(url);
      return { success: true };
    }
    return { success: false, error: 'No browser view available' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 关闭当前窗口（仅对子窗口有效，不能关闭主窗口）
ipcMain.handle('close-current-window', async (event) => {
  console.log('[Window Manager] ========== 收到关闭窗口请求 ==========');
  try {
    // 查找发送请求的窗口
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    console.log('[Window Manager] senderWindow:', senderWindow ? 'Found' : 'NULL');
    console.log('[Window Manager] mainWindow:', mainWindow ? 'Exists' : 'NULL');
    console.log('[Window Manager] senderWindow === mainWindow:', senderWindow === mainWindow);
    console.log('[Window Manager] childWindows.length:', childWindows.length);
    console.log('[Window Manager] event.sender.getType():', event.sender.getType());

    // 如果是主窗口，拒绝关闭
    if (senderWindow === mainWindow) {
      console.log('[Window Manager] ❌ 拒绝关闭主窗口');
      return { success: false, error: 'Cannot close main window' };
    }

    // 如果 senderWindow 是 null，可能是来自 BrowserView
    if (!senderWindow) {
      console.log('[Window Manager] ⚠️ senderWindow 为 null，可能来自 BrowserView');
      console.log('[Window Manager] ⚠️ 尝试查找包含此 webContents 的窗口...');

      // 遍历所有子窗口，查找匹配的 webContents
      for (let i = 0; i < childWindows.length; i++) {
        const child = childWindows[i];
        if (child && !child.isDestroyed() && child.webContents === event.sender) {
          console.log(`[Window Manager] ✅ 在子窗口列表中找到匹配窗口 [${i}]`);
          child.close();
          return { success: true };
        }
      }

      console.log('[Window Manager] ❌ 未在子窗口列表中找到匹配窗口');
      return { success: false, error: 'Sender is BrowserView, not a window' };
    }

    // 如果是子窗口，关闭它
    if (senderWindow && !senderWindow.isDestroyed()) {
      const isChildWindow = childWindows.includes(senderWindow);
      console.log('[Window Manager] isChildWindow:', isChildWindow);

      if (isChildWindow) {
        console.log('[Window Manager] ✅ 关闭子窗口');
        senderWindow.close();
        return { success: true };
      } else {
        console.log('[Window Manager] ⚠️ 窗口存在但不在子窗口列表中');
      }
    }

    console.log('[Window Manager] ❌ No window to close');
    return { success: false, error: 'No window to close' };
  } catch (err) {
    console.error('[Window Manager] ❌ 关闭窗口失败:', err);
    return { success: false, error: err.message };
  }
});

// 获取当前窗口的 ID（用于新窗口识别自己）
ipcMain.handle('get-window-id', async (event) => {
  try {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow) {
      return { success: true, windowId: senderWindow.id };
    }
    // 可能是 BrowserView
    if (browserView && event.sender === browserView.webContents) {
      return { success: true, windowId: 'main', isMainView: true };
    }
    return { success: false, error: 'Cannot determine window' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 获取主窗口（BrowserView）的 URL（用于获取首页域名）
ipcMain.handle('get-main-url', async () => {
  try {
    if (browserView && !browserView.webContents.isDestroyed()) {
      const url = browserView.webContents.getURL();
      // 解析出域名
      const urlObj = new URL(url);
      return {
        success: true,
        url: url,
        origin: urlObj.origin,  // 如 https://dev.china9.cn
        host: urlObj.host,      // 如 dev.china9.cn
        protocol: urlObj.protocol // 如 https:
      };
    }
    return { success: false, error: 'BrowserView 不可用' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ========== 脚本管理功能 ==========

// 获取所有已保存的脚本列表
ipcMain.handle('get-all-scripts', async () => {
  return scriptManager.getAllScripts();
});

// 删除指定脚本
ipcMain.handle('delete-script', async (event, url) => {
  return await scriptManager.deleteScript(url);
});

// 清空所有脚本
ipcMain.handle('clear-all-scripts', async () => {
  return await scriptManager.clearAll();
});

// 导出脚本到指定目录
ipcMain.handle('export-scripts', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: '选择导出目录'
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }

  return await scriptManager.exportScripts(result.filePaths[0]);
});

// 从目录导入脚本
ipcMain.handle('import-scripts', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择要导入的脚本目录'
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }

  return await scriptManager.importScripts(result.filePaths[0]);
});

// 打开脚本存储目录
ipcMain.handle('open-scripts-folder', async () => {
  const { shell } = require('electron');
  await shell.openPath(scriptManager.scriptsDir);
  return { success: true };
});

// ========== Cookie 调试功能 ==========

// 获取当前所有 Cookies
ipcMain.handle('get-cookies', async () => {
  if (browserView) {
    const cookies = await browserView.webContents.session.cookies.get({});
    console.log(`[Cookie Debug] Total cookies: ${cookies.length}`);
    cookies.forEach(c => {
      console.log(`  - ${c.name} @ ${c.domain} (expires: ${c.expirationDate ? new Date(c.expirationDate * 1000).toLocaleString() : 'session'})`);
    });
    return { success: true, count: cookies.length, cookies };
  }
  return { success: false, error: 'No browser view' };
});

// 手动保存 Session 数据
ipcMain.handle('flush-session', async () => {
  if (browserView) {
    const ses = browserView.webContents.session;
    const cookies = await ses.cookies.get({});
    console.log(`[Manual Save] Flushing ${cookies.length} cookies to disk...`);
    await ses.flushStorageData();
    console.log('[Manual Save] Session data flushed successfully');
    return { success: true, cookieCount: cookies.length };
  }
  return { success: false, error: 'No browser view' };
});

// 获取 Session 存储路径
ipcMain.handle('get-session-path', async () => {
  if (browserView) {
    const storagePath = browserView.webContents.session.getStoragePath();
    console.log(`[Session Path] ${storagePath}`);
    return { success: true, path: storagePath };
  }
  return { success: false };
});

// ========== 设置 Cookie（跨域支持） ==========
ipcMain.handle('set-cookie', async (event, cookieData) => {
  console.log('[Set Cookie] ========== API 调用 ==========');
  console.log('[Set Cookie] 请求设置 Cookie:', cookieData);

  if (!cookieData || !cookieData.name || !cookieData.value) {
    return { success: false, error: 'Cookie name 和 value 不能为空' };
  }

  if (browserView && !browserView.webContents.isDestroyed()) {
    try {
      const ses = browserView.webContents.session;

      // 构建 Cookie 对象 - URL 必须提供
      if (!cookieData.url) {
        return { success: false, error: 'Cookie url 不能为空' };
      }

      const cookie = {
        url: cookieData.url,
        name: cookieData.name,
        value: cookieData.value,
        path: cookieData.path || '/',
        secure: cookieData.secure !== undefined ? cookieData.secure : false,
        httpOnly: cookieData.httpOnly || false,
        sameSite: cookieData.sameSite || 'no_restriction'
      };

      // 只有明确提供 domain 时才设置（localhost 不需要 domain）
      if (cookieData.domain) {
        cookie.domain = cookieData.domain;
      }

      // 设置过期时间
      if (cookieData.expirationDate) {
        cookie.expirationDate = cookieData.expirationDate;
      } else if (cookieData.expires) {
        // 支持 Date 对象或时间戳
        cookie.expirationDate = typeof cookieData.expires === 'number'
          ? Math.floor(cookieData.expires / 1000)  // 毫秒转秒
          : Math.floor(new Date(cookieData.expires).getTime() / 1000);
      }

      console.log('[Set Cookie] 实际设置的 Cookie:', cookie);
      await ses.cookies.set(cookie);
      console.log('[Set Cookie] ✅ Cookie 设置成功');

      // 强制刷新到磁盘，确保持久化
      await ses.flushStorageData();
      console.log('[Set Cookie] ✅ Session 数据已刷新到磁盘');

      // 验证 Cookie 是否设置成功
      const cookies = await ses.cookies.get({ name: cookieData.name });
      console.log('[Set Cookie] 验证结果:', cookies);

      return { success: true };
    } catch (err) {
      console.error('[Set Cookie] ❌ 设置失败:', err);
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: 'BrowserView 不可用' };
});

// ========== 迁移临时 Session 的 Cookies 到持久化 Session ==========
// 用于授权窗口（临时session）授权成功后，把登录状态复制到持久化session
ipcMain.handle('migrate-cookies-to-persistent', async (event, domain) => {
  console.log('[Cookie Migration] ========== API 调用 ==========');
  console.log('[Cookie Migration] 请求迁移域名:', domain);

  if (!domain) {
    return { success: false, error: '域名不能为空' };
  }

  try {
    // 获取调用者的 session（临时 session）
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      return { success: false, error: '无法获取发送者窗口' };
    }

    const tempSession = senderWindow.webContents.session;
    const persistentSession = browserView.webContents.session;

    // 检查是否是不同的 session
    if (tempSession === persistentSession) {
      console.log('[Cookie Migration] ⚠️ 已经是持久化 session，跳过迁移');
      return { success: true, migratedCount: 0, message: '已经是持久化 session' };
    }

    // 获取临时 session 中指定域名的 cookies
    const tempCookies = await tempSession.cookies.get({});
    console.log(`[Cookie Migration] 临时 session 共有 ${tempCookies.length} 个 cookies`);

    // 过滤出指定域名的 cookies
    const domainCookies = tempCookies.filter(cookie => {
      const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
      return cookieDomain.includes(domain) || domain.includes(cookieDomain);
    });

    console.log(`[Cookie Migration] 找到 ${domainCookies.length} 个 ${domain} 的 cookies`);

    if (domainCookies.length === 0) {
      return { success: false, error: `没有找到 ${domain} 的 cookies` };
    }

    // 先清除持久化 session 中该域名的旧 cookies（避免冲突）
    const oldCookies = await persistentSession.cookies.get({});
    for (const cookie of oldCookies) {
      const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
      const shouldDelete = cookieDomain.includes(domain) || domain.includes(cookieDomain);
      if (shouldDelete) {
        const cookieUrl = `${cookie.secure ? 'https' : 'http'}://${cookieDomain}${cookie.path}`;
        try {
          await persistentSession.cookies.remove(cookieUrl, cookie.name);
          console.log(`[Cookie Migration] ✓ 清除旧 cookie: ${cookie.name}`);
        } catch (err) {
          // 忽略删除失败
        }
      }
    }

    // 将临时 session 的 cookies 复制到持久化 session
    let migratedCount = 0;
    const oneYearFromNow = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);

    for (const cookie of domainCookies) {
      try {
        const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
        const cookieUrl = `${cookie.secure ? 'https' : 'http'}://${cookieDomain}${cookie.path}`;

        const newCookie = {
          url: cookieUrl,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite || 'no_restriction',
          // 设置为持久化 cookie（1年过期）
          expirationDate: cookie.expirationDate || oneYearFromNow
        };

        await persistentSession.cookies.set(newCookie);
        migratedCount++;
        console.log(`[Cookie Migration] ✓ 迁移: ${cookie.name} @ ${cookie.domain}`);
      } catch (err) {
        console.error(`[Cookie Migration] ✗ 迁移失败: ${cookie.name} @ ${cookie.domain}`, err.message);
      }
    }

    // 刷新到磁盘
    await persistentSession.flushStorageData();

    console.log(`[Cookie Migration] ========== 迁移完成 ==========`);
    console.log(`[Cookie Migration] ✅ 共迁移 ${migratedCount}/${domainCookies.length} 个 cookies`);

    return { success: true, migratedCount, totalFound: domainCookies.length };
  } catch (err) {
    console.error('[Cookie Migration] 迁移失败:', err);
    return { success: false, error: err.message };
  }
});

// ========== 清除指定域名的 Cookies ==========
ipcMain.handle('clear-domain-cookies', async (event, domain) => {
  console.log('[Clear Cookies] ========== API 调用 ==========');
  console.log('[Clear Cookies] 请求清除域名:', domain);

  if (!domain) {
    return { success: false, error: '域名不能为空' };
  }

  try {
    // 获取调用者的 session（可能是 BrowserView 或子窗口）
    let ses = null;
    let sessionSource = '';

    // 检查是否来自 BrowserView
    if (browserView && event.sender === browserView.webContents) {
      ses = browserView.webContents.session;
      sessionSource = 'BrowserView';
    } else {
      // 检查是否来自子窗口
      const senderWindow = BrowserWindow.fromWebContents(event.sender);
      if (senderWindow) {
        ses = senderWindow.webContents.session;
        sessionSource = `子窗口 (ID: ${senderWindow.id})`;
      }
    }

    if (!ses) {
      console.error('[Clear Cookies] 无法获取 session');
      return { success: false, error: '无法获取 session' };
    }

    console.log(`[Clear Cookies] Session 来源: ${sessionSource}`);
    const cookies = await ses.cookies.get({});
    console.log(`[Clear Cookies] 当前共有 ${cookies.length} 个 cookies`);

    let deletedCount = 0;
    for (const cookie of cookies) {
      // 匹配域名（包括子域名）
      const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
      const shouldDelete = cookieDomain.includes(domain) || domain.includes(cookieDomain);

      // 调试：显示所有 Cookie 的匹配情况
      if (cookie.domain.includes('weixin') || cookie.domain.includes('channels')) {
        console.log(`[Clear Cookies] 检查: ${cookie.name} @ ${cookie.domain}, 匹配: ${shouldDelete}`);
      }

      if (shouldDelete) {
        // 使用原始域名（保留点）构建 URL
        // 对于 .channels.weixin.qq.com，需要使用去掉点的域名作为 host
        const urlHost = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
        const cookieUrl = `${cookie.secure ? 'https' : 'http'}://${urlHost}${cookie.path}`;

        console.log(`[Clear Cookies] 尝试删除: ${cookie.name} @ ${cookie.domain}`);
        console.log(`[Clear Cookies] Cookie 详情:`, {
          name: cookie.name,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite
        });
        console.log(`[Clear Cookies] 使用 URL: ${cookieUrl}`);

        try {
          await ses.cookies.remove(cookieUrl, cookie.name);
          deletedCount++;
          console.log(`[Clear Cookies] ✓ 删除成功: ${cookie.name} @ ${cookie.domain}`);
        } catch (err) {
          console.error(`[Clear Cookies] ✗ 删除失败: ${cookie.name} @ ${cookie.domain}`, err.message);

          // 如果删除失败，尝试多种 URL 格式
          const urlsToTry = [
            `${cookie.secure ? 'https' : 'http'}://${cookie.domain}${cookie.path}`, // 带点的域名
            `${cookie.secure ? 'https' : 'http'}://${urlHost}/`, // 根路径
            `${cookie.secure ? 'https' : 'http'}://${cookie.domain}/`, // 带点的域名 + 根路径
          ];

          let retrySuccess = false;
          for (const tryUrl of urlsToTry) {
            try {
              console.log(`[Clear Cookies] 重试 URL: ${tryUrl}`);
              await ses.cookies.remove(tryUrl, cookie.name);
              deletedCount++;
              retrySuccess = true;
              console.log(`[Clear Cookies] ✓ 重试成功: ${cookie.name} @ ${cookie.domain} (URL: ${tryUrl})`);
              break;
            } catch (retryErr) {
              console.error(`[Clear Cookies] ✗ 重试失败 (${tryUrl}):`, retryErr.message);
            }
          }

          if (!retrySuccess) {
            console.error(`[Clear Cookies] ❌ 所有重试都失败了: ${cookie.name} @ ${cookie.domain}`);
          }
        }
      }
    }

    console.log(`[Clear Cookies] ========== 清除完成 ==========`);
    console.log(`[Clear Cookies] ✅ 共删除 ${deletedCount} 个 cookies`);

    return { success: true, deletedCount };
  } catch (err) {
    console.error('[Clear Cookies] 清除失败:', err);
    return { success: false, error: err.message };
  }
});

// ========== 全局数据存储（用于跨页面数据传递） ==========

// 存储数据
ipcMain.handle('global-storage-set', async (event, key, value) => {
  console.log('[Global Storage] 存储数据:', key, '=', value);
  globalStorage[key] = value;
  saveGlobalStorage(); // 持久化保存
  return { success: true };
});

// 获取数据
ipcMain.handle('global-storage-get', async (event, key) => {
  const value = globalStorage[key];
  console.log('[Global Storage] 获取数据:', key, '=', value);
  return { success: true, value };
});

// 删除数据
ipcMain.handle('global-storage-remove', async (event, key) => {
  console.log('[Global Storage] 删除数据:', key);
  delete globalStorage[key];
  saveGlobalStorage(); // 持久化保存
  return { success: true };
});

// 获取所有数据
ipcMain.handle('global-storage-get-all', async () => {
  console.log('[Global Storage] 获取所有数据:', globalStorage);
  return { success: true, data: { ...globalStorage } };
});

// 清空所有数据
ipcMain.handle('global-storage-clear', async () => {
  console.log('[Global Storage] 清空所有数据');
  globalStorage = {};
  saveGlobalStorage(); // 持久化保存
  return { success: true };
});

// ========== 视频下载功能（通过主进程绕过跨域限制） ==========
// 优化：添加文件大小限制，防止内存溢出
const MAX_VIDEO_SIZE = 200 * 1024 * 1024; // 200MB 限制

ipcMain.handle('download-video', async (event, url) => {
  console.log('[Video Download] 开始下载:', url);

  if (!url) {
    return { success: false, error: 'No URL provided' };
  }

  // 内部下载函数，支持重定向
  const downloadWithRedirect = (downloadUrl, redirectCount = 0) => {
    return new Promise((resolve) => {
      if (redirectCount > 5) {
        resolve({ success: false, error: 'Too many redirects' });
        return;
      }

      const https = require('https');
      const http = require('http');
      const protocol = downloadUrl.startsWith('https') ? https : http;

      const request = protocol.get(downloadUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      }, (response) => {
        // 处理重定向
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          let redirectUrl = response.headers.location;
          // 处理相对路径重定向
          if (!redirectUrl.startsWith('http')) {
            const urlObj = new URL(downloadUrl);
            redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
          }
          console.log('[Video Download] 重定向到:', redirectUrl);
          resolve(downloadWithRedirect(redirectUrl, redirectCount + 1));
          return;
        }

        if (response.statusCode !== 200) {
          resolve({ success: false, error: `HTTP error: ${response.statusCode}` });
          return;
        }

        // 优化：检查文件大小
        const contentLength = parseInt(response.headers['content-length'], 10);
        if (contentLength && contentLength > MAX_VIDEO_SIZE) {
          response.destroy();
          resolve({ success: false, error: `File too large: ${Math.round(contentLength / 1024 / 1024)}MB (max ${MAX_VIDEO_SIZE / 1024 / 1024}MB)` });
          return;
        }

        const chunks = [];
        let totalSize = 0;
        const contentType = response.headers['content-type'] || 'video/mp4';

        response.on('data', (chunk) => {
          totalSize += chunk.length;
          // 优化：实时检查大小，防止超限
          if (totalSize > MAX_VIDEO_SIZE) {
            response.destroy();
            resolve({ success: false, error: `Download exceeded size limit: ${Math.round(totalSize / 1024 / 1024)}MB` });
            return;
          }
          chunks.push(chunk);
        });

        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const base64Data = buffer.toString('base64');
          console.log('[Video Download] 下载完成，大小:', buffer.length, 'bytes');

          // 优化：立即清理 chunks 数组释放内存
          chunks.length = 0;

          resolve({
            success: true,
            data: base64Data,
            contentType: contentType,
            size: buffer.length
          });
        });

        response.on('error', (err) => {
          console.error('[Video Download] 响应错误:', err);
          resolve({ success: false, error: err.message });
        });
      });

      request.on('error', (err) => {
        console.error('[Video Download] 请求错误:', err);
        resolve({ success: false, error: err.message });
      });

      // 优化：增加超时时间到 120 秒
      request.setTimeout(120000, () => {
        request.destroy();
        resolve({ success: false, error: 'Download timeout (120s)' });
      });
    });
  };

  try {
    return await downloadWithRedirect(url);
  } catch (err) {
    console.error('[Video Download] 异常:', err);
    return { success: false, error: err.message };
  }
});

// ========== 图片下载功能（通过主进程绕过跨域限制） ==========
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB 限制

ipcMain.handle('download-image', async (event, url) => {
  console.log('[Image Download] 开始下载:', url);

  if (!url) {
    return { success: false, error: 'No URL provided' };
  }

  const downloadWithRedirect = (downloadUrl, redirectCount = 0) => {
    return new Promise((resolve) => {
      if (redirectCount > 5) {
        resolve({ success: false, error: 'Too many redirects' });
        return;
      }

      const protocol = downloadUrl.startsWith('https') ? https : http;

      const request = protocol.get(downloadUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          let redirectUrl = response.headers.location;
          if (!redirectUrl.startsWith('http')) {
            const urlObj = new URL(downloadUrl);
            redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
          }
          console.log('[Image Download] 重定向到:', redirectUrl);
          resolve(downloadWithRedirect(redirectUrl, redirectCount + 1));
          return;
        }

        if (response.statusCode !== 200) {
          resolve({ success: false, error: `HTTP error: ${response.statusCode}` });
          return;
        }

        const contentLength = parseInt(response.headers['content-length'], 10);
        if (contentLength && contentLength > MAX_IMAGE_SIZE) {
          response.destroy();
          resolve({ success: false, error: `File too large: ${Math.round(contentLength / 1024 / 1024)}MB (max ${MAX_IMAGE_SIZE / 1024 / 1024}MB)` });
          return;
        }

        const chunks = [];
        let totalSize = 0;
        const contentType = response.headers['content-type'] || 'image/jpeg';

        response.on('data', (chunk) => {
          totalSize += chunk.length;
          if (totalSize > MAX_IMAGE_SIZE) {
            response.destroy();
            resolve({ success: false, error: `Download exceeded size limit: ${Math.round(totalSize / 1024 / 1024)}MB` });
            return;
          }
          chunks.push(chunk);
        });

        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const base64Data = buffer.toString('base64');
          console.log('[Image Download] 下载完成，大小:', buffer.length, 'bytes');
          chunks.length = 0;

          resolve({
            success: true,
            data: base64Data,
            contentType: contentType,
            size: buffer.length
          });
        });

        response.on('error', (err) => {
          console.error('[Image Download] 响应错误:', err);
          resolve({ success: false, error: err.message });
        });
      });

      request.on('error', (err) => {
        console.error('[Image Download] 请求错误:', err);
        resolve({ success: false, error: err.message });
      });

      request.setTimeout(30000, () => {
        request.destroy();
        resolve({ success: false, error: 'Download timeout (30s)' });
      });
    });
  };

  try {
    return await downloadWithRedirect(url);
  } catch (err) {
    console.error('[Image Download] 异常:', err);
    return { success: false, error: err.message };
  }
});

// ========== 文件下载功能（从内容页面触发） ==========
ipcMain.handle('trigger-download', async (event, url) => {
  console.log('[Trigger Download] 收到下载请求:', url);

  if (!url) {
    return { success: false, error: 'No URL provided' };
  }

  try {
    // 触发下载
    if (browserView && !browserView.webContents.isDestroyed()) {
      browserView.webContents.downloadURL(url);
      return { success: true };
    }
    return { success: false, error: 'BrowserView not available' };
  } catch (err) {
    console.error('[Trigger Download] 错误:', err);
    return { success: false, error: err.message };
  }
});

// ========== 第三方窗口关闭前保存登录信息的公共函数 ==========
// 用于在窗口关闭前自动上传最新的登录信息到后台

/**
 * 保存窗口的登录信息到后台
 * @param {BrowserWindow} targetWindow - 要保存的窗口
 * @param {number} windowId - 窗口 ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function saveWindowSessionToBackend(targetWindow, windowId) {
  console.log('[Save Session] ========== 窗口关闭前保存登录信息 ==========');
  console.log('[Save Session] windowId:', windowId);

  try {
    // 检查窗口是否还有效
    if (!targetWindow || targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
      console.log('[Save Session] ⚠️ 窗口已销毁，跳过保存');
      return { success: false, error: '窗口已销毁' };
    }

    // 检查是否是多账号模式的窗口
    const accountInfo = windowAccountMap.get(windowId);
    if (!accountInfo) {
      console.log('[Save Session] ⚠️ 该窗口没有关联账号（非多账号模式），跳过保存');
      return { success: false, error: '非多账号模式窗口' };
    }

    console.log('[Save Session] 平台:', accountInfo.platform, '账号ID:', accountInfo.accountId);

    // 获取发布数据中的账号信息
    const publishDataKey = `publish_data_window_${windowId}`;
    const publishData = globalStorage[publishDataKey];
    const backendAccountId = publishData?.element?.account_info?.id;

    // 优先从 element 获取配置，否则使用配置文件
    const saveSessionApi = publishData?.element?.saveSessionApi
      || publishData?.element?.save_session_api
      || config.platformApis[accountInfo.platform];

    // 从 element.cookies 提取 domain，否则使用配置文件
    let cookieDomains = config.platformDomains[accountInfo.platform] || [];
    const elementCookies = publishData?.element?.cookies;
    if (elementCookies) {
      try {
        const cookiesData = typeof elementCookies === 'string' ? JSON.parse(elementCookies) : elementCookies;
        if (cookiesData.domain) {
          cookieDomains = [cookiesData.domain];
          console.log('[Save Session] 从 element.cookies 提取 domain:', cookiesData.domain);
        }
      } catch (parseErr) {
        console.error('[Save Session] 解析 element.cookies 失败:', parseErr);
      }
    }

    if (!saveSessionApi) {
      console.log('[Save Session] ⚠️ 未找到保存接口配置，跳过保存');
      return { success: false, error: '未找到保存接口配置' };
    }

    if (cookieDomains.length === 0) {
      console.log('[Save Session] ⚠️ 未找到 cookie domain 配置，跳过保存');
      return { success: false, error: '未找到 cookie domain 配置' };
    }

    if (!backendAccountId) {
      console.log('[Save Session] ⚠️ 未找到账号 ID（account_info.id），跳过保存');
      return { success: false, error: '未找到账号 ID' };
    }

    // 获取该窗口 session 的最新 cookies
    const windowSession = targetWindow.webContents.session;
    const allCookies = await windowSession.cookies.get({});

    // 根据 domains 过滤 cookies
    const platformCookies = allCookies.filter(cookie => {
      const cd = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
      return cookieDomains.some(d => cd.includes(d) || d.includes(cd));
    });

    console.log(`[Save Session] 找到 ${platformCookies.length} 个平台相关 cookies (domains: ${cookieDomains.join(', ')})`);

    if (platformCookies.length === 0) {
      console.log('[Save Session] ⚠️ 未找到平台相关 cookies，跳过保存');
      return { success: false, error: '未找到平台相关 cookies' };
    }

    // 转换为可序列化的格式
    const cookiesArray = platformCookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      expirationDate: c.expirationDate
    }));

    // 获取后台 API 域名（从 browserView 的 URL 获取，否则用配置文件默认值）
    let apiOrigin = config.apiBaseUrl;
    if (browserView && !browserView.webContents.isDestroyed()) {
      try {
        const mainUrl = browserView.webContents.getURL();
        const urlObj = new URL(mainUrl);
        if (urlObj.origin && !urlObj.origin.includes('file://')) {
          apiOrigin = urlObj.origin;
        }
      } catch (urlErr) {
        console.error('[Save Session] 解析主窗口 URL 失败:', urlErr);
      }
    }

    console.log('[Save Session] 后台 API 域名:', apiOrigin);
    console.log('[Save Session] 保存接口路径:', saveSessionApi);
    console.log('[Save Session] 账号 ID:', backendAccountId);

    // 调用后台接口保存 cookies（使用 Promise 包装，等待完成）
    const https = require('https');
    const http = require('http');

    const postData = JSON.stringify({
      id: backendAccountId,
      cookies: JSON.stringify({ domain: cookieDomains[0], cookies: cookiesArray })
    });

    const apiUrl = new URL(`${apiOrigin}${saveSessionApi}`);
    const protocol = apiUrl.protocol === 'https:' ? https : http;

    const result = await new Promise((resolve) => {
      const req = protocol.request({
        hostname: apiUrl.hostname,
        port: apiUrl.port || (apiUrl.protocol === 'https:' ? 443 : 80),
        path: apiUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 10000 // 10秒超时
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('[Save Session] ✅ 会话数据已保存到后台, 响应:', data.substring(0, 200));
          resolve({ success: true, cookieCount: cookiesArray.length });
        });
      });

      req.on('error', (err) => {
        console.error('[Save Session] ❌ 保存会话数据到后台失败:', err.message);
        resolve({ success: false, error: err.message });
      });

      req.on('timeout', () => {
        console.error('[Save Session] ❌ 保存请求超时');
        req.destroy();
        resolve({ success: false, error: '请求超时' });
      });

      req.write(postData);
      req.end();
    });

    console.log('[Save Session] ========== 保存完成 ==========');
    return result;
  } catch (err) {
    console.error('[Save Session] ❌ 保存失败:', err);
    return { success: false, error: err.message };
  }
}

// ========== 多账号管理功能 ==========
// 账号 Session 缓存（避免重复创建）
const accountSessions = new Map();

// 生成唯一账号 ID
function generateAccountId(platform) {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 6);
  return `${platform}_${timestamp}_${random}`;
}

// 获取或创建账号的 Session
function getAccountSession(platform, accountId) {
  const partitionName = `persist:${platform}_${accountId}`;

  // 检查缓存
  if (accountSessions.has(partitionName)) {
    console.log(`[Account Session] 从缓存获取 session: ${partitionName}`);
    return accountSessions.get(partitionName);
  }

  // 创建新的持久化 session（禁用 HTTP 缓存，避免 CSS 渲染异常）
  const accountSession = session.fromPartition(partitionName, { cache: false });

  // 配置 User-Agent（与主 session 保持一致）
  const customUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 zh.Cloud-browse/1.0';
  accountSession.setUserAgent(customUA);

  // 添加 webRequest 拦截器（阻止 bitbrowser:// 等协议）
  accountSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    if (url && url.toLowerCase().startsWith('bitbrowser:')) {
      console.log(`[Account Session ${partitionName}] ❌ Blocked bitbrowser protocol:`, url);
      callback({ cancel: true });
      return;
    }
    callback({});
  });

  // 缓存 session
  accountSessions.set(partitionName, accountSession);
  console.log(`[Account Session] 创建新 session: ${partitionName}`);
  addContentTypeFix(accountSession, `账号 session ${partitionName}`);

  return accountSession;
}

// 删除账号的 Session 数据
async function deleteAccountSession(platform, accountId) {
  const partitionName = `persist:${platform}_${accountId}`;

  // 从缓存中移除
  if (accountSessions.has(partitionName)) {
    const accountSession = accountSessions.get(partitionName);
    try {
      // 清除 session 数据
      await accountSession.clearStorageData();
      console.log(`[Account Session] 已清除 session 数据: ${partitionName}`);
    } catch (err) {
      console.error(`[Account Session] 清除 session 数据失败: ${partitionName}`, err);
    }
    accountSessions.delete(partitionName);
  }

  // 尝试删除磁盘上的 session 目录
  const sessionPath = path.join(app.getPath('userData'), 'Partitions', partitionName.replace('persist:', ''));
  if (fs.existsSync(sessionPath)) {
    try {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log(`[Account Session] 已删除 session 目录: ${sessionPath}`);
    } catch (err) {
      console.error(`[Account Session] 删除 session 目录失败: ${sessionPath}`, err);
    }
  }
}

// 初始化 platformAccounts 数据结构
function ensurePlatformAccounts() {
  if (!globalStorage.platformAccounts) {
    globalStorage.platformAccounts = {
      douyin: [],
      xiaohongshu: [],
      baijiahao: [],
      weixin: [],
      shipinhao: []
    };
    saveGlobalStorage();
  }
  return globalStorage.platformAccounts;
}

// 获取指定平台的所有账号
ipcMain.handle('get-accounts', async (event, platform) => {
  console.log('[Account Manager] 获取账号列表:', platform);

  const platformAccounts = ensurePlatformAccounts();
  const accounts = platformAccounts[platform] || [];

  console.log(`[Account Manager] ${platform} 共有 ${accounts.length} 个账号`);
  return { success: true, accounts };
});

// 获取所有平台的所有账号
ipcMain.handle('get-all-accounts', async () => {
  console.log('[Account Manager] 获取所有平台账号');

  const platformAccounts = ensurePlatformAccounts();
  return { success: true, platformAccounts };
});

// 添加账号
ipcMain.handle('add-account', async (event, platform, accountInfo) => {
  console.log('[Account Manager] 添加账号:', platform, accountInfo);

  const platformAccounts = ensurePlatformAccounts();

  if (!platformAccounts[platform]) {
    platformAccounts[platform] = [];
  }

  // 检查是否已存在（通过 platformUid 去重）
  if (accountInfo.platformUid) {
    const existing = platformAccounts[platform].find(a => a.platformUid === accountInfo.platformUid);
    if (existing) {
      console.log('[Account Manager] 账号已存在，更新信息:', existing.id);
      // 更新现有账号信息
      existing.nickname = accountInfo.nickname || existing.nickname;
      existing.avatar = accountInfo.avatar || existing.avatar;
      existing.lastUsedAt = Date.now();
      saveGlobalStorage();
      return { success: true, accountId: existing.id, isNew: false };
    }
  }

  // 创建新账号
  const accountId = accountInfo.id || generateAccountId(platform);
  const newAccount = {
    id: accountId,
    nickname: accountInfo.nickname || '未命名账号',
    avatar: accountInfo.avatar || '',
    platformUid: accountInfo.platformUid || '',
    createdAt: Date.now(),
    lastUsedAt: Date.now()
  };

  platformAccounts[platform].push(newAccount);
  saveGlobalStorage();

  console.log('[Account Manager] ✅ 账号添加成功:', accountId);
  return { success: true, accountId, isNew: true };
});

// 删除账号
ipcMain.handle('remove-account', async (event, platform, accountId) => {
  console.log('[Account Manager] 删除账号:', platform, accountId);

  const platformAccounts = ensurePlatformAccounts();

  if (!platformAccounts[platform]) {
    return { success: false, error: '平台不存在' };
  }

  const index = platformAccounts[platform].findIndex(a => a.id === accountId);
  if (index === -1) {
    return { success: false, error: '账号不存在' };
  }

  // 从列表中移除
  platformAccounts[platform].splice(index, 1);
  saveGlobalStorage();

  // 删除对应的 session 数据
  await deleteAccountSession(platform, accountId);

  console.log('[Account Manager] ✅ 账号删除成功:', accountId);
  return { success: true };
});

// 更新账号信息
ipcMain.handle('update-account', async (event, platform, accountId, updates) => {
  console.log('[Account Manager] 更新账号:', platform, accountId, updates);

  const platformAccounts = ensurePlatformAccounts();

  if (!platformAccounts[platform]) {
    return { success: false, error: '平台不存在' };
  }

  const account = platformAccounts[platform].find(a => a.id === accountId);
  if (!account) {
    return { success: false, error: '账号不存在' };
  }

  // 更新允许的字段
  if (updates.nickname !== undefined) account.nickname = updates.nickname;
  if (updates.avatar !== undefined) account.avatar = updates.avatar;
  if (updates.platformUid !== undefined) account.platformUid = updates.platformUid;
  account.lastUsedAt = Date.now();

  saveGlobalStorage();

  console.log('[Account Manager] ✅ 账号更新成功:', accountId);
  return { success: true, account };
});

// 检查账号是否已存在（通过平台用户 ID 判断）
ipcMain.handle('account-exists', async (event, platform, platformUid) => {
  console.log('[Account Manager] 检查账号是否存在:', platform, platformUid);

  const platformAccounts = ensurePlatformAccounts();

  if (!platformAccounts[platform]) {
    return { exists: false };
  }

  const account = platformAccounts[platform].find(a => a.platformUid === platformUid);
  if (account) {
    console.log('[Account Manager] 账号已存在:', account.id);
    return { exists: true, accountId: account.id, account };
  }

  return { exists: false };
});

// 获取账号信息
ipcMain.handle('get-account', async (event, platform, accountId) => {
  console.log('[Account Manager] 获取账号信息:', platform, accountId);

  const platformAccounts = ensurePlatformAccounts();

  if (!platformAccounts[platform]) {
    return { success: false, error: '平台不存在' };
  }

  const account = platformAccounts[platform].find(a => a.id === accountId);
  if (!account) {
    return { success: false, error: '账号不存在' };
  }

  return { success: true, account };
});

// 窗口账号信息存储（用于窗口获取自己对应的账号）
const windowAccountMap = new Map();

// 获取当前窗口的账号信息
ipcMain.handle('get-current-account', async (event) => {
  try {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      return { success: false, error: '无法获取发送者窗口' };
    }

    const windowId = senderWindow.id;
    const accountInfo = windowAccountMap.get(windowId);

    if (!accountInfo) {
      return { success: false, error: '该窗口没有关联账号' };
    }

    // 获取完整账号信息
    const platformAccounts = ensurePlatformAccounts();
    const account = platformAccounts[accountInfo.platform]?.find(a => a.id === accountInfo.accountId);

    return {
      success: true,
      platform: accountInfo.platform,
      accountId: accountInfo.accountId,
      account: account || null
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 迁移临时 Session 到新账号
ipcMain.handle('migrate-to-new-account', async (event, platform, accountInfo) => {
  console.log('[Account Manager] 迁移到新账号:', platform, accountInfo);

  try {
    // 获取调用者的 session（临时 session）
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      return { success: false, error: '无法获取发送者窗口' };
    }

    const tempSession = senderWindow.webContents.session;

    // 检查账号是否已存在
    const platformAccounts = ensurePlatformAccounts();
    let accountId;
    let isNew = true;

    if (accountInfo.platformUid) {
      const existing = platformAccounts[platform]?.find(a => a.platformUid === accountInfo.platformUid);
      if (existing) {
        accountId = existing.id;
        isNew = false;
        // 更新现有账号信息
        existing.nickname = accountInfo.nickname || existing.nickname;
        existing.avatar = accountInfo.avatar || existing.avatar;
        existing.lastUsedAt = Date.now();
        console.log('[Account Manager] 账号已存在，更新并迁移到:', accountId);
      }
    }

    if (!accountId) {
      // 创建新账号
      accountId = generateAccountId(platform);
      const newAccount = {
        id: accountId,
        nickname: accountInfo.nickname || '未命名账号',
        avatar: accountInfo.avatar || '',
        platformUid: accountInfo.platformUid || '',
        createdAt: Date.now(),
        lastUsedAt: Date.now()
      };

      if (!platformAccounts[platform]) {
        platformAccounts[platform] = [];
      }
      platformAccounts[platform].push(newAccount);
      console.log('[Account Manager] 创建新账号:', accountId);
    }

    saveGlobalStorage();

    // 获取目标账号的 session
    const targetSession = getAccountSession(platform, accountId);

    // 获取临时 session 中的所有 cookies
    const tempCookies = await tempSession.cookies.get({});
    console.log(`[Account Manager] 临时 session 共有 ${tempCookies.length} 个 cookies`);

    // 确定要迁移的域名
    const platformDomains = {
      douyin: ['douyin.com'],
      xiaohongshu: ['xiaohongshu.com'],
      baijiahao: ['baidu.com'],
      weixin: ['weixin.qq.com', 'mp.weixin.qq.com'],
      shipinhao: ['channels.weixin.qq.com']
    };

    const domains = platformDomains[platform] || [];

    // 过滤并迁移 cookies
    const oneYearFromNow = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);
    let migratedCount = 0;

    for (const cookie of tempCookies) {
      const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
      const shouldMigrate = domains.some(d => cookieDomain.includes(d) || d.includes(cookieDomain));

      if (shouldMigrate) {
        try {
          const cookieUrl = `${cookie.secure ? 'https' : 'http'}://${cookieDomain}${cookie.path}`;
          const newCookie = {
            url: cookieUrl,
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite || 'no_restriction',
            expirationDate: cookie.expirationDate || oneYearFromNow
          };

          await targetSession.cookies.set(newCookie);
          migratedCount++;
        } catch (err) {
          console.error(`[Account Manager] 迁移 cookie 失败: ${cookie.name}`, err.message);
        }
      }
    }

    // 刷新到磁盘
    await targetSession.flushStorageData();

    console.log(`[Account Manager] ✅ 迁移完成: ${migratedCount} 个 cookies`);
    return { success: true, accountId, isNew, migratedCount };
  } catch (err) {
    console.error('[Account Manager] 迁移失败:', err);
    return { success: false, error: err.message };
  }
});

// 检查账号登录状态
ipcMain.handle('check-account-login-status', async (event, platform, accountId) => {
  console.log('[Account Manager] 检查账号登录状态:', platform, accountId);

  try {
    const accountSession = getAccountSession(platform, accountId);
    const cookies = await accountSession.cookies.get({});

    // 平台登录凭证 cookie 名称
    const loginCookies = {
      douyin: ['sessionid', 'sessionid_ss', 'passport_csrf_token', 'sid_guard', 'uid_tt', 'uid_tt_ss'],
      xiaohongshu: ['web_session', 'websectiga', 'sec_poison_id', 'a1', 'webId'],
      baijiahao: ['BDUSS', 'STOKEN', 'BAIDUID'],
      weixin: ['wxuin', 'pass_ticket', 'slave_user', 'slave_sid'],
      shipinhao: ['wxuin', 'pass_ticket']
    };

    const requiredCookies = loginCookies[platform] || [];
    const hasLoginCookie = cookies.some(c => requiredCookies.includes(c.name));

    console.log(`[Account Manager] ${platform}/${accountId} 登录状态: ${hasLoginCookie}`);
    return { success: true, isLoggedIn: hasLoginCookie, cookieCount: cookies.length };
  } catch (err) {
    console.error('[Account Manager] 检查登录状态失败:', err);
    return { success: false, error: err.message };
  }
});

// ========== 获取完整会话数据（Cookies + Storage + IndexedDB） ==========
// 用于授权后将完整登录状态存储到后台
ipcMain.handle('get-full-session-data', async (event, domain) => {
  console.log('[Session Data] ========== 获取完整会话数据 ==========');
  console.log('[Session Data] 域名:', domain);

  if (!domain) {
    return { success: false, error: '域名不能为空' };
  }

  try {
    // 获取调用者的 session
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    let ses;
    let webContents;

    if (senderWindow) {
      ses = senderWindow.webContents.session;
      webContents = senderWindow.webContents;
      console.log('[Session Data] 使用子窗口 session');
    } else if (browserView && !browserView.webContents.isDestroyed()) {
      ses = browserView.webContents.session;
      webContents = browserView.webContents;
      console.log('[Session Data] 使用 BrowserView session');
    } else {
      return { success: false, error: 'session 不可用' };
    }

    // 1. 获取 Cookies
    const allCookies = await ses.cookies.get({});
    const domainCookies = allCookies.filter(cookie => {
      const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
      return cookieDomain.includes(domain) || domain.includes(cookieDomain);
    });

    const cookiesArray = domainCookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      expirationDate: c.expirationDate
    }));

    console.log(`[Session Data] Cookies: ${cookiesArray.length} 个`);

    // 2. 获取 localStorage 和 sessionStorage（通过执行 JS）
    let storageData = { localStorage: {}, sessionStorage: {} };
    try {
      storageData = await webContents.executeJavaScript(`
        (function() {
          const result = { localStorage: {}, sessionStorage: {} };

          // 获取 localStorage
          try {
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              result.localStorage[key] = localStorage.getItem(key);
            }
          } catch (e) {
            console.error('获取 localStorage 失败:', e);
          }

          // 获取 sessionStorage
          try {
            for (let i = 0; i < sessionStorage.length; i++) {
              const key = sessionStorage.key(i);
              result.sessionStorage[key] = sessionStorage.getItem(key);
            }
          } catch (e) {
            console.error('获取 sessionStorage 失败:', e);
          }

          return result;
        })()
      `);
      console.log(`[Session Data] localStorage: ${Object.keys(storageData.localStorage).length} 项`);
      console.log(`[Session Data] sessionStorage: ${Object.keys(storageData.sessionStorage).length} 项`);
    } catch (err) {
      console.error('[Session Data] 获取 Storage 失败:', err.message);
    }

    // 3. 获取 IndexedDB 数据库列表和数据
    let indexedDBData = {};
    try {
      indexedDBData = await webContents.executeJavaScript(`
        (async function() {
          const result = {};

          try {
            // 获取所有数据库
            const databases = await indexedDB.databases();
            console.log('[IndexedDB] 发现数据库:', databases.length);

            for (const dbInfo of databases) {
              const dbName = dbInfo.name;
              if (!dbName) continue;

              try {
                const db = await new Promise((resolve, reject) => {
                  const request = indexedDB.open(dbName);
                  request.onsuccess = () => resolve(request.result);
                  request.onerror = () => reject(request.error);
                });

                const dbData = {
                  version: db.version,
                  stores: {}
                };

                // 遍历所有 object store
                const storeNames = Array.from(db.objectStoreNames);
                for (const storeName of storeNames) {
                  try {
                    const tx = db.transaction(storeName, 'readonly');
                    const store = tx.objectStore(storeName);
                    const allData = await new Promise((resolve, reject) => {
                      const request = store.getAll();
                      request.onsuccess = () => resolve(request.result);
                      request.onerror = () => reject(request.error);
                    });

                    // 限制数据量，避免数据过大
                    if (allData.length <= 1000) {
                      dbData.stores[storeName] = allData;
                    } else {
                      dbData.stores[storeName] = allData.slice(0, 1000);
                      dbData.stores[storeName + '_truncated'] = true;
                    }
                  } catch (storeErr) {
                    console.error('[IndexedDB] 读取 store 失败:', storeName, storeErr);
                  }
                }

                db.close();
                result[dbName] = dbData;
              } catch (dbErr) {
                console.error('[IndexedDB] 打开数据库失败:', dbName, dbErr);
              }
            }
          } catch (e) {
            console.error('[IndexedDB] 获取数据库列表失败:', e);
          }

          return result;
        })()
      `);
      console.log(`[Session Data] IndexedDB: ${Object.keys(indexedDBData).length} 个数据库`);
    } catch (err) {
      console.error('[Session Data] 获取 IndexedDB 失败:', err.message);
    }

    // 组装完整的会话数据
    const sessionData = {
      domain: domain,
      timestamp: Date.now(),
      cookies: cookiesArray,
      localStorage: storageData.localStorage,
      sessionStorage: storageData.sessionStorage,
      indexedDB: indexedDBData
    };

    // 计算数据大小（用于日志）
    const dataSize = JSON.stringify(sessionData).length;
    console.log(`[Session Data] ========== 获取完成 ==========`);
    console.log(`[Session Data] 总数据大小: ${Math.round(dataSize / 1024)} KB`);

    return { success: true, data: sessionData, size: dataSize };
  } catch (err) {
    console.error('[Session Data] 获取失败:', err);
    return { success: false, error: err.message };
  }
});

// ========== 恢复完整会话数据（Cookies + Storage + IndexedDB） ==========
// 用于发布时从后台获取的会话数据恢复到当前窗口
ipcMain.handle('restore-session-data', async (event, sessionDataStr) => {
  console.log('[Session Restore] ========== 开始恢复会话数据 ==========');

  if (!sessionDataStr) {
    return { success: false, error: '会话数据为空' };
  }

  try {
    // 解析会话数据
    let sessionData;
    try {
      sessionData = typeof sessionDataStr === 'string' ? JSON.parse(sessionDataStr) : sessionDataStr;
    } catch (parseErr) {
      return { success: false, error: '会话数据解析失败: ' + parseErr.message };
    }

    console.log('[Session Restore] 域名:', sessionData.domain);
    console.log('[Session Restore] 时间戳:', new Date(sessionData.timestamp).toLocaleString());

    // 获取调用者的 session 和 webContents
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    let ses;
    let webContents;

    if (senderWindow) {
      ses = senderWindow.webContents.session;
      webContents = senderWindow.webContents;
      console.log('[Session Restore] 使用子窗口 session');
    } else if (browserView && !browserView.webContents.isDestroyed()) {
      ses = browserView.webContents.session;
      webContents = browserView.webContents;
      console.log('[Session Restore] 使用 BrowserView session');
    } else {
      return { success: false, error: 'session 不可用' };
    }

    const results = {
      cookies: { restored: 0, failed: 0 },
      localStorage: { restored: 0, failed: 0 },
      sessionStorage: { restored: 0, failed: 0 },
      indexedDB: { restored: 0, failed: 0 }
    };

    // 1. 恢复 Cookies
    if (sessionData.cookies && Array.isArray(sessionData.cookies)) {
      console.log(`[Session Restore] 开始恢复 ${sessionData.cookies.length} 个 Cookies...`);

      for (const cookie of sessionData.cookies) {
        try {
          // 构建 cookie URL
          const protocol = cookie.secure ? 'https' : 'http';
          const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
          const url = `${protocol}://${domain}${cookie.path || '/'}`;

          const cookieDetails = {
            url: url,
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path || '/',
            secure: cookie.secure || false,
            httpOnly: cookie.httpOnly || false,
            sameSite: cookie.sameSite || 'no_restriction'
          };

          // 设置过期时间（如果有的话，否则设置为1年后）
          if (cookie.expirationDate) {
            cookieDetails.expirationDate = cookie.expirationDate;
          } else {
            cookieDetails.expirationDate = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
          }

          await ses.cookies.set(cookieDetails);
          results.cookies.restored++;
        } catch (cookieErr) {
          console.error(`[Session Restore] Cookie 恢复失败 (${cookie.name}):`, cookieErr.message);
          results.cookies.failed++;
        }
      }
      console.log(`[Session Restore] Cookies 恢复完成: ${results.cookies.restored} 成功, ${results.cookies.failed} 失败`);
    }

    // 2. 恢复 localStorage
    if (sessionData.localStorage && Object.keys(sessionData.localStorage).length > 0) {
      console.log(`[Session Restore] 开始恢复 ${Object.keys(sessionData.localStorage).length} 个 localStorage 项...`);

      try {
        const localStorageData = sessionData.localStorage;
        await webContents.executeJavaScript(`
          (function() {
            const data = ${JSON.stringify(localStorageData)};
            let restored = 0;
            let failed = 0;
            for (const [key, value] of Object.entries(data)) {
              try {
                localStorage.setItem(key, value);
                restored++;
              } catch (e) {
                console.error('localStorage 恢复失败:', key, e);
                failed++;
              }
            }
            return { restored, failed };
          })()
        `).then(result => {
          results.localStorage = result;
          console.log(`[Session Restore] localStorage 恢复完成: ${result.restored} 成功, ${result.failed} 失败`);
        });
      } catch (storageErr) {
        console.error('[Session Restore] localStorage 恢复失败:', storageErr.message);
      }
    }

    // 3. 恢复 sessionStorage
    if (sessionData.sessionStorage && Object.keys(sessionData.sessionStorage).length > 0) {
      console.log(`[Session Restore] 开始恢复 ${Object.keys(sessionData.sessionStorage).length} 个 sessionStorage 项...`);

      try {
        const sessionStorageData = sessionData.sessionStorage;
        await webContents.executeJavaScript(`
          (function() {
            const data = ${JSON.stringify(sessionStorageData)};
            let restored = 0;
            let failed = 0;
            for (const [key, value] of Object.entries(data)) {
              try {
                sessionStorage.setItem(key, value);
                restored++;
              } catch (e) {
                console.error('sessionStorage 恢复失败:', key, e);
                failed++;
              }
            }
            return { restored, failed };
          })()
        `).then(result => {
          results.sessionStorage = result;
          console.log(`[Session Restore] sessionStorage 恢复完成: ${result.restored} 成功, ${result.failed} 失败`);
        });
      } catch (storageErr) {
        console.error('[Session Restore] sessionStorage 恢复失败:', storageErr.message);
      }
    }

    // 4. 恢复 IndexedDB（复杂，可能需要页面刷新才能生效）
    if (sessionData.indexedDB && Object.keys(sessionData.indexedDB).length > 0) {
      console.log(`[Session Restore] 开始恢复 ${Object.keys(sessionData.indexedDB).length} 个 IndexedDB 数据库...`);

      try {
        const indexedDBData = sessionData.indexedDB;
        await webContents.executeJavaScript(`
          (async function() {
            const data = ${JSON.stringify(indexedDBData)};
            let restored = 0;
            let failed = 0;

            for (const [dbName, dbData] of Object.entries(data)) {
              try {
                // 打开数据库（使用保存的版本号）
                const db = await new Promise((resolve, reject) => {
                  const request = indexedDB.open(dbName, dbData.version || 1);

                  request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    // 创建 object stores
                    for (const storeName of Object.keys(dbData.stores || {})) {
                      if (!db.objectStoreNames.contains(storeName)) {
                        try {
                          db.createObjectStore(storeName, { autoIncrement: true });
                        } catch (e) {
                          console.warn('创建 object store 失败:', storeName, e);
                        }
                      }
                    }
                  };

                  request.onsuccess = () => resolve(request.result);
                  request.onerror = () => reject(request.error);
                });

                // 恢复数据到各个 object store
                for (const [storeName, storeData] of Object.entries(dbData.stores || {})) {
                  if (storeName.endsWith('_truncated')) continue;
                  if (!db.objectStoreNames.contains(storeName)) continue;

                  try {
                    const tx = db.transaction(storeName, 'readwrite');
                    const store = tx.objectStore(storeName);

                    // 清空现有数据
                    await new Promise((resolve, reject) => {
                      const clearReq = store.clear();
                      clearReq.onsuccess = resolve;
                      clearReq.onerror = reject;
                    });

                    // 写入保存的数据
                    for (const item of storeData) {
                      await new Promise((resolve, reject) => {
                        const addReq = store.add(item);
                        addReq.onsuccess = resolve;
                        addReq.onerror = () => resolve(); // 忽略单条失败
                      });
                    }

                    restored++;
                  } catch (storeErr) {
                    console.error('恢复 object store 失败:', storeName, storeErr);
                    failed++;
                  }
                }

                db.close();
              } catch (dbErr) {
                console.error('恢复数据库失败:', dbName, dbErr);
                failed++;
              }
            }

            return { restored, failed };
          })()
        `).then(result => {
          results.indexedDB = result;
          console.log(`[Session Restore] IndexedDB 恢复完成: ${result.restored} 成功, ${result.failed} 失败`);
        });
      } catch (idbErr) {
        console.error('[Session Restore] IndexedDB 恢复失败:', idbErr.message);
      }
    }

    console.log('[Session Restore] ========== 恢复完成 ==========');
    console.log('[Session Restore] 恢复统计:', results);

    return { success: true, results: results };
  } catch (err) {
    console.error('[Session Restore] 恢复失败:', err);
    return { success: false, error: err.message };
  }
});

// ========== 恢复账号会话数据（打开窗口之前调用） ==========
// 用于从后台获取的会话数据恢复到指定账号的 session
ipcMain.handle('restore-account-session', async (event, platform, accountId, sessionDataStr) => {
  console.log('[Account Session Restore] ========== 开始恢复账号会话数据 ==========');
  console.log('[Account Session Restore] 平台:', platform);
  console.log('[Account Session Restore] 账号ID:', accountId);

  if (!sessionDataStr) {
    return { success: false, error: '会话数据为空' };
  }

  try {
    // 解析会话数据
    let sessionData;
    try {
      sessionData = typeof sessionDataStr === 'string' ? JSON.parse(sessionDataStr) : sessionDataStr;
    } catch (parseErr) {
      return { success: false, error: '会话数据解析失败: ' + parseErr.message };
    }

    console.log('[Account Session Restore] 域名:', sessionData.domain);
    console.log('[Account Session Restore] 时间戳:', new Date(sessionData.timestamp).toLocaleString());

    // 获取账号对应的 session（格式：persist:accountId）
    const sessionPartition = `persist:${accountId}`;
    const targetSession = session.fromPartition(sessionPartition);
    console.log('[Account Session Restore] 目标 Session 分区:', sessionPartition);

    const results = {
      cookies: { restored: 0, failed: 0 },
      // localStorage 和 sessionStorage 需要在窗口打开后通过页面脚本恢复
      // 因为无法在窗口打开前注入 JavaScript 到特定域名的上下文
      localStorage: { restored: 0, failed: 0, skipped: true },
      sessionStorage: { restored: 0, failed: 0, skipped: true },
      indexedDB: { restored: 0, failed: 0, skipped: true }
    };

    // 1. 恢复 Cookies（可以在窗口打开前恢复）
    if (sessionData.cookies && Array.isArray(sessionData.cookies)) {
      console.log(`[Account Session Restore] 开始恢复 ${sessionData.cookies.length} 个 Cookies...`);

      for (const cookie of sessionData.cookies) {
        try {
          // 构建 cookie URL
          const protocol = cookie.secure ? 'https' : 'http';
          const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
          const url = `${protocol}://${domain}${cookie.path || '/'}`;

          const cookieDetails = {
            url: url,
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path || '/',
            secure: cookie.secure || false,
            httpOnly: cookie.httpOnly || false,
            sameSite: cookie.sameSite || 'no_restriction'
          };

          // 设置过期时间（如果有的话，否则设置为1年后）
          if (cookie.expirationDate) {
            cookieDetails.expirationDate = cookie.expirationDate;
          } else {
            cookieDetails.expirationDate = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
          }

          await targetSession.cookies.set(cookieDetails);
          results.cookies.restored++;
        } catch (cookieErr) {
          console.error(`[Account Session Restore] Cookie 恢复失败 (${cookie.name}):`, cookieErr.message);
          results.cookies.failed++;
        }
      }
      console.log(`[Account Session Restore] Cookies 恢复完成: ${results.cookies.restored} 成功, ${results.cookies.failed} 失败`);
    }

    console.log('[Account Session Restore] ========== 恢复完成 ==========');
    console.log('[Account Session Restore] 恢复统计:', results);
    console.log('[Account Session Restore] 提示: localStorage/sessionStorage/IndexedDB 需要在窗口打开后通过页面脚本恢复');

    return { success: true, results: results };
  } catch (err) {
    console.error('[Account Session Restore] 恢复失败:', err);
    return { success: false, error: err.message };
  }
});

// ========== 清空账号的所有 Cookies（窗口关闭前调用） ==========
// 用于清空发布窗口对应账号的登录状态
ipcMain.handle('clear-account-cookies', async (event, platform, accountId) => {
  console.log('[Clear Account Cookies] ========== 开始清空账号 Cookies ==========');
  console.log('[Clear Account Cookies] 平台:', platform);
  console.log('[Clear Account Cookies] 账号ID:', accountId);

  try {
    // 获取账号对应的 session
    const sessionPartition = `persist:${accountId}`;
    const targetSession = session.fromPartition(sessionPartition);
    console.log('[Clear Account Cookies] 目标 Session 分区:', sessionPartition);

    // 获取所有 cookies
    const cookies = await targetSession.cookies.get({});
    console.log(`[Clear Account Cookies] 找到 ${cookies.length} 个 cookies`);

    let deletedCount = 0;
    // 删除所有 cookies
    for (const cookie of cookies) {
      try {
        const protocol = cookie.secure ? 'https' : 'http';
        const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
        const url = `${protocol}://${domain}${cookie.path || '/'}`;
        await targetSession.cookies.remove(url, cookie.name);
        deletedCount++;
      } catch (err) {
        console.error(`[Clear Account Cookies] 删除失败 (${cookie.name}):`, err.message);
      }
    }

    console.log('[Clear Account Cookies] ========== 清空完成 ==========');
    console.log(`[Clear Account Cookies] 成功删除 ${deletedCount} 个 cookies`);

    return { success: true, deletedCount: deletedCount };
  } catch (err) {
    console.error('[Clear Account Cookies] 清空失败:', err);
    return { success: false, error: err.message };
  }
});

// ========== 手动保存会话数据到后台（开发调试用） ==========
// 让发布脚本可以在不关闭窗口的情况下保存最新 cookies
ipcMain.handle('save-session-to-backend', async (event) => {
  console.log('[Save Session] ========== 手动保存会话数据 ==========');

  try {
    // 获取调用者窗口
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      return { success: false, error: '无法获取发送者窗口' };
    }

    const windowId = senderWindow.id;
    console.log('[Save Session] 窗口ID:', windowId);

    // 检查是否是多账号模式的窗口
    const accountInfo = windowAccountMap.get(windowId);
    if (!accountInfo) {
      return { success: false, error: '该窗口没有关联账号（非多账号模式）' };
    }

    console.log('[Save Session] 平台:', accountInfo.platform, '账号ID:', accountInfo.accountId);

    // 获取发布数据中的账号信息
    const publishDataKey = `publish_data_window_${windowId}`;
    const publishData = globalStorage[publishDataKey];
    const backendAccountId = publishData?.element?.account_info?.id;

    // 优先从 element 获取配置，否则使用配置文件
    const saveSessionApi = publishData?.element?.saveSessionApi
      || publishData?.element?.save_session_api
      || config.platformApis[accountInfo.platform];

    // 从 element.cookies 提取 domain，否则使用配置文件
    let cookieDomains = config.platformDomains[accountInfo.platform] || [];
    const elementCookies = publishData?.element?.cookies;
    if (elementCookies) {
      try {
        const cookiesData = typeof elementCookies === 'string' ? JSON.parse(elementCookies) : elementCookies;
        if (cookiesData.domain) {
          cookieDomains = [cookiesData.domain];
          console.log('[Save Session] 从 element.cookies 提取 domain:', cookiesData.domain);
        }
      } catch (parseErr) {
        console.error('[Save Session] 解析 element.cookies 失败:', parseErr);
      }
    }

    if (!saveSessionApi) {
      return { success: false, error: '未找到保存接口配置' };
    }

    if (cookieDomains.length === 0) {
      return { success: false, error: '未找到 cookie domain 配置' };
    }

    if (!backendAccountId) {
      return { success: false, error: '未找到账号 ID（account_info.id）' };
    }

    // 获取该窗口 session 的最新 cookies
    const windowSession = senderWindow.webContents.session;
    const allCookies = await windowSession.cookies.get({});

    // 根据 domains 过滤 cookies
    const platformCookies = allCookies.filter(cookie => {
      const cd = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
      return cookieDomains.some(d => cd.includes(d) || d.includes(cd));
    });

    console.log(`[Save Session] 找到 ${platformCookies.length} 个平台相关 cookies (domains: ${cookieDomains.join(', ')})`);

    if (platformCookies.length === 0) {
      return { success: false, error: '未找到平台相关 cookies' };
    }

    // 转换为可序列化的格式
    const cookiesArray = platformCookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      expirationDate: c.expirationDate
    }));

    // 获取后台 API 域名（从 browserView 的 URL 获取，否则用配置文件默认值）
    let apiOrigin = config.apiBaseUrl;
    if (browserView && !browserView.webContents.isDestroyed()) {
      try {
        const mainUrl = browserView.webContents.getURL();
        const urlObj = new URL(mainUrl);
        if (urlObj.origin && !urlObj.origin.includes('file://')) {
          apiOrigin = urlObj.origin;
        }
      } catch (urlErr) {
        console.error('[Save Session] 解析主窗口 URL 失败:', urlErr);
      }
    }

    console.log('[Save Session] 后台 API 域名:', apiOrigin);
    console.log('[Save Session] 保存接口路径:', saveSessionApi);
    console.log('[Save Session] 账号 ID:', backendAccountId);

    // 调用后台接口保存 cookies（使用 Promise 包装）
    const postData = JSON.stringify({
      id: backendAccountId,
      cookies: JSON.stringify({ domain: cookieDomains[0], cookies: cookiesArray })
    });

    const apiUrl = new URL(`${apiOrigin}${saveSessionApi}`);
    const protocol = apiUrl.protocol === 'https:' ? https : http;

    const result = await new Promise((resolve, reject) => {
      const req = protocol.request({
        hostname: apiUrl.hostname,
        port: apiUrl.port || (apiUrl.protocol === 'https:' ? 443 : 80),
        path: apiUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('[Save Session] ✅ 会话数据已保存到后台, 响应:', data.substring(0, 200));
          resolve({ success: true, response: data, cookieCount: cookiesArray.length });
        });
      });

      req.on('error', (err) => {
        console.error('[Save Session] ❌ 保存会话数据到后台失败:', err.message);
        reject(err);
      });

      req.write(postData);
      req.end();
    });

    return result;
  } catch (err) {
    console.error('[Save Session] 保存失败:', err);
    return { success: false, error: err.message };
  }
});
