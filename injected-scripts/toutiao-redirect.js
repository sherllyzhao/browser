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
 * 未登录时进入登录守望（最长 10 分钟）：头条弹窗登录成功后不一定整页刷新，
 * SPA 局部更新不会触发脚本重注入（防重标志也会挡住重注入），
 * 所以必须由本实例守望登录态，登录成功后接力执行跳转。
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

    // 页面异步渲染 + 登录守望：持续轮询，满足已登录条件即跳转
    const LOGIN_WATCH_MAX_MS = 10 * 60 * 1000; // 给足扫码/输密码/收验证码的时间
    const CHECK_INTERVAL_MS = 500;
    const startTime = Date.now();
    let waitingForLogin = false;

    while (Date.now() - startTime < LOGIN_WATCH_MAX_MS) {
        // 无登录按钮 + 有头像 => 已登录，跳转创作者平台
        if (!hasLoginButton() && hasAvatar()) {
            console.log('[头条重定向] 🚀 已登录（无登录按钮 + 有头像），即将跳转:', CREATOR_URL);
            if (typeof showOperationBanner === 'function') {
                showOperationBanner('登录成功，正在进入授权流程...');
            }
            // 刚登录完稍等片刻，让 cookie/storage 落定后再离开主站
            const delayMs = typeof window.getRandomDelayMs === 'function'
                ? window.getRandomDelayMs(1500)
                : 1500 + Math.floor(Math.random() * 600);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            window.location.replace(CREATOR_URL);
            return;
        }

        // 出现登录按钮 => 未登录：停留当前页守望，用户登录成功后由本循环接力跳转
        // （不能 return 放弃：弹窗登录成功若不整页刷新，就再没有跳转的机会了）
        if (hasLoginButton() && !waitingForLogin) {
            waitingForLogin = true;
            console.log('[头条重定向] ⏳ 检测到 .login-button（未登录），进入登录守望，最长等待 10 分钟');
            if (typeof showOperationBanner === 'function') {
                showOperationBanner('请完成登录，登录成功后将自动进入授权流程...');
            }
        }

        await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
    }

    console.log('[头条重定向] ℹ️ 登录守望超时（10 分钟），未确定登录态，保持在当前页');
})();
