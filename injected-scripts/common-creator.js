console.log('[快手授权] 正在关闭当前窗口...')
sendMessageToParent('授权成功，刷新数据');
setTimeout(() => {
    window.browserAPI.closeCurrentWindow();
}, 10000);
