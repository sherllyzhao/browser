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
 * - 网易号: https://mp.163.com/subscribe_v4/index.html#/content-manage*
 * - 企鹅号: https://om.qq.com/main/management/articleManage
 * - 百家号: https://baijiahao.baidu.com/builder/rc/clue*
 * - 新浪: https://card.weibo.com/article/v5/editor#/draft/*
 */

(async function() {
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

  // 获取当前窗口 ID（提前获取，用于后续检测）
  let windowId = null;
  try {
    windowId = await window.browserAPI.getWindowId();
    console.log('[发布成功] 当前窗口 ID:', windowId);
  } catch (e) {
    console.error('[发布成功] ❌ 获取窗口 ID 失败:', e);
  }

  // 🔴 先检查是否有发布成功标记，没有就不执行后续逻辑
  // 这样可以避免干扰正常的页面浏览
  // 🔑 检查多种可能的标记来源（localStorage + globalData）
  const allLocalStorageKeys = Object.keys(localStorage);
  const hasPublishSuccessKey = allLocalStorageKeys.some(k => k.startsWith('PUBLISH_SUCCESS_DATA_'));

  // 🔑 同时检查 globalData（更可靠，不受域名隔离限制）
  let hasGlobalDataFlag = false;
  let globalPublishData = null;
  if (windowId && window.browserAPI && window.browserAPI.getGlobalData) {
    try {
      globalPublishData = await window.browserAPI.getGlobalData(`PUBLISH_SUCCESS_DATA_${windowId}`);
      hasGlobalDataFlag = !!globalPublishData;
      console.log('[发布成功] 🔍 globalData 检测:', hasGlobalDataFlag ? '有数据' : '无数据');
    } catch (e) {
      console.log('[发布成功] ⚠️ globalData 检测失败:', e.message);
    }
  }

  console.log('[发布成功] 🔍 检测发布标记...');
  console.log('[发布成功] - sohuPublishSuccessFlag:', !!window.__sohuPublishSuccessFlag);
  console.log('[发布成功] - PUBLISH_SUCCESS_DATA:', !!localStorage.getItem('PUBLISH_SUCCESS_DATA'));
  console.log('[发布成功] - PUBLISH_SUCCESS_DATA_* keys:', hasPublishSuccessKey);
  console.log('[发布成功] - globalData flag:', hasGlobalDataFlag);
  if (hasPublishSuccessKey) {
    const matchedKeys = allLocalStorageKeys.filter(k => k.startsWith('PUBLISH_SUCCESS_DATA_'));
    console.log('[发布成功] - 匹配的 localStorage keys:', matchedKeys);
  }

  const hasPublishFlag = window.__sohuPublishSuccessFlag ||
                         localStorage.getItem('PUBLISH_SUCCESS_DATA') ||
                         hasPublishSuccessKey ||
                         hasGlobalDataFlag;

  if (!hasPublishFlag) {
    console.log('[发布成功] ℹ️ 未检测到发布成功标记，可能是正常浏览，跳过处理');
    return;
  }

  // 延迟执行，确保页面完全加载
  setTimeout(async () => {
    console.log('[发布成功] 🎉 检测到发布成功页，开始处理...');

    // 读取保存的发布数据
    // 优先级：globalData > 窗口专属 localStorage > 通用 localStorage
    let publishData = null;
    let usedSource = null;
    try {
      // 1. 优先使用 globalData（最可靠）
      if (globalPublishData) {
        publishData = globalPublishData;
        usedSource = 'globalData';
        console.log('[发布成功] 📦 从 globalData 读取到数据:', publishData);
      }

      // 2. 尝试窗口专属 localStorage key
      if (!publishData && windowId) {
        const windowSpecificKey = `PUBLISH_SUCCESS_DATA_${windowId}`;
        console.log('[发布成功] 🔍 尝试读取窗口专属 key:', windowSpecificKey);
        const savedData = localStorage.getItem(windowSpecificKey);
        if (savedData) {
          publishData = JSON.parse(savedData);
          usedSource = `localStorage:${windowSpecificKey}`;
          console.log('[发布成功] 📦 读取到窗口专属数据:', publishData);
        }
      }

      // 3. 尝试通用 localStorage key（兼容旧版本）
      if (!publishData) {
        console.log('[发布成功] 🔍 尝试读取通用 key: PUBLISH_SUCCESS_DATA');
        const savedData = localStorage.getItem('PUBLISH_SUCCESS_DATA');
        if (savedData) {
          publishData = JSON.parse(savedData);
          usedSource = 'localStorage:PUBLISH_SUCCESS_DATA';
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

    console.log('[发布成功] 📋 数据来源:', usedSource);
    console.log('[发布成功] 📋 最终 publishId:', publishData?.publishId);

    // 发送统计接口
    if (publishData && publishData.publishId) {
      try {
        const mainInfo = await window.browserAPI.getMainUrl();

        // 开发环境（localhost）跳过接口调用
        console.log('[发布成功] 📤 发送成功统计...');
        const scanData = { data: JSON.stringify({ id: publishData.publishId }) };
        let url = await getStatisticsUrl();
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
    console.log('[发布成功] 📤 准备通知首页刷新...');
    console.log('[发布成功] browserAPI 存在:', !!window.browserAPI);
    console.log('[发布成功] browserAPI.sendToHome 存在:', !!(window.browserAPI && window.browserAPI.sendToHome));

    if (window.browserAPI && window.browserAPI.sendToHome) {
      try {
        console.log('[发布成功] 📤 调用 browserAPI.sendToHome...');
        window.browserAPI.sendToHome('发布成功，刷新数据');
        console.log('[发布成功] ✅ browserAPI.sendToHome 调用完成');
      } catch (e) {
        console.error('[发布成功] ❌ browserAPI.sendToHome 调用出错:', e);
      }
    } else if (typeof sendMessageToParent === 'function') {
      console.log('[发布成功] 📤 通过 sendMessageToParent 通知首页...');
      sendMessageToParent('发布成功，刷新数据');
    } else {
      console.error('[发布成功] ❌ 没有可用的消息发送方式！');
    }

    // 清除临时数据
    try {
      // 🔑 清除 globalData（发布成功标记和发布数据）
      if (windowId && window.browserAPI && window.browserAPI.removeGlobalData) {
        try {
          // 清除发布成功标记
          await window.browserAPI.removeGlobalData(`PUBLISH_SUCCESS_DATA_${windowId}`);
          console.log('[发布成功] 🗑️ 已清除 globalData: PUBLISH_SUCCESS_DATA_' + windowId);

          // 🔑 清除发布页数据（登录跳转场景下保留的数据）
          await window.browserAPI.removeGlobalData(`publish_data_window_${windowId}`);
          console.log('[发布成功] 🗑️ 已清除 globalData: publish_data_window_' + windowId);
        } catch (e) {
          console.log('[发布成功] ⚠️ 清除 globalData 失败:', e.message);
        }
      }

      // 清除 localStorage 数据
      if (windowId) {
        localStorage.removeItem(`PUBLISH_SUCCESS_DATA_${windowId}`);
        // 清除窗口专属的平台数据
        localStorage.removeItem(`SHIPINHAO_PUBLISH_DATA_${windowId}`);
        localStorage.removeItem(`SHIPINHAO_PUBLISH_URL_${windowId}`);
      }
      // 清除其他平台数据（兼容旧版本）
      localStorage.removeItem('PUBLISH_SUCCESS_DATA');
      localStorage.removeItem('DOUYIN_PUBLISH_DATA');
      localStorage.removeItem('XHS_PUBLISH_DATA');
      localStorage.removeItem('SHIPINHAO_PUBLISH_DATA');
      localStorage.removeItem('BJH_PUBLISH_DATA');

      // 🔑 不要清除 toPath，保持它为发布页路径
      // 这样下次打开发布页时，搜狐号会根据 toPath 跳转到发布页，而不是首页
      console.log('[发布成功] 💡 保留 toPath，防止下次打开发布页时跳转到首页');

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
