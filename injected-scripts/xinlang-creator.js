/**
 * 新浪创作者平台授权脚本
 * 用于处理授权流程和数据传输
 *
 * 支持两种授权模式：
 * 1. 监听父页面消息（直接通信模式）
 * 2. 从 globalData/localStorage 读取跳转带来的数据（跳转模式）
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
    'use strict';

    // ===========================
    // 防止脚本重复注入
    // ===========================
    if (window.__XINLANG_CREATOR_LOADED__) {
        console.log('[新浪授权] ⚠️ 脚本已经加载过，跳过重复注入');
        return;
    }

    // ===========================
    // 页面状态检查 - 防止异常渲染
    // ===========================
    if (typeof window.checkPageStateAndReload === 'function') {
        if (!window.checkPageStateAndReload('新浪授权')) {
            return;
        }
    }

    window.__XINLANG_CREATOR_LOADED__ = true;

    console.log('═══════════════════════════════════════');
    console.log('✅ 新浪授权脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    // 检查 common.js 是否已加载
    if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
        console.error('[新浪授权] ❌ common.js 未加载！脚本可能无法正常工作');
    } else {
        console.log('[新浪授权] ✅ common.js 已加载，工具函数可用');
    }

    // ===========================
    // 1. 从 URL 获取基础参数
    // ===========================

    const urlParams = new URLSearchParams(window.location.search);
    const companyId = await window.browserAPI.getGlobalData('company_id');
    const transferId = urlParams.get('transfer_id');
    const authType = urlParams.get('auth_type') || 1;

    console.log('[新浪授权] URL 参数:', {
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
    // 2. 暴露全局方法供手动调用
    // ===========================

    window.__XINLANG_AUTH__ = {
        notifySuccess: () => {
            sendMessageToParent('授权成功');
        },
        sendMessage: (message) => {
            sendMessageToParent(message);
        },
        getAuthData: () => window.__AUTH_DATA__,
    };

    // ===========================
    // 3. 防重复处理标志
    // ===========================
    let isProcessing = false;
    let hasProcessed = false;

    // ===========================
    // 4. 核心授权处理函数（两种模式共用）
    // ===========================
    async function processAuthorization(messageData, storedCompanyId) {
        if (isProcessing) {
            console.warn('[新浪授权] ⚠️ 正在处理中，忽略重复调用');
            return;
        }
        if (hasProcessed) {
            console.warn('[新浪授权] ⚠️ 已经处理过，忽略重复调用');
            return;
        }

        isProcessing = true;
        console.log('[新浪授权] 🔄 开始处理授权数据...');

        try {
            // 获取用户信息
            console.log('[新浪授权] 📡 正在获取用户信息...');
            const response = await fetch('https://mp.sina.com.cn/aj/media/info/getbaseinfo');

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            console.log('[新浪授权] 📥 用户信息响应:', result);

            if (!result.data || result.code !== 200) {
                throw new Error('获取用户信息失败: ' + (result.msg || 'Unknown error'));
            }

            const user = result.data;

            // 🔑 获取完整会话数据（Cookies + Storage + IndexedDB）
            console.log('[新浪授权] 📦 正在获取完整会话数据...');
            let cookiesData = '';
            try {
                // 新浪涉及多个域名，需要获取 sina.com.cn 和 weibo.com 的 cookies
                const sessionResult = await window.browserAPI.getFullSessionData('sina.com.cn');
                if (sessionResult.success) {
                    cookiesData = JSON.stringify(sessionResult.data);
                    console.log(`[新浪授权] ✅ 会话数据获取成功，大小: ${Math.round(sessionResult.size / 1024)} KB`);
                } else {
                    console.warn('[新浪授权] ⚠️ 获取完整会话数据失败:', sessionResult.error);
                    const cookieResult = await window.browserAPI.getDomainCookies('sina.com.cn');
                    if (cookieResult.success && cookieResult.cookies) {
                        cookiesData = cookieResult.cookies;
                    }
                }
            } catch (sessionError) {
                console.error('[新浪授权] ⚠️ 获取会话数据异常:', sessionError);
                cookiesData = document.cookie;
            }

            const scanData = {
                data: JSON.stringify({
                    nickname: userInfo.m_fname || '',
                    avatar: user.m_logo || '',
                    follow: user.follow_count || 0,
                    follower_count: user.fans_count || user.follower_count || 0,
                    video: user.article_count || user.content_count || 0,
                    uid: user.uid || user.id || '',
                    favoriting_count: 0,
                    total_favorited: 0,
                    company_id: storedCompanyId,
                    auth_type: messageData.auth_type || authType,
                    cookies: cookiesData
                })
            };

            console.log('[新浪授权] 📤 准备发送数据到接口...');

            // 动态获取 API 域名
            const apiDomain = await getApiDomain();
            const apiUrl = `${apiDomain}/api/mediaauth/xlinfo`;
            console.log('[新浪授权] 📡 API 地址:', apiUrl);

            // 发送数据到服务器
            const apiResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(scanData)
            });

            if (!apiResponse.ok) {
                throw new Error(`Statistics API failed with status: ${apiResponse.status}`);
            }

            const apiResult = await apiResponse.json();
            console.log('[新浪授权] 📥 接口响应:', apiResult);

            if (apiResult && 'code' in apiResult && apiResult.code === 200) {
                console.log('[新浪授权] ✅ 数据发送成功');

                hasProcessed = true;

                // 🔑 迁移登录 Cookies 到持久化 session
                try {
                    console.log('[新浪授权] 🔄 开始迁移 Cookies 到持久化 session...');
                    const migrateResult = await window.browserAPI.migrateCookiesToPersistent('sina.com.cn');
                    if (migrateResult.success) {
                        console.log(`[新浪授权] ✅ Cookies 迁移成功，共迁移 ${migrateResult.migratedCount} 个`);
                    } else {
                        console.error('[新浪授权] ⚠️ Cookies 迁移失败:', migrateResult.error);
                    }
                } catch (migrateError) {
                    console.error('[新浪授权] ⚠️ Cookies 迁移异常:', migrateError);
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
        } catch (error) {
            console.error('[新浪授权] ❌ 处理授权数据出错:', error);
        } finally {
            isProcessing = false;
        }
    }

    // ===========================
    // 5. 模式一：监听父页面消息（像百家号）
    // ===========================
    console.log('[新浪授权] 注册消息监听器...');

    if (!window.browserAPI) {
        console.error('[新浪授权] ❌ browserAPI 不可用！');
    } else {
        console.log('[新浪授权] ✅ browserAPI 可用');

        if (!window.browserAPI.onMessageFromHome) {
            console.error('[新浪授权] ❌ browserAPI.onMessageFromHome 不可用！');
        } else {
            console.log('[新浪授权] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

            window.browserAPI.onMessageFromHome(async (message) => {
                try {
                    console.log('═══════════════════════════════════════');
                    console.log('[新浪授权] 🎉 收到来自父窗口的消息!');
                    console.log('[新浪授权] 消息类型:', typeof message);
                    console.log('[新浪授权] 消息内容:', message);
                    console.log('[新浪授权] 消息.type:', message?.type);
                    console.log('[新浪授权] 消息.data:', message?.data);
                    console.log('═══════════════════════════════════════');

                    if (message.type === 'auth-data') {
                        console.log('[新浪授权] ✅ 收到授权数据:', message.data);

                        // 🔑 检查 windowId 是否匹配
                        if (message.windowId) {
                            const myWindowId = await window.browserAPI.getWindowId();
                            console.log('[新浪授权] 我的窗口 ID:', myWindowId, '消息目标窗口 ID:', message.windowId);
                            if (myWindowId !== message.windowId) {
                                console.log('[新浪授权] ⏭️ 消息不是发给我的，跳过');
                                return;
                            }
                            console.log('[新浪授权] ✅ windowId 匹配，处理消息');
                        }

                        if (message.data) {
                            const messageData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
                            window.__AUTH_DATA__ = {
                                ...window.__AUTH_DATA__,
                                message: messageData,
                                receivedAt: Date.now()
                            };
                            console.log('[新浪授权] ✅ 授权数据已更新:', window.__AUTH_DATA__);

                            // 调用核心处理函数
                            await processAuthorization(messageData, companyId);
                        }
                    }
                } catch (error) {
                    console.error('[新浪授权] ❌ 消息处理出错:', error);
                }
            });

            console.log('[新浪授权] ✅ 消息监听器注册成功');
        }
    }

    // ===========================
    // 6. 模式二：检查跳转带来的数据（像知乎）
    // ===========================
    console.log('[新浪授权] 检查跳转带来的授权数据...');
    console.log('[新浪授权] 当前 URL:', window.location.href);
    console.log('[新浪授权] URL hash:', window.location.hash);

    // 读取 redirect 脚本执行日志
    const redirectLog = await window.browserAPI.getGlobalData('xinlang_redirect_log');
    if (redirectLog && redirectLog.length > 0) {
        console.log('[新浪授权] 📋 redirect 脚本执行日志:');
        redirectLog.forEach(log => console.log('  ' + log));
    }

    let authData = null;

    // 方案1: 从 URL hash 读取（最可靠）
    if (window.location.hash && window.location.hash.includes('auth_data=')) {
        try {
            const hashData = window.location.hash.split('auth_data=')[1];
            if (hashData) {
                authData = JSON.parse(decodeURIComponent(hashData));
                console.log('[新浪授权] ✅ 从 URL hash 读取到授权数据');
                // 清除 hash，避免显示在地址栏
                history.replaceState(null, '', window.location.pathname + window.location.search);
            }
        } catch (e) {
            console.error('[新浪授权] URL hash 解析失败:', e);
        }
    }

    // 方案2: 从 localStorage 读取
    if (!authData) {
        try {
            const lsData = localStorage.getItem('xinlang_auth_data');
            console.log('[新浪授权] localStorage 原始值:', lsData ? '有数据，长度' + lsData.length : 'null');
            if (lsData) {
                authData = JSON.parse(lsData);
                console.log('[新浪授权] ✅ 从 localStorage 读取到授权数据');
                localStorage.removeItem('xinlang_auth_data');
            }
        } catch (e) {
            console.error('[新浪授权] localStorage 读取失败:', e);
        }
    }

    // 方案3: 从 globalData 读取
    if (!authData) {
        authData = await window.browserAPI.getGlobalData('xinlang_auth_data');
        if (authData) {
            console.log('[新浪授权] ✅ 从 globalData 读取到授权数据');
            await window.browserAPI.removeGlobalData('xinlang_auth_data');
        } else {
            console.log('[新浪授权] ⚠️ 所有来源都没有跳转数据');
        }
    }

    console.log('[新浪授权] 最终 authData:', authData ? '有数据' : 'undefined');

    // 如果有跳转带来的数据，处理它
    if (authData && authData.timestamp) {
        const dataAge = Date.now() - authData.timestamp;
        if (dataAge < 5 * 60 * 1000) {
            console.log('[新浪授权] ✅ 检测到有效的跳转数据，开始处理...');

            // 清除数据（防止重复处理）
            await window.browserAPI.removeGlobalData('xinlang_auth_data');

            const { messageData, companyId: storedCompanyId } = authData;

            // 调用核心处理函数
            await processAuthorization(messageData || {}, storedCompanyId || companyId);
        } else {
            console.log('[新浪授权] ⚠️ 跳转数据已过期（超过5分钟），忽略');
            await window.browserAPI.removeGlobalData('xinlang_auth_data');
        }
    } else {
        console.log('[新浪授权] ℹ️ 没有跳转数据，等待父页面消息...');
    }

    // ===========================
    // 7. 页面加载完成向父窗口发送消息
    // ===========================
    console.log('[新浪授权] 页面加载完成，发送 页面加载完成 消息');
    sendMessageToParent('页面加载完成');

    console.log('═══════════════════════════════════════');
    console.log('✅ 新浪授权脚本初始化完成');
    console.log('📝 支持两种授权模式:');
    console.log('  1. 监听父页面消息（直接通信）');
    console.log('  2. 读取跳转数据（从 redirect 页面）');
    console.log('📝 全局方法: window.__XINLANG_AUTH__');
    console.log('  - notifySuccess()  : 发送授权成功消息');
    console.log('  - sendMessage(msg) : 发送自定义消息');
    console.log('  - getAuthData()    : 获取授权数据');
    console.log('═══════════════════════════════════════');

})();
