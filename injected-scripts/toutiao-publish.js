/**
 * 头条创作者平台发布脚本
 * 用于处理发布流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
  'use strict'

  // ===========================
  // 防止脚本重复注入
  // ===========================
  if (window.__TOUTIAO_PUBLISH_SCRIPT_LOADED__) {
    console.log('[头条发布] ⚠️ 脚本已经加载过，跳过重复注入');
    return;
  }

  // ===========================
  // 页面状态检查 - 防止异常渲染
  // ===========================
  if (typeof window.checkPageStateAndReload === 'function') {
    if (!window.checkPageStateAndReload('头条发布')) {
      return;
    }
  }

  // 头条发布页是富文本编辑器，跳过异常渲染检测，避免误报
  window.__TOUTIAO_PUBLISH_SCRIPT_LOADED__ = true;

  if (typeof showOperationBanner === 'function') {
    showOperationBanner('正在自动发布中，请勿操作此页面...');
  }

  let fillFormRunning = false;
  let publishRunning = false;
  let isProcessing = false;
  let hasProcessed = false;
  let receivedMessageData = null;
  let currentWindowId = null;
  let errorListener = null;

  const LOG_PREFIX = '[头条发布]';

  const SUCCESS_TOAST_KEYWORDS = ['发布成功', '提交成功', '成功'];
  const FAIL_TOAST_KEYWORDS = ['失败', '错误', '异常', '请先', '不能为空', '未通过', '违规', '超限', '驳回'];
  const PUBLISH_API_PATH = '/mp/agw/article/publish';
  const DRAFT_API_PATH = '/mp/agw/draft/save_ugc_draft';

  let latestApiDiag = null;
  let latestPublishApiFailure = null;
  let latestPreSubmitPublishFailure = null;
  let latestPublishApiSuccessAt = 0;
  let latestDumpFilePath = '';
  let submitAttempted = false;
  let submitAttemptedAt = 0;
  const stageTrace = [];

  const initErrorListener = () => {
    if (typeof createErrorListener !== 'function') {
      return;
    }
    if (ERROR_LISTENER_CONFIGS?.toutiao) {
      errorListener = createErrorListener(ERROR_LISTENER_CONFIGS.toutiao);
      console.log(`${LOG_PREFIX} ✅ 使用公共错误监听器配置`);
      return;
    }
    errorListener = createErrorListener({
      logPrefix: LOG_PREFIX,
      selectors: [
        { containerClass: 'byte-message', textSelector: '.byte-message-content' },
        { containerClass: 'byte-message-notice-content', textSelector: '.byte-message-notice-content-text' },
        { containerClass: 'semi-toast', textSelector: '.semi-toast-content-text' }
      ]
    });
    console.log(`${LOG_PREFIX} ⚠️ 使用本地错误监听器配置`);
  };

  const startErrorListener = () => {
    if (!errorListener) {
      initErrorListener();
    }
    errorListener?.start?.();
  };
  const stopErrorListener = () => errorListener?.stop?.();
  const getLatestError = () => errorListener?.getLatestError?.() || null;

  const getPublishSuccessKey = () => {
    const key = `PUBLISH_SUCCESS_DATA_${currentWindowId || 'default'}`;
    console.log(`${LOG_PREFIX} 🔑 使用 localStorage key:`, key);
    return key;
  };

  const pushStage = (stage, detail = {}) => {
    const entry = {
      stage,
      ts: Date.now(),
      iso: new Date().toISOString(),
      ...detail
    };
    stageTrace.push(entry);
    if (stageTrace.length > 120) {
      stageTrace.shift();
    }
    console.log(`${LOG_PREFIX} 🧭 阶段: ${stage}`, detail);
    try {
      window.__TOUTIAO_PUBLISH_DIAG__.stageTrace = stageTrace.slice(-50);
    } catch (_) {}
    return entry;
  };

  const getVisibleButtonTexts = (limit = 40) => {
    try {
      return Array.from(document.querySelectorAll('button'))
        .filter(btn => {
          const rect = btn.getBoundingClientRect();
          return rect.width > 2 && rect.height > 2;
        })
        .map(btn => (btn.textContent || '').trim())
        .filter(Boolean)
        .slice(0, limit);
    } catch (_) {
      return [];
    }
  };

  const getQuickPageSnapshot = () => ({
    href: window.location.href,
    title: document.title,
    visibleButtons: getVisibleButtonTexts(),
    submitAttempted,
    submitAttemptedAt,
    latestApiDiag,
    latestPublishApiFailure,
    latestPreSubmitPublishFailure
  });

  // ═══ 2. 初始化日志与平台检查 ═══
  console.log('═══════════════════════════════════════');
  console.log('✅ 头条发布脚本已注入');
  console.log('📍 当前 URL:', window.location.href);
  console.log('🕐 注入时间:', new Date().toLocaleString());
  console.log('═══════════════════════════════════════');

  // 暴露诊断数据到全局 window 对象（这样在 DevTools Console 可以直接查看）
  window.__TOUTIAO_PUBLISH_DIAG__ = {
    loaded: true,
    loadTime: Date.now(),
    apiDiag: null,
    errors: [],
    publishAttempts: 0,
    lastDiagMessage: ''
  };

  // 全局异常捕获：确保所有错误都被记录
  const origOnError = window.onerror;
  window.onerror = function(msg, source, lineno, colno, error) {
    const errMsg = `[头条发布脚本异常] ${msg} (${source}:${lineno}:${colno})`;
    console.error(errMsg, error);
    try {
      window.__TOUTIAO_PUBLISH_DIAG__.errors.push({
        msg: errMsg,
        error: error && error.message ? error.message : String(error),
        timestamp: Date.now()
      });
    } catch (e) {}
    if (origOnError) return origOnError.apply(this, arguments);
  };

  const origOnUnhandledRejection = window.onunhandledrejection;
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const errMsg = `[头条发布脚本 Promise 异常] ${reason && reason.message ? reason.message : String(reason)}`;
    console.error(errMsg);
    try {
      window.__TOUTIAO_PUBLISH_DIAG__.errors.push({
        msg: errMsg,
        error: reason && reason.message ? reason.message : String(reason),
        timestamp: Date.now()
      });
    } catch (e) {}
    if (origOnUnhandledRejection) origOnUnhandledRejection.call(window, event);
  });

  if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
    console.error(`${LOG_PREFIX} ❌ common.js 未加载！脚本可能无法正常工作`);
  } else {
    console.log(`${LOG_PREFIX} ✅ common.js 已加载，工具函数可用`);
  }

  // ═══ 3. 注册消息监听器 ═══
  console.log(`${LOG_PREFIX} 注册消息监听器...`);

  if (!window.browserAPI) {
    console.error(`${LOG_PREFIX} ❌ browserAPI 不可用！`);
  } else if (!window.browserAPI.onMessageFromHome) {
    console.error(`${LOG_PREFIX} ❌ browserAPI.onMessageFromHome 不可用！`);
  } else {
    window.browserAPI.onMessageFromHome(async (message) => {
      console.log('═══════════════════════════════════════');
      console.log(`${LOG_PREFIX} 🎉 收到来自父窗口的消息!`);
      console.log(`${LOG_PREFIX} 消息.type:`, message?.type);
      console.log(`${LOG_PREFIX} 消息.windowId:`, message?.windowId);
      console.log('═══════════════════════════════════════');

      if (message.type !== 'publish-data') return;

      const messageData = parseMessageData(message.data, LOG_PREFIX);
      if (!messageData) return;

      const isMatch = await checkWindowIdMatch(message, LOG_PREFIX);
      if (!isMatch) return;

      const needReload = await restoreSessionAndReload(messageData, LOG_PREFIX);
      if (needReload) return;

      receivedMessageData = messageData;
      console.log(`${LOG_PREFIX} 💾 已保存收到的消息数据到 receivedMessageData`);

      if (isProcessing) {
        console.warn(`${LOG_PREFIX} ⚠️ 正在处理中，忽略重复消息`);
        return;
      }
      if (hasProcessed) {
        console.warn(`${LOG_PREFIX} ⚠️ 已经处理过，忽略重复消息`);
        return;
      }

      isProcessing = true;
      try {
        window.__AUTH_DATA__ = {
          ...window.__AUTH_DATA__,
          message: messageData,
          receivedAt: Date.now()
        };
        await retryOperation(async () => fillFormData(messageData), 3, 2000);
      } catch (e) {
        console.error(`${LOG_PREFIX} ❌ 执行发布流程失败:`, e);
      } finally {
        isProcessing = false;
      }
    });

    console.log(`${LOG_PREFIX} ✅ 消息监听器注册成功`);
  }

  // ═══ 4. URL 参数与窗口 ID ═══
  const urlParams = new URLSearchParams(window.location.search);
  const companyId = await window.browserAPI.getGlobalData('company_id');
  const transferId = urlParams.get('transfer_id');

  try {
    currentWindowId = await window.browserAPI.getWindowId();
    console.log(`${LOG_PREFIX} 当前窗口 ID:`, currentWindowId);
  } catch (e) {
    console.error(`${LOG_PREFIX} ❌ 获取窗口 ID 失败:`, e);
  }

  // ═══ 5. 全局授权数据与方法 ═══
  window.__AUTH_DATA__ = {
    companyId,
    transferId,
    timestamp: Date.now()
  };

  window.__TOUTIAO_PUBLISH_AUTH__ = {
    notifySuccess: () => sendMessageToParent('发布成功'),
    sendMessage: (message) => sendMessageToParent(message),
    getAuthData: () => window.__AUTH_DATA__
  };

  // ═══ 6. 发送页面加载完成消息 ═══
  console.log(`${LOG_PREFIX} 页面加载完成，发送 页面加载完成 消息`);
  sendMessageToParent('页面加载完成');

  console.log('═══════════════════════════════════════');
  console.log('✅ 头条发布脚本初始化完成');
  console.log('📝 全局方法: window.__TOUTIAO_PUBLISH_AUTH__');
  console.log('  - notifySuccess()  : 发送发布成功消息');
  console.log('  - sendMessage(msg) : 发送自定义消息');
  console.log('  - getAuthData()    : 获取发布数据');
  console.log('═══════════════════════════════════════');

  // ═══ 头条专用辅助函数 ═══
  const parsePlainTextFromHtml = (html) => {
    if (!html) return '';
    if (typeof html !== 'string') return String(html);
    if (!/[<>]/.test(html)) return html.trim();
    const temp = document.createElement('div');
    temp.innerHTML = html;
    return (temp.innerText || temp.textContent || '').trim();
  };

  const ensureFileFromUrl = async (url, fileNamePrefix = 'toutiao-cover') => {
    if (!url) return null;
    let blob;
    let contentType = 'image/jpeg';

    if (window.browserAPI?.downloadVideo) {
      const result = await window.browserAPI.downloadVideo(url);
      if (!result.success) {
        throw new Error(result.error || '封面下载失败');
      }
      const binary = atob(result.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      blob = new Blob([bytes], { type: result.contentType || 'image/jpeg' });
      contentType = result.contentType || 'image/jpeg';
    } else {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`封面下载失败: HTTP ${response.status}`);
      }
      blob = await response.blob();
      contentType = response.headers.get('Content-Type') || blob.type || 'image/jpeg';
    }

    let ext = '.jpg';
    if (contentType.includes('png')) ext = '.png';
    if (contentType.includes('webp')) ext = '.webp';
    if (contentType.includes('gif')) ext = '.gif';
    if (contentType.includes('bmp')) ext = '.bmp';

    return new File([blob], `${fileNamePrefix}${ext}`, { type: contentType });
  };

  const createFallbackCoverFile = async (title) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // 使用稳定兜底封面，避免无封面导致平台保存失败
    ctx.fillStyle = '#1f6feb';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px sans-serif';
    const safeTitle = (
      typeof title === 'string' && title.trim()
        ? title.trim()
        : '未命名文章'
    ).slice(0, 16);
    ctx.fillText(safeTitle, 56, 140);
    ctx.font = '32px sans-serif';
    const timeText = new Date().toLocaleString('zh-CN', { hour12: false });
    ctx.fillText(timeText, 56, 210);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return null;
    return new File([blob], 'toutiao-cover-fallback.png', { type: 'image/png' });
  };

  const normalizeTitleForPublish = (title) => {
    const clean = (title || '').trim();
    if (clean.length >= 5) return clean;
    const suffix = new Date().toLocaleTimeString('zh-CN', { hour12: false }).replace(/:/g, '');
    const base = clean || '未命名文章';
    const composed = `${base} ${suffix}`.trim();
    return composed.slice(0, 30);
  };

  const normalizeContentForPublish = (content, intro, title) => {
    const raw = parsePlainTextFromHtml(content) || parsePlainTextFromHtml(intro) || '';
    const trimmed = raw.trim();
    if (trimmed.length >= 20) return trimmed;
    const head = (typeof title === 'string' ? title.trim() : '') || '';
    const timeText = new Date().toLocaleString('zh-CN', { hour12: false });
    return [
      head,
      `更新时间：${timeText}`
    ].filter(Boolean).join('\n\n');
  };

  const findVisibleEditable = () => {
    const candidates = [
      ...document.querySelectorAll('#root .ProseMirror'),
      ...document.querySelectorAll('.ProseMirror'),
      ...document.querySelectorAll('[contenteditable="true"]')
    ];
    if (candidates.length === 0) return null;
    const filtered = candidates.filter(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 30) return false;
      if (el.closest('textarea, input')) return false;
      return true;
    });
    return filtered[0] || candidates[0];
  };

  const isVisibleElement = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number(style.opacity || '1') === 0) return false;
    return true;
  };

  const findVisibleHintText = (patterns = []) => {
    const regs = patterns.map(pattern => (pattern instanceof RegExp ? pattern : new RegExp(pattern)));
    const selectors = [
      '.byte-form-item-help',
      '.byte-form-item-msg',
      '.byte-form-item-explain',
      '.byte-message-content',
      '.byte-message-notice-content-text',
      '.semi-toast-content-text',
      '.arco-message-content',
      '[class*="error"]',
      '[class*="hint"]',
      '[class*="tips"]',
      '[class*="suffix"]'
    ];
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (!isVisibleElement(element)) continue;
        const text = (element.textContent || '').trim();
        if (!text || text.length > 200) continue;
        if (regs.some(reg => reg.test(text))) {
          return text;
        }
      }
    }
    return '';
  };

  const findTitleInput = () => {
    const selectors = [
      'textarea[placeholder*="请输入文章标题"]',
      'textarea[placeholder*="文章标题"]',
      'textarea[placeholder*="标题"]',
      'input[placeholder*="标题"]',
      'textarea[placeholder*="填写标题"]',
      'input[placeholder*="填写标题"]',
      'textarea[data-testid*="title"]',
      'input[data-testid*="title"]'
    ];
    for (const selector of selectors) {
      const candidates = Array.from(document.querySelectorAll(selector));
      const visible = candidates.find(el => isVisibleElement(el) && el.getBoundingClientRect().width > 120);
      if (visible) return visible;
      if (candidates[0]) return candidates[0];
    }
    const byLabel = Array.from(document.querySelectorAll('textarea, input')).find(el => {
      const text = `${el.placeholder || ''}${el.getAttribute('aria-label') || ''}`;
      return text.includes('标题');
    });
    return byLabel || null;
  };

  const readLatestToast = () => {
    const selectors = [
      '.byte-message-notice-content-text',
      '.byte-message-content',
      '.semi-toast-content-text',
      '.arco-message-content',
      '[class*="message"] [class*="content"]'
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const text = (el?.textContent || '').trim();
      if (text && text.length < 200) return text;
    }
    return '';
  };

  const findPublishButton = () => {
    const allButtons = Array.from(document.querySelectorAll('button'));
    const visibleButtons = allButtons.filter(btn => {
      const rect = btn.getBoundingClientRect();
      return rect.width > 20 && rect.height > 16;
    });

    const firstMatch = visibleButtons.find(btn => (btn.textContent || '').trim() === '预览并发布');
    if (firstMatch) return firstMatch;

    const secondMatch = visibleButtons.find(btn => {
      const text = (btn.textContent || '').trim();
      return text === '发布' || text.includes('发布文章') || text.includes('确认发布');
    });
    if (secondMatch) return secondMatch;

    const selectorMatch =
      document.querySelector("button.publish-btn-last") ||
      document.querySelector("button[class*='publish-btn-last']") ||
      document.querySelector("button[class*='byte-btn-primary'][class*='publish-btn']") ||
      document.querySelector("[class*='garr-footer-publish-content'] button[class*='byte-btn-primary']");

    if (selectorMatch) return selectorMatch;
    return visibleButtons.find(btn => (btn.textContent || '').includes('发布')) || null;
  };

  const findSecondaryConfirmButton = () => {
    const dialogs = Array.from(document.querySelectorAll(
      "[class*='modal'], [class*='dialog'], .byte-modal, .semi-modal, .arco-modal"
    )).filter(el => isVisibleElement(el));
    if (dialogs.length === 0) return null;
    const scope = dialogs[dialogs.length - 1];
    const buttons = Array.from(scope.querySelectorAll('button'));
    const byText = buttons.find(btn => {
      const text = (btn.textContent || '').trim();
      return text === '发布' || text === '确认发布' || text === '立即发布' || text.includes('确认');
    });
    return byText || null;
  };

  const getVisibleDialogs = () => Array.from(document.querySelectorAll(
    "[class*='modal'], [class*='dialog'], .byte-modal, .semi-modal, .arco-modal"
  )).filter(el => isVisibleElement(el));

  const getActiveDialogScope = () => {
    const dialogs = getVisibleDialogs();
    return dialogs.length > 0 ? dialogs[dialogs.length - 1] : document;
  };

  const hasVisiblePreviewLoading = () => {
    const scope = getActiveDialogScope();
    const loadingSelectors = [
      '.byte-spin',
      '.semi-spin',
      '.arco-spin',
      '[class*="spin"]',
      '[class*="loading"]',
      '[aria-busy="true"]'
    ];

    for (const selector of loadingSelectors) {
      const nodes = Array.from(scope.querySelectorAll(selector));
      if (nodes.some(node => isVisibleElement(node))) {
        return true;
      }
    }

    const loadingTextNode = Array.from(scope.querySelectorAll('div,span,p')).find(node => {
      if (!isVisibleElement(node)) return false;
      const t = (node.textContent || '').trim();
      return /加载中|处理中|生成中|请稍候/.test(t);
    });
    return !!loadingTextNode;
  };

  const waitPreviewConfirmReady = async (timeoutMs = 12000) => {
    const start = Date.now();
    let stableSince = 0;
    let lastStateLogAt = 0;

    while (Date.now() - start < timeoutMs) {
      const confirmBtn = findSecondaryConfirmButton();
      const hasConfirm = !!confirmBtn;
      const interactive = confirmBtn ? isButtonInteractive(confirmBtn) : false;
      const loading = hasVisiblePreviewLoading();

      if (hasConfirm && interactive && !loading) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 1000) {
          return { ready: true, confirmBtn };
        }
      } else {
        stableSince = 0;
      }

      if (Date.now() - lastStateLogAt > 2000) {
        lastStateLogAt = Date.now();
        console.log(`${LOG_PREFIX} ⏳ 等待预览层稳定:`, {
          hasConfirm,
          interactive,
          loading
        });
      }
      await delay(300);
    }

    return { ready: false, confirmBtn: findSecondaryConfirmButton() };
  };

  const clickElement = async (el) => {
    if (!el) return { success: false, message: '元素为空' };
    if (typeof clickWithRetry === 'function') {
      return clickWithRetry(el, 3, 500, true);
    }
    try {
      el.click();
      return { success: true, message: 'click() 成功' };
    } catch (e) {
      return { success: false, message: e.message || 'click() 失败' };
    }
  };

  const isButtonInteractive = (btn) => {
    if (!btn) return false;
    const className = (btn.className || '').toString().toLowerCase();
    if (btn.disabled || btn.getAttribute('disabled') !== null) return false;
    if (btn.getAttribute('aria-disabled') === 'true') return false;
    if (btn.getAttribute('aria-busy') === 'true') return false;
    if (className.includes('disabled') || className.includes('loading')) return false;
    return true;
  };

  const safeParseJsonText = (text) => {
    if (!text || typeof text !== 'string') return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  };

  const getApiCode = (payload) => {
    if (!payload || typeof payload !== 'object') return null;
    const keys = ['code', 'err_no', 'errno', 'status', 'status_code', 'ret'];
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        return payload[key];
      }
    }
    return null;
  };

  const getApiMessage = (payload) => {
    if (!payload || typeof payload !== 'object') return '';
    const keys = ['msg', 'message', 'err_tips', 'error_msg', 'desc'];
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  };

  const isApiSuccessPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return false;
    if (payload.success === true) return true;
    const code = getApiCode(payload);
    if (code === null || typeof code === 'undefined') {
      const msg = getApiMessage(payload);
      return /成功|ok/i.test(msg);
    }
    const numCode = Number(code);
    if (Number.isNaN(numCode)) {
      return String(code).toLowerCase() === 'ok' || String(code) === '0';
    }
    return numCode === 0;
  };

  const bodyToSnippet = (body) => {
    if (!body) return '';
    try {
      if (typeof body === 'string') return body.slice(0, 8000);
      if (body instanceof URLSearchParams) return body.toString().slice(0, 8000);
      return String(body).slice(0, 8000);
    } catch (_) {
      return '';
    }
  };

  const summarizeRequestBody = (bodyText) => {
    if (!bodyText || typeof bodyText !== 'string') return null;
    if (!bodyText.includes('=')) return { rawLength: bodyText.length };
    try {
      const params = new URLSearchParams(bodyText);
      const entries = Array.from(params.entries());
      const keys = entries.map(([k]) => k);
      const keyMap = new Map(entries);
      const pick = (candidates) => {
        for (const candidate of candidates) {
          if (keyMap.has(candidate)) return keyMap.get(candidate);
        }
        return '';
      };
      const title = pick(['title', 'article_title', 'publish_title']);
      const content = pick(['content', 'article_content', 'article', 'rich_text']);
      const cover = pick(['cover', 'cover_uri', 'thumb_uri', 'cover_info']);
      const draftId = pick(['draft_id', 'pgc_id', 'article_id']);
      const summary = {
        rawLength: bodyText.length,
        keyCount: keys.length,
        keysSample: keys.slice(0, 40),
        titleLength: title ? String(title).length : 0,
        contentLength: content ? String(content).length : 0,
        hasCoverField: !!cover,
        draftId: draftId ? String(draftId).slice(0, 60) : ''
      };
      return summary;
    } catch (_) {
      return { rawLength: bodyText.length };
    }
  };

  const normalizeUrl = (input) => {
    try {
      return new URL(input, window.location.origin).toString();
    } catch (_) {
      return String(input || '');
    }
  };

  const isTargetApiUrl = (url) => {
    if (!url) return false;
    return url.includes(PUBLISH_API_PATH) || url.includes(DRAFT_API_PATH);
  };

  const createApiFailText = (diag) => {
    if (!diag) return '发布接口失败';
    const codeText = diag.code !== null && typeof diag.code !== 'undefined' ? `code=${diag.code}` : 'code=unknown';
    const msgText = diag.message || '无返回信息';
    return `${diag.kind === 'publish' ? '发布' : '草稿'}接口失败(${codeText}): ${msgText}`;
  };

  const recordApiDiag = (diag) => {
    latestApiDiag = diag;
    const codeText = diag.code !== null && typeof diag.code !== 'undefined' ? diag.code : 'unknown';
    const statusText = `HTTP ${diag.status}`;
    const msgText = diag.message ? `(${diag.message})` : '';

    // 【关键】记录到全局诊断对象（DevTools 可查看）
    try {
      window.__TOUTIAO_PUBLISH_DIAG__.apiDiag = {
        kind: diag.kind,
        status: diag.status,
        code: codeText,
        message: diag.message,
        success: diag.success,
        requestHeaders: diag.requestHeaders || {},
        timestamp: Date.now()
      };
      window.__TOUTIAO_PUBLISH_DIAG__.lastDiagMessage = `${diag.kind}接口 ${statusText} code=${codeText}`;
    } catch (e) {}

    // 格式化输出到 console（同时也会通过 console overlay 显示在浮层）
    console.log(`${LOG_PREFIX} 📡 ${diag.kind}接口响应: ${statusText} code=${codeText} ${msgText}`);
    if (diag.requestSummary) {
      console.log(`${LOG_PREFIX} 🧾 ${diag.kind}请求体摘要: ${diag.requestSummary}`);
    }
    if (diag.requestHeaders && Object.keys(diag.requestHeaders).length > 0) {
      console.log(`${LOG_PREFIX} 🔐 请求头: ${JSON.stringify(diag.requestHeaders).slice(0, 200)}`);
    }

    if (!diag.success) {
      const failText = createApiFailText(diag);
      if (diag.kind === 'publish') {
        if (submitAttempted) {
          latestPublishApiFailure = {
            ...diag,
            failText
          };
        } else {
          latestPreSubmitPublishFailure = {
            ...diag,
            failText
          };
          console.warn(`${LOG_PREFIX} ℹ️ 捕获到发布接口失败（尚未提交）: ${failText}`);
        }
      }

      // 把失败诊断信息格式化输出到 console（会显示在浮层）
      const diagSummary = [
        `❌ ${failText}`,
        `   状态: ${diag.status}`,
        `   代码: ${codeText}`,
        diag.message ? `   信息: ${diag.message}` : '',
        diag.requestSummary ? `   请求: ${diag.requestSummary}` : '',
        diag.responseSnippet ? `   响应: ${diag.responseSnippet.slice(0, 100)}...` : ''
      ].filter(Boolean).join('\n');

      console.error(diagSummary);

      if (submitAttempted && typeof sendMessageToParent === 'function') {
        sendMessageToParent(`头条发布诊断: ${failText}`);
      }
      // DevTools 看不到时，直接落盘到 debug-dumps
      void dumpDebugToFile('api-failed', diag);
    } else if (diag.kind === 'publish') {
      latestPublishApiSuccessAt = Date.now();
      // 一旦检测到发布接口成功响应，清理之前的失败快照，避免误判中间失败
      latestPublishApiFailure = null;
      latestPreSubmitPublishFailure = null;
      console.log(`${LOG_PREFIX} ✅ ${diag.kind}接口成功`);
    }
  };

  const handleApiResponse = (url, status, requestBodySnippet, responseText, fullDiag = {}) => {
    if (!isTargetApiUrl(url)) return;

    const payload = safeParseJsonText(responseText);
    const apiCode = payload ? getApiCode(payload) : null;
    const apiMessage = payload ? getApiMessage(payload) : '';
    const success = status >= 200 && status < 300 && payload ? isApiSuccessPayload(payload) : false;
    const kind = url.includes(PUBLISH_API_PATH) ? 'publish' : 'draft';

    const requestSummary = summarizeRequestBody(requestBodySnippet);

    recordApiDiag({
      kind,
      url,
      status,
      code: apiCode,
      message: apiMessage || (success ? 'success-without-message' : ''),
      success,
      requestBodySnippet,
      requestSummary,
      responseSnippet: (responseText || '').slice(0, 400),
      requestHeaders: fullDiag?.requestHeaders || {},
      ts: Date.now()
    });
  };

  const installApiDiagnostics = () => {
    if (window.__TOUTIAO_API_DIAG_HOOKED__) return;
    window.__TOUTIAO_API_DIAG_HOOKED__ = true;

    console.log(`${LOG_PREFIX} 📊 开始安装 API 诊断钩子...`);

    let fetchHooked = false;
    let xhrHooked = false;

    if (typeof window.fetch === 'function') {
      console.log(`${LOG_PREFIX} 🔗 检测到 fetch，正在 hook...`);
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const req = args[0];
        const init = args[1] || {};
        const url = typeof req === 'string' ? req : (req?.url || '');
        const fullUrl = normalizeUrl(url);
        const bodySnippet = bodyToSnippet(init?.body || req?.body);

        // 【新增】捕获请求头用于诊断
        const requestHeaders = init?.headers || {};
        const headersSummary = {};
        try {
          if (requestHeaders instanceof Headers) {
            requestHeaders.forEach((value, key) => {
              headersSummary[key] = value;
            });
          } else if (typeof requestHeaders === 'object') {
            Object.assign(headersSummary, requestHeaders);
          }
        } catch (e) {
          console.warn(`${LOG_PREFIX} ⚠️ 请求头读取失败:`, e.message);
        }

        try {
          const res = await nativeFetch(...args);
          if (isTargetApiUrl(fullUrl)) {
            fetchHooked = true;
            try {
              const text = await res.clone().text();
              // 【新增】记录请求头到诊断数据
              const fullDiag = {
                requestHeaders: headersSummary,
                requestUrl: fullUrl
              };
              handleApiResponse(fullUrl, res.status || 0, bodySnippet, text, fullDiag);
            } catch (e) {
              console.warn(`${LOG_PREFIX} ⚠️ fetch响应读取失败:`, e.message || e);
            }
          }
          return res;
        } catch (e) {
          if (isTargetApiUrl(fullUrl)) {
            fetchHooked = true;
            recordApiDiag({
              kind: fullUrl.includes(PUBLISH_API_PATH) ? 'publish' : 'draft',
              url: fullUrl,
              status: 0,
              code: 'network_error',
              message: e.message || 'network error',
              success: false,
              requestBodySnippet: bodySnippet,
              responseSnippet: '',
              ts: Date.now()
            });
          }
          throw e;
        }
      };
      console.log(`${LOG_PREFIX} ✅ fetch hook 安装完成`);
    }

    if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
      console.log(`${LOG_PREFIX} 🔗 检测到 XMLHttpRequest，正在 hook...`);
      const xhrProto = window.XMLHttpRequest.prototype;
      const nativeOpen = xhrProto.open;
      const nativeSend = xhrProto.send;

      xhrProto.open = function patchedOpen(method, url, ...rest) {
        try {
          this.__ttDiagUrl = normalizeUrl(url);
          this.__ttDiagMethod = method;
        } catch (_) {}
        return nativeOpen.call(this, method, url, ...rest);
      };

      xhrProto.send = function patchedSend(body) {
        try {
          this.__ttDiagBodySnippet = bodyToSnippet(body);
          this.addEventListener('loadend', () => {
            const targetUrl = this.__ttDiagUrl || '';
            if (!isTargetApiUrl(targetUrl)) return;
            xhrHooked = true;
            let responseText = '';
            try {
              responseText = typeof this.responseText === 'string' ? this.responseText : '';
            } catch (_) {}
            handleApiResponse(targetUrl, this.status || 0, this.__ttDiagBodySnippet || '', responseText);
          }, { once: true });
        } catch (_) {}
        return nativeSend.call(this, body);
      };
      console.log(`${LOG_PREFIX} ✅ XMLHttpRequest hook 安装完成`);
    }

    console.log(`${LOG_PREFIX} ✅ 已安装发布接口诊断钩子`);
  };

  const dumpDebugToFile = async (reason, extra = {}) => {
    if (!window.browserAPI?.writeDebugFile) return null;
    try {
      const payload = {
        prefix: 'toutiao-publish',
        content: {
          reason,
          ts: new Date().toISOString(),
          url: window.location.href,
          submitAttempted,
          submitAttemptedAt,
          stageTrace,
          latestApiDiag,
          latestPublishApiFailure,
          latestPreSubmitPublishFailure,
          latestPublishApiSuccessAt,
          pageSnapshot: getQuickPageSnapshot(),
          extra
        }
      };
      const result = await window.browserAPI.writeDebugFile(payload);
      if (result?.success && result.filePath) {
        latestDumpFilePath = result.filePath;
        if (window.browserAPI?.setGlobalData) {
          try {
            await window.browserAPI.setGlobalData('toutiao_last_debug_dump', result.filePath);
          } catch (_) {}
        }
        console.log(`${LOG_PREFIX} 📝 已写入调试文件:`, result.filePath);
        if (typeof sendMessageToParent === 'function') {
          sendMessageToParent(`头条调试文件: ${result.filePath}`);
        }
      }
      return result;
    } catch (e) {
      console.warn(`${LOG_PREFIX} ⚠️ 写调试文件失败:`, e.message || e);
      return null;
    }
  };

  installApiDiagnostics();

  // ========== 设备 Cookie 安全网 ==========
  // 如果 openNewWindow 阶段的补全未生效（如 restoreSessionAndReload 路径），
  // 在脚本运行时再补一次，确保后续 publish API 请求携带正确的设备标识。
  const ensureDeviceCookies = async () => {
    try {
      const cookies = document.cookie;
      if (!cookies.includes('tt_webid=') && window.browserAPI?.setCookie) {
        const ts = BigInt(Date.now());
        const rand = BigInt(Math.floor(Math.random() * (2 ** 22)));
        const ttWebid = String(ts * BigInt(2 ** 22) + rand);
        await window.browserAPI.setCookie({
          name: 'tt_webid', value: ttWebid, domain: '.toutiao.com',
          path: '/', secure: true, httpOnly: false, sameSite: 'no_restriction',
          expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
        });
        console.log(`${LOG_PREFIX} ✅ 安全网：已补全 tt_webid`);
      }

      const svMatch = cookies.match(/s_v_web_id=(verify_[^;]*)/);
      if (svMatch && window.browserAPI?.setCookie) {
        const fixed = svMatch[1].replace('verify_', '');
        await window.browserAPI.setCookie({
          name: 's_v_web_id', value: fixed, domain: 'mp.toutiao.com',
          path: '/', secure: true, httpOnly: false, sameSite: 'no_restriction',
          expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
        });
        console.log(`${LOG_PREFIX} ✅ 安全网：已修复 s_v_web_id`);
      }

      if (!cookies.includes('ttcid=') && window.browserAPI?.setCookie) {
        const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
        await window.browserAPI.setCookie({
          name: 'ttcid', value: hex + Math.floor(Math.random() * 100).toString().padStart(2, '0'),
          domain: 'mp.toutiao.com', path: '/', secure: true, httpOnly: false,
          sameSite: 'no_restriction', expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
        });
        console.log(`${LOG_PREFIX} ✅ 安全网：已补全 ttcid`);
      }

      if (!cookies.includes('tt_scid=') && window.browserAPI?.setCookie) {
        const sc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-';
        const ttScid = Array.from({ length: 64 }, () => sc[Math.floor(Math.random() * sc.length)]).join('');
        await window.browserAPI.setCookie({
          name: 'tt_scid', value: ttScid, domain: 'mp.toutiao.com',
          path: '/', secure: true, httpOnly: false, sameSite: 'no_restriction',
          expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
        });
        console.log(`${LOG_PREFIX} ✅ 安全网：已补全 tt_scid`);
      }
    } catch (e) {
      console.warn(`${LOG_PREFIX} ⚠️ 设备 Cookie 安全网失败:`, e.message || e);
    }
  };
  await ensureDeviceCookies();

  const fillTitle = async (title) => {
    const targetTitle = (title || '').trim();
    if (!targetTitle) return;
    pushStage('fill-title:start', { targetTitle });
    await retryOperation(async () => {
      const titleInput = findTitleInput();
      if (!titleInput) {
        throw new Error('未找到标题输入框');
      }
      if (typeof titleInput.focus === 'function') {
        titleInput.focus();
      }
      await delay(200);

      const applyTitle = (value) => {
        const previousValue = titleInput.value;
        try {
          const proto = titleInput.tagName.toLowerCase() === 'textarea'
            ? window.HTMLTextAreaElement?.prototype
            : window.HTMLInputElement?.prototype;
          const valueSetter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (valueSetter) {
            valueSetter.call(titleInput, value);
          } else {
            titleInput.value = value;
          }
        } catch (_) {
          titleInput.value = value;
        }

        if (titleInput._valueTracker) {
          titleInput._valueTracker.setValue(previousValue);
        }

        try {
          titleInput.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: value
          }));
        } catch (_) {}
        titleInput.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: value
        }));
        titleInput.dispatchEvent(new Event('change', { bubbles: true }));
        titleInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      };

      if (typeof setNativeValue === 'function') {
        setNativeValue(titleInput, targetTitle);
      }
      applyTitle(targetTitle);
      await delay(800);

      let currentValue = (titleInput.value || titleInput.textContent || '').trim();
      let titleHint = findVisibleHintText([/标题不能为空/, /还需输入\s*\d+\s*个字/]);

      if (!currentValue || titleHint) {
        applyTitle(targetTitle);
        await delay(1000);
        currentValue = (titleInput.value || titleInput.textContent || '').trim();
        titleHint = findVisibleHintText([/标题不能为空/, /还需输入\s*\d+\s*个字/]);
      }

      if (!currentValue) {
        throw new Error('标题设置失败: 输入框仍为空');
      }
      if (titleHint) {
        console.warn(`${LOG_PREFIX} ⚠️ 标题存在校验提示（继续尝试发布）:`, titleHint);
      }

      console.log(`${LOG_PREFIX} ✅ 标题设置成功`);
      pushStage('fill-title:done', {
        finalValue: currentValue,
        titleHint: titleHint || ''
      });
    }, 5, 1000);
  };

  const fillContent = async (htmlContent, introText) => {
    const plain = parsePlainTextFromHtml(htmlContent) || parsePlainTextFromHtml(introText);
    if (!plain) {
      console.log(`${LOG_PREFIX} ℹ️ 内容为空，跳过正文填写`);
      pushStage('fill-content:skip-empty');
      return;
    }
    pushStage('fill-content:start', { length: plain.length });
    await retryOperation(async () => {
      const editor = findVisibleEditable();
      if (!editor) {
        throw new Error('未找到正文编辑器');
      }

      // 聚焦编辑器
      editor.focus();
      await delay(200);

      // 优先用 DOM 写入（与单次发布脚本一致），失败再回退粘贴
      try {
        // 清空现有内容
        try {
          editor.innerHTML = '';
        } catch (_) {
          try {
            document.execCommand('selectAll');
            document.execCommand('delete');
          } catch (_) {}
        }
        await delay(200);

        const lines = plain.split('\n').map(s => s.trim()).filter(Boolean);
        if (lines.length === 0) {
          lines.push(plain.trim());
        }

        for (const line of lines) {
          const p = document.createElement('p');
          p.textContent = line;
          editor.appendChild(p);
        }

        try {
          editor.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: plain
          }));
        } catch (_) {}
        editor.dispatchEvent(new Event('change', { bubbles: true }));

        await delay(800);

        let currentText = (editor.innerText || editor.textContent || '').trim();
        if (!currentText) {
          console.warn(`${LOG_PREFIX} ⚠️ DOM 写入后内容为空，尝试粘贴回退`);

          const clipboardData = new DataTransfer();
          clipboardData.setData('text/plain', plain);
          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: false,
            clipboardData: clipboardData
          });
          const pasteResult = editor.dispatchEvent(pasteEvent);
          console.log(`${LOG_PREFIX} 📋 粘贴回退已触发，propagate=${pasteResult}`);
          await delay(800);

          currentText = (editor.innerText || editor.textContent || '').trim();
        }

        if (!currentText) {
          throw new Error('正文填写后仍为空');
        }

        console.log(`${LOG_PREFIX} ✅ 正文填充完成，文本长度: ${currentText.length} 字`);
        pushStage('fill-content:done', { finalLength: currentText.length });

        // 最后等待页面完成所有处理（字数统计、数据绑定等）
        await delay(1200);
      } catch (err) {
        console.error(`${LOG_PREFIX} ❌ 正文填充失败:`, err.message);
        throw err;
      }
    }, 3, 2500);
  };

  const tryUploadCover = async (coverUrl, title) => {
    try {
      pushStage('cover:start', { hasCoverUrl: !!coverUrl });
      console.log(`${LOG_PREFIX} 🖼️ 准备上传封面:`, coverUrl || '[使用兜底封面]');
      const getVisibleButtons = () => Array.from(document.querySelectorAll('button')).filter(btn => isVisibleElement(btn));
      const findVisibleButtonByTexts = (texts) => {
        const targets = Array.isArray(texts) ? texts : [texts];
        return getVisibleButtons().find(btn => {
          const text = (btn.textContent || '').trim();
          return targets.includes(text);
        }) || null;
      };
      const isCoverModalOpen = () => {
        const modalRoots = Array.from(document.querySelectorAll(
          '.byte-modal-wrapper, .byte-modal, .semi-modal, .arco-modal, [class*="upload-cover"], [class*="cover-panel"]'
        )).filter(el => isVisibleElement(el));
        if (modalRoots.length > 0) return true;
        const strongHints = ['上传图片', '免费正版图片', '我的素材', '本地上传', '扫码上传'];
        const hintNode = Array.from(document.querySelectorAll('div,span,p')).find(el => {
          if (!isVisibleElement(el)) return false;
          const t = (el.textContent || '').trim();
          return strongHints.some(h => t.includes(h));
        });
        return !!hintNode;
      };
      const waitCoverReady = async (timeoutMs = 15000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const hasCoverPreview = !!document.querySelector(
            '.article-cover-images img, .article-cover img, [class*="cover"] img, .article-cover-images [class*="uploaded"], .article-cover-images [class*="image"]'
          ) || !!Array.from(document.querySelectorAll('.article-cover-images button, .article-cover button, .article-cover-images div'))
            .find(el => isVisibleElement(el) && /编辑|替换|预览/.test((el.textContent || '').trim()));
          if (hasCoverPreview) return true;
          await delay(500);
        }
        return false;
      };

      const coverBlock = document.querySelector('.article-cover, .pgc-edit-cell .edit-label');
      if (coverBlock && typeof coverBlock.scrollIntoView === 'function') {
        coverBlock.scrollIntoView({ behavior: 'auto', block: 'center' });
        await delay(300);
      }

      const directCoverTrigger = Array.from(document.querySelectorAll('.article-cover-add, [class*="cover-add"]'))
        .find(el => isVisibleElement(el));
      if (directCoverTrigger) {
        directCoverTrigger.click();
      } else {
        const triggerCandidates = Array.from(document.querySelectorAll('button, div, span')).filter(el => {
          if (!isVisibleElement(el)) return false;
          const text = (el.textContent || '').trim();
          if (!text) return false;
          return text.includes('封面') || text.includes('上传图片');
        });
        if (triggerCandidates[0]) {
          triggerCandidates[0].click();
        }
      }

      await delay(1000);

      let fileInput = Array.from(document.querySelectorAll('input[type="file"]')).find(input => {
        const accept = (input.getAttribute('accept') || '').toLowerCase();
        const className = (input.className || '').toString().toLowerCase();
        return accept.includes('image') || accept.includes('png') || accept.includes('jpg') || className.includes('upload') || className.includes('cover');
      });
      if (!fileInput) {
        fileInput = document.querySelector('input[type="file"]');
      }
      if (!fileInput) {
        console.log(`${LOG_PREFIX} ⚠️ 未找到封面上传 input，跳过封面上传`);
        pushStage('cover:no-file-input');
        return;
      }

      const file = coverUrl
        ? await ensureFileFromUrl(coverUrl, (title || 'toutiao-cover').slice(0, 20))
        : await createFallbackCoverFile(title);
      if (!file) {
        console.log(`${LOG_PREFIX} ⚠️ 封面文件为空，跳过`);
        pushStage('cover:no-file');
        return;
      }

      if (typeof uploadFileToInput === 'function') {
        await uploadFileToInput(fileInput, file);
      } else {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      }

      await delay(900);

      // 重点修复：轮询确认封面弹层，优先点“确定”，保证不会卡在上传面板
      const modalStart = Date.now();
      let modalClosed = !isCoverModalOpen();
      while (!modalClosed && Date.now() - modalStart < 15000) {
        const confirmBtn = findVisibleButtonByTexts(['确定', '完成', '使用']);
        if (confirmBtn && !confirmBtn.disabled) {
          confirmBtn.click();
          console.log(`${LOG_PREFIX} 🔘 已点击封面弹层确认按钮:`, (confirmBtn.textContent || '').trim());
          await delay(900);
        } else {
          await delay(400);
        }
        modalClosed = !isCoverModalOpen();
      }

      // 兜底：如果还没关，尝试关闭按钮或 ESC，防止阻塞后续发布
      if (!modalClosed) {
        const closeBtn = getVisibleButtons().find(btn => {
          const t = (btn.textContent || '').trim();
          const cls = (btn.className || '').toString().toLowerCase();
          return t === '关闭' || t === '取消' || cls.includes('close');
        });
        if (closeBtn) {
          closeBtn.click();
          await delay(500);
        } else {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await delay(500);
        }
      }

      const hasCoverPreview = await waitCoverReady(12000);
      const coverHint = findVisibleHintText([/封面.*不能为空/, /上传失败/, /格式不支持/]);
      if (!hasCoverPreview && coverHint) {
        console.warn(`${LOG_PREFIX} ⚠️ 封面上传后校验提示:`, coverHint, 'modalClosed=', modalClosed);
        pushStage('cover:hint', { coverHint, modalClosed });
      } else if (!hasCoverPreview) {
        console.warn(`${LOG_PREFIX} ⚠️ 封面上传后未检测到预览，可能仍需人工确认裁剪`);
        pushStage('cover:no-preview', { modalClosed });
      } else {
        console.log(`${LOG_PREFIX} ✅ 封面上传已触发`);
        pushStage('cover:done', { modalClosed });
      }
    } catch (e) {
      console.warn(`${LOG_PREFIX} ⚠️ 封面上传失败（不阻断发布）:`, e.message || e);
      pushStage('cover:error', { message: e.message || String(e) });
    }
  };

  const trySetSchedule = async (sendSet, sendTime) => {
    if (+sendSet !== 2 || !sendTime) return;
    try {
      console.log(`${LOG_PREFIX} ⏰ 尝试设置定时发布:`, sendTime);
      const scheduleToggle = Array.from(document.querySelectorAll('label, span, button, div')).find(el => {
        const text = (el.textContent || '').trim();
        return text.includes('定时发布');
      });
      if (scheduleToggle) {
        scheduleToggle.click();
        await delay(500);
      }

      const timeInput = Array.from(document.querySelectorAll('input')).find(el => {
        const ph = (el.placeholder || '') + (el.getAttribute('aria-label') || '');
        return ph.includes('时间') || ph.includes('日期') || ph.includes('发布时间');
      });
      if (!timeInput) {
        console.warn(`${LOG_PREFIX} ⚠️ 未找到定时输入框，保持平台默认发布时间`);
        return;
      }
      setNativeValue(timeInput, sendTime);
      timeInput.dispatchEvent(new Event('input', { bubbles: true }));
      timeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await delay(300);
      console.log(`${LOG_PREFIX} ✅ 已写入定时时间`);
    } catch (e) {
      console.warn(`${LOG_PREFIX} ⚠️ 定时发布设置失败，保持平台默认策略:`, e.message || e);
    }
  };

  const waitForPublishResult = async (publishId, originalUrl, options = {}) => {
    pushStage('publish-result:wait-start', { originalUrl });
    const start = Date.now();
    const timeout = 45000;
    const allowAutoConfirm = options.allowAutoConfirm !== false;
    let autoConfirmClicked = false;
    let autoConfirmDetectedAt = 0;
    let lastToast = '';

    while (Date.now() - start < timeout) {
      await delay(1500);

      if (window.location.href !== originalUrl) {
        console.log(`${LOG_PREFIX} ✅ 页面已跳转，视为提交成功`);
        pushStage('publish-result:url-changed', { currentUrl: window.location.href });
        return { success: true, reason: 'url-changed', message: '' };
      }

      if (window.location.href.includes('/profile_v4/graphic/manage')) {
        console.log(`${LOG_PREFIX} ✅ 跳转到管理页，视为成功`);
        pushStage('publish-result:manage-page');
        return { success: true, reason: 'manage-page', message: '' };
      }

      if (window.location.href.includes('/profile_v4/graphic/articles')) {
        console.log(`${LOG_PREFIX} ✅ 跳转到文章列表页，视为成功`);
        pushStage('publish-result:articles-page');
        return { success: true, reason: 'articles-page', message: '' };
      }

      const explicitError = getLatestError();
      if (explicitError) {
        return { success: false, reason: 'error-listener', message: explicitError };
      }

      if (latestPublishApiFailure) {
        const failTs = latestPublishApiFailure.ts || 0;
        const hasLaterSuccess = latestPublishApiSuccessAt > failTs;
        const elapsedSinceFail = Date.now() - failTs;
        // 平台可能存在中间保存失败（非最终发布），给 5s 观察窗口，避免误判
        if (hasLaterSuccess) {
          latestPublishApiFailure = null;
        } else if (elapsedSinceFail > 5000) {
          void dumpDebugToFile('publish-api-failed-final', {
            failTs,
            elapsedSinceFail
          });
          const failText = latestPublishApiFailure.failText || createApiFailText(latestPublishApiFailure);
          return {
            success: false,
            reason: 'publish-api-failed',
            message: failText
          };
        }
      }

      const toastText = readLatestToast();
      if (toastText) {
        lastToast = toastText;
        const isSuccess = SUCCESS_TOAST_KEYWORDS.some(k => toastText.includes(k));
        if (isSuccess) {
          console.log(`${LOG_PREFIX} ✅ 检测到成功提示:`, toastText);
          pushStage('publish-result:toast-success', { toastText });
          return { success: true, reason: 'toast-success', message: toastText };
        }
        const isFailed = FAIL_TOAST_KEYWORDS.some(k => toastText.includes(k));
        if (isFailed) {
          pushStage('publish-result:toast-failed', { toastText });
          return { success: false, reason: 'toast-failed', message: toastText };
        }
      }

      const currentKeyData = localStorage.getItem(getPublishSuccessKey());
      if (!currentKeyData) {
        console.log(`${LOG_PREFIX} ✅ 发布标记已被消费，视为成功`);
        pushStage('publish-result:success-key-consumed');
        return { success: true, reason: 'success-key-consumed', message: '' };
      }

      // 某些场景会先弹预览确认框，这里仅做一次兜底点击，避免重复提交
      if (allowAutoConfirm && !autoConfirmClicked) {
        const confirmBtn = findSecondaryConfirmButton();
        if (confirmBtn) {
          const t = (confirmBtn.textContent || '').trim();
          const canClick = isButtonInteractive(confirmBtn);
          const loading = hasVisiblePreviewLoading();
          if (!canClick || loading) {
            if (Date.now() - autoConfirmDetectedAt > 2500) {
              autoConfirmDetectedAt = Date.now();
              console.log(`${LOG_PREFIX} ⏳ 检测到二次确认按钮但尚未就绪:`, { text: t, canClick, loading });
            }
          } else {
            console.log(`${LOG_PREFIX} 🔄 结果等待阶段兜底点击二次确认:`, t);
            const secondClick = await clickElement(confirmBtn);
            if (secondClick.success) {
              submitAttempted = true;
              submitAttemptedAt = Date.now();
              pushStage('publish-result:auto-confirm-clicked', { text: t });
              autoConfirmClicked = true;
              await delay(900);
            }
          }
        }
      }
    }

    pushStage('publish-result:timeout', getQuickPageSnapshot());
    return { success: false, reason: 'timeout', message: lastToast || '发布超时，未检测到成功状态' };
  };

  const publishApi = async (dataObj) => {
    if (publishRunning) {
      console.log(`${LOG_PREFIX} ⚠️ 发布流程正在进行，跳过重复调用`);
      return;
    }
    publishRunning = true;

    const publishId = dataObj?.video?.dyPlatform?.id;
    const originalUrl = window.location.href;

    try {
      startErrorListener();
      pushStage('publish:start');
      latestPublishApiFailure = null;
      latestPreSubmitPublishFailure = null;
      latestApiDiag = null;
      latestPublishApiSuccessAt = 0;
      submitAttempted = false;
      submitAttemptedAt = 0;

      const publishBtn = await retryOperation(async () => {
        // 收口可能挡住 footer 的弹层，避免发布按钮被遮挡
        const visibleButtons = Array.from(document.querySelectorAll('button')).filter(btn => {
          const rect = btn.getBoundingClientRect();
          return rect.width > 10 && rect.height > 10;
        });
        const closeLike = visibleButtons.find(btn => {
          const text = (btn.textContent || '').trim();
          return text === '关闭' || text === '取消';
        });
        if (closeLike) {
          closeLike.click();
          await delay(250);
        }

        try {
          window.scrollTo(0, document.body.scrollHeight);
        } catch (_) {}
        await delay(200);

        const btn = findPublishButton();
        if (!btn) throw new Error('未找到发布按钮');
        if (btn.disabled || btn.getAttribute('disabled') !== null || btn.classList.contains('disabled')) {
          throw new Error('发布按钮不可用(disabled)');
        }
        return btn;
      }, 12, 1200);
      pushStage('publish:button-ready', { text: (publishBtn.textContent || '').trim() });

      if (publishId) {
        try {
          localStorage.setItem(getPublishSuccessKey(), JSON.stringify({ publishId }));
          if (window.browserAPI?.setGlobalData && currentWindowId) {
            await window.browserAPI.setGlobalData(`PUBLISH_SUCCESS_DATA_${currentWindowId}`, { publishId });
          }
          console.log(`${LOG_PREFIX} 💾 发布前已保存 publishId:`, publishId);
        } catch (e) {
          console.error(`${LOG_PREFIX} ❌ 保存 publishId 失败:`, e);
        }
      }

      const clickResult = await clickElement(publishBtn);
      if (!clickResult.success) {
        throw new Error(clickResult.message || '点击发布按钮失败');
      }
      console.log(`${LOG_PREFIX} ✅ 已点击发布按钮`);
      pushStage('publish:button-clicked', { text: (publishBtn.textContent || '').trim() });

      // 实测头条为“预览并发布”两步流：预览层稳定后再点确认，避免 7050 保存失败
      let secondConfirmed = false;
      const previewReady = await waitPreviewConfirmReady(15000);
      pushStage('publish:preview-ready', {
        ready: previewReady.ready,
        hasConfirmBtn: !!previewReady.confirmBtn,
        confirmText: (previewReady.confirmBtn?.textContent || '').trim()
      });
      if (previewReady.confirmBtn && isButtonInteractive(previewReady.confirmBtn)) {
        const confirmText = (previewReady.confirmBtn.textContent || '').trim();
        if (!previewReady.ready) {
          console.log(`${LOG_PREFIX} ⚠️ 预览层未完全稳定，谨慎尝试点击确认:`, confirmText);
          await delay(1200);
        } else {
          console.log(`${LOG_PREFIX} ✅ 预览层已稳定，准备点击确认发布`);
        }
        const confirmClick = await clickElement(previewReady.confirmBtn);
        if (!confirmClick.success) {
          throw new Error(confirmClick.message || '二次确认发布点击失败');
        }
        submitAttempted = true;
        submitAttemptedAt = Date.now();
        console.log(`${LOG_PREFIX} ✅ 已点击二次确认按钮`);
        pushStage('publish:secondary-confirm-clicked', { text: confirmText });
        secondConfirmed = true;
      }
      if (!secondConfirmed) {
        console.log(`${LOG_PREFIX} ℹ️ 未检测到可点击二次确认，进入结果等待阶段继续观察`);
        pushStage('publish:no-secondary-confirm', getQuickPageSnapshot());
      }

      const result = await waitForPublishResult(publishId, originalUrl, {
        allowAutoConfirm: !secondConfirmed
      });
      if (!result.success) {
        pushStage('publish:result-failed', result);
        throw new Error(result.message || '发布失败');
      }
      pushStage('publish:result-success', result);

      hasProcessed = true;
      isProcessing = false;

      const urlChanged = window.location.href !== originalUrl;
      if (publishId && !urlChanged && typeof sendStatistics === 'function') {
        await sendStatistics(publishId, '头条发布');
      }

      if (!urlChanged) {
        await closeWindowWithMessage('发布成功，刷新数据', 1000);
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} ❌ 发布失败:`, error);
      pushStage('publish:error', {
        message: error?.message || String(error),
        snapshot: getQuickPageSnapshot()
      });
      void dumpDebugToFile('publish-catch-error', {
        errorMessage: error?.message || String(error),
        latestDumpFilePath
      });
      if (publishId && typeof sendStatisticsError === 'function') {
        await sendStatisticsError(publishId, error.message || '发布失败', '头条发布', error);
      }
      const detail = (error?.message || '发布失败').slice(0, 120);
      const dumpHint = latestDumpFilePath ? ` | 调试文件: ${latestDumpFilePath}` : '';
      await closeWindowWithMessage(`发布失败: ${detail}${dumpHint}`.slice(0, 500), 1000);
    } finally {
      stopErrorListener();
      publishRunning = false;
    }
  };

  async function fillFormData(dataObj) {
    if (fillFormRunning) {
      console.log(`${LOG_PREFIX} ⚠️ fillFormData 正在执行，跳过重复调用`);
      return;
    }
    fillFormRunning = true;
    try {
      pushStage('fill-form:start');
      const rawTitle = dataObj?.video?.video?.title || dataObj?.element?.title || '';
      const intro = dataObj?.video?.video?.intro || dataObj?.element?.intro || '';
      const rawContent = dataObj?.video?.video?.content || dataObj?.element?.content || intro || '';

      if (!String(rawTitle || '').trim()) {
        throw new Error('缺少标题');
      }
      if (!String(rawContent || '').trim()) {
        throw new Error('缺少正文');
      }

      const title = normalizeTitleForPublish(rawTitle);
      const content = normalizeContentForPublish(rawContent, intro, title);
      const cover = dataObj?.video?.video?.cover || dataObj?.element?.image || '';
      const sendSet = dataObj?.video?.formData?.send_set ?? dataObj?.element?.formData?.send_set ?? 1;
      const sendTime = dataObj?.video?.formData?.send_time || dataObj?.video?.dyPlatform?.send_time || dataObj?.element?.formData?.send_time || '';

      await delay(1500);
      await fillTitle(title);
      await fillContent(content, intro);
      await tryUploadCover(cover, title);
      await trySetSchedule(sendSet, sendTime);
      // 给平台自动存草稿留出稳定窗口，避免立即提交触发 7050
      await delay(1200);
      pushStage('fill-form:before-publish');
      await publishApi(dataObj);
    } catch (e) {
      console.error(`${LOG_PREFIX} ❌ 填写表单失败:`, e);
      pushStage('fill-form:error', {
        message: e?.message || String(e),
        snapshot: getQuickPageSnapshot()
      });
      const publishId = dataObj?.video?.dyPlatform?.id;
      if (publishId && typeof sendStatisticsError === 'function') {
        await sendStatisticsError(publishId, e.message || '填写表单失败', '头条发布', e);
      }
      await closeWindowWithMessage('填写表单失败，刷新数据', 1000);
    } finally {
      fillFormRunning = false;
    }
  }

  // ═══ 7. 检查是否是恢复 cookies 后的刷新 ═══
  await (async () => {
    if (isProcessing || hasProcessed) return;
    try {
      const publishData = await loadPublishDataFromGlobalStorage(LOG_PREFIX);
      if (!publishData) return;
      if (receivedMessageData) {
        console.log(`${LOG_PREFIX} ℹ️ 已有消息数据，跳过全局存储恢复数据`);
        return;
      }
      if (hasProcessed) {
        console.log(`${LOG_PREFIX} ℹ️ 已处理完成，跳过全局存储恢复数据`);
        return;
      }
      isProcessing = true;
      await fillFormData(publishData);
      isProcessing = false;
    } catch (error) {
      console.error(`${LOG_PREFIX} ❌ 从全局存储读取数据失败:`, error);
      isProcessing = false;
    }
  })();
})();
