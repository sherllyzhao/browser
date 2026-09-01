/**
 * 头条创作者平台发布脚本
 * 用于处理发布流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
  'use strict';

  if (window.__TOUTIAO_PUBLISH_SCRIPT_LOADED__) {
    console.log('[头条发布] ⚠️ 脚本已经加载过，跳过重复注入');
    return;
  }

  // 头条发布页是富文本编辑器，跳过异常渲染检测，避免误报
  window.__TOUTIAO_PUBLISH_SCRIPT_LOADED__ = true;

  // ===========================
  // 🔑 头条白屏检测和自动恢复（使用公共函数）
  // ===========================
  if (typeof window.checkBlankPageAndReload === 'function') {
    window.checkBlankPageAndReload('头条发布', [
      '.byte-editor',
      '.ProseMirror',
      '.publish-button'
    ], 3000, 3);
  }

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
  let latestDraftSaveSuccessAt = 0;
  let latestDraftSavePgcId = '0';

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

  const parsePlainTextFromHtml = (html) => {
    if (!html) return '';
    if (typeof html !== 'string') return String(html);
    if (!/[<>]/.test(html)) return html.trim();
    const temp = document.createElement('div');
    temp.innerHTML = html;
    // 🔢 innerText 不含有序列表序号标记（marker 是伪元素），这里给 li 注入全局连续序号文本前缀，
    //    避免被段落打断的多个 <ol> 拍平成纯文本后丢失序号
    let olCounter = 1;
    temp.querySelectorAll('ol').forEach((ol) => {
      if (ol.closest('li')) return; // 跳过嵌套子列表
      ol.querySelectorAll(':scope > li').forEach((li) => {
        li.insertBefore(document.createTextNode(olCounter + '. '), li.firstChild);
        olCounter++;
      });
    });
    return (temp.innerText || temp.textContent || '').trim();
  };

  const ensureFileFromUrl = async (url, fileNamePrefix = 'toutiao-cover') => {
    if (!url) return null;
    let blob;
    let contentType = 'image/jpeg';

    // 【FIX_TOUTIAO_UNIFY_INJECTION】封面下载重试（对齐 bare 时代的 FIX_TOUTIAO_COVER_RETRY 与
    // common.js downloadFile 的 5 次/3 秒）。旧实现单次下载，瞬态网络抖动/CDN 超时直接判失败，
    // 用户重发即成功 —— 头条独有这个毛病就是因为它没走 common.js 的下载重试
    const maxAttempts = window.isFeatureEnabled?.('FIX_TOUTIAO_UNIFY_INJECTION') ? 5 : 1;
    const fetchOnce = async () => {
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
        return {
          blob: new Blob([bytes], { type: result.contentType || 'image/jpeg' }),
          contentType: result.contentType || 'image/jpeg'
        };
      }
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`封面下载失败: HTTP ${response.status}`);
      }
      const fetched = await response.blob();
      return {
        blob: fetched,
        contentType: response.headers.get('Content-Type') || fetched.type || 'image/jpeg'
      };
    };

    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const got = await fetchOnce();
        blob = got.blob;
        contentType = got.contentType;
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        console.warn(`${LOG_PREFIX} ⚠️ 封面下载第 ${attempt}/${maxAttempts} 次失败:`, e.message || e);
        if (attempt < maxAttempts) await delay(3000);
      }
    }
    if (lastError) throw lastError;

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
    const safeTitle = (title || '测试文章').slice(0, 16);
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
    const base = clean || '测试文章';
    return `${base} ${suffix}`.slice(0, 30);
  };

  const normalizeContentForPublish = (content, intro, title) => {
    const raw = parsePlainTextFromHtml(content) || parsePlainTextFromHtml(intro) || '';
    const trimmed = raw.trim();
    if (trimmed.length >= 20) return trimmed;
    const head = (title || '测试文章').trim() || '测试文章';
    return [
      `${head}`,
      '这是一篇测试内容，用于验证发布页流程。',
      `更新时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`
    ].join('\n');
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
    console.log(`${LOG_PREFIX} 📡 ${diag.kind}接口响应:`, {
      status: diag.status,
      code: codeText,
      message: diag.message,
      url: diag.url
    });
    if (diag.requestSummary) {
      console.log(`${LOG_PREFIX} 🧾 ${diag.kind}请求体摘要:`, diag.requestSummary);
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
          console.warn(`${LOG_PREFIX} ℹ️ 捕获到发布接口失败，但尚未点击确认发布，先记为预提交失败:`, failText);
        }
      }
      console.error(`${LOG_PREFIX} ❌ ${failText}`, {
        requestBodySnippet: diag.requestBodySnippet || '',
        responseSnippet: diag.responseSnippet || ''
      });
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
    }

    // 追踪草稿保存成功，提取 pgc_id
    if (diag.kind === 'draft' && diag.success) {
      latestDraftSaveSuccessAt = Date.now();
      try {
        const respObj = safeParseJsonText(diag.responseSnippet);
        const pgcId = respObj?.data?.pgc_id || respObj?.pgc_id || '';
        if (pgcId && String(pgcId) !== '0') {
          latestDraftSavePgcId = String(pgcId);
          console.log(`${LOG_PREFIX} ✅ 草稿保存成功，pgc_id:`, latestDraftSavePgcId);
        }
      } catch (_) {}
    }
  };

  const handleApiResponse = (url, status, requestBodySnippet, responseText) => {
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
      ts: Date.now()
    });
  };

  const waitForDraftSave = async (timeoutMs = 12000) => {
    const start = Date.now();
    console.log(`${LOG_PREFIX} ⏳ 等待平台自动保存草稿（超时 ${timeoutMs / 1000}s）...`);
    while (Date.now() - start < timeoutMs) {
      if (latestDraftSaveSuccessAt > 0 && latestDraftSavePgcId !== '0') {
        console.log(`${LOG_PREFIX} ✅ 草稿保存已确认，pgc_id: ${latestDraftSavePgcId}`);
        return true;
      }
      await delay(600);
    }
    console.warn(`${LOG_PREFIX} ⚠️ 等待草稿保存超时（${timeoutMs / 1000}s），pgc_id: ${latestDraftSavePgcId}`);
    return false;
  };

  const installApiDiagnostics = () => {
    if (window.__TOUTIAO_API_DIAG_HOOKED__) return;
    window.__TOUTIAO_API_DIAG_HOOKED__ = true;

    if (typeof window.fetch === 'function') {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const req = args[0];
        const init = args[1] || {};
        const url = typeof req === 'string' ? req : (req?.url || '');
        const fullUrl = normalizeUrl(url);
        const bodySnippet = bodyToSnippet(init?.body || req?.body);
        try {
          const res = await nativeFetch(...args);
          if (isTargetApiUrl(fullUrl)) {
            try {
              const text = await res.clone().text();
              handleApiResponse(fullUrl, res.status || 0, bodySnippet, text);
            } catch (e) {
              console.warn(`${LOG_PREFIX} ⚠️ fetch响应读取失败:`, e.message || e);
            }
          }
          return res;
        } catch (e) {
          if (isTargetApiUrl(fullUrl)) {
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
    }

    if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
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
            let responseText = '';
            try {
              responseText = typeof this.responseText === 'string' ? this.responseText : '';
            } catch (_) {}
            handleApiResponse(targetUrl, this.status || 0, this.__ttDiagBodySnippet || '', responseText);
          }, { once: true });
        } catch (_) {}
        return nativeSend.call(this, body);
      };
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
          latestApiDiag,
          latestPublishApiFailure,
          latestPreSubmitPublishFailure,
          latestPublishApiSuccessAt,
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

  const fillTitle = async (title) => {
    const targetTitle = (title || '').trim();
    if (!targetTitle) return;
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
    }, 5, 1000);
  };

  // 🔗 从 HTML 中提取链接映射和列表信息
  const extractLinksAndListsFromHtml = (htmlContent) => {
    if (!htmlContent || !/[<>]/.test(htmlContent)) {
      return { links: [], listItems: [], hasLists: false };
    }

    const div = document.createElement('div');
    div.innerHTML = htmlContent;

    // 提取所有链接：{ text: "链接文本", url: "https://..." }
    const links = [];
    div.querySelectorAll('a[href]').forEach((a) => {
      const text = (a.textContent || '').trim();
      const url = (a.getAttribute('href') || '').trim();
      if (text && url) {
        links.push({ text, url });
      }
    });

    // 提取所有列表项及其类型
    const listItems = [];
    let listIndex = 0;
    div.querySelectorAll('ul, ol').forEach((list) => {
      const isOrdered = list.tagName.toLowerCase() === 'ol';
      let itemIndex = 1;
      list.querySelectorAll(':scope > li').forEach((li) => {
        const text = (li.textContent || '').trim();
        if (text) {
          listItems.push({
            text,
            type: isOrdered ? 'ordered' : 'bullet',
            number: isOrdered ? itemIndex : null,
            listIndex
          });
          itemIndex++;
        }
      });
      listIndex++;
    });

    return {
      links,
      listItems,
      hasLists: listItems.length > 0
    };
  };

  // 🔗 在 ProseMirror 文档中定位文本的 from/to 位置（块之间补 \n 分隔，避免跨段误匹配）
  const findTextRangeInPmDoc = (doc, targetText) => {
    let fullText = '';
    const segments = [];
    doc.descendants((node, pos) => {
      if (node.isText) {
        segments.push({ start: fullText.length, end: fullText.length + node.text.length, pos });
        fullText += node.text;
      } else if (node.isBlock && fullText.length > 0 && !fullText.endsWith('\n')) {
        fullText += '\n';
      }
      return true;
    });
    const idx = fullText.indexOf(targetText);
    if (idx === -1) return null;
    const endIdx = idx + targetText.length;
    const startSeg = segments.find(s => s.start <= idx && idx < s.end);
    const endSeg = segments.find(s => s.start < endIdx && endIdx <= s.end);
    if (!startSeg || !endSeg) return null;
    return {
      from: startSeg.pos + (idx - startSeg.start),
      to: endSeg.pos + (endIdx - endSeg.start)
    };
  };

  // 🔗 在 schema 中查找链接类 mark（不同编辑器可能命名为 link/hyperlink/anchor/a）
  const findLinkMarkType = (schema) => {
    if (!schema?.marks) return null;
    if (schema.marks.link) return schema.marks.link;
    const name = Object.keys(schema.marks).find(n => /link|anchor|hyper/i.test(n));
    if (name) return schema.marks[name];
    return schema.marks.a || null;
  };

  // 🔗 直接操作 ProseMirror state 给文本加 link mark（绕过工具栏 UI 与粘贴过滤）
  const addLinksViaPmMarks = (view, links) => {
    const result = { supported: false, applied: 0, marks: null, attrKeys: null, failures: [] };
    try {
      const schema = view.state.schema;
      result.marks = Object.keys(schema.marks || {});
      const linkType = findLinkMarkType(schema);
      if (!linkType) {
        console.warn(`${LOG_PREFIX} [PM链接] schema 无链接类 mark，可用 marks: ${result.marks.join(', ')}`);
        return result;
      }
      result.supported = true;
      result.attrKeys = Object.keys(linkType.spec?.attrs || {});
      console.log(`${LOG_PREFIX} [PM链接] 使用 mark "${linkType.name}" (attrs: ${result.attrKeys.join(',')})，schema marks: ${result.marks.join(', ')}`);
      for (const link of links) {
        try {
          const range = findTextRangeInPmDoc(view.state.doc, link.text);
          if (!range) {
            result.failures.push({ text: link.text, reason: 'doc中未找到文本' });
            console.warn(`${LOG_PREFIX} [PM链接] ⚠️ doc 中未找到文本: "${link.text}"`);
            continue;
          }
          // 根据 mark 实际定义的 attr 名装配属性（href / url 等命名差异）
          const attrs = {};
          if (result.attrKeys.includes('href')) attrs.href = link.url;
          else if (result.attrKeys.includes('url')) attrs.url = link.url;
          else if (result.attrKeys.length > 0) attrs[result.attrKeys[0]] = link.url;
          else attrs.href = link.url;
          if (result.attrKeys.includes('title')) attrs.title = link.text;
          view.dispatch(view.state.tr.addMark(range.from, range.to, linkType.create(attrs)));
          result.applied++;
          console.log(`${LOG_PREFIX} [PM链接] ✅ 已加链接: "${link.text}" → ${link.url}`);
        } catch (e) {
          result.failures.push({ text: link.text, reason: e.message });
          console.warn(`${LOG_PREFIX} [PM链接] ⚠️ 加链接失败 "${link.text}":`, e.message);
        }
      }
    } catch (e) {
      result.failures.push({ text: '(整体)', reason: e.message });
      console.warn(`${LOG_PREFIX} [PM链接] ⚠️ 整体异常:`, e.message);
    }
    return result;
  };

  // 🔍 收集可见按钮清单（诊断用：链接添加失败时写入调试文件，定位工具栏真实结构）
  const collectToolbarInfo = () => {
    try {
      return Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter(el => isVisibleElement(el))
        .slice(0, 60)
        .map(el => ({
          tag: el.tagName,
          title: el.title || '',
          aria: el.getAttribute('aria-label') || '',
          cls: (el.className || '').toString().slice(0, 60),
          text: (el.textContent || '').trim().slice(0, 20),
          svg: (() => {
            const svg = el.querySelector('svg, use');
            if (!svg) return '';
            const cls = (svg.className?.baseVal || svg.className || '').toString();
            const href = svg.getAttribute?.('xlink:href') || svg.getAttribute?.('href') || '';
            return (cls + ' ' + href).trim().slice(0, 60);
          })()
        }));
    } catch (e) {
      return [{ error: e.message }];
    }
  };

  // 🖱️ 完整鼠标事件序列点击（ProseMirror 工具栏常监听 mousedown 而非 click，裸 .click() 无效）
  const simulateMouseClick = (el) => {
    try {
      const rect = el.getBoundingClientRect();
      const opts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0
      };
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      return true;
    } catch (e) {
      try { el.click(); return true; } catch (_) { return false; }
    }
  };

  // 🔗 在编辑器中精确定位并选中文本（兼容 ProseMirror）
  const selectTextInEditor = (editor, targetText) => {
    // 如果是 ProseMirror 编辑器，先尝试找 ProseMirror 数据
    const isProseMirror = editor.classList?.contains('ProseMirror');

    // 方案1: 直接查找所有文本内容
    const editorText = (editor.innerText || editor.textContent || '').trim();
    if (!editorText.includes(targetText)) {
      console.warn(`${LOG_PREFIX} ⚠️ 编辑器中不存在文本: "${targetText}"`);
      return false;
    }

    // 方案2: 使用 DOM Range API（对 ProseMirror 有更好兼容性）
    const walker = document.createTreeWalker(
      editor,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let textNode;
    let fullText = '';
    const nodePositions = [];

    // 先遍历所有文本节点，构建完整文本和位置映射
    while (textNode = walker.nextNode()) {
      const text = textNode.textContent || '';
      nodePositions.push({
        node: textNode,
        start: fullText.length,
        end: fullText.length + text.length,
        text: text
      });
      fullText += text;
    }

    const targetIndex = fullText.indexOf(targetText);
    if (targetIndex === -1) {
      console.warn(`${LOG_PREFIX} ⚠️ 未在编辑器文本中找到: "${targetText}"`);
      return false;
    }

    // 找到包含目标文本的文本节点
    const targetEnd = targetIndex + targetText.length;
    const startNodeInfo = nodePositions.find(
      pos => pos.start <= targetIndex && targetIndex < pos.end
    );
    const endNodeInfo = nodePositions.find(
      pos => pos.start < targetEnd && targetEnd <= pos.end
    );

    if (!startNodeInfo) {
      console.warn(`${LOG_PREFIX} ⚠️ 无法定位目标文本的起点`);
      return false;
    }

    try {
      const range = document.createRange();
      const startOffset = targetIndex - startNodeInfo.start;

      if (startNodeInfo === endNodeInfo) {
        // 文本在同一个节点内
        const endOffset = targetIndex + targetText.length - startNodeInfo.start;
        range.setStart(startNodeInfo.node, startOffset);
        range.setEnd(startNodeInfo.node, endOffset);
      } else if (endNodeInfo) {
        // 文本跨越多个节点
        const endOffset = targetEnd - endNodeInfo.start;
        range.setStart(startNodeInfo.node, startOffset);
        range.setEnd(endNodeInfo.node, endOffset);
      } else {
        // 结束节点未找到，按起始节点文本长度计算
        range.setStart(startNodeInfo.node, startOffset);
        range.setEnd(startNodeInfo.node, startNodeInfo.text.length);
      }

      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      console.log(`${LOG_PREFIX} ✅ 已选中文本: "${targetText}"`);
      return true;
    } catch (e) {
      console.warn(`${LOG_PREFIX} ⚠️ 选中文本失败:`, e.message);
      return false;
    }
  };

  // 🔗 模拟点击链接工具按钮并填入 URL
  const addLinkToSelection = async (url) => {
    try {
      // 方法1: 查找链接按钮（优先查找有 title="链接" 或 aria-label 的按钮）
      const findLinkButton = () => {
        // 精准查找：具有 title 或 aria-label 含有 "链接" 的按钮
        let linkBtn = Array.from(document.querySelectorAll('button, [role="button"]')).find(el => {
          const title = (el.title || '').toLowerCase();
          const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
          const text = (el.textContent || '').trim().toLowerCase();
          return title.includes('链接') || ariaLabel.includes('link') || text.includes('链接');
        });

        if (linkBtn) return linkBtn;

        // 次要查找：具有链接图标的按钮
        linkBtn = Array.from(document.querySelectorAll('button, [role="button"]')).find(el => {
          const svg = el.querySelector('svg');
          if (!svg) return false;
          const svgClass = (svg.className?.baseVal || svg.className || '').toLowerCase();
          return svgClass.includes('link') || svgClass.includes('url');
        });

        return linkBtn || null;
      };

      const linkButton = findLinkButton();
      if (!linkButton) {
        console.warn(`${LOG_PREFIX} ⚠️ 未找到链接工具按钮`);
        return false;
      }

      console.log(`${LOG_PREFIX} 🔗 找到链接按钮，准备点击`);
      simulateMouseClick(linkButton);
      await delay(600);

      // 方法2: 等待链接输入框出现（使用多种选择器兼容不同 UI）
      const findLinkInput = () => {
        // 先查找专门的链接输入框
        let input = document.querySelector(
          'input[placeholder*="链接"], input[placeholder*="URL"], input[placeholder*="url"], input[aria-label*="链接"]'
        );
        if (input) return input;

        // 查找最后出现的可见输入框（通常在弹窗中）
        const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="url"], input:not([type])'))
          .filter(inp => {
            const rect = inp.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0; // 可见
          });

        return inputs[inputs.length - 1] || null;
      };

      let linkInput = null;
      for (let i = 0; i < 15; i++) {
        linkInput = findLinkInput();
        if (linkInput && linkInput.offsetParent !== null) break;
        await delay(100);
      }

      if (!linkInput) {
        console.warn(`${LOG_PREFIX} ⚠️ 链接输入框未出现`);
        return false;
      }

      console.log(`${LOG_PREFIX} 📝 已找到链接输入框，填入 URL: ${url}`);

      // 清空现有内容
      linkInput.focus();
      linkInput.select();
      await delay(50);

      // 填入 URL
      linkInput.value = url;
      linkInput.dispatchEvent(new Event('input', { bubbles: true }));
      linkInput.dispatchEvent(new Event('change', { bubbles: true }));
      linkInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

      await delay(400);

      // 方法3: 查找确认按钮
      const findConfirmButton = () => {
        const buttons = Array.from(document.querySelectorAll('button')).filter(btn => {
          if (!isVisibleElement(btn)) return false;
          const text = (btn.textContent || '').trim().toLowerCase();
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          return text.includes('确定') || text.includes('确认') || text.includes('ok') ||
                 ariaLabel.includes('confirm') || ariaLabel.includes('ok') ||
                 text.includes('添加') || text === '确认';
        });
        return buttons[buttons.length - 1] || null; // 优先取最后一个（通常是确认按钮）
      };

      const confirmButton = findConfirmButton();
      if (confirmButton && isVisibleElement(confirmButton)) {
        console.log(`${LOG_PREFIX} ✅ 找到确认按钮，点击提交链接`);
        simulateMouseClick(confirmButton);
        await delay(500);
        return true;
      } else {
        // 如果没找到确认按钮，尝试 Enter 键提交
        console.log(`${LOG_PREFIX} ℹ️ 未找到确认按钮，尝试按 Enter 键提交`);
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        });
        linkInput.dispatchEvent(enterEvent);
        await delay(500);
        return true;
      }
    } catch (e) {
      console.warn(`${LOG_PREFIX} ⚠️ 添加链接失败:`, e.message);
      return false;
    }
  };

  // 🔗 逐个添加所有链接
  const addAllLinks = async (links, editor) => {
    if (!links || links.length === 0) {
      console.log(`${LOG_PREFIX} ℹ️ 没有链接需要添加`);
      return 0;
    }

    console.log(`${LOG_PREFIX} 🔗 开始添加 ${links.length} 个链接`);
    let successCount = 0;

    for (const link of links) {
      try {
        // 选中链接文本
        const selected = selectTextInEditor(editor, link.text);
        if (!selected) {
          console.warn(`${LOG_PREFIX} ⚠️ 未能选中链接文本 "${link.text}"，跳过`);
          continue;
        }

        await delay(200);

        // 添加链接
        const added = await addLinkToSelection(link.url);
        if (added) {
          successCount++;
          console.log(`${LOG_PREFIX} ✅ 已添加链接: "${link.text}" → ${link.url}`);
        } else {
          console.warn(`${LOG_PREFIX} ⚠️ 未能添加链接: "${link.text}"`);
        }

        await delay(300);
      } catch (e) {
        console.warn(`${LOG_PREFIX} ⚠️ 添加链接异常:`, e.message);
      }
    }

    console.log(`${LOG_PREFIX} ✅ 链接添加完成，成功 ${successCount}/${links.length}`);
    return successCount;
  };

  // 📋 处理列表格式
  const applyListFormatting = async (listItems, editor) => {
    if (!listItems || listItems.length === 0) {
      console.log(`${LOG_PREFIX} ℹ️ 没有列表需要处理`);
      return 0;
    }

    console.log(`${LOG_PREFIX} 📋 开始处理 ${listItems.length} 个列表项`);
    let successCount = 0;

    // 按 listIndex 分组处理
    const groupedByList = {};
    listItems.forEach(item => {
      if (!groupedByList[item.listIndex]) {
        groupedByList[item.listIndex] = [];
      }
      groupedByList[item.listIndex].push(item);
    });

    for (const [listIdx, items] of Object.entries(groupedByList)) {
      const listType = items[0].type; // 取第一项的类型作为整个列表的类型
      const buttonText = listType === 'ordered' ? '有序列表' : '无序列表';

      for (const item of items) {
        try {
          // 选中列表项文本
          const selected = selectTextInEditor(editor, item.text);
          if (!selected) {
            console.warn(`${LOG_PREFIX} ⚠️ 未能选中列表项文本 "${item.text}"，跳过`);
            continue;
          }

          await delay(200);

          // 查找并点击列表按钮
          // 先点击列表按钮的下拉菜单
          const listButtons = Array.from(document.querySelectorAll('button, div[role="button"]')).filter(el => {
            const title = (el.title || '').toLowerCase();
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            const svg = el.querySelector('svg');
            if (!svg) return false;
            const svgClass = (svg.className?.baseVal || '').toLowerCase();
            return title.includes('list') || ariaLabel.includes('list') || svgClass.includes('list');
          });

          if (listButtons.length === 0) {
            console.warn(`${LOG_PREFIX} ⚠️ 未找到列表按钮`);
            continue;
          }

          console.log(`${LOG_PREFIX} 📋 点击列表按钮: ${buttonText}`);
          simulateMouseClick(listButtons[0]);
          await delay(400);

          // 查找并点击列表类型选项
          const listOptions = Array.from(document.querySelectorAll('div, li, button, span')).filter(el => {
            const text = (el.textContent || '').trim();
            return text === buttonText || text === '无序列表' || text === '有序列表';
          });

          if (listOptions.length > 0) {
            const targetOption = listOptions.find(opt => (opt.textContent || '').trim() === buttonText) || listOptions[0];
            console.log(`${LOG_PREFIX} 📋 选择列表类型: ${buttonText}`);
            simulateMouseClick(targetOption);
            await delay(300);
            successCount++;
            console.log(`${LOG_PREFIX} ✅ 已应用列表格式: "${item.text}"`);
          } else {
            console.warn(`${LOG_PREFIX} ⚠️ 未找到列表类型选项`);
          }

          await delay(200);
        } catch (e) {
          console.warn(`${LOG_PREFIX} ⚠️ 处理列表项异常:`, e.message);
        }
      }
    }

    console.log(`${LOG_PREFIX} ✅ 列表处理完成，成功 ${successCount}/${listItems.length}`);
    return successCount;
  };

  // ===========================================================================
  // 🖼️ 【FIX_TOUTIAO_UNIFY_INJECTION】正文图片（自 main.js bare 脚本 8666-9036 移植）
  // normalizeContentForPublish 走 innerText 会把 <img> 整个丢掉，纯文本 p 节点也承载不了图片，
  // 所以正文改走「整段 HTML 粘贴 → 头条编辑器自行转存」，不达标回退逐图原生上传。
  // ⚠️ 判成功绝不能只数 img 数量：头条若没转存，外链 <img> 照样留在 DOM 里，
  //    数量达标但发布后图片挂掉（假 ✅）。必须校验 src 已落在头条自家图床域名。
  // ===========================================================================
  const TOUTIAO_IMAGE_HOST_RE = /(toutiaoimg|byteimg|pstatp|bytedance|ttcdn|toutiaostatic|toutiaocdn)/i;
  const isHostedImage = (src) => {
    const value = String(src || '').trim();
    if (!value) return false;
    if (/^(blob:|data:)/i.test(value)) return false;
    return TOUTIAO_IMAGE_HOST_RE.test(value);
  };
  const getEditorImages = (editorEl) => {
    if (!editorEl) return [];
    return Array.from(editorEl.querySelectorAll('img')).filter((img) => {
      // 编辑器容器内理论上不含封面，这里再兜一层，防止封面缩略图被计入正文图片数
      return !img.closest('.article-cover, .article-cover-images');
    });
  };
  const countHostedImages = (editorEl) => getEditorImages(editorEl)
    .filter((img) => isHostedImage(img.getAttribute('src') || img.src || '')).length;
  const extractImageSourcesFromHtml = (html) => {
    const list = [];
    if (!html || typeof html !== 'string' || !/[<>]/.test(html)) return list;
    try {
      const temp = document.createElement('div');
      temp.innerHTML = html;
      temp.querySelectorAll('img').forEach((img) => {
        const src = (img.getAttribute('src') || '').trim();
        if (src && !/^data:/i.test(src)) list.push(src);
      });
    } catch (_) {}
    return list;
  };
  // 清空编辑器：优先走编辑器命令层（selectAll+delete）。直接 innerHTML='' 会让 ProseMirror 的
  // 内部 model 与 DOM 脱节，之后 paste 链路必炸 RangeError（腾讯号踩过，见 tengxvnhao-publish.js:2292）
  const clearEditorContent = async (editorEl) => {
    try {
      editorEl.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editorEl);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('delete', false, null);
      await delay(300);
    } catch (_) {}
    const remainText = (editorEl.innerText || editorEl.textContent || '').trim();
    if (!remainText && getEditorImages(editorEl).length === 0) return true;
    // execCommand 清不掉（典型：正文里有图片这种 atom 节点）→ 走 PM 模型层删除。
    // 直接 innerHTML='' 会让 PM model 与 DOM 脱节，后续 paste 必炸 RangeError，只能当最后一招
    try {
      const view = getEditorPmView(editorEl);
      if (view && view.state && view.state.doc.content.size > 0) {
        view.dispatch(view.state.tr.delete(0, view.state.doc.content.size));
        await delay(300);
        const afterPm = (editorEl.innerText || editorEl.textContent || '').trim();
        if (!afterPm && getEditorImages(editorEl).length === 0) return true;
      }
    } catch (_) {}
    editorEl.innerHTML = '';
    editorEl.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, inputType: 'deleteContentBackward'
    }));
    await delay(400);
    return false;
  };
  // 🔎 图片链路专用的 ProseMirror EditorView 取用（fillContent 里那份 getPmView 在闭包内取不到）
  const getEditorPmView = (editorEl) => {
    try {
      const pmNode = (editorEl && editorEl.closest && editorEl.closest('.ProseMirror')) || editorEl;
      if (pmNode && pmNode.pmViewDesc && pmNode.pmViewDesc.view) return pmNode.pmViewDesc.view;
    } catch (_) {}
    try {
      let node = editorEl;
      while (node && node !== document.body) {
        if (node.pmViewDesc && node.pmViewDesc.view) return node.pmViewDesc.view;
        node = node.parentElement;
      }
    } catch (_) {}
    try {
      for (const pm of document.querySelectorAll('.ProseMirror')) {
        if (pm.pmViewDesc && pm.pmViewDesc.view) return pm.pmViewDesc.view;
      }
    } catch (_) {}
    return null;
  };
  // 🚨 把选区塌陷到文档末尾 —— 追加内容（正文段 / 插图）前必须做
  // 2026-09-01 实测现场（debug-dumps/toutiao-publish-*.json 草稿接口连拍）：
  //   35:24 content=<ol><li>77 字代码</li></ol>  → 正文写入成功
  //   35:28 content=<ol><li><br></li></ol> + <div class="pgc-img"><img 头条图床>  word_cnt=0
  // 头条插图走 PM 的 replaceSelection，选区此时还覆盖着正文（clearEditorContent 的
  // selectNodeContents 残留 / 抽屉抢焦点后 PM 回落到全选），于是"插图"变成"用图替换正文"，
  // 只留下被掏空的那个 <li>。多段追加同理：不塌陷，后一段会吃掉前一段。
  const collapseSelectionToDocEnd = (editorEl, opts = {}) => {
    const result = { pm: false, dom: false, kind: '' };
    try {
      const view = getEditorPmView(editorEl);
      if (view && view.state && view.state.selection) {
        const state = view.state;
        const Ctor = state.selection.constructor;
        result.kind = (Ctor && Ctor.name) || '';
        // Selection.atEnd / Selection.near 是 prosemirror-state 的静态方法，子类继承可用
        let sel = null;
        if (typeof Ctor.atEnd === 'function') sel = Ctor.atEnd(state.doc);
        else if (typeof Ctor.near === 'function') sel = Ctor.near(state.doc.resolve(state.doc.content.size));
        if (sel) {
          view.dispatch(state.tr.setSelection(sel));
          result.pm = true;
        }
      }
    } catch (_) {}
    // 抽屉开着时不要抢 DOM 焦点（可能把抽屉关掉），只动 PM 选区
    if (opts.domFocus !== false) {
      try {
        editorEl.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editorEl);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
        result.dom = true;
      } catch (_) {}
    }
    return result;
  };
  const pasteHtmlIntoEditor = (editorEl, html, plainText) => {
    try {
      // 追加语义：粘贴前塌陷到末尾（清空后是空文档，塌陷无副作用）
      collapseSelectionToDocEnd(editorEl);
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/html', html);
      clipboardData.setData('text/plain', plainText || '');
      editorEl.focus();
      editorEl.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData, bubbles: true, cancelable: true
      }));
      return true;
    } catch (_) {
      return false;
    }
  };

  // 图片下载走主进程（content-preload.js 暴露的 browserAPI.downloadImage），
  // 页面内直接 fetch 第三方 CDN 会被 CORS/防盗链挡住
  const downloadImageAsFile = async (url, index) => {
    const downloader = window.browserAPI && window.browserAPI.downloadImage;
    if (typeof downloader !== 'function') throw new Error('browserAPI.downloadImage 不可用');
    let lastError = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await downloader(url);
        if (res && res.success && res.data) {
          const binary = atob(res.data);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const type = res.contentType || 'image/jpeg';
          let ext = '.jpg';
          if (type.includes('png')) ext = '.png';
          else if (type.includes('webp')) ext = '.webp';
          else if (type.includes('gif')) ext = '.gif';
          else if (type.includes('bmp')) ext = '.bmp';
          return new File([bytes], 'toutiao-content-' + index + ext, { type });
        }
        lastError = (res && res.error) || 'download-failed';
      } catch (e) {
        lastError = e.message;
      }
      if (attempt < 3) await delay(1500);
    }
    throw new Error(lastError || 'download-failed');
  };
  // 头条正文图片抽屉（点击工具栏图片按钮后弹出，与封面上传共用 byte-drawer 组件）：
  //   .byte-drawer-inner > tabs[上传图片|免费正版图片|热点图库|我的素材]
  //   「上传图片」默认就是激活态，file input 已经在 DOM 里：
  //     button.upload-btn > .btn-upload-handle.upload-handler > input[type=file][accept=image/*][multiple]
  //     另有 #upload-drag-input（拖拽口，0x0）
  // ⚠️ 绝对不能点「本地上传」/「扫码上传」按钮：这类按钮内部通常是 inputRef.click()，
  //    会弹出系统原生文件对话框，Electron 窗口当场悬死（本项目有卡窗前科）。
  //    input 本来就在 DOM 里，直接塞 files 即可。
  const findOpenImageDrawer = () => {
    const drawers = Array.from(document.querySelectorAll('.byte-drawer-inner, .byte-drawer'));
    return drawers.filter((el) => {
      if (!isVisibleElement(el)) return false;
      if (el.closest('.article-cover, .article-cover-images')) return false;
      return !!el.querySelector('input[type="file"]');
    }).pop() || null;
  };
  // ⚠️ 正文图片 input 必须排除封面的，否则正文图会被塞进封面上传口。
  // 抽屉里的 input 优先（那才是我们刚点开的那个）；input 自身是 0x0，不能用可见性判
  const findBodyImageInput = () => {
    const acceptOk = (input) => {
      if (!input || input.disabled) return false;
      const accept = (input.getAttribute('accept') || '').toLowerCase();
      if (!accept) return true;
      return accept.includes('image') || accept.includes('png') || accept.includes('jpg');
    };
    const drawer = findOpenImageDrawer();
    if (drawer) {
      const inDrawer = Array.from(drawer.querySelectorAll('input[type="file"]')).filter(acceptOk);
      // 优先真正的上传按钮口，拖拽口（#upload-drag-input）作次选
      const primary = inDrawer.find((el) => el.closest('.btn-upload-handle, .upload-handler'));
      if (primary) return primary;
      if (inDrawer[0]) return inDrawer[0];
    }
    const list = Array.from(document.querySelectorAll('input[type="file"]')).filter((input) => {
      if (!acceptOk(input)) return false;
      return !input.closest('.article-cover, .article-cover-images, [class*="cover"]');
    });
    return list[0] || null;
  };

  const IMAGE_TOOL_SELECTORS = [
    '.syl-toolbar-tool.image.static button',
    '.syl-toolbar-tool.image button',
    '.syl-toolbar-tool.image.static',
    '.syl-toolbar-tool.image'
  ];
  // 头条正文图片按钮是纯 SVG 图标按钮，没有任何文字/title/aria-label：
  //   <div class="syl-toolbar-tool image static"><div><button class="syl-toolbar-button">
  // 按文案匹配（/图片|插图/）永远匹配不到 —— 旧实现是死代码，上传口一次都没打开过。
  const findImageToolbarTrigger = () => {
    for (const selector of IMAGE_TOOL_SELECTORS) {
      const hit = Array.from(document.querySelectorAll(selector))
        .find((el) => el && !el.closest('.article-cover, .article-cover-images'));
      if (hit) return { el: hit, selector };
    }
    const byText = Array.from(document.querySelectorAll('button, [role="button"], [class*="menu-item"]'))
      .find((el) => {
        if (!isVisibleElement(el)) return false;
        if (el.closest('.article-cover, .article-cover-images')) return false;
        const label = [el.textContent, el.getAttribute('title'), el.getAttribute('aria-label')]
          .filter(Boolean).join(' ').trim();
        if (!label || label.length > 12) return false;
        return /图片|插图|image/i.test(label);
      });
    return byText ? { el: byText, selector: 'text-fallback' } : null;
  };
  // 只切「上传图片」标签页（且仅在它不是激活态时）。绝不碰「本地上传」「扫码上传」按钮
  const ensureUploadTabActive = async (drawer) => {
    const scope = drawer || document;
    const titles = Array.from(scope.querySelectorAll('.byte-tabs-header-title'));
    const target = titles.find((el) => (el.textContent || '').trim() === '上传图片');
    if (!target) return false;
    if ((target.className || '').includes('active')) return true;
    try { target.click(); } catch (_) {}
    await delay(600);
    return true;
  };
  const ensureBodyImageInput = async (editorEl, diag) => {
    const note = (key, value) => { if (diag) diag[key] = value; };
    let input = findBodyImageInput();
    if (input) {
      note('inputRoute', 'already-present');
      return input;
    }
    // 工具栏通常要编辑器获得焦点后才可用
    try { if (editorEl) editorEl.focus(); } catch (_) {}
    await delay(200);

    const trigger = findImageToolbarTrigger();
    note('imageToolSelector', trigger ? trigger.selector : 'not-found');
    if (!trigger) {
      note('inputRoute', 'trigger-not-found');
      return null;
    }
    try { trigger.el.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch (_) {}
    await delay(150);
    try { trigger.el.click(); } catch (_) {}
    await delay(900);

    for (let i = 0; i < 10; i++) {
      const drawer = findOpenImageDrawer();
      if (drawer && i === 1) await ensureUploadTabActive(drawer);
      input = findBodyImageInput();
      if (input) {
        note('inputRoute', drawer ? 'drawer-input' : 'toolbar-click');
        note('drawerOpened', !!drawer);
        return input;
      }
      await delay(500);
    }
    note('drawerOpened', !!findOpenImageDrawer());
    note('inputRoute', 'input-not-found-after-click');
    return null;
  };
  // 抽屉里传完图后要点确认才会插进正文（未上传前 byte-drawer-content-nofooter，footer 是后出现的）
  const confirmImageDrawer = async (drawer) => {
    if (!drawer) return false;
    const start = Date.now();
    while (Date.now() - start < 25000) {
      const thumbs = drawer.querySelectorAll('.upload-image-wrapper img, .upload-image-wrapper [class*="item"]');
      const btn = Array.from(drawer.querySelectorAll('button')).find((el) => {
        if (!isVisibleElement(el) || el.disabled) return false;
        const text = (el.textContent || '').trim();
        if (!text || text.length > 6) return false;
        if (/取消|关闭|返回|删除|重新/.test(text)) return false;
        return /确定|确认|插入|完成|下一步/.test(text);
      });
      if (btn && thumbs.length > 0) {
        // 与 bare 时代的 clickButton 行为保持一致：先滚到可视区再原生 click
        // （simulateMouseClick 不滚动，抽屉确认按钮可能在视口外）
        try { btn.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch (_) {}
        try { btn.click(); } catch (_) { simulateMouseClick(btn); }
        await delay(900);
        return true;
      }
      await delay(600);
    }
    return false;
  };

  const uploadImageIntoEditor = async (editorEl, url, index, diag) => {
    const before = countHostedImages(editorEl);
    const textBefore = (editorEl.innerText || editorEl.textContent || '').trim().length;
    const file = await downloadImageAsFile(url, index);
    const input = await ensureBodyImageInput(editorEl, diag);
    if (!input) throw new Error('body-image-input-not-found');
    // 🚨 插图前必须塌陷选区，否则这张图会把已写入的正文整段替换掉
    const selBefore = collapseSelectionToDocEnd(editorEl);
    if (diag) diag.selectionBeforeUpload = `${selBefore.kind || 'no-pm'}${selBefore.pm ? '→collapsed' : '→pm-unavailable'}`;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    if (input._valueTracker) input._valueTracker.setValue('');
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await delay(1200);

    // 抽屉模式：等缩略图出现 → 点确认插入；无抽屉说明是直插模式，跳过
    const drawer = findOpenImageDrawer();
    if (drawer) {
      // 抽屉交互可能又把选区带回全选，点确认前再塌陷一次（不抢 DOM 焦点，免得关掉抽屉）
      collapseSelectionToDocEnd(editorEl, { domFocus: false });
      const confirmed = await confirmImageDrawer(drawer);
      if (diag) diag.drawerConfirmed = (diag.drawerConfirmed || 0) + (confirmed ? 1 : 0);
    }

    const start = Date.now();
    while (Date.now() - start < 30000) {
      if (countHostedImages(editorEl) > before) {
        await delay(500);
        const textAfter = (editorEl.innerText || editorEl.textContent || '').trim().length;
        // 判据：图进来了但字少了 → 选区塌陷没生效，交给外层补写兜底
        if (diag && textBefore > 0 && textAfter < textBefore * 0.8) {
          diag.textEaten = (diag.textEaten || 0) + 1;
          diag.textEatenDetail = `${textBefore}→${textAfter}`;
        }
        return true;
      }
      await delay(600);
    }
    throw new Error('body-image-upload-timeout');
  };
  // 把正文按 <img> 切成「HTML 段 / 图片段」，回退模式下逐段插入
  const buildContentSegments = (html) => {
    const segments = [];
    const temp = document.createElement('div');
    temp.innerHTML = html;
    let buffer = document.createElement('div');
    const flush = () => {
      const inner = buffer.innerHTML.trim();
      if (inner) {
        segments.push({
          type: 'html',
          html: inner,
          text: (buffer.innerText || buffer.textContent || '').trim()
        });
      }
      buffer = document.createElement('div');
    };
    const walk = (node) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === 1 && child.tagName === 'IMG') {
          flush();
          const src = (child.getAttribute('src') || '').trim();
          if (src && !/^data:/i.test(src)) segments.push({ type: 'image', src });
          return;
        }
        if (child.nodeType === 1 && child.querySelector && child.querySelector('img')) {
          walk(child);
          return;
        }
        buffer.appendChild(child.cloneNode(true));
      });
    };
    walk(temp);
    flush();
    return segments;
  };
  const fillContentWithImages = async (editorEl, rawHtml, plainText) => {
    const diag = {
      mode: 'skip', expectedImages: 0, hostedAfterPaste: 0,
      uploadedImages: 0, hostedFinal: 0, textLength: 0, errors: []
    };
    // 诊断落盘：以后再出"图对了字没了"这类问题，直接看 debug-dumps 里的 content-images 条目，
    // 不用再靠发布窗口的 console（关窗即失）
    const dumpImageDiag = async () => {
      try { await dumpDebugToFile('content-images', { imgDiag: diag }); } catch (_) {}
    };
    const html = (typeof rawHtml === 'string' && /[<>]/.test(rawHtml)) ? rawHtml.trim() : '';
    const imageSources = extractImageSourcesFromHtml(html);
    diag.expectedImages = imageSources.length;
    if (!html || imageSources.length === 0) return { ok: false, diag };

    const expectedLength = String(plainText || '').trim().length;
    const measureText = () => {
      const len = (editorEl.innerText || editorEl.textContent || '').trim().length;
      diag.textLength = len;
      return len;
    };
    const textPassed = () => expectedLength === 0 || measureText() >= expectedLength * 0.8;

    // 路线 1：整段粘贴，让头条编辑器自己转存外链图（顺带保住加粗/列表/段落格式）
    diag.mode = 'paste';
    await clearEditorContent(editorEl);
    pasteHtmlIntoEditor(editorEl, html, plainText);
    // 转存是异步的，图越多越慢：基础 4 轮之外，每张图再多给 2 轮，避免"其实在传"被判死后
    // 白白清空重来（轮次上限 12，约 45 秒）
    const rounds = Math.min(4 + imageSources.length * 2, 12);
    for (let round = 0; round < rounds; round++) {
      await delay(round < 3 ? [1500, 2000, 2500][round] : 3000);
      diag.hostedAfterPaste = countHostedImages(editorEl);
      diag.rounds = round + 1;
      measureText();
      if (diag.hostedAfterPaste >= imageSources.length && textPassed()) {
        diag.hostedFinal = diag.hostedAfterPaste;
        diag.ok = true;
        await dumpImageDiag();
        return { ok: true, diag };
      }
      // 提前跳车：正文已经落地（文本达标）但一张都没转存，且编辑器里已经有未转存的外链 img，
      // 说明头条这条粘贴链路根本不接管外链图 —— 再等也是等，直接转原生上传省 20+ 秒
      if (round >= 2 && diag.hostedAfterPaste === 0) {
        const externalCount = getEditorImages(editorEl)
          .filter((img) => !isHostedImage(img.getAttribute('src') || img.src || '')).length;
        diag.externalAfterPaste = externalCount;
        if (textPassed() || externalCount > 0) {
          diag.pasteVerdict = 'no-transcode';
          break;
        }
      }
      // 更快的跳车：文字进来了、但外链 img 连 DOM 都没留下 —— 头条 syl 的 paste handler 直接
      // 把外链图剥掉了（2026-09-01 实测：粘贴后 content 里一个 <img> 都没有，只剩空 <li>），
      // 这种情况等 12 轮也不会变，1 轮后就转原生上传
      if (round >= 1 && diag.hostedAfterPaste === 0 && textPassed()
        && getEditorImages(editorEl).length === 0) {
        diag.externalAfterPaste = 0;
        diag.pasteVerdict = 'images-stripped';
        break;
      }
    }

    // 路线 2：回退逐图原生上传（清空重来，避免残留未转存的外链 img）
    diag.mode = 'native-upload';
    await clearEditorContent(editorEl);
    const segments = buildContentSegments(html);
    diag.segments = segments.map((s) => s.type).join('|');
    let imageIndex = 0;
    const textHtmlWritten = [];
    for (const segment of segments) {
      if (segment.type === 'html') {
        pasteHtmlIntoEditor(editorEl, segment.html, segment.text);
        textHtmlWritten.push(segment.html);
        await delay(900);
        continue;
      }
      imageIndex++;
      try {
        await uploadImageIntoEditor(editorEl, segment.src, imageIndex, diag);
        diag.uploadedImages++;
      } catch (e) {
        diag.errors.push({ src: String(segment.src || '').slice(0, 160), message: e.message });
      }
    }
    diag.hostedFinal = countHostedImages(editorEl);
    let finalTextLength = (editorEl.innerText || editorEl.textContent || '').trim().length;
    // 兜底：插图仍然把正文吃掉了（选区塌陷没生效）→ 把文字补回末尾。
    // 顺序会退化成「图在前、文字在后」，但远好过发出去只有图没有字
    if (textHtmlWritten.length > 0 && expectedLength > 0 && finalTextLength < expectedLength * 0.5) {
      diag.textRepairAttempted = true;
      diag.textBeforeRepair = finalTextLength;
      pasteHtmlIntoEditor(editorEl, textHtmlWritten.join(''), plainText);
      await delay(1200);
      finalTextLength = (editorEl.innerText || editorEl.textContent || '').trim().length;
      diag.hostedFinal = countHostedImages(editorEl);
      diag.textRepaired = finalTextLength >= expectedLength * 0.5;
    }
    diag.textLength = finalTextLength;
    // 部分成功也保留：有图 + 有字就好过整篇降级成纯文本
    const routeOk = diag.hostedFinal > 0 && finalTextLength > 0;
    diag.ok = routeOk;
    await dumpImageDiag();
    return { ok: routeOk, diag };
  };

  const fillContent = async (htmlContent, introText) => {
    // 🔢 给被段落打断的多个 <ol> 用 start 属性接续编号，修复 insertHTML/paste 原生渲染时序号全 1
    const addOrderedListStart = (html) => {
      if (!html || !/[<>]/.test(html)) return html;
      const d = document.createElement('div');
      d.innerHTML = html;
      let counter = 1;
      d.querySelectorAll('ol').forEach((ol) => {
        if (ol.closest('li')) return; // 跳过嵌套子列表
        ol.setAttribute('start', String(counter));
        ol.querySelectorAll(':scope > li').forEach((li) => {
          li.removeAttribute('value');
          counter++;
        });
      });
      return d.innerHTML;
    };

    // 保留原始 HTML 用于 HTML 方法（优先保留格式）
    let htmlForPaste = htmlContent
      ? addOrderedListStart(htmlContent)
      : `<p>${(introText || '').split('\n').filter(Boolean).join('</p><p>')}</p>`;

    // 仅作为最后兜底时才用纯文本
    const plain = parsePlainTextFromHtml(htmlForPaste) || parsePlainTextFromHtml(introText);
    if (!plain) {
      console.log(`${LOG_PREFIX} ℹ️ 内容为空，跳过正文填写`);
      return;
    }

    await retryOperation(async () => {
      const editor = findVisibleEditable();
      if (!editor) {
        throw new Error('未找到正文编辑器');
      }
      if (typeof editor.focus === 'function') {
        editor.focus();
      }
      await delay(300);

      let contentSet = false;
      let contentSetByImages = false;

      // 🖼️ 【FIX_TOUTIAO_UNIFY_INJECTION】正文含 <img> 时优先走图片专用链路。
      // 下面的老链路（PM dispatch / insertHTML / 纯文本节点）都承载不了图片，<img> 会静默蒸发 ——
      // 这正是 bare 脚本时代 FIX_TOUTIAO_CONTENT_IMAGES 要解决的问题，随迁移一并搬进来。
      // fillContentWithImages 自身以 clearEditorContent 开头，retryOperation 重试不会叠加正文
      //（见 memory: retry-nonidempotent-editor-write）
      if (window.isFeatureEnabled?.('FIX_TOUTIAO_UNIFY_INJECTION')) {
        const imageSources = extractImageSourcesFromHtml(htmlForPaste);
        if (imageSources.length > 0) {
          console.log(`${LOG_PREFIX} 🖼️ 正文含 ${imageSources.length} 张图片，走图片专用链路`);
          try {
            const imgResult = await fillContentWithImages(editor, htmlForPaste, plain);
            console.log(`${LOG_PREFIX} 🖼️ 图片链路结果:`, JSON.stringify(imgResult.diag));
            if (imgResult.ok) {
              contentSet = true;
              contentSetByImages = true;
            } else {
              // 不达标：清空后交给下面的老链路兜底（至少保住文字，不让整篇空着）
              console.warn(`${LOG_PREFIX} ⚠️ 图片链路未达标，降级到原有正文写入（图片可能丢失）`);
              await clearEditorContent(editor);
            }
          } catch (e) {
            console.warn(`${LOG_PREFIX} ⚠️ 图片链路异常，降级到原有正文写入:`, e.message);
            try { await clearEditorContent(editor); } catch (_) {}
          }
        }
      }

      // Helper: 选中编辑器全部内容并删除
      const selectAndClear = () => {
        const sel = window.getSelection();
        if (sel) {
          const r = document.createRange();
          r.selectNodeContents(editor);
          sel.removeAllRanges();
          sel.addRange(r);
        }
        document.execCommand('delete', false);
      };

      // Helper: 获取 ProseMirror EditorView（多种策略搜索）
      const getPmView = () => {
        // 策略1: editor 自身或最近的 .ProseMirror 的 pmViewDesc
        try {
          const pmNode = editor.closest('.ProseMirror') || editor;
          if (pmNode.pmViewDesc?.view) {
            console.log(`${LOG_PREFIX} [PM] 通过 pmViewDesc 找到 EditorView`);
            return pmNode.pmViewDesc.view;
          }
        } catch (_) {}

        // 策略2: 向上遍历 DOM 树查找 pmViewDesc
        try {
          let node = editor;
          while (node && node !== document.body) {
            if (node.pmViewDesc?.view) {
              console.log(`${LOG_PREFIX} [PM] 通过 DOM 向上遍历找到 EditorView (tag: ${node.tagName}, class: ${(node.className || '').toString().slice(0, 60)})`);
              return node.pmViewDesc.view;
            }
            node = node.parentElement;
          }
        } catch (_) {}

        // 策略3: 在页面中搜索所有 .ProseMirror 元素
        try {
          const allPm = document.querySelectorAll('.ProseMirror');
          for (const pm of allPm) {
            if (pm.pmViewDesc?.view) {
              console.log(`${LOG_PREFIX} [PM] 通过全局搜索 .ProseMirror 找到 EditorView`);
              return pm.pmViewDesc.view;
            }
          }
        } catch (_) {}

        // 策略4: 搜索 contenteditable 元素上的 pmViewDesc
        try {
          const editables = document.querySelectorAll('[contenteditable="true"]');
          for (const el of editables) {
            if (el.pmViewDesc?.view) {
              console.log(`${LOG_PREFIX} [PM] 通过 contenteditable 找到 EditorView`);
              return el.pmViewDesc.view;
            }
          }
        } catch (_) {}

        console.warn(`${LOG_PREFIX} [PM] ❌ 未找到 ProseMirror EditorView。诊断信息:`, {
          editorTag: editor.tagName,
          editorClass: (editor.className || '').toString().slice(0, 100),
          hasPmViewDesc: !!editor.pmViewDesc,
          closestPM: !!editor.closest('.ProseMirror'),
          allPMCount: document.querySelectorAll('.ProseMirror').length,
          allEditableCount: document.querySelectorAll('[contenteditable="true"]').length
        });
        return null;
      };

      // Helper: 检查 ProseMirror state 是否有实际内容
      const pmStateHasContent = () => {
        try {
          const view = getPmView();
          if (!view) return false;
          const text = view.state.doc.textContent || '';
          const hasContent = text.trim().length > 0;
          console.log(`${LOG_PREFIX} [PM] state 内容检查: "${text.trim().slice(0, 50)}..." (长度=${text.trim().length}, 有内容=${hasContent})`);
          return hasContent;
        } catch (e) {
          console.warn(`${LOG_PREFIX} [PM] state 检查异常:`, e.message);
          return false;
        }
      };

      // Helper: 通过 ProseMirror dispatch 设置内容
      // 🔗 优先用 view.pasteHTML 灌入原始 HTML（走 PM 原生剪贴板解析，保留超链接/加粗/列表等
      //    schema 支持的富文本格式），失败时只做纯文本 dispatch
      const pmDispatchContent = (textContent, htmlContent) => {
        const view = getPmView();
        if (!view) {
          console.warn(`${LOG_PREFIX} [PM] dispatch 失败: EditorView 不可用`);
          return false;
        }

        // ✅ 优先尝试 pasteHTML（保留原始 HTML 格式）
        if (htmlContent && /[<>]/.test(htmlContent) && typeof view.pasteHTML === 'function') {
          try {
            if (view.state.doc.content.size > 0) {
              view.dispatch(view.state.tr.delete(0, view.state.doc.content.size));
            }
            view.pasteHTML(htmlContent);
            const pastedText = view.state.doc.textContent || '';
            if (pastedText.trim().length > 0) {
              console.log(`${LOG_PREFIX} [PM] ✅ pasteHTML 富文本写入成功 (长度=${pastedText.trim().length})`);
              return true;
            }
            console.warn(`${LOG_PREFIX} [PM] ⚠️ pasteHTML 后 state 为空，尝试纯文本 dispatch`);
          } catch (e) {
            console.warn(`${LOG_PREFIX} [PM] ⚠️ pasteHTML 失败，尝试纯文本 dispatch:`, e.message);
          }
        }

        // 🔢 纯文本 dispatch（仅当 pasteHTML 不可用或失败时）
        const state = view.state;
        const { schema } = state;

        // 找到用于创建段落的 node type
        const paraType = schema.nodes.paragraph || schema.nodes.para || schema.nodes.text_block;
        if (!paraType) {
          console.warn(`${LOG_PREFIX} [PM] dispatch 失败: schema 中没有 paragraph/para/text_block 节点`);
          return false;
        }

        const pmLines = textContent.split('\n').map(l => l.trim()).filter(Boolean);
        const paragraphs = pmLines.length > 0
          ? pmLines.map(line => paraType.create(null, line ? [schema.text(line)] : []))
          : [paraType.create(null, [schema.text(textContent || ' ')])];

        console.log(`${LOG_PREFIX} [PM] 纯文本 dispatch: ${paragraphs.length} 个段落`);
        const tr = state.tr.replaceWith(0, state.doc.content.size, paragraphs);
        view.dispatch(tr);

        // 验证 dispatch 后的状态
        const afterText = view.state.doc.textContent || '';
        console.log(`${LOG_PREFIX} [PM] dispatch 后 state 内容: "${afterText.slice(0, 80)}..." (长度=${afterText.length})`);
        return afterText.trim().length > 0;
      };

      // === 方法 1: ProseMirror EditorView 直接操作（最可靠）===
      // 直接 dispatch transaction 设置文档内容，确保 ProseMirror 内部 state 被正确更新
      // 这是唯一能保证草稿自动保存时发送正确 content 的方式
      // 🚨 必须跳过图片链路已经写好的情况：pmDispatchContent 第一步就是
      //    tr.delete(0, doc.content.size)，之后 pasteHTML 灌的是**原始 HTML**（外链图），
      //    而头条的 paste handler 会把外链图整个剥掉 —— 那等于把刚传上去的图全删了。
      if (!contentSet) {
        try {
          const dispatched = pmDispatchContent(plain, htmlForPaste);
          if (dispatched) {
            contentSet = true;
            console.log(`${LOG_PREFIX} ✅ 方法1(ProseMirror dispatch) 正文设置成功`);
          } else {
            console.warn(`${LOG_PREFIX} ⚠️ 方法1(ProseMirror dispatch) 未能写入 state，尝试其他方法`);
          }
        } catch (e) {
          console.warn(`${LOG_PREFIX} ⚠️ 方法1(ProseMirror dispatch) 失败:`, e.message);
        }
      } else {
        console.log(`${LOG_PREFIX} ⏭️ 正文已由图片链路写入，跳过方法1~5（避免删图重写）`);
      }

      // === 方法 2: execCommand('insertHTML') ===
      if (!contentSet) {
        try {
          editor.focus();
          selectAndClear();
          await delay(200);

          // ✅ 优先用 htmlForPaste（保留原始 HTML 格式）
          const insertOk = document.execCommand('insertHTML', false, htmlForPaste);
          await delay(800);

          const afterInsert = (editor.innerText || editor.textContent || '').trim();
          if (insertOk && afterInsert.length > 0) {
            contentSet = true;
            console.log(`${LOG_PREFIX} ✅ 方法2(insertHTML) 正文设置成功，长度:`, afterInsert.length);
          } else {
            console.warn(`${LOG_PREFIX} ⚠️ 方法2(insertHTML) ${insertOk ? '内容为空' : 'execCommand返回false'}，尝试下一种方法`);
          }
        } catch (e) {
          console.warn(`${LOG_PREFIX} ⚠️ 方法2(insertHTML) 失败:`, e.message);
        }
      }

      // === 方法 3: Clipboard paste ===
      if (!contentSet) {
        try {
          editor.focus();
          selectAndClear();
          await delay(200);

          // ✅ 优先用 htmlForPaste（保留原始 HTML 格式）
          const clipboardData = new DataTransfer();
          clipboardData.setData('text/html', htmlForPaste);
          clipboardData.setData('text/plain', plain);
          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: clipboardData
          });
          editor.dispatchEvent(pasteEvent);
          await delay(600);

          const afterPaste = (editor.innerText || editor.textContent || '').trim();
          if (afterPaste.length > 0) {
            contentSet = true;
            console.log(`${LOG_PREFIX} ✅ 方法3(clipboard paste) 正文设置成功，长度:`, afterPaste.length);
          } else {
            console.warn(`${LOG_PREFIX} ⚠️ 方法3(clipboard paste) 内容为空，尝试下一种方法`);
          }
        } catch (e) {
          console.warn(`${LOG_PREFIX} ⚠️ 方法3(clipboard paste) 失败:`, e.message);
        }
      }

      // === 方法 4: execCommand insertText ===
      if (!contentSet) {
        try {
          editor.focus();
          selectAndClear();
          await delay(200);

          const lines = plain.split('\n').map(l => l.trim()).filter(Boolean);
          for (let i = 0; i < lines.length; i++) {
            if (i > 0) {
              document.execCommand('insertParagraph', false);
            }
            document.execCommand('insertText', false, lines[i]);
          }
          await delay(400);

          const afterExec = (editor.innerText || editor.textContent || '').trim();
          if (afterExec.length > 0) {
            contentSet = true;
            console.log(`${LOG_PREFIX} ✅ 方法4(insertText) 正文设置成功，长度:`, afterExec.length);
          } else {
            console.warn(`${LOG_PREFIX} ⚠️ 方法4(insertText) 内容为空，尝试下一种方法`);
          }
        } catch (e) {
          console.warn(`${LOG_PREFIX} ⚠️ 方法4(insertText) 失败:`, e.message);
        }
      }

      // === 方法 5: 直接 DOM 操作（最终兜底）===
      if (!contentSet) {
        console.warn(`${LOG_PREFIX} ⚠️ 降级到方法5(直接 DOM 操作)，草稿可能无法自动保存`);
        editor.innerHTML = '';
        const lines = plain.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) {
          editor.textContent = plain;
        } else {
          lines.forEach(line => {
            const p = document.createElement('p');
            p.textContent = line;
            editor.appendChild(p);
          });
        }
        editor.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertFromPaste',
          data: plain
        }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));

        // 对于直接 DOM 写入：只要 DOM 里已经有可见文本，就先视为“内容已写入”
        // 这样后面的“关键补救”才会尝试把 ProseMirror state 同步回来
        const afterDom = (editor.innerText || editor.textContent || '').trim();
        if (afterDom.length > 0) {
          contentSet = true;
          console.log(`${LOG_PREFIX} ✅ 方法5(直接 DOM) 已写入内容，长度:`, afterDom.length);
        } else {
          console.warn(`${LOG_PREFIX} ⚠️ 方法5(直接 DOM) 写入后仍为空`);
        }
      }

      // === 关键补救：如果 DOM 有内容但 ProseMirror state 为空，强制 dispatch ===
      // 这是 insertHTML/paste 等方法的常见问题——DOM 改了但 ProseMirror 不知道
      // 注意：方法5(直接DOM)也会把 contentSet 标为 true（只代表“DOM 有内容”），因此这里必须做 state 同步
      // 🖼️ 图片链路已确认头条图床转存成功（说明编辑器自己的 paste handler 处理过这批内容，
      // PM state 必然同步），此时绝不能再 pmDispatchContent —— 那一步会把正文重写成纯文本，图片全丢
      if (contentSet && !contentSetByImages && !pmStateHasContent()) {
        console.warn(`${LOG_PREFIX} ⚠️ DOM 有内容但 ProseMirror state 为空，强制 dispatch 补救`);
        try {
          const rescued = pmDispatchContent(plain, htmlForPaste);
          await delay(300);
          if (rescued && pmStateHasContent()) {
            console.log(`${LOG_PREFIX} ✅ ProseMirror state 补救成功`);
          } else {
            console.warn(`${LOG_PREFIX} ⚠️ ProseMirror state 补救后仍为空，草稿保存可能失败`);
          }
        } catch (e) {
          console.warn(`${LOG_PREFIX} ⚠️ ProseMirror state 补救失败:`, e.message);
        }
      }

      await delay(300);
      const currentText = (editor.innerText || editor.textContent || '').trim();
      if (!currentText) {
        throw new Error('正文设置后仍为空');
      }
      console.log(`${LOG_PREFIX} ✅ 正文设置成功，长度:`, currentText.length);

      // 🔗 正文设置成功后，处理链接和列表
      if (htmlContent && /[<>]/.test(htmlContent)) {
        try {
          const { links, listItems } = extractLinksAndListsFromHtml(htmlContent);
          const normUrl = (u) => (u || '').trim().replace(/\/+$/, '');
          const getDomHrefs = () => new Set(
            Array.from(editor.querySelectorAll('a[href]')).map(a => normUrl(a.getAttribute('href')))
          );

          // 链接三级策略：已存在跳过 → PM state 直加 mark → 工具栏 UI 模拟兜底
          const linkDiag = {
            expected: links.length, alreadyInDom: 0,
            pmSupported: null, pmApplied: 0, pmFailures: null, marks: null,
            uiApplied: 0, finalInDom: 0
          };
          if (links.length > 0) {
            await delay(500);
            // 1) pasteHTML 可能已保留链接，避免重复添加
            let domHrefs = getDomHrefs();
            let missingLinks = links.filter(l => !domHrefs.has(normUrl(l.url)));
            linkDiag.alreadyInDom = links.length - missingLinks.length;
            if (missingLinks.length === 0) {
              console.log(`${LOG_PREFIX} ✅ ${links.length} 个链接已由富文本写入保留，无需补加`);
            } else {
              // 2) 优先直接操作 ProseMirror state 加 link mark（绕过粘贴过滤与工具栏 UI）
              const view = getPmView();
              if (view) {
                const pmRes = addLinksViaPmMarks(view, missingLinks);
                linkDiag.pmSupported = pmRes.supported;
                linkDiag.pmApplied = pmRes.applied;
                linkDiag.pmFailures = pmRes.failures;
                linkDiag.marks = pmRes.marks;
                await delay(300);
              } else {
                console.warn(`${LOG_PREFIX} 🔗 PM view 不可用，直接走 UI 模拟`);
              }
              // 3) 仍缺失的链接 → 工具栏 UI 模拟兜底
              domHrefs = getDomHrefs();
              missingLinks = missingLinks.filter(l => !domHrefs.has(normUrl(l.url)));
              if (missingLinks.length > 0) {
                console.log(`${LOG_PREFIX} 🔗 仍有 ${missingLinks.length} 个链接缺失，尝试 UI 模拟兜底`);
                linkDiag.uiApplied = await addAllLinks(missingLinks, editor);
              }
            }
            await delay(500);
            linkDiag.finalInDom = editor.querySelectorAll('a[href]').length;
            console.log(`${LOG_PREFIX} 🔗 链接最终验证: 期望 ${linkDiag.expected} 个, 编辑器实际 ${linkDiag.finalInDom} 个`);
            if (linkDiag.finalInDom < linkDiag.expected) {
              // 写诊断文件：包含 schema marks、各阶段结果、工具栏按钮清单，便于定位失败环节
              await dumpDebugToFile('link-add-incomplete', {
                linkDiag,
                links,
                toolbar: collectToolbarInfo()
              });
            }
          }

          // 处理列表：编辑器已有原生 ol/ul（pasteHTML 保留）时跳过，避免二次点击把列表切回普通段落
          if (listItems.length > 0) {
            await delay(500);
            if (editor.querySelector('ol, ul, li')) {
              console.log(`${LOG_PREFIX} ✅ 检测到编辑器已有原生列表，跳过 UI 模拟`);
            } else {
              await applyListFormatting(listItems, editor);
            }
            await delay(500);
          }

          console.log(`${LOG_PREFIX} ✅ 链接和列表处理完成`);
        } catch (e) {
          console.warn(`${LOG_PREFIX} ⚠️ 链接和列表处理异常（不影响正文发布）:`, e.message);
        }
      }
    }, 4, 1200);
  };

  const tryUploadCover = async (coverUrl, title) => {
    try {
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
        return;
      }

      const file = coverUrl
        ? await ensureFileFromUrl(coverUrl, (title || 'toutiao-cover').slice(0, 20))
        : await createFallbackCoverFile(title);
      if (!file) {
        console.log(`${LOG_PREFIX} ⚠️ 封面文件为空，跳过`);
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
      } else if (!hasCoverPreview) {
        console.warn(`${LOG_PREFIX} ⚠️ 封面上传后未检测到预览，可能仍需人工确认裁剪`);
      } else {
        console.log(`${LOG_PREFIX} ✅ 封面上传已触发`);
      }
    } catch (e) {
      console.warn(`${LOG_PREFIX} ⚠️ 封面上传失败（不阻断发布）:`, e.message || e);
    }
  };

  // ===========================================================================
  // ⏰ 【FIX_TOUTIAO_UNIFY_INJECTION】定时发布（自 main.js bare 脚本 8265-8511 移植）
  // 旧实现只做「找含『定时发布』文案的元素点一下 + 往 input 硬写时间字符串」，且任一步找不到就
  // 静默 return —— 头条实际是 byte-select 三段下拉（日期/小时/分钟），硬写 input 不生效，
  // 于是按面板默认时间（当前时间）发了出去，日志却全是 ✅。这与小红书那个坑同款
  //（见 memory: xhs-schedule-picker-diagnosis），所以失败一律回传 reason 让调用方能中断。
  // ===========================================================================
  const parseScheduleParts = (sendTime) => {
    const value = String(sendTime || '').trim();
    if (!value) return null;
    const normalized = value.replace(/\//g, '-').replace('T', ' ');
    const match = normalized.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2})/);
    if (!match) return null;
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    if ([month, day, hour, minute].some(Number.isNaN)) return null;
    return {
      dayText: String(month).padStart(2, '0') + '月' + String(day).padStart(2, '0') + '日',
      hourText: String(hour),
      minuteText: String(minute)
    };
  };
  const clickScheduleElement = (el) => {
    if (!el) return false;
    try { el.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch (_) {}
    try { el.click(); } catch (_) {}
    return true;
  };
  // ⚠️ 底部有两个发布按钮：「定时发布」和 .publish-btn-last（「发布」）。必须排除后者，
  // 否则点中的是立即发布
  const findFooterScheduleButton = () => {
    const selectors = [
      'button.publish-btn:not(.publish-btn-last)',
      'button[class*="publish-btn"]:not(.publish-btn-last):not([class*="publish-btn-last"])',
      '.publish-footer button:not(.publish-btn-last)',
      '.publish-footer-content button:not(.publish-btn-last)'
    ];
    for (const selector of selectors) {
      const list = Array.from(document.querySelectorAll(selector));
      const target = list.find(btn => isVisibleElement(btn) && (btn.textContent || '').trim() === '定时发布');
      if (target) return target;
    }
    return Array.from(document.querySelectorAll('button')).find(btn => {
      const cls = (btn.className || '').toString();
      return (btn.textContent || '').trim() === '定时发布'
        && cls.includes('publish-btn') && !cls.includes('publish-btn-last');
    }) || null;
  };
  const findScheduleModal = () => {
    return Array.from(document.querySelectorAll(
      '[role="dialog"], .byte-modal, .byte-modal-wrap, .byte-modal-content, [class*="picker"], [class*="calendar"], [class*="popover"]'
    )).find(el => {
      if (!isVisibleElement(el)) return false;
      const titleEl = el.querySelector('.byte-modal-title');
      const titleText = ((titleEl ? titleEl.textContent : '') || el.textContent || '').trim();
      return /(定时|发布时间|选择时间)/.test(titleText);
    }) || null;
  };
  const findScheduleModalButton = (modal, matcher) => {
    if (!modal) return null;
    const list = Array.from(modal.querySelectorAll('button'));
    return list.find(btn => isVisibleElement(btn) && matcher((btn.textContent || '').trim(), btn)) || null;
  };
  const findScheduleSelectTriggers = (modal) => {
    if (!modal) return [];
    const selectors = [
      '.byte-select-view',
      '.byte-select-trigger',
      '[class*="select"][class*="view"]',
      '[class*="select"][class*="trigger"]'
    ];
    for (const selector of selectors) {
      const list = Array.from(modal.querySelectorAll(selector)).filter(isVisibleElement);
      if (list.length >= 3) return list.slice(0, 3);
    }
    const fallbacks = Array.from(modal.querySelectorAll('input, button, div, span')).filter(el => {
      if (!isVisibleElement(el)) return false;
      const text = (el.textContent || '').trim();
      return /^\d{2}月\d{2}日$/.test(text) || /^\d{1,2}$/.test(text);
    });
    return fallbacks.slice(0, 3);
  };
  const pickDropdownOption = async (trigger, expectedText) => {
    if (!trigger || !expectedText) return false;
    clickScheduleElement(trigger);
    await delay(400);
    const findOption = () => {
      const selectors = [
        '.byte-select-option',
        '.byte-option',
        '[role="option"]',
        '.byte-dropdown-menu-item',
        '.byte-select-dropdown .byte-select-option-inner',
        '.byte-select-option-inner'
      ];
      for (const selector of selectors) {
        const list = Array.from(document.querySelectorAll(selector));
        const exact = list.find(el => isVisibleElement(el) && (el.textContent || '').trim() === expectedText);
        if (exact) return exact;
      }
      const generic = Array.from(document.querySelectorAll('li, div, span, button')).find(el => {
        if (!isVisibleElement(el)) return false;
        return (el.textContent || '').trim() === expectedText;
      });
      return generic || null;
    };
    const optionStart = Date.now();
    let option = null;
    while (Date.now() - optionStart < 5000) {
      option = findOption();
      if (option) break;
      await delay(200);
    }
    if (!option) return false;
    clickScheduleElement(option);
    await delay(500);
    return true;
  };

  const trySetSchedule = async (sendSet, sendTime) => {
    if (+sendSet !== 2 || !sendTime) return { ok: true, skipped: true };
    if (!window.isFeatureEnabled?.('FIX_TOUTIAO_UNIFY_INJECTION')) {
      return await trySetScheduleLegacy(sendSet, sendTime);
    }
    try {
      console.log(`${LOG_PREFIX} ⏰ 尝试设置定时发布:`, sendTime);
      const scheduleParts = parseScheduleParts(sendTime);
      if (!scheduleParts) {
        return { ok: false, reason: 'schedule-time-invalid', hint: String(sendTime || '') };
      }
      const scheduleBtn = findFooterScheduleButton();
      if (!scheduleBtn) return { ok: false, reason: 'schedule-btn-not-found' };
      clickScheduleElement(scheduleBtn);
      await delay(900);

      const modalStart = Date.now();
      let scheduleModal = null;
      while (Date.now() - modalStart < 8000) {
        scheduleModal = findScheduleModal();
        if (scheduleModal) break;
        await delay(300);
      }
      if (!scheduleModal) return { ok: false, reason: 'schedule-modal-not-opened' };
      const triggers = findScheduleSelectTriggers(scheduleModal);
      if (triggers.length < 3) {
        return {
          ok: false,
          reason: 'schedule-select-trigger-not-found',
          hint: (scheduleModal.textContent || '').trim().slice(0, 200)
        };
      }

      const pickedDay = await pickDropdownOption(triggers[0], scheduleParts.dayText);
      const pickedHour = await pickDropdownOption(triggers[1], scheduleParts.hourText);
      const pickedMinute = await pickDropdownOption(triggers[2], scheduleParts.minuteText);
      if (!pickedDay || !pickedHour || !pickedMinute) {
        return {
          ok: false,
          reason: 'schedule-option-pick-failed',
          hint: JSON.stringify({ expected: scheduleParts, pickedDay, pickedHour, pickedMinute })
        };
      }
      await delay(800);

      const confirmBtn = findScheduleModalButton(scheduleModal, (t) => {
        if (!t) return false;
        if (/取消|关闭|返回/.test(t)) return false;
        return t === '确定' || t === '确认' || t === '完成' || t === '发布' || t.includes('定时发布');
      });
      if (!confirmBtn || confirmBtn.disabled) {
        return {
          ok: false,
          reason: 'schedule-confirm-not-found',
          hint: (scheduleModal.textContent || '').trim().slice(0, 200)
        };
      }
      clickScheduleElement(confirmBtn);
      await delay(1000);
      console.log(`${LOG_PREFIX} ✅ 定时发布已设置:`, scheduleParts);
      return { ok: true, modal: true, confirmText: (confirmBtn.textContent || '').trim() };
    } catch (e) {
      return { ok: false, reason: 'schedule-exception', hint: e.message || String(e) };
    }
  };

  // 旧实现保留作降级路径（FIX_TOUTIAO_UNIFY_INJECTION 关掉时走这里）
  const trySetScheduleLegacy = async (sendSet, sendTime) => {
    if (+sendSet !== 2 || !sendTime) return { ok: true, skipped: true };
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
        return { ok: false, reason: 'schedule-input-not-found' };
      }
      setNativeValue(timeInput, sendTime);
      timeInput.dispatchEvent(new Event('input', { bubbles: true }));
      timeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await delay(300);
      console.log(`${LOG_PREFIX} ✅ 已写入定时时间`);
      return { ok: true, legacy: true };
    } catch (e) {
      console.warn(`${LOG_PREFIX} ⚠️ 定时发布设置失败，保持平台默认策略:`, e.message || e);
      return { ok: false, reason: 'schedule-exception', hint: e.message || String(e) };
    }
  };

  const waitForPublishResult = async (publishId, originalUrl, options = {}) => {
    const start = Date.now();
    // 接口成功信号(code=0)是主判据，超时仅作网络极慢时的兜底；对齐全平台统一放宽到 90s，避免误报 timeout
    const timeout = 90000;
    const allowAutoConfirm = options.allowAutoConfirm !== false;
    let autoConfirmClicked = false;
    let autoConfirmDetectedAt = 0;
    let lastToast = '';

    while (Date.now() - start < timeout) {
      await delay(1500);

      if (window.location.href !== originalUrl) {
        console.log(`${LOG_PREFIX} ✅ 页面已跳转，视为提交成功`);
        return { success: true, reason: 'url-changed', message: '' };
      }

      if (window.location.href.includes('/profile_v4/graphic/manage')) {
        console.log(`${LOG_PREFIX} ✅ 跳转到管理页，视为成功`);
        return { success: true, reason: 'manage-page', message: '' };
      }

      if (window.location.href.includes('/profile_v4/graphic/articles')) {
        console.log(`${LOG_PREFIX} ✅ 跳转到文章列表页，视为成功`);
        return { success: true, reason: 'articles-page', message: '' };
      }

      // 🔑 最强成功判据：发布接口 /mp/agw/article/publish 返回 code=0
      //    latestPublishApiSuccessAt 在 publishArticle 开头（发布流程启动时）已清零，
      //    因此这里 >0 必然代表「本次」发布接口成功、内容已提交。头条发布成功后经常不跳转、
      //    不弹成功 toast、也不消费 localStorage 标记，若不认这个接口信号，循环会空等到超时→误报失败。
      //    放在 explicitError 之前，确保接口权威成功优先于表现层的疑似错误提示。
      if (latestPublishApiSuccessAt > 0) {
        console.log(`${LOG_PREFIX} ✅ 检测到发布接口成功响应(code=0)，视为发布成功`);
        return { success: true, reason: 'publish-api-success', message: '' };
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
          return { success: true, reason: 'toast-success', message: toastText };
        }
        const isFailed = FAIL_TOAST_KEYWORDS.some(k => toastText.includes(k));
        if (isFailed) {
          return { success: false, reason: 'toast-failed', message: toastText };
        }
      }

      const currentKeyData = localStorage.getItem(getPublishSuccessKey());
      if (!currentKeyData) {
        console.log(`${LOG_PREFIX} ✅ 发布标记已被消费，视为成功`);
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
              autoConfirmClicked = true;
              await delay(900);
            }
          }
        }
      }
    }

    // 🔑 超时兜底（范式对齐小红书）：走到这里说明循环内既未判成功、也未 return 失败toast/失败接口。
    //    点击发布已提交，若无明确失败接口信号，视为发布成功，避免「发成功了只是没跳转/没弹提示」被误报 timeout 失败。
    if (!latestPublishApiFailure) {
      console.log(`${LOG_PREFIX} ✅ 超时未捕获明确失败信号，点击已提交，视为发布成功`);
      return { success: true, reason: 'timeout-no-failure', message: '' };
    }
    return { success: false, reason: 'timeout', message: lastToast || '发布超时，未检测到成功状态' };
  };

  const publishArticle = async (dataObj) => {
    if (publishRunning) {
      console.log(`${LOG_PREFIX} ⚠️ 发布流程正在进行，跳过重复调用`);
      return;
    }
    publishRunning = true;

    const publishId = dataObj?.video?.dyPlatform?.id;
    const originalUrl = window.location.href;

    try {
      startErrorListener();
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

      if (publishId) {
        try {
          const publishTaskTokenForSuccess = window.__CURRENT_PUBLISH_TASK_TOKEN__ || "task_default";
          localStorage.setItem(getPublishSuccessKey(), JSON.stringify({ publishId, taskToken: publishTaskTokenForSuccess }));
          if (window.browserAPI?.setGlobalData && currentWindowId) {
            await window.browserAPI.setGlobalData(`PUBLISH_SUCCESS_DATA_${currentWindowId}`, { publishId, taskToken: publishTaskTokenForSuccess });
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
      // 头条存在“预览并发布”二次确认，成功统计必须等待真实成功页或结果确认。

      // 实测头条为“预览并发布”两步流：预览层稳定后再点确认，避免 7050 保存失败
      let secondConfirmed = false;
      const previewReady = await waitPreviewConfirmReady(15000);
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
        secondConfirmed = true;
      }
      if (!secondConfirmed) {
        console.log(`${LOG_PREFIX} ℹ️ 未检测到可点击二次确认，进入结果等待阶段继续观察`);
      }

      const result = await waitForPublishResult(publishId, originalUrl, {
        allowAutoConfirm: !secondConfirmed
      });
      if (!result.success) {
        throw new Error(result.message || '发布失败');
      }

      hasProcessed = true;
      isProcessing = false;

      const urlChanged = window.location.href !== originalUrl;
      if (publishId && !urlChanged && typeof sendStatistics === 'function') {
        await sendStatistics(publishId, '头条发布', { taskToken: window.__CURRENT_PUBLISH_TASK_TOKEN__ || "task_default" });
      }

      if (!urlChanged) {
        await closeWindowWithMessage('发布成功，刷新数据', 1000);
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} ❌ 发布失败:`, error);
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

    const publishTaskToken = typeof window.resolvePublishTaskToken === 'function'
        ? window.resolvePublishTaskToken(dataObj, '发布')
        : (typeof window.buildPublishTaskToken === 'function'
            ? window.buildPublishTaskToken(dataObj, '发布')
            : 'task_default');
    if (typeof window.setCurrentPublishTaskToken === 'function') {
        window.setCurrentPublishTaskToken(publishTaskToken);
    } else {
        window.__CURRENT_PUBLISH_TASK_TOKEN__ = publishTaskToken;
    }


    // 🔴 将所有核心填表逻辑包装在一个函数中，便于外层兜底重试
    const executeAllFormSteps = async () => {
      const rawTitle = dataObj?.video?.video?.title || dataObj?.element?.title || '';
      const intro = dataObj?.video?.video?.intro || dataObj?.element?.intro || '';
      const rawContent = dataObj?.video?.video?.content || dataObj?.element?.content || intro;
      const title = normalizeTitleForPublish(rawTitle);
      const content = normalizeContentForPublish(rawContent, intro, title);
      const cover = dataObj?.video?.video?.cover || dataObj?.element?.image || '';
      const sendSet = dataObj?.video?.formData?.send_set ?? dataObj?.element?.formData?.send_set ?? 1;
      const sendTime = dataObj?.video?.formData?.send_time || dataObj?.video?.dyPlatform?.send_time || dataObj?.element?.formData?.send_time || '';

      // 在填写前重置草稿追踪状态，这样填写期间平台自动保存的草稿能被正确记录
      latestDraftSaveSuccessAt = 0;
      latestDraftSavePgcId = '0';

      await delay(1500);
      await fillTitle(title);
      // 🖼️🔗 【FIX_TOUTIAO_UNIFY_INJECTION】fillContent 必须拿到原始 HTML。
      // normalizeContentForPublish 的输出是 parsePlainTextFromHtml 拍平后的纯文本，
      // 传它进去 → fillContent 里 htmlForPaste 永远不含标签 → 图片/链接/列表三套逻辑全是死代码
      //（这是老文件里链接修复 v1-v3 即便执行也看不出效果的第二层原因）。
      // 仅当原始 HTML 的正文够长（不需要 normalize 兜底补测试文案）时才用原始 HTML。
      const rawContentIsRichAndLongEnough = typeof rawContent === 'string'
        && /[<>]/.test(rawContent)
        && (parsePlainTextFromHtml(rawContent) || '').trim().length >= 20;
      const contentForFill = (window.isFeatureEnabled?.('FIX_TOUTIAO_UNIFY_INJECTION') && rawContentIsRichAndLongEnough)
        ? rawContent
        : content;
      await fillContent(contentForFill, intro);
      await tryUploadCover(cover, title);
      // ⏰ 定时设置失败必须中断：否则头条会按面板默认时间（当前时间）立即发出去，
      // 而日志里全是 ✅（小红书踩过同款坑，见 memory: xhs-schedule-picker-diagnosis）
      const scheduleResult = await trySetSchedule(sendSet, sendTime);
      if (scheduleResult && scheduleResult.ok === false) {
        const scheduleHint = scheduleResult.hint ? ` / ${String(scheduleResult.hint).slice(0, 160)}` : '';
        throw new Error(`定时发布设置失败: ${scheduleResult.reason || 'unknown'}${scheduleHint}`);
      }

      // 检查填写期间平台是否已经自动保存了草稿（ProseMirror dispatch 会立刻触发平台的自动保存）
      let draftSaved = latestDraftSaveSuccessAt > 0 && latestDraftSavePgcId !== '0';
      if (draftSaved) {
        console.log(`${LOG_PREFIX} ✅ 填写期间平台已自动保存草稿，pgc_id: ${latestDraftSavePgcId}`);
      } else {
        // 触发编辑器 blur，促使平台自动保存草稿
        const editorForBlur = findVisibleEditable();
        if (editorForBlur) {
          editorForBlur.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
          console.log(`${LOG_PREFIX} 📤 已触发编辑器 blur，等待平台自动保存草稿...`);
        }

        // 等待草稿保存成功（监控 /mp/agw/draft/save_ugc_draft 响应）
        draftSaved = await waitForDraftSave(12000);
      }
      if (!draftSaved) {
        // 二次尝试：通过 ProseMirror dispatch 制造一次真实的 state 变更来强制触发保存
        console.log(`${LOG_PREFIX} 🔄 草稿未保存，尝试 ProseMirror state 变更触发保存...`);
        const editorRetry = findVisibleEditable();
        if (editorRetry) {
          try {
            const pmNode = editorRetry.closest('.ProseMirror') || editorRetry;
            const view = pmNode.pmViewDesc?.view;
            if (view) {
              // 在末尾插入空格再撤销，ProseMirror 会检测到 state 变化并触发保存
              const { state } = view;
              const endPos = state.doc.content.size;
              const trInsert = state.tr.insertText(' ', endPos);
              view.dispatch(trInsert);
              await delay(200);
              const trUndo = view.state.tr.delete(view.state.doc.content.size - 1, view.state.doc.content.size);
              view.dispatch(trUndo);
              await delay(300);
              editorRetry.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
            } else {
              // fallback: 用 execCommand
              editorRetry.focus();
              document.execCommand('insertText', false, ' ');
              await delay(200);
              document.execCommand('undo', false);
              await delay(300);
              editorRetry.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
            }
          } catch (e) {
            console.warn(`${LOG_PREFIX} ⚠️ ProseMirror 变更触发失败:`, e.message);
            editorRetry.focus();
            document.execCommand('insertText', false, ' ');
            await delay(200);
            document.execCommand('undo', false);
            await delay(300);
            editorRetry.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
          }
        }
        draftSaved = await waitForDraftSave(10000);
      }
      if (!draftSaved) {
        // 第三次尝试：焦点切换
        console.log(`${LOG_PREFIX} 🔄 草稿仍未保存，尝试焦点切换触发保存...`);
        const titleInput = findTitleInput();
        if (titleInput) {
          titleInput.focus();
          await delay(300);
          titleInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        }
        draftSaved = await waitForDraftSave(8000);
      }

      if (!draftSaved) {
        const errMsg = `草稿保存失败（pgc_id=${latestDraftSavePgcId}），无法继续发布。正文内容可能未被编辑器正确识别`;
        console.error(`${LOG_PREFIX} ❌ ${errMsg}`);
        throw new Error(errMsg);
      }

      await publishArticle(dataObj);
    };
    // ===== 原有逻辑结束 =====

    // 🔴 最外层兜底重试：即使单步骤重试都失败，外层还会重试整个流程2次
    try {
      await retryOperation(executeAllFormSteps, 2, 3000);
      console.log('[头条发布] ✅ 所有表单填写完成');
    } catch (finalError) {
      console.error('[头条发布] ❌ 填表流程失败（外层重试2次后）:', finalError);
      stopErrorListener?.();
      const publishId = dataObj?.video?.dyPlatform?.id;
      if (publishId && typeof sendStatisticsError === 'function') {
        await sendStatisticsError(publishId, finalError.message || '填写表单失败', '头条发布', finalError);
      }
      await closeWindowWithMessage('填写表单失败，刷新数据', 1000);
    } finally {
      fillFormRunning = false;
    }
  }

  console.log('═══════════════════════════════════════');
  console.log('✅ 头条发布脚本已注入');
  console.log('📍 当前 URL:', window.location.href);
  console.log('🕐 注入时间:', new Date().toLocaleString());
  console.log('═══════════════════════════════════════');

  if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
    console.error(`${LOG_PREFIX} ❌ common.js 未加载！脚本可能无法正常工作`);
  } else {
    console.log(`${LOG_PREFIX} ✅ common.js 已加载，工具函数可用`);
  }

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

  const urlParams = new URLSearchParams(window.location.search);
  const companyId = await window.browserAPI.getGlobalData('company_id');
  const transferId = urlParams.get('transfer_id');

  try {
    currentWindowId = await window.browserAPI.getWindowId();
    console.log(`${LOG_PREFIX} 当前窗口 ID:`, currentWindowId);
  } catch (e) {
    console.error(`${LOG_PREFIX} ❌ 获取窗口 ID 失败:`, e);
  }

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

  console.log(`${LOG_PREFIX} 页面加载完成，发送 页面加载完成 消息`);
  sendMessageToParent('页面加载完成');

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
