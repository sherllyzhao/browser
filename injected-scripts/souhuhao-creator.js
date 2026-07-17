/**
 * 搜狐号创作者平台授权脚本
 * 用于处理授权流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

// 🔑 注意：授权脚本不应该设置 toPath
// 原因：授权流程需要用户停留在首页获取账号信息
// 如果设置 toPath 为发布页，会导致：
// - 登录成功后尝试跳转到发布页 → 需要短信验证 → 又跳回验证页 → 循环
// toPath 的设置应该只在发布脚本（souhuhao-publish.js）中进行

(async function () {
    'use strict';

    // ===========================
    // 🔑 检查 common.js 依赖并提供降级实现
    // ===========================
    if (typeof window.getRandomDelayMs !== "function") {
        console.warn("[搜狐号授权] ⚠️ common.js 未正确加载，使用降级实现");
        window.getRandomDelayMs = function (ms, jitterMs) {
            const baseMs = Number.isFinite(Number(ms)) ? Math.max(0, Math.floor(Number(ms))) : 0;
            const hasCustomJitter = jitterMs !== null && typeof jitterMs !== "undefined" && Number.isFinite(Number(jitterMs));
            const resolvedJitterMs = hasCustomJitter
                ? Math.max(0, Math.floor(Number(jitterMs)))
                : Math.max(80, Math.round(baseMs * 0.35));
            return baseMs + Math.floor(Math.random() * (resolvedJitterMs + 1));
        };
    }

    // 🔑 平台配置（在 IIFE 内部定义，避免与发布脚本冲突）
    const PLATFORM_CONFIG = {
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
    if (window.__SOUHUHAO_SCRIPT_LOADED__) {
        console.log('[搜狐号授权] ⚠️ 脚本已经加载过，跳过重复注入');
        return;
    }

    // ===========================
    // 页面状态检查 - 防止异常渲染
    // ===========================
    if (typeof window.checkPageStateAndReload === 'function') {
        if (!window.checkPageStateAndReload('搜狐号授权')) {
            return;
        }
    }

    window.__SOUHUHAO_SCRIPT_LOADED__ = true;

    // 显示操作提示横幅
    if (typeof showOperationBanner === 'function') {
        showOperationBanner('正在自动授权中，请勿操作此页面...');
    }

    console.log('═══════════════════════════════════════');
    console.log('✅ 搜狐号授权脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    // 检查 common.js 是否已加载
    if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
        console.error('[搜狐号授权] ❌ common.js 未加载！脚本可能无法正常工作');
    } else {
        console.log('[搜狐号授权] ✅ common.js 已加载，工具函数可用');
    }

    // ===========================
    // 1. 从 URL 获取授权数据
    // ===========================

    const urlParams = new URLSearchParams(window.location.search);
    const companyId = await window.browserAPI.getGlobalData('company_id');
    const transferId = urlParams.get('transfer_id');
    const authType = urlParams.get('auth_type') || 1;  // 从 URL 获取 auth_type，默认为 1

    console.log('[搜狐号授权] URL 参数:', {
        companyId,
        transferId,
        authType
    });

    // 存储授权数据到全局
    window.__AUTH_DATA__ = {
        companyId,
        transferId,
        timestamp: Date.now()
    };

    // ===========================
    // 2. 发送消息到父窗口的辅助函数（使用 common.js）
    // ===========================

    // ===========================
    // 3. 暴露全局方法供手动调用
    // ===========================

    window.__SOUHUHAO_AUTH__ = {
        // 发送授权成功消息
        notifySuccess: () => {
            sendMessageToParent('授权成功');
        },

        // 发送自定义消息
        sendMessage: (message) => {
            sendMessageToParent(message);
        },

        // 获取授权数据
        getAuthData: () => window.__AUTH_DATA__,
    };

    function parseMaybeJson(value) {
        if (typeof value !== 'string') {
            return value;
        }
        const trimmed = value.trim();
        if (!trimmed || !['{', '['].includes(trimmed[0])) {
            return value;
        }
        try {
            return JSON.parse(trimmed);
        } catch (_) {
            return value;
        }
    }

    function readNestedValue(source, path) {
        if (!source || !path) {
            return undefined;
        }
        return path.split('.').reduce((current, key) => {
            if (current === null || typeof current === 'undefined') {
                return undefined;
            }
            const parsedCurrent = parseMaybeJson(current);
            if (Array.isArray(parsedCurrent)) {
                return parsedCurrent.map(item => readNestedValue(item, key)).filter(value => typeof value !== 'undefined');
            }
            if (typeof parsedCurrent !== 'object') {
                return undefined;
            }
            return parsedCurrent[key];
        }, parseMaybeJson(source));
    }

    function normalizeBackendMediaAuthId(value) {
        const parsed = parseMaybeJson(value);
        if (Array.isArray(parsed) || parsed === null || typeof parsed === 'undefined' || typeof parsed === 'object') {
            return '';
        }
        return String(parsed).trim();
    }

    function normalizeSohuhaoIdentityText(value) {
        return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
    }

    function firstNonEmptyNestedValue(source, paths) {
        for (const path of paths) {
            const value = normalizeBackendMediaAuthId(readNestedValue(source, path));
            if (value) {
                return value;
            }
        }
        return '';
    }

    function getExpectedSohuhaoAuthIdentity(messageData) {
        const parsedMessageData = parseMaybeJson(messageData);
        return {
            name: firstNonEmptyNestedValue(parsedMessageData, [
                'element.account_name',
                'element.accountName',
                'element.nickname',
                'element.nickName',
                'element.name',
                // ⚠️ 不要加 'element.title'：发布数据里 title 是文章标题，不是账号名，
                // 会导致身份校验误判"账号不匹配"而阻止正常授权
                'element.account_info.account_name',
                'element.accountInfo.accountName',
                'element.account_info.nickname',
                'element.accountInfo.nickname',
                'element.account_info.nickName',
                'element.accountInfo.nickName',
                'element.account_info.name',
                'element.accountInfo.name',
                'element.account_info.title',
                'element.accountInfo.title',
                'account_info.account_name',
                'accountInfo.accountName',
                'account_info.nickname',
                'accountInfo.nickname',
                'account_info.nickName',
                'accountInfo.nickName',
                'account_info.name',
                'accountInfo.name',
                'media_auth.account_name',
                'mediaAuth.accountName',
                'media_auth.nickname',
                'mediaAuth.nickname',
                'media_auth.nickName',
                'mediaAuth.nickName',
                'media_auth.name',
                'mediaAuth.name'
            ]),
            platformUid: firstNonEmptyNestedValue(parsedMessageData, [
                'element.uid',
                'element.platformUid',
                'element.platform_uid',
                'element.account_info.uid',
                'element.accountInfo.uid',
                'element.account_info.platformUid',
                'element.accountInfo.platformUid',
                'element.account_info.platform_uid',
                'element.accountInfo.platform_uid',
                'element.media_auth.uid',
                'element.mediaAuth.uid',
                'element.media_auth.platformUid',
                'element.mediaAuth.platformUid',
                'uid',
                'platformUid',
                'platform_uid',
                'account_info.uid',
                'accountInfo.uid',
                'media_auth.uid',
                'mediaAuth.uid'
            ])
        };
    }

    function assertSohuhaoAuthAccountMatches(messageData, currentAccount) {
        const expected = getExpectedSohuhaoAuthIdentity(messageData);
        const actualName = currentAccount && (currentAccount.nickName || currentAccount.nickname || currentAccount.name || currentAccount.title)
            ? String(currentAccount.nickName || currentAccount.nickname || currentAccount.name || currentAccount.title)
            : '';
        const actualUid = currentAccount && currentAccount.id ? String(currentAccount.id) : '';
        const expectedName = normalizeSohuhaoIdentityText(expected.name);
        const normalizedActualName = normalizeSohuhaoIdentityText(actualName);
        const expectedUid = normalizeBackendMediaAuthId(expected.platformUid);
        const normalizedActualUid = normalizeBackendMediaAuthId(actualUid);
        const nameMismatch = !!expectedName && !!normalizedActualName && expectedName !== normalizedActualName;
        const uidMismatch = !!expectedUid && !!normalizedActualUid && expectedUid !== normalizedActualUid;

        if (!nameMismatch && !uidMismatch) {
            return { matched: true, expected, actual: { name: actualName, uid: actualUid } };
        }

        const message = `搜狐号授权账号不匹配：目标=${expected.name || expected.platformUid || '未知'}，当前=${actualName || actualUid || '未知'}。已停止保存登录态，请先切到正确搜狐账号后重新授权。`;
        console.error('[搜狐号授权] 🚫 当前登录账号与授权目标不一致，停止上报和 cookie 迁移:', {
            expected,
            actual: { name: actualName, uid: actualUid },
            nameMismatch,
            uidMismatch
        });
        try { alert(message); } catch (_) {}
        throw new Error(message);
    }
    function collectNormalizedNestedValues(source, paths) {
        const values = [];
        paths.forEach(path => {
            const value = normalizeBackendMediaAuthId(readNestedValue(source, path));
            if (value) {
                values.push(value);
            }
        });
        return values;
    }

    function resolveConditionalAccountInfoBackendId(source, accountInfoPaths) {
        const platformUidCandidates = collectNormalizedNestedValues(source, [
            'element.uid',
            'element.platformUid',
            'element.platform_uid',
            'element.account_info.uid',
            'element.accountInfo.uid',
            'element.account_info.platformUid',
            'element.accountInfo.platformUid',
            'element.account_info.platform_uid',
            'element.accountInfo.platform_uid',
            'element.media_auth.uid',
            'element.mediaAuth.uid',
            'element.media_auth.platformUid',
            'element.mediaAuth.platformUid',
            'uid',
            'platformUid',
            'platform_uid',
            'account_info.uid',
            'accountInfo.uid',
            'account_info.platformUid',
            'accountInfo.platformUid',
            'account_info.platform_uid',
            'accountInfo.platform_uid',
            'media_auth.uid',
            'mediaAuth.uid',
            'media_auth.platformUid',
            'mediaAuth.platformUid',
            'currentAccount.id'
        ]);

        for (const path of accountInfoPaths) {
            const id = normalizeBackendMediaAuthId(readNestedValue(source, path));
            if (id && (platformUidCandidates.length === 0 || !platformUidCandidates.includes(id))) {
                return { id, sourcePath: `${path}:conditional`, platformUidCandidates };
            }
        }

        return { id: '', sourcePath: '', platformUidCandidates };
    }

    function resolveBackendMediaAuthSessionId(messageData) {
        const parsedMessageData = parseMaybeJson(messageData);
        const trustedPaths = [
            'element.backend_account_id',
            'element.backendAccountId',
            'element.media_auth.id',
            'element.mediaAuth.id',
            'element.media_auth_id',
            'element.mediaAuthId',
            'media_auth.id',
            'mediaAuth.id',
            'media_auth_id',
            'mediaAuthId',
            'backend_account_id',
            'backendAccountId'
        ];

        for (const path of trustedPaths) {
            const id = normalizeBackendMediaAuthId(readNestedValue(parsedMessageData, path));
            if (id) {
                return { id, sourcePath: path };
            }
        }

        const conditionalAccountInfoId = resolveConditionalAccountInfoBackendId(parsedMessageData, [
            'element.account_info.id',
            'element.accountInfo.id',
            'account_info.id',
            'accountInfo.id'
        ]);
        if (conditionalAccountInfoId.id) {
            return conditionalAccountInfoId;
        }

        return {
            id: '',
            sourcePath: '',
            ignoredFallbacks: {
                accountInfoId: normalizeBackendMediaAuthId(readNestedValue(parsedMessageData, 'element.account_info.id') || readNestedValue(parsedMessageData, 'element.accountInfo.id') || readNestedValue(parsedMessageData, 'account_info.id') || readNestedValue(parsedMessageData, 'accountInfo.id')) || '无',
                platformUidCandidates: conditionalAccountInfoId.platformUidCandidates,
                elementId: normalizeBackendMediaAuthId(readNestedValue(parsedMessageData, 'element.id')) || '无',
                platformUid: normalizeBackendMediaAuthId(readNestedValue(parsedMessageData, 'currentAccount.id')) || '无'
            }
        };
    }

    async function relaunchAuthWindowInAccountSessionIfNeeded(messageData) {
        const backendMediaAuthSession = resolveBackendMediaAuthSessionId(messageData);
        if (!backendMediaAuthSession.id) {
            return { relaunched: false, reason: 'missing-backend-media-auth-id', backendMediaAuthSession };
        }

        if (!window.browserAPI?.getWindowContext || !window.browserAPI?.openNewWindow) {
            return { relaunched: false, reason: 'missing-browser-api', backendMediaAuthSession };
        }

        const context = await window.browserAPI.getWindowContext();
        const currentAccountId = normalizeBackendMediaAuthId(context?.accountId);
        if (context?.purpose === 'auth' && context?.platform === 'sohuhao' && currentAccountId === backendMediaAuthSession.id) {
            return { relaunched: false, reason: 'already-account-session', backendMediaAuthSession, context };
        }

        const currentUrl = window.location.href;
        console.warn('[搜狐号授权] 🔄 当前授权窗口未绑定目标账号 session，重新用账号独立 session 打开，避免共享搜狐登录态串号:', {
            backendMediaAuthId: backendMediaAuthSession.id,
            sourcePath: backendMediaAuthSession.sourcePath,
            context
        });

        if (window.browserAPI?.prepareSohuhaoAuthAccountSession) {
            try {
                const prepareResult = await window.browserAPI.prepareSohuhaoAuthAccountSession(backendMediaAuthSession.id, 'sohuhao-auth-relaunch-before-open');
                console.log('[搜狐号授权] 🔑 账号 session 重开前预热结果:', prepareResult);
            } catch (prepareError) {
                console.warn('[搜狐号授权] ⚠️ 账号 session 重开前预热失败，继续打开账号窗口:', prepareError.message);
            }
        }

        const openResult = await window.browserAPI.openNewWindow(currentUrl, {
            platform: 'sohuhao',
            accountId: backendMediaAuthSession.id,
            useTemporarySession: true,
            windowContext: {
                purpose: 'auth',
                platform: 'sohuhao',
                accountId: backendMediaAuthSession.id,
                expectedPageUrl: currentUrl,
                safeOrigin: window.location.origin,
                bootstrapUrl: `${window.location.origin}/`,
                guardResourceUrls: true
            }
        });

        if (!openResult?.success || !openResult.windowId) {
            return {
                relaunched: false,
                reason: 'open-account-session-window-failed',
                backendMediaAuthSession,
                error: openResult?.error || 'unknown'
            };
        }

        // 🔑 把授权数据持久化给新窗口：三次延时重发可能全部早于新窗口监听器注册
        // （新窗口加载慢/落在登录页需重新扫码时必然错过），导致 shinfo 上报被跳过。
        // 新窗口脚本注入时会读取此缓存自愈（见脚本尾部"待处理授权数据自愈"逻辑）
        try {
            await window.browserAPI.setGlobalData(
                `sohuhao_pending_auth_data_window_${openResult.windowId}`,
                typeof messageData === 'string' ? messageData : JSON.stringify(messageData)
            );
            console.log('[搜狐号授权] 📦 授权数据已缓存给新窗口:', openResult.windowId);
        } catch (persistErr) {
            console.warn('[搜狐号授权] ⚠️ 缓存授权数据给新窗口失败:', persistErr.message);
        }

        if (window.browserAPI.sendToOtherPage) {
            [3000, 6000, 9000].forEach(delayMs => {
                setTimeout(() => {
                    window.browserAPI.sendToOtherPage({
                        type: 'auth-data',
                        windowId: openResult.windowId,
                        data: messageData
                    });
                }, delayMs);
            });
        }

        setTimeout(() => {
            if (window.browserAPI?.closeCurrentWindow) {
                window.browserAPI.closeCurrentWindow();
            }
        }, 10000);

        return { relaunched: true, reason: 'opened-account-session-window', backendMediaAuthSession, windowId: openResult.windowId };
    }

    // ===========================
    // 4. 显示调试信息横幅
    // ===========================

    // ===========================
    // 5. 接收来自父窗口的消息（必须在发送 页面加载完成 之前注册！）
    // ===========================
    console.log('[搜狐号授权] 注册消息监听器...');

    // 防重复标志：确保数据只处理一次
    let isProcessing = false;
    let hasProcessed = false;


    if (!window.browserAPI) {
        console.error('[搜狐号授权] ❌ browserAPI 不可用！');
    } else {
        console.log('[搜狐号授权] ✅ browserAPI 可用');

        if (!window.browserAPI.onMessageFromHome) {
            console.error('[搜狐号授权] ❌ browserAPI.onMessageFromHome 不可用！');
        } else {
            console.log('[搜狐号授权] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

            window.browserAPI.onMessageFromHome(async (message) => {
                try {
                    console.log('═══════════════════════════════════════');
                    console.log('[搜狐号授权] 🎉 收到来自父窗口的消息!');
                    console.log('[搜狐号授权] 消息类型:', typeof message);
                    console.log('[搜狐号授权] 消息内容:', message);
                    console.log('[搜狐号授权] 消息.type:', message?.type);
                    console.log('[搜狐号授权] 消息.data:', message?.data);
                    console.log('═══════════════════════════════════════');

                    // 接收完整的授权数据
                    if (message.type === 'auth-data') {
                        console.log('[搜狐号授权] ✅ 收到授权数据:', message.data);

                        // 🔑 强制检查 windowId（必须匹配，否则立即返回）
                        const myWindowId = await window.browserAPI.getWindowId();
                        console.log('[搜狐号授权] 我的窗口 ID:', myWindowId, '消息目标窗口 ID:', message.windowId);

                        if (!message.windowId) {
                          console.error('[搜狐号授权] ❌ 收到的 auth-data 消息缺少 windowId，这不应该发生！已拒绝处理');
                          return;
                        }

                        if (myWindowId !== message.windowId) {
                          console.warn('[搜狐号授权] ⚠️ 消息不是发给我的（我是 ' + myWindowId + '，消息发给 ' + message.windowId + '），拒绝处理');
                          return;
                        }

                        console.log('[搜狐号授权] ✅ windowId 匹配，安全处理消息');

                        // 防重复检查
                        if (isProcessing) {
                            console.warn('[搜狐号授权] ⚠️ 正在处理中，忽略重复消息');
                            return;
                        }
                        if (hasProcessed) {
                            console.warn('[搜狐号授权] ⚠️ 已经处理过，忽略重复消息');
                            return;
                        }

                        // 标记为正在处理
                        isProcessing = true;

                        // 更新全局变量
                        if (message.data) {
                            const messageData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
                            await processSohuhaoAuthData(messageData);
                        }

                        // 重置处理标志（无论成功或失败）
                        isProcessing = false;
                        console.log('[搜狐号授权] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
                    }
                } catch (error) {
                    console.error('[搜狐号授权] ❌ 消息处理出错:', error);
                    isProcessing = false;
                }
            });

            console.log('[搜狐号授权] ✅ 消息监听器注册成功');
        }
    }

    // ===========================
    // 5.5 授权数据处理主流程（消息路径与"待处理授权数据自愈"路径共用）
    // 读写外层闭包的 isProcessing / hasProcessed 标志
    // ===========================
    async function processSohuhaoAuthData(messageData) {
                            window.__AUTH_DATA__ = {
                                ...window.__AUTH_DATA__,
                                message: messageData,
                                receivedAt: Date.now()
                            };
                            console.log('[搜狐号授权] ✅ 授权数据已更新:', window.__AUTH_DATA__);

                            const accountSessionRelaunch = await relaunchAuthWindowInAccountSessionIfNeeded(messageData);
                            console.log('[搜狐号授权] 账号 session 授权窗口检查结果:', accountSessionRelaunch);
                            if (accountSessionRelaunch.relaunched) {
                                hasProcessed = true;
                                isProcessing = false;
                                return;
                            }

                            const currentAccount = localStorage.getItem('currentAccount') ? JSON.parse(localStorage.getItem('currentAccount')) : null;

                            // 🔑 未登录（如 relaunch 后新窗口落在登录页）：缓存授权数据后退出，
                            // 等用户登录、页面跳转脚本重新注入时由"自愈"逻辑自动继续上报。
                            // 此前会带着 null 硬闯后续流程（TypeError 被外层 catch 吞掉），shinfo 静默丢失
                            if (!currentAccount) {
                                try {
                                    const myWindowId = await window.browserAPI.getWindowId();
                                    if (myWindowId && window.browserAPI.setGlobalData) {
                                        await window.browserAPI.setGlobalData(
                                            `sohuhao_pending_auth_data_window_${myWindowId}`,
                                            typeof messageData === 'string' ? messageData : JSON.stringify(messageData)
                                        );
                                    }
                                    console.warn('[搜狐号授权] ⚠️ 当前未登录，已缓存授权数据，登录后将自动继续上报 shinfo');
                                } catch (cacheErr) {
                                    console.warn('[搜狐号授权] ⚠️ 缓存待处理授权数据失败:', cacheErr.message);
                                }
                                isProcessing = false;
                                return;
                            }

                            let authIdentityCheck = null;
                            try {
                                authIdentityCheck = assertSohuhaoAuthAccountMatches(messageData, currentAccount);
                            } catch (identityError) {
                                const backendMediaAuthSession = resolveBackendMediaAuthSessionId(messageData);
                                if (backendMediaAuthSession.id && window.browserAPI?.clearAccountAuthSession) {
                                    try {
                                        const cleanupResult = await window.browserAPI.clearAccountAuthSession('sohuhao', backendMediaAuthSession.id, 'sohuhao-auth-account-mismatch');
                                        console.warn('[搜狐号授权] 🧹 已清理账号不匹配的目标 session/cache:', cleanupResult);
                                    } catch (cleanupError) {
                                        console.warn('[搜狐号授权] ⚠️ 清理账号不匹配 session/cache 失败:', cleanupError.message);
                                    }
                                }
                                throw identityError;
                            }
                            console.log('[搜狐号授权] ✅ 当前登录账号与授权目标校验通过:', authIdentityCheck);

                            // 🔑 获取完整会话数据（Cookies + Storage + IndexedDB）
                            console.log('[搜狐号授权] 📦 正在获取完整会话数据...');
                            let cookiesData = '';
                            try {
                                const sessionResult = await window.browserAPI.getFullSessionData('mp.sohu.com');
                                if (sessionResult.success) {
                                    console.log("🚀 ~  ~ sessionResult.data: ", sessionResult.data);

                                    // 🔑 追加 sohu.com 全域 cookies（含 passport.sohu.com 等子域）
                                    // mp.sohu.com 的域过滤会漏掉 passport 子域的续签凭证，导致隔天 ppmdig 失效后
                                    // 静默续签无凭证可用而掉登录。这里只合并去重新增 cookie，原结构不变
                                    try {
                                        const fullDomainResult = await window.browserAPI.getFullSessionData('sohu.com');
                                        if (fullDomainResult.success && fullDomainResult.data && Array.isArray(fullDomainResult.data.cookies)) {
                                            // 防御：data.cookies 缺失时补成空数组，保证 push 不抛错（合并仍能生效）
                                            sessionResult.data.cookies = sessionResult.data.cookies || [];
                                            const cookieKey = (c) => [c.name, c.domain, c.path || '/', c.secure ? '1' : '0'].join('|');
                                            const seen = new Set(sessionResult.data.cookies.map(cookieKey));
                                            let addedCount = 0;
                                            for (const c of fullDomainResult.data.cookies) {
                                                const k = cookieKey(c);
                                                if (!seen.has(k)) {
                                                    seen.add(k);
                                                    sessionResult.data.cookies.push(c);
                                                    addedCount++;
                                                }
                                            }
                                            console.log(`[搜狐号授权] ✅ 已合并 sohu.com 全域 cookies，新增 ${addedCount} 个（含 passport 子域）`);
                                        } else {
                                            console.warn('[搜狐号授权] ⚠️ 获取 sohu.com 全域 cookies 失败:', fullDomainResult && fullDomainResult.error);
                                        }
                                    } catch (mergeErr) {
                                        console.warn('[搜狐号授权] ⚠️ 合并 sohu.com 全域 cookies 异常:', mergeErr && mergeErr.message);
                                    }

                                    cookiesData = JSON.stringify(sessionResult.data);
                                    console.log(`[搜狐号授权] ✅ 会话数据获取成功，大小: ${Math.round(sessionResult.size / 1024)} KB`);
                                } else {
                                    console.warn('[搜狐号授权] ⚠️ 获取完整会话数据失败:', sessionResult.error);
                                    // 降级为简单 cookie 字符串
                                    const cookieResult = await window.browserAPI.getDomainCookies('https://mp.sohu.com/mpfe/v4/contentManagement/first/page');
                                    if (cookieResult.success && cookieResult.cookies) {
                                        cookiesData = cookieResult.cookies;
                                    }
                                }
                            } catch (sessionError) {
                                console.error('[搜狐号授权] ⚠️ 获取会话数据异常:', sessionError);
                                cookiesData = document.cookie;
                            }

                            /* const statisticsResult = await fetch(`https://mp.sohu.com/mpbp/bp/news/v4/users/newsInfo?accountId=${currentAccount.id}&_=${Date.now() + 1200}`, {
                                method: 'GET',
                                credentials: 'include',  // 自动携带 Cookie
                            });
                            console.log("🚀 ~  ~ statisticsResult: ", statisticsResult);

                            if (!statisticsResult.ok) {
                                throw new Error(`HTTP error! status: ${statisticsResult.status}`);
                            }

                            const statisticsRes = await statisticsResult.json();
                            console.log("🚀 ~  ~ statisticsRes: ", statisticsRes);
                            const statisticsData = statisticsRes.data;
                            console.log("🚀 ~  ~ statisticsData: ", statisticsData); */

                            // 🔑 作品数元素获取降级：拿不到不阻断 shinfo 上报
                            // （此前 waitForElement 超时会 throw 被外层 catch 吞掉，
                            // 造成"授权成功但后台没保存 cookies"的间歇性问题）
                            let videoCount = 0;
                            try {
                                await delay(1000);
                                const eleClass = await waitForElement('.read-info-info-item:nth-of-type(2) .number-icon', 15000);
                                console.log("🚀 ~  ~ eleClass: ", eleClass);
                                const eleClassList = eleClass.classList;
                                eleClassList.forEach(item => {
                                    if (item.startsWith('mp-iconnumber_')) {
                                        videoCount = parseInt(item.replace('mp-iconnumber_', ''));
                                    }
                                });
                            } catch (videoCountError) {
                                console.warn('[搜狐号授权] ⚠️ 获取作品数元素失败，作品数按 0 上报:', videoCountError && videoCountError.message);
                            }

                            const scanData = {
                                data: JSON.stringify({
                                    nickname: currentAccount.nickName,
                                    avatar: currentAccount.avatar,
                                    follow: 0,
                                    follower_count: 0, //粉丝
                                    video: videoCount, // 作品数
                                    uid: currentAccount.id,
                                    favoriting_count: 0, // 收藏数
                                    total_favorited: 0, // 总收藏数
                                    company_id: companyId,
                                    auth_type: messageData.auth_type,
                                    cookies: cookiesData
                                })
                            };
                            console.log(JSON.stringify(cookiesData));
                            console.log("🚀 ~  ~ scanData: ", scanData);
                            //return;

                            console.log('[搜狐号授权] 📤 准备发送数据到接口...');
                            // 发送数据到服务器（根据环境选择域名）
                            const apiDomain = await getApiDomain();
                            console.log('[搜狐号授权] 📡 API 地址:', `${apiDomain}/api/mediaauth/shinfo`);
                            const apiResponse = await fetch(`${apiDomain}/api/mediaauth/shinfo`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(scanData)
                            });

                            // 读取响应体（先 text 再尝试 JSON，便于 alert 完整 dump）
                            const apiResponseText = await apiResponse.text();
                            let apiResult = null;
                            try { apiResult = JSON.parse(apiResponseText); } catch (_) {}

                            // 🔔 调试日志（与发布窗口关闭时的日志字段对齐，便于对比）
                            try {
                                const cookiesSizeKB = Math.round((cookiesData ? cookiesData.length : 0) / 1024);
                                const okFlag = apiResponse.ok && apiResult && apiResult.code === 200;
                                const debugMsg = okFlag
                                    ? `✅ 授权保存成功（搜狐号）\n窗口: 授权窗口\n平台: sohuhao\n后台账号ID(uid): ${currentAccount?.id || '无'}\n账号昵称: ${currentAccount?.nickName || '未知'}\nCookies 数据大小: ${cookiesSizeKB} KB\nHTTP 状态: ${apiResponse.status}\n接口 code: ${apiResult?.code}`
                                    : `❌ 授权保存失败（搜狐号）\n窗口: 授权窗口\n平台: sohuhao\n后台账号ID(uid): ${currentAccount?.id || '无'}\n账号昵称: ${currentAccount?.nickName || '未知'}\nCookies 数据大小: ${cookiesSizeKB} KB\nHTTP 状态: ${apiResponse.status}\n接口 code: ${apiResult?.code ?? '-'}\n响应: ${apiResponseText.slice(0, 200)}`;
                                console[okFlag ? 'log' : 'warn'](debugMsg);
                            } catch (logErr) {
                                console.warn('[搜狐号授权] ⚠️ 输出调试日志失败:', logErr.message);
                            }

                            // 检查响应状态
                            if (!apiResponse.ok) {
                                throw new Error(`Statistics API failed with status: ${apiResponse.status}`);
                            }
                            if (!apiResult) {
                                throw new Error('授权接口响应不是 JSON: ' + apiResponseText.slice(0, 100));
                            }

                            console.log('[搜狐号授权] 📥 接口响应:', apiResult);

                            if (apiResult && 'code' in apiResult && apiResult.code === 200) {
                                console.log('[搜狐号授权] ✅ 数据发送成功');

                                // 标记已完成（防止重复发送）
                                hasProcessed = true;

                                // 🔑 清理自愈缓存，避免下次页面注入重复上报
                                try {
                                    const myWindowId = await window.browserAPI.getWindowId();
                                    if (myWindowId && window.browserAPI.removeGlobalData) {
                                        await window.browserAPI.removeGlobalData(`sohuhao_pending_auth_data_window_${myWindowId}`);
                                    }
                                } catch (_) {}

                                // 🔑 迁移登录 Cookies 到持久化 session
                                // 因为授权窗口使用临时 session，需要把登录状态复制到持久化 session
                                // 这样发布时才能用新授权的账号
                                try {
                                    console.log('[搜狐号授权] 🔄 开始迁移 Cookies 到持久化 session...');
                                    const migrateResult = await window.browserAPI.migrateCookiesToPersistent('mp.sohu.com');
                                    if (migrateResult.success) {
                                        console.log(`[搜狐号授权] ✅ Cookies 迁移成功，共迁移 ${migrateResult.migratedCount} 个`);
                                    } else {
                                        console.error('[搜狐号授权] ⚠️ Cookies 迁移失败:', migrateResult.error);
                                    }
                                    // 🔑 追加迁移 sohu.com 全域（含 passport.sohu.com 等子域的续签凭证）
                                    // 与上面快照采集的口径一致，避免持久化 session 缺 passport 子域 cookie
                                    const migrateFullResult = await window.browserAPI.migrateCookiesToPersistent('sohu.com');
                                    if (migrateFullResult.success) {
                                        console.log(`[搜狐号授权] ✅ sohu.com 全域 Cookies 迁移成功，共迁移 ${migrateFullResult.migratedCount} 个`);
                                    } else {
                                        console.error('[搜狐号授权] ⚠️ sohu.com 全域 Cookies 迁移失败:', migrateFullResult.error);
                                    }

                                    // 🔑 多账号发布窗口使用 persist:sohuhao_<后台授权记录ID> 独立 session。
                                    // 这里只能写入父页面明确传入的后台记录 ID，不能使用 currentAccount.id（搜狐平台 uid）
                                    // 或接口响应里的泛化 id，否则会把当前登录 cookie 写进其他账号分区。
                                    const backendMediaAuthSession = resolveBackendMediaAuthSessionId(messageData);
                                    console.log('[搜狐号授权] 账号 session 目标:', {
                                        backendMediaAuthId: backendMediaAuthSession.id || '无',
                                        sourcePath: backendMediaAuthSession.sourcePath || '无',
                                        ignoredFallbacks: backendMediaAuthSession.ignoredFallbacks || null,
                                        platformUid: currentAccount?.id || '无',
                                        nickname: currentAccount?.nickName || '未知'
                                    });
                                    if (backendMediaAuthSession.id && window.browserAPI.migrateCookiesToAccountSession) {
                                        const migrateAccountMpResult = await window.browserAPI.migrateCookiesToAccountSession('mp.sohu.com', 'sohuhao', backendMediaAuthSession.id);
                                        if (migrateAccountMpResult.success) {
                                            console.log(`[搜狐号授权] ✅ mp.sohu.com Cookies 已迁移到账号 session: ${backendMediaAuthSession.id}, 共 ${migrateAccountMpResult.migratedCount} 个`);
                                        } else {
                                            console.error(`[搜狐号授权] ⚠️ mp.sohu.com Cookies 迁移到账号 session 失败: ${backendMediaAuthSession.id}`, migrateAccountMpResult.error);
                                        }

                                        const migrateAccountFullResult = await window.browserAPI.migrateCookiesToAccountSession('sohu.com', 'sohuhao', backendMediaAuthSession.id);
                                        if (migrateAccountFullResult.success) {
                                            console.log(`[搜狐号授权] ✅ sohu.com 全域 Cookies 已迁移到账号 session: ${backendMediaAuthSession.id}, 共 ${migrateAccountFullResult.migratedCount} 个`);
                                        } else {
                                            console.error(`[搜狐号授权] ⚠️ sohu.com 全域 Cookies 迁移到账号 session 失败: ${backendMediaAuthSession.id}`, migrateAccountFullResult.error);
                                        }
                                    } else {
                                        console.warn('[搜狐号授权] ⚠️ 无法迁移到账号 session：缺少父页面传入的后台授权记录ID或 migrateCookiesToAccountSession', {
                                            hasMigrateApi: !!window.browserAPI.migrateCookiesToAccountSession,
                                            platformUid: currentAccount?.id || '无'
                                        });
                                    }
                                } catch (migrateError) {
                                    console.error('[搜狐号授权] ⚠️ Cookies 迁移异常:', migrateError);
                                }

                                // API 成功后通知父页面刷新
                                sendMessageToParent('授权成功，刷新数据');

                                // 开发模式下不关闭窗口（browserAPI.isProduction 为 false 时是开发环境）
                                const isDev = window.browserAPI && window.browserAPI.isProduction === false;
                                if (isDev) {
                                    console.log('[发布成功] 🔧 开发模式：跳过关闭窗口，可查看控制台');
                                    return;
                                }else{
                                    // 统计接口成功后关闭弹窗
                                    setTimeout(() => {
                                        window.browserAPI.closeCurrentWindow();
                                    }, window.getRandomDelayMs(10000));
                                }
                            } else {
                                throw new Error(apiResult.msg || apiResult.message || '上报数据失败');
                            }
    }

    // 自动执行授权流程

    // ===========================
    // 6. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
    // ===========================

    // 页面加载完成后向父窗口发送消息
    console.log('[搜狐号授权] 页面加载完成，发送 页面加载完成 消息');
    sendMessageToParent('页面加载完成');

    // ===========================
    // 6.5 待处理授权数据自愈
    // 场景：relaunch 新窗口错过三次 auth-data 重发、或收到消息时尚未登录。
    // 授权数据已缓存在 globalData，本次注入若已登录则自动继续 shinfo 上报。
    // ===========================
    (async () => {
        const nativeDelay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        try {
            if (!window.browserAPI?.getWindowId || !window.browserAPI?.getGlobalData) return;
            const myWindowId = await window.browserAPI.getWindowId();
            if (!myWindowId || myWindowId === 'main') return;
            const pendingKey = `sohuhao_pending_auth_data_window_${myWindowId}`;
            const pendingRaw = await window.browserAPI.getGlobalData(pendingKey);
            if (!pendingRaw) return;

            // currentAccount 由页面框架异步写入，轮询等待最多 20 秒
            let waitedMs = 0;
            while (!localStorage.getItem('currentAccount') && waitedMs < 20000) {
                await nativeDelay(1000);
                waitedMs += 1000;
            }
            if (!localStorage.getItem('currentAccount')) {
                console.log('[搜狐号授权] ⏳ 检测到待处理授权数据但尚未登录，等待登录后页面跳转自动继续');
                return;
            }
            if (isProcessing || hasProcessed) return;

            console.log('[搜狐号授权] 🔁 检测到待处理授权数据且已登录，自动继续授权上报 shinfo');
            isProcessing = true;
            let pendingData = pendingRaw;
            if (typeof pendingRaw === 'string') {
                try { pendingData = JSON.parse(pendingRaw); } catch (_) { pendingData = pendingRaw; }
            }
            await processSohuhaoAuthData(pendingData);
            isProcessing = false;
            console.log('[搜狐号授权] 🔁 自愈处理完成, hasProcessed=', hasProcessed);
        } catch (pendingErr) {
            isProcessing = false;
            console.error('[搜狐号授权] ❌ 待处理授权数据自愈失败:', pendingErr);
        }
    })();

    // ===========================
    // 6.6 登录页守望
    // 场景：授权窗口落在登录页时本脚本已注入并置 __SOUHUHAO_SCRIPT_LOADED__；
    // 用户登录后搜狐走 SPA 路由跳到 firstPage，脚本重注入会被防重标志挡住，
    // 授权流程卡在「等待登录后页面跳转自动继续」，只能手动刷新。
    // 这里检测到进入业务页后 reload 一次，让脚本干净地重新注入继续授权
    // （授权数据缓存在 globalData，不受刷新影响）。
    // 用业务页白名单而非「离开登录页」做条件，避免短信验证等登录中间页误触发刷新。
    // 整页跳转场景下本 window 连同定时器一起销毁，不会产生副作用。
    // ===========================
    (function watchAuthLoginRecovery() {
        const isOnSohuLoginPage = () => {
            try {
                const url = new URL(window.location.href);
                return url.hostname === 'mp.sohu.com' && url.pathname.includes('/mpfe/v4/login');
            } catch (_) {
                return String(window.location.href || '').includes('/mpfe/v4/login');
            }
        };
        const isOnSohuBusinessPage = () => {
            try {
                const url = new URL(window.location.href);
                return url.hostname === 'mp.sohu.com' && url.pathname.startsWith('/mpfe/v4/contentManagement');
            } catch (_) {
                return false;
            }
        };

        if (!isOnSohuLoginPage()) {
            return; // 只在授权窗口停在登录页时才需要守望
        }
        if (window.__sohuAuthLoginRecoveryWatcher__) {
            return;
        }
        console.log('[搜狐号授权] 👀 当前在登录页，开始监听登录完成，进入业务页后将自动刷新继续授权');
        window.__sohuAuthLoginRecoveryWatcher__ = setInterval(() => {
            if (isOnSohuBusinessPage()) {
                clearInterval(window.__sohuAuthLoginRecoveryWatcher__);
                window.__sohuAuthLoginRecoveryWatcher__ = null;
                console.log('[搜狐号授权] 🔄 检测到已登录并进入业务页（SPA 跳转），刷新页面让授权脚本重新注入');
                window.location.reload();
            }
        }, 1000);
    })();

    console.log('═══════════════════════════════════════');
    console.log('✅ 搜狐号授权脚本初始化完成');
    console.log('📝 全局方法: window.__SOUHUHAO_AUTH__');
    console.log('  - notifySuccess()  : 发送授权成功消息');
    console.log('  - sendMessage(msg) : 发送自定义消息');
    console.log('  - getAuthData()    : 获取授权数据');
    console.log('═══════════════════════════════════════');

})();

