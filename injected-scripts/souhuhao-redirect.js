/**
 * 搜狐号 firstPage 重定向脚本
 * 用于检测发布窗口误跳转到 firstPage，立即重定向回发布页
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

// 🔑 平台配置（从 common.js 引用，避免重复定义）
const PLATFORM_CONFIG = (window.PLATFORM_CONFIGS && window.PLATFORM_CONFIGS.souhuhao) || {
    name: '搜狐号',
    publishPagePath: '/contentManagement/news/addarticle',
    publishPageUrl: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle',
    firstPageUrl: 'https://mp.sohu.com/mpfe/v4/contentManagement/first/page',
    domain: 'mp.sohu.com',
    cookiesDomain: 'mp.sohu.com'
};

const CONTENT_ENTRY_KEY = '__sohuhao_content_entry__';
const AUTH_ENTRY_KEY = '__sohuhao_auth_entry__';
const PUBLISH_RECOVER_COUNT_KEY = '__sohuhao_publish_recover_count__';
const FIRST_PAGE_BASE_URL = 'https://mp.sohu.com/mpfe/v4/contentManagement/first/page';
const MAX_PUBLISH_RECOVER_COUNT = 3;

(async function () {
    'use strict';

    console.log('═══════════════════════════════════════');
    console.log('✅ 搜狐号重定向脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    const currentUrl = new URL(window.location.href);
    const entrySource = currentUrl.searchParams.get('from');
    const isContentEntry = entrySource === 'content';
    const isAuthEntry = entrySource === 'auth';
    if (isContentEntry || isAuthEntry) {
        try {
            localStorage.removeItem('toPath');
            sessionStorage.setItem(isContentEntry ? CONTENT_ENTRY_KEY : AUTH_ENTRY_KEY, String(Date.now()));
            if (isContentEntry) {
                currentUrl.searchParams.delete('from');
                window.history.replaceState(null, document.title, currentUrl.toString());
            }
            console.log(`[搜狐号重定向] ${isContentEntry ? '内容管理' : '授权'}入口，已清除 toPath${isContentEntry ? ` 并移除 from=${entrySource} 标记` : '，保留 from=auth 以便后续 SPA 导航继续注入'}`);
        } catch (contentEntryError) {
            console.warn(`[搜狐号重定向] ⚠️ ${isContentEntry ? '内容管理' : '授权'}入口清理 toPath 失败:`, contentEntryError.message);
        }
        return;
    }

    const isSohuMpfeRoot = currentUrl.origin === 'https://mp.sohu.com'
        && /^\/mpfe\/v4\/?$/.test(currentUrl.pathname);
    if (isSohuMpfeRoot) {
        let rootWindowContext = null;
        try {
            if (window.browserAPI && window.browserAPI.getWindowContext) {
                rootWindowContext = await window.browserAPI.getWindowContext();
            }
        } catch (rootContextError) {
            console.warn('[搜狐号重定向] ⚠️ 根入口读取窗口上下文失败，按授权入口兜底:', rootContextError.message);
        }

        // 🛡️ 发布窗口识别加 publish-data 兜底：掉登录时序里 getWindowContext 可能读空，
        //    若仅靠 purpose 判断会把发布窗口误当授权入口 → 写 AUTH_ENTRY_KEY 并跳授权页，
        //    导致登录后回不到发布页。故上下文读空时再查 publish_data_window 兜底确认。
        //    ⚠️ 此处早于 hasActivePublishData/getCurrentWindowId 定义（TDZ），故内联直接读取，不调用后面的函数。
        let rootIsPublishWindow = !!(rootWindowContext && rootWindowContext.purpose === 'publish');
        if (!rootIsPublishWindow) {
            try {
                if (window.browserAPI && window.browserAPI.getWindowId && window.browserAPI.getGlobalData) {
                    const rootWid = await window.browserAPI.getWindowId();
                    if (rootWid && rootWid !== 'main') {
                        const rootPublishData = await window.browserAPI.getGlobalData(`publish_data_window_${rootWid}`);
                        rootIsPublishWindow = !!rootPublishData;
                    }
                }
            } catch (rootPublishDataError) {
                console.warn('[搜狐号重定向] ⚠️ 根入口 publish-data 兜底检查失败:', rootPublishDataError.message);
            }
        }

        if (rootIsPublishWindow) {
            console.log('[搜狐号重定向] 根入口属于发布窗口，跳过授权入口兜底');
        } else {
            try {
                localStorage.removeItem('toPath');
                sessionStorage.setItem(AUTH_ENTRY_KEY, String(Date.now()));
            } catch (rootEntryError) {
                console.warn('[搜狐号重定向] ⚠️ 根入口清理 toPath 失败，继续跳转授权入口:', rootEntryError.message);
            }

            const authEntryUrl = new URL(FIRST_PAGE_BASE_URL);
            currentUrl.searchParams.forEach((value, key) => {
                if (key !== 'from') {
                    authEntryUrl.searchParams.append(key, value);
                }
            });
            authEntryUrl.searchParams.set('from', 'auth');
            console.log('[搜狐号重定向] 🔄 检测到搜狐 mpfe 根入口，跳转到可注入的授权入口:', authEntryUrl.toString());
            window.location.replace(authEntryUrl.toString());
            return;
        }
    }

    // 🔑 【最优先】检测是否是发布成功后的跳转
    // 发布页点击发布按钮前会写入：
    // 1. globalData: PUBLISH_SUCCESS_DATA_${windowId}（更可靠，不受页面 storage 清理影响）
    // 2. localStorage: sohu_publish_success_data（兼容旧版本）
    const PUBLISH_SUCCESS_KEY = 'sohu_publish_success_data';
    let currentWindowId = null;
    let windowContext = null;
    let publishSuccessData = null;
    let publishSuccessSource = '';

    const isFirstPageUrl = (href = window.location.href) => {
        try {
            const url = new URL(href);
            return url.hostname === PLATFORM_CONFIG.domain
                && url.pathname === '/mpfe/v4/contentManagement/first/page';
        } catch (_) {
            return false;
        }
    };

    const getPublishRecoverCount = () => {
        try {
            return Number(sessionStorage.getItem(PUBLISH_RECOVER_COUNT_KEY) || 0) || 0;
        } catch (_) {
            return 0;
        }
    };

    const bumpPublishRecoverCount = () => {
        const nextCount = getPublishRecoverCount() + 1;
        try {
            sessionStorage.setItem(PUBLISH_RECOVER_COUNT_KEY, String(nextCount));
        } catch (_) {}
        return nextCount;
    };

    try {
        if (window.browserAPI && window.browserAPI.getWindowContext) {
            windowContext = await window.browserAPI.getWindowContext();
            console.log('[搜狐号重定向] 窗口上下文:', windowContext);
        }
    } catch (contextError) {
        console.warn('[搜狐号重定向] ⚠️ 读取窗口上下文失败:', contextError.message);
    }

    const isPublishWindow = windowContext && windowContext.purpose === 'publish';

    const getCurrentWindowId = async (logLabel = '当前窗口 ID') => {
        if (currentWindowId) {
            return currentWindowId;
        }

        try {
            if (window.browserAPI && window.browserAPI.getWindowId) {
                currentWindowId = await window.browserAPI.getWindowId();
                console.log(`[搜狐号重定向] ${logLabel}:`, currentWindowId);
            }
        } catch (e) {
            console.warn('[搜狐号重定向] ⚠️ 获取窗口 ID 失败:', e.message);
        }

        return currentWindowId;
    };

    const hasActivePublishData = async () => {
        const windowId = await getCurrentWindowId();
        if (!windowId || !window.browserAPI || !window.browserAPI.getGlobalData) {
            return false;
        }

        try {
            const publishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
            return !!publishData;
        } catch (error) {
            console.warn('[搜狐号重定向] ⚠️ 读取发布任务数据失败:', error.message);
            return false;
        }
    };

    const readLocalPublishSuccessData = (keys) => {
        for (const key of keys.filter(Boolean)) {
            const localData = localStorage.getItem(key);
            if (!localData) {
                continue;
            }

            try {
                publishSuccessData = JSON.parse(localData);
                publishSuccessSource = `localStorage:${key}`;
                console.log('[搜狐号重定向] 📦 从 localStorage 读取到发布成功标志:', key);
                return true;
            } catch (parseError) {
                console.warn('[搜狐号重定向] ⚠️ 发布成功标志解析失败:', key, parseError.message);
            }
        }

        return false;
    };

    // 🔎 内容验证模式守卫：验证标记存在时，成功标志的上报/关窗与发布页回跳都交给 content-verify.js，
    // 这里直接退出，避免验证还没做完窗口就被关掉
    // 🛡️ 授权短路：仅在「非发布窗口」且是授权入口时生效，避免误伤授权链路。
    //    ⚠️ 关键修复：AUTH_ENTRY_KEY 是 sessionStorage，发布窗口掉登录时途经授权/根入口会残留它，
    //    登录后搜狐跳回裸 first/page，若仍按授权短路会跳过回跳发布页 → 永停 first/page。
    //    故发布窗口(isPublishWindow)即使有残留授权标记也不短路，并主动清除误留标记。
    try {
        if (isPublishWindow) {
            // 发布窗口：清掉可能残留的授权标记，确保后续回跳发布页逻辑不被误拦
            try { sessionStorage.removeItem(AUTH_ENTRY_KEY); } catch (_) {}
        }
        const isAuthContext = !isPublishWindow && (isAuthEntry
            || (() => { try { return !!sessionStorage.getItem(AUTH_ENTRY_KEY); } catch (_) { return false; } })());
        if (isAuthContext) {
            console.log('[搜狐号重定向] ⏭️ 非发布窗口的授权入口场景，跳过内容验证守卫，保障授权链路');
        } else if (window.browserAPI && window.browserAPI.getWindowId && window.browserAPI.getGlobalData) {
            const verifyWindowIdEarly = await window.browserAPI.getWindowId();
            if (verifyWindowIdEarly && verifyWindowIdEarly !== 'main') {
                const verifyFlagEarly = await window.browserAPI.getGlobalData(`CONTENT_VERIFY_DATA_${verifyWindowIdEarly}`);
                if (verifyFlagEarly) {
                    console.log('[搜狐号重定向] ⏭️ 检测到内容验证标记，本脚本退出，交给 content-verify.js 处理');
                    return;
                }
            }
        }
    } catch (verifyGuardEarlyError) {
        console.warn('[搜狐号重定向] ⚠️ 内容验证标记检测失败，继续正常流程:', verifyGuardEarlyError.message);
    }

    try {
        if (windowContext && !isPublishWindow) {
            console.log('[搜狐号重定向] 当前不是发布窗口，跳过发布成功标志检测');
        } else {
            readLocalPublishSuccessData(['PUBLISH_SUCCESS_DATA', PUBLISH_SUCCESS_KEY]);

            if (!publishSuccessData) {
                try {
                    await getCurrentWindowId();
                } catch (e) {
                    console.warn('[搜狐号重定向] ⚠️ 获取窗口 ID 失败:', e.message);
                }
            }

            if (currentWindowId && window.browserAPI && window.browserAPI.getGlobalData) {
                const globalDataKey = `PUBLISH_SUCCESS_DATA_${currentWindowId}`;
                publishSuccessData = await window.browserAPI.getGlobalData(globalDataKey);
                if (publishSuccessData) {
                    publishSuccessSource = `globalData:${globalDataKey}`;
                    console.log('[搜狐号重定向] 📦 从 globalData 读取到发布成功标志');
                }
            }

            if (!publishSuccessData) {
                readLocalPublishSuccessData([currentWindowId ? `PUBLISH_SUCCESS_DATA_${currentWindowId}` : '']);
            }

            if (publishSuccessData) {
                console.log('[搜狐号重定向] 🎉 检测到发布成功标志，准备上报成功...');
                const data = typeof publishSuccessData === 'string' ? JSON.parse(publishSuccessData) : publishSuccessData;
                const publishId = data.publishId;
                console.log('[搜狐号重定向] 📋 成功标志来源:', publishSuccessSource);
                console.log('[搜狐号重定向] 📋 publishId:', publishId || '无');

                if (!currentWindowId && window.browserAPI && window.browserAPI.getWindowId) {
                    try {
                        await getCurrentWindowId('当前窗口 ID（成功清理前补取）');
                    } catch (e) {
                        console.warn('[搜狐号重定向] ⚠️ 成功清理前补取窗口 ID 失败:', e.message);
                    }
                }

                // 立即清除标志，防止重复上报；清理失败不应阻断成功上报和关闭窗口
                try {
                    localStorage.removeItem(PUBLISH_SUCCESS_KEY);
                    localStorage.removeItem('PUBLISH_SUCCESS_DATA');
                    if (currentWindowId) {
                        localStorage.removeItem(`PUBLISH_SUCCESS_DATA_${currentWindowId}`);
                        if (window.browserAPI && window.browserAPI.removeGlobalData) {
                            await window.browserAPI.removeGlobalData(`PUBLISH_SUCCESS_DATA_${currentWindowId}`);
                        }
                    }
                    console.log('[搜狐号重定向] 🧹 已清除发布成功标志');
                } catch (cleanupError) {
                    console.warn('[搜狐号重定向] ⚠️ 清除发布成功标志失败，继续上报成功:', cleanupError.message);
                }

                if (publishId && typeof sendStatistics === 'function') {
                    console.log('[搜狐号重定向] 📤 调用 sendStatistics, publishId:', publishId);
                    await sendStatistics(publishId, '搜狐号发布');
                    console.log('[搜狐号重定向] ✅ 发布成功上报完成');
                } else if (publishId) {
                    console.log('[搜狐号重定向] ⚠️ sendStatistics 函数不存在，尝试手动上报');
                    try {
                        let apiUrl;
                        if (typeof getStatisticsUrl === 'function') {
                            apiUrl = await getStatisticsUrl(false);
                        } else {
                            apiUrl = 'https://api.china9.cn/api/mediaauth/tjlog';
                        }
                        console.log('[搜狐号重定向] 📤 API 地址:', apiUrl);
                        const scanData = window.buildStatisticsRequestData
                            ? await window.buildStatisticsRequestData(publishId, '搜狐号发布')
                            : { data: JSON.stringify({ id: publishId }) };
                        const response = await fetch(apiUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(scanData)
                        });
                        console.log('[搜狐号重定向] ✅ 手动上报成功');
                    } catch (apiError) {
                        console.error('[搜狐号重定向] ❌ 手动上报失败:', apiError);
                    }
                }

                // 上报完成后关闭窗口
                console.log('[搜狐号重定向] 🚪 准备关闭窗口...');
                if (typeof closeWindowWithMessage === 'function') {
                    await closeWindowWithMessage('发布成功，刷新数据', 1000);
                } else if (typeof sendMessageToParent === 'function') {
                    sendMessageToParent('发布成功，刷新数据');
                } else {
                    console.error('[搜狐号重定向] ❌ closeWindowWithMessage/sendMessageToParent 均不可用，无法通知首页发布成功');
                }
                return; // 不再执行后续逻辑
            } else {
                console.log('[搜狐号重定向] ℹ️ 没有发布成功标志，继续正常流程');
            }
        }
    } catch (e) {
        console.error('[搜狐号重定向] ❌ 检测发布成功标志失败:', e);
    }

    // 🔑 只通过当前窗口 publish-data 判断是否需要恢复发布页，避免内容管理/授权页误跳
    try {
        if (!windowContext && window.browserAPI && window.browserAPI.getWindowContext) {
            windowContext = await window.browserAPI.getWindowContext();
            console.log('[搜狐号重定向] 窗口上下文:', windowContext);
        }

        // 🔎 内容验证模式守卫：发布成功后 content-verify.js 会带着验证标记跳回内容管理页，
        // 此时绝不能再回跳发布页，否则和验证流程打架形成循环
        // 🛡️ 授权短路：仅非发布窗口的授权入口生效；发布窗口清除残留授权标记，确保回跳不被误拦
        try {
            if (isPublishWindow) {
                try { sessionStorage.removeItem(AUTH_ENTRY_KEY); } catch (_) {}
            }
            const isAuthContext2 = !isPublishWindow && (isAuthEntry
                || (() => { try { return !!sessionStorage.getItem(AUTH_ENTRY_KEY); } catch (_) { return false; } })());
            if (isAuthContext2) {
                console.log('[搜狐号重定向] ⏭️ 非发布窗口的授权入口场景，跳过发布页回跳守卫');
            } else if (window.browserAPI && window.browserAPI.getWindowId && window.browserAPI.getGlobalData) {
                const verifyWindowId = await window.browserAPI.getWindowId();
                if (verifyWindowId && verifyWindowId !== 'main') {
                    const verifyFlag = await window.browserAPI.getGlobalData(`CONTENT_VERIFY_DATA_${verifyWindowId}`);
                    if (verifyFlag) {
                        console.log('[搜狐号重定向] ⏭️ 检测到内容验证标记，跳过发布页回跳，交给 content-verify.js 处理');
                        return;
                    }
                }
            }
        } catch (verifyGuardError) {
            console.warn('[搜狐号重定向] ⚠️ 内容验证标记检测失败，继续正常流程:', verifyGuardError.message);
        }

        const activePublishData = await hasActivePublishData();
        if (!activePublishData) {
            console.log('[搜狐号重定向] 当前窗口没有 publish-data，保持在 firstPage', {
                hasWindowContext: !!windowContext,
                activePublishData
            });
            return;
        }

        if (!isFirstPageUrl()) {
            console.log('[搜狐号重定向] 当前窗口有 publish-data，但不是 firstPage，等待页面继续跳转:', window.location.href);
            return;
        }

        const recoverCount = bumpPublishRecoverCount();
        if (recoverCount > MAX_PUBLISH_RECOVER_COUNT) {
            console.warn('[搜狐号重定向] ⚠️ 发布页恢复次数超过上限，停止回跳，避免循环:', recoverCount);
            return;
        }

        try {
            localStorage.setItem('toPath', PLATFORM_CONFIG.publishPagePath);
        } catch (storageError) {
            console.warn('[搜狐号重定向] ⚠️ 写入 toPath 失败，继续尝试跳转发布页:', storageError.message);
        }

        const publishUrl = (windowContext && windowContext.expectedPageUrl) || PLATFORM_CONFIG.publishPageUrl;
        if (window.location.href !== publishUrl) {
            console.log('[搜狐号重定向] 🔄 检测到发布窗口落在首页，直接跳转回发布页:', publishUrl);
            window.location.replace(publishUrl);
            return;
        }
    } catch (error) {
        console.error('[搜狐号重定向] ❌ 检测窗口类型失败:', error);
    }

    console.log('═══════════════════════════════════════');
    console.log('✅ 搜狐号重定向脚本初始化完成');
    console.log('═══════════════════════════════════════');

})();
