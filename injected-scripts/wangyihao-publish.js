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
                    let messageData;
                    try {
                        messageData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
                    } catch (parseError) {
                        console.error('[网易号发布] ❌ 解析消息数据失败:', parseError);
                        console.error('[网易号发布] 原始数据:', message.data);
                        return;
                    }

                    // 🔑 先检查 windowId 是否匹配（在保存数据之前！避免串数据）
                    if (message.windowId) {
                        const myWindowId = await window.browserAPI.getWindowId();
                        console.log('[网易号发布] 我的窗口 ID:', myWindowId, '消息目标窗口 ID:', message.windowId);
                        if (myWindowId !== message.windowId) {
                            console.log('[网易号发布] ⏭️ 消息不是发给我的，跳过（不保存数据）');
                            return;
                        }
                        console.log('[网易号发布] ✅ windowId 匹配，处理消息');
                    }

                    // 🔑 恢复会话数据（cookies、localStorage、sessionStorage、IndexedDB）
                    if (messageData.cookies) {
                        console.log('[网易号发布] 📦 检测到 cookies 数据，开始恢复会话...');
                        try {
                            const cookiesData = typeof messageData.cookies === 'string' ? messageData.cookies : JSON.stringify(messageData.cookies);
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

                // 清除已使用的数据，避免重复处理
                await window.browserAPI.removeGlobalData(`publish_data_window_${windowId}`);
                console.log('[网易号发布] 🗑️ 已清除 publish_data_window_' + windowId);

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
                await retryOperation(async () => {
                    // 有弹窗先关闭弹窗
                    const tipDialogEle = await waitForElement('.ne-modal-body', 5000, 1000);
                    if (tipDialogEle) {
                        const tipBtnEle = await waitForElement('.ne-button-color-primary', 5000, 1000, tipDialogEle);
                        tipBtnEle.click()
                    }
                }, 5, 1000)

                // 标题（带重试和验证）
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

                                // 📝 先处理标题：将所有 h2、h3 转换为 h5
                                const headingsInfo = [];
                                tempDiv.querySelectorAll('h2, h3').forEach(el => {
                                    const text = el.textContent.trim();
                                    headingsInfo.push({ text });

                                    // 将 h2、h3 都转换为 h5
                                    const h5 = document.createElement('h5');
                                    h5.textContent = text;
                                    el.replaceWith(h5);

                                    console.log(`[网易号发布] 📝 将 ${el.tagName} 转换为 H5`);
                                });

                                // 获取转换后的 HTML
                                htmlContent = tempDiv.innerHTML;
                                console.log('[网易号发布] 📋 发现标题数:', headingsInfo.length);
                                console.log('[网易号发布] 📄 已将所有 H2/H3 转换为 H5');

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

                                // 🎯 处理标题格式 - 获取标题按钮并点击
                                console.log('[网易号发布] 🔧 开始处理标题格式...');

                                // 获取标题按钮（第10个按钮 = 索引9）
                                const allPanelItems = document.querySelectorAll('.rich-editor-panel-item');
                                const titleButton = allPanelItems[9];

                                console.log('[网易号发布] 📌 标题按钮信息:');
                                console.log('  - 按钮元素:', titleButton);
                                console.log('  - 按钮 className:', titleButton?.className);
                                console.log('  - 按钮 disabled:', titleButton?.disabled);

                                if (!titleButton) {
                                    console.warn('[网易号发布] ⚠️ 找不到标题按钮');
                                } else {
                                    // 等待编辑器完全渲染
                                    await new Promise(r => setTimeout(r, 500));

                                    // 先让编辑器获得焦点
                                    editorEle.focus();
                                    await new Promise(r => setTimeout(r, 100));

                                    for (const info of headingsInfo) {
                                        try {
                                            // 在编辑器中查找该标题文本
                                            const allTextNodes = [];
                                            const walker = document.createTreeWalker(
                                                editorEle,
                                                NodeFilter.SHOW_TEXT,
                                                null,
                                                false
                                            );

                                            let node;
                                            while (node = walker.nextNode()) {
                                                allTextNodes.push(node);
                                            }

                                            console.log(`[网易号发布] 搜索标题文本: "${info.text.substring(0, 30)}..." (${allTextNodes.length} 个文本节点)`);

                                            // 逐个检查找到精确匹配的文本节点
                                            let found = false;
                                            for (const textNode of allTextNodes) {
                                                const nodeText = textNode.textContent.trim();
                                                if (nodeText === info.text) {
                                                    // 构建精确的 Range
                                                    const range = document.createRange();
                                                    range.selectNodeContents(textNode);

                                                    // 设置选中
                                                    const sel = window.getSelection();
                                                    sel.removeAllRanges();
                                                    sel.addRange(range);

                                                    console.log(`[网易号发布] 🎯 已选中标题文本：${info.text.substring(0, 40)}`);

                                                    // 🔴 关键：选中后立即点击，不要再做其他操作
                                                    // 点击 1 次：将正文转换为 H5
                                                    titleButton.click();
                                                    console.log(`[网易号发布] 📌 已点击标题按钮（正文 → H5）`);

                                                    // 点击完成后等待 Draft.js 处理
                                                    await new Promise(r => setTimeout(r, 500));

                                                    console.log(`[网易号发布] ✅ 标题已设置为 H5`);
                                                    found = true;
                                                    break;
                                                }
                                            }

                                            if (!found) {
                                                console.warn(`[网易号发布] ⚠️ 未找到标题文本：${info.text.substring(0, 40)}`);
                                            }
                                        } catch (e) {
                                            console.error(`[网易号发布] ❌ 处理标题失败：${e.message}`);
                                        }
                                    }

                                    console.log('[网易号发布] ✅ 标题格式处理完成');
                                }

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
                    let errorObserver = null;

                    // 启动错误监听
                    const startErrorListener = () => {
                        console.log('[网易号发布] 🔍 启动全局错误监听器...');

                        errorObserver = new MutationObserver((mutations) => {
                            for (const mutation of mutations) {
                                for (const node of mutation.addedNodes) {
                                    if (node.nodeType === 1) {
                                        const element = node;
                                        const classList = element.classList ? Array.from(element.classList).join(' ') : '';
                                        const textContent = element.textContent || '';

                                        // 1. 检测网易号的标准错误提示（cheetah-message）
                                        if (classList.includes('cheetah-message')) {
                                            const errorSpan = element.querySelector('.cheetah-message-error span:last-child') ||
                                                element.querySelector('.cheetah-message-custom-content span:last-child') ||
                                                element.querySelector('[class*="content"] span:last-child');
                                            if (errorSpan) {
                                                const text = (errorSpan.textContent || '').trim();
                                                if (text && !capturedErrors.includes(text)) {
                                                    capturedErrors.push(text);
                                                    console.log('[网易号发布] 📨 捕获到错误信息（标准消息框）:', text);
                                                }
                                            }
                                        }

                                        // 2. 检测所有 cheetah-message 类中的所有 span
                                        if (classList.includes('cheetah-message')) {
                                            const allSpans = element.querySelectorAll('span');
                                            for (const span of allSpans) {
                                                const spanText = (span.textContent || '').trim();
                                                // 过滤空白和纯图标文本
                                                if (spanText && spanText.length > 1 && !capturedErrors.includes(spanText) &&
                                                    !['✕', '✓', '!', '?', '×'].includes(spanText)) {
                                                    capturedErrors.push(spanText);
                                                    console.log('[网易号发布] 📨 捕获到错误信息（span）:', spanText);
                                                }
                                            }
                                        }

                                        // 3. 检测对话框中的错误信息（ne-modal）
                                        if (classList.includes('ne-modal') || classList.includes('modal')) {
                                            const dialogContent = element.querySelector('.custom-confirm-content') ||
                                                element.querySelector('[class*="content"]');
                                            if (dialogContent) {
                                                const dialogText = (dialogContent.textContent || '').trim();
                                                if (dialogText && dialogText.length > 1 && !capturedErrors.includes(dialogText)) {
                                                    capturedErrors.push(dialogText);
                                                    console.log('[网易号发布] 📨 捕获到对话框信息:', dialogText);
                                                }
                                            }
                                        }

                                        // 4. 递归检查所有子元素中的错误类
                                        const errorElements = element.querySelectorAll('[class*="error"], [class*="message"], [class*="warning"], [class*="alert"]');
                                        for (const el of errorElements) {
                                            const elText = (el.textContent || '').trim();
                                            if (elText && elText.length > 2 && !capturedErrors.includes(elText) &&
                                                el.children.length === 0) { // 只取最后一层文本
                                                capturedErrors.push(elText);
                                                console.log('[网易号发布] 📨 捕获到错误信息（其他容器）:', elText);
                                            }
                                        }
                                    }
                                }
                            }
                        });

                        errorObserver.observe(document.body, {
                            childList: true,
                            subtree: true
                        });

                        console.log('[网易号发布] ✅ 全局错误监听器已启动');
                    };

                    // 停止错误监听
                    const stopErrorListener = () => {
                        if (errorObserver) {
                            errorObserver.disconnect();
                            errorObserver = null;
                            console.log('[网易号发布] 🛑 全局错误监听器已停止');
                        }
                    };

                    // 获取最新的错误信息
                    const getLatestError = () => {
                        // 优先返回最后一条非中间状态的错误
                        // 🔑 过滤掉成功消息和中间状态消息
                        const ignoredMessages = ['正在上传', '加载中', '处理中', '成功', '发布成功', '提交成功', '上传成功'];
                        for (let i = capturedErrors.length - 1; i >= 0; i--) {
                            const msg = capturedErrors[i];
                            const isIgnored = ignoredMessages.some(ignored => msg.includes(ignored));
                            if (!isIgnored) {
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
                                const coverEle = await waitForElement('.cover-pic__single__content__choose > img');
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

                                        await retryOperation(async () => {
                                            // 有弹窗先关闭弹窗
                                            const tipDialogEle = await waitForElement('.ne-modal-body', 5000, 1000);
                                            console.log("🚀 ~  ~ tipDialogEle: ", tipDialogEle);
                                            if (tipDialogEle) {
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
                                                coverBtn.click();
                                            }

                                            const uploadListDialog = await waitForElement('.ne-modal-body', 5000, 1000);
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
                                }
                                await delay(1000); // 等待渲染完成

                                setTimeout(async () => {
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
                                                    return {type: 'error', message: errorMsg};
                                                }

                                                // 2. 再检查图片元素是否出现
                                                const imageEle = document.querySelector("[class*='-imglist'] [class*='-selectedItem']");
                                                console.log("🚀 ~ waitForImageOrError ~ imageEle: ", imageEle);
                                                if (imageEle) {
                                                    const imgEle = imageEle.querySelector('img');
                                                    if (imgEle && imgEle.getAttribute('src')) {
                                                        // 🔑 检测到图片元素后，再等待 500ms 确认是否有错误
                                                        // 因为 MutationObserver 是异步的，错误信息可能还在路上
                                                        console.log('[网易号发布] 🔍 检测到图片元素，等待 500ms 确认是否有错误...');
                                                        await delay(500);
                                                        const confirmError = getLatestError();
                                                        if (confirmError) {
                                                            console.log('[网易号发布] ⚠️ 确认期间检测到错误:', confirmError);
                                                            return {type: 'error', message: confirmError};
                                                        }
                                                        return {type: 'success', element: imageEle};
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
                                                return {type: 'error', message: finalError};
                                            }

                                            return {type: 'timeout'};
                                        };

                                        const result = await waitForImageOrError(10000);
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

                                            await delay(2000); // 等待渲染完成
                                            const publishBtns = document.querySelectorAll(".ne-button-color-primary");
                                            let publishBtn = null;
                                            for (let publishBtnEle of publishBtns) {
                                                if(publishBtnEle.textContent.trim() === '发布'){
                                                    publishBtn = publishBtnEle;
                                                    break;
                                                }
                                            }
                                            //  点击发布按钮
                                            if (publishBtn) {
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
                                                        await sendStatisticsError(publishIdForError, '发布按钮不可用，可能不符合发布要求', '网易号发布');
                                                    }
                                                    await closeWindowWithMessage('发布失败，刷新数据', 1000);
                                                    return;
                                                }
                                                // 🔑 在点击发布前保存 publishId，让 publish-success.js 可以调用统计接口
                                                const publishId = dataObj.video?.dyPlatform?.id;
                                                if (publishId) {
                                                    try {
                                                        localStorage.setItem(getPublishSuccessKey(), JSON.stringify({publishId: publishId}));
                                                        console.log('[网易号发布] 💾 已保存 publishId 到 localStorage:', publishId);
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
                                                console.log('[网易号发布] ✅ 已点击发布（模拟鼠标事件）');

                                                // 🔴 点击发布后，等待并检测是否有错误信息
                                                console.log('[网易号发布] ⏳ 等待 5 秒检测发布结果...');
                                                await delay(5000);

                                                // 检查是否有错误信息
                                                const publishErrorMsg = getLatestError();
                                                if (publishErrorMsg) {
                                                    console.log('[网易号发布] ❌ 检测到发布错误:', publishErrorMsg);
                                                    stopErrorListener();
                                                    const publishId = dataObj.video?.dyPlatform?.id;
                                                    if (publishId) {
                                                        console.log('[网易号发布] 📤 调用失败接口...');
                                                        await sendStatisticsError(publishId, publishErrorMsg, '网易号发布');
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
                                            console.log(`[网易号发布] [窗口${myWindowId}] 📋 当前捕获的所有错误:`, capturedErrors);
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
                                                console.log(`[网易号发布] 🔄 ${2}秒后重新上传图片...`);
                                                await delay(2000);

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
