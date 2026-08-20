// 临时修复脚本：清理搜狐号刷新计数器
// 使用方法：在浏览器 DevTools Console 中运行此代码

(function clearSouhuhaoReloadCounters() {
    console.log('[修复工具] 开始清理搜狐号刷新计数器...');

    const keysToRemove = [
        // localStorage 键
        '搜狐号发布_RELOAD_RETRY_COUNT',
        '搜狐号_RELOAD_RETRY_COUNT',
        'SOUHUHAO_RELOAD_RETRY_COUNT',

        // sessionStorage 键
        '__sohu_publish_render_unhealthy_reload_count__',
        '__sohuhao_required_element_miss_count__',
        '__sohuhao_publish_data_recover_count__',
    ];

    let removed = 0;

    // 清理 localStorage
    keysToRemove.forEach(key => {
        try {
            if (localStorage.getItem(key)) {
                localStorage.removeItem(key);
                console.log(`[修复工具] ✅ 已清理 localStorage.${key}`);
                removed++;
            }
        } catch (e) {
            console.warn(`[修复工具] ⚠️ 清理 localStorage.${key} 失败:`, e.message);
        }
    });

    // 清理 sessionStorage
    keysToRemove.forEach(key => {
        try {
            if (sessionStorage.getItem(key)) {
                sessionStorage.removeItem(key);
                console.log(`[修复工具] ✅ 已清理 sessionStorage.${key}`);
                removed++;
            }
        } catch (e) {
            console.warn(`[修复工具] ⚠️ 清理 sessionStorage.${key} 失败:`, e.message);
        }
    });

    console.log(`[修复工具] 🎉 清理完成，共清理 ${removed} 个计数器`);
    console.log('[修复工具] 请手动刷新页面，或等待页面自动跳转');
})();
