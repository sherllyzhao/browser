// ===========================
// 🔑 检查 common.js 依赖并提供降级实现
// ===========================
if (typeof window.getRandomDelayMs !== "function") {
    console.warn("[快手授权] ⚠️ common.js 未正确加载，使用降级实现");
    window.getRandomDelayMs = function (ms, jitterMs) {
        const baseMs = Number.isFinite(Number(ms)) ? Math.max(0, Math.floor(Number(ms))) : 0;
        const hasCustomJitter = jitterMs !== null && typeof jitterMs !== "undefined" && Number.isFinite(Number(jitterMs));
        const resolvedJitterMs = hasCustomJitter
            ? Math.max(0, Math.floor(Number(jitterMs)))
            : Math.max(80, Math.round(baseMs * 0.35));
        return baseMs + Math.floor(Math.random() * (resolvedJitterMs + 1));
    };
}

console.log('[快手授权] 正在关闭当前窗口...')
sendMessageToParent('授权成功，刷新数据');
setTimeout(() => {
    window.browserAPI.closeCurrentWindow();
}, window.getRandomDelayMs(10000));
