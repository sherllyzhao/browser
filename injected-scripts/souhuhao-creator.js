/**
 * 搜狐号创作者平台授权脚本
 * 用于处理授权流程和数据传输
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

// 🔑 最优先：在脚本最顶部劫持 localStorage 和 window.location，防止 toPath 导致页面跳转
(function() {
    'use strict';

    console.log('[搜狐号授权] 🛡️ 在脚本最顶部劫持 localStorage 和 window.location');
    try {
        const originalSetItem = localStorage.setItem.bind(localStorage);
        const originalGetItem = localStorage.getItem.bind(localStorage);
        const originalRemoveItem = localStorage.removeItem.bind(localStorage);

        // 劫持 setItem，阻止设置 toPath
        localStorage.setItem = function(key, value) {
            if (key === 'toPath') {
                console.log('[搜狐号授权] 🚫 阻止修改 toPath:', value);
                return; // 直接返回，不执行设置
            }
            return originalSetItem(key, value);
        };

        // 劫持 getItem，toPath 永远返回发布页路径
        localStorage.getItem = function(key) {
            if (key === 'toPath') {
                console.log('[搜狐号授权] 🔄 拦截读取 toPath，返回发布页路径');
                return PLATFORM_CONFIG.publishPagePath; // 返回发布页路径
            }
            return originalGetItem(key);
        };

        // 劫持 removeItem，阻止删除 toPath
        localStorage.removeItem = function(key) {
            if (key === 'toPath') {
                console.log('[搜狐号授权] 🚫 阻止删除 toPath');
                return; // 直接返回，不执行删除
            }
            return originalRemoveItem(key);
        };

        // 🔑 劫持 window.location 的所有跳转方法，防止跳转到首页
        const originalReplace = window.location.replace.bind(window.location);
        const originalAssign = window.location.assign.bind(window.location);

        window.location.replace = function(url) {
            console.log('[搜狐号授权] 🚫 检测到 location.replace:', url);
            if (url.includes('firstPage') || url.includes('first/page')) {
                console.log('[搜狐号授权] 🚫 阻止跳转到首页');
                return; // 阻止跳转
            }
            return originalReplace(url);
        };

        window.location.assign = function(url) {
            console.log('[搜狐号授权] 🚫 检测到 location.assign:', url);
            if (url.includes('firstPage') || url.includes('first/page')) {
                console.log('[搜狐号授权] 🚫 阻止跳转到首页');
                return; // 阻止跳转
            }
            return originalAssign(url);
        };

        // 🔑 劫持 history.pushState 和 history.replaceState，防止通过 history API 跳转
        const originalPushState = window.history.pushState.bind(window.history);
        const originalReplaceState = window.history.replaceState.bind(window.history);

        window.history.pushState = function(state, title, url) {
            console.log('[搜狐号授权] 🚫 检测到 history.pushState:', url);
            if (url && (url.includes('firstPage') || url.includes('first/page'))) {
                console.log('[搜狐号授权] 🚫 阻止通过 history.pushState 跳转到首页');
                return; // 阻止跳转
            }
            return originalPushState(state, title, url);
        };

        window.history.replaceState = function(state, title, url) {
            console.log('[搜狐号授权] 🚫 检测到 history.replaceState:', url);
            if (url && (url.includes('firstPage') || url.includes('first/page'))) {
                console.log('[搜狐号授权] 🚫 阻止通过 history.replaceState 跳转到首页');
                return; // 阻止跳转
            }
            return originalReplaceState(state, title, url);
        };

        console.log('[搜狐号授权] ✅ localStorage 和 window.location 劫持完成');
    } catch (e) {
        console.error('[搜狐号授权] ❌ 劫持失败:', e);
    }
})();

(async function () {
    'use strict';

    // ===========================
    // 防止脚本重复注入
    // ===========================
    if (window.__SOUHUHAO_SCRIPT_LOADED__) {
        console.log('[搜狐号授权] ⚠️ 脚本已经加载过，跳过重复注入');
        return;
    }

    // ===========================
    // 页面状态检查 - 防止异常渲染
    // ===========================
    if (typeof window.checkPageStateAndReload === 'function') {
        if (!window.checkPageStateAndReload('搜狐号授权')) {
            return;
        }
    }

    window.__SOUHUHAO_SCRIPT_LOADED__ = true;

    console.log('═══════════════════════════════════════');
    console.log('✅ 搜狐号授权脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    // 检查 common.js 是否已加载
    if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
        console.error('[搜狐号授权] ❌ common.js 未加载！脚本可能无法正常工作');
    } else {
        console.log('[搜狐号授权] ✅ common.js 已加载，工具函数可用');
    }

    // ===========================
    // 1. 从 URL 获取授权数据
    // ===========================

    const urlParams = new URLSearchParams(window.location.search);
    const companyId = await window.browserAPI.getGlobalData('company_id');
    const transferId = urlParams.get('transfer_id');
    const authType = urlParams.get('auth_type') || 1;  // 从 URL 获取 auth_type，默认为 1

    console.log('[搜狐号授权] URL 参数:', {
        companyId,
        transferId,
        authType
    });

    // 存储授权数据到全局
    window.__AUTH_DATA__ = {
        companyId,
        transferId,
        timestamp: Date.now()
    };

    // ===========================
    // 2. 发送消息到父窗口的辅助函数（使用 common.js）
    // ===========================

    // ===========================
    // 3. 暴露全局方法供手动调用
    // ===========================

    window.__SOUHUHAO_AUTH__ = {
        // 发送授权成功消息
        notifySuccess: () => {
            sendMessageToParent('授权成功');
        },

        // 发送自定义消息
        sendMessage: (message) => {
            sendMessageToParent(message);
        },

        // 获取授权数据
        getAuthData: () => window.__AUTH_DATA__,
    };

    // ===========================
    // 4. 显示调试信息横幅
    // ===========================

    // ===========================
    // 5. 接收来自父窗口的消息（必须在发送 页面加载完成 之前注册！）
    // ===========================
    console.log('[搜狐号授权] 注册消息监听器...');

    // 防重复标志：确保数据只处理一次
    let isProcessing = false;
    let hasProcessed = false;


    if (!window.browserAPI) {
        console.error('[搜狐号授权] ❌ browserAPI 不可用！');
    } else {
        console.log('[搜狐号授权] ✅ browserAPI 可用');

        if (!window.browserAPI.onMessageFromHome) {
            console.error('[搜狐号授权] ❌ browserAPI.onMessageFromHome 不可用！');
        } else {
            console.log('[搜狐号授权] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

            window.browserAPI.onMessageFromHome(async (message) => {
                try {
                    console.log('═══════════════════════════════════════');
                    console.log('[搜狐号授权] 🎉 收到来自父窗口的消息!');
                    console.log('[搜狐号授权] 消息类型:', typeof message);
                    console.log('[搜狐号授权] 消息内容:', message);
                    console.log('[搜狐号授权] 消息.type:', message?.type);
                    console.log('[搜狐号授权] 消息.data:', message?.data);
                    console.log('═══════════════════════════════════════');

                    // 接收完整的授权数据
                    if (message.type === 'auth-data') {
                        console.log('[搜狐号授权] ✅ 收到授权数据:', message.data);

                        // 🔑 检查 windowId 是否匹配（如果消息带有 windowId）
                        if (message.windowId) {
                            const myWindowId = await window.browserAPI.getWindowId();
                            console.log('[搜狐号授权] 我的窗口 ID:', myWindowId, '消息目标窗口 ID:', message.windowId);
                            if (myWindowId !== message.windowId) {
                                console.log('[搜狐号授权] ⏭️ 消息不是发给我的，跳过');
                                return;
                            }
                            console.log('[搜狐号授权] ✅ windowId 匹配，处理消息');
                        }

                        // 防重复检查
                        if (isProcessing) {
                            console.warn('[搜狐号授权] ⚠️ 正在处理中，忽略重复消息');
                            return;
                        }
                        if (hasProcessed) {
                            console.warn('[搜狐号授权] ⚠️ 已经处理过，忽略重复消息');
                            return;
                        }

                        // 标记为正在处理
                        isProcessing = true;

                        // 更新全局变量
                        if (message.data) {
                            const messageData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
                            window.__AUTH_DATA__ = {
                                ...window.__AUTH_DATA__,
                                message: messageData,
                                receivedAt: Date.now()
                            };
                            console.log('[搜狐号授权] ✅ 授权数据已更新:', window.__AUTH_DATA__);

                            const currentAccount = localStorage.getItem('currentAccount') ? JSON.parse(localStorage.getItem('currentAccount')) : null;

                            // 🔑 获取完整会话数据（Cookies + Storage + IndexedDB）
                            console.log('[搜狐号授权] 📦 正在获取完整会话数据...');
                            let cookiesData = '';
                            try {
                                const sessionResult = await window.browserAPI.getFullSessionData('mp.sohu.com');
                                if (sessionResult.success) {
                                    console.log("🚀 ~  ~ sessionResult.data: ", sessionResult.data);

                                    // 🔑 手动删除 localStorage 中的 toPath，防止发布页自动跳转
                                    if (sessionResult.data.localStorage && sessionResult.data.localStorage.toPath) {
                                        console.log('[搜狐号授权] 🧹 检测到 toPath:', sessionResult.data.localStorage.toPath);
                                        delete sessionResult.data.localStorage.toPath;
                                        console.log('[搜狐号授权] ✅ 已从会话数据中删除 toPath');
                                    }

                                    cookiesData = JSON.stringify(sessionResult.data);
                                    console.log(`[搜狐号授权] ✅ 会话数据获取成功，大小: ${Math.round(sessionResult.size / 1024)} KB`);
                                } else {
                                    console.warn('[搜狐号授权] ⚠️ 获取完整会话数据失败:', sessionResult.error);
                                    // 降级为简单 cookie 字符串
                                    const cookieResult = await window.browserAPI.getDomainCookies('https://mp.sohu.com/mpfe/v4/contentManagement/first/page');
                                    if (cookieResult.success && cookieResult.cookies) {
                                        cookiesData = cookieResult.cookies;
                                    }
                                }
                            } catch (sessionError) {
                                console.error('[搜狐号授权] ⚠️ 获取会话数据异常:', sessionError);
                                cookiesData = document.cookie;
                            }

                            /* const statisticsResult = await fetch(`https://mp.sohu.com/mpbp/bp/news/v4/users/newsInfo?accountId=${currentAccount.id}&_=${Date.now() + 1200}`, {
                                method: 'GET',
                                credentials: 'include',  // 自动携带 Cookie
                            });
                            console.log("🚀 ~  ~ statisticsResult: ", statisticsResult);

                            if (!statisticsResult.ok) {
                                throw new Error(`HTTP error! status: ${statisticsResult.status}`);
                            }

                            const statisticsRes = await statisticsResult.json();
                            console.log("🚀 ~  ~ statisticsRes: ", statisticsRes);
                            const statisticsData = statisticsRes.data;
                            console.log("🚀 ~  ~ statisticsData: ", statisticsData); */

                            await delay(1000);
                            const eleClass = await waitForElement('.read-info-info-item:nth-of-type(2) .number-icon');
                            console.log("🚀 ~  ~ eleClass: ", eleClass);
                            const eleClassList = eleClass.classList;
                            let videoCount = 0;
                            eleClassList.forEach(item => {
                                if (item.startsWith('mp-iconnumber_')) {
                                    videoCount = parseInt(item.replace('mp-iconnumber_', ''));
                                }
                            });

                            const scanData = {
                                data: JSON.stringify({
                                    nickname: currentAccount.nickName,
                                    avatar: currentAccount.avatar,
                                    follow: 0,
                                    follower_count: 0, //粉丝
                                    video: videoCount, // 作品数
                                    uid: currentAccount.id,
                                    favoriting_count: 0, // 收藏数
                                    total_favorited: 0, // 总收藏数
                                    company_id: companyId,
                                    auth_type: messageData.auth_type,
                                    cookies: cookiesData
                                })
                            };
                            console.log(JSON.stringify(cookiesData));
                            console.log("🚀 ~  ~ scanData: ", scanData);
                            //return;

                            console.log('[搜狐号授权] 📤 准备发送数据到接口...');
                            // 发送数据到服务器
                            const apiResponse = await fetch('https://apidev.china9.cn/api/mediaauth/shinfo', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(scanData)
                            });

                            // 检查响应状态
                            if (!apiResponse.ok) {
                                throw new Error(`Statistics API failed with status: ${apiResponse.status}`);
                            }

                            const apiResult = await apiResponse.json();
                            console.log('[搜狐号授权] 📥 接口响应:', apiResult);

                            if (apiResult && 'code' in apiResult && apiResult.code === 200) {
                                console.log('[搜狐号授权] ✅ 数据发送成功');

                                // 标记已完成（防止重复发送）
                                hasProcessed = true;

                                // 🔑 迁移登录 Cookies 到持久化 session
                                // 因为授权窗口使用临时 session，需要把登录状态复制到持久化 session
                                // 这样发布时才能用新授权的账号
                                try {
                                    console.log('[搜狐号授权] 🔄 开始迁移 Cookies 到持久化 session...');
                                    const migrateResult = await window.browserAPI.migrateCookiesToPersistent('mp.sohu.com');
                                    if (migrateResult.success) {
                                        console.log(`[搜狐号授权] ✅ Cookies 迁移成功，共迁移 ${migrateResult.migratedCount} 个`);
                                    } else {
                                        console.error('[搜狐号授权] ⚠️ Cookies 迁移失败:', migrateResult.error);
                                    }
                                } catch (migrateError) {
                                    console.error('[搜狐号授权] ⚠️ Cookies 迁移异常:', migrateError);
                                }

                                // API 成功后通知父页面刷新
                                sendMessageToParent('授权成功，刷新数据');

                                // 开发模式下不关闭窗口（browserAPI.isProduction 为 false 时是开发环境）
                                const isDev = window.browserAPI && window.browserAPI.isProduction === false;
                                if (isDev) {
                                    console.log('[发布成功] 🔧 开发模式：跳过关闭窗口，可查看控制台');
                                    return;
                                }else{
                                    // 统计接口成功后关闭弹窗
                                    setTimeout(() => {
                                        window.browserAPI.closeCurrentWindow();
                                    }, 1000);
                                }
                            } else {
                                throw new Error(apiResult.msg || apiResult.message || '上报数据失败');
                            }
                        }

                        // 重置处理标志（无论成功或失败）
                        isProcessing = false;
                        console.log('[搜狐号授权] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
                    }
                } catch (error) {
                    console.error('[搜狐号授权] ❌ 消息处理出错:', error);
                    isProcessing = false;
                }
            });

            console.log('[搜狐号授权] ✅ 消息监听器注册成功');
        }
    }

    // 自动执行授权流程

    // ===========================
    // 6. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
    // ===========================

    // 页面加载完成后向父窗口发送消息
    console.log('[搜狐号授权] 页面加载完成，发送 页面加载完成 消息');
    sendMessageToParent('页面加载完成');

    console.log('═══════════════════════════════════════');
    console.log('✅ 搜狐号授权脚本初始化完成');
    console.log('📝 全局方法: window.__SOUHUHAO_AUTH__');
    console.log('  - notifySuccess()  : 发送授权成功消息');
    console.log('  - sendMessage(msg) : 发送自定义消息');
    console.log('  - getAuthData()    : 获取授权数据');
    console.log('═══════════════════════════════════════');

})();

