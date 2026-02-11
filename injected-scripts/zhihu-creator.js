/**
 * 知乎创作者平台授权脚本
 * 用于处理授权流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
    'use strict';

    // ===========================
    // 防止脚本重复注入
    // ===========================
    if (window.__ZHIHU_SCRIPT_LOADED__) {
        console.log('[知乎授权] ⚠️ 脚本已经加载过，跳过重复注入');
        return;
    }

    // ===========================
    // 页面状态检查 - 防止异常渲染
    // ===========================
    if (typeof window.checkPageStateAndReload === 'function') {
        if (!window.checkPageStateAndReload('知乎授权')) {
            return;
        }
    }

    window.__ZHIHU_SCRIPT_LOADED__ = true;

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
    // 5. 从多个来源读取授权数据
    // ===========================
    console.log('[知乎授权] 检查授权数据...');
    console.log('[知乎授权] 当前 URL:', window.location.href);
    console.log('[知乎授权] URL hash:', window.location.hash);

    // 读取 redirect 脚本执行日志
    const redirectLog = await window.browserAPI.getGlobalData('zhihu_redirect_log');
    if (redirectLog && redirectLog.length > 0) {
        console.log('[知乎授权] 📋 redirect 脚本执行日志:');
        redirectLog.forEach(log => console.log('  ' + log));
    }

    let authData = null;

    // 方案1: 从 URL hash 读取（最可靠）
    if (window.location.hash && window.location.hash.includes('auth_data=')) {
        try {
            const hashData = window.location.hash.split('auth_data=')[1];
            if (hashData) {
                authData = JSON.parse(decodeURIComponent(hashData));
                console.log('[知乎授权] ✅ 从 URL hash 读取到授权数据');
                // 清除 hash，避免显示在地址栏
                history.replaceState(null, '', window.location.pathname + window.location.search);
            }
        } catch (e) {
            console.error('[知乎授权] URL hash 解析失败:', e);
        }
    }

    // 方案2: 从 localStorage 读取
    if (!authData) {
        try {
            const lsData = localStorage.getItem('zhihu_auth_data');
            console.log('[知乎授权] localStorage 原始值:', lsData ? '有数据，长度' + lsData.length : 'null');
            if (lsData) {
                authData = JSON.parse(lsData);
                console.log('[知乎授权] ✅ 从 localStorage 读取到授权数据');
                localStorage.removeItem('zhihu_auth_data');
            }
        } catch (e) {
            console.error('[知乎授权] localStorage 读取失败:', e);
        }
    }

    // 方案3: 从 globalData 读取
    if (!authData) {
        authData = await window.browserAPI.getGlobalData('zhihu_auth_data');
        if (authData) {
            console.log('[知乎授权] ✅ 从 globalData 读取到授权数据');
            await window.browserAPI.removeGlobalData('zhihu_auth_data');
        } else {
            console.log('[知乎授权] ⚠️ 所有来源都没有数据');
        }
    }

    // 方案4: 从 接口 读取
    if (!authData) {
     const authDataResult= await fetch('https://www.zhihu.com/api/v4/me?include=is_realname', {
         method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
     });
     const authDataRes = await authDataResult.json();
      console.log('[知乎授权] ✅ 从接口读取到授权数据:', authData);
      authData = authDataRes;
    }

    console.log('[知乎授权] 最终 authData:', authData ? '有数据' : 'undefined');

    if (authData && authData.timestamp) {
        // 检查数据是否在 5 分钟内（防止使用过期数据）
        const dataAge = Date.now() - authData.timestamp;
        if (dataAge < 5 * 60 * 1000) {
            console.log('[知乎授权] ✅ 从 globalData 读取到授权数据:', authData);

            // 清除 globalData 中的数据（防止重复处理）
            await window.browserAPI.removeGlobalData('zhihu_auth_data');

            const { messageData, userInfo, companyId: storedCompanyId } = authData;
            const result = userInfo;

            try {
                // 🔑 获取完整会话数据（Cookies + Storage + IndexedDB）
                console.log('[知乎授权] 📦 正在获取完整会话数据...');
                let cookiesData = '';
                try {
                    const sessionResult = await window.browserAPI.getFullSessionData('www.zhihu.com');
                    if (sessionResult.success) {
                        cookiesData = JSON.stringify(sessionResult.data);
                        console.log(`[知乎授权] ✅ 会话数据获取成功，大小: ${Math.round(sessionResult.size / 1024)} KB`);
                    } else {
                        console.warn('[知乎授权] ⚠️ 获取完整会话数据失败:', sessionResult.error);
                        // 降级为简单 cookie 字符串
                        const cookieResult = await window.browserAPI.getDomainCookies('www.zhihu.com');
                        if (cookieResult.success && cookieResult.cookies) {
                            cookiesData = cookieResult.cookies;
                        }
                    }
                } catch (sessionError) {
                    console.error('[知乎授权] ⚠️ 获取会话数据异常:', sessionError);
                    cookiesData = document.cookie;
                }

                const scanData = {
                    data: JSON.stringify({
                        nickname: result.name,
                        avatar: result.avatar_url,
                        follow: result.creation_count,
                        follower_count: 0, //粉丝
                        video: result.articles_count, // 作品数
                        uid: result.id,
                        favoriting_count: 0, // 收藏数
                        total_favorited: 0, // 总收藏数
                        company_id: storedCompanyId,
                        auth_type: messageData.auth_type,
                        cookies: cookiesData
                    })
                };
                console.log('[知乎授权] 📤 准备发送数据到接口...', scanData);

                // 发送数据到服务器
                const apiResponse = await fetch('https://apidev.china9.cn/api/mediaauth/zhinfo', {
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
                console.log('[知乎授权] 📥 接口响应:', apiResult);

                if (apiResult && 'code' in apiResult && apiResult.code === 200) {
                    console.log('[知乎授权] ✅ 数据发送成功');

                    // 🔑 迁移登录 Cookies 到持久化 session
                    try {
                        console.log('[知乎授权] 🔄 开始迁移 Cookies 到持久化 session...');
                        const migrateResult = await window.browserAPI.migrateCookiesToPersistent('www.zhihu.com');
                        if (migrateResult.success) {
                            console.log(`[知乎授权] ✅ Cookies 迁移成功，共迁移 ${migrateResult.migratedCount} 个`);
                        } else {
                            console.error('[知乎授权] ⚠️ Cookies 迁移失败:', migrateResult.error);
                        }
                    } catch (migrateError) {
                        console.error('[知乎授权] ⚠️ Cookies 迁移异常:', migrateError);
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
                console.error('[知乎授权] ❌ 处理授权数据出错:', error);
            }
        } else {
            console.log('[知乎授权] ⚠️ globalData 中的数据已过期，忽略');
            await window.browserAPI.removeGlobalData('zhihu_auth_data');
        }
    } else {
        console.log('[知乎授权] ℹ️ globalData 中没有授权数据（可能是直接访问此页面）');
    }

    console.log('═══════════════════════════════════════');
    console.log('✅ 知乎授权脚本初始化完成');
    console.log('📝 全局方法: window.__ZHIHU_AUTH__');
    console.log('  - notifySuccess()  : 发送授权成功消息');
    console.log('  - sendMessage(msg) : 发送自定义消息');
    console.log('  - getAuthData()    : 获取授权数据');
    console.log('═══════════════════════════════════════');

})();

