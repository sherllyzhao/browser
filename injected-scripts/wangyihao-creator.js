/**
 * 网易号创作者平台授权脚本
 * 用于处理授权流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
    'use strict';

    // ===========================
    // 防止脚本重复注入
    // ===========================
    if (window.__WANGYIHAO_SCRIPT_LOADED__) {
        console.log('[网易号授权] ⚠️ 脚本已经加载过，跳过重复注入');
        return;
    }

    // ===========================
    // 页面状态检查 - 防止异常渲染
    // ===========================
    if (typeof window.checkPageStateAndReload === 'function') {
        if (!window.checkPageStateAndReload('网易号授权')) {
            return;
        }
    }

    window.__WANGYIHAO_SCRIPT_LOADED__ = true;

    console.log('═══════════════════════════════════════');
    console.log('✅ 网易号授权脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    // 检查 common.js 是否已加载
    if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
        console.error('[网易号授权] ❌ common.js 未加载！脚本可能无法正常工作');
    } else {
        console.log('[网易号授权] ✅ common.js 已加载，工具函数可用');
    }

    // ===========================
    // 1. 从 URL 获取授权数据
    // ===========================

    const urlParams = new URLSearchParams(window.location.search);
    const companyId = await window.browserAPI.getGlobalData('company_id');
    const transferId = urlParams.get('transfer_id');
    const authType = urlParams.get('auth_type') || 1;  // 从 URL 获取 auth_type，默认为 1

    console.log('[网易号授权] URL 参数:', {
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

    window.__WANGYIHAO_AUTH__ = {
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
    console.log('[网易号授权] 注册消息监听器...');

    // 防重复标志：确保数据只处理一次
    let isProcessing = false;
    let hasProcessed = false;


    if (!window.browserAPI) {
        console.error('[网易号授权] ❌ browserAPI 不可用！');
    } else {
        console.log('[网易号授权] ✅ browserAPI 可用');

        if (!window.browserAPI.onMessageFromHome) {
            console.error('[网易号授权] ❌ browserAPI.onMessageFromHome 不可用！');
        } else {
            console.log('[网易号授权] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

            window.browserAPI.onMessageFromHome(async (message) => {
                try {
                    console.log('═══════════════════════════════════════');
                    console.log('[网易号授权] 🎉 收到来自父窗口的消息!');
                    console.log('[网易号授权] 消息类型:', typeof message);
                    console.log('[网易号授权] 消息内容:', message);
                    console.log('[网易号授权] 消息.type:', message?.type);
                    console.log('[网易号授权] 消息.data:', message?.data);
                    console.log('═══════════════════════════════════════');

                    // 接收完整的授权数据
                    if (message.type === 'auth-data') {
                        console.log('[网易号授权] ✅ 收到授权数据:', message.data);

                        // 🔑 检查 windowId 是否匹配（如果消息带有 windowId）
                        if (message.windowId) {
                            const myWindowId = await window.browserAPI.getWindowId();
                            console.log('[网易号授权] 我的窗口 ID:', myWindowId, '消息目标窗口 ID:', message.windowId);
                            if (myWindowId !== message.windowId) {
                                console.log('[网易号授权] ⏭️ 消息不是发给我的，跳过');
                                return;
                            }
                            console.log('[网易号授权] ✅ windowId 匹配，处理消息');
                        }

                        // 防重复检查
                        if (isProcessing) {
                            console.warn('[网易号授权] ⚠️ 正在处理中，忽略重复消息');
                            return;
                        }
                        if (hasProcessed) {
                            console.warn('[网易号授权] ⚠️ 已经处理过，忽略重复消息');
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
                            console.log('[网易号授权] ✅ 授权数据已更新:', window.__AUTH_DATA__);

                            const response = await fetch('/wemedia/index/count.do', {
                                method: 'GET',
                                credentials: 'include',  // 自动携带 Cookie
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                            });

                            if (!response.ok) {
                                throw new Error(`HTTP error! status: ${response.status}`);
                            }

                            const result = await response.json();
                            console.log("🚀 ~  ~ result: ", result);
                            if(result.code === 1){
                                const {data} = result;
                                console.log("🚀 ~  ~ data: ", data);

                                if (!data) {
                                    throw new Error('User data not found in response');
                                }

                                // 🔑 获取完整会话数据（Cookies + Storage + IndexedDB）
                                console.log('[网易号授权] 📦 正在获取完整会话数据...');
                                let cookiesData = '';
                                try {
                                    // 同时获取两个域名的会话数据
                                    const domains = ['.163.com', 'mp.163.com'];
                                    const sessionResults = {};

                                    for (const domain of domains) {
                                        try {
                                            const sessionResult = await window.browserAPI.getFullSessionData(domain);
                                            if (sessionResult.success) {
                                                sessionResults[domain] = sessionResult.data;
                                                console.log(`[网易号授权] ✅ ${domain} 会话数据获取成功，大小: ${Math.round(sessionResult.size / 1024)} KB`);
                                            } else {
                                                console.warn(`[网易号授权] ⚠️ ${domain} 获取完整会话数据失败:`, sessionResult.error);
                                            }
                                        } catch (domainError) {
                                            console.error(`[网易号授权] ⚠️ ${domain} 获取会话数据异常:`, domainError);
                                        }
                                    }

                                    // 如果有成功的结果，合并后转为 JSON
                                    if (Object.keys(sessionResults).length > 0) {
                                        cookiesData = JSON.stringify(sessionResults);
                                    } else {
                                        // 降级为简单 cookie 字符串
                                        console.warn('[网易号授权] ⚠️ 所有域名的完整会话数据获取失败，尝试获取简单 cookies');
                                        const cookieResults = {};
                                        for (const domain of domains) {
                                            const cookieResult = await window.browserAPI.getDomainCookies(domain);
                                            if (cookieResult.success && cookieResult.cookies) {
                                                cookieResults[domain] = cookieResult.cookies;
                                            }
                                        }
                                        if (Object.keys(cookieResults).length > 0) {
                                            cookiesData = JSON.stringify(cookieResults);
                                        } else {
                                            cookiesData = document.cookie;
                                        }
                                    }
                                } catch (sessionError) {
                                    console.error('[网易号授权] ⚠️ 获取会话数据异常:', sessionError);
                                    cookiesData = document.cookie;
                                }

                                const userInfoResult = await fetch('http://mp.163.com/wemedia/navinfo.do', {
                                    method: 'GET',
                                    credentials: 'include',
                                    headers: {
                                        'Content-Type': 'application/json',
                                    },
                                })
                                const userInfoRes = await userInfoResult.json();
                                if(userInfoRes.code === 1){
                                    const userInfo = userInfoRes.data;
                                    console.log("🚀 ~  ~ userInfo: ", userInfo);
                                    const publishArticleCountResult = await fetch('http://mp.163.com/wemedia/content/manage/list.do', {
                                        method: 'POST',
                                        body: new URLSearchParams({
                                            pageNo: 1,
                                            size: 10,
                                            contentState: 3,
                                            contentType: 0,
                                            mergeUnPassed: false,
                                            filterState: 0
                                        }),
                                        credentials: 'include' // 带上 cookies
                                    });

                                    const publishArticleCountRes = await publishArticleCountResult.json();
                                    let publishArticleCount = 0;
                                    if(publishArticleCountRes.code === 1){
                                        publishArticleCount = publishArticleCountRes.data.total;
                                        console.log('[网易号授权] ✅ 发布文章数量:', publishArticleCount);
                                    }else{
                                        console.error('[网易号授权] ⚠️ 获取发布文章数量失败:', publishArticleCountRes.msg);
                                    }
                                    const scanData = {
                                        data: JSON.stringify({
                                            nickname: userInfo.tname,
                                            avatar: userInfo.icon,
                                            follow: data.yesterdaySubscribeCount,
                                            follower_count: data.totalSubscribeCount, //粉丝
                                            video: publishArticleCount, // 作品数
                                            uid: userInfo.tid,
                                            favoriting_count: data.yesterdayRecommendCount, // 收藏数
                                            total_favorited: data.totalRecommendCount, // 总收藏数
                                            company_id: companyId,
                                            auth_type: messageData.auth_type,
                                            cookies: cookiesData
                                        })
                                    };
                                    console.log("🚀 ~  ~ scanData: ", scanData);

                                    console.log('[网易号授权] 📤 准备发送数据到接口...');
                                    // 发送数据到服务器（根据环境选择域名）
                                    const apiDomain = await getApiDomain();
                                    console.log('[网易号授权] 📡 API 地址:', `${apiDomain}/api/mediaauth/wyinfo`);
                                    const apiResponse = await fetch(`${apiDomain}/api/mediaauth/wyinfo`, {
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
                                    console.log('[网易号授权] 📥 接口响应:', apiResult);

                                    if (apiResult && 'code' in apiResult && apiResult.code === 200) {
                                        console.log('[网易号授权] ✅ 数据发送成功');

                                        // 标记已完成（防止重复发送）
                                        hasProcessed = true;

                                        // 🔑 迁移登录 Cookies 到持久化 session
                                        // 因为授权窗口使用临时 session，需要把登录状态复制到持久化 session
                                        // 这样发布时才能用新授权的账号
                                        try {
                                            console.log('[网易号授权] 🔄 开始迁移 Cookies 到持久化 session...');
                                            const domainsToMigrate = ['.163.com', 'mp.163.com'];
                                            const migrateResults = {};

                                            for (const domain of domainsToMigrate) {
                                                try {
                                                    const migrateResult = await window.browserAPI.migrateCookiesToPersistent(domain);
                                                    migrateResults[domain] = migrateResult;
                                                    if (migrateResult.success) {
                                                        console.log(`[网易号授权] ✅ ${domain} Cookies 迁移成功，共迁移 ${migrateResult.migratedCount} 个`);
                                                    } else {
                                                        console.error(`[网易号授权] ⚠️ ${domain} Cookies 迁移失败:`, migrateResult.error);
                                                    }
                                                } catch (domainMigrateError) {
                                                    console.error(`[网易号授权] ⚠️ ${domain} Cookies 迁移异常:`, domainMigrateError);
                                                    migrateResults[domain] = { success: false, error: domainMigrateError.message };
                                                }
                                            }

                                            // 检查是否至少有一个域名迁移成功
                                            const anySuccess = Object.values(migrateResults).some(r => r.success);
                                            if (anySuccess) {
                                                console.log('[网易号授权] ✅ 至少一个域名的 Cookies 迁移成功');
                                            } else {
                                                console.warn('[网易号授权] ⚠️ 所有域名的 Cookies 迁移都失败了');
                                            }
                                        } catch (migrateError) {
                                            console.error('[网易号授权] ⚠️ Cookies 迁移异常:', migrateError);
                                        }

                                        // API 成功后通知父页面刷新
                                        sendMessageToParent('授权成功，刷新数据');

                                        // 统计接口成功后关闭弹窗
                                        setTimeout(() => {
                                            window.browserAPI.closeCurrentWindow();
                                        }, 1000);
                                    } else {
                                        throw new Error(apiResult.msg || apiResult.message || '上报数据失败');
                                    }
                                }else{
                                    throw new Error(userInfo.msg || userInfo.message || '获取用户信息失败');
                                }
                            }else{
                                throw new Error(result.msg || result.message || '获取数据失败');
                            }
                        }

                        // 重置处理标志（无论成功或失败）
                        isProcessing = false;
                        console.log('[网易号授权] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
                    }
                } catch (error) {
                    console.error('[网易号授权] ❌ 消息处理出错:', error);
                    isProcessing = false;
                }
            });

            console.log('[网易号授权] ✅ 消息监听器注册成功');
        }
    }

    // 自动执行授权流程

    // ===========================
    // 6. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
    // ===========================

    // 页面加载完成后向父窗口发送消息
    console.log('[网易号授权] 页面加载完成，发送 页面加载完成 消息');
    sendMessageToParent('页面加载完成');

    console.log('═══════════════════════════════════════');
    console.log('✅ 网易号授权脚本初始化完成');
    console.log('📝 全局方法: window.__WANGYIHAO_AUTH__');
    console.log('  - notifySuccess()  : 发送授权成功消息');
    console.log('  - sendMessage(msg) : 发送自定义消息');
    console.log('  - getAuthData()    : 获取授权数据');
    console.log('═══════════════════════════════════════');

})();

