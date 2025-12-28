const { app, BrowserWindow, BrowserView, ipcMain, session, dialog, Menu, globalShortcut, nativeImage, Tray, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const ScriptManager = require('./script-manager');

let mainWindow;
let browserView;
let scriptManager;
let isQuitting = false; // 标记是否正在退出
let isScriptPanelOpen = false; // 跟踪脚本面板状态
const isProduction = app.isPackaged; // 是否生产环境
let tray = null; // 托盘图标对象

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
    const portableDataPath = path.join(process.env.LOCALAPPDATA || app.getPath('appData'), '运营助手-Portable');

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

// 首页地址（开发和生产环境都使用登录页）
const HOME_URL = LOGIN_URL;

console.log('[Config] LOGIN_URL:', LOGIN_URL);

// 所有可能的首页地址（用于消息路由判断）
const HOME_URLS = [
  'http://localhost:5173/',
  'https://dev.china9.cn/aigc_browser/',
  'http://172.16.6.17:8080/',
  'https://jzt_dev_1.china9.cn/jzt_all/#/geo/index',
  'https://zhjzt.china9.cn/jzt_all/#/geo/index',
  LOGIN_URL  // 登录页也作为首页处理
];

// 判断 URL 是否为首页
function isHomeUrl(url) {
  return HOME_URLS.some(homeUrl => url.startsWith(homeUrl));
}

const childWindows = []; // 跟踪所有打开的子窗口

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

function createWindow() {
  // 使用 nativeImage 创建图标（支持高 DPI）
  const appIcon = nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));

  // 创建主窗口
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: '运营助手',
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

  // 获取或创建持久化 session
  const persistentSession = session.fromPartition('persist:browserview', { cache: true });

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
      session: persistentSession // 直接使用 session 对象
    }
  });

  // 设置背景色避免白屏
  browserView.setBackgroundColor('#f2f7fa');

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
          url: 'https://china9.cn',
          name: 'token',
          value: savedToken,
          domain: '.china9.cn',
          path: '/',
          expirationDate: savedExpires,
          secure: true
        });
        await ses.cookies.set({
          url: 'https://china9.cn',
          name: 'access_token',
          value: savedToken,
          domain: '.china9.cn',
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
            url: 'https://china9.cn',
            name: 'gcc',
            value: globalStorage.login_gcc,
            domain: '.china9.cn',
            path: '/',
            expirationDate: savedExpires,
            secure: true
          });
        }

        await ses.flushStorageData();
        console.log('[BrowserView] ✅ 登录状态已恢复');

        // 根据环境选择首页
        startUrl = isProduction
          ? 'https://dev.china9.cn/aigc_browser/'
          : 'http://localhost:5173/';

        console.log('[BrowserView] 将跳转到首页:', startUrl);
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

    browserView.webContents.loadURL(startUrl)
      .then(() => {
        console.log('[BrowserView] ✅ 页面 loadURL 调用成功');
      })
      .catch(err => {
        console.error('[BrowserView] ❌ 页面加载失败:', err);
        // 失败后3秒重试一次
        setTimeout(() => {
          console.log('[BrowserView] 🔄 3秒后重试加载...');
          browserView.webContents.loadURL(startUrl).catch(e => {
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

  // 监听页面导航开始
  browserView.webContents.on('did-start-navigation', (event, url) => {
    console.log(`[Navigation] 导航开始 → ${url}`);
    // 不在这里发送 url-changed，避免重复触发

    // 在导航开始时注入预防性隐藏脚本
    if (browserView && !browserView.webContents.isDestroyed()) {
      browserView.webContents.executeJavaScript(preHideScript).catch(() => {});
    }
  });

  // 监听页面导航完成
  browserView.webContents.on('did-navigate', (event, url) => {
    console.log(`[Navigation] 导航完成 → ${url}`);
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('url-changed', url);
  });

  // 页面异常检测脚本（在 dom-ready 时尽早执行）
  const earlyPageCheckScript = `
    (function() {
      // 延迟一小段时间等待内容渲染
      setTimeout(() => {
        if (!document.body) return;

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

  // 在 dom-ready 时尽早检测页面状态（比 did-finish-load 更早）
  browserView.webContents.on('dom-ready', () => {
    console.log('[Navigation] DOM Ready，执行早期页面检测...');
    if (browserView && !browserView.webContents.isDestroyed()) {
      browserView.webContents.executeJavaScript(earlyPageCheckScript).catch(() => {});
    }
  });

  // 监听页面内导航（如 hash 变化）- 单页应用路由切换
  browserView.webContents.on('did-navigate-in-page', async (event, url) => {
    console.log(`[Navigation] 页面内跳转 → ${url}`);
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('url-changed', url);
    console.log('[SPA Navigation] Hash/path changed, injecting script...');
    // 单页应用路由切换时也需要注入脚本
    await injectScriptForCurrentPage();
  });

  // 监听页面加载完成，注入自定义脚本
  browserView.webContents.on('did-finish-load', injectScriptForCurrentPage);

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
          session: browserView.webContents.session // 使用相同的 session
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

    // 监听子窗口导航开始（用于调试和预防性隐藏）
    newWindow.webContents.on('did-start-navigation', (event, url, isInPlace, isMainFrame) => {
      console.log('[New Window Navigation] 导航开始:', url, 'isMainFrame:', isMainFrame);
      if (url && url.toLowerCase().startsWith('bitbrowser:')) {
        console.log('[New Window Navigation] ⚠️ 检测到 bitbrowser 协议导航!');
      }
      // 在导航开始时注入预防性隐藏脚本
      if (newWindow && !newWindow.isDestroyed() && !newWindow.webContents.isDestroyed()) {
        newWindow.webContents.executeJavaScript(preHideScript).catch(() => {});
      }
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
            session: browserView.webContents.session
          }
        }
      };
    });

    // 忽略页面的 beforeunload 事件，允许直接关闭窗口
    newWindow.webContents.on('will-prevent-unload', (event) => {
      console.log('[Window Manager] 忽略页面的 beforeunload 事件，强制关闭窗口');
      event.preventDefault();
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

    // 新窗口也添加早期页面检测（dom-ready 时执行）
    newWindow.webContents.on('dom-ready', () => {
      console.log('[New Window] DOM Ready，执行早期页面检测...');
      if (newWindow && !newWindow.isDestroyed() && !newWindow.webContents.isDestroyed()) {
        newWindow.webContents.executeJavaScript(earlyPageCheckScript).catch(() => {});
      }
    });

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

function updateBrowserViewBounds(scriptPanelOpen = false) {
  const { width, height } = mainWindow.getContentBounds();
  // 公共头部高度 50px（始终显示）
  // 开发环境额外为工具栏留出 60px
  const headerHeight = 50;
  const toolbarHeight = isProduction ? 0 : 60;
  const totalTopOffset = headerHeight + toolbarHeight;
  const viewWidth = scriptPanelOpen ? width - 400 : width;
  browserView.setBounds({ x: 0, y: totalTopOffset, width: viewWidth, height: height - totalTopOffset });
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
    const douyinLoggedIn = douyinCookies.some(c =>
      c.name === 'sessionid' ||
      c.name === 'sessionid_ss' ||
      c.name === 'passport_csrf_token' ||
      c.name === 'sid_guard' ||
      c.name === 'uid_tt' ||
      c.name === 'uid_tt_ss'
    );

    const xiaohongshuLoggedIn = xiaohongshuCookies.some(c =>
      c.name === 'web_session' ||
      c.name === 'websectiga' ||
      c.name === 'sec_poison_id'
    );

    const weixinLoggedIn = weixinCookies.some(c =>
      c.name === 'wxuin' ||
      c.name === 'pass_ticket'
    );

    const baijiahaoLoggedIn = baijiahaoCookies.some(c =>
      c.name === 'BDUSS' ||
      c.name === 'STOKEN'
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

// 导航到指定 URL
ipcMain.handle('navigate-to', async (event, url) => {
  if (browserView) {
    browserView.webContents.loadURL(url);
  }
});

// 导航到登录页
ipcMain.handle('navigate-to-login', async () => {
  if (browserView) {
    const loginPath = path.join(__dirname, 'login.html');
    const loginUrl = `file://${loginPath}`;
    console.log('[Main] 导航到登录页:', loginUrl);
    browserView.webContents.loadURL(loginUrl);
  }
});

// 刷新页面
ipcMain.handle('refresh-page', async () => {
  if (browserView) {
    browserView.webContents.reload();
  }
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
    const menuWidth = 220;
    const menuHeight = Math.min(sites.length * 48 + 16, 320);

    // 计算菜单位置：右上角，header 下方
    const menuX = contentBounds.x + contentBounds.width - menuWidth - 10;
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

    // 生成菜单 HTML
    const sitesJson = JSON.stringify(sites);
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
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
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
          const currentSiteId = ${currentSiteId};

          const menu = document.getElementById('menu');
          sites.forEach(site => {
            const item = document.createElement('div');
            item.className = 'menu-item' + (site.id === currentSiteId ? ' active' : '');
            item.innerHTML = \`
              <div class="site-icon">\${site.shortName ? site.shortName.charAt(0) : site.name.charAt(0)}</div>
              <span class="site-name">\${site.name}</span>
              <svg class="check-icon" viewBox="0 0 1024 1024" fill="#409EFF">
                <path d="M912 190h-69.9c-9.8 0-19.1 4.5-25.1 12.2L404.7 724.5 207 474a32 32 0 0 0-25.1-12.2H112c-6.7 0-10.4 7.7-6.3 12.9l273.9 347c12.8 16.2 37.4 16.2 50.3 0l488.4-618.9c4.1-5.1.4-12.8-6.3-12.8z"/>
              </svg>
            \`;
            item.onclick = () => {
              ipcRenderer.send('site-selected', site.id, site.name);
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

// 从内容页面打开新窗口（始终创建新窗口，不受模式影响）
ipcMain.handle('open-new-window', async (event, url) => {
  if (!url) {
    return { success: false, error: 'No URL provided' };
  }

  try {
    const appIcon = nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));

    const newWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      icon: appIcon, // 使用 nativeImage 加载的图标
      webPreferences: {
        preload: path.join(__dirname, 'content-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        session: browserView.webContents.session // 使用相同的 session
      }
    });

    // 添加到子窗口列表
    childWindows.push(newWindow);
    console.log('[Window Manager] 新窗口已添加，当前窗口数量:', childWindows.length);

    // 忽略页面的 beforeunload 事件，允许直接关闭窗口
    newWindow.webContents.on('will-prevent-unload', (event) => {
      console.log('[Window Manager] 忽略页面的 beforeunload 事件，强制关闭窗口');
      event.preventDefault();
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

    // 为新窗口添加脚本注入
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

      await scriptManager.getScript(currentURL).then(async (script) => {
        if (script) {
          console.log('[New Window API] Injecting script...');
          try {
            await newWindow.webContents.executeJavaScript(script);
            console.log('[New Window API] Script injected successfully');
          } catch (err) {
            console.error('[New Window API] Script injection error:', err);
          }
        }
      });
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
    });

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

// ========== 清除指定域名的 Cookies ==========
ipcMain.handle('clear-domain-cookies', async (event, domain) => {
  console.log('[Clear Cookies] ========== API 调用 ==========');
  console.log('[Clear Cookies] 请求清除域名:', domain);

  if (!domain) {
    return { success: false, error: '域名不能为空' };
  }

  if (browserView && !browserView.webContents.isDestroyed()) {
    try {
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

      return { success: true, deletedCount };
    } catch (err) {
      console.error('[Clear Cookies] 清除失败:', err);
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: 'BrowserView 不可用' };
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
