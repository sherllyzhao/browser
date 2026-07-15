// 🔓 Shadow DOM 穿透：小红书新版把发布/暂存按钮放进 closed shadow root
// 在脚本最顶端 hook attachShadow，保留所有 shadowRoot 的引用，供后续查找使用
(function patchAttachShadowForXhs() {
    if (window.__xhsShadowPatched) return;
    window.__xhsShadowPatched = true;
    window.__xhsShadowHosts = new WeakSet();
    window.__xhsShadowRoots = [];
    try {
        const original = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function (init) {
            const patchedInit = Object.assign({}, init || {}, { mode: "open" });
            const root = original.call(this, patchedInit);
            try {
                window.__xhsShadowHosts.add(this);
                window.__xhsShadowRoots.push(root);
            } catch (e) { /* ignore */ }
            return root;
        };
        console.log("[xhs-publish] attachShadow 已 hook → open mode");
    } catch (e) {
        console.warn("[xhs-publish] attachShadow hook 失败", e);
    }
})();

// 发布成功页跳过本脚本，避免与 publish-success.js 冲突
if (location.search.includes("published=true")) {
    console.log("[小红书发布] 跳过：当前为发布成功页");
    // 用 void 包裹，阻止后续代码执行
    void 0;
} else {
    let introFilled = false; // 标记 intro 是否已填写
    let fillFormRunning = false; // 标记 fillFormData 是否正在执行
    let publishRunning = false; // 标记发布是否正在执行，防止重复点击
    let hasProcessed = false; // 标记发布按钮已提交，防止提交后重复上报失败

    // 防重复标志：记录已处理的视频 ID
    let isProcessing = false;
    let processedVideoIds = new Set(); // 改为 Set 存储已处理的视频 ID

    /**
     * 小红书创作者平台发布脚本
     * 用于处理发布流程和数据传输
     *
     * 依赖: common.js (会在此脚本之前注入)
     */

    (async function () {
        "use strict";

        // ===========================
        // 🔑 检查 common.js 依赖并提供降级实现
        // ===========================
        if (typeof window.getRandomDelayMs !== "function") {
            console.warn("[小红书发布] ⚠️ common.js 未正确加载，使用降级实现");
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
        // 防止脚本重复注入
        // ===========================
        if (window.__XHS_SCRIPT_LOADED__) {
            console.log("[小红书发布] ⚠️ 脚本已经加载过，跳过重复注入");
            return;
        }

        // ===========================
        // 页面状态检查 - 防止异常渲染
        // ===========================
        if (typeof window.checkPageStateAndReload === "function") {
            if (!window.checkPageStateAndReload("小红书发布")) {
                return;
            }
        }

        window.__XHS_SCRIPT_LOADED__ = true;

        // ===========================
        // 🔑 小红书白屏检测和自动恢复（使用公共函数）
        // ===========================
        if (typeof window.checkBlankPageAndReload === "function") {
            window.checkBlankPageAndReload("小红书发布", [
                ".publish-container",
                ".c-input",
                ".submit",
                ".dnd-upload"
            ], 3000, 3);
        }

        // 显示操作提示横幅
        if (typeof showOperationBanner === "function") {
            showOperationBanner("正在自动发布中，请勿操作此页面...");
        }

        console.log("═══════════════════════════════════════");
        console.log("✅ 小红书发布脚本已注入");
        console.log("📍 当前 URL:", window.location.href);
        console.log("🕐 注入时间:", new Date().toLocaleString());
        console.log("═══════════════════════════════════════");

        // 检查 common.js 是否已加载（延迟检查，给 common.js 时间执行）
        setTimeout(() => {
            if (!window.__COMMON_JS_LOADED__) {
                console.error("[小红书发布] ❌ common.js 未加载！");
            } else if (typeof waitForElement === "undefined" || typeof retryOperation === "undefined" || typeof uploadVideo === "undefined") {
                console.error("[小红书发布] ❌ common.js 加载不完整！缺少必需函数");
                console.error("[小红书发布] waitForElement:", typeof waitForElement);
                console.error("[小红书发布] retryOperation:", typeof retryOperation);
                console.error("[小红书发布] uploadVideo:", typeof uploadVideo);
                console.error("[小红书发布] sendStatistics:", typeof sendStatistics);
                console.error("[小红书发布] nativeClickElement:", typeof nativeClickElement);
                console.error("[小红书发布] nativeInsertText:", typeof nativeInsertText);
                console.error("[小红书发布] clickWithTrustedRetry:", typeof clickWithTrustedRetry);
                console.error("[小红书发布] closeWindowWithMessage:", typeof closeWindowWithMessage);
                console.error("[小红书发布] scrollElementIntoViewIfNeeded:", typeof scrollElementIntoViewIfNeeded);
                console.error("[小红书发布] delay:", typeof delay);
            } else {
                console.log("[小红书发布] ✅ common.js 已完整加载，所有工具函数可用");
            }
        }, window.getRandomDelayMs(100)); // 延迟 100ms 检查

        // ===========================
        // 1. 从 URL 获取发布数据
        // ===========================

        const urlParams = new URLSearchParams(window.location.search);
        const companyId = await safeGetGlobalData("company_id");
        const transferId = urlParams.get("transfer_id");

        console.log("[小红书发布] URL 参数:", {
            companyId,
            transferId,
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

        window.__XHS_AUTH__ = {
            // 发送发布成功消息
            notifySuccess: () => {
                sendMessageToParent("发布成功");
            },
        };

        // ===========================
        // 4. 显示调试信息横幅
        // ===========================

        // ===========================
        // 5. 接收来自父窗口的消息（必须在发送 页面加载完成 之前注册！）
        // ===========================
        console.log("[小红书发布] 注册消息监听器...");

        if (!window.browserAPI) {
            console.error("[小红书发布] ❌ browserAPI 不可用！");
        } else {
            console.log("[小红书发布] ✅ browserAPI 可用");

            if (!window.browserAPI.onMessageFromHome) {
                console.error("[小红书发布] ❌ browserAPI.onMessageFromHome 不可用！");
            } else {
                console.log("[小红书发布] ✅ browserAPI.onMessageFromHome 可用，正在注册...");

                window.browserAPI.onMessageFromHome(async message => {
                    console.log("═══════════════════════════════════════");
                    console.log("[小红书发布] 🎉 收到来自父窗口的消息!");
                    console.log("[小红书发布] 消息类型:", typeof message);
                    console.log("[小红书发布] 消息内容:", message);
                    console.log("[小红书发布] 消息.type:", message?.type);
                    console.log("[小红书发布] 消息.data:", message?.data);
                    console.log("═══════════════════════════════════════");

                    // 接收完整的发布数据（直接传递，不使用 IndexedDB）
                    if (message.type === "publish-data") {
                        console.log("[小红书发布] ✅ 收到发布数据:", message.data);

                        // 使用公共方法检查 windowId 是否匹配
                        const isMatch = await checkWindowIdMatch(message, "[小红书发布]");
                        if (!isMatch) return;

                        // 使用公共方法解析消息数据
                        const messageData = parseMessageData(message.data, "[小红书发布]");
                        if (!messageData) return;

                        // 使用公共方法恢复会话数据
                        const needReload = await restoreSessionAndReload(messageData, "[小红书发布]");
                        if (needReload) return; // 已触发刷新，脚本会重新注入

                        // 防重复检查
                        if (isProcessing) {
                            console.warn("[小红书发布] ⚠️ 正在处理中，忽略重复消息");
                            return;
                        }

                        const videoId = messageData?.video?.dyPlatform?.id;

                        if (!videoId) {
                            console.error("[小红书发布] ❌ 视频 ID 不存在，无法处理");
                            return;
                        }

                        // 检查是否已处理过这个视频
                        if (processedVideoIds.has(videoId)) {
                            console.warn("[小红书发布] ⚠️ 视频已处理过，忽略重复消息. Video ID:", videoId);
                            return;
                        }

                        // 🔑 掉登录被弹回登录页时不消费发布数据，停窗等待用户手动登录后 reload 续发
                        if (stopIfXhsLoginPage("message-entry")) {
                            return;
                        }

                        // 标记为正在处理
                        isProcessing = true;
                        console.log("[小红书发布] 📝 开始处理视频 ID:", videoId);

                        // 更新全局变量
                        if (message.data) {
                            window.__AUTH_DATA__ = {
                                ...window.__AUTH_DATA__,
                                message: messageData,
                                receivedAt: Date.now(),
                            };
                            console.log("[小红书发布] ✅ 发布数据已更新:", window.__AUTH_DATA__);
                            console.log("🚀 ~  ~ messageData: ", messageData);

                            // 💾 保存数据到 localStorage（用于授权跳转后恢复）
                            /* try {
              localStorage.setItem('XHS_PUBLISH_DATA', message.data);
              console.log('[小红书发布] 💾 数据已保存到 localStorage');
            } catch (e) {
              console.error('[小红书发布] ❌ 保存数据失败:', e);
            }

            // 🔖 保存当前发布页URL（用于授权跳转后返回）
            try {
              localStorage.setItem('XHS_PUBLISH_URL', window.location.href);
              console.log('[小红书发布] 🔖 已保存发布页URL:', window.location.href);
            } catch (e) {
              console.error('[小红书发布] ❌ 保存发布页URL失败:', e);
            } */

                            // 查找是否有提示消息（这是可选提示，不存在时不能中断首次发布流程）
                            try {
                                const tipsEle = await waitForElement(".progetto-sugger-warn .tips", 2000);
                                console.log("🚀 ~  ~ tipsEle: ", tipsEle);
                                if (tipsEle) {
                                    const tipsText = tipsEle.textContent.trim();
                                    console.log("[小红书发布] ✅ 提示消息:", tipsText);
                                    const canToError = tipsText.includes("未绑定手机号");
                                    if (canToError) {
                                        console.log("[小红书发布] ✅ 提示消息包含未绑定手机号，跳转到错误页面");
                                        const publishId = messageData?.video?.dyPlatform?.id;
                                        await sendStatisticsError(publishId, "未绑定手机号", "小红书发布");
                                        await closeWindowWithMessage("发布失败，刷新数据", 1000);
                                        return;
                                    }
                                }
                            } catch (e) {
                                console.log("[小红书发布] ℹ️ 未检测到发布前提示，继续发布流程:", e.message);
                            }

                            await uploadVideo(messageData);
                            try {
                                await retryOperation(async () => await fillFormData(messageData), 3, 2000);
                            } catch (e) {
                                console.log("[小红书发布] ❌ 填写表单数据失败:", e);
                            }

                            console.log("[小红书发布] 📤 准备发送数据到接口...");
                            console.log("[小红书发布] ✅ 发布流程已启动，等待 publishApi 完成...");
                            // 注意：不在这里关闭窗口，因为 publishApi 内部有异步的统计接口调用
                            // 窗口会在 publishApi 完成后自动关闭
                        }

                        // 标记视频已处理（成功或失败都记录）
                        processedVideoIds.add(videoId);

                        // 重置处理标志
                        isProcessing = false;
                        console.log("[小红书发布] 处理完成，已处理视频数:", processedVideoIds.size);
                    }
                });

                console.log("[小红书发布] ✅ 消息监听器注册成功");
            }
        }

        // ===========================
        // 6. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
        // ===========================

        // 页面加载完成后向父窗口发送消息
        console.log("[小红书发布] 页面加载完成，发送 页面加载完成 消息");
        sendMessageToParent("页面加载完成");

        console.log("═══════════════════════════════════════");
        console.log("✅ 小红书发布脚本初始化完成");
        console.log("📝 全局方法: window.__XHS_AUTH__");
        console.log("  - notifySuccess()  : 发送发布成功消息");
        console.log("  - sendMessage(msg) : 发送自定义消息");
        console.log("  - getAuthData()    : 获取发布数据");
        console.log("═══════════════════════════════════════");

        // ===========================
        // 7. 检查是否是恢复 cookies 后的刷新（立即执行）
        // ===========================
        await (async () => {
            // 如果已经在处理，跳过
            if (isProcessing) {
                console.log("[小红书发布] ⏭️ 已在处理中，跳过全局存储读取");
                return;
            }

            try {
                // 获取当前窗口 ID
                const windowId = await window.browserAPI.getWindowId();
                console.log("[小红书发布] 检查全局存储，窗口 ID:", windowId);

                if (!windowId) {
                    console.log("[小红书发布] ❌ 无法获取窗口 ID");
                    return;
                }

                // 检查是否有恢复 cookies 后保存的发布数据
                const publishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
                console.log("[小红书发布] 📦 从全局存储读取 publish_data_window_" + windowId + ":", publishData ? "有数据" : "无数据");

                if (publishData && !isProcessing) {
                    const videoId = publishData?.video?.dyPlatform?.id;

                    // 检查是否已处理过这个视频
                    if (videoId && processedVideoIds.has(videoId)) {
                        console.warn("[小红书发布] ⚠️ 视频已处理过，跳过. Video ID:", videoId);
                        await window.browserAPI.removeGlobalData(`publish_data_window_${windowId}`);
                        return;
                    }

                    console.log("[小红书发布] ✅ 检测到恢复 cookies 后的数据，开始处理...");

                    // 🔑 不再立即删除数据，改为在发布完成后删除
                    // 这样如果登录跳转后跳回来，数据仍然可用
                    // 使用 hasProcessed 标记防止重复处理
                    console.log("[小红书发布] 📝 保留 publish_data_window_" + windowId + " 数据，待发布完成后清理");

                    // 🔑 掉登录被弹回登录页时不消费发布数据，停窗等待用户手动登录后 reload 续发
                    if (stopIfXhsLoginPage("restore-entry")) {
                        return;
                    }

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

                    // 查找是否有提示消息
                    try {
                        const tipsEle = await waitForElement(".progetto-sugger-warn .tips", 2000);
                        console.log("🚀 ~  ~ tipsEle: ", tipsEle);
                        if (tipsEle) {
                            const tipsText = tipsEle.textContent.trim();
                            console.log("[小红书发布] ✅ 提示消息:", tipsText);
                            const canToError = tipsText.includes("未绑定手机号");
                            if (canToError) {
                                console.log("[小红书发布] ✅ 提示消息包含未绑定手机号，跳转到错误页面");
                                const publishId = publishData?.video?.dyPlatform?.id;
                                await sendStatisticsError(publishId, "未绑定手机号", "小红书发布");
                                await closeWindowWithMessage("发布失败，刷新数据", 1000);
                                return;
                            }
                        }
                    } catch (e) {
                        console.log("[小红书发布] ❌ 查找提示消息失败:", e);
                    }

                    await uploadVideo(publishData);
                    try {
                        await retryOperation(async () => await fillFormData(publishData), 3, 2000);
                    } catch (e) {
                        console.log("[小红书发布] ❌ 填写表单数据失败:", e);
                    }

                    console.log("[小红书发布] 📤 准备发送数据到接口...");
                    console.log("[小红书发布] ✅ 发布流程已启动，等待 publishApi 完成...");

                    // 标记视频已处理
                    if (videoId) {
                        processedVideoIds.add(videoId);
                    }
                    isProcessing = false;
                }
            } catch (error) {
                console.error("[小红书发布] ❌ 从全局存储读取数据失败:", error);
            }
        })();

        // ===========================
        // 7. 检查是否有保存的发布数据（授权跳转恢复）
        // ===========================
    })();

    // ===========================
    // 7. 发布视频到小红书
    // ===========================
    function isVisibleElement(element) {
        if (!element) {
            return false;
        }
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none"
            && style.visibility !== "hidden"
            && style.opacity !== "0"
            && rect.width > 0
            && rect.height > 0;
    }

    function isDisabledButton(button) {
        return button.disabled
            || button.classList.contains("disabled")
            || button.getAttribute("disabled") !== null
            || button.getAttribute("aria-disabled") === "true";
    }

    function queryAllDeep(selector) {
        const results = [];
        const seen = new Set();
        const visit = (root) => {
            try {
                root.querySelectorAll(selector).forEach(el => {
                    if (!seen.has(el)) {
                        seen.add(el);
                        results.push(el);
                    }
                });
            } catch (e) { /* ignore */ }
            try {
                root.querySelectorAll("*").forEach(el => {
                    if (el.shadowRoot) visit(el.shadowRoot);
                });
            } catch (e) { /* ignore */ }
        };
        visit(document);
        if (window.__xhsShadowRoots) {
            window.__xhsShadowRoots.forEach(r => {
                if (r && r.querySelectorAll) visit(r);
            });
        }
        return results;
    }

    function findXhsPublishButton() {
        const primarySelectors = [
            ".publish-page-publish-btn .ce-btn.bg-red",
            ".publish-page-publish-btn .custom-button.bg-red",
            ".ce-btn.bg-red"
        ];

        for (const selector of primarySelectors) {
            const element = queryAllDeep(selector).find(isVisibleElement);
            if (element) {
                return element;
            }
        }

        const fallbackSelectors = [
            ".ce-btn",
            ".custom-button",
            "button",
            "[role='button']",
        ];
        const candidates = [];
        fallbackSelectors.forEach(selector => {
            queryAllDeep(selector).forEach(element => {
                if (!candidates.includes(element)) {
                    candidates.push(element);
                }
            });
        });

        const visibleCandidates = candidates.filter(isVisibleElement);
        const textMatchedButton = visibleCandidates.find(element => {
            const text = (element.textContent || "").replace(/\s+/g, "");
            return text === "发布"
                || (text.includes("发布")
                    && !text.includes("草稿")
                    && !text.includes("取消")
                    && !text.includes("预览")
                    && !text.includes("暂存"));
        });

        if (!textMatchedButton) {
            console.warn("[xhs-publish] findXhsPublishButton 未匹配", {
                publishWrap: queryAllDeep(".publish-page-publish-btn").length,
                ceBtn: queryAllDeep(".ce-btn").length,
                customBtn: queryAllDeep(".custom-button").length,
                shadowRoots: (window.__xhsShadowRoots || []).length,
                xhsHost: document.querySelectorAll("xhs-publish-btn").length,
            });
        }

        return textMatchedButton || null;
    }

    async function clearPublishSuccessData(windowId) {
        if (windowId) {
            localStorage.removeItem(`PUBLISH_SUCCESS_DATA_${windowId}`);
            await window.browserAPI?.removeGlobalData?.(`PUBLISH_SUCCESS_DATA_${windowId}`);
        }
        localStorage.removeItem("PUBLISH_SUCCESS_DATA");
    }

    function readXhsPublishSignal() {
        const selectors = [
            ".d-toast-description",
            ".d-message-content",
            ".semi-toast-content-text",
            ".cheetah-message-custom-content span:last-child",
            ".el-message__content",
            '[class*="toast"]',
            '[class*="message"]',
            '[class*="notification"]',
        ];
        const successKeywords = ["发布成功", "提交成功", "已发布", "已提交", "审核中"];
        const failureKeywords = ["发布失败", "提交失败", "发布错误", "提交错误", "校验失败", "失败", "错误", "未绑定手机号", "不能为空", "不支持", "违规", "禁止"];
        const roots = [document, ...(window.__xhsShadowRoots || [])];

        for (const root of roots) {
            for (const selector of selectors) {
                try {
                    const elements = root.querySelectorAll(selector);
                    for (const element of elements) {
                        const text = (element.textContent || element.innerText || "").trim();
                        if (!text) continue;
                        if (successKeywords.some(keyword => text.includes(keyword))) {
                            return { type: "success", text };
                        }
                        if (failureKeywords.some(keyword => text.includes(keyword))) {
                            return { type: "failure", text };
                        }
                    }
                } catch (_) {}
            }
        }

        return { type: "none", text: "" };
    }

    async function completeXhsPublishAsSuccess(publishId, windowId, reason) {
        console.log("[小红书发布] ✅ 按成功收口:", reason);
        try {
            await sendStatistics(publishId, "小红书发布");
        } catch (error) {
            console.warn("[小红书发布] ⚠️ 成功统计上报异常:", error.message);
        }
        try {
            await clearPublishSuccessData(windowId);
        } catch (error) {
            console.warn("[小红书发布] ⚠️ 清理发布临时数据异常:", error.message);
        }
        publishRunning = false;
        // 🔎 跳内容管理页二次验证，跳转成功则由 content-verify.js 收尾
        if (typeof window.gotoContentVerify === 'function'
            && await window.gotoContentVerify('xiaohongshu', publishId, '小红书发布')) {
            return;
        }
        try {
            await closeWindowWithMessage("发布成功，刷新数据", 1000);
        } catch (error) {
            console.warn("[小红书发布] ⚠️ 成功后关闭窗口异常:", error.message);
        }
    }

    async function publishApi(dataObj) {
        console.log("🚀 ~ publishApi ~ dataObj: ", dataObj);

        // 防止重复执行
        if (publishRunning || hasProcessed) {
            console.log("Publish is already running or processed, skipping duplicate call");
            return;
        }

        const publishId = dataObj.video.dyPlatform.id;

        // 获取窗口 ID（用于多窗口并发发布时区分数据）
        let windowId = null;
        try {
            windowId = await window.browserAPI.getWindowId();
            console.log("[小红书发布] 当前窗口 ID:", windowId);
        } catch (e) {
            console.error("[小红书发布] ❌ 获取窗口 ID 失败:", e);
        }

        try {
            // 标记发布正在进行
            publishRunning = true;

            const publishHelperStatus = {
                findXhsPublishButton: typeof findXhsPublishButton,
                isDisabledButton: typeof isDisabledButton,
                clearPublishSuccessData: typeof clearPublishSuccessData,
                nativeClickElement: typeof nativeClickElement,
                nativeInsertText: typeof nativeInsertText,
                clickWithTrustedRetry: typeof clickWithTrustedRetry,
            };
            const missingPublishHelpers = Object.entries(publishHelperStatus)
                .filter(([, value]) => value !== "function")
                .map(([key]) => key);
            if (missingPublishHelpers.length > 0) {
                throw new Error(`publishApi 依赖缺失: ${missingPublishHelpers.join(", ")}`);
            }

            // 等待发布按钮可用
            const publishBtn = await retryOperation(
                async () => {
                    const btn = findXhsPublishButton();
                    console.log("🚀 ~  ~ btn: ", btn);
                    if (!btn) {
                        throw new Error("发布按钮未找到");
                    }
                    // 🔑 检查按钮是否 disabled
                    if (isDisabledButton(btn)) {
                        throw new Error("发布按钮当前不可用(disabled)，可能不符合发布要求");
                    }
                    return btn;
                },
                10,
                2000,
            );

            // 等待按钮事件绑定完成
            await delay(800);

            // 🔑 小红书成功后会直接跳转页面，必须在点击前保存数据
            // 否则跳转后 publishApi 的后续代码不会执行
            // 使用窗口 ID 作为 key，避免多窗口并发时数据覆盖
            try {
                const storageKey = windowId ? `PUBLISH_SUCCESS_DATA_${windowId}` : "PUBLISH_SUCCESS_DATA";
                localStorage.setItem(storageKey, JSON.stringify({ publishId: publishId }));
                console.log("[小红书发布] 💾 已提前保存 publishId 到 localStorage:", publishId, "key:", storageKey);

                // 🔑 同时保存到 globalData（更可靠，不受域名隔离限制）
                if (window.browserAPI && window.browserAPI.setGlobalData) {
                    await window.browserAPI.setGlobalData(`PUBLISH_SUCCESS_DATA_${windowId}`, { publishId: publishId });
                    console.log("[小红书发布] 💾 已保存 publishId 到 globalData");
                }
            } catch (e) {
                console.error("[小红书发布] ❌ 保存 publishId 失败:", e);
            }

            // 检测视频是否上传完成
            console.log("[小红书发布] ⏳ 等待视频上传完成...");
            await retryOperation(
                async () => {
                    const stageEle = document.querySelector(".stage");
                    if (!stageEle) {
                        throw new Error(".stage 元素未找到");
                    }
                    const stageText = stageEle.textContent || "";
                    // 新版小红书上传完成后显示"检测为高清视频..."等文案，不再显示"上传成功"
                    // 只要不包含上传中/失败的关键词，且 .stage 存在，就认为上传完成
                    if (stageText.includes("上传中") || stageText.includes("上传失败") || stageText.includes("正在上传")) {
                        throw new Error("视频尚未上传完成，当前状态: " + stageText.substring(0, 30));
                    }
                    console.log("[小红书发布] ✅ 检测到视频上传完成，状态: " + stageText.substring(0, 30));
                    return true;
                },
                150,
                2000,
            ); // 最多重试 150 次，每次间隔 2 秒，共 5 分钟

            // 生产环境：必须点击发布按钮
            console.log("[小红书发布] ✅ 生产环境确认，准备点击发布按钮...");
            await delay(1000);

            const clickResult = await clickWithTrustedRetry(publishBtn, 3, 500, true); // 启用可信点击和消息捕获

            if (!clickResult.success) {
                console.error("[小红书发布] ❌ 所有点击尝试均失败:", clickResult.message);
                // 清除提前保存的数据（使用窗口专属 key 和通用 key，确保兼容性）
                await clearPublishSuccessData(windowId);
                // 发送失败统计
                await sendStatisticsError(publishId, clickResult.message || "点击发布按钮失败", "小红书发布");
                publishRunning = false;
                throw new Error("发布按钮点击失败: " + clickResult.message);
            }

            console.log("[小红书发布] ✅ 发布按钮已点击");
            // 🚀 点击发布成功 → 立即乐观上报一次成功（GEO 由 sendOptimisticSuccess 内部跳过；不 await 避免阻塞发布流程）
            if (publishId) { window.sendOptimisticSuccess(publishId, '小红书发布').catch(() => {}); }
            console.log("[小红书发布] 📨 平台提示:", clickResult.message);

            // 开发环境弹窗显示平台提示信息
            if (window.browserAPI && window.browserAPI.isProduction === false) {
                alert(`小红书发布结果：\n\n${clickResult.message}`);
            }

            // 等待页面稳定
            await delay(2000);

            // 点击成功后，不再判断 toast 消息（因为各平台提示词不统一，无法准确判断）
            // 直接认为发布已提交，等待页面跳转到成功页
            // 成功统计由 publish-success.js 在成功页发送
            console.log("[小红书发布] ✅ 发布已提交，消息:", clickResult.message);

            // 标记已完成
            hasProcessed = true;

            // 等待页面跳转到成功页，超时 30 秒
            console.log("[小红书发布] ⏳ 等待跳转到成功页（90秒超时）...");
            const currentUrl = window.location.href;
            const startTime = Date.now();
            const timeout = 90000; // 90秒：对齐全平台，网慢兜底，避免误报超时失败
            let lastFailureMessage = "";

            while (Date.now() - startTime < timeout) {
                await delay(2000); // 每 2 秒检查一次

                // 检查 URL 是否变化
                if (window.location.href !== currentUrl) {
                    console.log("[小红书发布] ✅ 检测到页面跳转，发布成功");
                    return; // 页面已跳转，由 publish-success.js 处理
                }

                // 检查 PUBLISH_SUCCESS_DATA 是否已被 publish-success.js 删除（检查窗口专属 key 和通用 key）
                const windowKey = windowId ? `PUBLISH_SUCCESS_DATA_${windowId}` : null;
                const hasWindowData = windowKey ? localStorage.getItem(windowKey) : false;
                const hasGenericData = localStorage.getItem("PUBLISH_SUCCESS_DATA");
                if (!hasWindowData && !hasGenericData) {
                    console.log("[小红书发布] ✅ 数据已被成功页处理，跳过后续检测");
                    return;
                }

                const signal = readXhsPublishSignal();
                if (signal.type === "success") {
                    await completeXhsPublishAsSuccess(publishId, windowId, signal.text);
                    return;
                }
                if (signal.type === "failure") {
                    lastFailureMessage = signal.text;
                    console.log("[小红书发布] ❌ 检测到明确失败提示:", signal.text);
                    break;
                }
            }

            // 超时未跳转 - 再次检查是否已被 publish-success.js 处理（检查窗口专属 key 和通用 key）
            const finalWindowKey = windowId ? `PUBLISH_SUCCESS_DATA_${windowId}` : null;
            const finalHasWindowData = finalWindowKey ? localStorage.getItem(finalWindowKey) : false;
            const finalHasGenericData = localStorage.getItem("PUBLISH_SUCCESS_DATA");
            if (!finalHasWindowData && !finalHasGenericData) {
                console.log("[小红书发布] ✅ 超时但数据已被成功页处理，跳过错误统计");
                return;
            }

            if (!lastFailureMessage) {
                await completeXhsPublishAsSuccess(publishId, windowId, "点击已成功但平台未跳转成功页");
                return;
            }

            console.log("[小红书发布] ❌ 检测到明确失败，结束发布:", lastFailureMessage);
            await clearPublishSuccessData(windowId);
            await sendStatisticsError(publishId, lastFailureMessage, "小红书发布");
            publishRunning = false;
            await closeWindowWithMessage("发布失败，刷新数据", 1000);
        } catch (error) {
            console.log("🚀 ~ publishApi ~ error: ", error);
            // 清除提前保存的数据（窗口专属 key 和通用 key）
            await clearPublishSuccessData(windowId);
            // 发送失败统计
            await sendStatisticsError(publishId, error.message || "发布过程出错", "小红书发布");
            publishRunning = false;
            // 即使出错也尝试关闭窗口
            await closeWindowWithMessage("发布失败，刷新数据", 1000);
        }
    }

    // ===========================
    // 🔐 登录页守卫：掉登录时小红书 SPA 路由跳到 /login，
    // 发布流程必须停在登录页等用户手动登录，禁止直接上报失败关窗。
    // 登录成功回到发布页后 reload 一次（绕过 __XHS_SCRIPT_LOADED__ 防重），
    // 脚本重新注入后从 publish_data_window_${windowId} 恢复数据继续发布；
    // 主进程「登录页→业务页」导航检测会自动保存新登录态到后台。
    // ===========================
    function isXhsLoginPage() {
        try {
            const url = new URL(window.location.href);
            return url.hostname === "creator.xiaohongshu.com" && url.pathname.startsWith("/login");
        } catch (_) {
            return String(window.location.href || "").includes("creator.xiaohongshu.com/login");
        }
    }

    // 登录等待提示条：fixed 顶部 + pointer-events:none，不遮挡、不拦截登录表单操作
    function showXhsLoginWaitTip() {
        try {
            if (document.getElementById("__xhs_login_wait_tip__")) {
                return;
            }
            const tip = document.createElement("div");
            tip.id = "__xhs_login_wait_tip__";
            tip.textContent = "小红书登录已失效，请在本窗口重新登录，登录成功后将自动继续发布";
            tip.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:10px 16px;background:#fff7e6;color:#d46b08;border-bottom:1px solid #ffd591;font-size:14px;font-weight:600;text-align:center;pointer-events:none;";
            (document.body || document.documentElement).appendChild(tip);
        } catch (e) {
            console.warn("[小红书发布] ⚠️ 显示登录提示条失败:", e.message);
        }
    }

    // 返回 true 表示当前在登录页，调用方应停止发布流程（不上报失败、不关窗）
    function stopIfXhsLoginPage(source) {
        if (!isXhsLoginPage()) {
            return false;
        }
        console.warn(`[小红书发布] 🔐 检测到登录页，暂停发布流程等待用户手动登录，source=${source}, url=${window.location.href}`);
        if (typeof hideOperationBanner === "function") {
            hideOperationBanner();
        }
        showXhsLoginWaitTip();
        watchXhsLoginRecovery();
        return true;
    }

    // 🔑 监听登录恢复：SPA 跳回发布页时脚本重注入会被 __XHS_SCRIPT_LOADED__ 防重挡住，
    // 这里 reload 一次让脚本干净地重新注入续发。
    // 用发布页白名单而非「离开登录页」做条件，避免验证码等登录中间页误触发刷新打断用户。
    function watchXhsLoginRecovery() {
        if (window.__xhsLoginRecoveryWatcher__) {
            return;
        }
        console.log("[小红书发布] 👀 开始监听登录恢复，用户登录成功后将自动刷新继续发布");
        window.__xhsLoginRecoveryWatcher__ = setInterval(() => {
            let onPublishPage = false;
            try {
                const url = new URL(window.location.href);
                onPublishPage = url.hostname === "creator.xiaohongshu.com" && url.pathname.startsWith("/publish/publish");
            } catch (_) {}
            if (onPublishPage) {
                clearInterval(window.__xhsLoginRecoveryWatcher__);
                window.__xhsLoginRecoveryWatcher__ = null;
                console.log("[小红书发布] 🔄 检测到已登录并回到发布页（用户已重新登录），刷新页面以继续发布流程");
                window.location.reload();
            }
        }, 1000);
    }

    // 🔐 全程守望：填表/上传任意时刻被弹回登录页都能接住（幂等，重注入不会重复启动）
    if (!window.__xhsLoginKickoutWatcher__) {
        window.__xhsLoginKickoutWatcher__ = setInterval(() => {
            if (isXhsLoginPage() && !window.__xhsLoginRecoveryWatcher__) {
                stopIfXhsLoginPage("kickout-watcher");
            }
        }, 1500);
    }

    // 填写表单数据
    async function fillFormData(dataObj) {
        // 防止重复执行
        if (fillFormRunning) {
            return;
        }
        fillFormRunning = true;

        // 🔑 掉登录被弹回登录页时不再继续填表，停窗等待用户手动登录
        if (stopIfXhsLoginPage("fillFormData")) {
            fillFormRunning = false;
            return;
        }

        // 🔴 将所有核心填表逻辑包装在一个函数中，便于外层兜底重试
        const executeAllFormSteps = async () => {
            const titleAndIntro = dataObj.video.video.sendlog;
            // alert(JSON.stringify(titleAndIntro));

            // 填写标题 - 尝试多个可能的选择器
            let titleInput = null;
            const titleSelectors = [".d-input-wrapper .d-input input"];

            // alert('Searching for title input...');
            for (const selector of titleSelectors) {
                try {
                    // alert(`Trying selector: ${selector}`);
                    titleInput = await waitForElement(selector, 5000); // 🔑 增加到 5 秒
                    if (titleInput) {
                        // alert(`✅ Found title input with selector: ${selector}`);
                        break;
                    }
                } catch (error) {
                    // alert(`❌ Selector ${selector} not found, trying next...`);
                }
            }

            if (!titleInput) {
                // alert('⚠️ Title input not found with any selector, skipping title...');
            } else {
                // alert(`Filling title: ${titleAndIntro.title || ''}`);

                try {
                    const titleText = titleAndIntro.title || "";
                    const focusResult = await nativeClickElement(titleInput, {
                        logPrefix: "[小红书发布][标题]",
                        allowJsFallback: false,
                    });
                    if (!focusResult.success) {
                        throw new Error(focusResult.message || "标题输入框原生聚焦失败");
                    }
                    await window.delay(200);

                    titleInput.value = "";
                    const insertResult = await nativeInsertText(titleText, {
                        logPrefix: "[小红书发布][标题]",
                    });
                    if (!insertResult.success) {
                        throw new Error(insertResult.message || "标题原生输入失败");
                    }
                    await window.delay(200);

                    const currentTitle = (titleInput.value || "").trim();
                    if (currentTitle !== titleText.trim()) {
                        throw new Error(`标题原生输入后校验失败: 期望="${titleText.slice(0, 80)}", 实际="${currentTitle.slice(0, 80)}"`);
                    }

                    // alert('✅ Title filled successfully');
                } catch (error) {
                    console.error("[小红书发布] ❌ 标题设置失败:", error.message);
                    throw error;
                }
            }

            // 填写简介 - 尝试多个可能的选择器
            try {
                // 首先检查是否已经填写过（通过全局标记）
                if (introFilled) {
                    // alert('✅ Intro already filled (by flag), skipping');
                    // 直接跳过，不再查找元素或进行任何操作
                } else {
                    let introInput = null;
                    const introSelectors = [".tiptap-container .ProseMirror"];

                    // alert('Searching for intro input...');
                    for (const selector of introSelectors) {
                        try {
                            // alert(`Trying selector: ${selector}`);
                            introInput = await waitForElement(selector, 5000); // 🔑 增加到 5 秒
                            if (introInput) {
                                // alert(`✅ Found intro input with selector: ${selector}`);
                                break;
                            }
                        } catch (error) {
                            // alert(`❌ Selector ${selector} not found, trying next...`);
                        }
                    }

                    if (!introInput) {
                        // alert('⚠️ Intro input not found with any selector, skipping intro...');
                    } else {
                        const targetIntro = titleAndIntro.intro || "";
                        let targetContent = targetIntro.trim();

                        // 检查实际内容
                        const currentContent = (introInput.textContent || introInput.innerText || "").trim();

                        // 检测内容是否有#并且其后跟有文字（提取话题）
                        const topicList = extractAfterHash(targetContent, { all: true, includeHash: true });
                        console.log("🚀 ~ fillFormData ~ topicList: ", topicList);

                        // 如果有话题，先从内容中移除话题文本
                        let cleanedIntro = targetContent;
                        if (topicList.length > 0) {
                            //  删除掉所有话题
                            cleanedIntro = removeHashTags(targetContent);
                        }

                        // 只有在标记未设置且内容不同时才填写
                        if (currentContent !== targetContent) {
                            // 立即标记为已填写（在任何操作之前，防止并发）
                            introFilled = true;

                            const introFocusResult = await nativeClickElement(introInput, {
                                logPrefix: "[小红书发布][简介]",
                                allowJsFallback: false,
                            });
                            if (!introFocusResult.success) {
                                throw new Error(introFocusResult.message || "简介输入框原生聚焦失败");
                            }
                            await window.delay(120);

                            // 清空现有内容，避免累积
                            introInput.innerHTML = "";
                            if (cleanedIntro) {
                                const introInsertResult = await nativeInsertText(cleanedIntro, {
                                    logPrefix: "[小红书发布][简介]",
                                });
                                if (!introInsertResult.success) {
                                    throw new Error(introInsertResult.message || "简介原生输入失败");
                                }
                                await window.delay(200);
                            }

                            // alert('✅ Intro filled successfully');

                            // 单独处理话题
                            if (topicList.length > 0) {
                                const introInput = await waitForElement(".tiptap-container .ProseMirror", 10000); // 🔑 增加到 10 秒
                                for (let topicListElement of topicList) {
                                    const topicFocusResult = await nativeClickElement(introInput, {
                                        logPrefix: "[小红书发布][话题]",
                                        allowJsFallback: false,
                                    });
                                    if (!topicFocusResult.success) {
                                        throw new Error(topicFocusResult.message || "话题输入区原生聚焦失败");
                                    }

                                    await window.delay(100);

                                    const selection = window.getSelection();
                                    const range = document.createRange();
                                    range.selectNodeContents(introInput);
                                    range.collapse(false);
                                    selection.removeAllRanges();
                                    selection.addRange(range);

                                    const spaceInsertResult = await nativeInsertText(" ", {
                                        logPrefix: "[小红书发布][话题]",
                                    });
                                    if (!spaceInsertResult.success) {
                                        throw new Error(spaceInsertResult.message || "话题分隔空格输入失败");
                                    }

                                    const topicInsertResult = await nativeInsertText(topicListElement, {
                                        logPrefix: "[小红书发布][话题]",
                                    });
                                    if (!topicInsertResult.success) {
                                        throw new Error(topicInsertResult.message || "话题文本输入失败");
                                    }

                                    // 等待话题建议列表出现（使用 waitForElement）
                                    try {
                                        const topicSuggest = await waitForElement("#creator-editor-topic-container", 3000);
                                        console.log("🏷️ 话题建议列表已出现:", topicSuggest);

                                        if (topicSuggest) {
                                            // 尝试多种选择器找到话题选项
                                            const selectors = ["#creator-editor-topic-container .item.is-selected", "#creator-editor-topic-container .item:first-child", "#creator-editor-topic-container .item", '#creator-editor-topic-container div[class*="item"]'];

                                            // 轮询等待话题选项出现（因为选项是异步接口返回的）
                                            let firstOption = null;
                                            const maxRetries = 30; // 最多等待3秒（30 * 100ms）
                                            let retryCount = 0;

                                            while (!firstOption && retryCount < maxRetries) {
                                                for (const selector of selectors) {
                                                    firstOption = topicSuggest.querySelector(selector);
                                                    if (firstOption) {
                                                        console.log("🏷️ 找到话题选项，选择器:", selector, "重试次数:", retryCount, firstOption);
                                                        break;
                                                    }
                                                }

                                                if (!firstOption) {
                                                    await window.delay(100);
                                                    retryCount++;
                                                }
                                            }

                                            if (firstOption) {
                                                const optionClickResult = await nativeClickElement(firstOption, {
                                                    logPrefix: "[小红书发布][话题]",
                                                    allowJsFallback: false,
                                                });
                                                if (!optionClickResult.success) {
                                                    throw new Error(optionClickResult.message || "话题选项原生点击失败");
                                                }
                                                console.log("🏷️ 已点击话题选项");
                                                await window.delay(200);
                                            } else {
                                                console.log("🏷️ 未找到话题选项（已重试", retryCount, "次），列表内容:", topicSuggest.innerHTML.substring(0, 500));
                                            }
                                        }
                                    } catch (e) {
                                        console.log("🏷️ 话题建议列表未出现:", e.message);
                                    }
                                }
                            }
                        } else {
                            // 内容已经正确，也标记为已填写
                            introFilled = true;
                            // alert('✅ Intro content already correct, marking as filled');
                        }
                    }
                }
            } catch (error) {
                // alert('⚠️ Intro handling failed: ' + error.message);
            }

            // 设置发布时间
            const publishTime = dataObj.video.formData.send_set;
            if (+publishTime === 2) {
                try {
                    await window.delay(1000);
                    // 定时发布
                    const scheduleRadio = await waitForElement(".publish-page-content-settings-content .post-time-switch-container .custom-switch-switch [type='checkbox']", 3000);
                    if (!scheduleRadio.checked) {
                        const scheduleClickResult = await nativeClickElement(scheduleRadio, {
                            logPrefix: "[小红书发布][定时开关]",
                            allowJsFallback: false,
                        });
                        if (!scheduleClickResult.success) {
                            throw new Error(scheduleClickResult.message || "定时发布开关原生点击失败");
                        }
                        await window.delay(200);
                        if (!scheduleRadio.checked) {
                            throw new Error("定时发布开关点击后未生效");
                        }
                    }

                    // 设置日期时间
                    await window.delay(1000);
                    const sendTime = dataObj.video?.formData?.send_time;
                    const publishId = dataObj.video.dyPlatform.id;
                    const timeSelectSuccess = await selectScheduledTime(sendTime, publishId);
                    if (!timeSelectSuccess) {
                        console.error("[小红书发布] ❌ 时间选择失败");
                        await closeWindowWithMessage("定时时间选择失败", 1000);
                    }
                    // 🔑 定时发布流程已在 selectScheduledTime 内完成（上报+关闭窗口），直接 return
                    return;
                } catch (error) {
                    console.error("[小红书发布] ❌ 定时发布流程出错:", error);
                    const errPublishId = dataObj?.video?.dyPlatform?.id;
                    if (errPublishId) {
                        await sendStatisticsError(errPublishId, error.message || "定时发布流程出错", "小红书发布");
                    }
                    await closeWindowWithMessage("定时发布失败，刷新数据", 1000);
                    return;
                }
            }

            // 等待表单填写完成
            await window.delay(6000);

            // 即时发布
            await publishApi(dataObj);
        };
        // ===== 原有逻辑结束 =====

        // 🔴 最外层兜底重试：即使单步骤重试都失败，外层还会重试整个流程2次
        try {
            await retryOperation(executeAllFormSteps, 2, 3000);
            console.log('[小红书发布] ✅ 所有表单填写完成');
        } catch (finalError) {
            console.error('[小红书发布] ❌ 填表流程失败（外层重试2次后）:', finalError);
            // 🔑 失败原因若是被弹回登录页，不上报失败、不关窗，停窗等待用户手动登录续发
            if (stopIfXhsLoginPage("fillFormData-final-catch")) {
                return;
            }
            stopErrorListener?.();
            const publishId = dataObj?.video?.dyPlatform?.id;
            if (publishId) {
                await sendStatisticsError(publishId, finalError.message || '填写表单失败', '小红书发布');
            }
            await closeWindowWithMessage('填写表单失败，刷新数据', 1000);
        } finally {
            // 无论成功还是失败，都重置标记
            fillFormRunning = false;
        }
    }

    /**
     * 选择定时发布的日期和时间
     * @param sendTime
     * @param publishId
     */
    async function selectScheduledTime(sendTime, publishId) {
        console.log("🚀 ~ selectScheduledTime ~ sendTime: ", sendTime);
        console.log("🚀 ~ selectScheduledTime ~ publishId: ", publishId);
        try {
            const modal = document.querySelector(".date-picker-container");
            if (!modal) {
                console.error("[小红书发布] ❌ 找不到定时发布弹窗");
                return false;
            }

            // 解析目标日期时间
            const [datePart, timePart] = sendTime.split(" ");
            const [year, month, day] = datePart.split("-");
            console.log("🚀 ~ selectScheduledTime ~ day: ", day);

            await delay(1000);

            // 1. 点击日期输入框打开日历（轮询等待渲染）
            let dateInput = modal.querySelector(".d-datepicker-content");
            if (!dateInput) {
                console.error("[小红书发布] ❌ 找不到日期输入框");
                return false;
            }
            console.log("[小红书发布] 🔧 开始选择定时发布时间...");

            // 仅在中心点不在视口内时做最小必要滚动，避免无意义位移
            const dateInputDidScroll = typeof window.scrollElementIntoViewIfNeeded === "function"
                ? window.scrollElementIntoViewIfNeeded(dateInput, {
                    margin: 12,
                    behavior: "instant",
                    block: "nearest",
                    inline: "nearest",
                })
                : false;
            await delay(dateInputDidScroll ? 500 : 120);

            // 使用原生可信点击（isTrusted=true），绕过 Vue 组件的事件检查
            const rect = dateInput.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            // 诊断：检查该坐标实际命中的元素
            const hitEl = document.elementFromPoint(cx, cy);
            console.log("[小红书发布] 🔍 nativeClick 坐标:", cx, cy, "命中元素:", hitEl?.tagName, hitEl?.className?.substring?.(0, 80));
            const clickResult = await window.browserAPI.nativeClick(cx, cy);
            console.log("[小红书发布] 🔍 nativeClick 返回:", JSON.stringify(clickResult));

            // 轮询等待日历弹出（最多 4s）
            let picker = null;
            for (let i = 0; i < 20; i++) {
                picker = document.querySelector(".post-time-date-picker-popover-class");
                if (picker) {
                    console.log("[小红书发布] ✅ 日历已弹出");
                    break;
                }
                await delay(200);
            }

            if (!picker) {
                console.error("[小红书发布] ❌ 找不到日期选择器");
                console.log("[小红书发布] 🔍 modal outerHTML:", modal.outerHTML.substring(0, 2000));
                return false;
            }

            // 2. 导航到目标月份（处理跨月情况）
            for (let i = 0; i < 24; i++) {
                // 最多尝试24个月
                // 小红书日期选择器: 年份和月份是两个独立的 <h6> 元素
                const headerH6s = picker.querySelectorAll(".d-datepicker-header-main h6");
                if (headerH6s.length < 2) {
                    console.error("[小红书发布] ❌ 找不到年月显示元素, 找到", headerH6s.length, "个 h6");
                    break;
                }

                const yearMatch = headerH6s[0].textContent.trim().match(/(\d+)/);
                const monthMatch = headerH6s[1].textContent.trim().match(/(\d+)/);
                if (!yearMatch || !monthMatch) {
                    console.error("[小红书发布] ❌ 无法解析年月:", headerH6s[0].textContent, headerH6s[1].textContent);
                    break;
                }

                const currYear = parseInt(yearMatch[1], 10);
                const currMonth = parseInt(monthMatch[1], 10);
                console.log(`[小红书发布] 📅 当前显示: ${currYear}-${currMonth}, 目标: ${year}-${month}`);

                if (currYear === parseInt(year) && currMonth === parseInt(month)) {
                    console.log("[小红书发布] ✅ 已到达目标月份");
                    break; // 已到达目标月份
                }

                // 判断需要前进还是后退
                const targetDate = new Date(year, month - 1);
                const currentDate = new Date(currYear, currMonth - 1);

                if (targetDate > currentDate) {
                    // 点击下一月 > (.d-datepicker-header 的第4个子元素，索引3)
                    const headerChildren = picker.querySelectorAll(".d-datepicker-header > *");
                    const nextBtn = headerChildren[3]; // 索引3 = 下一月按钮
                    if (nextBtn) {
                        const nextClickResult = await nativeClickElement(nextBtn, {
                            logPrefix: "[小红书发布][日期翻月]",
                            allowJsFallback: false,
                        });
                        if (!nextClickResult.success) {
                            throw new Error(nextClickResult.message || "点击下一月失败");
                        }
                        console.log("[小红书发布] ➡️ 点击下一月");
                    }
                } else {
                    // 点击上一月 < (.d-datepicker-header 的第2个子元素，索引1)
                    const headerChildren = picker.querySelectorAll(".d-datepicker-header > *");
                    const prevBtn = headerChildren[1]; // 索引1 = 上一月按钮
                    if (prevBtn) {
                        const prevClickResult = await nativeClickElement(prevBtn, {
                            logPrefix: "[小红书发布][日期翻月]",
                            allowJsFallback: false,
                        });
                        if (!prevClickResult.success) {
                            throw new Error(prevClickResult.message || "点击上一月失败");
                        }
                        console.log("[小红书发布] ⬅️ 点击上一月");
                    }
                }
                await delay(200);
            }
            await delay(200);

            // 3. 选择日期 - 找到目标日期的 td 并点击
            let dateSelected = false;
            const allDayCells = picker.querySelectorAll(".d-datepicker-cell");
            console.log(`[小红书发布] 📅 找到 ${allDayCells.length} 个日期单元格`);

            for (const td of allDayCells) {
                // 跳过不可选的日期（有 disabled 类，表示过去的日期）
                if (td.classList.contains("disabled")) continue;

                // 跳过非当前月份的日期（上月/下月的灰色日期）
                if (td.classList.contains("--color-text-placeholder")) continue;

                // 从 .d-datepicker-cell-main 获取日期数字
                let dayText = "";
                const cellMain = td.querySelector(".d-datepicker-cell-main");
                if (cellMain) {
                    dayText = cellMain.textContent.trim();
                }
                // 兜底：直接从 td 获取
                if (!dayText || isNaN(parseInt(dayText, 10))) {
                    dayText = td.textContent.trim();
                }

                const dayNum = parseInt(dayText, 10);
                const targetDay = parseInt(day, 10);
                console.log(`[小红书发布] 📅 检查日期: text="${dayText}", dayNum=${dayNum}, targetDay=${targetDay}, match=${dayNum === targetDay}`);

                if (!isNaN(dayNum) && dayNum === targetDay) {
                    const dayClickResult = await nativeClickElement(td, {
                        logPrefix: "[小红书发布][日期选择]",
                        allowJsFallback: false,
                    });
                    if (!dayClickResult.success) {
                        throw new Error(dayClickResult.message || "点击日期失败");
                    }
                    dateSelected = true;
                    console.log(`[小红书发布] ✅ 选择日期: ${year}-${month}-${day}`);
                    break;
                }
            }

            if (!dateSelected) {
                console.error(`[小红书发布] ❌ 未能选择日期 ${day} 号`);
            }
            await delay(300);

            // 4. 设置时间 - 点击时间输入框打开下拉，然后选择小时和分钟
            const [hour, minute] = timePart.split(":");
            console.log(`[小红书发布] ⏰ 目标时间: ${hour}:${minute}`);

            const timebars = document.querySelectorAll(".d-timepicker-body .d-timepicker-timebar");
            console.log(`[小红书发布] ⏰ 找到 ${timebars.length} 个时间滚动列表`);

            for (let i = 0; i < timebars.length; i++) {
                const targetValue = i === 0 ? hour : minute;
                const targetNum = parseInt(targetValue, 10);
                const timeItems = timebars[i].querySelectorAll(".d-timepicker-time.d-clickable");
                console.log(`[小红书发布] ⏰ 时间栏${i} 共 ${timeItems.length} 个选项，目标值: ${targetValue}`);

                let matched = false;
                for (const item of timeItems) {
                    const itemText = item.textContent.trim();
                    const itemNum = parseInt(itemText, 10);
                    if (!isNaN(itemNum) && itemNum === targetNum) {
                        const timeClickResult = await nativeClickElement(item, {
                            logPrefix: "[小红书发布][时间选择]",
                            allowJsFallback: false,
                        });
                        if (!timeClickResult.success) {
                            throw new Error(timeClickResult.message || "点击时间项失败");
                        }
                        matched = true;
                        console.log(`[小红书发布] ✅ 选择${i === 0 ? "小时" : "分钟"}: ${itemText}`);
                        break;
                    }
                }
                if (!matched) {
                    console.warn(`[小红书发布] ⚠️ 未匹配到${i === 0 ? "小时" : "分钟"}: ${targetValue}`);
                }
                await delay(300);
            }
            await delay(200);

            // 点击定时发布按钮（新版小红书没有单独的确认按钮，直接点击主发布按钮）
            const publishBtn = findXhsPublishButton();
            if (publishBtn) {
                console.log("[小红书发布] ⏰ publishId:", publishId);

                // 点击发布按钮
                const clickResult = await clickWithTrustedRetry(publishBtn, 3, 500, true); // 启用可信点击和消息捕获
                if (!clickResult.success) {
                    console.error("[小红书发布] ❌ 所有点击尝试均失败:", clickResult.message);
                    await sendStatisticsError(publishId, clickResult.message || "点击发布按钮失败", "小红书发布");
                    return false;
                }
                console.log("[小红书发布] ✅ 已点击定时发布按钮");

                // 等待 2 秒，检测是否有错误提示
                await delay(2000);

                // 检测是否有错误提示（如果有错误，不发送统计）
                let hasError = false;
                try {
                    const errorSelectors = [
                        ".d-toast-description",  // toast 提示
                        ".d-message-content",    // 消息提示
                        ".error-message",        // 错误消息
                    ];

                    for (const selector of errorSelectors) {
                        const errorEl = document.querySelector(selector);
                        if (errorEl) {
                            const errorText = (errorEl.textContent || "").trim();
                            // 过滤掉成功消息
                            const successKeywords = ["成功", "提交成功", "发布成功"];
                            const isSuccess = successKeywords.some(keyword => errorText.includes(keyword));
                            if (errorText && !isSuccess) {
                                hasError = true;
                                console.error("[小红书发布] ❌ 检测到错误提示:", errorText);
                                break;
                            }
                        }
                    }
                } catch (e) {
                    console.log("[小红书发布] ⚠️ 错误检测失败:", e);
                }

                // 如果没有错误，发送统计请求
                if (!hasError && publishId) {
                    try {
                        if (typeof sendStatistics !== "function") {
                            throw new Error("sendStatistics 未定义，无法执行去重统计上报");
                        }

                        const statResult = await sendStatistics(publishId, "小红书发布");
                        if (statResult?.skipped) {
                            console.log("[小红书发布] ⏭️ 定时发布统计已由其它页面上报，跳过重复记录:", statResult.reason);
                        } else if (statResult?.success) {
                            console.log("[小红书发布] ✅ 定时发布统计上报成功");
                        } else {
                            console.error("[小红书发布] ❌ 定时发布统计上报未确认:", statResult?.error || statResult);
                        }
                    } catch (e) {
                        console.error("[小红书发布] ❌ 统计上报失败:", e);
                    }
                } else if (hasError) {
                    console.error("[小红书发布] ❌ 检测到错误，不发送统计");
                } else {
                    console.error("[小红书发布] ❌ publishId 为空，无法上报统计");
                }

                // 清除保存的标记（避免 publish-success.js 重复处理）
                try {
                    const wid = await window.browserAPI?.getWindowId();
                    if (wid) {
                        localStorage.removeItem(`PUBLISH_SUCCESS_DATA_${wid}`);
                        await window.browserAPI?.removeGlobalData?.(`PUBLISH_SUCCESS_DATA_${wid}`);
                        console.log("[小红书发布] 🗑️ 已清除发布标记");
                    }
                } catch (e) {
                    // 忽略清除失败
                }

                // 等待一小段时间让统计请求发送出去
                await delay(500);

                // 关闭窗口
                await closeWindowWithMessage("发布成功，刷新数据", 1000);
                return true;
            } else {
                console.error("[小红书发布] ❌ 未找到发布按钮");
            }
            return false;
        } catch (error) {
            console.error("[小红书发布] ❌ selectScheduledTime 错误:", error);
            return false;
        }
    }
} // end of published=true guard
