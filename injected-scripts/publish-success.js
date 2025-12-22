/**
 * 发布成功页脚本
 * 用于在发布成功跳转到列表页后：
 * 1. 发送统计接口
 * 2. 通知首页刷新
 * 3. 关闭窗口
 *
 * 适用平台：
 * - 抖音: https://creator.douyin.com/creator-micro/content/manage?enter_from=publish
 * - 小红书: https://creator.xiaohongshu.com/publish/success*
 * - 视频号: https://channels.weixin.qq.com/platform/post/list*
 */

(function() {
  'use strict';

  // 防止脚本重复注入
  if (window.__PUBLISH_SUCCESS_LOADED__) {
    console.log('[发布成功] ⚠️ 脚本已加载，跳过');
    return;
  }
  window.__PUBLISH_SUCCESS_LOADED__ = true;

  console.log('═══════════════════════════════════════');
  console.log('✅ 发布成功页脚本已注入');
  console.log('📍 当前 URL:', window.location.href);
  console.log('🕐 注入时间:', new Date().toLocaleString());
  console.log('═══════════════════════════════════════');

  // 延迟执行，确保页面完全加载
  setTimeout(async () => {
    console.log('[发布成功] 🎉 检测到发布成功页，开始处理...');

    // 读取保存的发布数据
    let publishData = null;
    try {
      const savedData = localStorage.getItem('PUBLISH_SUCCESS_DATA');
      if (savedData) {
        publishData = JSON.parse(savedData);
        console.log('[发布成功] 📦 读取到发布数据:', publishData);
      }
    } catch (e) {
      console.error('[发布成功] ❌ 读取数据失败:', e);
    }

    // 发送统计接口
    if (publishData && publishData.publishId) {
      try {
        console.log('[发布成功] 📤 发送成功统计...');
        const scanData = { data: JSON.stringify({ id: publishData.publishId }) };
        const response = await fetch("https://apidev.china9.cn/api/mediaauth/tjlog", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(scanData),
        });
        console.log('[发布成功] ✅ 统计接口请求成功');
      } catch (e) {
        console.error('[发布成功] ❌ 统计接口请求失败:', e);
      }
    }

    // 通知首页刷新
    if (window.browserAPI && window.browserAPI.sendToHome) {
      console.log('[发布成功] 📤 通知首页刷新...');
      window.browserAPI.sendToHome('发布成功，刷新数据');
      console.log('[发布成功] ✅ 已通知首页');
    } else if (typeof sendMessageToParent === 'function') {
      console.log('[发布成功] 📤 通过 sendMessageToParent 通知首页...');
      sendMessageToParent('发布成功，刷新数据');
    }

    // 清除临时数据
    try {
      localStorage.removeItem('PUBLISH_SUCCESS_DATA');
      localStorage.removeItem('DOUYIN_PUBLISH_DATA');
      localStorage.removeItem('XHS_PUBLISH_DATA');
      localStorage.removeItem('SHIPINHAO_PUBLISH_DATA');
      console.log('[发布成功] 🗑️ 已清除临时数据');
    } catch (e) {
      // 忽略清除失败
    }

    // 延迟关闭窗口
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 关闭窗口
    if (window.browserAPI && window.browserAPI.closeCurrentWindow) {
      try {
        console.log('[发布成功] 🚪 正在关闭窗口...');
        await window.browserAPI.closeCurrentWindow();
      } catch (e) {
        console.error('[发布成功] ❌ 关闭窗口失败:', e);
      }
    } else {
      console.log('[发布成功] ⚠️ browserAPI 不可用，尝试 window.close()');
      window.close();
    }
  }, 2000); // 延迟 2 秒执行

})();
