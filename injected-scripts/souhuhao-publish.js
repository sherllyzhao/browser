/**
 * 搜狐号创作者平台发布脚本
 * 用于处理发布流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
    'use strict';

    // ===========================
    // 🔑 检查 common.js 依赖并提供降级实现
    // ===========================
    if (typeof window.getRandomDelayMs !== "function") {
        console.warn("[搜狐号发布] ⚠️ common.js 未正确加载，使用降级实现");
        window.getRandomDelayMs = function (ms, jitterMs) {
            const baseMs = Number.isFinite(Number(ms)) ? Math.max(0, Math.floor(Number(ms))) : 0;
            const hasCustomJitter = jitterMs !== null && typeof jitterMs !== "undefined" && Number.isFinite(Number(jitterMs));
            const resolvedJitterMs = hasCustomJitter
                ? Math.max(0, Math.floor(Number(jitterMs)))
                : Math.max(80, Math.round(baseMs * 0.35));
            return baseMs + Math.floor(Math.random() * (resolvedJitterMs + 1));
        };
    }

    // 🔑 平台配置（从 common.js 引用，避免重复定义）
    const PLATFORM_CONFIG = window.PLATFORM_CONFIGS?.souhuhao || {
        name: '搜狐号',
        publishPagePath: '/contentManagement/news/addarticle',
        publishPageUrl: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle',
        firstPageUrl: 'https://mp.sohu.com/mpfe/v4/contentManagement/first/page',
        domain: 'mp.sohu.com',
        cookiesDomain: 'mp.sohu.com'
    };

    // ===========================
    // 防止脚本重复注入
    // ===========================
    if (window.__SH_SCRIPT_LOADED__) {
        console.log('[搜狐号发布] ⚠️ 脚本已经加载过，跳过重复注入');
        return;
    }

    // ===========================
    // 页面状态检查 - 防止异常渲染
    // ===========================
    if (typeof window.checkPageStateAndReload === 'function') {
        if (!window.checkPageStateAndReload('搜狐号发布')) {
            return;
        }
    }

    window.__SH_SCRIPT_LOADED__ = true;

    // ===========================
    // 🔑 搜狐号白屏检测和自动恢复（使用公共函数）
    // ===========================
    if (typeof window.checkBlankPageAndReload === 'function') {
        window.checkBlankPageAndReload('搜狐号发布', [
            '.ne-editor',
            '.publish-btn',
            '.title-input'
        ], 3000, 3);
    }

    // ===========================
    // 🩹 渲染健康守卫：接住白屏检测漏掉的「乱码渲染」
    // 场景：dbd0760 把搜狐窗口切到账号 session 后，首次冷加载偶发 CSS/SPA 抢跑，
    // 搜狐把自己的 Vue scoped 样式（.xxx[data-v-abcdef]{...}）当纯文本渲染到页面，
    // 编辑器等关键区域缺失 → 用户看到整页乱码、无填写区。
    // checkBlankPageAndReload 用「bodyText 很少」判白屏，此时 bodyText 巨大（塞满 CSS 文本），
    // 被判为「非白屏」→ 漏接。这里改用「乱码特征 + 编辑器缺失」判定，双确认后 reload 一次。
    // 冷加载竞态多为一次性，重载后第二次渲染即正常（session cache:false，无缓存可清，纯时序问题）。
    // 用 sessionStorage 计数上限防止真损坏时无限刷新。
    // ===========================
    (function watchSohuRenderHealth() {
        const RELOAD_COUNT_KEY = '__sohu_publish_render_unhealthy_reload_count__';
        const MAX_RELOAD = 2;

        const isEditorPresent = () => !!(
            document.querySelector('#editor')
            || document.querySelector('.ql-editor')
            || document.querySelector('.ne-editor')
            || document.querySelector('.title-input')
        );

        // 乱码特征：搜狐 Vue scoped 选择器（.xxx[data-v-十六进制]）作为可见文本出现在页面，
        // 或大量 CSS 规则块被当文本渲染。正常「加载中/白屏」页不会有这种文本，可精准区分「慢」与「坏」。
        const hasGarbledCssText = () => {
            try {
                const bodyText = (document.body && document.body.innerText) || '';
                if (bodyText.length < 200) {
                    return false; // 文本太少 → 是白屏或加载中，交给 checkBlankPageAndReload，别在这误判
                }
                if (/\[data-v-[0-9a-f]{6,}\]/.test(bodyText)) {
                    return true; // 命中搜狐 scoped 选择器文本，几乎可确诊乱码
                }
                // 兜底：大量 CSS 声明块被当文本（含多组 {...} 且带典型 CSS 属性名）
                const braceBlocks = (bodyText.match(/\{[^{}]*\}/g) || []).length;
                return braceBlocks >= 8
                    && /(position|display|background|font-size|margin|padding)\s*:/.test(bodyText);
            } catch (_) {
                return false;
            }
        };

        const doReloadIfUnhealthy = (phase) => {
            // 健康（编辑器已出现）→ 清计数并停止
            if (isEditorPresent()) {
                try { sessionStorage.removeItem(RELOAD_COUNT_KEY); } catch (_) {}
                console.log(`[搜狐号发布] ✅ 渲染健康守卫：编辑器已就绪（${phase}），页面正常`);
                return true; // 表示已确认健康，无需再查
            }
            // 编辑器缺失但无乱码特征 → 可能只是加载慢，交给白屏检测/20s 等待，别抢着刷新
            if (!hasGarbledCssText()) {
                console.log(`[搜狐号发布] ⏳ 渲染健康守卫：编辑器暂未就绪且无乱码特征（${phase}），继续等待`);
                return false;
            }
            // 编辑器缺失 + 命中乱码特征 → 确诊乱码渲染
            let reloadCount = 0;
            try { reloadCount = parseInt(sessionStorage.getItem(RELOAD_COUNT_KEY) || '0', 10) || 0; } catch (_) {}
            if (reloadCount >= MAX_RELOAD) {
                console.warn(`[搜狐号发布] 🛑 渲染健康守卫：已重载 ${reloadCount} 次仍乱码，停止自动刷新，避免死循环`);
                return true;
            }
            try { sessionStorage.setItem(RELOAD_COUNT_KEY, String(reloadCount + 1)); } catch (_) {}
            console.warn(`[搜狐号发布] 🔁 渲染健康守卫：检测到整页乱码渲染（编辑器缺失+CSS文本），刷新页面重试（第 ${reloadCount + 1}/${MAX_RELOAD} 次）`);
            if (typeof window.hidePageAndShowMask === 'function') {
                window.hidePageAndShowMask();
            }
            window.location.reload();
            return true;
        };

        // 首查给 SPA 4s 渲染窗口；命中乱码再等 2s 复查双确认，避免 hydration 瞬态误刷
        setTimeout(() => {
            if (doReloadIfUnhealthy('first-check')) {
                return;
            }
            setTimeout(() => {
                doReloadIfUnhealthy('recheck');
            }, 2000);
        }, 4000);
    })();

    // 显示操作提示横幅
    if (typeof showOperationBanner === 'function') {
        showOperationBanner('正在自动发布中，请勿操作此页面...');
    }

    // 变量声明（放在防重复检查之后）
    let introFilled = false; // 标记 intro 是否已填写
    let fillFormRunning = false; // 标记 fillFormData 是否正在执行

    // 防重复标志：确保数据只处理一次
    let isProcessing = false;
    let hasProcessed = false;

    // 保存收到的父窗口消息（用于备用方案）
    let receivedMessageData = null;

    // 当前窗口 ID（用于构建窗口专属的 localStorage key，避免多窗口冲突）
    let currentWindowId = null;

    // ===========================
    // 🔴 使用公共错误监听器（来自 common.js）
    // ===========================
    let errorListener = null;

    // 初始化错误监听器
    const initErrorListener = () => {
        if (typeof createErrorListener === 'function' && ERROR_LISTENER_CONFIGS?.sohu) {
            errorListener = createErrorListener(ERROR_LISTENER_CONFIGS.sohu);
            console.log('[搜狐号发布] ✅ 使用公共错误监听器配置');
        } else {
            // 回退方案：使用本地配置
            errorListener = createErrorListener({
                logPrefix: '[搜狐号发布]',
                selectors: [
                    { containerClass: 'ne-snackbar-item-description', textSelector: 'span:last-child' },
                    { containerClass: 'el-message--error', textSelector: '.el-message__content', recursiveSelector: '.el-message.el-message--error' }
                ]
            });
            console.log('[搜狐号发布] ⚠️ 使用本地错误监听器配置');
        }
    };

    // 兼容旧代码的函数别名
    const startErrorListener = () => {
        if (!errorListener) initErrorListener();
        errorListener.start();
    };
    const stopErrorListener = () => errorListener?.stop();
    const getLatestError = () => errorListener?.getLatestError() || null;

    // 🔑 注意：getPublishSuccessKey() 使用 IIFE 外部定义的全局函数
    // 返回固定的 'sohu_publish_success_data'，与 souhuhao-redirect.js 保持一致

    console.log('═══════════════════════════════════════');
    console.log('✅ 搜狐号发布脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    // 检查 common.js 是否已加载
    if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
        console.error('[搜狐号发布] ❌ common.js 未加载！脚本可能无法正常工作');
    } else {
        console.log('[搜狐号发布] ✅ common.js 已加载，工具函数可用');
    }

    // ===========================
    // 🔴 重要：先注册消息监听器，再执行任何 await 操作！
    // 否则消息可能在 await 期间到达，但回调还没注册
    // ===========================
    console.log('[搜狐号发布] 注册消息监听器...');

    if (!window.browserAPI) {
        console.error('[搜狐号发布] ❌ browserAPI 不可用！');
    } else {
        console.log('[搜狐号发布] ✅ browserAPI 可用');

        if (!window.browserAPI.onMessageFromHome) {
            console.error('[搜狐号发布] ❌ browserAPI.onMessageFromHome 不可用！');
        } else {
            console.log('[搜狐号发布] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

            window.browserAPI.onMessageFromHome(async (message) => {
                console.log('═══════════════════════════════════════');
                console.log('[搜狐号发布] 🎉 收到来自父窗口的消息!');
                console.log('[搜狐号发布] 消息类型:', typeof message);
                console.log('[搜狐号发布] 消息内容:', message);
                console.log('[搜狐号发布] 消息.type:', message?.type);
                console.log('[搜狐号发布] 消息.windowId:', message?.windowId);
                console.log('═══════════════════════════════════════');

                // 接收完整的发布数据（直接传递，不使用 IndexedDB）
                // 兼容 publish-data 和 auth-data 两种消息类型
                if (message.type === 'publish-data') {
                    // 使用公共方法解析消息数据
                    const messageData = parseMessageData(message.data, '[搜狐号发布]');
                    if (!messageData) return;

                    // 使用公共方法检查 windowId 是否匹配
                    const isMatch = await checkWindowIdMatch(message, '[搜狐号发布]');
                    if (!isMatch) return;

                    // 使用公共方法恢复会话数据
                    const needReload = await restoreSessionAndReload(messageData, '[搜狐号发布]');
                    if (needReload) return; // 已触发刷新，脚本会重新注入

                    // windowId 匹配后才保存消息数据
                    receivedMessageData = messageData;
                    console.log('[搜狐号发布] 💾 已保存收到的消息数据到 receivedMessageData');

                    console.log('[搜狐号发布] ✅ 收到发布数据:', messageData);

                    // 防重复检查
                    if (isProcessing) {
                        console.warn('[搜狐号发布] ⚠️ 正在处理中，忽略重复消息');
                        return;
                    }
                    if (hasProcessed) {
                        console.warn('[搜狐号发布] ⚠️ 已经处理过，忽略重复消息');
                        return;
                    }

                    // 标记为正在处理
                    isProcessing = true;

                    // 更新全局变量
                    if (messageData) {
                        window.__AUTH_DATA__ = {
                            ...window.__AUTH_DATA__,
                            message: messageData,
                            receivedAt: Date.now()
                        };
                        console.log('[搜狐号发布] ✅ 发布数据已更新:', window.__AUTH_DATA__);
                        console.log("🚀 ~  ~ messageData: ", messageData);

                        try {
                            const fillResult = await retryOperation(async () => await fillFormData(messageData), 3, 2000);
                            if (fillResult === false) {
                                console.warn('[搜狐号发布] 🚫 表单流程已中止，不再进入 publishApi 等待');
                                isProcessing = false;
                                return;
                            }
                        } catch (e) {
                            console.log('[搜狐号发布] ❌ 填写表单数据失败:', e);
                        }

                        console.log('[搜狐号发布] 📤 准备发送数据到接口...');
                        console.log('[搜狐号发布] ✅ 发布流程已启动，等待 publishApi 完成...');
                    }

                    // 重置处理标志（无论成功或失败）
                    isProcessing = false;
                    console.log('[搜狐号发布] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
                }
            });

            console.log('[搜狐号发布] ✅ 消息监听器注册成功');
        }
    }

    // ===========================
    // 1. 从 URL 获取发布数据（在消息监听器注册之后）
    // ===========================

    const urlParams = new URLSearchParams(window.location.search);
    const companyId = await window.browserAPI.getGlobalData('company_id');
    const transferId = urlParams.get('transfer_id');

    // 获取当前窗口 ID（用于窗口专属的 localStorage key）
    try {
        currentWindowId = await window.browserAPI.getWindowId();
        console.log('[搜狐号发布] 当前窗口 ID:', currentWindowId);
    } catch (e) {
        console.error('[搜狐号发布] ❌ 获取窗口 ID 失败:', e);
    }

    console.log('[搜狐号发布] URL 参数:', {
        companyId,
        transferId,
        windowId: currentWindowId
    });

    // 存储发布数据到全局
    window.__AUTH_DATA__ = {
        companyId,
        transferId,
        timestamp: Date.now()
    };

    // ===========================
    // 2. 暴露全局方法供手动调用
    // ===========================

    window.__SH_AUTH__ = {
        // 发送发布成功消息
        notifySuccess: () => {
            sendMessageToParent('发布成功');
        },
    };

    // ===========================
    // 3. 显示调试信息横幅
    // ===========================

    // ===========================
    // 4. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
    // ===========================

    // 页面加载完成后向父窗口发送消息
    console.log('[搜狐号发布] 页面加载完成，发送 页面加载完成 消息');
    sendMessageToParent('页面加载完成');

    console.log('═══════════════════════════════════════');
    console.log('✅ 搜狐号发布脚本初始化完成');
    console.log('📝 全局方法: window.__SH_AUTH__');
    console.log('  - notifySuccess()  : 发送发布成功消息');
    console.log('  - sendMessage(msg) : 发送自定义消息');
    console.log('  - getAuthData()    : 获取发布数据');
    console.log('═══════════════════════════════════════');

    // ===========================
    // 7. 检查是否是恢复 cookies 后的刷新（立即执行）
    // ===========================
    await (async () => {
        // 如果已经在处理或已处理完成，跳过
        if (isProcessing || hasProcessed) {
            console.log('[搜狐号发布] ⏭️ 已在处理中或已完成，跳过全局存储读取');
            return;
        }

        try {
            // 获取当前窗口 ID
            const windowId = await window.browserAPI.getWindowId();
            console.log('[搜狐号发布] 检查全局存储，窗口 ID:', windowId);

            if (!windowId) {
                console.log('[搜狐号发布] ❌ 无法获取窗口 ID');
                return;
            }

            // 检查是否有恢复 cookies 后保存的发布数据
            const publishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
            console.log('[搜狐号发布] 📦 从全局存储读取 publish_data_window_' + windowId + ':', publishData ? '有数据' : '无数据');

            if (publishData && !isProcessing && !hasProcessed) {
                console.log('[搜狐号发布] ✅ 检测到恢复 cookies 后的数据，开始处理...');

                // 🔑 不再立即删除数据，改为在发布完成后删除
                // 这样如果登录跳转后跳回来，数据仍然可用
                // 使用 hasProcessed 标记防止重复处理
                console.log('[搜狐号发布] 📝 保留 publish_data_window_' + windowId + ' 数据，待发布完成后清理');

                // 标记为正在处理
                isProcessing = true;

                // 更新全局变量
                window.__AUTH_DATA__ = {
                    ...window.__AUTH_DATA__,
                    message: publishData,
                    source: 'cookieRestore',
                    windowId: windowId,
                    receivedAt: Date.now()
                };

                try {
                    const fillResult = await retryOperation(async () => await fillFormData(publishData), 3, 2000);
                    if (fillResult === false) {
                        console.warn('[搜狐号发布] 🚫 表单流程已中止，不再进入 publishApi 等待');
                        isProcessing = false;
                        return;
                    }
                } catch (e) {
                    console.log('[搜狐号发布] ❌ 填写表单数据失败:', e);
                }

                console.log('[搜狐号发布] 📤 准备发送数据到接口...');
                console.log('[搜狐号发布] ✅ 发布流程已启动，等待 publishApi 完成...');

                isProcessing = false;
            }
        } catch (error) {
            console.error('[搜狐号发布] ❌ 从全局存储读取数据失败:', error);
        }
    })();

    // ===========================
    // 7. 从全局存储读取发布数据（备用方案，不依赖消息）
    // ===========================

    // ===========================
    // 8. 检查是否有保存的发布数据（授权跳转恢复）
    // ===========================

    // ===========================
    // 9. 发布视频到搜狐号（移到 IIFE 内部以访问变量）
    // ===========================

    async function getCurrentWindowIdSafe() {
        if (currentWindowId) {
            return currentWindowId;
        }
        try {
            if (window.browserAPI && window.browserAPI.getWindowId) {
                currentWindowId = await window.browserAPI.getWindowId();
                console.log('[搜狐号发布] 当前窗口 ID（重新获取）:', currentWindowId);
            }
        } catch (e) {
            console.warn('[搜狐号发布] ⚠️ 获取窗口 ID 失败:', e.message);
        }
        return currentWindowId;
    }

    async function savePublishSuccessMarker(dataObj) {
        const publishId = dataObj?.video?.dyPlatform?.id || '';
        const markerData = {
            publishId,
            platform: 'souhuhao',
            savedAt: Date.now()
        };

        window.__sohuPublishSuccessFlag = true;

        try {
            localStorage.setItem(getPublishSuccessKey(), JSON.stringify(markerData));
            localStorage.setItem('PUBLISH_SUCCESS_DATA', JSON.stringify(markerData));

            const windowId = await getCurrentWindowIdSafe();
            if (windowId) {
                localStorage.setItem(`PUBLISH_SUCCESS_DATA_${windowId}`, JSON.stringify(markerData));
                if (window.browserAPI && window.browserAPI.setGlobalData) {
                    await window.browserAPI.setGlobalData(`PUBLISH_SUCCESS_DATA_${windowId}`, markerData);
                    console.log('[搜狐号发布] 💾 已保存 publishId 到 globalData:', publishId || '无');
                }
            } else {
                console.warn('[搜狐号发布] ⚠️ 窗口 ID 为空，仅保存 localStorage 成功标记');
            }

            console.log('[搜狐号发布] 💾 已保存发布成功标记:', markerData);
        } catch (e) {
            console.error('[搜狐号发布] ❌ 保存发布成功标记失败:', e);
        }

        return markerData;
    }

    async function clearPublishSuccessMarker() {
        try {
            localStorage.removeItem(getPublishSuccessKey());
            localStorage.removeItem('PUBLISH_SUCCESS_DATA');
            const windowId = await getCurrentWindowIdSafe();
            if (windowId) {
                localStorage.removeItem(`PUBLISH_SUCCESS_DATA_${windowId}`);
                if (window.browserAPI && window.browserAPI.removeGlobalData) {
                    await window.browserAPI.removeGlobalData(`PUBLISH_SUCCESS_DATA_${windowId}`);
                }
            }
            console.log('[搜狐号发布] 🧹 已清除发布成功标记');
        } catch (e) {
            console.warn('[搜狐号发布] ⚠️ 清除发布成功标记失败:', e.message);
        }
    }

    async function failPublishAndClose(dataObj, message, detail = message) {
        stopErrorListener();
        await clearPublishSuccessMarker();

        const publishId = dataObj?.video?.dyPlatform?.id;
        if (publishId && typeof sendStatisticsError === 'function') {
            console.log('[搜狐号发布] 📤 调用失败接口:', detail);
            await sendStatisticsError(publishId, detail, '搜狐号发布');
        } else if (publishId) {
            console.error('[搜狐号发布] ❌ sendStatisticsError 不可用，无法调用失败接口:', detail);
        } else {
            console.error('[搜狐号发布] ❌ publishId 为空，无法调用失败接口:', detail);
        }

        if (typeof closeWindowWithMessage === 'function') {
            await closeWindowWithMessage(message, 1000);
        } else if (typeof sendMessageToParent === 'function') {
            sendMessageToParent(message);
        } else {
            console.error('[搜狐号发布] ❌ closeWindowWithMessage/sendMessageToParent 均不可用，无法通知首页:', message);
        }
        return false;
    }

    function isSohuLoginPage() {
        try {
            const url = new URL(window.location.href);
            return url.hostname === 'mp.sohu.com' && url.pathname.includes('/mpfe/v4/login');
        } catch (_) {
            return String(window.location.href || '').includes('/mpfe/v4/login');
        }
    }

    async function stopIfLoginPage(dataObj, source = 'unknown') {
        if (!isSohuLoginPage()) {
            return false;
        }

        // 🔑 检测到登录页：不上报失败、不关窗，窗口停在登录页等用户手动登录。
        // 发布数据保留在 publish_data_window_${windowId}（发布完成后才清理），
        // 登录成功跳回发布页后脚本重新注入，会自动读取数据继续发布；
        // 主进程检测「登录页 → 业务页」导航后会自动保存新登录态到后台（publish-relogin-save）。
        console.warn(`[搜狐号发布] 🔐 检测到登录页，暂停发布流程等待用户手动登录，source=${source}, url=${window.location.href}`);
        if (typeof hideOperationBanner === 'function') {
            hideOperationBanner();
        }
        showLoginWaitTip();
        watchLoginRecovery();
        return true;
    }

    // 登录等待提示条：fixed 顶部 + pointer-events:none，不遮挡、不拦截登录表单操作
    function showLoginWaitTip() {
        try {
            if (document.getElementById('__sohu_login_wait_tip__')) {
                return;
            }
            const tip = document.createElement('div');
            tip.id = '__sohu_login_wait_tip__';
            tip.textContent = '搜狐号登录已失效，请在本窗口重新登录，登录成功后将自动继续发布';
            tip.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:10px 16px;background:#fff7e6;color:#d46b08;border-bottom:1px solid #ffd591;font-size:14px;font-weight:600;text-align:center;pointer-events:none;';
            (document.body || document.documentElement).appendChild(tip);
        } catch (e) {
            console.warn('[搜狐号发布] ⚠️ 显示登录提示条失败:', e.message);
        }
    }

    // 🔑 监听登录恢复：SPA 路由跳离登录页时脚本重新注入会被 __SH_SCRIPT_LOADED__ 防重挡住，
    // 这里 reload 一次让脚本干净地重新注入，从 globalData 恢复发布数据继续发布。
    // 用业务页白名单而非「离开登录页」做条件，避免短信验证等登录中间页误触发刷新打断用户。
    // 整页跳转场景下本 window 连同定时器一起销毁，不会产生副作用。
    function watchLoginRecovery() {
        if (window.__sohuLoginRecoveryWatcher__) {
            return;
        }
        console.log('[搜狐号发布] 👀 开始监听登录恢复，用户登录成功后将自动刷新继续发布');
        window.__sohuLoginRecoveryWatcher__ = setInterval(() => {
            let onBusinessPage = false;
            try {
                const url = new URL(window.location.href);
                onBusinessPage = url.hostname === 'mp.sohu.com' && url.pathname.startsWith('/mpfe/v4/contentManagement');
            } catch (_) {}
            if (onBusinessPage) {
                clearInterval(window.__sohuLoginRecoveryWatcher__);
                window.__sohuLoginRecoveryWatcher__ = null;
                console.log('[搜狐号发布] 🔄 检测到已登录并进入业务页（用户已重新登录），刷新页面以继续发布流程');
                window.location.reload();
            }
        }, 1000);
    }

    function readPublishFeedbackText() {
        const isVisible = (el) => {
            if (!el) {
                return false;
            }
            const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
            if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
                return false;
            }
            const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
            return !rect || rect.width > 0 || rect.height > 0;
        };

        const selectors = [
            '.ne-snackbar-item-description',
            '.el-message__content',
            '.el-message',
            '.alert-dialog .alert-desc',
            '.pushtimeout-dialog',
            '.cheetah-modal',
            '.cheetah-message',
            '.cheetah-toast'
        ];

        const texts = [];
        for (const selector of selectors) {
            try {
                const elements = Array.from(document.querySelectorAll(selector));
                for (const el of elements) {
                    if (isVisible(el)) {
                        const text = (el.textContent || '').trim();
                        if (text) {
                            texts.push(text);
                        }
                    }
                }
            } catch (e) {
                console.warn('[搜狐号发布] ⚠️ 读取反馈文本失败:', selector, e.message);
            }
        }

        return Array.from(new Set(texts)).join(' | ');
    }

    // 填写表单数据
    async function fillFormData(dataObj) {
        console.log("🚀 ~ fillFormData ~ dataObj: ", dataObj);
        // 防止重复执行
        if (fillFormRunning) {
            return;
        }
        fillFormRunning = true;

        try {
            if (await stopIfLoginPage(dataObj, 'fillFormData')) {
                fillFormRunning = false;
                return false;
            }

            const pathImage = dataObj?.video?.video?.cover;
            if (!pathImage) {
                // alert('No cover image found');
                fillFormRunning = false;
                return;
            }

            /* const userInfoResult = await fetch('https://mp.163.com/wemedia/navinfo.do', {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
            })
            const userInfoRes = await userInfoResult.json(); */
            let userInfo = {};
            /* if(userInfoRes.code === 1){
                userInfo = userInfoRes.data;
            } */

            setTimeout(async () => {
                // 🔑 延迟窗口内页面可能被搜狐弹回登录页，真正开始填表前再确认一次
                if (await stopIfLoginPage(dataObj, 'fillFormData-delayed')) {
                    fillFormRunning = false;
                    return;
                }

                // 标题（带重试和验证）
                try {
                    await retryOperation(async () => {
                        const titleEle = await waitForElement(".publish-title input", 5000);

                        // 先触发focus事件
                        if (typeof titleEle.focus === 'function') {
                            titleEle.focus();
                        } else {
                            titleEle.dispatchEvent(new Event('focus', {bubbles: true}));
                        }

                        // 延迟执行，让React状态稳定
                        await window.delay(300);

                        const targetTitle = dataObj.video.video.title || '';
                        setNativeValue(titleEle, targetTitle);

                        // 额外触发input事件
                        titleEle.dispatchEvent(new Event('input', {bubbles: true}));

                        // 等待 React 更新
                        await window.delay(200);

                        // 🔑 验证是否成功设置
                        const currentValue = (titleEle.value || '').trim();
                        const expectedValue = targetTitle.trim();
                        if (currentValue !== expectedValue) {
                            throw new Error(`标题设置失败: 期望"${expectedValue}", 实际"${currentValue}"`);
                        }

                        console.log('[搜狐号发布] ✅ 标题设置成功:', currentValue);
                    }, 5, 1000);
                } catch (error) {
                    console.log('[搜狐号发布] ❌ 标题填写失败:', error.message);
                }

                //设置简介（带重试）
                try {
                    await retryOperation(async () => {
                        // 首先检查是否已经填写过（通过全局标记）
                        if (introFilled) {
                            console.log('[搜狐号发布] 简介已填写过，跳过');
                            return; // 跳过重试
                        }

                        console.log('[搜狐号发布] 开始填写简介...');
                        const introEle = await waitForElement(".abstract textarea", 5000);
                        console.log('[搜狐号发布] 简介输入框元素:', introEle);

                        const targetIntro = dataObj.video.video.intro || '';
                        const targetContent = targetIntro.trim();
                        console.log('[搜狐号发布] 目标简介内容:', targetContent);

                        // 检查实际内容
                        const currentContent = (introEle?.value || '').trim();
                        console.log('[搜狐号发布] 当前简介内容:', currentContent);

                        // 只有在标记未设置且内容不同时才填写
                        if (introEle && currentContent !== targetContent) {
                            // 立即标记为已填写（在任何操作之前，防止并发）
                            introFilled = true;
                            console.log('[搜狐号发布] 正在填写简介...');

                            // 先触发focus事件
                            if (typeof introEle.focus === 'function') {
                                introEle.focus();
                            } else {
                                introEle.dispatchEvent(new Event('focus', { bubbles: true }));
                            }

                            // 延迟执行，让React状态稳定
                            await window.delay(300);

                            setNativeValue(introEle, dataObj.video.video.intro);

                            // 额外触发input事件
                            introEle.dispatchEvent(new Event('input', { bubbles: true }));

                            // 等待 React 更新
                            await window.delay(200);

                            // 🔑 验证是否成功设置
                            const updatedValue = (introEle.value || '').trim();
                            if (updatedValue !== targetContent) {
                                throw new Error(`简介设置失败: 期望"${targetContent.substring(0, 50)}...", 实际"${updatedValue.substring(0, 50)}..."`);
                            }

                            console.log('[搜狐号发布] ✅ 简介填写完成');
                        } else if (!introEle) {
                            throw new Error('简介输入框元素为空');
                        } else {
                            // 内容已经正确，也标记为已填写
                            introFilled = true;
                            console.log('[搜狐号发布] 简介内容已正确，无需修改');
                        }
                    }, 5, 1000);
                } catch (error) {
                    console.log('[搜狐号发布] ❌ 简介填写失败:', error.message);
                }

                try {
                    // 内容（带重试）
                    setTimeout(async () => {
                        try {
                            await retryOperation(async () => {
                                const editorIframeEle = await waitForElement("#editor", 20000); // 🔑 增加到 20 秒
                                const editorEle = editorIframeEle.querySelector('.ql-editor ')
                                let htmlContent = dataObj.video.video.content;

                                // 解析 HTML 中的图片，通过搜狐号 dumpproxy 接口上传
                                const tempDiv = document.createElement('div');
                                tempDiv.innerHTML = htmlContent;

                                // 🔴 清理开头的空白 - 直接删除文字内容之前的所有HTML
                                const tempCleaner = document.createElement('div');
                                tempCleaner.innerHTML = htmlContent;

                                // 递归删除所有开头的空节点，直到找到第一个有非空文本的节点
                                function removeLeadingEmptyNodes(node) {
                                    while (node.firstChild) {
                                        const child = node.firstChild;
                                        if (child.nodeType === 3) { // 文本节点
                                            const trimmedText = child.textContent.trim();
                                            if (trimmedText) {
                                                // 有内容，保留但删除前面的空白
                                                child.textContent = trimmedText + '\u200B'; // 用零宽字符保留格式
                                                return true; // 找到了内容，停止
                                            } else {
                                                node.removeChild(child);
                                            }
                                        } else if (child.nodeType === 1) { // 元素节点
                                            // 先检查这个节点是否有非空文本
                                            if (child.textContent.trim()) {
                                                // 有内容，递归处理这个节点
                                                if (removeLeadingEmptyNodes(child)) {
                                                    return true; // 找到了内容，停止
                                                }
                                                // 如果递归后仍然是空的，删除它
                                                if (!child.textContent.trim()) {
                                                    node.removeChild(child);
                                                } else {
                                                    return true; // 有内容，停止
                                                }
                                            } else {
                                                // 完全空节点，删除
                                                node.removeChild(child);
                                            }
                                        } else {
                                            // 注释、文档等其他节点，直接删除
                                            node.removeChild(child);
                                        }
                                    }
                                    return false;
                                }

                                removeLeadingEmptyNodes(tempCleaner);

                                // 🔢 序号文本化：搜狐号用 Quill 编辑器，有序列表序号由 CSS counter 渲染，
                                //    被段落打断的多个独立 <ol> 会各自从 1 开始（Quill 已知缺陷 #3922，
                                //    且 Quill 忽略 <ol start>，粘贴后改 DOM 也会被 Delta 模型丢弃）。
                                //    这里在粘贴前把顶层有序列表按文档顺序连续编号，序号写成实体文本
                                //    "N. " 并将 <ol>/<li> 降级为普通段落 <p>，确保发布后序号正确。
                                (function textifyOrderedLists(root) {
                                    let counter = 1;
                                    // 跳过嵌套在 li 内的子列表（保留其独立编号），仅处理顶层有序列表
                                    const topOls = Array.from(root.querySelectorAll('ol')).filter((ol) => !ol.closest('li'));
                                    topOls.forEach((ol) => {
                                        const frag = document.createDocumentFragment();
                                        ol.querySelectorAll(':scope > li').forEach((li) => {
                                            const p = document.createElement('p');
                                            p.innerHTML = counter + '. ' + li.innerHTML;
                                            frag.appendChild(p);
                                            counter++;
                                        });
                                        if (ol.parentNode) ol.parentNode.replaceChild(frag, ol);
                                    });
                                    if (counter > 1) {
                                        console.log('[搜狐号发布] 🔢 有序列表序号已文本化，共', counter - 1, '项');
                                    }
                                })(tempCleaner);
                                htmlContent = tempCleaner.innerHTML.replace(/\u200B/g, '').trim();
                                console.log('[搜狐号发布] 🧹 已清理开头所有空白内容');

                                // 清空编辑器
                                editorEle.innerHTML = '';

                                // 让编辑器获得焦点
                                editorEle.focus();

                                // 📏 记录预期内容长度（用于验证）
                                const expectedPlainText = tempDiv.textContent || '';
                                const expectedLength = expectedPlainText.trim().length;
                                console.log('[搜狐号发布] 📏 预期内容长度:', expectedLength, '字符');

                                // 通过粘贴事件插入内容（让 Draft.js 自己处理）
                                const pasteEvent = new ClipboardEvent('paste', {
                                    clipboardData: new DataTransfer(),
                                    bubbles: true,
                                    cancelable: true
                                });

                                // 设置粘贴的 HTML 和纯文本内容
                                pasteEvent.clipboardData.setData('text/html', htmlContent);
                                pasteEvent.clipboardData.setData('text/plain', expectedPlainText);

                                editorEle.dispatchEvent(pasteEvent);
                                console.log('[搜狐号发布] ✅ 已触发粘贴事件');

                                // 🔑 等待并验证内容是否完整粘贴
                                let actualLength = 0;
                                let retryCount = 0;
                                const maxRetries = 3;
                                const waitTimes = [800, 2000, 3000];

                                while (retryCount < maxRetries) {
                                    await window.delay(waitTimes[retryCount]);

                                    const actualText = (editorEle.innerText || editorEle.textContent || '').trim();
                                    actualLength = actualText.length;

                                    console.log(`[搜狐号发布] 📏 第${retryCount + 1}次验证: 实际长度=${actualLength}, 预期长度=${expectedLength}`);

                                    if (actualLength >= expectedLength * 0.8) {
                                        console.log('[搜狐号发布] ✅ 内容验证通过！实际/预期比例:', (actualLength / expectedLength * 100).toFixed(1) + '%');
                                        break;
                                    }

                                    retryCount++;
                                    if (retryCount < maxRetries) {
                                        console.warn(`[搜狐号发布] ⚠️ 内容可能未完全粘贴（${actualLength}/${expectedLength}），等待更长时间...`);
                                    }
                                }

                                if (actualLength < expectedLength * 0.8) {
                                    console.error(`[搜狐号发布] ❌ 内容验证失败！实际长度${actualLength}，预期长度${expectedLength}，仅达到${(actualLength / expectedLength * 100).toFixed(1)}%`);
                                }

                                console.log('[搜狐号发布] ✅ 内容填写完成');
                            }, 3, 1000);
                        } catch (e) {
                            console.log('[搜狐号发布] ❌ 内容填写失败:', e.message);
                        }
                    }, window.getRandomDelayMs(200));
                } catch (e) {
                    console.log('[搜狐号发布] ❌ 内容填写失败:', e.message)
                }

                // 设置
                const hasSettingsWrapEle = await waitForElement(".cover-button");
                if (hasSettingsWrapEle) {
                    // 🔴 启动全局错误监听器（已在 IIFE 顶层定义）
                    startErrorListener();

                    // 设置封面（使用主进程下载绕过跨域）
                    await (async () => {
                        try {
                            const {blob, contentType} = await downloadFile(pathImage, 'image/png');
                            var file = new File([blob], dataObj?.video?.formData?.title + ".png", {type: contentType || "image/png"});

                            setTimeout(async () => {
                                // 选中本地上传（点击"选择封面"按钮）
                                setTimeout(async () => {
                                    // 等待封面选择区域出现
                                    await waitForElement(".cover-button");
                                    await delay(500); // 等待渲染完成

                                    // 查找并点击"选择封面"按钮
                                    const coverBtn = document.querySelector(".cover-button .upload-file");
                                    console.log("🚀 ~  ~ coverBtn: ", coverBtn);
                                    if (coverBtn) {
                                        //检查是否已经有图片
                                        const coverWrapperEle = document.querySelector(".pic-cover");
                                        if(coverWrapperEle){
                                            const coverBg = coverWrapperEle.getAttribute('style');
                                            if(coverBg){
                                                // 检查是否有图片
                                                if(coverBg.includes('url')){
                                                    console.log('[搜狐号发布] ✅ 已经有图片');
                                                    const closeBtn = coverWrapperEle.querySelector('.mp-icon-close');
                                                    closeBtn && closeBtn.click();
                                                }else{
                                                    console.log('[搜狐号发布] ❌ 没有图片');
                                                }
                                            }
                                        }
                                        coverBtn.click();
                                    }
                                    await delay(1000); // 等待渲染完成

                                    // 封面上传弹窗弹出后选中还有本地上传的tab
                                    const uploadTabs = document.querySelectorAll('.select-dialog .dialog-title h3');
                                    console.log("🚀 ~  ~ uploadTabs: ", uploadTabs);
                                    let uploadFromLocalTab = null;
                                    if (uploadTabs.length) {
                                        for (const tab of uploadTabs) {
                                            if (tab.textContent.trim().includes('本地')) {
                                                uploadFromLocalTab = tab;
                                            }
                                        }
                                    }
                                    await delay(1000); // 等待渲染完成
                                    console.log("🚀 ~  ~ uploadFromLocalTab: ", uploadFromLocalTab);
                                    if (uploadFromLocalTab) {
                                        uploadFromLocalTab.click();
                                    } else {
                                        console.log('找不到本地上传tab');
                                    }

                                    setTimeout(async () => {
                                        // 使用原生选择器获取元素
                                        const hasInputEle = await waitForElement("#new-file");
                                        if (hasInputEle) {
                                            const input = document.querySelector("#new-file");
                                            const dataTransfer = new DataTransfer();
                                            // 创建 DataTransfer 对象模拟文件上传
                                            dataTransfer.items.add(file);
                                            input.files = dataTransfer.files;
                                            const event = new Event("change", {bubbles: true});
                                            input.dispatchEvent(event);

                                            // 封装上传检测与重试逻辑
                                            const tryUploadImage = async (retryCount = 0) => {
                                                const maxRetries = 3;

                                                // 🔴 自定义等待逻辑：同时检查图片元素和错误信息
                                                const waitForImageOrError = async (timeout = 30000) => { // 🔑 增加到 30 秒
                                                    const startTime = Date.now();
                                                    const checkInterval = 500; // 🔑 增加到 500ms

                                                    while (Date.now() - startTime < timeout) {
                                                        // 1. 先检查是否有错误信息（优先级更高）
                                                        const errorMsg = getLatestError();
                                                        if (errorMsg) {
                                                            return { type: 'error', message: errorMsg };
                                                        }

                                                        // 2. 再检查图片元素是否出现
                                                        const imageEle = document.querySelector(".img-wrapper");
                                                        console.log("🚀 ~ waitForImageOrError ~ imageEle: ", imageEle);
                                                        if (imageEle) {
                                                            const imgEle = imageEle.querySelector('img');
                                                            if(imgEle && imgEle.getAttribute('src')){
                                                                // 🔑 检测到图片元素后，再等待 500ms 确认是否有错误
                                                                // 因为 MutationObserver 是异步的，错误信息可能还在路上
                                                                console.log('[搜狐号发布] 🔍 检测到图片元素，等待 500ms 确认是否有错误...');
                                                                await delay(500);
                                                                // 检查是否有符合条件的图片
                                                                const successCountEle = document.querySelector('.success-number');
                                                                if(successCountEle){
                                                                    const successCount = parseInt(successCountEle.textContent.trim());
                                                                    if(successCount){
                                                                        return { type: 'success', element: imageEle };
                                                                    }else{
                                                                        // 检查图片上的错误信息
                                                                        const errorMsgEle = imageEle.querySelector('.error-bar');
                                                                        if (errorMsgEle){
                                                                            const errorMsg = errorMsgEle.textContent.trim();
                                                                            if(errorMsg){
                                                                                return { type: 'error', message: errorMsgEle.textContent.trim() };
                                                                            }else{
                                                                                return { type: 'error', message: '上传失败或图片不符合要求' };
                                                                            }
                                                                        }
                                                                    }
                                                                }
                                                                const confirmError = getLatestError();
                                                                if (confirmError) {
                                                                    console.log('[搜狐号发布] ⚠️ 确认期间检测到错误:', confirmError);
                                                                    return { type: 'error', message: confirmError };
                                                                }
                                                                return { type: 'success', element: imageEle };
                                                            }

                                                            // 等待下一次检查
                                                            await delay(checkInterval);
                                                        }

                                                        // 等待下一次检查
                                                        await delay(checkInterval);
                                                    }

                                                    // 超时，再检查一次错误信息
                                                    const finalError = getLatestError();
                                                    if (finalError) {
                                                        return { type: 'error', message: finalError };
                                                    }

                                                    return { type: 'timeout' };
                                                };

                                                const result = await waitForImageOrError(10000);
                                                const myWindowId = await window.browserAPI.getWindowId();

                                                // 🔴 检测到错误信息，直接上报失败
                                                if (result.type === 'error') {
                                                    console.log(`[搜狐号发布] [窗口${myWindowId}] ❌ 检测到错误信息，直接上报失败: ${result.message}`);
                                                    stopErrorListener();
                                                    const publishId = dataObj.video?.dyPlatform?.id;
                                                    if (publishId) {
                                                        await sendStatisticsError(publishId, result.message, '搜狐号发布');
                                                    }
                                                    await closeWindowWithMessage('发布失败，刷新数据', 1000);
                                                    return; // 不再继续
                                                }

                                                if (result.type === 'success') {
                                                    console.log('[搜狐号发布] ✅ 图片上传成功');

                                                    await delay(2000); // 等待渲染完成
                                                    const uploadBoards = document.querySelectorAll(`.select-dialog .board`);
                                                    let visibleBoard = null;
                                                    for (let board of uploadBoards) {
                                                        // 检查行内样式是否有 display: none
                                                        if (board.style.display !== 'none') {
                                                            visibleBoard = board;
                                                            break;
                                                        }
                                                    }
                                                    console.log("🚀 ~ visibleBoard: ", visibleBoard);
                                                    const submitCoverBtns = visibleBoard ? visibleBoard.querySelectorAll('.bottom-buttons p.button') : [];
                                                    console.log("🚀 ~ tryUploadImage ~ submitCoverBtns: ", submitCoverBtns);
                                                    let submitCoverBtn = null;
                                                    // 点击确定按钮
                                                    if (submitCoverBtns.length) {
                                                        for (const btn of submitCoverBtns) {
                                                            if (btn.textContent.trim().includes('确定')) {
                                                                submitCoverBtn = btn;
                                                            }
                                                        }
                                                        console.log("🚀 ~ tryUploadImage ~ submitCoverBtn: ", submitCoverBtn);
                                                        // 使用模拟真实鼠标事件，确保点击生效
                                                        const clickEvent = new MouseEvent('click', {
                                                            view: window,
                                                            bubbles: true,
                                                            cancelable: true
                                                        });
                                                        submitCoverBtn.dispatchEvent(clickEvent);
                                                        console.log('[搜狐号发布] ✅ 已点击确定（模拟鼠标事件）');
                                                        // 等待编辑器关闭和图片保存
                                                        await delay(2000);
                                                    } else {
                                                        console.error('[搜狐号发布] ❌ 找不到提交图片按钮，上报失败');
                                                        stopErrorListener();
                                                        const publishId = dataObj.video?.dyPlatform?.id;
                                                        if (publishId) {
                                                            await sendStatisticsError(publishId, '找不到提交图片按钮', '搜狐号发布');
                                                        }
                                                        await closeWindowWithMessage('发布失败，刷新数据', 1000);
                                                        return;
                                                    }
                                                    await delay(2000);
                                                    const publishTime = dataObj.video.formData.send_set;
                                                    console.log("🚀 ~ tryUploadImage ~ publishTime: ", publishTime);
                                                    //return
                                                    if (+publishTime === 2) {
                                                        let scheduledReleasesBtn = document.querySelector('.publish-report-btn.timeout-pub');

                                                        if (scheduledReleasesBtn) {
                                                            console.log("🚀 ~ tryUploadImage ~ scheduledReleasesBtn: ", scheduledReleasesBtn);
                                                            if (scheduledReleasesBtn) {
                                                                const clickEvent = new MouseEvent('click', {
                                                                    view: window,
                                                                    bubbles: true,
                                                                    cancelable: true
                                                                });
                                                                scheduledReleasesBtn.dispatchEvent(clickEvent);
                                                                console.log('[搜狐号发布] ✅ 已点击定时发布（模拟鼠标事件）');
                                                                await delay(2000);
                                                                const tipDialog = document.querySelector('.alert-dialog');
                                                                if(tipDialog){
                                                                    const tipText = tipDialog.innerText;
                                                                    if(tipText && tipText.includes('确认发布文章么')){
                                                                        tipDialog.querySelector('button.sure-btn').click();
                                                                    }
                                                                }
                                                                await delay(2000);
                                                                //  检测有没有定时发布弹窗
                                                                const scheduledReleasesModal = document.querySelector('.pushtimeout-dialog');
                                                                if (scheduledReleasesModal) {
                                                                    console.log('[搜狐号发布] ✅ 检测到定时发布弹窗');

                                                                    // 解析定时发布时间
                                                                    const sendTime = dataObj.video?.formData?.send_time;
                                                                    if (sendTime) {
                                                                        console.log('[搜狐号发布] ⏰ 开始选择定时发布时间:', sendTime);

                                                                        const timeConfig = parseSendTime(sendTime);
                                                                        if (!timeConfig) {
                                                                            console.error('[搜狐号发布] ❌ 解析定时时间失败');
                                                                            await failPublishAndClose(dataObj, '发布失败，刷新数据', '定时时间解析失败');
                                                                            return;
                                                                        }

                                                                        // 调用选择时间函数
                                                                        const timeSelectSuccess = await selectScheduledTime(
                                                                            timeConfig.dateIndex,
                                                                            timeConfig.hour,
                                                                            timeConfig.minute
                                                                        );

                                                                        if (!timeSelectSuccess) {
                                                                            console.error('[搜狐号发布] ❌ 时间选择失败');
                                                                            await failPublishAndClose(dataObj, '发布失败，刷新数据', '定时时间选择失败');
                                                                            return;
                                                                        }

                                                                        // 点击确定发布按钮
                                                                        await delay(500);
                                                                        const confirmBtn = document.querySelector('.pushtimeout-btn .sure-btn');

                                                                        if (confirmBtn) {
                                                                            console.log('[搜狐号发布] ✅ 点击确定定时发布');

                                                                            await savePublishSuccessMarker(dataObj);

                                                                            confirmBtn.click();

                                                                            // 定时发布点击后会立即跳转到成功页
                                                                            console.log('[搜狐号发布] ✅ 等待页面跳转到首页');
                                                                            await checkPublishResult(dataObj, false);
                                                                        } else {
                                                                            console.error('[搜狐号发布] ❌ 未找到确定按钮');
                                                                            await failPublishAndClose(dataObj, '发布失败，刷新数据', '未找到定时发布确定按钮');
                                                                            return;
                                                                        }
                                                                    } else {
                                                                        console.warn('[搜狐号发布] ⚠️ 未传入定时发布时间');
                                                                        await failPublishAndClose(dataObj, '发布失败，刷新数据', '未传入定时发布时间');
                                                                        return;
                                                                    }
                                                                } else {
                                                                    console.error('[搜狐号发布] ❌ 未检测到定时发布弹窗');
                                                                    await failPublishAndClose(dataObj, '发布失败，刷新数据', '未检测到定时发布弹窗');
                                                                    return;
                                                                }
                                                            }
                                                        } else {
                                                            console.error('[搜狐号发布] ❌ 找不到定时发布按钮');
                                                            await failPublishAndClose(dataObj, '发布失败，刷新数据', '找不到定时发布按钮');
                                                            return;
                                                        }
                                                    }else{
                                                        let publishBtn = await waitForElement('.publish-report-btn.active');
                                                        //  点击发布按钮
                                                        if(publishBtn){
                                                            // 🔑 检查发布按钮是否 disabled
                                                            if (publishBtn.disabled || publishBtn.classList.contains('cheetah-btn-disabled') || publishBtn.getAttribute('disabled') !== null) {
                                                                console.error('[搜狐号发布] ❌ 发布按钮不可用(disabled)');

                                                                // 🔴 收集表单诊断信息
                                                                const formDiagnostics = typeof window.collectFormDiagnostics === 'function' ?
                                                                  window.collectFormDiagnostics({
                                                                    platform: 'souhuhao',
                                                                    selectors: {
                                                                      title: 'input[placeholder*="标题"]',
                                                                      content: '.editor-content',
                                                                      coverImage: '.select-image img',
                                                                    },
                                                                    required: {
                                                                      title: true,
                                                                      content: true,
                                                                      coverImage: true,
                                                                    }
                                                                  }) : null;

                                                                // 🔴 诊断按钮 disabled 原因
                                                                const buttonDiagnosis = typeof window.diagnoseButtonDisabled === 'function' ?
                                                                  window.diagnoseButtonDisabled(publishBtn, formDiagnostics, getLatestError() ? [getLatestError()] : []) : null;

                                                                console.log('[搜狐号发布] 📋 表单诊断结果:', formDiagnostics);
                                                                console.log('[搜狐号发布] 📋 按钮诊断结果:', buttonDiagnosis);

                                                                // 🔴 生成详细的失败原因（人类可读）
                                                                let failureReason = '发布按钮不可用，可能不符合发布要求，或者发文次数已用尽';
                                                                if (buttonDiagnosis && buttonDiagnosis.recommendation) {
                                                                  failureReason = buttonDiagnosis.recommendation;
                                                                }

                                                                await failPublishAndClose(dataObj, '发布失败，刷新数据', failureReason);
                                                                return;
                                                            }
                                                            await savePublishSuccessMarker(dataObj);

                                                            const clickEvent = new MouseEvent('click', {
                                                                view: window,
                                                                bubbles: true,
                                                                cancelable: true
                                                            });
                                                            publishBtn.dispatchEvent(clickEvent);
                                                            await checkPublishResult(dataObj, true);
                                                            console.log('[搜狐号发布] ✅ 已点击发布（模拟鼠标事件）');
                                                        }else{
                                                            console.error('[搜狐号发布] ❌ 找不到发布按钮，上报失败');
                                                            await failPublishAndClose(dataObj, '发布失败，刷新数据', '发布按钮不可用');
                                                            return;
                                                        }
                                                    }

                                                } else {
                                                    // 图片上传失败（timeout），检查是否有错误信息
                                                    const myWindowId = await window.browserAPI.getWindowId();
                                                    console.log(`[搜狐号发布] [窗口${myWindowId}] ❌ 图片上传失败，重试次数: ${retryCount}/${maxRetries}`);

                                                    // 优先使用全局错误监听器捕获的错误
                                                    const errorMessage = getLatestError();
                                                    console.log(`[搜狐号发布] [窗口${myWindowId}] 📨 最新错误信息:`, errorMessage);

                                                    // 🔴 有错误信息就直接走失败接口，不再重试
                                                    if (errorMessage) {
                                                        console.log(`[搜狐号发布] [窗口${myWindowId}] ❌ 检测到错误信息，直接上报失败，不再重试`);
                                                        stopErrorListener(); // 停止监听
                                                        const publishId = dataObj.video?.dyPlatform?.id;
                                                        console.log(`[搜狐号发布] [窗口${myWindowId}] 📋 publishId:`, publishId);
                                                        console.log(`[搜狐号发布] [窗口${myWindowId}] 📋 dataObj:`, dataObj);
                                                        if (publishId) {
                                                            console.log(`[搜狐号发布] [窗口${myWindowId}] 📤 调用 sendStatisticsError...`);
                                                            await sendStatisticsError(publishId, errorMessage, '搜狐号发布');
                                                            console.log(`[搜狐号发布] [窗口${myWindowId}] ✅ sendStatisticsError 完成`);
                                                        } else {
                                                            console.error(`[搜狐号发布] [窗口${myWindowId}] ❌ publishId 为空，无法调用失败接口！`);
                                                        }
                                                        await closeWindowWithMessage('发布失败，刷新数据', 1000);
                                                        return; // 不再继续
                                                    }

                                                    // 没有错误信息才重试
                                                    if (retryCount < maxRetries) {
                                                        console.log(`[搜狐号发布] 🔄 ${2}秒后重新上传图片...`);
                                                        await delay(2000);

                                                        // 重新触发文件上传
                                                        const input = document.querySelector(".cheetah-upload input");
                                                        if (input) {
                                                            input.files = dataTransfer.files;
                                                            const event = new Event("change", {bubbles: true});
                                                            input.dispatchEvent(event);
                                                            console.log('[搜狐号发布] 🔄 已重新触发上传');

                                                            // 递归重试
                                                            await delay(2000);
                                                            await tryUploadImage(retryCount + 1);
                                                        } else {
                                                            console.error('[搜狐号发布] ❌ 无法找到上传输入框，无法重试');
                                                            stopErrorListener();
                                                            const publishId = dataObj.video?.dyPlatform?.id;
                                                            if (publishId) {
                                                                await sendStatisticsError(publishId, '图片上传失败，无法找到上传输入框', '搜狐号发布');
                                                            }
                                                            await closeWindowWithMessage('图片上传失败，刷新数据', 1000);
                                                        }
                                                    } else {
                                                        // 超过最大重试次数
                                                        console.error('[搜狐号发布] ❌ 图片上传重试次数已用尽');
                                                        stopErrorListener();
                                                        const publishId = dataObj.video?.dyPlatform?.id;
                                                        if (publishId) {
                                                            await sendStatisticsError(publishId, '图片上传失败，重试次数已用尽', '搜狐号发布');
                                                        }
                                                        await closeWindowWithMessage('图片上传失败，刷新数据', 1000);
                                                    }
                                                }
                                            };

                                            // 启动上传检测（延迟2秒等待上传开始）
                                            setTimeout(async () => {
                                                await tryUploadImage(0);
                                            }, window.getRandomDelayMs(2000));
                                        }
                                    }, window.getRandomDelayMs(1000));
                                }, window.getRandomDelayMs(2000));
                            }, window.getRandomDelayMs(1000));
                        } catch (error) {
                            console.log('[搜狐号发布] ❌ 封面下载失败:', error);
                            stopErrorListener();
                            const publishId = dataObj?.video?.dyPlatform?.id;
                            if (publishId) {
                                await sendStatisticsError(publishId, error.message || '封面下载失败', '搜狐号发布');
                            }
                            await closeWindowWithMessage('封面下载失败，刷新数据', 1000);
                        }
                    })();
                }

                fillFormRunning = false;
                // alert('Automation process completed');
            }, window.getRandomDelayMs(10000));

        } catch (error) {
            // 捕获填写表单过程中的任何错误（仅捕获 setTimeout 调度前的同步错误）
            console.error('[搜狐号发布] fillFormData 错误:', error);
            // 发送错误上报
            const publishId = dataObj?.video?.dyPlatform?.id;
            if (publishId) {
                await sendStatisticsError(publishId, error.message || '填写表单失败', '搜狐号发布');
            }
            // 同步错误时重置标记
            fillFormRunning = false;
            // 填写表单失败也要关闭窗口，不阻塞下一个任务
            await closeWindowWithMessage('填写表单失败，刷新数据', 1000);
        }
        // 注意：不在 finally 中重置 fillFormRunning
        // 因为 setTimeout 是异步的，finally 会立即执行
        // fillFormRunning 的重置在 setTimeout 回调内部完成（line 974）
    }

    /**
     * 检查发布结果（通用方法）
     * @param {object} dataObj - 发布数据对象
     * @param {boolean} handleExtraButtons - 是否处理额外的确认按钮（立即发布需要，定时发布不需要）
     * @returns {Promise<boolean>} 是否成功（无错误）
     */
    async function checkPublishResult(dataObj, handleExtraButtons = true) {
        console.log('[搜狐号发布] ⏳ 等待检测发布结果...');
        await delay(1000);

        const handlePublishSuccess = async (reason, feedbackText = '') => {
            stopErrorListener();
            const markerData = await savePublishSuccessMarker(dataObj);
            if (markerData.publishId && typeof sendStatistics === 'function') {
                console.log('[搜狐号发布] 📤 检测到成功，调用成功接口:', reason);
                await sendStatistics(markerData.publishId, '搜狐号发布');
            } else if (markerData.publishId) {
                console.warn('[搜狐号发布] ⚠️ 检测到成功但 sendStatistics 不可用，无法调用成功接口:', reason);
            } else {
                console.warn('[搜狐号发布] ⚠️ 检测到成功但 publishId 为空，无法调用成功接口:', reason);
            }
            console.log('[搜狐号发布] ✅ 发布成功确认:', { reason, feedbackText });
            if (typeof closeWindowWithMessage === 'function') {
                await closeWindowWithMessage('发布成功，刷新数据', 1000);
            } else if (typeof sendMessageToParent === 'function') {
                sendMessageToParent('发布成功，刷新数据');
            } else {
                console.error('[搜狐号发布] ❌ closeWindowWithMessage/sendMessageToParent 均不可用，无法通知首页发布成功');
            }
            return true;
        };

        const handleExtraConfirmButtons = async () => {
            if (!handleExtraButtons) {
                return;
            }
            try {
                const transferDialogEle = document.querySelector('.alert-dialog');
                if(transferDialogEle){
                    const dialogContent = transferDialogEle.querySelector('.alert-desc');
                    if(dialogContent){
                        const dialogText = dialogContent.textContent.trim();
                        if(dialogText.includes('建议以动态形式发布')){
                            const sureBtn = transferDialogEle.querySelector('.sure-btn');
                            if (sureBtn) {
                                sureBtn.click();
                                console.log('[搜狐号发布] ✅ 已确认“建议以动态形式发布”弹窗');
                            }
                        }
                    }
                }
            } catch (e) {
                console.log(e);
            }
        };

        const startedAt = Date.now();
        const timeoutMs = 120000;
        const successPattern = /(发布|提交|定时|预约|审核).{0,10}成功|成功.{0,10}(发布|提交|定时|预约|审核)|已发布|已提交|发布已受理/;
        const failurePattern = /失败|错误|异常|不能为空|请先|违规|超限|驳回|不可用|不符合|已用尽|审核未通过/;
        let lastFeedbackText = '';

        while (Date.now() - startedAt < timeoutMs) {
            await handleExtraConfirmButtons();

            const href = window.location.href;
            if (href.includes('/contentManagement/first/page')) {
                return await handlePublishSuccess('first-page-navigation', href);
            }

            const publishErrorMsg = getLatestError();
            if (publishErrorMsg) {
                console.log('[搜狐号发布] ❌ 检测到发布错误:', publishErrorMsg);
                return await failPublishAndClose(dataObj, '发布失败，刷新数据', publishErrorMsg);
            }

            const feedbackText = readPublishFeedbackText();
            if (feedbackText && feedbackText !== lastFeedbackText) {
                lastFeedbackText = feedbackText;
                console.log('[搜狐号发布] 🔎 发布反馈:', feedbackText);
            }

            if (feedbackText && successPattern.test(feedbackText) && !failurePattern.test(feedbackText)) {
                return await handlePublishSuccess('success-feedback', feedbackText);
            }

            if (feedbackText && failurePattern.test(feedbackText)) {
                console.log('[搜狐号发布] ❌ 检测到失败反馈:', feedbackText);
                return await failPublishAndClose(dataObj, '发布失败，刷新数据', feedbackText);
            }

            await delay(1500);
        }

        console.error('[搜狐号发布] ❌ 发布结果超时，未检测到成功跳转或错误提示');
        return await failPublishAndClose(dataObj, '发布失败，刷新数据', '发布结果超时，未检测到成功跳转或错误提示');
    }
})(); // IIFE 结束

/**
 * 获取发布成功标志的 localStorage key
 * 用于发布页和首页之间的通信：发布页设置标志，首页检测到后上报成功
 */
function getPublishSuccessKey() {
    return 'sohu_publish_success_data';
}

function getImageType(src){
    const imageType = src.split(';')[0].split('/')[1];
    return imageType;
}

/**
 * 解析定时发布时间
 * @param {string} sendTimeStr - 时间字符串，格式："2026-01-21 00:00:00"
 * @returns {object} { dateIndex, hour, minute } 或 null
 */
function parseSendTime(sendTimeStr) {
    try {
        // 解析时间字符串
        const [dateStr, timeStr] = sendTimeStr.split(' ');
        const [year, month, day] = dateStr.split('-').map(Number);
        const [hour, minute] = timeStr.split(':').map(Number);

        // 计算相对于今天的天数差
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const sendDate = new Date(year, month - 1, day);
        sendDate.setHours(0, 0, 0, 0);

        const dayDiff = Math.floor((sendDate - today) / (1000 * 60 * 60 * 24));

        console.log('[搜狐号发布] 📅 解析定时时间:', {
            原始时间: sendTimeStr,
            日期: `${year}-${month}-${day}`,
            时间: `${hour}:${minute}`,
            相对天数: dayDiff
        });

        return {
            dateIndex: dayDiff,
            hour: hour,
            minute: minute
        };
    } catch (error) {
        console.error('[搜狐号发布] ❌ 解析定时时间失败:', error);
        return null;
    }
}

/**
 * 选择虚拟列表中的选项
 * @param {HTMLElement} selectElement - select 组件的容器
 * @param {string|number} targetValue - 要选择的值（显示文本）
 * @param {number} timeout - 超时时间（毫秒）
 */
async function selectFromVirtualList(selectElement, targetValue, timeout = 10000) {
    try {
        console.log('[搜狐号发布] 🔍 准备选择:', targetValue);

        // 1. 找到触发器并点击打开下拉
        const selectTrigger = selectElement.querySelector('i');
        if (!selectTrigger) {
            console.error('[搜狐号发布] ❌ 找不到 select 触发器');
            return false;
        }

        console.log('[搜狐号发布] ✅ 找到触发器，点击打开下拉列表');
        selectTrigger.click();

        // 等待下拉出现
        await window.delay(500);

        // 2. 查找虚拟列表容器（可能有多个位置）
        const startTime = Date.now();
        let virtualList = null;
        let options = [];

        while (Date.now() - startTime < timeout) {
            // 尝试多种选择器找虚拟列表
            virtualList = selectElement.querySelector('ul');

            if (virtualList) {
                // 查找所有可见的选项
                options = Array.from(virtualList.querySelectorAll('li'))
                    .filter(el => el.offsetParent !== null); // 过滤隐藏的元素

                if (options.length > 0) {
                    console.log('[搜狐号发布] ✅ 找到虚拟列表，有', options.length, '个选项');
                    break;
                }
            }

            await window.delay(100);
        }

        if (options.length === 0) {
            console.error('[搜狐号发布] ❌ 未找到任何选项');
            return false;
        }

        // 3. 虚拟列表只渲染可视区选项，需自动探测滚动容器、边滚动边查找
        const targetStr = String(targetValue).trim();

        // 探测真正可滚动的容器：优先 ul 自身，否则向上找带 overflow 的祖先
        const getScrollContainer = (ul) => {
            if (ul.scrollHeight - ul.clientHeight > 5) return ul;
            let p = ul.parentElement;
            for (let i = 0; i < 6 && p && p !== document.body; i++) {
                const oy = getComputedStyle(p).overflowY;
                if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight - p.clientHeight > 5) {
                    return p;
                }
                p = p.parentElement;
            }
            return ul; // 兜底
        };

        // 在当前已渲染的可见选项里按文本查找目标
        const findOption = () => {
            return Array.from(virtualList.querySelectorAll('li'))
                .filter(el => el.offsetParent !== null)
                .find(el => el.textContent.trim() === targetStr) || null;
        };

        const scroller = getScrollContainer(virtualList);
        let foundOption = findOption();

        // 没找到 → 从顶部开始逐屏向下滚动，边滚边重新读 DOM 查找
        if (!foundOption) {
            scroller.scrollTop = 0;
            await window.delay(120);
            foundOption = findOption();

            const step = Math.max(60, Math.floor(scroller.clientHeight * 0.8));
            let guard = 0;
            while (!foundOption && guard < 100) {
                const prevTop = scroller.scrollTop;
                scroller.scrollTop = prevTop + step;
                await window.delay(120); // 等虚拟列表重渲染
                foundOption = findOption();

                // scrollTop 不再变化说明已到底，最后再找一次后退出
                if (scroller.scrollTop === prevTop) {
                    foundOption = foundOption || findOption();
                    break;
                }
                guard++;
            }
        }

        if (!foundOption) {
            const visibleTexts = Array.from(virtualList.querySelectorAll('li'))
                .filter(el => el.offsetParent !== null)
                .map(o => o.textContent.trim()).join(', ');
            console.error('[搜狐号发布] ❌ 滚动到底仍未找到目标选项:', targetStr);
            console.log('[搜狐号发布] 📋 当前可见选项:', visibleTexts);

            // 弹窗提示用户选项不全，询问是否手动调整
            const userChoice = confirm(`[搜狐号发布] 找不到时间选项 "${targetStr}"\n\n下拉可能只提供了部分时间。当前可用选项：\n${visibleTexts}\n\n是否需要手动调整时间后重试？`);
            if (userChoice) {
                console.log('[搜狐号发布] ⏸️ 脚本已暂停，请手动调整时间');
                alert('[搜狐号发布] 请在下拉中手动选择可用的时间，然后点击"确定"让脚本继续。');
            }
            return false;
        }

        console.log('[搜狐号发布] ✅ 找到匹配的选项:', foundOption.textContent.trim());

        // 4. 滚动到视图并点击
        foundOption.scrollIntoView({ behavior: 'auto', block: 'nearest' });
        await window.delay(200);

        console.log('[搜狐号发布] 🖱️ 点击选项:', foundOption.textContent.trim());
        foundOption.click();

        // 等待下拉关闭
        await window.delay(300);

        console.log('[搜狐号发布] ✅ 选项选择完成');
        return true;

    } catch (error) {
        console.error('[搜狐号发布] ❌ selectFromVirtualList 错误:', error);
        return false;
    }
}

/**
 * 选择定时发布的日期和时间
 * @param {number} dateIndex - 日期索引（0=今天, 1=明天等）
 * @param {number} hour - 小时（0-23）
 * @param {number} minute - 分钟（0-59）
 */
async function selectScheduledTime(dateIndex, hour, minute) {
    try {
        // 1. 找到定时发布弹窗的三个 select 组件
        const modal = document.querySelector('.pushtimeout-dialog');
        if (!modal) {
            console.error('[搜狐号发布] ❌ 找不到定时发布弹窗');
            return false;
        }

        const selectElements = modal.querySelectorAll('.select');
        if (selectElements.length < 3) {
            console.error('[搜狐号发布] ❌ 找不到三个 select 组件，找到:', selectElements.length);
            return false;
        }

        const dateSelect = selectElements[0]; // 日期
        const hourSelect = selectElements[1]; // 小时
        const minuteSelect = selectElements[2]; // 分钟

        console.log('[搜狐号发布] 🔧 开始选择定时发布时间...');

        // 2. 获取日期选项的显示文本
        let dateText = '';
        const date = new Date();
        date.setDate(date.getDate() + dateIndex);

        // 格式：M月D日 或 MM月DD日
        const month = date.getMonth() + 1; // getMonth() 返回 0-11
        const day = date.getDate();
        dateText = `${month}月${day}日`;

        // 3. 依次选择日期、小时、分钟
        console.log('[搜狐号发布] 📅 选择日期:', dateText);
        if (!await selectFromVirtualList(dateSelect, dateText)) {
            return false;
        }

        await window.delay(300);

        const hourText = `${hour}`;
        console.log('[搜狐号发布] 🕐 选择小时:', hourText);
        if (!await selectFromVirtualList(hourSelect, hourText)) {
            return false;
        }

        await window.delay(300);

        const minuteText = `${minute}`;
        console.log('[搜狐号发布] ⏱️ 选择分钟:', minuteText);
        if (!await selectFromVirtualList(minuteSelect, minuteText)) {
            return false;
        }

        console.log('[搜狐号发布] ✅ 定时发布时间选择完成');
        return true;

    } catch (error) {
        console.error('[搜狐号发布] ❌ selectScheduledTime 错误:', error);
        return false;
    }
}
