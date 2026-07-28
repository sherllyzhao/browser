/**
 * 知乎安全验证提示脚本
 *
 * 背景：多账号托管发布时，知乎可能弹出「你的网络环境或行为异常，请进行安全验证」。
 * 本脚本只做「发现并提示」——检测到验证提示时在页面顶部显示横幅，引导客服手动完成验证，
 * 不对验证本身做任何绕过或自动应答。
 *
 * 与新浪 xinlang-captcha.js 的差异：
 * 新浪验证是独立 URL 页面（security.weibo.com/captcha/geetest），可按 URL 注入；
 * 知乎验证多为当前页弹出的验证层/内联提示，因此这里改为「文案+节点」检测 + MutationObserver 持续监听。
 */
(function () {
    "use strict";

    // 防止重复注入
    if (window.__ZH_CAPTCHA_BANNER__) return;
    window.__ZH_CAPTCHA_BANNER__ = true;

    const BANNER_ID = "zh-captcha-banner";

    // 知乎安全验证的典型文案（命中任一即认为出现验证）
    const CAPTCHA_TEXTS = [
        "网络环境或行为异常",
        "请进行安全验证",
        "安全验证",
        "系统监测到您的网络环境存在异常",
        "请完成验证后继续"
    ];

    // 知乎验证组件的典型选择器
    const CAPTCHA_SELECTORS = [
        ".Captcha",
        ".Captcha-chineseContainer",
        ".Captcha-englishContainer",
        "[class*='Captcha']",
        "[class*='captcha']",
        ".Modal-content [class*='verify']",
        "#captcha",
        "iframe[src*='captcha']",
        "iframe[src*='unhuman']"
    ];

    function getDelay(ms) {
        return typeof window.getRandomDelayMs === "function"
            ? window.getRandomDelayMs(ms)
            : ms + Math.floor(Math.random() * Math.max(80, Math.round(ms * 0.35)));
    }

    // 检测页面上是否存在安全验证
    function detectCaptcha() {
        // 1. 节点检测：验证组件是否存在且可见
        for (const selector of CAPTCHA_SELECTORS) {
            try {
                const nodes = document.querySelectorAll(selector);
                for (const node of nodes) {
                    if (node && node.offsetParent !== null) {
                        return { hit: true, reason: `节点命中: ${selector}` };
                    }
                }
            } catch (_) {
                // 选择器不合法时跳过
            }
        }

        // 2. 文案检测：只扫描可见文本，避免误伤脚本/隐藏节点里的同名字符串
        try {
            const bodyText = document.body ? (document.body.innerText || "") : "";
            for (const text of CAPTCHA_TEXTS) {
                if (bodyText.includes(text)) {
                    return { hit: true, reason: `文案命中: ${text}` };
                }
            }
        } catch (_) {
            // 读取文本失败时忽略
        }

        return { hit: false, reason: "" };
    }

    function removeBanner() {
        const existing = document.getElementById(BANNER_ID);
        if (existing && existing.parentNode) {
            existing.parentNode.removeChild(existing);
            console.log("[知乎验证] 验证已消失，移除提示横幅");
        }
    }

    function showBanner(reason) {
        if (!document.body) {
            setTimeout(() => showBanner(reason), getDelay(100));
            return;
        }

        // 已经显示过就不重复插入
        if (document.getElementById(BANNER_ID)) return;

        const banner = document.createElement("div");
        banner.id = BANNER_ID;
        banner.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 2147483647;
            background: linear-gradient(135deg, #0084ff 0%, #0f5cd6 100%);
            color: #fff;
            text-align: center;
            padding: 16px 24px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
            box-shadow: 0 4px 15px rgba(15, 92, 214, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
        `;

        const icon = document.createElement("div");
        icon.style.cssText = `
            width: 36px;
            height: 36px;
            background: rgba(255,255,255,0.2);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            flex-shrink: 0;
        `;
        icon.innerHTML = "🔐";

        const textBox = document.createElement("div");
        textBox.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 2px;
        `;

        const title = document.createElement("div");
        title.style.cssText = `
            font-size: 15px;
            font-weight: 600;
            letter-spacing: 0.5px;
        `;
        title.textContent = "知乎需要人工安全验证";

        const subtitle = document.createElement("div");
        subtitle.style.cssText = `
            font-size: 13px;
            opacity: 0.9;
            font-weight: 400;
        `;
        subtitle.textContent = "请手动完成页面上的验证，完成后可继续发布；频繁切换账号会更容易触发验证";

        textBox.appendChild(title);
        textBox.appendChild(subtitle);
        banner.appendChild(icon);
        banner.appendChild(textBox);
        document.body.appendChild(banner);

        console.log("[知乎验证] 已显示人工验证提示横幅，原因:", reason);

        // 通知首页：该账号触发了安全验证，便于运营侧感知与排班
        try {
            if (window.browserAPI && typeof window.browserAPI.sendToHome === "function") {
                window.browserAPI.sendToHome({
                    type: "zhihu-captcha-detected",
                    reason: reason,
                    url: location.href,
                    timestamp: Date.now()
                });
            }
        } catch (e) {
            console.warn("[知乎验证] 通知首页失败:", e && e.message);
        }
    }

    // 统一的检查入口：命中则显示，消失则移除
    function checkAndToggle() {
        const result = detectCaptcha();
        if (result.hit) {
            showBanner(result.reason);
        } else {
            removeBanner();
        }
    }

    function start() {
        checkAndToggle();

        // 验证层通常是异步弹出的，用 MutationObserver 持续监听
        try {
            const observer = new MutationObserver(() => {
                if (window.__ZH_CAPTCHA_CHECK_TIMER__) return;
                // 合并高频变更，避免每次 DOM 改动都全量扫描
                window.__ZH_CAPTCHA_CHECK_TIMER__ = setTimeout(() => {
                    window.__ZH_CAPTCHA_CHECK_TIMER__ = null;
                    checkAndToggle();
                }, 300);
            });
            observer.observe(document.documentElement || document.body, {
                childList: true,
                subtree: true
            });
            console.log("[知乎验证] 已启动安全验证监听");
        } catch (e) {
            console.warn("[知乎验证] MutationObserver 启动失败，降级为轮询:", e && e.message);
            setInterval(checkAndToggle, 3000);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();
