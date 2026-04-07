/**
 * 新浪微博重定向脚本
 * 场景：
 * 1. 发布页登录过期后，新浪自身会跳到 weibo.com 首页
 * 2. 普通未登录场景，应该回到新浪创作者平台而不是停在微博首页
 * 3. 新浪有时不会稳定携带 sudaref，因此不能只靠单一参数判断
 *
 * 处理规则：
 * - 未登录时，优先跳到新浪创作者入口登录
 * - 已登录且有发布恢复数据时，跳回发布页
 * - 已登录但没有发布恢复数据时，跳到新浪创作者入口
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
    // 1. 检查当前页面是否属于需要兜底处理的微博落地页
    // ===========================
    const urlParams = new URLSearchParams(window.location.search);
    const sudaref = urlParams.get('sudaref');
    const nestedTargetUrlRaw = urlParams.get('url') || '';
    const currentUrl = new URL(window.location.href);
    const isWeiboHost = /(^|\.)weibo\.com$/i.test(currentUrl.hostname);
    const isWeiboLandingPage = isWeiboHost
        && (
            currentUrl.pathname === '/'
            || currentUrl.pathname === ''
            || currentUrl.pathname === '/u/page/fav'
        );
    const isWeiboLoginPage = isWeiboHost
        && (
            currentUrl.pathname === '/newlogin'
            || currentUrl.pathname.startsWith('/login')
        );

    let nestedSudaref = '';
    try {
        if (nestedTargetUrlRaw) {
            const decoded = decodeURIComponent(nestedTargetUrlRaw);
            const nestedUrl = new URL(decoded);
            nestedSudaref = new URLSearchParams(nestedUrl.search).get('sudaref') || '';
        }
    } catch (e) {
        console.warn('[新浪重定向] ⚠️ 解析嵌套 url 参数失败:', e.message);
    }

    const fromXinlangPublish = (
        (sudaref && sudaref.includes('card.weibo.com'))
        || (nestedSudaref && nestedSudaref.includes('card.weibo.com'))
    );

    if (!isWeiboHost) {
        console.log('[新浪重定向] ℹ️ 当前页面不是 weibo.com 域名，不处理');
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
    // 3. 根据窗口状态和页面特征选择是否接管
    // - 发布流程：回编辑页，依赖 window-loaded 重发消息恢复发布
    // - 非发布流程：回新浪创作者入口，避免卡在 weibo.com 首页
    // ===========================
    const publishDataKey = `publish_data_window_${windowId}`;
    const publishSuccessKey = `PUBLISH_SUCCESS_DATA_${windowId}`;
    const creatorUrl = 'https://mp.sina.com.cn/';
    const publishUrl = 'https://card.weibo.com/article/v5/editor#/draft';

    let publishData = null;
    let publishSuccessData = null;

    try {
        publishData = await window.browserAPI?.getGlobalData?.(publishDataKey);
        publishSuccessData = await window.browserAPI?.getGlobalData?.(publishSuccessKey);
        console.log('[新浪重定向] 📦 publish_data:', publishData ? '有数据' : '无数据');
        console.log('[新浪重定向] 📦 publish_success_data:', publishSuccessData ? '有数据' : '无数据');
    } catch (e) {
        console.error('[新浪重定向] ❌ 读取发布恢复数据失败:', e);
    }

    const hasPublishContext = !!(publishData || publishSuccessData);
    const shouldHandleRedirect = fromXinlangPublish || hasPublishContext || isWeiboLandingPage || isWeiboLoginPage;

    if (!shouldHandleRedirect) {
        console.log('[新浪重定向] ℹ️ 既不是新浪发布回跳，也不是微博首页兜底场景，不处理');
        return;
    }

    const cookieString = document.cookie || '';
    const hasWeiboLoginCookie = ['SUB=', 'ALF=', 'SSOLoginState='].some((cookieKey) => {
        return cookieString.includes(cookieKey);
    });

    console.log('[新浪重定向] 🍪 登录态检查:', {
        fromXinlangPublish,
        isWeiboLoginPage,
        nestedSudaref,
        isWeiboLandingPage,
        hasPublishContext,
        hasWeiboLoginCookie,
        cookieLength: cookieString.length
    });

    let targetUrl = creatorUrl;
    let targetLabel = '新浪创作者入口';
    let scenario = '未登录';

    if (hasWeiboLoginCookie && hasPublishContext) {
        targetUrl = publishUrl;
        targetLabel = '发布页';
        scenario = '已登录且有发布恢复数据';
    } else if (hasWeiboLoginCookie) {
        scenario = '已登录但无发布恢复数据';
    }

    console.log(`[新浪重定向] 🚀 检测到${scenario}场景，重定向到${targetLabel}:`, targetUrl);
    window.location.href = targetUrl;

})();
