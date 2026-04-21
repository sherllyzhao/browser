// ===========================
// common.js - 公共工具库
// ===========================
// 防止重复加载（检查关键函数是否已存在）

if (typeof window.uploadVideo === "function" && typeof window.uploadImage === "function" && typeof window.waitForElement === "function" && typeof window.setNativeValue === "function") {
    console.log("[common.js] ⚠️ common.js 已加载，跳过重复定义");
    console.log("[common.js] 当前窗口:", window.location.href);
} else {
    console.log("[common.js] ✅ common.js 开始加载...");
    console.log("[common.js] 当前窗口:", window.location.href);

    // 标记为已加载
    window.__COMMON_JS_LOADED__ = true;

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
     * 白屏检测和自动恢复（针对扫码登录后跳转的情况）
     * @param {string} platform - 平台名称（如 '视频号'、'小红书'）
     * @param {Array<string>} keySelectors - 关键元素选择器数组（用于判断页面是否正常加载）
     * @param {number} checkDelay - 检测延迟时间（毫秒），默认 3000ms
     * @param {number} maxRetries - 最大重试次数，默认 3 次
     */
    window.checkBlankPageAndReload = function (platform = '发布', keySelectors = [], checkDelay = 3000, maxRetries = 3) {
        const __startTs__ = Date.now();
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
            console.log(`[${platform}][白屏检测] ⏰ 定时检测触发 @${new Date().toLocaleTimeString()}, 距启动 ${__checkTs__ - __startTs__}ms`);
            try {
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

                        // 🔑 如果是 wujie-app，检查 shadowRoot 是否真正有内容
                        // 原问题：wujie-app 元素存在 + shadowRoot 存在就认为正常，但微前端子应用加载中/失败时
                        // shadowRoot 存在但内部为空（或仅有 loading 骨架），导致"白屏但检测不触发 reload"
                        // 修复：同时要求 shadowRoot.innerHTML 长度 > 300 或内部有可见元素
                        if (selector === 'wujie-app') {
                            const wujieApp = document.querySelector('wujie-app');
                            if (wujieApp && wujieApp.shadowRoot) {
                                const shadowHtml = wujieApp.shadowRoot.innerHTML || '';
                                // 内部是否有实际渲染的子节点（body/div/form 等常见容器）
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
                                continue;
                            }
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

                    // 增加重试计数
                    localStorage.setItem(retryKey, String(retryCount + 1));
                    console.log(`[${platform}][白屏检测] 🔢 重试计数更新: ${retryCount} → ${retryCount + 1}`);

                    // 隐藏页面并显示 loading
                    if (typeof window.hidePageAndShowMask === 'function') {
                        window.hidePageAndShowMask();
                    }

                    // 延迟 1 秒后刷新
                    setTimeout(() => {
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
                await new Promise(resolve => setTimeout(resolve, waitTime));
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

        // 优先使用主进程下载（绕过跨域限制）
        if (downloadByMainProcess) {
            console.log("[downloadFile] 使用主进程下载...");
            const result = await downloadByMainProcess(url);

            if (!result.success) {
                throw new Error("Download failed: " + result.error);
            }

            const normalized = normalizeDownloadedResult(result, defaultType, "downloadFile");
            blob = normalized.blob;
            contentType = normalized.contentType;
            console.log("[downloadFile] 主进程下载成功，大小:", result.size, "bytes, 类型:", contentType);
        } else {
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
            blob = normalized.blob;
            contentType = normalized.contentType;
        }

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
        await new Promise(resolve => setTimeout(resolve, 3000));
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
        await new Promise(resolve => setTimeout(resolve, 3000));
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
    // 返回格式：https://apidev.china9.cn 或 https://api.china9.cn
    window.getApiDomain = async function () {
        // 开发环境域名列表
        const devHosts = [
            "localhost:5173",
            "localhost:8080",
            "127.0.0.1:5173",
            "127.0.0.1:8080",
            "dev.china9.cn",
            "www.dev.china9.cn",
            "apidev.china9.cn",
            "172.16.6.17:8080",
            "jzt_dev_1.china9.cn",
        ];

        // 默认使用开发环境
        let apiDomain = "https://apidev.china9.cn";

        try {
            if (window.browserAPI && window.browserAPI.getMainUrl) {
                const mainInfo = await window.browserAPI.getMainUrl();
                if (mainInfo.success && mainInfo.host) {
                    const host = mainInfo.host.toLowerCase();

                    // 检查是否是开发环境（精确匹配，避免 china9.cn 被 dev.china9.cn 误匹配）
                    const isDev = devHosts.some(devHost => host === devHost || host.endsWith('.' + devHost) || devHost === host);

                    if (isDev) {
                        apiDomain = "https://apidev.china9.cn";
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

    // 发送统计接口（发布成功时调用）
    window.sendStatistics = async function (publishId, platform = "") {
        const scanData = { data: JSON.stringify({ id: publishId }) };
        try {
            console.log(`[${platform || "发布"}] 📤 发送成功统计接口，ID: ${publishId}`);
            const url = await getStatisticsUrl(false);
            console.log(`[${platform || "发布"}] 统计接口地址: ${url}`);
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(scanData),
            });
            console.log(`[${platform || "发布"}] ✅ 成功统计接口请求成功`);
            return { success: true, response };
        } catch (e) {
            console.error(`[${platform || "发布"}] ❌ 成功统计接口请求失败:`, e);
            return { success: false, error: e };
        }
    };

    // 发送错误统计接口（发布失败时调用）
    // 🔑 增强版：附带详细的错误上下文日志
    window.sendStatisticsError = async function (publishId, statusText, platform = "", errorObj = null) {
        // 使用 PublishLogger 记录错误
        if (window.PublishLogger && errorObj) {
            window.PublishLogger.error(platform || "发布", "sendStatisticsError", errorObj, { publishId, statusText });
        }

        // 构建错误数据（包含更多上下文信息）
        const errorData = {
            id: publishId,
            status_text: statusText,
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
                errorData.context.recentActions = recentLogs.map(log => ({
                    time: log.timestamp,
                    action: log.action,
                    message: log.message,
                }));
            }
        }

        const scanData = { data: JSON.stringify(errorData) };
        try {
            console.log(`[${platform || "发布"}] 📤 发送失败统计接口，ID: ${publishId}, 错误: ${statusText}`);
            const url = await getStatisticsUrl(true);
            console.log(`[${platform || "发布"}] 统计接口地址: ${url}`);
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(scanData),
            });
            console.log(`[${platform || "发布"}] ✅ 失败统计接口请求成功`);
            return { success: true, response };
        } catch (e) {
            console.error(`[${platform || "发布"}] ❌ 失败统计接口请求失败:`, e);
            return { success: false, error: e };
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
        if (!message.windowId) {
            return true; // 没有 windowId 限制，认为匹配
        }

        try {
            const myWindowId = await window.browserAPI.getWindowId();
            console.log(`${logPrefix} 我的窗口 ID:`, myWindowId, "消息目标窗口 ID:", message.windowId);

            if (myWindowId !== message.windowId) {
                console.log(`${logPrefix} ⏭️ 消息不是发给我的，跳过`);
                return false;
            }

            console.log(`${logPrefix} ✅ windowId 匹配，处理消息`);
            return true;
        } catch (e) {
            console.error(`${logPrefix} ❌ 检查 windowId 失败:`, e);
            return true; // 出错时默认处理
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
                    await new Promise(resolve => setTimeout(resolve, delay));
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
                    await new Promise(resolve => setTimeout(resolve, 3000));

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
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        console.error("[clickWithRetry] ❌ 所有点击尝试均失败");
        return { success: false, message: "所有点击尝试均失败" };
    };

    // 发送成功消息并关闭窗口
    // 🔑 增加默认延迟到 2500ms，确保消息有足够时间到达 Vue 应用
    // 🔑 关闭窗口前自动清除 publish_data_window 数据
    window.closeWindowWithMessage = async function (message = "发布成功，刷新数据", delay = 10000) {
        console.log(`[closeWindow] 发送消息: ${message}`);
        window.sendMessageToParent(message);

        // 🔑 额外等待 500ms 确保 IPC 消息已发送到主进程
        await new Promise(resolve => setTimeout(resolve, 500));

        // 🔑 在关闭窗口前清除发布数据（防止数据残留）
        try {
            const windowId = await window.browserAPI.getWindowId();
            if (windowId) {
                await window.browserAPI.removeGlobalData(`publish_data_window_${windowId}`);
                console.log(`[closeWindow] 🗑️ 已清除 publish_data_window_${windowId}`);
            }
        } catch (e) {
            console.log(`[closeWindow] ⚠️ 清除发布数据失败:`, e.message);
        }

        if (delay > 0) {
            console.log(`[closeWindow] 等待 ${delay}ms 确保消息到达...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        // 开发环境下跳过关闭窗口，方便测试
        if (!window.browserAPI.isProduction) {
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

    // 延迟执行（Promise 包装的 setTimeout）
    window.delay = function (ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    };

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
            selectors: [{ containerClass: "el-message--error", textSelector: ".el-message__content", recursiveSelector: ".el-message.el-message--error" }],
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
     * 显示操作提示横幅（固定在页面顶部，推开页面内容）
     * - 橙黄色渐变背景 + 扫描线动画 + 呼吸脉冲指示灯
     * - 用于发布/授权等自动化流程中提示用户不要手动操作
     * @param {string} text - 横幅文案
     */
    window.showOperationBanner = function (text) {
        text = text || "自动操作进行中，请勿操作此页面...";

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
            "  0%, 100% { opacity: 1; box-shadow: 0 0 8px rgba(255, 160, 0, 0.5); }",
            "  50% { opacity: 0.45; box-shadow: 0 0 3px rgba(255, 160, 0, 0.2); }",
            "}",
            "/* 扫描线动画 */",
            "@keyframes __ob_scan__ {",
            "  0% { transform: translateX(-100%); }",
            "  100% { transform: translateX(400%); }",
            "}",
            "/* 入场滑入动画 */",
            "@keyframes __ob_slide__ {",
            "  0% { transform: translateY(-100%); opacity: 0; }",
            "  100% { transform: translateY(0); opacity: 1; }",
            "}",
            "/* 横幅主体 */",
            "#__operation_banner__ {",
            "  position: fixed;",
            "  top: 0; left: 0; right: 0;",
            "  z-index: 2147483647;",
            "  height: 40px;",
            "  background: linear-gradient(135deg, #e8870e 0%, #f5a623 40%, #f7c948 100%);",
            "  border-bottom: 1px solid rgba(0, 0, 0, 0.08);",
            "  display: flex;",
            "  align-items: center;",
            "  justify-content: center;",
            "  gap: 10px;",
            "  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;",
            "  font-size: 14px;",
            "  font-weight: 600;",
            "  color: #fff;",
            "  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);",
            "  box-shadow: 0 2px 12px rgba(232, 135, 14, 0.3);",
            "  overflow: hidden;",
            "  animation: __ob_slide__ 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;",
            "  user-select: none;",
            "  -webkit-user-select: none;",
            "}",
            "/* 扫描线伪元素 */",
            "#__operation_banner__::before {",
            "  content: '';",
            "  position: absolute;",
            "  top: 0; left: 0;",
            "  width: 25%;",
            "  height: 100%;",
            "  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);",
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
            "}",
            "/* 文案 */",
            ".__ob_text__ {",
            "  letter-spacing: 0.5px;",
            "  white-space: nowrap;",
            "}",
            "/* 占位元素（推开页面内容） */",
            "#__operation_banner_spacer__ {",
            "  height: 40px;",
            "  width: 100%;",
            "  flex-shrink: 0;",
            "}",
        ].join("\n");
        (document.head || document.documentElement).appendChild(style);

        // 创建横幅
        var banner = document.createElement("div");
        banner.id = "__operation_banner__";

        var dot = document.createElement("span");
        dot.className = "__ob_dot__";

        var span = document.createElement("span");
        span.className = "__ob_text__";
        span.textContent = text;

        banner.appendChild(dot);
        banner.appendChild(span);

        // 创建占位元素（推开页面内容，防止横幅遮挡顶部区域）
        var spacer = document.createElement("div");
        spacer.id = "__operation_banner_spacer__";

        // 插入到页面
        document.documentElement.appendChild(banner);
        if (document.body) {
            document.body.insertBefore(spacer, document.body.firstChild);
        }

        console.log("[横幅] ✅ 操作提示横幅已显示:", text);
    };

    /**
     * 移除操作提示横幅
     */
    window.hideOperationBanner = function () {
        var banner = document.getElementById("__operation_banner__");
        var spacer = document.getElementById("__operation_banner_spacer__");
        var style = document.getElementById("__operation_banner_style__");

        if (banner) banner.remove();
        if (spacer) spacer.remove();
        if (style) style.remove();

        console.log("[横幅] 🗑️ 操作提示横幅已移除");
    };

    console.log("[common.js] ✅ common.js 加载完成");
    console.log("[common.js] 已定义函数: waitForElement, waitForElements, retryOperation, sendMessageToParent, uploadFileToInput, downloadFile, uploadVideo, uploadImage, setNativeValue, waitForShadowElement, deepShadowSearch, sendStatistics, clickWithRetry, closeWindowWithMessage, delay, createErrorListener, parseMessageData, checkWindowIdMatch, restoreSessionAndReload, loadPublishDataFromGlobalStorage, getCurrentWindowId, showOperationBanner, hideOperationBanner, checkBlankPageAndReload");
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
if (typeof waitForShadowElement === "undefined") window.waitForShadowElement && (waitForShadowElement = window.waitForShadowElement);
if (typeof deepShadowSearch === "undefined") window.deepShadowSearch && (deepShadowSearch = window.deepShadowSearch);
if (typeof sendStatistics === "undefined") window.sendStatistics && (sendStatistics = window.sendStatistics);
if (typeof sendStatisticsError === "undefined") window.sendStatisticsError && (sendStatisticsError = window.sendStatisticsError);
if (typeof getApiDomain === "undefined") window.getApiDomain && (getApiDomain = window.getApiDomain);
if (typeof getStatisticsUrl === "undefined") window.getStatisticsUrl && (getStatisticsUrl = window.getStatisticsUrl);
if (typeof clickWithRetry === "undefined") window.clickWithRetry && (clickWithRetry = window.clickWithRetry);
if (typeof closeWindowWithMessage === "undefined") window.closeWindowWithMessage && (closeWindowWithMessage = window.closeWindowWithMessage);
if (typeof delay === "undefined") window.delay && (delay = window.delay);
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
