/**
 * 搜狐号 firstPage 重定向脚本
 * 用于检测发布窗口误跳转到 firstPage，立即重定向回发布页
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

// 🔑 平台配置（从 platform-config.json 中提取）
const PLATFORM_CONFIG = {
    name: '搜狐号',
    publishPagePath: '/contentManagement/news/addarticle',
    publishPageUrl: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle',
    firstPageUrl: 'https://mp.sohu.com/mpfe/v4/contentManagement/first/page',
    domain: 'mp.sohu.com',
    cookiesDomain: 'mp.sohu.com'
};

// 🔑 最优先：在首页就设置 toPath，防止页面跳转到其他地方
(function() {
    'use strict';

    console.log('[搜狐号重定向] 🛡️ 在首页设置 localStorage.toPath，防止页面跳转');
    try {
        // 主动设置 toPath 为发布页路径
        localStorage.setItem('toPath', PLATFORM_CONFIG.publishPagePath);
        console.log('[搜狐号重定向] ✅ 已设置 localStorage.toPath =', PLATFORM_CONFIG.publishPagePath);

        // 🔑 定期检查 toPath 是否被修改，如果被修改就重新设置
        let checkCount = 0;
        const checkInterval = setInterval(() => {
            checkCount++;
            const currentToPath = localStorage.getItem('toPath');
            if (currentToPath !== PLATFORM_CONFIG.publishPagePath) {
                console.log('[搜狐号重定向] ⚠️ 检测到 toPath 被修改，当前值:', currentToPath, '重新设置为', PLATFORM_CONFIG.publishPagePath);
                localStorage.setItem('toPath', PLATFORM_CONFIG.publishPagePath);
            }
            // 只检查 120 次（约 12 秒），之后停止检查
            if (checkCount >= 120) {
                clearInterval(checkInterval);
                console.log('[搜狐号重定向] ✅ toPath 检查完成');
            }
        }, 100);

        // 🔑 劫持 window.location.href，防止跳转到首页
        // 注意：window.location.href 在现代浏览器中不可配置，尝试劫持可能失败
        if (!window.__sohuRedirectLocationHrefHijacked) {
            window.__sohuRedirectLocationHrefHijacked = true;
            try {
                let originalLocationHref = window.location.href;
                Object.defineProperty(window.location, 'href', {
                    configurable: true,
                    get: function() {
                        return originalLocationHref;
                    },
                    set: function(value) {
                        console.log('[搜狐号重定向] 🚫 检测到页面跳转:', value);
                        if (value.includes('firstPage') || value.includes('first/page')) {
                            console.log('[搜狐号重定向] 🚫 阻止跳转到首页');
                            return; // 阻止跳转
                        }
                        originalLocationHref = value;
                        window.location.assign(value);
                    }
                });
                console.log('[搜狐号重定向] ✅ 成功劫持 window.location.href');
            } catch (e) {
                console.log('[搜狐号重定向] ⚠️ 无法劫持 window.location.href（浏览器限制）');
            }
        }

        // 🔑 劫持 history.pushState 和 history.replaceState，防止通过 history API 跳转
        const originalPushState = window.history.pushState.bind(window.history);
        const originalReplaceState = window.history.replaceState.bind(window.history);

        window.history.pushState = function(state, title, url) {
            console.log('[搜狐号重定向] 🚫 检测到 history.pushState:', url);
            if (url && (url.includes('firstPage') || url.includes('first/page'))) {
                console.log('[搜狐号重定向] 🚫 阻止通过 history.pushState 跳转到首页');
                return; // 阻止跳转
            }
            return originalPushState(state, title, url);
        };

        window.history.replaceState = function(state, title, url) {
            console.log('[搜狐号重定向] 🚫 检测到 history.replaceState:', url);
            if (url && (url.includes('firstPage') || url.includes('first/page'))) {
                console.log('[搜狐号重定向] 🚫 阻止通过 history.replaceState 跳转到首页');
                return; // 阻止跳转
            }
            return originalReplaceState(state, title, url);
        };

        console.log('[搜狐号重定向] ✅ localStorage 和 window.location 劫持完成');
    } catch (e) {
        console.error('[搜狐号重定向] ❌ 劫持失败:', e);
    }
})();

(async function () {
    'use strict';

    console.log('═══════════════════════════════════════');
    console.log('✅ 搜狐号重定向脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    // 🔑 【最优先】检测是否是发布成功后的跳转
    // 通过 localStorage 中的标志来区分：发布页点击发布按钮前会设置这个标志
    const PUBLISH_SUCCESS_KEY = 'sohu_publish_success_data';
    try {
        const publishSuccessData = localStorage.getItem(PUBLISH_SUCCESS_KEY);
        if (publishSuccessData) {
            console.log('[搜狐号重定向] 🎉 检测到发布成功标志，准备上报成功...');
            const data = JSON.parse(publishSuccessData);
            const publishId = data.publishId;

            // 立即清除标志，防止重复上报
            localStorage.removeItem(PUBLISH_SUCCESS_KEY);
            console.log('[搜狐号重定向] 🧹 已清除发布成功标志');

            if (publishId && typeof sendStatisticsSuccess === 'function') {
                console.log('[搜狐号重定向] 📤 调用 sendStatisticsSuccess, publishId:', publishId);
                await sendStatisticsSuccess(publishId, '搜狐号发布');
                console.log('[搜狐号重定向] ✅ 发布成功上报完成');
            } else if (publishId) {
                // sendStatisticsSuccess 可能在 common.js 中，如果不存在就手动调用
                console.log('[搜狐号重定向] ⚠️ sendStatisticsSuccess 函数不存在，尝试手动上报');
                try {
                    const mainInfo = await window.browserAPI.getMainUrl();
                    if (mainInfo.success) {
                        const apiUrl = `${mainInfo.origin}/api/mediaauth/tjlog`;
                        const response = await fetch(apiUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                id: publishId,
                                status: 1,
                                remark: '搜狐号发布成功'
                            })
                        });
                        console.log('[搜狐号重定向] ✅ 手动上报成功，响应:', await response.text());
                    }
                } catch (apiError) {
                    console.error('[搜狐号重定向] ❌ 手动上报失败:', apiError);
                }
            }

            // 上报完成后关闭窗口
            console.log('[搜狐号重定向] 🚪 准备关闭窗口...');
            await closeWindowWithMessage('发布成功，刷新数据', 1000);
            return; // 不再执行后续逻辑
        } else {
            console.log('[搜狐号重定向] ℹ️ 没有发布成功标志，继续正常流程');
        }
    } catch (e) {
        console.error('[搜狐号重定向] ❌ 检测发布成功标志失败:', e);
    }

    // 🔑 再次检查和设置 toPath，确保它是正确的值
    console.log('[搜狐号重定向] 🔍 再次检查 toPath...');
    const currentToPath = localStorage.getItem('toPath');
    if (!currentToPath || currentToPath !== PLATFORM_CONFIG.publishPagePath) {
        console.log('[搜狐号重定向] ⚠️ 检测到 toPath 不正确，重新设置');
        localStorage.setItem('toPath', PLATFORM_CONFIG.publishPagePath);
        console.log('[搜狐号重定向] ✅ 已重新设置 toPath =', PLATFORM_CONFIG.publishPagePath);
    } else {
        console.log('[搜狐号重定向] ✅ toPath 已正确设置');
    }

    // 🔑 在页面加载完成后继续检查 toPath
    // 延迟 1 秒后再检查一次
    setTimeout(() => {
        const toPathAfter1s = localStorage.getItem('toPath');
        if (toPathAfter1s !== PLATFORM_CONFIG.publishPagePath) {
            console.log('[搜狐号重定向] ⚠️ 1秒后检测到 toPath 被修改，当前值:', toPathAfter1s, '重新设置');
            localStorage.setItem('toPath', PLATFORM_CONFIG.publishPagePath);
        }
    }, 1000);

    // 延迟 3 秒后再检查一次
    setTimeout(() => {
        const toPathAfter3s = localStorage.getItem('toPath');
        if (toPathAfter3s !== PLATFORM_CONFIG.publishPagePath) {
            console.log('[搜狐号重定向] ⚠️ 3秒后检测到 toPath 被修改，当前值:', toPathAfter3s, '重新设置');
            localStorage.setItem('toPath', PLATFORM_CONFIG.publishPagePath);
        }
    }, 3000);

    // 延迟 5 秒后再检查一次
    setTimeout(() => {
        const toPathAfter5s = localStorage.getItem('toPath');
        if (toPathAfter5s !== PLATFORM_CONFIG.publishPagePath) {
            console.log('[搜狐号重定向] ⚠️ 5秒后检测到 toPath 被修改，当前值:', toPathAfter5s, '重新设置');
            localStorage.setItem('toPath', PLATFORM_CONFIG.publishPagePath);
        }
    }, 5000);

    // 延迟 10 秒后再检查一次
    setTimeout(() => {
        const toPathAfter10s = localStorage.getItem('toPath');
        if (toPathAfter10s !== PLATFORM_CONFIG.publishPagePath) {
            console.log('[搜狐号重定向] ⚠️ 10秒后检测到 toPath 被修改，当前值:', toPathAfter10s, '重新设置');
            localStorage.setItem('toPath', PLATFORM_CONFIG.publishPagePath);
        }
    }, 10000);

    // 延迟 15 秒后再检查一次
    setTimeout(() => {
        const toPathAfter15s = localStorage.getItem('toPath');
        if (toPathAfter15s !== PLATFORM_CONFIG.publishPagePath) {
            console.log('[搜狐号重定向] ⚠️ 15秒后检测到 toPath 被修改，当前值:', toPathAfter15s, '重新设置');
            localStorage.setItem('toPath', PLATFORM_CONFIG.publishPagePath);
        }
    }, 15000);

    // 🔑 通过检查父页面传来的数据判断窗口类型
    try {
        const windowId = await window.browserAPI.getWindowId();
        console.log('[搜狐号重定向] 当前窗口 ID:', windowId);

        // 如果是主窗口（BrowserView），不需要重定向
        if (windowId === 'main') {
            console.log('[搜狐号重定向] 这是主窗口，不需要重定向');
            return;
        }

        // 检查是否有授权数据（auth_data）
        const authData = await window.browserAPI.getGlobalData(`auth_data_window_${windowId}`);
        console.log('[搜狐号重定向] 授权数据:', authData ? '存在' : '不存在');

        if (authData) {
            // 有授权数据，说明是授权窗口
            const authType = authData.auth_type || (typeof authData === 'string' ? JSON.parse(authData).auth_type : null);
            console.log('[搜狐号重定向] ✅ 检测到授权窗口（auth_type:', authType, '），保持在 firstPage');
            return;
        }

        // 检查是否有发布数据（publish_data）
        const publishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
        console.log('[搜狐号重定向] 发布数据:', publishData ? '存在' : '不存在');

        if (publishData) {
            // 有发布数据，说明是发布窗口，需要重定向到发布页
            console.log('[搜狐号重定向] 🔄 检测到发布窗口，立即重定向到发布页...');

            // 立即跳转到发布页
            const publishUrl = PLATFORM_CONFIG.publishPageUrl;
            console.log('[搜狐号重定向] 🚀 跳转到:', publishUrl);
            window.location.href = publishUrl;
        } else {
            console.log('[搜狐号重定向] 没有授权或发布数据，保持在 firstPage');
        }
    } catch (error) {
        console.error('[搜狐号重定向] ❌ 检测窗口类型失败:', error);
    }

    console.log('═══════════════════════════════════════');
    console.log('✅ 搜狐号重定向脚本初始化完成');
    console.log('═══════════════════════════════════════');

})();
