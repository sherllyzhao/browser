/**
 * 网易号创作者平台发布脚本
 * 用于处理发布流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
    'use strict';

    // ===========================
    // 防止脚本重复注入
    // ===========================
    if (window.__WYH_SCRIPT_LOADED__) {
        console.log('[网易号发布] ⚠️ 脚本已经加载过，跳过重复注入');
        return;
    }

    // ===========================
    // 页面状态检查 - 防止异常渲染
    // ===========================
    if (typeof window.checkPageStateAndReload === 'function') {
        if (!window.checkPageStateAndReload('网易号发布')) {
            return;
        }
    }

    window.__WYH_SCRIPT_LOADED__ = true;

    // ===========================
    // 🔑 网易号白屏检测和自动恢复（使用公共函数）
    // ===========================
    if (typeof window.checkBlankPageAndReload === 'function') {
        window.checkBlankPageAndReload('网易号发布', [
            '.editor-container',
            '.publish-btn',
            '.title-input'
        ], 3000, 3);
    }

    // 显示操作提示横幅
    if (typeof showOperationBanner === 'function') {
        showOperationBanner('正在自动发布中，请勿操作此页面...');
    }

    // ===========================
    // 🔑 等待 React 初始化完成
    // 延迟执行脚本，避免在 React 渲染过程中干扰 DOM
    // ===========================
    console.log('[网易号发布] ⏳ 等待页面渲染完成...');
    await new Promise(resolve => setTimeout(resolve, 1500));
    console.log('[网易号发布] ✅ 延迟完成，开始执行脚本');

    // 变量声明（放在防重复检查之后）
    let introFilled = false; // 标记 intro 是否已填写
    let fillFormRunning = false; // 标记 fillFormData 是否正在执行
    let publishRunning = false; // 标记发布是否正在执行，防止重复点击

    // 防重复标志：确保数据只处理一次
    let isProcessing = false;
    let hasProcessed = false;

    // 保存收到的父窗口消息（用于备用方案）
    let receivedMessageData = null;

    // 当前窗口 ID（用于构建窗口专属的 localStorage key，避免多窗口冲突）
    let currentWindowId = null;

    // 获取窗口专属的发布成功数据 key
    const getPublishSuccessKey = () => {
        const key = `PUBLISH_SUCCESS_DATA_${currentWindowId || 'default'}`;
        console.log('[网易号发布] 🔑 使用 localStorage key:', key);
        return key;
    };

    console.log('═══════════════════════════════════════');
    console.log('✅ 网易号发布脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    // 检查 common.js 是否已加载
    if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
        console.error('[网易号发布] ❌ common.js 未加载！脚本可能无法正常工作');
    } else {
        console.log('[网易号发布] ✅ common.js 已加载，工具函数可用');
    }

    // ===========================
    // 🔴 重要：先注册消息监听器，再执行任何 await 操作！
    // 否则消息可能在 await 期间到达，但回调还没注册
    // ===========================
    console.log('[网易号发布] 注册消息监听器...');

    if (!window.browserAPI) {
        console.error('[网易号发布] ❌ browserAPI 不可用！');
    } else {
        console.log('[网易号发布] ✅ browserAPI 可用');

        if (!window.browserAPI.onMessageFromHome) {
            console.error('[网易号发布] ❌ browserAPI.onMessageFromHome 不可用！');
        } else {
            console.log('[网易号发布] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

            window.browserAPI.onMessageFromHome(async (message) => {
                console.log('═══════════════════════════════════════');
                console.log('[网易号发布] 🎉 收到来自父窗口的消息!');
                console.log('[网易号发布] 消息类型:', typeof message);
                console.log('[网易号发布] 消息内容:', message);
                console.log('[网易号发布] 消息.type:', message?.type);
                console.log('[网易号发布] 消息.windowId:', message?.windowId);
                console.log('═══════════════════════════════════════');

                // 接收完整的发布数据（直接传递，不使用 IndexedDB）
                // 兼容 publish-data 和 auth-data 两种消息类型
                if (message.type === 'publish-data') {
                    // 使用公共方法解析消息数据
                    const messageData = parseMessageData(message.data, '[网易号发布]');
                    if (!messageData) return;

                    // 使用公共方法检查 windowId 是否匹配（在保存数据之前！避免串数据）
                    const isMatch = await checkWindowIdMatch(message, '[网易号发布]');
                    if (!isMatch) return;

                    // 🔑 恢复会话数据（cookies、localStorage、sessionStorage、IndexedDB）
                    // 注意：网易号有特殊的多域名 cookies 处理逻辑，不能直接使用 restoreSessionAndReload
                    if (messageData.cookies) {
                        console.log('[网易号发布] 📦 检测到 cookies 数据，开始恢复会话...');
                        try {
                            let cookiesData = messageData.cookies;

                            // 🔑 如果 cookies 数据是 JSON 字符串，先解析为对象
                            // 授权脚本中 cookies 是 JSON.stringify 后存储的，从后台取回时是字符串
                            if (typeof cookiesData === 'string') {
                                try {
                                    const parsed = JSON.parse(cookiesData);
                                    if (typeof parsed === 'object' && parsed !== null) {
                                        cookiesData = parsed;
                                        console.log('[网易号发布] 🔄 cookies 数据已从字符串解析为对象');
                                    }
                                } catch (e) {
                                    console.log('[网易号发布] ℹ️ cookies 数据不是 JSON 格式，保持原样');
                                }
                            }

                            // 处理多域名会话数据格式
                            // 如果是对象格式（多域名），需要合并处理
                            if (typeof cookiesData === 'object' && !Array.isArray(cookiesData)) {
                                console.log('[网易号发布] 🔄 检测到多域名会话数据，开始合并...');
                                const mergedData = {
                                    cookies: [],
                                    localStorage: {},
                                    sessionStorage: {},
                                    indexedDB: {}
                                };

                                // 遍历每个域名的数据
                                for (const [domain, domainData] of Object.entries(cookiesData)) {
                                    console.log(`[网易号发布] 📦 处理域名 ${domain} 的会话数据...`);

                                    if (domainData.cookies && Array.isArray(domainData.cookies)) {
                                        mergedData.cookies.push(...domainData.cookies);
                                        console.log(`[网易号发布] ✅ ${domain} 的 ${domainData.cookies.length} 个 cookies 已合并`);
                                    }

                                    if (domainData.localStorage) {
                                        Object.assign(mergedData.localStorage, domainData.localStorage);
                                    }

                                    if (domainData.sessionStorage) {
                                        Object.assign(mergedData.sessionStorage, domainData.sessionStorage);
                                    }

                                    if (domainData.indexedDB) {
                                        Object.assign(mergedData.indexedDB, domainData.indexedDB);
                                    }
                                }

                                cookiesData = JSON.stringify(mergedData);
                                console.log(`[网易号发布] ✅ 会话数据合并完成，共 ${mergedData.cookies.length} 个 cookies`);
                            } else {
                                // 单域名或字符串格式，直接转换
                                cookiesData = typeof cookiesData === 'string' ? cookiesData : JSON.stringify(cookiesData);
                            }

                            const restoreResult = await window.browserAPI.restoreSessionData(cookiesData);
                            if (restoreResult.success) {
                                console.log('[网易号发布] ✅ 会话数据恢复成功:', restoreResult.results);
                                // 恢复 cookies 后需要刷新页面才能生效
                                console.log('[网易号发布] 🔄 刷新页面以应用 cookies...');
                                // 保存消息数据到全局存储，刷新后继续使用
                                await window.browserAPI.setGlobalData(`publish_data_window_${await window.browserAPI.getWindowId()}`, messageData);
                                window.location.reload();
                                return; // 刷新后脚本会重新注入
                            } else {
                                console.warn('[网易号发布] ⚠️ 会话数据恢复失败:', restoreResult.error);
                            }
                        } catch (restoreError) {
                            console.error('[网易号发布] ⚠️ 会话数据恢复异常:', restoreError);
                        }
                    }

                    // windowId 匹配后才保存消息数据
                    receivedMessageData = messageData;
                    console.log('[网易号发布] 💾 已保存收到的消息数据到 receivedMessageData');

                    // 🔑 同时保存到 globalData（用于登录跳转后恢复）
                    try {
                        const windowId = await window.browserAPI.getWindowId();
                        if (windowId) {
                            await window.browserAPI.setGlobalData(`publish_data_window_${windowId}`, messageData);
                            console.log('[网易号发布] 💾 数据已保存到 globalData, key: publish_data_window_' + windowId);
                        }
                    } catch (e) {
                        console.error('[网易号发布] ❌ 保存数据到 globalData 失败:', e);
                    }

                    console.log('[网易号发布] ✅ 收到发布数据:', messageData);

                    // 防重复检查
                    if (isProcessing) {
                        console.warn('[网易号发布] ⚠️ 正在处理中，忽略重复消息');
                        return;
                    }
                    if (hasProcessed) {
                        console.warn('[网易号发布] ⚠️ 已经处理过，忽略重复消息');
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
                        console.log('[网易号发布] ✅ 发布数据已更新:', window.__AUTH_DATA__);
                        console.log("🚀 ~  ~ messageData: ", messageData);

                        try {
                            await retryOperation(async () => await fillFormData(messageData), 3, 2000);
                        } catch (e) {
                            console.log('[网易号发布] ❌ 填写表单数据失败:', e);
                        }

                        console.log('[网易号发布] 📤 准备发送数据到接口...');
                        console.log('[网易号发布] ✅ 发布流程已启动，等待 publishApi 完成...');
                    }

                    // 重置处理标志（无论成功或失败）
                    isProcessing = false;
                    console.log('[网易号发布] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
                }
            });

            console.log('[网易号发布] ✅ 消息监听器注册成功');
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
        console.log('[网易号发布] 当前窗口 ID:', currentWindowId);
    } catch (e) {
        console.error('[网易号发布] ❌ 获取窗口 ID 失败:', e);
    }

    console.log('[网易号发布] URL 参数:', {
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

    window.__WYH_AUTH__ = {
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
    console.log('[网易号发布] 页面加载完成，发送 页面加载完成 消息');
    sendMessageToParent('页面加载完成');

    console.log('═══════════════════════════════════════');
    console.log('✅ 网易号发布脚本初始化完成');
    console.log('📝 全局方法: window.__WYH_AUTH__');
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
            console.log('[网易号发布] ⏭️ 已在处理中或已完成，跳过全局存储读取');
            return;
        }

        try {
            // 获取当前窗口 ID
            const windowId = await window.browserAPI.getWindowId();
            console.log('[网易号发布] 检查全局存储，窗口 ID:', windowId);

            if (!windowId) {
                console.log('[网易号发布] ❌ 无法获取窗口 ID');
                return;
            }

            // 检查是否有恢复 cookies 后保存的发布数据
            const publishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
            console.log('[网易号发布] 📦 从全局存储读取 publish_data_window_' + windowId + ':', publishData ? '有数据' : '无数据');

            if (publishData && !isProcessing && !hasProcessed) {
                console.log('[网易号发布] ✅ 检测到恢复 cookies 后的数据，开始处理...');

                // 🔑 不再立即删除数据，改为在发布完成后删除
                // 这样如果登录跳转后跳回来，数据仍然可用
                // 使用 hasProcessed 标记防止重复处理
                console.log('[网易号发布] 📝 保留 publish_data_window_' + windowId + ' 数据，待发布完成后清理');

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
                    console.log('[网易号发布] ❌ 填写表单数据失败:', e);
                }

                console.log('[网易号发布] 📤 准备发送数据到接口...');
                console.log('[网易号发布] ✅ 发布流程已启动，等待 publishApi 完成...');

                isProcessing = false;
            }
        } catch (error) {
            console.error('[网易号发布] ❌ 从全局存储读取数据失败:', error);
        }
    })();

    // ===========================
    // 7. 从全局存储读取发布数据（备用方案，不依赖消息）
    // ===========================

    // ===========================
    // 8. 检查是否有保存的发布数据（授权跳转恢复）
    // ===========================

    // ===========================
    // 9. 发布视频到网易号（移到 IIFE 内部以访问变量）
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

            const userInfoResult = await fetch('https://mp.163.com/wemedia/navinfo.do', {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
            })
            const userInfoRes = await userInfoResult.json();
            let userInfo = {};
            if(userInfoRes.code === 1){
                userInfo = userInfoRes.data;
            }

            setTimeout(async () => {
                // 标题（带重试和验证）
                try{
                    await retryOperation(async () => {
                        const titleEle = await waitForElement(".newtitle-container .netease-textarea", 5000);

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

                        console.log('[网易号发布] ✅ 标题设置成功:', currentValue);
                    }, 5, 1000);
                }catch(e){
                    console.log('[网易号发布] ❌ 标题设置失败:', e);
                }

                try {
                    // 内容（带重试）
                    setTimeout(async () => {
                        try {
                            await retryOperation(async () => {
                                const editorIframeEle = await waitForElement("#editor_wyh", 10000);
                                const editorEle = editorIframeEle.querySelector('.public-DraftEditor-content > div')
                                let htmlContent = dataObj.video.video.content;

                                // 解析 HTML 中的图片，通过网易号 dumpproxy 接口上传
                                const tempDiv = document.createElement('div');
                                tempDiv.innerHTML = htmlContent;
                                const images = tempDiv.querySelectorAll('img');

                                console.log('[网易号发布] 🖼️ 发现', images.length, '张图片需要处理');

                                for (const img of images) {
                                    const originalSrc = img.src;
                                    if (!originalSrc || originalSrc.startsWith('data:')) {
                                        continue; // 跳过空 src 或 base64 图片
                                    }

                                    // 如果已经是网易号的图片，跳过
                                    if (originalSrc.includes('mp.163.com') || originalSrc.includes('dingyue.ws.')) {
                                        console.log('[网易号发布] ⏭️ 跳过已有图片:', originalSrc.substring(0, 50));
                                        continue;
                                    }

                                    try {
                                        console.log('[网易号发布] 📤 上传图片:', originalSrc.substring(0, 200));
                                        // 下载图片到本地转为二进制格式
                                        const imgRes = await window.browserAPI.downloadImage(originalSrc);
                                        console.log("🚀 ~  ~ imgRes: ", imgRes);
                                        if (!imgRes.success) {
                                            console.error('[网易号发布] ❌ 图片下载失败:', imgRes.error);
                                            continue;
                                        }
                                        // 将 base64 转换为二进制 File 对象
                                        const byteString = atob(imgRes.data);
                                        const ab = new ArrayBuffer(byteString.length);
                                        const ia = new Uint8Array(ab);
                                        for (let i = 0; i < byteString.length; i++) {
                                            ia[i] = byteString.charCodeAt(i);
                                        }

                                        // 创建 File 对象（直接用 ArrayBuffer，不用 Blob 包装）
                                        const imageType = getImageType(originalSrc);
                                        const fileName = `image.${imageType}`;
                                        const file = new File([ab], fileName, { type: imgRes.contentType });
                                        console.log("🚀 ~  ~ 文件信息 - 名称:", fileName, "类型:", imgRes.contentType, "大小:", file.size);

                                        // 调用网易号图片代理接口
                                        const formData = new FormData();
                                        formData.append('from', 'neteasecode_mp');
                                        formData.append('file', file);

                                        // 使用 URL 和 URLSearchParams 自动处理编码
                                        const url = new URL('https://mp.163.com/api/v3/upload/picupload');
                                        url.searchParams.append('wemediaId', userInfo.wemediaId);
                                        url.searchParams.append('realUserId', userInfo.loginUser);

                                        const response = await fetch(url.toString(), {
                                            method: 'POST',
                                            body: formData,
                                            credentials: 'include' // 带上 cookies
                                        });

                                        const result = await response.json();
                                        console.log('[网易号发布] 📥 上传结果:', result);

                                        if (result.code === 200 && result.data && result.data.url) {
                                            // 替换为网易号服务器的图片地址
                                            img.src = result.data.url;
                                            console.log('[网易号发布] ✅ 图片替换成功:', result.data.url.substring(0, 200));
                                        } else {
                                            console.log('[网易号发布] ⚠️ 图片上传失败，保留原地址');
                                        }
                                    } catch (e) {
                                        console.error('[网易号发布] ❌ 图片上传异常:', e.message);
                                    }
                                }

                                // 获取处理后的 HTML 并通过粘贴事件插入
                                htmlContent = tempDiv.innerHTML;

                                // 📝 只将最大的标题标签转换为 h5，其他保持不变
                                const headingsInfo = [];
                                let largestHeadingTag = null;
                                for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5']) {
                                    if (tempDiv.querySelector(tag)) {
                                        largestHeadingTag = tag;
                                        break;
                                    }
                                }

                                if (largestHeadingTag) {
                                    tempDiv.querySelectorAll(largestHeadingTag).forEach(el => {
                                        const text = el.textContent.trim();
                                        headingsInfo.push({ text });

                                        const h5 = document.createElement('h5');
                                        h5.textContent = text;
                                        el.replaceWith(h5);
                                    });
                                    console.log(`[网易号发布] 📝 将 ${largestHeadingTag.toUpperCase()} 转换为 H5，共 ${headingsInfo.length} 个`);
                                }

                                // 获取转换后的 HTML
                                htmlContent = tempDiv.innerHTML;

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
                                console.log('[网易号发布] 🧹 已清理开头所有空白内容');

                                // 🔑 检查 editorEle 是否存在
                                if (!editorEle) {
                                    console.error('[网易号发布] ❌ 编辑器元素未找到');
                                    throw new Error('编辑器元素未找到');
                                }
                                console.log('[网易号发布] ✅ 编辑器元素已找到:', editorEle.tagName, editorEle.className);

                                // 🔑 Draft.js 兼容方案：只使用粘贴事件，不做任何 DOM 操作
                                // Draft.js 会自己处理粘贴内容，不会破坏内部状态

                                // 让编辑器获得焦点
                                editorEle.focus();
                                await new Promise(resolve => setTimeout(resolve, 300));

                                // 🔑 关键：不要清空编辑器！让 Draft.js 自己处理
                                // 只通过粘贴事件插入内容（追加到现有内容后面）
                                // 如果编辑器有默认占位内容，粘贴后会自动替换

                                console.log('[网易号发布] 📋 准备通过粘贴事件插入内容...');

                                // 创建粘贴事件
                                const clipboardData = new DataTransfer();
                                clipboardData.setData('text/html', htmlContent);
                                clipboardData.setData('text/plain', tempDiv.textContent);

                                const pasteEvent = new ClipboardEvent('paste', {
                                    clipboardData: clipboardData,
                                    bubbles: true,
                                    cancelable: true
                                });

                                // 触发粘贴事件
                                editorEle.dispatchEvent(pasteEvent);
                                console.log('[网易号发布] ✅ 已触发粘贴事件');

                                // 等待 Draft.js 处理粘贴内容
                                await new Promise(resolve => setTimeout(resolve, 1000));

                                console.log('[网易号发布] ✅ 内容填写完成');
                            }, 3, 1000);
                        } catch (e) {
                            console.log('[网易号发布] ❌ 内容填写失败:', e.message);
                        }
                    }, 200);
                } catch (e) {
                    console.log('[网易号发布] ❌ 内容填写失败:', e.message)
                }

                // 设置封面为单图模式
                const hasSettingsWrapEle = await waitForElement(".cover-pic__cover");
                if (hasSettingsWrapEle) {
                    const coverRadioEle = hasSettingsWrapEle.querySelectorAll('.cover-pic__radio');
                    for (let coverRadioEleElement of coverRadioEle) {
                        const radioInput = coverRadioEleElement.querySelector('input');
                        if (coverRadioEleElement.innerText === '单图') {
                            setNativeValue(radioInput, true);
                        } else {
                            setNativeValue(radioInput, false);
                        }
                    }

                    // ===========================
                    // 🔴 全局错误监听器 - 在上传图片之前就开始监听
                    // ===========================
                    const capturedErrors = []; // 收集所有捕获的错误信息
                    let errorScanInterval = null;

                    // 🔑 需要忽略的非错误文本（在采集时就过滤掉）
                    const ignoredTexts = [
                        '正在上传', '加载中', '处理中', '成功', '发布成功', '提交成功', '上传成功',
                        '设置区', '内容区', '封面区', '发文前检测'
                    ];
                    const shouldIgnoreText = (text) => {
                        if (!text) return true;
                        return ignoredTexts.some(ignored => text.includes(ignored));
                    };

                    // 启动错误监听
                    const startErrorListener = () => {
                        console.log('[网易号发布] 🔍 启动全局错误监听器...');

                        let scanCount = 0;
                        // 定期扫描 DOM 中的错误提示
                        errorScanInterval = setInterval(() => {
                            scanCount++;
                            if (scanCount % 10 === 1) {
                                console.log('[网易号发布] 🔄 错误扫描器运行中...', scanCount);
                            }

                            // 扫描 snackbar 错误提示
                            const snackbars = document.querySelectorAll('.ne-snackbar-item-description');
                            if (snackbars.length > 0 && scanCount % 10 === 1) {
                                console.log('[网易号发布] 📍 找到', snackbars.length, '个 snackbar');
                            }

                            for (const snackbar of snackbars) {
                                const spans = snackbar.querySelectorAll('span');
                                if (spans.length >= 2) {
                                    const textSpan = spans[spans.length - 1];
                                    const text = (textSpan.textContent || '').trim();
                                    // 🔑 采集时就过滤掉非错误文本
                                    if (text && !capturedErrors.includes(text) && !shouldIgnoreText(text)) {
                                        capturedErrors.push(text);
                                        console.log('[网易号发布] 📨 捕获到错误信息:', text);
                                    }
                                }
                            }

                            // 扫描表单错误提示
                            const formErrors = document.querySelectorAll('.ne-modal-container');
                            for (const formError of formErrors) {
                                const errorSpan = formError.querySelector('.custom-confirm-content');
                                if (errorSpan) {
                                    const text = (errorSpan.textContent || '').trim();
                                    // 🔑 采集时就过滤掉非错误文本
                                    if (text && !capturedErrors.includes(text) && !shouldIgnoreText(text)) {
                                        capturedErrors.push(text);
                                        console.log('[网易号发布] 📨 捕获到错误信息:', text);
                                    }
                                }
                            }
                        }, 300); // 每 300ms 扫描一次

                        console.log('[网易号发布] ✅ 全局错误监听器已启动');
                    };

                    // 停止错误监听
                    const stopErrorListener = () => {
                        if (errorScanInterval) {
                            clearInterval(errorScanInterval);
                            errorScanInterval = null;
                            console.log('[网易号发布] 🛑 全局错误监听器已停止');
                        }
                    };

                    // 获取最新的错误信息
                    const getLatestError = () => {
                        // 优先返回最后一条错误（采集时已过滤非错误文本）
                        for (let i = capturedErrors.length - 1; i >= 0; i--) {
                            const msg = capturedErrors[i];
                            // 🔑 双重保险：再次检查是否应忽略
                            if (!shouldIgnoreText(msg)) {
                                console.log("🚀 ~ getLatestError ~ msg: ", msg);
                                return msg;
                            }
                        }
                        // 🔑 如果所有消息都被过滤了，返回 null（不是错误）
                        return null;
                    };

                    // 立即启动错误监听
                    startErrorListener();

                    // 设置封面（使用主进程下载绕过跨域）
                    await (async () => {
                        try {
                            const {blob, contentType} = await downloadFile(pathImage, 'image/png');
                            var file = new File([blob], dataObj?.video?.formData?.title + ".png", {type: contentType || "image/png"});

                            // 选中本地上传（点击"选择封面"按钮）
                            setTimeout(async () => {
                                // 查找并点击"选择封面"按钮
                                const coverBtn = await waitForElement('.cover-pic__single__content__choose');
                                const coverEle = coverBtn.querySelector('img');
                                console.log("🚀 ~  ~ coverBtn: ", coverBtn);
                                if (coverBtn) {
                                    //检查是否已经有图片
                                    if(coverEle){
                                        if (coverEle.getAttribute('src')) {
                                            const changeBtnEles = await waitForElement('.cover-pic__operate', 5000, 1000, coverBtn);
                                            let changeBtnEle = null;
                                            if (changeBtnEles.length) {
                                                for (const btn of changeBtnEles) {
                                                    if (btn.textContent.trim().includes('换图')) {
                                                        changeBtnEle = btn;
                                                    }
                                                }
                                            }
                                            changeBtnEle && changeBtnEle.click();
                                        }
                                    }else{
                                        coverBtn.click();
                                        console.log('[网易号发布] ✅ 已点击"选择封面"按钮');
                                    }

                                    await retryOperation(async () => {
                                        // 有弹窗先关闭弹窗
                                        const tipDialogEle = await waitForElement('.ne-modal-body', 5000, 1000);
                                        console.log("🚀 ~  ~ tipDialogEle: ", tipDialogEle);
                                        if (tipDialogEle) {
                                            const imgListEle = tipDialogEle.querySelector('.cover-picture__list')
                                            if(!imgListEle){
                                                const dialogTextEle = await waitForElement('.custom-confirm-content', 5000, 1000, tipDialogEle);
                                                if (dialogTextEle) {
                                                    const dialogText = dialogTextEle.textContent.trim();
                                                    if (dialogText.includes('正文中至少上传一张图片')) {
                                                        // 需要在正文中插入图片
                                                        console.log('[网易号发布] 📝 检测到需要在正文中插入图片');

                                                        try {
                                                            // 等待编辑器加载
                                                            const editorIframeEle = await waitForElement("#editor_wyh", 5000);
                                                            if (editorIframeEle) {
                                                                const editorEle = editorIframeEle.querySelector('.public-DraftEditor-content > div');
                                                                if (editorEle && pathImage) {
                                                                    // 使用和内容插入相同的粘贴事件方式
                                                                    const imgHtml = `<img src="${pathImage}" style="max-width: 100%; height: auto; margin-bottom: 16px;" />`;

                                                                    // 让编辑器获得焦点
                                                                    editorEle.focus();

                                                                    // 通过粘贴事件插入图片HTML
                                                                    const pasteEvent = new ClipboardEvent('paste', {
                                                                        clipboardData: new DataTransfer(),
                                                                        bubbles: true,
                                                                        cancelable: true
                                                                    });

                                                                    pasteEvent.clipboardData.setData('text/html', imgHtml);
                                                                    pasteEvent.clipboardData.setData('text/plain', '[图片]');

                                                                    editorEle.dispatchEvent(pasteEvent);

                                                                    // 等待编辑器处理
                                                                    await new Promise(resolve => setTimeout(resolve, 500));

                                                                    console.log('[网易号发布] ✅ 已在正文中插入封面图片');
                                                                }
                                                            }
                                                        } catch (e) {
                                                            console.error('[网易号发布] ❌ 在正文中插入图片失败:', e);
                                                        }
                                                    }
                                                }
                                                const tipBtnEle = await waitForElement('.ne-button-color-primary', 5000, 1000, tipDialogEle);
                                                tipBtnEle.click();
                                                await delay(1000);
                                            }
                                        }


                                        // 检查刚刚上传的图片是否已经显示在编辑器中，并且域名包括dingyue.ws
                                        console.log('[网易号发布] 🔍 检查编辑器中的图片是否已上传...');
                                        let editorImageValid = false;
                                        const checkEditorStartTime = Date.now();
                                        const checkEditorTimeout = 60000; // 1分钟超时
                                        const checkEditorInterval = 300; // 每300ms检查一次
                                        let checkCount = 0; // 检查次数计数

                                        while (Date.now() - checkEditorStartTime < checkEditorTimeout) {
                                            await delay(checkEditorInterval);
                                            checkCount++;

                                            // 每10次检查输出一次状态（避免日志过多）
                                            if (checkCount % 10 === 1) {
                                                console.log(`[网易号发布] 🔄 第 ${checkCount} 次检查编辑器图片...`);
                                            }

                                            const editorImageContainer = await waitForElement("#editor_wyh", 5000);
                                            if (!editorImageContainer) {
                                                if (checkCount === 1) {
                                                    console.warn('[网易号发布] ⚠️ 找不到编辑器图片容器 .cover-pic__single__content__choose');
                                                }
                                                continue;
                                            }

                                            const editorImg = editorImageContainer.querySelector('img');
                                            if (!editorImg) {
                                                if (checkCount === 1) {
                                                    console.warn('[网易号发布] ⚠️ 编辑器图片容器中找不到 img 元素');
                                                }
                                                continue;
                                            }

                                            const editorImgSrc = editorImg.getAttribute('src');
                                            if (checkCount === 1 || checkCount % 10 === 1) {
                                                console.log('[网易号发布] 📸 编辑器中的图片src:', editorImgSrc);
                                            }

                                            if (editorImgSrc && editorImgSrc.includes('dingyue.ws')) {
                                                console.log('[网易号发布] ✅ 编辑器中的图片已完成上传:', editorImgSrc);
                                                editorImageValid = true;
                                                break;
                                            }
                                        }

                                        if (!editorImageValid) {
                                            console.warn(`[网易号发布] ⚠️ 检查了 ${checkCount} 次，1分钟内编辑器中的图片未完成上传，继续执行后续流程`);
                                        }

                                        // ✅ 编辑器图片检测完毕后，再点击上传封面
                                        console.log('[网易号发布] ✅ 编辑器图片检测完成，现在点击上传封面');
                                        coverBtn.click();
                                        await delay(1000);

                                        const uploadListDialog = await waitForElement('.ne-modal-body', 5000, 5000);
                                        if(uploadListDialog){
                                            //    找到图片列表
                                            const imgListEle = await waitForElement('.cover-picture__list', 5000, 1000);
                                            console.log("🚀 ~  ~ imgListEle: ", imgListEle);
                                            if (imgListEle) {
                                                const imgItemEle = imgListEle.querySelectorAll('.cover-picture__item')[0];
                                                console.log("🚀 ~  ~ imgItemEle: ", imgItemEle);
                                                if(imgItemEle){
                                                    const imgEle = imgItemEle.querySelector('img');
                                                    console.log("🚀 ~  ~ imgEle: ", imgEle);
                                                    if (imgEle) {
                                                        await delay(1000);
                                                        imgEle.click();
                                                        await delay(1000);
                                                        const src = imgEle.getAttribute('src');
                                                        console.log("🚀 ~  ~ src: ", src);

                                                        // 有src就等待链接变化（等待变成dingyue.ws的链接），最多等1分钟
                                                        if(!src){
                                                            console.warn('[网易号发布] ⚠️ 图片未获取到src，返回');
                                                            return;
                                                        }

                                                        // 定时检测src是否有变化，等待变成dingyue.ws的链接
                                                        console.log('[网易号发布] ⏳ 等待图片链接变化（等待dingyue.ws的链接）...');
                                                        let finalSrc = src;
                                                        let srcChanged = false;
                                                        const waitSrcChangeStartTime = Date.now();
                                                        const waitSrcChangeTimeout = 60000; // 1分钟超时
                                                        const checkSrcChangeInterval = 500; // 每500ms检查一次

                                                        while (Date.now() - waitSrcChangeStartTime < waitSrcChangeTimeout) {
                                                            await delay(checkSrcChangeInterval);
                                                            const currentSrc = imgEle.getAttribute('src');

                                                            // 检查src是否有变化或变成了dingyue.ws
                                                            if (currentSrc !== finalSrc || (currentSrc && currentSrc.includes('dingyue.ws'))) {
                                                                console.log('[网易号发布] ✅ 检测到链接变化或已是有效链接:', currentSrc);
                                                                finalSrc = currentSrc;
                                                                srcChanged = true;
                                                                break;
                                                            }
                                                        }

                                                        if (!srcChanged) {
                                                            console.warn('[网易号发布] ⚠️ 1分钟内链接未变化，继续执行');
                                                        }
                                                        const coverConfirmBtn = await waitForElement('.cover-picture__footer', 5000, 1000);
                                                        if (coverConfirmBtn) {
                                                            // 寻找coverConfirmBtn下含"确认"的元素
                                                            const allBtns = coverConfirmBtn.querySelectorAll('div, button, span');
                                                            console.log("🚀 ~  ~ allBtns: ", allBtns);
                                                            let confirmBtnEle = null;
                                                            for (const btn of allBtns) {
                                                                if (btn.textContent.trim() === '确认' && btn.children.length === 0) {
                                                                    confirmBtnEle = btn || btn;
                                                                    break;
                                                                }
                                                            }
                                                            console.log("🚀 ~  ~ confirmBtnEle: ", confirmBtnEle);
                                                            if (confirmBtnEle) {
                                                                confirmBtnEle.click();
                                                                console.log('[网易号发布] ✅ 已点击封面图片确认按钮');
                                                            } else {
                                                                console.warn('[网易号发布] ⚠️ 找不到确认按钮，尝试直接点击footer');
                                                                coverConfirmBtn.click();
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }, 5, 1000)
                                }
                                await delay(1000); // 等待渲染完成

                                setTimeout(async () => {
                                    // 封装上传检测与重试逻辑
                                    const tryUploadImage = async (retryCount = 0) => {
                                        const maxRetries = 3;

                                        // 🔴 自定义等待逻辑：同时检查图片元素和错误信息
                                        const waitForImageOrError = async (timeout = 60000) => {
                                            const startTime = Date.now();
                                            const checkInterval = 300; // 每300ms检查一次

                                            while (Date.now() - startTime < timeout) {
                                                // 1. 先检查是否有错误信息（优先级更高）- 直接扫描 DOM
                                                const snackbars = document.querySelectorAll('.ne-snackbar-item-description');
                                                for (const snackbar of snackbars) {
                                                    const spans = snackbar.querySelectorAll('span');
                                                    if (spans.length >= 2) {
                                                        const textSpan = spans[spans.length - 1];
                                                        const text = (textSpan.textContent || '').trim();
                                                        // 排除非错误提示（使用外层定义的过滤函数）
                                                        if (!shouldIgnoreText(text)) {
                                                            console.log('[网易号发布] 📨 实时捕获到错误信息:', text);
                                                            return {type: 'error', message: text};
                                                        }
                                                    }
                                                }

                                                // 2. 再检查图片元素是否出现，且 src 包含 dingyue.ws
                                                const imageContainer = document.querySelector(".cover-pic__single__content__choose");
                                                if (imageContainer) {
                                                    const imgEle = imageContainer.querySelector('img');
                                                    if (imgEle) {
                                                        const src = imgEle.getAttribute('src');
                                                        if (src && src.includes('dingyue.ws')) {
                                                            // 🔑 检测到有效图片（dingyue.ws 域名），再等待 500ms 确认是否有错误
                                                            console.log('[网易号发布] 🔍 检测到有效图片（dingyue.ws），等待 500ms 确认是否有错误...');
                                                            await delay(500);

                                                            // 再次检查错误
                                                            const snackbarsConfirm = document.querySelectorAll('.ne-snackbar-item-description');
                                                            for (const snackbar of snackbarsConfirm) {
                                                                const spans = snackbar.querySelectorAll('span');
                                                                if (spans.length >= 2) {
                                                                    const textSpan = spans[spans.length - 1];
                                                                    const text = (textSpan.textContent || '').trim();
                                                                    // 排除非错误提示，不当作错误
                                                                    if (text && !shouldIgnoreText(text)) {
                                                                        console.log('[网易号发布] ⚠️ 确认期间检测到错误:', text);
                                                                        return {type: 'error', message: text};
                                                                    }
                                                                }
                                                            }

                                                            return {type: 'success', element: imageContainer};
                                                        }
                                                    }
                                                }

                                                // 等待下一次检查
                                                await delay(checkInterval);
                                            }

                                            // 超时，再检查一次错误信息
                                            const snackbarsFinal = document.querySelectorAll('.ne-snackbar-item-description');
                                            for (const snackbar of snackbarsFinal) {
                                                const spans = snackbar.querySelectorAll('span');
                                                if (spans.length >= 2) {
                                                    const textSpan = spans[spans.length - 1];
                                                    const text = (textSpan.textContent || '').trim();
                                                    // 排除非错误提示，不当作错误
                                                    if (text && !shouldIgnoreText(text)) {
                                                        return {type: 'error', message: text};
                                                    }
                                                }
                                            }

                                            return {type: 'timeout'};
                                        };

                                        const result = await waitForImageOrError(); // 使用默认 60 秒超时
                                        console.log("🚀 ~ tryUploadImage ~ result: ", result);
                                        const myWindowId = await window.browserAPI.getWindowId();

                                        // 🔴 检测到错误信息，直接上报失败
                                        if (result.type === 'error') {
                                            console.log(`[网易号发布] [窗口${myWindowId}] ❌ 检测到错误信息，直接上报失败: ${result.message}`);
                                            stopErrorListener();
                                            const publishId = dataObj.video?.dyPlatform?.id;
                                            if (publishId) {
                                                await sendStatisticsError(publishId, result.message, '网易号发布');
                                            }
                                            await closeWindowWithMessage('发布失败，刷新数据', 1000);
                                            return; // 不再继续
                                        }

                                        if (result.type === 'success') {
                                            console.log('[网易号发布] ✅ 图片上传成功');

                                            await delay(5000); // 等待渲染完成

                                            const publishBtns = document.querySelectorAll(".post-footer__container-right .ne-button");
                                            let publishBtn = null;
                                            let scheduledReleasesBtn = null;
                                            for (let publishBtnEle of publishBtns) {
                                                if(publishBtnEle.textContent.trim() === '发布'){
                                                    publishBtn = publishBtnEle;
                                                }
                                                if(publishBtnEle.textContent.trim() === '定时发布'){
                                                    scheduledReleasesBtn = publishBtnEle;
                                                }
                                            }

                                            console.log("🚀 ~ tryUploadImage ~ scheduledReleasesBtn: ", scheduledReleasesBtn);
                                            // 🔑 检查是否需要定时发布
                                            const publishTime = dataObj.video?.formData?.send_set;
                                            console.log("🚀 ~ tryUploadImage ~ publishTime: ", publishTime);
                                            const sendTime = dataObj.video?.formData?.send_time;
                                            console.log("🚀 ~ tryUploadImage ~ sendTime: ", sendTime);

                                            if (publishTime === 2 && sendTime && scheduledReleasesBtn) {
                                                console.log("🚀 ~ tryUploadImage ~ scheduledReleasesBtn: ", scheduledReleasesBtn);
                                                console.log('[网易号发布] ⏰ 检测到需要定时发布，时间:', sendTime);

                                                // 点击定时发布按钮（第一次，触发发文前检测）
                                                await delay(5000);
                                                console.log('[网易号发布] 🖱️ 点击定时发布按钮');
                                                scheduledReleasesBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
                                                await delay(300);
                                                scheduledReleasesBtn.click();

                                                // 检查是否有发文前检测提示
                                                await delay(1000);
                                                const checkTip = document.querySelector('.ne-snackbar-item-description');
                                                if (checkTip && checkTip.textContent.includes('发文前检测')) {
                                                    console.log('[网易号发布] 🔍 检测到发文前检测提示，等待完成后再点一次...');
                                                    await delay(5000);
                                                    console.log('[网易号发布] 🖱️ 再次点击定时发布按钮');
                                                    scheduledReleasesBtn.click();
                                                    await delay(1000);
                                                }

                                                // 等待弹窗出现并选择时间
                                                const scheduledModal = await waitForElement('.ne-modal-container');
                                                if (scheduledModal) {
                                                    console.log('[网易号发布] ✅ 定时发布弹窗已打开');

                                                    // 调用选择时间函数
                                                    const timeSelectSuccess = await selectScheduledTime(sendTime);

                                                    if (!timeSelectSuccess) {
                                                        console.error('[网易号发布] ❌ 时间选择失败');
                                                        stopErrorListener();
                                                        await closeWindowWithMessage('定时时间选择失败', 1000);
                                                    }
                                                } else {
                                                    console.error('[网易号发布] ❌ 定时发布弹窗未打开');
                                                    stopErrorListener();
                                                    await closeWindowWithMessage('定时发布弹窗未打开', 1000);
                                                    return;
                                                }
                                            } else if (publishBtn) {
                                                // 直接发布流程
                                                // 🔑 检查发布按钮是否 disabled - 支持网易号的禁用类名
                                                const isDisabled = publishBtn.disabled === true ||
                                                                   publishBtn.hasAttribute('disabled') ||
                                                                   publishBtn.classList.contains('is-disabled') ||
                                                                   publishBtn.classList.contains('ne-disabled') ||
                                                                   publishBtn.classList.contains('ne-btn-disabled') ||
                                                                   publishBtn.getAttribute('aria-disabled') === 'true';

                                                if (isDisabled) {
                                                    console.error('[网易号发布] ❌ 发布按钮不可用(disabled)');
                                                    console.log('[网易号发布] 按钮 disabled:', publishBtn.disabled);
                                                    console.log('[网易号发布] 按钮类名:', publishBtn.className);
                                                    console.log('[网易号发布] 按钮属性:', {
                                                        hasDisabled: publishBtn.hasAttribute('disabled'),
                                                        ariaDisabled: publishBtn.getAttribute('aria-disabled')
                                                    });
                                                    stopErrorListener();
                                                    const publishIdForError = dataObj.video?.dyPlatform?.id;
                                                    if (publishIdForError) {
                                                        await sendStatisticsError(publishIdForError, '发布按钮不可用，可能不符合发布要求，或者发文次数已用尽', '网易号发布');
                                                    }
                                                    await closeWindowWithMessage('发布失败，刷新数据', 1000);
                                                    return;
                                                }
                                                // 🔑 在点击发布前保存 publishId，让 publish-success.js 可以调用统计接口
                                                const publishId = dataObj.video?.dyPlatform?.id;
                                                if (publishId) {
                                                    try {
                                                        // 同时保存到 localStorage 和 globalData（双保险）
                                                        localStorage.setItem(getPublishSuccessKey(), JSON.stringify({publishId: publishId}));
                                                        console.log('[网易号发布] 💾 已保存 publishId 到 localStorage:', publishId);

                                                        // 🔑 也保存到 globalData（更可靠，不受域名隔离限制）
                                                        if (window.browserAPI && window.browserAPI.setGlobalData) {
                                                            await window.browserAPI.setGlobalData(`PUBLISH_SUCCESS_DATA_${currentWindowId}`, {publishId: publishId});
                                                            console.log('[网易号发布] 💾 已保存 publishId 到 globalData');
                                                        }
                                                    } catch (e) {
                                                        console.error('[网易号发布] ❌ 保存 publishId 失败:', e);
                                                    }
                                                } else {
                                                    console.log('[网易号发布] ℹ️ 没有 publishId，跳过统计接口');
                                                }

                                                const clickEvent = new MouseEvent('click', {
                                                    view: window,
                                                    bubbles: true,
                                                    cancelable: true
                                                });
                                                publishBtn.dispatchEvent(clickEvent);
                                                console.log('[网易号发布] ✅ 已点击发布按钮');

                                                // 检查是否有发文前检测提示
                                                await delay(1000);
                                                const publishCheckTip = document.querySelector('.ne-snackbar-item-description');
                                                if (publishCheckTip && publishCheckTip.textContent.includes('发文前检测')) {
                                                    console.log('[网易号发布] 🔍 检测到发文前检测提示，等待完成后再点一次...');
                                                    await delay(5000);
                                                    console.log('[网易号发布] 🖱️ 再次点击发布按钮');
                                                    publishBtn.dispatchEvent(clickEvent);
                                                    await delay(1000);
                                                }

                                                let publishDialogErrorMsg = null;
                                                // 检查是否有弹窗类型的错误信息
                                                try{
                                                    await retryOperation(async () => {
                                                        // 有弹窗先关闭弹窗
                                                        const errorDialogEle = await waitForElement('.ne-modal-body', 5000, 1000);
                                                        console.log("🚀 ~  ~ errorDialogEle: ", errorDialogEle);
                                                        if (errorDialogEle) {
                                                            publishDialogErrorMsg = errorDialogEle.querySelector('.custom-confirm-content').textContent.trim();
                                                            const tipBtnEle = await waitForElement('.ne-button-color-primary', 5000, 1000, errorDialogEle);
                                                            tipBtnEle.click()
                                                        }
                                                    }, 5, 1000)
                                                } catch (error) {
                                                    console.log("🚀 ~ ~ error: ", error);
                                                }

                                                // 检查是否有错误信息
                                                const publishErrorMsg = getLatestError();
                                                if (publishErrorMsg || publishDialogErrorMsg) {
                                                    const errorMsg = publishErrorMsg || publishDialogErrorMsg;
                                                    console.log('[网易号发布] ❌ 检测到发布错误:', errorMsg);
                                                    stopErrorListener();
                                                    const publishId = dataObj.video?.dyPlatform?.id;
                                                    if (publishId) {
                                                        console.log('[网易号发布] 📤 调用失败接口...');
                                                        await sendStatisticsError(publishId, errorMsg, '网易号发布');
                                                    }
                                                    await closeWindowWithMessage('发布失败，刷新数据', 1000);
                                                    return;
                                                } else {
                                                    console.log('[网易号发布] ✅ 未检测到错误，等待页面跳转（由 publish-success.js 处理）');
                                                    stopErrorListener();
                                                }
                                            } else {
                                                console.error('[网易号发布] ❌ 找不到提交图片按钮，上报失败');
                                                stopErrorListener();
                                                const publishId = dataObj.video?.dyPlatform?.id;
                                                if (publishId) {
                                                    await sendStatisticsError(publishId, '发布按钮不可用', '网易号发布');
                                                }
                                                await closeWindowWithMessage('发布失败，刷新数据', 1000);
                                                return;
                                            }
                                        } else {
                                            // 图片上传失败（timeout），检查是否有错误信息
                                            const myWindowId = await window.browserAPI.getWindowId();
                                            console.log(`[网易号发布] [窗口${myWindowId}] ❌ 图片上传失败，重试次数: ${retryCount}/${maxRetries}`);

                                            // 优先使用全局错误监听器捕获的错误
                                            const errorMessage = getLatestError();
                                            console.log(`[网易号发布] [窗口${myWindowId}] 📨 最新错误信息:`, errorMessage);

                                            // 🔴 有错误信息就直接走失败接口，不再重试
                                            if (errorMessage) {
                                                console.log(`[网易号发布] [窗口${myWindowId}] ❌ 检测到错误信息，直接上报失败，不再重试`);
                                                stopErrorListener(); // 停止监听
                                                const publishId = dataObj.video?.dyPlatform?.id;
                                                console.log(`[网易号发布] [窗口${myWindowId}] 📋 publishId:`, publishId);
                                                console.log(`[网易号发布] [窗口${myWindowId}] 📋 dataObj:`, dataObj);
                                                if (publishId) {
                                                    console.log(`[网易号发布] [窗口${myWindowId}] 📤 调用 sendStatisticsError...`);
                                                    await sendStatisticsError(publishId, errorMessage, '网易号发布');
                                                    console.log(`[网易号发布] [窗口${myWindowId}] ✅ sendStatisticsError 完成`);
                                                } else {
                                                    console.error(`[网易号发布] [窗口${myWindowId}] ❌ publishId 为空，无法调用失败接口！`);
                                                }
                                                await closeWindowWithMessage('发布失败，刷新数据', 1000);
                                                return; // 不再继续
                                            }

                                            // 没有错误信息才重试
                                            if (retryCount < maxRetries) {
                                                console.log(`[网易号发布] 🔄 ${2}秒后重新点击上传封面按钮...`);
                                                await delay(2000);

                                                // 重新点击封面上传按钮
                                                const coverBtn = document.querySelector('.cover-pic__single__content__choose');
                                                if (coverBtn) {
                                                    coverBtn.click();
                                                    console.log('[网易号发布] 🔄 已重新点击封面按钮');

                                                    // 等待上传对话框出现
                                                    await delay(1000);

                                                    // 重新触发文件上传
                                                    const input = document.querySelector(".cheetah-upload input");
                                                    if (input) {
                                                        input.files = dataTransfer.files;
                                                        const event = new Event("change", {bubbles: true});
                                                        input.dispatchEvent(event);
                                                        console.log('[网易号发布] 🔄 已重新触发上传');

                                                        // 递归重试
                                                        await delay(2000);
                                                        await tryUploadImage(retryCount + 1);
                                                    } else {
                                                        console.error('[网易号发布] ❌ 无法找到上传输入框，无法重试');
                                                        stopErrorListener();
                                                        const publishId = dataObj.video?.dyPlatform?.id;
                                                        if (publishId) {
                                                            await sendStatisticsError(publishId, '图片上传失败，无法找到上传输入框', '网易号发布');
                                                        }
                                                        await closeWindowWithMessage('图片上传失败，刷新数据', 1000);
                                                    }
                                                } else {
                                                    console.error('[网易号发布] ❌ 无法找到封面按钮，无法重试');
                                                    stopErrorListener();
                                                    const publishId = dataObj.video?.dyPlatform?.id;
                                                    if (publishId) {
                                                        await sendStatisticsError(publishId, '图片上传失败，无法找到封面按钮', '网易号发布');
                                                    }
                                                    await closeWindowWithMessage('图片上传失败，刷新数据', 1000);
                                                }
                                            } else {
                                                // 超过最大重试次数
                                                console.error('[网易号发布] ❌ 图片上传重试次数已用尽');
                                                stopErrorListener();
                                                const publishId = dataObj.video?.dyPlatform?.id;
                                                if (publishId) {
                                                    await sendStatisticsError(publishId, '图片上传失败，重试次数已用尽', '网易号发布');
                                                }
                                                await closeWindowWithMessage('图片上传失败，刷新数据', 1000);
                                            }
                                        }
                                    };

                                    // 启动上传检测（延迟2秒等待上传开始）
                                    setTimeout(async () => {
                                        await tryUploadImage(0);
                                    }, 2000);
                                }, 1000);
                            }, 2000);
                        } catch (error) {
                            console.log('[网易号发布] ❌ 封面下载失败:', error);
                            stopErrorListener();
                            const publishId = dataObj?.video?.dyPlatform?.id;
                            if (publishId) {
                                await sendStatisticsError(publishId, error.message || '封面下载失败', '网易号发布');
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
            console.error('[网易号发布] fillFormData 错误:', error);
            // 发送错误上报
            const publishId = dataObj?.video?.dyPlatform?.id;
            if (publishId) {
                await sendStatisticsError(publishId, error.message || '填写表单失败', '网易号发布');
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
})(); // IIFE 结束

function getImageType(src){
    const imageType = src.split(';')[0].split('/')[1];
    return imageType;
}

/**
 * 选择定时发布的日期和时间
 * @param sendTime
 */
async function selectScheduledTime(sendTime) {
    console.log("🚀 ~ selectScheduledTime ~ sendTime: ", sendTime);
    try {
        const modal = document.querySelector(".ne-modal-body");
        if (!modal) {
            console.error("[网易号发布] ❌ 找不到定时发布弹窗");
            return false;
        }

        // 解析目标日期时间
        const [datePart, timePart] = sendTime.split(' ');
        const [year, month, day] = datePart.split('-');
        console.log("🚀 ~ selectScheduledTime ~ day: ", day);

        // 1. 点击日期输入框打开日历
        const dateInput = modal.querySelector(".ne-input-container input");
        if (!dateInput) {
            console.error("[网易号发布] ❌ 找不到日期输入框");
            return false;
        }
        dateInput.click();
        await delay(300);
        console.log("[网易号发布] 🔧 开始选择定时发布时间...");

        const picker = document.querySelector(".ne-date-picker");
        if (!picker) {
            console.error("[网易号发布] ❌ 找不到日期选择器");
            return false;
        }

        // 2. 导航到目标月份（处理跨月情况）
        for (let i = 0; i < 24; i++) { // 最多尝试24个月
            // 注意: curr-date 是独立的 class，不是 omui-calendar-nav 的子元素
            const currDateEl = picker.querySelector(".ne-calendar-head-date-title");
            if (!currDateEl) {
                console.error("[网易号发布] ❌ 找不到当前月份显示元素");
                break;
            }

            const currentText = currDateEl.textContent; // 格式: "2026-01"
            const match = currentText.match(/(\d+)-(\d+)/);
            if (!match) {
                console.error("[网易号发布] ❌ 无法解析当前月份:", currentText);
                break;
            }

            const currYear = parseInt(match[1], 10);
            const currMonth = parseInt(match[2], 10);
            console.log(`[网易号发布] 📅 当前显示: ${currYear}-${currMonth}, 目标: ${year}-${month}`);

            if (currYear === parseInt(year) && currMonth === parseInt(month)) {
                console.log("[网易号发布] ✅ 已到达目标月份");
                break; // 已到达目标月份
            }

            // 判断需要前进还是后退
            const targetDate = new Date(year, month - 1);
            const currentDate = new Date(currYear, currMonth - 1);

            if (targetDate > currentDate) {
                // 点击下一月 > (omui-calendar-nav 和 next-m 是同一元素的 class)
                const nextBtn = picker.querySelector(".ne-calendar-next");
                if (nextBtn) {
                    nextBtn.click();
                    console.log("[网易号发布] ➡️ 点击下一月");
                }
            } else {
                // 点击上一月 < (omui-calendar-nav 和 prev-m 是同一元素的 class)
                const prevBtn = picker.querySelector(".ne-calendar-prev");
                if (prevBtn) {
                    prevBtn.click();
                    console.log("[网易号发布] ⬅️ 点击上一月");
                }
            }
            await delay(200);
        }
        await delay(200);

        // 3. 选择日期 - 找到目标日期的 td 并点击
        let dateSelected = false;
        const allDayCells = picker.querySelectorAll(".ne-calendar-body td");
        for (const td of allDayCells) {
            const span = td.querySelector("button");
            if (!span) continue;

            // 跳过不可选的日期（有 no-drop 类，表示过去的日期）
            if (span.classList.contains("ne-calendar-date-item-disabled")) continue;

            // 跳过非当前月份的日期（上月/下月的灰色日期）
            if (td.classList.contains("ne-calendar-date-item-different-month")) continue;
            console.log("🚀 ~ selectScheduledTime ~ td: ", td);

            const dayNum = parseInt(span.textContent, 10);
            console.log("🚀 ~ selectScheduledTime ~ dayNum: ", dayNum);
            if (dayNum === parseInt(day)) {
                span.click();
                dateSelected = true;
                console.log(`[网易号发布] ✅ 选择日期: ${year}-${month}-${day}`);
                break;
            }
        }

        if (!dateSelected) {
            console.error(`[网易号发布] ❌ 未能选择日期 ${day} 号`);
        }
        await delay(300);

        // 4. 设置时间 - 点击时间输入框打开下拉，然后选择小时和分钟
        const [hour, minute] = timePart.split(':');
        console.log(`[网易号发布] ⏰ 目标时间: ${hour}:${minute}`);

        // 点击时间输入框打开下拉面板
        const timeInput = modal.querySelector(".time-picker__item__value");
        if (timeInput) {
            timeInput.click();
            await delay(300);

            // 找到时间选择面板
            const timePanel = document.querySelector(".time-picker-tooltip");
            if (timePanel) {
                // 获取两个 ul：第一个是小时，第二个是分钟
                const ulList = timePanel.querySelectorAll("ul");
                console.log(`[网易号发布] ⏰ 找到 ${ulList.length} 个时间列表`);

                // 选择小时
                if (ulList[0]) {
                    const hourItems = ulList[0].querySelectorAll("li");
                    for (const li of hourItems) {
                        if (li.textContent.trim() === hour) {
                            li.click();
                            console.log(`[网易号发布] ✅ 选择小时: ${hour}`);
                            break;
                        }
                    }
                }
                await delay(200);

                // 选择分钟（分钟选项是每5分钟一档：00, 05, 10, 15...，需要找最接近的）
                if (ulList[1]) {
                    const minuteNum = parseInt(minute, 10);
                    // 向上取整到最近的5分钟（如 17 -> 20, 12 -> 15）
                    const roundedMinute = Math.ceil(minuteNum / 5) * 5;
                    // 如果超过55，则取55
                    const targetMinute = roundedMinute > 55 ? 55 : roundedMinute;
                    const targetMinuteStr = targetMinute.toString().padStart(2, '0');
                    console.log(`[网易号发布] ⏰ 原始分钟: ${minute}, 取整后: ${targetMinuteStr}`);

                    const minuteItems = ulList[1].querySelectorAll("li");
                    for (const li of minuteItems) {
                        if (li.textContent.trim() === targetMinuteStr) {
                            li.click();
                            console.log(`[网易号发布] ✅ 选择分钟: ${targetMinuteStr}`);
                            break;
                        }
                    }
                }
                await delay(200);

                // 点击时间面板的确定按钮
                const timeConfirmBtn = document.querySelector(".time-picker__footer__save");
                if (timeConfirmBtn) {
                    timeConfirmBtn.click();
                    console.log("[网易号发布] ✅ 点击时间确定按钮");
                }
            } else {
                console.warn("[网易号发布] ⚠️ 未找到时间选择面板");
            }
        } else {
            console.warn("[网易号发布] ⚠️ 未找到时间输入框");
        }
        await delay(200);

        // 5. 等待确定按钮出现
        const confirmDateBtns = modal.querySelectorAll(".regularRelease__content__footer div");
        let confirmDateBtn = null;
        for (const btn of confirmDateBtns) {
            if (btn.textContent.trim().includes("确认")) {
                confirmDateBtn = btn;
                break;
            }
        }

        console.log("🚀 ~ selectScheduledTime ~ confirmDateBtn: ", confirmDateBtn);
        if (!confirmDateBtn) {
            console.error("[网易号发布] ❌ 找不到确认按钮");
            return false;
        }
        confirmDateBtn.click();
        console.log("[网易号发布] ✅ 点击确认按钮");
        //return false;
        return true;
    } catch (error) {
        console.error("[网易号发布] ❌ selectScheduledTime 错误:", error);
        return false;
    }
}
