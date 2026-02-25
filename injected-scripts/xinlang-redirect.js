/**
 * 新浪微博重定向脚本
 * 场景：重新发布时登录过期，重新登录后跳到 weibo.com 首页而非发布页
 * 检测 URL 含 sudaref=card.weibo.com 且是新窗口时，直接跳回发布页
 * 跳回后 did-finish-load 触发 window-loaded 事件，首页会重新发送发布数据
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
    'use strict';

    // 防止重复注入
    if (window.__XINLANG_REDIRECT_LOADED__) {
        console.log('[新浪重定向] ⚠️ 脚本已加载，跳过');
        return;
    }
    window.__XINLANG_REDIRECT_LOADED__ = true;

    console.log('═══════════════════════════════════════');
    console.log('✅ 新浪重定向脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    // ===========================
    // 1. 检查 URL 参数，确认是从 card.weibo.com 登录跳转过来的
    // ===========================
    const urlParams = new URLSearchParams(window.location.search);
    const sudaref = urlParams.get('sudaref');

    if (!sudaref || !sudaref.includes('card.weibo.com')) {
        console.log('[新浪重定向] ℹ️ sudaref 不是 card.weibo.com，非发布页登录跳转，不处理');
        return;
    }

    // ===========================
    // 2. 确认是新窗口（非主窗口 BrowserView）
    // ===========================
    let windowId = null;
    try {
        windowId = await window.browserAPI.getWindowId();
        console.log('[新浪重定向] 🔑 当前窗口 ID:', windowId);

        if (windowId === 'main') {
            console.log('[新浪重定向] ℹ️ 是主窗口，不需要重定向');
            return;
        }
    } catch (e) {
        console.error('[新浪重定向] ❌ 获取窗口 ID 失败:', e);
    }

    // ===========================
    // 3. 直接跳回发布页
    // 发布数据通过 sendToOtherPage 消息传递，不在 globalData 中
    // 跳回发布页后 did-finish-load 触发 window-loaded，首页会重新发送数据
    // ===========================
    const publishUrl = 'https://card.weibo.com/article/v5/editor#/draft';
    console.log('[新浪重定向] 🚀 从 card.weibo.com 登录跳转，重定向回发布页:', publishUrl);
    window.location.href = publishUrl;

})();
