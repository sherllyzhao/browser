/**
 * 内容管理页验证脚本（接替 publish-success.js）
 *
 * 双模式：
 * 1. 导航模式：页面带发布成功标记（PUBLISH_SUCCESS_DATA_*）但当前不在本平台内容管理页
 *    → 补发成功统计（带去重锁，已报过会自动跳过）→ 通知首页 → 写 CONTENT_VERIFY_DATA → 跳转管理页
 * 2. 验证模式：当前在内容管理页且有 CONTENT_VERIFY_DATA_${windowId}
 *    → 轮询页面文本（含 open Shadow DOM，视频号 wujie 需要）最多 30 秒
 *    → 命中标题（前 12 字包含匹配）→ 完整再走一次成功（sendStatistics skipDedup + 通知首页 + 关窗）
 *    → 未命中 → 只清标记静默关窗，不上报任何统计（"没有就别动"）
 *
 * 无任何标记时直接退出，不干扰正常浏览。
 */

(async function () {
  'use strict';

  const LOG = '[内容验证]';

  // 防止脚本重复注入（SPA 内路由变化会重复注入）
  if (window.__CONTENT_VERIFY_LOADED__) {
    console.log(`${LOG} ⚠️ 脚本已加载，跳过`);
    return;
  }
  window.__CONTENT_VERIFY_LOADED__ = true;

  const currentUrl = String(window.location.href || '');
  const currentPath = String(window.location.pathname || '');
  const currentSearch = String(window.location.search || '');

  console.log(`${LOG} ✅ 脚本已注入 | URL:`, currentUrl);

  // ===========================
  // 平台管理页匹配（与 common.js 的 CONTENT_MANAGE_URLS 对应）
  // ===========================
  const MANAGE_PAGE_MATCHERS = {
    xinlang: (url) => url.includes('me.weibo.com/content/article'),
    sohuhao: (url) => url.includes('mp.sohu.com/mpfe/v4/contentManagement/first/page'),
    tengxunhao: (url) => (url.includes('om.qq.com/main/management/articleManage')
      || (url.includes('om.qq.com/main') && !url.includes('/creation/'))),
    baijiahao: (url) => url.includes('baijiahao.baidu.com/builder/rc/content'),
    zhihu: (url) => url.includes('zhihu.com/creator/manage/creation'),
    wangyihao: (url) => url.includes('mp.163.com') && url.includes('content-manage'),
    douyin: (url) => url.includes('creator.douyin.com/creator-micro/content/manage'),
    xiaohongshu: (url) => url.includes('creator.xiaohongshu.com/new/note-manager'),
    shipinhao: (url) => url.includes('channels.weixin.qq.com/platform/post/list'),
    toutiao: (url) => (url.includes('mp.toutiao.com/profile_v4/manage/content')
      || url.includes('mp.toutiao.com/profile_v4/graphic/manage')),
  };

  // URL → 平台 key（导航模式下用于识别当前是哪个平台的成功落地页）
  function detectPlatformByUrl(url) {
    if (url.includes('me.weibo.com') || url.includes('card.weibo.com') || url.includes('mp.sina.com.cn')) return 'xinlang';
    if (url.includes('mp.sohu.com')) return 'sohuhao';
    if (url.includes('om.qq.com')) return 'tengxunhao';
    if (url.includes('baijiahao.baidu.com')) return 'baijiahao';
    if (url.includes('zhihu.com')) return 'zhihu';
    if (url.includes('mp.163.com')) return 'wangyihao';
    if (url.includes('creator.douyin.com')) return 'douyin';
    if (url.includes('xiaohongshu.com')) return 'xiaohongshu';
    if (url.includes('channels.weixin.qq.com')) return 'shipinhao';
    if (url.includes('mp.toutiao.com')) return 'toutiao';
    return null;
  }

  function getPlatformDisplayName(platformKey) {
    const names = {
      xinlang: '新浪发布', sohuhao: '搜狐号发布', tengxunhao: '腾讯号发布',
      baijiahao: '百家号发布', zhihu: '知乎发布', wangyihao: '网易号发布',
      douyin: '抖音发布', xiaohongshu: '小红书发布', shipinhao: '视频号发布', toutiao: '头条发布',
    };
    return names[platformKey] || platformKey || '发布';
  }

  function findMatchedManagePlatform(url) {
    for (const [key, matcher] of Object.entries(MANAGE_PAGE_MATCHERS)) {
      try {
        if (matcher(url)) return key;
      } catch (_) {}
    }
    return null;
  }

  // ===========================
  // 编辑页排除（仅导航模式生效；验证模式在管理页上不受影响）
  // 保留 publish-success.js 的排除逻辑，但放行小红书发布成功页 /publish/success 与 published=true
  // ===========================
  function isEditPage() {
    const hardPatterns = ['/write', '/edit', '/draft', '/upload', '/addarticle'];
    if (hardPatterns.some((p) => currentPath.includes(p))) return true;
    if (currentPath.includes('/publish')) {
      const isXhsSuccess = currentPath.includes('/publish/success') || currentSearch.includes('published=true');
      if (!isXhsSuccess) return true;
    }
    return false;
  }

  // ===========================
  // 工具
  // ===========================
  const delayFn = typeof window.delay === 'function'
    ? window.delay
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normalizeText(text) {
    return String(text || '').replace(/\s+/g, '');
  }

  // 标题匹配片段：空白归一化后取前 12 字（不足 12 字用全文）
  function buildTitleFragment(title) {
    const normalized = normalizeText(title);
    return normalized.length > 12 ? normalized.slice(0, 12) : normalized;
  }

  // 收集页面全部可见文本（含 open Shadow DOM，视频号 post/list 的列表在 wujie-app.shadowRoot 内）
  function collectPageText(root, depth = 0, maxDepth = 4) {
    if (!root || depth > maxDepth) return '';
    let text = '';
    try {
      if (root.body) {
        text += root.body.innerText || '';
      } else if (typeof root.innerText === 'string') {
        text += root.innerText;
      } else if (root.textContent) {
        text += root.textContent;
      }
    } catch (_) {}
    try {
      const all = (root.querySelectorAll ? root.querySelectorAll('*') : []);
      for (const el of all) {
        if (el.shadowRoot) {
          text += '\n' + collectPageText(el.shadowRoot, depth + 1, maxDepth);
        }
      }
    } catch (_) {}
    return text;
  }

  async function closeWindowSafely() {
    // 开发模式下不关闭窗口，方便看控制台
    const isDev = window.browserAPI && window.browserAPI.isProduction === false;
    if (isDev) {
      console.log(`${LOG} 🔧 开发模式：跳过关闭窗口`);
      return;
    }
    if (window.browserAPI && window.browserAPI.closeCurrentWindow) {
      try {
        console.log(`${LOG} 🚪 正在关闭窗口...`);
        await window.browserAPI.closeCurrentWindow();
        return;
      } catch (e) {
        console.error(`${LOG} ❌ 关闭窗口失败:`, e);
      }
    }
    try { window.close(); } catch (_) {}
  }

  async function cleanupFlags(windowId) {
    try {
      if (windowId && window.browserAPI && window.browserAPI.removeGlobalData) {
        await window.browserAPI.removeGlobalData(`CONTENT_VERIFY_DATA_${windowId}`);
        await window.browserAPI.removeGlobalData(`PUBLISH_SUCCESS_DATA_${windowId}`);
        // publish_data_window 保留到窗口真正关闭，供主进程 close handler 保存最新登录态
      }
    } catch (e) {
      console.warn(`${LOG} ⚠️ 清除 globalData 标记失败:`, e && e.message);
    }
    try {
      if (windowId) {
        localStorage.removeItem(`PUBLISH_SUCCESS_DATA_${windowId}`);
      }
      localStorage.removeItem('PUBLISH_SUCCESS_DATA');
    } catch (_) {}
  }

  function notifyHome(message) {
    try {
      if (window.browserAPI && window.browserAPI.sendToHome) {
        window.browserAPI.sendToHome(message);
        return true;
      }
      if (typeof window.sendMessageToParent === 'function') {
        return window.sendMessageToParent(message);
      }
    } catch (e) {
      console.error(`${LOG} ❌ 通知首页失败:`, e);
    }
    return false;
  }

  // ===========================
  // 主流程
  // ===========================
  if (!window.browserAPI || !window.browserAPI.getWindowId || !window.browserAPI.getGlobalData) {
    console.log(`${LOG} ⚠️ browserAPI 不可用，退出`);
    return;
  }

  let windowId = null;
  try {
    windowId = await window.browserAPI.getWindowId();
  } catch (e) {
    console.error(`${LOG} ❌ 获取窗口 ID 失败:`, e);
    return;
  }
  if (!windowId || windowId === 'main') {
    console.log(`${LOG} ⏭️ 非发布子窗口（windowId=${windowId}），退出`);
    return;
  }

  // 读取验证标记
  let verifyData = null;
  try {
    verifyData = await window.browserAPI.getGlobalData(`CONTENT_VERIFY_DATA_${windowId}`);
    if (verifyData && typeof verifyData === 'string') {
      try { verifyData = JSON.parse(verifyData); } catch (_) { verifyData = null; }
    }
  } catch (_) {}

  // 过期标记清理（15 分钟）：避免异常残留导致下次正常浏览被误触发
  if (verifyData && verifyData.createdAt && Date.now() - Number(verifyData.createdAt) > 15 * 60 * 1000) {
    console.warn(`${LOG} ⚠️ 验证标记已过期（>15min），清除并退出`);
    await cleanupFlags(windowId);
    return;
  }

  const matchedManagePlatform = findMatchedManagePlatform(currentUrl);

  // ---------------------------
  // 验证模式：有验证标记且在对应平台管理页
  // ---------------------------
  if (verifyData && verifyData.publishId && verifyData.title) {
    if (!matchedManagePlatform || matchedManagePlatform !== verifyData.platform) {
      // 🛡️ 落到登录页说明管理页要求重新登录，验证无法进行；发布与首次上报已完成，清标记关窗兜底
      if (typeof window.isPageOnLoginUrl === 'function' && window.isPageOnLoginUrl()) {
        console.warn(`${LOG} ⚠️ 验证跳转落到登录页，无法验证（发布与首次上报已完成），清标记关窗`);
        await cleanupFlags(windowId);
        await delayFn(1000);
        await closeWindowSafely();
        return;
      }
      console.log(`${LOG} ⏳ 有验证标记但当前页非 ${verifyData.platform} 管理页（匹配到: ${matchedManagePlatform || '无'}），等待跳转完成`);
      return;
    }

    const displayName = verifyData.displayName || getPlatformDisplayName(verifyData.platform);
    const fragment = buildTitleFragment(verifyData.title);
    if (!fragment) {
      console.warn(`${LOG} ⚠️ 标题片段为空，无法验证，清标记关窗（不上报）`);
      await cleanupFlags(windowId);
      await delayFn(1000);
      await closeWindowSafely();
      return;
    }

    console.log(`${LOG} 🔍 验证模式启动 | 平台: ${displayName} | publishId: ${verifyData.publishId} | 匹配片段: "${fragment}"`);

    // 🔄 管理页是 SPA，列表不会自己刷新：内容在审核中/接口慢时首屏数据里没有这篇，
    // 干等只会盯着同一份旧 DOM。策略：每轮轮询 20 秒，未命中就 location.reload() 拉新列表，
    // 最多加载 3 轮（轮数存在 verifyData.verifyAttempts 里，reload 后脚本重进继续数）。
    const POLL_INTERVAL = 2000;
    const POLL_TIMEOUT = 20000;
    const MAX_PAGE_LOADS = 3;
    const currentAttempt = Number(verifyData.verifyAttempts || 0) + 1;
    console.log(`${LOG} 📄 第 ${currentAttempt}/${MAX_PAGE_LOADS} 轮列表检查`);

    const startTs = Date.now();
    let found = false;
    // 先等 3 秒让列表首屏渲染
    await delayFn(3000);
    while (Date.now() - startTs < POLL_TIMEOUT) {
      try {
        const pageText = normalizeText(collectPageText(document));
        if (pageText.includes(fragment)) {
          found = true;
          break;
        }
        console.log(`${LOG} ⏳ 未命中，${POLL_INTERVAL / 1000}s 后重试（本轮已等待 ${Math.round((Date.now() - startTs) / 1000)}s，页面文本 ${pageText.length} 字）`);
      } catch (e) {
        console.warn(`${LOG} ⚠️ 文本采集异常:`, e && e.message);
      }
      await delayFn(POLL_INTERVAL);
    }

    if (found) {
      console.log(`${LOG} ✅ 内容管理页已找到刚发布的内容，完整再走一次成功流程`);
      try {
        if (typeof window.sendStatistics === 'function') {
          // skipDedup: 验证通过后的二次成功上报，绕过去重锁
          await window.sendStatistics(verifyData.publishId, displayName, { skipDedup: true });
        }
      } catch (e) {
        console.error(`${LOG} ❌ 验证成功统计上报异常:`, e && e.message);
      }
      notifyHome('发布成功，刷新数据');
      await cleanupFlags(windowId);
      await delayFn(3000);
      await closeWindowSafely();
    } else if (currentAttempt < MAX_PAGE_LOADS) {
      // 本轮没找到 → 刷新页面拉最新列表，脚本重新注入后继续下一轮
      console.warn(`${LOG} 🔄 第 ${currentAttempt} 轮未命中，刷新管理页拉取最新列表（还剩 ${MAX_PAGE_LOADS - currentAttempt} 轮）`);
      try {
        await window.browserAPI.setGlobalData(`CONTENT_VERIFY_DATA_${windowId}`, {
          ...verifyData,
          verifyAttempts: currentAttempt,
        });
        window.location.reload();
        return;
      } catch (e) {
        console.warn(`${LOG} ⚠️ 更新轮数失败，无法安全刷新，按未找到收尾:`, e && e.message);
        await cleanupFlags(windowId);
        await delayFn(1000);
        await closeWindowSafely();
      }
    } else {
      console.warn(`${LOG} ❌ ${MAX_PAGE_LOADS} 轮列表检查均未找到 "${fragment}"（可能审核中），按约定不上报任何统计，静默关窗`);
      await cleanupFlags(windowId);
      await delayFn(1000);
      await closeWindowSafely();
    }
    return;
  }

  // ---------------------------
  // 导航模式：无验证标记，检查发布成功标记（跳转型平台：腾讯/网易/知乎/抖音/头条等平台自动跳转的落地页）
  // ---------------------------
  if (isEditPage()) {
    console.log(`${LOG} ⏭️ 编辑页 URL (${currentPath})，跳过`);
    return;
  }

  // 读取发布成功标记（globalData 优先，localStorage 兜底，与 publish-success.js 一致）
  let successData = null;
  try {
    successData = await window.browserAPI.getGlobalData(`PUBLISH_SUCCESS_DATA_${windowId}`);
    if (successData && typeof successData === 'string') {
      try { successData = JSON.parse(successData); } catch (_) { successData = null; }
    }
  } catch (_) {}
  if (!successData) {
    try {
      const raw = localStorage.getItem(`PUBLISH_SUCCESS_DATA_${windowId}`) || localStorage.getItem('PUBLISH_SUCCESS_DATA');
      if (raw) successData = JSON.parse(raw);
    } catch (_) {}
  }

  if (!successData || !successData.publishId) {
    console.log(`${LOG} ℹ️ 无发布成功标记，正常浏览，退出`);
    return;
  }

  const platformKey = detectPlatformByUrl(currentUrl);
  if (!platformKey) {
    console.warn(`${LOG} ⚠️ 无法识别当前平台（${currentUrl}），退出`);
    return;
  }
  const displayName = getPlatformDisplayName(platformKey);

  console.log(`${LOG} 🎉 导航模式：检测到发布成功标记 | 平台: ${displayName} | publishId: ${successData.publishId}`);

  // 延迟 2 秒（与 publish-success.js 一致，等页面稳定）
  await delayFn(2000);

  // 第一遍成功流程：补发统计（带去重锁，发布脚本已报过会自动 skip）+ 通知首页
  try {
    if (typeof window.sendStatistics === 'function') {
      await window.sendStatistics(successData.publishId, displayName);
    }
  } catch (e) {
    console.error(`${LOG} ❌ 首次统计上报异常:`, e && e.message);
  }
  notifyHome('发布成功，刷新数据');

  // 提取标题（发布数据仍在 publish_data_window_${windowId} 中）
  let title = '';
  try {
    const publishData = typeof window.getCurrentPublishDataForStatistics === 'function'
      ? await window.getCurrentPublishDataForStatistics(LOG)
      : null;
    title = typeof window.extractPublishTitle === 'function' ? window.extractPublishTitle(publishData) : '';
  } catch (_) {}

  if (!title) {
    console.warn(`${LOG} ⚠️ 提取不到标题，无法验证，走原收尾（清标记 + 关窗）`);
    await cleanupFlags(windowId);
    await delayFn(3000);
    await closeWindowSafely();
    return;
  }

  // 如果当前落地页恰好就是本平台管理页（抖音/腾讯/网易/头条），原地转验证模式：写标记后刷新逻辑复用
  const manageUrl = (window.CONTENT_MANAGE_URLS && window.CONTENT_MANAGE_URLS[platformKey]) || null;
  const newVerifyData = {
    platform: platformKey,
    displayName,
    publishId: String(successData.publishId),
    title,
    manageUrl,
    createdAt: Date.now(),
  };

  try {
    await window.browserAPI.setGlobalData(`CONTENT_VERIFY_DATA_${windowId}`, newVerifyData);
  } catch (e) {
    console.warn(`${LOG} ⚠️ 写验证标记失败，走原收尾:`, e && e.message);
    await cleanupFlags(windowId);
    await delayFn(3000);
    await closeWindowSafely();
    return;
  }

  if (matchedManagePlatform === platformKey) {
    // 已在管理页：落地页的列表可能是跳转前的旧数据（SPA 不会自己刷新），
    // 验证标记已写入 globalData，直接 reload 拉最新列表，脚本重进后以验证模式接管（含 3 轮刷新重试）
    console.log(`${LOG} 📍 落地页即管理页，刷新拉取最新列表后进入验证模式`);
    window.location.reload();
    return;
  }

  if (!manageUrl) {
    console.warn(`${LOG} ⚠️ 平台 ${platformKey} 未配置管理页 URL，走原收尾`);
    await cleanupFlags(windowId);
    await delayFn(3000);
    await closeWindowSafely();
    return;
  }

  console.log(`${LOG} 🚀 跳转内容管理页验证:`, manageUrl);
  window.location.href = manageUrl;
})();
