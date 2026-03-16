/**
 * 小红书创作者平台授权脚本
 * 用于处理授权流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
    'use strict';

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
                    if (message.windowId) {
                        const myWindowId = await window.browserAPI.getWindowId();
                        if (myWindowId !== message.windowId) return;
                    }

                    if (isProcessing || hasProcessed) return;
                    isProcessing = true;

                    const messageData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;

                    await waitForElement('.account-name', 15000);
                    const titleEle = document.querySelector('.account-name');
                    if (!titleEle || !titleEle.innerText) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }

                    const accountNameEle = await waitForElement('.account-name', 5000);
                    const avatarEle = await waitForElement('.avatar img', 5000);
                    const followerCountEle = await waitForElement('.static.description-text >div:nth-of-type(2) .numerical', 5000);
                    const favoritingCountEle = await waitForElement('.static.description-text >div:nth-of-type(1) .numerical', 5000);
                    const totalFavoritedEle = await waitForElement('.static.description-text >div:nth-of-type(3) .numerical', 5000);
                    const uidEle = await waitForElement('.others.description-text > div:nth-of-type(1)', 5000);

                    const scanData = {
                        data: JSON.stringify({
                            nickname: accountNameEle.innerText,
                            avatar: avatarEle.getAttribute('src'),
                            follower_count: followerCountEle.innerText,
                            video: 0,
                            uid: uidEle.innerText.replace('小红书账号: ', ''),
                            favoriting_count: favoritingCountEle.innerText,
                            total_favorited: totalFavoritedEle.innerText,
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
                            setTimeout(() => window.browserAPI.closeCurrentWindow(), 10000);
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

})();

