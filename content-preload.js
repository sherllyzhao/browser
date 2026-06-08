const { contextBridge, ipcRenderer, webFrame } = require('electron');

// 🩹 软件渲染回退标志：由主进程通过 webPreferences.additionalArguments 注入。
// 仅 Win7/8 与 Win10 1607/LTSB 老驱动测试机启用视频号发布页白屏巡检兜底。
const __IS_LEGACY_WINDOWS__ = (() => {
  try {
    return Array.isArray(process.argv) && process.argv.some(arg => String(arg).includes('--yyzs-legacy-windows'));
  } catch (_) {
    return false;
  }
})();

function isChina9Host(hostname = '') {
  const host = String(hostname || '').toLowerCase();
  return host === 'china9.cn' || host.endsWith('.china9.cn');
}

function injectMainWorldScript(scriptSource, logTag) {
  try {
    webFrame.executeJavaScript(scriptSource, true).catch((err) => {
      console.warn(`${logTag} 注入失败:`, err && err.message ? err.message : err);
    });
  } catch (err) {
    console.warn(`${logTag} 初始化失败:`, err && err.message ? err.message : err);
  }
}

function isShipinhaoPublishUrl(rawUrl = '') {
  try {
    const parsed = new URL(rawUrl);
    return String(parsed.hostname || '').toLowerCase() === 'channels.weixin.qq.com'
      && String(parsed.pathname || '').toLowerCase().includes('/platform/post/create');
  } catch (_) {
    return String(rawUrl || '').toLowerCase().includes('channels.weixin.qq.com/platform/post/create');
  }
}

// 修复授权回调脚本写死 dev.china9.cn，但父页面实际在 www.china9.cn 时的 postMessage targetOrigin 报错。
// 补丁安装在 china9 父页面，子窗口调用 opener.postMessage 时会优先命中父页面的 postMessage 方法。
(function installChina9PostMessageTargetOriginShim() {
  try {
    const currentUrl = new URL(window.location.href);
    if (!isChina9Host(currentUrl.hostname)) {
      return;
    }

    injectMainWorldScript(`
      (function() {
        if (window.__china9PostMessageTargetOriginShimInstalled) return;
        window.__china9PostMessageTargetOriginShimInstalled = true;

        const currentOrigin = window.location.origin;
        const isChina9Origin = (origin) => {
          try {
            const parsed = new URL(origin);
            const host = String(parsed.hostname || '').toLowerCase();
            return parsed.protocol === 'https:' && (host === 'china9.cn' || host.endsWith('.china9.cn'));
          } catch (_) {
            return false;
          }
        };

        if (!isChina9Origin(currentOrigin)) {
          return;
        }

        const nativePostMessage = Window.prototype.postMessage;
        if (typeof nativePostMessage !== 'function') {
          return;
        }

        const getTargetOrigin = (targetOriginOrOptions) => {
          if (typeof targetOriginOrOptions === 'string') return targetOriginOrOptions;
          if (targetOriginOrOptions && typeof targetOriginOrOptions === 'object') {
            return typeof targetOriginOrOptions.targetOrigin === 'string'
              ? targetOriginOrOptions.targetOrigin
              : '';
          }
          return '';
        };

        const withTargetOrigin = (args, origin) => {
          const nextArgs = Array.prototype.slice.call(args);
          if (nextArgs[1] && typeof nextArgs[1] === 'object' && typeof nextArgs[1].targetOrigin === 'string') {
            nextArgs[1] = { ...nextArgs[1], targetOrigin: origin };
          } else {
            nextArgs[1] = origin;
          }
          return nextArgs;
        };

        const extractRecipientOrigin = (message) => {
          const match = String(message || '').match(/recipient window's origin \\('([^']+)'\\)/);
          return match ? match[1] : '';
        };

        Window.prototype.postMessage = function() {
          try {
            return nativePostMessage.apply(this, arguments);
          } catch (error) {
            const message = error && error.message ? error.message : String(error || '');
            const requestedOrigin = getTargetOrigin(arguments[1]);
            const recipientOrigin = extractRecipientOrigin(message);
            const canRetry = message.includes("Failed to execute 'postMessage'")
              && message.includes('target origin')
              && isChina9Origin(requestedOrigin)
              && isChina9Origin(recipientOrigin);

            if (!canRetry) {
              throw error;
            }

            console.warn('[China9 postMessage shim] targetOrigin 已按 recipient origin 修正:', {
              from: requestedOrigin,
              to: recipientOrigin
            });
            return nativePostMessage.apply(this, withTargetOrigin(arguments, recipientOrigin));
          }
        };

        console.log('[China9 postMessage shim] 已启用');
      })();
    `, '[China9 postMessage shim]');
  } catch (err) {
    console.warn('[China9 postMessage shim] 初始化失败:', err && err.message ? err.message : err);
  }
})();

// 授权回调页兜底：即使第三方页面自己的 opener.postMessage 失败，也通过 Electron IPC 通知首页刷新。
(function notifyHomeOnMediaAuthCallback() {
  try {
    const currentUrl = new URL(window.location.href);
    if (!isChina9Host(currentUrl.hostname)
      || !currentUrl.pathname.toLowerCase().startsWith('/api/mediaauth/')) {
      return;
    }

    const isTargetOriginError = (value) => {
      const text = value && value.message ? value.message : String(value || '');
      return text.includes("Failed to execute 'postMessage'")
        && text.includes('target origin')
        && text.includes('china9.cn');
    };

    window.addEventListener('error', (event) => {
      if (isTargetOriginError(event.error) || isTargetOriginError(event.message)) {
        event.preventDefault();
        console.warn('[MediaAuth callback] preload 已阻止 postMessage targetOrigin 报错冒泡');
      }
    }, true);

    window.addEventListener('unhandledrejection', (event) => {
      if (isTargetOriginError(event.reason)) {
        event.preventDefault();
        console.warn('[MediaAuth callback] preload 已阻止 postMessage targetOrigin Promise 报错冒泡');
      }
    }, true);

    injectMainWorldScript(`
      (function() {
        if (window.__mediaAuthPostMessageErrorSilencerInstalled) return;
        window.__mediaAuthPostMessageErrorSilencerInstalled = true;

        const isTargetOriginError = (value) => {
          const text = value && value.message ? value.message : String(value || '');
          return text.includes("Failed to execute 'postMessage'")
            && text.includes('target origin')
            && text.includes('china9.cn');
        };

        const previousOnError = window.onerror;
        window.onerror = function(message, source, lineno, colno, error) {
          if (isTargetOriginError(error) || isTargetOriginError(message)) {
            console.warn('[MediaAuth callback] 已忽略已兜底处理的 postMessage targetOrigin 报错');
            return true;
          }

          if (typeof previousOnError === 'function') {
            return previousOnError.apply(this, arguments);
          }

          return false;
        };

        window.addEventListener('error', function(event) {
          if (isTargetOriginError(event.error) || isTargetOriginError(event.message)) {
            event.preventDefault();
            console.warn('[MediaAuth callback] 已阻止 postMessage targetOrigin 报错冒泡');
          }
        }, true);

        window.addEventListener('unhandledrejection', function(event) {
          if (isTargetOriginError(event.reason)) {
            event.preventDefault();
            console.warn('[MediaAuth callback] 已阻止 postMessage targetOrigin Promise 报错冒泡');
          }
        }, true);
      })();
    `, '[MediaAuth callback]');

    const hasSuccessMarker = currentUrl.searchParams.has('code')
      || currentUrl.searchParams.get('response_type') === 'code';
    if (!hasSuccessMarker) {
      return;
    }

    setTimeout(() => {
      try {
        ipcRenderer.send('content-to-home', '授权成功，刷新数据');
        console.log('[MediaAuth callback] 已通过 IPC 通知首页刷新');
      } catch (err) {
        console.warn('[MediaAuth callback] IPC 通知失败:', err && err.message ? err.message : err);
      }
    }, 0);
  } catch (err) {
    console.warn('[MediaAuth callback] 初始化失败:', err && err.message ? err.message : err);
  }
})();

// 🎭 SPA 加载白屏遮罩 - 盖住第三方页面 SPA 自然加载期（约 500ms）的白屏
// 仅对第三方平台生效，跳过本地页和登录页（避免遮挡二维码）
(function injectLoadingMask() {
  try {
    const url = String(window.location.href || '');
    const isLocalPage = url.startsWith('file://')
      || url.includes('localhost:5173')
      || url.startsWith('about:')
      || url.startsWith('data:');
    if (isLocalPage) return;

    // 跳过登录类页面，避免覆盖扫码二维码
    const lowerUrl = url.toLowerCase();
    if (isShipinhaoPublishUrl(url)) {
      return;
    }

    const LOGIN_PATTERNS = ['/login', '/userauth', '/userlogin', '/loginpage', '/cgi-bin/login', 'passport.', '/sso/', '/auth/', '/signin'];
    if (LOGIN_PATTERNS.some(p => lowerUrl.includes(p))) return;

    const MASK_ID = '__yyzs_preload_loading_mask__';

    function ensureMask() {
      if (document.getElementById(MASK_ID)) return;
      const root = document.documentElement;
      if (!root) return;
      const mask = document.createElement('div');
      mask.id = MASK_ID;
      mask.setAttribute('style', [
        'position:fixed', 'inset:0', 'z-index:2147483647',
        'background:#ffffff',
        'display:flex', 'align-items:center', 'justify-content:center',
        'font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif',
        'color:#888', 'transition:opacity 200ms ease'
      ].join(';') + ';');
      mask.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;gap:12px;">'
        + '<div style="width:32px;height:32px;border:3px solid #e5e5e5;border-top-color:#1989fa;border-radius:50%;animation:__yyzs_spin__ .8s linear infinite;"></div>'
        + '<span>页面加载中...</span>'
        + '</div>'
        + '<style>@keyframes __yyzs_spin__{to{transform:rotate(360deg)}}</style>';
      root.appendChild(mask);
    }

    function removeMask() {
      const mask = document.getElementById(MASK_ID);
      if (!mask) return;
      mask.style.opacity = '0';
      setTimeout(() => { try { mask.remove(); } catch (_) {} }, 220);
    }

    ensureMask();

    // 文档结构变化时再尝试插入（防止首次时 documentElement 尚未就绪）
    let earlyObserver = null;
    try {
      if (document.documentElement && typeof MutationObserver === 'function') {
        earlyObserver = new MutationObserver(ensureMask);
        earlyObserver.observe(document.documentElement, { childList: true });
      }
    } catch (_) {}

    function scheduleRemove() {
      try { earlyObserver && earlyObserver.disconnect(); } catch (_) {}
      // 给真实内容 400ms 渲染时间再移除
      setTimeout(removeMask, 400);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      scheduleRemove();
    } else {
      document.addEventListener('DOMContentLoaded', scheduleRemove, { once: true });
    }

    // 兜底：最长 5 秒后强制移除，防止异常情况遮罩不消失
    setTimeout(removeMask, 5000);
  } catch (e) {
    try { console.error('[content-preload] loading mask 注入失败:', e); } catch (_) {}
  }
})();

// 📊 页面生命周期日志 - 在 preload 中监听页面各个阶段的事件，便于排查白屏/加载异常
// 仅对第三方发布/授权页面生效，不影响首页和本地页
(function attachPageLifecycleLogger() {
  try {
    const currentUrl = window.location.href;
    const isLocalPage = currentUrl.startsWith('file://')
      || currentUrl.includes('localhost:5173')
      || currentUrl.startsWith('about:')
      || currentUrl.startsWith('data:');
    if (isLocalPage) {
      return;
    }

    const __LC_START__ = Date.now();
    const __LC_TS__ = () => `T+${Date.now() - __LC_START__}ms`;
    const __LC_TAG__ = '[PageLifecycle]';

    console.log('═══════════════════════════════════════');
    console.log(`${__LC_TAG__} 🚀 preload 加载 @${new Date().toLocaleTimeString()}`);
    console.log(`${__LC_TAG__} 📍 URL: ${currentUrl}`);
    console.log(`${__LC_TAG__} 📄 初始 document.readyState: ${document.readyState}`);
    console.log(`${__LC_TAG__} 📐 viewport: ${window.innerWidth}x${window.innerHeight}`);
    console.log('═══════════════════════════════════════');

    // 监听 readystatechange
    document.addEventListener('readystatechange', () => {
      console.log(`${__LC_TAG__}[${__LC_TS__()}] 📄 readyState → ${document.readyState}`);
      if (document.body) {
        console.log(`${__LC_TAG__}[${__LC_TS__()}] 📊 body.innerHTML 长度: ${document.body.innerHTML.length}`);
      }
    }, true);

    // DOMContentLoaded
    document.addEventListener('DOMContentLoaded', () => {
      console.log(`${__LC_TAG__}[${__LC_TS__()}] 🏗 DOMContentLoaded (body 存在=${!!document.body}, innerHTML 长度=${document.body ? document.body.innerHTML.length : 0})`);
    }, true);

    // window load
    window.addEventListener('load', () => {
      console.log(`${__LC_TAG__}[${__LC_TS__()}] ✅ window.load 完成`);
      try {
        const wujieApp = document.querySelector('wujie-app');
        if (wujieApp) {
          const shadowLen = wujieApp.shadowRoot ? wujieApp.shadowRoot.innerHTML.length : -1;
          console.log(`${__LC_TAG__}[${__LC_TS__()}] 🧩 wujie-app 已存在, shadowRoot innerHTML 长度=${shadowLen}`);
        }
      } catch (e) {
        console.warn(`${__LC_TAG__} wujie-app 检查异常: ${e.message}`);
      }
    }, true);

    // beforeunload / pagehide（用于观察 reload 循环）
    window.addEventListener('beforeunload', () => {
      console.log(`${__LC_TAG__}[${__LC_TS__()}] 👋 beforeunload URL=${window.location.href}`);
    });
    window.addEventListener('pagehide', (e) => {
      console.log(`${__LC_TAG__}[${__LC_TS__()}] 👋 pagehide persisted=${e.persisted}`);
    });

    // 捕获全局错误（便于排查白屏原因）
    window.addEventListener('error', (evt) => {
      console.error(`${__LC_TAG__}[${__LC_TS__()}] ❌ window.error: ${evt.message} @${evt.filename}:${evt.lineno}:${evt.colno}`);
    }, true);
    window.addEventListener('unhandledrejection', (evt) => {
      console.error(`${__LC_TAG__}[${__LC_TS__()}] ❌ unhandledrejection:`, evt.reason && (evt.reason.message || evt.reason));
    });

    if (isShipinhaoPublishUrl(currentUrl) && __IS_LEGACY_WINDOWS__) {
      const PRELOAD_MASK_ID = '__yyzs_preload_loading_mask__';
      const BLANK_RELOAD_COUNT_KEY = '__yyzs_shipinhao_publish_blank_reload_count__';
      const MAX_BLANK_RELOAD = 3; // 最多自动刷新次数（计数器跨 reload 累积），防止无限刷新
      const RELOAD_ALLOW_TAGS = ['T+8s', 'T+15s']; // 允许触发刷新的巡检点（T+3s/T+6s 仅观测，不刷新）
      let reloadScheduled = false; // 本页面生命周期内是否已排定刷新，防止 T+8s/T+15s 同周期重复消耗配额
      const publishSelectors = [
        '.post-short-title-wrap',
        '.input-editor',
        '.form-btns',
        '.weui-desktop-btn',
        '.post-time-wrap',
        '.ant-progress-text',
        '.ant-progress',
        '.upload-wrapper',
        '#fullScreenVideo',
        'input[type="file"]'
      ];

      const removePreloadMaskIfAny = () => {
        try {
          const mask = document.getElementById(PRELOAD_MASK_ID);
          if (mask) {
            mask.remove();
            console.warn('[PageLifecycle][视频号白屏巡检] 已移除 preload 白色遮罩');
          }
        } catch (_) {}
      };

      const hasVisibleElement = (el) => {
        try {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number(style.opacity || '1') !== 0
            && rect.width >= 8
            && rect.height >= 8;
        } catch (_) {
          return false;
        }
      };

      const inspectShipinhaoPublishVisualState = (tag) => {
        try {
          removePreloadMaskIfAny();
          const wujieApp = document.querySelector('wujie-app');
          const shadowRoot = wujieApp && wujieApp.shadowRoot ? wujieApp.shadowRoot : null;
          const roots = shadowRoot ? [document, shadowRoot] : [document];
          let hitSelector = '';
          for (const selector of publishSelectors) {
            if (roots.some(root => root.querySelector(selector))) {
              hitSelector = selector;
              break;
            }
          }

          let visibleElementCount = 0;
          roots.forEach(root => {
            Array.from(root.querySelectorAll('*')).slice(0, 160).forEach(el => {
              if (hasVisibleElement(el)) {
                visibleElementCount += 1;
              }
            });
          });

          const bodyTextLength = document.body ? (document.body.innerText || '').trim().length : 0;
          const bodyHtmlLength = document.body ? document.body.innerHTML.length : 0;
          const blankSuspected = !hitSelector && visibleElementCount <= 2 && bodyTextLength < 20;
          const snapshot = {
            tag,
            href: window.location.href,
            readyState: document.readyState,
            bodyHtmlLength,
            bodyTextLength,
            visibleElementCount,
            wujieApp: !!wujieApp,
            shadowRoot: !!shadowRoot,
            shadowChildren: shadowRoot ? shadowRoot.childElementCount : 0,
            hitSelector: hitSelector || '无',
            blankSuspected
          };
          console.warn('[PageLifecycle][视频号白屏巡检]', snapshot);

          if (blankSuspected && RELOAD_ALLOW_TAGS.includes(tag) && !reloadScheduled) {
            let reloadCount = 0;
            try {
              reloadCount = parseInt(sessionStorage.getItem(BLANK_RELOAD_COUNT_KEY) || '0', 10) || 0;
            } catch (_) {}
            if (reloadCount < MAX_BLANK_RELOAD) {
              reloadScheduled = true;
              try {
                sessionStorage.setItem(BLANK_RELOAD_COUNT_KEY, String(reloadCount + 1));
              } catch (_) {}
              console.warn(`[PageLifecycle][视频号白屏巡检] ${tag} 仍疑似白屏，自动刷新已禁用（原计划第 ${reloadCount + 1}/${MAX_BLANK_RELOAD} 次），仅记录诊断`);
            } else {
              console.warn(`[PageLifecycle][视频号白屏巡检] 已达刷新上限 ${MAX_BLANK_RELOAD} 次，停止自动刷新`);
            }
          }
        } catch (inspectErr) {
          console.warn('[PageLifecycle][视频号白屏巡检] 巡检异常:', inspectErr && inspectErr.message ? inspectErr.message : inspectErr);
        }
      };

      setTimeout(() => inspectShipinhaoPublishVisualState('T+3s'), 3000);
      setTimeout(() => inspectShipinhaoPublishVisualState('T+6s'), 6000);
      setTimeout(() => inspectShipinhaoPublishVisualState('T+8s'), 8000);
      setTimeout(() => inspectShipinhaoPublishVisualState('T+15s'), 15000);
    }
  } catch (err) {
    console.error('[PageLifecycle] 注册页面生命周期日志失败:', err);
  }
})();

// 🎭 视频号登录页预隐藏 - 在页面渲染前隐藏，防止用户看到扫码界面闪烁
// 必须在最开始执行，比反自动化检测更早
(function preHideShipinhaoLogin() {
  try {
    const currentUrl = window.location.href;
    // 仅对视频号登录页生效
    if (currentUrl.includes('channels.weixin.qq.com/login.html')) {
      const REFRESH_FLAG_KEY = '_shipinhao_login_refreshed';
      const RESET_FLAG_KEYS = [
        '_shipinhao_force_reset_login',
        'SHIPINHAO_FORCE_RESET_LOGIN',
        'SHIPINHAO_LOGIN_RESET_REQUESTED'
      ];
      const RESET_URL_PARAMS = [
        'shipinhao_reset_login',
        'shipinhao_force_reset',
        'force_reset',
        'reset_login',
        'clear_login'
      ];

      const isTruthyFlagValue = (value) => {
        if (value === true) return true;
        if (value === false || value == null) return false;
        return ['1', 'true', 'yes', 'y'].includes(String(value).trim().toLowerCase());
      };

      const readStorage = (storage, key) => {
        try {
          return storage.getItem(key);
        } catch (_) {
          return null;
        }
      };

      const hasResetRequest = () => {
        let resetFromUrl = false;
        try {
          const params = new URLSearchParams(window.location.search || '');
          resetFromUrl = RESET_URL_PARAMS.some(key => isTruthyFlagValue(params.get(key)));
        } catch (_) {}

        const resetFromSession = RESET_FLAG_KEYS.some(key => isTruthyFlagValue(readStorage(sessionStorage, key)));
        const resetFromLocal = RESET_FLAG_KEYS.some(key => isTruthyFlagValue(readStorage(localStorage, key)));
        return resetFromUrl || resetFromSession || resetFromLocal;
      };

      const refreshed = readStorage(sessionStorage, REFRESH_FLAG_KEY);
      const resetRequested = hasResetRequest();

      // 默认扫码/授权流程不要预隐藏。只有显式重置登录时才短暂隐藏，避免隐藏样式造成白屏。
      if (!resetRequested || refreshed) {
        console.log('[Shipinhao PreHide] 正常登录/授权流程，跳过预隐藏:', {
          resetRequested,
          refreshed: !!refreshed
        });
        return;
      }

      console.log('[Shipinhao PreHide] 检测到视频号登录重置流程，注入短时预隐藏样式');

      // 使用 webFrame.insertCSS 在页面渲染前注入样式（比 DOM 操作更早）
      webFrame.insertCSS(`
        html {
          visibility: hidden !important;
          background: #fff !important;
        }
        html[data-shipinhao-login-visible] {
          visibility: visible !important;
        }
      `);

      const revealLoginPage = (reason) => {
        try {
          document.documentElement.setAttribute('data-shipinhao-login-visible', 'true');
          console.log(`[Shipinhao PreHide] 恢复页面显示: ${reason}`);
        } catch (e) {
          console.warn('[Shipinhao PreHide] 恢复页面显示失败:', e);
        }
      };

      const checkAndRevealIfNeeded = () => {
        const refreshedNow = readStorage(sessionStorage, REFRESH_FLAG_KEY);
        if (refreshedNow || !hasResetRequest()) {
          revealLoginPage(refreshedNow ? '已完成重置刷新' : '重置标记已消失');
        } else {
          console.log('[Shipinhao PreHide] 首次重置加载，等待登录脚本清缓存并刷新');
        }
      };

      // 在 DOM 准备好后检查是否已刷新过；再加兜底，避免注入脚本异常时永久隐藏。
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkAndRevealIfNeeded, { once: true });
      } else {
        checkAndRevealIfNeeded();
      }

      setTimeout(() => {
        revealLoginPage('5s 兜底，防止永久白屏');
      }, 5000);
    }
  } catch (err) {
    console.error('[Shipinhao PreHide] 预隐藏失败:', err);
  }
})();

// 🛡️ 反自动化检测 - 隐藏 Electron/Webdriver 特征
// 必须在最开始执行，在页面脚本之前
(function injectAntiDetection() {
  try {
    console.log('[AntiDetection] 🚀 开始注入反自动化检测脚本...');
    console.log('[AntiDetection] 📍 当前 URL:', window.location.href);
    console.log('[AntiDetection] 📍 当前时间:', new Date().toISOString());

    const antiDetectionScript = `
      (function() {
        'use strict';

        console.log('[AntiDetection-Page] 🎯 脚本开始执行');
        console.log('[AntiDetection-Page] 📍 URL:', window.location.href);

        // 1. 隐藏 webdriver 属性
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
          configurable: true
        });

        // 2. 模拟正常的 chrome 对象
        if (!window.chrome) {
          window.chrome = {
            runtime: {},
            loadTimes: function() {},
            csi: function() {},
            app: {}
          };
        }

        // 3. 隐藏 Electron 特征
        delete window.process;
        delete window.require;

        // 4. 修复 permissions API
        const originalQuery = window.navigator.permissions?.query;
        if (originalQuery) {
          window.navigator.permissions.query = function(parameters) {
            if (parameters.name === 'notifications') {
              return Promise.resolve({ state: Notification.permission });
            }
            return originalQuery.call(this, parameters);
          };
        }

        // 5. 模拟正常的 plugins 数组
        Object.defineProperty(navigator, 'plugins', {
          get: () => {
            const plugins = [
              { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
              { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
              { name: 'Native Client', filename: 'internal-nacl-plugin' }
            ];
            plugins.length = 3;
            return plugins;
          },
          configurable: true
        });

        // 6. 模拟正常的 languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['zh-CN', 'zh', 'en'],
          configurable: true
        });

        console.log('[AntiDetection-Page] ✅ 反自动化检测已启用');
      })();
    `;

    webFrame.executeJavaScript(antiDetectionScript);
    console.log('[AntiDetection] ✅ 脚本已通过 webFrame.executeJavaScript 注入');
  } catch (e) {
    console.error('[AntiDetection] ❌ 注入失败:', e);
  }
})();

// 搜狐号发布页保护已经迁移到主进程窗口上下文守卫
// 这里保留占位日志，避免 preload 再次劫持 localStorage / history / location
(function injectSohuToPathFix() {
  try {
    if (window.location?.host?.includes('mp.sohu.com')) {
      console.log('[content-preload] ℹ️ 搜狐号 preload 跳转劫持已禁用，改由主进程窗口守卫处理');
    }
  } catch (e) {
    console.error('[content-preload] ❌ 记录搜狐号 preload 状态失败:', e);
  }
})();

// 配置（内联，因为 preload 脚本沙盒环境不能使用 path 模块）
const config = {
  platformIdMap: {
    1: 'dy',    // 抖音
    4: 'bjh',   // 百家号
    6: 'xhs',   // 小红书
    7: 'sph',   // 视频号
    8: 'wyh',   // 网易号
    9: 'shh',   // 搜狐号
    10: 'txh',  // 腾讯号
    11: 'xl',   // 新浪号
    12: 'zh',   // 知乎
    14: 'tt',   // 头条号
  },
  platformNameMap: {
    'dy': 'douyin',
    'xhs': 'xiaohongshu',
    'sph': 'shipinhao',
    'bjh': 'baijiahao',
    'wx': 'weixin',
    'wyh': 'wangyihao',
    'shh': 'sohuhao',
    'txh': 'tengxunhao',
    'xl': 'xinlang',
    'zh': 'zhihu',
    'tt': 'toutiao'
  }
};

const PLATFORM_CONFIG_ALIASES = {
  tengxunhao: 'tengxvnhao',
  tengxvnhao: 'tengxunhao',
  sohuhao: 'souhuhao',
  souhuhao: 'sohuhao',
  xinlang: 'xinlang',
  zhihu: 'zhihu'
};

const LOCAL_PLATFORM_CONFIG_FALLBACK = {
  publish: {
    maxConcurrentWindows: 5
  },
  platforms: {
    souhuhao: {
      publishPageUrl: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle',
      publishPageUrls: {
        video: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle',
        article: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle'
      }
    },
    douyin: {
      publishPageUrl: 'https://creator.douyin.com/creator-micro/content/upload',
      publishPageUrls: {
        video: 'https://creator.douyin.com/creator-micro/content/upload',
        article: 'https://creator.douyin.com/creator-micro/content/upload'
      }
    },
    xiaohongshu: {
      publishPageUrl: 'https://creator.xiaohongshu.com/publish/publish',
      publishPageUrls: {
        video: 'https://creator.xiaohongshu.com/publish/publish?target=video',
        article: 'https://creator.xiaohongshu.com/publish/publish?target=image'
      }
    },
    baijiahao: {
      publishPageUrl: 'https://baijiahao.baidu.com/builder/rc/edit',
      publishPageUrls: {
        video: 'https://baijiahao.baidu.com/builder/rc/edit?type=video',
        article: 'https://baijiahao.baidu.com/builder/rc/edit?type=news&is_from_cms=1'
      }
    },
    wangyihao: {
      publishPageUrl: 'https://mp.163.com/subscribe_v4/index.html#/article-publish',
      publishPageUrls: {
        video: 'https://mp.163.com/subscribe_v4/index.html#/article-publish',
        article: 'https://mp.163.com/subscribe_v4/index.html#/article-publish'
      }
    },
    shipinhao: {
      publishPageUrl: 'https://channels.weixin.qq.com/platform/post/create',
      publishPageUrls: {
        video: 'https://channels.weixin.qq.com/platform/post/create',
        article: 'https://channels.weixin.qq.com/platform/post/create'
      }
    },
    tengxvnhao: {
      publishPageUrl: 'https://om.qq.com/main/creation/article',
      publishPageUrls: {
        video: 'https://om.qq.com/main/creation/article',
        article: 'https://om.qq.com/main/creation/article'
      }
    },
    tengxunhao: {
      publishPageUrl: 'https://om.qq.com/main/creation/article',
      publishPageUrls: {
        video: 'https://om.qq.com/main/creation/article',
        article: 'https://om.qq.com/main/creation/article'
      }
    },
    xinlang: {
      publishPageUrl: 'https://card.weibo.com/article/v5/editor#/draft',
      publishPageUrls: {
        video: 'https://card.weibo.com/article/v5/editor#/draft',
        article: 'https://card.weibo.com/article/v5/editor#/draft'
      }
    },
    zhihu: {
      publishPageUrl: 'https://zhuanlan.zhihu.com/write',
      publishPageUrls: {
        video: 'https://zhuanlan.zhihu.com/write',
        article: 'https://zhuanlan.zhihu.com/write'
      }
    },
    toutiao: {
      publishPageUrl: 'https://mp.toutiao.com/profile_v4/graphic/publish?from=toutiao_pc',
      publishPageUrls: {
        video: 'https://mp.toutiao.com/profile_v4/graphic/publish?from=toutiao_pc',
        article: 'https://mp.toutiao.com/profile_v4/graphic/publish?from=toutiao_pc'
      }
    }
  }
};

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.flv', '.wmv', '.mpeg', '.mpg'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.svg', '.heic'];

function getFileExtensionFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';

  try {
    const normalizedUrl = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
    const pathname = new URL(normalizedUrl).pathname || '';
    return pathname.slice(pathname.lastIndexOf('.')).toLowerCase();
  } catch (error) {
    const cleanUrl = rawUrl.split('?')[0].split('#')[0];
    const lastDotIndex = cleanUrl.lastIndexOf('.');
    if (lastDotIndex === -1) return '';
    return cleanUrl.slice(lastDotIndex).toLowerCase();
  }
}

function detectPublishContentType(element) {
  // 1. 优先看显式 type / contentType 字段（前端传字符串时直接用）
  const explicitType = element?.contentType || element?.content_type || element?.type;
  if (typeof explicitType === 'string') {
    const lower = explicitType.toLowerCase();
    if (lower.includes('video')) {
      return { contentType: 'video', extension: '', sourceUrl: element?.video || element?.video_url || element?.videoUrl || element?.url || '' };
    }
    if (lower.includes('article') || lower.includes('image') || lower.includes('graphic')) {
      return { contentType: 'article', extension: '', sourceUrl: element?.image || element?.image_url || element?.url || element?.cover || '' };
    }
  }

  // 2. 文件扩展名判断（视频字段优先于通用 url，避免视频被 cover/bg_url 误判为图片）
  const candidateUrls = [
    element?.video,
    element?.video_url,
    element?.videoUrl,
    element?.url,
    element?.image,
    element?.cover,
    element?.bg_url,
    element?.image_url,
    element?.imageUrl
  ].filter(Boolean);

  for (const candidateUrl of candidateUrls) {
    const extension = getFileExtensionFromUrl(candidateUrl);
    if (VIDEO_EXTENSIONS.includes(extension)) {
      return { contentType: 'video', extension, sourceUrl: candidateUrl };
    }
    if (IMAGE_EXTENSIONS.includes(extension)) {
      return { contentType: 'article', extension, sourceUrl: candidateUrl };
    }
  }

  return {
    contentType: 'article',
    extension: '',
    sourceUrl: candidateUrls[0] || ''
  };
}

let runtimePlatformConfig = null;
let runtimePlatformConfigPromise = null;

function mergePlatformConfig(remoteConfig) {
  const mergedPlatforms = {
    ...(LOCAL_PLATFORM_CONFIG_FALLBACK.platforms || {}),
    ...((remoteConfig && remoteConfig.platforms) || {})
  };

  return {
    ...LOCAL_PLATFORM_CONFIG_FALLBACK,
    ...(remoteConfig || {}),
    platforms: mergedPlatforms
  };
}

function buildPlatformPublishUrlMap(platformConfig) {
  const platforms = (platformConfig && platformConfig.platforms) || {};
  const result = {};

  for (const [shortPlatform, fullPlatform] of Object.entries(config.platformNameMap)) {
    const aliasPlatform = PLATFORM_CONFIG_ALIASES[fullPlatform];
    const platformItem = platforms[fullPlatform] || (aliasPlatform ? platforms[aliasPlatform] : null);
    if (!platformItem) continue;

    const publishPageUrls = platformItem.publishPageUrls || {};
    result[shortPlatform] = {
      video: publishPageUrls.video || platformItem.publishPageUrl || '',
      article: publishPageUrls.article || platformItem.publishPageUrl || ''
    };
  }

  return result;
}

async function getRuntimePlatformConfig() {
  if (runtimePlatformConfig) {
    return runtimePlatformConfig;
  }

  if (!runtimePlatformConfigPromise) {
    runtimePlatformConfigPromise = ipcRenderer.invoke('get-platform-config')
      .then((result) => {
        const remoteConfig = result && result.success ? result.config : null;
        const mergedConfig = mergePlatformConfig(remoteConfig);
        runtimePlatformConfig = mergedConfig;
        console.log('[content-preload] ✅ 平台配置已加载:', {
          source: result?.source || 'fallback',
          platformCount: Object.keys(mergedConfig.platforms || {}).length
        });
        return runtimePlatformConfig;
      })
      .catch((error) => {
        console.error('[content-preload] ❌ 加载平台配置失败，使用本地兜底:', error);
        runtimePlatformConfig = mergePlatformConfig(null);
        return runtimePlatformConfig;
      })
      .finally(() => {
        runtimePlatformConfigPromise = null;
      });
  }

  return runtimePlatformConfigPromise;
}

// 检测是否为生产环境（打包后运行）
// 使用多种方式判断，确保准确
const isProduction = (() => {
  // 方法1：检查 process.defaultApp（开发环境为 true）
  if (process.defaultApp) {
    return false;
  }

  // 方法2：检查执行路径是否包含 electron（开发环境特征）
  const execPath = process.execPath.toLowerCase();
  if (execPath.includes('electron')) {
    return false;
  }

  // 方法3：检查 resourcesPath 是否包含 app.asar
  if (process.resourcesPath && process.resourcesPath.includes('app.asar')) {
    return true;
  }

  // 方法4：检查 resourcesPath 是否在 node_modules 中（开发环境特征）
  if (process.resourcesPath && process.resourcesPath.includes('node_modules')) {
    return false;
  }

  // 默认认为是生产环境（安全起见）
  return true;
})();

console.log('[content-preload] 环境检测:', {
  isProduction,
  defaultApp: process.defaultApp,
  execPath: process.execPath,
  resourcesPath: process.resourcesPath
});

// 消息回调存储（多订阅模式 - 同一通道可注册多个回调，避免后注册者覆盖前者）
const messageCallbacks = {
  fromHome: new Set(),
  fromOtherPage: new Set(),
  fromMain: new Set()
};

// 统一分发：遍历 Set 中所有回调，单个回调抛错不影响其他订阅者
function dispatchCallbacks(set, payload, channelName) {
  if (!set || set.size === 0) {
    console.warn(`[BrowserAPI] ⚠️ ${channelName} 回调未注册！`);
    return;
  }
  set.forEach((fn) => {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[BrowserAPI] ${channelName} 回调执行异常:`, err);
    }
  });
}

// 防重复发布标志
let isPublishing = false;

// 待发送的消息队列（按 windowId 存储，等窗口加载完成后发送）
const pendingMessages = new Map();
const DEFAULT_MAX_CONCURRENT_PUBLISH_WINDOWS = 5;
const publishWindowScheduler = {
  pendingJobs: [],
  activeJobs: new Map(),
  isLaunching: false,
  batchId: 0,
  maxConcurrentWindows: DEFAULT_MAX_CONCURRENT_PUBLISH_WINDOWS
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getSchedulerSnapshot() {
  return {
    activeCount: publishWindowScheduler.activeJobs.size,
    pendingCount: publishWindowScheduler.pendingJobs.length,
    batchId: publishWindowScheduler.batchId,
    maxConcurrentWindows: publishWindowScheduler.maxConcurrentWindows
  };
}

function resolveMaxConcurrentPublishWindows(platformConfig) {
  const value = Number(platformConfig?.publish?.maxConcurrentWindows);
  if (Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return DEFAULT_MAX_CONCURRENT_PUBLISH_WINDOWS;
}

function buildPublishWindowJob(element, index, total, platformMap, platformFullNameMap, urlMap) {
  const platform = platformMap[element.account_info.media.id];
  const platformFullName = platformFullNameMap[platform];
  const backendAccountId = String(
    element?.account_info?.id
    || element?.accountInfo?.id
    || element?.media_auth_id
    || element?.mediaAuthId
    || element?.dyPlatform?.id
    || element?.id
    || ''
  ).trim();
  const publishTarget = detectPublishContentType(element);
  const platformUrls = urlMap[platform] || {};
  const url = platformUrls[publishTarget.contentType] || platformUrls.article || platformUrls.video;
  console.log(`🚀 [${index + 1}/${total}] platform: ${platform}, contentType: ${publishTarget.contentType}, ext: ${publishTarget.extension || 'unknown'}, url: ${url}`);

  if (!url) {
    console.error(`❌ [${index + 1}] 未找到发布地址: platform=${platform}, contentType=${publishTarget.contentType}`);
    return null;
  }

  const openOptions = {};
  const ENABLE_MULTI_ACCOUNT = true;
  let cookiesData = null;
  let cookiesArray = [];
  if (element.cookies) {
    try {
      cookiesData = typeof element.cookies === 'string' ? JSON.parse(element.cookies) : element.cookies;
      if (Array.isArray(cookiesData)) {
        cookiesArray = cookiesData;
      } else if (cookiesData.cookies && Array.isArray(cookiesData.cookies)) {
        cookiesArray = cookiesData.cookies;
      }
      console.log('🚀 ~ element.cookies 解析成功, cookies 数量:', cookiesArray.length);
    } catch (e) {
      console.error('🚀 ~ element.cookies 解析失败:', e);
    }
  }

  const shouldUseMultiAccountSession = ENABLE_MULTI_ACCOUNT
    && platformFullName
    && (element.cookies || (platformFullName === 'shipinhao' && backendAccountId));

  if (shouldUseMultiAccountSession) {
    const uniqueSessionId = `${platformFullName}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const sessionAccountId = backendAccountId || uniqueSessionId;
    if (platformFullName) {
      openOptions.platform = platformFullName;
      openOptions.accountId = sessionAccountId;
      console.log(`[BrowserAPI] 📋 多账号模式，使用独立 session: platform=${platformFullName}, accountId=${sessionAccountId}, backendAccountId=${backendAccountId || 'none'}`);
    }
    if (element.cookies) {
      openOptions.sessionData = element.cookies;
      console.log(`[BrowserAPI] 📋 检测到 cookies 数据，共 ${cookiesArray.length} 个`);
    } else {
      console.log(`[BrowserAPI] 📋 视频号未带后台 cookies，使用账号持久 session / 本地最新缓存兜底: accountId=${sessionAccountId}`);
    }
  } else if (element.cookies) {
    console.log('[BrowserAPI] 📋 检测到 cookies 数据，但多账号模式已禁用，使用共享 session');
  } else {
    console.log('[BrowserAPI] 📋 普通模式（无 cookies 数据），使用共享 session（persist:browserview）');
  }

  const basePublishData = {
    element,
    platform,
    createdAt: Date.now(),
    contentType: publishTarget.contentType,
    detectedFileExtension: publishTarget.extension,
    sourceUrl: publishTarget.sourceUrl,
    video: {
      formData: element.formData || { title: element.title, send_set: 1 },
      video: {
        cover: element.url || element.image,
        title: element.title,
        intro: element.intro,
        content: element.content,
        url: element.url,
        sendlog: element.sendlog || {
          title: element.title,
          intro: element.intro
        }
      },
      dyPlatform: element.dyPlatform || { id: element.id }
    }
  };
  openOptions.publishData = basePublishData;

  try {
    const publishUrl = new URL(url);
    openOptions.windowContext = {
      purpose: 'publish',
      platform,
      contentType: publishTarget.contentType,
      expectedPageUrl: url,
      safeOrigin: publishUrl.origin,
      bootstrapUrl: `${publishUrl.origin}/`,
      guardResourceUrls: true
    };
  } catch (e) {
    console.warn('[BrowserAPI] ⚠️ 构建窗口上下文失败，降级使用目标 URL:', e);
    openOptions.windowContext = {
      purpose: 'publish',
      platform,
      contentType: publishTarget.contentType,
      expectedPageUrl: url,
      safeOrigin: '',
      bootstrapUrl: url,
      guardResourceUrls: true
    };
  }

  return {
    index,
    total,
    platform,
    platformFullName,
    url,
    openOptions,
    basePublishData
  };
}

function schedulePublishWindowLaunch() {
  setTimeout(() => {
    launchQueuedPublishWindows().catch(err => {
      console.error('[BrowserAPI] ❌ 发布窗口调度失败:', err);
    });
  }, 0);
}

async function launchQueuedPublishWindows() {
  if (publishWindowScheduler.isLaunching) {
    return;
  }

  publishWindowScheduler.isLaunching = true;
  try {
    while (
      publishWindowScheduler.activeJobs.size < publishWindowScheduler.maxConcurrentWindows &&
      publishWindowScheduler.pendingJobs.length > 0
    ) {
      const job = publishWindowScheduler.pendingJobs.shift();
      console.log('[BrowserAPI] 📋 openOptions:', JSON.stringify(job.openOptions, null, 2));
      const result = await ipcRenderer.invoke('open-new-window', job.url, job.openOptions);
      if (!result.success) {
        console.error(`❌ [${job.index + 1}] 打开窗口失败: ${result.error}`);
        continue;
      }

      const windowId = result.windowId;
      publishWindowScheduler.activeJobs.set(windowId, {
        ...job,
        windowId
      });
      console.log(`✅ [${job.index + 1}] 窗口创建成功, windowId: ${windowId}`);

      const publishDataKey = `publish_data_window_${windowId}`;
      const defaultPublishData = {
        ...job.basePublishData,
        windowId
      };
      const existingPublishDataResult = await ipcRenderer.invoke('global-storage-get', publishDataKey);
      let publishData = existingPublishDataResult?.success ? existingPublishDataResult.value : null;

      if (publishData && typeof publishData === 'object') {
        publishData = {
          ...publishData,
          windowId
        };
        console.log(`[BrowserAPI] ♻️ 保留主进程预写入的 ${publishDataKey}`);
      } else {
        publishData = defaultPublishData;
        await ipcRenderer.invoke('global-storage-set', publishDataKey, publishData);
        console.log(`[BrowserAPI] ✅ 已存储 ${publishDataKey}`);
      }

      pendingMessages.set(windowId, {
        type: 'publish-data',
        platform: job.platform,
        windowId,
        data: publishData
      });
      console.log(`[BrowserAPI] 📋 已存储待发送消息, windowId: ${windowId}, 等待窗口加载完成...`);
      console.log('[BrowserAPI] 📊 当前发布窗口调度状态:', getSchedulerSnapshot());

      if (
        publishWindowScheduler.activeJobs.size < publishWindowScheduler.maxConcurrentWindows &&
        publishWindowScheduler.pendingJobs.length > 0
      ) {
        await delay(500);
      }
    }
  } finally {
    publishWindowScheduler.isLaunching = false;
  }

  if (
    publishWindowScheduler.activeJobs.size < publishWindowScheduler.maxConcurrentWindows &&
    publishWindowScheduler.pendingJobs.length > 0
  ) {
    schedulePublishWindowLaunch();
    return;
  }

  if (publishWindowScheduler.pendingJobs.length === 0) {
    console.log('[BrowserAPI] ✅ 发布窗口待启动队列已清空，当前活跃窗口数:', publishWindowScheduler.activeJobs.size);
  }
}

ipcRenderer.on('managed-window-closed', (event, data = {}) => {
  console.log('[BrowserAPI] 收到 managed-window-closed 事件:', data);
  const { windowId } = data;
  if (!publishWindowScheduler.activeJobs.has(windowId)) {
    pendingMessages.delete(windowId);
    return;
  }

  publishWindowScheduler.activeJobs.delete(windowId);
  pendingMessages.delete(windowId);
  console.log(`[BrowserAPI] 🧹 发布窗口已关闭，释放并发槽位: windowId=${windowId}`);
  console.log('[BrowserAPI] 📊 当前发布窗口调度状态:', getSchedulerSnapshot());

  if (publishWindowScheduler.pendingJobs.length > 0) {
    schedulePublishWindowLaunch();
  }
});

// 监听窗口加载完成事件（在这里发送消息，替代 setTimeout 延时）
ipcRenderer.on('window-loaded', (event, data) => {
  console.log('[BrowserAPI] 🔔 收到 window-loaded 事件:', data);
  const { windowId, url } = data;

  // 检查是否有待发送的消息
  if (pendingMessages.has(windowId)) {
    const messageData = pendingMessages.get(windowId);
    // 🔑 不删除 pendingMessages，保留消息以便窗口重定向后重发
    // 场景：登录过期 → 跳登录页 → window-loaded 触发但脚本没监听 → 消息丢失
    // 保留后：登录完成 → 跳回发布页 → window-loaded 再次触发 → 重发消息
    // 发布脚本自带防重复处理（isProcessing/hasProcessed），不会重复执行

    // 发送消息到目标窗口
    setTimeout(() => {
      ipcRenderer.send('home-to-content', messageData);
      console.log(`[BrowserAPI] 📤 窗口加载完成，已发送消息, windowId: ${windowId}, url: ${url}`);
    }, 6000)
  }
  // 没有待发送消息时不再输出日志，减少干扰
});

// 全局消息监听器（只注册一次）
window.addEventListener('message', (event) => {
  // 只处理字符串类型的 type（过滤掉抖音等第三方消息）
  if (!event.data || typeof event.data.type !== 'string') {
    // 不再输出干扰日志
    return;
  }

  console.log('[BrowserAPI] ✅ 收到有效 postMessage:', {
    origin: event.origin,
    type: event.data.type,
    data: event.data.data
  });

  switch (event.data.type) {
    case 'FROM_HOME':
      console.log('[BrowserAPI] 检测到 FROM_HOME 消息，订阅者数量:', messageCallbacks.fromHome.size);
      dispatchCallbacks(messageCallbacks.fromHome, event.data.data, 'fromHome');
      break;
    case 'FROM_OTHER_PAGE':
      console.log('[BrowserAPI] 检测到 FROM_OTHER_PAGE 消息，订阅者数量:', messageCallbacks.fromOtherPage.size);
      dispatchCallbacks(messageCallbacks.fromOtherPage, event.data.data, 'fromOtherPage');
      break;
    case 'FROM_MAIN':
      console.log('[BrowserAPI] 检测到 FROM_MAIN 消息，订阅者数量:', messageCallbacks.fromMain.size);
      dispatchCallbacks(messageCallbacks.fromMain, event.data.data, 'fromMain');
      break;
    default:
      console.log('[BrowserAPI] 未知消息类型:', event.data.type);
  }
});

// 为内容页面提供 API
contextBridge.exposeInMainWorld('browserAPI', {
  // 环境信息
  isProduction: isProduction,

  // 发送消息到首页
  sendToHome: (message) => {
    console.log('[BrowserAPI] 发送消息到首页:', message);
    ipcRenderer.send('content-to-home', message);
  },

  // 从首页发送消息到其他页面
  sendToOtherPage: (message) => {
    console.log('[BrowserAPI] 发送消息到其他页面:', message);

    // 处理发布数据
    if (message.type === 'publish-data' && message.data) {
      const dataObj = JSON.parse(message.data);
      console.log("🚀 ~ sendToOtherPage ~ dataObj: ", dataObj);

      // 统一转换为数组处理（兼容单个对象和数组）
      const dataArray = Array.isArray(dataObj) ? dataObj : [dataObj];

      console.log('[BrowserAPI] 🔍 数据类型:', Array.isArray(dataObj) ? '数组' : '对象');
      console.log('[BrowserAPI] 🔍 dataArray 长度:', dataArray.length);

      // 存储完整发布数据到全局存储
      ipcRenderer.invoke('global-storage-set', 'publish_data', message.data);
      console.log('[BrowserAPI] ✅ 已存储 publish_data 到全局存储');
      console.log(`[BrowserAPI] 📋 共有 ${dataArray.length} 篇文章待发布`);

      const platformMap = config.platformIdMap;
      const platformFullNameMap = config.platformNameMap;

      // 使用立即执行的异步函数 + for...of 确保顺序执行
      (async () => {
        const platformConfig = await getRuntimePlatformConfig();
        const urlMap = buildPlatformPublishUrlMap(platformConfig);
        publishWindowScheduler.maxConcurrentWindows = resolveMaxConcurrentPublishWindows(platformConfig);
        const jobs = [];

        for (let index = 0; index < dataArray.length; index++) {
          const element = dataArray[index];
          const job = buildPublishWindowJob(
            element,
            index,
            dataArray.length,
            platformMap,
            platformFullNameMap,
            urlMap
          );
          if (job) {
            jobs.push(job);
          }
        }

        if (jobs.length === 0) {
          console.warn('[BrowserAPI] ⚠️ 没有可创建的发布窗口任务');
          return;
        }

        publishWindowScheduler.batchId += 1;
        publishWindowScheduler.pendingJobs.push(...jobs);
        console.log(`[BrowserAPI] ✅ 已加入 ${jobs.length} 个发布窗口任务，最多并发 ${publishWindowScheduler.maxConcurrentWindows} 个`);
        console.log('[BrowserAPI] 📊 当前发布窗口调度状态:', getSchedulerSnapshot());
        await launchQueuedPublishWindows();
      })();

      // publish-data 类型的消息已经在循环中处理，不需要再次发送
      return;
    }

    // 其他类型的消息正常发送
    ipcRenderer.send('home-to-content', message);
  },

  // 监听来自首页的消息（多订阅，返回 unsubscribe 函数）
  onMessageFromHome: (callback) => {
    if (typeof callback !== 'function') {
      console.warn('[BrowserAPI] onMessageFromHome: callback 必须是函数，已忽略');
      return () => {};
    }
    messageCallbacks.fromHome.add(callback);
    console.log('[BrowserAPI] onMessageFromHome 监听器已注册，当前订阅者数量:', messageCallbacks.fromHome.size);
    return () => {
      messageCallbacks.fromHome.delete(callback);
      console.log('[BrowserAPI] onMessageFromHome 监听器已注销，剩余订阅者数量:', messageCallbacks.fromHome.size);
    };
  },

  // 监听来自其他页面的消息（首页使用，多订阅，返回 unsubscribe 函数）
  onMessageFromOtherPage: (callback) => {
    if (typeof callback !== 'function') {
      console.warn('[BrowserAPI] onMessageFromOtherPage: callback 必须是函数，已忽略');
      return () => {};
    }
    messageCallbacks.fromOtherPage.add(callback);
    console.log('[BrowserAPI] onMessageFromOtherPage 监听器已注册，当前订阅者数量:', messageCallbacks.fromOtherPage.size);
    return () => {
      messageCallbacks.fromOtherPage.delete(callback);
      console.log('[BrowserAPI] onMessageFromOtherPage 监听器已注销，剩余订阅者数量:', messageCallbacks.fromOtherPage.size);
    };
  },

  // 监听来自控制面板的消息（多订阅，返回 unsubscribe 函数）
  onMessageFromMain: (callback) => {
    if (typeof callback !== 'function') {
      console.warn('[BrowserAPI] onMessageFromMain: callback 必须是函数，已忽略');
      return () => {};
    }
    messageCallbacks.fromMain.add(callback);
    console.log('[BrowserAPI] onMessageFromMain 监听器已注册，当前订阅者数量:', messageCallbacks.fromMain.size);
    return () => {
      messageCallbacks.fromMain.delete(callback);
      console.log('[BrowserAPI] onMessageFromMain 监听器已注销，剩余订阅者数量:', messageCallbacks.fromMain.size);
    };
  },

  // 监听 Cookies 清除事件（首页使用，用于清空授权列表）
  onCookiesCleared: (callback) => {
    ipcRenderer.on('cookies-cleared', (event, data) => {
      console.log('[BrowserAPI] 收到 cookies-cleared 事件:', data);
      callback(data);
    });
    console.log('[BrowserAPI] onCookiesCleared 监听器已注册');
  },

  // 监听新窗口加载完成事件（首页使用，用于知道新窗口何时准备好）
  onWindowLoaded: (callback) => {
    ipcRenderer.on('window-loaded', (event, data) => {
      console.log('[BrowserAPI] 收到 window-loaded 事件:', data);
      callback(data);
    });
    console.log('[BrowserAPI] onWindowLoaded 监听器已注册');
  },

  // 监听会话更新事件（首页使用，用于保存发布窗口关闭时的最新 cookies）
  // data: { windowId, platform, accountId, cookies, publishData, timestamp }
  onSessionUpdated: (callback) => {
    ipcRenderer.on('session-updated', (event, data) => {
      console.log('[BrowserAPI] 收到 session-updated 事件:', data);
      callback(data);
    });
    console.log('[BrowserAPI] onSessionUpdated 监听器已注册');
  },

  // 清除所有监听器（清空当前 webContents 内所有订阅；推荐改用 onMessage* 返回的 unsubscribe）
  clearMessageListeners: () => {
    const sizes = {
      fromHome: messageCallbacks.fromHome.size,
      fromOtherPage: messageCallbacks.fromOtherPage.size,
      fromMain: messageCallbacks.fromMain.size
    };
    messageCallbacks.fromHome.clear();
    messageCallbacks.fromOtherPage.clear();
    messageCallbacks.fromMain.clear();
    console.log('[BrowserAPI] 所有消息监听器已清除（清除前订阅者数量）:', sizes);
  },

  // 导航控制 API
  // options: {
  //   useTemporarySession: boolean - 为 true 时使用临时 session（不保存登录状态，用于授权页）
  //   platform: string - 平台名称（多账号模式必填）
  //   accountId: string - 账号 ID（多账号模式必填）
  //   sessionData: object | string - 会话数据（可选）。如果提供，浏览器会在打开窗口前自动清空旧登录信息并恢复此数据
  // }
  openNewWindow: (url, options) => ipcRenderer.invoke('open-new-window', url, options),
  navigateCurrentWindow: (url) => ipcRenderer.invoke('navigate-current-window', url),
  closeCurrentWindow: () => ipcRenderer.invoke('close-current-window'),
  goBack: () => ipcRenderer.invoke('content-go-back'),
  goForward: () => ipcRenderer.invoke('content-go-forward'),
  refresh: () => ipcRenderer.invoke('content-refresh'),
  canGoBack: () => ipcRenderer.invoke('content-can-go-back'),
  canGoForward: () => ipcRenderer.invoke('content-can-go-forward'),
  openDevTools: () => ipcRenderer.invoke('content-open-devtools'),

  // 获取当前窗口 ID（用于新窗口识别自己，读取对应的发布数据）
  getWindowId: () => ipcRenderer.invoke('get-window-id').then(r => r.success ? r.windowId : null),
  getWindowContext: () => ipcRenderer.invoke('get-window-context').then(r => r.success ? r.context : null),

  // 获取主窗口（BrowserView/首页）的 URL 信息（用于动态获取 API 域名）
  getMainUrl: () => ipcRenderer.invoke('get-main-url'),

  // 视频下载 API（通过主进程绕过跨域限制）
  downloadVideo: (url) => ipcRenderer.invoke('download-video', url),

  // 图片下载 API（通过主进程绕过跨域限制）
  downloadImage: (url) => ipcRenderer.invoke('download-image', url),

  // 触发文件下载（会弹出保存对话框）
  triggerDownload: (url) => ipcRenderer.invoke('trigger-download', url),

  // 清除指定域名的 Cookies（用于退出登录）
  clearDomainCookies: (domain) => ipcRenderer.invoke('clear-domain-cookies', domain),
  dedupeShipinhaoCookies: () => ipcRenderer.invoke('dedupe-shipinhao-cookies'),
  clearShipinhaoLoginIdentityCookies: () => ipcRenderer.invoke('clear-shipinhao-login-identity-cookies'),
  clearAllAuthData: () => ipcRenderer.invoke('clear-all-auth-data'),

  // 迁移临时 Session 的 Cookies 到持久化 Session
  // 用于授权窗口（临时session）授权成功后，把登录状态复制到持久化session
  // 参数: domain - 要迁移的域名，如 'baidu.com'
  // 返回: { success: true, migratedCount: 10 } 或 { success: false, error: '错误信息' }
  migrateCookiesToPersistent: (domain) => ipcRenderer.invoke('migrate-cookies-to-persistent', domain),
  migrateCookiesToAccountSession: (domain, platform, accountId) => ipcRenderer.invoke('migrate-cookies-to-account-session', domain, platform, accountId),

  // 检查 Session 状态（用于检测登录状态是否被清除）
  checkSessionStatus: () => ipcRenderer.invoke('check-session-status'),

  // 设置 Cookie（跨域支持，用于登录后设置 .china9.cn 等父域名的 Cookie）
  // 参数: { name, value, domain, path, expires, secure, httpOnly, sameSite }
  // 示例: setCookie({ name: 'token', value: 'xxx', domain: '.china9.cn', expires: Date.now() + 86400000 })
  setCookie: (cookieData) => ipcRenderer.invoke('set-cookie', cookieData),

  // 跳转到本地 HTML 页面（用于跳转到 not-available.html 等本地页面）
  // 参数: pageName - 页面文件名，如 'not-available.html'、'login.html'
  navigateToLocalPage: (pageName) => ipcRenderer.invoke('navigate-to-local-page', pageName),

  // 获取指定域名的所有 Cookies（包括 HttpOnly）
  // 参数: domain - 域名，如 'baidu.com'
  // 返回: { success: true, cookies: 'cookie_string' } 或 { success: false, error: '错误信息' }
  getDomainCookies: (domain) => ipcRenderer.invoke('get-domain-cookies', domain),

  // 获取完整会话数据（Cookies + localStorage + sessionStorage + IndexedDB）
  // 用于授权后将完整登录状态存储到后台
  // 参数: domain - 域名，如 'baidu.com'
  // 返回: { success: true, data: { cookies, localStorage, sessionStorage, indexedDB }, size: 数据大小 }
  getFullSessionData: (domain) => ipcRenderer.invoke('get-full-session-data', domain),

  // 🔁 跨域代理 fetch（用当前窗口 session 在主进程发请求，绕过浏览器 CORS）
  // 用于发布窗口跨域调平台 API（如 card.weibo.com 跨域调 mp.sina.com.cn/aj/...）
  // 参数:
  //   url - 完整 URL
  //   options - { method, headers, body, withCookies }
  // 返回: { success, status, ok, data } 或 { success: false, error }
  proxyFetch: (url, options) => ipcRenderer.invoke('proxy-fetch-window-session', url, options || {}),

  // 恢复完整会话数据（Cookies + localStorage + sessionStorage + IndexedDB）
  // 用于发布时从后台获取的会话数据恢复到当前窗口
  // 参数: sessionData - 会话数据对象或 JSON 字符串（与 getFullSessionData 返回的 data 格式相同）
  // 返回: { success: true, results: { cookies, localStorage, sessionStorage, indexedDB } }
  restoreSessionData: (sessionData) => ipcRenderer.invoke('restore-session-data', sessionData),

  // ========== 全局数据存储 API（用于跨页面数据传递） ==========
  // 存储数据（如 company_id）
  setGlobalData: (key, value) => ipcRenderer.invoke('global-storage-set', key, value),
  // 获取数据
  getGlobalData: (key) => ipcRenderer.invoke('global-storage-get', key).then(r => r.value),
  // 删除数据
  removeGlobalData: (key) => ipcRenderer.invoke('global-storage-remove', key),
  // 获取所有数据
  getAllGlobalData: () => ipcRenderer.invoke('global-storage-get-all').then(r => r.data),
  // 清空所有数据
  clearGlobalData: () => ipcRenderer.invoke('global-storage-clear'),
  // 写调试文件到 userData/debug-dumps
  writeDebugFile: (payload) => ipcRenderer.invoke('write-debug-file', payload),

  // ========== 多账号管理 API ==========
  // 获取指定平台的所有账号
  // 参数: platform - 平台名称，如 'douyin', 'xiaohongshu', 'baijiahao', 'weixin', 'shipinhao'
  // 返回: { success: true, accounts: [...] }
  getAccounts: (platform) => ipcRenderer.invoke('get-accounts', platform).then(r => r.accounts || []),

  // 获取所有平台的所有账号
  // 返回: { douyin: [...], xiaohongshu: [...], ... }
  getAllAccounts: () => ipcRenderer.invoke('get-all-accounts').then(r => r.platformAccounts || {}),

  // 添加账号（授权成功后调用）
  // 参数: platform - 平台名称
  //       accountInfo - { nickname, avatar, platformUid, id? }
  // 返回: { success: true, accountId: 'xxx', isNew: true/false }
  addAccount: (platform, accountInfo) => ipcRenderer.invoke('add-account', platform, accountInfo),

  // 删除账号（同时清理对应 session 数据）
  // 参数: platform - 平台名称
  //       accountId - 账号 ID
  // 返回: { success: true }
  removeAccount: (platform, accountId) => ipcRenderer.invoke('remove-account', platform, accountId),

  // 更新账号信息
  // 参数: platform - 平台名称
  //       accountId - 账号 ID
  //       updates - { nickname?, avatar?, platformUid? }
  // 返回: { success: true, account: {...} }
  updateAccount: (platform, accountId, updates) => ipcRenderer.invoke('update-account', platform, accountId, updates),

  // 检查账号是否已存在（通过平台用户 ID 判断）
  // 参数: platform - 平台名称
  //       platformUid - 平台用户 ID
  // 返回: { exists: true, accountId: 'xxx', account: {...} } 或 { exists: false }
  accountExists: (platform, platformUid) => ipcRenderer.invoke('account-exists', platform, platformUid),

  // 获取账号信息
  // 参数: platform - 平台名称
  //       accountId - 账号 ID
  // 返回: { success: true, account: {...} }
  getAccount: (platform, accountId) => ipcRenderer.invoke('get-account', platform, accountId),

  // 获取当前窗口的账号信息（在发布脚本中使用）
  // 返回: { success: true, platform: 'xxx', accountId: 'xxx', account: {...} }
  getCurrentAccount: () => ipcRenderer.invoke('get-current-account'),

  // 迁移临时 Session 到新账号（授权窗口使用）
  // 用于授权成功后，将临时 session 的 cookies 迁移到新账号的持久化 session
  // 参数: platform - 平台名称
  //       accountInfo - { nickname, avatar, platformUid }
  // 返回: { success: true, accountId: 'xxx', isNew: true/false, migratedCount: 10 }
  migrateToNewAccount: (platform, accountInfo) => ipcRenderer.invoke('migrate-to-new-account', platform, accountInfo),

  // 检查账号登录状态
  // 参数: platform - 平台名称
  //       accountId - 账号 ID
  // 返回: { success: true, isLoggedIn: true/false, cookieCount: 10 }
  checkAccountLoginStatus: (platform, accountId) => ipcRenderer.invoke('check-account-login-status', platform, accountId),

  // 恢复账号会话数据（在打开窗口之前调用）
  // 用于从后台获取的会话数据恢复到指定账号的 session
  // 参数: platform - 平台名称（如 'douyin', 'xiaohongshu'）
  //       accountId - 账号 ID（如 'douyin_xxx_1'）
  //       sessionData - 会话数据对象或 JSON 字符串（getFullSessionData 返回的格式）
  // 返回: { success: true, results: { cookies, localStorage, sessionStorage, indexedDB } }
  restoreAccountSession: (platform, accountId, sessionData) => ipcRenderer.invoke('restore-account-session', platform, accountId, sessionData),

  // 清空账号的所有 Cookies（在窗口关闭前调用）
  // 用于清空发布窗口对应账号的登录状态
  // 参数: platform - 平台名称
  //       accountId - 账号 ID
  // 返回: { success: true, deletedCount: 10 }
  clearAccountCookies: (platform, accountId) => ipcRenderer.invoke('clear-account-cookies', platform, accountId),

  // 手动保存会话数据到后台（开发调试用）
  // 在不关闭窗口的情况下保存最新 cookies 到后台
  // 返回: { success: true, cookieCount: 10, response: '...' }
  saveSessionToBackend: () => ipcRenderer.invoke('save-session-to-backend'),

  // 版本更新
  // 获取当前应用版本号
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  // 手动检查更新（会弹出更新对话框）
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),

  // 🔑 获取域名配置（集中配置）
  getDomainConfig: () => ipcRenderer.invoke('get-domain-config'),
  // 🔑 获取平台发布配置（开发环境读本地，生产环境走远程）
  getPlatformConfig: () => getRuntimePlatformConfig(),

  // 原生鼠标点击（发送 isTrusted=true 的可信事件，绕过 Vue 组件的 isTrusted 检查）
  nativeClick: (x, y) => ipcRenderer.invoke('native-click', x, y),
  // 原生鼠标移动（触发真实 hover，不执行点击）
  nativeMouseMove: (x, y, options) => ipcRenderer.invoke('native-mouse-move', x, y, options),
  // 原生连续 hover（批量移动并停留，用于触发依赖真实鼠标移入的提示）
  nativeMouseHover: (points, options) => ipcRenderer.invoke('native-mouse-hover', points, options)
});

// 在页面加载时注入通信代码和协议拦截
window.addEventListener('DOMContentLoaded', () => {
  console.log('BrowserAPI ready:', window.location.href);

  // 注入协议拦截代码到页面上下文
  const script = document.createElement('script');
  script.textContent = `
    (function() {
      // 阻止的协议列表
      const blockedProtocols = ['bitbrowser:', 'mqqwpa:', 'weixin:', 'alipays:', 'tbopen:'];

      function isBlockedProtocol(url) {
        if (!url || typeof url !== 'string') return false;
        const lowerUrl = url.toLowerCase();
        return blockedProtocols.some(function(protocol) { return lowerUrl.startsWith(protocol); });
      }

      // 拦截链接点击
      document.addEventListener('click', function(e) {
        var target = e.target;
        while (target && target !== document) {
          if (target.tagName === 'A' && target.href && isBlockedProtocol(target.href)) {
            console.log('[ProtocolBlock] 阻止链接点击:', target.href);
            e.preventDefault();
            e.stopPropagation();
            return false;
          }
          target = target.parentElement;
        }
      }, true);

      // 拦截 window.open
      var originalOpen = window.open;
      window.open = function(url) {
        if (isBlockedProtocol(url)) {
          console.log('[ProtocolBlock] 阻止 window.open:', url);
          return null;
        }
        return originalOpen.apply(window, arguments);
      };

      // 拦截 location.assign
      var originalAssign = window.location.assign;
      if (originalAssign) {
        window.location.assign = function(url) {
          if (isBlockedProtocol(url)) {
            console.log('[ProtocolBlock] 阻止 location.assign:', url);
            return;
          }
          return originalAssign.call(window.location, url);
        };
      }

      // 拦截 location.replace
      var originalReplace = window.location.replace;
      if (originalReplace) {
        window.location.replace = function(url) {
          if (isBlockedProtocol(url)) {
            console.log('[ProtocolBlock] 阻止 location.replace:', url);
            return;
          }
          return originalReplace.call(window.location, url);
        };
      }

      console.log('[ProtocolBlock] 前端协议拦截已启用');
    })();
  `;
  document.documentElement.appendChild(script);
  script.remove(); // 注入后立即移除 script 标签
});
