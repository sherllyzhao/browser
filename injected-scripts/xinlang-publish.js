/**
 * 新浪创作者平台发布脚本
 * 用于处理发布流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
    "use strict";

    // ===========================
    // 防止脚本重复注入
    // ===========================
    if (window.__XL_SCRIPT_LOADED__) {
        console.log("[新浪发布] ⚠️ 脚本已经加载过，跳过重复注入");
        return;
    }

    // ===========================
    // 页面状态检查 - 防止异常渲染
    // ===========================
    // 🔴 新浪跳过此检测：富文本编辑器支持写代码，容易误报
    // if (typeof window.checkPageStateAndReload === "function") {
    //     if (!window.checkPageStateAndReload("新浪发布")) {
    //         return;
    //     }
    // }

    window.__XL_SCRIPT_LOADED__ = true;

    // 变量声明（放在防重复检查之后）
    let fillFormRunning = false; // 标记 fillFormData 是否正在执行

    // 防重复标志：确保数据只处理一次
    let isProcessing = false;
    let hasProcessed = false;

    // 简介填写标志：防止重复填写
    let introFilled = false;

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
        if (typeof createErrorListener === "function" && ERROR_LISTENER_CONFIGS?.tengxun) {
            errorListener = createErrorListener(ERROR_LISTENER_CONFIGS.tengxun);
            console.log("[新浪发布] ✅ 使用公共错误监听器配置");
        } else {
            // 回退方案：使用本地配置
            errorListener = createErrorListener({
                logPrefix: "[新浪发布]",
                selectors: [{ containerClass: "omui-message", textSelector: ".omui-message__desc", recursiveSelector: ".omui-message" }],
            });
            console.log("[新浪发布] ⚠️ 使用本地错误监听器配置");
        }
    };

    // 兼容旧代码的函数别名
    const startErrorListener = () => {
        if (!errorListener) initErrorListener();
        errorListener.start();
    };
    const stopErrorListener = () => errorListener?.stop();
    const getLatestError = () => errorListener?.getLatestError() || null;

    // 获取窗口专属的发布成功数据 key
    const getPublishSuccessKey = () => {
        const key = `PUBLISH_SUCCESS_DATA_${currentWindowId || "default"}`;
        console.log("[新浪发布] 🔑 使用 localStorage key:", key);
        return key;
    };

    console.log("═══════════════════════════════════════");
    console.log("✅ 新浪发布脚本已注入");
    console.log("📍 当前 URL:", window.location.href);
    console.log("🕐 注入时间:", new Date().toLocaleString());
    console.log("═══════════════════════════════════════");

    // 检查 common.js 是否已加载
    if (typeof waitForElement === "undefined" || typeof retryOperation === "undefined") {
        console.error("[新浪发布] ❌ common.js 未加载！脚本可能无法正常工作");
    } else {
        console.log("[新浪发布] ✅ common.js 已加载，工具函数可用");
    }

    // ===========================
    // 🔴 重要：先注册消息监听器，再执行任何 await 操作！
    // 否则消息可能在 await 期间到达，但回调还没注册
    // ===========================
    console.log("[新浪发布] 注册消息监听器...");

    if (!window.browserAPI) {
        console.error("[新浪发布] ❌ browserAPI 不可用！");
    } else {
        console.log("[新浪发布] ✅ browserAPI 可用");

        if (!window.browserAPI.onMessageFromHome) {
            console.error("[新浪发布] ❌ browserAPI.onMessageFromHome 不可用！");
        } else {
            console.log("[新浪发布] ✅ browserAPI.onMessageFromHome 可用，正在注册...");

            window.browserAPI.onMessageFromHome(async message => {
                console.log("═══════════════════════════════════════");
                console.log("[新浪发布] 🎉 收到来自父窗口的消息!");
                console.log("[新浪发布] 消息类型:", typeof message);
                console.log("[新浪发布] 消息内容:", message);
                console.log("[新浪发布] 消息.type:", message?.type);
                console.log("[新浪发布] 消息.windowId:", message?.windowId);
                console.log("═══════════════════════════════════════");

                // 接收完整的发布数据（直接传递，不使用 IndexedDB）
                // 兼容 publish-data 和 auth-data 两种消息类型
                if (message.type === "publish-data") {
                    // 使用公共方法解析消息数据
                    const messageData = parseMessageData(message.data, "[新浪发布]");
                    if (!messageData) return;

                    // 使用公共方法检查 windowId 是否匹配
                    const isMatch = await checkWindowIdMatch(message, "[新浪发布]");
                    if (!isMatch) return;

                    // 使用公共方法恢复会话数据
                    const needReload = await restoreSessionAndReload(messageData, "[新浪发布]");
                    if (needReload) return; // 已触发刷新，脚本会重新注入

                    // windowId 匹配后才保存消息数据
                    receivedMessageData = messageData;
                    console.log("[新浪发布] 💾 已保存收到的消息数据到 receivedMessageData");

                    console.log("[新浪发布] ✅ 收到发布数据:", messageData);

                    // 防重复检查
                    if (isProcessing) {
                        console.warn("[新浪发布] ⚠️ 正在处理中，忽略重复消息");
                        return;
                    }
                    if (hasProcessed) {
                        console.warn("[新浪发布] ⚠️ 已经处理过，忽略重复消息");
                        return;
                    }

                    // 标记为正在处理
                    isProcessing = true;

                    // 更新全局变量
                    if (messageData) {
                        window.__AUTH_DATA__ = {
                            ...window.__AUTH_DATA__,
                            message: messageData,
                            receivedAt: Date.now(),
                        };
                        console.log("[新浪发布] ✅ 发布数据已更新:", window.__AUTH_DATA__);
                        console.log("🚀 ~  ~ messageData: ", messageData);

                        try {
                            await retryOperation(async () => await fillFormData(messageData), 3, 2000);
                        } catch (e) {
                            console.log("[新浪发布] ❌ 填写表单数据失败:", e);
                        }

                        console.log("[新浪发布] 📤 准备发送数据到接口...");
                        console.log("[新浪发布] ✅ 发布流程已启动，等待 publishApi 完成...");
                    }

                    // 重置处理标志（无论成功或失败）
                    isProcessing = false;
                    console.log("[新浪发布] 处理完成，isProcessing=false, hasProcessed=", hasProcessed);
                }
            });

            console.log("[新浪发布] ✅ 消息监听器注册成功");
        }
    }

    // ===========================
    // 1. 从 URL 获取发布数据（在消息监听器注册之后）
    // ===========================

    const urlParams = new URLSearchParams(window.location.search);
    const companyId = await window.browserAPI.getGlobalData("company_id");
    const transferId = urlParams.get("transfer_id");

    // 获取当前窗口 ID（用于窗口专属的 localStorage key）
    try {
        currentWindowId = await window.browserAPI.getWindowId();
        console.log("[新浪发布] 当前窗口 ID:", currentWindowId);
    } catch (e) {
        console.error("[新浪发布] ❌ 获取窗口 ID 失败:", e);
    }

    console.log("[新浪发布] URL 参数:", {
        companyId,
        transferId,
        windowId: currentWindowId,
    });

    // 存储发布数据到全局
    window.__AUTH_DATA__ = {
        companyId,
        transferId,
        timestamp: Date.now(),
    };

    // ===========================
    // 2. 暴露全局方法供手动调用
    // ===========================

    window.__XL_AUTH__ = {
        // 发送发布成功消息
        notifySuccess: () => {
            sendMessageToParent("发布成功");
        },
    };

    // ===========================
    // 3. 显示调试信息横幅
    // ===========================

    // ===========================
    // 4. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
    // ===========================

    // 页面加载完成后向父窗口发送消息
    console.log("[新浪发布] 页面加载完成，发送 页面加载完成 消息");
    sendMessageToParent("页面加载完成");

    console.log("═══════════════════════════════════════");
    console.log("✅ 新浪发布脚本初始化完成");
    console.log("📝 全局方法: window.__XL_AUTH__");
    console.log("  - notifySuccess()  : 发送发布成功消息");
    console.log("  - sendMessage(msg) : 发送自定义消息");
    console.log("  - getAuthData()    : 获取发布数据");
    console.log("═══════════════════════════════════════");

    // ===========================
    // 7. 检查是否是恢复 cookies 后的刷新（立即执行）
    // ===========================
    await (async () => {
        // 如果已经在处理或已处理完成，跳过
        if (isProcessing || hasProcessed) {
            console.log("[新浪发布] ⏭️ 已在处理中或已完成，跳过全局存储读取");
            return;
        }

        try {
            // 获取当前窗口 ID
            const windowId = await window.browserAPI.getWindowId();
            console.log("[新浪发布] 检查全局存储，窗口 ID:", windowId);

            if (!windowId) {
                console.log("[新浪发布] ❌ 无法获取窗口 ID");
                return;
            }

            // 检查是否有恢复 cookies 后保存的发布数据
            const publishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
            console.log("[新浪发布] 📦 从全局存储读取 publish_data_window_" + windowId + ":", publishData ? "有数据" : "无数据");

            if (publishData && !isProcessing && !hasProcessed) {
                console.log("[新浪发布] ✅ 检测到恢复 cookies 后的数据，开始处理...");

                // 清除已使用的数据，避免重复处理
                await window.browserAPI.removeGlobalData(`publish_data_window_${windowId}`);
                console.log("[新浪发布] 🗑️ 已清除 publish_data_window_" + windowId);

                // 标记为正在处理
                isProcessing = true;

                // 更新全局变量
                window.__AUTH_DATA__ = {
                    ...window.__AUTH_DATA__,
                    message: publishData,
                    source: "cookieRestore",
                    windowId: windowId,
                    receivedAt: Date.now(),
                };

                try {
                    await retryOperation(async () => await fillFormData(publishData), 3, 2000);
                } catch (e) {
                    console.log("[新浪发布] ❌ 填写表单数据失败:", e);
                }

                console.log("[新浪发布] 📤 准备发送数据到接口...");
                console.log("[新浪发布] ✅ 发布流程已启动，等待 publishApi 完成...");

                isProcessing = false;
            }
        } catch (error) {
            console.error("[新浪发布] ❌ 从全局存储读取数据失败:", error);
        }
    })();

    // ===========================
    // 7. 从全局存储读取发布数据（备用方案，不依赖消息）
    // ===========================

    // ===========================
    // 8. 检查是否有保存的发布数据（授权跳转恢复）
    // ===========================

    // ===========================
    // 9. 发布视频到新浪（移到 IIFE 内部以访问变量）
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
            // 🔴 等待 URL 稳定（新浪可能会自动跳转）
            console.log("[新浪发布] ⏳ 等待页面 URL 稳定...");
            let lastUrl = window.location.href;
            let stableCount = 0;
            const maxWait = 5000; // 最多等待 5 秒
            const startTime = Date.now();

            while (stableCount < 3 && Date.now() - startTime < maxWait) {
                await new Promise(r => setTimeout(r, 500));
                if (window.location.href === lastUrl) {
                    stableCount++;
                } else {
                    lastUrl = window.location.href;
                    stableCount = 0;
                    console.log("[新浪发布] 🔄 URL 变化:", lastUrl);
                }
            }
            console.log("[新浪发布] ✅ URL 已稳定:", window.location.href);

            // 🔴 如果是草稿详情页（#/draft/xxx），点击"写文章"按钮创建新文章
            const currentHash = window.location.hash;
            if (currentHash.match(/#\/draft\/\d+/)) {
                console.log("[新浪发布] 📝 检测到草稿详情页，尝试点击写文章按钮...");

                // 🔑 先把数据保存到 globalData，防止跳转后丢失
                if (currentWindowId && dataObj) {
                    try {
                        await window.browserAPI.setGlobalData(`xinlang_publish_data_${currentWindowId}`, dataObj);
                        console.log("[新浪发布] 💾 已备份发布数据到 globalData");
                    } catch (e) {
                        console.log("[新浪发布] ⚠️ 备份数据失败:", e);
                    }
                }

                // 查找"写文章"按钮
                const writeBtn = await waitForElement('.n-button--primary-type', 5000);
                if (writeBtn && writeBtn.textContent.includes('写文章')) {
                    console.log("[新浪发布] ✅ 找到写文章按钮，点击...");
                    writeBtn.click();

                    // 等待跳转到新文章页面（延长到 3 秒）
                    await new Promise(r => setTimeout(r, 3000));
                    console.log("[新浪发布] ✅ 已跳转到新文章页面:", window.location.href);
                } else {
                    // 尝试其他方式找按钮
                    const allButtons = document.querySelectorAll('button');
                    for (const btn of allButtons) {
                        if (btn.textContent.trim() === '写文章') {
                            console.log("[新浪发布] ✅ 找到写文章按钮（遍历），点击...");
                            btn.click();
                            await new Promise(r => setTimeout(r, 3000));
                            break;
                        }
                    }
                }

                // 🔑 如果 dataObj 丢失，从 globalData 恢复
                if (!dataObj && currentWindowId) {
                    try {
                        dataObj = await window.browserAPI.getGlobalData(`xinlang_publish_data_${currentWindowId}`);
                        if (dataObj) {
                            console.log("[新浪发布] 📦 从 globalData 恢复发布数据");
                        }
                    } catch (e) {
                        console.log("[新浪发布] ⚠️ 恢复数据失败:", e);
                    }
                }
            }

            const pathImage = dataObj?.video?.video?.cover;
            if (!pathImage) {
                // alert('No cover image found');
                fillFormRunning = false;
                return;
            }

            setTimeout(async () => {
                // 标题（带重试和验证）
                await retryOperation(async () => {
                    const titleEles = await waitForElements(".n-input__textarea-el", 5000);
                    if(titleEles.length > 0){
                        // 找到titleEles中placeholder包括标题的元素
                        for (const titleEle of titleEles) {
                            if (titleEle.placeholder.includes("标题")) {
                                try{
                                    // 先触发focus事件
                                    if (typeof titleEle.focus === 'function') {
                                        titleEle.focus();
                                    } else {
                                        titleEle.dispatchEvent(new Event('focus', { bubbles: true }));
                                    }

                                    // 延迟执行，让React状态稳定
                                    await new Promise(resolve => setTimeout(resolve, 300));

                                    const targetTitle = dataObj.video.video.title || '';
                                    setNativeValue(titleEle, targetTitle);

                                    // 额外触发input事件
                                    titleEle.dispatchEvent(new Event('input', { bubbles: true }));

                                    // 等待 React 更新
                                    await new Promise(resolve => setTimeout(resolve, 200));

                                    // 🔑 验证是否成功设置
                                    const currentValue = (titleEle.value || '').trim();
                                    const expectedValue = targetTitle.trim();
                                    if (currentValue !== expectedValue) {
                                        throw new Error(`标题设置失败: 期望"${expectedValue}", 实际"${currentValue}"`);
                                    }

                                    console.log('[新浪发布] ✅ 标题设置成功:', currentValue);
                                }catch (e) {
                                    console.log("[新浪发布] ❌ 设置标题失败:", e);
                                }
                            } else if(titleEle.placeholder.includes("导语")){
                                //设置简介（带重试）
                                try {
                                    // 首先检查是否已经填写过（通过全局标记）
                                    if (introFilled) {
                                        console.log('[新浪发布] 简介已填写过，跳过');
                                        return; // 跳过重试
                                    }

                                    console.log('[新浪发布] 开始填写简介...');
                                    const introEle = titleEle;
                                    console.log('[新浪发布] 简介输入框元素:', introEle);

                                    const targetIntro = dataObj.video.video.intro || '';
                                    const targetContent = targetIntro.trim();
                                    console.log('[新浪发布] 目标简介内容:', targetContent);

                                    // 检查实际内容
                                    const currentContent = (introEle?.value || '').trim();
                                    console.log('[新浪发布] 当前简介内容:', currentContent);

                                    // 只有在标记未设置且内容不同时才填写
                                    if (introEle && currentContent !== targetContent) {
                                        // 立即标记为已填写（在任何操作之前，防止并发）
                                        introFilled = true;
                                        console.log('[新浪发布] 正在填写简介...');

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

                                        console.log('[新浪发布] ✅ 简介填写完成');
                                    } else if (!introEle) {
                                        throw new Error('简介输入框元素为空');
                                    } else {
                                        // 内容已经正确，也标记为已填写
                                        introFilled = true;
                                        console.log('[新浪发布] 简介内容已正确，无需修改');
                                    }
                                } catch (error) {
                                    console.log('[新浪发布] ❌ 简介填写失败:', error.message);
                                }
                            }
                        }
                    }
                }, 5, 1000);

                try {
                    // 内容（带重试）
                    setTimeout(async () => {
                        try {
                            await retryOperation(async () => {
                                const editorEle = await waitForElement(".wb-editor", 10000);
                                let htmlContent = dataObj.video.video.content;

                                // 解析 HTML 中的图片，通过新浪 dumpproxy 接口上传
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
                                console.log('[新浪发布] 🧹 已清理开头所有空白内容');

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

                                console.log('[新浪发布] ✅ 内容填写完成');
                            }, 3, 1000);
                        } catch (e) {
                            console.log('[新浪发布] ❌ 内容填写失败:', e.message);
                        }
                    }, 200);
                } catch (e) {
                    console.log('[新浪发布] ❌ 内容填写失败:', e.message)
                }

                // 🔴 启动全局错误监听器（已在 IIFE 顶层定义）
                startErrorListener();

                // 设置封面（使用主进程下载绕过跨域）
                await (async () => {
                    try {
                        const { blob, contentType } = await downloadFile(pathImage, "image/png");
                        var file = new File([blob], dataObj?.video?.formData?.title + ".png", { type: contentType || "image/png" });
                        // 选中本地上传（点击"选择封面"按钮）
                        await delay(1000);

                        // 等待封面选择区域出现
                        const coverPreview = document.querySelector(".cover-preview");
                        await delay(500); // 等待渲染完成
                        try{
                            if(coverPreview){
                                // 查找并点击"替换封面图"按钮
                                const coverBtns = document.querySelectorAll(".cover-preview span");
                                console.log("🚀 ~  ~ coverBtns: ", coverBtns);
                                if(!coverBtns || coverBtns.length === 0){
                                    throw new Error('[新浪发布]：找不到替换封面按钮');
                                }
                                let coverChangeBtn = null;
                                for (let coverBtn of coverBtns) {
                                    const coverBtnText = coverBtn.textContent.trim();
                                    if(coverBtnText.includes("替换封面图")){
                                        coverChangeBtn = coverBtn;
                                    }
                                }
                                console.log("🚀 ~  ~ coverChangeBtn: ", coverChangeBtn);
                                if(!coverChangeBtn) {
                                    throw new Error('[新浪发布]：找不到替换封面按钮');
                                }
                                coverChangeBtn.click();

                            }else{
                                const uploadBtn = document.querySelector(".cover-empty");
                                if(!uploadBtn){
                                    throw new Error('[新浪发布]：找不到封面按钮');
                                }
                                uploadBtn.click();
                            }
                        } catch (e){
                            const uploadBtn = document.querySelector(".cover-empty");
                            if(!uploadBtn){
                                throw new Error('[新浪发布]：找不到封面按钮');
                            }
                            uploadBtn.click();
                        }
                        await delay(1000); // 等待渲染完成

                        // 检测上传封面弹窗
                        const uploadModal = document.querySelector(".n-dialog");
                        console.log("🚀 ~  ~ uploadModal: ", uploadModal);
                        if (!uploadModal) {
                            throw new Error('[新浪发布]：未找到发布弹窗')
                        }
                        //    选择本地上传
                        const tabs = uploadModal.querySelectorAll(".n-tabs-tab__label");
                        if(tabs && tabs.length > 0){
                            for (let tab of tabs) {
                                if (tab.textContent.includes("图片库")) {
                                    tab.click();
                                    await delay(1000);
                                    // 检测是否已经有封面图
                                    const coverImages = uploadModal.querySelectorAll(".image-list .image-item");
                                    if(coverImages && coverImages.length > 0){
                                        // 删除掉封面图
                                        coverImages.forEach((image) => {
                                            image.querySelector(".ico_delpic").click();
                                        })
                                        await delay(1000);
                                    }

                                    // 上传图片
                                    const input = uploadModal.querySelector("input[type='file']");
                                    console.log("🚀 ~  ~ input: ", input);
                                    const dataTransfer = new DataTransfer();
                                    // 创建 DataTransfer 对象模拟文件上传
                                    dataTransfer.items.add(file);
                                    input.files = dataTransfer.files;
                                    const event = new Event("change", { bubbles: true });
                                    input.dispatchEvent(event);
                                    await delay(1000);

                                    // 选中第一项
                                    const firstImg = await waitForElement('.image-list .image-item:nth-of-type(1)', 30000, 1000, uploadModal);
                                    console.log("🚀 ~  ~ firstImg: ", firstImg);
                                    if(firstImg){
                                        firstImg.click();
                                    }

                                    // 点击确定
                                    await delay(1000);
                                    const confirmBtns = uploadModal.querySelectorAll(".n-button--primary-type");
                                    console.log("🚀 ~  ~ confirmBtns: ", confirmBtns);
                                    let confirmBtn = null;
                                    for (let confirmBtn1 of confirmBtns) {
                                        if (confirmBtn1.textContent.trim() === '下一步'){
                                            confirmBtn = confirmBtn1;
                                        }
                                    }
                                    if(!confirmBtn){
                                        throw Error('[新浪发布]：找不到图片上传按钮');
                                    }
                                    confirmBtn.click();

                                    // 🔴 等待 loading 消失（图片上传可能很慢）
                                    console.log("[新浪发布] ⏳ 等待图片上传完成...");
                                    const maxLoadingWait = 60000; // 最多等待 60 秒
                                    const loadingStartTime = Date.now();
                                    while (Date.now() - loadingStartTime < maxLoadingWait) {
                                        const loadingEl = document.querySelector(".n-base-loading__container");
                                        if (!loadingEl) {
                                            console.log("[新浪发布] ✅ 图片上传完成（loading 消失）");
                                            break;
                                        }
                                        console.log("[新浪发布] ⏳ 图片上传中...");
                                        await delay(500);
                                    }
                                    await delay(1000); // 额外等待 1 秒确保弹窗渲染

                                    // 图片裁剪弹窗
                                    const coverCutDialogEle = document.querySelector(".n-dialog");
                                    if(!coverCutDialogEle){
                                        throw Error('[新浪发布]：找不到图片裁剪弹窗');
                                    }
                                    const coverCutTitle = coverCutDialogEle.querySelector('.n-card-header__main');
                                    if(!coverCutTitle){
                                        throw Error('[新浪发布]：找不到图片裁剪弹窗标题');
                                    }
                                    if(coverCutTitle.textContent.trim() === '图片裁剪'){
                                        const confirmCutBtn = coverCutDialogEle.querySelector(".n-button--primary-type");
                                        if(!confirmCutBtn){
                                            throw Error('[新浪发布]：找不到图片裁剪弹窗确认按钮');
                                        }
                                        confirmCutBtn.click();
                                    }

                                    await delay(1000);

                                    // 封装上传检测与重试逻辑
                                    const tryUploadImage = async (retryCount = 0) => {
                                        const maxRetries = 3;

                                        // 🔴 自定义等待逻辑：同时检查弹窗状态、封面图和错误信息
                                        const waitForImageOrError = async (timeout = 15000) => {
                                            const startTime = Date.now();
                                            const checkInterval = 300; // 每300ms检查一次

                                            while (Date.now() - startTime < timeout) {
                                                // 1. 先检查是否有错误信息（优先级最高）
                                                const errorMsg = getLatestError();
                                                if (errorMsg) {
                                                    return { type: "error", message: errorMsg };
                                                }

                                                // 2. 检查弹窗状态
                                                const modal = document.querySelector(".n-dialog");
                                                const modalVisible = modal && modal.offsetParent !== null;

                                                // 3. 检查封面预览区域是否有图片
                                                const coverPreview = document.querySelector(".cover-preview");
                                                const coverImg = coverPreview?.querySelector(".cover-img");
                                                const hasCoverImage = coverImg && coverImg.getAttribute("src");

                                                console.log(`[新浪发布] 🔍 检测状态: 弹窗=${modalVisible ? '存在' : '已关闭'}, 封面图=${hasCoverImage ? '有' : '无'}`);

                                                // 4. 判断结果
                                                if (!modalVisible && hasCoverImage) {
                                                    // 弹窗关闭 + 封面图出现 = 成功
                                                    console.log("[新浪发布] 🔍 弹窗已关闭且检测到封面图片，等待 500ms 确认...");
                                                    await delay(500);
                                                    const confirmError = getLatestError();
                                                    if (confirmError) {
                                                        console.log("[新浪发布] ⚠️ 确认期间检测到错误:", confirmError);
                                                        return { type: "error", message: confirmError };
                                                    }
                                                    return { type: "success", element: coverPreview };
                                                }

                                                if (modalVisible) {
                                                    // 弹窗还在，检查弹窗内是否有错误提示
                                                    const modalError = modal.querySelector(".n-message--error, .error-message, .n-form-item-feedback--error");
                                                    if (modalError && modalError.textContent.trim()) {
                                                        return { type: "error", message: modalError.textContent.trim() };
                                                    }
                                                    // 弹窗还在，继续等待（可能还在上传中）
                                                }

                                                // 等待下一次检查
                                                await delay(checkInterval);
                                            }

                                            // 超时，再检查一次状态
                                            const finalError = getLatestError();
                                            if (finalError) {
                                                return { type: "error", message: finalError };
                                            }

                                            // 检查弹窗是否还在
                                            const finalModal = document.querySelector(".n-dialog");
                                            if (finalModal && finalModal.offsetParent !== null) {
                                                return { type: "timeout", reason: "modal_still_open" };
                                            }

                                            return { type: "timeout", reason: "no_cover_image" };
                                        };

                                        const result = await waitForImageOrError(15000);
                                        const myWindowId = await window.browserAPI.getWindowId();

                                        // 🔴 检测到错误信息，直接上报失败
                                        if (result.type === "error") {
                                            console.log(`[新浪发布] [窗口${myWindowId}] ❌ 检测到错误信息，直接上报失败: ${result.message}`);
                                            stopErrorListener();
                                            const publishId = dataObj.video?.dyPlatform?.id;
                                            if (publishId) {
                                                await sendStatisticsError(publishId, result.message, "新浪发布");
                                            }
                                            await closeWindowWithMessage("发布失败，刷新数据", 1000);
                                            return; // 不再继续
                                        }

                                        if (result.type === "success") {
                                            console.log("[新浪发布] ✅ 封面图片上传成功");

                                            await delay(2000); // 等待渲染完成

                                            const publishTime = dataObj.video.formData.send_set;
                                            console.log("🚀 ~ tryUploadImage ~ publishTime: ", publishTime);

                                            // 找发布按钮
                                            const publishBtns = document.querySelectorAll(".common-footer .footer-item button");
                                            console.log("🚀 ~ tryUploadImage ~ publishBtns: ", publishBtns);
                                            let publishBtn = null;
                                            if (publishBtns.length > 0) {
                                                publishBtns.forEach(btn => {
                                                    if (btn.textContent.trim() === "下一步") {
                                                        publishBtn = btn;
                                                    }
                                                });
                                            }
                                            if (publishBtn) {
                                                console.log("🚀 ~ tryUploadImage ~ publishBtn: ", publishBtn);
                                                // 🔑 检查发布按钮是否 disabled
                                                if (publishBtn.disabled || publishBtn.getAttribute("disabled") !== null) {
                                                    console.error("[新浪发布] ❌ 发布按钮不可用(disabled)");
                                                    stopErrorListener();
                                                    const publishIdForError = dataObj.video?.dyPlatform?.id;
                                                    if (publishIdForError) {
                                                        await sendStatisticsError(publishIdForError, "发布按钮不可用，可能不符合发布要求", "新浪发布");
                                                    }
                                                    await closeWindowWithMessage("发布失败，刷新数据", 1000);
                                                    return;
                                                }

                                                // 🔑 在点击发布前保存 publishId，让首页可以调用统计接口
                                                const publishId = dataObj.video?.dyPlatform?.id;
                                                if (publishId) {
                                                    try {
                                                        // 同时设置全局变量和 localStorage，确保标志能被检测到
                                                        window.__xinlangPublishSuccessFlag = true;
                                                        window.__xinlangPublishId = publishId; // 供 selectScheduledTime 使用
                                                        localStorage.setItem(getPublishSuccessKey(), JSON.stringify({ publishId: publishId }));
                                                        console.log("[新浪发布] 💾 已保存 publishId（全局变量 + localStorage）:", publishId);

                                                        // 🔑 同时保存到 globalData（更可靠，不受域名隔离限制）
                                                        if (window.browserAPI && window.browserAPI.setGlobalData) {
                                                            await window.browserAPI.setGlobalData(`PUBLISH_SUCCESS_DATA_${currentWindowId}`, {publishId: publishId});
                                                            console.log('[新浪发布] 💾 已保存 publishId 到 globalData');
                                                        }
                                                    } catch (e) {
                                                        console.error("[新浪发布] ❌ 保存 publishId 失败:", e);
                                                    }
                                                } else {
                                                    // 即使没有 publishId，也要设置全局变量允许跳转
                                                    window.__xinlangPublishSuccessFlag = true;
                                                    console.log("[新浪发布] ℹ️ 没有 publishId，但已设置跳转标志");
                                                }

                                                const clickEvent = new MouseEvent("click", {
                                                    view: window,
                                                    bubbles: true,
                                                    cancelable: true,
                                                });
                                                publishBtn.dispatchEvent(clickEvent);
                                                console.log("[新浪发布] ✅ 已点击发布（模拟鼠标事件）");
                                                await delay(1000);

                                            //    发布弹窗
                                                const publishDialogEle = document.querySelector('.n-dialog');
                                                if(!publishDialogEle){
                                                    throw new Error('[新浪发布]：找不到发布弹窗');
                                                }
                                                const publishBtnArea = publishDialogEle.querySelector('.n-mention + div .items-center:nth-of-type(2)');
                                                if(!publishBtnArea){
                                                    throw new Error('[新浪发布]：找不到发布按钮操作区');
                                                }
                                                const publishTime = dataObj.video.formData.send_set;
                                                if(+publishTime === 2){
                                                    const timedReleaseButton = publishBtnArea.querySelector('.svg-icon');
                                                    if(!timedReleaseButton){
                                                        throw new Error('[新浪发布]：找不到定时发布按钮');
                                                    }
                                                    const clickEvent = new MouseEvent("click", {
                                                        view: window,
                                                        bubbles: true,
                                                        cancelable: true,
                                                    });
                                                    timedReleaseButton.dispatchEvent(clickEvent);
                                                    console.log("[新浪发布] ✅ 已点击定时发布");

                                                    const sendTime = dataObj.video?.formData?.send_time;
                                                    if (!sendTime) {
                                                        console.error("[新浪发布] ❌ 解析定时时间失败");
                                                        stopErrorListener();
                                                        await closeWindowWithMessage("定时时间解析失败", 1000);
                                                        return;
                                                    }

                                                    console.log("[新浪发布] ⏰ 开始选择定时发布时间:", sendTime)

                                                    // 调用选择时间函数
                                                    const timeSelectSuccess = await selectScheduledTime(sendTime);

                                                    if (!timeSelectSuccess) {
                                                        console.error("[新浪发布] ❌ 时间选择失败");
                                                        stopErrorListener();
                                                        await closeWindowWithMessage("定时时间选择失败", 1000);
                                                        return;
                                                    }
                                                }else{
                                                    const publishButtons = publishBtnArea.querySelectorAll('button');
                                                    let publishButton = null;
                                                    for (let publishButton1 of publishButtons) {
                                                        if (publishButton1.textContent.trim() === '发布'){
                                                            publishButton = publishButton1;
                                                        }
                                                    }
                                                    if(!publishButton){
                                                        throw new Error('[新浪发布]：找不到发布按钮');
                                                    }

                                                    const clickEvent = new MouseEvent("click", {
                                                        view: window,
                                                        bubbles: true,
                                                        cancelable: true,
                                                    });
                                                    publishButton.dispatchEvent(clickEvent);
                                                    console.log("[新浪发布] ✅ 已点击即时发布");

                                                    // 🔑 即时发布成功后直接上报并关闭窗口，不等页面跳转
                                                    await delay(1000);
                                                    console.log("[新浪发布] 📤 即时发布提交成功，准备上报统计...");

                                                    // 获取 publishId 并上报成功
                                                    const publishIdForInstant = window.__xinlangPublishId ||
                                                        (await window.browserAPI?.getGlobalData?.(`PUBLISH_SUCCESS_DATA_${currentWindowId}`))?.publishId;

                                                    if (publishIdForInstant) {
                                                        try {
                                                            const successUrl = await getStatisticsUrl();
                                                            const scanData = { data: JSON.stringify({ id: publishIdForInstant }) };
                                                            await fetch(successUrl, {
                                                                method: "POST",
                                                                headers: { "Content-Type": "application/json" },
                                                                body: JSON.stringify(scanData),
                                                            });
                                                            console.log("[新浪发布] ✅ 即时发布统计上报成功");
                                                        } catch (e) {
                                                            console.error("[新浪发布] ❌ 统计上报失败:", e);
                                                        }
                                                    }

                                                    // 清除保存的标记（避免 publish-success.js 重复处理）
                                                    try {
                                                        if (currentWindowId) {
                                                            localStorage.removeItem(`PUBLISH_SUCCESS_DATA_${currentWindowId}`);
                                                            await window.browserAPI?.removeGlobalData?.(`PUBLISH_SUCCESS_DATA_${currentWindowId}`);
                                                            console.log("[新浪发布] 🗑️ 已清除发布标记");
                                                        }
                                                    } catch (e) {
                                                        // 忽略清除失败
                                                    }

                                                    // 关闭窗口
                                                    stopErrorListener();
                                                    await closeWindowWithMessage("发布成功，刷新数据", 1000);
                                                }
                                            } else {
                                                console.error("[新浪发布] ❌ 找不到发布按钮，上报失败");
                                                stopErrorListener();
                                                const publishId = dataObj.video?.dyPlatform?.id;
                                                if (publishId) {
                                                    await sendStatisticsError(publishId, "发布按钮不可用", "新浪发布");
                                                }
                                                await closeWindowWithMessage("发布失败，刷新数据", 1000);
                                            }
                                        } else {
                                            // 图片上传失败（timeout），检查是否有错误信息
                                            const timeoutReason = result.reason === "modal_still_open" ? "弹窗未关闭" : "封面图未出现";
                                            console.log(`[新浪发布] [窗口${myWindowId}] ❌ 封面上传超时(${timeoutReason})，重试次数: ${retryCount}/${maxRetries}`);

                                            // 优先使用全局错误监听器捕获的错误
                                            const errorMessage = getLatestError();
                                            console.log(`[新浪发布] [窗口${myWindowId}] 📨 最新错误信息:`, errorMessage);

                                            // 🔴 有错误信息就直接走失败接口，不再重试
                                            if (errorMessage) {
                                                console.log(`[新浪发布] [窗口${myWindowId}] ❌ 检测到错误信息，直接上报失败，不再重试`);
                                                stopErrorListener();
                                                const publishId = dataObj.video?.dyPlatform?.id;
                                                if (publishId) {
                                                    await sendStatisticsError(publishId, errorMessage, "新浪发布");
                                                } else {
                                                    console.error(`[新浪发布] [窗口${myWindowId}] ❌ publishId 为空，无法调用失败接口！`);
                                                }
                                                await closeWindowWithMessage("发布失败，刷新数据", 1000);
                                                return;
                                            }

                                            // 没有错误信息才重试
                                            if (retryCount < maxRetries) {
                                                console.log(`[新浪发布] 🔄 2秒后重新上传封面图...`);
                                                await delay(2000);

                                                // 如果弹窗还在，先尝试关闭它
                                                const existingModal = document.querySelector(".n-dialog");
                                                if (existingModal && existingModal.offsetParent !== null) {
                                                    console.log("[新浪发布] 🔄 弹窗还在，尝试关闭...");
                                                    const closeBtn = existingModal.querySelector(".n-base-close, .n-dialog__close, [aria-label='close']");
                                                    if (closeBtn) {
                                                        closeBtn.click();
                                                        await delay(500);
                                                    }
                                                }

                                                // 重新打开上传弹窗并上传
                                                try {
                                                    // 重新点击"替换封面图"按钮
                                                    const retryBtns = document.querySelectorAll(".cover-preview span");
                                                    let retryChangeBtn = null;
                                                    for (let btn of retryBtns) {
                                                        if (btn.textContent.trim().includes("替换封面图")) {
                                                            retryChangeBtn = btn;
                                                        }
                                                    }
                                                    if (retryChangeBtn) {
                                                        retryChangeBtn.click();
                                                        await delay(1000);

                                                        const retryModal = document.querySelector(".n-dialog");
                                                        if (retryModal) {
                                                            // 切换到"图片库"标签
                                                            const retryTabs = retryModal.querySelectorAll(".n-tabs-tab__label");
                                                            for (let tab of retryTabs) {
                                                                if (tab.textContent.includes("图片库")) {
                                                                    tab.click();
                                                                    await delay(500);
                                                                    break;
                                                                }
                                                            }

                                                            // 重新上传文件
                                                            const retryInput = retryModal.querySelector("input[type='file']");
                                                            if (retryInput) {
                                                                retryInput.files = dataTransfer.files;
                                                                retryInput.dispatchEvent(new Event("change", { bubbles: true }));
                                                                await delay(1000);

                                                                // 选中第一项
                                                                const retryFirstImg = retryModal.querySelector('.image-list .image-item:nth-of-type(1)');
                                                                if (retryFirstImg) retryFirstImg.click();

                                                                // 点击确定
                                                                const retryConfirmBtn = retryModal.querySelector(".n-button--primary-type");
                                                                if (retryConfirmBtn) retryConfirmBtn.click();
                                                                await delay(1000);

                                                                console.log("[新浪发布] 🔄 已重新触发上传");
                                                                // 递归重试
                                                                await delay(2000);
                                                                await tryUploadImage(retryCount + 1);
                                                                return;
                                                            }
                                                        }
                                                    }

                                                    // 走到这里说明重试流程中找不到元素
                                                    console.error("[新浪发布] ❌ 重试时找不到上传相关元素");
                                                    stopErrorListener();
                                                    const publishId = dataObj.video?.dyPlatform?.id;
                                                    if (publishId) {
                                                        await sendStatisticsError(publishId, "封面上传失败，重试时找不到上传元素", "新浪发布");
                                                    }
                                                    await closeWindowWithMessage("封面上传失败，刷新数据", 1000);
                                                } catch (retryError) {
                                                    console.error("[新浪发布] ❌ 重试上传异常:", retryError);
                                                    stopErrorListener();
                                                    const publishId = dataObj.video?.dyPlatform?.id;
                                                    if (publishId) {
                                                        await sendStatisticsError(publishId, "封面上传重试异常: " + retryError.message, "新浪发布");
                                                    }
                                                    await closeWindowWithMessage("封面上传失败，刷新数据", 1000);
                                                }
                                            } else {
                                                // 超过最大重试次数
                                                console.error(`[新浪发布] ❌ 封面上传重试次数已用尽 (原因: ${timeoutReason})`);
                                                stopErrorListener();
                                                const publishId = dataObj.video?.dyPlatform?.id;
                                                if (publishId) {
                                                    await sendStatisticsError(publishId, `封面上传失败(${timeoutReason})，重试次数已用尽`, "新浪发布");
                                                }
                                                await closeWindowWithMessage("封面上传失败，刷新数据", 1000);
                                            }
                                        }
                                    };

                                    // 启动上传检测（延迟2秒等待上传开始）
                                    await delay(2000);
                                    await tryUploadImage(0);
                                }
                            }
                        }
                    } catch (error) {
                        console.log("[新浪发布] ❌ 封面下载失败:", error);
                        stopErrorListener();
                        const publishId = dataObj?.video?.dyPlatform?.id;
                        if (publishId) {
                            await sendStatisticsError(publishId, error.message || "封面下载失败", "新浪发布");
                        }
                        await closeWindowWithMessage("封面下载失败，刷新数据", 1000);
                    }
                })();

                fillFormRunning = false;
                // alert('Automation process completed');
            }, 10000);
        } catch (error) {
            // 捕获填写表单过程中的任何错误（仅捕获 setTimeout 调度前的同步错误）
            console.error("[新浪发布] fillFormData 错误:", error);
            // 发送错误上报
            const publishId = dataObj?.video?.dyPlatform?.id;
            if (publishId) {
                await sendStatisticsError(publishId, error.message || "填写表单失败", "新浪发布");
            }
            // 同步错误时重置标记
            fillFormRunning = false;
            // 填写表单失败也要关闭窗口，不阻塞下一个任务
            await closeWindowWithMessage("填写表单失败，刷新数据", 1000);
        }
        // 注意：不在 finally 中重置 fillFormRunning
        // 因为 setTimeout 是异步的，finally 会立即执行
        // fillFormRunning 的重置在 setTimeout 回调内部完成（line 974）
    }
})(); // IIFE 结束

/**
 * 选择虚拟列表中的选项
 * @param {HTMLElement} selectElement - select 组件的容器
 * @param {string|number} targetValue - 要选择的值（显示文本）
 * @param targetIndex - 要选择的索引（默认0）
 * @param {number} timeout - 超时时间（毫秒）
 */
async function selectFromVirtualList(selectElement, targetValue, targetIndex = 0, timeout = 10000) {
    try {
        console.log("[新浪发布] 🔍 准备选择:", targetValue);

        // 1. 找到触发器并点击打开下拉
        // 尝试多种可能的触发器选择器
        let selectTrigger = selectElement.querySelector(".ne-select-selector") || selectElement.querySelector(".ne-select") || selectElement;
        console.log("🚀 ~ selectFromVirtualList ~ selectTrigger: ", selectTrigger);
        if (!selectTrigger) {
            console.error("[新浪发布] ❌ 找不到 select 触发器");
            return false;
        }

        console.log("[新浪发布] ✅ 找到触发器，点击打开下拉列表");
        selectTrigger.dispatchEvent(new Event("mousedown", { bubbles: true }));

        // 等待下拉出现 - 增加等待时间到 1000ms
        await new Promise(r => setTimeout(r, 1000));

        // 2. 查找虚拟列表容器（可能有多个位置）
        const startTime = Date.now();
        let virtualList = null;
        let options = [];

        while (Date.now() - startTime < timeout) {
            // 尝试多种选择器找虚拟列表
            virtualList = document.querySelectorAll(".rc-virtual-list-holder") || document.querySelectorAll(".ne-select-dropdown .rc-virtual-list") || document.querySelectorAll('[role="listbox"]') || document.querySelectorAll(".ne-select-dropdown");

            if (virtualList && virtualList.length > 0) {
                console.log("[新浪发布] 📍 找到虚拟列表容器:", virtualList[targetIndex].className);

                // 查找所有可见的选项 - 尝试多种选择器
                let allOptions = Array.from(virtualList[targetIndex].querySelectorAll('[role="option"], .ne-select-item-option, .rc-virtual-list-holder-inner [class*="option"]'));

                // 如果还是没找到，尝试所有 div
                if (allOptions.length === 0) {
                    allOptions = Array.from(virtualList[targetIndex].querySelectorAll("div")).filter(el => {
                        const text = el.textContent.trim();
                        // 过滤掉空的和太长的（可能是容器）
                        return text && text.length < 20 && el.children.length === 0;
                    });
                }

                // 滚动到最顶部
                virtualList[targetIndex].scrollTo(0, 0);
                await new Promise(r => setTimeout(r, 300));

                options = allOptions.filter(el => el.offsetParent !== null);

                if (options.length > 0) {
                    console.log("[新浪发布] ✅ 找到虚拟列表，有", options.length, "个选项");
                    break;
                } else {
                    console.log("[新浪发布] ⏳ 虚拟列表已打开但选项还未渲染，等待中...");
                }
            } else {
                console.log("[新浪发布] ⏳ 虚拟列表还未出现，等待中...");
            }

            await new Promise(r => setTimeout(r, 200));
        }

        if (options.length === 0) {
            console.error("[新浪发布] ❌ 未找到任何选项");
            return false;
        }

        // 3. 滚动搜索匹配项
        const targetStr = String(targetValue).trim();
        let foundOption = null;
        const seenTexts = new Set();
        const scrollStep = 100;
        let currentScroll = 0;

        while (true) {
            // 获取当前可见选项
            const currentOptions = Array.from(virtualList[targetIndex].querySelectorAll('[role="option"], .ne-select-item-option, .rc-virtual-list-holder-inner [class*="option"]')).filter(el => el.offsetParent !== null);

            // 检查当前可见选项
            for (const option of currentOptions) {
                const optionText = option.textContent.trim();
                seenTexts.add(optionText);

                if (optionText === targetStr) {
                    foundOption = option;
                    console.log("[新浪发布] ✅ 找到匹配的选项:", optionText);
                    break;
                }
            }

            if (foundOption) break;

            // 检查是否到底
            const scrollHeight = virtualList[targetIndex].scrollHeight;
            const clientHeight = virtualList[targetIndex].clientHeight;
            currentScroll += scrollStep;

            if (currentScroll >= scrollHeight - clientHeight) {
                console.log("[新浪发布] 📍 已滚动到底部");
                break;
            }

            // 向下滚动
            virtualList[targetIndex].scrollTo(0, currentScroll);
            await new Promise(r => setTimeout(r, 200));
        }

        if (!foundOption) {
            console.error("[新浪发布] ❌ 未找到目标选项:", targetStr);
            console.log("[新浪发布] 📋 已扫描选项数:", seenTexts.size);
            return false;
        }

        // 4. 滚动到视图并点击
        foundOption.scrollIntoView({ behavior: "auto", block: "nearest" });
        await new Promise(r => setTimeout(r, 300));

        console.log("[新浪发布] 🖱️ 点击选项:", foundOption.textContent.trim());
        console.log("🚀 ~ selectFromVirtualList ~ foundOption: ", foundOption);
        foundOption.querySelector(".ne-select-item-option-content").dispatchEvent(new Event("click", { bubbles: true }));

        // 等待下拉关闭
        await new Promise(r => setTimeout(r, 500));

        console.log("[新浪发布] ✅ 选项选择完成");
        return true;
    } catch (error) {
        console.error("[新浪发布] ❌ selectFromVirtualList 错误:", error);
        return false;
    }
}


/**
 * 选择定时发布的日期和时间
 * @param sendTime
 */
async function selectScheduledTime(sendTime) {
    console.log("🚀 ~ selectScheduledTime ~ sendTime: ", sendTime);
    try {
        const modal = document.querySelector(".n-dialog");
        if (!modal) {
            console.error("[新浪发布] ❌ 找不到定时发布弹窗");
            return false;
        }

        // 解析目标日期时间
        const [datePart, timePart] = sendTime.split(' ');
        const [year, month, day] = datePart.split('-');
        console.log("🚀 ~ selectScheduledTime ~ day: ", day);

        await delay(1000);

        // 1. 点击日期输入框打开日历
        const dateInput = modal.querySelector(".n-date-picker input");
        if (!dateInput) {
            console.error("[新浪发布] ❌ 找不到日期输入框");
            return false;
        }
        dateInput.click();
        await delay(300);
        console.log("[新浪发布] 🔧 开始选择定时发布时间...");

        const picker = document.querySelector(".n-date-panel");
        if (!picker) {
            console.error("[新浪发布] ❌ 找不到日期选择器");
            return false;
        }

        // 2. 导航到目标月份（处理跨月情况）
        for (let i = 0; i < 24; i++) { // 最多尝试24个月
            // 注意: curr-date 是独立的 class，不是 omui-calendar-nav 的子元素
            const currDateEl = picker.querySelector(".n-date-panel-month__text");
            if (!currDateEl) {
                console.error("[新浪发布] ❌ 找不到当前月份显示元素");
                break;
            }

            const currentText = currDateEl.textContent.trim(); // 格式: "2026年 1月" 或 "2026年1月"
            const match = currentText.match(/(\d+)年\s*(\d+)月/);
            if (!match) {
                console.error("[新浪发布] ❌ 无法解析当前月份:", currentText);
                break;
            }

            const currYear = parseInt(match[1], 10);
            const currMonth = parseInt(match[2], 10);
            console.log(`[新浪发布] 📅 当前显示: ${currYear}-${currMonth}, 目标: ${year}-${month}`);

            if (currYear === parseInt(year) && currMonth === parseInt(month)) {
                console.log("[新浪发布] ✅ 已到达目标月份");
                break; // 已到达目标月份
            }

            // 判断需要前进还是后退
            const targetDate = new Date(year, month - 1);
            const currentDate = new Date(currYear, currMonth - 1);

            if (targetDate > currentDate) {
                // 点击下一月 > (omui-calendar-nav 和 next-m 是同一元素的 class)
                const nextBtn = picker.querySelector(".n-date-panel-month__next");
                if (nextBtn) {
                    nextBtn.click();
                    console.log("[新浪发布] ➡️ 点击下一月");
                }
            } else {
                // 点击上一月 < (omui-calendar-nav 和 prev-m 是同一元素的 class)
                const prevBtn = picker.querySelector(".n-date-panel-month__prev");
                if (prevBtn) {
                    prevBtn.click();
                    console.log("[新浪发布] ⬅️ 点击上一月");
                }
            }
            await delay(200);
        }
        await delay(200);

        // 3. 选择日期 - 找到目标日期的 td 并点击
        let dateSelected = false;
        const allDayCells = picker.querySelectorAll(".n-date-panel-date");
        console.log(`[新浪发布] 📅 找到 ${allDayCells.length} 个日期单元格`);

        for (const td of allDayCells) {
            // 跳过不可选的日期（有 disabled 类，表示过去的日期）
            if (td.classList.contains("n-date-panel-date--disabled")) continue;

            // 跳过非当前月份的日期（上月/下月的灰色日期）
            if (td.classList.contains("n-date-panel-date--excluded")) continue;

            // 尝试多种方式获取日期数字
            let dayText = '';
            const trigger = td.querySelector(".n-date-panel-date__trigger");
            if (trigger) {
                dayText = trigger.textContent.trim();
            }
            // 如果 trigger 内容不是数字，尝试直接从 td 获取
            if (!dayText || isNaN(parseInt(dayText, 10))) {
                // 可能日期数字直接在 td 的文本节点中
                dayText = td.textContent.trim();
            }

            const dayNum = parseInt(dayText, 10);
            const targetDay = parseInt(day, 10);
            console.log(`[新浪发布] 📅 检查日期: text="${dayText}", dayNum=${dayNum}, targetDay=${targetDay}, match=${dayNum === targetDay}`);

            if (!isNaN(dayNum) && dayNum === targetDay) {
                // 点击整个单元格或 trigger
                if (trigger) {
                    trigger.click();
                } else {
                    td.click();
                }
                dateSelected = true;
                console.log(`[新浪发布] ✅ 选择日期: ${year}-${month}-${day}`);
                break;
            }
        }

        if (!dateSelected) {
            console.error(`[新浪发布] ❌ 未能选择日期 ${day} 号`);
        }
        await delay(300);

        // 4. 设置时间 - 点击时间输入框打开下拉，然后选择小时和分钟
        const [hour, minute] = timePart.split(':');
        console.log(`[新浪发布] ⏰ 目标时间: ${hour}:${minute}`);

        const inputs = modal.querySelectorAll(".n-select");
        console.log("🚀 ~ selectScheduledTime ~ inputs: ", inputs);
        for (let i = 0; i < inputs.length; i++) {
            // 点击时间输入框打开下拉面板
            const hourInput = inputs[i].querySelector(".n-base-selection-label");
            if (hourInput) {
                hourInput.click();
                await delay(1000);

                // 找到时间选择面板
                const timePanels = document.querySelectorAll(".n-base-select-menu-option-wrapper");
                const timePanel = timePanels[i];
                await delay(1000);
                if (timePanel) {
                    const hourItems = timePanel.querySelectorAll(".n-base-select-option__content");
                    const targetValue = i === 0 ? hour : minute;
                    for (const li of hourItems) {
                        if (li.textContent.trim() === targetValue + (i === 0 ? '时' : '分')) {
                            li.click();
                            console.log(`[新浪发布] ✅ 选择时间${i}: ${targetValue}`);
                            break;
                        }
                    }
                    await delay(200);
                } else {
                    console.warn("[新浪发布] ⚠️ 未找到时间选择面板");
                }
            } else {
                console.warn("[新浪发布] ⚠️ 未找到"+i+"输入框");
            }
            await delay(1000);
        }
        await delay(200);

        // 点击发布
        const publishBtn = modal.querySelector(".timing-setting + div .n-button--primary-type");
        if (publishBtn) {
            publishBtn.click();
            console.log("[新浪发布] ✅ 已点击定时发布按钮");

            // 等待发布请求完成（检测弹窗是否关闭）
            await delay(1000);

            // 🔑 定时发布成功后直接上报并关闭窗口，不等页面跳转
            // 这样可以避免新浪跳转到草稿页导致的各种问题
            console.log("[新浪发布] ⏰ 定时发布提交成功，准备上报统计...");

            // 获取 publishId 并上报成功
            const publishIdForTimer = window.__xinlangPublishId ||
                (await window.browserAPI?.getGlobalData?.(`PUBLISH_SUCCESS_DATA_${await window.browserAPI?.getWindowId()}`))?.publishId;

            if (publishIdForTimer) {
                try {
                    const successUrl = await getStatisticsUrl();
                    const scanData = { data: JSON.stringify({ id: publishIdForTimer }) };
                    await fetch(successUrl, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(scanData),
                    });
                    console.log("[新浪发布] ✅ 定时发布统计上报成功");
                } catch (e) {
                    console.error("[新浪发布] ❌ 统计上报失败:", e);
                }
            }

            // 清除保存的标记（避免 publish-success.js 重复处理）
            try {
                const wid = await window.browserAPI?.getWindowId();
                if (wid) {
                    localStorage.removeItem(`PUBLISH_SUCCESS_DATA_${wid}`);
                    await window.browserAPI?.removeGlobalData?.(`PUBLISH_SUCCESS_DATA_${wid}`);
                    console.log("[新浪发布] 🗑️ 已清除发布标记");
                }
            } catch (e) {
                // 忽略清除失败
            }

            // 关闭窗口
            await closeWindowWithMessage("发布成功，刷新数据", 1000);
            return true;
        } else {
            console.error("[新浪发布] ❌ 未找到发布按钮");
        }
        return false;
    } catch (error) {
        console.error("[新浪发布] ❌ selectScheduledTime 错误:", error);
        return false;
    }
}
