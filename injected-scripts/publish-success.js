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

    // 获取当前窗口 ID（用于读取窗口专属数据，避免多窗口冲突）
    let windowId = null;
    try {
      windowId = await window.browserAPI.getWindowId();
      console.log('[发布成功] 当前窗口 ID:', windowId);
    } catch (e) {
      console.error('[发布成功] ❌ 获取窗口 ID 失败:', e);
    }

    // 读取保存的发布数据（优先使用窗口专属 key，兼容旧的通用 key）
    let publishData = null;
    let usedKey = null;
    try {
      // 优先尝试窗口专属 key
      if (windowId) {
        const windowSpecificKey = `PUBLISH_SUCCESS_DATA_${windowId}`;
        console.log('[发布成功] 🔍 尝试读取窗口专属 key:', windowSpecificKey);
        const savedData = localStorage.getItem(windowSpecificKey);
        console.log('[发布成功] 🔍 窗口专属数据:', savedData);
        if (savedData) {
          publishData = JSON.parse(savedData);
          usedKey = windowSpecificKey;
          console.log('[发布成功] 📦 读取到窗口专属数据:', publishData);
        }
      }

      // 如果没有窗口专属数据，尝试通用 key（兼容旧版本）
      if (!publishData) {
        console.log('[发布成功] 🔍 尝试读取通用 key: PUBLISH_SUCCESS_DATA');
        const savedData = localStorage.getItem('PUBLISH_SUCCESS_DATA');
        console.log('[发布成功] 🔍 通用数据:', savedData);
        if (savedData) {
          publishData = JSON.parse(savedData);
          usedKey = 'PUBLISH_SUCCESS_DATA';
          console.log('[发布成功] 📦 读取到通用数据:', publishData);
        }
      }

      // 打印所有 PUBLISH_SUCCESS_DATA 相关的 key（调试用）
      console.log('[发布成功] 🔍 localStorage 中所有 PUBLISH_SUCCESS_DATA 相关的 key:');
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes('PUBLISH_SUCCESS_DATA')) {
          console.log(`  - ${key}: ${localStorage.getItem(key)}`);
        }
      }
    } catch (e) {
      console.error('[发布成功] ❌ 读取数据失败:', e);
    }

    console.log('[发布成功] 📋 最终使用的 key:', usedKey);
    console.log('[发布成功] 📋 最终 publishId:', publishData?.publishId);

    // 发送统计接口
    if (publishData && publishData.publishId) {
      try {
        const mainInfo = await window.browserAPI.getMainUrl();

        // 开发环境（localhost）跳过接口调用
        console.log('[发布成功] 📤 发送成功统计...');
        const scanData = { data: JSON.stringify({ id: publishData.publishId }) };
        const urlMap = {
          'localhost': 'https://apidev.china9.cn/api/mediaauth/tjlog',
          'china9.cn': 'https://apidev.china9.cn/api/mediaauth/tjlog',
          'www.china9.cn': 'https://apidev.china9.cn/api/mediaauth/tjlog',
          'dev.china9.cn': 'https://apidev.china9.cn/api/mediaauth/tjlog',
          'www.dev.china9.cn': 'https://apidev.china9.cn/api/mediaauth/tjlog',
          'jzt_dev_1.china9.cn': 'https://jzt_dev_1.china9.cn/api/geo/tjlog',
          'zhjzt.china9.cn': 'https://zhjzt.china9.cn/api/geo/tjlog',
          '172.16.6.17:8080': 'https://jzt_dev_1.china9.cn/api/geo/tjlog',
        }
        let url = 'https://apidev.china9.cn/api/mediaauth/tjlog';
        if (mainInfo.success && urlMap[mainInfo.host]) {
          url = urlMap[mainInfo.host];
        }
        const response = await fetch(url, {
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
      // 清除使用过的 key
      if (usedKey) {
        localStorage.removeItem(usedKey);
        console.log('[发布成功] 🗑️ 已清除:', usedKey);
      }
      // 也清除窗口专属 key（如果有 windowId）
      if (windowId) {
        localStorage.removeItem(`PUBLISH_SUCCESS_DATA_${windowId}`);
      }
      // 清除其他平台数据
      localStorage.removeItem('DOUYIN_PUBLISH_DATA');
      localStorage.removeItem('XHS_PUBLISH_DATA');
      localStorage.removeItem('SHIPINHAO_PUBLISH_DATA');
      localStorage.removeItem('BJH_PUBLISH_DATA');
      console.log('[发布成功] 🗑️ 已清除临时数据');
    } catch (e) {
      // 忽略清除失败
    }

    // 延迟关闭窗口
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 开发模式下不关闭窗口（browserAPI.isProduction 为 false 时是开发环境）
    const isDev = window.browserAPI && window.browserAPI.isProduction === false;
    if (isDev) {
      console.log('[发布成功] 🔧 开发模式：跳过关闭窗口，可查看控制台');
      console.log('[发布成功] ✅ 处理完成！');
      return;
    }

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
