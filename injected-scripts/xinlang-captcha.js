/**
 * 新浪拼图验证页提示脚本
 * 在验证页面顶部显示横幅，提示用户需要手动完成验证
 */
(function () {
    "use strict";

    // 防止重复注入
    if (window.__XL_CAPTCHA_BANNER__) return;
    window.__XL_CAPTCHA_BANNER__ = true;

    function showBanner() {
        // 确保 body 存在
        if (!document.body) {
            setTimeout(showBanner, 100);
            return;
        }

        // 创建横幅容器
        const banner = document.createElement("div");
        banner.id = "xl-captcha-banner";
        banner.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 999999;
            background: linear-gradient(135deg, #ff8c42 0%, #ff5e62 100%);
            color: #fff;
            text-align: center;
            padding: 16px 24px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
            box-shadow: 0 4px 15px rgba(255, 94, 98, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
        `;

        // 图标
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

        // 文字容器
        const textBox = document.createElement("div");
        textBox.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 2px;
        `;

        // 标题
        const title = document.createElement("div");
        title.style.cssText = `
            font-size: 15px;
            font-weight: 600;
            letter-spacing: 0.5px;
        `;
        title.textContent = "需要人工验证";

        // 副标题
        const subtitle = document.createElement("div");
        subtitle.style.cssText = `
            font-size: 13px;
            opacity: 0.9;
            font-weight: 400;
        `;
        subtitle.textContent = "请完成下方拼图验证，通过后将自动继续发布";

        textBox.appendChild(title);
        textBox.appendChild(subtitle);

        banner.appendChild(icon);
        banner.appendChild(textBox);

        document.body.appendChild(banner);

        console.log("[新浪验证] 已显示人工验证提示横幅");
    }

    // 等待 DOM 准备好
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", showBanner);
    } else {
        showBanner();
    }
})();
