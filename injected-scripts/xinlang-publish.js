/**
 * 新浪创作者平台发布脚本
 * 用于处理发布流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
    "use strict";

    // ===========================
    // 防止脚本重复注入（但消息监听器需要每次注册）
    // ===========================
    const isFirstLoad = !window.__XL_SCRIPT_LOADED__;

    if (window.__XL_SCRIPT_LOADED__) {
        console.log("[新浪发布] ⚠️ 脚本已经加载过，但仍需注册消息监听器");
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

    // 变量声明（只在第一次加载时初始化）
    if (isFirstLoad) {
        window.__XL_fillFormRunning = false; // 标记 fillFormData 是否正在执行
        window.__XL_isProcessing = false; // 防重复标志
        window.__XL_hasProcessed = false; // 防重复标志
        window.__XL_introFilled = false; // 简介填写标志
        window.__XL_receivedMessageData = null; // 保存收到的父窗口消息
        window.__XL_currentWindowId = null; // 当前窗口 ID
    }

    // 使用 window 上的变量（兼容多次注入）
    let fillFormRunning = window.__XL_fillFormRunning;
    let isProcessing = window.__XL_isProcessing;
    let hasProcessed = window.__XL_hasProcessed;
    let introFilled = window.__XL_introFilled;
    let receivedMessageData = window.__XL_receivedMessageData;
    let currentWindowId = window.__XL_currentWindowId;

    // 同步回 window 的辅助函数
    const syncToWindow = () => {
        window.__XL_fillFormRunning = fillFormRunning;
        window.__XL_isProcessing = isProcessing;
        window.__XL_hasProcessed = hasProcessed;
        window.__XL_introFilled = introFilled;
        window.__XL_receivedMessageData = receivedMessageData;
        window.__XL_currentWindowId = currentWindowId;
    };

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
                selectors: [{
                    containerClass: "n-message--error-type",
                    textSelector: ".n-message__content",
                    recursiveSelector: ".n-message--error-type"
                }],
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
    // 🔴 验证页返回检测：检查是否有保存的发布数据（说明点击过发布按钮后跳转到了验证页）
    // ===========================
    // 先获取窗口 ID（赋值给 currentWindowId，后面的代码也会用到）
    try {
        currentWindowId = await window.browserAPI?.getWindowId?.();
        window.__XL_currentWindowId = currentWindowId; // 同步到 window
        console.log("[新浪发布] 🔑 当前窗口 ID:", currentWindowId);
    } catch (e) {
        console.error("[新浪发布] ❌ 获取窗口 ID 失败:", e);
    }

    // 检查 globalData 中是否有保存的发布数据
    let savedData = null;
    if (currentWindowId && window.browserAPI?.getGlobalData) {
        try {
            savedData = await window.browserAPI.getGlobalData(`PUBLISH_SUCCESS_DATA_${currentWindowId}`);
            console.log("[新浪发布] 📦 检查保存的发布数据:", savedData);

            // 🔴 检查数据是否过期（超过 15 分钟就认为无效，增加时间以支持多次验证）
            if (savedData && savedData.timestamp) {
                const dataAge = Date.now() - savedData.timestamp;
                const maxAge = 15 * 60 * 1000; // 15 分钟（原来是5分钟，现在增加到15分钟）
                if (dataAge > maxAge) {
                    console.log("[新浪发布] ⏰ 保存的发布数据已过期（" + Math.round(dataAge / 1000) + "秒），清除并忽略");
                    await window.browserAPI.removeGlobalData(`PUBLISH_SUCCESS_DATA_${currentWindowId}`);
                    savedData = null;
                }
            } else if (savedData && !savedData.timestamp) {
                // 旧格式数据没有时间戳，直接清除
                console.log("[新浪发布] ⚠️ 保存的发布数据没有时间戳，清除并忽略");
                await window.browserAPI.removeGlobalData(`PUBLISH_SUCCESS_DATA_${currentWindowId}`);
                savedData = null;
            }
        } catch (e) {
            console.error("[新浪发布] ❌ 获取保存的发布数据失败:", e);
        }
    }

    // 如果有保存的数据，说明是从验证页返回的，等待发布弹窗出现并处理
    // 🔑 防止主流程和验证页返回流程同时执行，导致验证页跳转两次
    if (savedData && savedData.publishId && !window.__xinlangPublishInitiated) {
        console.log("[新浪发布] 🔄 检测到保存的发布数据，可能是从验证页返回，等待发布弹窗...");

        const {publishId, publishTime, sendTime} = savedData;
        console.log("[新浪发布] 📋 发布类型:", publishTime === 2 ? "定时发布" : "即时发布");
        console.log("[新浪发布] 📋 publishId:", publishId);
        console.log("[新浪发布] 📋 sendTime:", sendTime);

        // 等待发布弹窗出现（最多等 60 秒，给用户更多时间）
        console.log("[新浪发布] ⏳ 开始等待发布弹窗（最多60秒）...");
        const existingDialog = await waitForElement('.n-dialog', 60000, 500);
        if (existingDialog) {
            console.log("[新浪发布] ✅ 发布弹窗已出现，继续发布流程...");

            try {
                // 增加等待时间，确保弹窗内容完全加载
                await delay(1000);

                // 🔴 先判断弹窗类型：通过检测 .publish-modal 类名
                const isPublishModal = existingDialog.classList.contains('publish-modal') ||
                    existingDialog.querySelector('.publish-modal');
                console.log("[新浪发布] 🔍 是否是发布确认弹窗 (.publish-modal):", !!isPublishModal);

                // 如果不是发布确认弹窗，需要继续执行填充数据
                if (!isPublishModal) {
                    console.log("[新浪发布] 📝 检测到非发布确认弹窗，继续执行填充数据...");

                    // 清除保存的数据，避免重复处理
                    try {
                        await window.browserAPI?.removeGlobalData?.(`PUBLISH_SUCCESS_DATA_${currentWindowId}`);
                    } catch (e) {
                    }

                    // 🔴 再次检测页面状态，根据编辑元素判断是否需要点击"写文章"
                    await delay(1000);
                    const titleInput = document.querySelector('input[placeholder*="标题"], textarea[placeholder*="标题"]');
                    const editor = document.querySelector('.wb-editor, [contenteditable="true"]');
                    const toolbar = document.querySelector('[class*="toolbar"], [class*="editor-tool"]');
                    const hasEditableElements = titleInput || editor || toolbar;

                    console.log("[新浪发布] 🔍 验证页返回后检测页面状态: 编辑元素=", !!hasEditableElements);

                    if (!hasEditableElements) {
                        // 没有编辑元素，说明需要点击"写文章"
                        console.log("[新浪发布] 📝 页面处于预览状态，尝试点击写文章按钮...");

                        const allButtons = document.querySelectorAll('button');
                        for (const btn of allButtons) {
                            const text = btn.textContent.trim();
                            if (text.includes('写文章')) {
                                console.log("[新浪发布] ✅ 找到写文章按钮，准备点击...");
                                btn.click();
                                await delay(2000);
                                break;
                            }
                        }
                    }

                    // 继续执行填充数据
                    try {
                        await retryOperation(async () => await fillFormData(savedData), 3, 2000);
                    } catch (e) {
                        console.log("[新浪发布] ❌ 填写表单数据失败:", e);
                    }

                    return;
                }

                // 如果是发布确认弹窗，需要点击发布按钮
                console.log("[新浪发布] 🔍 检测到发布确认弹窗，查找发布按钮...");

                // 🔴 改进按钮查找逻辑：优先使用原选择器，失败时采用备用选择器
                let publishBtnArea = existingDialog.querySelector('.n-mention + div .items-center:nth-of-type(2)');

                // 备用选择器1：查找所有 items-center 并选择最后一个（通常是操作区）
                if (!publishBtnArea) {
                    const itemsCenters = existingDialog.querySelectorAll('.items-center');
                    if (itemsCenters.length > 0) {
                        publishBtnArea = itemsCenters[itemsCenters.length - 1];
                        console.log("[新浪发布] 🔍 使用备用选择器1：最后一个 .items-center");
                    }
                }

                // 备用选择器2：查找所有按钮
                if (!publishBtnArea) {
                    const allBtns = existingDialog.querySelectorAll('button');
                    if (allBtns.length > 0) {
                        publishBtnArea = existingDialog;
                        console.log("[新浪发布] 🔍 使用备用选择器2：对话框本身");
                    }
                }

                console.log("[新浪发布] 🔍 发布按钮操作区:", publishBtnArea);
                if (!publishBtnArea) {
                    console.log('[新浪发布]：找不到发布按钮操作区');
                }

                if (+publishTime === 2) {
                    // 定时发布
                    let timedReleaseButton = publishBtnArea.querySelector('.svg-icon');

                    // 如果找不到 svg-icon，尝试查找 icon 按钮
                    if (!timedReleaseButton) {
                        const iconBtns = publishBtnArea.querySelectorAll('button');
                        for (let btn of iconBtns) {
                            if (btn.querySelector('svg') && !btn.textContent.trim().includes('发布')) {
                                timedReleaseButton = btn;
                                break;
                            }
                        }
                    }

                    console.log("[新浪发布] 🔍 定时发布按钮:", timedReleaseButton);
                    if (!timedReleaseButton) {
                        console.log('[新浪发布]：找不到定时发布按钮');
                    }

                    // 🔴 在点击前重新保存数据（以防再次跳转验证页）
                    console.log("[新浪发布] 💾 重新保存发布数据（以防再次跳转验证页）...");
                    await window.browserAPI.setGlobalData(`PUBLISH_SUCCESS_DATA_${currentWindowId}`, {
                        publishId: publishId,
                        publishTime: publishTime,
                        sendTime: sendTime,
                        timestamp: Date.now()
                    });

                    timedReleaseButton.dispatchEvent(new MouseEvent("click", {
                        view: window,
                        bubbles: true,
                        cancelable: true
                    }));
                    console.log("[新浪发布] ✅ 已点击定时发布（验证页返回后）");

                    if (!sendTime) {
                        console.error("[新浪发布] ❌ 定时时间丢失");
                        await closeWindowWithMessage("定时时间解析失败", 1000);
                        return;
                    }

                    console.log("[新浪发布] ⏰ 开始选择定时发布时间:", sendTime);
                    const timeSelectSuccess = await selectScheduledTime(sendTime);
                    if (!timeSelectSuccess) {
                        console.error("[新浪发布] ❌ 时间选择失败");
                        await closeWindowWithMessage("定时时间选择失败", 1000);
                        return;
                    }
                } else {
                    // 即时发布
                    const publishButtons = publishBtnArea.querySelectorAll('button');
                    console.log("[新浪发布] 🔍 找到的按钮数量:", publishButtons.length);
                    let publishButton = null;
                    for (let btn of publishButtons) {
                        const btnText = btn.textContent.trim();
                        console.log("[新浪发布] 🔍 按钮文本:", btnText);
                        if (btnText === '发布') {
                            publishButton = btn;
                            break;
                        }
                    }
                    if (!publishButton) {
                        console.log('[新浪发布]：找不到发布按钮（文本为"发布"的button）');
                    }

                    // 🔴 在点击前重新保存数据（以防再次跳转验证页）
                    console.log("[新浪发布] 💾 重新保存发布数据（以防再次跳转验证页）...");
                    await window.browserAPI.setGlobalData(`PUBLISH_SUCCESS_DATA_${currentWindowId}`, {
                        publishId: publishId,
                        publishTime: publishTime,
                        sendTime: sendTime,
                        timestamp: Date.now()
                    });

                    publishButton.dispatchEvent(new MouseEvent("click", {
                        view: window,
                        bubbles: true,
                        cancelable: true
                    }));
                    console.log("[新浪发布] ✅ 已点击即时发布（验证页返回后）");

                    await delay(1000);
                    console.log("[新浪发布] 📤 即时发布提交成功，准备上报统计...");

                    if (publishId) {
                        try {
                            const successUrl = await getStatisticsUrl();
                            const scanData = {data: JSON.stringify({id: publishId})};
                            await fetch(successUrl, {
                                method: "POST",
                                headers: {"Content-Type": "application/json"},
                                body: JSON.stringify(scanData),
                            });
                            console.log("[新浪发布] ✅ 即时发布统计上报成功");
                        } catch (e) {
                            console.error("[新浪发布] ❌ 统计上报失败:", e);
                        }
                    }

                    // 清除保存的标记
                    try {
                        localStorage.removeItem(`PUBLISH_SUCCESS_DATA_${currentWindowId}`);
                        await window.browserAPI?.removeGlobalData?.(`PUBLISH_SUCCESS_DATA_${currentWindowId}`);
                        console.log("[新浪发布] 🗑️ 已清除发布标记");
                    } catch (e) {
                        // 忽略清除失败
                    }

                    await closeWindowWithMessage("发布成功，刷新数据", 1000);
                }

                return; // 已处理完，退出脚本
            } catch (e) {
                console.error("[新浪发布] ❌ 验证页返回后处理失败:", e);
                // 清除保存的数据，避免下次重试时又走这个流程
                try {
                    await window.browserAPI?.removeGlobalData?.(`PUBLISH_SUCCESS_DATA_${currentWindowId}`);
                } catch (e2) {
                }
                await closeWindowWithMessage("发布失败，刷新数据", 1000);
                return;
            }
        } else {
            console.log("[新浪发布] ⚠️ 等待发布弹窗超时，清除保存的数据，继续正常流程");
            // 清除保存的数据
            try {
                await window.browserAPI?.removeGlobalData?.(`PUBLISH_SUCCESS_DATA_${currentWindowId}`);
            } catch (e) {
            }
        }
    }

    // ===========================
    // 🔴 草稿详情页检测：自动点击"写文章"按钮创建新文章
    // 通过检查是否有输入元素来判断是预览页还是编辑页
    // ===========================
    const currentHash = window.location.hash;
    if (currentHash.match(/#\/draft/)) {
        // 🔑 检查是否已经点击过（防止重复点击导致死循环）
        if (window.__XL_WRITE_BTN_CLICKED__) {
            console.log("[新浪发布] ⏭️ 已经点击过写文章按钮，跳过");
        } else {
            // 等待页面完全加载
            await new Promise(r => setTimeout(r, 2000));

            // 检查是否有编辑器相关元素（多种检测方式）
            const titleInput = document.querySelector('input[placeholder*="标题"], textarea[placeholder*="标题"]');
            const editor = document.querySelector('.wb-editor, [contenteditable="true"]');
            // 编辑器工具栏
            const toolbar = document.querySelector('[class*="toolbar"], [class*="editor-tool"]');
            // 编辑页面特有的按钮：保存草稿、预览、下一步
            const editPageBtns = document.querySelectorAll('button');
            let hasEditPageBtn = false;
            for (const btn of editPageBtns) {
                const text = btn.textContent.trim();
                if (text === '保存草稿' || text === '预览' || text === '下一步') {
                    hasEditPageBtn = true;
                    break;
                }
            }

            const hasEditableElements = titleInput || editor || toolbar || hasEditPageBtn;

            console.log("[新浪发布] 🔍 检测页面状态: 标题输入框=", !!titleInput, ", 编辑器=", !!editor, ", 工具栏=", !!toolbar, ", 编辑按钮=", hasEditPageBtn);

            if (!hasEditableElements) {
                // 没有输入元素，说明是草稿预览页，需要点击"写文章"
                console.log("[新浪发布] 📝 检测到草稿预览页（无输入元素），尝试点击写文章按钮...");

                // 查找"写文章"按钮
                let writeBtn = null;
                const allButtons = document.querySelectorAll('button');
                console.log("[新浪发布] 🔍 找到", allButtons.length, "个 button 元素");

                for (const btn of allButtons) {
                    const text = btn.textContent.trim();
                    if (text.includes('写文章')) {
                        writeBtn = btn;
                        console.log("[新浪发布] ✅ 匹配到写文章按钮:", text);
                        break;
                    }
                }

                if (writeBtn) {
                    // 🔑 标记已点击，防止重复
                    window.__XL_WRITE_BTN_CLICKED__ = true;

                    console.log("[新浪发布] ✅ 找到写文章按钮，准备点击...");
                    writeBtn.click();
                    console.log("[新浪发布] ✅ 已点击写文章按钮");

                    // 等待跳转到新文章页面
                    await new Promise(r => setTimeout(r, 2000));
                    console.log("[新浪发布] ✅ 点击后当前 URL:", window.location.href);
                } else {
                    console.warn("[新浪发布] ⚠️ 未找到写文章按钮");
                }
            } else {
                console.log("[新浪发布] ✅ 已在编辑页面（有输入元素），无需点击写文章按钮");
            }
        }
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

        // 🔴 使用全局锁防止并发执行
        if (window.__XL_fillFormRunning) {
            console.log("[新浪发布] ⚠️ fillFormData 已在运行，忽略重复调用");
            return;
        }

        // 设置全局锁
        window.__XL_fillFormRunning = true;
        fillFormRunning = true;

        // 原有的防止重复执行检查
        if (hasProcessed) {
            console.log("[新浪发布] ⚠️ 已处理过，跳过");
            window.__XL_fillFormRunning = false;
            fillFormRunning = false;
            return;
        }

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

            // 🔴 注意：不在这里点击"写文章"按钮
            // 点击逻辑已在脚本初始化时执行（287-352行）
            // 避免重复点击导致创建多个空草稿

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
                    if (titleEles.length > 0) {
                        // 找到titleEles中placeholder包括标题的元素
                        for (const titleEle of titleEles) {
                            if (titleEle.placeholder.includes("标题")) {
                                try {
                                    // 🔴 检查标题是否已填写（防止从验证页返回时重复填写）
                                    const currentValue = (titleEle.value || '').trim();
                                    const targetTitle = dataObj.video.video.title || '';
                                    const expectedValue = targetTitle.trim();

                                    if (currentValue === expectedValue && currentValue) {
                                        console.log('[新浪发布] ⏭️ 标题已填写过，跳过:', currentValue);
                                        break; // 跳过标题填写
                                    }

                                    // 先触发focus事件
                                    if (typeof titleEle.focus === 'function') {
                                        titleEle.focus();
                                    } else {
                                        titleEle.dispatchEvent(new Event('focus', {bubbles: true}));
                                    }

                                    // 延迟执行，让React状态稳定
                                    await new Promise(resolve => setTimeout(resolve, 300));

                                    setNativeValue(titleEle, expectedValue);

                                    // 额外触发input事件
                                    titleEle.dispatchEvent(new Event('input', {bubbles: true}));

                                    // 等待 React 更新
                                    await new Promise(resolve => setTimeout(resolve, 200));

                                    // 🔑 验证是否成功设置
                                    const verifyValue = (titleEle.value || '').trim();
                                    if (verifyValue !== expectedValue) {
                                        console.log(`标题设置失败: 期望"${expectedValue}", 实际"${verifyValue}"`);
                                    }

                                    console.log('[新浪发布] ✅ 标题设置成功:', verifyValue);
                                } catch (e) {
                                    console.log("[新浪发布] ❌ 设置标题失败:", e);
                                    throw e; // 🔑 重新抛出错误以便 retryOperation 重试
                                }
                            } else if (titleEle.placeholder.includes("导语")) {
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
                                            introEle.dispatchEvent(new Event('focus', {bubbles: true}));
                                        }

                                        // 延迟执行，让React状态稳定
                                        await new Promise(resolve => setTimeout(resolve, 300));

                                        setNativeValue(introEle, dataObj.video.video.intro);

                                        // 额外触发input事件
                                        introEle.dispatchEvent(new Event('input', {bubbles: true}));

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

                                // 🔴 检查编辑器是否已有内容（防止从验证页返回时重复填写）
                                // 注意：必须检查 textContent 而不是 innerHTML，因为编辑器可能包含空白 HTML 标签
                                const editorText = (editorEle.textContent || '').trim();
                                if (editorText && editorText.length > 0) {
                                    console.log('[新浪发布] ⏭️ 编辑器已有内容（' + editorText.length + '字），跳过内容填写');
                                    return;
                                }

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
                        const {blob, contentType} = await downloadFile(pathImage, "image/png");
                        var file = new File([blob], dataObj?.video?.formData?.title + ".png", {type: contentType || "image/png"});
                        // 选中本地上传（点击"选择封面"按钮）
                        await delay(1000);

                        // 等待封面选择区域出现
                        const coverPreview = document.querySelector(".cover-preview");
                        await delay(500); // 等待渲染完成
                        try {
                            if (coverPreview) {
                                // 查找并点击"替换封面图"按钮
                                const coverBtns = document.querySelectorAll(".cover-preview span");
                                console.log("🚀 ~  ~ coverBtns: ", coverBtns);
                                if (!coverBtns || coverBtns.length === 0) {
                                    console.log('[新浪发布]：找不到替换封面按钮');
                                }
                                let coverChangeBtn = null;
                                for (let coverBtn of coverBtns) {
                                    const coverBtnText = coverBtn.textContent.trim();
                                    if (coverBtnText.includes("替换封面图")) {
                                        coverChangeBtn = coverBtn;
                                    }
                                }
                                console.log("🚀 ~  ~ coverChangeBtn: ", coverChangeBtn);
                                if (!coverChangeBtn) {
                                    console.log('[新浪发布]：找不到替换封面按钮');
                                }
                                coverChangeBtn.click();

                            } else {
                                const uploadBtn = document.querySelector(".cover-empty");
                                if (!uploadBtn) {
                                    console.log('[新浪发布]：找不到封面按钮');
                                }
                                uploadBtn.click();
                            }
                        } catch (e) {
                            console.log("[新浪发布] 未找到替换封面图按钮，尝试查找选择封面按钮...");
                            const uploadBtn = document.querySelector(".cover-empty");
                            if (!uploadBtn) {
                                console.log('[新浪发布]：找不到封面按钮（既没有替换封面图按钮，也没有选择封面按钮）');
                            }
                            uploadBtn.click();
                        }

                        // 等待上传封面弹窗出现（使用 waitForElement）
                        console.log("[新浪发布] ⏳ 等待上传封面弹窗出现...");
                        const uploadModal = await waitForElement(".n-dialog", 10000, 500);
                        console.log("🚀 ~  ~ uploadModal: ", uploadModal);
                        if (!uploadModal) {
                            console.log('[新浪发布]：上传封面弹窗未出现（等待10秒超时）')
                        }

                        await delay(1000);
                        //    选择本地上传（带重试）
                        const tabs = uploadModal.querySelectorAll(".n-tabs-tab__label");
                        console.log("🚀 ~  ~ tabs: ", tabs, "数量:", tabs?.length);
                        let localTab = null;

                        if (tabs && tabs.length > 0) {
                            for (let tab of tabs) {
                                const tabText = tab.textContent.trim();
                                console.log("[新浪发布] 检查标签:", tabText);
                                if (tabText.includes("图片库")) {
                                    // 尝试多种点击方式
                                    localTab = tab;
                                }
                            }
                        }

                        if (localTab) {
                            localTab.dispatchEvent(new MouseEvent('click', {
                                bubbles: true,
                                cancelable: true,
                                view: window
                            }));

                            console.log("[新浪发布] ✅ 已点击图片库标签");

                            await delay(3000);

                            // 清空所有上传了的图片
                            // 🔴 上传前清空所有旧文件，确保只上传新文件
                            console.log('[新浪发布] 🧹 清空旧文件...');
                            const uploadList = uploadModal.querySelectorAll(".image-item");
                            console.log("🚀 ~  ~ uploadList: ", uploadList, "数量:", uploadList?.length);
                            if (uploadList && uploadList.length > 0) {
                                for (let uploadItem of uploadList) {
                                    const uploadItemBtn = uploadItem.querySelector(".ico_delpic");
                                    if (uploadItemBtn) {
                                        // 🔴 模拟完整的鼠标交互序列
                                        uploadItem.dispatchEvent(new MouseEvent('mouseenter', {
                                            bubbles: true,
                                            cancelable: true,
                                            view: window
                                        }));
                                        await delay(100);

                                        uploadItem.dispatchEvent(new MouseEvent('mouseover', {
                                            bubbles: true,
                                            cancelable: true,
                                            view: window
                                        }));
                                        await delay(500); // 等待删除按钮完全显示

                                        // 🔴 添加 mousedown 和 mouseup 事件
                                        uploadItemBtn.dispatchEvent(new MouseEvent('mousedown', {
                                            bubbles: true,
                                            cancelable: true,
                                            view: window,
                                            button: 0
                                        }));
                                        await delay(50);

                                        uploadItemBtn.dispatchEvent(new MouseEvent('mouseup', {
                                            bubbles: true,
                                            cancelable: true,
                                            view: window,
                                            button: 0
                                        }));
                                        await delay(50);

                                        uploadItemBtn.dispatchEvent(new MouseEvent('click', {
                                            bubbles: true,
                                            cancelable: true,
                                            view: window,
                                            button: 0
                                        }));

                                        console.log('[新浪发布] 🗑️ 已点击删除按钮');
                                        await delay(1500); // 等待删除动画完成
                                    }
                                }
                            }
                            console.log('[新浪发布] 🧹 清空完毕');

                            // 上传图片（带重试）
                            let input;
                            // 🔴 重新获取 uploadModal，防止引用失效
                            const currentModal = document.querySelector(".n-dialog");
                            if (!currentModal) {
                                console.error("[新浪发布] ❌ 上传弹窗已关闭或消失");
                            }
                            input = currentModal.querySelector("input[type='file']");
                            console.log("[新浪发布] ⚠️ 未找到文件输入框，等待后重试...");
                            await delay(5000);

                            if (!input) {
                                console.error("[新浪发布] ❌ 找不到文件输入框，可能是：");
                                console.error("[新浪发布]    1. 上传弹窗已关闭");
                                console.error("[新浪发布]    2. 弹窗结构改变");
                                console.error("[新浪发布]    3. 图片库标签未激活");
                            }

                            // 方法1：清空 value（对某些浏览器有效）
                            input.value = '';
                            await delay(300);

                            // 方法2：重新创建 DataTransfer 并确保只有一个文件
                            const newDataTransfer = new DataTransfer();
                            newDataTransfer.items.add(file);

                            console.log(`[新浪发布] 📤 上传文件 (共 ${newDataTransfer.items.length} 个)...`);
                            input.files = newDataTransfer.files;

                            // 验证上传的文件数量
                            console.log(`[新浪发布] ✅ input.files 包含 ${input.files.length} 个文件`);
                            if (input.files.length > 1) {
                                console.warn(`[新浪发布] ⚠️ 警告：input 中有 ${input.files.length} 个文件，应该只有1个`);
                            }

                            // 🔴 只触发一次 change 事件，不要多次触发
                            console.log('[新浪发布] 📤 触发文件上传事件...');
                            const event = new Event("change", {bubbles: true});
                            input.dispatchEvent(event);

                            // 🔑 设置上传标志，防止重试时重复上传
                            window.__xinlangImageUploaded = true;
                            console.log('[新浪发布] 🔑 已设置图片上传标志，防止重复上传');

                            // 增加等待时间，让文件上传开始处理
                            await delay(2000);

                            // 选中第一项（只执行一次，不重试）
                            // 🔴 改进：移除重试循环，只执行一次选择，避免重复点击
                            let selectSuccess = false;
                            try {
                                console.log(`[新浪发布] 开始选中第一张图片...`);

                                // 获取所有图片项
                                const imageItems = uploadModal.querySelectorAll('.image-list .image-item');
                                console.log(`[新浪发布] 找到 ${imageItems.length} 个图片项`);

                                if (imageItems.length > 0) {
                                    const firstImg = imageItems[0];
                                    console.log("[新浪发布] 🖱️ 开始选中第一张图片");

                                    // 🔴 先清除所有已选中的状态，防止多选（只做一次）
                                    console.log('[新浪发布] 🧹 清除所有其他已选状态...');
                                    imageItems.forEach((item, index) => {
                                        if (index !== 0 && item.classList.contains('is-selected')) {
                                            item.click(); // 取消其他选中
                                        }
                                    });
                                    await delay(300);

                                    // 检查是否已经选中（有 is-selected 类名）
                                    if (firstImg.classList.contains('is-selected')) {
                                        console.log('[新浪发布] ✅ 第一张图片已经是选中状态，无需重新选择');
                                        selectSuccess = true;
                                    } else {
                                        // 只点击一次，不重试
                                        console.log('[新浪发布] 🖱️ 点击选中第一张图片...');
                                        firstImg.click();
                                        await delay(800);  // 等待 UI 更新

                                        // 验证是否成功选中
                                        const selectedCount = uploadModal.querySelectorAll('.image-list .image-item.is-selected').length;
                                        console.log(`[新浪发布] 📊 当前选中数量: ${selectedCount}`);

                                        if (selectedCount === 1 && firstImg.classList.contains('is-selected')) {
                                            console.log('[新浪发布] ✅ 图片选中成功（仅选中1张）');
                                            selectSuccess = true;
                                        } else if (selectedCount > 1) {
                                            console.warn(`[新浪发布] ⚠️ 多选了 ${selectedCount} 张，清除其他选中...`);
                                            // 只清除一次，不循环重试
                                            imageItems.forEach((item, index) => {
                                                if (index !== 0 && item.classList.contains('is-selected')) {
                                                    item.click();
                                                }
                                            });
                                            await delay(300);

                                            const finalCount = uploadModal.querySelectorAll('.image-list .image-item.is-selected').length;
                                            if (finalCount === 1) {
                                                selectSuccess = true;
                                                console.log('[新浪发布] ✅ 已清除多选状态，仅保留第一张');
                                            }
                                        } else {
                                            console.warn('[新浪发布] ⚠️ 点击后未选中，继续执行...');
                                        }
                                    }
                                } else {
                                    console.error('[新浪发布] ❌ 未找到图片项');
                                }
                            } catch (e) {
                                console.error('[新浪发布] 选中图片异常:', e);
                            }

                            if (!selectSuccess) {
                                console.warn('[新浪发布] ⚠️ 图片选中未完全成功，但继续执行...');
                            }

                            // 点击确定
                            await delay(1000);
                            const confirmBtns = uploadModal.querySelectorAll(".n-button--primary-type");
                            console.log("🚀 ~  ~ confirmBtns: ", confirmBtns);
                            let confirmBtn = null;
                            for (let confirmBtn1 of confirmBtns) {
                                if (confirmBtn1.textContent.trim() === '下一步') {
                                    confirmBtn = confirmBtn1;
                                }
                            }
                            if (!confirmBtn) {
                                throw Error('[新浪发布]：找不到图片上传按钮');
                            }
                            confirmBtn.click();

                            // 🔴 等待图片裁剪弹窗出现（图片上传可能很慢）
                            // 不检测 loading，直接等待最终结果（裁剪弹窗）
                            console.log("[新浪发布] ⏳ 等待图片上传完成，裁剪弹窗出现...");

                            await delay(5000);
                            // 等待裁剪弹窗出现，最多等 120 秒
                            const coverCutDialogEle = await waitForElement(".n-dialog", 120000, 1000);
                            console.log("🚀 ~  ~ coverCutDialogEle: ", coverCutDialogEle);
                            if (!coverCutDialogEle) {
                                throw Error('[新浪发布]：图片上传超时，找不到图片裁剪弹窗');
                            }
                            console.log("[新浪发布] ✅ 图片上传完成，裁剪弹窗已出现");

                            await delay(1000);
                            const confirmCutBtn = coverCutDialogEle.querySelector(".n-button--primary-type");
                            console.log("🚀 ~  ~ confirmCutBtn: ", confirmCutBtn);
                            if (!confirmCutBtn) {
                                throw Error('[新浪发布]：找不到图片裁剪弹窗确认按钮');
                            }
                            confirmCutBtn.click();

                            // 🔴 增加等待时间，让裁剪弹窗有足够时间关闭（从1秒增加到5秒）
                            console.log('[新浪发布] ⏳ 等待裁剪弹窗关闭...');
                            await delay(5000);

                            // 封装上传检测逻辑（不重试）
                            const tryUploadImage = async () => {

                                // 🔴 自定义等待逻辑：同时检查弹窗状态、封面图和错误信息
                                const waitForImageOrError = async (timeout = 15000) => {
                                    const startTime = Date.now();
                                    const checkInterval = 300; // 每300ms检查一次

                                    while (Date.now() - startTime < timeout) {
                                        // 1. 先检查是否有错误信息（优先级最高）
                                        const errorMsg = getLatestError();
                                        if (errorMsg) {
                                            return {type: "error", message: errorMsg};
                                        }

                                        // 2. 检查弹窗状态
                                        const modal = document.querySelector(".n-dialog");
                                        const modalVisible = modal && modal.offsetParent !== null;

                                        // 3. 检查封面预览区域是否有图片
                                        const coverPreview = document.querySelector(".cover-preview");
                                        const coverImg = coverPreview?.querySelector(".cover-img");
                                        const hasCoverImage = coverImg && coverImg.getAttribute("src");

                                        // 🔴 增加详细日志，帮助定位问题
                                        console.log(`[新浪发布] 🔍 检测状态: 弹窗=${modalVisible ? '存在' : '已关闭'}, 封面图=${hasCoverImage ? '有' : '无'}`);
                                        if (modalVisible) {
                                            console.log(`[新浪发布] 🔍 弹窗详情: className="${modal?.className}", 内容="${modal?.textContent?.substring(0, 100)}..."`);
                                        }
                                        if (!hasCoverImage && coverPreview) {
                                            console.log(`[新浪发布] 🔍 封面预览区域存在但无图片: coverImg=${!!coverImg}, src="${coverImg?.getAttribute("src") || '空'}"`);
                                        }

                                        // 4. 判断结果
                                        if (!modalVisible && hasCoverImage) {
                                            // 弹窗关闭 + 封面图出现 = 成功
                                            console.log("[新浪发布] 🔍 弹窗已关闭且检测到封面图片，等待 500ms 确认...");
                                            await delay(500);
                                            const confirmError = getLatestError();
                                            if (confirmError) {
                                                console.log("[新浪发布] ⚠️ 确认期间检测到错误:", confirmError);
                                                return {type: "error", message: confirmError};
                                            }
                                            return {type: "success", element: coverPreview};
                                        }

                                        if (modalVisible) {
                                            // 弹窗还在，检查弹窗内是否有错误提示
                                            const modalError = modal.querySelector(".n-message--error, .error-message, .n-form-item-feedback--error");
                                            if (modalError && modalError.textContent.trim()) {
                                                return {type: "error", message: modalError.textContent.trim()};
                                            }
                                            // 弹窗还在，继续等待（可能还在上传中）
                                        }

                                        // 等待下一次检查
                                        await delay(checkInterval);
                                    }

                                    // 超时，再检查一次状态
                                    const finalError = getLatestError();
                                    if (finalError) {
                                        return {type: "error", message: finalError};
                                    }

                                    // 检查弹窗是否还在
                                    const finalModal = document.querySelector(".n-dialog");
                                    if (finalModal && finalModal.offsetParent !== null) {
                                        return {type: "timeout", reason: "modal_still_open"};
                                    }

                                    return {type: "timeout", reason: "no_cover_image"};
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
                                    let saveBtn = null;
                                    if (publishBtns.length > 0) {
                                        publishBtns.forEach(btn => {
                                            if (btn.textContent.trim() === "下一步") {
                                                publishBtn = btn;
                                            } else if (btn.textContent.trim().includes("保存")) {
                                                saveBtn = btn;
                                            }
                                        });
                                    }
                                    if (saveBtn) {
                                        saveBtn.click();
                                    }
                                    await delay(5000);
                                    if (publishBtn) {
                                        console.log("🚀 ~ tryUploadImage ~ publishBtn: ", publishBtn);
                                        // 🔑 检查发布按钮是否 disabled
                                        if (publishBtn.disabled || publishBtn.getAttribute("disabled") !== null) {
                                            console.error("[新浪发布] ❌ 发布按钮不可用(disabled)");
                                            stopErrorListener();
                                            const publishIdForError = dataObj.video?.dyPlatform?.id;
                                            if (publishIdForError) {
                                                await sendStatisticsError(publishIdForError, "发布按钮不可用，可能不符合发布要求，或者发文次数已用尽", "新浪发布");
                                            }
                                            await closeWindowWithMessage("发布失败，刷新数据", 1000);
                                            return;
                                        }

                                        // 🔑 在点击发布前保存 publishId，让首页可以调用统计接口
                                        const publishId = dataObj.video?.dyPlatform?.id;
                                        const publishTime = dataObj.video?.formData?.send_set; // 1=即时发布, 2=定时发布
                                        const sendTime = dataObj.video?.formData?.send_time; // 定时发布的时间
                                        if (publishId) {
                                            try {
                                                // 同时设置全局变量和 localStorage，确保标志能被检测到
                                                window.__xinlangPublishSuccessFlag = true;
                                                window.__xinlangPublishId = publishId; // 供 selectScheduledTime 使用
                                                localStorage.setItem(getPublishSuccessKey(), JSON.stringify({publishId: publishId}));
                                                console.log("[新浪发布] 💾 已保存 publishId（全局变量 + localStorage）:", publishId);

                                                // 🔑 同时保存到 globalData（更可靠，不受域名隔离限制）
                                                // 同时保存发布类型和定时时间，用于验证页返回后恢复
                                                if (window.browserAPI && window.browserAPI.setGlobalData) {
                                                    await window.browserAPI.setGlobalData(`PUBLISH_SUCCESS_DATA_${currentWindowId}`, {
                                                        publishId: publishId,
                                                        publishTime: publishTime, // 1=即时, 2=定时
                                                        sendTime: sendTime, // 定时发布的时间
                                                        timestamp: Date.now() // 🔴 添加时间戳，防止被清除
                                                    });
                                                    console.log('[新浪发布] 💾 已保存发布数据到 globalData (publishId, publishTime, sendTime, timestamp)');
                                                }
                                            } catch (e) {
                                                console.error("[新浪发布] ❌ 保存 publishId 失败:", e);
                                            }
                                        } else {
                                            // 即使没有 publishId，也要设置全局变量允许跳转
                                            window.__xinlangPublishSuccessFlag = true;
                                            console.log("[新浪发布] ℹ️ 没有 publishId，但已设置跳转标志");
                                        }

                                        // 🔑 设置发布发起标志，防止验证页返回流程重复执行
                                        window.__xinlangPublishInitiated = true;
                                        console.log("[新浪发布] 🚀 已设置发布发起标志，防止验证页重复跳转");

                                        const clickEvent = new MouseEvent("click", {
                                            view: window,
                                            bubbles: true,
                                            cancelable: true,
                                        });
                                        publishBtn.dispatchEvent(clickEvent);
                                        console.log("[新浪发布] ✅ 已点击发布（模拟鼠标事件）");
                                        await delay(1000);

                                        // 可能跳转至拼图验证页（https://security.weibo.com/captcha/geetest?key=...）
                                        // 验证完成后会自动回到发布页，需要等待发布弹窗出现
                                        // 使用 waitForElement 等待弹窗，超时时间设置为 300 秒（5 分钟），给用户足够时间完成验证
                                        console.log("[新浪发布] ⏳ 等待发布弹窗出现（如果跳转到验证页，请在 5 分钟内完成验证...）");

                                        //    发布弹窗
                                        try {
                                            const publishDialogEle = await waitForElement('.n-dialog', 300000, 500);
                                            if (!publishDialogEle) {
                                                console.log('[新浪发布]：找不到发布弹窗（等待超时）');
                                            }
                                            console.log("[新浪发布] ✅ 发布弹窗已出现");

                                            // 🔴 检测弹窗类型：是发布确认弹窗还是发布成功提示
                                            const isPublishModal = publishDialogEle.classList.contains('publish-modal') ||
                                                publishDialogEle.querySelector('.publish-modal');
                                            console.log("[新浪发布] 🔍 是否是发布确认弹窗 (.publish-modal):", !!isPublishModal);

                                            // 如果不是发布确认弹窗，说明已经发布成功了
                                            if (!isPublishModal) {
                                                console.log("[新浪发布] ✅ 检测到发布成功提示弹窗，文章已发布");

                                                // 直接上报统计
                                                const publishIdForSuccess = window.__xinlangPublishId ||
                                                    (await window.browserAPI?.getGlobalData?.(`PUBLISH_SUCCESS_DATA_${currentWindowId}`))?.publishId;

                                                if (publishIdForSuccess) {
                                                    try {
                                                        const successUrl = await getStatisticsUrl();
                                                        const scanData = {data: JSON.stringify({id: publishIdForSuccess})};
                                                        await fetch(successUrl, {
                                                            method: "POST",
                                                            headers: {"Content-Type": "application/json"},
                                                            body: JSON.stringify(scanData),
                                                        });
                                                        console.log("[新浪发布] ✅ 发布统计上报成功");
                                                    } catch (e) {
                                                        console.error("[新浪发布] ❌ 统计上报失败:", e);
                                                    }
                                                }

                                                // 清除保存的标记
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
                                                return;
                                            }

                                            // 如果是发布确认弹窗，继续查找发布按钮
                                            let publishBtnArea = publishDialogEle.querySelector('.n-mention + div .items-center:nth-of-type(2)');

                                            // 备用选择器1：查找所有 items-center 并选择最后一个
                                            if (!publishBtnArea) {
                                                const itemsCenters = publishDialogEle.querySelectorAll('.items-center');
                                                if (itemsCenters.length > 0) {
                                                    publishBtnArea = itemsCenters[itemsCenters.length - 1];
                                                    console.log("[新浪发布] 🔍 使用备用选择器1：最后一个 .items-center");
                                                }
                                            }

                                            // 备用选择器2：查找所有按钮
                                            if (!publishBtnArea) {
                                                const allBtns = publishDialogEle.querySelectorAll('button');
                                                if (allBtns.length > 0) {
                                                    publishBtnArea = publishDialogEle;
                                                    console.log("[新浪发布] 🔍 使用备用选择器2：对话框本身");
                                                }
                                            }

                                            if (!publishBtnArea) {
                                                console.log('[新浪发布]：找不到发布按钮操作区');
                                            }
                                            // publishTime 已在上面声明过（用于保存到 globalData）
                                            if (+publishTime === 2) {
                                                let timedReleaseButton = publishBtnArea.querySelector('.svg-icon');

                                                // 如果找不到 svg-icon，尝试查找 icon 按钮
                                                if (!timedReleaseButton) {
                                                    const iconBtns = publishBtnArea.querySelectorAll('button');
                                                    for (let btn of iconBtns) {
                                                        if (btn.querySelector('svg') && !btn.textContent.trim().includes('发布')) {
                                                            timedReleaseButton = btn;
                                                            break;
                                                        }
                                                    }
                                                }

                                                if (!timedReleaseButton) {
                                                    console.log('[新浪发布]：找不到定时发布按钮');
                                                }
                                                const clickEvent = new MouseEvent("click", {
                                                    view: window,
                                                    bubbles: true,
                                                    cancelable: true,
                                                });
                                                timedReleaseButton.dispatchEvent(clickEvent);
                                                console.log("[新浪发布] ✅ 已点击定时发布");

                                                // sendTime 已在上面声明过（用于保存到 globalData）
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
                                            } else {
                                                const publishButtons = publishBtnArea.querySelectorAll('button');
                                                let publishButton = null;
                                                for (let publishButton1 of publishButtons) {
                                                    if (publishButton1.textContent.trim() === '发布') {
                                                        publishButton = publishButton1;
                                                    }
                                                }
                                                if (!publishButton) {
                                                    console.log('[新浪发布]：找不到发布按钮');
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
                                                        const scanData = {data: JSON.stringify({id: publishIdForInstant})};
                                                        await fetch(successUrl, {
                                                            method: "POST",
                                                            headers: {"Content-Type": "application/json"},
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
                                        } catch (dialogError) {
                                            console.error("[新浪发布] ❌ 发布弹窗处理失败:", dialogError);
                                            stopErrorListener();
                                            const publishId = dataObj.video?.dyPlatform?.id;
                                            if (publishId) {
                                                await sendStatisticsError(publishId, dialogError.message || "发布弹窗处理失败", "新浪发布");
                                            }
                                            await closeWindowWithMessage("发布失败，刷新数据", 1000);
                                            return;
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
                                    // 图片上传失败（timeout），直接上报失败
                                    const timeoutReason = result.reason === "modal_still_open" ? "弹窗未关闭" : "封面图未出现";
                                    console.log(`[新浪发布] [窗口${myWindowId}] ❌ 封面上传超时(${timeoutReason})`);

                                    // 优先使用全局错误监听器捕获的错误
                                    const errorMessage = getLatestError();
                                    console.log(`[新浪发布] [窗口${myWindowId}] 📨 最新错误信息:`, errorMessage);

                                    // 构建失败消息
                                    const failureMessage = errorMessage || `封面上传失败(${timeoutReason})`;
                                    console.log(`[新浪发布] [窗口${myWindowId}] ❌ 上报失败: ${failureMessage}`);

                                    stopErrorListener();
                                    const publishId = dataObj.video?.dyPlatform?.id;
                                    if (publishId) {
                                        await sendStatisticsError(publishId, failureMessage, "新浪发布");
                                    } else {
                                        console.error(`[新浪发布] [窗口${myWindowId}] ❌ publishId 为空，无法调用失败接口！`);
                                    }
                                    await closeWindowWithMessage("发布失败，刷新数据", 1000);
                                    return;
                                }
                            };

                            // 启动上传检测（延迟2秒等待上传开始）
                            await delay(2000);
                            await tryUploadImage();
                        }  // if (tabClickSuccess) 结束
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
                window.__XL_fillFormRunning = false; // 🔴 释放全局锁
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
            window.__XL_fillFormRunning = false; // 🔴 释放全局锁
            // 填写表单失败也要关闭窗口，不阻塞下一个任务
            await closeWindowWithMessage("填写表单失败，刷新数据", 1000);
        }
        // 注意：不在 finally 中重置 fillFormRunning
        // 因为 setTimeout 是异步的，finally 会立即执行
        // fillFormRunning 的重置在 setTimeout 回调内部完成（line 974）
    }
})(); // IIFE 结束


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
                console.warn("[新浪发布] ⚠️ 未找到" + i + "输入框");
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
                    const scanData = {data: JSON.stringify({id: publishIdForTimer})};
                    await fetch(successUrl, {
                        method: "POST",
                        headers: {"Content-Type": "application/json"},
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
