/**
 * 搜狐号 firstPage 重定向脚本
 * 用于检测发布窗口误跳转到 firstPage，立即重定向回发布页
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
    'use strict';

    console.log('═══════════════════════════════════════');
    console.log('✅ 搜狐号重定向脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    // 🔑 检查是否是授权窗口（通过 URL 参数判断）
    const urlParams = new URLSearchParams(window.location.search);
    const transferId = urlParams.get('transfer_id');
    const authType = urlParams.get('auth_type');

    console.log('[搜狐号重定向] URL 参数:', { transferId, authType });

    // 如果有 transfer_id 或 auth_type，说明是授权窗口，不要重定向
    if (transferId || authType) {
        console.log('[搜狐号重定向] ✅ 检测到授权窗口（有 transfer_id 或 auth_type），保持在 firstPage');
        return;
    }

    // 🔑 检查是否是发布窗口（通过 windowId 判断）
    try {
        const windowId = await window.browserAPI.getWindowId();
        console.log('[搜狐号重定向] 当前窗口 ID:', windowId);

        // 如果是主窗口（BrowserView），不需要重定向
        if (windowId === 'main') {
            console.log('[搜狐号重定向] 这是主窗口，不需要重定向');
            return;
        }

        // 如果是新窗口，检查是否有发布数据
        const publishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
        console.log('[搜狐号重定向] 发布数据:', publishData ? '存在' : '不存在');

        if (publishData) {
            // 有发布数据，说明是发布窗口，需要重定向到发布页
            console.log('[搜狐号重定向] 🔄 检测到发布窗口，立即重定向到发布页...');

            // 清除 localStorage 中的 toPath，防止再次跳转
            try {
                localStorage.removeItem('toPath');
                console.log('[搜狐号重定向] ✅ 已清除 localStorage.toPath');
            } catch (e) {
                console.warn('[搜狐号重定向] ⚠️ 清除 toPath 失败:', e);
            }

            // 立即跳转到发布页
            const publishUrl = 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?contentStatus=1';
            console.log('[搜狐号重定向] 🚀 跳转到:', publishUrl);
            window.location.href = publishUrl;
        } else {
            console.log('[搜狐号重定向] 这不是发布窗口，保持在 firstPage');
        }
    } catch (error) {
        console.error('[搜狐号重定向] ❌ 检测窗口类型失败:', error);
    }

    console.log('═══════════════════════════════════════');
    console.log('✅ 搜狐号重定向脚本初始化完成');
    console.log('═══════════════════════════════════════');

})();
