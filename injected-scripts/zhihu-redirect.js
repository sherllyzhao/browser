/**
 * 知乎创作者平台授权脚本
 * 用于处理授权流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
    'use strict';

    // ===========================
    // 初始化调试日志（立即写入 globalData）
    // ===========================
    const redirectLog = [];
    const logAndSave = async (msg) => {
        redirectLog.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
        await window.browserAPI?.setGlobalData('zhihu_redirect_log', redirectLog);
    };

    await logAndSave('redirect 脚本开始执行, URL: ' + window.location.href);

    // ===========================
    // 防止脚本重复注入
    // ===========================
    if (window.__ZHIHU_SCRIPT_LOADED__) {
        await logAndSave('⚠️ 脚本已加载过，跳过');
        console.log('[知乎授权] ⚠️ 脚本已经加载过，跳过重复注入');
        return;
    }

    // ===========================
    // 页面状态检查 - 防止异常渲染
    // ===========================
    if (typeof window.checkPageStateAndReload === 'function') {
        if (!window.checkPageStateAndReload('知乎授权')) {
            await logAndSave('❌ 页面状态检查失败，return');
            return;
        }
    }

    window.__ZHIHU_SCRIPT_LOADED__ = true;
    await logAndSave('✅ 标记 __ZHIHU_SCRIPT_LOADED__ = true');

    console.log('═══════════════════════════════════════');
    console.log('✅ 知乎授权脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    // 检查 common.js 是否已加载
    if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
        console.error('[知乎授权] ❌ common.js 未加载！脚本可能无法正常工作');
    } else {
        console.log('[知乎授权] ✅ common.js 已加载，工具函数可用');
    }

    // ===========================
    // 1. 从 URL 获取授权数据
    // ===========================

    const urlParams = new URLSearchParams(window.location.search);
    const companyId = await window.browserAPI.getGlobalData('company_id');
    const transferId = urlParams.get('transfer_id');
    const authType = urlParams.get('auth_type') || 1;  // 从 URL 获取 auth_type，默认为 1

    console.log('[知乎授权] URL 参数:', {
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

    window.__ZHIHU_AUTH__ = {
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
    console.log('[知乎授权] 注册消息监听器...');

    // 防重复标志：确保数据只处理一次
    let isProcessing = false;
    let hasProcessed = false;

    // 🔑 轮询等登录：未登录（401/403）时用户可能还没扫码，持续轮询而不是一次就死
    // shouldAbort: 可选回调，返回 true 时中止轮询（用于兜底模式被正常消息路径接管时退出）
    const pollUserInfo = async (maxWaitMs = 5 * 60 * 1000, intervalMs = 3000, shouldAbort = null) => {
        const startTime = Date.now();
        let attempt = 0;
        while (Date.now() - startTime < maxWaitMs) {
            if (shouldAbort && shouldAbort()) {
                await logAndSave('⏹️ 轮询中止（正常消息路径已接管）');
                return null;
            }
            attempt++;
            try {
                const resp = await fetch('https://www.zhihu.com/api/v4/me?include=is_realname', {
                    method: 'GET',
                    credentials: 'include',  // 自动携带 Cookie
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });
                if (resp.ok) {
                    const me = await resp.json();
                    if (me && me.id) {
                        await logAndSave(`📡 第 ${attempt} 次轮询成功: type=${me.type}, url_token=${me.url_token}`);
                        return me;
                    }
                }
                if (attempt === 1 || attempt % 10 === 0) {
                    await logAndSave(`⏳ 第 ${attempt} 次轮询: HTTP ${resp.status}，等待扫码登录...`);
                }
            } catch (pollError) {
                if (attempt === 1 || attempt % 10 === 0) {
                    await logAndSave(`⏳ 第 ${attempt} 次轮询异常: ${pollError.message}`);
                }
            }
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
        return null;
    };

    // 🔑 跳转前存储数据（三方案）并带 hash 跳转个人主页，由 zhihu-creator.js 接手上报
    const storeAndJump = async (messageData, userInfo, companyIdToUse) => {
        await logAndSave('💾 准备存储 authData...');
        await logAndSave('💾 当前域名: ' + window.location.origin);
        const authDataToStore = {
            messageData: messageData,
            userInfo: userInfo,
            companyId: companyIdToUse,
            timestamp: Date.now()
        };
        const authDataStr = JSON.stringify(authDataToStore);

        // 方案1: localStorage（同域名共享）
        try {
            localStorage.setItem('zhihu_auth_data', authDataStr);
            // 立即验证
            const verify = localStorage.getItem('zhihu_auth_data');
            if (verify) {
                await logAndSave('💾 localStorage 写入成功，验证通过，长度: ' + verify.length);
            } else {
                await logAndSave('❌ localStorage 写入后验证失败！');
            }
        } catch (e) {
            await logAndSave('❌ localStorage 写入失败: ' + e.message);
        }

        // 方案2: globalData 备用
        await window.browserAPI.setGlobalData('zhihu_auth_data', authDataToStore);
        await logAndSave('💾 globalData 写入完成');

        // 方案3: 通过 URL hash 传递（最可靠）
        const targetUrl = 'https://www.zhihu.com/' + userInfo.type + '/' + userInfo.url_token;
        const urlWithData = targetUrl + '#auth_data=' + encodeURIComponent(authDataStr);
        await logAndSave('🚀 即将跳转到: ' + targetUrl);

        hasProcessed = true;
        window.location.href = urlWithData;
    };

    if (!window.browserAPI) {
        await logAndSave('❌ browserAPI 不可用');
        console.error('[知乎授权] ❌ browserAPI 不可用！');
    } else {
        await logAndSave('✅ browserAPI 可用');
        console.log('[知乎授权] ✅ browserAPI 可用');

        if (!window.browserAPI.onMessageFromHome) {
            await logAndSave('❌ onMessageFromHome 不可用');
            console.error('[知乎授权] ❌ browserAPI.onMessageFromHome 不可用！');
        } else {
            await logAndSave('✅ onMessageFromHome 可用，注册监听器...');
            console.log('[知乎授权] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

            window.browserAPI.onMessageFromHome(async (message) => {
                try {
                    await logAndSave('🎉 收到消息: type=' + message?.type);
                    console.log('═══════════════════════════════════════');
                    console.log('[知乎授权] 🎉 收到来自父窗口的消息!');
                    console.log('[知乎授权] 消息类型:', typeof message);
                    console.log('[知乎授权] 消息内容:', message);
                    console.log('[知乎授权] 消息.type:', message?.type);
                    console.log('[知乎授权] 消息.data:', message?.data);
                    console.log('═══════════════════════════════════════');

                    // 接收完整的授权数据
                    if (message.type === 'auth-data') {
                        await logAndSave('进入 auth-data 处理逻辑');
                        console.log('[知乎授权] ✅ 收到授权数据:', message.data);

                        // 🔑 检查 windowId 是否匹配（如果消息带有 windowId）
                        if (message.windowId) {
                            const myWindowId = await window.browserAPI.getWindowId();
                            await logAndSave(`windowId 检查: 我的=${myWindowId}, 消息目标=${message.windowId}`);
                            console.log('[知乎授权] 我的窗口 ID:', myWindowId, '消息目标窗口 ID:', message.windowId);
                            if (myWindowId !== message.windowId) {
                                await logAndSave('❌ windowId 不匹配，跳过');
                                console.log('[知乎授权] ⏭️ 消息不是发给我的，跳过');
                                return;
                            }
                            await logAndSave('✅ windowId 匹配');
                            console.log('[知乎授权] ✅ windowId 匹配，处理消息');
                        } else {
                            await logAndSave('消息无 windowId，不检查');
                        }

                        // 防重复检查
                        if (isProcessing) {
                            await logAndSave('⚠️ isProcessing=true，跳过');
                            console.warn('[知乎授权] ⚠️ 正在处理中，忽略重复消息');
                            return;
                        }
                        if (hasProcessed) {
                            await logAndSave('⚠️ hasProcessed=true，跳过');
                            console.warn('[知乎授权] ⚠️ 已经处理过，忽略重复消息');
                            return;
                        }

                        // 标记为正在处理
                        isProcessing = true;
                        await logAndSave('✅ 开始处理，isProcessing=true');

                        // 更新全局变量
                        if (message.data) {
                            await logAndSave('message.data 存在，开始处理');
                            const messageData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
                            window.__AUTH_DATA__ = {
                                ...window.__AUTH_DATA__,
                                message: messageData,
                                receivedAt: Date.now()
                            };
                            console.log('[知乎授权] ✅ 授权数据已更新:', window.__AUTH_DATA__);

                            await logAndSave('📡 开始轮询知乎 API（等待登录）...');
                            const result = await pollUserInfo();
                            if (!result) {
                                throw new Error('轮询超时（5分钟），未获取到登录用户信息');
                            }

                            await storeAndJump(messageData, result, companyId);
                        }

                        // 重置处理标志（无论成功或失败）
                        isProcessing = false;
                        console.log('[知乎授权] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
                    }
                } catch (error) {
                    await logAndSave('❌ 错误: ' + error.message);
                    console.error('[知乎授权] ❌ 消息处理出错:', error);
                    isProcessing = false;
                }
            });

            console.log('[知乎授权] ✅ 消息监听器注册成功');
            await logAndSave('✅ 消息监听器注册成功，等待父窗口消息...');
        }
    }

    // 自动执行授权流程

    // ===========================
    // 6. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
    // ===========================

    // 页面加载完成后向父窗口发送消息
    console.log('[知乎授权] 页面加载完成，发送 页面加载完成 消息');
    await logAndSave('📤 发送"页面加载完成"消息给父窗口');
    sendMessageToParent('页面加载完成');

    // ===========================
    // 6.5 子窗口兜底：auth-data 消息丢失时也必须完成重定向
    // ===========================
    // 场景：子窗口停在推荐页且 auth-data 消息未送达（页面导航打断投递/父页面路由切走/时序错过），
    // 正常消息路径永远不触发。子窗口一律兜底救援（管他从哪进来的），主窗口浏览不触发。
    (async () => {
        try {
            const myWindowId = await window.browserAPI.getWindowId();
            const isChildWindow = typeof myWindowId === 'number';
            await logAndSave(`🛡️ 兜底检查: windowId=${myWindowId}, 子窗口=${isChildWindow}`);
            if (!isChildWindow) {
                console.log('[知乎授权] ℹ️ 主窗口浏览，兜底不启动');
                return;
            }
            // 发布窗口不触发授权兜底（避免干扰发布流程）
            if (await window.browserAPI.getGlobalData(`publish_data_window_${myWindowId}`)) {
                await logAndSave('🛡️ 发布窗口，兜底不启动');
                return;
            }
            // 本窗口已完成过授权上报就不再跳转（防止授权后浏览首页被反复劫持）
            try {
                if (sessionStorage.getItem('zhihu_auth_reported') === '1') {
                    await logAndSave('🛡️ 本窗口已完成授权上报，兜底不启动');
                    return;
                }
            } catch (e) { }

            // 给正常 auth-data 消息路径留 15 秒
            await new Promise(resolve => setTimeout(resolve, 15000));
            if (hasProcessed || isProcessing) {
                await logAndSave('🛡️ 兜底退出：正常消息路径已在处理');
                return;
            }

            await logAndSave('🛡️ 15秒未收到 auth-data，启动兜底轮询等登录...');
            console.log('[知乎授权] 🛡️ 授权窗口未收到 auth-data 消息，启动兜底：轮询等登录后自动跳转个人主页');

            const me = await pollUserInfo(5 * 60 * 1000, 3000, () => hasProcessed || isProcessing);
            if (!me) {
                await logAndSave('🛡️ 兜底轮询结束（超时或被正常路径接管），不跳转');
                return;
            }
            // 轮询期间正常消息可能已接管，双检查
            if (hasProcessed || isProcessing) {
                await logAndSave('🛡️ 兜底退出：轮询完成时正常消息路径已在处理');
                return;
            }

            isProcessing = true;
            // auth-data 消息丢了，用 URL 参数重建 messageData（auth_type/company_id 授权 URL 上都有）
            const fallbackMessageData = {
                auth_type: authType,
                company_id: companyId,
            };
            await logAndSave('🛡️ 兜底登录成功，跳转个人主页（messageData 来自 URL 参数）');
            await storeAndJump(fallbackMessageData, me, companyId);
        } catch (fallbackError) {
            await logAndSave('❌ 兜底流程异常: ' + fallbackError.message);
            console.error('[知乎授权] ❌ 兜底流程异常:', fallbackError);
            isProcessing = false;
        }
    })();

    console.log('═══════════════════════════════════════');
    console.log('✅ 知乎授权脚本初始化完成');
    console.log('📝 全局方法: window.__ZHIHU_AUTH__');
    console.log('  - notifySuccess()  : 发送授权成功消息');
    console.log('  - sendMessage(msg) : 发送自定义消息');
    console.log('  - getAuthData()    : 获取授权数据');
    console.log('═══════════════════════════════════════');

})();
