/**
 * 腾讯号创作者平台授权脚本
 * 用于处理授权流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
    'use strict';

    // ===========================
    // 🔑 检查 common.js 依赖并提供降级实现
    // ===========================
    if (typeof window.getRandomDelayMs !== "function") {
        console.warn("[腾讯号授权] ⚠️ common.js 未正确加载，使用降级实现");
        window.getRandomDelayMs = function (ms, jitterMs) {
            const baseMs = Number.isFinite(Number(ms)) ? Math.max(0, Math.floor(Number(ms))) : 0;
            const hasCustomJitter = jitterMs !== null && typeof jitterMs !== "undefined" && Number.isFinite(Number(jitterMs));
            const resolvedJitterMs = hasCustomJitter
                ? Math.max(0, Math.floor(Number(jitterMs)))
                : Math.max(80, Math.round(baseMs * 0.35));
            return baseMs + Math.floor(Math.random() * (resolvedJitterMs + 1));
        };
    }

    const TENGXVNHAO_SESSION_DOMAINS = ['qq.com', 'om.qq.com', 'image.om.qq.com', 'aqq.qq.com', 'account.qq.com', 'ptlogin2.qq.com'];

    const getPublishWindowData = async () => {
        try {
            if (!window.browserAPI?.getWindowId || !window.browserAPI?.getGlobalData) {
                return null;
            }
            const windowId = await window.browserAPI.getWindowId();
            if (!windowId) {
                return null;
            }
            return await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
        } catch (err) {
            console.warn('[腾讯号授权] ⚠️ 读取窗口发布数据失败:', err);
            return null;
        }
    };

    // ===========================
    // 防止脚本重复注入
    // ===========================
    if (window.__TENGXVNHAO_SCRIPT_LOADED__) {
        console.log('[腾讯号授权] ⚠️ 脚本已经加载过，跳过重复注入');
        return;
    }

    // ===========================
    // 页面状态检查 - 防止异常渲染
    // ===========================
    if (typeof window.checkPageStateAndReload === 'function') {
        if (!window.checkPageStateAndReload('腾讯号授权')) {
            return;
        }
    }

    window.__TENGXVNHAO_SCRIPT_LOADED__ = true;

    // 显示操作提示横幅
    if (typeof showOperationBanner === 'function') {
        showOperationBanner('正在自动授权中，请勿操作此页面...');
    }
    console.log('加了恢复数据的')

    console.log('═══════════════════════════════════════');
    console.log('✅ 腾讯号授权脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    // 检查 common.js 是否已加载
    if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
        console.error('[腾讯号授权] ❌ common.js 未加载！脚本可能无法正常工作');
    } else {
        console.log('[腾讯号授权] ✅ common.js 已加载，工具函数可用');
    }

    // ===========================
    // 1. 从 URL 获取授权数据
    // ===========================

    const urlParams = new URLSearchParams(window.location.search);
    const companyId = await window.browserAPI.getGlobalData('company_id');
    const transferId = urlParams.get('transfer_id');
    const authType = urlParams.get('auth_type') || 1;  // 从 URL 获取 auth_type，默认为 1

    console.log('[腾讯号授权] URL 参数:', {
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
    let cachedPublishWindowData = await getPublishWindowData();
    if (cachedPublishWindowData) {
        console.log('[腾讯号授权] 📦 已缓存发布窗口数据，后续将用于回写账号 session');
    }

    // ===========================
    // 2. 发送消息到父窗口的辅助函数（使用 common.js）
    // ===========================

    // ===========================
    // 3. 暴露全局方法供手动调用
    // ===========================

    window.__TENGXVNHAO_AUTH__ = {
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

    // ===========================
    // 4. 显示调试信息横幅
    // ===========================

    // ===========================
    // 5. 接收来自父窗口的消息（必须在发送 页面加载完成 之前注册！）
    // ===========================
    console.log('[腾讯号授权] 注册消息监听器...');

    // 防重复标志：确保数据只处理一次
    let isProcessing = false;
    let hasProcessed = false;

    // 窗口类型判定：子窗口一律授权（管他从哪进来的），主窗口浏览不触发
    // 授权窗口标志仅用于决定"授权完成后是否自动关窗"
    let isChildWindow = false;
    let isAuthModeWindow = false;
    let hasPublishData = false;
    try {
        const detectedWindowId = await window.browserAPI?.getWindowId();
        isChildWindow = typeof detectedWindowId === 'number';
        if (isChildWindow) {
            isAuthModeWindow = !!(await window.browserAPI.getGlobalData(`auth_mode_window_${detectedWindowId}`));
            // 发布窗口不触发授权兜底（避免发布中途上报+通知父页面刷新干扰发布流程）
            hasPublishData = !!(await window.browserAPI.getGlobalData(`publish_data_window_${detectedWindowId}`));
        }
        console.log('[腾讯号授权] 窗口 ID:', detectedWindowId, '子窗口:', isChildWindow, '授权窗口标志:', isAuthModeWindow, '发布窗口:', hasPublishData);
    } catch (e) {
        console.warn('[腾讯号授权] ⚠️ 读取窗口信息失败:', e.message);
    }

    if (!window.browserAPI) {
        console.error('[腾讯号授权] ❌ browserAPI 不可用！');
    } else {
        console.log('[腾讯号授权] ✅ browserAPI 可用');

        if (!window.browserAPI.onMessageFromHome) {
            console.error('[腾讯号授权] ❌ browserAPI.onMessageFromHome 不可用！');
        } else {
            console.log('[腾讯号授权] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

            // ===========================
            // 核心授权流程（消息模式与兜底模式共用；接口优先获取用户信息）
            // ===========================
            async function processAuthorization(messageData) {
                if (isProcessing) {
                    console.warn('[腾讯号授权] ⚠️ 正在处理中，忽略重复调用');
                    return;
                }
                if (hasProcessed) {
                    console.warn('[腾讯号授权] ⚠️ 已经处理过，忽略重复调用');
                    return;
                }
                isProcessing = true;
                try {
                            const response = await fetch('https://om.qq.com/mindex/homeInfo?app=all&relogin=1', {
                                method: 'GET',
                                credentials: 'include',  // 自动携带 Cookie
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                            });

                            if (!response.ok) {
                                throw new Error(`HTTP error! status: ${response.status}`);
                            }

                            const result = await response.json();
                            console.log("🚀 ~  ~ result: ", result);
                            if(result.data){
                                const {data} = result;

                                if (!data) {
                                    throw new Error('User data not found in response');
                                }

                                // 🔑 获取完整会话数据（Cookies + Storage + IndexedDB）
                                console.log('[腾讯号授权] 📦 正在获取完整会话数据...');
                                let cookiesData = '';
                                try {
                                    const sessionResults = await Promise.all(
                                        TENGXVNHAO_SESSION_DOMAINS.map(domain => window.browserAPI.getFullSessionData(domain).catch(err => {
                                            console.warn(`[腾讯号授权] ⚠️ 获取 ${domain} 会话数据失败:`, err);
                                            return { success: false, domain };
                                        }))
                                    );

                                    const mergedData = {
                                        domains: TENGXVNHAO_SESSION_DOMAINS,
                                        timestamp: Date.now(),
                                        cookies: [],
                                        localStorage: {},
                                        sessionStorage: {},
                                        indexedDB: {}
                                    };
                                    const seenCookieKeys = new Set();
                                    let totalSize = 0;

                                    sessionResults.forEach((sessionResult, index) => {
                                        const domain = TENGXVNHAO_SESSION_DOMAINS[index];
                                        if (!sessionResult.success || !sessionResult.data) {
                                            return;
                                        }

                                        console.log(`[腾讯号授权] ✅ ${domain} 会话数据获取成功，大小: ${Math.round((sessionResult.size || 0) / 1024)} KB`);
                                        totalSize += sessionResult.size || 0;

                                        if (Array.isArray(sessionResult.data.cookies)) {
                                            sessionResult.data.cookies.forEach(cookie => {
                                                const dedupeKey = [
                                                    cookie.name,
                                                    cookie.domain,
                                                    cookie.path || '/',
                                                    cookie.secure ? '1' : '0'
                                                ].join('|');
                                                if (!seenCookieKeys.has(dedupeKey)) {
                                                    seenCookieKeys.add(dedupeKey);
                                                    mergedData.cookies.push(cookie);
                                                }
                                            });
                                        }
                                        if (sessionResult.data.localStorage && Object.keys(sessionResult.data.localStorage).length > 0) {
                                            mergedData.localStorage[domain] = sessionResult.data.localStorage;
                                        }
                                        if (sessionResult.data.sessionStorage && Object.keys(sessionResult.data.sessionStorage).length > 0) {
                                            mergedData.sessionStorage[domain] = sessionResult.data.sessionStorage;
                                        }
                                        if (sessionResult.data.indexedDB && Object.keys(sessionResult.data.indexedDB).length > 0) {
                                            mergedData.indexedDB[domain] = sessionResult.data.indexedDB;
                                        }
                                    });

                                    if (mergedData.cookies.length > 0) {
                                        cookiesData = JSON.stringify(mergedData);
                                        console.log(`[腾讯号授权] ✅ 多域名会话数据获取成功，共 ${mergedData.cookies.length} 个 cookies，总大小: ${Math.round(totalSize / 1024)} KB`);
                                    } else {
                                        console.warn('[腾讯号授权] ⚠️ 未获取到有效会话数据，回退为简单 cookie 字符串');
                                        const cookieResult = await window.browserAPI.getDomainCookies('qq.com');
                                        if (cookieResult.success && cookieResult.cookies) {
                                            cookiesData = cookieResult.cookies;
                                        }
                                    }
                                } catch (sessionError) {
                                    console.error('[腾讯号授权] ⚠️ 获取会话数据异常:', sessionError);
                                    cookiesData = document.cookie;
                                }

                                const userInfoResult = await fetch('https://om.qq.com/maccountsetting/basicinfo/?relogin=1', {
                                    method: 'GET',
                                    credentials: 'include'
                                })
                                const userInfoRes = await userInfoResult.json();
                                console.log("🚀 ~  ~ userInfoRes: ", userInfoRes);
                                if(userInfoRes.data && userInfoRes.data.cpInfo){
                                    const userInfo = userInfoRes.data.cpInfo;
                                    if (!userInfo){
                                        throw new Error('User info not found in response');
                                    }
                                    if(userInfo.header){
                                        // 直接使用腾讯原始头像 URL，前端展示时用 referrerpolicy="no-referrer" 即可
                                        console.log('[腾讯号授权] 使用原始头像 URL:', userInfo.header);
                                    }
                                    const fansCountResult = await fetch('https://om.qq.com/mstatistic/ommixin/getFansTotalStatistic?app=&relogin=1', {
                                        method: 'GET',
                                        credentials: 'include' // 带上 cookies
                                    });

                                    const fansCountRes = await fansCountResult.json();
                                    let fansCount = 0;
                                    if(fansCountRes.data){
                                        fansCount = fansCountRes.data.data ? JSON.parse(fansCountRes.data.data) ? JSON.parse(fansCountRes.data.data).fans : 0 : 0;
                                        console.log('[腾讯号授权] ✅ 发布文章数量:', fansCount);
                                    }else{
                                        console.error('[腾讯号授权] ⚠️ 获取发布文章数量失败:', fansCountRes.msg);
                                    }

                                    const publishArticleCountResult = await fetch('https://om.qq.com/marticle/article/list?category=&search=&source=&startDate=&endDate=&num=10&ftype=&readChannel=all&dstChannel=&isPartDst=0&isQBQA=false&refreshField=&relogin=1', {
                                        method: 'GET',
                                        credentials: 'include' // 带上 cookies
                                    });

                                    const publishArticleCountRes = await publishArticleCountResult.json();
                                    let publishArticleCount = 0;
                                    if(publishArticleCountRes.data){
                                        publishArticleCount = fansCountRes.data.totalNumber ?? 0;
                                        console.log('[腾讯号授权] ✅ 发布文章数量:', publishArticleCount);
                                    }else{
                                        console.error('[腾讯号授权] ⚠️ 获取发布文章数量失败:', publishArticleCountRes.msg);
                                    }
                                    const scanData = {
                                        data: JSON.stringify({
                                            nickname: userInfo.mediaName,
                                            avatar: userInfo.header,
                                            follow: 0,
                                            follower_count: fansCount, //粉丝
                                            video: publishArticleCount, // 作品数
                                            uid: userInfo.mediaId,
                                            favoriting_count: 0, // 收藏数
                                            total_favorited: 0, // 总收藏数
                                            company_id: companyId,
                                            auth_type: messageData?.auth_type ?? authType,
                                            cookies: cookiesData
                                        })
                                    };
                                    console.log("🚀 ~  ~ scanData: ", scanData);

                                    console.log('[腾讯号授权] 📤 准备发送数据到接口...');
                                    // 发送数据到服务器（根据环境选择域名）
                                    const apiDomain = await getApiDomain();
                                    console.log('[腾讯号授权] 📡 API 地址:', `${apiDomain}/api/mediaauth/txinfo`);
                                    const apiResponse = await fetch(`${apiDomain}/api/mediaauth/txinfo`, {
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
                                            ? `✅ 授权保存成功（腾讯号）\n窗口: 授权窗口\n平台: tengxunhao\n后台账号ID(uid): ${userInfo.mediaId || '无'}\n账号昵称: ${userInfo.mediaName || '未知'}\nCookies 数据大小: ${cookiesSizeKB} KB\nHTTP 状态: ${apiResponse.status}\n接口 code: ${apiResult?.code}`
                                            : `❌ 授权保存失败（腾讯号）\n窗口: 授权窗口\n平台: tengxunhao\n后台账号ID(uid): ${userInfo.mediaId || '无'}\n账号昵称: ${userInfo.mediaName || '未知'}\nCookies 数据大小: ${cookiesSizeKB} KB\nHTTP 状态: ${apiResponse.status}\n接口 code: ${apiResult?.code ?? '-'}\n响应: ${apiResponseText.slice(0, 200)}`;
                                        console[okFlag ? 'log' : 'warn'](debugMsg);
                                    } catch (logErr) {
                                        console.warn('[腾讯号授权] ⚠️ 输出调试日志失败:', logErr.message);
                                    }

                                    // 检查响应状态
                                    if (!apiResponse.ok) {
                                        throw new Error(`Statistics API failed with status: ${apiResponse.status}`);
                                    }
                                    if (!apiResult) {
                                        throw new Error('授权接口响应不是 JSON: ' + apiResponseText.slice(0, 100));
                                    }

                                    console.log('[腾讯号授权] 📥 接口响应:', apiResult);

                                    if (apiResult && 'code' in apiResult && apiResult.code === 200) {
                                        console.log('[腾讯号授权] ✅ 数据发送成功');

                                        // 标记已完成（防止重复发送）
                                        hasProcessed = true;
                                        try { sessionStorage.setItem('tengxunhao_auth_reported', '1'); } catch (e) { }

                                        // 🔑 迁移登录 Cookies 到持久化 session
                                        // 因为授权窗口使用临时 session，需要把登录状态复制到持久化 session
                                        // 这样发布时才能用新授权的账号
                                        try {
                                            const publishData = cachedPublishWindowData || await getPublishWindowData();
                                            const publishAccountId = publishData?.element?.account_info?.id || publishData?.element?.accountInfo?.id || '';
                                            const publishPlatform = publishData?.platform || 'tengxunhao';

                                            if (publishAccountId && window.browserAPI?.migrateCookiesToAccountSession) {
                                                console.log('[腾讯号授权] 🔄 迁移 Cookies 到当前发布账号 session...', {
                                                    publishPlatform,
                                                    publishAccountId,
                                                    domains: TENGXVNHAO_SESSION_DOMAINS
                                                });
                                                let totalMigrated = 0;
                                                for (const domain of TENGXVNHAO_SESSION_DOMAINS) {
                                                    const migrateResult = await window.browserAPI.migrateCookiesToAccountSession(domain, publishPlatform, String(publishAccountId));
                                                    if (migrateResult.success) {
                                                        totalMigrated += migrateResult.migratedCount || 0;
                                                        console.log(`[腾讯号授权] ✅ ${domain} 已写回当前发布账号 session，迁移 ${migrateResult.migratedCount || 0} 个 cookies`);
                                                    } else {
                                                        console.error(`[腾讯号授权] ⚠️ ${domain} 写回当前发布账号 session 失败:`, migrateResult.error);
                                                    }
                                                }
                                                console.log(`[腾讯号授权] ✅ 当前发布账号 session 回写完成，共迁移 ${totalMigrated} 个 cookies`);
                                            } else {
                                                console.log('[腾讯号授权] ℹ️ 未获取到发布账号上下文，回退迁移到持久化 session');
                                                let totalMigrated = 0;
                                                for (const domain of TENGXVNHAO_SESSION_DOMAINS) {
                                                    const migrateResult = await window.browserAPI.migrateCookiesToPersistent(domain);
                                                    if (migrateResult.success) {
                                                        totalMigrated += migrateResult.migratedCount || 0;
                                                        console.log(`[腾讯号授权] ✅ ${domain} Cookies 迁移成功，迁移 ${migrateResult.migratedCount} 个`);
                                                    } else {
                                                        console.error(`[腾讯号授权] ⚠️ ${domain} Cookies 迁移失败:`, migrateResult.error);
                                                    }
                                                }
                                                console.log(`[腾讯号授权] ✅ 多域名 Cookies 迁移完成，共迁移 ${totalMigrated} 个`);
                                            }
                                        } catch (migrateError) {
                                            console.error('[腾讯号授权] ⚠️ Cookies 迁移异常:', migrateError);
                                        }

                                        // API 成功后通知父页面刷新
                                        sendMessageToParent('授权成功，刷新数据');

                                        // 统计接口成功后关闭弹窗（仅授权窗口自动关，其他入口保留窗口）
                                        if (isAuthModeWindow) {
                                            setTimeout(() => {
                                                window.browserAPI.closeCurrentWindow();
                                            }, window.getRandomDelayMs(10000));
                                        } else {
                                            console.log('[腾讯号授权] ℹ️ 非授权窗口，授权完成后保留窗口');
                                        }
                                    } else {
                                        throw new Error(apiResult.msg || apiResult.message || '上报数据失败');
                                    }
                                }else{
                                    throw new Error(userInfo.msg || userInfo.message || '获取用户信息失败');
                                }
                            }else{
                                throw new Error(result.msg || result.message || '获取数据失败');
                            }
                } catch (error) {
                    console.error('[腾讯号授权] ❌ 处理授权数据出错:', error);
                } finally {
                    isProcessing = false;
                    console.log('[腾讯号授权] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
                }
            }

            // ===========================
            // 消息模式：监听父窗口 auth-data（windowId 强校验后调用核心流程）
            // ===========================
            window.browserAPI.onMessageFromHome(async (message) => {
                try {
                    console.log('═══════════════════════════════════════');
                    console.log('[腾讯号授权] 🎉 收到来自父窗口的消息!');
                    console.log('[腾讯号授权] 消息内容:', message);
                    console.log('═══════════════════════════════════════');

                    // 接收完整的授权数据
                    if (message.type === 'auth-data') {
                        console.log('[腾讯号授权] ✅ 收到授权数据:', message.data);

                        // 🔑 强制检查 windowId（必须匹配，否则立即返回）
                        const myWindowId = await window.browserAPI.getWindowId();
                        console.log('[腾讯号授权] 我的窗口 ID:', myWindowId, '消息目标窗口 ID:', message.windowId);

                        if (!message.windowId) {
                          console.error('[腾讯号授权] ❌ 收到的 auth-data 消息缺少 windowId，这不应该发生！已拒绝处理');
                          return;
                        }

                        if (myWindowId !== message.windowId) {
                          console.warn('[腾讯号授权] ⚠️ 消息不是发给我的（我是 ' + myWindowId + '，消息发给 ' + message.windowId + '），拒绝处理');
                          return;
                        }

                        console.log('[腾讯号授权] ✅ windowId 匹配，安全处理消息');

                        if (message.data) {
                            const messageData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
                            window.__AUTH_DATA__ = {
                                ...window.__AUTH_DATA__,
                                message: messageData,
                                receivedAt: Date.now()
                            };
                            console.log('[腾讯号授权] ✅ 授权数据已更新:', window.__AUTH_DATA__);
                            await processAuthorization(messageData);
                        }
                    }
                } catch (error) {
                    console.error('[腾讯号授权] ❌ 消息处理出错:', error);
                }
            });

            console.log('[腾讯号授权] ✅ 消息监听器注册成功');

            // ===========================
            // 兜底模式：子窗口必须完成授权（管他从哪进来的；auth-data 丢失/一次性失败时接口轮询）
            // ===========================
            (async () => {
                try {
                    if (!isChildWindow) {
                        console.log('[腾讯号授权] ℹ️ 主窗口浏览，不启动兜底授权');
                        return;
                    }
                    if (hasPublishData) {
                        console.log('[腾讯号授权] ℹ️ 发布窗口，不启动兜底授权');
                        return;
                    }
                    // 本窗口已成功上报过就不再兜底（上报失败不置位，下次导航可重试）
                    try {
                        if (sessionStorage.getItem('tengxunhao_auth_reported') === '1') {
                            console.log('[腾讯号授权] ℹ️ 本窗口已完成过授权上报，兜底不启动');
                            return;
                        }
                    } catch (dedupError) { }

                    // 给正常 auth-data 消息 15 秒到达时间
                    await new Promise(resolve => setTimeout(resolve, 15000));
                    if (hasProcessed) {
                        console.log('[腾讯号授权] ℹ️ 消息模式已完成授权，兜底退出');
                        return;
                    }

                    console.log('[腾讯号授权] 🚀 启动兜底授权：轮询 homeInfo 等待登录...');
                    const startTime = Date.now();
                    const maxWaitMs = 5 * 60 * 1000;
                    let attempt = 0;
                    while (Date.now() - startTime < maxWaitMs) {
                        if (hasProcessed) {
                            console.log('[腾讯号授权] ℹ️ 授权已完成，兜底轮询退出');
                            return;
                        }
                        if (isProcessing) {
                            // 消息模式正在处理，等它结束再看结果
                            await new Promise(resolve => setTimeout(resolve, 3000));
                            continue;
                        }
                        attempt++;
                        try {
                            const probe = await fetch('https://om.qq.com/mindex/homeInfo?app=all&relogin=1', {
                                method: 'GET',
                                credentials: 'include',
                                headers: { 'Content-Type': 'application/json' },
                            });
                            if (probe.ok) {
                                const probeResult = await probe.json();
                                if (probeResult && probeResult.data) {
                                    console.log(`[腾讯号授权] ✅ 兜底第 ${attempt} 次轮询检测到已登录，执行授权流程`);
                                    await processAuthorization({ auth_type: authType });
                                    if (hasProcessed) {
                                        return;
                                    }
                                    // 上报失败，10 秒后重试
                                    await new Promise(resolve => setTimeout(resolve, 10000));
                                    continue;
                                }
                            }
                            if (attempt === 1 || attempt % 10 === 0) {
                                console.log(`[腾讯号授权] ⏳ 兜底第 ${attempt} 次轮询：未登录，等待扫码...`);
                            }
                        } catch (probeError) {
                            if (attempt === 1 || attempt % 10 === 0) {
                                console.warn(`[腾讯号授权] ⏳ 兜底第 ${attempt} 次轮询异常:`, probeError.message);
                            }
                        }
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                    console.error('[腾讯号授权] ❌ 兜底轮询超时（5分钟），未完成授权');
                } catch (fallbackError) {
                    console.error('[腾讯号授权] ❌ 兜底授权异常:', fallbackError);
                }
            })();
        }
    }

    // 自动执行授权流程

    // ===========================
    // 6. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
    // ===========================

    // 页面加载完成后向父窗口发送消息
    console.log('[腾讯号授权] 页面加载完成，发送 页面加载完成 消息');
    sendMessageToParent('页面加载完成');

    console.log('═══════════════════════════════════════');
    console.log('✅ 腾讯号授权脚本初始化完成');
    console.log('📝 全局方法: window.__TENGXVNHAO_AUTH__');
    console.log('  - notifySuccess()  : 发送授权成功消息');
    console.log('  - sendMessage(msg) : 发送自定义消息');
    console.log('  - getAuthData()    : 获取授权数据');
    console.log('═══════════════════════════════════════');

    // ===========================
    // 7. 检查是否有发布数据需要恢复（登录跳转后返回首页的情况）
    // ===========================
    setTimeout(async () => {
        try {
            const windowId = await window.browserAPI.getWindowId();
            if (!windowId) {
                console.log('[腾讯号授权] ℹ️ 无法获取窗口 ID，跳过发布数据检查');
                return;
            }

            const globalPublishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
            console.log('[腾讯号授权] 🔍 检查发布数据:', {
                globalData: globalPublishData ? '有' : '无',
                windowId
            });

            if (!globalPublishData) {
                console.log('[腾讯号授权] ℹ️ 没有发布数据，这是正常的授权流程');
                return;
            }

            const isAuthWindow = await window.browserAPI.getGlobalData(`auth_mode_window_${windowId}`);
            if (isAuthWindow) {
                if (globalPublishData && !cachedPublishWindowData) {
                    cachedPublishWindowData = globalPublishData;
                }
                console.log('[腾讯号授权] ℹ️ 授权窗口保留发布数据，继续正常授权流程');
                return;
            }

            console.log('[腾讯号授权] ✅ 检测到发布数据，这是从发布流程登录后跳回来的');
            console.log('[腾讯号授权] 🔄 准备自动跳转到发布页...');

            await window.delay(1000);

            const publishUrl = 'https://om.qq.com/main/creation/article';
            console.log('[腾讯号授权] 🔗 跳转到发布页:', publishUrl);
            window.location.href = publishUrl;
        } catch (error) {
            console.error('[腾讯号授权] ❌ 检查发布数据失败:', error);
        }
    }, window.getRandomDelayMs(2000));

})();

