/**
 * 头条创作者平台授权脚本
 * 用于处理授权流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
    'use strict';

    // ===========================
    // 防止脚本重复注入
    // ===========================
    if (window.__TOUTIAO_SCRIPT_LOADED__) {
        console.log('[头条授权] ⚠️ 脚本已经加载过，跳过重复注入');
        return;
    }

    // ===========================
    // 页面状态检查 - 防止异常渲染
    // ===========================
    if (typeof window.checkPageStateAndReload === 'function') {
        if (!window.checkPageStateAndReload('头条授权')) {
            return;
        }
    }

    window.__TOUTIAO_SCRIPT_LOADED__ = true;

    // 显示操作提示横幅
    if (typeof showOperationBanner === 'function') {
        showOperationBanner('正在自动授权中，请勿操作此页面...');
    }

    console.log('═══════════════════════════════════════');
    console.log('✅ 头条授权脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    // 检查 common.js 是否已加载
    if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
        console.error('[头条授权] ❌ common.js 未加载！脚本可能无法正常工作');
    } else {
        console.log('[头条授权] ✅ common.js 已加载，工具函数可用');
    }

    // ===========================
    // 1. 从 URL 获取授权数据
    // ===========================

    const urlParams = new URLSearchParams(window.location.search);
    const companyId = await window.browserAPI.getGlobalData('company_id');
    const transferId = urlParams.get('transfer_id');
    const authType = urlParams.get('auth_type') || 1;  // 从 URL 获取 auth_type，默认为 1

    console.log('[头条授权] URL 参数:', {
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

    window.__TOUTIAO_AUTH__ = {
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
    console.log('[头条授权] 注册消息监听器...');

    // 防重复标志：确保数据只处理一次
    let isProcessing = false;
    let hasProcessed = false;


    if (!window.browserAPI) {
        console.error('[头条授权] ❌ browserAPI 不可用！');
    } else {
        console.log('[头条授权] ✅ browserAPI 可用');

        if (!window.browserAPI.onMessageFromHome) {
            console.error('[头条授权] ❌ browserAPI.onMessageFromHome 不可用！');
        } else {
            console.log('[头条授权] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

            window.browserAPI.onMessageFromHome(async (message) => {
                try {
                    console.log('═══════════════════════════════════════');
                    console.log('[头条授权] 🎉 收到来自父窗口的消息!');
                    console.log('[头条授权] 消息类型:', typeof message);
                    console.log('[头条授权] 消息内容:', message);
                    console.log('[头条授权] 消息.type:', message?.type);
                    console.log('[头条授权] 消息.data:', message?.data);
                    console.log('═══════════════════════════════════════');

                    // 接收完整的授权数据
                    if (message.type === 'auth-data') {
                        console.log('[头条授权] ✅ 收到授权数据:', message.data);

                        // 🔑 检查 windowId 是否匹配（如果消息带有 windowId）
                        if (message.windowId) {
                            const myWindowId = await window.browserAPI.getWindowId();
                            console.log('[头条授权] 我的窗口 ID:', myWindowId, '消息目标窗口 ID:', message.windowId);
                            if (myWindowId !== message.windowId) {
                                console.log('[头条授权] ⏭️ 消息不是发给我的，跳过');
                                return;
                            }
                            console.log('[头条授权] ✅ windowId 匹配，处理消息');
                        }

                        // 防重复检查
                        if (isProcessing) {
                            console.warn('[头条授权] ⚠️ 正在处理中，忽略重复消息');
                            return;
                        }
                        if (hasProcessed) {
                            console.warn('[头条授权] ⚠️ 已经处理过，忽略重复消息');
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
                            console.log('[头条授权] ✅ 授权数据已更新:', window.__AUTH_DATA__);

                            // 获取用户信息
                            const userInfoResult = await fetch("https://mp.toutiao.com/mp/agw/media/get_media_info", {
                                method: "get"
                            })
                            const userInfo = await userInfoResult.json();
                            if (!userInfo || !userInfo.data || !userInfo.data.user){
                                console.error('[头条授权] ❌ 获取用户信息失败:', userInfo);
                                return;
                            }
                            const user = userInfo.data.user;
                            // 从 localStorage 键名中提取 Tea SDK 的 app_id
                            // 键名格式: __tea_cache_first_{app_id}
                            let appId = '';
                            for (let i = 0; i < localStorage.length; i++) {
                                const key = localStorage.key(i);
                                const match = key.match(/^__tea_cache_first_(\d+)$/);
                                if (match) {
                                    appId = match[1];
                                    break;
                                }
                            }
                            user.app_id = appId;
                            console.log('[头条授权] 📱 获取到 app_id:', appId || '(未找到)');

                            const response = await fetch('https://mp.toutiao.com/mp/fe_api/home/merge_v2?app_id=' + user.app_id, {
                                method: 'get',
                            });

                            if (!response.ok) {
                                throw new Error(`HTTP error! status: ${response.status}`);
                            }

                            const result = await response.json();

                            // 🔧 补全设备 Cookie（tt_webid / s_v_web_id / ttcid / tt_scid）
                            // Electron 临时 session 中这些 Cookie 可能缺失，补全后一并保存到后台
                            try {
                                const _allCookies = document.cookie;
                                const _hasTtWebid = _allCookies.includes('tt_webid=');

                                if (!_hasTtWebid) {
                                    const _ts = BigInt(Date.now());
                                    const _rand = BigInt(Math.floor(Math.random() * (2 ** 22)));
                                    const _ttWebid = String(_ts * BigInt(2 ** 22) + _rand);
                                    await window.browserAPI.setCookie({
                                        name: 'tt_webid', value: _ttWebid, domain: '.toutiao.com',
                                        path: '/', secure: true, httpOnly: false, sameSite: 'no_restriction',
                                        expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
                                    });
                                    console.log('[头条授权] ✅ 已补全 tt_webid:', _ttWebid);
                                }

                                // 修复 s_v_web_id 的 verify_ 前缀
                                const _svMatch = _allCookies.match(/s_v_web_id=(verify_[^;]*)/);
                                if (_svMatch) {
                                    const _fixedSv = _svMatch[1].replace('verify_', '');
                                    await window.browserAPI.setCookie({
                                        name: 's_v_web_id', value: _fixedSv, domain: 'mp.toutiao.com',
                                        path: '/', secure: true, httpOnly: false, sameSite: 'no_restriction',
                                        expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
                                    });
                                    console.log('[头条授权] ✅ 已修复 s_v_web_id');
                                }

                                if (!_allCookies.includes('ttcid=')) {
                                    const _hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
                                    const _ttcid = _hex + Math.floor(Math.random() * 100).toString().padStart(2, '0');
                                    await window.browserAPI.setCookie({
                                        name: 'ttcid', value: _ttcid, domain: 'mp.toutiao.com',
                                        path: '/', secure: true, httpOnly: false, sameSite: 'no_restriction',
                                        expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
                                    });
                                    console.log('[头条授权] ✅ 已补全 ttcid');
                                }

                                if (!_allCookies.includes('tt_scid=')) {
                                    const _scChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-';
                                    const _ttScid = Array.from({ length: 64 }, () => _scChars[Math.floor(Math.random() * _scChars.length)]).join('');
                                    await window.browserAPI.setCookie({
                                        name: 'tt_scid', value: _ttScid, domain: 'mp.toutiao.com',
                                        path: '/', secure: true, httpOnly: false, sameSite: 'no_restriction',
                                        expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
                                    });
                                    console.log('[头条授权] ✅ 已补全 tt_scid');
                                }

                                // 等待 Cookie 写入完成
                                await new Promise(r => setTimeout(r, 200));
                            } catch (_devErr) {
                                console.warn('[头条授权] ⚠️ 设备 Cookie 补全失败:', _devErr);
                            }

                            // 🔑 获取完整会话数据（Cookies + Storage + IndexedDB）
                            // 头条需要多个域名的数据：www.toutiao.com, .toutiao.com, xxbg.snssdk.com, .bytedance.com
                            const sessionDomains = ['www.toutiao.com', '.toutiao.com', 'xxbg.snssdk.com', '.bytedance.com'];
                            console.log('[头条授权] 📦 正在获取多域名完整会话数据...', sessionDomains);
                            let cookiesData = '';
                            try {
                                // 并行获取所有域名的会话数据
                                const sessionResults = await Promise.all(
                                    sessionDomains.map(domain => window.browserAPI.getFullSessionData(domain).catch(err => {
                                        console.warn(`[头条授权] ⚠️ 获取 ${domain} 会话数据失败:`, err);
                                        return { success: false, domain };
                                    }))
                                );

                                // 合并所有域名的 cookies（只保存 cookies，不保存 localStorage/sessionStorage/indexedDB）
                                const mergedData = {
                                    domains: sessionDomains,
                                    timestamp: Date.now(),
                                    cookies: []
                                };

                                let totalSize = 0;
                                sessionResults.forEach((result, index) => {
                                    const domain = sessionDomains[index];
                                    if (result.success && result.data) {
                                        console.log(`[头条授权] ✅ ${domain} 会话数据获取成功，大小: ${Math.round((result.size || 0) / 1024)} KB`);
                                        totalSize += result.size || 0;
                                        // 只合并 cookies
                                        if (Array.isArray(result.data.cookies)) {
                                            mergedData.cookies.push(...result.data.cookies);
                                        }
                                    } else {
                                        console.warn(`[头条授权] ⚠️ ${domain} 会话数据获取失败`);
                                    }
                                });

                                if (mergedData.cookies.length > 0) {
                                    cookiesData = JSON.stringify(mergedData);
                                    console.log(`[头条授权] ✅ 多域名会话数据合并完成，共 ${mergedData.cookies.length} 个 cookies，总大小: ${Math.round(totalSize / 1024)} KB`);
                                } else {
                                    console.warn('[头条授权] ⚠️ 所有域名均无有效会话数据，降级为简单 cookie');
                                    const cookieResult = await window.browserAPI.getDomainCookies('.toutiao.com');
                                    if (cookieResult.success && cookieResult.cookies) {
                                        cookiesData = cookieResult.cookies;
                                    }
                                }
                            } catch (sessionError) {
                                console.error('[头条授权] ⚠️ 获取会话数据异常:', sessionError);
                                cookiesData = document.cookie;
                            }

                            const scanData = {
                                data: JSON.stringify({
                                    nickname: user.screen_name,
                                    avatar: user.https_avatar_url,
                                    follow: result?.data?.fans || 0,
                                    follower_count: result?.data?.following || 0,
                                    video: 0,
                                    uid: user.id,
                                    favoriting_count: 0,
                                    total_favorited: 0,
                                    company_id: companyId,
                                    auth_type: messageData.auth_type,
                                    cookies: cookiesData
                                })
                            };
                            try {
                                // Debug dump 只保存 cookies，不保存用户信息
                                const debugDumpData = typeof cookiesData === 'string' ? JSON.parse(cookiesData) : cookiesData;
                                const prettyDebugData = JSON.stringify(debugDumpData, null, 2);
                                const dumpResult = await window.browserAPI.writeDebugFile({
                                    prefix: 'toutiao-scanData',
                                    content: prettyDebugData
                                });
                                if (dumpResult?.success) {
                                    console.log(`[头条授权] Debug dump 已保存: ${dumpResult.filePath}`);
                                } else {
                                    console.warn(`[头条授权] Debug dump 保存失败: ${dumpResult?.error || 'unknown error'}`);
                                }
                            } catch (dumpError) {
                                console.error(`[头条授权] Debug dump 写文件异常:`, dumpError);
                            }

                            console.log('[头条授权] 📤 准备发送数据到接口...');
                            // 发送数据到服务器（根据环境选择域名）
                            const apiDomain = await getApiDomain();
                            console.log('[头条授权] 📡 API 地址:', `${apiDomain}/api/mediaauth/ttinfo`);
                            const apiResponse = await fetch(`${apiDomain}/api/mediaauth/ttinfo`, {
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
                            console.log('[头条授权] 📥 接口响应:', apiResult);

                            if (apiResult && 'code' in apiResult && apiResult.code === 200) {
                                console.log('[头条授权] ✅ 数据发送成功');

                                // 标记已完成（防止重复发送）
                                hasProcessed = true;

                                // 🔑 迁移登录 Cookies 到持久化 session
                                // 因为授权窗口使用临时 session，需要把登录状态复制到持久化 session
                                // 头条涉及多个域名，需要全部迁移
                                try {
                                    const migrateDomains = ['www.toutiao.com', '.toutiao.com', 'xxbg.snssdk.com', '.bytedance.com'];
                                    console.log('[头条授权] 🔄 开始迁移多域名 Cookies 到持久化 session...', migrateDomains);
                                    let totalMigrated = 0;
                                    for (const domain of migrateDomains) {
                                        try {
                                            const migrateResult = await window.browserAPI.migrateCookiesToPersistent(domain);
                                            if (migrateResult.success) {
                                                totalMigrated += migrateResult.migratedCount;
                                                console.log(`[头条授权] ✅ ${domain} Cookies 迁移成功，迁移 ${migrateResult.migratedCount} 个`);
                                            } else {
                                                console.warn(`[头条授权] ⚠️ ${domain} Cookies 迁移失败:`, migrateResult.error);
                                            }
                                        } catch (e) {
                                            console.warn(`[头条授权] ⚠️ ${domain} Cookies 迁移异常:`, e);
                                        }
                                    }
                                    console.log(`[头条授权] ✅ 多域名 Cookies 迁移完成，共迁移 ${totalMigrated} 个`);
                                } catch (migrateError) {
                                    console.error('[头条授权] ⚠️ Cookies 迁移异常:', migrateError);
                                }

                                // API 成功后通知父页面刷新
                                sendMessageToParent('授权成功，刷新数据');

                                // 统计接口成功后关闭弹窗
                                setTimeout(() => {
                                    window.browserAPI.closeCurrentWindow();
                                }, window.PUBLISH_CONFIG.timeout.windowClose);
                            } else {
                                throw new Error(apiResult.msg || apiResult.message || 'Data collection failed');
                            }
                        }

                        // 重置处理标志（无论成功或失败）
                        isProcessing = false;
                        console.log('[头条授权] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
                    }
                } catch (error) {
                    console.error('[头条授权] ❌ 消息处理出错:', error);
                    isProcessing = false;
                }
            });

            console.log('[头条授权] ✅ 消息监听器注册成功');
        }
    }

    // 自动执行授权流程

    // ===========================
    // 6. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
    // ===========================

    // 页面加载完成后向父窗口发送消息
    console.log('[头条授权] 页面加载完成，发送 页面加载完成 消息');
    sendMessageToParent('页面加载完成');

    console.log('═══════════════════════════════════════');
    console.log('✅ 头条授权脚本初始化完成');
    console.log('📝 全局方法: window.__TOUTIAO_AUTH__');
    console.log('  - notifySuccess()  : 发送授权成功消息');
    console.log('  - sendMessage(msg) : 发送自定义消息');
    console.log('  - getAuthData()    : 获取授权数据');
    console.log('═══════════════════════════════════════');

})();

