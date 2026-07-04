/**
 * 搜狐号创作者平台授权脚本
 * 用于处理授权流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

// 🔑 注意：授权脚本不应该设置 toPath
// 原因：授权流程需要用户停留在首页获取账号信息
// 如果设置 toPath 为发布页，会导致：
// - 登录成功后尝试跳转到发布页 → 需要短信验证 → 又跳回验证页 → 循环
// toPath 的设置应该只在发布脚本（souhuhao-publish.js）中进行

(async function () {
    'use strict';

    // 🔑 平台配置（在 IIFE 内部定义，避免与发布脚本冲突）
    const PLATFORM_CONFIG = {
        name: '搜狐号',
        publishPagePath: '/contentManagement/news/addarticle',
        publishPageUrl: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle',
        firstPageUrl: 'https://mp.sohu.com/mpfe/v4/contentManagement/first/page',
        domain: 'mp.sohu.com',
        cookiesDomain: 'mp.sohu.com'
    };

    // 🔑 搜狐号登录 Cookie 所在域名（迁移时按这些域名过滤）
    const SOUHUHAO_SESSION_DOMAINS = ['sohu.com', 'mp.sohu.com'];

    // 读取当前窗口对应的发布数据（若授权是在发布窗口内重新扫码，则能拿到发布账号上下文）
    const getPublishWindowData = async () => {
        try {
            if (!window.browserAPI?.getWindowId || !window.browserAPI?.getGlobalData) {
                return null;
            }
            const windowId = await window.browserAPI.getWindowId();
            if (!windowId) {
                return null;
            }
            return await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
        } catch (err) {
            console.warn('[搜狐号授权] ⚠️ 读取窗口发布数据失败:', err);
            return null;
        }
    };

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

    // 显示操作提示横幅
    if (typeof showOperationBanner === 'function') {
        showOperationBanner('正在自动授权中，请勿操作此页面...');
    }

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

    // 缓存发布窗口数据（若存在，说明是在发布窗口内重新授权，后续用于回写对应账号 session）
    let cachedPublishWindowData = await getPublishWindowData();
    if (cachedPublishWindowData) {
        console.log('[搜狐号授权] 📦 已缓存发布窗口数据，后续将用于回写账号 session');
    }

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
                            // 发送数据到服务器（根据环境选择域名）
                            const apiDomain = await getApiDomain();
                            console.log('[搜狐号授权] 📡 API 地址:', `${apiDomain}/api/mediaauth/shinfo`);
                            const apiResponse = await fetch(`${apiDomain}/api/mediaauth/shinfo`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(scanData)
                            });

                            // 读取响应体（先 text 再尝试 JSON，便于 alert 完整 dump）
                            const apiResponseText = await apiResponse.text();
                            let apiResult = null;
                            try { apiResult = JSON.parse(apiResponseText); } catch (_) {}

                            // 🔔 调试 alert（与发布窗口关闭时的 alert 字段对齐，便于对比）
                            try {
                                const cookiesSizeKB = Math.round((cookiesData ? cookiesData.length : 0) / 1024);
                                const okFlag = apiResponse.ok && apiResult && apiResult.code === 200;
                                const debugMsg = okFlag
                                    ? `✅ 授权保存成功（搜狐号）\n窗口: 授权窗口\n平台: sohuhao\n后台账号ID(uid): ${currentAccount?.id || '无'}\n账号昵称: ${currentAccount?.nickName || '未知'}\nCookies 数据大小: ${cookiesSizeKB} KB\nHTTP 状态: ${apiResponse.status}\n接口 code: ${apiResult?.code}`
                                    : `❌ 授权保存失败（搜狐号）\n窗口: 授权窗口\n平台: sohuhao\n后台账号ID(uid): ${currentAccount?.id || '无'}\n账号昵称: ${currentAccount?.nickName || '未知'}\nCookies 数据大小: ${cookiesSizeKB} KB\nHTTP 状态: ${apiResponse.status}\n接口 code: ${apiResult?.code ?? '-'}\n响应: ${apiResponseText.slice(0, 200)}`;
                                alert(debugMsg);
                            } catch (alertErr) {
                                console.warn('[搜狐号授权] ⚠️ 弹 alert 失败:', alertErr.message);
                            }

                            // 检查响应状态
                            if (!apiResponse.ok) {
                                throw new Error(`Statistics API failed with status: ${apiResponse.status}`);
                            }
                            if (!apiResult) {
                                throw new Error('授权接口响应不是 JSON: ' + apiResponseText.slice(0, 100));
                            }

                            console.log('[搜狐号授权] 📥 接口响应:', apiResult);

                            if (apiResult && 'code' in apiResult && apiResult.code === 200) {
                                console.log('[搜狐号授权] ✅ 数据发送成功');

                                // 标记已完成（防止重复发送）
                                hasProcessed = true;

                                // 🔑 迁移登录 Cookies 到发布时使用的 session
                                // 授权窗口使用临时 session，必须把登录状态写到发布窗口会读取的 session：
                                //   - 发布窗口用的是账号独立 session：persist:souhuhao_<account_info.id>
                                //   - 因此优先迁移到该账号 session，发布时才不会掉登录/用错账号
                                //   - 若没有发布账号上下文（首次独立授权），回退迁移到持久化 session
                                try {
                                    const publishData = cachedPublishWindowData || await getPublishWindowData();
                                    const publishAccountId = publishData?.element?.account_info?.id
                                        || publishData?.element?.accountInfo?.id
                                        || '';
                                    const publishPlatform = publishData?.platform || 'souhuhao';

                                    if (publishAccountId && window.browserAPI?.migrateCookiesToAccountSession) {
                                        console.log('[搜狐号授权] 🔄 迁移 Cookies 到当前发布账号 session...', {
                                            publishPlatform,
                                            publishAccountId,
                                            domains: SOUHUHAO_SESSION_DOMAINS
                                        });
                                        let totalMigrated = 0;
                                        for (const domain of SOUHUHAO_SESSION_DOMAINS) {
                                            const migrateResult = await window.browserAPI.migrateCookiesToAccountSession(domain, publishPlatform, String(publishAccountId));
                                            if (migrateResult.success) {
                                                totalMigrated += migrateResult.migratedCount || 0;
                                                console.log(`[搜狐号授权] ✅ ${domain} 已写回当前发布账号 session，迁移 ${migrateResult.migratedCount || 0} 个 cookies`);
                                            } else {
                                                console.error(`[搜狐号授权] ⚠️ ${domain} 写回当前发布账号 session 失败:`, migrateResult.error);
                                            }
                                        }
                                        console.log(`[搜狐号授权] ✅ 当前发布账号 session 回写完成，共迁移 ${totalMigrated} 个 cookies`);
                                    } else {
                                        console.log('[搜狐号授权] ℹ️ 未获取到发布账号上下文，回退迁移到持久化 session');
                                        let totalMigrated = 0;
                                        for (const domain of SOUHUHAO_SESSION_DOMAINS) {
                                            const migrateResult = await window.browserAPI.migrateCookiesToPersistent(domain);
                                            if (migrateResult.success) {
                                                totalMigrated += migrateResult.migratedCount || 0;
                                                console.log(`[搜狐号授权] ✅ ${domain} Cookies 迁移成功，迁移 ${migrateResult.migratedCount} 个`);
                                            } else {
                                                console.error(`[搜狐号授权] ⚠️ ${domain} Cookies 迁移失败:`, migrateResult.error);
                                            }
                                        }
                                        console.log(`[搜狐号授权] ✅ 多域名 Cookies 迁移完成，共迁移 ${totalMigrated} 个`);
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
                                    }, 10000);
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

