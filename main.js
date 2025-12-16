const { app, BrowserWindow, BrowserView, ipcMain, session, dialog, Menu, globalShortcut } = require('electron');
const path = require('path');
const ScriptManager = require('./script-manager');

let mainWindow;
let browserView;
let scriptManager;
let isQuitting = false; // 标记是否正在退出
let isScriptPanelOpen = false; // 跟踪脚本面板状态
const isProduction = app.isPackaged; // 是否生产环境
const HOME_URL = isProduction
  ? 'https://dev.china9.cn/aigc_browser/'
  : 'http://localhost:5173/';
const childWindows = []; // 跟踪所有打开的子窗口

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
  // 生产环境隐藏菜单栏
  if (isProduction) {
    Menu.setApplicationMenu(null);
  }

  // 创建主窗口
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false, // 先隐藏窗口，等内容准备好再显示
    autoHideMenuBar: isProduction, // 生产环境自动隐藏菜单栏
    backgroundColor: '#f2f7fa', // 设置背景色避免白闪
    icon: path.join(__dirname, 'icon.ico'), // 应用图标
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

  // 设置背景色避免白屏
  browserView.setBackgroundColor('#f2f7fa');

  mainWindow.setBrowserView(browserView);
  updateBrowserViewBounds();

  // 监听窗口大小变化
  mainWindow.on('resize', () => {
    updateBrowserViewBounds(isScriptPanelOpen);
  });

  // 直接加载首页，不再使用占位页（减少空白时间）
  browserView.webContents.loadURL(HOME_URL);

  // 脚本注入函数（提取为公共函数，可复用）
  const injectScriptForUrl = async (webContents, url) => {
    // 检查 webContents 是否已销毁
    if (!webContents || webContents.isDestroyed()) {
      return;
    }

    console.log('==================================================');
    console.log('[Script Injection] Checking URL:', url);

    // 注入对应的自定义脚本
    const script = await scriptManager.getScript(url);

    if (script) {
      // 再次检查（异步操作后可能已销毁）
      if (webContents.isDestroyed()) {
        return;
      }
      console.log('[Script Injection] Script found! Length:', script.length);
      console.log('[Script Injection] Preview:', script.substring(0, 100) + '...');
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
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send('url-changed', currentURL);
    await injectScriptForUrl(browserView.webContents, currentURL);
  };

  // 监听页面导航开始
  browserView.webContents.on('did-start-navigation', (event, url) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('url-changed', url);
  });

  // 监听页面导航完成
  browserView.webContents.on('did-navigate', (event, url) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('url-changed', url);
  });

  // 监听页面内导航（如 hash 变化）- 单页应用路由切换
  browserView.webContents.on('did-navigate-in-page', async (event, url) => {
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
  // 生产环境不需要工具栏空间，开发环境为工具栏留出 60px
  const toolbarHeight = isProduction ? 0 : 60;
  const viewWidth = scriptPanelOpen ? width - 400 : width;
  browserView.setBounds({ x: 0, y: toolbarHeight, width: viewWidth, height: height - toolbarHeight });
}

app.whenReady().then(() => {
  console.log('=================================');
  console.log('应用启动 - Cookie 持久化已启用');
  console.log('=================================');

  // 初始化脚本管理器
  // 生产环境使用 app.asar.unpacked 路径，开发环境使用 __dirname
  let scriptsBaseDir = __dirname;
  if (app.isPackaged) {
    scriptsBaseDir = __dirname.replace('app.asar', 'app.asar.unpacked');
  }
  console.log('Scripts base dir:', scriptsBaseDir);
  scriptManager = new ScriptManager(scriptsBaseDir);

  createWindow();

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

        await ses.clearStorageData({
          storages: ['cookies', 'localstorage', 'sessionstorage']
        });

        const cookiesAfter = await ses.cookies.get({});
        console.log(`[Clear Cookies] 清除后有 ${cookiesAfter.length} 个 cookies`);
        console.log('[Clear Cookies] ✅ 已清除所有登录状态');

        await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: '清除成功',
          message: '已清除所有网站的登录状态',
          detail: `删除了 ${cookiesBefore.length} 个 cookies`,
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

      const inputWindow = new BrowserWindow({
        width: 500,
        height: 220,
        parent: mainWindow,
        modal: true,
        show: false,
        autoHideMenuBar: true,
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
        await ses.flushStorageData();
        console.log('Auto-saved session data');
      } catch (err) {
        console.error('Auto-save error:', err);
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
  console.log('[IPC] HOME_URL:', HOME_URL);

  // 向 BrowserView 中的首页发送消息
  if (browserView) {
    browserView.webContents.executeJavaScript(`
      (function() {
        const homeUrl = '${HOME_URL}';
        const currentUrl = window.location.href;
        const isHome = currentUrl.startsWith(homeUrl);
        console.log('[Main] HOME_URL:', homeUrl);
        console.log('[Main] currentUrl:', currentUrl);
        console.log('[Main] isHome:', isHome);
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
