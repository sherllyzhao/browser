/**
 * 小红书创作者平台授权脚本
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
        console.warn("[小红书授权] ⚠️ common.js 未正确加载，使用降级实现");
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
    if (window.__DOUYIN_SCRIPT_LOADED__) {
        console.log('[小红书授权] ⚠️ 脚本已经加载过，跳过重复注入');
        return;
    }

    // ===========================
    // 页面状态检查 - 防止异常渲染
    // ===========================
    if (typeof window.checkPageStateAndReload === 'function') {
        if (!window.checkPageStateAndReload('小红书授权')) {
            return;
        }
    }

    window.__DOUYIN_SCRIPT_LOADED__ = true;

    // 显示操作提示横幅
    if (typeof showOperationBanner === 'function') {
        showOperationBanner('正在自动授权中，请勿操作此页面...');
    }

    console.log('═══════════════════════════════════════');
    console.log('✅ 小红书授权脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    // 检查 common.js 是否已加载
    if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
        console.error('[小红书授权] ❌ common.js 未加载！脚本可能无法正常工作');
    } else {
        console.log('[小红书授权] ✅ common.js 已加载，工具函数可用');
    }

    // ===========================
    // 1. 从 URL 获取授权数据
    // ===========================

    const urlParams = new URLSearchParams(window.location.search);
    const companyId = await window.browserAPI.getGlobalData('company_id');
    const transferId = urlParams.get('transfer_id');

    console.log('[小红书授权] URL 参数:', {
        companyId,
        transferId
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

    window.__DOUYIN_AUTH__ = {
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
    console.log('[小红书授权] 注册消息监听器...');

    // 防重复标志：确保数据只处理一次
    let isProcessing = false;
    let hasProcessed = false;

    if (!window.browserAPI) {
        console.error('[小红书授权] ❌ browserAPI 不可用！');
    } else {
        window.browserAPI.onMessageFromHome(async (message) => {
            try {
                console.log('[小红书授权] 🎉 收到消息:', message);

                if (message.type === 'auth-data') {
                    // 🔑 强制检查 windowId（必须匹配，否则立即返回）
                    const myWindowId = await window.browserAPI.getWindowId();
                    console.log('[小红书授权] 我的窗口 ID:', myWindowId, '消息目标窗口 ID:', message.windowId);

                    if (!message.windowId) {
                      console.error('[小红书授权] ❌ 收到的 auth-data 消息缺少 windowId，这不应该发生！已拒绝处理');
                      return;
                    }

                    if (myWindowId !== message.windowId) {
                      console.warn('[小红书授权] ⚠️ 消息不是发给我的（我是 ' + myWindowId + '，消息发给 ' + message.windowId + '），拒绝处理');
                      return;
                    }

                    console.log('[小红书授权] ✅ windowId 匹配，安全处理消息');

                    if (isProcessing || hasProcessed) return;
                    isProcessing = true;

                    const messageData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;

                    await waitForElement('.account-name', 15000);
                    const titleEle = document.querySelector('.account-name');
                    if (!titleEle || !titleEle.innerText) {
                        await window.delay(2000);
                    }

                    // 🆕 改为接口取（与 publish 关闭时保存逻辑一致，避免 DOM 选择器失效）
                    const personalInfoRes = await fetch('https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info', {
                        method: 'GET',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    if (!personalInfoRes.ok) throw new Error(`personal_info 接口失败: ${personalInfoRes.status}`);
                    const personalInfo = await personalInfoRes.json();
                    const userData = personalInfo && personalInfo.data;
                    if (!userData || !userData.red_num) {
                        throw new Error('小红书 personal_info 接口返回缺少 red_num');
                    }

                    const scanData = {
                        data: JSON.stringify({
                            nickname: userData.name,
                            avatar: userData.avatar,
                            follow: userData.follow_count,
                            follower_count: userData.fans_count,
                            video: 0,
                            uid: userData.red_num,
                            favoriting_count: userData.follow_count,
                            total_favorited: userData.faved_count,
                            company_id: await window.browserAPI.getGlobalData('company_id'),
                            auth_type: messageData.auth_type
                        })
                    };

                    // 🔑 获取完整会话数据（Cookies + Storage + IndexedDB）
                    console.log('[小红书授权] 📦 正在获取完整会话数据...');
                    try {
                        const sessionResult = await window.browserAPI.getFullSessionData('xiaohongshu.com');
                        if (sessionResult.success) {
                            const dataObj = JSON.parse(scanData.data);
                            dataObj.cookies = JSON.stringify(sessionResult.data);
                            scanData.data = JSON.stringify(dataObj);
                            console.log(`[小红书授权] ✅ 会话数据获取成功，大小: ${Math.round(sessionResult.size / 1024)} KB`);
                        } else {
                            console.warn('[小红书授权] ⚠️ 获取会话数据失败:', sessionResult.error);
                        }
                    } catch (sessionError) {
                        console.error('[小红书授权] ⚠️ 获取会话数据异常:', sessionError);
                    }

                    // 发送数据到服务器（根据环境选择域名）
                    const apiDomain = await getApiDomain();
                    console.log('[小红书授权] 📡 API 地址:', `${apiDomain}/api/mediaauth/xhsinfo`);
                    const apiResponse = await fetch(`${apiDomain}/api/mediaauth/xhsinfo`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(scanData)
                    });

                    if (!apiResponse.ok) throw new Error(`API failed: ${apiResponse.status}`);

                    const apiResult = await apiResponse.json();
                    if (apiResult && apiResult.code === 200) {
                        hasProcessed = true;

                        // 🔑 迁移登录 Cookies 到持久化 session
                        // 因为授权窗口使用临时 session，需要把登录状态复制到持久化 session
                        // 这样发布时才能用新授权的账号
                        try {
                            console.log('[小红书授权] 🔄 开始迁移 Cookies 到持久化 session...');
                            const migrateResult = await window.browserAPI.migrateCookiesToPersistent('xiaohongshu.com');
                            if (migrateResult.success) {
                                console.log(`[小红书授权] ✅ Cookies 迁移成功，共迁移 ${migrateResult.migratedCount} 个`);
                            } else {
                                console.error('[小红书授权] ⚠️ Cookies 迁移失败:', migrateResult.error);
                            }
                        } catch (migrateError) {
                            console.error('[小红书授权] ⚠️ Cookies 迁移异常:', migrateError);
                        }

                        sendMessageToParent('授权成功，刷新数据');
                        const isDev = window.browserAPI && window.browserAPI.isProduction === false;
                        if(isDev){
                            console.log('[小红书授权] ✅ 开发环境，不关闭窗口');
                        }else{
                            setTimeout(() => window.browserAPI.closeCurrentWindow(), window.getRandomDelayMs(10000));
                        }
                    } else {
                        throw new Error(apiResult.msg || 'Failed');
                    }
                    isProcessing = false;
                }
            } catch (error) {
                console.error('[小红书授权] ❌ 出错:', error);
                isProcessing = false;
            }
        });
        console.log('[小红书授权] ✅ 消息监听器注册成功');
    }

    // ===========================
    // 6. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
    // ===========================

    // 页面加载完成后向父窗口发送消息
    console.log('[小红书授权] 页面加载完成，发送 页面加载完成 消息');
    sendMessageToParent('页面加载完成');

    console.log('═══════════════════════════════════════');
    console.log('✅ 小红书授权脚本初始化完成');
    console.log('📝 全局方法: window.__DOUYIN_AUTH__');
    console.log('  - notifySuccess()  : 发送授权成功消息');
    console.log('  - sendMessage(msg) : 发送自定义消息');
    console.log('  - getAuthData()    : 获取授权数据');
    console.log('  - sendAuthCode(code): 发送授权码');
    console.log('═══════════════════════════════════════');

    // ===========================
    // 7. 授权登录守望
    // 场景：授权窗口打开 /new/home 时本脚本已注入并置 __DOUYIN_SCRIPT_LOADED__；
    // 未登录时小红书走 SPA 路由跳到 /login，用户登录后 SPA 跳回 /new/home，
    // 脚本重注入会被防重标志挡住 return，而 auth-data 已在未登录时消费失败，
    // 父页面只在收到『页面加载完成』时才发 auth-data，授权流程就此卡死。
    // 这里监测「经过登录页 → 回到业务页」后 reload 一次，让脚本干净地重新注入：
    // 重注入后重新发送『页面加载完成』，父页面会重发 auth-data 继续授权。
    // 用业务页白名单而非「离开登录页」做条件，避免验证码等登录中间页误触发刷新。
    // 整页跳转场景下本 window 连同定时器一起销毁，不会产生副作用。
    // ===========================
    (function watchXhsAuthLoginRecovery() {
        if (window.__xhsAuthLoginRecoveryWatcher__) {
            return;
        }
        const isOnXhsLoginPage = () => {
            try {
                const url = new URL(window.location.href);
                return url.hostname === 'creator.xiaohongshu.com' && url.pathname.startsWith('/login');
            } catch (_) {
                return String(window.location.href || '').includes('creator.xiaohongshu.com/login');
            }
        };
        const isOnXhsBusinessPage = () => {
            try {
                const url = new URL(window.location.href);
                return url.hostname === 'creator.xiaohongshu.com' && url.pathname.startsWith('/new/home');
            } catch (_) {
                return false;
            }
        };

        let passedLoginPage = isOnXhsLoginPage();
        window.__xhsAuthLoginRecoveryWatcher__ = setInterval(() => {
            if (hasProcessed) {
                // 授权已完成，停止守望，避免授权成功后的页面跳转误触发 reload
                clearInterval(window.__xhsAuthLoginRecoveryWatcher__);
                window.__xhsAuthLoginRecoveryWatcher__ = null;
                return;
            }
            if (isOnXhsLoginPage()) {
                if (!passedLoginPage) {
                    passedLoginPage = true;
                    console.log('[小红书授权] 👀 检测到 SPA 跳转到登录页，等待用户登录后自动刷新继续授权');
                }
                return;
            }
            if (passedLoginPage && isOnXhsBusinessPage()) {
                clearInterval(window.__xhsAuthLoginRecoveryWatcher__);
                window.__xhsAuthLoginRecoveryWatcher__ = null;
                console.log('[小红书授权] 🔄 检测到已登录并回到业务页（SPA 跳转），刷新页面让授权脚本重新注入继续授权');
                window.location.reload();
            }
        }, 1000);
    })();

})();

