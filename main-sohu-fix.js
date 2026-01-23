// 🔑 这是要添加到 main.js 第 3213 行之后的代码
// 在 newWindow.loadURL(url); 之前插入

    // 🔑 搜狐号特殊处理：在加载 URL 之前先清除 toPath
    if (url.includes('mp.sohu.com')) {
      console.log('[Window Manager] 🛡️ 检测到搜狐号 URL，在加载前清除 toPath');

      // 先加载一个空白页，然后执行清除脚本，最后再跳转到目标 URL
      await newWindow.loadURL('about:blank');

      try {
        // 在空白页执行清除脚本
        await newWindow.webContents.executeJavaScript(`
          (function() {
            console.log('[搜狐号-主进程] 🧹 在加载页面前清除 toPath');
            try {
              const currentToPath = localStorage.getItem('toPath');
              console.log('[搜狐号-主进程] 当前 toPath:', currentToPath);

              const PUBLISH_PAGE_PATH = '/contentManagement/news/addarticle';

              // 清除旧值
              localStorage.removeItem('toPath');
              // 设置为发布页路径
              localStorage.setItem('toPath', PUBLISH_PAGE_PATH);

              console.log('[搜狐号-主进程] ✅ 已设置 toPath =', PUBLISH_PAGE_PATH);
            } catch (e) {
              console.error('[搜狐号-主进程] ❌ 清除 toPath 失败:', e);
            }
          })();
        `);
        console.log('[Window Manager] ✅ toPath 清除脚本执行完成');
      } catch (err) {
        console.error('[Window Manager] ❌ toPath 清除脚本执行失败:', err);
      }
    }
