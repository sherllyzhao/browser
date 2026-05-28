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

(async function () {
    'use strict';

    console.log('═══════════════════════════════════════');
    console.log('✅ 搜狐号重定向脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    // 🔑 【最优先】检测是否是发布成功后的跳转
    // 发布页点击发布按钮前会写入：
    // 1. globalData: PUBLISH_SUCCESS_DATA_${windowId}（更可靠，不受页面 storage 清理影响）
    // 2. localStorage: sohu_publish_success_data（兼容旧版本）
    const PUBLISH_SUCCESS_KEY = 'sohu_publish_success_data';
    let currentWindowId = null;
    let publishSuccessData = null;
    let publishSuccessSource = '';

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

    try {
        readLocalPublishSuccessData(['PUBLISH_SUCCESS_DATA', PUBLISH_SUCCESS_KEY]);

        if (!publishSuccessData) {
            try {
                if (window.browserAPI && window.browserAPI.getWindowId) {
                    currentWindowId = await window.browserAPI.getWindowId();
                    console.log('[搜狐号重定向] 当前窗口 ID:', currentWindowId);
                }
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
                    currentWindowId = await window.browserAPI.getWindowId();
                    console.log('[搜狐号重定向] 当前窗口 ID（成功清理前补取）:', currentWindowId);
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
    } catch (e) {
        console.error('[搜狐号重定向] ❌ 检测发布成功标志失败:', e);
    }

    // 🔑 通过主进程窗口上下文判断窗口类型，避免依赖 toPath/localStorage 竞态
    try {
        const windowContext = await window.browserAPI.getWindowContext();
        console.log('[搜狐号重定向] 窗口上下文:', windowContext);

        if (!windowContext || windowContext.purpose !== 'publish') {
            console.log('[搜狐号重定向] 当前不是发布窗口，保持在 firstPage');
            return;
        }

        const publishUrl = windowContext.expectedPageUrl || PLATFORM_CONFIG.publishPageUrl;
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
