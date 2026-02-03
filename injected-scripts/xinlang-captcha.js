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

        // 创建横幅
        const banner = document.createElement("div");
        banner.id = "xl-captcha-banner";
        banner.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 999999;
            background: linear-gradient(135deg, #ff6b35, #f7c948);
            color: #fff;
            text-align: center;
            padding: 14px 20px;
            font-size: 16px;
            font-weight: bold;
            font-family: "Microsoft YaHei", sans-serif;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            letter-spacing: 1px;
            animation: bannerPulse 2s ease-in-out infinite;
        `;
        banner.innerHTML = `
            <span style="margin-right: 8px; font-size: 20px;">⚠</span>
            需要人工操作：请完成下方拼图验证，验证通过后将自动继续发布
            <span style="margin-left: 8px; font-size: 20px;">⚠</span>
        `;

        // 添加脉冲动画
        const style = document.createElement("style");
        style.textContent = `
            @keyframes bannerPulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.85; }
            }
        `;

        if (document.head) {
            document.head.appendChild(style);
        }
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
