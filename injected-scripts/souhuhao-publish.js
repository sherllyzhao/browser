/**
 * 搜狐号创作者平台发布脚本
 * 用于处理发布流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

// 🔑 最优先：在脚本最顶部劫持 localStorage 和 window.location，防止 toPath 导致页面跳转
// 这必须在任何其他代码执行之前进行
(function() {
    'use strict';

    // 🔑 在 IIFE 内部定义平台配置，避免与授权脚本的 PLATFORM_CONFIG 冲突
    const PUBLISH_PAGE_PATH = '/contentManagement/news/addarticle';
    const PUBLISH_SUCCESS_KEY = 'sohu_publish_success_data';

    console.log('[搜狐号发布] 🛡️ 在脚本最顶部劫持 localStorage 和 window.location，阻止页面跳转');
    try {
        const originalSetItem = localStorage.setItem.bind(localStorage);
        const originalGetItem = localStorage.getItem.bind(localStorage);
        const originalRemoveItem = localStorage.removeItem.bind(localStorage);

        // 🔑 首先清除 toPath，然后设置为发布页路径
        console.log('[搜狐号发布] 🧹 清除旧的 toPath');
        originalRemoveItem('toPath');

        // 立即设置为发布页路径
        console.log('[搜狐号发布] ✅ 设置 toPath 为发布页路径');
        originalSetItem('toPath', PUBLISH_PAGE_PATH);
        console.log('[搜狐号发布] ✅ 已设置 localStorage.toPath =', PUBLISH_PAGE_PATH);

        // 🔑 检查发布成功标志的辅助函数（使用 originalGetItem 避免劫持问题）
        function hasPublishSuccessFlag() {
            // 优先检查全局变量（更可靠）
            if (window.__sohuPublishSuccessFlag) {
                console.log('[搜狐号发布] ✅ 检测到全局变量标志');
                return true;
            }
            // 其次检查 localStorage
            try {
                const data = originalGetItem(PUBLISH_SUCCESS_KEY);
                if (data) {
                    console.log('[搜狐号发布] ✅ 检测到 localStorage 标志');
                    return true;
                }
            } catch (e) {
                console.error('[搜狐号发布] ❌ 读取 localStorage 标志失败:', e);
            }
            return false;
        }

        // 🔑 劫持 window.location.href，防止跳转到首页
        // 注意：window.location.href 在现代浏览器中不可配置，尝试劫持可能失败
        if (!window.__sohuLocationHrefHijacked) {
            window.__sohuLocationHrefHijacked = true;
            try {
                let originalLocationHref = window.location.href;
                Object.defineProperty(window.location, 'href', {
                    configurable: true,
                    get: function() {
                        return originalLocationHref;
                    },
                    set: function(value) {
                        console.log('[搜狐号发布] 🚫 检测到页面跳转:', value);
                        // 如果要跳转到首页，检查是否是发布成功后的跳转
                        if (value.includes('firstPage') || value.includes('first/page')) {
                            // 🔑 使用辅助函数检查发布成功标志
                            if (hasPublishSuccessFlag()) {
                                console.log('[搜狐号发布] ✅ 检测到发布成功标志，允许跳转到首页');
                                originalLocationHref = value;
                                window.location.assign(value);
                                return;
                            }
                            console.log('[搜狐号发布] 🚫 阻止跳转到首页（无发布成功标志）');
                            return; // 阻止跳转
                        }
                        // 其他跳转允许
                        originalLocationHref = value;
                        window.location.assign(value); // 使用 assign 代替直接赋值，避免递归
                    }
                });
                console.log('[搜狐号发布] ✅ 成功劫持 window.location.href');
            } catch (e) {
                console.log('[搜狐号发布] ⚠️ 无法劫持 window.location.href（浏览器限制），使用其他方式拦截');
            }
        }

        // 🔑 劫持 history.pushState 和 history.replaceState，防止通过 history API 跳转
        const originalPushState = window.history.pushState.bind(window.history);
        const originalReplaceState = window.history.replaceState.bind(window.history);

        window.history.pushState = function(state, title, url) {
            console.log('[搜狐号发布] 🚫 检测到 history.pushState:', url);
            if (url && (url.includes('firstPage') || url.includes('first/page'))) {
                // 🔑 使用辅助函数检查发布成功标志
                if (hasPublishSuccessFlag()) {
                    console.log('[搜狐号发布] ✅ 检测到发布成功标志，允许 pushState 到首页');
                    return originalPushState(state, title, url);
                }
                console.log('[搜狐号发布] 🚫 阻止通过 history.pushState 跳转到首页');
                return; // 阻止跳转
            }
            return originalPushState(state, title, url);
        };

        window.history.replaceState = function(state, title, url) {
            console.log('[搜狐号发布] 🚫 检测到 history.replaceState:', url);
            if (url && (url.includes('firstPage') || url.includes('first/page'))) {
                // 🔑 使用辅助函数检查发布成功标志
                if (hasPublishSuccessFlag()) {
                    console.log('[搜狐号发布] ✅ 检测到发布成功标志，允许 replaceState 到首页');
                    return originalReplaceState(state, title, url);
                }
                console.log('[搜狐号发布] 🚫 阻止通过 history.replaceState 跳转到首页');
                return; // 阻止跳转
            }
            return originalReplaceState(state, title, url);
        };

        // 劫持 setItem，阻止设置 toPath
        localStorage.setItem = function(key, value) {
            if (key === 'toPath') {
                console.log('[搜狐号发布] 🚫 阻止修改 toPath:', value, '-> 保持为', PUBLISH_PAGE_PATH);
                return; // 直接返回，不执行设置
            }
            return originalSetItem(key, value);
        };

        // 劫持 getItem，toPath 永远返回发布页路径
        localStorage.getItem = function(key) {
            if (key === 'toPath') {
                console.log('[搜狐号发布] 🔄 拦截读取 toPath，返回发布页路径');
                return PUBLISH_PAGE_PATH; // 返回发布页路径
            }
            return originalGetItem(key);
        };

        // 劫持 removeItem，阻止删除 toPath
        localStorage.removeItem = function(key) {
            if (key === 'toPath') {
                console.log('[搜狐号发布] 🚫 阻止删除 toPath');
                return; // 直接返回，不执行删除
            }
            return originalRemoveItem(key);
        };

        // 🔑 定期检查 toPath 是否被修改，如果被修改就重新设置
        // 这样可以防止搜狐号的代码修改 toPath 导致页面跳转
        let checkCount = 0;
        const checkInterval = setInterval(() => {
            checkCount++;
            const currentToPath = originalGetItem('toPath');
            if (currentToPath !== PUBLISH_PAGE_PATH) {
                console.log('[搜狐号发布] ⚠️ 检测到 toPath 被修改，当前值:', currentToPath, '重新设置为', PUBLISH_PAGE_PATH);
                // 打印调用栈，看看是谁修改了 toPath
                console.log('[搜狐号发布] 📍 调用栈:', new Error().stack);
                originalSetItem('toPath', PUBLISH_PAGE_PATH);
            }
            // 只检查 60 次（约 6 秒），之后停止检查
            if (checkCount >= 60) {
                clearInterval(checkInterval);
                console.log('[搜狐号发布] ✅ toPath 检查完成');
            }
        }, 100);

        // 🔑 也劫持 Object.defineProperty，防止通过属性访问器设置 toPath
        const originalDefineProperty = Object.defineProperty;
        Object.defineProperty = function(obj, prop, descriptor) {
            if (obj === localStorage && prop === 'toPath') {
                console.log('[搜狐号发布] 🚫 阻止通过 defineProperty 设置 toPath');
                return obj; // 直接返回，不执行定义
            }
            return originalDefineProperty.call(this, obj, prop, descriptor);
        };

        console.log('[搜狐号发布] ✅ localStorage 和 window.location 劫持完成，toPath 已被控制');
    } catch (e) {
        console.error('[搜狐号发布] ❌ 劫持失败:', e);
    }
})();

(async function () {
    'use strict';

    // 🔑 平台配置（在 IIFE 内部定义，避免与授权脚本冲突）
    const PLATFORM_CONFIG = {
        name: '搜狐号',
        publishPagePath: '/contentManagement/news/addarticle',
        publishPageUrl: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle',
        firstPageUrl: 'https://mp.sohu.com/mpfe/v4/contentManagement/first/page',
        domain: 'mp.sohu.com',
        cookiesDomain: 'mp.sohu.com'
    };

    // ===========================
    // 防止脚本重复注入
    // ===========================
    if (window.__SH_SCRIPT_LOADED__) {
        console.log('[搜狐号发布] ⚠️ 脚本已经加载过，跳过重复注入');
        return;
    }

    // ===========================
    // 页面状态检查 - 防止异常渲染
    // ===========================
    if (typeof window.checkPageStateAndReload === 'function') {
        if (!window.checkPageStateAndReload('搜狐号发布')) {
            return;
        }
    }

    window.__SH_SCRIPT_LOADED__ = true;

    // 显示操作提示横幅
    if (typeof showOperationBanner === 'function') {
        showOperationBanner('正在自动发布中，请勿操作此页面...');
    }

    // 变量声明（放在防重复检查之后）
    let introFilled = false; // 标记 intro 是否已填写
    let fillFormRunning = false; // 标记 fillFormData 是否正在执行

    // 防重复标志：确保数据只处理一次
    let isProcessing = false;
    let hasProcessed = false;

    // 保存收到的父窗口消息（用于备用方案）
    let receivedMessageData = null;

    // 当前窗口 ID（用于构建窗口专属的 localStorage key，避免多窗口冲突）
    let currentWindowId = null;

    // ===========================
    // 🔴 使用公共错误监听器（来自 common.js）
    // ===========================
    let errorListener = null;

    // 初始化错误监听器
    const initErrorListener = () => {
        if (typeof createErrorListener === 'function' && ERROR_LISTENER_CONFIGS?.sohu) {
            errorListener = createErrorListener(ERROR_LISTENER_CONFIGS.sohu);
            console.log('[搜狐号发布] ✅ 使用公共错误监听器配置');
        } else {
            // 回退方案：使用本地配置
            errorListener = createErrorListener({
                logPrefix: '[搜狐号发布]',
                selectors: [
                    { containerClass: 'ne-snackbar-item-description', textSelector: 'span:last-child' },
                    { containerClass: 'el-message--error', textSelector: '.el-message__content', recursiveSelector: '.el-message.el-message--error' }
                ]
            });
            console.log('[搜狐号发布] ⚠️ 使用本地错误监听器配置');
        }
    };

    // 兼容旧代码的函数别名
    const startErrorListener = () => {
        if (!errorListener) initErrorListener();
        errorListener.start();
    };
    const stopErrorListener = () => errorListener?.stop();
    const getLatestError = () => errorListener?.getLatestError() || null;

    // 🔑 注意：getPublishSuccessKey() 使用 IIFE 外部定义的全局函数
    // 返回固定的 'sohu_publish_success_data'，与 souhuhao-redirect.js 保持一致

    console.log('═══════════════════════════════════════');
    console.log('✅ 搜狐号发布脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    // 检查 common.js 是否已加载
    if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
        console.error('[搜狐号发布] ❌ common.js 未加载！脚本可能无法正常工作');
    } else {
        console.log('[搜狐号发布] ✅ common.js 已加载，工具函数可用');
    }

    // ===========================
    // 🔴 重要：先注册消息监听器，再执行任何 await 操作！
    // 否则消息可能在 await 期间到达，但回调还没注册
    // ===========================
    console.log('[搜狐号发布] 注册消息监听器...');

    if (!window.browserAPI) {
        console.error('[搜狐号发布] ❌ browserAPI 不可用！');
    } else {
        console.log('[搜狐号发布] ✅ browserAPI 可用');

        if (!window.browserAPI.onMessageFromHome) {
            console.error('[搜狐号发布] ❌ browserAPI.onMessageFromHome 不可用！');
        } else {
            console.log('[搜狐号发布] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

            window.browserAPI.onMessageFromHome(async (message) => {
                console.log('═══════════════════════════════════════');
                console.log('[搜狐号发布] 🎉 收到来自父窗口的消息!');
                console.log('[搜狐号发布] 消息类型:', typeof message);
                console.log('[搜狐号发布] 消息内容:', message);
                console.log('[搜狐号发布] 消息.type:', message?.type);
                console.log('[搜狐号发布] 消息.windowId:', message?.windowId);
                console.log('═══════════════════════════════════════');

                // 接收完整的发布数据（直接传递，不使用 IndexedDB）
                // 兼容 publish-data 和 auth-data 两种消息类型
                if (message.type === 'publish-data') {
                    // 使用公共方法解析消息数据
                    const messageData = parseMessageData(message.data, '[搜狐号发布]');
                    if (!messageData) return;

                    // 使用公共方法检查 windowId 是否匹配
                    const isMatch = await checkWindowIdMatch(message, '[搜狐号发布]');
                    if (!isMatch) return;

                    // 使用公共方法恢复会话数据
                    const needReload = await restoreSessionAndReload(messageData, '[搜狐号发布]');
                    if (needReload) return; // 已触发刷新，脚本会重新注入

                    // windowId 匹配后才保存消息数据
                    receivedMessageData = messageData;
                    console.log('[搜狐号发布] 💾 已保存收到的消息数据到 receivedMessageData');

                    console.log('[搜狐号发布] ✅ 收到发布数据:', messageData);

                    // 防重复检查
                    if (isProcessing) {
                        console.warn('[搜狐号发布] ⚠️ 正在处理中，忽略重复消息');
                        return;
                    }
                    if (hasProcessed) {
                        console.warn('[搜狐号发布] ⚠️ 已经处理过，忽略重复消息');
                        return;
                    }

                    // 标记为正在处理
                    isProcessing = true;

                    // 更新全局变量
                    if (messageData) {
                        window.__AUTH_DATA__ = {
                            ...window.__AUTH_DATA__,
                            message: messageData,
                            receivedAt: Date.now()
                        };
                        console.log('[搜狐号发布] ✅ 发布数据已更新:', window.__AUTH_DATA__);
                        console.log("🚀 ~  ~ messageData: ", messageData);

                        try {
                            await retryOperation(async () => await fillFormData(messageData), 3, 2000);
                        } catch (e) {
                            console.log('[搜狐号发布] ❌ 填写表单数据失败:', e);
                        }

                        console.log('[搜狐号发布] 📤 准备发送数据到接口...');
                        console.log('[搜狐号发布] ✅ 发布流程已启动，等待 publishApi 完成...');
                    }

                    // 重置处理标志（无论成功或失败）
                    isProcessing = false;
                    console.log('[搜狐号发布] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
                }
            });

            console.log('[搜狐号发布] ✅ 消息监听器注册成功');
        }
    }

    // ===========================
    // 1. 从 URL 获取发布数据（在消息监听器注册之后）
    // ===========================

    const urlParams = new URLSearchParams(window.location.search);
    const companyId = await window.browserAPI.getGlobalData('company_id');
    const transferId = urlParams.get('transfer_id');

    // 获取当前窗口 ID（用于窗口专属的 localStorage key）
    try {
        currentWindowId = await window.browserAPI.getWindowId();
        console.log('[搜狐号发布] 当前窗口 ID:', currentWindowId);
    } catch (e) {
        console.error('[搜狐号发布] ❌ 获取窗口 ID 失败:', e);
    }

    console.log('[搜狐号发布] URL 参数:', {
        companyId,
        transferId,
        windowId: currentWindowId
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

    window.__SH_AUTH__ = {
        // 发送发布成功消息
        notifySuccess: () => {
            sendMessageToParent('发布成功');
        },
    };

    // ===========================
    // 3. 显示调试信息横幅
    // ===========================

    // ===========================
    // 4. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
    // ===========================

    // 页面加载完成后向父窗口发送消息
    console.log('[搜狐号发布] 页面加载完成，发送 页面加载完成 消息');
    sendMessageToParent('页面加载完成');

    console.log('═══════════════════════════════════════');
    console.log('✅ 搜狐号发布脚本初始化完成');
    console.log('📝 全局方法: window.__SH_AUTH__');
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
            console.log('[搜狐号发布] ⏭️ 已在处理中或已完成，跳过全局存储读取');
            return;
        }

        try {
            // 获取当前窗口 ID
            const windowId = await window.browserAPI.getWindowId();
            console.log('[搜狐号发布] 检查全局存储，窗口 ID:', windowId);

            if (!windowId) {
                console.log('[搜狐号发布] ❌ 无法获取窗口 ID');
                return;
            }

            // 检查是否有恢复 cookies 后保存的发布数据
            const publishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
            console.log('[搜狐号发布] 📦 从全局存储读取 publish_data_window_' + windowId + ':', publishData ? '有数据' : '无数据');

            if (publishData && !isProcessing && !hasProcessed) {
                console.log('[搜狐号发布] ✅ 检测到恢复 cookies 后的数据，开始处理...');

                // 🔑 不再立即删除数据，改为在发布完成后删除
                // 这样如果登录跳转后跳回来，数据仍然可用
                // 使用 hasProcessed 标记防止重复处理
                console.log('[搜狐号发布] 📝 保留 publish_data_window_' + windowId + ' 数据，待发布完成后清理');

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

                try {
                    await retryOperation(async () => await fillFormData(publishData), 3, 2000);
                } catch (e) {
                    console.log('[搜狐号发布] ❌ 填写表单数据失败:', e);
                }

                console.log('[搜狐号发布] 📤 准备发送数据到接口...');
                console.log('[搜狐号发布] ✅ 发布流程已启动，等待 publishApi 完成...');

                isProcessing = false;
            }
        } catch (error) {
            console.error('[搜狐号发布] ❌ 从全局存储读取数据失败:', error);
        }
    })();

    // ===========================
    // 7. 从全局存储读取发布数据（备用方案，不依赖消息）
    // ===========================

    // ===========================
    // 8. 检查是否有保存的发布数据（授权跳转恢复）
    // ===========================

    // ===========================
    // 9. 发布视频到搜狐号（移到 IIFE 内部以访问变量）
    // ===========================

    // 填写表单数据
    async function fillFormData(dataObj) {
        console.log("🚀 ~ fillFormData ~ dataObj: ", dataObj);
        // 防止重复执行
        if (fillFormRunning) {
            return;
        }
        fillFormRunning = true;

        try {
            const pathImage = dataObj?.video?.video?.cover;
            if (!pathImage) {
                // alert('No cover image found');
                fillFormRunning = false;
                return;
            }

            /* const userInfoResult = await fetch('https://mp.163.com/wemedia/navinfo.do', {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
            })
            const userInfoRes = await userInfoResult.json(); */
            let userInfo = {};
            /* if(userInfoRes.code === 1){
                userInfo = userInfoRes.data;
            } */

            setTimeout(async () => {
                // 标题（带重试和验证）
                try {
                    await retryOperation(async () => {
                        const titleEle = await waitForElement(".publish-title input", 5000);

                        // 先触发focus事件
                        if (typeof titleEle.focus === 'function') {
                            titleEle.focus();
                        } else {
                            titleEle.dispatchEvent(new Event('focus', {bubbles: true}));
                        }

                        // 延迟执行，让React状态稳定
                        await new Promise(resolve => setTimeout(resolve, 300));

                        const targetTitle = dataObj.video.video.title || '';
                        setNativeValue(titleEle, targetTitle);

                        // 额外触发input事件
                        titleEle.dispatchEvent(new Event('input', {bubbles: true}));

                        // 等待 React 更新
                        await new Promise(resolve => setTimeout(resolve, 200));

                        // 🔑 验证是否成功设置
                        const currentValue = (titleEle.value || '').trim();
                        const expectedValue = targetTitle.trim();
                        if (currentValue !== expectedValue) {
                            throw new Error(`标题设置失败: 期望"${expectedValue}", 实际"${currentValue}"`);
                        }

                        console.log('[搜狐号发布] ✅ 标题设置成功:', currentValue);
                    }, 5, 1000);
                } catch (error) {
                    console.log('[搜狐号发布] ❌ 标题填写失败:', error.message);
                }

                //设置简介（带重试）
                try {
                    await retryOperation(async () => {
                        // 首先检查是否已经填写过（通过全局标记）
                        if (introFilled) {
                            console.log('[搜狐号发布] 简介已填写过，跳过');
                            return; // 跳过重试
                        }

                        console.log('[搜狐号发布] 开始填写简介...');
                        const introEle = await waitForElement(".abstract textarea", 5000);
                        console.log('[搜狐号发布] 简介输入框元素:', introEle);

                        const targetIntro = dataObj.video.video.intro || '';
                        const targetContent = targetIntro.trim();
                        console.log('[搜狐号发布] 目标简介内容:', targetContent);

                        // 检查实际内容
                        const currentContent = (introEle?.value || '').trim();
                        console.log('[搜狐号发布] 当前简介内容:', currentContent);

                        // 只有在标记未设置且内容不同时才填写
                        if (introEle && currentContent !== targetContent) {
                            // 立即标记为已填写（在任何操作之前，防止并发）
                            introFilled = true;
                            console.log('[搜狐号发布] 正在填写简介...');

                            // 先触发focus事件
                            if (typeof introEle.focus === 'function') {
                                introEle.focus();
                            } else {
                                introEle.dispatchEvent(new Event('focus', { bubbles: true }));
                            }

                            // 延迟执行，让React状态稳定
                            await new Promise(resolve => setTimeout(resolve, 300));

                            setNativeValue(introEle, dataObj.video.video.intro);

                            // 额外触发input事件
                            introEle.dispatchEvent(new Event('input', { bubbles: true }));

                            // 等待 React 更新
                            await new Promise(resolve => setTimeout(resolve, 200));

                            // 🔑 验证是否成功设置
                            const updatedValue = (introEle.value || '').trim();
                            if (updatedValue !== targetContent) {
                                throw new Error(`简介设置失败: 期望"${targetContent.substring(0, 50)}...", 实际"${updatedValue.substring(0, 50)}..."`);
                            }

                            console.log('[搜狐号发布] ✅ 简介填写完成');
                        } else if (!introEle) {
                            throw new Error('简介输入框元素为空');
                        } else {
                            // 内容已经正确，也标记为已填写
                            introFilled = true;
                            console.log('[搜狐号发布] 简介内容已正确，无需修改');
                        }
                    }, 5, 1000);
                } catch (error) {
                    console.log('[搜狐号发布] ❌ 简介填写失败:', error.message);
                }

                try {
                    // 内容（带重试）
                    setTimeout(async () => {
                        try {
                            await retryOperation(async () => {
                                const editorIframeEle = await waitForElement("#editor", 10000);
                                const editorEle = editorIframeEle.querySelector('.ql-editor ')
                                let htmlContent = dataObj.video.video.content;

                                // 解析 HTML 中的图片，通过搜狐号 dumpproxy 接口上传
                                const tempDiv = document.createElement('div');
                                tempDiv.innerHTML = htmlContent;

                                // 🔴 清理开头的空白 - 直接删除文字内容之前的所有HTML
                                const tempCleaner = document.createElement('div');
                                tempCleaner.innerHTML = htmlContent;

                                // 递归删除所有开头的空节点，直到找到第一个有非空文本的节点
                                function removeLeadingEmptyNodes(node) {
                                    while (node.firstChild) {
                                        const child = node.firstChild;
                                        if (child.nodeType === 3) { // 文本节点
                                            const trimmedText = child.textContent.trim();
                                            if (trimmedText) {
                                                // 有内容，保留但删除前面的空白
                                                child.textContent = trimmedText + '\u200B'; // 用零宽字符保留格式
                                                return true; // 找到了内容，停止
                                            } else {
                                                node.removeChild(child);
                                            }
                                        } else if (child.nodeType === 1) { // 元素节点
                                            // 先检查这个节点是否有非空文本
                                            if (child.textContent.trim()) {
                                                // 有内容，递归处理这个节点
                                                if (removeLeadingEmptyNodes(child)) {
                                                    return true; // 找到了内容，停止
                                                }
                                                // 如果递归后仍然是空的，删除它
                                                if (!child.textContent.trim()) {
                                                    node.removeChild(child);
                                                } else {
                                                    return true; // 有内容，停止
                                                }
                                            } else {
                                                // 完全空节点，删除
                                                node.removeChild(child);
                                            }
                                        } else {
                                            // 注释、文档等其他节点，直接删除
                                            node.removeChild(child);
                                        }
                                    }
                                    return false;
                                }

                                removeLeadingEmptyNodes(tempCleaner);
                                htmlContent = tempCleaner.innerHTML.replace(/\u200B/g, '').trim();
                                console.log('[搜狐号发布] 🧹 已清理开头所有空白内容');

                                // 清空编辑器
                                editorEle.innerHTML = '';

                                // 让编辑器获得焦点
                                editorEle.focus();

                                // 通过粘贴事件插入内容（让 Draft.js 自己处理）
                                const pasteEvent = new ClipboardEvent('paste', {
                                    clipboardData: new DataTransfer(),
                                    bubbles: true,
                                    cancelable: true
                                });

                                // 设置粘贴的 HTML 和纯文本内容
                                pasteEvent.clipboardData.setData('text/html', htmlContent);
                                pasteEvent.clipboardData.setData('text/plain', tempDiv.textContent);

                                editorEle.dispatchEvent(pasteEvent);

                                // 等待编辑器处理粘贴事件
                                await new Promise(resolve => setTimeout(resolve, 800));

                                console.log('[搜狐号发布] ✅ 内容填写完成');
                            }, 3, 1000);
                        } catch (e) {
                            console.log('[搜狐号发布] ❌ 内容填写失败:', e.message);
                        }
                    }, 200);
                } catch (e) {
                    console.log('[搜狐号发布] ❌ 内容填写失败:', e.message)
                }

                // 设置
                const hasSettingsWrapEle = await waitForElement(".cover-button");
                if (hasSettingsWrapEle) {
                    // 🔴 启动全局错误监听器（已在 IIFE 顶层定义）
                    startErrorListener();

                    // 设置封面（使用主进程下载绕过跨域）
                    await (async () => {
                        try {
                            const {blob, contentType} = await downloadFile(pathImage, 'image/png');
                            var file = new File([blob], dataObj?.video?.formData?.title + ".png", {type: contentType || "image/png"});

                            setTimeout(async () => {
                                // 选中本地上传（点击"选择封面"按钮）
                                setTimeout(async () => {
                                    // 等待封面选择区域出现
                                    await waitForElement(".cover-button");
                                    await delay(500); // 等待渲染完成

                                    // 查找并点击"选择封面"按钮
                                    const coverBtn = document.querySelector(".cover-button .upload-file");
                                    console.log("🚀 ~  ~ coverBtn: ", coverBtn);
                                    if (coverBtn) {
                                        //检查是否已经有图片
                                        const coverWrapperEle = document.querySelector(".pic-cover");
                                        if(coverWrapperEle){
                                            const coverBg = coverWrapperEle.getAttribute('style');
                                            if(coverBg){
                                                // 检查是否有图片
                                                if(coverBg.includes('url')){
                                                    console.log('[搜狐号发布] ✅ 已经有图片');
                                                    const closeBtn = coverWrapperEle.querySelector('.mp-icon-close');
                                                    closeBtn && closeBtn.click();
                                                }else{
                                                    console.log('[搜狐号发布] ❌ 没有图片');
                                                }
                                            }
                                        }
                                        coverBtn.click();
                                    }
                                    await delay(1000); // 等待渲染完成

                                    // 封面上传弹窗弹出后选中还有本地上传的tab
                                    const uploadTabs = document.querySelectorAll('.select-dialog .dialog-title h3');
                                    console.log("🚀 ~  ~ uploadTabs: ", uploadTabs);
                                    let uploadFromLocalTab = null;
                                    if (uploadTabs.length) {
                                        for (const tab of uploadTabs) {
                                            if (tab.textContent.trim().includes('本地')) {
                                                uploadFromLocalTab = tab;
                                            }
                                        }
                                    }
                                    await delay(1000); // 等待渲染完成
                                    console.log("🚀 ~  ~ uploadFromLocalTab: ", uploadFromLocalTab);
                                    if (uploadFromLocalTab) {
                                        uploadFromLocalTab.click();
                                    } else {
                                        console.log('找不到本地上传tab');
                                    }

                                    setTimeout(async () => {
                                        // 使用原生选择器获取元素
                                        const hasInputEle = await waitForElement("#new-file");
                                        if (hasInputEle) {
                                            const input = document.querySelector("#new-file");
                                            const dataTransfer = new DataTransfer();
                                            // 创建 DataTransfer 对象模拟文件上传
                                            dataTransfer.items.add(file);
                                            input.files = dataTransfer.files;
                                            const event = new Event("change", {bubbles: true});
                                            input.dispatchEvent(event);

                                            // 封装上传检测与重试逻辑
                                            const tryUploadImage = async (retryCount = 0) => {
                                                const maxRetries = 3;

                                                // 🔴 自定义等待逻辑：同时检查图片元素和错误信息
                                                const waitForImageOrError = async (timeout = 10000) => {
                                                    const startTime = Date.now();
                                                    const checkInterval = 300; // 每300ms检查一次

                                                    while (Date.now() - startTime < timeout) {
                                                        // 1. 先检查是否有错误信息（优先级更高）
                                                        const errorMsg = getLatestError();
                                                        if (errorMsg) {
                                                            return { type: 'error', message: errorMsg };
                                                        }

                                                        // 2. 再检查图片元素是否出现
                                                        const imageEle = document.querySelector(".img-wrapper");
                                                        console.log("🚀 ~ waitForImageOrError ~ imageEle: ", imageEle);
                                                        if (imageEle) {
                                                            const imgEle = imageEle.querySelector('img');
                                                            if(imgEle && imgEle.getAttribute('src')){
                                                                // 🔑 检测到图片元素后，再等待 500ms 确认是否有错误
                                                                // 因为 MutationObserver 是异步的，错误信息可能还在路上
                                                                console.log('[搜狐号发布] 🔍 检测到图片元素，等待 500ms 确认是否有错误...');
                                                                await delay(500);
                                                                // 检查是否有符合条件的图片
                                                                const successCountEle = document.querySelector('.success-number');
                                                                if(successCountEle){
                                                                    const successCount = parseInt(successCountEle.textContent.trim());
                                                                    if(successCount){
                                                                        return { type: 'success', element: imageEle };
                                                                    }else{
                                                                        // 检查图片上的错误信息
                                                                        const errorMsgEle = imageEle.querySelector('.error-bar');
                                                                        if (errorMsgEle){
                                                                            const errorMsg = errorMsgEle.textContent.trim();
                                                                            if(errorMsg){
                                                                                return { type: 'error', message: errorMsgEle.textContent.trim() };
                                                                            }else{
                                                                                return { type: 'error', message: '上传失败或图片不符合要求' };
                                                                            }
                                                                        }
                                                                    }
                                                                }
                                                                const confirmError = getLatestError();
                                                                if (confirmError) {
                                                                    console.log('[搜狐号发布] ⚠️ 确认期间检测到错误:', confirmError);
                                                                    return { type: 'error', message: confirmError };
                                                                }
                                                                return { type: 'success', element: imageEle };
                                                            }

                                                            // 等待下一次检查
                                                            await delay(checkInterval);
                                                        }

                                                        // 等待下一次检查
                                                        await delay(checkInterval);
                                                    }

                                                    // 超时，再检查一次错误信息
                                                    const finalError = getLatestError();
                                                    if (finalError) {
                                                        return { type: 'error', message: finalError };
                                                    }

                                                    return { type: 'timeout' };
                                                };

                                                const result = await waitForImageOrError(10000);
                                                const myWindowId = await window.browserAPI.getWindowId();

                                                // 🔴 检测到错误信息，直接上报失败
                                                if (result.type === 'error') {
                                                    console.log(`[搜狐号发布] [窗口${myWindowId}] ❌ 检测到错误信息，直接上报失败: ${result.message}`);
                                                    stopErrorListener();
                                                    const publishId = dataObj.video?.dyPlatform?.id;
                                                    if (publishId) {
                                                        await sendStatisticsError(publishId, result.message, '搜狐号发布');
                                                    }
                                                    await closeWindowWithMessage('发布失败，刷新数据', 1000);
                                                    return; // 不再继续
                                                }

                                                if (result.type === 'success') {
                                                    console.log('[搜狐号发布] ✅ 图片上传成功');

                                                    await delay(2000); // 等待渲染完成
                                                    const uploadBoards = document.querySelectorAll(`.select-dialog .board`);
                                                    let visibleBoard = null;
                                                    for (let board of uploadBoards) {
                                                        // 检查行内样式是否有 display: none
                                                        if (board.style.display !== 'none') {
                                                            visibleBoard = board;
                                                            break;
                                                        }
                                                    }
                                                    console.log("🚀 ~ visibleBoard: ", visibleBoard);
                                                    const submitCoverBtns = visibleBoard ? visibleBoard.querySelectorAll('.bottom-buttons p.button') : [];
                                                    console.log("🚀 ~ tryUploadImage ~ submitCoverBtns: ", submitCoverBtns);
                                                    let submitCoverBtn = null;
                                                    // 点击确定按钮
                                                    if (submitCoverBtns.length) {
                                                        for (const btn of submitCoverBtns) {
                                                            if (btn.textContent.trim().includes('确定')) {
                                                                submitCoverBtn = btn;
                                                            }
                                                        }
                                                        console.log("🚀 ~ tryUploadImage ~ submitCoverBtn: ", submitCoverBtn);
                                                        // 使用模拟真实鼠标事件，确保点击生效
                                                        const clickEvent = new MouseEvent('click', {
                                                            view: window,
                                                            bubbles: true,
                                                            cancelable: true
                                                        });
                                                        submitCoverBtn.dispatchEvent(clickEvent);
                                                        console.log('[搜狐号发布] ✅ 已点击确定（模拟鼠标事件）');
                                                        // 等待编辑器关闭和图片保存
                                                        await delay(2000);
                                                    } else {
                                                        console.error('[搜狐号发布] ❌ 找不到提交图片按钮，上报失败');
                                                        stopErrorListener();
                                                        const publishId = dataObj.video?.dyPlatform?.id;
                                                        if (publishId) {
                                                            await sendStatisticsError(publishId, '找不到提交图片按钮', '搜狐号发布');
                                                        }
                                                        await closeWindowWithMessage('发布失败，刷新数据', 1000);
                                                        return;
                                                    }
                                                    await delay(2000);
                                                    const publishTime = dataObj.video.formData.send_set;
                                                    console.log("🚀 ~ tryUploadImage ~ publishTime: ", publishTime);
                                                    //return
                                                    if (+publishTime === 2) {
                                                        let scheduledReleasesBtn = document.querySelector('.publish-report-btn.timeout-pub');

                                                        if (scheduledReleasesBtn) {
                                                            console.log("🚀 ~ tryUploadImage ~ scheduledReleasesBtn: ", scheduledReleasesBtn);
                                                            if (scheduledReleasesBtn) {
                                                                const clickEvent = new MouseEvent('click', {
                                                                    view: window,
                                                                    bubbles: true,
                                                                    cancelable: true
                                                                });
                                                                scheduledReleasesBtn.dispatchEvent(clickEvent);
                                                                console.log('[搜狐号发布] ✅ 已点击定时发布（模拟鼠标事件）');
                                                                await delay(2000);
                                                                //  检测有没有定时发布弹窗
                                                                const scheduledReleasesModal = document.querySelector('.pushtimeout-dialog');
                                                                if (scheduledReleasesModal) {
                                                                    console.log('[搜狐号发布] ✅ 检测到定时发布弹窗');

                                                                    // 解析定时发布时间
                                                                    const sendTime = dataObj.video?.formData?.send_time;
                                                                    if (sendTime) {
                                                                        console.log('[搜狐号发布] ⏰ 开始选择定时发布时间:', sendTime);

                                                                        const timeConfig = parseSendTime(sendTime);
                                                                        if (!timeConfig) {
                                                                            console.error('[搜狐号发布] ❌ 解析定时时间失败');
                                                                            stopErrorListener();
                                                                            await closeWindowWithMessage('定时时间解析失败', 1000);
                                                                            return;
                                                                        }

                                                                        // 调用选择时间函数
                                                                        const timeSelectSuccess = await selectScheduledTime(
                                                                            timeConfig.dateIndex,
                                                                            timeConfig.hour,
                                                                            timeConfig.minute
                                                                        );

                                                                        if (!timeSelectSuccess) {
                                                                            console.error('[搜狐号发布] ❌ 时间选择失败');
                                                                            stopErrorListener();
                                                                            await closeWindowWithMessage('定时时间选择失败', 1000);
                                                                            return;
                                                                        }

                                                                        // 点击确定发布按钮
                                                                        await delay(500);
                                                                        const confirmBtn = document.querySelector('.pushtimeout-btn .sure-btn');

                                                                        if (confirmBtn) {
                                                                            console.log('[搜狐号发布] ✅ 点击确定定时发布');

                                                                            // 🔑 在点击定时发布前保存 publishId，让首页可以调用统计接口
                                                                            const publishId = dataObj.video?.dyPlatform?.id;
                                                                            if (publishId) {
                                                                                try {
                                                                                    // 同时设置全局变量和 localStorage，确保标志能被检测到
                                                                                    window.__sohuPublishSuccessFlag = true;
                                                                                    localStorage.setItem(getPublishSuccessKey(), JSON.stringify({ publishId: publishId }));
                                                                                    console.log('[搜狐号发布] 💾 已保存 publishId（全局变量 + localStorage）:', publishId);

                                                                                    // 🔑 同时保存到 globalData（更可靠，不受域名隔离限制）
                                                                                    if (window.browserAPI && window.browserAPI.setGlobalData) {
                                                                                        await window.browserAPI.setGlobalData(`PUBLISH_SUCCESS_DATA_${currentWindowId}`, {publishId: publishId});
                                                                                        console.log('[搜狐号发布] 💾 已保存 publishId 到 globalData');
                                                                                    }
                                                                                } catch (e) {
                                                                                    console.error('[搜狐号发布] ❌ 保存 publishId 失败:', e);
                                                                                }
                                                                            } else {
                                                                                // 即使没有 publishId，也要设置全局变量允许跳转
                                                                                window.__sohuPublishSuccessFlag = true;
                                                                                console.log('[搜狐号发布] ℹ️ 没有 publishId，但已设置跳转标志');
                                                                            }

                                                                            confirmBtn.click();

                                                                            // 定时发布点击后会立即跳转到成功页
                                                                            console.log('[搜狐号发布] ✅ 等待页面跳转到首页');
                                                                            stopErrorListener();
                                                                        } else {
                                                                            console.error('[搜狐号发布] ❌ 未找到确定按钮');
                                                                        }
                                                                    } else {
                                                                        console.warn('[搜狐号发布] ⚠️ 未传入定时发布时间');
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }else{
                                                        let publishBtn = await waitForElement('.publish-report-btn.active');
                                                        //  点击发布按钮
                                                        if(publishBtn){
                                                            // 🔑 检查发布按钮是否 disabled
                                                            if (publishBtn.disabled || publishBtn.classList.contains('cheetah-btn-disabled') || publishBtn.getAttribute('disabled') !== null) {
                                                                console.error('[搜狐号发布] ❌ 发布按钮不可用(disabled)');
                                                                stopErrorListener();
                                                                const publishIdForError = dataObj.video?.dyPlatform?.id;
                                                                if (publishIdForError) {
                                                                    await sendStatisticsError(publishIdForError, '发布按钮不可用，可能不符合发布要求，或者发文次数已用尽', '搜狐号发布');
                                                                }
                                                                await closeWindowWithMessage('发布失败，刷新数据', 1000);
                                                                return;
                                                            }
                                                            // 🔑 在点击发布前保存 publishId，让首页可以调用统计接口
                                                            const publishId = dataObj.video?.dyPlatform?.id;
                                                            if (publishId) {
                                                                try {
                                                                    // 同时设置全局变量和 localStorage，确保标志能被检测到
                                                                    window.__sohuPublishSuccessFlag = true;
                                                                    localStorage.setItem(getPublishSuccessKey(), JSON.stringify({ publishId: publishId }));
                                                                    console.log('[搜狐号发布] 💾 已保存 publishId（全局变量 + localStorage）:', publishId);

                                                                    // 🔑 同时保存到 globalData（更可靠，不受域名隔离限制）
                                                                    if (window.browserAPI && window.browserAPI.setGlobalData) {
                                                                        await window.browserAPI.setGlobalData(`PUBLISH_SUCCESS_DATA_${currentWindowId}`, {publishId: publishId});
                                                                        console.log('[搜狐号发布] 💾 已保存 publishId 到 globalData');
                                                                    }
                                                                } catch (e) {
                                                                    console.error('[搜狐号发布] ❌ 保存 publishId 失败:', e);
                                                                }
                                                            } else {
                                                                // 即使没有 publishId，也要设置全局变量允许跳转
                                                                window.__sohuPublishSuccessFlag = true;
                                                                console.log('[搜狐号发布] ℹ️ 没有 publishId，但已设置跳转标志');
                                                            }

                                                            const clickEvent = new MouseEvent('click', {
                                                                view: window,
                                                                bubbles: true,
                                                                cancelable: true
                                                            });
                                                            publishBtn.dispatchEvent(clickEvent);
                                                            await checkPublishResult(dataObj, true);
                                                            console.log('[搜狐号发布] ✅ 已点击发布（模拟鼠标事件）');
                                                        }else{
                                                            console.error('[搜狐号发布] ❌ 找不到发布按钮，上报失败');
                                                            stopErrorListener();
                                                            const publishId = dataObj.video?.dyPlatform?.id;
                                                            if (publishId) {
                                                                await sendStatisticsError(publishId, '发布按钮不可用', '搜狐号发布');
                                                            }
                                                            await closeWindowWithMessage('发布失败，刷新数据', 1000);
                                                            return;
                                                        }
                                                    }

                                                } else {
                                                    // 图片上传失败（timeout），检查是否有错误信息
                                                    const myWindowId = await window.browserAPI.getWindowId();
                                                    console.log(`[搜狐号发布] [窗口${myWindowId}] ❌ 图片上传失败，重试次数: ${retryCount}/${maxRetries}`);

                                                    // 优先使用全局错误监听器捕获的错误
                                                    const errorMessage = getLatestError();
                                                    console.log(`[搜狐号发布] [窗口${myWindowId}] 📨 最新错误信息:`, errorMessage);

                                                    // 🔴 有错误信息就直接走失败接口，不再重试
                                                    if (errorMessage) {
                                                        console.log(`[搜狐号发布] [窗口${myWindowId}] ❌ 检测到错误信息，直接上报失败，不再重试`);
                                                        stopErrorListener(); // 停止监听
                                                        const publishId = dataObj.video?.dyPlatform?.id;
                                                        console.log(`[搜狐号发布] [窗口${myWindowId}] 📋 publishId:`, publishId);
                                                        console.log(`[搜狐号发布] [窗口${myWindowId}] 📋 dataObj:`, dataObj);
                                                        if (publishId) {
                                                            console.log(`[搜狐号发布] [窗口${myWindowId}] 📤 调用 sendStatisticsError...`);
                                                            await sendStatisticsError(publishId, errorMessage, '搜狐号发布');
                                                            console.log(`[搜狐号发布] [窗口${myWindowId}] ✅ sendStatisticsError 完成`);
                                                        } else {
                                                            console.error(`[搜狐号发布] [窗口${myWindowId}] ❌ publishId 为空，无法调用失败接口！`);
                                                        }
                                                        await closeWindowWithMessage('发布失败，刷新数据', 1000);
                                                        return; // 不再继续
                                                    }

                                                    // 没有错误信息才重试
                                                    if (retryCount < maxRetries) {
                                                        console.log(`[搜狐号发布] 🔄 ${2}秒后重新上传图片...`);
                                                        await delay(2000);

                                                        // 重新触发文件上传
                                                        const input = document.querySelector(".cheetah-upload input");
                                                        if (input) {
                                                            input.files = dataTransfer.files;
                                                            const event = new Event("change", {bubbles: true});
                                                            input.dispatchEvent(event);
                                                            console.log('[搜狐号发布] 🔄 已重新触发上传');

                                                            // 递归重试
                                                            await delay(2000);
                                                            await tryUploadImage(retryCount + 1);
                                                        } else {
                                                            console.error('[搜狐号发布] ❌ 无法找到上传输入框，无法重试');
                                                            stopErrorListener();
                                                            const publishId = dataObj.video?.dyPlatform?.id;
                                                            if (publishId) {
                                                                await sendStatisticsError(publishId, '图片上传失败，无法找到上传输入框', '搜狐号发布');
                                                            }
                                                            await closeWindowWithMessage('图片上传失败，刷新数据', 1000);
                                                        }
                                                    } else {
                                                        // 超过最大重试次数
                                                        console.error('[搜狐号发布] ❌ 图片上传重试次数已用尽');
                                                        stopErrorListener();
                                                        const publishId = dataObj.video?.dyPlatform?.id;
                                                        if (publishId) {
                                                            await sendStatisticsError(publishId, '图片上传失败，重试次数已用尽', '搜狐号发布');
                                                        }
                                                        await closeWindowWithMessage('图片上传失败，刷新数据', 1000);
                                                    }
                                                }
                                            };

                                            // 启动上传检测（延迟2秒等待上传开始）
                                            setTimeout(async () => {
                                                await tryUploadImage(0);
                                            }, 2000);
                                        }
                                    }, 1000);
                                }, 2000);
                            }, 1000);
                        } catch (error) {
                            console.log('[搜狐号发布] ❌ 封面下载失败:', error);
                            stopErrorListener();
                            const publishId = dataObj?.video?.dyPlatform?.id;
                            if (publishId) {
                                await sendStatisticsError(publishId, error.message || '封面下载失败', '搜狐号发布');
                            }
                            await closeWindowWithMessage('封面下载失败，刷新数据', 1000);
                        }
                    })();
                }

                fillFormRunning = false;
                // alert('Automation process completed');
            }, 10000);

        } catch (error) {
            // 捕获填写表单过程中的任何错误（仅捕获 setTimeout 调度前的同步错误）
            console.error('[搜狐号发布] fillFormData 错误:', error);
            // 发送错误上报
            const publishId = dataObj?.video?.dyPlatform?.id;
            if (publishId) {
                await sendStatisticsError(publishId, error.message || '填写表单失败', '搜狐号发布');
            }
            // 同步错误时重置标记
            fillFormRunning = false;
            // 填写表单失败也要关闭窗口，不阻塞下一个任务
            await closeWindowWithMessage('填写表单失败，刷新数据', 1000);
        }
        // 注意：不在 finally 中重置 fillFormRunning
        // 因为 setTimeout 是异步的，finally 会立即执行
        // fillFormRunning 的重置在 setTimeout 回调内部完成（line 974）
    }

    /**
     * 检查发布结果（通用方法）
     * @param {object} dataObj - 发布数据对象
     * @param {boolean} handleExtraButtons - 是否处理额外的确认按钮（立即发布需要，定时发布不需要）
     * @returns {Promise<boolean>} 是否成功（无错误）
     */
    async function checkPublishResult(dataObj, handleExtraButtons = true) {
        console.log('[搜狐号发布] ⏳ 等待检测发布结果...');
        await delay(1000);

        if (handleExtraButtons) {
            try {
                const transferDialogEle = await waitForElement('.alert-dialog', 10000, 1000);
                if(transferDialogEle){
                    const dialogContent = transferDialogEle.querySelector('.alert-desc');
                    if(dialogContent){
                        const dialogText = dialogContent.textContent.trim();
                        if(dialogText.includes('建议以动态形式发布')){
                            transferDialogEle.querySelector('.sure-btn').click();
                        }
                    }
                }
            } catch (e) {
                console.log(e);
            }
        }

        await delay(5000);

        const publishErrorMsg = getLatestError();
        if (publishErrorMsg) {
            console.log('[搜狐号发布] ❌ 检测到发布错误:', publishErrorMsg);
            stopErrorListener();
            const publishId = dataObj.video?.dyPlatform?.id;
            if (publishId) {
                console.log('[搜狐号发布] 📤 调用失败接口...');
                await sendStatisticsError(publishId, publishErrorMsg, '搜狐号发布');
            }
            await closeWindowWithMessage('发布失败，刷新数据', 1000);
            return false;
        } else {
            console.log('[搜狐号发布] ✅ 未检测到错误，等待页面跳转（由 publish-success.js 处理）');
            stopErrorListener();
            return true;
        }
    }
})(); // IIFE 结束

/**
 * 获取发布成功标志的 localStorage key
 * 用于发布页和首页之间的通信：发布页设置标志，首页检测到后上报成功
 */
function getPublishSuccessKey() {
    return 'sohu_publish_success_data';
}

function getImageType(src){
    const imageType = src.split(';')[0].split('/')[1];
    return imageType;
}

/**
 * 解析定时发布时间
 * @param {string} sendTimeStr - 时间字符串，格式："2026-01-21 00:00:00"
 * @returns {object} { dateIndex, hour, minute } 或 null
 */
function parseSendTime(sendTimeStr) {
    try {
        // 解析时间字符串
        const [dateStr, timeStr] = sendTimeStr.split(' ');
        const [year, month, day] = dateStr.split('-').map(Number);
        const [hour, minute] = timeStr.split(':').map(Number);

        // 计算相对于今天的天数差
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const sendDate = new Date(year, month - 1, day);
        sendDate.setHours(0, 0, 0, 0);

        const dayDiff = Math.floor((sendDate - today) / (1000 * 60 * 60 * 24));

        console.log('[搜狐号发布] 📅 解析定时时间:', {
            原始时间: sendTimeStr,
            日期: `${year}-${month}-${day}`,
            时间: `${hour}:${minute}`,
            相对天数: dayDiff
        });

        return {
            dateIndex: dayDiff,
            hour: hour,
            minute: minute
        };
    } catch (error) {
        console.error('[搜狐号发布] ❌ 解析定时时间失败:', error);
        return null;
    }
}

/**
 * 选择虚拟列表中的选项
 * @param {HTMLElement} selectElement - select 组件的容器
 * @param {string|number} targetValue - 要选择的值（显示文本）
 * @param {number} timeout - 超时时间（毫秒）
 */
async function selectFromVirtualList(selectElement, targetValue, timeout = 10000) {
    try {
        console.log('[搜狐号发布] 🔍 准备选择:', targetValue);

        // 1. 找到触发器并点击打开下拉
        const selectTrigger = selectElement.querySelector('i');
        if (!selectTrigger) {
            console.error('[搜狐号发布] ❌ 找不到 select 触发器');
            return false;
        }

        console.log('[搜狐号发布] ✅ 找到触发器，点击打开下拉列表');
        selectTrigger.click();

        // 等待下拉出现
        await new Promise(r => setTimeout(r, 500));

        // 2. 查找虚拟列表容器（可能有多个位置）
        const startTime = Date.now();
        let virtualList = null;
        let options = [];

        while (Date.now() - startTime < timeout) {
            // 尝试多种选择器找虚拟列表
            virtualList = selectElement.querySelector('ul');

            if (virtualList) {
                // 查找所有可见的选项
                options = Array.from(virtualList.querySelectorAll('li'))
                    .filter(el => el.offsetParent !== null); // 过滤隐藏的元素

                if (options.length > 0) {
                    console.log('[搜狐号发布] ✅ 找到虚拟列表，有', options.length, '个选项');
                    break;
                }
            }

            await new Promise(r => setTimeout(r, 100));
        }

        if (options.length === 0) {
            console.error('[搜狐号发布] ❌ 未找到任何选项');
            return false;
        }

        // 3. 在所有选项中查找匹配的
        const targetStr = String(targetValue).trim();
        let foundOption = null;

        for (const option of options) {
            const optionText = option.textContent.trim();
            console.log('[搜狐号发布] 🔎 检查选项:', optionText);

            if (optionText === targetStr) {
                foundOption = option;
                console.log('[搜狐号发布] ✅ 找到匹配的选项:', optionText);
                break;
            }
        }

        if (!foundOption) {
            console.error('[搜狐号发布] ❌ 未找到目标选项:', targetStr);
            console.log('[搜狐号发布] 📋 所有选项:', options.map(o => o.textContent.trim()).join(', '));
            return false;
        }

        // 4. 滚动到视图并点击
        foundOption.scrollIntoView({ behavior: 'auto', block: 'nearest' });
        await new Promise(r => setTimeout(r, 200));

        console.log('[搜狐号发布] 🖱️ 点击选项:', foundOption.textContent.trim());
        foundOption.click();

        // 等待下拉关闭
        await new Promise(r => setTimeout(r, 300));

        console.log('[搜狐号发布] ✅ 选项选择完成');
        return true;

    } catch (error) {
        console.error('[搜狐号发布] ❌ selectFromVirtualList 错误:', error);
        return false;
    }
}

/**
 * 选择定时发布的日期和时间
 * @param {number} dateIndex - 日期索引（0=今天, 1=明天等）
 * @param {number} hour - 小时（0-23）
 * @param {number} minute - 分钟（0-59）
 */
async function selectScheduledTime(dateIndex, hour, minute) {
    try {
        // 1. 找到定时发布弹窗的三个 select 组件
        const modal = document.querySelector('.pushtimeout-dialog');
        if (!modal) {
            console.error('[搜狐号发布] ❌ 找不到定时发布弹窗');
            return false;
        }

        const selectElements = modal.querySelectorAll('.select');
        if (selectElements.length < 3) {
            console.error('[搜狐号发布] ❌ 找不到三个 select 组件，找到:', selectElements.length);
            return false;
        }

        const dateSelect = selectElements[0]; // 日期
        const hourSelect = selectElements[1]; // 小时
        const minuteSelect = selectElements[2]; // 分钟

        console.log('[搜狐号发布] 🔧 开始选择定时发布时间...');

        // 2. 获取日期选项的显示文本
        let dateText = '';
        const date = new Date();
        date.setDate(date.getDate() + dateIndex);

        // 格式：M月D日 或 MM月DD日
        const month = date.getMonth() + 1; // getMonth() 返回 0-11
        const day = date.getDate();
        dateText = `${month}月${day}日`;

        // 3. 依次选择日期、小时、分钟
        console.log('[搜狐号发布] 📅 选择日期:', dateText);
        if (!await selectFromVirtualList(dateSelect, dateText)) {
            return false;
        }

        await new Promise(r => setTimeout(r, 300));

        const hourText = `${hour}`;
        console.log('[搜狐号发布] 🕐 选择小时:', hourText);
        if (!await selectFromVirtualList(hourSelect, hourText)) {
            return false;
        }

        await new Promise(r => setTimeout(r, 300));

        const minuteText = `${minute}`;
        console.log('[搜狐号发布] ⏱️ 选择分钟:', minuteText);
        if (!await selectFromVirtualList(minuteSelect, minuteText)) {
            return false;
        }

        console.log('[搜狐号发布] ✅ 定时发布时间选择完成');
        return true;

    } catch (error) {
        console.error('[搜狐号发布] ❌ selectScheduledTime 错误:', error);
        return false;
    }
}
