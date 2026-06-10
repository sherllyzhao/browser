/**
 * 腾讯号创作者平台发布脚本
 * 用于处理发布流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
    "use strict";

    // ===========================
    // 防止脚本重复注入
    // ===========================
    const TXH_PUBLISH_SCRIPT_VERSION = "2026-06-09-ai-declaration-radio-confirm-v19";
    if (window.__TXH_SCRIPT_LOADED__ && window.__TXH_PUBLISH_SCRIPT_VERSION__ === TXH_PUBLISH_SCRIPT_VERSION) {
        console.log("[腾讯号发布] ⚠️ 脚本已经加载过，跳过重复注入，版本:", TXH_PUBLISH_SCRIPT_VERSION);
        return;
    }
    if (window.__TXH_SCRIPT_LOADED__ && window.__TXH_PUBLISH_SCRIPT_VERSION__ !== TXH_PUBLISH_SCRIPT_VERSION) {
        console.warn("[腾讯号发布] ♻️ 检测到旧版脚本，继续加载新版逻辑:", {
            oldVersion: window.__TXH_PUBLISH_SCRIPT_VERSION__ || "unknown",
            newVersion: TXH_PUBLISH_SCRIPT_VERSION
        });
    }

    // ===========================
    // 页面状态检查 - 防止异常渲染
    // ===========================
    // 🔴 腾讯号跳过此检测：富文本编辑器支持写代码，容易误报
    // if (typeof window.checkPageStateAndReload === "function") {
    //     if (!window.checkPageStateAndReload("腾讯号发布")) {
    //         return;
    //     }
    // }

    window.__TXH_SCRIPT_LOADED__ = true;
    window.__TXH_PUBLISH_SCRIPT_VERSION__ = TXH_PUBLISH_SCRIPT_VERSION;
    console.log("[腾讯号发布] 🧪 当前脚本版本:", TXH_PUBLISH_SCRIPT_VERSION);

    // ===========================
    // 🔑 腾讯号白屏检测和自动恢复（使用公共函数）
    // ===========================
    if (typeof window.checkBlankPageAndReload === "function") {
        window.checkBlankPageAndReload("腾讯号发布", [
            ".ExEditor-basic",
            ".publish-button",
            ".editor_container"
        ], 3000, 3);
    }

    // 显示操作提示横幅
    if (typeof showOperationBanner === "function") {
        showOperationBanner("正在自动发布中，请勿操作此页面...");
    }

    // 变量声明（放在防重复检查之后）
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
        if (typeof createErrorListener === "function" && ERROR_LISTENER_CONFIGS?.tengxun) {
            errorListener = createErrorListener(ERROR_LISTENER_CONFIGS.tengxun);
            console.log("[腾讯号发布] ✅ 使用公共错误监听器配置");
        } else {
            // 回退方案：使用本地配置
            errorListener = createErrorListener({
                logPrefix: "[腾讯号发布]",
                selectors: [{ containerClass: "omui-message", textSelector: ".omui-message__desc", recursiveSelector: ".omui-message" }],
            });
            console.log("[腾讯号发布] ⚠️ 使用本地错误监听器配置");
        }
    };

    // 兼容旧代码的函数别名
    const startErrorListener = () => {
        if (!errorListener) initErrorListener();
        errorListener.start();
    };
    const stopErrorListener = () => errorListener?.stop();
    const clearLatestErrors = () => errorListener?.clear?.();
    const getLatestError = () => errorListener?.getLatestError() || null;

    // 获取窗口专属的发布成功数据 key
    const getPublishSuccessKey = () => {
        const key = `PUBLISH_SUCCESS_DATA_${currentWindowId || "default"}`;
        console.log("[腾讯号发布] 🔑 使用 localStorage key:", key);
        return key;
    };

    const normalizePublishTipText = text => (text || "").replace(/\s+/g, " ").trim();

    const extractPublishErrorText = text => {
        const normalizedText = normalizePublishTipText(text);
        if (!normalizedText) return "";

        const qualificationMatch = normalizedText.match(/您(?:的)?(?:资质|资格).{0,30}(?:未通过|不能|不可).{0,30}(?:发文|发文章|发布)/);
        if (qualificationMatch && qualificationMatch[0]) {
            return normalizePublishTipText(qualificationMatch[0]);
        }

        const preciseMatch = normalizedText.match(/您[^发布定时存草稿预览]{0,100}(?:资质|资格)[^发布定时存草稿预览]{0,100}(?:不能|不可|未通过|发文)[^发布定时存草稿预览]{0,60}/);
        if (preciseMatch && preciseMatch[0]) {
            return normalizePublishTipText(preciseMatch[0]);
        }

        const shortMatch = normalizedText.match(/(?:资质|资格)[^发布定时存草稿预览]{0,100}(?:不能|不可|未通过|发文)[^发布定时存草稿预览]{0,60}/);
        if (shortMatch && shortMatch[0]) {
            return normalizePublishTipText(shortMatch[0]);
        }

        return normalizedText.length <= 120 ? normalizedText : "";
    };

    const isPublishTipErrorText = text => {
        const normalizedText = extractPublishErrorText(text);
        return normalizedText
            && normalizedText.length <= 120
            && /资质|资格|不能|不可|未通过|发文|次数|权限|审核|失败|违规/.test(normalizedText);
    };

    const publishTipSelectors = [
        'li[class*="tool_public_tip"]',
        '[class*="tool_public_tip"]',
        '[class*="public_tip"]',
        '[role="tooltip"]',
        '.omui-tooltip',
        '.omui-tooltip-content',
        '.omui-popover',
        '[class*="tooltip"]',
        '[class*="popover"]',
        '[class*="popper"]'
    ];

    const getElementTextForPublishError = element => {
        if (!element || element.nodeType !== 1) return "";
        return normalizePublishTipText(
            element.innerText
            || element.textContent
            || element.getAttribute("title")
            || element.getAttribute("aria-label")
            || ""
        );
    };

    const getPublishElementDebugInfo = element => {
        const rect = element.getBoundingClientRect();
        return {
            tag: element.tagName.toLowerCase(),
            className: String(element.className || "").slice(0, 160),
            text: getElementTextForPublishError(element).slice(0, 180),
            rect: {
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
            }
        };
    };

    const getPublishButtonTextElements = publishBtn => {
        const elements = [];
        const addElement = element => {
            if (element && element.nodeType === 1 && !elements.includes(element)) {
                elements.push(element);
            }
        };

        const textElements = publishBtn?.querySelectorAll?.('span[class*="tool_publish_button_text"], span[class*="tool_publish_buttons_text"], [class*="tool_publish_button_text"], [class*="tool_publish_buttons_text"], span') || [];
        for (const element of textElements) {
            const text = getElementTextForPublishError(element);
            if (text && /发布/.test(text)) {
                addElement(element);
            }
        }

        return elements;
    };

    const getPublishTextRects = element => {
        if (!element || element.nodeType !== 1 || typeof document.createRange !== "function") {
            return [];
        }

        const rects = [];
        try {
            const range = document.createRange();
            range.selectNodeContents(element);
            for (const rect of Array.from(range.getClientRects())) {
                if (rect.width > 0 && rect.height > 0) {
                    rects.push(rect);
                }
            }
            range.detach?.();
        } catch (e) {
            // Range 读取失败时使用元素矩形兜底。
        }

        if (rects.length === 0) {
            const rect = element.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                rects.push(rect);
            }
        }

        return rects;
    };

    const createPublishHoverPointerEventsOverride = (publishBtn, publishBtnWrap) => {
        const styleId = "__txh_publish_hover_pointer_events_override__";
        const listItem = publishBtn?.closest?.("li");
        const toolRight = publishBtn?.closest?.('[class*="tool_right"], [class*="tool-right"]');
        const toolContent = publishBtn?.closest?.('[class*="tool_content"], [class*="tool-content"]');
        const publishTool = publishBtn?.closest?.('[class*="publish_tool"], [class*="publish-tool"]');
        const roots = [publishBtnWrap, publishTool, toolContent, toolRight, listItem?.parentElement].filter(Boolean);
        const disabledElements = [];
        const seen = new Set();

        const collectDisabledElement = element => {
            if (!element || element.nodeType !== 1 || seen.has(element)) return;
            seen.add(element);

            const style = window.getComputedStyle(element);
            if (style.pointerEvents === "none") {
                disabledElements.push(getPublishElementDebugInfo(element));
            }
        };

        [publishBtn, ...getPublishButtonTextElements(publishBtn), listItem, toolRight, toolContent, publishTool, publishBtnWrap].forEach(collectDisabledElement);
        roots.forEach(root => {
            collectDisabledElement(root);
            const elements = root.querySelectorAll?.("*") || [];
            for (const element of elements) {
                collectDisabledElement(element);
            }
        });

        let styleElement = document.getElementById(styleId);
        if (!styleElement) {
            styleElement = document.createElement("style");
            styleElement.id = styleId;
            document.head.appendChild(styleElement);
        }

        styleElement.textContent = `
            footer[class*="publish_tool"],
            footer[class*="publish_tool"] *,
            [class*="tool_right"],
            [class*="tool_right"] *,
            [class*="tool-right"],
            [class*="tool-right"] *,
            [class*="tool_content"],
            [class*="tool_content"] *,
            [class*="tool-content"],
            [class*="tool-content"] *,
            [class*="tool_publish_buttons"],
            [class*="tool_publish_buttons"] *,
            [class*="tool_publish_button_text"],
            [class*="tool_publish_buttons_text"],
            button[class*="omui-button"],
            button[class*="omui-button"] *,
            button[class*="omui-button"] > span,
            li[class*="tool_public_tip"],
            [class*="tool_public_tip"],
            li[class*="public_tip"],
            [class*="public_tip"] {
                pointer-events: auto !important;
            }
        `;

        console.log("[腾讯号发布] 🧷 已临时解除发布区 pointer-events 禁用:", disabledElements);

        return () => {
            try {
                styleElement.remove();
                console.log("[腾讯号发布] 🧷 已还原发布区 pointer-events 覆盖");
            } catch (e) {
                console.warn("[腾讯号发布] ⚠️ 移除 pointer-events 覆盖失败:", e.message);
            }
        };
    };

    const isPublishPublicTipElement = element => {
        if (!element || element.nodeType !== 1) return false;

        const className = String(element.className || "");
        return /tool_public_tip|public_tip/.test(className);
    };

    const getPublishPublicTipElements = (publishBtn, publishBtnWrap) => {
        const elements = [];
        const addElement = element => {
            if (element && element.nodeType === 1 && !elements.includes(element)) {
                elements.push(element);
            }
        };

        const listItem = publishBtn?.closest?.("li");
        addElement(listItem?.previousElementSibling);
        addElement(listItem?.nextElementSibling);
        addElement(publishBtn?.closest?.('[class*="tool_public_tip"]'));
        addElement(publishBtn?.closest?.('[class*="public_tip"]'));

        const roots = [
            publishBtnWrap,
            listItem?.parentElement,
            publishBtn?.closest?.('[class*="tool_right"]'),
            publishBtn?.closest?.('[class*="tool-right"]'),
            publishBtn?.closest?.('[class*="tool_content"]'),
            publishBtn?.closest?.('[class*="publish_tool"]')
        ].filter(Boolean);

        for (const root of roots) {
            const tipElements = root.querySelectorAll?.('li[class*="tool_public_tip"], [class*="tool_public_tip"], li[class*="public_tip"], [class*="public_tip"]') || [];
            for (const element of tipElements) {
                addElement(element);
            }
        }

        return elements.filter(isPublishPublicTipElement);
    };

    const readPublishPublicTipFullText = (publishBtn, publishBtnWrap) => {
        for (const element of getPublishPublicTipElements(publishBtn, publishBtnWrap)) {
            const text = getElementTextForPublishError(element);
            if (text) {
                console.log("[腾讯号发布] ✅ 捕获 tool_public_tip 元素完整文本:", {
                    text,
                    element: getPublishElementDebugInfo(element)
                });
                return text;
            }
        }

        return null;
    };

    const extractPublishTipTextFromElement = element => {
        if (!element || element.nodeType !== 1) return null;

        if (isPublishPublicTipElement(element)) {
            return getElementTextForPublishError(element) || null;
        }

        const directText = extractPublishErrorText(getElementTextForPublishError(element));
        if (isPublishTipErrorText(directText)) {
            return directText;
        }

        for (const attr of Array.from(element.attributes || [])) {
            const attrName = attr.name || "";
            if (!/title|label|content|tooltip|tip|popover|data-/i.test(attrName)) continue;

            const attrText = extractPublishErrorText(attr.value);
            if (isPublishTipErrorText(attrText)) {
                return attrText;
            }
        }

        for (const pseudo of ["::before", "::after"]) {
            try {
                const content = window.getComputedStyle(element, pseudo).content;
                if (content && content !== "none" && content !== "normal") {
                    const pseudoText = extractPublishErrorText(content.replace(/^["']|["']$/g, ""));
                    if (isPublishTipErrorText(pseudoText)) {
                        return pseudoText;
                    }
                }
            } catch (e) {
                // 个别节点不支持伪元素读取，跳过即可。
            }
        }

        for (const selector of publishTipSelectors) {
            if (typeof element.matches === "function" && element.matches(selector)) {
                const text = isPublishPublicTipElement(element)
                    ? getElementTextForPublishError(element)
                    : extractPublishErrorText(getElementTextForPublishError(element));
                if (text && (isPublishPublicTipElement(element) || isPublishTipErrorText(text))) {
                    return text;
                }
            }

            const elements = element.querySelectorAll(selector);
            for (const item of elements) {
                const text = isPublishPublicTipElement(item)
                    ? getElementTextForPublishError(item)
                    : extractPublishErrorText(getElementTextForPublishError(item));
                if (text && (isPublishPublicTipElement(item) || isPublishTipErrorText(text))) {
                    return text;
                }
            }
        }

        return null;
    };

    const collectPublishHoverTextCandidates = (roots = [document.body], baselineTexts = null) => {
        if (!document.body) return [];

        const candidates = [];
        const seen = new Set();

        const scanElement = element => {
            if (!element || element.nodeType !== 1) return;

            const rect = element.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;

            const style = window.getComputedStyle(element);
            if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return;

            const rawText = getElementTextForPublishError(element);
            if (!rawText || rawText.length > 180) return;
            if (!/资质|资格|不能|不可|未通过|发文|次数|权限|审核|失败|违规/.test(rawText)) return;

            const text = extractPublishErrorText(rawText);
            if (!isPublishTipErrorText(text) || seen.has(text)) return;
            if (baselineTexts && baselineTexts.has(text)) return;

            seen.add(text);
            candidates.push({
                text,
                ...getPublishElementDebugInfo(element)
            });
        };

        for (const root of roots.filter(Boolean)) {
            scanElement(root);
            const elements = root.querySelectorAll ? root.querySelectorAll("*") : [];
            for (const element of elements) {
                scanElement(element);
            }
        }

        return candidates.slice(0, 10);
    };

    const readPublishHoverTargetAttributeTip = (publishBtn, publishBtnWrap) => {
        for (const element of getPublishHoverTargets(publishBtn, publishBtnWrap)) {
            const text = extractPublishTipTextFromElement(element);
            if (text) {
                console.log("[腾讯号发布] ✅ 从 hover 目标属性/伪元素捕获错误提示:", {
                    text,
                    tag: element.tagName,
                    className: String(element.className || "").slice(0, 160)
                });
                return text;
            }
        }

        return null;
    };

    const readPublishHoverErrorTip = publishBtnWrap => {
        const roots = [publishBtnWrap, document.body].filter(Boolean);

        for (const root of roots) {
            const publicTipElements = root.querySelectorAll?.('li[class*="tool_public_tip"], [class*="tool_public_tip"], li[class*="public_tip"], [class*="public_tip"]') || [];
            for (const element of publicTipElements) {
                const text = getElementTextForPublishError(element);
                if (text) {
                    return text;
                }
            }

            const directText = extractPublishErrorText(root.textContent);
            if (isPublishTipErrorText(directText)) {
                return directText;
            }

            const text = extractPublishTipTextFromElement(root);
            if (text) {
                return text;
            }
        }

        return null;
    };

    const createPublishHoverTipCapture = publishBtnWrap => {
        let capturedText = readPublishHoverErrorTip(publishBtnWrap);
        let observer = null;

        const captureFromNode = node => {
            if (capturedText || !node) return capturedText;

            if (node.nodeType === 3) {
                const ownText = extractPublishErrorText(node.textContent);
                if (isPublishTipErrorText(ownText)) {
                    capturedText = ownText;
                    return capturedText;
                }

                const parentText = extractPublishTipTextFromElement(node.parentElement);
                if (parentText) {
                    capturedText = parentText;
                }
                return capturedText;
            }

            const rawNodeText = node.nodeType === 1 ? (node.innerText || node.textContent) : node.textContent;
            const directNodeText = extractPublishErrorText(rawNodeText);
            if (isPublishTipErrorText(directNodeText)) {
                capturedText = directNodeText;
                return capturedText;
            }

            const nodeText = extractPublishTipTextFromElement(node);
            if (nodeText) {
                capturedText = nodeText;
            }

            return capturedText;
        };

        if (document.body && typeof MutationObserver === "function") {
            observer = new MutationObserver(mutations => {
                for (const mutation of mutations) {
                    if (capturedText) break;

                    captureFromNode(mutation.target);
                    for (const node of mutation.addedNodes || []) {
                        captureFromNode(node);
                        if (capturedText) break;
                    }
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: ["class", "style", "aria-hidden"]
            });
        }

        return {
            get: () => capturedText || readPublishHoverErrorTip(publishBtnWrap),
            stop: () => {
                if (observer) {
                    observer.disconnect();
                    observer = null;
                }
            }
        };
    };

    const waitForPublishHoverTipCapture = async (tipCapture, options = {}) => {
        const sampleDelays = options.sampleDelays || [0, 40, 80, 120, 180, 260, 360, 520, 760, 1100, 1500];
        const roots = options.roots || [document.body];
        const baselineTexts = options.baselineTexts || null;

        for (const sampleDelay of sampleDelays) {
            if (sampleDelay > 0) {
                await window.delay(sampleDelay);
            }

            const publicTipText = tipCapture.getPublicTip?.();
            if (publicTipText) {
                return publicTipText;
            }

            const capturedText = tipCapture.get();
            if (capturedText) {
                return capturedText;
            }

            const candidates = collectPublishHoverTextCandidates(roots, baselineTexts);
            if (candidates.length > 0) {
                console.log("[腾讯号发布] 🔎 hover 普通元素文本候选:", candidates);
                return candidates[0].text;
            }
        }

        return null;
    };

    const dispatchPublishHoverEvent = (element, type, eventInit) => {
        if (!element) return;

        const EventCtor = type.startsWith("pointer") && typeof PointerEvent === "function"
            ? PointerEvent
            : MouseEvent;
        try {
            element.dispatchEvent(new EventCtor(type, {
                ...eventInit,
                composed: true,
                pointerType: "mouse",
                pointerId: 1,
                isPrimary: true
            }));
        } catch (e) {
            element.dispatchEvent(new MouseEvent(type, {
                ...eventInit,
                composed: true
            }));
        }
    };

    const getPublishHoverTargets = (publishBtn, publishBtnWrap) => {
        const targets = [];
        const addTarget = element => {
            if (element && element.nodeType === 1 && !targets.includes(element)) {
                targets.push(element);
            }
        };

        const listItem = publishBtn?.closest?.("li");
        getPublishButtonTextElements(publishBtn).forEach(addTarget);
        addTarget(listItem);
        addTarget(publishBtn);
        addTarget(publishBtn?.parentElement);
        addTarget(publishBtn?.closest?.('[class*="tool_publish_buttons"]'));
        addTarget(listItem?.previousElementSibling);
        addTarget(listItem?.nextElementSibling);
        addTarget(listItem?.parentElement);
        addTarget(publishBtn?.closest?.('[class*="tool_right"]'));
        addTarget(publishBtn?.closest?.('[class*="tool-right"]'));
        addTarget(publishBtn?.closest?.('[class*="tool_content"]'));
        addTarget(publishBtn?.closest?.('[class*="tool_public_tip"]'));
        addTarget(publishBtn?.closest?.('[class*="public_tip"]'));
        addTarget(publishBtn?.closest?.('[class*="tool-right"]'));
        addTarget(publishBtn?.closest?.('[class*="publish_tool"]'));
        addTarget(publishBtnWrap);

        return targets.filter(element => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0
                && rect.height > 0
                && rect.bottom >= 0
                && rect.right >= 0
                && rect.top <= window.innerHeight
                && rect.left <= window.innerWidth;
        });
    };

    const getPublishHoverPoints = (publishBtn, publishBtnWrap) => {
        const clampX = value => Math.max(0, Math.min(Math.round(value), Math.max(0, window.innerWidth - 1)));
        const clampY = value => Math.max(0, Math.min(Math.round(value), Math.max(0, window.innerHeight - 1)));
        const points = [];
        const pointKeys = new Set();

        const addPoint = (element, x, y, label) => {
            const clientX = clampX(x);
            const clientY = clampY(y);
            const key = `${clientX}:${clientY}`;
            if (!pointKeys.has(key)) {
                pointKeys.add(key);
                points.push({ element, clientX, clientY, label });
            }
        };

        getPublishHoverTargets(publishBtn, publishBtnWrap).forEach((element, targetIndex) => {
            const rect = element.getBoundingClientRect();
            const xInset = Math.min(Math.max(rect.width * 0.25, 4), 24);
            const yInset = Math.min(Math.max(rect.height * 0.25, 4), 18);
            const isTextTarget = getPublishButtonTextElements(publishBtn).includes(element);
            const targetLabel = isTextTarget
                ? "publish-text"
                : element === publishBtn
                ? "button"
                : `${element.tagName.toLowerCase()}#${targetIndex}`;

            if (isTextTarget) {
                getPublishTextRects(element).forEach((textRect, textRectIndex) => {
                    const textXInset = Math.min(Math.max(textRect.width * 0.2, 2), 10);
                    const textYInset = Math.min(Math.max(textRect.height * 0.25, 2), 8);
                    addPoint(element, textRect.left + textRect.width / 2, textRect.top + textRect.height / 2, `${targetLabel}:text-${textRectIndex}:center`);
                    addPoint(element, textRect.left + textXInset, textRect.top + textRect.height / 2, `${targetLabel}:text-${textRectIndex}:left`);
                    addPoint(element, textRect.right - textXInset, textRect.top + textRect.height / 2, `${targetLabel}:text-${textRectIndex}:right`);
                    addPoint(element, textRect.left + textRect.width / 2, textRect.top + textYInset, `${targetLabel}:text-${textRectIndex}:top`);
                });
            }

            addPoint(element, rect.left + rect.width / 2, rect.top + rect.height / 2, `${targetLabel}:center`);
            addPoint(element, rect.left + xInset, rect.top + rect.height / 2, `${targetLabel}:left`);
            addPoint(element, rect.right - xInset, rect.top + rect.height / 2, `${targetLabel}:right`);
            addPoint(element, rect.left + rect.width / 2, rect.top + yInset, `${targetLabel}:top`);
        });

        return points;
    };

    const createNativeHoverPointPayload = points => points.map(point => ({
        x: point.clientX,
        y: point.clientY,
        label: point.label
    }));

    const getAwayPointForPublishHover = point => {
        const maxX = Math.max(0, window.innerWidth - 1);
        const maxY = Math.max(0, window.innerHeight - 1);
        return {
            x: point.clientX < window.innerWidth / 2 ? maxX : 0,
            y: point.clientY < window.innerHeight / 2 ? maxY : 0
        };
    };

    const createPublishHoverEventInit = point => ({
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: point.clientX,
        clientY: point.clientY,
        screenX: window.screenX + point.clientX,
        screenY: window.screenY + point.clientY
    });

    const dispatchPublishHoverEnterEvents = point => {
        const eventInit = createPublishHoverEventInit(point);
        const chain = [];
        const addToChain = element => {
            if (element && element.nodeType === 1 && !chain.includes(element)) {
                chain.push(element);
            }
        };

        addToChain(document.elementFromPoint(point.clientX, point.clientY));
        addToChain(point.element);

        let current = chain[0]?.parentElement;
        while (current && current !== document.body && chain.length < 8) {
            addToChain(current);
            current = current.parentElement;
        }

        chain.forEach(element => {
            dispatchPublishHoverEvent(element, "pointerover", eventInit);
            dispatchPublishHoverEvent(element, "pointerenter", eventInit);
            dispatchPublishHoverEvent(element, "pointermove", eventInit);
            dispatchPublishHoverEvent(element, "mouseover", eventInit);
            dispatchPublishHoverEvent(element, "mouseenter", eventInit);
            dispatchPublishHoverEvent(element, "mousemove", eventInit);
        });
    };

    const capturePublishHoverErrorTip = async (publishBtn, publishBtnWrap) => {
        if (!publishBtn) return null;

        const existingPublicTip = readPublishPublicTipFullText(publishBtn, publishBtnWrap);
        if (existingPublicTip) return existingPublicTip;

        const existingTip = readPublishHoverErrorTip(publishBtnWrap);
        if (existingTip) return existingTip;

        const targetAttrTip = readPublishHoverTargetAttributeTip(publishBtn, publishBtnWrap);
        if (targetAttrTip) return targetAttrTip;

        const restorePointerEvents = createPublishHoverPointerEventsOverride(publishBtn, publishBtnWrap);
        const hoverTipCapture = createPublishHoverTipCapture(publishBtnWrap);
        hoverTipCapture.getPublicTip = () => readPublishPublicTipFullText(publishBtn, publishBtnWrap);
        try {
            publishBtn.scrollIntoView({ block: "center", inline: "center" });
            await window.delay(120);
        } catch (e) {
            // footer 固定布局下 scrollIntoView 可能无意义，失败时继续 hover。
        }
        const hoverPoints = getPublishHoverPoints(publishBtn, publishBtnWrap);
        const hoverRoots = [publishBtnWrap, document.body].filter(Boolean);
        const baselineTexts = new Set(collectPublishHoverTextCandidates(hoverRoots).map(candidate => candidate.text));
        const primaryHoverPoints = hoverPoints.slice(0, 16);
        const cdpHoverPoints = hoverPoints.slice(0, 6);
        let capturedHoverText = null;
        console.log("[腾讯号发布] 🧭 发布按钮 hover 探测点:", hoverPoints.map(point => ({
            label: point.label,
            x: point.clientX,
            y: point.clientY
        })));

        try {
            if (window.browserAPI && typeof window.browserAPI.nativeMouseMove === "function") {
                try {
                    if (typeof window.browserAPI.nativeMouseHover === "function" && primaryHoverPoints.length > 0) {
                        const awayPoint = getAwayPointForPublishHover(primaryHoverPoints[0]);
                        const batchHoverPoints = [
                            { x: awayPoint.x, y: awayPoint.y, label: "away" },
                            ...createNativeHoverPointPayload(primaryHoverPoints)
                        ];
                        const batchHoverResult = await window.browserAPI.nativeMouseHover(batchHoverPoints, {
                            intervalMs: 120,
                            holdMs: 1600,
                            useSendInput: true,
                            useCdp: true
                        });
                        console.log("[腾讯号发布] 🖱️ 原生连续 hover 结果:", batchHoverResult);

                        primaryHoverPoints.forEach(dispatchPublishHoverEnterEvents);

                        const batchHoverTip = await waitForPublishHoverTipCapture(hoverTipCapture, {
                            roots: hoverRoots,
                            baselineTexts,
                            sampleDelays: [0, 80, 160, 300, 520, 800, 1200]
                        });
                        if (batchHoverTip) {
                            console.log("[腾讯号发布] ✅ 原生连续 hover 已捕获错误提示:", batchHoverTip);
                            capturedHoverText = batchHoverTip;
                            return capturedHoverText;
                        }
                    }

                    if (primaryHoverPoints[0]) {
                        const awayPoint = getAwayPointForPublishHover(primaryHoverPoints[0]);
                        await window.browserAPI.nativeMouseMove(awayPoint.x, awayPoint.y, { enter: true });
                        await window.delay(120);
                    }

                    for (const point of primaryHoverPoints) {
                        const nativeMoveResult = await window.browserAPI.nativeMouseMove(point.clientX, point.clientY, { enter: true });
                        console.log("[腾讯号发布] 🖱️ 原生 hover 尝试:", {
                            label: point.label,
                            hit: getPublishElementDebugInfo(document.elementFromPoint(point.clientX, point.clientY) || point.element),
                            result: nativeMoveResult
                        });
                        dispatchPublishHoverEnterEvents(point);

                        const nativeHoverTip = await waitForPublishHoverTipCapture(hoverTipCapture, {
                            roots: hoverRoots,
                            baselineTexts,
                            sampleDelays: [0, 40, 90, 160, 260, 420, 700, 1100, 1600]
                        });
                        if (nativeHoverTip) {
                            console.log("[腾讯号发布] ✅ 原生 hover 已捕获瞬时错误提示:", nativeHoverTip);
                            capturedHoverText = nativeHoverTip;
                            return capturedHoverText;
                        }
                    }

                    if (cdpHoverPoints[0]) {
                        const awayPoint = getAwayPointForPublishHover(cdpHoverPoints[0]);
                        await window.browserAPI.nativeMouseMove(awayPoint.x, awayPoint.y, { method: "cdp" });
                        await window.delay(120);
                    }

                    for (const point of cdpHoverPoints) {
                        const cdpMoveResult = await window.browserAPI.nativeMouseMove(point.clientX, point.clientY, { method: "cdp" });
                        console.log("[腾讯号发布] 🖱️ CDP hover 兜底尝试:", {
                            label: point.label,
                            result: cdpMoveResult
                        });
                        dispatchPublishHoverEnterEvents(point);

                        const cdpHoverTip = await waitForPublishHoverTipCapture(hoverTipCapture, {
                            roots: hoverRoots,
                            baselineTexts,
                            sampleDelays: [0, 40, 90, 160, 260, 420, 700, 1100]
                        });
                        if (cdpHoverTip) {
                            console.log("[腾讯号发布] ✅ CDP hover 已捕获瞬时错误提示:", cdpHoverTip);
                            capturedHoverText = cdpHoverTip;
                            return capturedHoverText;
                        }
                    }
                } catch (e) {
                    console.warn("[腾讯号发布] ⚠️ 原生鼠标移入失败，回退 DOM 事件:", e);
                }
            }

            if (typeof publishBtn.focus === "function") {
                try {
                    publishBtn.focus({ preventScroll: true });
                } catch (e) {
                    publishBtn.focus();
                }
            }

            for (const point of primaryHoverPoints) {
                dispatchPublishHoverEnterEvents(point);
                const hoverTip = await waitForPublishHoverTipCapture(hoverTipCapture, {
                    roots: hoverRoots,
                    baselineTexts,
                    sampleDelays: [0, 40, 90, 160, 260, 420, 700]
                });
                if (hoverTip) {
                    capturedHoverText = hoverTip;
                    return capturedHoverText;
                }
            }

            capturedHoverText = await waitForPublishHoverTipCapture(hoverTipCapture, {
                roots: hoverRoots,
                baselineTexts
            });
            if (!capturedHoverText) {
                console.log("[腾讯号发布] 🧪 hover 后仍未抓到普通元素错误文本，发布区快照:", {
                    publishWrap: publishBtnWrap ? getPublishElementDebugInfo(publishBtnWrap) : null,
                    button: getPublishElementDebugInfo(publishBtn),
                    candidatesWithoutBaseline: collectPublishHoverTextCandidates(hoverRoots)
                });
            }
            return capturedHoverText;
        } finally {
            hoverTipCapture.stop();
            restorePointerEvents();
        }
    };

    const getPublishButtonDisabledMarkers = publishBtn => {
        const markers = [];
        const seen = new Set();

        const addMarker = (element, reason) => {
            if (!element || element.nodeType !== 1 || !reason) return;

            const key = `${reason}:${element.tagName}:${element.className}:${markers.length}`;
            if (seen.has(key)) return;
            seen.add(key);

            markers.push({
                reason,
                element: getPublishElementDebugInfo(element)
            });
        };

        const candidateElements = [];
        const addCandidate = element => {
            if (element && element.nodeType === 1 && !candidateElements.includes(element)) {
                candidateElements.push(element);
            }
        };

        addCandidate(publishBtn);
        getPublishButtonTextElements(publishBtn).forEach(addCandidate);
        addCandidate(publishBtn?.closest?.("li"));
        addCandidate(publishBtn?.parentElement);
        addCandidate(publishBtn?.closest?.('[class*="tool_publish_buttons"]'));
        addCandidate(publishBtn?.closest?.('[class*="tool_right"], [class*="tool-right"]'));
        addCandidate(publishBtn?.closest?.('[class*="tool_content"], [class*="tool-content"]'));
        addCandidate(publishBtn?.closest?.('[class*="publish_tool"], [class*="publish-tool"]'));

        for (const element of candidateElements) {
            const className = String(element.className || "");
            const disabledAttr = element.getAttribute?.("disabled");
            const ariaDisabled = element.getAttribute?.("aria-disabled");
            const dataDisabled = element.getAttribute?.("data-disabled");
            const style = window.getComputedStyle(element);

            if (element.disabled === true) {
                addMarker(element, "element.disabled=true");
            }
            if (disabledAttr !== null) {
                addMarker(element, "disabled attribute");
            }
            if (ariaDisabled === "true") {
                addMarker(element, "aria-disabled=true");
            }
            if (dataDisabled === "true") {
                addMarker(element, "data-disabled=true");
            }
            if (/(^|[\s_-])(is--disabled|is-disabled|disabled|disable|forbid|forbidden)([\s_-]|$)/i.test(className)) {
                addMarker(element, `disabled class: ${className.slice(0, 120)}`);
            }
            if ((element === publishBtn || getPublishButtonTextElements(publishBtn).includes(element)) && style.pointerEvents === "none") {
                addMarker(element, "pointer-events=none on publish button/text");
            }
        }

        return markers;
    };

    const isPublishButtonDisabled = publishBtn => {
        const markers = getPublishButtonDisabledMarkers(publishBtn);
        if (markers.length > 0) {
            console.log("[腾讯号发布] 🚫 发布按钮禁用标识检测命中:", markers);
            return true;
        }

        return false;
    };

    const getPublishButtonDisabledMessage = async (publishBtn, publishBtnWrap) => {
        const hoverError = await capturePublishHoverErrorTip(publishBtn, publishBtnWrap);
        if (hoverError) {
            return hoverError;
        }

        const latestError = getLatestError();
        console.log("[腾讯号发布] ⚠️ 未捕获到 hover-only 错误文案，使用错误监听兜底:", latestError);
        return latestError || "发布按钮不可用，可能不符合发布要求，或者发文次数已用尽";
    };

    const clearPublishErrorReportLock = async publishId => {
        if (!publishId) return;

        let windowId = null;
        try {
            if (window.browserAPI && typeof window.browserAPI.getWindowId === "function") {
                windowId = await window.browserAPI.getWindowId();
            }
        } catch (e) {
            console.warn("[腾讯号发布] ⚠️ 获取窗口 ID 失败，按 default 清理失败上报锁:", e.message);
        }

        const key = `PUBLISH_STATISTICS_REPORTED_${windowId || "default"}_error`;
        try {
            const cachedRaw = sessionStorage.getItem(key);
            if (!cachedRaw) return;

            const cached = JSON.parse(cachedRaw);
            if (String(cached?.publishId || "") === String(publishId)) {
                sessionStorage.removeItem(key);
                console.log("[腾讯号发布] 🧹 已清理旧失败上报锁，允许发送最新错误文案:", key);
            }
        } catch (e) {
            console.warn("[腾讯号发布] ⚠️ 清理失败上报锁失败:", e.message);
        }
    };

    console.log("═══════════════════════════════════════");
    console.log("✅ 腾讯号发布脚本已注入");
    console.log("📍 当前 URL:", window.location.href);
    console.log("🕐 注入时间:", new Date().toLocaleString());
    console.log("═══════════════════════════════════════");

    // 检查 common.js 是否已加载
    if (typeof waitForElement === "undefined" || typeof retryOperation === "undefined") {
        console.error("[腾讯号发布] ❌ common.js 未加载！脚本可能无法正常工作");
    } else {
        console.log("[腾讯号发布] ✅ common.js 已加载，工具函数可用");
    }

    // ===========================
    // 🔴 重要：先注册消息监听器，再执行任何 await 操作！
    // 否则消息可能在 await 期间到达，但回调还没注册
    // ===========================
    console.log("[腾讯号发布] 注册消息监听器...");

    if (!window.browserAPI) {
        console.error("[腾讯号发布] ❌ browserAPI 不可用！");
    } else {
        console.log("[腾讯号发布] ✅ browserAPI 可用");

        if (!window.browserAPI.onMessageFromHome) {
            console.error("[腾讯号发布] ❌ browserAPI.onMessageFromHome 不可用！");
        } else {
            console.log("[腾讯号发布] ✅ browserAPI.onMessageFromHome 可用，正在注册...");

            window.browserAPI.onMessageFromHome(async message => {
                console.log("═══════════════════════════════════════");
                console.log("[腾讯号发布] 🎉 收到来自父窗口的消息!");
                console.log("[腾讯号发布] 消息类型:", typeof message);
                console.log("[腾讯号发布] 消息内容:", message);
                console.log("[腾讯号发布] 消息.type:", message?.type);
                console.log("[腾讯号发布] 消息.windowId:", message?.windowId);
                console.log("═══════════════════════════════════════");

                // 接收完整的发布数据（直接传递，不使用 IndexedDB）
                // 兼容 publish-data 和 auth-data 两种消息类型
                if (message.type === "publish-data") {
                    // 使用公共方法解析消息数据
                    const messageData = parseMessageData(message.data, "[腾讯号发布]");
                    if (!messageData) return;

                    // 使用公共方法检查 windowId 是否匹配
                    const isMatch = await checkWindowIdMatch(message, "[腾讯号发布]");
                    if (!isMatch) return;

                    // 使用公共方法恢复会话数据
                    const needReload = await restoreSessionAndReload(messageData, "[腾讯号发布]");
                    if (needReload) return; // 已触发刷新，脚本会重新注入

                    // windowId 匹配后才保存消息数据
                    receivedMessageData = messageData;
                    console.log("[腾讯号发布] 💾 已保存收到的消息数据到 receivedMessageData");

                    console.log("[腾讯号发布] ✅ 收到发布数据:", messageData);

                    // 防重复检查
                    if (isProcessing) {
                        console.warn("[腾讯号发布] ⚠️ 正在处理中，忽略重复消息");
                        return;
                    }
                    if (hasProcessed) {
                        console.warn("[腾讯号发布] ⚠️ 已经处理过，忽略重复消息");
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
                        console.log("[腾讯号发布] ✅ 发布数据已更新:", window.__AUTH_DATA__);
                        console.log("🚀 ~  ~ messageData: ", messageData);

                        try {
                            await retryOperation(async () => await fillFormData(messageData), 3, 2000);
                        } catch (e) {
                            console.log("[腾讯号发布] ❌ 填写表单数据失败:", e);
                        }

                        console.log("[腾讯号发布] 📤 准备发送数据到接口...");
                        console.log("[腾讯号发布] ✅ 发布流程已启动，等待 publishApi 完成...");
                    }

                    // 重置处理标志（无论成功或失败）
                    isProcessing = false;
                    console.log("[腾讯号发布] 处理完成，isProcessing=false, hasProcessed=", hasProcessed);
                }
            });

            console.log("[腾讯号发布] ✅ 消息监听器注册成功");
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
        console.log("[腾讯号发布] 当前窗口 ID:", currentWindowId);
    } catch (e) {
        console.error("[腾讯号发布] ❌ 获取窗口 ID 失败:", e);
    }

    console.log("[腾讯号发布] URL 参数:", {
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

    window.__TXH_AUTH__ = {
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
    console.log("[腾讯号发布] 页面加载完成，发送 页面加载完成 消息");
    sendMessageToParent("页面加载完成");

    console.log("═══════════════════════════════════════");
    console.log("✅ 腾讯号发布脚本初始化完成");
    console.log("📝 全局方法: window.__TXH_AUTH__");
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
            console.log("[腾讯号发布] ⏭️ 已在处理中或已完成，跳过全局存储读取");
            return;
        }

        try {
            // 获取当前窗口 ID
            const windowId = await window.browserAPI.getWindowId();
            console.log("[腾讯号发布] 检查全局存储，窗口 ID:", windowId);

            if (!windowId) {
                console.log("[腾讯号发布] ❌ 无法获取窗口 ID");
                return;
            }

            // 检查是否有恢复 cookies 后保存的发布数据
            const publishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
            console.log("[腾讯号发布] 📦 从全局存储读取 publish_data_window_" + windowId + ":", publishData ? "有数据" : "无数据");

            if (publishData && !isProcessing && !hasProcessed) {
                console.log("[腾讯号发布] ✅ 检测到恢复 cookies 后的数据，开始处理...");

                // 🔑 不再立即删除数据，改为在发布完成后删除
                // 这样如果登录跳转后跳回来，数据仍然可用
                // 使用 hasProcessed 标记防止重复处理
                console.log("[腾讯号发布] 📝 保留 publish_data_window_" + windowId + " 数据，待发布完成后清理");

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
                    console.log("[腾讯号发布] ❌ 填写表单数据失败:", e);
                }

                console.log("[腾讯号发布] 📤 准备发送数据到接口...");
                console.log("[腾讯号发布] ✅ 发布流程已启动，等待 publishApi 完成...");

                isProcessing = false;
            }
        } catch (error) {
            console.error("[腾讯号发布] ❌ 从全局存储读取数据失败:", error);
        }
    })();

    // ===========================
    // 7. 从全局存储读取发布数据（备用方案，不依赖消息）
    // ===========================

    // ===========================
    // 8. 检查是否有保存的发布数据（授权跳转恢复）
    // ===========================

    // ===========================
    // 9. 发布视频到腾讯号（移到 IIFE 内部以访问变量）
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

            setTimeout(async () => {
                // 标题（带重试和验证）
                await retryOperation(
                    async () => {
                        const titleEle = await waitForElement(".omui-articletitle__input1 .omui-inputautogrowing__inner", 5000);
                        console.log("🚀 ~  ~ titleEle: ", titleEle);

                        // 先触发focus事件
                        if (typeof titleEle.focus === "function") {
                            titleEle.focus();
                        } else {
                            titleEle.dispatchEvent(new Event("focus", { bubbles: true }));
                        }

                        // 延迟执行，让React状态稳定
                        await window.delay(300);

                        const targetTitle = dataObj.video.video.title || ""

                        // 清空原有内容
                        titleEle.innerText = "";
                        await window.delay(100);

                        // 设置新标题
                        titleEle.innerText = targetTitle;

                        // 🔴 触发多个事件确保 React 同步
                        titleEle.dispatchEvent(new Event("input", { bubbles: true }));
                        titleEle.dispatchEvent(new Event("change", { bubbles: true }));
                        titleEle.dispatchEvent(new InputEvent("input", {
                            bubbles: true,
                            cancelable: true,
                            inputType: "insertText",
                            data: targetTitle
                        }));

                        // 模拟键盘输入结束
                        titleEle.dispatchEvent(new Event("blur", { bubbles: true }));
                        await window.delay(100);
                        titleEle.focus();

                        console.log("[腾讯号发布] ✅ 已填写标题:", targetTitle);
                    },
                    5,
                    1000,
                );

                try {
                    // 内容（带重试）
                    setTimeout(async () => {
                        try {
                            await retryOperation(
                                async () => {
                                    const editorIframeEle = await waitForElement("class^=editor_container", 20000); // 🔑 增加到 20 秒
                                    const editorEle = editorIframeEle.querySelector(".ExEditor-basic");

                                    editorEle.focus();
                                    editorEle.innerHTML = "";
                                    console.log("[腾讯号发布] ✅ 已清空富文本编辑器");

                                    let htmlContent = dataObj.video.video.content;

                                    // 解析 HTML 中的图片，通过腾讯号 dumpproxy 接口上传
                                    const tempDiv = document.createElement("div");
                                    tempDiv.innerHTML = htmlContent;
                                    const images = tempDiv.querySelectorAll("img");

                                    console.log("[腾讯号发布] 🖼️ 发现", images.length, "张图片需要处理");

                                    // 获取转换后的 HTML
                                    htmlContent = tempDiv.innerHTML;

                                    // 🔴 清理开头的空白 - 直接删除文字内容之前的所有HTML
                                    const tempCleaner = document.createElement("div");
                                    tempCleaner.innerHTML = htmlContent;

                                    // 递归删除所有开头的空节点，直到找到第一个有非空文本的节点
                                    function removeLeadingEmptyNodes(node) {
                                        while (node.firstChild) {
                                            const child = node.firstChild;
                                            if (child.nodeType === 3) {
                                                // 文本节点
                                                const trimmedText = child.textContent.trim();
                                                if (trimmedText) {
                                                    // 有内容，保留但删除前面的空白
                                                    child.textContent = trimmedText + "\u200B"; // 用零宽字符保留格式
                                                    return true; // 找到了内容，停止
                                                } else {
                                                    node.removeChild(child);
                                                }
                                            } else if (child.nodeType === 1) {
                                                // 元素节点
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
                                    htmlContent = tempCleaner.innerHTML.replace(/\u200B/g, "").trim();
                                    console.log("[腾讯号发布] 🧹 已清理开头所有空白内容");

                                    // 让编辑器获得焦点
                                    editorEle.focus();
                                    await delay(500); // 🔑 增加到 500ms

                                    // 用键盘事件全选+删除（保持编辑器状态同步）
                                    editorEle.dispatchEvent(new KeyboardEvent('keydown', {
                                        key: 'a',
                                        code: 'KeyA',
                                        ctrlKey: true,
                                        bubbles: true
                                    }));
                                    await delay(200); // 🔑 增加到 200ms
                                    editorEle.dispatchEvent(new KeyboardEvent('keydown', {
                                        key: 'Backspace',
                                        code: 'Backspace',
                                        bubbles: true
                                    }));
                                    await delay(500); // 🔑 增加到 500ms

                                    // 通过粘贴事件插入内容（让编辑器自己处理）
                                    const pasteEvent = new ClipboardEvent("paste", {
                                        clipboardData: new DataTransfer(),
                                        bubbles: true,
                                        cancelable: true,
                                    });

                                    // 设置粘贴的 HTML 和纯文本内容
                                    pasteEvent.clipboardData.setData("text/html", htmlContent);
                                    pasteEvent.clipboardData.setData("text/plain", tempDiv.textContent);

                                    editorEle.dispatchEvent(pasteEvent);

                                    // 等待编辑器处理粘贴事件
                                    await window.delay(1500); // 🔑 增加到 1.5 秒

                                    console.log("[腾讯号发布] ✅ 内容填写完成");
                                },
                                3,
                                1000,
                            );
                        } catch (e) {
                            console.log("[腾讯号发布] ❌ 内容填写失败:", e.message);
                        }
                    }, window.getRandomDelayMs(200));
                } catch (e) {
                    console.log("[腾讯号发布] ❌ 内容填写失败:", e.message);
                }

                // 设置封面为单图模式
                const hasSettingsWrapEle = await waitForElement("class^=articleCoverWrap-");
                if (hasSettingsWrapEle) {
                    const coverRadioEle = hasSettingsWrapEle.querySelectorAll(".omui-radio");
                    for (let coverRadioEleElement of coverRadioEle) {
                        const radioInput = coverRadioEleElement.querySelector("input");
                        if (coverRadioEleElement.innerText === "单图") {
                            setNativeValue(radioInput, true);
                        } else {
                            setNativeValue(radioInput, false);
                        }
                    }

                    // 🔴 启动全局错误监听器（已在 IIFE 顶层定义）
                    startErrorListener();

                    // 设置封面（使用主进程下载绕过跨域）
                    await (async () => {
                        try {
                            const { blob, contentType } = await downloadFile(pathImage, "image/png");
                            var file = new File([blob], dataObj?.video?.formData?.title + ".png", { type: contentType || "image/png" });

                            setTimeout(async () => {
                                // 选中本地上传（点击"选择封面"按钮）
                                setTimeout(async () => {
                                    // 等待封面选择区域出现
                                    await waitForElement("class^=articleCoverWrap-");
                                    await delay(1000); // 🔑 增加到 1 秒

                                    // 查找并点击"选择封面"按钮
                                    const coverBtn = document.querySelector("[class*=addCoverBtn-]");
                                    console.log("🚀 ~  ~ coverBtn: ", coverBtn);
                                    if (coverBtn) {
                                        coverBtn.click();
                                    }else{
                                        //检查是否已经有图片
                                        const coverWrapperEle = await waitForElement(".omui-thumb__figure");
                                        if (coverWrapperEle) {
                                            const imgEle = coverWrapperEle.querySelector("img");
                                            const coverBg = imgEle.getAttribute("src");
                                            if (imgEle) {
                                                // 检查是否有图片
                                                if (coverBg) {
                                                    console.log("[腾讯号发布] ✅ 已经有图片");
                                                    const closeBtns = coverWrapperEle.querySelectorAll(".omui-thumb__action span");
                                                    closeBtns.forEach(btn => {
                                                        if (btn.textContent.trim() === "更换") {
                                                            btn.click();
                                                        }
                                                    });
                                                } else {
                                                    console.log("[腾讯号发布] ❌ 没有图片");
                                                }
                                            }
                                        }
                                    }
                                    await delay(1000); // 等待渲染完成

                                    // 封面上传弹窗弹出后选中还有本地上传的tab
                                    const uploadTabs = document.querySelectorAll(".omui-dialog .omui-tab__nav .omui-tab__label");
                                    console.log("🚀 ~  ~ uploadTabs: ", uploadTabs);
                                    let uploadFromLocalTab = null;
                                    if (uploadTabs.length) {
                                        for (const tab of uploadTabs) {
                                            if (tab.textContent.trim().includes("本地")) {
                                                uploadFromLocalTab = tab;
                                            }
                                        }
                                    }
                                    await delay(1000); // 等待渲染完成
                                    console.log("🚀 ~  ~ uploadFromLocalTab: ", uploadFromLocalTab);
                                    if (uploadFromLocalTab) {
                                        uploadFromLocalTab.click();
                                    } else {
                                        console.log("找不到本地上传tab");
                                    }

                                    setTimeout(async () => {
                                        // 使用原生选择器获取元素
                                        const hasInputEle = await waitForElement(".omui-upload-image-list");
                                        if (hasInputEle) {
                                            const input = document.querySelector("input[type='file']");
                                            const dataTransfer = new DataTransfer();
                                            // 创建 DataTransfer 对象模拟文件上传
                                            dataTransfer.items.add(file);
                                            input.files = dataTransfer.files;
                                            const event = new Event("change", { bubbles: true });
                                            input.dispatchEvent(event);

                                            // 封装上传检测与重试逻辑
                                            const tryUploadImage = async (retryCount = 0) => {
                                                const maxRetries = 3;

                                                // 🔴 自定义等待逻辑：同时检查图片元素和错误信息
                                                const waitForImageOrError = async (timeout = 30000) => { // 🔑 增加到 30 秒
                                                    const startTime = Date.now();
                                                    const checkInterval = 500; // 🔑 增加到 500ms

                                                    while (Date.now() - startTime < timeout) {
                                                        // 1. 先检查是否有错误信息（优先级更高）
                                                        const errorMsg = getLatestError();
                                                        if (errorMsg) {
                                                            return { type: "error", message: errorMsg };
                                                        }

                                                        // 2. 再检查图片元素是否出现
                                                        const imageEle = document.querySelector(".omui-upload-image-item:nth-of-type(1)");
                                                        console.log("🚀 ~ waitForImageOrError ~ imageEle: ", imageEle);
                                                        if (imageEle) {
                                                            const imgEle = imageEle.querySelector("img");
                                                            if (imgEle && imgEle.getAttribute("src")) {
                                                                // 🔑 检测到图片元素后，再等待 1 秒确认是否有错误（增加到 1 秒）
                                                                // 因为 MutationObserver 是异步的，错误信息可能还在路上
                                                                console.log("[腾讯号发布] 🔍 检测到图片元素，等待 1 秒确认是否有错误...");
                                                                await delay(1000);
                                                                const confirmError = getLatestError();
                                                                if (confirmError) {
                                                                    console.log("[腾讯号发布] ⚠️ 确认期间检测到错误:", confirmError);
                                                                    return { type: "error", message: confirmError };
                                                                }
                                                                return { type: "success", element: imageEle };
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
                                                        return { type: "error", message: finalError };
                                                    }

                                                    return { type: "timeout" };
                                                };

                                                const result = await waitForImageOrError(30000); // 🔑 增加到 30 秒
                                                const myWindowId = await window.browserAPI.getWindowId();

                                                // 🔴 检测到错误信息，直接上报失败
                                                if (result.type === "error") {
                                                    console.log(`[腾讯号发布] [窗口${myWindowId}] ❌ 检测到错误信息，直接上报失败: ${result.message}`);
                                                    stopErrorListener();
                                                    const publishId = dataObj.video?.dyPlatform?.id;
                                                    if (publishId) {
                                                        await sendStatisticsError(publishId, result.message, "腾讯号发布");
                                                    }
                                                    await closeWindowWithMessage("发布失败，刷新数据", 1000);
                                                    return; // 不再继续
                                                }

                                                if (result.type === "success") {
                                                    console.log("[腾讯号发布] ✅ 图片上传成功");

                                                    await delay(3000); // 🔑 增加到 3 秒

                                                    const submitCoverBtn = document.querySelector(".omui-dialog-footer .omui-button--primary");
                                                    console.log("🚀 ~ tryUploadImage ~ submitCoverBtn: ", submitCoverBtn);
                                                    // 点击确定按钮
                                                    if (submitCoverBtn) {
                                                        // 使用模拟真实鼠标事件，确保点击生效
                                                        const clickEvent = new MouseEvent("click", {
                                                            view: window,
                                                            bubbles: true,
                                                            cancelable: true,
                                                        });
                                                        submitCoverBtn.dispatchEvent(clickEvent);
                                                        console.log("[腾讯号发布] ✅ 已点击确定（模拟鼠标事件）");
                                                        // 等待编辑器关闭和图片保存
                                                        await delay(3000); // 🔑 增加到 3 秒
                                                    } else {
                                                        console.error("[腾讯号发布] ❌ 找不到提交图片按钮，上报失败");
                                                        stopErrorListener();
                                                        const publishId = dataObj.video?.dyPlatform?.id;
                                                        if (publishId) {
                                                            await sendStatisticsError(publishId, "找不到提交图片按钮", "腾讯号发布");
                                                        }
                                                        await closeWindowWithMessage("发布失败，刷新数据", 1000);
                                                        return;
                                                    }

                                                    // 自主声明
                                                    const declarationArea = await waitForElement("#articlePublish-selfDeclaration");
                                                    if(declarationArea){
                                                        const declarationTitle = declarationArea.querySelector(".omui-contentbutton__title");
                                                        console.log("🚀 ~ tryUploadImage ~ declarationTitle: ", declarationTitle);
                                                        if(declarationTitle){
                                                            if(declarationTitle.textContent.includes("作者声明")){
                                                                const closeBtn = declarationArea.querySelector(".omui-contentbutton__remove");
                                                                if(closeBtn){
                                                                    closeBtn.click();
                                                                }
                                                            }
                                                        }
                                                        await delay(1000);
                                                        const declarationBtns = declarationArea.querySelectorAll(".omui-button--dashed");
                                                        console.log("🚀 ~ tryUploadImage ~ declarationBtns: ", declarationBtns);
                                                        for (let declarationBtn of declarationBtns) {
                                                            if (declarationBtn.textContent.includes("自主声明")) {
                                                                declarationBtn.click();
                                                                break;
                                                            }
                                                        }
                                                        await delay(1000);
                                                        const declarationDialog = await waitForDialogByTitle("自主声明", 5000);
                                                        console.log("🚀 ~ tryUploadImage ~ declarationDialog: ", declarationDialog);
                                                        if (declarationDialog) {
                                                            const dialogTitle = declarationDialog.querySelector(".omui-dialog-header");
                                                            console.log("🚀 ~ tryUploadImage ~ dialogTitle: ", dialogTitle);
                                                            if (dialogTitle && dialogTitle.textContent.includes("自主声明")) {
                                                                const declarationAudios = declarationDialog.querySelectorAll(".omui-radio");
                                                                if (declarationAudios.length) {
                                                                    let systemType = getCurrentSystem();
                                                                    let declarationRadioChanged = false;
                                                                    declarationAudios.forEach(item => {
                                                                        console.log("🚀 ~  ~ item: ", item);
                                                                        const systemRaidoTextMap = {
                                                                            aigc: '暂无声明',
                                                                            geo: '该文章由AI生成'
                                                                        };
                                                                        const labelEle = item.querySelector(".omui-radio__label");
                                                                        console.log("🚀 ~  ~ labelEle: ", labelEle);
                                                                        if (labelEle && labelEle.textContent.includes(systemRaidoTextMap[systemType])) {
                                                                            const radioInput = item.querySelector(".omui-radio__input");
                                                                            if (radioInput) {
                                                                                setNativeValue(radioInput, true);
                                                                                declarationRadioChanged = true;
                                                                            }
                                                                        }else{
                                                                            const radioInput = item.querySelector(".omui-radio__input");
                                                                            if (radioInput) {
                                                                                setNativeValue(radioInput, false);
                                                                            }
                                                                        }
                                                                    });
                                                                    if (declarationRadioChanged) {
                                                                        await confirmAIDeclarationDialog(3000);
                                                                    }
                                                                    const confirmBtn = declarationDialog.querySelector(".omui-button--primary");
                                                                    console.log("🚀 ~ tryUploadImage ~ confirmBtn: ", confirmBtn);
                                                                    if (confirmBtn) {
                                                                        confirmBtn.click();
                                                                        await confirmAIDeclarationDialog(3000);
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    } else {
                                                        console.log("[腾讯号发布] ✅ 未找到自主声明区域");
                                                    }

                                                    await delay(2000);
                                                    const publishTime = dataObj.video.formData.send_set;
                                                    console.log("🚀 ~ tryUploadImage ~ publishTime: ", publishTime);

                                                    const publishBtnWrap = document.querySelector('footer[class*="publish_tool-"]');
                                                    console.log("🚀 ~ tryUploadImage ~ publishBtnWrap: ", publishBtnWrap);
                                                    if (publishBtnWrap) {
                                                        // 找发布按钮
                                                        const publishBtns = document.querySelectorAll(".omui-button--primary");
                                                        if (publishBtns.length > 0) {
                                                            let scheduledReleasesBtn = null;
                                                            let publishBtn = null;
                                                            publishBtns.forEach(item => {
                                                                if (item.textContent.includes("定时")) {
                                                                    scheduledReleasesBtn = item;
                                                                } else if (item.textContent.includes("发布")) {
                                                                    publishBtn = item;
                                                                }
                                                            });

                                                            if (+publishTime === 2) {
                                                                if (scheduledReleasesBtn) {
                                                                    console.log("🚀 ~ tryUploadImage ~ scheduledReleasesBtn: ", scheduledReleasesBtn);
                                                                    if (scheduledReleasesBtn) {
                                                                        if (isPublishButtonDisabled(scheduledReleasesBtn)) {
                                                                            console.error("[腾讯号发布] ❌ 定时发布按钮不可用(disabled)");
                                                                            stopErrorListener();
                                                                            clearLatestErrors();
                                                                            const disabledErrorMessage = await getPublishButtonDisabledMessage(scheduledReleasesBtn, publishBtnWrap);
                                                                            console.log("[腾讯号发布] 📨 定时发布按钮 hover 错误提示:", disabledErrorMessage);
                                                                            const publishIdForError = dataObj.video?.dyPlatform?.id;
                                                                            if (publishIdForError) {
                                                                                await clearPublishErrorReportLock(publishIdForError);
                                                                                const reportResult = await sendStatisticsError(publishIdForError, disabledErrorMessage, "腾讯号发布");
                                                                                console.log("[腾讯号发布] 📤 定时发布按钮 disabled 失败上报结果:", reportResult);
                                                                            }
                                                                            await closeWindowWithMessage("发布失败，刷新数据", 1000);
                                                                            return;
                                                                        }

                                                                        const clickEvent = new MouseEvent("click", {
                                                                            view: window,
                                                                            bubbles: true,
                                                                            cancelable: true,
                                                                        });
                                                                        scheduledReleasesBtn.dispatchEvent(clickEvent);
                                                                        console.log("[腾讯号发布] ✅ 已点击定时发布（模拟鼠标事件）");
                                                                        await delay(2000);

                                                                        // 腾讯的ai生成声明确认弹窗
                                                                        await AICreatePopup();

                                                                        //  检测有没有定时发布弹窗
                                                                        const scheduledReleasesModal = await  waitForElement(".omui-dialog-wrapper");
                                                                        if (scheduledReleasesModal) {
                                                                            console.log("[腾讯号发布] ✅ 检测到定时发布弹窗");

                                                                            // 解析定时发布时间
                                                                            const sendTime = dataObj.video?.formData?.send_time;

                                                                            if (!sendTime) {
                                                                                console.error("[腾讯号发布] ❌ 解析定时时间失败");
                                                                                stopErrorListener();
                                                                                await closeWindowWithMessage("定时时间解析失败", 1000);
                                                                                return;
                                                                            }

                                                                            console.log("[腾讯号发布] ⏰ 开始选择定时发布时间:", sendTime)

                                                                            // 调用选择时间函数
                                                                            const timeSelectSuccess = await selectScheduledTime(sendTime);

                                                                            if (!timeSelectSuccess) {
                                                                                console.error("[腾讯号发布] ❌ 时间选择失败");
                                                                                stopErrorListener();
                                                                                await closeWindowWithMessage("定时时间选择失败", 1000);
                                                                                return;
                                                                            }

                                                                            // 点击确定发布按钮
                                                                            await delay(500);
                                                                            const confirmBtn = document.querySelector(".omui-button--primary");

                                                                            if (confirmBtn) {
                                                                                console.log("[腾讯号发布] ✅ 点击确定定时发布");

                                                                                // 🔑 在点击定时发布前保存 publishId，让首页可以调用统计接口
                                                                                const publishId = dataObj.video?.dyPlatform?.id;
                                                                                if (publishId) {
                                                                                    try {
                                                                                        // 同时设置全局变量和 localStorage，确保标志能被检测到
                                                                                        window.__tengxunPublishSuccessFlag = true;
                                                                                        localStorage.setItem(getPublishSuccessKey(), JSON.stringify({ publishId: publishId }));
                                                                                        console.log("[腾讯号发布] 💾 已保存 publishId（全局变量 + localStorage）:", publishId);

                                                                                        // 🔑 同时保存到 globalData（更可靠，不受域名隔离限制）
                                                                                        if (window.browserAPI && window.browserAPI.setGlobalData) {
                                                                                            await window.browserAPI.setGlobalData(`PUBLISH_SUCCESS_DATA_${currentWindowId}`, {publishId: publishId});
                                                                                            console.log('[腾讯号发布] 💾 已保存 publishId 到 globalData');
                                                                                        }
                                                                                    } catch (e) {
                                                                                        console.error("[腾讯号发布] ❌ 保存 publishId 失败:", e);
                                                                                    }
                                                                                } else {
                                                                                    // 即使没有 publishId，也要设置全局变量允许跳转
                                                                                    window.__sohuPublishSuccessFlag = true;
                                                                                    console.log("[腾讯号发布] ℹ️ 没有 publishId，但已设置跳转标志");
                                                                                }

                                                                                confirmBtn.click();

                                                                                await handleProtocolPopup(() => {
                                                                                    confirmBtn.click();
                                                                                });

                                                                                // 定时发布点击后会立即跳转到成功页
                                                                                console.log("[腾讯号发布] ✅ 等待页面跳转到首页");
                                                                                stopErrorListener();
                                                                            } else {
                                                                                console.error("[腾讯号发布] ❌ 未找到确定按钮");
                                                                            }
                                                                        }
                                                                    }
                                                                }
                                                            } else {
                                                                //  点击发布按钮
                                                                if (publishBtn) {
                                                                    console.log("🚀 ~ tryUploadImage ~ publishBtn: ", publishBtn);
                                                                    console.log(publishBtn.disabled, 'publishBtn.disabled');
                                                                    console.log(publishBtn.classList.contains("is--disabled"), 'publishBtn.classList.contains("is--disabled")');
                                                                    console.log(publishBtn.getAttribute("disabled") !== null, 'publishBtn.getAttribute("disabled") !== null');
                                                                    // 🔑 检查发布按钮是否 disabled
                                                                    if (isPublishButtonDisabled(publishBtn)) {
                                                                        console.error("[腾讯号发布] ❌ 发布按钮不可用(disabled)");
                                                                        stopErrorListener();
                                                                        clearLatestErrors();
                                                                        const disabledErrorMessage = await getPublishButtonDisabledMessage(publishBtn, publishBtnWrap);
                                                                        console.log("[腾讯号发布] 📨 发布按钮 hover 错误提示:", disabledErrorMessage);
                                                                        const publishIdForError = dataObj.video?.dyPlatform?.id;
                                                                        if (publishIdForError) {
                                                                            await clearPublishErrorReportLock(publishIdForError);
                                                                            const reportResult = await sendStatisticsError(publishIdForError, disabledErrorMessage, "腾讯号发布");
                                                                            console.log("[腾讯号发布] 📤 发布按钮 disabled 失败上报结果:", reportResult);
                                                                        }
                                                                        await closeWindowWithMessage("发布失败，刷新数据", 1000);
                                                                        return;
                                                                    }

                                                                    // 🔑 在点击发布前保存 publishId，让首页可以调用统计接口
                                                                    const publishId = dataObj.video?.dyPlatform?.id;
                                                                    if (publishId) {
                                                                        try {
                                                                            // 同时设置全局变量和 localStorage，确保标志能被检测到
                                                                            window.__sohuPublishSuccessFlag = true;
                                                                            localStorage.setItem(getPublishSuccessKey(), JSON.stringify({ publishId: publishId }));
                                                                            console.log("[腾讯号发布] 💾 已保存 publishId（全局变量 + localStorage）:", publishId);

                                                                            // 🔑 同时保存到 globalData（更可靠，不受域名隔离限制）
                                                                            if (window.browserAPI && window.browserAPI.setGlobalData) {
                                                                                await window.browserAPI.setGlobalData(`PUBLISH_SUCCESS_DATA_${currentWindowId}`, {publishId: publishId});
                                                                                console.log('[腾讯号发布] 💾 已保存 publishId 到 globalData');
                                                                            }
                                                                        } catch (e) {
                                                                            console.error("[腾讯号发布] ❌ 保存 publishId 失败:", e);
                                                                        }
                                                                    } else {
                                                                        // 即使没有 publishId，也要设置全局变量允许跳转
                                                                        window.__sohuPublishSuccessFlag = true;
                                                                        console.log("[腾讯号发布] ℹ️ 没有 publishId，但已设置跳转标志");
                                                                    }

                                                                    const clickEvent = new MouseEvent("click", {
                                                                        view: window,
                                                                        bubbles: true,
                                                                        cancelable: true,
                                                                    });
                                                                    publishBtn.dispatchEvent(clickEvent);
                                                                    console.log("[腾讯号发布] ✅ 已点击发布（模拟鼠标事件）");

                                                                    // 腾讯的ai生成声明确认弹窗
                                                                    await AICreatePopup();

                                                                    await handleProtocolPopup(() => {
                                                                        publishBtn.dispatchEvent(clickEvent);
                                                                    })
                                                                } else {
                                                                    console.error("[腾讯号发布] ❌ 找不到发布按钮，上报失败");
                                                                    stopErrorListener();
                                                                    const publishId = dataObj.video?.dyPlatform?.id;
                                                                    if (publishId) {
                                                                        await sendStatisticsError(publishId, "发布按钮不可用", "腾讯号发布");
                                                                    }
                                                                    await closeWindowWithMessage("发布失败，刷新数据", 1000);
                                                                    return;
                                                                }
                                                            }
                                                        } else {
                                                            console.error("[腾讯号发布] ❌ 找不到发布按钮，上报失败");
                                                            stopErrorListener();
                                                            const publishId = dataObj.video?.dyPlatform?.id;
                                                            if (publishId) {
                                                                await sendStatisticsError(publishId, "发布按钮不可用", "腾讯号发布");
                                                            }
                                                            await closeWindowWithMessage("发布失败，刷新数据", 1000);
                                                            return;
                                                        }
                                                    } else {
                                                        const publishId = dataObj.video?.dyPlatform?.id;
                                                        if (publishId) {
                                                            await sendStatisticsError(publishId, "找不到发布按钮", "腾讯号发布");
                                                        }
                                                        await closeWindowWithMessage("发布失败，刷新数据", 1000);
                                                        return;
                                                    }
                                                } else {
                                                    // 图片上传失败（timeout），检查是否有错误信息
                                                    const myWindowId = await window.browserAPI.getWindowId();
                                                    console.log(`[腾讯号发布] [窗口${myWindowId}] ❌ 图片上传失败，重试次数: ${retryCount}/${maxRetries}`);

                                                    // 优先使用全局错误监听器捕获的错误
                                                    const errorMessage = getLatestError();
                                                    console.log(`[腾讯号发布] [窗口${myWindowId}] 📨 最新错误信息:`, errorMessage);

                                                    // 🔴 有错误信息就直接走失败接口，不再重试
                                                    if (errorMessage) {
                                                        console.log(`[腾讯号发布] [窗口${myWindowId}] ❌ 检测到错误信息，直接上报失败，不再重试`);
                                                        stopErrorListener(); // 停止监听
                                                        const publishId = dataObj.video?.dyPlatform?.id;
                                                        console.log(`[腾讯号发布] [窗口${myWindowId}] 📋 publishId:`, publishId);
                                                        console.log(`[腾讯号发布] [窗口${myWindowId}] 📋 dataObj:`, dataObj);
                                                        if (publishId) {
                                                            console.log(`[腾讯号发布] [窗口${myWindowId}] 📤 调用 sendStatisticsError...`);
                                                            await sendStatisticsError(publishId, errorMessage, "腾讯号发布");
                                                            console.log(`[腾讯号发布] [窗口${myWindowId}] ✅ sendStatisticsError 完成`);
                                                        } else {
                                                            console.error(`[腾讯号发布] [窗口${myWindowId}] ❌ publishId 为空，无法调用失败接口！`);
                                                        }
                                                        await closeWindowWithMessage("发布失败，刷新数据", 1000);
                                                        return; // 不再继续
                                                    }

                                                    // 没有错误信息才重试
                                                    if (retryCount < maxRetries) {
                                                        console.log(`[腾讯号发布] 🔄 ${2}秒后重新上传图片...`);
                                                        await delay(2000);

                                                        // 重新触发文件上传
                                                        const input = document.querySelector(".cheetah-upload input");
                                                        if (input) {
                                                            input.files = dataTransfer.files;
                                                            const event = new Event("change", { bubbles: true });
                                                            input.dispatchEvent(event);
                                                            console.log("[腾讯号发布] 🔄 已重新触发上传");

                                                            // 递归重试
                                                            await delay(2000);
                                                            await tryUploadImage(retryCount + 1);
                                                        } else {
                                                            console.error("[腾讯号发布] ❌ 无法找到上传输入框，无法重试");
                                                            stopErrorListener();
                                                            const publishId = dataObj.video?.dyPlatform?.id;
                                                            if (publishId) {
                                                                await sendStatisticsError(publishId, "图片上传失败，无法找到上传输入框", "腾讯号发布");
                                                            }
                                                            await closeWindowWithMessage("图片上传失败，刷新数据", 1000);
                                                        }
                                                    } else {
                                                        // 超过最大重试次数
                                                        console.error("[腾讯号发布] ❌ 图片上传重试次数已用尽");
                                                        stopErrorListener();
                                                        const publishId = dataObj.video?.dyPlatform?.id;
                                                        if (publishId) {
                                                            await sendStatisticsError(publishId, "图片上传失败，重试次数已用尽", "腾讯号发布");
                                                        }
                                                        await closeWindowWithMessage("图片上传失败，刷新数据", 1000);
                                                    }
                                                }
                                            };

                                            // 启动上传检测（延迟2秒等待上传开始）
                                            setTimeout(async () => {
                                                await tryUploadImage(0);
                                            }, window.getRandomDelayMs(2000));
                                        }
                                    }, window.getRandomDelayMs(1000));
                                }, window.getRandomDelayMs(2000));
                            }, window.getRandomDelayMs(1000));
                        } catch (error) {
                            console.log("[腾讯号发布] ❌ 封面下载失败:", error);
                            stopErrorListener();
                            const publishId = dataObj?.video?.dyPlatform?.id;
                            if (publishId) {
                                await sendStatisticsError(publishId, error.message || "封面下载失败", "腾讯号发布");
                            }
                            await closeWindowWithMessage("封面下载失败，刷新数据", 1000);
                        }
                    })();
                }

                fillFormRunning = false;
                // alert('Automation process completed');
            }, window.getRandomDelayMs(10000));
        } catch (error) {
            // 捕获填写表单过程中的任何错误（仅捕获 setTimeout 调度前的同步错误）
            console.error("[腾讯号发布] fillFormData 错误:", error);
            // 发送错误上报
            const publishId = dataObj?.video?.dyPlatform?.id;
            if (publishId) {
                await sendStatisticsError(publishId, error.message || "填写表单失败", "腾讯号发布");
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

//    协议弹窗处理（用短超时检测，避免长时间等待）
    async function handleProtocolPopup(callback) {
        console.log("[腾讯号发布] 检测协议弹窗...");

        try {
            //    激励活动合作框架协议弹窗（用 3 秒短超时）
            const protocolDialogEle = await waitForElement("class^=signedDialog", 3000);
            console.log("🚀 ~ handleProtocolPopup ~ protocolDialogEle: ", protocolDialogEle);
            if (protocolDialogEle) {
                const dialogTitle = protocolDialogEle.querySelector(".omui-dialog-header");
                console.log("🚀 ~ tryUploadImage ~ dialogTitle: ", dialogTitle);
                if (dialogTitle && dialogTitle.textContent.includes("协议签署")) {
                    const agreeCheckBox = protocolDialogEle.querySelector(".omui-checkbox__input");
                    console.log("🚀 ~ tryUploadImage ~ agreeCheckBox: ", agreeCheckBox);
                    if (agreeCheckBox) {
                        setNativeValue(agreeCheckBox, true);
                    }
                    await delay(1000);
                    const confirmBtn = protocolDialogEle.querySelector(".omui-button--primary:not(.is--disabled)");
                    console.log("🚀 ~ handleProtocolPopup ~ confirmBtn: ", confirmBtn);
                    if (confirmBtn) {
                        confirmBtn.click();
                        await delay(1000);
                        // 协议确认后，如果需要重新点击发布按钮
                        callback && callback();
                    }
                }
            }
        } catch (e) {
            console.log("[腾讯号发布] ℹ️ 未检测到协议弹窗，继续执行");
            callback && callback();
        }
    }

    function isVisibleElement(element) {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
            && rect.height > 0
            && style.display !== "none"
            && style.visibility !== "hidden"
            && style.opacity !== "0";
    }

    function getDialogTitleText(dialog) {
        return dialog?.querySelector(".omui-dialog-header")?.textContent?.trim() || "";
    }

    async function waitForDialogByTitle(titleText, timeout = 3000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            const dialogs = Array.from(document.querySelectorAll(".omui-dialog")).reverse();
            const matchedDialog = dialogs.find(dialog => {
                const wrapper = dialog.closest(".omui-dialog-wrapper");
                return isVisibleElement(dialog)
                    && (!wrapper || isVisibleElement(wrapper))
                    && getDialogTitleText(dialog).includes(titleText);
            });
            if (matchedDialog) return matchedDialog;
            await delay(200);
        }
        return null;
    }

    async function confirmAIDeclarationDialog(timeout = 3000) {
        const aiCreateConfirmDialog = await waitForDialogByTitle("AI生成声明", timeout);
        if (!aiCreateConfirmDialog) return false;

        const confirmBtn = Array.from(aiCreateConfirmDialog.querySelectorAll(".omui-button--primary"))
            .find(btn => !btn.disabled && !btn.classList.contains("is--disabled"));
        if (confirmBtn) {
            confirmBtn.click();
            console.log("[腾讯号发布] ✅ 已点击AI生成声明确认");
            await delay(1500);
            return true;
        }

        console.warn("[腾讯号发布] ⚠️ 检测到AI生成声明弹窗，但未找到可点击的确认按钮");
        return false;
    }

//    AI声明弹窗处理（只检测并处理弹窗，不重复点击发布按钮）
    async function AICreatePopup() {
        console.log("[腾讯号发布] 检测AI声明弹窗...");

        // 用短超时检测弹窗（3秒），避免长时间等待
        try {
            return await confirmAIDeclarationDialog(3000);
        } catch (e) {
            console.log("[腾讯号发布] ℹ️ 未检测到AI声明弹窗，继续执行");
        }
        return false; // 没有弹窗或不是AI声明弹窗
    }
})(); // IIFE 结束

/**
 * 选择定时发布的日期和时间
 * @param sendTime 定时发布时间，格式：YYYY-MM-DD HH:mm
 */
async function selectScheduledTime(sendTime) {
    console.log("🚀 ~ selectScheduledTime ~ sendTime: ", sendTime);
    try {
        const modal = document.querySelector(".omui-dialog-wrapper");
        if (!modal) {
            console.error("[腾讯号发布] ❌ 找不到定时发布弹窗");
            return false;
        }

        // 解析目标日期时间
        const [datePart, timePart] = sendTime.split(' ');
        const [year, month, day] = datePart.split('-').map(Number);

        // 1. 点击日期输入框打开日历
        const dateInput = modal.querySelector(".omui-datepicker-inputwrap input");
        if (!dateInput) {
            console.error("[腾讯号发布] ❌ 找不到日期输入框");
            return false;
        }
        dateInput.click();
        await delay(300);
        console.log("[腾讯号发布] 🔧 开始选择定时发布时间...");

        const picker = document.querySelector(".omui-datepicker");
        if (!picker) {
            console.error("[腾讯号发布] ❌ 找不到日期选择器");
            return false;
        }

        // 2. 导航到目标月份（处理跨月情况）
        for (let i = 0; i < 24; i++) { // 最多尝试24个月
            // 注意: curr-date 是独立的 class，不是 omui-calendar-nav 的子元素
            const currDateEl = picker.querySelector(".curr-date");
            if (!currDateEl) {
                console.error("[腾讯号发布] ❌ 找不到当前月份显示元素");
                break;
            }

            const currentText = currDateEl.textContent; // 格式: "2026年1月"
            const match = currentText.match(/(\d+)年(\d+)月/);
            if (!match) {
                console.error("[腾讯号发布] ❌ 无法解析当前月份:", currentText);
                break;
            }

            const currYear = parseInt(match[1], 10);
            const currMonth = parseInt(match[2], 10);
            console.log(`[腾讯号发布] 📅 当前显示: ${currYear}年${currMonth}月, 目标: ${year}年${month}月`);

            if (currYear === year && currMonth === month) {
                console.log("[腾讯号发布] ✅ 已到达目标月份");
                break; // 已到达目标月份
            }

            // 判断需要前进还是后退
            const targetDate = new Date(year, month - 1);
            const currentDate = new Date(currYear, currMonth - 1);

            if (targetDate > currentDate) {
                // 点击下一月 > (omui-calendar-nav 和 next-m 是同一元素的 class)
                const nextBtn = picker.querySelector(".omui-calendar-nav.next-m");
                if (nextBtn) {
                    nextBtn.click();
                    console.log("[腾讯号发布] ➡️ 点击下一月");
                }
            } else {
                // 点击上一月 < (omui-calendar-nav 和 prev-m 是同一元素的 class)
                const prevBtn = picker.querySelector(".omui-calendar-nav.prev-m");
                if (prevBtn) {
                    prevBtn.click();
                    console.log("[腾讯号发布] ⬅️ 点击上一月");
                }
            }
            await delay(200);
        }
        await delay(200);

        // 3. 选择日期 - 找到目标日期的 td 并点击
        let dateSelected = false;
        const allDayCells = picker.querySelectorAll(".omui-calendar-tbody td");
        for (const td of allDayCells) {
            const span = td.querySelector("span");
            if (!span) continue;

            // 跳过不可选的日期（有 no-drop 类，表示过去的日期）
            if (span.classList.contains("no-drop")) continue;

            // 跳过非当前月份的日期（上月/下月的灰色日期）
            if (td.classList.contains("prev-month") || td.classList.contains("next-month")) continue;

            const dayNum = parseInt(span.textContent, 10);
            if (dayNum === day) {
                td.click();
                dateSelected = true;
                console.log(`[腾讯号发布] ✅ 选择日期: ${year}-${month}-${day}`);
                break;
            }
        }

        if (!dateSelected) {
            console.error(`[腾讯号发布] ❌ 未能选择日期 ${day} 号`);
        }
        await delay(300);

        // 4. 设置时间 - 点击时间输入框打开下拉，然后选择小时和分钟
        const [hour, minute] = timePart.split(':');
        console.log(`[腾讯号发布] ⏰ 目标时间: ${hour}:${minute}`);

        // 点击时间输入框打开下拉面板
        const timeInput = picker.querySelector(".omui-timepicker-input");
        if (timeInput) {
            timeInput.click();
            await delay(300);

            // 找到时间选择面板
            const timePanel = document.querySelector(".omui-timepicker-panel");
            if (timePanel) {
                // 获取两个 ul：第一个是小时，第二个是分钟
                const ulList = timePanel.querySelectorAll("ul");
                console.log(`[腾讯号发布] ⏰ 找到 ${ulList.length} 个时间列表`);

                // 选择小时
                if (ulList[0]) {
                    const hourItems = ulList[0].querySelectorAll("li");
                    for (const li of hourItems) {
                        if (li.textContent.trim() === hour) {
                            li.click();
                            console.log(`[腾讯号发布] ✅ 选择小时: ${hour}`);
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
                    console.log(`[腾讯号发布] ⏰ 原始分钟: ${minute}, 取整后: ${targetMinuteStr}`);

                    const minuteItems = ulList[1].querySelectorAll("li");
                    for (const li of minuteItems) {
                        if (li.textContent.trim() === targetMinuteStr) {
                            li.click();
                            console.log(`[腾讯号发布] ✅ 选择分钟: ${targetMinuteStr}`);
                            break;
                        }
                    }
                }
                await delay(200);

                // 点击时间面板的确定按钮
                const timeConfirmBtn = document.querySelector(".omui-timepicker-panel-confirm button");
                if (timeConfirmBtn) {
                    timeConfirmBtn.click();
                    console.log("[腾讯号发布] ✅ 点击时间确定按钮");
                }
            } else {
                console.warn("[腾讯号发布] ⚠️ 未找到时间选择面板");
            }
        } else {
            console.warn("[腾讯号发布] ⚠️ 未找到时间输入框");
        }
        await delay(200);

        // 5. 点击确定按钮
        const confirmBtns = picker.querySelector(".omui-time-confirm");
        if (!confirmBtns) {
            console.error("[腾讯号发布] ❌ 找不到确定按钮");
            return false;
        }
        confirmBtns.click();
        console.log("[腾讯号发布] ✅ 点击确定按钮");

        await delay(300);
        // 6. 等待确定按钮出现
        const confirmDateBtn = modal.querySelector(".omui-button--primary");
        console.log("🚀 ~ selectScheduledTime ~ confirmDateBtn: ", confirmDateBtn);
        if (!confirmDateBtn) {
            console.error("[腾讯号发布] ❌ 找不到确认按钮");
            return false;
        }
        confirmDateBtn.click();
        console.log("[腾讯号发布] ✅ 点击确认按钮");
        return true;
    } catch (error) {
        console.error("[腾讯号发布] ❌ selectScheduledTime 错误:", error);
        return false;
    }
}
