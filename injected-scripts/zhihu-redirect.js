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

                            await logAndSave('📡 开始调用知乎 API...');
                            const response = await fetch('https://www.zhihu.com/api/v4/me?include=is_realname', {
                                method: 'GET',
                                credentials: 'include',  // 自动携带 Cookie
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                            });
                            await logAndSave(`📡 API 响应: status=${response.status}, ok=${response.ok}`);

                            if (!response.ok) {
                                throw new Error(`HTTP error! status: ${response.status}`);
                            }

                            const result = await response.json();
                            await logAndSave(`📡 用户信息: type=${result.type}, url_token=${result.url_token}`);

                            // 🔑 跳转前把数据存到 globalData，供跳转后的页面读取
                            await logAndSave('💾 准备存储 authData 到 globalData...');
                            const authDataToStore = {
                                messageData: messageData,
                                userInfo: result,
                                companyId: companyId,
                                timestamp: Date.now()
                            };
                            await window.browserAPI.setGlobalData('zhihu_auth_data', authDataToStore);

                            // 等待 500ms 确保文件写入完成（避免内存与文件不同步）
                            await new Promise(resolve => setTimeout(resolve, 500));

                            await logAndSave('💾 setGlobalData 完成，等待 500ms');

                            // 验证数据是否存储成功
                            const verifyData = await window.browserAPI.getGlobalData('zhihu_auth_data');
                            if (verifyData && verifyData.timestamp) {
                                await logAndSave('✅ 验证成功，数据已写入');
                            } else {
                                await logAndSave('❌ 验证失败！读回为: ' + JSON.stringify(verifyData));
                                // 验证失败时重试一次
                                await window.browserAPI.setGlobalData('zhihu_auth_data', authDataToStore);
                                await new Promise(resolve => setTimeout(resolve, 500));
                                await logAndSave('🔄 重试写入完成');
                            }

                            await logAndSave('🚀 即将跳转到: https://www.zhihu.com/' + result.type + '/' + result.url_token);

                            // 再等待 300ms 确保所有写入都完成
                            await new Promise(resolve => setTimeout(resolve, 300));

                            window.location.href = 'https://www.zhihu.com/' + result.type + '/' + result.url_token;
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

    console.log('═══════════════════════════════════════');
    console.log('✅ 知乎授权脚本初始化完成');
    console.log('📝 全局方法: window.__ZHIHU_AUTH__');
    console.log('  - notifySuccess()  : 发送授权成功消息');
    console.log('  - sendMessage(msg) : 发送自定义消息');
    console.log('  - getAuthData()    : 获取授权数据');
    console.log('═══════════════════════════════════════');

})();
