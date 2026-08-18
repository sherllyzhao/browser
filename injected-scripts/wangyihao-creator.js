/**
 * 网易号创作者平台授权脚本
 * 用于处理授权流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
    'use strict';

    // ===========================
    // 🔑 检查 common.js 依赖并提供降级实现
    // ===========================
    if (typeof window.getRandomDelayMs !== "function") {
        console.warn("[网易号授权] ⚠️ common.js 未正确加载，使用降级实现");
        window.getRandomDelayMs = function (ms, jitterMs) {
            const baseMs = Number.isFinite(Number(ms)) ? Math.max(0, Math.floor(Number(ms))) : 0;
            const hasCustomJitter = jitterMs !== null && typeof jitterMs !== "undefined" && Number.isFinite(Number(jitterMs));
            const resolvedJitterMs = hasCustomJitter
                ? Math.max(0, Math.floor(Number(jitterMs)))
                : Math.max(80, Math.round(baseMs * 0.35));
            return baseMs + Math.floor(Math.random() * (resolvedJitterMs + 1));
        };
    }

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

    // 显示操作提示横幅
    if (typeof showOperationBanner === 'function') {
        showOperationBanner('正在自动授权中，请勿操作此页面...');
    }

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

    // 窗口类型判定：子窗口一律授权（管他从哪进来的），主窗口浏览不触发
    // 授权窗口标志仅用于决定"授权完成后是否自动关窗"
    let isChildWindow = false;
    let isAuthModeWindow = false;
    let hasPublishData = false;
    try {
        const detectedWindowId = await window.browserAPI?.getWindowId();
        isChildWindow = typeof detectedWindowId === 'number';
        if (isChildWindow) {
            isAuthModeWindow = !!(await window.browserAPI.getGlobalData(`auth_mode_window_${detectedWindowId}`));
            // 发布窗口不触发授权兜底（避免发布中途上报+通知父页面刷新干扰发布流程）
            hasPublishData = !!(await window.browserAPI.getGlobalData(`publish_data_window_${detectedWindowId}`));
        }
        console.log('[网易号授权] 窗口 ID:', detectedWindowId, '子窗口:', isChildWindow, '授权窗口标志:', isAuthModeWindow, '发布窗口:', hasPublishData);
    } catch (e) {
        console.warn('[网易号授权] ⚠️ 读取窗口信息失败:', e.message);
    }

    if (!window.browserAPI) {
        console.error('[网易号授权] ❌ browserAPI 不可用！');
    } else {
        console.log('[网易号授权] ✅ browserAPI 可用');

        if (!window.browserAPI.onMessageFromHome) {
            console.error('[网易号授权] ❌ browserAPI.onMessageFromHome 不可用！');
        } else {
            console.log('[网易号授权] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

            // ===========================
            // 核心授权流程（消息模式与兜底模式共用；接口优先获取用户信息）
            // ===========================
            async function processAuthorization(messageData) {
                if (isProcessing) {
                    console.warn('[网易号授权] ⚠️ 正在处理中，忽略重复调用');
                    return;
                }
                if (hasProcessed) {
                    console.warn('[网易号授权] ⚠️ 已经处理过，忽略重复调用');
                    return;
                }
                isProcessing = true;
                try {
                            const response = await fetch('https://mp.163.com/wemedia/index/count.do', {
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

                                const userInfoResult = await fetch('https://mp.163.com/wemedia/navinfo.do', {
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
                                    const publishArticleCountResult = await fetch('https://mp.163.com/wemedia/content/manage/list.do', {
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
                                            auth_type: messageData?.auth_type ?? authType,
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
                                        try { sessionStorage.setItem('wangyihao_auth_reported', '1'); } catch (e) { }

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

                                        // 统计接口成功后关闭弹窗（仅授权窗口自动关，其他入口保留窗口）
                                        if (isAuthModeWindow) {
                                            setTimeout(() => {
                                                window.browserAPI.closeCurrentWindow();
                                            }, window.getRandomDelayMs(10000));
                                        } else {
                                            console.log('[网易号授权] ℹ️ 非授权窗口，授权完成后保留窗口');
                                        }
                                    } else {
                                        throw new Error(apiResult.msg || apiResult.message || '上报数据失败');
                                    }
                                }else{
                                    throw new Error(userInfo.msg || userInfo.message || '获取用户信息失败');
                                }
                            }else{
                                throw new Error(result.msg || result.message || '获取数据失败');
                            }
                } catch (error) {
                    console.error('[网易号授权] ❌ 处理授权数据出错:', error);
                } finally {
                    isProcessing = false;
                    console.log('[网易号授权] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
                }
            }

            // ===========================
            // 消息模式：监听父窗口 auth-data（windowId 强校验后调用核心流程）
            // ===========================
            window.browserAPI.onMessageFromHome(async (message) => {
                try {
                    console.log('═══════════════════════════════════════');
                    console.log('[网易号授权] 🎉 收到来自父窗口的消息!');
                    console.log('[网易号授权] 消息内容:', message);
                    console.log('═══════════════════════════════════════');

                    // 接收完整的授权数据
                    if (message.type === 'auth-data') {
                        console.log('[网易号授权] ✅ 收到授权数据:', message.data);

                        // 🔑 强制检查 windowId（必须匹配，否则立即返回）
                        const myWindowId = await window.browserAPI.getWindowId();
                        console.log('[网易号授权] 我的窗口 ID:', myWindowId, '消息目标窗口 ID:', message.windowId);

                        if (!message.windowId) {
                          console.error('[网易号授权] ❌ 收到的 auth-data 消息缺少 windowId，这不应该发生！已拒绝处理');
                          return;
                        }

                        if (myWindowId !== message.windowId) {
                          console.warn('[网易号授权] ⚠️ 消息不是发给我的（我是 ' + myWindowId + '，消息发给 ' + message.windowId + '），拒绝处理');
                          return;
                        }

                        console.log('[网易号授权] ✅ windowId 匹配，安全处理消息');

                        if (message.data) {
                            const messageData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
                            window.__AUTH_DATA__ = {
                                ...window.__AUTH_DATA__,
                                message: messageData,
                                receivedAt: Date.now()
                            };
                            console.log('[网易号授权] ✅ 授权数据已更新:', window.__AUTH_DATA__);
                            await processAuthorization(messageData);
                        }
                    }
                } catch (error) {
                    console.error('[网易号授权] ❌ 消息处理出错:', error);
                }
            });

            console.log('[网易号授权] ✅ 消息监听器注册成功');

            // ===========================
            // 兜底模式：子窗口必须完成授权（管他从哪进来的；auth-data 丢失/一次性失败时接口轮询）
            // ===========================
            (async () => {
                try {
                    if (!isChildWindow) {
                        console.log('[网易号授权] ℹ️ 主窗口浏览，不启动兜底授权');
                        return;
                    }
                    if (hasPublishData) {
                        console.log('[网易号授权] ℹ️ 发布窗口，不启动兜底授权');
                        return;
                    }
                    // 本窗口已成功上报过就不再兜底（上报失败不置位，下次导航可重试）
                    try {
                        if (sessionStorage.getItem('wangyihao_auth_reported') === '1') {
                            console.log('[网易号授权] ℹ️ 本窗口已完成过授权上报，兜底不启动');
                            return;
                        }
                    } catch (dedupError) { }

                    // 给正常 auth-data 消息 15 秒到达时间
                    await new Promise(resolve => setTimeout(resolve, 15000));
                    if (hasProcessed) {
                        console.log('[网易号授权] ℹ️ 消息模式已完成授权，兜底退出');
                        return;
                    }

                    console.log('[网易号授权] 🚀 启动兜底授权：轮询 count.do 等待登录...');
                    const startTime = Date.now();
                    const maxWaitMs = 5 * 60 * 1000;
                    let attempt = 0;
                    while (Date.now() - startTime < maxWaitMs) {
                        if (hasProcessed) {
                            console.log('[网易号授权] ℹ️ 授权已完成，兜底轮询退出');
                            return;
                        }
                        if (isProcessing) {
                            // 消息模式正在处理，等它结束再看结果
                            await new Promise(resolve => setTimeout(resolve, 3000));
                            continue;
                        }
                        attempt++;
                        try {
                            const probe = await fetch('https://mp.163.com/wemedia/index/count.do', {
                                method: 'GET',
                                credentials: 'include',
                                headers: { 'Content-Type': 'application/json' },
                            });
                            if (probe.ok) {
                                const probeResult = await probe.json();
                                if (probeResult && probeResult.code === 1) {
                                    console.log(`[网易号授权] ✅ 兜底第 ${attempt} 次轮询检测到已登录，执行授权流程`);
                                    await processAuthorization({ auth_type: authType });
                                    if (hasProcessed) {
                                        return;
                                    }
                                    // 上报失败，10 秒后重试
                                    await new Promise(resolve => setTimeout(resolve, 10000));
                                    continue;
                                }
                            }
                            if (attempt === 1 || attempt % 10 === 0) {
                                console.log(`[网易号授权] ⏳ 兜底第 ${attempt} 次轮询：未登录，等待扫码...`);
                            }
                        } catch (probeError) {
                            if (attempt === 1 || attempt % 10 === 0) {
                                console.warn(`[网易号授权] ⏳ 兜底第 ${attempt} 次轮询异常:`, probeError.message);
                            }
                        }
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                    console.error('[网易号授权] ❌ 兜底轮询超时（5分钟），未完成授权');
                } catch (fallbackError) {
                    console.error('[网易号授权] ❌ 兜底授权异常:', fallbackError);
                }
            })();
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

    // ===========================
    // 7. 检查是否有发布数据需要恢复（登录跳转后返回首页的情况）
    // ===========================
    setTimeout(async () => {
        try {
            // 获取当前窗口 ID
            const windowId = await window.browserAPI.getWindowId();
            if (!windowId) {
                console.log('[网易号授权] ℹ️ 无法获取窗口 ID，跳过发布数据检查');
                return;
            }

            // 检查 globalData 中是否有发布数据（发布脚本保存的）
            const globalPublishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);

            console.log('[网易号授权] 🔍 检查发布数据:', {
                globalData: globalPublishData ? '有' : '无',
                windowId
            });

            if (globalPublishData) {
                // 检查是否为授权窗口（main.js 在临时 session 窗口打开时设置此标记）
                const isAuthWindow = await window.browserAPI.getGlobalData(`auth_mode_window_${windowId}`);
                if (isAuthWindow) {
                    // 🔑 授权流程：publish_data 是残留脏数据（窗口 ID 复用），清除并跳过
                    console.log('[网易号授权] ⚠️ 授权窗口中检测到残留的发布数据，清除它');
                    await window.browserAPI.removeGlobalData(`publish_data_window_${windowId}`);
                    console.log('[网易号授权] 🗑️ 已清除残留的 publish_data_window_' + windowId);
                    console.log('[网易号授权] ℹ️ 继续正常授权流程');
                } else {
                    // 🔑 发布掉登录恢复（URL 无 transfer_id）：跳回发布页继续发布
                    console.log('[网易号授权] ✅ 检测到发布数据，这是从发布流程登录后跳回来的');
                    console.log('[网易号授权] 🔄 准备自动跳转到发布页...');

                    // 等待页面完全加载
                    await window.delay(1000);

                    // 网易号发布页是 SPA 的 hash 路由，直接修改 hash 即可跳转
                    const publishHash = '#/article-publish';
                    console.log('[网易号授权] 🔗 跳转到发布页:', publishHash);
                    window.location.hash = publishHash;
                    console.log('[网易号授权] ✅ 已跳转到发布页');
                }
            } else {
                console.log('[网易号授权] ℹ️ 没有发布数据，这是正常的授权流程');
            }
        } catch (error) {
            console.error('[网易号授权] ❌ 检查发布数据失败:', error);
        }
    }, window.getRandomDelayMs(2000)); // 延迟2秒，等待页面完全加载

})();

