const { contextBridge, ipcRenderer, webFrame } = require('electron');

// 🔧 Toutiao IndexedDB 诊断标记
// 之前这里会强行 hook indexedDB.open，但一次性发布窗口在“无 hook”环境下能稳定保存，
// 说明 monkey patch 本身更可能在干扰头条编辑器的原生持久化流程。
// 现在改成只打诊断标记，不再改写原生 IDB API。
(async function injectIDBFixFirst() {
  const idbFixScript = `
    (function() {
      'use strict';
      try {
        var host = (window.location && window.location.hostname) ? window.location.hostname : '';
        if (!host.includes('toutiao.com') && !host.includes('toutiaostatic.com')) return;

        window.__IDB_FIX__ = false;
        window.__IDB_FIX_LOG__ = ['disabled: keep native IndexedDB behavior for Toutiao'];
        try { console.log('[IDB-Fix] disabled: keep native IndexedDB behavior for Toutiao'); } catch(e) {}

      } catch (e) {
        try { console.error('[IDB-Fix] fatal:', e); } catch(e2) {}
      }
    })();
  `;
  try {
    await webFrame.executeJavaScript(idbFixScript);
  } catch (e) {}
})();

// 🛡️ 反自动化检测 - 隐藏 Electron/Webdriver 特征
// 必须在最开始执行，在页面脚本之前
(async function injectAntiDetection() {
  try {
    const antiDetectionScript = `
      (function() {
        'use strict';

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
        // 说明：严格模式下，delete 非 configurable 属性会抛异常（可能导致后续脚本不再注入）
        // 这里改为更安全的“遮蔽”写法：优先 defineProperty getter 返回 undefined；失败再尝试赋值。
        (function hideElectronProp(key) {
          try {
            Object.defineProperty(window, key, {
              get: () => undefined,
              set: () => {},
              configurable: true
            });
            return;
          } catch (e) {}

          try {
            window[key] = undefined;
          } catch (e2) {}
        })('process');

        (function hideElectronProp(key) {
          try {
            Object.defineProperty(window, key, {
              get: () => undefined,
              set: () => {},
              configurable: true
            });
            return;
          } catch (e) {}

          try {
            window[key] = undefined;
          } catch (e2) {}
        })('require');

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

        // 7. 补充 navigator.connection API（头条 vendor 依赖）
        // Chromium 106 / Electron 21 环境下可能不存在或不完整，导致 "Cannot read properties of undefined (reading 'network')"
        // 注意：这里必须在 antiDetection 脚本内执行，不能等到 polyfill 脚本，因为头条 vendor 加载很早
        try {
          if (!navigator.connection) {
            var connObj = {
              effectiveType: '4g',
              downlink: 10,
              rtt: 50,
              saveData: false,
              type: 'wifi'
            };
            navigator.connection = connObj;
            console.log('[AntiDetection] ✅ 已直接赋值 navigator.connection');
          }
        } catch (e) {
          console.warn('[AntiDetection] ⚠️ 直接赋值 navigator.connection 失败，尝试 defineProperty');
          try {
            Object.defineProperty(navigator, 'connection', {
              value: {
                effectiveType: '4g',
                downlink: 10,
                rtt: 50,
                saveData: false,
                type: 'wifi'
              },
              writable: true,
              configurable: true,
              enumerable: true
            });
            console.log('[AntiDetection] ✅ 已通过 defineProperty 补充 navigator.connection');
          } catch (e2) {
            console.warn('[AntiDetection] ⚠️ defineProperty 也失败了:', e2.message);
          }
        }

        console.log('[AntiDetection] ✅ 反自动化检测已启用');
      })();
    `;

    // ⚠️ 必须 await，确保注入顺序早于页面脚本
    try {
      await webFrame.executeJavaScript(antiDetectionScript);
    } catch (e) {
      console.error('[AntiDetection] 注入失败:', e);
    }

    // 🔧 Chromium 106 Polyfills - 补充头条等平台前端可能用到的新 API
    const polyfillScript = `
      (function() {
        'use strict';

        var polyfilled = [];

        // Array.prototype.toSorted (Chrome 110+)
        if (!Array.prototype.toSorted) {
          Array.prototype.toSorted = function(compareFn) {
            return Array.from(this).sort(compareFn);
          };
          polyfilled.push('Array.toSorted');
        }

        // Array.prototype.toReversed (Chrome 110+)
        if (!Array.prototype.toReversed) {
          Array.prototype.toReversed = function() {
            return Array.from(this).reverse();
          };
          polyfilled.push('Array.toReversed');
        }

        // Array.prototype.toSpliced (Chrome 110+)
        if (!Array.prototype.toSpliced) {
          Array.prototype.toSpliced = function() {
            var arr = Array.from(this);
            arr.splice.apply(arr, arguments);
            return arr;
          };
          polyfilled.push('Array.toSpliced');
        }

        // Array.prototype.with (Chrome 110+)
        if (!Array.prototype.with) {
          Array.prototype.with = function(index, value) {
            var arr = Array.from(this);
            if (index < 0) index = arr.length + index;
            arr[index] = value;
            return arr;
          };
          polyfilled.push('Array.with');
        }

        // Array.prototype.findLast (Chrome 97+, but double-check)
        if (!Array.prototype.findLast) {
          Array.prototype.findLast = function(fn, thisArg) {
            for (var i = this.length - 1; i >= 0; i--) {
              if (fn.call(thisArg, this[i], i, this)) return this[i];
            }
            return undefined;
          };
          polyfilled.push('Array.findLast');
        }

        // Array.prototype.findLastIndex (Chrome 97+)
        if (!Array.prototype.findLastIndex) {
          Array.prototype.findLastIndex = function(fn, thisArg) {
            for (var i = this.length - 1; i >= 0; i--) {
              if (fn.call(thisArg, this[i], i, this)) return i;
            }
            return -1;
          };
          polyfilled.push('Array.findLastIndex');
        }

        // Object.groupBy (Chrome 117+)
        if (!Object.groupBy) {
          Object.groupBy = function(iterable, callbackFn) {
            var result = Object.create(null);
            var index = 0;
            for (var item of iterable) {
              var key = callbackFn(item, index++);
              if (!(key in result)) result[key] = [];
              result[key].push(item);
            }
            return result;
          };
          polyfilled.push('Object.groupBy');
        }

        // Map.groupBy (Chrome 117+)
        if (!Map.groupBy) {
          Map.groupBy = function(iterable, callbackFn) {
            var map = new Map();
            var index = 0;
            for (var item of iterable) {
              var key = callbackFn(item, index++);
              if (!map.has(key)) map.set(key, []);
              map.get(key).push(item);
            }
            return map;
          };
          polyfilled.push('Map.groupBy');
        }

        // Promise.withResolvers (Chrome 119+)
        if (!Promise.withResolvers) {
          Promise.withResolvers = function() {
            var resolve, reject;
            var promise = new Promise(function(res, rej) {
              resolve = res;
              reject = rej;
            });
            return { promise: promise, resolve: resolve, reject: reject };
          };
          polyfilled.push('Promise.withResolvers');
        }

        // String.prototype.isWellFormed (Chrome 111+)
        if (!String.prototype.isWellFormed) {
          String.prototype.isWellFormed = function() {
            return !/\\uD800/.test(this) || /[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]/.test(this);
          };
          polyfilled.push('String.isWellFormed');
        }

        // String.prototype.toWellFormed (Chrome 111+)
        if (!String.prototype.toWellFormed) {
          String.prototype.toWellFormed = function() {
            return this.replace(/[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]/g, '\\uFFFD');
          };
          polyfilled.push('String.toWellFormed');
        }

        // Set methods (Chrome 122+)
        if (!Set.prototype.intersection) {
          Set.prototype.intersection = function(other) {
            var result = new Set();
            for (var item of this) { if (other.has(item)) result.add(item); }
            return result;
          };
          polyfilled.push('Set.intersection');
        }
        if (!Set.prototype.union) {
          Set.prototype.union = function(other) {
            var result = new Set(this);
            for (var item of other) result.add(item);
            return result;
          };
          polyfilled.push('Set.union');
        }
        if (!Set.prototype.difference) {
          Set.prototype.difference = function(other) {
            var result = new Set();
            for (var item of this) { if (!other.has(item)) result.add(item); }
            return result;
          };
          polyfilled.push('Set.difference');
        }

        if (polyfilled.length > 0) {
          console.log('[Polyfill] ✅ 已补充 ' + polyfilled.length + ' 个 API:', polyfilled.join(', '));
        }
      })();
    `;
    try {
      await webFrame.executeJavaScript(polyfillScript);
    } catch (e) {}

    // 🔍 JS 错误捕获浮层 - 在页面上直接显示 JS 错误（不依赖 Console）
    // 同时在头条域名额外捕获 console.* 输出（可观测日志）
    const errorOverlayScript = `
      (function() {
        'use strict';
        var errors = [];
        var overlay = null;
        var MAX_ERRORS = 80;
        var pendingLines = [];

        function isOverlayMountedAndCurrentDoc() {
          try {
            if (!overlay) return false;
            if (overlay.ownerDocument !== document) return false;
            if (!document.contains(overlay)) return false;
            return true;
          } catch (e) {
            return false;
          }
        }

        function buildOverlayElement() {
          var el = document.createElement('div');
          el.id = '__js_error_overlay__';
          el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:35vh;overflow-y:auto;' +
            'background:rgba(0,0,0,0.88);color:#ff6b6b;font:12px/1.5 monospace;padding:8px 12px;z-index:2147483647;' +
            'display:none;border-top:2px solid #ff4444;pointer-events:auto;';
          var closeBtn = document.createElement('span');
          closeBtn.textContent = '[X 关闭]';
          closeBtn.style.cssText = 'position:sticky;top:0;float:right;cursor:pointer;color:#aaa;padding:2px 6px;';
          closeBtn.onclick = function() { el.style.display = 'none'; };
          el.appendChild(closeBtn);
          return el;
        }

        function appendLine(el, msg, color) {
          var line = document.createElement('div');
          line.style.cssText = 'border-bottom:1px solid rgba(255,255,255,0.1);padding:3px 0;word-break:break-all;' +
            (color ? ('color:' + color + ';') : '');
          line.textContent = msg;
          el.appendChild(line);
          el.style.display = 'block';
          el.scrollTop = el.scrollHeight;
        }

        function flushPendingLines() {
          if (!isOverlayMountedAndCurrentDoc()) return;
          if (!pendingLines.length) return;
          try {
            var el = overlay;
            var list = pendingLines.slice(0);
            pendingLines.length = 0;
            list.forEach(function(item) {
              try { appendLine(el, item.msg, item.color); } catch (e) {}
            });
          } catch (e) {}
        }

        function tryMountOverlay() {
          // 跨导航保护：旧 document 的节点不可复用
          if (overlay && (overlay.ownerDocument !== document || !document.contains(overlay))) {
            try { overlay.remove(); } catch (e) {}
            overlay = null;
          }

          if (isOverlayMountedAndCurrentDoc()) {
            flushPendingLines();
            return overlay;
          }

          var parent = document.body || document.documentElement;
          if (!parent) return null;

          try {
            var el = overlay;
            if (!el) {
              el = buildOverlayElement();
            }
            parent.appendChild(el);
            // 只有成功挂载后才缓存为可用 overlay（避免早期文档 append 失败导致“假缓存”）
            overlay = el;
            flushPendingLines();
            return overlay;
          } catch (e) {
            // 挂载失败：不要缓存 overlay，等待后续重试
            overlay = null;
            return null;
          }
        }

        function addLine(msg, color) {
          errors.push(msg);
          if (errors.length > MAX_ERRORS) errors.shift();

          pendingLines.push({ msg: msg, color: color });
          if (pendingLines.length > MAX_ERRORS) pendingLines.shift();

          tryMountOverlay();
        }

        // 挂载重试：同一 renderer 跨导航时，DOMContentLoaded/load 会在新 document 再次触发
        try {
          window.addEventListener('DOMContentLoaded', function() { tryMountOverlay(); }, false);
          window.addEventListener('load', function() { tryMountOverlay(); }, false);
        } catch (e) {}

        // 尽早尝试一次（可能在早期文档失败，后续事件会再试）
        tryMountOverlay();

        function safeStringify(val) {
          try {
            if (typeof val === 'string') return val;
            if (val && typeof val === 'object') {
              if (val instanceof Error) return (val.stack || val.message || String(val));
              return JSON.stringify(val);
            }
            return String(val);
          } catch (e) {
            try { return String(val); } catch (e2) { return '[unserializable]'; }
          }
        }

        function formatArgs(args) {
          try {
            return Array.prototype.slice.call(args).map(safeStringify).join(' ');
          } catch (e) {
            return '[format failed]';
          }
        }

        // 在头条域名展示 IDB 修复状态 + hook 诊断日志
        (function() {
          try {
            var host = window.location.hostname || '';
            if (!host.includes('toutiao.com') && !host.includes('toutiaostatic.com')) return;
            var enabled = !!window.__IDB_FIX__;
            addLine('[IDB-Fix] ' + (enabled ? 'enabled' : 'disabled'), enabled ? '#7bed9f' : '#ffa502');
            // 显示 hook 安装过程中的所有日志
            var logs = window.__IDB_FIX_LOG__ || [];
            for (var i = 0; i < logs.length; i++) {
              addLine('[IDB-Fix] ' + logs[i], '#7bed9f');
            }
            if (logs.length === 0 && enabled) {
              addLine('[IDB-Fix] WARNING: no hook logs captured (hook may have failed silently)', '#ffa502');
            }
          } catch (e) {}
        })();

        // 捕获 JS 错误
        window.onerror = function(msg, source, lineno, colno, error) {
          var src = (source || '').split('/').slice(-2).join('/');
          addLine('[ERR] ' + msg + ' | ' + src + ':' + lineno + ':' + colno, '#ff6b6b');
        };

        window.addEventListener('unhandledrejection', function(e) {
          var reason = e.reason;
          var msg = (reason && reason.stack) ? reason.stack.split('\\n').slice(0, 2).join(' ') :
                    (reason && reason.message) ? reason.message : String(reason);
          addLine('[Promise] ' + msg, '#ffa502');
        });

        // 头条域名：捕获 console.* 到 overlay（不依赖 DevTools）
        (function hookConsoleForToutiao() {
          try {
            var host = window.location.hostname || '';
            if (!host.includes('toutiao.com') && !host.includes('toutiaostatic.com')) return;

            if (!window.console) return;

            var con = window.console;

            // 防重复 hook：避免多次注入导致递归/性能问题，也避免覆盖站点自己对 console 的处理
            if (con.__consoleOverlayHooked__) return;

            var methods = [
              { key: 'log', tag: '[LOG]', color: '#dfe4ea' },
              { key: 'info', tag: '[INFO]', color: '#70a1ff' },
              { key: 'warn', tag: '[WARN]', color: '#ffa502' },
              { key: 'error', tag: '[ERR]', color: '#ff6b6b' },
              { key: 'debug', tag: '[DBG]', color: '#a4b0be' }
            ];

            methods.forEach(function(m) {
              var current = con[m.key];
              if (current && current.__overlayHooked__) return;

              var orig = con[m.key];
              if (typeof orig !== 'function') return;
              if (orig.__overlayHooked__) return;

              var wrapped = function() {
                try {
                  addLine(m.tag + ' ' + formatArgs(arguments), m.color);
                } catch (e) {}
                try {
                  return orig.apply(con, arguments);
                } catch (e) {
                  // console 本身失败也不要影响业务
                }
              };
              try { wrapped.__overlayHooked__ = true; } catch (e) {}

              // 关键：不要把 console.* 变成只读/不可配置，避免站点脚本后续覆盖时报错
              try {
                con[m.key] = wrapped;
              } catch (e) {
                try {
                  Object.defineProperty(con, m.key, {
                    value: wrapped,
                    writable: true,
                    configurable: true,
                    enumerable: true
                  });
                } catch (e2) {}
              }
            });

            try { con.__consoleOverlayHooked__ = true; } catch (e) {}

            addLine('[ConsoleOverlay] enabled', '#7bed9f');
          } catch (e) {}
        })();

        console.log('[ErrorOverlay] ✅ JS 错误/日志捕获浮层已启用');
      })();
    `;
    try {
      await webFrame.executeJavaScript(errorOverlayScript);
    } catch (e) {}
  } catch (e) {
    console.error('[AntiDetection] 注入失败:', e);
  }
})();

// 🔑 搜狐号 toPath 处理 - 在页面脚本执行之前注入
// 这必须在最开始执行，因为搜狐号的页面代码会在加载时读取 toPath
(function injectSohuToPathFix() {
  try {
    // 检查当前 URL 是否是搜狐号
    // 注意：preload 脚本执行时 window.location 可能还不可用，所以我们无条件注入
    // 脚本内部会检查域名
    const sohuToPathScript = `
      (function() {
        'use strict';
        // 只在搜狐号发布页执行，不在首页或其他页面执行
        // 原因：首页设置 toPath 会导致授权流程出问题
        // - 授权窗口访问首页 → toPath 被设置为发布页 → 搜狐尝试跳转到发布页 → 需要短信验证 → 循环
        // 只对发布页进行处理，确保发布窗口能正常工作
        const url = window.location.href;
        if (!url.includes('mp.sohu.com') || !url.includes('contentManagement/news/addarticle')) {
          return;
        }

        console.log('[搜狐号-preload] 🛡️ 在发布页设置 toPath');

        try {
          const PUBLISH_PAGE_PATH = '/contentManagement/news/addarticle';
          const currentToPath = localStorage.getItem('toPath');
          console.log('[搜狐号-preload] 当前 toPath:', currentToPath);

          // 🔑 关键修复：无论当前 toPath 是什么值，都强制设置为发布页路径
          // 这样可以确保第一次打开发布窗口时直接进入发布页
          if (currentToPath !== PUBLISH_PAGE_PATH) {
            console.log('[搜狐号-preload] ⚠️ toPath 不是发布页路径，强制设置');
            localStorage.setItem('toPath', PUBLISH_PAGE_PATH);
            console.log('[搜狐号-preload] ✅ 已设置 toPath 为发布页路径:', PUBLISH_PAGE_PATH);
          } else {
            console.log('[搜狐号-preload] ✅ toPath 已经是发布页路径，无需修改');
          }

          // 🔑 劫持 localStorage.getItem，确保读取 toPath 时始终返回发布页路径
          const originalGetItem = localStorage.getItem.bind(localStorage);
          localStorage.getItem = function(key) {
            if (key === 'toPath') {
              console.log('[搜狐号-preload] 🔄 拦截读取 toPath，返回发布页路径');
              return PUBLISH_PAGE_PATH;
            }
            return originalGetItem(key);
          };
          console.log('[搜狐号-preload] ✅ 已劫持 localStorage.getItem');
        } catch (e) {
          console.error('[搜狐号-preload] ❌ 处理 toPath 失败:', e);
        }
      })();
    `;

    // 使用 webFrame 在主世界中执行脚本（在页面脚本之前）
    webFrame.executeJavaScript(sohuToPathScript);
    console.log('[content-preload] ✅ 已注入搜狐号 toPath 修复脚本');
  } catch (e) {
    console.error('[content-preload] ❌ 注入搜狐号 toPath 修复脚本失败:', e);
  }
})();

// 配置（内联，因为 preload 脚本沙盒环境不能使用 path 模块）
const config = {
  platformPublishUrls: {
    dy: 'https://creator.douyin.com/creator-micro/content/upload',
    xhs: 'https://creator.xiaohongshu.com/publish/publish?from=homepage&target=video&openFilePicker=true',
    sph: 'https://channels.weixin.qq.com/platform/post/create',
    bjh: 'https://baijiahao.baidu.com/builder/rc/edit?type=news&is_from_cms=1',
    wyh: 'https://mp.163.com/subscribe_v4/index.html#/article-publish',
    shh: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle',
    txh: 'https://om.qq.com/main/creation/article',
    xl: 'https://card.weibo.com/article/v5/editor#/draft',
    zh: 'https://zhuanlan.zhihu.com/write',
    tt: 'https://mp.toutiao.com/profile_v4/graphic/publish?from=toutiao_pc'
  },
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
    13: 'tt',   // 头条号
    14: 'tt',   // 头条号（兼容）
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

// 消息回调存储（单例模式 - 只保留最新的回调）
const messageCallbacks = {
  fromHome: null,
  fromOtherPage: null,
  fromMain: null
};

// 防重复发布标志
let isPublishing = false;

// 待发送的消息队列（按 windowId 存储，等窗口加载完成后发送）
const pendingMessages = new Map();

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
      console.log('[BrowserAPI] 检测到 FROM_HOME 消息');
      if (messageCallbacks.fromHome) {
        console.log('[BrowserAPI] 调用 fromHome 回调，数据:', event.data.data);
        console.log('[BrowserAPI] 回调函数类型:', typeof messageCallbacks.fromHome);
        try {
          const result = messageCallbacks.fromHome(event.data.data);
          console.log('[BrowserAPI] 回调返回值:', result);
          if (result && typeof result.catch === 'function') {
            result.catch(err => console.error('[BrowserAPI] fromHome 回调 Promise 错误:', err));
          }
        } catch (e) {
          console.error('[BrowserAPI] fromHome 回调同步错误:', e);
        }
      } else {
        console.warn('[BrowserAPI] ⚠️ fromHome 回调未注册！');
      }
      break;
    case 'FROM_OTHER_PAGE':
      console.log('[BrowserAPI] 检测到 FROM_OTHER_PAGE 消息');
      if (messageCallbacks.fromOtherPage) {
        console.log('[BrowserAPI] 调用 fromOtherPage 回调');
        messageCallbacks.fromOtherPage(event.data.data);
      } else {
        console.warn('[BrowserAPI] ⚠️ fromOtherPage 回调未注册！');
      }
      break;
    case 'FROM_MAIN':
      console.log('[BrowserAPI] 检测到 FROM_MAIN 消息');
      if (messageCallbacks.fromMain) {
        console.log('[BrowserAPI] 调用 fromMain 回调');
        messageCallbacks.fromMain(event.data.data);
      } else {
        console.warn('[BrowserAPI] ⚠️ fromMain 回调未注册！');
      }
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

      // 使用配置文件中的映射
      const urlMap = config.platformPublishUrls;
      const platformMap = config.platformIdMap;
      const platformFullNameMap = config.platformNameMap;
      const resolvePlatform = (element) => {
        const mediaId = element?.account_info?.media?.id;
        if (platformMap[mediaId]) {
          return platformMap[mediaId];
        }

        // 兼容后台新增平台 ID 未及时同步的情况：按平台名称兜底
        const mediaName = `${element?.account_info?.media?.name || ''}`.toLowerCase();
        if (mediaName.includes('头条') || mediaName.includes('toutiao')) {
          return 'tt';
        }

        return null;
      };

      // 使用立即执行的异步函数 + for...of 确保顺序执行
      (async () => {
        for (let index = 0; index < dataArray.length; index++) {
          const element = dataArray[index];
          const platform = resolvePlatform(element);
          const platformFullName = platformFullNameMap[platform];
          const url = urlMap[platform];
          console.log(`🚀 [${index + 1}/${dataArray.length}] platform: ${platform}, url: ${url}`);

          if (!platform || !url) {
            console.error(`❌ [${index + 1}] 不支持的平台，media.id=${element?.account_info?.media?.id}, media.name=${element?.account_info?.media?.name || ''}`);
            continue;
          }

          // 构建 openNewWindow 的 options
          // 如果有 cookies 数据，传入 sessionData 让浏览器自动清空并恢复
          const openOptions = {};

          // 🔑 多账号模式开关
          // true: 每个窗口使用独立 session，从父页面传入的 cookies 恢复登录状态
          // false: 所有窗口使用共享 session（persist:browserview）
          const ENABLE_MULTI_ACCOUNT = true;

          // 解析 element.cookies（格式: {domain, timestamp, cookies: [...]} 或 JSON 字符串）
          let cookiesData = null;
          let cookiesArray = [];
          if (element.cookies) {
            try {
              cookiesData = typeof element.cookies === 'string' ? JSON.parse(element.cookies) : element.cookies;
              // cookiesData 可能是 {domain, cookies: [...]} 或直接是数组
              if (Array.isArray(cookiesData)) {
                cookiesArray = cookiesData;
              } else if (cookiesData.cookies && Array.isArray(cookiesData.cookies)) {
                cookiesArray = cookiesData.cookies;
              }
              console.log("🚀 ~ element.cookies 解析成功, cookies 数量:", cookiesArray.length);
            } catch (e) {
              console.error("🚀 ~ element.cookies 解析失败:", e);
            }
          }

          // 🔑 关键判断：只要 element.cookies 存在（即使内部 cookies 数组为空），就使用多账号模式
          // 这样每个账号窗口使用独立 session，避免登录状态互相干扰
          if (ENABLE_MULTI_ACCOUNT && element.cookies) {
            // 多账号模式：为每个窗口创建唯一的 session ID
            const uniqueSessionId = `${platformFullName}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            if (platformFullName) {
              openOptions.platform = platformFullName;
              openOptions.accountId = uniqueSessionId;
              console.log(`[BrowserAPI] 📋 多账号模式，使用独立 session: platform=${platformFullName}, accountId=${uniqueSessionId}`);
            }
            openOptions.sessionData = element.cookies;  // 传原始数据，main.js 会解析
            console.log(`[BrowserAPI] 📋 检测到 cookies 数据，共 ${cookiesArray.length} 个`);
          } else {
            // 普通模式：使用共享 session，保持现有登录状态
            if (element.cookies) {
              console.log(`[BrowserAPI] 📋 检测到 cookies 数据，但多账号模式已禁用，使用共享 session`);
            } else {
              console.log(`[BrowserAPI] 📋 普通模式（无 cookies 数据），使用共享 session（persist:browserview）`);
            }
          }

          // 打开新窗口，获取窗口 ID
          console.log('[BrowserAPI] 📋 openOptions:', JSON.stringify(openOptions, null, 2));
          const result = await ipcRenderer.invoke('open-new-window', url, openOptions);
          if (!result.success) {
            console.error(`❌ [${index + 1}] 打开窗口失败: ${result.error}`);
            continue; // 继续下一个，不要 return
          }

          const windowId = result.windowId;
          console.log(`✅ [${index + 1}] 窗口创建成功, windowId: ${windowId}`);

          // 用窗口 ID 作为 key 存储数据，避免多窗口冲突
          const publishData = {
            element,
            platform,
            windowId,
            video: {
              formData: element.formData || { title: element.title, send_set: 1 },
              video: {
                cover: element.image,
                title: element.title,
                intro: element.intro,
                content: element.content,
                url: element.url,
                sendlog: element.sendlog || {
                  title: element.title,
                  intro: element.intro,
                }
              },
              dyPlatform: element.dyPlatform || { id: element.id }
            },
          };
          await ipcRenderer.invoke('global-storage-set', `publish_data_window_${windowId}`, publishData);
          console.log(`[BrowserAPI] ✅ 已存储 publish_data_window_${windowId}`);

          // 存储待发送的消息，等窗口加载完成事件触发后发送（替代 setTimeout 延时）
          pendingMessages.set(windowId, {
            type: 'publish-data',
            platform: platform,
            windowId: windowId,
            data: publishData
          });
          console.log(`[BrowserAPI] 📋 已存储待发送消息, windowId: ${windowId}, 等待窗口加载完成...`);

          // 每个窗口之间稍微延迟，避免同时创建太多
          if (index < dataArray.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        console.log(`[BrowserAPI] ✅ 所有 ${dataArray.length} 个窗口已创建完成`);
      })();

      // publish-data 类型的消息已经在循环中处理，不需要再次发送
      return;
    }

    // 其他类型的消息正常发送
    ipcRenderer.send('home-to-content', message);
  },

  // 监听来自首页的消息
  onMessageFromHome: (callback) => {
    messageCallbacks.fromHome = callback;
    console.log('[BrowserAPI] onMessageFromHome 监听器已注册/更新');
  },

  // 监听来自其他页面的消息（首页使用）
  onMessageFromOtherPage: (callback) => {
    messageCallbacks.fromOtherPage = callback;
    console.log('[BrowserAPI] onMessageFromOtherPage 监听器已注册/更新');
  },

  // 监听来自控制面板的消息
  onMessageFromMain: (callback) => {
    messageCallbacks.fromMain = callback;
    console.log('[BrowserAPI] onMessageFromMain 监听器已注册/更新');
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

  // 监听新窗口页面跳转事件（首页使用，用于检测发布页被第三方平台重定向的情况）
  // data: { windowId, expectedUrl, actualUrl, isSameOrigin, timestamp }
  onWindowRedirected: (callback) => {
    ipcRenderer.on('window-redirected', (event, data) => {
      console.log('[BrowserAPI] 收到 window-redirected 事件:', data);
      callback(data);
    });
    console.log('[BrowserAPI] onWindowRedirected 监听器已注册');
  },

  // 清除所有监听器（用于组件卸载）
  clearMessageListeners: () => {
    messageCallbacks.fromHome = null;
    messageCallbacks.fromOtherPage = null;
    messageCallbacks.fromMain = null;
    console.log('[BrowserAPI] 所有消息监听器已清除');
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

  // 迁移临时 Session 的 Cookies 到持久化 Session
  // 用于授权窗口（临时session）授权成功后，把登录状态复制到持久化session
  // 参数: domain - 要迁移的域名，如 'baidu.com'
  // 返回: { success: true, migratedCount: 10 } 或 { success: false, error: '错误信息' }
  migrateCookiesToPersistent: (domain) => ipcRenderer.invoke('migrate-cookies-to-persistent', domain),

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

  // 原生鼠标点击（发送 isTrusted=true 的可信事件，绕过 Vue 组件的 isTrusted 检查）
  nativeClick: (x, y) => ipcRenderer.invoke('native-click', x, y)
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
