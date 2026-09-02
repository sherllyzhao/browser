let introFilled = false; // 标记 intro 是否已填写
let fillFormRunning = false; // 标记 fillFormData 是否正在执行
let publishRunning = false; // 标记发布是否正在执行，防止重复点击

// 防重复标志：确保数据只处理一次
let isProcessing = false;
let hasProcessed = false;

/**
 * 抖音创作者平台发布脚本
 * 用于处理发布流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
    'use strict';

    // ===========================
    // 🔑 检查 common.js 依赖并提供降级实现
    // ===========================
    if (typeof window.getRandomDelayMs !== "function") {
        console.warn("[抖音发布] ⚠️ common.js 未正确加载，使用降级实现");
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
    // 🔑 Semi Modal 定位公共实现
    // ===========================
    // 全脚本原先都在等 `.semi-modal-content.semi-modal-content-animate-show`，
    // 但 animate-show 是 Semi 的**入场动画 class**，动画一放完就被移除 —— 等它必然超时，
    // 于是「未找到确认弹窗」成了常态，弹窗明明开着却没人点「完成」。
    // 这里改成按可见性 + 尺寸自己找，三处调用点共用一份，避免以后又各修各的。
    // 选择器要放宽：抖音的封面浮层不保证是 .semi-modal-content，
    // 也可能是侧边抽屉（semi-sidesheet）或外层的 .semi-modal。
    // 只认两个 class 的话，弹窗明明开着也会被判成"没开"。
    window.__DOUYIN_MODAL_SELECTOR = '.semi-modal-content, .semi-sidesheet-content, .semi-modal, [role="dialog"]';

    window.__douyinModalCandidates = function () {
        return Array.from(document.querySelectorAll(window.__DOUYIN_MODAL_SELECTOR)).map((el) => {
            const r = el.getBoundingClientRect();
            const cs = window.getComputedStyle(el);
            const reasons = [];
            if (!el.isConnected) reasons.push('脱离文档');
            if (cs.display === 'none') reasons.push('display:none');
            if (cs.visibility === 'hidden') reasons.push('visibility:hidden');
            if (Number(cs.opacity) === 0) reasons.push('opacity:0');
            if (!(r.width > 100 && r.height > 100)) reasons.push(`尺寸${Math.round(r.width)}×${Math.round(r.height)}太小`);
            return {el, rect: r, reasons, ok: reasons.length === 0};
        });
    };

    window.__douyinFindVisibleModal = function () {
        const visible = window.__douyinModalCandidates().filter((c) => c.ok);
        if (!visible.length) return null;
        // 页面上可能同时挂着别的弹窗（发布确认、活动提示…），
        // 优先挑文案跟封面上传相关的那个，避免把封面文件塞进无关弹窗
        const scored = visible.map((c) => {
            const t = (c.el.textContent || '');
            let score = 0;
            if (/上传封面|设置封面|封面/.test(t)) score += 10;
            if (c.el.querySelector('.semi-upload-hidden-input, input[type="file"]')) score += 5;
            // 外层 .semi-modal 会包着 .semi-modal-content，两个都可见时取内层更精确
            if (!c.el.querySelector(window.__DOUYIN_MODAL_SELECTOR)) score += 1;
            return {c, score};
        });
        scored.sort((a, b) => b.score - a.score);
        return scored[0].c.el;
    };

    // 没找到弹窗时把候选全打出来：这行日志能一次性区分
    // "弹窗压根没开"（候选数 0）和 "开了但判据没认出来"（候选有但全被否）
    window.__douyinDumpModalState = function (tag) {
        const cands = window.__douyinModalCandidates();
        if (!cands.length) {
            console.log(`[封面上传] 🔬 ${tag}: 页面上一个弹窗候选都没有（选择器 ${window.__DOUYIN_MODAL_SELECTOR}）→ 弹窗确实没打开`);
            return;
        }
        console.log(
            `[封面上传] 🔬 ${tag}: 共 ${cands.length} 个弹窗候选，全部被否 →`,
            cands
                .map((c, i) => `#${i}[${c.el.className || '无class'}] ${c.reasons.join('+')} 文案="${(c.el.textContent || '').trim().slice(0, 12)}"`)
                .join(' || ')
        );
    };

    // 轮询等可见弹窗出现，超时返回 null（不 reject，调用方不必再包 try/catch）
    window.__douyinWaitVisibleModal = async function (timeout = 8000, interval = 200) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const hit = window.__douyinFindVisibleModal();
            if (hit) return hit;
            await new Promise((r) => setTimeout(r, interval));
        }
        return null;
    };

    // ===========================
    // 防止脚本重复注入
    // ===========================
    if (window.__DOUYIN_SCRIPT_LOADED__) {
        console.log('[抖音发布] ⚠️ 脚本已经加载过，跳过重复注入');
        return;
    }

    // ===========================
    // 页面状态检查 - 防止异常渲染
    // ===========================
    if (typeof window.checkPageStateAndReload === 'function') {
        if (!window.checkPageStateAndReload('抖音发布')) {
            return;
        }
    }

    window.__DOUYIN_SCRIPT_LOADED__ = true;

    // ===========================
    // 🔑 抖音白屏检测和自动恢复（使用公共函数）
    // ===========================
    if (typeof window.checkBlankPageAndReload === 'function') {
        window.checkBlankPageAndReload('抖音发布', [
            '.editor-kit-root-container',
            '.semi-input',
            '.button-dhlUZE'
        ], 3000, 3);
    }

    // 显示操作提示横幅
    if (typeof showOperationBanner === 'function') {
        showOperationBanner('正在自动发布中，请勿操作此页面...');
    }

    console.log('═══════════════════════════════════════');
    console.log('✅ 抖音发布脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    // 检查 common.js 是否已加载（延迟检查，给 common.js 时间执行）
    setTimeout(() => {
        if (!window.__COMMON_JS_LOADED__) {
            console.error('[抖音发布] ❌ common.js 未加载！');
        } else if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined' || typeof uploadVideo === 'undefined') {
            console.error('[抖音发布] ❌ common.js 加载不完整！缺少必需函数');
            console.error('[抖音发布] waitForElement:', typeof waitForElement);
            console.error('[抖音发布] retryOperation:', typeof retryOperation);
            console.error('[抖音发布] uploadVideo:', typeof uploadVideo);
            console.error('[抖音发布] sendStatistics:', typeof sendStatistics);
            console.error('[抖音发布] clickWithRetry:', typeof clickWithRetry);
            console.error('[抖音发布] closeWindowWithMessage:', typeof closeWindowWithMessage);
            console.error('[抖音发布] delay:', typeof delay);
        } else {
            console.log('[抖音发布] ✅ common.js 已完整加载，所有工具函数可用');
        }
    }, window.getRandomDelayMs(100)); // 延迟 100ms 检查

    // ===========================
    // 1. 从 URL 获取发布数据
    // ===========================

    const urlParams = new URLSearchParams(window.location.search);
    const companyId = await window.browserAPI.getGlobalData('company_id');
    const transferId = urlParams.get('transfer_id');

    console.log('[抖音发布] URL 参数:', {
        companyId,
        transferId
    });

    // 存储发布数据到全局
    window.__AUTH_DATA__ = {
        companyId,
        transferId,
        timestamp: Date.now()
    };

    // ===========================
    // 2. 暴露全局方法供手动调用
    // ===========================

    window.__DOUYIN_AUTH__ = {
        // 发送发布成功消息
        notifySuccess: () => {
            sendMessageToParent('发布成功');
        },

        // 发送自定义消息
        sendMessage: (message) => {
            sendMessageToParent(message);
        },

        // 获取发布数据
        getAuthData: () => window.__AUTH_DATA__,
    };

    // ===========================
    // 4. 显示调试信息横幅
    // ===========================

    // ===========================
    // 5. 接收来自父窗口的消息（必须在发送 页面加载完成 之前注册！）
    // ===========================
    console.log('[抖音发布] 注册消息监听器...');

    if (!window.browserAPI) {
        console.error('[抖音发布] ❌ browserAPI 不可用！');
    } else {
        console.log('[抖音发布] ✅ browserAPI 可用');

        if (!window.browserAPI.onMessageFromHome) {
            console.error('[抖音发布] ❌ browserAPI.onMessageFromHome 不可用！');
        } else {
            console.log('[抖音发布] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

            window.browserAPI.onMessageFromHome(async (message) => {
                console.log('═══════════════════════════════════════');
                console.log('[抖音发布] 🎉 收到来自父窗口的消息!');
                console.log('[抖音发布] 消息类型:', typeof message);
                console.log('[抖音发布] 消息内容:', message);
                console.log('[抖音发布] 消息.type:', message?.type);
                console.log('[抖音发布] 消息.data:', message?.data);
                console.log('═══════════════════════════════════════');

                // 接收完整的发布数据（直接传递，不使用 IndexedDB）
                if (message.type === 'publish-data') {
                    console.log('[抖音发布] ✅ 收到发布数据:', message.data);
                    console.log('[抖音发布] ✅✅✅ 进入处理逻辑 ✅✅✅');

                    // 使用公共方法检查 windowId 是否匹配
                    const isMatch = await checkWindowIdMatch(message, '[抖音发布]');
                    if (!isMatch) return;

                    // 使用公共方法解析消息数据
                    const messageData = parseMessageData(message.data, '[抖音发布]');
                    if (!messageData) return;

                    // 使用公共方法恢复会话数据
                    const needReload = await restoreSessionAndReload(messageData, '[抖音发布]');
                    if (needReload) return; // 已触发刷新，脚本会重新注入

                    // 防重复检查
                    console.log('[抖音发布] 🔍 检查防重复标志: isProcessing=', isProcessing, ', hasProcessed=', hasProcessed);
                    if (isProcessing) {
                        console.warn('[抖音发布] ⚠️ 正在处理中，忽略重复消息');
                        return;
                    }
                    if (hasProcessed) {
                        console.warn('[抖音发布] ⚠️ 已经处理过，忽略重复消息');
                        return;
                    }

                    // 标记为正在处理
                    isProcessing = true;
                    console.log('[抖音发布] 🔄 已标记为正在处理');

                    // 更新全局变量
                    console.log('[抖音发布] 🔍 检查 message.data:', !!message.data);
                    if (message.data) {
                        console.log("🚀 ~  ~ messageData: ", messageData);

                        window.__AUTH_DATA__ = {
                            ...window.__AUTH_DATA__,
                            message: messageData,
                            receivedAt: Date.now()
                        };
                        console.log('[抖音发布] ✅ 发布数据已更新:', window.__AUTH_DATA__);

                        // 💾 保存数据到 localStorage（用于授权跳转后恢复）
                        /* try {
                          localStorage.setItem('DOUYIN_PUBLISH_DATA', message.data);
                          console.log('[抖音发布] 💾 数据已保存到 localStorage');
                        } catch (e) {
                          console.error('[抖音发布] ❌ 保存数据失败:', e);
                        }

                        // 🔖 保存当前发布页URL（用于授权跳转后返回）
                        try {
                          localStorage.setItem('DOUYIN_PUBLISH_URL', window.location.href);
                          console.log('[抖音发布] 🔖 已保存发布页URL:', window.location.href);
                        } catch (e) {
                          console.error('[抖音发布] ❌ 保存发布页URL失败:', e);
                        } */

                        console.log("🚀 ~  ~ messageData: ", messageData);
                        await uploadVideo(messageData);
                        try {
                            await retryOperation(async () => await fillFormData(messageData), 3, 2000);
                        } catch (e) {
                            console.log('[抖音发布] ❌ 填写表单数据失败:', e);
                        }

                        console.log('[抖音发布] 📤 准备发送数据到接口...');
                        console.log('[抖音发布] ✅ 发布流程已启动，等待 publishApi 完成...');
                        // 注意：不在这里关闭窗口，因为 publishApi 内部有异步的统计接口调用
                        // 窗口会在 publishApi 完成后自动关闭
                    }

                    // 重置处理标志（无论成功或失败）
                    isProcessing = false;
                    console.log('[抖音发布] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
                }
            });

            console.log('[抖音发布] ✅ 消息监听器注册成功');
        }
    }

    // ===========================
    // 6. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
    // ===========================

    // 页面加载完成后向父窗口发送消息
    console.log('[抖音发布] 页面加载完成，发送 页面加载完成 消息');
    sendMessageToParent('页面加载完成');

    console.log('═══════════════════════════════════════');
    console.log('✅ 抖音发布脚本初始化完成');
    console.log('📝 全局方法: window.__DOUYIN_AUTH__');
    console.log('  - notifySuccess()  : 发送发布成功消息');
    console.log('  - sendMessage(msg) : 发送自定义消息');
    console.log('  - getAuthData()    : 获取发布数据');
    console.log('═══════════════════════════════════════');

    // ===========================
    // 7. 检查是否是恢复 cookies 后的刷新（立即执行）
    // ===========================
    await (async () => {
        // 如果已经在处理或已处理完成，跳过
        if (isProcessing || hasProcessed) {
            console.log('[抖音发布] ⏭️ 已在处理中或已完成，跳过全局存储读取');
            return;
        }

        try {
            // 获取当前窗口 ID
            const windowId = await window.browserAPI.getWindowId();
            console.log('[抖音发布] 检查全局存储，窗口 ID:', windowId);

            if (!windowId) {
                console.log('[抖音发布] ❌ 无法获取窗口 ID');
                return;
            }

            // 检查是否有恢复 cookies 后保存的发布数据
            const publishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
            console.log('[抖音发布] 📦 从全局存储读取 publish_data_window_' + windowId + ':', publishData ? '有数据' : '无数据');

            if (publishData && !isProcessing && !hasProcessed) {
                console.log('[抖音发布] ✅ 检测到恢复 cookies 后的数据，开始处理...');

                // 🔑 不再立即删除数据，改为在发布完成后删除
                // 这样如果登录跳转后跳回来，数据仍然可用
                // 使用 hasProcessed 标记防止重复处理
                console.log('[抖音发布] 📝 保留 publish_data_window_' + windowId + ' 数据，待发布完成后清理');

                // 标记为正在处理
                isProcessing = true;

                // 更新全局变量
                window.__AUTH_DATA__ = {
                    ...window.__AUTH_DATA__,
                    message: publishData,
                    source: 'cookieRestore',
                    windowId: windowId,
                    receivedAt: Date.now()
                };

                console.log("🚀 ~  ~ publishData: ", publishData);
                await uploadVideo(publishData);
                try {
                    await retryOperation(async () => await fillFormData(publishData), 3, 2000);
                } catch (e) {
                    console.log('[抖音发布] ❌ 填写表单数据失败:', e);
                }

                console.log('[抖音发布] 📤 准备发送数据到接口...');
                console.log('[抖音发布] ✅ 发布流程已启动，等待 publishApi 完成...');

                isProcessing = false;
            }
        } catch (error) {
            console.error('[抖音发布] ❌ 从全局存储读取数据失败:', error);
        }
    })();
})();

// ===========================
// 7. 发布视频到抖音
// ===========================
function isDouyinLoginExpiredMessage(message) {
    const text = String(message || '').trim().toLowerCase();
    if (!text) {
        return false;
    }

    const loginExpiredKeywords = [
        '登录过期',
        '登录已过期',
        '登陆过期',
        '需要重新登录',
        'login expired',
        'need to login',
        'please login',
        '授权已过期',
        '权限已过期',
        '会话已过期'
    ];

    return loginExpiredKeywords.some(keyword => text.includes(keyword));
}

// ===========================
// 🔐 登录过期停窗等待：检测到登录过期时不再上报失败关窗，
// 停在当前窗口等用户手动登录，登录成功后 reload 让脚本重新注入，
// 从 publish_data_window_${windowId} 恢复发布数据继续发布；
// 主进程「登录页→业务页」导航检测会自动保存新登录态到后台。
// 抖音掉登录常为同页弹登录框（URL 不变），所以用接口探测登录态而非 URL 判断。
// ===========================
function showDouyinLoginWaitTip() {
    try {
        if (document.getElementById('__douyin_login_wait_tip__')) {
            return;
        }
        const tip = document.createElement('div');
        tip.id = '__douyin_login_wait_tip__';
        tip.textContent = '抖音登录已失效，请在本窗口重新登录，登录成功后将自动继续发布';
        tip.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:10px 16px;background:#fff7e6;color:#d46b08;border-bottom:1px solid #ffd591;font-size:14px;font-weight:600;text-align:center;pointer-events:none;';
        (document.body || document.documentElement).appendChild(tip);
    } catch (e) {
        console.warn('[抖音发布] ⚠️ 显示登录提示条失败:', e.message);
    }
}

function startDouyinPublishLoginWatch() {
    if (window.__douyinPublishLoginWatcher__) {
        return;
    }
    console.log('[抖音发布] 👀 开始探测登录态，用户重新登录成功后将自动刷新继续发布');
    if (typeof hideOperationBanner === 'function') {
        hideOperationBanner();
    }
    showDouyinLoginWaitTip();
    window.__douyinPublishLoginWatcher__ = setInterval(async () => {
        try {
            const response = await fetch('https://creator.douyin.com/web/api/media/user/info/', {
                method: 'get'
            });
            if (!response.ok) {
                return;
            }
            const apiData = await response.json();
            if (apiData?.user && 'nickname' in apiData.user) {
                clearInterval(window.__douyinPublishLoginWatcher__);
                window.__douyinPublishLoginWatcher__ = null;
                console.log('[抖音发布] 🔄 检测到已重新登录，刷新页面以继续发布流程');
                window.location.reload();
            }
        } catch (_) {
            // 未登录 / 网络抖动，继续探测
        }
    }, 3000);
}

function isDouyinNetworkErrorMessage(message) {
    const text = String(message || '').trim().toLowerCase();
    if (!text) {
        return false;
    }

    const networkErrorKeywords = [
        '网络错误',
        'network error',
        'net::',
        'failed to fetch',
        '连接失败',
        '请求失败',
        'timeout',
        '超时'
    ];

    return networkErrorKeywords.some(keyword => text.includes(keyword));
}

function isDouyinPublishSuccessMessage(message) {
    const text = String(message || '').trim();
    if (!text) {
        return false;
    }
    const successKeywords = ['发布成功', '提交成功', '上传成功', '成功'];
    const failureKeywords = ['失败', '错误', '异常', '不可用', '未找到', '超时', '审核未通过'];
    return successKeywords.some(keyword => text.includes(keyword))
        && !failureKeywords.some(keyword => text.includes(keyword));
}

function isDouyinNeutralPublishMessage(message) {
    const text = String(message || '').trim();
    if (!text) {
        return true;
    }

    const exactNeutralMessages = ['点击完成', '点击成功'];
    const pendingKeywords = ['正在发布', '正在提交', '正在上传', '加载中', '处理中'];
    const failureKeywords = ['失败', '错误', '异常', '不可用', '未找到', '超时', '审核未通过'];
    if (failureKeywords.some(keyword => text.includes(keyword))) {
        return false;
    }

    return exactNeutralMessages.includes(text)
        || pendingKeywords.some(keyword => text.includes(keyword));
}

function getDouyinTimeoutFailureMessage(lastToastMessage, clickMessage) {
    const toastText = String(lastToastMessage || '').trim();
    if (toastText && !isDouyinNeutralPublishMessage(toastText)) {
        return toastText;
    }

    const clickText = String(clickMessage || '').trim();
    if (clickText && !isDouyinNeutralPublishMessage(clickText)) {
        return clickText;
    }

    return '发布超时，未跳转到成功页（点击已触发，但未捕获平台成功或失败提示）';
}

async function clickDouyinPublishButton(publishBtn) {
    let trustedResult = null;
    if (typeof clickWithTrustedRetry === 'function') {
        trustedResult = await clickWithTrustedRetry(publishBtn, 3, 500, true, '');
        if (trustedResult?.success) {
            return {
                ...trustedResult,
                clickMode: 'trusted',
            };
        }

        console.warn('[抖音发布] ⚠️ 可信点击失败，准备回退普通点击:', trustedResult);
    } else {
        console.warn('[抖音发布] ⚠️ clickWithTrustedRetry 不可用，准备回退普通点击');
    }

    if (typeof clickWithRetry === 'function') {
        const fallbackResult = await clickWithRetry(publishBtn, 3, 500, true, '');
        return {
            ...fallbackResult,
            clickMode: 'js-fallback',
            trustedMessage: trustedResult?.message || '',
        };
    }

    return {
        success: false,
        message: trustedResult?.message || '点击工具不可用',
        clickMode: 'none',
    };
}

function normalizeDouyinPublishText(message) {
    return String(message || '').replace(/\s+/g, ' ').trim();
}

function isDouyinPhoneVerifyMessage(message) {
    const text = normalizeDouyinPublishText(message);
    if (!text) {
        return false;
    }

    const keywords = [
        '接收短信验证码',
        '短信验证码',
        '手机号验证',
        '验证手机号',
        '选择其他验证方式',
        '当前手机号',
    ];

    return keywords.some(keyword => text.includes(keyword));
}

function getDouyinPhoneVerifyMessage() {
    // 🔑 扩展选择器列表，覆盖更多弹窗变体
    const selectors = [
        '#uc-second-verify',
        '.uc-ui-verify-sms-verify',
        '.second-verify-panel',           // 新增：主弹窗容器
        '.uc-ui-layout_content',          // 新增：布局容器
        '.uc-ui-verify-new_header',       // 新增：弹窗标题
        '[class*="second-verify"]',       // 新增：通配符匹配
        '[class*="sms-verify"]',          // 新增：通配符匹配
    ];
    const bodyText = normalizeDouyinPublishText(document.body?.innerText || document.body?.textContent || '');

    for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
            if (!element) {
                continue;
            }

            const rect = element.getBoundingClientRect?.();
            const isVisible = element.offsetParent !== null || (rect && rect.width > 0 && rect.height > 0);
            if (!isVisible) {
                continue;
            }

            const text = normalizeDouyinPublishText(element.textContent || element.innerText || '');
            if (text && isDouyinPhoneVerifyMessage(text)) {
                console.log('[抖音发布] 🔍 通过选择器检测到手机验证弹窗:', selector, '内容:', text.substring(0, 100));
                return text;
            }
        }
    }

    // 🔑 回退方案：检查整个 body 文本
    if (isDouyinPhoneVerifyMessage(bodyText)) {
        console.log('[抖音发布] 🔍 通过 body 文本检测到手机验证弹窗:', bodyText.substring(0, 100));
        return bodyText;
    }

    return '';
}

async function clearDouyinPublishSuccessData(windowId) {
    if (windowId) {
        localStorage.removeItem(`PUBLISH_SUCCESS_DATA_${windowId}`);
        await window.browserAPI?.removeGlobalData?.(`PUBLISH_SUCCESS_DATA_${windowId}`);
        await window.browserAPI?.removeGlobalData?.(`publish_data_window_${windowId}`);
    }
    localStorage.removeItem('PUBLISH_SUCCESS_DATA');
}

function getDouyinPublishTaskToken(windowId) {
    const keys = [];
    if (windowId) {
        keys.push(`PUBLISH_SUCCESS_DATA_${windowId}`);
    }
    keys.push('PUBLISH_SUCCESS_DATA');

    for (const key of keys) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            const token = String(parsed?.taskToken || parsed?.__publishTaskToken || '').trim();
            if (token) {
                return token;
            }
        } catch (_) {
        }
    }

    return String(window.__CURRENT_PUBLISH_TASK_TOKEN__ || 'task_default').trim() || 'task_default';
}

async function reportDouyinPublishSuccess(publishId, windowId, reason = 'success-toast') {
    if (!publishId) {
        console.error('[抖音发布] ❌ publishId 为空，无法上报成功统计');
        return false;
    }

    console.log('[抖音发布] 📤 发送成功统计:', {publishId, reason});
    let result = null;
    if (typeof sendStatistics === 'function') {
        const publishTaskToken = getDouyinPublishTaskToken(windowId);
        result = await sendStatistics(publishId, '抖音发布', {taskToken: publishTaskToken});
    } else if (typeof window.sendStatistics === 'function') {
        const publishTaskToken = getDouyinPublishTaskToken(windowId);
        result = await window.sendStatistics(publishId, '抖音发布', {taskToken: publishTaskToken});
    } else {
        const scanData = typeof window.buildStatisticsRequestData === 'function'
            ? await window.buildStatisticsRequestData(publishId, '抖音发布')
            : {data: JSON.stringify({id: publishId})};
        const url = typeof getStatisticsUrl === 'function'
            ? await getStatisticsUrl(false)
            : await window.getStatisticsUrl(false);
        const response = await fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(scanData),
            keepalive: true,
        });
        result = {success: response.ok, response};
    }

    if (result?.success) {
        await clearDouyinPublishSuccessData(windowId);
        console.log('[抖音发布] ✅ 成功统计已上报，发布标记已清理:', result);
        return true;
    }

    console.error('[抖音发布] ❌ 成功统计上报失败:', result);
    return false;
}

async function publishApi(dataObj) {
    console.log("🚀 ~ publishApi ~ dataObj: ", dataObj);

    // 防止重复执行
    if (publishRunning || hasProcessed) {
        console.log('Publish is already running or processed, skipping duplicate call');
        return;
    }

    const publishId = dataObj.video.dyPlatform.id;

    // 获取窗口 ID（用于多窗口并发发布时区分数据）
    let windowId = null;
    try {
        windowId = await window.browserAPI.getWindowId();
        console.log('[抖音发布] 当前窗口 ID:', windowId);
    } catch (e) {
        console.error('[抖音发布] ❌ 获取窗口 ID 失败:', e);
    }

    try {
        // 标记发布正在进行
        publishRunning = true;
        let phoneVerifyReported = false;

        const reportDouyinPhoneVerifyFailure = async (reason = 'phone-verify', rawMessage = '') => {
            if (phoneVerifyReported) {
                // 🔑 已上报过手机验证错误，返回 false 让轮询继续（不退出）
                console.log('[抖音发布] ⚠️ 手机验证错误已上报过，跳过重复上报，继续监听后续错误');
                return false;
            }

            // 🔑 先检查用户是否正在操作，如果是就等他停下来
            if (typeof window.checkUserActivity === 'function') {
                console.log('[抖音发布] 🔍 检测到手机验证弹窗，先检查用户是否正在操作...');
                await window.checkUserActivity();
                console.log('[抖音发布] ✅ 用户操作检查完成，继续处理验证弹窗');
            }

            phoneVerifyReported = true;
            // 🔑 不要设置 hasProcessed = true，让轮询可以继续检测后续错误
            const normalizedRawMessage = normalizeDouyinPublishText(rawMessage);
            console.warn('[抖音发布] 📱 检测到手机号认证弹窗，准备上报失败:', {
                reason,
                rawMessage: normalizedRawMessage,
            });

            // 🔑 显示醒目的横幅提示（红色警告）
            if (typeof showOperationBanner === 'function') {
                showOperationBanner('⚠️ 需要输入手机验证码，请完成验证后手动点击发布。窗口将保持打开，请勿关闭！', 'error');
            }

            // 🔑 立即上报错误（让后台知道卡在这里了）
            try {
                await sendStatisticsError(publishId, '需要手机号认证，请手动完成', '抖音发布');
                console.log('[抖音发布] 📤 手机验证错误已上报');
            } catch (reportError) {
                console.error('[抖音发布] ❌ 手机号认证失败上报异常:', reportError);
            }

            // 🔑 保存 publishId 到 localStorage，供 publish-success.js 使用
            if (publishId) {
                try {
                    const windowKey = windowId ? `PUBLISH_SUCCESS_DATA_${windowId}` : 'PUBLISH_SUCCESS_DATA';
                    localStorage.setItem(windowKey, JSON.stringify({
                        publishId: publishId,
                        taskToken: window.__CURRENT_PUBLISH_TASK_TOKEN__ || "task_default"
                    }));
                    console.log('[抖音发布] 💾 已保存 publishId 到 localStorage:', windowKey);

                    // 同时保存到 globalData
                    if (window.browserAPI && window.browserAPI.setGlobalData) {
                        await window.browserAPI.setGlobalData(`PUBLISH_SUCCESS_DATA_${windowId}`, {
                            publishId: publishId,
                            taskToken: window.__CURRENT_PUBLISH_TASK_TOKEN__ || "task_default"
                        });
                        console.log('[抖音发布] 💾 已保存 publishId 到 globalData');
                    }
                } catch (e) {
                    console.error('[抖音发布] ❌ 保存 publishId 失败:', e);
                }
            }

            // 🔑 不设置 publishRunning = false，让脚本保持运行状态

            // 🔑 不关闭窗口，让轮询继续运行，监听用户手动发布后的错误
            console.log('[抖音发布] 🛑 暂停自动发布流程，但继续监听后续错误');
            console.log('[抖音发布] 💡 用户需要：1) 完成手机验证 2) 手动点击发布按钮');
            console.log('[抖音发布] 📌 轮询继续运行，如果发布失败会检测到新错误并上报');
            console.log('[抖音发布] 📌 如果发布成功，publish-success.js 会自动上报成功状态覆盖此错误');

            // 🔑 返回 false 表示"不要退出轮询"
            return false;
        };

        const publishHelperStatus = {
            isDouyinPublishSuccessMessage: typeof isDouyinPublishSuccessMessage,
            isDouyinPhoneVerifyMessage: typeof isDouyinPhoneVerifyMessage,
            getDouyinPhoneVerifyMessage: typeof getDouyinPhoneVerifyMessage,
            clearDouyinPublishSuccessData: typeof clearDouyinPublishSuccessData,
            reportDouyinPublishSuccess: typeof reportDouyinPublishSuccess,
            reportDouyinPhoneVerifyFailure: typeof reportDouyinPhoneVerifyFailure,
            clickDouyinPublishButton: typeof clickDouyinPublishButton,
        };
        const missingPublishHelpers = Object.entries(publishHelperStatus)
            .filter(([, value]) => value !== 'function')
            .map(([key]) => key);
        if (missingPublishHelpers.length > 0) {
            throw new Error(`publishApi 依赖缺失: ${missingPublishHelpers.join(', ')}`);
        }

        // 等待页面稳定
        await delay(2000);

        // 等待发布按钮可用
        const publishBtn = await retryOperation(async () => {
            // 抖音用 CSS Modules，类名带哈希后缀，只能模糊匹配；元素常含多个 class，用 *= 而非 ^=
            const candidates = document.querySelectorAll('[class*="content-confirm-container-"] [class*="primary-"]');
            // primary- 系可能同时命中预览/存草稿，用文本"发布"锁定目标按钮
            let btn = Array.from(candidates).find(el => /发布/.test(el.textContent || ''));
            // 兜底：文本没匹配上时退回第一个 primary- 元素
            if (!btn) {
                btn = candidates[0];
            }
            if (!btn) {
                throw new Error('发布按钮未找到');
            }
            // 🔑 检查按钮是否 disabled
            if (btn.disabled || btn.classList.contains('disabled') || btn.getAttribute('disabled') !== null) {
                throw new Error('发布按钮当前不可用(disabled)，可能不符合发布要求');
            }
            return btn;
        }, 10, 2000);

        // 等待按钮事件绑定完成
        await delay(800);

        // 🔑 抖音成功后会直接跳转页面，必须在点击前保存数据
        // 否则跳转后 publishApi 的后续代码不会执行
        // 使用窗口 ID 作为 key，避免多窗口并发时数据覆盖
        try {
            const storageKey = windowId ? `PUBLISH_SUCCESS_DATA_${windowId}` : 'PUBLISH_SUCCESS_DATA';
            localStorage.setItem(storageKey, JSON.stringify({
                publishId: publishId,
                taskToken: window.__CURRENT_PUBLISH_TASK_TOKEN__ || "task_default"
            }));
            console.log('[抖音发布] 💾 已提前保存 publishId 到 localStorage:', publishId, 'key:', storageKey);

            // 🔑 同时保存到 globalData（更可靠，不受域名隔离限制）
            if (window.browserAPI && window.browserAPI.setGlobalData) {
                await window.browserAPI.setGlobalData(`PUBLISH_SUCCESS_DATA_${windowId}`, {
                    publishId: publishId,
                    taskToken: window.__CURRENT_PUBLISH_TASK_TOKEN__ || "task_default"
                });
                console.log('[抖音发布] 💾 已保存 publishId 到 globalData');
            }
        } catch (e) {
            console.error('[抖音发布] ❌ 保存 publishId 失败:', e);
        }

        // 生产环境：必须点击发布按钮
        console.log('[抖音发布] ✅ 生产环境确认，准备点击发布按钮...');

        // 检测视频是否上传完成
        console.log('[抖音发布] ⏳ 等待视频上传完成...');
        await retryOperation(async () => {
            const percentEle = document.querySelector('[class*="upload-progress-style"] [class*="text-"]');
            if (percentEle) {
                const percentText = percentEle.textContent || '';
                throw new Error('视频正在上传中: ' + percentText);
            }
            console.log('[抖音发布] ✅ 检测到视频上传完成（进度元素已消失）');
            return true;
        }, 150, 2000); // 最多重试 150 次，每次间隔 2 秒，共 5 分钟


        // 设置封面
        try {
            console.log('[封面设置] 开始设置封面...');
            const customCoverList = dataObj.element.cover2
            /* const customCoverList = [
                "https://images.china9.cn/attachment/2026-06-16/CR3XUbGEhafOuXFr7x1H08hyao6bKQMYZGzwo6o0.png",
                "https://images.china9.cn/attachment/2026-06-16/wfnaYbuz0eVXKVcaIoc57KUlAwvB8BEyXzuaBtFz.png"
            ]; */
            console.log("🚀 ~ executeAllFormSteps ~ customCoverList: ", customCoverList);
            // 🔑 进门先看锁：SPA 重复注入会产生两个脚本实例，两个都会跑到这里。
            //    如果对方已经在传封面，本实例必须整块跳过 —— 两个实例同时点坑位、
            //    同时往 input 塞文件，只会把彼此的弹窗和文件互相冲掉，两边都失败。
            //    （上一版的锁只防住了"检测循环 vs 上传"，没防"上传 vs 上传"。）
            if (Date.now() < (window.__douyinCoverUploadingUntil || 0)) {
                console.log('[封面上传] ⏭️ 另一个脚本实例正在上传封面，本实例整块跳过封面设置');
            } else if (customCoverList && customCoverList.length > 0) {
                // 🔑 互斥锁：抖音是 SPA，视频传完 URL 变化会触发 did-navigate-in-page，
                //    脚本被重新注入 → 页面上同时有两个实例。另一个实例的「封面检测」轮询
                //    （本文件 801-889 行）每 2 秒就点一次推荐封面 + 点一次「完成」，
                //    会把我这边刚塞进去的文件、刚打开的弹窗全部冲掉。
                //    用"过期时间戳"而不是布尔值：中途抛错也会自动解锁，绝不把对方永久锁死。
                window.__douyinCoverUploadingUntil = Date.now() + 40000;
                console.log('[封面上传] 🔒 已上锁，封面检测轮询暂时让路');

                // 坑位选择器抽成函数：坑位之间 React 会重渲染封面区，
                // 循环开始前存下的静态 NodeList 里的节点会脱离文档，点了等于点空气
                const SLOT_SELECTOR = '[class*="coverControl-"] > [class^="cover-"]';
                const querySlots = () => Array.from(document.querySelectorAll(SLOT_SELECTOR));
                const coverListWrapEle = querySlots();
                console.log(`[封面设置] 页面上共 ${coverListWrapEle.length} 个封面坑位，待传 ${customCoverList.length} 张封面`);

                // 并行预加载所有封面图片，获取真实宽高。
                // 必须带超时：new Image() 碰上不响应的地址既不 onload 也不 onerror，
                // Promise.all 会永远挂着，整块封面设置卡死在这一行且毫无日志
                const coverPromises = customCoverList.map((coverUrl, i) => {
                    return new Promise((resolve) => {
                        const img = new Image();
                        let settled = false;
                        const done = (v, why) => {
                            if (settled) return;
                            settled = true;
                            if (!v) console.log(`[封面设置] ⚠️ 第 ${i + 1} 张封面预加载${why}，这张作废: ${coverUrl}`);
                            resolve(v);
                        };
                        const timer = setTimeout(() => done(null, '超时(10秒)'), 10000);
                        img.onload = () => {
                            clearTimeout(timer);
                            done({
                                url: coverUrl,
                                width: img.naturalWidth,
                                height: img.naturalHeight,
                                ratio: img.naturalWidth / img.naturalHeight
                            });
                        };
                        img.onerror = () => {
                            clearTimeout(timer);
                            done(null, '失败(404/跨域?)');
                        };
                        img.src = coverUrl;
                    });
                });

                const loadedCovers = await Promise.all(coverPromises);
                // 对照表：坑位匹配一旦出错，照这行就能分清是"图没加载出来"还是"比值没匹配上"
                console.log(
                    `[封面设置] 封面预加载结果 ${loadedCovers.filter(Boolean).length}/${loadedCovers.length} 可用:`,
                    loadedCovers
                        .map((c, i) => (c ? `#${i + 1} ${c.width}×${c.height} 比值${c.ratio.toFixed(2)}` : `#${i + 1} ✗作废`))
                        .join(' | ')
                );

                // ── helper：把 File 塞进隐藏 input，并真正让 React/Semi 的 onChange 跑起来 ──
                const fireFileInput = (input, file) => {
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    input.files = dt.files;

                    // 🔑 关键：React 给每个 input 挂了 _valueTracker 缓存上一次的 value，
                    //    change 冒上来时先跟缓存比对，"值没变"就直接把事件丢掉，onChange 根本不执行。
                    //    file input 的 value 又不允许代码写，所以只能把 tracker 手动打回空串，
                    //    它下次比较才会认为值变了。少了这一步，change 派了也是白派。
                    if (input._valueTracker && typeof input._valueTracker.setValue === 'function') {
                        input._valueTracker.setValue('');
                    }
                    input.dispatchEvent(new Event('input', {bubbles: true}));
                    input.dispatchEvent(new Event('change', {bubbles: true}));
                };

                // ── helper：兜底，直接从 React fiber 上把 onChange 抠出来手动调 ──
                const callReactOnChange = (input) => {
                    const key = Object.keys(input).find(
                        (k) => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$')
                    );
                    const onChange = key && input[key] && input[key].onChange;
                    if (typeof onChange !== 'function') {
                        console.log('[封面上传] ⚠️ fiber 上没挂 onChange，兜底失败');
                        return false;
                    }
                    onChange({
                        target: input,
                        currentTarget: input,
                        type: 'change',
                        nativeEvent: new Event('change'),
                        preventDefault() {
                        },
                        stopPropagation() {
                        },
                        persist() {
                        }
                    });
                    console.log('[封面上传] 🔁 已通过 React fiber 直调 onChange');
                    return true;
                };

                // ── helper：给弹窗内容拍指纹，用来判断上传到底有没有被平台接住 ──
                //    上传成功后必定出现本地预览（blob: URL）/ 文件列表项 / 裁剪框 / loading，
                //    指纹变了才算真的生效。光看代码跑完就打 ✅ 是自欺欺人。
                const fingerprint = (root) => {
                    const scope = root || document;
                    const imgs = Array.from(scope.querySelectorAll('img')).map((i) => i.src).join('|');
                    const extra = scope.querySelectorAll(
                        '.semi-upload-file-list-item, .semi-upload-file-card, [class*="cropper"], [class*="Cropper"], .semi-spin-animate'
                    ).length;
                    return imgs + '#' + extra;
                };
                const waitFingerprintChange = async (root, before, timeout = 6000) => {
                    const start = Date.now();
                    while (Date.now() - start < timeout) {
                        if (fingerprint(root) !== before) return true;
                        await window.delay(300);
                    }
                    return false;
                };

                // ── helper：网络层上传监控 —— 判"图传完了"唯一扛得住的证据 ──
                //    ⚠️ 别再拿 DOM 启发式当门闸了，这个坑踩过两次：
                //       第一次拿"指纹变化"当成功（fingerprint 把 .semi-spin-animate 也计了数，
                //       菊花一挂指纹就变，图才刚开始传）；
                //       第二次拿"没有忙碌元素 + 快照静止"当成功 —— 抖音封面弹窗里压根没有
                //       .semi-spin-animate，文本也不跳百分比，本地预览 blob: 图一秒就渲染完，
                //       于是地板时间一过就"静止"，照样早点（用户第二次实测到的正是这个）。
                //    确凿的信号只有一个：图片的 POST 请求收到了响应。
                //    Semi Upload 内部走 XMLHttpRequest（要 progress 事件，fetch 给不了），
                //    hook XHR 一定抓得到；fetch 也一并 hook 防万一。
                //    幂等安装：SPA 重复注入会跑两遍这段，套娃 hook 会让计数翻倍。
                const installUploadMonitor = () => {
                    if (window.__douyinUploadMonitorInstalled) return;
                    window.__douyinUploadMonitorInstalled = true;
                    const stats = (window.__douyinUploadStats = {inflight: 0, done: 0, lastUrl: ''});

                    // 窄口径判"这是不是一次文件上传"：
                    // body 是 FormData/Blob/ArrayBuffer 是最强特征（普通接口发的是 JSON 字符串），
                    // URL 特征兜住 base64-in-JSON 的传法。判宽了会把页面心跳请求算进来，
                    // inflight 永远 >0 就变成每个坑位白等满超时。
                    const isUploadReq = (method, url, body) => {
                        if (!/^(post|put)$/i.test(String(method || '').trim())) return false;
                        const u = String(url || '');
                        if (/upload|imagex|\/tos|byteimg|\/file\//i.test(u)) return true;
                        return (
                            (typeof FormData !== 'undefined' && body instanceof FormData)
                            || (typeof Blob !== 'undefined' && body instanceof Blob)
                            || (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer)
                            || ArrayBuffer.isView(body)
                        );
                    };
                    const begin = (url) => {
                        stats.inflight++;
                        stats.lastUrl = String(url || '').slice(0, 120);
                    };
                    const end = () => {
                        stats.inflight = Math.max(0, stats.inflight - 1);
                        stats.done++;
                    };

                    try {
                        const OrigOpen = XMLHttpRequest.prototype.open;
                        const OrigSend = XMLHttpRequest.prototype.send;
                        XMLHttpRequest.prototype.open = function (method, url) {
                            try {
                                this.__dyMethod = method;
                                this.__dyUrl = url;
                            } catch (e) {
                            }
                            return OrigOpen.apply(this, arguments);
                        };
                        XMLHttpRequest.prototype.send = function (body) {
                            try {
                                if (isUploadReq(this.__dyMethod, this.__dyUrl, body)) {
                                    begin(this.__dyUrl);
                                    // loadend 覆盖 load/error/abort/timeout 四种收尾，
                                    // 只挂这一个既不会漏也不会重复减
                                    this.addEventListener('loadend', end, {once: true});
                                }
                            } catch (e) {
                            }
                            return OrigSend.apply(this, arguments);
                        };
                    } catch (e) {
                        console.log('[封面上传] ⚠️ XHR 监控安装失败:', e && e.message);
                    }

                    try {
                        const origFetch = window.fetch;
                        if (typeof origFetch === 'function') {
                            window.fetch = function (input, init) {
                                let counted = false;
                                try {
                                    const url = typeof input === 'string' ? input : (input && input.url) || '';
                                    const method = (init && init.method) || (input && input.method) || 'GET';
                                    if (isUploadReq(method, url, init && init.body)) {
                                        begin(url);
                                        counted = true;
                                    }
                                } catch (e) {
                                }
                                const p = origFetch.apply(this, arguments);
                                if (!counted || !p || typeof p.then !== 'function') return p;
                                return p.then(
                                    (r) => {
                                        end();
                                        return r;
                                    },
                                    (e) => {
                                        end();
                                        throw e;
                                    }
                                );
                            };
                        }
                    } catch (e) {
                        console.log('[封面上传] ⚠️ fetch 监控安装失败:', e && e.message);
                    }
                    console.log('[封面上传] 🛰️ 上传网络监控已安装');
                };

                // 上传前的基线：请求完成数 + 弹窗里已有的 http 图片。
                // "新增的 http 图"是第二条硬证据 —— 服务端回填 CDN url 了才会出现，
                // 本地预览是 blob:，两者能干净地区分开。
                const uploadBaseline = (root) => {
                    const scope = root || document;
                    const s = window.__douyinUploadStats || {done: 0};
                    return {
                        done: s.done,
                        httpImgs: new Set(
                            Array.from(scope.querySelectorAll('img'))
                                .map((i) => i.src)
                                .filter((u) => /^https?:/i.test(u))
                        )
                    };
                };

                // ── helper：等"图真的传完"，而不是"文件刚被组件接住" ──
                //    判据按可信度排序，命中靠前的直接放行：
                //      A. 上传请求数增加且 inflight 归零 —— 服务端已应答，最硬
                //      B. 弹窗里冒出基线里没有的 http 图 —— 服务端回填了 CDN url，次硬
                //      C. 都没抓到 → 退回"无忙碌元素 + 快照静止"，打醒目日志标明是降级
                const waitUploadSettled = async (root, baseline, {min = 1500, timeout = 30000, stableFor = 4} = {}) => {
                    const scope = root || document;
                    const clsOf = (el) => el.getAttribute('class') || '(无class)';
                    const stats = () => window.__douyinUploadStats || {inflight: 0, done: 0, lastUrl: ''};
                    const base = baseline || {done: stats().done, httpImgs: new Set()};

                    const newHttpImg = () =>
                        Array.from(scope.querySelectorAll('img'))
                            .map((i) => i.src)
                            .find((u) => /^https?:/i.test(u) && !base.httpImgs.has(u));

                    // 窄口径：只认明确表示"正在进行"的信号（抖音这边常年为空，仅作补充）
                    const busyNow = () =>
                        Array.from(scope.querySelectorAll('.semi-spin-animate, [class*="uploading"], [class*="Uploading"]'))
                            .filter((el) => {
                                const cs = window.getComputedStyle(el);
                                if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
                                const r = el.getBoundingClientRect();
                                return r.width > 0 && r.height > 0;
                            });
                    const snap = () => {
                        const imgs = Array.from(scope.querySelectorAll('img')).map((i) => i.src).join('|');
                        const txt = (scope.textContent || '').replace(/\s+/g, '').slice(0, 300);
                        return imgs + '#' + txt;
                    };

                    // 放行前的复查：分片上传（申请 token → 传分片 → commit）在两段之间
                    // 会短暂 inflight=0，直接放行就卡在中间那一刻了。等 900ms 看有没有新请求接上。
                    const confirmIdle = async () => {
                        for (let i = 0; i < 3; i++) {
                            await window.delay(300);
                            if (stats().inflight > 0) return false;
                        }
                        return true;
                    };

                    const start = Date.now();
                    // 地板时间：刚派完 change 时请求还没发出去，
                    // 立刻采样会读到"没请求 + 页面静止"直接假放行
                    await window.delay(min);

                    let last = snap();
                    let stable = 0;
                    let busyLogged = false;
                    let inflightLogged = false;
                    while (Date.now() - start < timeout) {
                        const s = stats();
                        const cost = () => Date.now() - start;

                        if (s.inflight > 0) {
                            if (!inflightLogged) {
                                inflightLogged = true;
                                console.log('[封面上传] ⏳ 上传请求进行中:', s.lastUrl || '(无 url)');
                            }
                            stable = 0;
                        } else if (s.done > base.done) {
                            if (await confirmIdle()) {
                                console.log(
                                    `[封面上传] ✅ 上传请求已完成（${s.done - base.done} 个，耗时 ${cost()}ms，末个: ${s.lastUrl}）`
                                );
                                await window.delay(600); // 给 React 回填 url / 刷新按钮态的时间
                                return true;
                            }
                            stable = 0;
                        } else {
                            const cdn = newHttpImg();
                            if (cdn && (await confirmIdle())) {
                                console.log(`[封面上传] ✅ 已出现服务端回填的图片（耗时 ${cost()}ms）:`, String(cdn).slice(0, 100));
                                await window.delay(600);
                                return true;
                            }
                            const busy = busyNow();
                            const now = snap();
                            if (busy.length) {
                                if (!busyLogged) {
                                    busyLogged = true;
                                    console.log('[封面上传] ⏳ 页面显示上传进行中:', busy.slice(0, 4).map(clsOf).join(' | '));
                                }
                                stable = 0;
                            } else if (now === last) {
                                stable++;
                                if (stable >= stableFor) {
                                    console.log(
                                        `[封面上传] ⚠️ 没抓到任何上传请求，退回"页面静止"判据放行（耗时 ${cost()}ms）。`
                                        + '若又出现"没传完就点按钮"，说明上传走了监控没覆盖的通道，看这行就知道要扩 isUploadReq'
                                    );
                                    return true;
                                }
                            } else {
                                stable = 0;
                            }
                            last = now;
                        }

                        // 这一等最长 30 秒，不续锁的话 40 秒的锁会过期，封面检测轮询会插进来抢点
                        window.__douyinCoverUploadingUntil = Date.now() + 40000;
                        await window.delay(500);
                    }
                    const s = stats();
                    console.log(
                        `[封面上传] ⚠️ 等了 ${timeout}ms 上传仍未收尾，强行继续。inflight=${s.inflight} 完成=${s.done - base.done} 忙碌元素:`,
                        busyNow().slice(0, 4).map(clsOf).join(' | ') || '(无)'
                    );
                    return false;
                };

                installUploadMonitor();

                const usedCovers = new Set(); // 一张封面只用一次，防止两个坑位传同一张
                let slotIndex = 0;
                // 整块加固的总开关，关掉即回退旧行为（只点一级 + modal 为空时退化到整页找 input）
                const slotGuardOn = typeof window.isFeatureEnabled === 'function'
                    ? window.isFeatureEnabled('FIX_DOUYIN_COVER_SLOT_GUARD')
                    : true;

                for (let slotPos = 0; slotPos < coverListWrapEle.length; slotPos++) {
                    slotIndex++;

                    // 🔑 每个坑位现查节点，别用循环开始前那份静态列表：
                    //    上一个坑位传完封面，React 会重渲染整个封面区，旧引用 isConnected 变 false，
                    //    click() 打在脱离文档的孤儿节点上 —— 不报错、不弹窗、什么都不发生，
                    //    症状完美伪装成"选择器写错了"
                    const freshSlots = slotGuardOn ? querySlots() : coverListWrapEle;
                    const item = freshSlots[slotPos] || coverListWrapEle[slotPos];
                    if (!item || (slotGuardOn && !item.isConnected)) {
                        console.log(`[封面设置] ⚠️ 坑位#${slotIndex} 节点已脱离文档且重查不到，跳过`);
                        continue;
                    }

                    const rect = item.getBoundingClientRect();
                    const ratio = rect.width / rect.height;

                    // 每个坑位开工前给锁续期：单个坑位最长 40 秒（下载+等指纹+兜底+确认），
                    // 续期比"一次性上一把大锁"安全 —— 卡住了最多锁 40 秒就自动放行
                    window.__douyinCoverUploadingUntil = Date.now() + 40000;

                    // 坑位之间隔开：上一个弹窗的关闭动画、上一张的上传请求都需要时间，
                    // 连着点会点在还没消失的遮罩上
                    if (slotIndex > 1) {
                        console.log('[封面设置] ⏳ 处理下一个坑位前等待 3 秒...');
                        await window.delay(3000);
                    }

                    // 🔑 只看朝向，不看比值差。
                    //    原来用 |图比值 - 坑位比值| > 1.5 过滤，两头都不对：
                    //      · 太严：3:4 坑位(0.75) 配 9:16 图(0.56) 明明该配，某些尺寸却被差值挡掉
                    //      · 也太松：3:4 坑位(0.75) 配 16:9 图(1.78) 差值才 1.03，横图照样塞进竖坑位
                    //    ratio 是个双曲的量（竖图挤在 0~1，横图铺开到 1~∞），拿它做线性距离本来就不成立。
                    //    正解是先按朝向分桶，桶内再用比值近似度排序当 tie-break —— 这也保证了
                    //    同一张图不会被所有坑位重复占用（usedCovers 仍然逐张扣除）
                    const orientationOf = (r) => (r > 1.05 ? '横' : r < 0.95 ? '纵' : '方');
                    const slotOrientation = orientationOf(ratio);
                    const orientationFits = (coverOrientation) =>
                        coverOrientation === slotOrientation           // 朝向一致
                        || coverOrientation === '方'                    // 近正方图哪个坑位都能用
                        || slotOrientation === '方';

                    let best = null;
                    for (const cover of loadedCovers) {
                        if (!cover || usedCovers.has(cover.url)) continue;
                        if (!orientationFits(orientationOf(cover.ratio))) continue;
                        const diff = Math.abs(cover.ratio - ratio);
                        if (!best || diff < best.diff) best = {cover, diff};
                    }

                    // 朝向一张都不匹配时，不空手而归 —— 有图能用就用，总比让平台拿视频帧凑强。
                    // 宽松兜底是刻意设计：判据宁可放过，也别把本来能成的坑位直接毙掉
                    if (!best) {
                        for (const cover of loadedCovers) {
                            if (!cover || usedCovers.has(cover.url)) continue;
                            const diff = Math.abs(cover.ratio - ratio);
                            if (!best || diff < best.diff) best = {cover, diff, orientationMismatch: true};
                        }
                        if (best) {
                            console.warn(
                                `[封面设置] ⚠️ 坑位#${slotIndex} 没有${slotOrientation}向封面，退而用${orientationOf(best.cover.ratio)}向的凑`
                                + `（坑位比值 ${ratio.toFixed(2)} / 图片比值 ${best.cover.ratio.toFixed(2)}），平台可能会自动裁剪`
                            );
                        }
                    }

                    if (!best) {
                        // 逐张说明为什么没选上，省得再靠猜（现在只剩"作废"和"被前面坑位用掉"两种）
                        const why = loadedCovers
                            .map((c, i) =>
                                !c ? `#${i + 1} 预加载作废`
                                    : usedCovers.has(c.url) ? `#${i + 1} 已被前面坑位用掉`
                                        : `#${i + 1} ${orientationOf(c.ratio)}向(${c.ratio.toFixed(2)})`
                            )
                            .join(' | ');
                        console.log(
                            `[封面设置] 坑位#${slotIndex} ${slotOrientation}向(比值 ${ratio.toFixed(2)}) 没有任何可用封面，跳过。逐张原因: ${why}`
                        );
                        continue;
                    }
                    const customCover = best.cover;
                    usedCovers.add(customCover.url);
                    console.log(
                        `[封面匹配] 坑位#${slotIndex} ${slotOrientation}向 ${ratio.toFixed(2)}`
                        + ` ← 封面${orientationOf(customCover.ratio)}向 ${customCover.ratio.toFixed(2)}`
                        + ` ${customCover.width}×${customCover.height} ${customCover.url}`
                    );

                    // 🔑 坑位的"视觉签名"：坑位里那张缩略图的 src / background-image。
                    //    点完「完成」拿它跟事后对比 —— 这是唯一能证明"封面真换上了"的东西。
                    //    弹窗关了 ≠ 换成功：文件被组件拒收时，点「完成」照样把弹窗关掉。
                    const slotSignature = (el) => {
                        if (!el || !el.isConnected) return '(节点已失效)';
                        const parts = [];
                        const nodes = [el, ...Array.from(el.querySelectorAll('*'))].slice(0, 40);
                        for (const n of nodes) {
                            if (n.tagName === 'IMG' && n.src) parts.push(n.src);
                            const bg = window.getComputedStyle(n).backgroundImage;
                            if (bg && bg !== 'none') parts.push(bg);
                        }
                        return parts.join('|') || '(无图)';
                    };
                    const sigBefore = slotSignature(item);

                    // 🔑 开弹窗要分级重试，不能点一次就认命。
                    //    实测症状：两个坑位只有第二个成功，第一个从头到尾没弹窗 ——
                    //    click() 打在容器 div 上，React 的 onClick 未必挂在这一层；
                    //    元素在可视区外时原生 click 也可能不生效。
                    const openModal = async () => {
                        try {
                            item.scrollIntoView({block: 'center', behavior: 'instant'});
                        } catch (e) {
                            try {
                                item.scrollIntoView();
                            } catch (e2) {
                            }
                        }
                        await window.delay(300);

                        const tries = [
                            ['原生 click', async () => item.click()],
                            ['MouseEvent 序列', async () => {
                                const r = item.getBoundingClientRect();
                                const x = r.left + r.width / 2;
                                const y = r.top + r.height / 2;
                                for (const type of ['mouseover', 'mousedown', 'mouseup', 'click']) {
                                    item.dispatchEvent(new MouseEvent(type, {
                                        bubbles: true, cancelable: true, view: window, clientX: x, clientY: y
                                    }));
                                }
                            }],
                            ['子元素 click', async () => {
                                // onClick 常挂在里层的图片/悬浮蒙层上，父容器点不动就往里点一层
                                const inner = item.querySelector('img, [class*="mask"], [class*="hover"], div');
                                (inner || item).click();
                            }],
                            ['原生鼠标', async () => {
                                if (typeof window.nativeClickElement === 'function') {
                                    await window.nativeClickElement(item, {logPrefix: '[封面上传]'});
                                } else {
                                    console.log('[封面上传] ⚠️ nativeClickElement 不可用，跳过这级');
                                }
                            }]
                        ];

                        for (const [name, act] of tries) {
                            try {
                                await act();
                            } catch (e) {
                                console.log(`[封面上传] ⚠️ ${name} 抛错:`, e.message);
                                continue;
                            }
                            // 第一级给足 8 秒（弹窗内容要现拉），后面几级只需确认有没有反应
                            const m = await window.__douyinWaitVisibleModal(name === '原生 click' ? 8000 : 4000);
                            if (m) {
                                console.log(`[封面上传] ✅ 弹窗已打开（${name} 生效）:`, m.className);
                                return m;
                            }
                            console.log(`[封面上传] ⚠️ ${name} 后没等到弹窗，换下一级`);
                            if (!slotGuardOn) break; // 开关关掉时只点第一级，回退旧行为
                        }
                        return null;
                    };

                    const modal = await openModal();

                    // 🔑 没拿到弹窗引用，绝不等于"这个坑位没救了"。
                    //    上一版在这里直接 continue，结果实测**两个坑位全军覆没** ——
                    //    因为旧代码的 `searchRoot = modal || document` 退化路径，正是
                    //    竖封面唯一成功的那条路：弹窗其实开着，只是探测判据没认出来，
                    //    退到整页去找反而找对了「上传封面」的 input。
                    //    所以这里保留降级，但降级必须**靠文案锚定**而不是碰运气取"最后一个"，
                    //    见下方 findUploadRootByText 的 strictMode。
                    const degraded = !modal;
                    if (degraded) {
                        window.__douyinDumpModalState(`坑位#${slotIndex} 四级点击后仍没拿到弹窗`);
                        console.log(
                            `[封面上传] ⚠️ 坑位#${slotIndex} 降级为整页查找模式（只认文案含「封面」的上传容器，找不到就放弃）`
                        );
                    }

                    // 🔑 弹窗里有两个上传入口：左侧「生成参考图」的 + 和右侧「上传封面」的 +。
                    //    两个都是 .semi-upload-hidden-input，取"弹窗内第一个"在 DOM 顺序上会命中
                    //    左边的参考图 input —— 塞对了文件也进不了封面。必须先按按钮文案锁定
                    //    「上传封面」那颗按钮，再回溯它自己的 .semi-upload 容器，只在容器里找 input。
                    const searchRoot = modal || document;

                    // 先等弹窗把上传区渲染出来（任意一个 hidden input 出现即可，证明 Upload 组件已挂载）
                    try {
                        await waitForElement('.semi-upload-hidden-input', 8000, 200, searchRoot);
                    } catch (e) {
                        console.log('[封面上传] ⚠️ 弹窗内没等到任何上传 input:', e.message);
                    }

                    // 一次性诊断：把弹窗内所有 file input 连它所属容器的文案一起打出来。
                    // 万一这次还没成，照这行就能直接判断该塞哪个，不用再靠猜。
                    const allInputs = Array.from(searchRoot.querySelectorAll('input[type="file"]'));
                    console.log(
                        `[封面上传] 🔍 弹窗内共 ${allInputs.length} 个 file input:`,
                        allInputs
                            .map((el, i) => {
                                const box = el.closest('.semi-upload');
                                const boxText = box ? (box.textContent || '').trim().slice(0, 15) : '无容器';
                                return `#${i}[${el.className}] accept=${el.accept || '未设'} 容器="${boxText}"`;
                            })
                            .join(' || ')
                    );

                    // 按文案找「上传封面」按钮，回溯到它所属的 .semi-upload 容器
                    // strict = 降级模式（searchRoot 是整个 document）：
                    //   此时"取最后一个 .semi-upload"纯属碰运气，页面主体的视频上传区
                    //   也是 .semi-upload，碰错了就把封面塞进视频上传口。
                    //   所以降级时只认文案里明确出现「封面」的容器，宁可放弃也不乱塞。
                    const findUploadRootByText = (strict) => {
                        const candidates = Array.from(
                            searchRoot.querySelectorAll('.semi-upload')
                        ).filter((el) => {
                            if (!strict) return true;
                            // 降级模式额外要求容器本身可见，排掉隐藏的历史节点
                            const r = el.getBoundingClientRect();
                            return r.width > 0 && r.height > 0;
                        });
                        if (strict) {
                            const hit = candidates.find((el) => {
                                const t = el.textContent || '';
                                return t.includes('封面') && !t.includes('参考图');
                            });
                            if (!hit) {
                                console.log(
                                    `[封面上传] 🔍 降级模式下整页 ${candidates.length} 个可见 .semi-upload，无一文案含「封面」:`,
                                    candidates.map((el, i) => `#${i}"${(el.textContent || '').trim().slice(0, 12)}"`).join(' || ') || '(空)'
                                );
                            }
                            return hit || null;
                        }
                        // 优先：容器内文字含「上传封面」/「上传」，且不含「参考图」
                        let hit = candidates.find((el) => {
                            const t = el.textContent || '';
                            return t.includes('上传封面') || (t.includes('上传') && !t.includes('参考图'));
                        });
                        // 兜底：排除掉明显是参考图的容器后，取最后一个（右侧封面上传一般排在后面）
                        // 只在弹窗内才敢这么兜底 —— 范围已经被弹窗限死，最多是选错弹窗内的入口
                        if (!hit) {
                            const notRef = candidates.filter(
                                (el) => !((el.textContent || '').includes('参考图'))
                            );
                            hit = notRef[notRef.length - 1] || candidates[candidates.length - 1];
                        }
                        return hit || null;
                    };

                    const uploadRoot = findUploadRootByText(degraded && slotGuardOn);
                    let uploadInput = null;
                    if (uploadRoot) {
                        // 🔑 优先 .semi-upload-hidden-input：-replace 那个依赖 Semi 内部的 replaceIdx
                        //    （只有用户点文件项的"替换"按钮时才会被赋值），脚本直接塞行为不可控
                        uploadInput = uploadRoot.querySelector('.semi-upload-hidden-input')
                            || uploadRoot.querySelector('.semi-upload-hidden-input-replace');
                    }
                    // 实在没定位到容器就退回"范围内第一个"。
                    // 但降级模式下这个范围是整个 document，随便挑一个等于乱塞，必须禁掉。
                    if (!uploadInput && !(degraded && slotGuardOn)) {
                        uploadInput = searchRoot.querySelector('.semi-upload-hidden-input')
                            || searchRoot.querySelector('.semi-upload-hidden-input-replace');
                    }
                    if (!uploadInput) {
                        usedCovers.delete(customCover.url); // 这张没用掉，退回去给后面的坑位
                        console.log(`[封面上传] ⚠️ 坑位#${slotIndex} 没找到可信的封面上传 input，跳过该坑位`);
                        continue;
                    }
                    console.log(
                        '[封面上传] 命中 input:', uploadInput.className,
                        '| accept:', uploadInput.accept,
                        '| 定位到上传容器:', !!uploadRoot,
                        '| 容器文案:', uploadRoot ? (uploadRoot.textContent || '').slice(0, 20) : '(无)'
                    );

                    const {blob, contentType} = await downloadFile(customCover.url, 'image/png');
                    const fileType = contentType || 'image/png';
                    // 文件名跟真实 MIME 对齐：input 的 accept 按扩展名校验，
                    // 用标题拼 ".png" 可能拼出 "undefined.png"、超长文件名或类型对不上
                    const ext = (fileType.split('/')[1] || 'png').replace('jpeg', 'jpg');
                    const file = new File([blob], `cover_${slotIndex}_${Date.now()}.${ext}`, {type: fileType});

                    const effectRoot = modal || uploadInput.closest('.semi-upload') || document;

                    // 🔑 弹窗开了但封面没换掉时，第一嫌疑是「Semi 的 beforeUpload 把文件拒了」——
                    //    抖音对封面有尺寸/比例/体积要求，不合格就弹个 toast 然后什么都不做。
                    //    脚本这边看起来"派发成功"，实际文件根本没进上传队列。
                    //    所以注入前先记下已有的提示，注入后把新增的提示原文打出来。
                    const toastTexts = () =>
                        Array.from(
                            document.querySelectorAll(
                                '.semi-toast, .semi-toast-content, .semi-notification, .semi-notification-content, [class*="toast"], [class*="Toast"], [class*="message-"]'
                            )
                        )
                            .map((el) => (el.textContent || '').trim())
                            .filter((t) => t && t.length < 120);
                    const toastBase = new Set(toastTexts());
                    const newToasts = () => toastTexts().filter((t) => !toastBase.has(t));

                    // 本地预览是 blob: 图，出现即证明文件被组件接住了（比指纹更直接）
                    const blobImgCount = () =>
                        Array.from(effectRoot.querySelectorAll('img'))
                            .filter((i) => /^blob:/i.test(i.src || '')).length;
                    const blobBase = blobImgCount();

                    const before = fingerprint(effectRoot);
                    // 基线必须在派发 change 之前取：晚一步，上传请求已经发出去甚至已完成，
                    // done 计数和 http 图集合就都被污染了，判据直接失效
                    const upBase = uploadBaseline(effectRoot);

                    // 🔑 注入要允许重试：第一次派发被 React 丢掉（_valueTracker 比对）、
                    //    或者组件刚挂载还没绑好 onChange，都会让文件悄无声息地消失。
                    //    "派发完就往下走"是上一版最大的一厢情愿。
                    let fileAccepted = false;
                    for (let attempt = 1; attempt <= 2 && !fileAccepted; attempt++) {
                        // 每次重新定位 input：上一次尝试可能已让 React 重渲染上传区
                        const freshInput =
                            (uploadRoot && uploadRoot.isConnected
                                ? uploadRoot.querySelector('.semi-upload-hidden-input')
                                : null) || (uploadInput.isConnected ? uploadInput : null);
                        if (!freshInput) {
                            console.log(`[封面上传] ⚠️ 第 ${attempt} 次注入前 input 已脱离文档，重新定位失败`);
                            break;
                        }

                        fireFileInput(freshInput, file);
                        console.log(`[封面上传] 已注入并派发 change（第 ${attempt} 次）:`, file.name, blob.size, 'bytes');

                        if (await waitFingerprintChange(effectRoot, before, 6000) || blobImgCount() > blobBase) {
                            fileAccepted = true;
                            console.log('[封面上传] 📥 组件已接住文件（注意：这只代表进了组件，不代表传完）');
                            break;
                        }

                        console.log('[封面上传] ⚠️ 派发 change 后页面无反应，启用 fiber 兜底');
                        if (callReactOnChange(freshInput)) {
                            if (await waitFingerprintChange(effectRoot, before, 6000) || blobImgCount() > blobBase) {
                                fileAccepted = true;
                                console.log('[封面上传] 📥 fiber 兜底生效');
                                break;
                            }
                            console.log('[封面上传] ❌ fiber 兜底后仍无反应');
                        }

                        // 组件把文件拒了的话，提示语通常已经弹出来了，原文比任何猜测都有用
                        const tips = newToasts();
                        if (tips.length) {
                            console.log(`[封面上传] 💬 页面新增提示（很可能就是拒收原因）: ${tips.join(' / ')}`);
                        }
                        if (attempt < 2) {
                            console.log('[封面上传] 🔁 换一次重新注入…');
                            await window.delay(1200);
                        }
                    }

                    if (!fileAccepted) {
                        const tips = newToasts();
                        console.log(
                            `[封面上传] ❌ 坑位#${slotIndex} 文件始终没被组件接住`
                            + (tips.length ? `，页面提示: ${tips.join(' / ')}` : '，且页面没弹任何提示')
                        );
                        console.log(
                            '[封面上传] 🔬 当前 input 状态:',
                            `files=${uploadInput.files ? uploadInput.files.length : 'null'}`,
                            `| accept=${uploadInput.accept || '未设'}`,
                            `| isConnected=${uploadInput.isConnected}`,
                            `| 文件类型=${fileType} 尺寸=${customCover.width}×${customCover.height}`
                        );
                    }

                    // 🔑 等图真的传完再点「完成」。少了这一步就是"图没上传完就点了按钮"，
                    //    提交上去的是半成品封面。指纹变化只证明文件进了组件，页面静止也只
                    //    证明本地预览渲染完了 —— 传没传完得看网络，见 waitUploadSettled 的注释。
                    //    文件压根没被接住时不必等：等 30 秒也等不出上传请求。
                    if (fileAccepted) {
                        await waitUploadSettled(effectRoot, upBase, {min: 1500, timeout: 30000});
                    }
                    // 收尾之后再给 React 一点时间（裁剪框定型、按钮态刷新）
                    await window.delay(800);

                    // 🔑 按文案锁定「完成」（底部并排着「重新检测」「完成」「设置横封面」，
                    //    左侧还有「AI生成封面」，取错一个就前功尽弃）。
                    //    注：「完成」看着是灰的但并非 disabled（实测确认），所以下面那圈
                    //    "等它变可用"的轮询正常情况下第一轮就直接放行，只当极端情况的保险；
                    //    真正防早点的是上面的 waitUploadSettled。
                    //
                    //    「完成」必须在弹窗范围里找。modal 为 null（降级模式）时往上回溯
                    //    到上传 input 最近的重叠层容器，只在该层找 —— 整页范围找「完成」
                    //    可能点到页面别处的按钮（比如发布页顶部的「发布」）。
                    const confirmScope = modal
                        || (() => {
                            const start = uploadInput || uploadRoot;
                            if (!start) return null;
                            let node = start;
                            while (node && node !== document.body && node !== document) {
                                const cls = node.className || '';
                                if (typeof cls === 'string' && /semi-modal|semi-sidesheet|modal|overlay|drawer|popup/i.test(cls)) {
                                    return node;
                                }
                                node = node.parentElement;
                            }
                            return null;
                        })();
                    if (confirmScope) {
                        const isDisabled = (b) =>
                            b.disabled === true
                            || b.hasAttribute('disabled')
                            || b.getAttribute('aria-disabled') === 'true'
                            || /semi-button-disabled/.test(b.className || '');
                        const allBtns = () => Array.from(confirmScope.querySelectorAll('.semi-button, button'));
                        const dumpBtns = () =>
                            allBtns()
                                .map((b) => {
                                    const t = (b.textContent || '').trim();
                                    return t ? `「${t}」${isDisabled(b) ? '[禁用]' : '[可点]'}` : '';
                                })
                                .filter(Boolean)
                                .join(' / ');
                        const findConfirm = () => {
                            const btns = allBtns();
                            const pick = (re) => btns.find((b) => re.test((b.textContent || '').trim()));
                            return pick(/^完成$/) || pick(/^(确定|确认|保存)$/) || pick(/^完成/);
                        };

                        console.log('[封面上传] 🔍 弹窗按钮一览:', dumpBtns() || '(一个都没有)');

                        // 等「完成」从禁用变可用，最长 20 秒
                        let confirmBtn = null;
                        const waitUntil = Date.now() + 20000;
                        while (Date.now() < waitUntil) {
                            const b = findConfirm();
                            if (b && !isDisabled(b)) {
                                confirmBtn = b;
                                break;
                            }
                            // 这一等最多吃掉 20 秒，不续锁的话 40 秒的锁会过期，封面检测轮询会插进来抢点
                            window.__douyinCoverUploadingUntil = Date.now() + 40000;
                            await window.delay(500);
                        }

                        if (!confirmBtn) {
                            const stillThere = findConfirm();
                            console.log(
                                stillThere
                                    ? `[封面上传] ⚠️ 等了 20 秒「完成」仍是禁用态，强行点一次试试。按钮: ${dumpBtns()}`
                                    : `[封面上传] ⚠️ 弹窗里压根没有「完成」按钮。现有: ${dumpBtns()}`
                            );
                            confirmBtn = stillThere;
                        }

                        if (confirmBtn) {
                            // ⚠️ 两个坑都别踩：
                            //    1) offsetParent === null 判不了 —— Semi modal 是 position:fixed，
                            //       fixed 元素的 offsetParent 天生就是 null，会把"还开着"误判成"已关闭"
                            //    2) animate-show 更判不了 —— 那 class 是入场动画期间才挂的，早没了，
                            //       拿它判等于每次都返回"已关闭"，第一次 click 就假报成功，兜底全废
                            //    只认两件事：还在文档里，且真的可见。
                            //    注意用 confirmScope 而不是 modal —— 降级模式下 modal 是 null，
                            //    写 modal.isConnected 会直接抛 TypeError，被外层 catch 吞掉，
                            //    表现成"封面设置失败"却完全看不出是空指针。
                            const modalClosed = () => {
                                if (!confirmScope.isConnected) return true;
                                const cs = window.getComputedStyle(confirmScope);
                                if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return true;
                                const r = confirmScope.getBoundingClientRect();
                                return r.width < 100 || r.height < 100;
                            };

                            // 三级点击：合成 click → 鼠标事件序列 → 主进程真实点击。
                            // 每级点完都验证弹窗是否关闭，关了立刻收工，避免多点一次误触后续弹窗
                            const attempts = [
                                ['element.click', async (el) => {
                                    el.click();
                                }],
                                ['mouse 序列', async (el) => {
                                    const r = el.getBoundingClientRect();
                                    const o = {
                                        bubbles: true, cancelable: true, view: window,
                                        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
                                    };
                                    el.dispatchEvent(new MouseEvent('mouseover', o));
                                    el.dispatchEvent(new MouseEvent('mousedown', o));
                                    el.dispatchEvent(new MouseEvent('mouseup', o));
                                    el.dispatchEvent(new MouseEvent('click', o));
                                }],
                                ['nativeClick', async (el) => {
                                    if (typeof window.nativeClickElement === 'function') {
                                        await window.nativeClickElement(el, {logPrefix: '[封面上传]'});
                                    } else {
                                        console.log('[封面上传] ⚠️ nativeClickElement 不可用，跳过这级兜底');
                                    }
                                }],
                            ];

                            let closed = false;
                            for (const [name, doClick] of attempts) {
                                // 每次重新找按钮：上一次点击可能已让 React 重渲染，旧引用会脱离文档
                                const el = findConfirm() || confirmBtn;
                                try {
                                    await doClick(el);
                                    console.log(`[封面上传] 已用 ${name} 点击「${(el.textContent || '').trim()}」`);
                                } catch (e) {
                                    console.log(`[封面上传] ⚠️ ${name} 点击抛错:`, e.message);
                                }
                                await window.delay(1500);
                                if (modalClosed()) {
                                    closed = true;
                                    console.log(`[封面上传] ✅ 弹窗已关闭（${name} 生效）`);
                                    break;
                                }
                                window.__douyinCoverUploadingUntil = Date.now() + 40000;
                            }
                            if (!closed) {
                                console.log('[封面上传] ❌ 三种点击都没能关掉弹窗，当前按钮状态:', dumpBtns());
                            }
                        }
                    } else {
                        console.log('[封面上传] ⚠️ 没拿到弹窗引用，跳过确认按钮（避免误点页面其他按钮）');
                    }

                    // 🔑 收尾必须回头验坑位。"弹窗关了"只证明按钮点动了，不证明封面换上了 ——
                    //    实测就出现过「已用 mouse 序列 点击「完成」」照打、图片纹丝不动的情况。
                    //    坑位缩略图的 src/background-image 变了才算真成功。
                    await window.delay(1500);
                    const freshItem = querySlots()[slotPos] || item;
                    const sigAfter = slotSignature(freshItem);
                    if (sigAfter !== sigBefore && sigAfter !== '(节点已失效)' && sigAfter !== '(无图)') {
                        console.log(`[封面上传] 🎉 坑位#${slotIndex} 封面确认已更换`);
                    } else {
                        // 这张没真正用上，退回给后面的坑位，别让它白占一个名额
                        usedCovers.delete(customCover.url);
                        console.log(
                            `[封面上传] ❌ 坑位#${slotIndex} 点完「完成」后缩略图没变化，封面【没有】换上（该封面已退回）。`
                            + `\n    文件是否被组件接住: ${fileAccepted ? '是' : '否'}`
                            + `\n    换前签名: ${String(sigBefore).slice(0, 120)}`
                            + `\n    换后签名: ${String(sigAfter).slice(0, 120)}`
                            + (newToasts().length ? `\n    页面提示: ${newToasts().join(' / ')}` : '\n    页面无提示')
                        );
                    }
                }

                // 所有坑位处理完，立刻解锁，别让封面检测白等到 40 秒过期
                window.__douyinCoverUploadingUntil = 0;
                console.log('[封面上传] 🔓 已解锁，封面检测轮询恢复');
            } else {
                await retryOperation(async () => {
                    // 尝试多种选择器策略
                    let coverInput = null;
                    const selectors = [
                        '.recommendCover-vWWsHB:nth-child(1)',
                        '.recommendCover-vWWsHB:first-child',
                        '.recommendCover-vWWsHB'
                    ];

                    for (const selector of selectors) {
                        try {
                            coverInput = await waitForElement(selector, 10000); // 🔑 增加到 10 秒
                            if (coverInput) {
                                console.log(`[封面设置] ✅ 找到封面元素: ${selector}`);
                                break;
                            }
                        } catch (e) {
                            console.log(`[封面设置] ⚠️ 未找到: ${selector}`);
                        }
                    }

                    if (!coverInput) {
                        throw new Error('未找到任何封面元素');
                    }

                    console.log("🚀 ~ fillFormData ~ coverInput: ", coverInput);

                    // 模拟完整的鼠标点击事件序列（更接近真实用户行为）
                    const rect = coverInput.getBoundingClientRect();
                    const x = rect.left + rect.width / 2;
                    const y = rect.top + rect.height / 2;

                    const mouseEventOptions = {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        clientX: x,
                        clientY: y,
                        screenX: x,
                        screenY: y,
                        button: 0
                    };

                    // 完整的鼠标事件序列
                    coverInput.dispatchEvent(new MouseEvent('mouseover', mouseEventOptions));
                    await window.delay(50);

                    coverInput.dispatchEvent(new MouseEvent('mousedown', mouseEventOptions));
                    await window.delay(50);

                    coverInput.dispatchEvent(new MouseEvent('mouseup', mouseEventOptions));
                    await window.delay(50);

                    coverInput.dispatchEvent(new MouseEvent('click', mouseEventOptions));

                    console.log('[封面设置] ✅ 已触发完整点击事件序列');

                    await window.delay(1000);

                    // 尝试查找并确认弹窗（如果没有弹窗也没关系）
                    try {
                        // 用公共 helper 找可见弹窗（别等 animate-show 动画 class，见文件顶部注释）
                        const confirmDialog = await window.__douyinWaitVisibleModal(3000);
                        if (confirmDialog) {
                            const btns = Array.from(confirmDialog.querySelectorAll('.semi-button, button'));
                            const pick = (re) => btns.find((b) => re.test((b.textContent || '').trim()));
                            const confirmBtn = pick(/^完成$/)
                                || pick(/^(确定|确认|保存)$/)
                                || btns.find((b) => /semi-button-primary/.test(b.className || ''));
                            if (confirmBtn) {
                                confirmBtn.click();
                                console.log('[封面设置] ✅ 已确认弹窗:', (confirmBtn.textContent || '').trim());
                            } else {
                                console.log(
                                    '[封面设置] ⚠️ 弹窗里没找到确认按钮:',
                                    btns.map((b) => (b.textContent || '').trim()).filter(Boolean).join(' / ')
                                );
                            }
                        } else {
                            console.log('[封面设置] ⚠️ 未找到确认弹窗，可能封面已自动设置');
                        }
                    } catch (dialogError) {
                        console.log('[封面设置] ⚠️ 确认弹窗处理异常:', dialogError.message);
                    }
                }, 5, 1000);
            }
        } catch (error) {
            console.log('[封面设置] ⚠️ 封面设置失败:', error.message);
        }

        // 检测封面是否通过检测
        console.log('[抖音发布] ⏳ 等待封面检测通过...');
        const coverCheckStartTime = Date.now();
        const coverCheckTimeout = 180000; // 3分钟超时（增加到3分钟，给封面检测更多时间）
        const coverCheckInterval = 2000;
        const maxCoverRetries = 90; // 🔑 最大重试次数（90次 * 2秒 = 180秒，与超时时间一致）
        let coverRetryCount = 0;

        while (Date.now() - coverCheckStartTime < coverCheckTimeout && coverRetryCount < maxCoverRetries) {
            coverRetryCount++;
            const elapsedTime = Math.round((Date.now() - coverCheckStartTime) / 1000);
            console.log(`[封面检测] 第 ${coverRetryCount}/${maxCoverRetries} 次检查，已耗时 ${elapsedTime} 秒`);

            let checkElement = null;
            try {
                checkElement = await waitForElement('.cover-check [class*="title-"]', 10000); // 🔑 增加到 10 秒
            } catch (e) {
                console.log('[封面检测] ⚠️ 未找到检测元素，继续等待...');
                await delay(coverCheckInterval);
                continue;
            }

            const currentText = checkElement.textContent || '';
            console.log('[封面检测] 当前状态:', currentText);

            if (currentText.includes('封面检测通过')) {
                console.log('[封面检测] ✅ 检测通过');
                break;
            }

            // 🔑 让路：抖音是 SPA，视频传完 URL 变化触发 did-navigate-in-page 会把脚本
            //    重新注入一次，页面上于是有两个实例。另一个实例可能正在往弹窗里塞自定义封面
            //    （executeAllFormSteps 的封面块），此时点推荐封面 / 点「完成」会把它刚塞进去的
            //    文件和弹窗一起冲掉 —— 双方互相打断，两边都失败。
            //    锁是过期时间戳，最长只让 40 秒，对方崩了也不会把这里永久卡住。
            const coverLockUntil = window.__douyinCoverUploadingUntil || 0;
            if (Date.now() < coverLockUntil) {
                const leftSec = Math.ceil((coverLockUntil - Date.now()) / 1000);
                console.log(`[封面检测] ⏸️ 自定义封面上传中，本轮只检测不操作（锁还剩 ${leftSec} 秒）`);
                // 让路不该吃掉重试预算；while 条件里的 180 秒时间闸仍然兜底，不会死循环
                coverRetryCount--;
                await delay(coverCheckInterval);
                continue;
            }

            // 尝试设置封面
            console.log('[封面检测] ⚠️ 未通过，尝试设置封面...');
            try {
                let coverInput = null;
                const selectors = [
                    '[class*="recommendCover-"]:nth-child(1)',
                    '[class*="recommendCover-"]:first-child',
                    '[class*="recommendCover-"]'
                ];

                for (const selector of selectors) {
                    try {
                        coverInput = await waitForElement(selector, 10000); // 🔑 增加到 10 秒
                        if (coverInput) {
                            console.log(`[封面设置] ✅ 找到封面元素: ${selector}`);
                            break;
                        }
                    } catch (e) {
                        // 继续尝试下一个选择器
                    }
                }

                if (coverInput) {
                    const rect = coverInput.getBoundingClientRect();
                    const x = rect.left + rect.width / 2;
                    const y = rect.top + rect.height / 2;

                    const mouseEventOptions = {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        clientX: x,
                        clientY: y,
                        screenX: x,
                        screenY: y,
                        button: 0
                    };

                    coverInput.dispatchEvent(new MouseEvent('mouseover', mouseEventOptions));
                    await delay(50);
                    coverInput.dispatchEvent(new MouseEvent('mousedown', mouseEventOptions));
                    await delay(50);
                    coverInput.dispatchEvent(new MouseEvent('mouseup', mouseEventOptions));
                    await delay(50);
                    coverInput.dispatchEvent(new MouseEvent('click', mouseEventOptions));

                    console.log('[封面设置] ✅ 已触发封面点击');
                    await delay(1000);

                    // 尝试确认弹窗
                    try {
                        // 用公共 helper 找可见弹窗（别等 animate-show 动画 class，见文件顶部注释）
                        const confirmDialog = await window.__douyinWaitVisibleModal(3000);
                        if (confirmDialog) {
                            // 按文案锁「完成」，别取第一个 primary —— 底部并排着「重新检测」「完成」「设置横封面」
                            const btns = Array.from(confirmDialog.querySelectorAll('.semi-button, button'));
                            const pick = (re) => btns.find((b) => re.test((b.textContent || '').trim()));
                            const confirmBtn = pick(/^完成$/)
                                || pick(/^(确定|确认|保存)$/)
                                || btns.find((b) => /semi-button-primary/.test(b.className || ''));
                            if (confirmBtn) {
                                confirmBtn.click(); // new Event('click') 缺鼠标属性 React 未必认，原生 click 更稳
                                console.log('[封面设置] ✅ 已确认弹窗:', (confirmBtn.textContent || '').trim());
                            } else {
                                console.log(
                                    '[封面设置] ⚠️ 弹窗里没找到确认按钮:',
                                    btns.map((b) => (b.textContent || '').trim()).filter(Boolean).join(' / ')
                                );
                            }
                        } else {
                            console.log('[封面设置] ⚠️ 未找到确认弹窗');
                        }
                    } catch (dialogError) {
                        console.log('[封面设置] ⚠️ 确认弹窗处理异常:', dialogError.message);
                    }

                    await delay(3000);
                }
            } catch (coverError) {
                console.log('[封面设置] ❌ 设置封面失败:', coverError.message);
            }

            await delay(coverCheckInterval);
        }

        // 🔑 检查退出原因
        if (coverRetryCount >= maxCoverRetries) {
            console.log(`[抖音发布] ⚠️ 封面设置重试次数已达上限(${maxCoverRetries}次)，继续发布流程`);
        }

        console.log('[抖音发布] ✅ 封面检测完成，准备点击发布按钮');
        await delay(1000);

        const clickResult = await clickDouyinPublishButton(publishBtn); // 优先可信点击，失败时回退普通点击

        if (!clickResult.success) {
            console.error('[抖音发布] ❌ 所有点击尝试均失败:', clickResult.message);
            // 清除提前保存的数据（使用窗口专属 key 和通用 key，确保兼容性）
            await clearDouyinPublishSuccessData(windowId);
            // 发送失败统计
            await sendStatisticsError(publishId, clickResult.message || '点击发布按钮失败', '抖音发布');
            publishRunning = false;
            throw new Error('发布按钮点击失败: ' + clickResult.message);
        }

        console.log('[抖音发布] ✅ 发布按钮已点击');
        // 成功统计仅由成功页或本地明确成功确认发送，避免点击成功抢占真实结果的去重锁。
        console.log('[抖音发布] 📨 平台提示:', {
            message: clickResult.message,
            clickMode: clickResult.clickMode || '',
            trustedMessage: clickResult.trustedMessage || '',
        });

        // 等待页面稳定
        await delay(2000);

        const initialPhoneVerifyMessage =
            getDouyinPhoneVerifyMessage() ||
            (isDouyinPhoneVerifyMessage(clickResult.message) ? clickResult.message : '');
        if (initialPhoneVerifyMessage) {
            console.log('[抖音发布] 📱 点击后检测到手机号认证弹窗:', initialPhoneVerifyMessage);
            const shouldExit = await reportDouyinPhoneVerifyFailure('post-click', initialPhoneVerifyMessage);
            // 🔑 如果返回 true，说明需要退出（旧逻辑兼容）；如果返回 false，继续轮询
            if (shouldExit) {
                return;
            }
            // 如果返回 false，不 return，继续执行后续的轮询逻辑
            console.log('[抖音发布] 📱 手机验证错误已上报，继续轮询监听后续错误...');
        }

        // 开发环境弹窗显示平台提示信息
        if (window.browserAPI && window.browserAPI.isProduction === false) {
            alert(`抖音发布结果：\n\n${clickResult.message}`);
        }

        // 点击成功后，不再判断 toast 消息（因为各平台提示词不统一，无法准确判断）
        // 直接认为发布已提交，等待页面跳转到成功页
        // 成功统计由 publish-success.js 在成功页发送
        console.log('[抖音发布] ✅ 发布已提交，消息:', clickResult.message);

        // 🔑 捕获登录过期：不上报失败、不关窗，停窗等待用户手动登录后自动续发
        if (isDouyinLoginExpiredMessage(clickResult.message)) {
            console.warn('[抖音发布] 🔐 检测到登录过期消息，暂停发布流程等待用户手动登录:', clickResult.message);
            publishRunning = false;
            startDouyinPublishLoginWatch();
            return;
        }

        if (isDouyinNetworkErrorMessage(clickResult.message)) {
            console.error('[抖音发布] 🚨 检测到网络错误消息:', clickResult.message);
            const reported = await sendStatisticsError(publishId, '检测到网络错误提示：' + clickResult.message, '抖音发布');
            publishRunning = false;
            if (reported) {
                await closeWindowWithMessage('网络错误，请检查网络连接', 2000);
                return;
            }
        }

        // 标记已完成
        hasProcessed = true;

        if (isDouyinPublishSuccessMessage(clickResult.message)) {
            console.log('[抖音发布] ✅ 捕获到成功提示，直接上报成功统计:', clickResult.message);
            const reported = await reportDouyinPublishSuccess(publishId, windowId, 'click-success-message');
            publishRunning = false;
            if (reported) {
                await closeWindowWithMessage('发布成功，刷新数据', 1000);
                return;
            }
        }

        // 等待页面跳转到成功页，超时 30 秒
        console.log('[抖音发布] ⏳ 等待跳转到成功页（90秒超时）...');
        const currentUrl = window.location.href;
        const startTime = Date.now();
        const timeout = 90000; // 90秒：对齐全平台，网慢兜底（配合点击乐观上报，避免误报超时失败）
        // 🔑 只保留真实平台提示，避免把“点击完成/点击成功”这类中性状态当失败原因上报
        let lastToastMessage = !isDouyinPublishSuccessMessage(clickResult.message)
        && !isDouyinNeutralPublishMessage(clickResult.message)
            ? (clickResult.message || '')
            : '';

        while (Date.now() - startTime < timeout) {
            await delay(2000); // 每 2 秒检查一次

            const phoneVerifyMessage = getDouyinPhoneVerifyMessage();
            if (phoneVerifyMessage) {
                console.log('[抖音发布] 📱 轮询检测到手机号认证弹窗:', phoneVerifyMessage);
                const shouldExit = await reportDouyinPhoneVerifyFailure('polling', phoneVerifyMessage);
                // 🔑 如果返回 true，说明需要退出（旧逻辑兼容）；如果返回 false，继续轮询
                if (shouldExit) {
                    return;
                }
                // 如果返回 false（手机验证已上报），继续轮询监听后续错误
                console.log('[抖音发布] 📱 继续轮询，监听用户手动发布后的错误...');
            }

            // 检查 URL 是否变化
            if (window.location.href !== currentUrl) {
                console.log('[抖音发布] ✅ 检测到页面跳转，发布成功');
                return; // 页面已跳转，由 publish-success.js 处理
            }

            // 检查 PUBLISH_SUCCESS_DATA 是否已被 publish-success.js 删除（检查窗口专属 key 和通用 key）
            const windowKey = windowId ? `PUBLISH_SUCCESS_DATA_${windowId}` : null;
            const hasWindowData = windowKey ? localStorage.getItem(windowKey) : false;
            const hasGenericData = localStorage.getItem('PUBLISH_SUCCESS_DATA');
            if (!hasWindowData && !hasGenericData) {
                console.log('[抖音发布] ✅ 数据已被成功页处理，跳过后续检测');
                return;
            }

            // 检测是否出现 toast 提示，记录消息内容
            // 🔑 过滤掉成功消息，避免将成功消息作为错误信息上报
            try {
                const toastEl = document.querySelector('.semi-toast-content-text');
                if (toastEl) {
                    const text = (toastEl.textContent || '').trim();
                    const isSuccess = isDouyinPublishSuccessMessage(text);
                    if (text && !isSuccess && !isDouyinNeutralPublishMessage(text)) {
                        lastToastMessage = text;
                        console.log('[抖音发布] 📨 检测到提示:', text);
                    } else if (text && isDouyinNeutralPublishMessage(text)) {
                        console.log('[抖音发布] 📨 检测到中性提示，暂不作为失败原因:', text);
                    } else if (isSuccess) {
                        console.log('[抖音发布] ✅ 检测到成功提示，直接上报:', text);
                        const reported = await reportDouyinPublishSuccess(publishId, windowId, 'poll-success-toast');
                        publishRunning = false;
                        if (reported) {
                            await closeWindowWithMessage('发布成功，刷新数据', 1000);
                            return;
                        }
                    }
                }
            } catch (e) {
                // 忽略检测错误
            }
        }

        // 超时未跳转 - 再次检查是否已被 publish-success.js 处理（检查窗口专属 key 和通用 key）
        const finalWindowKey = windowId ? `PUBLISH_SUCCESS_DATA_${windowId}` : null;
        const finalHasWindowData = finalWindowKey ? localStorage.getItem(finalWindowKey) : false;
        const finalHasGenericData = localStorage.getItem('PUBLISH_SUCCESS_DATA');
        if (!finalHasWindowData && !finalHasGenericData) {
            console.log('[抖音发布] ✅ 超时但数据已被成功页处理，跳过错误统计');
            return;
        }

        // 【特性开关】FIX_MULTIPLATFORM_FAILURE_REPORT_P0：抖音超时收口前补查失败探针
        // 原逻辑：lastToastMessage 空即上报成功，但该变量只记轮询中捕获的失败提示
        // 如果 toast 在 3 秒内消失（轮询间隙）或点击后立即出现（capturedErrors 有记录），会被漏捕
        // 修复：超时收口前补查持久化失败探针，参考小红书实现
        let finalFailureMessage = lastToastMessage;
        if (!finalFailureMessage && window.isFeatureEnabled?.("FIX_MULTIPLATFORM_FAILURE_REPORT_P0")) {
            const probed = typeof readPublishErrorProbe === 'function' ? readPublishErrorProbe() : null;
            if (probed) {
                finalFailureMessage = probed;
                console.error('[抖音发布] ❌ 超时兜底命中失败探针:', probed);
            }
        }

        // 🔑 超时无明确失败提示 → 视为发布成功（范式对齐小红书：点击已提交、平台未跳转但也无任何失败提示）
        //    抖音轮询中只把「真实平台失败提示」记入 lastToastMessage（成功/中性提示已被过滤排除），
        //    故 lastToastMessage 为空 = 全程未捕获明确失败 → 判成功，避免把「发成功了只是没跳转」误报为失败。
        if (!finalFailureMessage) {
            console.log('[抖音发布] ✅ 超时未捕获任何失败提示，点击发布已提交，视为发布成功');
            await reportDouyinPublishSuccess(publishId, windowId, 'timeout-no-failure');
            publishRunning = false;
            await closeWindowWithMessage('发布成功，刷新数据', 1000);
            return;
        }

        // 真正的超时失败
        const timeoutFailureMessage = getDouyinTimeoutFailureMessage(finalFailureMessage, clickResult.message);
        console.log('[抖音发布] ❌ 等待超时（90秒），判定发布失败:', {
            timeoutFailureMessage,
            lastToastMessage: finalFailureMessage,
            clickMessage: clickResult.message || '',
            clickMode: clickResult.clickMode || '',
            startUrl: currentUrl,
            currentUrl: window.location.href,
            hasWindowSuccessData: !!finalHasWindowData,
            hasGenericSuccessData: !!finalHasGenericData,
        });
        // 清除数据（窗口专属 key 和通用 key）
        await clearDouyinPublishSuccessData(windowId);
        await sendStatisticsError(publishId, timeoutFailureMessage, '抖音发布', new Error(timeoutFailureMessage));
        publishRunning = false;
        await closeWindowWithMessage('发布失败，刷新数据', 1000);

    } catch (error) {
        console.log("🚀 ~ publishApi ~ error: ", error);
        // 清除提前保存的数据（窗口专属 key 和通用 key）
        await clearDouyinPublishSuccessData(windowId);

        // 🔴 识别按钮 disabled 错误，补充诊断信息
        let errorDetail = error.message || '发布过程出错';
        if (errorDetail.includes('发布按钮') && errorDetail.includes('不可用')) {
            console.log('[抖音发布] 🔍 检测到按钮 disabled 错误，尝试诊断...');
            try {
                const publishBtn = document.querySelector(".button-dhlUZE");

                // 🔴 收集表单诊断信息
                const formDiagnostics = typeof window.collectFormDiagnostics === 'function' ?
                    window.collectFormDiagnostics({
                        platform: 'douyin',
                        selectors: {
                            title: '.editor-kit-root-container .semi-input',
                            content: '.zone-container',
                            video: '[class*="upload-progress-style"]',
                        },
                        required: {
                            title: true,
                            content: false,
                            video: true,
                        }
                    }) : null;

                // 🔴 诊断按钮 disabled 原因
                const buttonDiagnosis = typeof window.diagnoseButtonDisabled === 'function' ?
                    window.diagnoseButtonDisabled(publishBtn, formDiagnostics, []) : null;

                console.log('[抖音发布] 📋 表单诊断结果:', formDiagnostics);
                console.log('[抖音发布] 📋 按钮诊断结果:', buttonDiagnosis);

                // 🔴 使用诊断生成的人类可读原因（如果有）
                if (buttonDiagnosis && buttonDiagnosis.recommendation) {
                    errorDetail = buttonDiagnosis.recommendation;
                }
            } catch (diagError) {
                console.warn('[抖音发布] ⚠️ 诊断异常，使用原始错误:', diagError.message);
            }
        }

        // 发送失败统计
        await sendStatisticsError(publishId, errorDetail, '抖音发布');
        publishRunning = false;
        // 即使出错也尝试关闭窗口
        await closeWindowWithMessage('发布失败，刷新数据', 1000);
    }
}

// 填写表单数据
async function fillFormData(dataObj) {
    // 防止并发执行
    if (fillFormRunning) {
        console.log("🚀 ~ fillFormData ~ fillFormRunning: ", fillFormRunning);
        // alert('fillFormData already running, skip');
        return;
    }

    fillFormRunning = true;

    const publishTaskToken = typeof window.resolvePublishTaskToken === 'function'
        ? window.resolvePublishTaskToken(dataObj, '发布')
        : (typeof window.buildPublishTaskToken === 'function'
            ? window.buildPublishTaskToken(dataObj, '发布')
            : 'task_default');
    if (typeof window.setCurrentPublishTaskToken === 'function') {
        window.setCurrentPublishTaskToken(publishTaskToken);
    } else {
        window.__CURRENT_PUBLISH_TASK_TOKEN__ = publishTaskToken;
    }


    // 🔴 将所有核心填表逻辑包装在一个函数中，便于外层兜底重试
    const executeAllFormSteps = async () => {
        const titleAndIntro = dataObj.video.video.sendlog;
        console.log("🚀 ~ executeAllFormSteps ~ dataObj: ", dataObj);
        // alert(JSON.stringify(titleAndIntro));
        await retryOperation(async () => {
            // 填写标题
            const titleInput = await waitForElement('.editor-kit-root-container .semi-input', 10000); // 🔑 增加到 10 秒

            // 先触发focus事件
            if (typeof titleInput.focus === 'function') {
                titleInput.focus();
            } else {
                titleInput.dispatchEvent(new Event('focus', {bubbles: true}));
            }

            // 延迟执行，让React状态稳定
            await window.delay(300);

            // 使用setNativeValue设置值
            const targetTitle = titleAndIntro.title || '';
            setNativeValue(titleInput, targetTitle);

            // 额外触发input事件
            titleInput.dispatchEvent(new Event('input', {bubbles: true}));

            // 等待 React 更新
            await window.delay(200);

            // 🔑 验证是否成功设置（清除前后空格后比较）
            const currentValue = (titleInput.value || '').trim();
            const expectedValue = targetTitle.trim();
            if (currentValue !== expectedValue) {
                throw new Error(`标题设置失败: 期望"${expectedValue}", 实际"${currentValue}"`);
            }

            console.log('[抖音发布] ✅ 标题设置成功:', currentValue);
        }, 5, 1000)
        // alert(`Filling title: ${titleAndIntro.title || ''}`);
        // 设置发布时间
        const publishTime = dataObj.video.formData.send_set;
        if (+publishTime === 2) {
            await retryOperation(async () => {
                try {
                    // 定时发布
                    const publishSection = await waitForElement('.container-EMGgQp:nth-of-type(3) .content-obt4oA.new-layout-sLYOT6:nth-of-type(4)', 3000);

                    const immediatePublish = publishSection.querySelector('input[type="checkbox"][value="0"]');
                    const scheduledPublish = publishSection.querySelector('input[type="checkbox"][value="1"]');

                    if (immediatePublish && scheduledPublish) {
                        setNativeValue(immediatePublish, false);
                        setNativeValue(scheduledPublish, true);

                        // 设置日期时间
                        await window.delay(500);
                        const dateInput = await waitForElement('.date-picker-ioPchj input', 3000);

                        // 多次设置确保生效
                        for (let i = 0; i < 2; i++) {
                            if (setNativeValue(dateInput, dataObj.video.dyPlatform.send_time)) {
                                break;
                            }
                            await window.delay(300);
                        }
                    }
                } catch (error) {
                    // alert('⚠️ Schedule time setting failed: ' + error.message);
                }
            }, 5, 1000)
        }

        // 填写简介
        try {
            // 首先检查是否已经填写过（通过全局标记）
            if (introFilled) {
                // alert('Intro already filled, introFilled=' + introFilled);
                // 直接跳过，不再查找元素或进行任何操作
            } else {
                await retryOperation(async () => {
                    // alert('Intro not filled yet, starting to fill, introFilled=' + introFilled);
                    const introInput = await waitForElement('.editor-kit-root-container .editor-kit-container.editor', 10000); // 🔑 增加到 10 秒
                    const targetIntro = titleAndIntro.intro || '';

                    // Debug: Show original intro
                    // alert('Original intro length: ' + targetIntro.length + '\nJSON: ' + JSON.stringify(targetIntro));

                    // 超强清理换行符逻辑:使用split/filter彻底清除空行
                    // 1. 将所有HTML标签和换行符统一转为换行符
                    // 2. 分割成行数组
                    // 3. 过滤掉所有空行
                    // 4. 重新组装
                    let cleanedText = targetIntro
                        .replace(/<br\s*\/?>/gi, '\n')              // 将<br>转为换行符
                        .replace(/<\/?(p|div|span)[^>]*>/gi, '\n')  // 将块级元素转为换行符
                        .replace(/<[^>]+>/g, '')                    // 移除所有其他HTML标签
                        .replace(/&nbsp;/g, ' ')                    // 将&nbsp;转为空格
                        .split('\n')                                // 按换行符分割成数组
                        .map(line => line.trim())                   // 每行去除首尾空格
                        .filter(line => line.length > 0)            // 过滤掉空行
                        .join('\n')                                 // 用单个换行符重新连接
                        .trim();

                    // Debug: Show cleaned text
                    // alert('Cleaned text length: ' + cleanedText.length + '\nJSON: ' + JSON.stringify(cleanedText));

                    // 对当前页面内容进行同样的清理,确保比较标准一致
                    const currentRawContent = (introInput.textContent || introInput.innerText || '');
                    const currentContent = currentRawContent
                        .split('\n')
                        .map(line => line.trim())
                        .filter(line => line.length > 0)
                        .join('\n')
                        .trim();

                    let targetContent = cleanedText;

                    // Debug: Show current vs target
                    // alert('Current content: ' + JSON.stringify(currentContent) + '\nTarget: ' + JSON.stringify(targetContent) + '\nEqual: ' + (currentContent === targetContent));

                    // 只有在标记未设置且内容不同时才填写
                    if (currentContent !== targetContent) {
                        // 立即标记为已填写（在任何操作之前，防止并发）
                        introFilled = true;

                        // 清空现有内容，避免累积
                        introInput.innerHTML = '';

                        // 额外清理：移除可能存在的占位符或空节点
                        while (introInput.firstChild) {
                            introInput.removeChild(introInput.firstChild);
                        }

                        // 检测内容是否有#并且其后跟有文字
                        const topicList = extractAfterHash(targetContent, {all: true, includeHash: true});
                        console.log("🚀 ~ fillFormData ~ topicList: ", topicList);
                        if (topicList.length > 0) {
                            //  删除掉所有话题
                            cleanedText = removeHashTags(targetContent);
                        }

                        // 先触发focus事件
                        if (typeof introInput.focus === 'function') {
                            introInput.focus();
                        } else {
                            introInput.dispatchEvent(new Event('focus', {bubbles: true}));
                        }

                        // 延迟执行，让React状态稳定
                        await window.delay(300);

                        // 使用简单的方式填充内容
                        const lines = cleanedText.split('\n').filter(line => line.trim());
                        const fragment = document.createDocumentFragment();

                        lines.forEach((line, index) => {
                            const textNode = document.createTextNode(line);
                            fragment.appendChild(textNode);
                            // 不是最后一行才加<br>
                            if (index < lines.length - 1) {
                                const br = document.createElement('br');
                                fragment.appendChild(br);
                            }
                        });

                        introInput.innerHTML = '';
                        introInput.appendChild(fragment);

                        // 只触发一次input事件
                        introInput.dispatchEvent(new Event('input', {bubbles: true}));

                        // 延迟后检查编辑器是否自动添加了额外内容
                        await window.delay(100);
                        // alert('After input event:\nHTML: ' + JSON.stringify(introInput.innerHTML) + '\nText: ' + JSON.stringify(introInput.textContent));

                        // 清理所有空的 ace-line 元素（编辑器可能在开头自动添加）
                        const aceLines = introInput.querySelectorAll('.ace-line');
                        // alert('Found ace-line elements: ' + aceLines.length);

                        let removedCount = 0;
                        aceLines.forEach((line, idx) => {
                            const text = (line.textContent || '').trim();
                            // 移除所有空白字符和零宽字符（\u200B-\u200D, \uFEFF）
                            const cleanText = text.replace(/[\s\u200B-\u200D\uFEFF]/g, '');
                            // alert('ace-line[' + idx + '] text: "' + text + '" clean: "' + cleanText + '" length: ' + cleanText.length);
                            if (!cleanText || cleanText.length === 0) {
                                line.remove();
                                removedCount++;
                            }
                        });

                        // 单独处理话题（添加防重复标记）
                        // 🔑 使用窗口专属标记，避免多窗口并发时冲突
                        const topicWindowId = await window.browserAPI.getWindowId();
                        const topicFilledKey = `__TOPIC_FILLED_${topicWindowId || 'default'}__`;
                        if (topicList.length > 0 && !window[topicFilledKey]) {
                            window[topicFilledKey] = true; // 标记话题已处理

                            const introInput = await waitForElement('.editor-kit-root-container .editor-kit-container.editor', 10000); // 🔑 增加到 10 秒
                            for (let topicListElement of topicList) {
                                console.log('🏷️ 开始处理话题:', topicListElement);

                                // 聚焦编辑器
                                introInput.focus();

                                // 将光标移到末尾
                                const selection = window.getSelection();
                                const range = document.createRange();
                                range.selectNodeContents(introInput);
                                range.collapse(false); // false = 折叠到末尾
                                selection.removeAllRanges();
                                selection.addRange(range);

                                // 使用 execCommand 模拟真实输入（这会触发编辑器的话题检测）
                                document.execCommand('insertText', false, topicListElement);

                                // 触发 input 事件确保编辑器识别变化
                                introInput.dispatchEvent(new InputEvent('input', {
                                    inputType: 'insertText',
                                    data: topicListElement,
                                    bubbles: true,
                                }));

                                // 等待话题建议列表出现（使用 waitForElement）
                                try {
                                    const mentionSuggest = await waitForElement('.mention-suggest-mount-dom', 3000);
                                    console.log('🏷️ 话题建议列表已出现');

                                    if (mentionSuggest) {
                                        // 轮询等待话题选项出现（因为选项是异步接口返回的）
                                        let firstOption = null;
                                        const maxRetries = 30; // 最多等待3秒（30 * 100ms）
                                        let retryCount = 0;

                                        while (!firstOption && retryCount < maxRetries) {
                                            // 根据截图的实际 DOM 结构，使用精确的选择器
                                            const selectors = [
                                                // 方式1: 直接找第一个 mention-suggest-item-container
                                                '[class*="mention-suggest-item-container"]:first-of-type',
                                                // 方式2: 通过层级关系找
                                                '.mention-suggest-mount-dom > div > [class*="mention-suggest-item-container"]:first-child',
                                                // 方式3: 找任意一个 item-container
                                                '[class*="mention-suggest-item-container"]',
                                                // 方式4: 更深层的结构
                                                '.mention-suggest-mount-dom [class*="mention-suggest-item-container"] > div:first-child'
                                            ];

                                            for (const selector of selectors) {
                                                const options = mentionSuggest.querySelectorAll('[class*="mention-suggest-item-container-"] [class*="tag-"]');
                                                if (options.length > 0) {
                                                    firstOption = options[0];
                                                    console.log('🏷️ 找到话题选项，选择器:', selector, '共', options.length, '个选项');
                                                    console.log('🏷️ 选项文本:', firstOption.textContent?.trim().substring(0, 50));
                                                    break;
                                                }
                                            }

                                            // 如果还没找到，每10次重试打印 DOM 结构
                                            if (!firstOption) {
                                                if (retryCount % 10 === 0) {
                                                    console.log('🏷️ 重试', retryCount, '次，当前DOM:', mentionSuggest.innerHTML.substring(0, 500));
                                                }
                                                await window.delay(100);
                                                retryCount++;
                                            }
                                        }

                                        if (firstOption) {
                                            // 确保元素可见
                                            firstOption.scrollIntoView({block: 'nearest'});
                                            await window.delay(100);

                                            // 尝试多种点击方式
                                            console.log('🏷️ 准备点击话题选项');

                                            // 方式1: 模拟完整的鼠标事件
                                            const rect = firstOption.getBoundingClientRect();
                                            const clickX = rect.left + rect.width / 2;
                                            const clickY = rect.top + rect.height / 2;

                                            firstOption.dispatchEvent(new MouseEvent('mouseenter', {
                                                bubbles: true,
                                                clientX: clickX,
                                                clientY: clickY
                                            }));
                                            await window.delay(50);

                                            firstOption.dispatchEvent(new MouseEvent('mousedown', {
                                                bubbles: true,
                                                clientX: clickX,
                                                clientY: clickY
                                            }));
                                            await window.delay(50);

                                            firstOption.dispatchEvent(new MouseEvent('mouseup', {
                                                bubbles: true,
                                                clientX: clickX,
                                                clientY: clickY
                                            }));
                                            await window.delay(50);

                                            firstOption.dispatchEvent(new MouseEvent('click', {
                                                bubbles: true,
                                                clientX: clickX,
                                                clientY: clickY
                                            }));

                                            // 方式2: 原生点击（作为兜底）
                                            await window.delay(50);
                                            firstOption.click();

                                            console.log('🏷️ 已点击话题选项');
                                            await window.delay(500);
                                        } else {
                                            console.log('🏷️ 未找到话题选项（已重试', retryCount, '次）');
                                            console.log('🏷️ 完整DOM:', mentionSuggest.innerHTML);
                                        }
                                    }
                                } catch (e) {
                                    console.log('🏷️ 话题建议列表未出现:', e.message);
                                }
                            }
                        }

                        // 延迟后触发blur事件
                        await window.delay(200);
                        if (typeof introInput.blur === 'function') {
                            introInput.blur();
                        } else {
                            introInput.dispatchEvent(new Event('blur', {bubbles: true}));
                        }

                        // 最后再检查一次
                        await window.delay(100);
                        // alert('After blur event:\nHTML: ' + JSON.stringify(introInput.innerHTML) + '\nText: ' + JSON.stringify(introInput.textContent));

                        // alert('✅ Intro filled successfully');
                    } else {
                        // 内容已经正确，也标记为已填写
                        introFilled = true;
                        // alert('✅ Intro content already correct, marking as filled');
                    }
                }, 5, 1000)
            }
        } catch (error) {
            // alert('⚠️ Intro handling failed: ' + error.message);
        }

        // 等待表单填写完成
        await window.delay(5000);

        // 直接调用发布（封面检测移到 publishApi 中，在视频上传完成后进行）
        await publishApi(dataObj);
    };
    // ===== 原有逻辑结束 =====

    // 🔴 最外层兜底重试：即使单步骤重试都失败，外层还会重试整个流程2次
    try {
        await retryOperation(executeAllFormSteps, 2, 3000);
        console.log('[抖音发布] ✅ 所有表单填写完成');
    } catch (finalError) {
        console.error('[抖音发布] ❌ 填表流程失败（外层重试2次后）:', finalError);
        stopErrorListener?.();
        const publishId = dataObj?.video?.dyPlatform?.id;
        if (publishId) {
            await sendStatisticsError(publishId, finalError.message || '填写表单失败', '抖音发布');
        }
        await closeWindowWithMessage('填写表单失败，刷新数据', 1000);
    } finally {
        // 无论成功还是失败，都重置标记
        fillFormRunning = false;
    }
}
