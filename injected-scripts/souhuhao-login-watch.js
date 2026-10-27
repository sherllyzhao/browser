/**
 * 搜狐号根页面登录状态监听。
 * 检测到已登录账号入口后，跳转到个人中心账号页。
 */
(function watchSohuLoginState() {
    'use strict';

    const ACCOUNT_LINK_SELECTORS = [
        '.CreatorProfile .login .account a',
        '[href*="/personalCenter/account"]'
    ];
    const AUTHORIZED_PAGE_URL = 'https://mp.sohu.com/mpfe/v4/personalCenter/account?curTab=1';
    let redirecting = false;

    const hasCurrentAccount = () => {
        try {
            const rawAccount = window.localStorage.getItem('currentAccount');
            if (!rawAccount) {
                return false;
            }
            const account = JSON.parse(rawAccount);
            return !!account && account.id !== null && typeof account.id !== 'undefined';
        } catch (error) {
            console.warn('[搜狐号登录监听] currentAccount 解析失败:', error.message);
            return false;
        }
    };

    const hasAccountEntry = () => ACCOUNT_LINK_SELECTORS.some(selector => document.querySelector(selector));

    const checkLoginState = () => {
        if (redirecting || (!hasAccountEntry() && !hasCurrentAccount())) {
            return;
        }

        redirecting = true;
        console.log('[搜狐号登录监听] 检测到登录状态，跳转到个人中心账号页');
        window.location.replace(AUTHORIZED_PAGE_URL);
    };

    checkLoginState();
    if (!redirecting) {
        if (typeof MutationObserver !== 'function') {
            console.warn('[搜狐号登录监听] 当前环境不支持 MutationObserver，无法持续检测登录状态');
            return;
        }

        const observer = new MutationObserver(() => {
            checkLoginState();
            if (redirecting) {
                observer.disconnect();
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }
})();
