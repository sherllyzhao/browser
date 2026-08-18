/**
 * 知乎创作者平台授权脚本
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
        console.warn("[知乎授权] ⚠️ common.js 未正确加载，使用降级实现");
        window.getRandomDelayMs = function (ms, jitterMs) {
            const baseMs = Number.isFinite(Number(ms)) ? Math.max(0, Math.floor(Number(ms))) : 0;
            const hasCustomJitter = jitterMs !== null && typeof jitterMs !== "undefined" && Number.isFinite(Number(jitterMs));
            const resolvedJitterMs = hasCustomJitter
                ? Math.max(0, Math.floor(Number(jitterMs)))
                : Math.max(80, Math.round(baseMs * 0.35));
            return baseMs + Math.floor(Math.random() * (resolvedJitterMs + 1));
        };
    }

    // ===========================
    // 防止脚本重复注入
    // ===========================
    if (window.__ZHIHU_SCRIPT_LOADED__) {
        console.log('[知乎授权] ⚠️ 脚本已经加载过，跳过重复注入');
        return;
    }

    // ===========================
    // 页面状态检查 - 防止异常渲染
    // ===========================
    if (typeof window.checkPageStateAndReload === 'function') {
        if (!window.checkPageStateAndReload('知乎授权')) {
            return;
        }
    }

    window.__ZHIHU_SCRIPT_LOADED__ = true;

    // 显示操作提示横幅
    if (typeof showOperationBanner === 'function') {
        showOperationBanner('正在自动授权中，请勿操作此页面...');
    }

    console.log('═══════════════════════════════════════');
    console.log('✅ 知乎授权脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    // 检查 common.js 是否已加载
    if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
        console.error('[知乎授权] ❌ common.js 未加载！脚本可能无法正常工作');
    } else {
        console.log('[知乎授权] ✅ common.js 已加载，工具函数可用');
    }

    // ===========================
    // 1. 从 URL 获取授权数据
    // ===========================

    const urlParams = new URLSearchParams(window.location.search);
    const companyId = await window.browserAPI.getGlobalData('company_id');
    const transferId = urlParams.get('transfer_id');
    const authType = urlParams.get('auth_type') || 1;  // 从 URL 获取 auth_type，默认为 1

    console.log('[知乎授权] URL 参数:', {
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

    window.__ZHIHU_AUTH__ = {
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
    // 5. 从多个来源读取授权数据
    // ===========================
    console.log('[知乎授权] 检查授权数据...');
    console.log('[知乎授权] 当前 URL:', window.location.href);
    console.log('[知乎授权] URL hash:', window.location.hash);

    // 读取 redirect 脚本执行日志
    const redirectLog = await window.browserAPI.getGlobalData('zhihu_redirect_log');
    if (redirectLog && redirectLog.length > 0) {
        console.log('[知乎授权] 📋 redirect 脚本执行日志:');
        redirectLog.forEach(log => console.log('  ' + log));
    }

    let authData = null;

    // 方案1: 从 URL hash 读取（最可靠）
    if (window.location.hash && window.location.hash.includes('auth_data=')) {
        try {
            const hashData = window.location.hash.split('auth_data=')[1];
            if (hashData) {
                authData = JSON.parse(decodeURIComponent(hashData));
                console.log('[知乎授权] ✅ 从 URL hash 读取到授权数据');
                // 清除 hash，避免显示在地址栏
                history.replaceState(null, '', window.location.pathname + window.location.search);
            }
        } catch (e) {
            console.error('[知乎授权] URL hash 解析失败:', e);
        }
    }

    // 方案2: 从 localStorage 读取
    if (!authData) {
        try {
            const lsData = localStorage.getItem('zhihu_auth_data');
            console.log('[知乎授权] localStorage 原始值:', lsData ? '有数据，长度' + lsData.length : 'null');
            if (lsData) {
                authData = JSON.parse(lsData);
                console.log('[知乎授权] ✅ 从 localStorage 读取到授权数据');
                localStorage.removeItem('zhihu_auth_data');
            }
        } catch (e) {
            console.error('[知乎授权] localStorage 读取失败:', e);
        }
    }

    // 方案3: 从 globalData 读取
    if (!authData) {
        authData = await window.browserAPI.getGlobalData('zhihu_auth_data');
        if (authData) {
            console.log('[知乎授权] ✅ 从 globalData 读取到授权数据');
            await window.browserAPI.removeGlobalData('zhihu_auth_data');
        } else {
            console.log('[知乎授权] ⚠️ 所有来源都没有数据');
        }
    }

    console.log('[知乎授权] 最终 authData:', authData ? '有数据' : 'undefined');

    // ===========================
    // 6. 核心上报流程（接口优先：userInfo 从平台接口实时获取）
    // ===========================
    let isReporting = false;
    let hasReported = false;

    async function processAuthorization(messageData, userInfo, storedCompanyId) {
        if (isReporting) {
            console.warn('[知乎授权] ⚠️ 正在上报中，忽略重复调用');
            return;
        }
        if (hasReported) {
            console.warn('[知乎授权] ⚠️ 已上报过，忽略重复调用');
            return;
        }
        isReporting = true;

        const result = userInfo;
        console.log("🚀 ~ processAuthorization ~ result: ", result);

        try {
            // 🔑 获取完整会话数据（Cookies + Storage + IndexedDB）
            console.log('[知乎授权] 📦 正在获取完整会话数据...');
            let cookiesData = '';
            try {
                // 🔑 用父域 zhihu.com 采集（覆盖 www/zhuanlan 等全部子域的 host-only cookie）
                // 之前传 'www.zhihu.com' 会漏掉 zhuanlan.zhihu.com（发布页所在域）的 cookie
                const sessionResult = await window.browserAPI.getFullSessionData('zhihu.com');
                if (sessionResult.success) {
                    cookiesData = JSON.stringify(sessionResult.data);
                    console.log(`[知乎授权] ✅ 会话数据获取成功，大小: ${Math.round(sessionResult.size / 1024)} KB`);
                } else {
                    console.warn('[知乎授权] ⚠️ 获取完整会话数据失败:', sessionResult.error);
                    // 降级为简单 cookie 字符串
                    const cookieResult = await window.browserAPI.getDomainCookies('zhihu.com');
                    if (cookieResult.success && cookieResult.cookies) {
                        cookiesData = cookieResult.cookies;
                    }
                }
            } catch (sessionError) {
                console.error('[知乎授权] ⚠️ 获取会话数据异常:', sessionError);
                cookiesData = document.cookie;
            }

            const scanData = {
                data: JSON.stringify({
                    nickname: result.name,
                    avatar: result.avatar_url,
                    follow: result.creation_count,
                    follower_count: 0, //粉丝
                    video: result.articles_count, // 作品数
                    uid: result.id,
                    favoriting_count: 0, // 收藏数
                    total_favorited: 0, // 总收藏数
                    company_id: storedCompanyId ?? companyId,
                    auth_type: messageData?.auth_type ?? authType,
                    cookies: cookiesData
                })
            };
            console.log('[知乎授权] 📤 准备发送数据到接口...', scanData);

            // 动态获取 API 域名
            const apiDomain = await getApiDomain();
            const apiUrl = `${apiDomain}/api/mediaauth/zhinfo`;
            console.log('[知乎授权] 📡 API 地址:', apiUrl);

            // 发送数据到服务器
            const apiResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(scanData)
            });

            // 检查响应状态
            if (!apiResponse.ok) {
                throw new Error(`Statistics API failed with status: ${apiResponse.status}`);
            }

            const apiResult = await apiResponse.json();
            console.log('[知乎授权] 📥 接口响应:', apiResult);

            if (apiResult && 'code' in apiResult && apiResult.code === 200) {
                console.log('[知乎授权] ✅ 数据发送成功');
                hasReported = true;
                try { sessionStorage.setItem('zhihu_auth_reported', '1'); } catch (e) { }

                // 🔑 迁移登录 Cookies 到持久化 session
                try {
                    console.log('[知乎授权] 🔄 开始迁移 Cookies 到持久化 session...');
                    // 🔑 用父域 zhihu.com 迁移（与快照采集口径一致，覆盖全部子域）
                    const migrateResult = await window.browserAPI.migrateCookiesToPersistent('zhihu.com');
                    if (migrateResult.success) {
                        console.log(`[知乎授权] ✅ Cookies 迁移成功，共迁移 ${migrateResult.migratedCount} 个`);
                    } else {
                        console.error('[知乎授权] ⚠️ Cookies 迁移失败:', migrateResult.error);
                    }
                } catch (migrateError) {
                    console.error('[知乎授权] ⚠️ Cookies 迁移异常:', migrateError);
                }

                // API 成功后通知父页面刷新
                sendMessageToParent('授权成功，刷新数据');

                // 统计接口成功后关闭弹窗（仅授权窗口自动关，其他入口保留窗口）
                if (isAuthWindow) {
                    setTimeout(() => {
                        window.browserAPI.closeCurrentWindow();
                    }, window.getRandomDelayMs(10000));
                } else {
                    console.log('[知乎授权] ℹ️ 非授权窗口，授权完成后保留窗口');
                }
            } else {
                throw new Error(apiResult.msg || apiResult.message || '上报数据失败');
            }
        } catch (error) {
            console.error('[知乎授权] ❌ 处理授权数据出错:', error);
        } finally {
            isReporting = false;
        }
    }

    // ===========================
    // 7. 轮询平台接口等待登录（接口优先获取 userInfo）
    // ===========================
    async function pollZhihuUserInfo(maxWaitMs = 5 * 60 * 1000, intervalMs = 3000) {
        const startTime = Date.now();
        let attempt = 0;
        while (Date.now() - startTime < maxWaitMs) {
            attempt++;
            try {
                const response = await fetch('https://www.zhihu.com/api/v4/me?include=is_realname', {
                    method: 'GET',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                if (response.ok) {
                    const me = await response.json();
                    if (me && me.id) {
                        console.log(`[知乎授权] ✅ 第 ${attempt} 次轮询获取到用户信息:`, me.name || me.id);
                        return me;
                    }
                }
                if (attempt === 1 || attempt % 10 === 0) {
                    console.log(`[知乎授权] ⏳ 第 ${attempt} 次轮询：未登录（HTTP ${response.status}），等待扫码...`);
                }
            } catch (e) {
                if (attempt === 1 || attempt % 10 === 0) {
                    console.warn(`[知乎授权] ⏳ 第 ${attempt} 次轮询异常:`, e.message);
                }
            }
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
        console.error(`[知乎授权] ❌ 轮询超时（${Math.round(maxWaitMs / 1000)}秒），未获取到登录用户信息`);
        return null;
    }

    // ===========================
    // 8. 授权意图判定与执行：授权窗口必须完成授权
    // ===========================

    // 跳转数据新鲜度检查（仅作为 auth_type/companyId 辅助来源，不再是 userInfo 来源）
    let freshAuthData = null;
    if (authData && authData.timestamp) {
        const dataAge = Date.now() - authData.timestamp;
        if (dataAge < 5 * 60 * 1000) {
            freshAuthData = authData;
            console.log('[知乎授权] ✅ 跳转数据有效（作为 auth_type/companyId 辅助）');
        } else {
            console.log('[知乎授权] ⚠️ 跳转数据已过期，忽略');
        }
        await window.browserAPI.removeGlobalData('zhihu_auth_data');
    }

    // 窗口类型判定：子窗口一律授权（管他从哪进来的），主窗口浏览不触发
    // 授权窗口标志仅用于决定"授权完成后是否自动关窗"
    let isAuthWindow = false;
    let isChildWindow = false;
    let hasPublishData = false;
    try {
        const myWindowId = await window.browserAPI.getWindowId();
        isChildWindow = typeof myWindowId === 'number';
        if (isChildWindow) {
            isAuthWindow = !!(await window.browserAPI.getGlobalData(`auth_mode_window_${myWindowId}`));
            // 发布窗口不触发授权（避免发布中途上报+通知父页面刷新干扰发布流程）
            hasPublishData = !!(await window.browserAPI.getGlobalData(`publish_data_window_${myWindowId}`));
        }
        console.log('[知乎授权] 窗口 ID:', myWindowId, '子窗口:', isChildWindow, '授权窗口标志:', isAuthWindow, '发布窗口:', hasPublishData);
    } catch (e) {
        console.warn('[知乎授权] ⚠️ 读取窗口信息失败:', e.message);
    }

    // 同窗口去重：本窗口已成功上报过就不再重复（上报失败不置位，下次导航可重试）
    let alreadyReportedInWindow = false;
    try {
        alreadyReportedInWindow = sessionStorage.getItem('zhihu_auth_reported') === '1';
    } catch (e) { }

    if (alreadyReportedInWindow) {
        console.log('[知乎授权] ℹ️ 本窗口已完成过授权上报，跳过');
    } else if ((isChildWindow && !hasPublishData) || freshAuthData) {
        console.log('[知乎授权] 🚀 检测到授权意图（子窗口=' + isChildWindow + ', 授权窗口=' + isAuthWindow + ', 跳转数据=' + !!freshAuthData + '），接口优先获取用户信息...');
        const me = await pollZhihuUserInfo();
        if (me) {
            await processAuthorization(
                freshAuthData?.messageData ?? { auth_type: authType },
                me,
                freshAuthData?.companyId ?? companyId
            );
        } else if (freshAuthData?.userInfo?.id) {
            // 接口轮询超时，降级使用跳转数据里的 userInfo（比完全失败好）
            console.warn('[知乎授权] ⚠️ 接口轮询超时，降级使用跳转数据中的 userInfo');
            await processAuthorization(
                freshAuthData.messageData ?? { auth_type: authType },
                freshAuthData.userInfo,
                freshAuthData.companyId ?? companyId
            );
        }
    } else {
        console.log('[知乎授权] ℹ️ 主窗口浏览或发布窗口，不执行授权');
    }

    console.log('═══════════════════════════════════════');
    console.log('✅ 知乎授权脚本初始化完成');
    console.log('📝 全局方法: window.__ZHIHU_AUTH__');
    console.log('  - notifySuccess()  : 发送授权成功消息');
    console.log('  - sendMessage(msg) : 发送自定义消息');
    console.log('  - getAuthData()    : 获取授权数据');
    console.log('═══════════════════════════════════════');

})();

