console.log('[快手授权] 正在关闭当前窗口...')
function sendMessageToParent(message) {
    console.log('[快手授权] 发送消息到父窗口:', message);

    // 方式 2: 使用 browserAPI (运营助手浏览器)
    if (window.browserAPI?.sendToHome) {
        try {
            window.browserAPI.sendToHome(message);
            console.log('[快手授权] ✅ 已通过 browserAPI.sendToHome 发送');
            return true;
        } catch (e) {
            console.error('[快手授权] ❌ browserAPI.sendToHome 失败:', e);
        }
    } else {
        console.warn('[快手授权] ⚠️ browserAPI 不可用');
    }

    return false;
}

sendMessageToParent('授权成功，刷新数据');
setTimeout(() => {
    window.browserAPI.closeCurrentWindow();
}, 1000);
