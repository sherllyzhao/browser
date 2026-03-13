/**
 * AI 智能发布脚本
 * 通过 AI 分析页面 DOM 结构，自动识别表单并填写发布
 * 依赖: common.js（需在 scripts-config.json 中配置为前置依赖）
 */
(async function () {
  'use strict';

  const LOG_PREFIX = '[AI发布]';

  // 防止重复执行
  if (window.__AI_PUBLISH_LOADED__) {
    console.log(`${LOG_PREFIX} 脚本已加载，跳过`);
    return;
  }
  window.__AI_PUBLISH_LOADED__ = true;

  console.log(`${LOG_PREFIX} ✅ AI 智能发布脚本已加载`);
  console.log(`${LOG_PREFIX} 页面 URL: ${window.location.href}`);

  // ===========================
  // 1. DOM 提取器
  // ===========================

  /**
   * 为元素生成唯一的 CSS 选择器
   */
  function generateSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;

    // 尝试用 name 属性
    if (el.name) {
      const byName = document.querySelectorAll(`[name="${CSS.escape(el.name)}"]`);
      if (byName.length === 1) return `[name="${el.name}"]`;
    }

    // 尝试用 data-testid 或其他 data 属性
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-') && attr.value) {
        const sel = `[${attr.name}="${CSS.escape(attr.value)}"]`;
        try {
          if (document.querySelectorAll(sel).length === 1) return sel;
        } catch (e) { /* 忽略无效选择器 */ }
      }
    }

    // 尝试用 placeholder
    if (el.placeholder) {
      const sel = `${el.tagName.toLowerCase()}[placeholder="${CSS.escape(el.placeholder)}"]`;
      try {
        if (document.querySelectorAll(sel).length === 1) return sel;
      } catch (e) { /* 忽略 */ }
    }

    // 回退到路径选择器
    const parts = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.className && typeof current.className === 'string') {
        // 取第一个有意义的 class（过滤掉超长的 hash class）
        const classes = current.className.split(/\s+/).filter(c => c.length > 0 && c.length < 40);
        if (classes.length > 0) {
          selector += '.' + classes.slice(0, 2).map(c => CSS.escape(c)).join('.');
        }
      }
      // 如果有同名兄弟，加 nth-child
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-child(${index})`;
        }
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  /**
   * 查找元素关联的 label 文本
   */
  function findLabel(el) {
    // 通过 for 属性
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent.trim();
    }
    // 父级 label
    const parentLabel = el.closest('label');
    if (parentLabel) return parentLabel.textContent.trim().substring(0, 50);

    // 前面的兄弟元素或最近的文本
    const prev = el.previousElementSibling;
    if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'DIV')) {
      const text = prev.textContent.trim();
      if (text.length > 0 && text.length < 50) return text;
    }

    // aria-label
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');

    return '';
  }

  /**
   * 获取元素附近的文本（上下文信息）
   */
  function getNearbyText(el) {
    const parent = el.parentElement;
    if (!parent) return '';
    // 获取父级的纯文本（去掉子元素的文本后的剩余）
    const text = parent.textContent.trim().substring(0, 100);
    return text;
  }

  /**
   * 检查元素是否可见
   */
  function isVisible(el) {
    if (!el.offsetParent && el.tagName !== 'BODY' && el.tagName !== 'HTML') {
      // 特殊处理 fixed/sticky 定位元素
      const style = window.getComputedStyle(el);
      if (style.position !== 'fixed' && style.position !== 'sticky') return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * 提取页面的精简 DOM 结构
   */
  function extractPageStructure() {
    const elements = [];

    // 可交互元素选择器
    const interactiveSelectors = [
      'input:not([type="hidden"])',
      'textarea',
      'select',
      '[contenteditable="true"]',
      'button',
      '[role="button"]',
      '[type="submit"]',
      'input[type="file"]',
    ].join(', ');

    document.querySelectorAll(interactiveSelectors).forEach(el => {
      if (!isVisible(el) && el.type !== 'file') return;

      const info = {
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        selector: generateSelector(el),
        label: findLabel(el),
        placeholder: el.placeholder || '',
        value: (el.value || '').substring(0, 50),
        text: (el.textContent || '').trim().substring(0, 50),
        contenteditable: el.getAttribute('contenteditable') === 'true',
        disabled: el.disabled || false,
        required: el.required || false,
      };

      // 去掉空字段，减少 token 消耗
      Object.keys(info).forEach(k => {
        if (info[k] === '' || info[k] === false || info[k] === undefined) {
          delete info[k];
        }
      });

      elements.push(info);
    });

    // 也提取页面上的提示信息（toast、alert、错误提示等）
    const notices = [];
    document.querySelectorAll(
      '[class*="toast"], [class*="Toast"], [class*="notice"], [class*="Notice"], ' +
      '[class*="alert"], [class*="Alert"], [class*="error"], [class*="Error"], ' +
      '[class*="success"], [class*="Success"], [class*="message"], [class*="Message"], ' +
      '[role="alert"], [role="status"]'
    ).forEach(el => {
      const text = (el.textContent || '').trim();
      if (text.length > 0 && text.length < 200 && isVisible(el)) {
        notices.push({ text, selector: generateSelector(el) });
      }
    });

    return {
      url: window.location.href,
      title: document.title,
      elementCount: elements.length,
      elements,
      notices,
    };
  }

  // ===========================
  // 2. 操作执行器
  // ===========================

  /**
   * 等待指定毫秒
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 执行单个操作
   */
  async function executeAction(action) {
    console.log(`${LOG_PREFIX} 执行步骤 ${action.step}: ${action.action} - ${action.description}`);

    const el = document.querySelector(action.selector);
    if (!el) {
      console.warn(`${LOG_PREFIX} ⚠️ 元素未找到: ${action.selector}`);
      return { success: false, error: `元素未找到: ${action.selector}` };
    }

    try {
      switch (action.action) {
        case 'fill': {
          // 普通输入框填写
          el.focus();
          el.value = '';

          // 兼容 React 受控组件
          if (window.setNativeValue) {
            window.setNativeValue(el, action.value);
          } else {
            el.value = action.value;
          }

          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
          console.log(`${LOG_PREFIX} ✅ 已填写: ${action.value.substring(0, 30)}...`);
          break;
        }

        case 'fill_rich': {
          // 富文本编辑器（contenteditable）
          el.focus();
          el.innerHTML = '';

          // 使用 document.execCommand 或直接设置
          if (document.execCommand) {
            document.execCommand('insertText', false, action.value);
          } else {
            el.textContent = action.value;
          }

          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          console.log(`${LOG_PREFIX} ✅ 已填写富文本: ${action.value.substring(0, 30)}...`);
          break;
        }

        case 'click': {
          el.click();
          console.log(`${LOG_PREFIX} ✅ 已点击: ${action.description}`);
          break;
        }

        case 'select': {
          // 下拉选择
          el.value = action.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          console.log(`${LOG_PREFIX} ✅ 已选择: ${action.value}`);
          break;
        }

        case 'check': {
          // 复选框/单选框
          if (!el.checked) el.click();
          console.log(`${LOG_PREFIX} ✅ 已勾选: ${action.description}`);
          break;
        }

        case 'upload': {
          // 文件上传 - 标记但不自动执行（需要配合 common.js 的 uploadVideo/uploadImage）
          console.log(`${LOG_PREFIX} 📤 文件上传区域已识别: ${action.description} (field: ${action.field})`);
          return { success: true, needsUpload: true, field: action.field, selector: action.selector };
        }

        case 'publish': {
          // 发布按钮 - 不自动点击，返回信息供调用方决定
          console.log(`${LOG_PREFIX} 🔘 发布按钮已识别: ${action.selector}`);
          return { success: true, isPublishButton: true, selector: action.selector };
        }

        default:
          console.warn(`${LOG_PREFIX} ⚠️ 未知操作类型: ${action.action}`);
          return { success: false, error: `未知操作: ${action.action}` };
      }

      return { success: true };
    } catch (error) {
      console.error(`${LOG_PREFIX} ❌ 步骤 ${action.step} 执行失败:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 批量执行操作（按步骤顺序，每步间隔 500ms）
   */
  async function executeActions(actions) {
    const results = [];
    let publishButton = null;
    const uploadFields = [];

    for (const action of actions) {
      const result = await executeAction(action);
      results.push({ step: action.step, action: action.action, ...result });

      if (result.isPublishButton) {
        publishButton = action;
      }
      if (result.needsUpload) {
        uploadFields.push(action);
      }

      // 每步间隔，等待页面响应
      await sleep(500);
    }

    return { results, publishButton, uploadFields };
  }

  // ===========================
  // 3. 主流程
  // ===========================

  /**
   * AI 智能发布主流程
   * @param {Object} publishData - 发布数据
   * @param {Object} options - { autoPublish: false, autoDetectResult: true }
   */
  async function aiPublish(publishData, options = {}) {
    const { autoPublish = false, autoDetectResult = true } = options;

    console.log(`${LOG_PREFIX} 🚀 开始 AI 智能发布流程...`);
    if (window.showOperationBanner) {
      window.showOperationBanner('AI 智能发布进行中，请勿操作此页面...');
    }

    // Step 1: 提取 DOM 结构
    console.log(`${LOG_PREFIX} 📊 步骤1: 提取页面结构...`);
    await sleep(2000); // 等待页面完全加载
    const domData = extractPageStructure();
    console.log(`${LOG_PREFIX} 提取到 ${domData.elementCount} 个可交互元素`);

    if (domData.elementCount === 0) {
      console.error(`${LOG_PREFIX} ❌ 页面没有找到可交互元素`);
      return { success: false, error: '页面没有找到可交互元素' };
    }

    // Step 2: 调用 AI 分析
    console.log(`${LOG_PREFIX} 🤖 步骤2: AI 分析页面结构...`);
    const analyzeResult = await window.browserAPI.aiAnalyzePage(domData, publishData);

    if (!analyzeResult.success) {
      console.error(`${LOG_PREFIX} ❌ AI 分析失败:`, analyzeResult.error);
      return { success: false, error: analyzeResult.error };
    }

    const aiResult = analyzeResult.result;
    if (!aiResult.isForm) {
      console.log(`${LOG_PREFIX} ℹ️ AI 判断这不是表单页面: ${aiResult.reason}`);
      return { success: false, error: `非表单页面: ${aiResult.reason}` };
    }

    console.log(`${LOG_PREFIX} ✅ AI 识别为: ${aiResult.pageName}, 共 ${aiResult.actions.length} 个操作`);

    // Step 3: 执行填写操作
    console.log(`${LOG_PREFIX} ✍️ 步骤3: 执行表单填写...`);
    const execResult = await executeActions(aiResult.actions);

    // 处理文件上传
    if (execResult.uploadFields.length > 0) {
      console.log(`${LOG_PREFIX} 📤 检测到 ${execResult.uploadFields.length} 个文件上传区域`);
      for (const upload of execResult.uploadFields) {
        console.log(`${LOG_PREFIX}   - ${upload.field}: ${upload.selector}`);
        // 文件上传需要配合 common.js 的 uploadVideo/uploadImage
        // 这里只标记，具体上传逻辑由调用方处理
      }
    }

    // Step 4: 处理发布按钮
    if (execResult.publishButton && autoPublish) {
      console.log(`${LOG_PREFIX} 🚀 步骤4: 自动点击发布按钮...`);
      await sleep(1000);
      const publishEl = document.querySelector(execResult.publishButton.selector);
      if (publishEl) {
        publishEl.click();
        console.log(`${LOG_PREFIX} ✅ 已点击发布按钮`);

        // Step 5: 检测结果
        if (autoDetectResult) {
          console.log(`${LOG_PREFIX} 🔍 步骤5: 检测发布结果...`);
          await sleep(3000); // 等待页面反馈
          const resultDom = extractPageStructure();
          const detectResult = await window.browserAPI.aiDetectResult(resultDom);

          if (detectResult.success) {
            console.log(`${LOG_PREFIX} 📋 发布结果:`, detectResult.result);
            return {
              success: detectResult.result.status === 'success',
              result: detectResult.result,
              actions: execResult.results,
            };
          }
        }
      }
    } else if (execResult.publishButton) {
      console.log(`${LOG_PREFIX} ⏸️ 发布按钮已找到但未自动点击（autoPublish=false）`);
      console.log(`${LOG_PREFIX} 发布按钮选择器: ${execResult.publishButton.selector}`);
    }

    return {
      success: true,
      message: '表单填写完成',
      publishButton: execResult.publishButton?.selector || null,
      uploadFields: execResult.uploadFields,
      actions: execResult.results,
    };
  }

  // ===========================
  // 4. 暴露全局 API
  // ===========================

  // 暴露给页面和控制台使用
  window.__AI_AGENT__ = {
    // 提取当前页面的 DOM 结构（调试用）
    extractDOM: extractPageStructure,

    // 完整的 AI 发布流程
    publish: aiPublish,

    // 手动触发 AI 分析（不执行操作，只看 AI 返回什么）
    analyze: async (publishData) => {
      const domData = extractPageStructure();
      console.log(`${LOG_PREFIX} DOM 结构:`, domData);
      const result = await window.browserAPI.aiAnalyzePage(domData, publishData || {});
      console.log(`${LOG_PREFIX} AI 分析结果:`, result);
      return result;
    },

    // 手动检测当前页面状态
    detectResult: async () => {
      const domData = extractPageStructure();
      const result = await window.browserAPI.aiDetectResult(domData);
      console.log(`${LOG_PREFIX} 检测结果:`, result);
      return result;
    },

    // 手动执行单个操作
    exec: executeAction,
  };

  console.log(`${LOG_PREFIX} 🎯 API 已暴露到 window.__AI_AGENT__`);
  console.log(`${LOG_PREFIX} 使用方法:`);
  console.log(`${LOG_PREFIX}   __AI_AGENT__.analyze({title:'测试标题', content:'测试内容'})  // AI 分析`);
  console.log(`${LOG_PREFIX}   __AI_AGENT__.publish({title:'标题', content:'内容'})          // 完整发布`);
  console.log(`${LOG_PREFIX}   __AI_AGENT__.extractDOM()                                     // 查看 DOM`);
  console.log(`${LOG_PREFIX}   __AI_AGENT__.detectResult()                                   // 检测结果`);

  // ===========================
  // 5. 页面跳转拦截
  // ===========================

  // 记录初始 URL，用于检测意外跳转
  const INITIAL_URL = window.location.href;
  const INITIAL_ORIGIN = new URL(INITIAL_URL).origin;
  let redirectAttempts = 0; // 跳转拦截计数
  const MAX_REDIRECT_ATTEMPTS = 1; // 最多拦截 1 次，再跳就上报错误

  // 登录页的关键词，这些跳转不拦截（正常的登录流程）
  const LOGIN_KEYWORDS = [
    '/login', '/signin', '/sign-in', '/passport', '/account/login',
    'login.html', 'accounts.google', 'passport.baidu',
    'open.weixin.qq.com', 'channels.weixin.qq.com/login',
  ];

  /**
   * 判断 URL 是否是登录页面
   */
  function isLoginPage(url) {
    const lowerUrl = url.toLowerCase();
    return LOGIN_KEYWORDS.some(keyword => lowerUrl.includes(keyword));
  }

  /**
   * 上报跳转错误
   */
  async function reportRedirectError(fromUrl, toUrl) {
    const errorMsg = `页面意外跳转: 从 ${fromUrl} 跳到 ${toUrl}`;
    console.error(`${LOG_PREFIX} ❌ ${errorMsg}`);

    // 使用 common.js 的 sendStatisticsError（如果可用）
    if (window.sendStatisticsError) {
      // 尝试从发布数据中获取 publishId
      const publishData = window.__AUTH_DATA__?.message;
      const publishId = publishData?.video?.dyPlatform?.id || publishData?.id || 'unknown';
      await window.sendStatisticsError(publishId, errorMsg, 'AI发布');
    }

    // 通知首页
    if (window.browserAPI && window.browserAPI.sendToHome) {
      window.browserAPI.sendToHome({
        type: 'ai-publish-error',
        error: errorMsg,
        fromUrl,
        toUrl,
        timestamp: Date.now(),
      });
    }

    // 关闭窗口
    if (window.closeWindowWithMessage) {
      await window.closeWindowWithMessage('页面跳转异常，刷新数据', 1000);
    }
  }

  /**
   * 启动导航监控（通过轮询 URL 变化检测跳转）
   * 注：注入脚本无法直接监听 beforeunload 阻止跳转，
   *     但可以在新页面加载后通过脚本再次注入来检测
   */
  function startNavigationGuard() {
    // 使用 beforeunload 提示（不阻止跳转，但记录跳转前的状态）
    window.__AI_EXPECTED_URL__ = INITIAL_URL;
    window.__AI_REDIRECT_ATTEMPTS__ = redirectAttempts;

    console.log(`${LOG_PREFIX} 🛡️ 导航守卫已启动，保护 URL: ${INITIAL_URL}`);

    // 方式1: 定期检查 URL 是否变化（兼容 SPA 内部路由跳转）
    const urlCheckInterval = setInterval(() => {
      const currentUrl = window.location.href;

      // URL 没变，继续监控
      if (currentUrl === INITIAL_URL) return;

      // URL 变了，检查是否是登录页
      if (isLoginPage(currentUrl)) {
        console.log(`${LOG_PREFIX} 🔓 检测到跳转到登录页，放行: ${currentUrl}`);
        clearInterval(urlCheckInterval);
        return;
      }

      // 同域名下的路径变化（可能是正常的 SPA 路由）
      try {
        const currentOrigin = new URL(currentUrl).origin;
        if (currentOrigin === INITIAL_ORIGIN) {
          // 同域名，可能是正常的页面内跳转（发布成功后跳到管理页）
          console.log(`${LOG_PREFIX} ℹ️ 同域名跳转: ${currentUrl}`);
          return;
        }
      } catch (e) { /* 忽略无效 URL */ }

      // 跨域跳转 = 意外跳转
      redirectAttempts++;
      console.warn(`${LOG_PREFIX} ⚠️ 检测到意外跳转 (第${redirectAttempts}次): ${currentUrl}`);

      if (redirectAttempts <= MAX_REDIRECT_ATTEMPTS) {
        // 第一次：尝试跳回
        console.log(`${LOG_PREFIX} 🔄 尝试跳回原页面: ${INITIAL_URL}`);
        window.location.href = INITIAL_URL;
      } else {
        // 超过次数：上报错误
        clearInterval(urlCheckInterval);
        reportRedirectError(INITIAL_URL, currentUrl);
      }
    }, 1000); // 每秒检查一次

    // 保存 interval ID，便于清理
    window.__AI_NAV_GUARD_INTERVAL__ = urlCheckInterval;
  }

  // ===========================
  // 6. 自动流程（接收发布数据）
  // ===========================

  // 等待 common.js 加载完成
  await sleep(500);

  // 获取窗口 ID 和发布数据
  let windowId = null;
  try {
    windowId = await window.browserAPI.getWindowId();
    console.log(`${LOG_PREFIX} 窗口 ID: ${windowId}`);
  } catch (e) {
    console.log(`${LOG_PREFIX} 获取窗口 ID 失败（可能是主窗口BrowserView）`);
  }

  // 启动导航守卫（仅子窗口，不拦截主窗口 BrowserView）
  if (windowId && windowId !== 'main') {
    startNavigationGuard();
  }

  // 尝试从全局存储读取发布数据
  if (windowId && windowId !== 'main') {
    try {
      const publishData = await window.browserAPI.getGlobalData(`publish_data_window_${windowId}`);
      if (publishData) {
        console.log(`${LOG_PREFIX} ✅ 检测到发布数据，自动启动 AI 发布流程...`);
        // 自动执行发布（不自动点击发布按钮，让用户确认）
        const result = await aiPublish(publishData, { autoPublish: false });
        console.log(`${LOG_PREFIX} 📋 AI 发布流程完成:`, result);
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} ❌ 读取发布数据失败:`, error);
    }
  }

  // 监听来自首页的消息
  if (window.browserAPI && window.browserAPI.onMessageFromHome) {
    window.browserAPI.onMessageFromHome(async (messageData) => {
      console.log(`${LOG_PREFIX} 收到消息:`, messageData);
      if (messageData && messageData.type === 'publish-data') {
        const result = await aiPublish(messageData.data || messageData, { autoPublish: false });
        console.log(`${LOG_PREFIX} 📋 消息触发的发布流程完成:`, result);
      }
    });
    console.log(`${LOG_PREFIX} ✅ 消息监听器已注册`);
  }

})();
