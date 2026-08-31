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
    // 🔑 检查 common.js 依赖并提供降级实现
    // ===========================
    if (typeof window.getRandomDelayMs !== "function") {
        console.warn("[新浪授权] ⚠️ common.js 未正确加载，使用降级实现");
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
    // 未认证账号拦截：微信扫码登录后新浪会跳到 /#/type 选择创作者类型
    // 该账号尚未在新浪侧完成认证，直接提示用户并关闭窗口
    // 放在最前面（独立于防重复注入），并监听 hashchange 兼容 SPA 路由跳转
    // ===========================
    function isXinlangUnauthPage() {
        return window.location.hash === '#/type'
            || window.location.href.includes('mp.sina.com.cn/#/type');
    }

    async function handleXinlangUnauthPage() {
        if (window.__XINLANG_UNAUTH_HANDLED__) return;
        window.__XINLANG_UNAUTH_HANDLED__ = true;
        console.warn('[新浪授权] ⚠️ 检测到未认证账号页面 (/#/type)，通知父页面并关闭窗口');
        try {
            if (typeof sendMessageToParent === 'function') {
                sendMessageToParent({
                    type: 'auth-failed',
                    reason: 'unauth-account',
                    message: '该账号尚未完成新浪认证，请先在新浪官方完成认证后再来授权',
                });
            }
        } catch (e) {
            console.error('[新浪授权] ❌ 通知父页面失败:', e);
        }
        try {
            await window.browserAPI.closeCurrentWindow();
        } catch (e) {
            console.error('[新浪授权] ❌ 关闭窗口失败:', e);
        }
    }

    if (!window.__XINLANG_UNAUTH_LISTENER__) {
        window.__XINLANG_UNAUTH_LISTENER__ = true;
        window.addEventListener('hashchange', () => {
            if (isXinlangUnauthPage()) {
                handleXinlangUnauthPage();
            }
        });
    }

    if (isXinlangUnauthPage()) {
        await handleXinlangUnauthPage();
        return;
    }

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

    // 显示操作提示横幅
    if (typeof showOperationBanner === 'function') {
        showOperationBanner('正在自动授权中，请勿操作此页面...');
    }

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
    let hasHandledLoginGate = false;

    // 窗口类型判定：子窗口一律授权（管他从哪进来的），主窗口浏览不触发
    // 授权窗口标志仅用于决定"授权完成后是否自动关窗"
    let isChildWindow = false;
    let isAuthOriginWindow = false;
    let hasPublishDataInWindow = false;
    try {
        const detectedWindowId = await window.browserAPI?.getWindowId?.();
        isChildWindow = typeof detectedWindowId === 'number';
        if (isChildWindow) {
            isAuthOriginWindow = !!(await window.browserAPI?.getGlobalData?.(`auth_mode_window_${detectedWindowId}`));
            // 发布窗口不触发授权兜底（避免发布中途上报+通知父页面刷新干扰发布流程）
            hasPublishDataInWindow = !!(await window.browserAPI?.getGlobalData?.(`publish_data_window_${detectedWindowId}`));
        }
        console.log('[新浪授权] 窗口 ID:', detectedWindowId, '子窗口:', isChildWindow, '授权窗口标志:', isAuthOriginWindow, '发布窗口:', hasPublishDataInWindow);
    } catch (e) {
        console.warn('[新浪授权] ⚠️ 读取窗口信息失败:', e.message);
    }

    function getXinlangLoginGateState() {
        const wrapper = document.querySelector('.notic_wapper');
        if (!wrapper) {
            return { matched: false, wrapper: null, loginButton: null, text: '' };
        }

        const loginButton = wrapper.querySelector('.btn_buttom');
        const text = (wrapper.innerText || wrapper.textContent || '').replace(/\s+/g, ' ').trim();
        const loginText = (loginButton?.textContent || '').trim();
        const hasLoginText = loginText.includes('登录');
        const hasUpgradeKeyword = ['新浪统一创作平台', '头条文章', '体验升级'].some(keyword => text.includes(keyword));

        return {
            matched: !!loginButton && (hasLoginText || hasUpgradeKeyword),
            wrapper,
            loginButton,
            text,
        };
    }

    async function handleXinlangLoginGate(options = {}) {
        const state = getXinlangLoginGateState();
        if (!state.matched) {
            return { handled: false };
        }

        const { messageData = null, storedCompanyId = null, source = 'unknown' } = options;

        // 🔴 先读取上下文，判断是否真的有授权/发布意图，避免在无意图场景误点登录形成循环
        let windowId = null;
        let publishData = null;
        let windowContext = null;
        let isAuthModeWindow = false;

        try {
            windowId = await window.browserAPI?.getWindowId?.();
            if (windowId) {
                publishData = await window.browserAPI?.getGlobalData?.(`publish_data_window_${windowId}`);
                isAuthModeWindow = !!(await window.browserAPI?.getGlobalData?.(`auth_mode_window_${windowId}`));
            }
            windowContext = await window.browserAPI?.getWindowContext?.();
        } catch (e) {
            console.warn('[新浪授权] ⚠️ 读取登录公告页上下文失败:', e.message);
        }

        const hasAuthIntent = !!messageData || !!publishData || isAuthModeWindow;

        if (!hasAuthIntent) {
            console.log('[新浪授权] ⏭️ 检测到登录公告页但无授权/发布上下文，不主动点击登录按钮，避免循环', {
                source,
                windowId,
            });
            return { handled: false, skipped: 'no-auth-intent' };
        }

        if (messageData && window.browserAPI?.setGlobalData) {
            try {
                await window.browserAPI.setGlobalData('xinlang_auth_data', {
                    messageData,
                    companyId: storedCompanyId || companyId,
                    timestamp: Date.now(),
                    source: `login-gate:${source}`,
                });
                console.log('[新浪授权] 💾 登录公告页已保存待处理授权数据，等待登录后恢复');
            } catch (e) {
                console.error('[新浪授权] ❌ 登录公告页保存待处理授权数据失败:', e);
            }
        }

        if (hasHandledLoginGate) {
            console.log('[新浪授权] ⏭️ 登录公告页已处理过，等待页面跳转');
            return { handled: true, deduped: true };
        }

        hasHandledLoginGate = true;

        console.warn('[新浪授权] ⚠️ 检测到新浪登录公告页，暂停授权处理并触发登录', {
            source,
            windowId,
            purpose: windowContext?.purpose || '',
            hasPublishData: !!publishData,
            isAuthModeWindow,
        });

        try {
            state.loginButton.dispatchEvent(new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true,
            }));
            console.log('[新浪授权] ✅ 已点击登录公告页的“登录”按钮');
        } catch (e) {
            console.warn('[新浪授权] ⚠️ 模拟点击失败，回退到原生 click:', e.message);
            state.loginButton.click();
            console.log('[新浪授权] ✅ 已通过原生 click 触发登录');
        }

        return { handled: true, windowId, purpose: windowContext?.purpose || '' };
    }

    // ===========================
    // 🔐 3.5 快照凭证自检 + 主站预热（授权成败唯一读码判不出来的一环）
    // 采集完直接 POST 时，快照缺 ALF/SSOLoginState 后台会以「授权失败」拒收
    // （HTTP 200 + 业务码非 200），兜底轮询接着拿同一份死快照重试到 5 分钟超时，
    // 现象是「授权半天不成功」但看不出原因。这里把采到了什么打成一手证据。
    // ===========================
    const XINLANG_SNAPSHOT_DOMAINS = ['sina.com.cn', 'weibo.com', 'weibo.cn', 'sina.cn'];
    // ALF = 登录才下发的一年期自动登录 token（值形如 02_<到期秒>）；SSOLoginState = SSO 登录状态标志。
    // SUB/SUBP/SCF 一律不算凭证：实测会话失效后仍在，SCF 甚至跨重登值都不变。
    const XINLANG_CREDENTIAL_COOKIE_NAMES = ['ALF', 'SSOLoginState'];

    function summarizeXinlangCredential(cookies) {
        const list = Array.isArray(cookies) ? cookies : [];
        const foundNames = [];
        const countByDomain = {};
        list.forEach(cookie => {
            const name = cookie?.name || '';
            const domain = cookie?.domain || '';
            countByDomain[domain] = (countByDomain[domain] || 0) + 1;
            if (XINLANG_CREDENTIAL_COOKIE_NAMES.includes(name) && cookie?.value) {
                foundNames.push(`${name}@${domain}`);
            }
        });
        return {
            ok: foundNames.length > 0,
            foundNames,
            summary: {
                total: list.length,
                credential: foundNames.length > 0 ? foundNames : '（无）',
                domains: Object.keys(countByDomain).map(d => `${d}(${countByDomain[d]})`),
            },
        };
    }

    async function warmupXinlangMainSite(urls) {
        try {
            if (window.browserAPI?.warmupSessionNavigation) {
                const warmupResult = await window.browserAPI.warmupSessionNavigation(urls, { waitMs: 2000, timeoutMs: 15000 });
                console.log('[新浪授权] ✅ 主站预热结果:', warmupResult);
                return warmupResult;
            }
            // 老版本浏览器没有该 API，退回旧的 fetch 预热（效果有限，但不影响授权上报）
            console.warn('[新浪授权] ⚠️ warmupSessionNavigation 不可用，退回 fetch 预热');
            for (const url of urls) {
                await fetch(url, { mode: 'no-cors', credentials: 'include' }).catch(() => { });
                await new Promise(resolve => setTimeout(resolve, 1200));
            }
            return { success: false, fallback: 'fetch' };
        } catch (warmupError) {
            console.warn('[新浪授权] ⚠️ 预热 weibo.com 主站失败（不阻断授权流程）:', warmupError?.message || warmupError);
            return { success: false, error: warmupError?.message || String(warmupError) };
        }
    }

    async function collectXinlangSessionSnapshot() {
        const allCookies = [];
        try {
            // 新浪涉及多个域名：weibo.cn 必须在列，SSO 会把 SSOLoginState 那一组种在 .weibo.cn
            for (const domain of XINLANG_SNAPSHOT_DOMAINS) {
                const sessionResult = await window.browserAPI.getFullSessionData(domain);
                if (sessionResult.success && sessionResult.data?.cookies?.length > 0) {
                    allCookies.push(...sessionResult.data.cookies);
                    console.log(`[新浪授权] ✅ ${domain} 会话数据获取成功，${sessionResult.data.cookies.length} 个 cookies`);
                }
            }
        } catch (sessionError) {
            console.error('[新浪授权] ⚠️ 获取会话数据异常:', sessionError);
        }

        if (allCookies.length > 0) {
            console.log(`[新浪授权] ✅ 所有域名会话数据获取完成，共 ${allCookies.length} 个 cookies`);
            return { cookiesData: JSON.stringify({ cookies: allCookies }), allCookies };
        }
        console.warn('[新浪授权] ⚠️ 未获取到任何会话数据，退回 document.cookie');
        return { cookiesData: document.cookie, allCookies: [] };
    }

    // 「真的能进编辑器」实证：cookie 名单只能粗筛，发布/内容管理跑在 card.weibo.com，
    // 要的是 weibo.com 主站登录态。主站没登录时该页返回 meta refresh 到 weibo.com，
    // 再被前端跳去 /newlogin —— 这才是"授权了但发不了文"的真实形态。
    async function probeXinlangEditorReachable() {
        try {
            if (!window.browserAPI?.probeXinlangPublishHostLogin) {
                return { supported: false, verdict: 'unknown', reason: 'api-unavailable' };
            }
            const result = await window.browserAPI.probeXinlangPublishHostLogin();
            return { supported: true, ...(result || {}) };
        } catch (e) {
            return { supported: true, verdict: 'unknown', reason: e?.message || String(e) };
        }
    }

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

            const user = result.data?.userInfo;
            console.log("🚀 ~ processAuthorization ~ user: ", user);
            if(!user || !user.uid) {
                // ⚠️ 不能用 alert：alert 会阻塞渲染线程，下面 closeCurrentWindow 的 setTimeout
                // 永远排不上，窗口悬死等人点确认（历史反模式，见 login-probe 自伤四连）。
                console.error('[新浪授权] ❌ 用户信息缺少 uid，无法继续授权:', user);
                try {
                    sendMessageToParent({
                        type: 'auth-failed',
                        reason: 'missing-uid',
                        message: '未获取到新浪账号 uid，请确认该账号已在新浪完成认证后重试',
                    });
                } catch (notifyError) {
                    console.error('[新浪授权] ❌ 通知父页面失败:', notifyError);
                }

                setTimeout(() => {
                    window.browserAPI.closeCurrentWindow();
                }, window.getRandomDelayMs(1500));
                return;
            }

            // ===========================
            // 🔥 预热 weibo.com 主站，补种主站凭证后再采集快照
            // 授权流程只在 mp.sina.com.cn + passport.weibo.com 完成 SSO，从未触达 weibo.com 主站，
            // 主站登录态（SCF / SSOLoginState / .weibo.cn 那一组 SSO cookie）不会种下，
            // 快照先天残缺 → 发布页 card.weibo.com / me.weibo.com 打开就跳 passport 登录页。
            //
            // ⚠️ 旧实现用 no-cors fetch 预热，实测无效（2026-08-31 session-diagnostic.log）：
            //   授权后 SCF@.weibo.com 与失效前的值一模一样，快照里从来没有 .weibo.cn 那一组，
            //   而人工在窗口里登录一次立刻就有 —— 说明 SSO 跳转链必须由浏览器真实导航才会跑完。
            // 现改为让主进程用同一个 session 开隐藏窗口真实导航一遍，跑完重定向链再采集。
            // ===========================
            console.log('[新浪授权] 🔥 真实导航预热 weibo.com 主站，补种 SSO 凭证...');
            await warmupXinlangMainSite(['https://weibo.com/', 'https://card.weibo.com/article/v5/editor#/draft']);

            // 🔑 获取完整会话数据（只取 cookies，不带 storage）
            console.log('[新浪授权] 📦 正在获取完整会话数据...');
            let snapshot = await collectXinlangSessionSnapshot();
            let cookiesData = snapshot.cookiesData;

            // 🔐 FIX_XINLANG_AUTH_SNAPSHOT_SELFCHECK：POST 之前双判据自证
            //   ① cookie 名单：快照里有没有 ALF / SSOLoginState
            //   ② 实证：拿当前 session 真请一次 card.weibo.com 编辑器，会不会被弹去登录
            if (window.isFeatureEnabled?.('FIX_XINLANG_AUTH_SNAPSHOT_SELFCHECK') !== false) {
                let credential = summarizeXinlangCredential(snapshot.allCookies);
                let editor = await probeXinlangEditorReachable();
                console.log('[新浪授权] 🔐 快照自检:', { cookie: credential.summary, 编辑器: editor });

                if (!credential.ok || editor.verdict === 'not-login') {
                    console.warn('[新浪授权] ⚠️ 自检未过，补跑一次预热后重采集', {
                        缺凭证: !credential.ok,
                        编辑器被弹登录: editor.verdict === 'not-login',
                        原因: editor.reason || ''
                    });
                    await warmupXinlangMainSite([
                        'https://weibo.com/',
                        'https://weibo.cn/',
                        'https://card.weibo.com/article/v5/editor#/draft'
                    ]);
                    snapshot = await collectXinlangSessionSnapshot();
                    cookiesData = snapshot.cookiesData;
                    credential = summarizeXinlangCredential(snapshot.allCookies);
                    editor = await probeXinlangEditorReachable();
                    console.log('[新浪授权] 🔐 补跑预热后自检:', { cookie: credential.summary, 编辑器: editor });
                }

                if (credential.ok && editor.verdict !== 'not-login') {
                    console.log('[新浪授权] ✅ 自检通过｜凭证:', credential.foundNames.join(', '), '｜编辑器:', editor.verdict);
                } else {
                    // 照旧 POST（不改变现状），但把结论写死在日志里
                    console.error('[新浪授权] ❌ 自检未通过：这份快照大概率发不了文'
                        + '（打开发布/内容管理会被弹到 weibo.com/newlogin）。请在本窗口人工登录一次微博主站后重试',
                        { cookie: credential.summary, 编辑器: editor });
                }
            }

            const scanData = {
                data: JSON.stringify({
                    nickname: user.m_fname || '',
                    avatar: user.m_logo || '',
                    follow: 0,
                    follower_count: 0,
                    video: 0,
                    uid: user.uid || '',
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
                try { sessionStorage.setItem('xinlang_auth_reported', '1'); } catch (e) { }

                // 🔑 迁移登录 Cookies（新浪涉及多个域名）
                // 优先写回「当前发布/内容管理上下文对应的账号 session」（persist:xinlang_<后台id>），
                // 否则内容管理/重新发布窗口用的还是该账号 session 里的旧 cookies，打开就跳 passport 登录页。
                // 拿不到发布上下文（纯「添加账号」入口）时退回持久化 session，行为与旧版一致。
                try {
                    const domains = ['sina.com.cn', 'weibo.com', 'weibo.cn', 'sina.cn'];
                    let publishAccountId = '';
                    // 新浪脚本可能从旧版 publishData 读到短名 "xl"；账号窗口统一使用
                    // persist:xinlang_<accountId>，这里必须传规范平台名，避免迁移到 persist:xl_*。
                    const publishPlatform = 'xinlang';
                    try {
                        const myWindowId = await window.browserAPI?.getWindowId?.();
                        const ctxPublishData = myWindowId
                            ? await window.browserAPI?.getGlobalData?.(`publish_data_window_${myWindowId}`)
                            : null;
                        publishAccountId = ctxPublishData?.element?.account_info?.id
                            || ctxPublishData?.element?.accountInfo?.id
                            || '';
                    } catch (ctxErr) {
                        console.warn('[新浪授权] ⚠️ 读取发布上下文失败，按持久化 session 迁移:', ctxErr?.message || ctxErr);
                    }

                    let totalMigrated = 0;
                    if (publishAccountId && window.browserAPI?.migrateCookiesToAccountSession) {
                        console.log('[新浪授权] 🔄 迁移 Cookies 到当前发布账号 session...', { publishPlatform, publishAccountId });
                        for (const domain of domains) {
                            const migrateResult = await window.browserAPI.migrateCookiesToAccountSession(domain, publishPlatform, String(publishAccountId));
                            if (migrateResult.success) {
                                totalMigrated += migrateResult.migratedCount || 0;
                            } else {
                                console.error(`[新浪授权] ⚠️ ${domain} 写回账号 session 失败:`, migrateResult.error);
                            }
                        }
                        console.log(`[新浪授权] ✅ 账号 session 回写完成，共迁移 ${totalMigrated} 个 cookies`);
                    } else {
                        console.log('[新浪授权] ℹ️ 未获取到发布账号上下文，迁移到持久化 session');
                        for (const domain of domains) {
                            const migrateResult = await window.browserAPI.migrateCookiesToPersistent(domain);
                            if (migrateResult.success && migrateResult.migratedCount > 0) {
                                totalMigrated += migrateResult.migratedCount;
                            } else if (!migrateResult.success) {
                                console.warn(`[新浪授权] ⚠️ ${domain} Cookies 迁移失败:`, migrateResult.error);
                            }
                        }
                        console.log(`[新浪授权] ✅ 持久化 session 迁移完成，共迁移 ${totalMigrated} 个`);
                    }
                } catch (migrateError) {
                    console.error('[新浪授权] ⚠️ Cookies 迁移异常:', migrateError);
                }

                // API 成功后通知父页面刷新
                sendMessageToParent('授权成功，刷新数据');

                // 统计接口成功后关闭弹窗（仅授权窗口自动关，其他入口保留窗口）
                if (isAuthOriginWindow) {
                    setTimeout(() => {
                        window.browserAPI.closeCurrentWindow();
                    }, window.getRandomDelayMs(10000));
                } else {
                    console.log('[新浪授权] ℹ️ 非授权窗口，授权完成后保留窗口');
                }
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

                        // 🔑 强制检查 windowId（必须匹配，否则立即返回）
                        const myWindowId = await window.browserAPI.getWindowId();
                        console.log('[新浪授权] 我的窗口 ID:', myWindowId, '消息目标窗口 ID:', message.windowId);

                        if (!message.windowId) {
                          console.error('[新浪授权] ❌ 收到的 auth-data 消息缺少 windowId，这不应该发生！已拒绝处理');
                          return;
                        }

                        if (myWindowId !== message.windowId) {
                          console.warn('[新浪授权] ⚠️ 消息不是发给我的（我是 ' + myWindowId + '，消息发给 ' + message.windowId + '），拒绝处理');
                          return;
                        }

                        console.log('[新浪授权] ✅ windowId 匹配，安全处理消息');

                        if (message.data) {
                            const messageData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
                            window.__AUTH_DATA__ = {
                                ...window.__AUTH_DATA__,
                                message: messageData,
                                receivedAt: Date.now()
                            };
                            console.log('[新浪授权] ✅ 授权数据已更新:', window.__AUTH_DATA__);

                            const loginGateResult = await handleXinlangLoginGate({
                                messageData,
                                storedCompanyId: companyId,
                                source: 'auth-message',
                            });
                            if (loginGateResult.handled) {
                                return;
                            }

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

    const pageInitLoginGateResult = await handleXinlangLoginGate({ source: 'page-init' });
    if (pageInitLoginGateResult.handled) {
        console.log('[新浪授权] 🔐 当前停留在登录公告页，已触发登录流程，等待后续跳转');
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

    // 🔑 authData 为 null 时不能强设 timestamp（否则 TypeError 打断整个脚本，后续兜底全部失效）
    if (authData) {
        authData.timestamp = Date.now();
    }
    // 如果有跳转带来的数据，处理它
    if (authData && authData.timestamp) {
        const dataAge = Date.now() - authData.timestamp;
        if (dataAge < 5 * 60 * 1000) {
            console.log('[新浪授权] ✅ 检测到有效的跳转数据，开始处理...');

            const loginGateResult = await handleXinlangLoginGate({
                messageData: authData.messageData || {},
                storedCompanyId: authData.companyId || companyId,
                source: 'stored-auth-data',
            });
            if (loginGateResult.handled) {
                console.log('[新浪授权] 🔐 登录公告页拦截成功，保留授权数据等待登录后恢复');
                return;
            }

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
    // 6.5 兜底模式：子窗口必须完成授权（管他从哪进来的；auth-data 丢失/跳转断链时接口轮询）
    // ===========================
    (async () => {
        try {
            if (!isChildWindow) {
                console.log('[新浪授权] ℹ️ 主窗口浏览，不启动兜底授权');
                return;
            }
            if (hasPublishDataInWindow) {
                console.log('[新浪授权] ℹ️ 发布窗口，不启动兜底授权');
                return;
            }
            // 本窗口已成功上报过就不再兜底（上报失败不置位，下次导航可重试）
            try {
                if (sessionStorage.getItem('xinlang_auth_reported') === '1') {
                    console.log('[新浪授权] ℹ️ 本窗口已完成过授权上报，兜底不启动');
                    return;
                }
            } catch (dedupError) { }

            // 给正常 auth-data 消息 / 跳转数据处理 15 秒时间
            await new Promise(resolve => setTimeout(resolve, 15000));
            if (hasProcessed) {
                console.log('[新浪授权] ℹ️ 正常流程已完成授权，兜底退出');
                return;
            }

            console.log('[新浪授权] 🚀 启动兜底授权：轮询 getbaseinfo 等待登录...');
            const startTime = Date.now();
            const maxWaitMs = 5 * 60 * 1000;
            let attempt = 0;
            while (Date.now() - startTime < maxWaitMs) {
                if (hasProcessed) {
                    console.log('[新浪授权] ℹ️ 授权已完成，兜底轮询退出');
                    return;
                }
                if (isProcessing) {
                    // 正常流程正在处理，等它结束再看结果
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    continue;
                }

                // 登录公告页拦截：触发登录点击后继续轮询等页面跳转
                const gateState = getXinlangLoginGateState();
                if (gateState.matched) {
                    await handleXinlangLoginGate({
                        messageData: { auth_type: authType },
                        storedCompanyId: companyId,
                        source: 'auth-fallback',
                    });
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    continue;
                }

                attempt++;
                try {
                    const probe = await fetch('https://mp.sina.com.cn/aj/media/info/getbaseinfo', {
                        credentials: 'include',
                    });
                    if (probe.ok) {
                        const probeResult = await probe.json();
                        if (probeResult && probeResult.code === 200 && probeResult.data?.userInfo?.uid) {
                            console.log(`[新浪授权] ✅ 兜底第 ${attempt} 次轮询检测到已登录，执行授权流程`);
                            await processAuthorization({ auth_type: authType }, companyId);
                            if (hasProcessed) {
                                return;
                            }
                            // 上报失败，10 秒后重试
                            await new Promise(resolve => setTimeout(resolve, 10000));
                            continue;
                        }
                    }
                    if (attempt === 1 || attempt % 10 === 0) {
                        console.log(`[新浪授权] ⏳ 兜底第 ${attempt} 次轮询：未登录，等待扫码...`);
                    }
                } catch (probeError) {
                    if (attempt === 1 || attempt % 10 === 0) {
                        console.warn(`[新浪授权] ⏳ 兜底第 ${attempt} 次轮询异常:`, probeError.message);
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
            console.error('[新浪授权] ❌ 兜底轮询超时（5分钟），未完成授权');
        } catch (fallbackError) {
            console.error('[新浪授权] ❌ 兜底授权异常:', fallbackError);
        }
    })();

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
