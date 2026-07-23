// ===========================
// common.js - 公共工具库
// ===========================
// 防止重复加载（检查关键函数是否已存在）

if (typeof window.uploadVideo === "function"
    && typeof window.uploadImage === "function"
    && typeof window.waitForElement === "function"
    && typeof window.setNativeValue === "function"
    && typeof window.__publishSaveSession__ === "function") {
    console.log("[common.js] ⚠️ common.js 已加载，跳过重复定义");
    console.log("[common.js] 当前窗口:", window.location.href);
} else {
    console.log("[common.js] ✅ common.js 开始加载...");
    console.log("[common.js] 当前窗口:", window.location.href);
    if (typeof window.uploadVideo === "function"
        && typeof window.uploadImage === "function"
        && typeof window.waitForElement === "function"
        && typeof window.setNativeValue === "function"
        && typeof window.__publishSaveSession__ !== "function") {
        console.log("[common.js] 🔁 公共函数已存在，补注册关闭前会话保存函数");
    }

    // 标记为已加载
    window.__COMMON_JS_LOADED__ = true;

    // ===========================
    // 🎛️ 特性开关框架（Feature Flags）
    // ===========================
    // 用途：隔离新修复和功能，遇到问题可快速禁用，实现无缝降级
    // 规则：新改动默认加入这里，enabled=true 启用，false 禁用；版本号追踪修复时间
    window.__COMMON_JS_FEATURES__ = {
      // 【修复】2026-07-22 修复发布时 ACCESS_VIOLATION 崩溃
      // 根因：pagehide 事件中的 Promise.catch() 链导致页面卸载时访问已释放内存
      // 修复：移除 setGlobalData() 调用后的 .catch()，改为 fire-and-forget
      // 风险：如果禁用此项，不会保存优化上报的缓存数据，但不会崩溃
      FIX_PAGEHIDE_PROMISE_CRASH: {
        enabled: true,
        version: '1.2.3',
        risk: 'high',
        files: ['common.js:3172', 'common.js:3218'],  // 修改位置
        description: '移除 pagehide 事件中的 Promise.catch() 链'
      },

      // 【修复】2026-07-23 网易发布失败漏报（tjlogerror 被 success 锁吞掉）
      // 根因：乐观成功 8 秒到点定时先发 tjlog 占 success 锁；网易点击后常触发「发文前检测」
      //       需二次点击（耗掉 ~7 秒），真实错误在 8 秒后才出现，随后的 sendStatisticsError
      //       被 success-already-reported 挡掉，失败永不上报（网络面板只见 tjlog 不见 tjlogerror）
      // 修复：网易乐观成功不设到点定时器（deferUntilUnload），只在页面卸载(pagehide)时冲刷；
      //       失败路径先 await sendStatisticsError 再关窗，失败上报永远抢在成功前
      // 风险：禁用后回退旧 8 秒到点逻辑（错误>8秒出现时仍会被误报成功）
      FIX_WANGYI_OPTIMISTIC_DEFER: {
        enabled: true,
        version: '1.2.3',
        risk: 'medium',
        files: ['common.js:sendOptimisticSuccess', 'wangyihao-publish.js:1404'],
        description: '网易乐观成功仅卸载冲刷，不设8秒定时，防失败被success锁吞'
      },

      // 【修复】2026-07-23 搜狐"昨天授权今天掉登录"（后台记录归属漂移）
      // 根因：新授权（auth_type=1）时前端不传后台记录 ID，shinfo 后台疑似新建记录而非更新，
      //       旧记录绑定的发布任务拿到的永远是老快照；浏览器侧"最近授权兜底"又因缺账号绑定被禁用
      // 修复：授权成功后记录登录身份（平台 uid+昵称）→ 主进程记"身份模式"最近授权标记 →
      //       发布窗口打开时期望账号身份匹配（账号守卫同款比对）才放行预热账号 session；
      //       发布关窗 close-save 顺势把新快照写回后台旧记录，形成闭环
      // 风险：禁用后回退"缺少 accountId 一律禁用兜底"旧行为（main.js 侧另有同名常量开关）
      FIX_SOHU_AUTH_IDENTITY_BINDING: {
        enabled: true,
        version: '1.2.3',
        risk: 'medium',
        files: ['souhuhao-creator.js:shinfo成功后', 'main.js:migrateCookiesToPersistent搜狐分支', 'main.js:hydrateSohuhaoAccountSessionFromRecentPersistentSession'],
        description: '搜狐授权身份绑定：新授权无后台记录ID时按登录身份匹配放行最近授权预热'
      },

      // 【修复】2026-07-23 腾讯号图片误判（"看到图了突然就没了"）
      // 根因：getTxhEditorImageFailureText 正则误判腾讯编辑器瞬时提示（如"上传中，请勿..."）
      //       触发清空编辑器 + 原生上传回退，回退链路 downloadFile 跨域失败 → 图片全丢
      // 修复：强化正则过滤词（排除"上传中""加载中""等待""请勿"等进行中状态）；
      //       验证循环命中失败文本后不立即 break，而是再等 1 轮确认文本仍存在（瞬时提示会消失）
      // 风险：禁用后回退旧正则（易误判）+ 单次命中即触发回退
      FIX_TENGXUN_IMAGE_FALSE_POSITIVE: {
        enabled: true,
        version: '1.2.3',
        risk: 'low',
        files: ['tengxvnhao-publish.js:getTxhEditorImageFailureText', 'tengxvnhao-publish.js:验证循环(数值达标优先判成功)', 'tengxvnhao-publish.js:clearEditor(selectAll+delete温和清空)'],
        description: '腾讯号图片误判修复：数值达标优先于失败文本 + 进行中文案排除 + 二次确认 + 编辑器友好清空防RangeError'
      },

      // 【预留】未来的修复/功能添加在下方
      // NEW_FEATURE_TEMPLATE: {
      //   enabled: false,
      //   version: '1.1.9',
      //   risk: 'medium',
      //   files: ['common.js:XXX'],
      //   description: '功能描述'
      // }
    };

    // 🔍 特性开关检查函数（快速判断改动是否启用）
    window.isFeatureEnabled = function (featureName) {
      const feature = window.__COMMON_JS_FEATURES__?.[featureName];
      if (!feature) {
        console.warn(`[Feature] ⚠️ 未知的特性: ${featureName}`);
        return false;
      }
      const result = feature.enabled;
      if (!result) {
        console.log(`[Feature] ℹ️ 特性已禁用: ${featureName} (v${feature.version})`);
      }
      return result;
    };

    // ===========================
    // 🔑 安全的 getGlobalData 包装函数（带超时保护）
    // ===========================
    /**
     * 安全地获取全局数据，带超时保护，避免 IPC 调用卡住阻塞脚本执行
     * @param {string} key - 数据键名
     * @param {number} timeout - 超时时间（毫秒），默认 3000ms
     * @returns {Promise<any>} 返回数据或 null（超时/失败时）
     */
    window.safeGetGlobalData = async function (key, timeout = 3000) {
        if (!window.browserAPI?.getGlobalData) {
            console.warn(`[safeGetGlobalData] ⚠️ browserAPI.getGlobalData 不可用`);
            return null;
        }

        try {
            const result = await Promise.race([
                window.browserAPI.getGlobalData(key),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout))
            ]);
            return result;
        } catch (e) {
            if (e.message === 'timeout') {
                console.warn(`[safeGetGlobalData] ⚠️ 获取 ${key} 超时 (${timeout}ms)`);
            } else {
                console.warn(`[safeGetGlobalData] ⚠️ 获取 ${key} 失败:`, e.message);
            }
            return null;
        }
    };

    // ===========================
    // 🔑 统一配置常量（低风险优化：提取硬编码延迟）
    // ===========================
    window.PUBLISH_CONFIG = {
        // 通用延迟配置（毫秒）
        delays: {
            short: 300, // 短延迟：事件触发后等待
            medium: 1000, // 中延迟：操作间等待
            long: 2000, // 长延迟：页面加载等待
            veryLong: 5000, // 超长延迟：复杂操作等待
        },
        // 重试配置
        retry: {
            maxRetries: 10, // 默认最大重试次数
            retryDelay: 2000, // 默认重试间隔
            uploadMaxRetries: 150, // 上传检测最大重试次数
            uploadRetryDelay: 2000, // 上传检测重试间隔
        },
        // 超时配置
        timeout: {
            element: 30000, // 等待元素超时
            upload: 300000, // 上传超时（5分钟）
            publish: 30000, // 发布超时
            iframe: 10000, // iframe 加载超时
            shadowDom: 5000, // Shadow DOM 查找超时
        },
        // 各平台选择器（方便维护和检查有效性）
        selectors: {
            douyin: {
                publishBtn: ".button-dhlUZE",
                titleInput: ".editor-kit-root-container .semi-input",
                introInput: ".editor-kit-root-container .editor-kit-container.editor",
                coverCheck: '.cover-check [class*="title-"]',
                uploadProgress: '[class*="upload-progress-style"] [class*="text-"]',
            },
            xiaohongshu: {
                publishBtn: ".submit > .custom-button.red",
                titleInput: ".d-input-wrapper .d-input input",
                introInput: ".tiptap-container .ProseMirror",
                uploadStage: ".stage",
            },
            baijiahao: {
                publishBtn: ".cheetah-btn-primary",
                editor: ".news-editor-pc",
                iframe: "iframe",
            },
            shipinhao: {
                publishBtn: ".weui-desktop-btn_primary",
                wujieApp: "wujie-app",
                uploadProgress: ".ant-progress-text",
                video: "#fullScreenVideo",
            },
        },
    };

    // ===========================
    // 🔑 选择器有效性检查工具
    // ===========================
    window.checkSelectorValidity = async function (platform) {
        const config = window.PUBLISH_CONFIG.selectors[platform];
        if (!config) {
            console.warn(`[选择器检查] ⚠️ 未知平台: ${platform}`);
            return { valid: true, missing: [] };
        }

        const missing = [];
        for (const [name, selector] of Object.entries(config)) {
            try {
                const element = document.querySelector(selector);
                if (!element) {
                    missing.push({ name, selector });
                }
            } catch (e) {
                missing.push({ name, selector, error: e.message });
            }
        }

        if (missing.length > 0) {
            console.warn(`[选择器检查] ⚠️ ${platform} 平台有 ${missing.length} 个选择器未找到:`);
            missing.forEach(m => console.warn(`  - ${m.name}: ${m.selector}`));
        } else {
            console.log(`[选择器检查] ✅ ${platform} 平台所有选择器有效`);
        }

        return { valid: missing.length === 0, missing };
    };

    // ===========================
    // 🔑 详细错误日志工具（低风险优化）
    // ===========================
    window.PublishLogger = {
        // 存储日志历史（用于错误上报时附带上下文）
        _history: [],
        _maxHistory: 100,

        // 记录日志
        log: function (platform, action, message, data = null) {
            const entry = {
                timestamp: new Date().toISOString(),
                platform,
                action,
                message,
                data,
                url: window.location.href,
            };
            this._history.push(entry);
            if (this._history.length > this._maxHistory) {
                this._history.shift();
            }
            console.log(`[${platform}] [${action}] ${message}`, data || "");
        },

        // 记录错误（带堆栈信息）
        error: function (platform, action, error, context = {}) {
            const entry = {
                timestamp: new Date().toISOString(),
                platform,
                action,
                error: {
                    message: error.message || String(error),
                    stack: error.stack || null,
                    name: error.name || "Error",
                },
                context,
                url: window.location.href,
                // 页面状态快照
                pageState: {
                    title: document.title,
                    readyState: document.readyState,
                    bodyExists: !!document.body,
                    visibilityState: document.visibilityState,
                },
            };
            this._history.push(entry);
            console.error(`[${platform}] [${action}] ❌ ${error.message}`, { error, context });
            return entry;
        },

        // 获取最近的日志（用于错误上报）
        getRecentLogs: function (count = 20) {
            return this._history.slice(-count);
        },

        // 获取指定平台的日志
        getPlatformLogs: function (platform) {
            return this._history.filter(log => log.platform === platform);
        },

        // 生成错误报告（用于发送到后台）
        generateErrorReport: function (platform, error) {
            return {
                error: {
                    message: error.message || String(error),
                    stack: error.stack || null,
                },
                recentLogs: this.getRecentLogs(10),
                platformLogs: this.getPlatformLogs(platform).slice(-5),
                environment: {
                    url: window.location.href,
                    userAgent: navigator.userAgent,
                    timestamp: new Date().toISOString(),
                },
            };
        },

        // 清空日志
        clear: function () {
            this._history = [];
        },
    };

    // ===========================
    // 页面状态检查 - 防止异常渲染
    // ===========================
    window.checkPageState = function (scriptName = "脚本") {
        // 检查 body 是否存在
        if (!document.body) {
            console.error(`[${scriptName}] ❌ 页面异常：document.body 不存在`);
            return false;
        }

        // 检查页面内容是否异常（CSS代码被当作文本显示）
        // 排除富文本编辑器的内容，避免编辑器中的代码片段导致误报
        let bodyText = "";
        try {
            // 克隆 body，然后删除编辑器元素，再获取 innerText
            const bodyClone = document.body.cloneNode(true);

            // 常见富文本编辑器选择器
            const editorSelectors = [
                // 通用编辑器
                '[contenteditable="true"]',
                '.ql-editor',           // Quill
                '.ProseMirror',         // ProseMirror
                '.tox-edit-area',       // TinyMCE
                '.w-e-text',            // wangEditor
                '.fr-element',          // Froala
                '.jodit-wysiwyg',       // Jodit
                '.cke_editable',        // CKEditor
                // 腾讯号特有
                '.ExEditor-basic',
                '[class*="editor_container"]',
                '[class*="Editor-"]',
                // 代码编辑器
                '.monaco-editor',
                '.CodeMirror',
                '.ace_editor',
            ];

            // 删除所有编辑器元素
            editorSelectors.forEach(selector => {
                try {
                    const elements = bodyClone.querySelectorAll(selector);
                    elements.forEach(el => el.remove());
                } catch (e) {
                    // 忽略无效选择器错误
                }
            });

            bodyText = bodyClone.innerText || "";
        } catch (e) {
            // 克隆失败时使用原始方法
            bodyText = document.body.innerText || "";
        }

        // 如果页面内容包含大量CSS选择器特征，说明渲染异常
        // 🔑 只使用真正的 CSS 规则语法特征（必须带大括号或冒号+值的组合）
        // 不要使用类名前缀（如 .semi-），因为它们在正常 HTML class 属性中也会出现
        const cssPatterns = [
            // CSS 规则语法特征（必须有大括号，这是 CSS 规则的标志）
            ":hover{",
            ":focus{",
            "::before{",
            "::after{",
            ":active{",
            ":visited{",
            ".where(",
            "@media ",
            "@keyframes ",
            "@font-face{",
            // CSS 属性:值 的完整组合（不带空格的紧凑写法，通常是压缩后的 CSS）
            "text-decoration:none",
            "background-color:transparent",
            "background-color:rgba(",
            "cursor:pointer",
            "display:block",
            "display:flex",
            "display:inline-block",
            "display:none",
            "position:absolute",
            "position:relative",
            "position:fixed",
            // 🔑 移除了容易误报的模式：
            // - 类名前缀（.ant-, .semi- 等）会在正常 HTML class 属性中出现
            // - 简单属性前缀（border-radius:, font-size: 等）可能在页面文本内容中出现
        ];

        let cssMatchCount = 0;
        for (const pattern of cssPatterns) {
            if (bodyText.includes(pattern)) {
                cssMatchCount++;
            }
        }

        // 如果匹配了3个以上CSS特征，认为页面渲染异常
        if (cssMatchCount >= 3) {
            console.error(`[${scriptName}] ❌ 检测到页面渲染异常（CSS代码被当作文本显示）`);
            console.error(`[${scriptName}] 匹配的CSS特征数量:`, cssMatchCount);
            return false;
        }

        return true;
    };

    // 隐藏页面内容并显示加载遮罩（纯CSS loading动画）
    // ⚠️ 为避免永久白屏（如平台返回错误页、脚本因等待元素超时抛错），
    // 默认 15s 兔兑底自动解除遮罩。调用方可传 safetyTimeoutMs 覆盖（0 表示禁用）
    window.hidePageAndShowMask = function (safetyTimeoutMs) {
        const __ts__ = Date.now();
        console.log(`[hidePageAndShowMask] 🎭 调用开始 @${new Date().toLocaleTimeString()}, body 存在: ${!!document.body}`);
        // 隐藏 body 内容
        if (document.body) {
            document.body.style.visibility = "hidden";
            document.body.style.opacity = "0";
            console.log(`[hidePageAndShowMask] 🎭 body 已隐藏 (visibility=hidden, opacity=0)`);
        } else {
            console.warn(`[hidePageAndShowMask] ⚠️ body 不存在，仅添加遮罩`);
        }

        // 添加白色遮罩层 + loading动画
        if (!document.getElementById("__page_loading_mask__")) {
            const mask = document.createElement("div");
            mask.id = "__page_loading_mask__";
            mask.innerHTML = `
      <style>
        @keyframes __loading_spin__ {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
      <div style="width:40px;height:40px;border:3px solid #f3f3f3;border-top:3px solid #3498db;border-radius:50%;animation:__loading_spin__ 1s linear infinite;"></div>
    `;
            mask.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;background:#fff;z-index:999999;display:flex;align-items:center;justify-content:center;";
            document.documentElement.appendChild(mask);
            console.log(`[hidePageAndShowMask] 🎭 遮罩层已添加，耗时 ${Date.now() - __ts__}ms`);
        } else {
            console.log(`[hidePageAndShowMask] 🎭 遮罩层已存在，跳过添加`);
        }

        // 🐰 兔兑底定时器：防止主体脚本抛错/超时导致 showPageAndHideMask 永不被调用
        // 背景：ab58f2d 引入开头遮罩，若脚本 60s 等按钮可用超时抛错，show 永远不执行 → 永久白屏
        // 兜底：默认 15s 后强制 show，同时把页面可见文字打到日志（便于排查平台的实际错误提示）
        try {
            if (window.__MASK_SAFETY_TIMER__) {
                clearTimeout(window.__MASK_SAFETY_TIMER__);
                window.__MASK_SAFETY_TIMER__ = null;
            }
            const timeoutMs = (typeof safetyTimeoutMs === 'number' && safetyTimeoutMs >= 0)
                ? safetyTimeoutMs
                : 15000;
            if (timeoutMs > 0) {
                window.__MASK_SAFETY_TIMER__ = setTimeout(() => {
                    try {
                        const mask = document.getElementById('__page_loading_mask__');
                        if (!mask) {
                            console.log(`[MaskSafetyTimer] ⏰ 兜底触发但遮罩已不存在，忽略`);
                            return;
                        }
                        console.warn(`[MaskSafetyTimer] ⏰ ${timeoutMs}ms 兜底触发：遮罩未被主动解除，强制 show`);
                        // 打印页面可见文字前 500 字，帮助排查平台错误页
                        try {
                            const bodyText = (document.body?.innerText || '').trim();
                            if (bodyText) {
                                console.warn(`[MaskSafetyTimer] 📢 当前页面可见文字（前 500 字）:\n${bodyText.slice(0, 500)}`);
                            } else {
                                console.warn(`[MaskSafetyTimer] 📢 页面 innerText 为空`);
                            }
                        } catch (_) {}
                        if (typeof window.showPageAndHideMask === 'function') {
                            window.showPageAndHideMask();
                        }
                    } catch (err) {
                        console.error(`[MaskSafetyTimer] ❌ 兜底异常:`, err);
                    }
                }, timeoutMs);
                console.log(`[hidePageAndShowMask] 🐰 兔兑底定时器已注册 (${timeoutMs}ms 后自动 show)`);
            }
        } catch (timerErr) {
            console.error(`[hidePageAndShowMask] ❌ 注册兔兑底定时器失败:`, timerErr);
        }
    };

    // 显示页面内容并隐藏加载遮罩
    window.showPageAndHideMask = function () {
        // 🐰 清除兔兑底定时器，避免误触
        try {
            if (window.__MASK_SAFETY_TIMER__) {
                clearTimeout(window.__MASK_SAFETY_TIMER__);
                window.__MASK_SAFETY_TIMER__ = null;
                console.log(`[showPageAndHideMask] 🐰 已清除兔兑底定时器`);
            }
        } catch (_) {}

        // 显示 body 内容
        if (document.body) {
            document.body.style.visibility = "visible";
            document.body.style.opacity = "1";
        }

        // 移除加载遮罩
        const mask = document.getElementById("__page_loading_mask__");
        if (mask) {
            mask.remove();
            console.log(`[showPageAndHideMask] ✅ 遮罩已移除`);
        } else {
            console.log(`[showPageAndHideMask] ℹ️ 遮罩不存在，跳过移除`);
        }
    };

    // 页面状态检查并自动刷新（检测到异常时先隐藏页面）
    // 🔑 只在主窗口检测，子窗口（发布页）跳过检测，避免第三方平台页面误报
    window.checkPageStateAndReload = function (scriptName = "脚本", reloadDelay = 2000) {
        // 🔑 子窗口跳过检测（发布页是第三方平台，检测容易误报）
        // 主窗口的 windowId 是 'main'，子窗口是数字
        if (window.browserAPI && window.browserAPI.getWindowId) {
            // 异步获取 windowId，但这里需要同步判断
            // 使用一个简单的标记：如果 URL 不是首页，就跳过检测
            const currentUrl = window.location.href;
            const isHomePage = currentUrl.includes('localhost:5173') ||
                               currentUrl.includes('china9.cn') ||
                               currentUrl.includes('file://');

            if (!isHomePage) {
                console.log(`[${scriptName}] ⏭️ 子窗口（第三方平台），跳过页面状态检测`);
                return true;
            }
        }

        if (!window.checkPageState(scriptName)) {
            // 立即隐藏页面内容，显示loading动画
            window.hidePageAndShowMask();

            console.error(`[${scriptName}] ❌ 页面状态异常，${reloadDelay / 1000}秒后刷新页面...`);
            setTimeout(() => {
                window.location.reload();
            }, reloadDelay);
            return false;
        }
        return true;
    };

    /**
     * 判断当前页面 URL 是否是登录页（覆盖所有平台变体）
     * 用于 showOperationBanner / checkBlankPageAndReload 等场景：在登录页时跳过相关操作，避免打断用户登录流程
     * @returns {boolean}
     */
    window.isPageOnLoginUrl = function () {
        try {
            const url = String(window.location.href || '').toLowerCase();
            if (!url) return false;
            // /login - 通用、小红书、视频号 login.html、搜狐 /mpfe/v4/login
            // /userauth - 腾讯号 om.qq.com/userAuth/index
            // /userlogin - 兜底通用
            // /loginpage, /cgi-bin/login - 微信公众号
            // passport. - 抖音、搜狐、网易、新浪等账号中心
            // account.qq.com - 腾讯账号中心
            const LOGIN_PATTERNS = [
                '/login', '/userauth', '/userlogin', '/loginpage', '/cgi-bin/login',
                'passport.', '/sso/', '/auth/', '/signin', 'account.qq.com', 'security.weibo.com'
            ];
            return LOGIN_PATTERNS.some(p => url.includes(p));
        } catch (e) {
            return false;
        }
    };

    // 在普通 DOM、open Shadow DOM 和同源 iframe 中查找元素。
    // 视频号发布页把真实表单放在 wujie-app.shadowRoot 内，普通 querySelector 会误判为空。
    window.findElementInPageOrShadow = function (selector, root = document, maxDepth = 5) {
        if (!selector || !root || maxDepth < 0) return null;

        const visited = new Set();
        const elementNodeType = typeof Node !== 'undefined' ? Node.ELEMENT_NODE : 1;

        function safeQuery(scope) {
            try {
                return scope && typeof scope.querySelector === 'function' ? scope.querySelector(selector) : null;
            } catch (_) {
                return null;
            }
        }

        function getAllElements(scope) {
            try {
                return scope && typeof scope.querySelectorAll === 'function' ? Array.from(scope.querySelectorAll('*')) : [];
            } catch (_) {
                return [];
            }
        }

        function search(scope, depth) {
            if (!scope || depth > maxDepth || visited.has(scope)) return null;
            visited.add(scope);

            const directHit = safeQuery(scope);
            if (directHit) return directHit;

            const elements = getAllElements(scope);
            for (const element of elements) {
                if (!element || element.nodeType !== elementNodeType) continue;

                if (element.shadowRoot) {
                    const shadowHit = search(element.shadowRoot, depth + 1);
                    if (shadowHit) return shadowHit;
                }

                if (String(element.tagName || '').toUpperCase() === 'IFRAME') {
                    try {
                        const iframeDoc = element.contentDocument || element.contentWindow?.document;
                        const iframeHit = search(iframeDoc, depth + 1);
                        if (iframeHit) return iframeHit;
                    } catch (_) {
                        // 跨域 iframe 无法访问，跳过。
                    }
                }
            }

            return null;
        }

        return search(root, 0);
    };

    /**
     * 白屏检测和自动恢复（针对扫码登录后跳转的情况）
     * @param {string} platform - 平台名称（如 '视频号'、'小红书'）
     * @param {Array<string>} keySelectors - 关键元素选择器数组（用于判断页面是否正常加载）
     * @param {number} checkDelay - 检测延迟时间（毫秒），默认 3000ms
     * @param {number} maxRetries - 最大重试次数，默认 3 次
     */
    window.checkBlankPageAndReload = function (platform = '发布', keySelectors = [], checkDelay = 3000, maxRetries = 3) {
        const __startTs__ = Date.now();
        const startUrl = String(window.location.href || '');
        const suppressShipinhaoAutoReload = String(platform || '').includes('视频号')
            || startUrl.toLowerCase().includes('channels.weixin.qq.com');
        // 🛡️ 登录页跳过白屏检测：登录页天然没有发布元素，触发刷新会打断用户扫码/登录
        if (typeof window.isPageOnLoginUrl === 'function' && window.isPageOnLoginUrl()) {
            console.log(`[${platform}][白屏检测] ⏭️ 当前为登录页，跳过白屏检测，避免打断登录流程`);
            return;
        }
        // 🔑 使用 localStorage 而不是 sessionStorage（登录跳转会清空 sessionStorage）
        const retryKey = `${platform.toUpperCase()}_RELOAD_RETRY_COUNT`;
        let retryCount = parseInt(localStorage.getItem(retryKey) || '0');

        console.log(`[${platform}][白屏检测] 🛡 启动 | checkDelay=${checkDelay}ms | maxRetries=${maxRetries} | 当前重试次数=${retryCount}`);
        console.log(`[${platform}][白屏检测] 📋 keySelectors:`, keySelectors);

        if (retryCount >= maxRetries) {
            console.log(`[${platform}][白屏检测] ⚠️ 已达到最大重试次数 ${maxRetries}，停止自动刷新`);
            localStorage.removeItem(retryKey);
            return;
        }

        // 延迟检测页面是否正常加载
        setTimeout(() => {
            const __checkTs__ = Date.now();
            const currentUrl = String(window.location.href || '');
            console.log(`[${platform}][白屏检测] ⏰ 定时检测触发 @${new Date().toLocaleTimeString()}, 距启动 ${__checkTs__ - __startTs__}ms`);
            try {
                if (typeof window.isPageOnLoginUrl === 'function' && window.isPageOnLoginUrl()) {
                    console.log(`[${platform}][白屏检测] ⏭️ 当前已进入登录页，取消本次白屏检测，避免刷新扫码页`);
                    return;
                }

                if (currentUrl !== startUrl) {
                    console.log(`[${platform}][白屏检测] ⏭️ URL 已变化，取消过期检测: ${startUrl} -> ${currentUrl}`);
                    return;
                }

                // 检测 1: body 是否为空或几乎为空
                const bodyText = (document.body?.innerText || '').trim();
                const bodyHtml = (document.body?.innerHTML || '').trim();

                console.log(`[${platform}][白屏检测] 📊 页面快照:`, {
                    url: window.location.href,
                    readyState: document.readyState,
                    bodyExists: !!document.body,
                    bodyTextLength: bodyText.length,
                    bodyHtmlLength: bodyHtml.length,
                    bodyTextPreview: bodyText.slice(0, 100)
                });

                // 检测 2: 是否有关键元素（支持 Shadow DOM）
                let hasKeyElement = false;
                let hitSelector = null;
                const selectorResults = {};
                if (keySelectors.length > 0) {
                    for (const selector of keySelectors) {
                        // wujie-app 只是微前端容器，必须先验证 shadowRoot 内部是否有真实内容。
                        if (selector === 'wujie-app') {
                            const wujieApp = document.querySelector('wujie-app');
                            if (wujieApp && wujieApp.shadowRoot) {
                                const shadowHtml = wujieApp.shadowRoot.innerHTML || '';
                                const hasRealContent = !!(
                                    wujieApp.shadowRoot.querySelector('body') ||
                                    wujieApp.shadowRoot.querySelector('div') ||
                                    wujieApp.shadowRoot.querySelector('form')
                                );
                                const innerMeaningful = shadowHtml.length > 300 && hasRealContent;
                                selectorResults[selector] = `shadow-root (innerHTML=${shadowHtml.length}, hasRealContent=${hasRealContent}, meaningful=${innerMeaningful})`;
                                if (innerMeaningful && !hasKeyElement) {
                                    hasKeyElement = true;
                                    hitSelector = selector;
                                }
                            } else {
                                selectorResults[selector] = wujieApp ? 'host-without-shadow-root' : 'miss';
                            }
                            continue;
                        }

                        // 先在普通 DOM 中查找
                        const directHit = document.querySelector(selector);
                        if (directHit) {
                            selectorResults[selector] = 'direct-match';
                            if (!hasKeyElement) {
                                hasKeyElement = true;
                                hitSelector = selector;
                            }
                            continue;
                        }

                        // 再查 open Shadow DOM / 同源 iframe，避免视频号 wujie 子应用被误判为空白页。
                        const nestedHit = typeof window.findElementInPageOrShadow === 'function'
                            ? window.findElementInPageOrShadow(selector)
                            : null;
                        if (nestedHit) {
                            selectorResults[selector] = 'nested-match';
                            if (!hasKeyElement) {
                                hasKeyElement = true;
                                hitSelector = selector;
                            }
                            continue;
                        }
                        selectorResults[selector] = 'miss';
                    }
                } else {
                    // 如果没有指定关键选择器，默认认为有元素（只检测 body 内容）
                    hasKeyElement = true;
                }

                console.log(`[${platform}][白屏检测] 🔎 选择器命中明细:`, selectorResults);
                console.log(`[${platform}][白屏检测] 🎯 命中结果: hasKeyElement=${hasKeyElement}, 命中=${hitSelector || '无'}`);

                // 检测 3: 是否是白屏（body 内容很少且没有关键元素）
                const isBlankPage = bodyText.length < 50 && bodyHtml.length < 200 && !hasKeyElement;
                console.log(`[${platform}][白屏检测] 🧮 判定: isBlankPage=${isBlankPage} (bodyText<50=${bodyText.length < 50}, bodyHtml<200=${bodyHtml.length < 200}, !hasKeyElement=${!hasKeyElement})`);

                if (isBlankPage) {
                    console.log(`[${platform}][白屏检测] ❌ 检测到白屏，准备刷新页面...`);
                    console.log(`[${platform}][白屏检测] 📊 白屏详情:`, {
                        bodyTextLength: bodyText.length,
                        bodyHtmlLength: bodyHtml.length,
                        hasKeyElement,
                        retryCount,
                        keySelectors,
                        url: window.location.href
                    });

                    if (suppressShipinhaoAutoReload) {
                        console.log(`[${platform}][白屏检测] ⏭️ 视频号链路已禁用自动 reload，仅保留白屏诊断，避免打断扫码/登录态保存`);
                        return;
                    }

                    // 增加重试计数
                    localStorage.setItem(retryKey, String(retryCount + 1));
                    console.log(`[${platform}][白屏检测] 🔢 重试计数更新: ${retryCount} → ${retryCount + 1}`);

                    // 隐藏页面并显示 loading
                    if (typeof window.hidePageAndShowMask === 'function') {
                        window.hidePageAndShowMask();
                    }

                    // 延迟 1 秒后刷新
                    setTimeout(() => {
                        if ((typeof window.isPageOnLoginUrl === 'function' && window.isPageOnLoginUrl()) || String(window.location.href || '') !== startUrl) {
                            console.log(`[${platform}][白屏检测] ⏭️ 刷新前页面已变化或进入登录页，取消 reload`);
                            return;
                        }
                        console.log(`[${platform}][白屏检测] 🔁 执行 window.location.reload()`);
                        window.location.reload();
                    }, 1000);
                } else {
                    // 页面正常，清除重试计数
                    localStorage.removeItem(retryKey);
                    console.log(`[${platform}][白屏检测] ✅ 页面加载正常 (命中: ${hitSelector || 'N/A'}, 耗时 ${Date.now() - __checkTs__}ms)`);
                }
            } catch (e) {
                console.error(`[${platform}][白屏检测] ❌ 白屏检测异常:`, e);
                console.error(`[${platform}][白屏检测] 🧾 堆栈:`, e.stack);
            }
        }, checkDelay);
    };

    // 等待元素出现的通用函数
    // 支持特殊语法：
    //   - class^=prefix  匹配 class 中以 prefix 开头的元素（用于 CSS Modules 等随机后缀类名）
    //   - class*=substr  匹配 class 中包含 substr 的元素
    //   - class$=suffix  匹配 class 中以 suffix 结尾的元素
    // 示例：waitForElement('class^=editor_container') 匹配 class="editor_container-abc123" 的元素
    window.waitForElement = function (selector, timeout = 30000, checkInterval = 200, ele = document) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            let timeoutId;

            // 解析特殊的类名匹配语法
            function parseClassSelector(sel) {
                // class^=prefix (前缀匹配)
                const prefixMatch = sel.match(/^class\^=(.+)$/);
                if (prefixMatch) {
                    const prefix = prefixMatch[1];
                    return root => {
                        const all = root.querySelectorAll("*");
                        for (const el of all) {
                            if (el.classList && [...el.classList].some(cls => cls.startsWith(prefix))) {
                                return el;
                            }
                        }
                        return null;
                    };
                }

                // class*=substr (包含匹配)
                const containsMatch = sel.match(/^class\*=(.+)$/);
                if (containsMatch) {
                    const substr = containsMatch[1];
                    return root => {
                        const all = root.querySelectorAll("*");
                        for (const el of all) {
                            if (el.classList && [...el.classList].some(cls => cls.includes(substr))) {
                                return el;
                            }
                        }
                        return null;
                    };
                }

                // class$=suffix (后缀匹配)
                const suffixMatch = sel.match(/^class\$=(.+)$/);
                if (suffixMatch) {
                    const suffix = suffixMatch[1];
                    return root => {
                        const all = root.querySelectorAll("*");
                        for (const el of all) {
                            if (el.classList && [...el.classList].some(cls => cls.endsWith(suffix))) {
                                return el;
                            }
                        }
                        return null;
                    };
                }

                // 不是特殊语法，返回 null
                return null;
            }

            function check() {
                try {
                    let el;
                    if (typeof selector === "string") {
                        // 检查是否是特殊的类名匹配语法
                        const customFinder = parseClassSelector(selector);
                        if (customFinder) {
                            el = customFinder(ele);
                        } else {
                            el = ele.querySelector(selector);
                        }
                    } else if (typeof selector === "function") {
                        // 如果是函数，调用它获取元素
                        el = selector();
                    } else {
                        // 否则直接使用（可能已经是元素了）
                        el = selector;
                    }

                    if (el) {
                        clearTimeout(timeoutId);
                        resolve(el);
                        return;
                    }

                    if (Date.now() - startTime > timeout) {
                        clearTimeout(timeoutId);
                        reject(new Error(`找不到元素: ${selector}`));
                        return;
                    }

                    timeoutId = setTimeout(check, checkInterval);
                } catch (error) {
                    clearTimeout(timeoutId);
                    reject(error);
                }
            }

            check();
        });
    };

    // 等待多个元素出现的通用函数（返回数组）
    // 支持特殊语法：
    //   - class^=prefix  匹配 class 中以 prefix 开头的所有元素
    //   - class*=substr  匹配 class 中包含 substr 的所有元素
    //   - class$=suffix  匹配 class 中以 suffix 结尾的所有元素
    // 示例：waitForElements('class^=editor_container') 返回所有 class 以 editor_container 开头的元素
    // minCount: 最少需要找到的元素数量，默认 1
    window.waitForElements = function (selector, timeout = 30000, checkInterval = 200, ele = document, minCount = 1) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            let timeoutId;

            // 解析特殊的类名匹配语法（返回所有匹配元素）
            function parseClassSelectorAll(sel) {
                // class^=prefix (前缀匹配)
                const prefixMatch = sel.match(/^class\^=(.+)$/);
                if (prefixMatch) {
                    const prefix = prefixMatch[1];
                    return root => {
                        const all = root.querySelectorAll("*");
                        const results = [];
                        for (const el of all) {
                            if (el.classList && [...el.classList].some(cls => cls.startsWith(prefix))) {
                                results.push(el);
                            }
                        }
                        return results;
                    };
                }

                // class*=substr (包含匹配)
                const containsMatch = sel.match(/^class\*=(.+)$/);
                if (containsMatch) {
                    const substr = containsMatch[1];
                    return root => {
                        const all = root.querySelectorAll("*");
                        const results = [];
                        for (const el of all) {
                            if (el.classList && [...el.classList].some(cls => cls.includes(substr))) {
                                results.push(el);
                            }
                        }
                        return results;
                    };
                }

                // class$=suffix (后缀匹配)
                const suffixMatch = sel.match(/^class\$=(.+)$/);
                if (suffixMatch) {
                    const suffix = suffixMatch[1];
                    return root => {
                        const all = root.querySelectorAll("*");
                        const results = [];
                        for (const el of all) {
                            if (el.classList && [...el.classList].some(cls => cls.endsWith(suffix))) {
                                results.push(el);
                            }
                        }
                        return results;
                    };
                }

                // 不是特殊语法，返回 null
                return null;
            }

            function check() {
                try {
                    let els = [];
                    if (typeof selector === "string") {
                        // 检查是否是特殊的类名匹配语法
                        const customFinder = parseClassSelectorAll(selector);
                        if (customFinder) {
                            els = customFinder(ele);
                        } else {
                            els = Array.from(ele.querySelectorAll(selector));
                        }
                    } else if (typeof selector === "function") {
                        // 如果是函数，调用它获取元素数组
                        const result = selector();
                        els = Array.isArray(result) ? result : result ? [result] : [];
                    }

                    if (els.length >= minCount) {
                        clearTimeout(timeoutId);
                        resolve(els);
                        return;
                    }

                    if (Date.now() - startTime > timeout) {
                        clearTimeout(timeoutId);
                        reject(new Error(`找不到足够的元素: ${selector} (需要 ${minCount} 个，找到 ${els.length} 个)`));
                        return;
                    }

                    timeoutId = setTimeout(check, checkInterval);
                } catch (error) {
                    clearTimeout(timeoutId);
                    reject(error);
                }
            }

            check();
        });
    };

    // 重试机制
    window.retryOperation = async function (operation, maxRetries = 3, delay = 1000) {
        // alert(`Starting operation with ${maxRetries} maximum retries`);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            // alert(`=== ATTEMPT ${attempt}/${maxRetries} ===
            // Executing operation...`);

            try {
                const result = await operation();
                // alert(`✅ ATTEMPT ${attempt} SUCCESS!
                // Operation completed successfully`);
                return result;
            } catch (error) {
                // alert(`❌ ATTEMPT ${attempt} FAILED
                // Error: ${error.message}`);

                if (attempt === maxRetries) {
                    // alert(`❌ MAX RETRIES REACHED
                    // Failed after ${maxRetries} attempts`);
                    throw error;
                }

                const waitTime = delay * attempt;
                // alert(`🔄 RETRYING... (${attempt}/${maxRetries})
                // Waiting ${waitTime}ms before next attempt`);
                await window.delay(waitTime);
            }
        }
    };

    // 发送消息到父窗口
    window.sendMessageToParent = function (message) {
        console.log("[sendMessageToParent] 发送消息到父窗口:", message);

        // 使用 browserAPI (运营助手浏览器)
        if (window.browserAPI?.sendToHome) {
            try {
                window.browserAPI.sendToHome(message);
                console.log("[sendMessageToParent] ✅ 已通过 browserAPI.sendToHome 发送");
                return true;
            } catch (e) {
                console.error("[sendMessageToParent] ❌ browserAPI.sendToHome 失败:", e);
            }
        } else {
            console.warn("[sendMessageToParent] ⚠️ browserAPI.sendToHome 不可用");
        }

        return false;
    };

    // 安全地上传文件到input元素
    window.uploadFileToInput = async function (inputElement, file) {
        if (!inputElement || !file) {
            //alert('Upload failed: Invalid input element or file');
            return false;
        }

        try {
            // 方法1: 使用DataTransfer API
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            inputElement.files = dataTransfer.files;

            // 方法2: 尝试触发change事件
            if (typeof inputElement.dispatchEvent === "function") {
                const changeEvent = new Event("change", { bubbles: true });
                inputElement.dispatchEvent(changeEvent);
            }

            // 方法3: 尝试触发input事件
            if (typeof inputElement.dispatchEvent === "function") {
                const inputEvent = new Event("input", { bubbles: true });
                inputElement.dispatchEvent(inputEvent);
            }

            await window.delay(80);
            return true;
        } catch (error) {
            //alert('File upload failed: ' + error.message);
            return false;
        }
    };

    function decodeBase64ToBytes(base64Data) {
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }

    function detectMimeTypeFromBytes(bytes, fallbackType = "application/octet-stream") {
        if (!bytes || bytes.length < 4) {
            return fallbackType;
        }

        if (
            bytes.length >= 8 &&
            bytes[0] === 0x89 &&
            bytes[1] === 0x50 &&
            bytes[2] === 0x4E &&
            bytes[3] === 0x47 &&
            bytes[4] === 0x0D &&
            bytes[5] === 0x0A &&
            bytes[6] === 0x1A &&
            bytes[7] === 0x0A
        ) {
            return "image/png";
        }

        if (
            bytes.length >= 6 &&
            bytes[0] === 0x47 &&
            bytes[1] === 0x49 &&
            bytes[2] === 0x46 &&
            bytes[3] === 0x38 &&
            (bytes[4] === 0x37 || bytes[4] === 0x39) &&
            bytes[5] === 0x61
        ) {
            return "image/gif";
        }

        if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
            return "image/jpeg";
        }

        if (
            bytes.length >= 12 &&
            bytes[0] === 0x52 &&
            bytes[1] === 0x49 &&
            bytes[2] === 0x46 &&
            bytes[3] === 0x46 &&
            bytes[8] === 0x57 &&
            bytes[9] === 0x45 &&
            bytes[10] === 0x42 &&
            bytes[11] === 0x50
        ) {
            return "image/webp";
        }

        if (bytes[0] === 0x42 && bytes[1] === 0x4D) {
            return "image/bmp";
        }

        return fallbackType;
    }

    function normalizeDownloadedResult(result, fallbackType = "application/octet-stream", label = "downloadFile") {
        const sourceType = String(result?.contentType || fallbackType || "application/octet-stream")
            .split(";")[0]
            .trim()
            .toLowerCase();
        const bytes = decodeBase64ToBytes(result.data);
        const detectedType = detectMimeTypeFromBytes(bytes, sourceType);
        const contentType = detectedType || sourceType || fallbackType;

        if (sourceType && detectedType && sourceType !== detectedType) {
            console.warn(`[${label}] ⚠️ 响应头类型与文件签名不一致:`, {
                headerType: sourceType,
                detectedType,
            });
        }

        return {
            bytes,
            blob: new Blob([bytes], { type: contentType }),
            contentType,
            sourceType,
            detectedType,
        };
    }

    async function normalizeBlobResult(blob, fallbackType = "application/octet-stream", label = "downloadFile") {
        const sourceType = String(blob?.type || fallbackType || "application/octet-stream")
            .split(";")[0]
            .trim()
            .toLowerCase();

        if (typeof blob?.arrayBuffer !== "function") {
            return {
                blob,
                contentType: sourceType || fallbackType,
                sourceType,
                detectedType: sourceType || fallbackType,
            };
        }

        const bytes = new Uint8Array(await blob.arrayBuffer());
        const detectedType = detectMimeTypeFromBytes(bytes, sourceType || fallbackType);
        const contentType = detectedType || sourceType || fallbackType;

        if (sourceType && detectedType && sourceType !== detectedType) {
            console.warn(`[${label}] ⚠️ Blob 类型与文件签名不一致:`, {
                headerType: sourceType,
                detectedType,
            });
        }

        return {
            blob: new Blob([bytes], { type: contentType }),
            contentType,
            sourceType,
            detectedType,
        };
    }

    function resolveImageExtension(pathImage, contentType) {
        const normalizedType = String(contentType || "").toLowerCase();
        if (normalizedType.includes("jpeg") || normalizedType.includes("jpg")) return ".jpg";
        if (normalizedType.includes("png")) return ".png";
        if (normalizedType.includes("gif")) return ".gif";
        if (normalizedType.includes("webp")) return ".webp";
        if (normalizedType.includes("bmp")) return ".bmp";
        if (normalizedType.includes("svg")) return ".svg";
        if (normalizedType.includes("ico")) return ".ico";

        if (pathImage && pathImage.includes(".")) {
            const urlExt = pathImage.split(".").pop().split("?")[0].toLowerCase();
            if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "ico"].includes(urlExt)) {
                return urlExt === "jpeg" ? ".jpg" : `.${urlExt}`;
            }
        }

        return ".jpg";
    }

    function createUnsupportedImageError(contentType, pathImage, detectedType = "", sourceType = "") {
        const normalizedType = String(contentType || "").toLowerCase();
        const isGif = normalizedType.includes("gif");
        const error = new Error(
            isGif
                ? "检测到原图为 GIF 格式，小红书不支持 GIF 及其转化图片，请更换 PNG/JPG/WebP 静态图"
                : `检测到不支持的图片格式: ${normalizedType || "unknown"}`
        );
        error.code = isGif ? "UNSUPPORTED_GIF_IMAGE" : "UNSUPPORTED_IMAGE_TYPE";
        error.contentType = normalizedType || "unknown";
        error.detectedType = detectedType || normalizedType || "unknown";
        error.sourceType = sourceType || normalizedType || "unknown";
        error.pathImage = pathImage || "";
        return error;
    }

    // 通用文件下载函数（绕过跨域限制）
    window.downloadFile = async function (url, defaultType = "application/octet-stream") {
        if (!url) {
            throw new Error("Download URL is required");
        }

        console.log("[downloadFile] 开始下载:", url);

        let blob;
        let contentType = defaultType;

        const isImageDownload = String(defaultType || "").toLowerCase().startsWith("image/");
        const downloadByMainProcess = isImageDownload && window.browserAPI?.downloadImage
            ? window.browserAPI.downloadImage
            : window.browserAPI?.downloadVideo;

        const executeWithRetry = typeof window.retryOperation === "function"
            ? window.retryOperation
            : async operation => operation();
        let attemptCount = 0;
        const downloadResult = await executeWithRetry(
            async () => {
                attemptCount += 1;
                if (attemptCount > 1) {
                    console.log(`[downloadFile] 第 ${attemptCount} 次重试下载...`);
                }

                try {
                if (downloadByMainProcess) {
                    console.log("[downloadFile] 使用主进程下载...");
                    const result = await downloadByMainProcess(url);

                    if (!result.success) {
                        throw new Error("Download failed: " + result.error);
                    }

                    const normalized = normalizeDownloadedResult(result, defaultType, "downloadFile");
                    console.log("[downloadFile] 主进程下载成功，大小:", result.size, "bytes, 类型:", normalized.contentType);
                    return {
                        blob: normalized.blob,
                        contentType: normalized.contentType,
                    };
                }

                // 回退到 fetch（可能有跨域问题）
                console.log("[downloadFile] browserAPI 下载能力不可用，使用 fetch...");
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error("HTTP error! status: " + response.status);
                }
                const downloadedBlob = await response.blob();
                const normalized = await normalizeBlobResult(
                    downloadedBlob,
                    response.headers.get("Content-Type") || downloadedBlob.type || defaultType,
                    "downloadFile"
                );
                return {
                    blob: normalized.blob,
                    contentType: normalized.contentType,
                };
                } catch (downloadErr) {
                    // 失败原因必须落日志：此前重试 5 次只打"第 N 次重试"不带原因，
                    // 现场（如腾讯号正文图片连挂 5 次）完全无法确诊是防盗链/超时/网络
                    console.warn(`[downloadFile] ❌ 第 ${attemptCount} 次下载失败:`, downloadErr.message, "| URL:", url);
                    throw downloadErr;
                }
            },
            5,
            3000,
        );

        blob = downloadResult.blob;
        contentType = downloadResult.contentType;

        return { blob, contentType };
    };

    // 上传视频到input元素
    window.uploadVideo = async function (dataObj, shadowRoot = undefined) {
        const pathImage = dataObj?.video?.video?.url;
        console.log("🚀 ~ uploadVideo ~ pathImage: ", pathImage);
        if (!pathImage) {
            //alert('No video URL found');
            return;
        }

        console.log("[uploadVideo] 开始下载视频:", pathImage);

        let blob;
        let contentType = "video/mp4";

        // 优先使用主进程下载（绕过跨域限制），添加重试机制防止并发下载时连接被重置
        const downloadResult = await retryOperation(
            async () => {
                if (window.browserAPI?.downloadVideo) {
                    console.log("[uploadVideo] 使用主进程下载...");
                    const result = await window.browserAPI.downloadVideo(pathImage);

                    if (!result.success) {
                        throw new Error("Video download failed: " + result.error);
                    }

                    // 将 base64 转换为 Blob
                    const binaryString = atob(result.data);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    const downloadedBlob = new Blob([bytes], { type: result.contentType });
                    console.log("[uploadVideo] 主进程下载成功，大小:", result.size, "bytes");
                    return { blob: downloadedBlob, contentType: result.contentType };
                } else {
                    // 回退到 fetch（可能有跨域问题）
                    console.log("[uploadVideo] browserAPI.downloadVideo 不可用，使用 fetch...");
                    const response = await fetch(pathImage);
                    if (!response.ok) {
                        throw new Error("HTTP error! status: " + response.status);
                    }
                    const downloadedBlob = await response.blob();
                    const type = response.headers.get("Content-Type") || downloadedBlob.type || "video/mp4";
                    return { blob: downloadedBlob, contentType: type };
                }
            },
            5,
            3000,
        ); // 最多重试5次，每次间隔3秒（处理并发下载时的 ECONNRESET 错误）

        blob = downloadResult.blob;
        contentType = downloadResult.contentType;

        // 从 URL 或 Content-Type 中提取文件扩展名
        let extension = ".mp4"; // 默认扩展名
        if (pathImage.includes(".")) {
            const urlExt = pathImage.split(".").pop().split("?")[0].toLowerCase();
            if (["mp4", "mov", "avi", "webm", "mkv", "flv"].includes(urlExt)) {
                extension = "." + urlExt;
            }
        } else if (contentType.includes("mp4")) {
            extension = ".mp4";
        } else if (contentType.includes("webm")) {
            extension = ".webm";
        } else if (contentType.includes("quicktime")) {
            extension = ".mov";
        }

        // 构建文件名，确保有扩展名
        let fileName = dataObj?.video?.formData?.title || "video";
        if (!fileName.toLowerCase().endsWith(extension.toLowerCase())) {
            fileName = fileName + extension;
        }

        const file = new File([blob], fileName, { type: contentType });

        // 等待上传按钮（使用重试机制，最多等待60秒）
        console.log("[uploadVideo] 开始查找上传 input 元素...");
        let uploadInput;
        if (!shadowRoot) {
            // 如果没有Shadow DOM，尝试直接查找
            uploadInput = await waitForElement('input[type="file"]', 30000);
        } else {
            // 深入Shadow DOM查找，使用重试机制（deepShadowSearch 超时时间短，需要多次重试）
            uploadInput = await retryOperation(
                async () => {
                    return await deepShadowSearch(shadowRoot, 'input[type="file"]', 5);
                },
                30,
                2000,
            ); // 最多重试30次，每次间隔2秒，总共最多60秒
        }
        console.log("[uploadVideo] ✅ 找到上传 input 元素:", uploadInput ? "success" : "failed");

        // 执行文件上传
        //alert('Uploading file: ' + file.name);
        await uploadFileToInput(uploadInput, file);

        // 等待上传完成并填写表单
        await window.delay(3000);
    };

    // 上传图片到input元素
    window.uploadImage = async function (dataObj, shadowRoot = undefined) {
        const pathImage = dataObj?.sourceUrl
            || dataObj?.video?.video?.url
            || dataObj?.video?.video?.cover
            || dataObj?.element?.image
            || dataObj?.element?.image_url
            || dataObj?.element?.imageUrl
            || dataObj?.element?.url;
        console.log("🚀 ~ uploadImage ~ pathImage: ", pathImage);
        if (!pathImage) {
            //alert('No image URL found');
            return;
        }

        console.log("[uploadImage] 开始下载图片:", pathImage);

        let blob;
        let contentType = "image/jpeg";

        // 优先使用主进程下载（绕过跨域限制），添加重试机制防止并发下载时连接被重置
        const downloadResult = await retryOperation(
            async () => {
                if (window.browserAPI?.downloadImage || window.browserAPI?.downloadVideo) {
                    console.log("[uploadImage] 使用主进程下载...");
                    const downloader = window.browserAPI.downloadImage || window.browserAPI.downloadVideo;
                    const result = await downloader(pathImage);

                    if (!result.success) {
                        throw new Error("Image download failed: " + result.error);
                    }

                    const normalized = normalizeDownloadedResult(result, "image/jpeg", "uploadImage");
                    const downloadedBlob = normalized.blob;
                    console.log("[uploadImage] 主进程下载成功，大小:", result.size, "bytes");
                    return {
                        blob: downloadedBlob,
                        contentType: normalized.contentType,
                        sourceType: normalized.sourceType,
                        detectedType: normalized.detectedType,
                    };
                } else {
                    // 回退到 fetch（可能有跨域问题）
                    console.log("[uploadImage] browserAPI 下载能力不可用，使用 fetch...");
                    const response = await fetch(pathImage);
                    if (!response.ok) {
                        throw new Error("HTTP error! status: " + response.status);
                    }
                    const downloadedBlob = await response.blob();
                    const normalized = await normalizeBlobResult(
                        downloadedBlob,
                        response.headers.get("Content-Type") || downloadedBlob.type || "image/jpeg",
                        "uploadImage"
                    );
                    return {
                        blob: normalized.blob,
                        contentType: normalized.contentType,
                        sourceType: normalized.sourceType,
                        detectedType: normalized.detectedType,
                    };
                }
            },
            5,
            3000,
        ); // 最多重试5次，每次间隔3秒（处理并发下载时的 ECONNRESET 错误）

        blob = downloadResult.blob;
        contentType = downloadResult.contentType;

        if (String(contentType || "").toLowerCase().includes("gif")) {
            console.warn("[uploadImage] ⚠️ 检测到 GIF 图片，已在上传前拦截:", {
                pathImage,
                contentType,
                detectedType: downloadResult.detectedType,
                sourceType: downloadResult.sourceType,
            });
            throw createUnsupportedImageError(
                contentType,
                pathImage,
                downloadResult.detectedType,
                downloadResult.sourceType
            );
        }

        // 从 URL 或 Content-Type 中提取文件扩展名
        const extension = resolveImageExtension(pathImage, contentType);

        // 构建文件名，确保有扩展名
        let fileName = dataObj?.video?.formData?.title || dataObj?.image?.formData?.title || "image";
        if (!fileName.toLowerCase().endsWith(extension.toLowerCase())) {
            fileName = fileName + extension;
        }

        const file = new File([blob], fileName, { type: contentType });

        // 等待上传按钮（使用重试机制，最多等待60秒）
        console.log("[uploadImage] 开始查找上传 input 元素...");
        let uploadInput;
        if (!shadowRoot) {
            // 如果没有Shadow DOM，尝试直接查找
            uploadInput = await waitForElement('input[type="file"]', 30000);
        } else {
            // 深入Shadow DOM查找，使用重试机制（deepShadowSearch 超时时间短，需要多次重试）
            uploadInput = await retryOperation(
                async () => {
                    return await deepShadowSearch(shadowRoot, 'input[type="file"]', 5);
                },
                30,
                2000,
            ); // 最多重试30次，每次间隔2秒，总共最多60秒
        }
        console.log("[uploadImage] ✅ 找到上传 input 元素:", uploadInput ? "success" : "failed");

        // 执行文件上传
        //alert('Uploading file: ' + file.name);
        await uploadFileToInput(uploadInput, file);

        // 等待上传完成并填写表单
        await window.delay(3000);
    };

    /* 给react的input、checkbox、radio赋值 */
    window.setNativeValue = function (el, value) {
        if (!el) return false;

        const previousValue = el.value;

        if (el.type === "checkbox" || el.type === "radio") {
            if ((!!value && !el.checked) || (!!!value && el.checked)) {
                el.click();
            }
        } else {
            el.value = value;
        }

        const tracker = el._valueTracker;
        if (tracker) {
            tracker.setValue(previousValue);
        }

        // 'change' instead of 'input', see https://github.com/facebook/react/issues/11488#issuecomment-381590324
        try {
            // 安全地触发事件 - 完整的事件序列
            if (typeof el.dispatchEvent === "function") {
                // 先触发input事件
                el.dispatchEvent(
                    new InputEvent("input", {
                        bubbles: true,
                        cancelable: true,
                        inputType: "insertText",
                        data: value,
                    }),
                );
                // 再触发change事件
                el.dispatchEvent(new Event("change", { bubbles: true }));
                // 最后触发blur确保React更新
                el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
            } else if (typeof el.onchange === "function") {
                el.onchange(new Event("change"));
            } else {
                // 如果所有方法都不可用，尝试其他事件
                if (typeof el.dispatchEvent === "function") {
                    el.dispatchEvent(new Event("input", { bubbles: true }));
                } else if (typeof el.oninput === "function") {
                    el.oninput(new Event("input"));
                }
            }
            return true;
        } catch (error) {
            // alert('setNativeValue error: ' + error.message);
            return false;
        }
    };

    function getNativeInputDelay() {
        return typeof window.delay === "function"
            ? window.delay
            : (ms) => new Promise(resolve => setTimeout(resolve, ms));
    }

    function isVisibleForNativeClick(element) {
        if (!element || typeof element.getBoundingClientRect !== "function") {
            return false;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return false;
        }
        const style = window.getComputedStyle(element);
        return style.display !== "none"
            && style.visibility !== "hidden"
            && style.opacity !== "0"
            && style.pointerEvents !== "none";
    }

    function isElementCenterInViewport(element, margin = 8) {
        if (!element || typeof element.getBoundingClientRect !== "function") {
            return false;
        }

        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return false;
        }

        const viewportWidth = Math.max(document.documentElement?.clientWidth || 0, window.innerWidth || 0);
        const viewportHeight = Math.max(document.documentElement?.clientHeight || 0, window.innerHeight || 0);
        const safeMargin = Math.max(0, Number.isFinite(Number(margin)) ? Number(margin) : 8);
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        return centerX >= safeMargin
            && centerX <= viewportWidth - safeMargin
            && centerY >= safeMargin
            && centerY <= viewportHeight - safeMargin;
    }

    window.scrollElementIntoViewIfNeeded = function (element, options = {}) {
        if (!element || typeof element.scrollIntoView !== "function") {
            return false;
        }

        const margin = Number.isFinite(Number(options.margin)) ? Number(options.margin) : 8;
        if (isElementCenterInViewport(element, margin)) {
            return false;
        }

        element.scrollIntoView({
            behavior: options.behavior || "instant",
            block: options.block || "nearest",
            inline: options.inline || "nearest",
        });
        return true;
    };

    // 点击坐标命中校验：elementFromPoint 命中目标自身或其后代才算命中
    // （元素被滚动容器裁剪/sticky 浮层遮挡时，视口几何判断感知不到，命中的会是遮挡物）
    // 注意：目标在 Shadow DOM 内时 document.elementFromPoint 返回宿主，校验会误判未命中，
    //       因此校验失败只触发一次补救滚动，不阻断点击（fail-open 与旧行为兼容）
    function isNativeClickHitOnTarget(target, hitEl) {
        if (!target || !hitEl) return false;
        if (hitEl === target) return true;
        return typeof target.contains === "function" && target.contains(hitEl);
    }

    function resolveNativeClickTarget(element) {
        if (!element) return null;
        const closest = typeof element.closest === "function"
            ? selector => {
                try { return element.closest(selector); } catch (_) { return null; }
            }
            : () => null;
        const candidates = [
            closest("label"),
            closest("[role='button']"),
            closest("[role='switch']"),
            closest(".custom-switch-switch"),
            closest(".d-switch"),
            closest(".d-checkbox"),
            closest(".d-radio"),
            element,
        ].filter(Boolean);

        return candidates.find(isVisibleForNativeClick) || element;
    }

    window.nativeClickElement = async function (element, options = {}) {
        const logPrefix = options.logPrefix || "[nativeClickElement]";
        const delayFn = getNativeInputDelay();
        const allowJsFallback = options.allowJsFallback === true;
        const target = options.target || resolveNativeClickTarget(element);

        if (!target) {
            return { success: false, message: "元素不存在" };
        }

        if (!window.browserAPI || typeof window.browserAPI.nativeClick !== "function") {
            const message = "browserAPI.nativeClick 不可用";
            console.warn(`${logPrefix} ⚠️ ${message}`);
            if (allowJsFallback && typeof target.click === "function") {
                target.click();
                return { success: true, message: "已回退到 element.click", fallback: "element.click" };
            }
            return { success: false, message };
        }

        try {
            if (options.scroll !== false && typeof target.scrollIntoView === "function") {
                const didScroll = typeof window.scrollElementIntoViewIfNeeded === "function"
                    ? window.scrollElementIntoViewIfNeeded(target, {
                        margin: options.scrollMargin,
                        behavior: "instant",
                        block: options.scrollBlock || "nearest",
                        inline: options.scrollInline || "nearest",
                    })
                    : false;
                if (didScroll) {
                    await delayFn(Number.isFinite(options.delayAfterScroll) ? options.delayAfterScroll : 120);
                }
            }

            if (!isVisibleForNativeClick(target)) {
                return { success: false, message: "元素不可见或不可点击" };
            }

            let rect = target.getBoundingClientRect();
            let x = rect.left + rect.width / 2;
            let y = rect.top + rect.height / 2;
            let hitEl = document.elementFromPoint(x, y);

            // 🛡️ 命中校验兜底：元素中心在视口内但被滚动容器裁剪（如时间选择器列表）或
            // sticky/fixed 浮层遮挡时，scrollElementIntoViewIfNeeded 的纯几何判断会跳过滚动，
            // 此时坐标点击会打在遮挡物上。这里检测到未命中就强制居中滚动一次再重算坐标
            if (!isNativeClickHitOnTarget(target, hitEl)
                && options.scroll !== false
                && typeof target.scrollIntoView === "function") {
                console.warn(`${logPrefix} ⚠️ 点击坐标未命中目标（命中: ${hitEl?.tagName || "无"}），强制居中滚动后重算坐标`);
                target.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
                await delayFn(Number.isFinite(options.delayAfterScroll) ? options.delayAfterScroll : 120);
                rect = target.getBoundingClientRect();
                x = rect.left + rect.width / 2;
                y = rect.top + rect.height / 2;
                hitEl = document.elementFromPoint(x, y);
                if (!isNativeClickHitOnTarget(target, hitEl)) {
                    // Shadow DOM 内目标会走到这里（elementFromPoint 返回宿主），按原行为继续点击
                    console.warn(`${logPrefix} ⚠️ 滚动后仍未命中目标（命中: ${hitEl?.tagName || "无"}），按原行为继续点击`);
                }
            }

            const hitClass = hitEl && typeof hitEl.className !== "undefined"
                ? String(hitEl.className).substring(0, 80)
                : "";

            console.log(`${logPrefix} 🔍 nativeClick 坐标:`, x, y, "命中元素:", hitEl?.tagName, hitClass);
            const result = await window.browserAPI.nativeClick(x, y);
            console.log(`${logPrefix} 🔍 nativeClick 返回:`, JSON.stringify(result));

            if (!result || !result.success) {
                return {
                    success: false,
                    message: result?.error || "nativeClick 失败",
                    result,
                };
            }

            return {
                success: true,
                message: "点击成功",
                result,
                x,
                y,
            };
        } catch (error) {
            console.error(`${logPrefix} ❌ nativeClickElement 失败:`, error);
            if (allowJsFallback && typeof target.click === "function") {
                target.click();
                return { success: true, message: "已回退到 element.click", fallback: error.message };
            }
            return { success: false, message: error.message || String(error) };
        }
    };

    window.nativeInsertText = async function (text, options = {}) {
        const logPrefix = options.logPrefix || "[nativeInsertText]";
        const value = String(text ?? "");

        if (!value) {
            return { success: true, length: 0 };
        }

        if (!window.browserAPI || typeof window.browserAPI.nativeInsertText !== "function") {
            const message = "browserAPI.nativeInsertText 不可用";
            console.warn(`${logPrefix} ⚠️ ${message}`);
            return { success: false, message };
        }

        try {
            const result = await window.browserAPI.nativeInsertText(value);
            if (!result || !result.success) {
                return {
                    success: false,
                    message: result?.error || "nativeInsertText 失败",
                    result,
                };
            }
            return {
                success: true,
                length: result.length ?? value.length,
                result,
            };
        } catch (error) {
            console.error(`${logPrefix} ❌ nativeInsertText 失败:`, error);
            return { success: false, message: error.message || String(error) };
        }
    };

    // 等待Shadow DOM中的元素（优化版 - 支持多选择器和重试）
    window.waitForShadowElement = function (hostSelector, shadowSelector, timeout = 30000, checkInterval = 200) {
        const startTime = Date.now();
        const selectors = Array.isArray(shadowSelector) ? shadowSelector : [shadowSelector];

        return new Promise((resolve, reject) => {
            async function check() {
                if (Date.now() - startTime > timeout) {
                    reject(new Error(`Shadow 元素超时: ${selectors.join(" | ")}`));
                    return;
                }

                try {
                    // 查找宿主元素
                    const host = document.querySelector(hostSelector);
                    if (!host) {
                        setTimeout(check, checkInterval);
                        return;
                    }

                    // 等待 shadowRoot 可用
                    if (!host.shadowRoot) {
                        setTimeout(check, checkInterval);
                        return;
                    }

                    // 🔑 尝试所有选择器
                    for (const selector of selectors) {
                        const element = host.shadowRoot.querySelector(selector);
                        if (element) {
                            console.log(`[waitForShadowElement] ✅ 找到: ${selector}`);
                            resolve(element);
                            return;
                        }
                    }

                    // 没找到，继续等待
                    setTimeout(check, checkInterval);
                } catch (error) {
                    setTimeout(check, checkInterval);
                }
            }

            check();
        });
    };

    // 深度搜索Shadow DOM中的元素（修复版 - 防止白屏，增加超时）
    window.deepShadowSearch = function (rootElement, selector, maxDepth = 3, timeout = 5000) {
        return new Promise((resolve, reject) => {
            let resolved = false; // 防止多次 resolve
            const startTime = Date.now();
            const selectors = Array.isArray(selector) ? selector : [selector];

            function searchInShadow(element, depth) {
                // 已经找到了，直接返回
                if (resolved) {
                    return;
                }

                // 🔑 检查超时
                if (Date.now() - startTime > timeout) {
                    return;
                }

                // 超过最大深度
                if (depth > maxDepth) {
                    return;
                }

                // 🔑 在当前元素中查找（支持多选择器）
                try {
                    for (const sel of selectors) {
                        const found = element.querySelector(sel);
                        if (found && !resolved) {
                            resolved = true;
                            console.log(`[deepShadowSearch] ✅ 找到: ${sel}`);
                            resolve(found);
                            return;
                        }
                    }
                } catch (error) {
                    // querySelector 可能在某些情况下失败，继续搜索
                }

                // 查找Shadow DOM
                if (element.shadowRoot && !resolved) {
                    searchInShadow(element.shadowRoot, depth + 1);
                }

                // 查找iframe
                if (!resolved) {
                    const iframes = element.querySelectorAll("iframe");
                    for (const iframe of iframes) {
                        if (resolved) break; // 已找到，退出循环
                        try {
                            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                            if (iframeDoc) {
                                searchInShadow(iframeDoc, depth + 1);
                            }
                        } catch (error) {
                            // 跨域iframe无法访问，跳过
                        }
                    }
                }

                // 递归查找子元素中的 Shadow DOM（不递归普通子元素，避免爆炸）
                if (!resolved && depth < maxDepth) {
                    const children = element.children || [];
                    for (const child of children) {
                        if (resolved) break; // 已找到，退出循环
                        if (child.nodeType === Node.ELEMENT_NODE && child.shadowRoot) {
                            searchInShadow(child, depth + 1);
                        }
                    }
                }
            }

            searchInShadow(rootElement, 0);

            // 🔑 使用配置的超时时间（而不是固定 100ms）
            setTimeout(() => {
                if (!resolved) {
                    reject(new Error(`找不到元素: ${selectors.join(" | ")}`));
                }
            }, timeout);
        });
    };

    // ===========================
    // 公共发布方法
    // ===========================

    // 根据主窗口域名获取 API 域名（用于授权等接口）
    // 返回格式：https://dev.china9.cn 或 https://api.china9.cn
    window.getApiDomain = async function () {
        // 开发环境域名列表
        const devHosts = [
            "localhost:5173",
            "localhost:8080",
            "127.0.0.1:5173",
            "127.0.0.1:8080",
            "dev.china9.cn",
            "www.dev.china9.cn",
            "172.16.6.17:8080",
            "jzt_dev_1.china9.cn",
        ];

        // 默认使用开发环境
        let apiDomain = "https://dev.china9.cn";

        try {
            if (window.browserAPI && window.browserAPI.getMainUrl) {
                const mainInfo = await window.browserAPI.getMainUrl();
                if (mainInfo.success && mainInfo.host) {
                    const host = mainInfo.host.toLowerCase();

                    // 检查是否是开发环境（精确匹配，避免 china9.cn 被 dev.china9.cn 误匹配）
                    const isDev = devHosts.some(devHost => host === devHost || host.endsWith('.' + devHost) || devHost === host);

                    if (isDev) {
                        apiDomain = "https://dev.china9.cn";
                        console.log("[getApiDomain] 检测到开发环境:", host, "→", apiDomain);
                    } else {
                        // 生产环境
                        apiDomain = "https://api.china9.cn";
                        console.log("[getApiDomain] 检测到生产环境:", host, "→", apiDomain);
                    }
                }
            }
        } catch (e) {
            console.warn("[getApiDomain] 获取主窗口 URL 失败，使用默认开发环境:", e);
        }

        return apiDomain;
    };

    // 根据主窗口域名获取统计接口 URL
    window.getStatisticsUrl = async function (isError = false) {
        const endpoint = isError ? "tjlogerror" : "tjlog";

        // 特殊域名映射（GEO 系统等）
        const specialUrlMap = {
            "jzt_dev_1.china9.cn": `https://jzt_dev_1.china9.cn/api/geo/${endpoint}`,
            "zhjzt.china9.cn": `https://zhjzt.china9.cn/api/geo/${endpoint}`,
            "172.16.6.17:8080": `https://jzt_dev_1.china9.cn/api/geo/${endpoint}`,
            "localhost:8080": `https://jzt_dev_1.china9.cn/api/geo/${endpoint}`,
        };

        try {
            if (window.browserAPI && window.browserAPI.getMainUrl) {
                const mainInfo = await window.browserAPI.getMainUrl();
                if (mainInfo.success && mainInfo.host) {
                    // 检查特殊域名映射
                    if (specialUrlMap[mainInfo.host]) {
                        return specialUrlMap[mainInfo.host];
                    }

                    // AIGC 域名下访问 /geo/ 路径时，也走 GEO 上报域名
                    if (mainInfo.url && (mainInfo.url.includes('/geo/') || mainInfo.url.includes('#/geo'))) {
                        const devHosts = [
                            "localhost:5173", "127.0.0.1:5173",
                            "dev.china9.cn", "www.dev.china9.cn",
                        ];
                        const isDev = devHosts.some(h => mainInfo.host.toLowerCase() === h);
                        const geoDomain = isDev
                            ? `https://jzt_dev_1.china9.cn`
                            : `https://zhjzt.china9.cn`;
                        return `${geoDomain}/api/geo/${endpoint}`;
                    }
                }
            }
        } catch (e) {
            console.warn("[统计接口] 获取主窗口 URL 失败:", e);
        }

        // 使用通用的 API 域名
        const apiDomain = await window.getApiDomain();
        return `${apiDomain}/api/mediaauth/${endpoint}`;
    };

    function evaluateStatisticsResponse(response, parsed) {
        if (!response || !response.ok) {
            return { ok: false, code: parsed ? parsed.code : undefined };
        }

        if (!parsed || typeof parsed !== "object") {
            return { ok: true, code: response.status, reason: "http-ok-without-json" };
        }

        if (!Object.prototype.hasOwnProperty.call(parsed, "code")) {
            return { ok: true, code: response.status, reason: "http-ok-without-code" };
        }

        const numericCode = Number(parsed.code);
        return {
            ok: Number.isFinite(numericCode) && numericCode === 200,
            code: parsed.code,
            reason: "business-code"
        };
    }

    function formatStatisticsResponseError(response, parsed) {
        return `status=${response ? response.status : "N/A"} code=${parsed ? parsed.code : "N/A"} msg=${parsed ? (parsed.message || parsed.msg || "") : "N/A"}`;
    }

    // ===========================
    // 📡 统计上报底层单次请求（供 sendStatistics/sendStatisticsError 重试与离线补报队列复用）
    // ⚠️ 逻辑须与 sendStatistics / sendStatisticsError 内联 fetch 保持一致：
    //    10s 超时 + keepalive + 响应校验（HTTP 2xx 且没有明确业务失败码）
    // 失败抛错（触发上层 retryOperation 重试或补报队列保留），成功返回 { response, parsed, evaluation }
    // ===========================
    window.postStatisticsRequest = async function (url, scanData, timeoutMs = 10000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(scanData),
                keepalive: true,
                signal: controller.signal,
            });
            const text = await response.text();
            let parsed = null;
            try { parsed = JSON.parse(text); } catch (_) {}
            const evaluation = evaluateStatisticsResponse(response, parsed);
            if (!evaluation.ok) {
                throw new Error(formatStatisticsResponseError(response, parsed));
            }
            return { response, parsed, evaluation };
        } finally {
            clearTimeout(timeoutId);
        }
    };

    // 判断是否为 GEO 系统统计接口（用于：跳过乐观上报、不入补报队列、日志标记）
    // 注意：GEO 的成功/失败上报与普通系统一样走去重锁，同一 publishId 只上报 1 次
    window.isGeoStatisticsReport = function (url) {
        return String(url || '').includes('/api/geo/');
    };

    // ===========================
    // 🔐 关闭前保存会话到后台（与 creator.js 走同一接口和 body 格式）
    // 用于发布窗口关闭前主动上报最新登录信息，避免主进程的轻量 {id, cookies} 格式被后台拒绝
    // 返回: { success, status, code, message, uid, nickname, cookiesLen, response, error }
    // ===========================
    const SHIPINHAO_SAVE_DEDUP_COOKIE_NAMES = new Set(['sessionid', 'wxuin', 'pass_ticket', 'wxsid', 'wxload']);

    function normalizeCookieDomainForPublishSave(domain) {
        return String(domain || '').toLowerCase().replace(/^\./, '');
    }

    function buildPublishSaveCookieKey(cookie) {
        return [
            String(cookie && cookie.name || ''),
            String(cookie && cookie.domain || '').toLowerCase(),
            cookie && cookie.path || '/',
            cookie && cookie.secure ? '1' : '0'
        ].join('|');
    }

    function shouldPreferPublishSaveCookie(currentEntry, candidateEntry) {
        const current = currentEntry.cookie;
        const candidate = candidateEntry.cookie;
        const currentHasValue = current.value !== undefined && current.value !== null && String(current.value) !== '';
        const candidateHasValue = candidate.value !== undefined && candidate.value !== null && String(candidate.value) !== '';
        if (currentHasValue !== candidateHasValue) {
            return candidateHasValue;
        }
        const currentExpires = Number(current.expirationDate || 0);
        const candidateExpires = Number(candidate.expirationDate || 0);
        if (currentExpires !== candidateExpires) {
            return candidateExpires > currentExpires;
        }
        return candidateEntry.index > currentEntry.index;
    }

    function getShipinhaoPublishSaveDomainPriority(cookie) {
        const rawDomain = String(cookie && cookie.domain || '').toLowerCase();
        const domain = rawDomain.replace(/^\./, '');
        if (domain === 'channels.weixin.qq.com') return 60;
        if (domain === 'weixin.qq.com') return 45;
        if (domain === 'mp.weixin.qq.com') return 35;
        if (domain === 'wx.qq.com') return 30;
        if (domain === 'qq.com') return 20;
        return 0;
    }

    function shouldPreferShipinhaoPublishSaveCookie(currentEntry, candidateEntry) {
        const currentPriority = getShipinhaoPublishSaveDomainPriority(currentEntry.cookie);
        const candidatePriority = getShipinhaoPublishSaveDomainPriority(candidateEntry.cookie);
        if (currentPriority !== candidatePriority) {
            return candidatePriority > currentPriority;
        }
        return shouldPreferPublishSaveCookie(currentEntry, candidateEntry);
    }

    function dedupePublishSaveCookies(platform, cookies) {
        if (!Array.isArray(cookies) || cookies.length === 0) {
            return [];
        }

        const exactMap = new Map();
        cookies.forEach((cookie, index) => {
            if (!cookie || !cookie.name || !cookie.domain) {
                return;
            }
            const entry = { cookie: { ...cookie }, index };
            const key = buildPublishSaveCookieKey(entry.cookie);
            const current = exactMap.get(key);
            if (!current || shouldPreferPublishSaveCookie(current, entry)) {
                exactMap.set(key, entry);
            }
        });

        let entries = Array.from(exactMap.values());
        if (platform === 'shipinhao') {
            const grouped = new Map();
            const passthrough = [];
            entries.forEach(entry => {
                const cookie = entry.cookie;
                const name = String(cookie.name || '');
                const domain = normalizeCookieDomainForPublishSave(cookie.domain);
                if (SHIPINHAO_SAVE_DEDUP_COOKIE_NAMES.has(name)
                    && (domain === 'channels.weixin.qq.com'
                        || domain === 'weixin.qq.com'
                        || domain === 'mp.weixin.qq.com'
                        || domain === 'wx.qq.com'
                        || domain === 'qq.com')) {
                    const groupKey = `${name}|${cookie.path || '/'}`;
                    const current = grouped.get(groupKey);
                    if (!current || shouldPreferShipinhaoPublishSaveCookie(current, entry)) {
                        grouped.set(groupKey, entry);
                    }
                } else {
                    passthrough.push(entry);
                }
            });
            entries = passthrough.concat(Array.from(grouped.values()));
        }

        entries.sort((a, b) => a.index - b.index);
        const result = entries.map(entry => entry.cookie);
        if (result.length !== cookies.length) {
            console.log('[publishSaveSession] cookies 去重:', cookies.length, '->', result.length, 'platform=', platform);
        }
        return result;
    }

    window.__publishSaveSession__ = async function (platform) {
        // 每平台配置：getUserInfo 返回 { nickname, avatar, uid }；domains 是要抓 cookies 的域；apiPath 是后台保存接口
        const platformConfigs = {
            tengxunhao: {
                apiPath: '/api/mediaauth/txinfo',
                domains: ['qq.com', 'om.qq.com', 'image.om.qq.com', 'aqq.qq.com', 'account.qq.com', 'ptlogin2.qq.com'],
                getUserInfo: async () => {
                    const r = await fetch('https://om.qq.com/maccountsetting/basicinfo/?relogin=1', {
                        method: 'GET',
                        credentials: 'include'
                    });
                    const res = await r.json();
                    const ui = res && res.data && res.data.cpInfo;
                    if (!ui) throw new Error('腾讯 cpInfo 不存在');
                    return { nickname: ui.mediaName, avatar: ui.header, uid: ui.mediaId };
                }
            },
            sohuhao: {
                apiPath: '/api/mediaauth/shinfo',
                domains: ['mp.sohu.com', 'sohu.com'],
                getUserInfo: async (publishData) => {
                    // 1. 优先 localStorage.currentAccount（搜狐前端约定）
                    let ca = null;
                    try {
                        const raw = localStorage.getItem('currentAccount');
                        if (raw) ca = JSON.parse(raw);
                    } catch (_) {}
                    if (ca && ca.id) {
                        return { nickname: ca.nickName, avatar: ca.avatar, uid: ca.id };
                    }
                    // 2. 兜底从 publishData 取 uid（发布页 localStorage 可能为空）
                    const e = publishData && publishData.element || {};
                    const uid = e.uid || e.platformUid || e.media_auth_id || e.account_info && e.account_info.uid;
                    if (uid) {
                        return { nickname: e.nickname || e.account_info && e.account_info.nickname || '', avatar: e.avatar || '', uid: uid };
                    }
                    throw new Error('搜狐 currentAccount/publishData 均无 uid');
                }
            },
            douyin: {
                apiPath: '/api/mediaauth/douyininfo',
                domains: ['douyin.com', 'creator.douyin.com'],
                getUserInfo: async () => {
                    const r = await fetch('https://creator.douyin.com/web/api/media/user/info/', { method: 'GET', credentials: 'include' });
                    const res = await r.json();
                    // creator.js 中是 const {user} = apiData; 所以是 res.user，不是 res.data.user
                    const u = res && res.user;
                    if (!u || !u.nickname) throw new Error('抖音 user 不存在');
                    const avatar = u.avatar_thumb && u.avatar_thumb.url_list && u.avatar_thumb.url_list[0] || u.avatar || '';
                    return { nickname: u.nickname, avatar: avatar, uid: u.uid || u.user_id || u.sec_uid };
                }
            },
            baijiahao: {
                apiPath: '/api/mediaauth/bjhinfo',
                domains: ['baidu.com', 'baijiahao.baidu.com'],
                getUserInfo: async () => {
                    const r = await fetch('https://baijiahao.baidu.com/builder/app/appinfo', { method: 'GET', credentials: 'include' });
                    const res = await r.json();
                    const u = res && res.data && res.data.user;
                    if (!u) throw new Error('百家号 user 不存在');
                    return { nickname: u.name, avatar: u.avatar, uid: u.id };
                }
            },
            toutiao: {
                apiPath: '/api/mediaauth/ttinfo',
                domains: ['toutiao.com', 'www.toutiao.com', 'mp.toutiao.com', '.bytedance.com', 'snssdk.com'],
                getUserInfo: async () => {
                    const r = await fetch('https://mp.toutiao.com/mp/agw/media/get_media_info', { method: 'GET', credentials: 'include' });
                    const res = await r.json();
                    const u = res && res.data && res.data.user;
                    if (!u) throw new Error('头条 user 不存在');
                    return { nickname: u.screen_name, avatar: u.https_avatar_url || u.avatar_url, uid: u.id || u.user_id };
                }
            },
            wangyihao: {
                apiPath: '/api/mediaauth/wyinfo',
                domains: ['163.com'],  // 163.com 能匹配 .163.com 和 mp.163.com
                getUserInfo: async () => {
                    const r = await fetch('https://mp.163.com/wemedia/navinfo.do', { method: 'GET', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
                    const res = await r.json();
                    if (res.code !== 1) throw new Error('网易号 navinfo code != 1');
                    const u = res.data;
                    if (!u) throw new Error('网易号 data 不存在');
                    return { nickname: u.tname, avatar: u.icon, uid: u.tid };
                }
            },
            zhihu: {
                apiPath: '/api/mediaauth/zhinfo',
                domains: ['zhihu.com', 'www.zhihu.com', 'zhuanlan.zhihu.com'],
                getUserInfo: async () => {
                    const r = await fetch('https://www.zhihu.com/api/v4/me?include=is_realname', { method: 'GET', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
                    const u = await r.json();
                    if (!u || !u.id) throw new Error('知乎 me 不存在');
                    return { nickname: u.name, avatar: u.avatar_url, uid: u.id };
                }
            },
            xinlang: {
                apiPath: '/api/mediaauth/xlinfo',
                domains: ['sina.com.cn', 'mp.sina.com.cn', 'weibo.com', 'card.weibo.com', 'sina.cn'],
                getUserInfo: async (publishData) => {
                    const API = 'https://mp.sina.com.cn/aj/media/info/getbaseinfo';
                    // 1) 先尝试浏览器 fetch（mp.sina.com.cn 同源时有效）
                    try {
                        const r = await fetch(API, { method: 'GET', credentials: 'include' });
                        const res = await r.json();
                        const u = res && res.data && res.data.userInfo;
                        if (u && u.uid) return { nickname: u.m_fname, avatar: u.m_logo, uid: u.uid };
                    } catch (e) {
                        console.warn('[xinlang getUserInfo] 浏览器 fetch 跨域失败:', e && e.message);
                    }
                    // 2) 主进程代理 fetch 绕 CORS（card.weibo.com 跨域 mp.sina.com.cn 时用）
                    try {
                        if (window.browserAPI && window.browserAPI.proxyFetch) {
                            const pr = await window.browserAPI.proxyFetch(API, { method: 'GET' });
                            if (pr && pr.success && pr.ok) {
                                const res = typeof pr.data === 'object' ? pr.data : null;
                                const u = res && res.data && res.data.userInfo;
                                if (u && u.uid) return { nickname: u.m_fname, avatar: u.m_logo, uid: u.uid };
                            } else {
                                console.warn('[xinlang getUserInfo] proxyFetch 失败:', pr && (pr.error || pr.status));
                            }
                        }
                    } catch (e) {
                        console.warn('[xinlang getUserInfo] proxyFetch 异常:', e && e.message);
                    }
                    // 3) 兜底：当前窗口绑定账号 → account.platformUid
                    try {
                        if (window.browserAPI && window.browserAPI.getCurrentAccount) {
                            const ar = await window.browserAPI.getCurrentAccount();
                            const acc = ar && ar.success && ar.account;
                            if (acc && acc.platformUid) {
                                return { nickname: acc.nickname || '', avatar: acc.avatar || '', uid: acc.platformUid };
                            }
                        }
                    } catch (e) {
                        console.warn('[xinlang getUserInfo] getCurrentAccount 兜底失败:', e && e.message);
                    }
                    // 4) 兜底：publishData.element
                    const e = publishData && publishData.element || {};
                    const uid = e.uid || e.platformUid || (e.account_info && (e.account_info.uid || e.account_info.platformUid));
                    if (uid) {
                        return {
                            nickname: e.nickname || (e.account_info && e.account_info.nickname) || '',
                            avatar: e.avatar || (e.account_info && e.account_info.avatar) || '',
                            uid: uid
                        };
                    }
                    throw new Error('新浪 fetch/proxyFetch/getCurrentAccount/publishData 均无 uid');
                }
            },
            xiaohongshu: {
                apiPath: '/api/mediaauth/xhsinfo',
                domains: ['xiaohongshu.com', 'creator.xiaohongshu.com', 'edith.xiaohongshu.com'],
                getUserInfo: async (publishData) => {
                    // 优先接口取（main.js 守卫会保证发布窗口能访问 creator.xiaohongshu.com 域名 cookies）
                    try {
                        const r = await fetch('https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info', {
                            method: 'GET',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' }
                        });
                        const res = await r.json();
                        const d = res && res.data;
                        if (d && d.red_num) {
                            return {
                                nickname: d.name,
                                avatar: d.avatar,
                                uid: d.red_num,
                                follower_count: d.fans_count,
                                favoriting_count: d.follow_count,
                                total_favorited: d.faved_count
                            };
                        }
                    } catch (e) {
                        console.warn('[xhs getUserInfo] 接口取失败:', e && e.message);
                    }
                    // 兜底从 publishData 取
                    const e = publishData && publishData.element || {};
                    if (e.uid || e.platformUid) {
                        return { nickname: e.nickname || '', avatar: e.avatar || '', uid: e.uid || e.platformUid };
                    }
                    throw new Error('小红书 接口/publishData 均无 uid');
                }
            },
            shipinhao: {
                apiPath: '/api/mediaauth/sphinfo',
                domains: ['weixin.qq.com', 'channels.weixin.qq.com', 'mp.weixin.qq.com', 'wx.qq.com', 'qq.com'],
                getUserInfo: async (publishData) => {
                    let finalResult = null;
                    // 优先 DOM 取
                    try {
                        const nicknameEle = document.querySelector('.finder-nickname, .nickname, [class*="nickname"]');
                        const avatarEle = document.querySelector('.finder-avatar img, .avatar img, img[class*="avatar"]');
                        const uidEle = Array.from(document.querySelectorAll('*')).find(e => /视频号 ?ID/i.test(e.textContent || ''));
                        const nickFromDom = nicknameEle ? (nicknameEle.innerText || '').trim() : '';
                        if (nickFromDom) {
                            finalResult = {
                                nickname: nickFromDom,
                                avatar: avatarEle ? avatarEle.getAttribute('src') : '',
                                uid: uidEle ? (uidEle.innerText || '').replace(/视频号 ?ID[:：]\s*/i, '').trim() : ''
                            };
                            return finalResult;
                        }
                    } catch (_) {}
                    // 接口兜底：DOM 无昵称时，用 localStorage 的 _aid / finder_username 调接口
                    try {
                        const aid = localStorage.getItem('_rx:aid') || localStorage.getItem('_ml:aid') || '';
                        const logFinderId = localStorage.getItem('finder_username') || '';
                        console.log('[shipinhao getUserInfo] localStorage参数:', {
                            aid: aid ? (aid.slice(0, 20) + '...') : '(空)',
                            logFinderId: logFinderId ? (logFinderId.slice(0, 30) + '...') : '(空)'
                        });
                        if (aid && logFinderId) {
                            const params = new URLSearchParams({
                                _aid: aid,
                                _rid: String(Date.now()).slice(0, 10),
                                _pageUrl: 'https%3A%2F%2Fchannels.weixin.qq.com%2Fplatform'
                            });
                            const resp = await fetch(
                                `https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data?${params}`,
                                {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        timestamp: String(Date.now()),
                                        _log_finder_id: logFinderId,
                                        _log_finder_uin: '',
                                        pluginSessionId: null,
                                        rawKeyBuff: null,
                                        reqScene: 7,
                                        scene: 7
                                    }),
                                    credentials: 'include'
                                }
                            );
                            const json = await resp.json();
                            console.log('[shipinhao getUserInfo] 接口返回:', JSON.stringify(json).slice(0, 500));
                            const d = json && json.data;
                            if (d) {
                                const finderUser = d.finderUser || {};
                                const userAttr = d.userAttr || {};
                                console.log('[shipinhao getUserInfo] finderUser.nickname:', finderUser.nickname);
                                console.log('[shipinhao getUserInfo] userAttr.nickname:', userAttr.nickname);
                                const nickFromApi = finderUser.nickname || userAttr.nickname || '';
                                if (nickFromApi) {
                                    finalResult = {
                                        nickname: nickFromApi,
                                        avatar: finderUser.headImgUrl || userAttr.encryptedHeadImage || '',
                                        uid: finderUser.finderUsername || logFinderId || ''
                                    };
                                    return finalResult;
                                } else {
                                    console.warn('[shipinhao getUserInfo] 接口返回数据中无昵称');
                                }
                            } else {
                                console.warn('[shipinhao getUserInfo] 接口返回无 data 字段');
                            }
                        }
                    } catch (apiErr) {
                        console.warn('[shipinhao getUserInfo] 接口兜底失败:', apiErr && apiErr.message);
                    }
                    // 当前窗口绑定账号兜底：发布成功页/列表页可能没有昵称 DOM，但主进程仍知道窗口账号。
                    try {
                        if (window.browserAPI && window.browserAPI.getCurrentAccount) {
                            const ar = await window.browserAPI.getCurrentAccount();
                            const acc = ar && ar.success && ar.account;
                            if (acc && acc.platformUid) {
                                finalResult = {
                                    nickname: acc.nickname || '',
                                    avatar: acc.avatar || '',
                                    uid: acc.platformUid
                                };
                                return finalResult;
                            }
                        }
                    } catch (e) {
                        console.warn('[shipinhao getUserInfo] getCurrentAccount 兜底失败:', e && e.message);
                    }
                    // 最后尝试从 localStorage 取参数再调一次接口（发布页可能第一次没取到，再试一次）
                    try {
                        const aidLocal2 = localStorage.getItem('_rx:aid') || localStorage.getItem('_ml:aid') || localStorage.getItem('_aid') || '';
                        const finderIdLocal2 = localStorage.getItem('finder_username') || localStorage.getItem('_log_finder_id') || '';
                        console.log('[shipinhao getUserInfo] localStorage 二次尝试:', {
                            aid: aidLocal2 ? (aidLocal2.slice(0, 20) + '...') : '(空)',
                            finderId: finderIdLocal2 ? (finderIdLocal2.slice(0, 30) + '...') : '(空)'
                        });
                        // 即使 aid 为空也尝试调用（某些接口可能不强制要求）
                        if (finderIdLocal2) {
                            const params = new URLSearchParams({
                                _aid: aidLocal2 || 'default-aid-placeholder',
                                _rid: String(Date.now()).slice(0, 10),
                                _pageUrl: 'https%3A%2F%2Fchannels.weixin.qq.com%2Fplatform'
                            });
                            const resp = await fetch(
                                `https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data?${params}`,
                                {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        timestamp: String(Date.now()),
                                        _log_finder_id: finderIdLocal2,
                                        _log_finder_uin: '',
                                        pluginSessionId: null,
                                        rawKeyBuff: null,
                                        reqScene: 7,
                                        scene: 7
                                    }),
                                    credentials: 'include'
                                }
                            );
                            const json = await resp.json();
                            const d = json && json.data;
                            if (d) {
                                const finderUser = d.finderUser || {};
                                const userAttr = d.userAttr || {};
                                const nickFromApi = finderUser.nickname || userAttr.nickname || '';
                                if (nickFromApi) {
                                    finalResult = {
                                        nickname: nickFromApi,
                                        avatar: finderUser.headImgUrl || userAttr.encryptedHeadImage || '',
                                        uid: finderUser.finderUsername || finderIdLocal2 || ''
                                    };
                                    return finalResult;
                                }
                            }
                        }
                    } catch (apiErr2) {
                        console.warn('[shipinhao getUserInfo] localStorage 接口兜底失败:', apiErr2 && apiErr2.message);
                    }
                    // 最后尝试：从 document.cookie 中提取参数调接口
                    try {
                        const cookies = document.cookie.split(';').reduce((obj, c) => {
                            const [k, v] = c.trim().split('=');
                            obj[k] = v;
                            return obj;
                        }, {});
                        const aidCookie = cookies['_aid'] || cookies['mm_aid'] || '';
                        console.log('[shipinhao getUserInfo] 从 cookie 提取 _aid:', aidCookie ? (aidCookie.slice(0, 20) + '...') : '(空)');
                        // finder_username 可能在 localStorage，但跨域拿不到，从 URL 或其他地方推断
                        // 如果都拿不到，就放弃接口调用
                        if (!aidCookie) {
                            console.warn('[shipinhao getUserInfo] Cookie 中无 _aid，跳过最后接口尝试');
                        }
                    } catch (cookieErr) {
                        console.warn('[shipinhao getUserInfo] Cookie 提取失败:', cookieErr && cookieErr.message);
                    }
                    // 兜底从 publishData 取
                    const e = publishData && publishData.element || {};
                    const accountInfo = e.account_info || e.accountInfo || {};
                    const mediaAuth = e.media_auth || e.mediaAuth || {};
                    const uid = e.uid
                        || e.platformUid
                        || accountInfo.uid
                        || accountInfo.platformUid
                        || accountInfo.open_id
                        || accountInfo.origin_id
                        || mediaAuth.uid
                        || mediaAuth.platformUid
                        || mediaAuth.open_id
                        || mediaAuth.origin_id
                        || e.media_auth_id
                        || e.mediaAuthId
                        || accountInfo.id
                        || mediaAuth.id;
                    if (uid) {
                        finalResult = {
                            nickname: e.nickname || accountInfo.nickname || mediaAuth.nickname || '',
                            avatar: e.avatar || accountInfo.avatar || mediaAuth.avatar || '',
                            uid: uid
                        };
                        return finalResult;
                    }
                    throw new Error('视频号 DOM/publishData 均无 uid');
                }
            }
        };

        const cfg = platformConfigs[platform];
        if (!cfg) {
            return { success: false, error: '未配置该平台: ' + platform };
        }

        try {
            const companyId = await (window.browserAPI && window.browserAPI.getGlobalData
                ? window.browserAPI.getGlobalData('company_id')
                : Promise.resolve(''));

            // 拿一份 publishData 给 getUserInfo 兜底使用
            let publishDataForFallback = null;
            try {
                const wid = await (window.browserAPI && window.browserAPI.getWindowId ? window.browserAPI.getWindowId() : null);
                if (wid && window.browserAPI && window.browserAPI.getGlobalData) {
                    publishDataForFallback = await window.browserAPI.getGlobalData('publish_data_window_' + wid);
                }
            } catch (_) {}

            // 1. 获取用户信息
            const userInfo = await cfg.getUserInfo(publishDataForFallback);
            if (!userInfo || !userInfo.uid) {
                throw new Error('userInfo.uid 为空');
            }

            // 2. 抓多域完整 session
            const mergedData = {
                domains: cfg.domains,
                timestamp: Date.now(),
                cookies: [],
                localStorage: {},
                sessionStorage: {},
                indexedDB: {}
            };
            const seen = new Set();
            for (const d of cfg.domains) {
                try {
                    const sr = await window.browserAPI.getFullSessionData(d);
                    if (sr && sr.success && sr.data) {
                        if (Array.isArray(sr.data.cookies)) {
                            sr.data.cookies.forEach(c => {
                                const k = [c.name, c.domain, c.path || '/', c.secure ? '1' : '0'].join('|');
                                if (!seen.has(k)) {
                                    seen.add(k);
                                    mergedData.cookies.push(c);
                                }
                            });
                        }
                        if (sr.data.localStorage && Object.keys(sr.data.localStorage).length > 0) {
                            mergedData.localStorage[d] = sr.data.localStorage;
                        }
                        if (sr.data.sessionStorage && Object.keys(sr.data.sessionStorage).length > 0) {
                            mergedData.sessionStorage[d] = sr.data.sessionStorage;
                        }
                        if (sr.data.indexedDB && Object.keys(sr.data.indexedDB).length > 0) {
                            mergedData.indexedDB[d] = sr.data.indexedDB;
                        }
                    }
                } catch (e) {
                    console.warn('[publishSaveSession] 获取 ' + d + ' session 失败:', e && e.message);
                }
            }
            mergedData.cookies = dedupePublishSaveCookies(platform, mergedData.cookies);

            if (mergedData.cookies.length === 0) {
                throw new Error('未获取到任何 cookies');
            }

            const cookiesData = JSON.stringify(mergedData);

            // 3. 构建 scanData（与 creator.js 一致）
            // userInfo 中扩展字段（follower_count/favoriting_count/total_favorited/follow/video）若存在则覆盖默认 0
            // auth_type 优先从 publishData.element.media_auth.auth_type 取（前端传入）
            const elementForScan = publishDataForFallback && publishDataForFallback.element || {};
            const resolvedAuthType = (elementForScan.media_auth && elementForScan.media_auth.auth_type != null)
                ? elementForScan.media_auth.auth_type
                : 1;
            const scanData = {
                data: JSON.stringify({
                    nickname: userInfo.nickname,
                    avatar: userInfo.avatar,
                    follow: userInfo.follow != null ? userInfo.follow : 0,
                    follower_count: userInfo.follower_count != null ? userInfo.follower_count : 0,
                    video: userInfo.video != null ? userInfo.video : 0,
                    uid: userInfo.uid,
                    favoriting_count: userInfo.favoriting_count != null ? userInfo.favoriting_count : 0,
                    total_favorited: userInfo.total_favorited != null ? userInfo.total_favorited : 0,
                    company_id: companyId,
                    auth_type: resolvedAuthType,
                    cookies: cookiesData
                })
            };

            // 4. 调后台接口
            const apiDomain = await window.getApiDomain();
            const apiResponse = await fetch(apiDomain + cfg.apiPath, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(scanData)
            });
            const apiResponseText = await apiResponse.text();
            let apiResult = null;
            try { apiResult = JSON.parse(apiResponseText); } catch (_) {}

            const okFlag = apiResponse.ok && apiResult && apiResult.code === 200;
            const result = {
                success: okFlag,
                status: apiResponse.status,
                code: apiResult ? apiResult.code : undefined,
                message: apiResult ? (apiResult.message || apiResult.msg) : undefined,
                cookiesLen: cookiesData.length,
                cookieCount: mergedData.cookies.length,
                uid: userInfo.uid,
                nickname: userInfo.nickname,
                response: apiResponseText.slice(0, 300)
            };

            try {
                const cookiesKB = Math.round(cookiesData.length / 1024);
                const msg = okFlag
                    ? '[__publishSaveSession__ ✅] 关闭前保存成功（' + platform + '）'
                        + ' | uid: ' + userInfo.uid
                        + ' | nickname: ' + userInfo.nickname
                        + ' | Cookies: ' + mergedData.cookies.length + ' 个 / ' + cookiesKB + ' KB'
                        + ' | HTTP: ' + apiResponse.status
                        + ' | 接口 code: ' + (apiResult && apiResult.code)
                    : '[__publishSaveSession__ ❌] 关闭前保存失败（' + platform + '）'
                        + ' | uid: ' + userInfo.uid
                        + ' | nickname: ' + userInfo.nickname
                        + ' | Cookies: ' + mergedData.cookies.length + ' 个 / ' + cookiesKB + ' KB'
                        + ' | HTTP: ' + apiResponse.status
                        + ' | 接口 code: ' + (apiResult ? apiResult.code : '-')
                        + ' | 响应: ' + apiResponseText.slice(0, 200);
                console[okFlag ? 'log' : 'warn'](msg);
            } catch (_) {}

            return result;
        } catch (err) {
            try { console.warn('[__publishSaveSession__ ❌] 关闭前保存异常（' + platform + '）:', err && err.message); } catch (_) {}
            return { success: false, error: err && err.message };
        }
    };

    function getFirstMeaningfulValue(...values) {
        for (const value of values) {
            if (value === undefined || value === null) {
                continue;
            }
            if (typeof value === "string" && value.trim() === "") {
                continue;
            }
            return value;
        }
        return null;
    }

    function pruneEmptyFields(payload = {}) {
        return Object.fromEntries(
            Object.entries(payload).filter(([_, value]) => {
                if (value === undefined || value === null) {
                    return false;
                }
                if (typeof value === "string" && value.trim() === "") {
                    return false;
                }
                return true;
            })
        );
    }

    function normalizeStatisticsPlatformName(platform = "") {
        if (typeof platform !== "string") {
            return "";
        }
        return platform.replace(/发布$/u, "").trim();
    }

    window.getCurrentPublishDataForStatistics = async function (logPrefix = "[统计接口]") {
        try {
            if (window.browserAPI?.getWindowId && window.browserAPI?.getGlobalData) {
                const windowId = await window.browserAPI.getWindowId();
                if (windowId) {
                    const publishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
                    if (publishData) {
                        console.log(`${logPrefix} ✅ 从 publish_data_window_${windowId} 读取到发布数据`);
                        return publishData;
                    }
                    console.log(`${logPrefix} ⚠️ windowId=${windowId} 对应的 publish_data 不存在，尝试遍历全部 window 数据`);
                }
            }

            // 回退：遍历所有 global data，找任意可用的 publish_data_window_*
            if (window.browserAPI?.getAllGlobalData) {
                const allData = await window.browserAPI.getAllGlobalData();
                if (allData && typeof allData === "object") {
                    const candidates = Object.keys(allData).filter((k) => k.startsWith("publish_data_window_"));
                    for (const key of candidates) {
                        if (allData[key]) {
                            console.log(`${logPrefix} ✅ 回退命中 ${key}`);
                            return allData[key];
                        }
                    }
                }
            }
        } catch (e) {
            console.warn(`${logPrefix} ⚠️ 从窗口级发布数据读取失败:`, e);
        }

        if (window.__AUTH_DATA__?.message) {
            console.log(`${logPrefix} ℹ️ 回退使用 window.__AUTH_DATA__.message`);
            return window.__AUTH_DATA__.message;
        }

        console.log(`${logPrefix} ℹ️ 未找到可用的发布数据，统计字段将仅上报基础信息`);
        return null;
    };

    window.extractStatisticsMeta = async function (platform = "", logPrefix = "[统计接口]") {
        const publishData = await window.getCurrentPublishDataForStatistics(logPrefix);
        const rawData = Array.isArray(publishData) ? publishData[0] : publishData;
        const element = rawData?.element || rawData || {};
        const accountInfo = element?.account_info || element?.accountInfo || {};
        const mediaInfo = accountInfo?.media || element?.media || {};
        const mediaAuth = element?.media_auth || element?.mediaAuth || {};

        const meta = pruneEmptyFields({
            media_id: getFirstMeaningfulValue(
                element?.media_id,
                mediaInfo?.id,
                accountInfo?.media_id,
                mediaAuth?.media_id
            ),
            account_id: getFirstMeaningfulValue(
                element?.account_id,
                accountInfo?.id,
                element?.media_auth_id,
                mediaAuth?.id,
                element?.platform_uid,
                element?.platformUid,
                element?.uid,
                element?.open_id,
                element?.openid,
                accountInfo?.platform_uid,
                accountInfo?.platformUid,
                accountInfo?.uid,
                accountInfo?.open_id,
                accountInfo?.openid,
                mediaAuth?.open_id,
                mediaAuth?.uid,
                mediaAuth?.origin_id
            ),
            nickname: getFirstMeaningfulValue(
                element?.nickname,
                element?.account_name,
                accountInfo?.nickname,
                accountInfo?.title,
                mediaAuth?.nickname,
                mediaAuth?.title
            ),
            avatar: getFirstMeaningfulValue(
                element?.avatar,
                accountInfo?.avatar,
                mediaAuth?.avatar
            ),
            media_logo: getFirstMeaningfulValue(
                element?.media_logo,
                mediaInfo?.logo,
                mediaInfo?.icon,
                mediaInfo?.avatar,
                element?.icon
            ),
            media_name: getFirstMeaningfulValue(
                element?.media_name,
                mediaInfo?.name,
                mediaInfo?.title
            ),
        });

        console.log(`${logPrefix} 📦 提取到统计附加字段:`, meta);
        return meta;
    };

    window.buildStatisticsPayload = async function (publishId, platform = "", extraData = {}) {
        const logPrefix = `[${platform || "发布"}][统计接口]`;
        const meta = await window.extractStatisticsMeta(platform, logPrefix);
        const payload = pruneEmptyFields({
            id: publishId,
            ...meta,
            ...(extraData || {}),
        });

        console.log(`${logPrefix} 📤 最终上报 payload:`, payload);
        return payload;
    };

    window.buildStatisticsRequestData = async function (publishId, platform = "", extraData = {}) {
        const payload = await window.buildStatisticsPayload(publishId, platform, extraData);
        return { data: JSON.stringify(payload) };
    };

    // 🔒 页内同步内存锁：Map 的 check-and-claim 在任何 await 之前同步完成，
    //     JS 单线程下不可被穿插，封死同页并发穿锁竞态
    //     （典型场景：乐观上报 fire-and-forget 与轮询判定几乎同时触发；success 与 error 同时触发）。
    //     sessionStorage/globalData 锁仍保留，用于跨导航、跨窗口去重。
    const statisticsReportMemoryLocks = new Map();

    function getStatisticsMemoryLockKey(publishId, resultType = "unknown") {
        return `${resultType}:${String(publishId || "").trim()}`;
    }

    function getStatisticsReportCacheKey(windowId, resultType = "unknown") {
        return `PUBLISH_STATISTICS_REPORTED_${windowId || "default"}_${resultType}`;
    }

    function getStatisticsGlobalReportCacheKey(publishId, resultType = "unknown") {
        const normalizedPublishId = String(publishId || "").trim();
        if (!normalizedPublishId) {
            return null;
        }
        return `PUBLISH_STATISTICS_REPORTED_GLOBAL_${resultType}_${encodeURIComponent(normalizedPublishId)}`;
    }

    function parseStatisticsReportCache(value) {
        if (!value) {
            return null;
        }
        if (typeof value === "object") {
            return value;
        }
        if (typeof value === "string") {
            try {
                return JSON.parse(value);
            } catch (_) {
                return null;
            }
        }
        return null;
    }

    async function getGlobalStatisticsReport(globalKey) {
        if (!globalKey || !window.browserAPI?.getGlobalData) {
            return null;
        }
        try {
            return parseStatisticsReportCache(await window.browserAPI.getGlobalData(globalKey));
        } catch (e) {
            console.warn("[统计接口] ⚠️ 读取全局统计去重锁失败:", e.message);
            return null;
        }
    }

    async function setGlobalStatisticsReport(globalKey, data) {
        if (!globalKey || !window.browserAPI?.setGlobalData) {
            return;
        }
        try {
            await window.browserAPI.setGlobalData(globalKey, data);
        } catch (e) {
            console.warn("[统计接口] ⚠️ 写入全局统计去重锁失败:", e.message);
        }
    }

    window.acquireStatisticsReportLock = async function (publishId, resultType = "unknown", platform = "") {
        if (!publishId) {
            return { acquired: true, key: null, globalKey: null, windowId: null, memoryKey: null };
        }

        const normalizedPublishId = String(publishId).trim();

        // 🔒 第一道闸（同步、原子）：内存锁。必须先于任何 await 执行——
        //     后面的 getWindowId/getGlobalData 是 IPC await 会让出事件循环，
        //     并发调用会在 check 与 set 之间穿插导致双双拿锁。
        const memoryKey = getStatisticsMemoryLockKey(normalizedPublishId, resultType);
        if (resultType === "error") {
            const successMemory = statisticsReportMemoryLocks.get(getStatisticsMemoryLockKey(normalizedPublishId, "success"));
            if (successMemory) {
                console.warn(`[${platform || "发布"}][统计接口] ⚠️ 成功上报已在进行/已完成（内存锁），跳过失败上报`, successMemory);
                return {
                    acquired: false,
                    key: null,
                    globalKey: null,
                    windowId: null,
                    memoryKey: null,
                    cached: successMemory,
                    reason: "success-already-reported",
                };
            }
        }
        const existingMemory = statisticsReportMemoryLocks.get(memoryKey);
        if (existingMemory) {
            console.warn(`[${platform || "发布"}][统计接口] ⚠️ 检测到重复上报（内存锁），跳过`, existingMemory);
            return {
                acquired: false,
                key: null,
                globalKey: null,
                windowId: null,
                memoryKey: null,
                cached: existingMemory,
                reason: "duplicate-report",
            };
        }
        statisticsReportMemoryLocks.set(memoryKey, {
            publishId: normalizedPublishId,
            resultType,
            platform: platform || "",
            timestamp: Date.now(),
        });

        const globalKey = getStatisticsGlobalReportCacheKey(normalizedPublishId, resultType);
        const globalSuccessKey = resultType === "error"
            ? getStatisticsGlobalReportCacheKey(normalizedPublishId, "success")
            : null;

        let windowId = null;
        try {
            if (window.browserAPI?.getWindowId) {
                windowId = await window.browserAPI.getWindowId();
            }
        } catch (e) {
            console.warn("[统计接口] ⚠️ 获取窗口 ID 失败，降级为默认去重 key:", e.message);
        }

        const key = getStatisticsReportCacheKey(windowId, resultType);

        try {
            if (resultType === "error") {
                const successKey = getStatisticsReportCacheKey(windowId, "success");
                const successCached = parseStatisticsReportCache(sessionStorage.getItem(successKey));
                if (successCached) {
                    if (String(successCached?.publishId || "") === normalizedPublishId) {
                        console.warn(`[${platform || "发布"}][统计接口] ⚠️ 已存在成功上报，跳过失败上报`, successCached);
                        return {
                            acquired: false,
                            key: successKey,
                            globalKey: globalSuccessKey,
                            windowId,
                            cached: successCached,
                            reason: "success-already-reported",
                        };
                    }
                }

                const globalSuccessCached = await getGlobalStatisticsReport(globalSuccessKey);
                if (String(globalSuccessCached?.publishId || "") === normalizedPublishId) {
                    console.warn(`[${platform || "发布"}][统计接口] ⚠️ 全局已存在成功上报，跳过失败上报`, globalSuccessCached);
                    return {
                        acquired: false,
                        key: successKey,
                        globalKey: globalSuccessKey,
                        windowId,
                        cached: globalSuccessCached,
                        reason: "success-already-reported",
                    };
                }
            }

            const cached = parseStatisticsReportCache(sessionStorage.getItem(key));
            if (cached) {
                if (String(cached?.publishId || "") === normalizedPublishId) {
                    console.warn(`[${platform || "发布"}][统计接口] ⚠️ 检测到重复上报，跳过`, cached);
                    return { acquired: false, key, globalKey, windowId, cached };
                }
            }

            const globalCached = await getGlobalStatisticsReport(globalKey);
            if (String(globalCached?.publishId || "") === normalizedPublishId) {
                console.warn(`[${platform || "发布"}][统计接口] ⚠️ 检测到全局重复上报，跳过`, globalCached);
                return { acquired: false, key, globalKey, windowId, cached: globalCached };
            }

            const cacheData = {
                publishId: normalizedPublishId,
                resultType,
                platform: platform || "",
                windowId,
                timestamp: Date.now(),
            };
            sessionStorage.setItem(key, JSON.stringify(cacheData));
            await setGlobalStatisticsReport(globalKey, cacheData);
        } catch (e) {
            console.warn(`[${platform || "发布"}][统计接口] ⚠️ 统计去重锁写入失败，继续发送请求:`, e.message);
        }

        return { acquired: true, key, globalKey, windowId, memoryKey };
    };

    window.releaseStatisticsReportLock = async function (lockOrKey, publishId = "") {
        const key = typeof lockOrKey === "object" ? lockOrKey?.key : lockOrKey;
        const globalKey = typeof lockOrKey === "object" ? lockOrKey?.globalKey : null;
        const memoryKey = typeof lockOrKey === "object" ? lockOrKey?.memoryKey : null;
        const normalizedPublishId = String(publishId || "").trim();
        if (memoryKey) {
            statisticsReportMemoryLocks.delete(memoryKey);
        }
        if (!key && !globalKey) {
            return;
        }

        try {
            const cached = parseStatisticsReportCache(key ? sessionStorage.getItem(key) : null);
            if (key && (!cached || !normalizedPublishId || String(cached?.publishId || "") === normalizedPublishId)) {
                sessionStorage.removeItem(key);
            }
        } catch (e) {
            console.warn("[统计接口] ⚠️ 清理统计去重锁失败:", e.message);
        }

        if (globalKey && window.browserAPI?.removeGlobalData) {
            try {
                const cached = await getGlobalStatisticsReport(globalKey);
                if (!cached || !normalizedPublishId || String(cached?.publishId || "") === normalizedPublishId) {
                    await window.browserAPI.removeGlobalData(globalKey);
                }
            } catch (e) {
                console.warn("[统计接口] ⚠️ 清理全局统计去重锁失败:", e.message);
            }
        }
    };

    // 发送统计接口（发布成功时调用）
    // 🔒 GEO 与普通系统统一走去重锁：同一 publishId 只上报 1 次（GEO 曾是"每次记录"导致重复计数，已改为只报一次）
    window.sendStatistics = async function (publishId, platform = "", options = {}) {
        const url = await getStatisticsUrl(false);
        const isGeo = window.isGeoStatisticsReport(url);

        const reportLock = await window.acquireStatisticsReportLock(publishId, "success", platform);
        if (!reportLock.acquired) {
            return { success: true, skipped: true, reason: reportLock.reason || "duplicate-report" };
        }

        const scanData = await window.buildStatisticsRequestData(publishId, platform);
        try {
            console.log(`[${platform || "发布"}] 📤 发送成功统计接口，ID: ${publishId}${isGeo ? " [GEO-仅一次]" : ""}`);
            console.log(`[${platform || "发布"}] 统计接口地址: ${url}`);

            // 🔒 只发一次：成功与失败上报都不重试、不入补报队列（用户要求「只有一次」）
            const result = await window.retryOperation(async () => {
                // 每个 fetch 带 10s 超时，网慢时超时报错触发重试
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                try {
                    const response = await fetch(url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(scanData),
                        keepalive: true,
                        signal: controller.signal,
                    });
                    const text = await response.text();
                    let parsed = null;
                    try { parsed = JSON.parse(text); } catch (_) {}
                    const evaluation = evaluateStatisticsResponse(response, parsed);
                    if (!evaluation.ok) {
                        throw new Error(formatStatisticsResponseError(response, parsed));
                    }
                    return { response, parsed, evaluation };
                } finally {
                    clearTimeout(timeoutId);
                }
            }, 1, 0);

            console.log(`[${platform || "发布"}] ✅ 成功统计接口已确认: code=${result.evaluation.code} reason=${result.evaluation.reason || "ok"}`);
            return { success: true, response: result.response, code: result.evaluation.code };
        } catch (e) {
            // 🔒 失败/超时后不释放去重锁：10s abort 超时的请求可能已到达服务器并被记录，
            //     释放锁会让后续判定路径重报同一 publishId（重复计数）。同一 publishId 最多只发出 1 次请求。
            console.error(`[${platform || "发布"}] ❌ 成功统计上报失败（只发 1 次，不重试、不补报、不解锁）:`, e.message);
            // 🔒 只发一次：不入补报队列。仅提示用户内容已发布成功、统计上报失败。
            window.showPublishToast?.(
                "内容已发布成功！仅数据统计上报失败（不影响发布结果）。",
                "warning"
            );
            return { success: false, error: e };
        }
    };

    // ===========================
    // 🚀 延迟乐观成功上报（点击发布按钮成功后调用）
    // ===========================
    // 背景：旧版「点击即上报成功」会先占 success 去重锁，导致点击后才出现的明确失败
    //       （账号被禁言/违规/频次超限等平台错误）被锁挡掉（success-already-reported），后台误记成功。
    //       后台不支持「失败覆盖成功」，因此必须保证同一 publishId 只发出一条、且是对的那条：
    //   1. 乐观成功延迟 OPTIMISTIC_SUCCESS_DELAY_MS 后才真正发送；
    //   2. 期间任何 sendStatisticsError 抢锁成功会自动取消该 pending（后台只收到失败）；
    //   3. 到点发送前先查 error 内存锁与错误探针（registerPublishErrorProbe 注册，
    //      如网易的 getLatestError）——探针命中则取消成功并转报失败；
    //   4. 页面卸载（pagehide/beforeunload，发布成功跳转的强信号）时用预构建请求体
    //      keepalive 立即冲刷成功，保留乐观上报的防漏报能力。
    // ⚠️ GEO 系统跳过乐观上报：GEO 保持「真正确认成功才记 1 次」的语义，
    //     确认成功/失败上报已由去重锁保证同一 publishId 只发 1 次。
    // 🕐 options.deferUntilUnload=true（网易，FIX_WANGYI_OPTIMISTIC_DEFER）：不设到点定时器，
    //     成功只在页面卸载冲刷时发出——错误出现时间不可预测（发文前检测二次点击+慢审核）的
    //     平台用，保证失败上报永远先于成功抢锁。
    const OPTIMISTIC_SUCCESS_DELAY_MS = 8000;
    const optimisticPendingReports = new Map(); // publishId -> pending
    let publishErrorProbe = null;
    let optimisticFlushHooked = false;

    // 平台脚本注册同步错误探针（返回错误文本或 null），供延迟乐观到点/卸载冲刷前查询
    window.registerPublishErrorProbe = function (fn) {
        if (typeof fn === "function") {
            publishErrorProbe = fn;
            console.log("[统计接口] ✅ 已注册发布错误探针");
        }
    };

    function readPublishErrorProbe() {
        if (typeof publishErrorProbe !== "function") {
            console.log("[统计接口] 🔍 探针查询: 未注册探针函数");
            return null;
        }
        try {
            const err = publishErrorProbe();
            if (err) {
                console.log(`[统计接口] 🔍 探针查询: 检测到错误 "${err}"`);
            }
            return err ? String(err) : null;
        } catch (e) {
            console.warn("[统计接口] ⚠️ 探针查询异常:", e.message);
            return null;
        }
    }

    window.cancelOptimisticPendingSuccess = function (publishId, reason = "") {
        const normalizedPublishId = String(publishId || "").trim();
        const pending = optimisticPendingReports.get(normalizedPublishId);
        if (!pending) return false;
        pending.cancelled = true;
        if (pending.timer) clearTimeout(pending.timer);
        if (pending.probeTimer) clearInterval(pending.probeTimer);
        optimisticPendingReports.delete(normalizedPublishId);
        console.log(`[${pending.platform || "发布"}] 🛑 已取消待发送的乐观成功上报（ID: ${normalizedPublishId}）${reason ? `，原因: ${reason}` : ""}`);
        return true;
    };

    function hasErrorMemoryLock(publishId) {
        return statisticsReportMemoryLocks.has(getStatisticsMemoryLockKey(publishId, "error"));
    }

    // 页面卸载冲刷：跳转/关窗前把尚未到点的乐观成功用 keepalive 发出。
    // 卸载多半意味着发布成功跳转（失败路径都是先 await sendStatisticsError 再关窗，
    // 那时 pending 已被取消，不会走到这里）。
    function flushOptimisticPendingOnUnload() {
        for (const [publishId, pending] of optimisticPendingReports) {
            if (pending.cancelled || pending.inFlight || pending.flushed) continue;
            if (hasErrorMemoryLock(publishId)) continue;
            const probeError = readPublishErrorProbe();
            if (probeError) {
                // 有明确错误 + 页面卸载：不能只放弃成功——平台脚本的失败流程可能随窗口关闭一起死掉，
                // 导致成功/失败都没发出（后台零上报、无失败原因）。这里同步 keepalive 补发失败（带原因）。
                console.warn(`[${pending.platform || "发布"}] ⚠️ 卸载冲刷时探针检测到错误，改为补发失败上报: ${probeError}`);
                pending.flushed = true;
                if (pending.timer) clearTimeout(pending.timer);
                if (pending.probeTimer) clearInterval(pending.probeTimer);
                try {
                    // 同步落 error 锁（内存 + sessionStorage；globalData 尽力而为），防平台脚本随后重复报失败
                    const errorMemoryKey = getStatisticsMemoryLockKey(publishId, "error");
                    if (statisticsReportMemoryLocks.has(errorMemoryKey)) continue;
                    const errorCacheData = {
                        publishId,
                        resultType: "error",
                        platform: pending.platform || "",
                        windowId: pending.windowId,
                        timestamp: Date.now(),
                        unloadProbe: true,
                    };
                    statisticsReportMemoryLocks.set(errorMemoryKey, errorCacheData);
                    try {
                        sessionStorage.setItem(getStatisticsReportCacheKey(pending.windowId, "error"), JSON.stringify(errorCacheData));
                    } catch (_) {}
                    const errorGlobalKey = getStatisticsGlobalReportCacheKey(publishId, "error");
                    if (errorGlobalKey && window.browserAPI?.setGlobalData) {
                        try {
                          // 【特性开关】FIX_PAGEHIDE_PROMISE_CRASH: 移除 .catch() 防止 Promise 在 unload 时访问释放内存
                          if (window.isFeatureEnabled?.('FIX_PAGEHIDE_PROMISE_CRASH')) {
                            window.browserAPI.setGlobalData(errorGlobalKey, errorCacheData);  // fire-and-forget
                          } else {
                            window.browserAPI.setGlobalData(errorGlobalKey, errorCacheData).catch(() => {});  // 旧逻辑兼容
                          }
                        } catch (_) {}
                    }
                    // 基于预构建的成功 body 同步改造出失败 body（payload = {id, ...meta, ...extraData}）
                    let errorBody = pending.body;
                    try {
                        const bodyObj = JSON.parse(pending.body);
                        const payload = JSON.parse(bodyObj.data);
                        payload.status_text = probeError;
                        if (typeof window.categorizeFailure === "function") {
                            try { payload.failure_category = window.categorizeFailure(probeError, {}).category; } catch (_) {}
                        }
                        payload.context = { url: window.location.href, timestamp: new Date().toISOString(), platform: pending.platform || "unknown", reportedOnUnload: true };
                        errorBody = JSON.stringify({ data: JSON.stringify(payload) });
                    } catch (_) {}
                    fetch(pending.errorUrl || pending.url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: errorBody,
                        keepalive: true,
                    }).catch(() => {});
                    console.log(`[${pending.platform || "发布"}] 📤 页面卸载，已用 keepalive 补发失败上报（ID: ${publishId}，原因: ${probeError}）`);
                } catch (e) {
                    console.warn(`[${pending.platform || "发布"}] ⚠️ 卸载补发失败上报异常:`, e.message);
                }
                continue;
            }
            pending.flushed = true;
            if (pending.timer) clearTimeout(pending.timer);
            try {
                // 同步落锁（内存 + sessionStorage；globalData 尽力而为），防跳转后 publish-success.js 重复报成功
                const memoryKey = getStatisticsMemoryLockKey(publishId, "success");
                if (statisticsReportMemoryLocks.has(memoryKey)) continue;
                const cacheData = {
                    publishId,
                    resultType: "success",
                    platform: pending.platform || "",
                    windowId: pending.windowId,
                    timestamp: Date.now(),
                    optimistic: true,
                };
                statisticsReportMemoryLocks.set(memoryKey, cacheData);
                try {
                    sessionStorage.setItem(getStatisticsReportCacheKey(pending.windowId, "success"), JSON.stringify(cacheData));
                } catch (_) {}
                const globalKey = getStatisticsGlobalReportCacheKey(publishId, "success");
                if (globalKey && window.browserAPI?.setGlobalData) {
                    try {
                      // 【特性开关】FIX_PAGEHIDE_PROMISE_CRASH: 移除 .catch() 防止 Promise 在 unload 时访问释放内存
                      if (window.isFeatureEnabled?.('FIX_PAGEHIDE_PROMISE_CRASH')) {
                        window.browserAPI.setGlobalData(globalKey, cacheData);  // fire-and-forget
                      } else {
                        window.browserAPI.setGlobalData(globalKey, cacheData).catch(() => {});  // 旧逻辑兼容
                      }
                    } catch (_) {}
                }
                fetch(pending.url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: pending.body,
                    keepalive: true,
                }).catch(() => {});
                console.log(`[${pending.platform || "发布"}] 🚀 页面卸载，已冲刷乐观成功上报（ID: ${publishId}）`);
            } catch (e) {
                console.warn(`[${pending.platform || "发布"}] ⚠️ 卸载冲刷乐观成功失败:`, e.message);
            }
        }
    }

    function ensureOptimisticFlushHook() {
        if (optimisticFlushHooked) return;
        optimisticFlushHooked = true;
        window.addEventListener("pagehide", flushOptimisticPendingOnUnload);
        window.addEventListener("beforeunload", flushOptimisticPendingOnUnload);
    }

    window.sendOptimisticSuccess = async function (publishId, platform = "", options = {}) {
        try {
            if (!publishId) {
                return { success: false, skipped: true, reason: "no-publishId" };
            }
            const normalizedPublishId = String(publishId).trim();
            const url = await getStatisticsUrl(false);
            if (window.isGeoStatisticsReport(url)) {
                console.log(`[${platform || "发布"}] ℹ️ GEO 系统跳过「点击即上报成功」，避免重复记录`);
                return { success: true, skipped: true, reason: "geo-skip-optimistic" };
            }
            if (optimisticPendingReports.has(normalizedPublishId)) {
                return { success: true, skipped: true, reason: "optimistic-already-pending" };
            }
            if (hasErrorMemoryLock(normalizedPublishId)) {
                return { success: true, skipped: true, reason: "error-already-reported" };
            }

            // 预构建请求体：页面卸载冲刷时来不及 async 构建
            const scanData = await window.buildStatisticsRequestData(normalizedPublishId, platform);
            const errorUrl = await getStatisticsUrl(true); // 预取失败接口地址，卸载冲刷探针命中时用
            let windowId = null;
            try {
                if (window.browserAPI?.getWindowId) windowId = await window.browserAPI.getWindowId();
            } catch (_) {}

            // await 之后重查：预构建期间失败流程可能已抢到 error 锁
            if (hasErrorMemoryLock(normalizedPublishId)) {
                return { success: true, skipped: true, reason: "error-already-reported" };
            }

            // 🔑 deferUntilUnload：不设到点定时器，成功只靠 pagehide 卸载冲刷发出
            //     （网易等「错误出现晚于固定延迟」的平台用，失败上报永远抢在成功前）
            const deferUntilUnload = options && options.deferUntilUnload === true;
            const pending = {
                publishId: normalizedPublishId,
                platform: platform || "",
                url,
                errorUrl,
                body: JSON.stringify(scanData),
                windowId,
                deferUntilUnload,
                cancelled: false,
                inFlight: false,
                flushed: false,
                timer: null,
                probeTimer: null,
            };
            optimisticPendingReports.set(normalizedPublishId, pending);
            ensureOptimisticFlushHook();

            if (deferUntilUnload) {
                console.log(`[${platform || "发布"}] 🚀 点击发布成功，乐观成功改为页面卸载时冲刷（不设 ${Math.round(OPTIMISTIC_SUCCESS_DELAY_MS / 1000)} 秒定时，期间检测到明确失败则自动取消，ID: ${normalizedPublishId}）`);
            } else {
                console.log(`[${platform || "发布"}] 🚀 点击发布成功，${Math.round(OPTIMISTIC_SUCCESS_DELAY_MS / 1000)} 秒后乐观上报成功（期间检测到明确失败则自动取消，ID: ${normalizedPublishId}）`);
            }

            // 🔍 秒级轮询探针：点击后才出现的禁言/违规等错误可能在 1-3 秒内显示，
            //     每秒探测一次，命中立即取消成功并转报失败（比 8 秒到点更早，防漏报）
            let probeTickCount = 0;
            pending.probeTimer = setInterval(() => {
                probeTickCount++;
                // defer 模式无到点定时器来清理轮询，设上限（~5 分钟）防长驻页面无限轮询；
                // 停止轮询后仍有脚本失败路径 + 卸载冲刷前的探针查询兜底
                if (deferUntilUnload && probeTickCount > 300) {
                    if (pending.probeTimer) clearInterval(pending.probeTimer);
                    console.log(`[${platform || "发布"}] 🛑 探针轮询达到上限（300 次），停止轮询，成功仍待卸载冲刷`);
                    return;
                }
                if (probeTickCount === 1 || probeTickCount % 3 === 0) {
                    console.log(`[${platform || "发布"}] 🔍 探针轮询第 ${probeTickCount} 次...`);
                }
                if (pending.cancelled || pending.flushed || pending.inFlight) {
                    if (pending.probeTimer) clearInterval(pending.probeTimer);
                    console.log(`[${platform || "发布"}] 🛑 探针轮询停止（pending 已结束）`);
                    return;
                }
                if (hasErrorMemoryLock(normalizedPublishId)) {
                    if (pending.probeTimer) clearInterval(pending.probeTimer);
                    window.cancelOptimisticPendingSuccess(normalizedPublishId, "已存在失败上报");
                    return;
                }
                const probeError = readPublishErrorProbe();
                if (probeError) {
                    if (pending.probeTimer) clearInterval(pending.probeTimer);
                    window.cancelOptimisticPendingSuccess(normalizedPublishId, `探针检测到错误: ${probeError}`);
                    console.log(`[${platform || "发布"}] ❌ 延迟期间探针发现明确错误，转报失败: ${probeError}`);
                    (async () => {
                        try {
                            await window.sendStatisticsError(normalizedPublishId, probeError, platform);
                        } catch (e) {
                            console.warn(`[${platform || "发布"}] ⚠️ 探针失败转报异常:`, e.message);
                        }
                    })();
                }
            }, 1000);

            // 🔑 defer 模式不设到点定时器：成功只在 pagehide 卸载冲刷时发出
            pending.timer = deferUntilUnload ? null : setTimeout(async () => {
                if (pending.cancelled || pending.flushed) return;
                if (pending.probeTimer) clearInterval(pending.probeTimer);
                if (hasErrorMemoryLock(normalizedPublishId)) {
                    window.cancelOptimisticPendingSuccess(normalizedPublishId, "已存在失败上报");
                    return;
                }
                const probeError = readPublishErrorProbe();
                if (probeError) {
                    window.cancelOptimisticPendingSuccess(normalizedPublishId, `探针检测到错误: ${probeError}`);
                    console.log(`[${platform || "发布"}] ❌ 乐观上报到点前探针发现明确错误，转报失败: ${probeError}`);
                    try {
                        await window.sendStatisticsError(normalizedPublishId, probeError, platform);
                    } catch (e) {
                        console.warn(`[${platform || "发布"}] ⚠️ 探针失败转报异常:`, e.message);
                    }
                    return;
                }
                pending.inFlight = true;
                try {
                    await window.sendStatistics(normalizedPublishId, platform);
                } catch (e) {
                    console.warn(`[${platform || "发布"}] ⚠️ 延迟乐观成功上报异常:`, e.message);
                } finally {
                    if (pending.probeTimer) clearInterval(pending.probeTimer);
                    optimisticPendingReports.delete(normalizedPublishId);
                }
            }, OPTIMISTIC_SUCCESS_DELAY_MS);

            return { success: true, deferred: true, deferUntilUnload, delayMs: deferUntilUnload ? null : OPTIMISTIC_SUCCESS_DELAY_MS };
        } catch (e) {
            console.warn(`[${platform || "发布"}] ⚠️ 乐观成功上报异常（不阻断发布流程）:`, e.message);
            return { success: false, error: e };
        }
    };

    // 发送错误统计接口（发布失败时调用）
    // 🔑 增强版：附带详细的错误上下文日志 + 标准化失败分类
    // @param {string} publishId - 发布 ID
    // @param {string} statusText - 人类可读的失败原因（会作为 status_text 上报）
    // @param {string} platform - 平台名称
    // @param {Error} errorObj - 错误对象（可选，用于日志记录）
    // @param {Object} extraFields - 附加结构化字段（可选）：
    //   - {Object} categorizeContext - 传给 categorizeFailure 的上下文提示（如 { buttonDisabled: true }）
    //   - {Object} diagnosis - 诊断信息（如表单/按钮诊断结果）
    //   - {string} failure_category - 显式指定失败分类（覆盖自动推断）
    window.sendStatisticsError = async function (publishId, statusText, platform = "", errorObj = null, extraFields = null, options = {}) {
        // 🔒 GEO 与普通系统统一走去重锁：同一 publishId 只上报 1 次失败（且已报成功则不再报失败）
        const url = await getStatisticsUrl(true);
        const isGeo = window.isGeoStatisticsReport(url);

        const reportLock = await window.acquireStatisticsReportLock(publishId, "error", platform);
        if (!reportLock.acquired) {
            return { success: true, skipped: true, reason: reportLock.reason || "duplicate-report" };
        }

        // 🛑 失败已确认抢锁：立即取消同 publishId 尚未发出的延迟乐观成功，
        //     保证后台只收到「失败」这一条（后台不支持失败覆盖成功）
        window.cancelOptimisticPendingSuccess?.(publishId, "失败上报已抢锁");

        // 使用 PublishLogger 记录错误
        if (window.PublishLogger && errorObj) {
            window.PublishLogger.error(platform || "发布", "sendStatisticsError", errorObj, { publishId, statusText });
        }

        // 🔴 标准化失败分类：自动根据 statusText 推断失败类别（方便后台统计分析）
        let failureCategory = "unknown";
        if (typeof window.categorizeFailure === "function") {
            try {
                const categorizeContext = (extraFields && extraFields.categorizeContext) || {};
                const categorized = window.categorizeFailure(statusText, categorizeContext);
                failureCategory = categorized.category;
            } catch (e) {
                console.warn(`[${platform || "发布"}][统计接口] ⚠️ 失败分类异常:`, e.message);
            }
        }

        // 构建错误数据（包含更多上下文信息）
        const errorExtraData = {
            status_text: statusText,
            // 🔴 标准化失败分类（方便后台统计分析）
            failure_category: failureCategory,
            // 🔑 附加诊断信息
            context: {
                url: window.location.href,
                timestamp: new Date().toISOString(),
                platform: platform || "unknown",
            },
        };

        // 如果有 PublishLogger，附加最近日志摘要
        if (window.PublishLogger) {
            const recentLogs = window.PublishLogger.getRecentLogs(5);
            if (recentLogs.length > 0) {
                errorExtraData.context.recentActions = recentLogs.map(log => ({
                    time: log.timestamp,
                    action: log.action,
                    message: log.message,
                }));
            }
        }

        // 🔴 合并调用方附加的结构化字段（如 diagnosis、显式 failure_category 覆盖）
        // categorizeContext 仅用于分类提示，不上报到后台
        if (extraFields && typeof extraFields === "object") {
            const { categorizeContext, ...mergeable } = extraFields;
            Object.assign(errorExtraData, mergeable);
        }

        const scanData = await window.buildStatisticsRequestData(publishId, platform, errorExtraData);
        try {
            console.log(`[${platform || "发布"}] 📤 发送失败统计接口，ID: ${publishId}, 错误: ${statusText}${isGeo ? " [GEO-仅一次]" : ""}`);
            console.log(`[${platform || "发布"}] 统计接口地址: ${url}`);

            // 🔒 只发一次：不重试、不入补报队列（用户要求「只有一次」）
            const result = await window.retryOperation(async () => {
                // 每个 fetch 带 10s 超时，网慢时超时报错触发重试
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                try {
                    const response = await fetch(url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(scanData),
                        keepalive: true,
                        signal: controller.signal,
                    });
                    const text = await response.text();
                    let parsed = null;
                    try { parsed = JSON.parse(text); } catch (_) {}
                    const evaluation = evaluateStatisticsResponse(response, parsed);
                    if (!evaluation.ok) {
                        throw new Error(formatStatisticsResponseError(response, parsed));
                    }
                    return { response, parsed, evaluation };
                } finally {
                    clearTimeout(timeoutId);
                }
            }, 1, 0);

            console.log(`[${platform || "发布"}] ✅ 失败统计接口已确认: code=${result.evaluation.code} reason=${result.evaluation.reason || "ok"}`);
            return { success: true, response: result.response, code: result.evaluation.code };
        } catch (e) {
            // 🔒 失败/超时后不释放去重锁：请求可能已到达服务器，释放会导致重复上报（同一 publishId 最多 1 次请求）
            console.error(`[${platform || "发布"}] ❌ 失败统计上报失败（只发 1 次，不重试、不补报、不解锁）:`, e.message);
            // 🔒 只发一次：不入补报队列。
            return { success: false, error: e };
        }
    };

    // ===========================
    // 📦 统计上报「离线补报队列」
    // 背景：sendStatistics/sendStatisticsError 重试 3 次仍失败（后台挂掉/长时间无响应）时，
    //       原逻辑只 console.error 后丢弃 → 数据永久丢失。
    // 方案：把失败的上报落盘到 global-storage（持久化、重启不丢），后台恢复后自动补发。
    // 防多窗口竞态：多账号会并发开多个发布窗口，故「每条独立 key」而非单数组，
    //              靠 setGlobalData 单键写入天然隔离，避免「读-改-写」互相覆盖。
    // ===========================
    const STAT_PENDING_PREFIX = "STAT_PENDING_";
    const STAT_MAX_ATTEMPTS = 10;                      // 单条补发累计超过 10 次则丢弃（死信）
    const STAT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;   // 单条超过 7 天则丢弃（死信）

    // 入队：把一条彻底失败的上报存入补报队列
    // @param {Object} item - { url, scanData, resultType('success'|'error'), platform, publishId }
    window.enqueueFailedStatReport = async function (item) {
        try {
            if (!window.browserAPI?.setGlobalData) {
                console.warn("[统计补报] ⚠️ browserAPI.setGlobalData 不可用，无法入队");
                return false;
            }
            if (!item || !item.url || !item.scanData) {
                console.warn("[统计补报] ⚠️ 入队数据不完整，跳过");
                return false;
            }
            if (window.isGeoStatisticsReport?.(item.url)) {
                console.warn("[统计补报] ⚠️ GEO 统计不入补报队列，避免重复记录");
                return false;
            }
            const resultType = item.resultType || "unknown";
            // publishId 缺失时用时间戳兜底，保证 key 唯一不互相覆盖
            const pid = item.publishId || `noid_${Date.now()}`;
            const key = `${STAT_PENDING_PREFIX}${pid}_${resultType}`;
            const record = {
                url: item.url,
                scanData: item.scanData,
                resultType,
                platform: item.platform || "",
                publishId: item.publishId || "",
                createdAt: Date.now(),
                attempts: 0,
            };
            await window.browserAPI.setGlobalData(key, record);
            console.log(`[统计补报] 📥 已落盘待补报：${key}`);
            return true;
        } catch (e) {
            console.warn("[统计补报] ⚠️ 入队失败:", e.message);
            return false;
        }
    };

    // 补发：读取队列逐条重发，成功移除 / 失败累计 / 超限丢弃。带并发锁防重入，单条异常不影响其它条。
    window.flushFailedStatReports = async function () {
        if (window.__STAT_FLUSH_RUNNING__) return;
        if (!window.browserAPI?.getAllGlobalData || typeof window.postStatisticsRequest !== "function") return;
        window.__STAT_FLUSH_RUNNING__ = true;
        try {
            const all = await window.browserAPI.getAllGlobalData();
            if (!all || typeof all !== "object") return;
            const keys = Object.keys(all).filter(k => k.startsWith(STAT_PENDING_PREFIX));
            if (keys.length === 0) return;
            console.log(`[统计补报] 🔁 待补报 ${keys.length} 条，开始补发...`);

            for (const key of keys) {
                try {
                    let item = all[key];
                    // 兼容历史被序列化成字符串的情况
                    if (typeof item === "string") {
                        try { item = JSON.parse(item); } catch (_) { item = null; }
                    }
                    // 坏数据 / 缺字段：直接清除
                    if (!item || !item.url || !item.scanData) {
                        await window.browserAPI.removeGlobalData(key);
                        continue;
                    }
                    if (window.isGeoStatisticsReport?.(item.url)) {
                        console.warn(`[统计补报] 🗑️ 清理历史 GEO 待补报项，避免重复记录：${key}`);
                        await window.browserAPI.removeGlobalData(key);
                        continue;
                    }
                    const normalizedPublishId = String(item.publishId || "").trim();
                    if (item.resultType === "error" && normalizedPublishId) {
                        const successKey = getStatisticsGlobalReportCacheKey(normalizedPublishId, "success");
                        const successCached = await getGlobalStatisticsReport(successKey);
                        if (String(successCached?.publishId || "") === normalizedPublishId) {
                            console.warn(`[统计补报] 🗑️ 已存在成功上报，清理历史失败待补报项：${key}`);
                            await window.browserAPI.removeGlobalData(key);
                            continue;
                        }
                    }
                    // 死信检查：超次数 / 超时长 → 丢弃
                    const age = Date.now() - (item.createdAt || 0);
                    if ((item.attempts || 0) >= STAT_MAX_ATTEMPTS || age > STAT_MAX_AGE_MS) {
                        console.warn(`[统计补报] 🗑️ 丢弃死信：${key}（attempts=${item.attempts || 0}, age≈${Math.round(age / 86400000)}天）`);
                        await window.browserAPI.removeGlobalData(key);
                        continue;
                    }
                    // 尝试补发（单条带 3 次重试，应对后台部分节点间歇性失败：
                    //   撞坏节点≈50%时，单次补发也≈50%成功，带3次重试后单条成功率大幅提升；
                    //   与外层 attempts 累计形成「本轮内3重试 + 跨轮/跨窗口重试」双层兜底）
                    try {
                        const doPost = () => window.postStatisticsRequest(item.url, item.scanData);
                        if (typeof window.retryOperation === "function") {
                            await window.retryOperation(doPost, 3, 600);
                        } else {
                            await doPost();
                        }
                        await window.browserAPI.removeGlobalData(key);
                        console.log(`[统计补报] ✅ 补发成功并移除：${key}`);
                    } catch (e) {
                        item.attempts = (item.attempts || 0) + 1;
                        item.lastTriedAt = Date.now();
                        await window.browserAPI.setGlobalData(key, item);
                        console.warn(`[统计补报] ⚠️ 补发失败（第 ${item.attempts} 次）：${key} - ${e.message}`);
                    }
                } catch (perItemErr) {
                    console.warn(`[统计补报] ⚠️ 处理 ${key} 异常:`, perItemErr.message);
                }
            }
        } catch (e) {
            console.warn("[统计补报] ⚠️ flush 异常:", e.message);
        } finally {
            window.__STAT_FLUSH_RUNNING__ = false;
        }
    };

    // ===========================
    // 💬 页面内浮动提示条（用于「发布成功但统计上报失败」等需让用户知晓的场景）
    // 参考 hidePageAndShowMask 的 DOM 注入风格；纯展示，绝不抛错影响主流程。
    // @param {string} message  - 提示文案
    // @param {string} type     - success | warning | error | info（决定背景色）
    // @param {number} duration - 自动消失时长（ms），默认 6000
    // ===========================
    window.showPublishToast = function (message, type = "success", duration = 6000) {
        try {
            const TOAST_ID = "__publish_toast__";
            // 幂等：先清掉旧的
            const old = document.getElementById(TOAST_ID);
            if (old) old.remove();

            const colorMap = {
                success: "#52c41a",
                warning: "#faad14",
                error: "#ff4d4f",
                info: "#1890ff",
            };
            const bg = colorMap[type] || colorMap.success;

            const toast = document.createElement("div");
            toast.id = TOAST_ID;
            toast.textContent = message;
            toast.style.cssText = [
                "position:fixed",
                "top:24px",
                "left:50%",
                "transform:translateX(-50%) translateY(-12px)",
                "max-width:80vw",
                "padding:12px 20px",
                "background:" + bg,
                "color:#fff",
                "font-size:14px",
                "line-height:1.5",
                "border-radius:8px",
                "box-shadow:0 4px 16px rgba(0,0,0,0.2)",
                "z-index:2147483647",
                "opacity:0",
                "transition:opacity .3s ease, transform .3s ease",
                "pointer-events:none",
                "white-space:pre-wrap",
                "text-align:center",
            ].join(";");

            // body 未就绪时降级挂到 documentElement
            const mount = document.body || document.documentElement;
            mount.appendChild(toast);

            // 强制下一帧淡入
            requestAnimationFrame(() => {
                toast.style.opacity = "1";
                toast.style.transform = "translateX(-50%) translateY(0)";
            });

            // duration 后淡出并移除
            setTimeout(() => {
                try {
                    toast.style.opacity = "0";
                    toast.style.transform = "translateX(-50%) translateY(-12px)";
                    setTimeout(() => { try { toast.remove(); } catch (_) {} }, 350);
                } catch (_) {}
            }, duration);
        } catch (e) {
            console.warn("[showPublishToast] ⚠️ 显示提示失败:", e.message);
        }
    };

    // ===========================
    // 🔴 发布脚本公共方法（消息处理、会话恢复等）
    // ===========================

    /**
     * 解析消息数据（字符串或对象均可）
     * @param {Object|string} data - 消息数据
     * @param {string} logPrefix - 日志前缀
     * @returns {Object|null} 解析后的数据，失败返回 null
     */
    window.parseMessageData = function (data, logPrefix = "[发布]") {
        try {
            return typeof data === "string" ? JSON.parse(data) : data;
        } catch (parseError) {
            console.error(`${logPrefix} ❌ 解析消息数据失败:`, parseError);
            console.error(`${logPrefix} 原始数据:`, data);
            return null;
        }
    };

    /**
     * 检查窗口 ID 是否匹配
     * @param {Object} message - 消息对象，包含 windowId 字段
     * @param {string} logPrefix - 日志前缀
     * @returns {Promise<boolean>} 是否匹配（无 windowId 时返回 true）
     */
    window.checkWindowIdMatch = async function (message, logPrefix = "[发布]") {
        // 强制检查：必须有 windowId，否则拒绝
        if (!message.windowId) {
            console.error(`${logPrefix} ❌ 收到的发布消息缺少 windowId 字段，已拒绝处理！`);
            return false; // 强制拒绝，不再是条件性的
        }

        try {
            const myWindowId = await window.browserAPI.getWindowId();
            console.log(`${logPrefix} 我的窗口 ID:`, myWindowId, "消息目标窗口 ID:", message.windowId);

            if (myWindowId !== message.windowId) {
                console.warn(`${logPrefix} ⚠️ 消息不是发给我的，拒绝处理`);
                return false;
            }

            console.log(`${logPrefix} ✅ windowId 匹配，安全处理消息`);
            return true;
        } catch (e) {
            console.error(`${logPrefix} ❌ 检查 windowId 失败:`, e);
            return false; // 出错时拒绝处理，防止串联
        }
    };

    /**
     * 恢复会话数据并刷新页面
     * @param {Object} messageData - 发布数据（包含 cookies 字段）
     * @param {string} logPrefix - 日志前缀
     * @returns {Promise<boolean>} 是否需要刷新（true 表示已触发刷新，调用方应 return）
     */
    window.restoreSessionAndReload = async function (messageData, logPrefix = "[发布]") {
        if (!messageData.cookies) {
            return false; // 没有 cookies 数据，无需恢复
        }

        const currentUrl = String(window.location.href || '');
        if (String(logPrefix || '').includes('视频号') || currentUrl.includes('channels.weixin.qq.com')) {
            const windowId = await window.browserAPI.getWindowId();
            await window.browserAPI.setGlobalData(`publish_data_window_${windowId}`, messageData);
            console.log(`${logPrefix} ⏭️ 视频号链路跳过 restoreSessionAndReload，避免刷新打断扫码/登录态保存`);
            return false;
        }

        console.log(`${logPrefix} 📦 检测到 cookies 数据，开始恢复会话...`);

        try {
            const cookiesData = typeof messageData.cookies === "string" ? messageData.cookies : JSON.stringify(messageData.cookies);

            const restoreResult = await window.browserAPI.restoreSessionData(cookiesData);

            if (restoreResult.success) {
                console.log(`${logPrefix} ✅ 会话数据恢复成功:`, restoreResult.results);
                console.log(`${logPrefix} 🔄 刷新页面以应用 cookies...`);

                // 保存消息数据到全局存储，刷新后继续使用
                const windowId = await window.browserAPI.getWindowId();
                await window.browserAPI.setGlobalData(`publish_data_window_${windowId}`, messageData);

                window.location.reload();
                return true; // 已触发刷新
            } else {
                console.warn(`${logPrefix} ⚠️ 会话数据恢复失败:`, restoreResult.error);
                return false;
            }
        } catch (restoreError) {
            console.error(`${logPrefix} ⚠️ 会话数据恢复异常:`, restoreError);
            return false;
        }
    };

    /**
     * 保存发布数据到全局存储（收到数据时立即调用，用于登录跳转后恢复）
     * @param {Object} messageData - 发布数据
     * @param {string} logPrefix - 日志前缀
     * @returns {Promise<boolean>} 是否保存成功
     */
    window.savePublishDataToGlobalStorage = async function (messageData, logPrefix = "[发布]") {
        try {
            const windowId = await window.browserAPI.getWindowId();
            if (!windowId) {
                console.log(`${logPrefix} ❌ 无法获取窗口 ID，跳过保存`);
                return false;
            }

            await window.browserAPI.setGlobalData(`publish_data_window_${windowId}`, messageData);
            console.log(`${logPrefix} 💾 已保存发布数据到 globalData (窗口 ${windowId})`);
            return true;
        } catch (e) {
            console.error(`${logPrefix} ❌ 保存发布数据到 globalData 失败:`, e);
            return false;
        }
    };

    /**
     * 从全局存储加载发布数据（刷新页面或登录跳转后使用）
     * 注意：此函数不会删除数据，需要在发布完成后调用 clearPublishDataFromGlobalStorage
     * @param {string} logPrefix - 日志前缀
     * @returns {Promise<Object|null>} 发布数据，无数据返回 null
     */
    window.loadPublishDataFromGlobalStorage = async function (logPrefix = "[发布]") {
        try {
            const windowId = await window.browserAPI.getWindowId();
            console.log(`${logPrefix} 检查全局存储，窗口 ID:`, windowId);

            if (!windowId) {
                console.log(`${logPrefix} ❌ 无法获取窗口 ID`);
                return null;
            }

            const publishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
            console.log(`${logPrefix} 📦 从全局存储读取 publish_data_window_${windowId}:`, publishData ? "有数据" : "无数据");

            // 🔑 不在这里删除数据，而是在发布完成后调用 clearPublishDataFromGlobalStorage 删除
            // 这样即使中途跳转到登录页，数据也不会丢失

            return publishData;
        } catch (e) {
            console.error(`${logPrefix} ❌ 从全局存储加载数据失败:`, e);
            return null;
        }
    };

    /**
     * 清除全局存储中的发布数据（发布完成或失败后调用）
     * @param {string} logPrefix - 日志前缀
     * @returns {Promise<boolean>} 是否清除成功
     */
    window.clearPublishDataFromGlobalStorage = async function (logPrefix = "[发布]") {
        try {
            const windowId = await window.browserAPI.getWindowId();
            if (!windowId) {
                console.log(`${logPrefix} ❌ 无法获取窗口 ID，跳过清除`);
                return false;
            }

            await window.browserAPI.removeGlobalData(`publish_data_window_${windowId}`);
            console.log(`${logPrefix} 🗑️ 已清除 globalData 中的发布数据 (窗口 ${windowId})`);
            return true;
        } catch (e) {
            console.error(`${logPrefix} ❌ 清除 globalData 发布数据失败:`, e);
            return false;
        }
    };

    /**
     * 获取当前窗口 ID 并记录日志
     * @param {string} logPrefix - 日志前缀
     * @returns {Promise<number|string|null>} 窗口 ID
     */
    window.getCurrentWindowId = async function (logPrefix = "[发布]") {
        try {
            const windowId = await window.browserAPI.getWindowId();
            console.log(`${logPrefix} 当前窗口 ID:`, windowId);
            return windowId;
        } catch (e) {
            console.error(`${logPrefix} ❌ 获取窗口 ID 失败:`, e);
            return null;
        }
    };

    // 带重试的点击按钮（改进版 - 等待按钮可用后再点击）
    // defaultMessage: 当没有捕获到平台提示时返回的默认消息（用于小红书等跳页面代表成功的平台）
    window.clickWithRetry = async function (element, maxRetries = 3, delay = 300, captureMessage = false, defaultMessage = "发布成功") {
        if (!element) {
            console.error("[clickWithRetry] 元素不存在");
            return { success: false, message: "元素不存在" };
        }

        for (let i = 0; i < maxRetries; i++) {
            // 检查按钮是否可点击
            if (element.offsetParent === null || element.disabled) {
                console.log(`[clickWithRetry] 第 ${i + 1}/${maxRetries} 次尝试：按钮不可用（hidden or disabled）`);
                if (i < maxRetries - 1) {
                    console.log(`[clickWithRetry] 等待 ${delay}ms 后重试...`);
                    await window.delay(delay);
                    continue;
                } else {
                    console.error("[clickWithRetry] ❌ 按钮始终不可用，所有重试失败");
                    return { success: false, message: "按钮不可用" };
                }
            }

            // 尝试点击按钮
            try {
                console.log(`[clickWithRetry] 第 ${i + 1}/${maxRetries} 次点击按钮`);

                // 如果需要捕获提示信息，设置监听器
                let capturedMessage = "";
                let messageObserver = null;
                const allMessages = []; // 收集所有捕获的消息

                if (captureMessage) {
                    console.log("🚀 ~ clickWithRetry ~ captureMessage: ", captureMessage);
                    // 需要忽略的中间状态消息
                    const ignoredMessages = ["正在发布", "正在提交", "正在上传", "加载中", "处理中"];

                    // 创建 MutationObserver 监听页面新增的提示元素
                    messageObserver = new MutationObserver(mutations => {
                        for (const mutation of mutations) {
                            for (const node of mutation.addedNodes) {
                                if (node.nodeType === 1) {
                                    // Element node
                                    // 检查是否是提示元素（常见的提示组件）
                                    const element = node;
                                    const classList = element.classList ? Array.from(element.classList).join(" ") : "";
                                    const className = element.className || "";

                                    // 匹配常见的提示类名
                                    if (
                                        classList.includes("toast") ||
                                        classList.includes("message") ||
                                        classList.includes("notification") ||
                                        classList.includes("ant-message") ||
                                        classList.includes("el-message") ||
                                        classList.includes("van-toast") ||
                                        classList.includes("semi-toast") ||
                                        classList.includes("weui-toast") ||
                                        classList.includes("cheetah-message") || // 百家号
                                        className.includes("toast") ||
                                        className.includes("message") ||
                                        className.includes("cheetah-message") // 百家号
                                    ) {
                                        // 优先查找具体的文本容器（更精确）
                                        let text = "";

                                        // Semi Design toast
                                        const semiText = element.querySelector(".semi-toast-content-text");
                                        if (semiText) {
                                            text = semiText.textContent || semiText.innerText || "";
                                        }

                                        // Ant Design message
                                        if (!text) {
                                            const antText = element.querySelector(".ant-message-custom-content");
                                            if (antText) {
                                                text = antText.textContent || antText.innerText || "";
                                            }
                                        }

                                        // Element UI message
                                        if (!text) {
                                            const elText = element.querySelector(".el-message__content");
                                            if (elText) {
                                                text = elText.textContent || elText.innerText || "";
                                            }
                                        }

                                        // 百家号 Cheetah UI message（注意：第一个span是图标，第二个span是文本）
                                        if (!text) {
                                            const cheetahText = element.querySelector(".cheetah-message-error span:last-child") || element.querySelector(".cheetah-message-custom-content span:last-child");
                                            if (cheetahText) {
                                                text = cheetahText.textContent || cheetahText.innerText || "";
                                            }
                                        }

                                        // 回退：使用整个元素的文本
                                        if (!text) {
                                            text = element.textContent || element.innerText || "";
                                        }

                                        if (text.trim()) {
                                            allMessages.push(text.trim());
                                        }
                                    }

                                    // 递归检查子元素（查找所有可能的 toast 容器）
                                    const toastElements = element.querySelectorAll('[class*="toast"], [class*="message"], [class*="notification"], [class*="cheetah-message"]');
                                    for (const toast of toastElements) {
                                        // 优先查找具体的文本容器
                                        let text = "";

                                        // 百家号 Cheetah UI（优先检查，因为结构特殊）
                                        const cheetahText = toast.querySelector(".cheetah-message-error span:last-child") || toast.querySelector(".cheetah-message-custom-content span:last-child");
                                        if (cheetahText) {
                                            text = cheetahText.textContent || cheetahText.innerText || "";
                                        }

                                        // Semi Design toast
                                        if (!text) {
                                            const semiText = toast.querySelector(".semi-toast-content-text");
                                            if (semiText) {
                                                text = semiText.textContent || semiText.innerText || "";
                                            }
                                        }

                                        // 回退：使用整个元素的文本
                                        if (!text) {
                                            text = toast.textContent || toast.innerText || "";
                                        }

                                        if (text.trim()) {
                                            allMessages.push(text.trim());
                                        }
                                    }
                                }
                            }
                        }
                    });

                    // 开始监听整个 body 的变化
                    messageObserver.observe(document.body, {
                        childList: true,
                        subtree: true,
                    });
                }

                // 点击按钮
                if (typeof element.click === "function") {
                    element.click();
                } else {
                    // 如果 click 方法不可用，使用事件
                    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
                }

                console.log("[clickWithRetry] ✅ 点击成功");

                // 如果需要捕获提示信息，等待提示出现
                if (captureMessage) {
                    console.log("[clickWithRetry] ⏳ 等待提示信息出现（3秒）...");
                    await window.delay(3000);

                    // 停止监听
                    if (messageObserver) {
                        messageObserver.disconnect();
                    }

                    // 从收集的消息中筛选最后一条有意义的消息（排除中间状态）
                    const ignoredMessages = ["正在发布", "正在提交", "正在上传", "加载中", "处理中"];
                    if (allMessages.length > 0) {
                        // 从后往前找第一条不是中间状态的消息
                        for (let j = allMessages.length - 1; j >= 0; j--) {
                            const msg = allMessages[j];
                            const isIgnored = ignoredMessages.some(ignored => msg.includes(ignored));
                            if (!isIgnored) {
                                capturedMessage = msg;
                                break;
                            }
                        }
                        // 如果所有消息都是中间状态，就取最后一条
                        if (!capturedMessage && allMessages.length > 0) {
                            capturedMessage = allMessages[allMessages.length - 1];
                        }
                        console.log("[clickWithRetry] 📨 最终捕获到提示信息:", capturedMessage);
                        console.log("[clickWithRetry] 📋 所有捕获的消息:", allMessages);
                    }

                    // 如果没有通过 MutationObserver 捕获到，尝试直接查找现有的提示元素
                    if (!capturedMessage) {
                        const possibleSelectors = [
                            ".cheetah-message-custom-content.cheetah-message-error span:last-child", // 百家号错误提示（优先，第一个span是图标）
                            ".cheetah-message-custom-content span:last-child", // 百家号普通提示
                            ".d-toast-description", // 小红书 toast
                            ".semi-toast-content-text", // 抖音 toast
                            ".ant-message-custom-content", // Ant Design
                            ".el-message__content", // Element UI
                            '[class*="toast"]',
                            '[class*="message"]',
                            '[class*="notification"]',
                            ".ant-message",
                            ".el-message",
                            ".van-toast",
                            ".semi-toast",
                            ".weui-toast",
                        ];

                        for (const selector of possibleSelectors) {
                            try {
                                const elements = document.querySelectorAll(selector);
                                for (const el of elements) {
                                    // 检查元素是否可见
                                    if (el.offsetParent !== null) {
                                        const text = el.textContent || el.innerText || "";
                                        if (text.trim()) {
                                            capturedMessage = text.trim();
                                            console.log("[clickWithRetry] 📨 捕获到提示信息（现有元素）:", capturedMessage);
                                            break;
                                        }
                                    }
                                }
                                if (capturedMessage) break;
                            } catch (e) {
                                // 忽略选择器错误
                            }
                        }
                    }

                    return {
                        success: true,
                        message: capturedMessage || defaultMessage,
                    };
                }

                return { success: true, message: "点击成功" };
            } catch (e) {
                console.error(`[clickWithRetry] 第 ${i + 1}/${maxRetries} 次点击失败:`, e.message);
                if (i < maxRetries - 1) {
                    console.log(`[clickWithRetry] 等待 ${delay}ms 后重试...`);
                    await window.delay(delay);
                }
            }
        }

        console.error("[clickWithRetry] ❌ 所有点击尝试均失败");
        return { success: false, message: "所有点击尝试均失败" };
    };

    window.clickWithTrustedRetry = async function (element, maxRetries = 3, delay = 300, captureMessage = false, defaultMessage = "发布成功") {
        if (!element) {
            console.error("[clickWithTrustedRetry] 元素不存在");
            return { success: false, message: "元素不存在" };
        }

        const delayFn = getNativeInputDelay();
        const successKeywords = ["成功", "提交成功", "发布成功", "上传成功"];
        const possibleSelectors = [
            ".cheetah-message-custom-content.cheetah-message-error span:last-child",
            ".cheetah-message-custom-content span:last-child",
            ".d-toast-description",
            ".semi-toast-content-text",
            ".ant-message-custom-content",
            ".el-message__content",
            ".d-message-content",
            '[class*="toast"]',
            '[class*="message"]',
            '[class*="notification"]',
            ".ant-message",
            ".el-message",
            ".van-toast",
            ".semi-toast",
            ".weui-toast",
        ];

        const readVisibleMessage = () => {
            for (const selector of possibleSelectors) {
                try {
                    const elements = document.querySelectorAll(selector);
                    for (const el of elements) {
                        if (el && el.offsetParent !== null) {
                            const text = (el.textContent || el.innerText || "").trim();
                            if (text && !successKeywords.some(keyword => text.includes(keyword))) {
                                return text;
                            }
                        }
                    }
                } catch (_) {
                    // ignore selector errors
                }
            }
            return "";
        };

        for (let i = 0; i < maxRetries; i++) {
            if (element.offsetParent === null || element.disabled) {
                console.log(`[clickWithTrustedRetry] 第 ${i + 1}/${maxRetries} 次尝试：按钮不可用（hidden or disabled）`);
                if (i < maxRetries - 1) {
                    console.log(`[clickWithTrustedRetry] 等待 ${delay}ms 后重试...`);
                    await delayFn(delay);
                    continue;
                }
                console.error("[clickWithTrustedRetry] ❌ 按钮始终不可用，所有重试失败");
                return { success: false, message: "按钮不可用" };
            }

            try {
                console.log(`[clickWithTrustedRetry] 第 ${i + 1}/${maxRetries} 次点击按钮`);
                const clickResult = await window.nativeClickElement(element, {
                    logPrefix: "[clickWithTrustedRetry]",
                    allowJsFallback: false,
                });

                if (!clickResult.success) {
                    throw new Error(clickResult.message || "原生点击失败");
                }

                console.log("[clickWithTrustedRetry] ✅ 点击成功");

                if (captureMessage) {
                    console.log("[clickWithTrustedRetry] ⏳ 等待提示信息出现（3秒）...");
                    await delayFn(3000);
                    const capturedMessage = readVisibleMessage();
                    return {
                        success: true,
                        message: capturedMessage || defaultMessage,
                    };
                }

                return { success: true, message: "点击成功" };
            } catch (error) {
                console.error(`[clickWithTrustedRetry] 第 ${i + 1}/${maxRetries} 次点击失败:`, error.message);
                if (i < maxRetries - 1) {
                    console.log(`[clickWithTrustedRetry] 等待 ${delay}ms 后重试...`);
                    await delayFn(delay);
                }
            }
        }

        console.error("[clickWithTrustedRetry] ❌ 所有点击尝试均失败");
        return { success: false, message: "所有点击尝试均失败" };
    };

    // 发送成功消息并关闭窗口
    // 🔑 增加默认延迟到 2500ms，确保消息有足够时间到达 Vue 应用
    // 🔑 publish_data_window 由主进程在窗口 closed 后统一清理。
    // 提前删除会让 close handler 拿不到账号上下文，导致登录态保存被跳过。
    window.closeWindowWithMessage = async function (message = "发布成功，刷新数据", delay = 10000) {
        console.log(`[closeWindow] 发送消息: ${message}`);
        window.sendMessageToParent(message);

        // 🔑 额外等待 500ms 确保 IPC 消息已发送到主进程
        await window.delay(500);

        if (delay > 0) {
            console.log(`[closeWindow] 等待 ${delay}ms 确保消息到达...`);
            await window.delay(delay);
        }

        // 开发环境下跳过关闭窗口，方便测试（旧版浏览器未暴露 isProduction，按生产环境处理）
        if (window.browserAPI && window.browserAPI.isProduction === false) {
            console.log("[closeWindow] ⚠️ 开发环境，跳过关闭窗口");
            return true;
        }

        try {
            console.log("[closeWindow] 尝试关闭窗口...");
            await window.browserAPI.closeCurrentWindow();
            console.log("[closeWindow] ✅ 窗口已关闭");
            return true;
        } catch (e) {
            console.error("[closeWindow] ❌ 关闭窗口失败:", e);
            return false;
        }
    };

    // 延迟执行（带随机抖动的 Promise 包装 setTimeout）
    window.getRandomDelayMs = function (ms, jitterMs) {
        const baseMs = Number.isFinite(Number(ms)) ? Math.max(0, Math.floor(Number(ms))) : 0;
        const hasCustomJitter = jitterMs !== null && typeof jitterMs !== "undefined" && Number.isFinite(Number(jitterMs));
        const resolvedJitterMs = hasCustomJitter
            ? Math.max(0, Math.floor(Number(jitterMs)))
            : Math.max(80, Math.round(baseMs * 0.35));
        return baseMs + Math.floor(Math.random() * (resolvedJitterMs + 1));
    };
    window.delay = function (ms, jitterMs) {
        const actualMs = window.getRandomDelayMs(ms, jitterMs);
        return new Promise(resolve => setTimeout(resolve, actualMs));
    };
    window.randomDelay = window.delay;

    // ===========================
    // 🔴 通用错误监听器工厂函数
    // ===========================
    /**
     * 创建错误监听器实例
     * @param {Object} options - 配置选项
     * @param {string} options.logPrefix - 日志前缀，如 '[搜狐号发布]'
     * @param {Array} options.selectors - 选择器配置数组，每项包含：
     *   - {string} containerClass - 容器类名（用于 classList.includes 检测）
     *   - {string} textSelector - 文本元素选择器
     *   - {string} [recursiveSelector] - 可选，递归查找的选择器
     * @param {Array} [options.ignoredMessages] - 要忽略的消息列表
     * @returns {Object} 返回监听器实例，包含 start, stop, getLatestError, getErrors, clear 方法
     *
     * @example
     * // 搜狐号用法
     * const errorListener = createErrorListener({
     *   logPrefix: '[搜狐号发布]',
     *   selectors: [
     *     { containerClass: 'ne-snackbar-item-description', textSelector: 'span:last-child' },
     *     { containerClass: 'el-message--error', textSelector: '.el-message__content', recursiveSelector: '.el-message.el-message--error' }
     *   ]
     * });
     * errorListener.start();
     * // ... 执行操作 ...
     * const error = errorListener.getLatestError();
     * errorListener.stop();
     *
     * @example
     * // 腾讯号用法
     * const errorListener = createErrorListener({
     *   logPrefix: '[腾讯号发布]',
     *   selectors: [
     *     { containerClass: 'omui-message', textSelector: '.omui-message__desc', recursiveSelector: '.omui-message' }
     *   ]
     * });
     */
    window.createErrorListener = function (options = {}) {
        const { logPrefix = "[发布]", selectors = [], ignoredMessages = ["正在上传", "加载中", "处理中", "成功", "发布成功", "提交成功", "上传成功", "设置区", "设置", "配置", "选项", "功能", "功能暂未开放", "暂未开放"] } = options;

        // 内部状态
        const capturedErrors = [];
        let errorObserver = null;

        // 启动错误监听
        function start() {
            if (errorObserver) {
                console.log(`${logPrefix} ⚠️ 错误监听器已经在运行`);
                return;
            }

            console.log(`${logPrefix} 🔍 启动全局错误监听器...`);

            errorObserver = new MutationObserver(mutations => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) {
                            const element = node;
                            const classList = element.classList ? Array.from(element.classList).join(" ") : "";

                            // 遍历所有配置的选择器
                            for (const selectorConfig of selectors) {
                                const { containerClass, textSelector, recursiveSelector } = selectorConfig;

                                // 检测容器类名
                                if (containerClass && classList.includes(containerClass)) {
                                    const textEl = element.querySelector(textSelector);
                                    if (textEl) {
                                        const text = (textEl.textContent || "").trim();
                                        if (text && !capturedErrors.includes(text)) {
                                            capturedErrors.push(text);
                                            console.log(`${logPrefix} 📨 捕获到错误信息:`, text);
                                        }
                                    }
                                }

                                // 递归检查子元素
                                if (recursiveSelector) {
                                    const childElements = element.querySelectorAll(recursiveSelector);
                                    for (const childEl of childElements) {
                                        const textEl = childEl.querySelector(textSelector);
                                        if (textEl) {
                                            const text = (textEl.textContent || "").trim();
                                            if (text && !capturedErrors.includes(text)) {
                                                capturedErrors.push(text);
                                                console.log(`${logPrefix} 📨 捕获到错误信息（子元素）:`, text);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });

            errorObserver.observe(document.body, {
                childList: true,
                subtree: true,
            });

            console.log(`${logPrefix} ✅ 全局错误监听器已启动`);
        }

        // 停止错误监听
        function stop() {
            if (errorObserver) {
                errorObserver.disconnect();
                errorObserver = null;
                console.log(`${logPrefix} 🛑 全局错误监听器已停止`);
            }
        }

        // 获取最新的错误信息（过滤掉忽略的消息）
        function getLatestError() {
            for (let i = capturedErrors.length - 1; i >= 0; i--) {
                const msg = capturedErrors[i];
                const isIgnored = ignoredMessages.some(ignored => msg.includes(ignored));
                if (!isIgnored) {
                    console.log(`${logPrefix} 🔍 getLatestError 返回:`, msg);
                    return msg;
                }
            }
            return null;
        }

        // 获取所有错误
        function getErrors() {
            return [...capturedErrors];
        }

        // 清空错误列表
        function clear() {
            capturedErrors.length = 0;
            console.log(`${logPrefix} 🗑️ 错误列表已清空`);
        }

        // 返回监听器实例
        return {
            start,
            stop,
            getLatestError,
            getErrors,
            clear,
        };
    };

    // 预定义的平台错误监听器配置
    window.ERROR_LISTENER_CONFIGS = {
        // 搜狐号
        sohu: {
            logPrefix: "[搜狐号发布]",
            selectors: [
                { containerClass: "ne-snackbar-item-description", textSelector: "span:last-child" },
                { containerClass: "el-message--error", textSelector: ".el-message__content", recursiveSelector: ".el-message.el-message--error" },
            ],
        },
        // 腾讯号
        tengxun: {
            logPrefix: "[腾讯号发布]",
            selectors: [{ containerClass: "omui-message", textSelector: ".omui-message__desc", recursiveSelector: ".omui-message" }],
        },
        // 百家号
        baijiahao: {
            logPrefix: "[百家号发布]",
            selectors: [
                { containerClass: "cheetah-message-error", textSelector: "span:last-child", recursiveSelector: ".cheetah-message.cheetah-message-error" },
                { containerClass: "cheetah-message", textSelector: ".cheetah-message-custom-content span:last-child" },
            ],
        },
        // 抖音
        douyin: {
            logPrefix: "[抖音发布]",
            selectors: [{ containerClass: "semi-toast", textSelector: ".semi-toast-content-text" }],
        },
        // 小红书
        xiaohongshu: {
            logPrefix: "[小红书发布]",
            selectors: [{ containerClass: "d-toast", textSelector: ".d-toast-description" }],
        },
        // 网易号
        wangyi: {
            logPrefix: "[网易号发布]",
            selectors: [
                { containerClass: "ne-snackbar-item-description", textSelector: "span:last-child", recursiveSelector: ".ne-snackbar-item-description" },
                { containerClass: "ne-snackbar-item", textSelector: ".ne-snackbar-item-description span:last-child", recursiveSelector: ".ne-snackbar-item" },
                { containerClass: "el-message--error", textSelector: ".el-message__content", recursiveSelector: ".el-message.el-message--error" },
            ],
        },
        // 头条号
        toutiao: {
            logPrefix: "[头条发布]",
            selectors: [
                { containerClass: "byte-message", textSelector: ".byte-message-content" },
                { containerClass: "byte-message-notice-content", textSelector: ".byte-message-notice-content-text" },
                { containerClass: "semi-toast", textSelector: ".semi-toast-content-text" },
            ],
        },
        // 知乎
        zhihu: {
            logPrefix: "[知乎发布]",
            selectors: [{ containerClass: "Notification-red", textSelector: ".Notification-textSection", recursiveSelector: ".Notification" }],
        },
    //    新浪
        xinlang: {
            logPrefix: "[新浪发布]",
            // 🔴 修复：".n-alert-body__content > div" 查不到子 div（实际"参数错误"是直接文本节点）
            // 改为直接读 .n-alert-body__content 的 textContent
            selectors: [{ containerClass: "n-alert", textSelector: ".n-alert-body__content", recursiveSelector: ".n-alert" }],
        }
    };

    // ===========================
    // 🔴 失败分类标准化工具
    // ===========================

    /**
     * 失败原因分类枚举
     */
    window.FAILURE_CATEGORIES = {
        FORM_VALIDATION: 'form_validation',      // 表单验证错误（标题为空、内容不合规等）
        UPLOAD_FAILED: 'upload_failed',          // 上传失败（图片/视频下载失败、上传超时）
        NETWORK_ERROR: 'network_error',          // 网络错误（API 调用失败）
        PLATFORM_LIMIT: 'platform_limit',        // 平台限制（发文次数限制、手机号认证）
        SCRIPT_ERROR: 'script_error',            // 脚本异常（common.js 未加载、API 不可用）
        TIMEOUT: 'timeout',                      // 超时（元素等待超时、上传超时）
        AUTH_REQUIRED: 'auth_required',          // 需要认证（登录失效、需要手机号认证）
        BUTTON_DISABLED: 'button_disabled',      // 发布按钮不可用
        UNKNOWN: 'unknown',                      // 未知错误
    };

    /**
     * 失败原因分类器（根据错误消息自动判断失败类别）
     * @param {string} errorMessage - 错误消息
     * @param {Object} context - 额外上下文信息（可选）
     * @returns {Object} { category: string, message: string, detail: Object }
     */
    window.categorizeFailure = function (errorMessage, context = {}) {
        const msg = String(errorMessage || '').toLowerCase();
        const { buttonDisabled = false, hasUploadError = false, hasNetworkError = false } = context;

        // 1. 认证相关（兼容「登录已失效」「登录状态过期」「重新登录」等常见文案变体）
        if (/手机号认证|实名认证|需要认证|认证失败|登录.{0,4}(失效|过期|超时)|重新登录|未登录|请先登录|账号.{0,4}异常/.test(msg)) {
            return {
                category: window.FAILURE_CATEGORIES.AUTH_REQUIRED,
                message: errorMessage,
                detail: { type: 'auth', originalMessage: errorMessage }
            };
        }

        // 2. 表单验证错误
        if (/不能为空|必填|请输入|请填写|内容不合规|标题.*长度|敏感词|违规|审核未通过|不符合.*要求/.test(msg)) {
            return {
                category: window.FAILURE_CATEGORIES.FORM_VALIDATION,
                message: errorMessage,
                detail: { type: 'validation', originalMessage: errorMessage }
            };
        }

        // 3. 上传失败
        if (hasUploadError || /上传失败|下载失败|图片.*失败|视频.*失败|文件.*失败|格式不支持|gif.*不支持/.test(msg)) {
            return {
                category: window.FAILURE_CATEGORIES.UPLOAD_FAILED,
                message: errorMessage,
                detail: { type: 'upload', originalMessage: errorMessage }
            };
        }

        // 4. 平台限制
        if (/发文次数|已用尽|超限|超过.*次|达到上限|驳回/.test(msg)) {
            return {
                category: window.FAILURE_CATEGORIES.PLATFORM_LIMIT,
                message: errorMessage,
                detail: { type: 'limit', originalMessage: errorMessage }
            };
        }

        // 5. 超时
        if (/超时|timeout|找不到元素/.test(msg)) {
            return {
                category: window.FAILURE_CATEGORIES.TIMEOUT,
                message: errorMessage,
                detail: { type: 'timeout', originalMessage: errorMessage }
            };
        }

        // 6. 网络错误
        if (hasNetworkError || /网络.*错误|network.*error|连接.*失败|请求.*失败|api.*失败/.test(msg)) {
            return {
                category: window.FAILURE_CATEGORIES.NETWORK_ERROR,
                message: errorMessage,
                detail: { type: 'network', originalMessage: errorMessage }
            };
        }

        // 7. 脚本错误
        if (/common\.js.*未加载|browserapi.*不可用|undefined|is not a function/.test(msg)) {
            return {
                category: window.FAILURE_CATEGORIES.SCRIPT_ERROR,
                message: errorMessage,
                detail: { type: 'script', originalMessage: errorMessage }
            };
        }

        // 8. 按钮 disabled
        if (buttonDisabled || /按钮.*不可用|disabled|按钮.*禁用/.test(msg)) {
            return {
                category: window.FAILURE_CATEGORIES.BUTTON_DISABLED,
                message: errorMessage,
                detail: { type: 'button', originalMessage: errorMessage }
            };
        }

        // 9. 未知错误
        return {
            category: window.FAILURE_CATEGORIES.UNKNOWN,
            message: errorMessage,
            detail: { type: 'unknown', originalMessage: errorMessage }
        };
    };

    /**
     * 通用表单诊断工具（收集表单状态用于失败诊断）
     * @param {Object} config - 配置选项
     * @param {Object} config.selectors - 各字段的选择器
     * @param {Object} config.required - 各字段是否必填
     * @param {Function} config.customChecks - 自定义检查函数（可选）
     * @returns {Object} 诊断结果
     */
    window.collectFormDiagnostics = function (config = {}) {
        const {
            selectors = {},
            required = {},
            customChecks = null,
            platform = 'unknown'
        } = config;

        const diagnostics = {
            platform: platform,
            timestamp: Date.now(),
            fields: {},
            issues: [],
            summary: '',
        };

        // 检查各个字段
        for (const [fieldName, selector] of Object.entries(selectors)) {
            try {
                const element = typeof selector === 'string'
                    ? document.querySelector(selector)
                    : selector;

                const fieldInfo = {
                    exists: !!element,
                    required: !!required[fieldName],
                    value: null,
                    filled: false,
                    valid: true,
                };

                if (element) {
                    // 获取字段值
                    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                        fieldInfo.value = element.value;
                        fieldInfo.filled = !!element.value && element.value.trim().length > 0;
                    } else {
                        fieldInfo.value = element.textContent || element.innerText;
                        fieldInfo.filled = !!fieldInfo.value && fieldInfo.value.trim().length > 0;
                    }

                    // 检查是否满足必填要求
                    if (fieldInfo.required && !fieldInfo.filled) {
                        fieldInfo.valid = false;
                        diagnostics.issues.push(`${fieldName}: 必填字段为空`);
                    }
                }

                diagnostics.fields[fieldName] = fieldInfo;
            } catch (e) {
                diagnostics.fields[fieldName] = {
                    exists: false,
                    error: e.message,
                };
                diagnostics.issues.push(`${fieldName}: 检测异常 - ${e.message}`);
            }
        }

        // 执行自定义检查
        if (typeof customChecks === 'function') {
            try {
                const customResult = customChecks(diagnostics);
                if (customResult && Array.isArray(customResult.issues)) {
                    diagnostics.issues.push(...customResult.issues);
                }
            } catch (e) {
                diagnostics.issues.push(`自定义检查异常: ${e.message}`);
            }
        }

        // 生成摘要
        const missingFields = Object.keys(diagnostics.fields)
            .filter(key => diagnostics.fields[key].required && !diagnostics.fields[key].filled);

        if (missingFields.length > 0) {
            diagnostics.summary = `缺少必填字段: ${missingFields.join(', ')}`;
        } else if (diagnostics.issues.length > 0) {
            diagnostics.summary = `发现 ${diagnostics.issues.length} 个问题`;
        } else {
            diagnostics.summary = '表单填写完整';
        }

        return diagnostics;
    };

    /**
     * 按钮 disabled 原因诊断（当按钮不可用时，诊断可能的原因）
     * @param {HTMLElement} button - 发布按钮元素
     * @param {Object} formDiagnostics - 表单诊断结果（来自 collectFormDiagnostics）
     * @param {Array} recentErrors - 最近的错误消息（来自错误监听器）
     * @returns {Object} 诊断结果
     */
    window.diagnoseButtonDisabled = function (button, formDiagnostics = null, recentErrors = []) {
        const diagnosis = {
            isDisabled: false,
            disabledReasons: [],
            htmlAttributes: {},
            formIssues: [],
            platformErrors: [],
            recommendation: '',
        };

        if (!button) {
            diagnosis.recommendation = '未找到发布按钮';
            return diagnosis;
        }

        // 检查按钮是否 disabled
        diagnosis.isDisabled = !!(
            button.disabled ||
            button.classList.contains('disabled') ||
            button.getAttribute('disabled') !== null ||
            button.getAttribute('aria-disabled') === 'true'
        );

        // 收集 HTML 属性
        diagnosis.htmlAttributes = {
            disabled: button.disabled,
            ariaDisabled: button.getAttribute('aria-disabled'),
            classList: Array.from(button.classList),
        };

        if (!diagnosis.isDisabled) {
            diagnosis.recommendation = '发布按钮可用';
            return diagnosis;
        }

        // 分析可能的原因

        // 1. 表单验证问题
        if (formDiagnostics && formDiagnostics.issues && formDiagnostics.issues.length > 0) {
            diagnosis.formIssues = formDiagnostics.issues;
            diagnosis.disabledReasons.push('表单验证未通过');
        }

        // 2. 平台错误提示
        if (recentErrors && recentErrors.length > 0) {
            diagnosis.platformErrors = recentErrors;
            diagnosis.disabledReasons.push('平台提示错误');
        }

        // 3. 未知原因
        if (diagnosis.disabledReasons.length === 0) {
            diagnosis.disabledReasons.push('未知原因（可能是上传中、加载中或其他平台限制）');
        }

        // 生成建议
        if (diagnosis.formIssues.length > 0) {
            diagnosis.recommendation = `请检查: ${diagnosis.formIssues.join('; ')}`;
        } else if (diagnosis.platformErrors.length > 0) {
            diagnosis.recommendation = `平台提示: ${diagnosis.platformErrors[diagnosis.platformErrors.length - 1]}`;
        } else {
            diagnosis.recommendation = '按钮不可用，请检查表单是否填写完整，或是否有文件正在上传';
        }

        return diagnosis;
    };

    // 判断当前系统类型
    window.getCurrentSystem = function getCurrentSystem() {
        const url = window.location.href;
        if (!url) return "aigc";
        const urlLower = url.toLowerCase();

        // 检查 not-available.html 的查询参数（用于占位页保持正确的 Tab 选中状态）
        if (urlLower.includes("not-available.html") || urlLower.includes("not-auth.html?")) {
            try {
                const urlObj = new URL(url);
                const systemParam = urlObj.searchParams.get("system");
                if (systemParam === "geo") return "geo";
                if (systemParam === "aigc") return "aigc";
            } catch (e) {
                // URL 解析失败，继续使用默认逻辑
            }
        }

        // GEO 系统特征
        if (urlLower.includes(":8080") || urlLower.includes("/geo/") || urlLower.includes("/jzt_all/") || urlLower.includes("jzt_dev") || urlLower.includes("zhjzt")) {
            return "geo";
        }

        // AIGC 系统特征
        if (urlLower.includes(":5173") || urlLower.includes("/aigc_browser/") || urlLower.includes("aigc")) {
            return "aigc";
        }

        // 默认返回 aigc
        return "aigc";
    };

    // ===========================
    // 🔔 操作提示横幅（自动化运行时提醒用户勿操作）
    // ===========================

    /**
     * 显示操作提示横幅（右下角浮动卡片，可折叠为右下角圆点）
     * - 不占据文档流，不挤压页面布局，对 SPA / 100vh 布局友好
     * - 橙黄色渐变背景 + 扫描线动画 + 呼吸脉冲指示灯
     * - 点击右侧折叠按钮可收起到右下角小圆点；点击圆点可重新展开
     * - 折叠状态用 sessionStorage 持久化，避免 SPA 跳转后又展开
     * @param {string} text - 横幅文案
     */
    window.showOperationBanner = function (text) {
        text = text || "正在自动发布中... 如遇问题可随时手动干预";
        var COLLAPSED_KEY = "__operation_banner_collapsed__";

        // 🛡️ 登录页不显示横幅：避免用户登录时看到"正在自动发布中"误导
        if (typeof window.isPageOnLoginUrl === 'function' && window.isPageOnLoginUrl()) {
            console.log("[横幅] ⏭️ 当前为登录页，跳过横幅显示");
            return;
        }

        // 防止重复创建（如果已存在则更新文案）
        if (document.getElementById("__operation_banner__")) {
            var textEl = document.querySelector("#__operation_banner__ .__ob_text__");
            if (textEl) textEl.textContent = text;
            return;
        }

        // 注入样式
        var style = document.createElement("style");
        style.id = "__operation_banner_style__";
        style.textContent = [
            "/* 呼吸脉冲动画（状态指示灯） */",
            "@keyframes __ob_breath__ {",
            "  0%, 100% { opacity: 1; box-shadow: 0 0 8px rgba(255, 160, 0, 0.6); }",
            "  50% { opacity: 0.5; box-shadow: 0 0 4px rgba(255, 160, 0, 0.25); }",
            "}",
            "/* 扫描线动画 */",
            "@keyframes __ob_scan__ {",
            "  0% { transform: translateX(-100%); }",
            "  100% { transform: translateX(400%); }",
            "}",
            "/* 入场滑入动画 */",
            "@keyframes __ob_slide__ {",
            "  0% { transform: translateY(24px); opacity: 0; }",
            "  100% { transform: translateY(0); opacity: 1; }",
            "}",
            "/* 折叠态淡入 */",
            "@keyframes __ob_fade__ {",
            "  0% { opacity: 0; transform: scale(0.6); }",
            "  100% { opacity: 1; transform: scale(1); }",
            "}",
            "/* 横幅主体（右下角浮动卡片，不占据文档流，避开顶部平台提示） */",
            "#__operation_banner__ {",
            "  position: fixed;",
            "  right: 18px;",
            "  bottom: 76px;",
            "  transform: translateY(0);",
            "  z-index: 2147483647;",
            "  max-width: calc(100vw - 36px);",
            "  padding: 7px 12px 7px 12px;",
            "  border-radius: 20px;",
            "  background: linear-gradient(135deg, #e8870e 0%, #f5a623 40%, #f7c948 100%);",
            "  border: 1px solid rgba(255, 255, 255, 0.4);",
            "  display: flex;",
            "  align-items: center;",
            "  gap: 8px;",
            "  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;",
            "  font-size: 12px;",
            "  font-weight: 600;",
            "  color: #fff;",
            "  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);",
            "  box-shadow: 0 6px 24px rgba(232, 135, 14, 0.35), 0 2px 6px rgba(0,0,0,0.12);",
            "  overflow: hidden;",
            "  animation: __ob_slide__ 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;",
            "  user-select: none;",
            "  -webkit-user-select: none;",
            "  pointer-events: auto;",
            "}",
            "/* 扫描线伪元素 */",
            "#__operation_banner__::before {",
            "  content: '';",
            "  position: absolute;",
            "  top: 0; left: 0;",
            "  width: 25%;",
            "  height: 100%;",
            "  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);",
            "  animation: __ob_scan__ 3s ease-in-out infinite;",
            "  pointer-events: none;",
            "}",
            "/* 状态指示灯 */",
            ".__ob_dot__ {",
            "  width: 8px; height: 8px;",
            "  border-radius: 50%;",
            "  background: #fff;",
            "  flex-shrink: 0;",
            "  animation: __ob_breath__ 2s ease-in-out infinite;",
            "  position: relative;",
            "  z-index: 1;",
            "}",
            "/* 文案 */",
            ".__ob_text__ {",
            "  letter-spacing: 0.5px;",
            "  white-space: nowrap;",
            "  overflow: hidden;",
            "  text-overflow: ellipsis;",
            "  position: relative;",
            "  z-index: 1;",
            "}",
            "/* 折叠按钮 */",
            ".__ob_collapse_btn__ {",
            "  width: 18px; height: 18px;",
            "  border-radius: 50%;",
            "  background: rgba(255, 255, 255, 0.22);",
            "  border: none;",
            "  color: #fff;",
            "  cursor: pointer;",
            "  display: flex;",
            "  align-items: center;",
            "  justify-content: center;",
            "  font-size: 14px;",
            "  line-height: 1;",
            "  padding: 0;",
            "  margin-left: 4px;",
            "  flex-shrink: 0;",
            "  transition: background 0.15s ease;",
            "  position: relative;",
            "  z-index: 1;",
            "}",
            ".__ob_collapse_btn__:hover {",
            "  background: rgba(255, 255, 255, 0.35);",
            "}",
            "/* 折叠态小圆点（右下角） */",
            "#__operation_banner_mini__ {",
            "  position: fixed;",
            "  right: 18px;",
            "  bottom: 76px;",
            "  z-index: 2147483647;",
            "  width: 22px; height: 22px;",
            "  border-radius: 50%;",
            "  background: linear-gradient(135deg, #e8870e, #f7c948);",
            "  box-shadow: 0 2px 8px rgba(232, 135, 14, 0.45);",
            "  cursor: pointer;",
            "  display: flex;",
            "  align-items: center;",
            "  justify-content: center;",
            "  animation: __ob_fade__ 0.25s ease forwards, __ob_breath__ 2s ease-in-out infinite;",
            "  user-select: none;",
            "  -webkit-user-select: none;",
            "}",
            "#__operation_banner_mini__::after {",
            "  content: '';",
            "  width: 6px; height: 6px;",
            "  border-radius: 50%;",
            "  background: #fff;",
            "}",
        ].join("\n");
        (document.head || document.documentElement).appendChild(style);

        // 检查折叠状态
        var startCollapsed = false;
        try {
            startCollapsed = sessionStorage.getItem(COLLAPSED_KEY) === '1';
        } catch (_) {}

        // 创建横幅主体
        var banner = document.createElement("div");
        banner.id = "__operation_banner__";

        var dot = document.createElement("span");
        dot.className = "__ob_dot__";

        var span = document.createElement("span");
        span.className = "__ob_text__";
        span.textContent = text;

        var collapseBtn = document.createElement("button");
        collapseBtn.className = "__ob_collapse_btn__";
        collapseBtn.type = "button";
        collapseBtn.title = "折叠";
        collapseBtn.textContent = "−";

        banner.appendChild(dot);
        banner.appendChild(span);
        banner.appendChild(collapseBtn);

        // 创建折叠态小圆点（默认隐藏）
        var miniDot = document.createElement("div");
        miniDot.id = "__operation_banner_mini__";
        miniDot.title = text;
        miniDot.style.display = "none";

        // 折叠 / 展开切换
        function setCollapsed(collapsed) {
            try {
                sessionStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
            } catch (_) {}
            if (collapsed) {
                banner.style.display = "none";
                miniDot.style.display = "flex";
            } else {
                banner.style.display = "flex";
                miniDot.style.display = "none";
            }
        }

        collapseBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            setCollapsed(true);
        });
        miniDot.addEventListener('click', function (e) {
            e.stopPropagation();
            setCollapsed(false);
        });

        // 插入到页面
        document.documentElement.appendChild(banner);
        document.documentElement.appendChild(miniDot);

        // 应用初始折叠状态
        if (startCollapsed) {
            setCollapsed(true);
        }

        // 🛡️ 启动 URL 监听器：如果页面 SPA 跳转到登录页，自动隐藏横幅
        // 解决：发布脚本在发布页注入显示横幅后，页面 SPA 跳到登录页（如搜狐 /mpfe/v4/login）横幅未消失
        if (!window.__operation_banner_watcher__) {
            window.__operation_banner_watcher__ = setInterval(function () {
                if (typeof window.isPageOnLoginUrl === 'function' && window.isPageOnLoginUrl()) {
                    if (typeof window.hideOperationBanner === 'function') {
                        window.hideOperationBanner();
                    }
                    clearInterval(window.__operation_banner_watcher__);
                    window.__operation_banner_watcher__ = null;
                    console.log("[横幅] 🛡️ 检测到页面跳转到登录页，已自动隐藏横幅");
                }
            }, 500);
        }

        console.log("[横幅] ✅ 操作提示浮动卡片已显示:", text);
    };

    /**
     * 移除操作提示横幅
     */
    window.hideOperationBanner = function () {
        var banner = document.getElementById("__operation_banner__");
        var miniDot = document.getElementById("__operation_banner_mini__");
        var spacer = document.getElementById("__operation_banner_spacer__");
        var style = document.getElementById("__operation_banner_style__");

        if (banner) banner.remove();
        if (miniDot) miniDot.remove();
        if (spacer) spacer.remove();
        if (style) style.remove();

        // 清理 URL 监听器定时器
        if (window.__operation_banner_watcher__) {
            clearInterval(window.__operation_banner_watcher__);
            window.__operation_banner_watcher__ = null;
        }

        console.log("[横幅] 🗑️ 操作提示横幅已移除");
    };

    console.log("[common.js] ✅ common.js 加载完成");
    console.log("[common.js] 已定义函数: waitForElement, waitForElements, retryOperation, sendMessageToParent, uploadFileToInput, downloadFile, uploadVideo, uploadImage, setNativeValue, scrollElementIntoViewIfNeeded, waitForShadowElement, deepShadowSearch, findElementInPageOrShadow, sendStatistics, clickWithRetry, closeWindowWithMessage, getRandomDelayMs, delay, randomDelay, createErrorListener, parseMessageData, checkWindowIdMatch, restoreSessionAndReload, loadPublishDataFromGlobalStorage, getCurrentWindowId, showOperationBanner, hideOperationBanner, checkBlankPageAndReload");
} // 结束 if-else 块，所有函数在 else 块内定义

/**
 * 高级版本：获取#后面的内容
 * @param {string} str 输入字符串
 * @param {Object} options 配置选项
 * @param {boolean} options.all 是否获取所有匹配（默认false）
 * @param {boolean} options.includeHash 是否包含#符号（默认false）
 * @param {RegExp} options.delimiter 分隔符正则（默认空白字符）
 * @returns {string|string[]|null} 结果
 */
window.extractAfterHash = function (str, options = {}) {
    const { all = false, includeHash = false, delimiter = /\s/ } = options;

    // 构建正则表达式
    const delimiterPattern = delimiter.source;
    const pattern = all ? `#([^${delimiterPattern}#]+)` : `#([^${delimiterPattern}#]+)`;

    const regex = new RegExp(pattern, all ? "g" : "");

    if (!all) {
        // 单次匹配
        const match = str.match(regex);
        if (!match) return null;
        return includeHash ? match[0] : match[1];
    } else {
        // 全局匹配
        const matches = [];
        let match;

        while ((match = regex.exec(str)) !== null) {
            matches.push(includeHash ? match[0] : match[1]);
        }

        return matches;
    }
};

window.removeHashTags = function (str) {
    // 先移除 # 及其内容
    let result = str.replace(/#[^\s#]+/g, "");

    // 清理因移除而产生的多余空格
    // 将多个连续空格替换为单个空格
    result = result.replace(/\s+/g, " ");

    // 去掉首尾空格
    result = result.trim();

    return result;
};

// 定义全局别名，确保向后兼容
if (typeof waitForElement === "undefined") window.waitForElement && (waitForElement = window.waitForElement);
if (typeof waitForElements === "undefined") window.waitForElements && (waitForElements = window.waitForElements);
if (typeof retryOperation === "undefined") window.retryOperation && (retryOperation = window.retryOperation);
if (typeof sendMessageToParent === "undefined") window.sendMessageToParent && (sendMessageToParent = window.sendMessageToParent);
if (typeof uploadFileToInput === "undefined") window.uploadFileToInput && (uploadFileToInput = window.uploadFileToInput);
if (typeof downloadFile === "undefined") window.downloadFile && (downloadFile = window.downloadFile);
if (typeof uploadVideo === "undefined") window.uploadVideo && (uploadVideo = window.uploadVideo);
if (typeof uploadImage === "undefined") window.uploadImage && (uploadImage = window.uploadImage);
if (typeof setNativeValue === "undefined") window.setNativeValue && (setNativeValue = window.setNativeValue);
if (typeof scrollElementIntoViewIfNeeded === "undefined") window.scrollElementIntoViewIfNeeded && (scrollElementIntoViewIfNeeded = window.scrollElementIntoViewIfNeeded);
if (typeof nativeClickElement === "undefined") window.nativeClickElement && (nativeClickElement = window.nativeClickElement);
if (typeof nativeInsertText === "undefined") window.nativeInsertText && (nativeInsertText = window.nativeInsertText);
if (typeof waitForShadowElement === "undefined") window.waitForShadowElement && (waitForShadowElement = window.waitForShadowElement);
if (typeof deepShadowSearch === "undefined") window.deepShadowSearch && (deepShadowSearch = window.deepShadowSearch);
if (typeof findElementInPageOrShadow === "undefined") window.findElementInPageOrShadow && (findElementInPageOrShadow = window.findElementInPageOrShadow);
if (typeof sendStatistics === "undefined") window.sendStatistics && (sendStatistics = window.sendStatistics);
if (typeof sendStatisticsError === "undefined") window.sendStatisticsError && (sendStatisticsError = window.sendStatisticsError);
if (typeof buildStatisticsPayload === "undefined") window.buildStatisticsPayload && (buildStatisticsPayload = window.buildStatisticsPayload);
if (typeof buildStatisticsRequestData === "undefined") window.buildStatisticsRequestData && (buildStatisticsRequestData = window.buildStatisticsRequestData);
if (typeof getApiDomain === "undefined") window.getApiDomain && (getApiDomain = window.getApiDomain);
if (typeof getStatisticsUrl === "undefined") window.getStatisticsUrl && (getStatisticsUrl = window.getStatisticsUrl);
if (typeof clickWithRetry === "undefined") window.clickWithRetry && (clickWithRetry = window.clickWithRetry);
if (typeof clickWithTrustedRetry === "undefined") window.clickWithTrustedRetry && (clickWithTrustedRetry = window.clickWithTrustedRetry);
if (typeof closeWindowWithMessage === "undefined") window.closeWindowWithMessage && (closeWindowWithMessage = window.closeWindowWithMessage);
if (typeof getRandomDelayMs === "undefined") window.getRandomDelayMs && (getRandomDelayMs = window.getRandomDelayMs);
if (typeof delay === "undefined") window.delay && (delay = window.delay);
if (typeof randomDelay === "undefined") window.randomDelay && (randomDelay = window.randomDelay);
if (typeof createErrorListener === "undefined") window.createErrorListener && (createErrorListener = window.createErrorListener);
if (typeof ERROR_LISTENER_CONFIGS === "undefined") window.ERROR_LISTENER_CONFIGS && (ERROR_LISTENER_CONFIGS = window.ERROR_LISTENER_CONFIGS);
if (typeof parseMessageData === "undefined") window.parseMessageData && (parseMessageData = window.parseMessageData);
if (typeof checkWindowIdMatch === "undefined") window.checkWindowIdMatch && (checkWindowIdMatch = window.checkWindowIdMatch);
if (typeof restoreSessionAndReload === "undefined") window.restoreSessionAndReload && (restoreSessionAndReload = window.restoreSessionAndReload);
if (typeof loadPublishDataFromGlobalStorage === "undefined") window.loadPublishDataFromGlobalStorage && (loadPublishDataFromGlobalStorage = window.loadPublishDataFromGlobalStorage);
if (typeof getCurrentWindowId === "undefined") window.getCurrentWindowId && (getCurrentWindowId = window.getCurrentWindowId);
if (typeof checkBlankPageAndReload === "undefined") window.checkBlankPageAndReload && (checkBlankPageAndReload = window.checkBlankPageAndReload);
if (typeof removeHashTags === "undefined") window.removeHashTags && (removeHashTags = window.removeHashTags);
if (typeof getCurrentSystem === "undefined") window.getCurrentSystem && (getCurrentSystem = window.getCurrentSystem);
if (typeof showOperationBanner === "undefined") window.showOperationBanner && (showOperationBanner = window.showOperationBanner);
if (typeof hideOperationBanner === "undefined") window.hideOperationBanner && (hideOperationBanner = window.hideOperationBanner);

// ===========================
// 前端拦截自定义协议（如 bitbrowser://）
// ===========================
(function () {
    // 阻止的协议列表
    const blockedProtocols = ["bitbrowser:", "mqqwpa:", "weixin:", "alipays:", "tbopen:"];

    // 检查 URL 是否是被阻止的协议
    function isBlockedProtocol(url) {
        if (!url || typeof url !== "string") return false;
        const lowerUrl = url.toLowerCase();
        return blockedProtocols.some(protocol => lowerUrl.startsWith(protocol));
    }

    // 拦截链接点击
    document.addEventListener(
        "click",
        function (e) {
            const target = e.target.closest("a");
            if (target && target.href && isBlockedProtocol(target.href)) {
                console.log("[ProtocolBlock] ❌ 阻止链接点击:", target.href);
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
        },
        true,
    );

    // 拦截 window.open
    const originalWindowOpen = window.open;
    window.open = function (url, ...args) {
        if (isBlockedProtocol(url)) {
            console.log("[ProtocolBlock] ❌ 阻止 window.open:", url);
            return null;
        }
        return originalWindowOpen.call(window, url, ...args);
    };

    // 拦截 location.assign
    const originalAssign = window.location.assign;
    if (originalAssign) {
        window.location.assign = function (url) {
            if (isBlockedProtocol(url)) {
                console.log("[ProtocolBlock] ❌ 阻止 location.assign:", url);
                return;
            }
            return originalAssign.call(window.location, url);
        };
    }

    // 拦截 location.replace
    const originalReplace = window.location.replace;
    if (originalReplace) {
        window.location.replace = function (url) {
            if (isBlockedProtocol(url)) {
                console.log("[ProtocolBlock] ❌ 阻止 location.replace:", url);
                return;
            }
            return originalReplace.call(window.location, url);
        };
    }

    // 拦截 location.href 设置（通过 defineProperty）
    try {
        const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
        if (locationDescriptor && locationDescriptor.set) {
            // 无法直接覆盖 location，尝试通过 MutationObserver 监控 iframe
        }
    } catch (e) {
        // 忽略错误
    }

    console.log("[ProtocolBlock] ✅ 前端协议拦截已启用");
})();

// ===========================
// 🔑 带超时检测和用户提示的统计上报函数
// ===========================
window.reportStatisticsWithTimeout = async function(url, scanData, options = {}) {
    const {
        timeout = 8000,  // 默认 8 秒超时
        retries = 3,     // 重试次数
        retryDelay = 1000 // 重试间隔（毫秒）
    } = options;

    let lastError = null;
    let isTimeout = false;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`[reportStatistics] 📤 第 ${attempt}/${retries} 次尝试，URL: ${url}`);

            // 使用 Promise.race 实现超时控制
            const response = await Promise.race([
                fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(scanData)
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('TIMEOUT')), timeout)
                )
            ]);

            // 请求成功（即使返回 HTTP 错误码也算请求成功）
            console.log(`[reportStatistics] ✅ 第 ${attempt} 次尝试成功，状态码: ${response.status}`);
            return {
                success: true,
                status: response.status,
                attempt: attempt
            };
        } catch (e) {
            lastError = e;
            isTimeout = e.message === 'TIMEOUT';

            if (isTimeout) {
                console.warn(`[reportStatistics] ⏱️ 第 ${attempt} 次尝试超时 (${timeout}ms)`);
            } else {
                console.warn(`[reportStatistics] ❌ 第 ${attempt} 次尝试失败:`, e.message);
            }

            // 最后一次尝试失败，不再重试
            if (attempt === retries) {
                break;
            }

            // 等待后重试
            console.log(`[reportStatistics] ⏳ 等待 ${retryDelay}ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }

    // 所有重试都失败了
    console.error(`[reportStatistics] ❌ 所有 ${retries} 次尝试都失败，最后错误:`, lastError?.message);

    // 在页面上显示提示（如果超时）
    if (isTimeout) {
        window.showReportTimeoutNotice();
    }

    return {
        success: false,
        error: lastError?.message,
        isTimeout: isTimeout,
        attempts: retries
    };
};

// 显示上报超时提示
window.showReportTimeoutNotice = function() {
    try {
        // 创建提示 DOM（简单版本，直接显示在页面上）
        const notice = document.createElement('div');
        notice.id = 'report-timeout-notice';
        notice.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #fff3cd;
            border: 1px solid #ffc107;
            border-radius: 4px;
            padding: 12px 16px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            font-size: 14px;
            color: #856404;
            z-index: 99999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        `;
        notice.innerHTML = '⏱️ 统计上报超时，请稍候...';
        document.body.appendChild(notice);

        // 3 秒后自动移除
        setTimeout(() => {
            if (notice.parentNode) {
                notice.parentNode.removeChild(notice);
            }
        }, 3000);

        console.log('[reportStatistics] 💬 已显示超时提示');
    } catch (e) {
        console.error('[reportStatistics] ❌ 显示超时提示失败:', e);
    }
};

// 🔒 已按「统计上报只发一次」移除离线补报队列的启动补发与周期性补发触发点。
// enqueueFailedStatReport / flushFailedStatReports 函数体保留但不再被自动调用，
// 上报失败即失败，不重试、不补发。
