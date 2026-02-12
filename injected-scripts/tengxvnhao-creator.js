/**
 * 腾讯号创作者平台授权脚本
 * 用于处理授权流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
    'use strict';

    // ===========================
    // 防止脚本重复注入
    // ===========================
    if (window.__TENGXVNHAO_SCRIPT_LOADED__) {
        console.log('[腾讯号授权] ⚠️ 脚本已经加载过，跳过重复注入');
        return;
    }

    // ===========================
    // 页面状态检查 - 防止异常渲染
    // ===========================
    if (typeof window.checkPageStateAndReload === 'function') {
        if (!window.checkPageStateAndReload('腾讯号授权')) {
            return;
        }
    }

    window.__TENGXVNHAO_SCRIPT_LOADED__ = true;

    console.log('═══════════════════════════════════════');
    console.log('✅ 腾讯号授权脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    // 检查 common.js 是否已加载
    if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
        console.error('[腾讯号授权] ❌ common.js 未加载！脚本可能无法正常工作');
    } else {
        console.log('[腾讯号授权] ✅ common.js 已加载，工具函数可用');
    }

    // ===========================
    // 1. 从 URL 获取授权数据
    // ===========================

    const urlParams = new URLSearchParams(window.location.search);
    const companyId = await window.browserAPI.getGlobalData('company_id');
    const transferId = urlParams.get('transfer_id');
    const authType = urlParams.get('auth_type') || 1;  // 从 URL 获取 auth_type，默认为 1

    console.log('[腾讯号授权] URL 参数:', {
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

    window.__TENGXVNHAO_AUTH__ = {
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
    console.log('[腾讯号授权] 注册消息监听器...');

    // 防重复标志：确保数据只处理一次
    let isProcessing = false;
    let hasProcessed = false;


    if (!window.browserAPI) {
        console.error('[腾讯号授权] ❌ browserAPI 不可用！');
    } else {
        console.log('[腾讯号授权] ✅ browserAPI 可用');

        if (!window.browserAPI.onMessageFromHome) {
            console.error('[腾讯号授权] ❌ browserAPI.onMessageFromHome 不可用！');
        } else {
            console.log('[腾讯号授权] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

            window.browserAPI.onMessageFromHome(async (message) => {
                try {
                    console.log('═══════════════════════════════════════');
                    console.log('[腾讯号授权] 🎉 收到来自父窗口的消息!');
                    console.log('[腾讯号授权] 消息类型:', typeof message);
                    console.log('[腾讯号授权] 消息内容:', message);
                    console.log('[腾讯号授权] 消息.type:', message?.type);
                    console.log('[腾讯号授权] 消息.data:', message?.data);
                    console.log('═══════════════════════════════════════');

                    // 接收完整的授权数据
                    if (message.type === 'auth-data') {
                        console.log('[腾讯号授权] ✅ 收到授权数据:', message.data);

                        // 🔑 检查 windowId 是否匹配（如果消息带有 windowId）
                        if (message.windowId) {
                            const myWindowId = await window.browserAPI.getWindowId();
                            console.log('[腾讯号授权] 我的窗口 ID:', myWindowId, '消息目标窗口 ID:', message.windowId);
                            if (myWindowId !== message.windowId) {
                                console.log('[腾讯号授权] ⏭️ 消息不是发给我的，跳过');
                                return;
                            }
                            console.log('[腾讯号授权] ✅ windowId 匹配，处理消息');
                        }

                        // 防重复检查
                        if (isProcessing) {
                            console.warn('[腾讯号授权] ⚠️ 正在处理中，忽略重复消息');
                            return;
                        }
                        if (hasProcessed) {
                            console.warn('[腾讯号授权] ⚠️ 已经处理过，忽略重复消息');
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
                            console.log('[腾讯号授权] ✅ 授权数据已更新:', window.__AUTH_DATA__);

                            const response = await fetch('https://om.qq.com/mindex/homeInfo?app=all&relogin=1', {
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
                            if(result.data){
                                const {data} = result;

                                if (!data) {
                                    throw new Error('User data not found in response');
                                }

                                // 🔑 获取完整会话数据（Cookies + Storage + IndexedDB）
                                console.log('[腾讯号授权] 📦 正在获取完整会话数据...');
                                let cookiesData = '';
                                try {
                                    const sessionResult = await window.browserAPI.getFullSessionData('om.qq.com');
                                    if (sessionResult.success) {
                                        cookiesData = JSON.stringify(sessionResult.data);
                                        console.

                                        log(`[腾讯号授权] ✅ 会话数据获取成功，大小: ${Math.round(sessionResult.size / 1024)} KB`);
                                    } else {
                                        console.warn('[腾讯号授权] ⚠️ 获取完整会话数据失败:', sessionResult.error);
                                        // 降级为简单 cookie 字符串
                                        const cookieResult = await window.browserAPI.getDomainCookies('om.qq.com');
                                        if (cookieResult.success && cookieResult.cookies) {
                                            cookiesData = cookieResult.cookies;
                                        }
                                    }
                                } catch (sessionError) {
                                    console.error('[腾讯号授权] ⚠️ 获取会话数据异常:', sessionError);
                                    cookiesData = document.cookie;
                                }

                                const userInfoResult = await fetch('https://om.qq.com/maccountsetting/basicinfo/?relogin=1', {
                                    method: 'GET',
                                    credentials: 'include'
                                })
                                const userInfoRes = await userInfoResult.json();
                                console.log("🚀 ~  ~ userInfoRes: ", userInfoRes);
                                if(userInfoRes.data && userInfoRes.data.cpInfo){
                                    const userInfo = userInfoRes.data.cpInfo;
                                    if (!userInfo){
                                        throw new Error('User info not found in response');
                                    }
                                    if(userInfo.header){
                                        // 通过主进程下载头像（绕过跨域限制）
                                        const imgResult = await window.browserAPI.downloadImage(userInfo.header);
                                        if (imgResult.success) {
                                            // 将 base64 转为 Blob 再上传
                                            const byteChars = atob(imgResult.data);
                                            const byteArray = new Uint8Array(byteChars.length);
                                            for (let i = 0; i < byteChars.length; i++) {
                                                byteArray[i] = byteChars.charCodeAt(i);
                                            }
                                            const avatarBlob = new Blob([byteArray], { type: imgResult.contentType });

                                            const uploadFormData = new FormData();
                                            uploadFormData.append('file', avatarBlob, 'avatar.jpg');
                                            const token = await window.browserAPI.getGlobalData('login_token');
                                            uploadFormData.append('access_token', token);
                                            uploadFormData.append('token', token);
                                            const uploadAvatarResult = await fetch('https://api.china9.cn/api/bucket/uploadall', {
                                                method: 'POST',
                                                body: uploadFormData
                                            });
                                            const uploadAvatarRes = await uploadAvatarResult.json();
                                            console.log("🚀 ~  ~ uploadAvatarRes: ", uploadAvatarRes);
                                            userInfo.header = 'https://images.china9.cn/' + uploadAvatarRes?.data;
                                        } else {
                                            console.error('[腾讯号授权] ⚠️ 头像下载失败:', imgResult.error, '，使用原始 URL');
                                        }
                                    }
                                    const fansCountResult = await fetch('https://om.qq.com/mstatistic/ommixin/getFansTotalStatistic?app=&relogin=1', {
                                        method: 'GET',
                                        credentials: 'include' // 带上 cookies
                                    });

                                    const fansCountRes = await fansCountResult.json();
                                    let fansCount = 0;
                                    if(fansCountRes.data){
                                        fansCount = fansCountRes.data.data ? JSON.parse(fansCountRes.data.data) ? JSON.parse(fansCountRes.data.data).fans : 0 : 0;
                                        console.log('[腾讯号授权] ✅ 发布文章数量:', fansCount);
                                    }else{
                                        console.error('[腾讯号授权] ⚠️ 获取发布文章数量失败:', fansCountRes.msg);
                                    }

                                    const publishArticleCountResult = await fetch('https://om.qq.com/marticle/article/list?category=&search=&source=&startDate=&endDate=&num=10&ftype=&readChannel=all&dstChannel=&isPartDst=0&isQBQA=false&refreshField=&relogin=1', {
                                        method: 'GET',
                                        credentials: 'include' // 带上 cookies
                                    });

                                    const publishArticleCountRes = await publishArticleCountResult.json();
                                    let publishArticleCount = 0;
                                    if(publishArticleCountRes.data){
                                        publishArticleCount = fansCountRes.data.totalNumber ?? 0;
                                        console.log('[腾讯号授权] ✅ 发布文章数量:', publishArticleCount);
                                    }else{
                                        console.error('[腾讯号授权] ⚠️ 获取发布文章数量失败:', publishArticleCountRes.msg);
                                    }
                                    const scanData = {
                                        data: JSON.stringify({
                                            nickname: userInfo.mediaName,
                                            avatar: userInfo.header,
                                            follow: 0,
                                            follower_count: fansCount, //粉丝
                                            video: publishArticleCount, // 作品数
                                            uid: userInfo.mediaId,
                                            favoriting_count: 0, // 收藏数
                                            total_favorited: 0, // 总收藏数
                                            company_id: companyId,
                                            auth_type: messageData.auth_type,
                                            cookies: cookiesData
                                        })
                                    };
                                    console.log("🚀 ~  ~ scanData: ", scanData);

                                    console.log('[腾讯号授权] 📤 准备发送数据到接口...');
                                    // 发送数据到服务器
                                    const apiResponse = await fetch('https://apidev.china9.cn/api/mediaauth/txinfo', {
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
                                    console.log('[腾讯号授权] 📥 接口响应:', apiResult);

                                    if (apiResult && 'code' in apiResult && apiResult.code === 200) {
                                        console.log('[腾讯号授权] ✅ 数据发送成功');

                                        // 标记已完成（防止重复发送）
                                        hasProcessed = true;

                                        // 🔑 迁移登录 Cookies 到持久化 session
                                        // 因为授权窗口使用临时 session，需要把登录状态复制到持久化 session
                                        // 这样发布时才能用新授权的账号
                                        try {
                                            console.log('[腾讯号授权] 🔄 开始迁移 Cookies 到持久化 session...');
                                            const migrateResult = await window.browserAPI.migrateCookiesToPersistent('om.qq.com');
                                            if (migrateResult.success) {
                                                console.log(`[腾讯号授权] ✅ Cookies 迁移成功，共迁移 ${migrateResult.migratedCount} 个`);
                                            } else {
                                                console.error('[腾讯号授权] ⚠️ Cookies 迁移失败:', migrateResult.error);
                                            }
                                        } catch (migrateError) {
                                            console.error('[腾讯号授权] ⚠️ Cookies 迁移异常:', migrateError);
                                        }

                                        // API 成功后通知父页面刷新
                                        sendMessageToParent('授权成功，刷新数据');

                                        // 统计接口成功后关闭弹窗
                                        setTimeout(() => {
                                            //window.browserAPI.closeCurrentWindow();
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
                        console.log('[腾讯号授权] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
                    }
                } catch (error) {
                    console.error('[腾讯号授权] ❌ 消息处理出错:', error);
                    isProcessing = false;
                }
            });

            console.log('[腾讯号授权] ✅ 消息监听器注册成功');
        }
    }

    // 自动执行授权流程

    // ===========================
    // 6. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
    // ===========================

    // 页面加载完成后向父窗口发送消息
    console.log('[腾讯号授权] 页面加载完成，发送 页面加载完成 消息');
    sendMessageToParent('页面加载完成');

    console.log('═══════════════════════════════════════');
    console.log('✅ 腾讯号授权脚本初始化完成');
    console.log('📝 全局方法: window.__TENGXVNHAO_AUTH__');
    console.log('  - notifySuccess()  : 发送授权成功消息');
    console.log('  - sendMessage(msg) : 发送自定义消息');
    console.log('  - getAuthData()    : 获取授权数据');
    console.log('═══════════════════════════════════════');

})();

