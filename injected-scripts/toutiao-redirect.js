/**
 * 头条主站重定向脚本
 * 场景：授权/新窗口打开 https://www.toutiao.com/ 后，如果已登录（无登录按钮、有用户头像），
 *       自动跳转到头条创作者平台，继续授权/发布流程。
 *
 * 判定规则（父页面需求）：
 * - 无 .login-button（未显示登录按钮）
 * - 且存在用户头像图片（.user-icon 内的 img，src 含 user-avatar）
 * - 两者同时满足 => 视为已登录 => 跳转 https://mp.toutiao.com/profile_v4/index
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
    'use strict';

    // 防止重复注入（SPA 内导航会重复触发注入）
    if (window.__TOUTIAO_REDIRECT_LOADED__) {
        console.log('[头条重定向] ⚠️ 脚本已加载，跳过');
        return;
    }
    window.__TOUTIAO_REDIRECT_LOADED__ = true;

    const CREATOR_URL = 'https://mp.toutiao.com/profile_v4/index';

    console.log('═══════════════════════════════════════');
    console.log('✅ 头条主站重定向脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    // 仅处理 toutiao.com 主站
    if (!/(^|\.)toutiao\.com$/i.test(window.location.hostname)) {
        console.log('[头条重定向] ℹ️ 非 toutiao.com 域名，不处理');
        return;
    }

    const hasLoginButton = () => !!document.querySelector('.login-button');

    const hasAvatar = () => {
        // 头像图片：user-icon 容器内的 img，或 src 含 user-avatar
        if (document.querySelector('.user-icon img')) {
            return true;
        }
        return Array.from(document.querySelectorAll('img')).some((img) => {
            return (img.getAttribute('src') || '').includes('user-avatar');
        });
    };

    // 页面异步渲染：轮询等待登录态稳定后再决策
    const MAX_WAIT_MS = 15000;
    const CHECK_INTERVAL_MS = 500;
    const startTime = Date.now();

    while (Date.now() - startTime < MAX_WAIT_MS) {
        // 出现登录按钮 => 未登录，停留在当前页让用户登录
        if (hasLoginButton()) {
            console.log('[头条重定向] ⛔ 检测到 .login-button（未登录），停留在当前页');
            return;
        }

        // 无登录按钮 + 有头像 => 已登录，跳转创作者平台
        if (hasAvatar()) {
            console.log('[头条重定向] 🚀 已登录（无登录按钮 + 有头像），跳转:', CREATOR_URL);
            window.location.replace(CREATOR_URL);
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
    }

    console.log('[头条重定向] ℹ️ 等待超时，未确定登录态，保持在当前页');
})();
