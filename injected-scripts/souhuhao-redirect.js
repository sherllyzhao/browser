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
        let originalLocationHref = window.location.href;
        Object.defineProperty(window.location, 'href', {
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
                window.location.href = value;
            }
        });

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
