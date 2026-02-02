// 🔑 这是要添加到 main.js 第 3213 行之后的代码（修正版）
// 在 newWindow.loadURL(url); 之前插入

    // 🔑 搜狐号特殊处理：在加载 URL 之前先清除 toPath
    if (url.includes('mp.sohu.com')) {
      console.log('[Window Manager] 🛡️ 检测到搜狐号 URL，在加载前清除 toPath');

      // 🔑 关键修改：先加载搜狐号的首页，在首页域名下清除 toPath，然后再跳转到发布页
      const sohuHomePage = 'https://mp.sohu.com/mpfe/v4/contentManagement/first/page';

      // 加载首页
      await newWindow.loadURL(sohuHomePage);

      // 等待页面加载完成
      await new Promise(resolve => {
        newWindow.webContents.once('did-finish-load', resolve);
      });

      try {
        // 在搜狐号域名下执行清除脚本
        await newWindow.webContents.executeJavaScript(`
          (function() {
            console.log('[搜狐号-主进程] 🧹 在搜狐号域名下清除 toPath');
            try {
              const currentToPath = localStorage.getItem('toPath');
              console.log('[搜狐号-主进程] 当前 toPath:', currentToPath);

              const PUBLISH_PAGE_PATH = '/contentManagement/news/addarticle';

              // 清除旧值
              localStorage.removeItem('toPath');
              // 设置为发布页路径
              localStorage.setItem('toPath', PUBLISH_PAGE_PATH);

              console.log('[搜狐号-主进程] ✅ 已设置 toPath =', PUBLISH_PAGE_PATH);

              // 验证设置是否成功
              const verifyToPath = localStorage.getItem('toPath');
              console.log('[搜狐号-主进程] 验证 toPath:', verifyToPath);
            } catch (e) {
              console.error('[搜狐号-主进程] ❌ 清除 toPath 失败:', e);
            }
          })();
        `);
        console.log('[Window Manager] ✅ toPath 清除脚本执行完成');

        // 等待一下确保 localStorage 写入完成
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        console.error('[Window Manager] ❌ toPath 清除脚本执行失败:', err);
      }
    }
