const { app, BrowserWindow, BrowserView, ipcMain, session, dialog } = require('electron');
const path = require('path');
const ScriptManager = require('./script-manager');

let mainWindow;
let browserView;
let scriptManager;
let isQuitting = false; // 标记是否正在退出
let isScriptPanelOpen = false; // 跟踪脚本面板状态
const HOME_URL = 'http://localhost:5173/';
const childWindows = []; // 跟踪所有打开的子窗口

function createWindow() {
  // 创建主窗口
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  // 为主窗口打开开发者工具（用于调试控制面板）
  // mainWindow.webContents.openDevTools();

  // 加载浏览器控制界面
  mainWindow.loadFile('index.html');

  // 监听窗口即将关闭事件，保存 session 数据
  mainWindow.on('close', async (e) => {
    if (!isQuitting) {
      e.preventDefault();
      isQuitting = true;

      console.log('Window closing, saving session data...');

      if (browserView) {
        try {
          const ses = browserView.webContents.session;
          const cookies = await ses.cookies.get({});
          console.log(`Saving ${cookies.length} cookies before close`);

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

          console.log(`Converted ${convertedCount} session cookies to persistent cookies`);

          await ses.flushStorageData();
          console.log('Session data saved successfully');
        } catch (err) {
          console.error('Error saving session data:', err);
        }
      }

      setTimeout(() => {
        mainWindow.destroy();
      }, 200); // 给更多时间确保数据写入磁盘
    }
  });

  // 获取或创建持久化 session
  const persistentSession = session.fromPartition('persist:browserview', { cache: true });

  // 打印 session 存储路径
  console.log('Session storage path:', app.getPath('userData'));
  console.log('Session partition:', persistentSession.getStoragePath());

  // 设置自定义 User-Agent（保持标准格式，避免某些网站解析错误）
  const customUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 zh.Cloud-browse/1.0';
  persistentSession.setUserAgent(customUA);
  console.log('User-Agent set to:', customUA);

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

  mainWindow.setBrowserView(browserView);
  updateBrowserViewBounds();

  // 监听窗口大小变化
  mainWindow.on('resize', () => {
    updateBrowserViewBounds(isScriptPanelOpen);
  });

  // 加载首页
  browserView.webContents.loadURL(HOME_URL);

  // 脚本注入函数（提取为公共函数，可复用）
  const injectScriptForUrl = async (webContents, url) => {
    console.log('==================================================');
    console.log('[Script Injection] Checking URL:', url);

    // 注入对应的自定义脚本
    const script = await scriptManager.getScript(url);

    if (script) {
      console.log('[Script Injection] Script found! Length:', script.length);
      console.log('[Script Injection] Preview:', script.substring(0, 100) + '...');
      console.log('✅ [Script Injection] Executing...');
      try {
        const result = await webContents.executeJavaScript(script);
        console.log('✅ [Script Injection] Script executed successfully!');
        console.log('[Script Injection] Execution result:', result);
      } catch (err) {
        console.error('❌ [Script Injection] Script execution error:', err);
      }
    } else {
      // 没有脚本时，只显示简单的调试信息
      console.log('ℹ️ [Script Injection] No script configured for this URL');
    }
    console.log('==================================================');
  };

  // BrowserView 的脚本注入函数
  const injectScriptForCurrentPage = async () => {
    const currentURL = browserView.webContents.getURL();
    mainWindow.webContents.send('url-changed', currentURL);
    await injectScriptForUrl(browserView.webContents, currentURL);
  };

  // 监听页面导航开始
  browserView.webContents.on('did-start-navigation', (event, url) => {
    mainWindow.webContents.send('url-changed', url);
  });

  // 监听页面导航完成
  browserView.webContents.on('did-navigate', (event, url) => {
    mainWindow.webContents.send('url-changed', url);
  });

  // 监听页面内导航（如 hash 变化）- 单页应用路由切换
  browserView.webContents.on('did-navigate-in-page', async (event, url) => {
    mainWindow.webContents.send('url-changed', url);
    console.log('[SPA Navigation] Hash/path changed, injecting script...');
    // 单页应用路由切换时也需要注入脚本
    await injectScriptForCurrentPage();
  });

  // 监听页面加载完成，注入自定义脚本
  browserView.webContents.on('did-finish-load', injectScriptForCurrentPage);

  // 监听新窗口请求 - 默认行为：总是打开新窗口（类似正常浏览器）
  browserView.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[Window Open] Opening new window for:', url);

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

    // 监听窗口关闭事件
    newWindow.on('closed', () => {
      const index = childWindows.indexOf(newWindow);
      if (index > -1) {
        childWindows.splice(index, 1);
        console.log('[Window Manager] 窗口已关闭，当前窗口数量:', childWindows.length);
      }
    });

    // 自动打开 DevTools
    newWindow.webContents.openDevTools();

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
  // 为工具栏留出 60px 的空间，如果脚本面板打开，则右侧留出 400px 空间
  const viewWidth = scriptPanelOpen ? width - 400 : width;
  browserView.setBounds({ x: 0, y: 60, width: viewWidth, height: height - 60 });
}

app.whenReady().then(() => {
  console.log('=================================');
  console.log('应用启动 - Cookie 持久化已启用');
  console.log('=================================');

  // 初始化脚本管理器
  scriptManager = new ScriptManager(__dirname);

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      isQuitting = false; // 重置标志
      createWindow();
    }
  });

  // 定期保存 session 数据（每 30 秒）
  const saveInterval = setInterval(async () => {
    if (browserView) {
      try {
        const ses = browserView.webContents.session;
        await ses.flushStorageData();
        console.log('Auto-saved session data');
      } catch (err) {
        console.error('Auto-save error:', err);
      }
    }
  }, 30000);
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC 处理程序

// 导航到指定 URL
ipcMain.handle('navigate-to', async (event, url) => {
  if (browserView) {
    browserView.webContents.loadURL(url);
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

  // 向 BrowserView 中的首页发送消息
  if (browserView) {
    browserView.webContents.executeJavaScript(`
      (function() {
        const isHome = window.location.href === '${HOME_URL}' || window.location.href.startsWith('${HOME_URL}#');
        console.log('[Main] 检查是否为首页:', window.location.href, 'isHome:', isHome);
        if (isHome) {
          console.log('[Main] 向首页发送消息:', ${JSON.stringify(message)});
          window.postMessage({ type: 'FROM_OTHER_PAGE', data: ${JSON.stringify(message)} }, '*');
        }
      })();
    `).catch(err => console.error('[Main] Failed to send message to home (BrowserView):', err));
  }
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
        const isHome = window.location.href === '${HOME_URL}' || window.location.href.startsWith('${HOME_URL}#');
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

// 从内容页面打开新窗口（始终创建新窗口，不受模式影响）
ipcMain.handle('open-new-window', async (event, url) => {
  if (!url) {
    return { success: false, error: 'No URL provided' };
  }

  try {
    const newWindow = new BrowserWindow({
      width: 1200,
      height: 800,
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

    // 监听窗口关闭事件
    newWindow.on('closed', () => {
      const index = childWindows.indexOf(newWindow);
      if (index > -1) {
        childWindows.splice(index, 1);
        console.log('[Window Manager] 窗口已关闭，当前窗口数量:', childWindows.length);
      }
    });

    // 自动打开 DevTools
    newWindow.webContents.openDevTools();

    // 为新窗口添加脚本注入
    newWindow.webContents.on('did-finish-load', async () => {
      const currentURL = newWindow.webContents.getURL();
      console.log('[New Window API] Page loaded:', currentURL);
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
    return { success: true };
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
  try {
    // 查找发送请求的窗口
    const senderWindow = BrowserWindow.fromWebContents(event.sender);

    // 如果是主窗口，拒绝关闭
    if (senderWindow === mainWindow) {
      console.log('[Window Manager] 拒绝关闭主窗口');
      return { success: false, error: 'Cannot close main window' };
    }

    // 如果是子窗口，关闭它
    if (senderWindow && !senderWindow.isDestroyed()) {
      console.log('[Window Manager] 关闭子窗口');
      senderWindow.close();
      return { success: true };
    }

    return { success: false, error: 'No window to close' };
  } catch (err) {
    console.error('[Window Manager] 关闭窗口失败:', err);
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
