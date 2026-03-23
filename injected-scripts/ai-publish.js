/**
 * AI 智能发布脚本
 * 通过 AI 分析页面 DOM 结构，自动识别表单并填写发布
 * 依赖: common.js（需在 scripts-config.json 中配置为前置依赖）
 */
(async function () {
  'use strict';

  const LOG_PREFIX = '[AI发布]';
  const AI_PUBLISH_FALLBACK_CONFIG = {
    publishMonitorTimeoutMs: 120000,
    publishMonitorPollIntervalMs: 5000,
  };
  const DOM_SNAPSHOT_LIMITS = {
    normal: {
      maxElements: 70,
      maxButtons: 18,
      maxNotices: 8,
      textLength: 40,
      valueLength: 60,
      noticeTextLength: 100,
    },
    compact: {
      maxElements: 35,
      maxButtons: 8,
      maxNotices: 5,
      textLength: 24,
      valueLength: 36,
      noticeTextLength: 60,
    },
  };

  // 防止重复执行
  if (window.__AI_PUBLISH_LOADED__) {
    console.log(`${LOG_PREFIX} 脚本已加载，跳过`);
    return;
  }
  window.__AI_PUBLISH_LOADED__ = true;

  console.log(`${LOG_PREFIX} ✅ AI 智能发布脚本已加载`);
  console.log(`${LOG_PREFIX} 页面 URL: ${window.location.href}`);

  function detectCurrentPlatform() {
    const href = String(window.location.href || '').toLowerCase();
    if (href.includes('douyin.com')) return 'douyin';
    if (href.includes('xiaohongshu.com')) return 'xiaohongshu';
    if (href.includes('zhihu.com')) return 'zhihu';
    if (href.includes('baijiahao.baidu.com')) return 'baijiahao';
    return 'generic';
  }

  function getAiPublishRuntimeConfig() {
    const platform = detectCurrentPlatform();
    const externalConfig = window.__AI_PUBLISH_RUNTIME_CONFIG__ || {};
    const defaultConfig = externalConfig.default || {};
    const platformOverrides = externalConfig.platformOverrides || {};
    return {
      ...AI_PUBLISH_FALLBACK_CONFIG,
      ...defaultConfig,
      ...(platformOverrides[platform] || {}),
      platform,
    };
  }

  function showAiUserNotice(title, message, level = 'warn') {
    try {
      let root = document.getElementById('__ai_user_notice__');
      if (!root) {
        root = document.createElement('div');
        root.id = '__ai_user_notice__';
        root.style.cssText = [
          'position:fixed',
          'top:72px',
          'right:16px',
          'width:360px',
          'max-width:calc(100vw - 32px)',
          'padding:14px 16px',
          'border-radius:12px',
          'box-shadow:0 12px 32px rgba(15,23,42,0.28)',
          'z-index:2147483647',
          'font-size:14px',
          'line-height:1.5',
          'color:#fff',
          'background:rgba(17,24,39,0.96)',
          'border:1px solid rgba(255,255,255,0.12)',
        ].join(';');
        document.documentElement.appendChild(root);
      }

      const palette = level === 'error'
        ? { border: '#ef4444', title: '#fecaca' }
        : { border: '#f59e0b', title: '#fde68a' };

      root.style.borderColor = palette.border;
      root.innerHTML = `
        <div style="font-weight:700;color:${palette.title};margin-bottom:6px;">${title}</div>
        <div style="white-space:pre-wrap;">${message}</div>
      `;
    } catch (error) {
      console.warn(`${LOG_PREFIX} ⚠️ 渲染用户提示失败:`, error);
    }
  }

  function notifyManualIntervention(reason, details = {}) {
    const message = String(reason || '当前步骤需要人工处理').trim();
    console.warn(`${LOG_PREFIX} 👤 需要用户人工介入: ${message}`, details);
    showAiUserNotice('需要你接管一下', `${message}\n请在当前页面补充填写后，再继续发布。`, 'warn');

    if (window.browserAPI && typeof window.browserAPI.sendToHome === 'function') {
      window.browserAPI.sendToHome({
        type: 'ai-publish-manual-required',
        reason: message,
        details,
        url: window.location.href,
        timestamp: Date.now(),
      });
    }
  }

  function notifyHumanWaiting(reason, details = {}) {
    const message = String(reason || '当前步骤需要你先完成验证').trim();
    console.warn(`${LOG_PREFIX} ⌛ 等待用户完成验证: ${message}`, details);
    showAiUserNotice('等待你完成验证', `${message}\nAI 会持续检测，完成后自动继续。`, 'warn');

    if (window.browserAPI && typeof window.browserAPI.sendToHome === 'function') {
      window.browserAPI.sendToHome({
        type: 'ai-publish-human-waiting',
        reason: message,
        details,
        url: window.location.href,
        timestamp: Date.now(),
      });
    }
  }

  function getPublishId() {
    const publishData = window.__AUTH_DATA__?.message;
    return publishData?.video?.dyPlatform?.id || publishData?.id || 'unknown';
  }

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
  function extractPageStructure(mode = 'normal') {
    const limits = DOM_SNAPSHOT_LIMITS[mode] || DOM_SNAPSHOT_LIMITS.normal;
    const candidates = [];
    const seenSelectors = new Set();
    let rawElementCount = 0;
    let keptButtonCount = 0;

    function limitText(value, maxLength) {
      const text = String(value || '').trim().replace(/\s+/g, ' ');
      return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
    }

    function getElementPriority(el, info) {
      const text = `${info.label || ''} ${info.placeholder || ''} ${info.text || ''}`.toLowerCase();
      if (info.type === 'file') return 100;
      if (info.contenteditable || info.tag === 'textarea') return 95;
      if (info.tag === 'input' && !['checkbox', 'radio', 'submit', 'button'].includes(info.type || '')) return 90;
      if (info.tag === 'select') return 85;
      if (/发布|提交|保存|下一步|定时|封面|话题|标签|分类|标题|简介|描述/.test(text)) return 80;
      if (info.tag === 'button' || info.type === 'submit') return 40;
      return 20;
    }

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
      rawElementCount++;

      const info = {
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        selector: generateSelector(el),
        label: findLabel(el),
        placeholder: el.placeholder || '',
        value: limitText(el.value || '', limits.valueLength),
        text: limitText(el.textContent || '', limits.textLength),
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

      if (!info.selector || seenSelectors.has(info.selector)) return;

      const priority = getElementPriority(el, info);
      if ((info.tag === 'button' || info.type === 'submit' || info.type === 'button') && priority < 80) {
        if (keptButtonCount >= limits.maxButtons) return;
        keptButtonCount++;
      }

      seenSelectors.add(info.selector);
      candidates.push({ ...info, priority });
    });

    // 也提取页面上的提示信息（toast、alert、错误提示等）
    const notices = [];
    const seenNoticeSelectors = new Set();
    document.querySelectorAll(
      '[class*="toast"], [class*="Toast"], [class*="notice"], [class*="Notice"], ' +
      '[class*="alert"], [class*="Alert"], [class*="error"], [class*="Error"], ' +
      '[class*="success"], [class*="Success"], [class*="message"], [class*="Message"], ' +
      '[role="alert"], [role="status"]'
    ).forEach(el => {
      const text = limitText(el.textContent || '', limits.noticeTextLength);
      const selector = generateSelector(el);
      if (text.length > 0 && isVisible(el) && selector && !seenNoticeSelectors.has(selector)) {
        seenNoticeSelectors.add(selector);
        notices.push({ text, selector });
      }
    });

    candidates.sort((a, b) => b.priority - a.priority);
    const elements = candidates.slice(0, limits.maxElements).map(({ priority, ...info }) => info);

    return {
      url: window.location.href,
      title: limitText(document.title, 60),
      snapshotMode: mode,
      rawElementCount,
      elementCount: elements.length,
      elements,
      notices: notices.slice(0, limits.maxNotices),
      truncated: rawElementCount > elements.length || notices.length > limits.maxNotices,
    };
  }

  function isContextWindowLimitError(error) {
    const message = String(error || '').toLowerCase();
    return (
      message.includes('context window limit') ||
      message.includes('maximum number of input and output tokens') ||
      message.includes('tokens exceeded') ||
      message.includes('code":"5021')
    );
  }

  function detectMediaKind(publishData, action = {}) {
    const explicitType = String(
      publishData?.contentType
      || action.mediaType
      || action.field
      || ''
    ).toLowerCase();

    if (/(image|cover|article|photo|picture)/.test(explicitType)) {
      return 'image';
    }

    if (/(video|movie|clip)/.test(explicitType)) {
      return 'video';
    }

    const sourceUrl = String(
      publishData?.sourceUrl
      || publishData?.video?.video?.url
      || publishData?.video?.video?.cover
      || publishData?.element?.image
      || publishData?.element?.image_url
      || publishData?.element?.imageUrl
      || ''
    ).toLowerCase();

    if (/\.(png|jpe?g|webp|bmp|gif)(\?|$)/.test(sourceUrl)) {
      return 'image';
    }

    return 'video';
  }

  async function handleUploadAction(action, publishData) {
    const mediaKind = detectMediaKind(publishData, action);
    console.log(`${LOG_PREFIX} 📤 准备执行上传: ${action.description || action.selector} | mediaKind=${mediaKind}`);

    const targetInput = document.querySelector(action.selector);
    if (!targetInput) {
      return { success: false, error: `上传元素未找到: ${action.selector}` };
    }

    if (mediaKind === 'image') {
      if (typeof window.uploadImage !== 'function') {
        return { success: false, error: 'uploadImage 未定义' };
      }
      await window.uploadImage(publishData);
    } else {
      if (typeof window.uploadVideo !== 'function') {
        return { success: false, error: 'uploadVideo 未定义' };
      }
      await window.uploadVideo(publishData);
    }

    return {
      success: true,
      uploaded: true,
      mediaKind,
      selector: action.selector,
      field: action.field,
    };
  }

  function isElementActionable(el) {
    if (!el) return false;
    if (el.disabled || el.getAttribute('disabled') !== null) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function normalizeText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function collectElementMeta(el) {
    if (!el) return {};
    const rect = el.getBoundingClientRect();
    return {
      tag: (el.tagName || '').toLowerCase(),
      type: String(el.type || '').toLowerCase(),
      text: normalizeText(el.textContent || el.innerText || ''),
      label: normalizeText(findLabel(el)),
      placeholder: normalizeText(el.getAttribute?.('placeholder') || ''),
      ariaLabel: normalizeText(el.getAttribute?.('aria-label') || ''),
      nearbyText: normalizeText(getNearbyText(el)),
      name: normalizeText(el.getAttribute?.('name') || ''),
      className: normalizeText(typeof el.className === 'string' ? el.className : ''),
      width: rect.width || 0,
      height: rect.height || 0,
      area: (rect.width || 0) * (rect.height || 0),
    };
  }

  function getActionIntent(action) {
    const text = normalizeText([
      action?.description,
      action?.field,
      action?.selector,
      action?.value,
    ].filter(Boolean).join(' '));

    if (/标题|title|caption/.test(text)) return 'title';
    if (/简介|描述|正文|内容|intro|description|content|text|summary/.test(text)) return 'content';
    if (/发布|提交|确认发布|立即发布|publish|submit/.test(text)) return 'publish';
    if (/定时|时间|schedule|time/.test(text)) return 'schedule';
    if (/合集|分类|category|label|collection/.test(text)) return 'category';
    if (/话题|标签|tag|topic|keyword|热点/.test(text)) return 'tag';
    if (/位置|地点|location|place/.test(text)) return 'location';
    if (/封面|图片|image|cover|photo/.test(text)) return 'image';
    if (/视频|video|upload/.test(text)) return 'video';
    if (/公开|私密|权限|保存到|允许|不允许/.test(text)) return 'option';
    return 'generic';
  }

  function scoreElementForAction(el, action) {
    if (!el) return -Infinity;

    const meta = collectElementMeta(el);
    const intent = getActionIntent(action);
    const haystack = [
      meta.text,
      meta.label,
      meta.placeholder,
      meta.ariaLabel,
      meta.nearbyText,
      meta.name,
      meta.className,
    ].join(' ');
    const selectorText = normalizeText(action?.selector);
    const descriptionText = normalizeText(action?.description);
    const actionValue = normalizeText(action?.value);

    let score = 0;

    if (selectorText) {
      try {
        if (generateSelector(el) === action.selector) score += 40;
      } catch (e) {
        // ignore
      }
    }

    if (descriptionText && haystack.includes(descriptionText)) score += 25;
    if (actionValue && haystack.includes(actionValue)) score += 15;
    if (isElementActionable(el)) score += 10;
    if (meta.label) score += 6;
    if (meta.placeholder) score += 6;

    if (intent === 'title') {
      if (/(标题|title|caption)/.test(haystack)) score += 60;
      if (meta.tag === 'input' || meta.tag === 'textarea') score += 25;
    } else if (intent === 'content') {
      if (/(简介|正文|描述|内容|intro|description|content|summary)/.test(haystack)) score += 60;
      if (el.getAttribute('contenteditable') === 'true' || meta.tag === 'textarea') score += 30;
    } else if (intent === 'publish') {
      if (/(发布|提交|确认发布|立即发布|publish|submit)/.test(haystack)) score += 90;
      if (meta.tag === 'button' || el.getAttribute('role') === 'button') score += 35;
    } else if (intent === 'schedule') {
      if (/(时间|日期|定时|schedule|time|date)/.test(haystack)) score += 55;
      if (meta.tag === 'input' || meta.tag === 'select') score += 15;
    } else if (intent === 'category') {
      if (/(合集|分类|category|label|collection)/.test(haystack)) score += 55;
      if (meta.tag === 'select') score += 20;
    } else if (intent === 'tag') {
      if (/(话题|标签|tag|topic|keyword|热点)/.test(haystack)) score += 55;
      if (meta.tag === 'input' || meta.tag === 'textarea' || el.getAttribute('contenteditable') === 'true') score += 15;
    } else if (intent === 'location') {
      if (/(位置|地点|location|place|地理)/.test(haystack)) score += 55;
      if (meta.tag === 'input' || meta.tag === 'select') score += 15;
    } else if (intent === 'option') {
      if (descriptionText && haystack.includes(descriptionText)) score += 40;
      if (meta.tag === 'input' || meta.tag === 'label' || el.getAttribute('role') === 'button') score += 20;
    }

    if (action?.action === 'fill' || action?.action === 'fill_rich') {
      if (meta.tag === 'input' || meta.tag === 'textarea' || el.getAttribute('contenteditable') === 'true') score += 20;
      if (meta.type === 'file' || meta.tag === 'button') score -= 25;
    }

    if (action?.action === 'click' || action?.action === 'check' || action?.action === 'publish') {
      if (meta.tag === 'button' || el.getAttribute('role') === 'button' || meta.tag === 'label') score += 20;
    }

    if (action?.action === 'select') {
      if (meta.tag === 'select') score += 30;
      if (/(下拉|选择|select)/.test(haystack)) score += 25;
    }

    if (!isVisible(el) && meta.type !== 'file') {
      score -= 40;
    }

    if (meta.area > 250000) score -= 120;
    else if (meta.area > 120000) score -= 80;
    else if (meta.area > 60000) score -= 40;

    if (intent === 'publish') {
      if (meta.tag === 'div' || meta.tag === 'span') score -= 60;
      if (!(meta.tag === 'button' || el.getAttribute('role') === 'button')) {
        const buttonAncestor = el.closest('button, [role="button"]');
        if (buttonAncestor) score += 15;
        else score -= 40;
      }
      if (meta.height > 120 || meta.width > 500) score -= 40;
      if (meta.text.length > 80) score -= 40;
      if (!/(发布|立即发布|确认发布|publish|submit)/.test(meta.text)) score -= 20;
      if (/发布时间|定时发布|立即发布/.test(meta.text) && !/^发布$/.test(meta.text)) score -= 30;
    }

    return score;
  }

  function getCandidatesForAction(action) {
    const intent = getActionIntent(action);
    const selectorMap = {
      title: 'input, textarea, [contenteditable="true"]',
      content: 'textarea, [contenteditable="true"], input',
      publish: 'button, [role="button"], input[type="button"], input[type="submit"]',
      schedule: 'input, select, [role="button"], button',
      category: 'select, [role="button"], button, input',
      tag: 'input, textarea, [contenteditable="true"], [role="button"], button',
      location: 'input, select, [role="button"], button',
      option: 'input, label, [role="button"], button, span, div',
      generic: 'input, textarea, select, [contenteditable="true"], button, [role="button"], label, span, div',
    };
    const selector = selectorMap[intent] || selectorMap.generic;
    return Array.from(document.querySelectorAll(selector));
  }

  function resolvePublishElement(selector) {
    const candidates = [];

    if (selector) {
      const direct = document.querySelector(selector);
      if (direct) {
        candidates.push(direct);
        const closestButton = direct.closest('button, [role="button"], .button-dhlUZE');
        if (closestButton && closestButton !== direct) {
          candidates.push(closestButton);
        }
      }
    }

    const textMatchers = [/^发布$/, /发布作品/, /确认发布/];
    const buttonCandidates = Array.from(document.querySelectorAll('button, [role="button"], .button-dhlUZE, input[type="button"], input[type="submit"]'));
    buttonCandidates.forEach(btn => {
      const text = (btn.textContent || btn.value || '').trim();
      if (textMatchers.some(pattern => pattern.test(text))) {
        candidates.push(btn);
      }
    });

    const scored = candidates
      .map(candidate => ({ candidate, score: scoreElementForAction(candidate, { action: 'publish', description: '发布按钮', selector }) }))
      .sort((a, b) => b.score - a.score);

    return scored[0]?.candidate || null;
  }

  function getRankedPublishCandidates(selector = '') {
    const candidates = [];

    if (selector) {
      try {
        const direct = document.querySelector(selector);
        if (direct) {
          candidates.push(direct);
          const closestButton = direct.closest('button, [role="button"], .button-dhlUZE');
          if (closestButton && closestButton !== direct) {
            candidates.push(closestButton);
          }
        }
      } catch (error) {
        console.warn(`${LOG_PREFIX} ⚠️ publish selector 无效: ${selector}`, error);
      }
    }

    const textMatchers = [/^发布$/, /发布作品/, /确认发布/];
    const buttonCandidates = Array.from(document.querySelectorAll('button, [role="button"], .button-dhlUZE, input[type="button"], input[type="submit"]'));
    buttonCandidates.forEach(btn => {
      const text = (btn.textContent || btn.value || '').trim();
      if (textMatchers.some(pattern => pattern.test(text))) {
        candidates.push(btn);
      }
    });

    const textNodes = Array.from(document.querySelectorAll('span, div'));
    textNodes.forEach(node => {
      const text = (node.textContent || '').trim();
      if (!textMatchers.some(pattern => pattern.test(text))) return;
      const closestButton = node.closest('button, [role="button"], .button-dhlUZE');
      if (closestButton) {
        candidates.push(closestButton);
      }
    });

    return Array.from(new Set(candidates))
      .map(candidate => ({
        candidate,
        score: scoreElementForAction(candidate, { action: 'publish', description: '发布按钮', selector }),
      }))
      .sort((a, b) => b.score - a.score);
  }

  function findBestPublishClickTarget(baseEl) {
    if (!baseEl) return null;

    const candidates = [];
    if (baseEl.matches('button, [role="button"], .button-dhlUZE, input[type="button"], input[type="submit"]')) {
      candidates.push(baseEl);
    }

    const closestButton = baseEl.closest('button, [role="button"], .button-dhlUZE');
    if (closestButton && closestButton !== baseEl) {
      candidates.push(closestButton);
    }

    const descendants = Array.from(baseEl.querySelectorAll?.('button, [role="button"], .button-dhlUZE, input[type="button"], input[type="submit"], span, div') || []);
    descendants.forEach(el => {
      const text = (el.textContent || '').trim();
      if (/^发布$|发布作品|确认发布/.test(text)) {
        if (el.matches('button, [role="button"], .button-dhlUZE, input[type="button"], input[type="submit"]')) {
          candidates.push(el);
        }
        const nestedButton = el.closest('button, [role="button"], .button-dhlUZE');
        if (nestedButton) {
          candidates.push(nestedButton);
        }
      }
    });

    const scored = Array.from(new Set(candidates))
      .map(candidate => ({
        candidate,
        score: scoreElementForAction(candidate, { action: 'publish', description: '发布按钮', selector: generateSelector(baseEl) }),
      }))
      .sort((a, b) => b.score - a.score);

    return scored[0]?.candidate || baseEl;
  }

  function getRankedCandidates(action) {
    const selector = action?.selector || '';
    const candidates = [];

    if (selector) {
      try {
        const direct = document.querySelector(selector);
        if (direct) {
          candidates.push(direct);
          const clickableAncestor = direct.closest('button, [role="button"], label, .semi-radio, .semi-checkbox');
          if (clickableAncestor && clickableAncestor !== direct) {
            candidates.push(clickableAncestor);
          }
        }
      } catch (error) {
        console.warn(`${LOG_PREFIX} ⚠️ selector 无效: ${selector}`, error);
      }
    }

    getCandidatesForAction(action).forEach(candidate => candidates.push(candidate));

    return Array.from(new Set(candidates))
      .map(candidate => ({ candidate, score: scoreElementForAction(candidate, action) }))
      .filter(item => item.score > -Infinity)
      .sort((a, b) => b.score - a.score);
  }

  function resolveActionElement(action) {
    const scored = getRankedCandidates(action);

    const top = scored[0];
    if (top) {
      console.log(`${LOG_PREFIX} 🔎 动态定位元素: action=${action?.action}, intent=${getActionIntent(action)}, score=${top.score}, selector=${generateSelector(top.candidate)}`);
      return top.candidate;
    }

    return null;
  }

  function getCandidateLogLabel(candidateItem, index) {
    if (!candidateItem?.candidate) {
      return `候选#${index + 1}`;
    }

    try {
      return `候选#${index + 1}(score=${candidateItem.score}, selector=${generateSelector(candidateItem.candidate)})`;
    } catch (error) {
      return `候选#${index + 1}(score=${candidateItem.score})`;
    }
  }

  async function tryCandidates(action, executor, options = {}) {
    const rankedCandidates = getRankedCandidates(action);
    const {
      minScore = -Infinity,
      maxAttempts = 3,
      actionName = action?.action || '动作',
    } = options;

    const filteredCandidates = rankedCandidates.filter(item => item.score >= minScore).slice(0, maxAttempts);

    if (filteredCandidates.length === 0) {
      return { success: false, error: `未找到可执行${actionName}的候选元素` };
    }

    const errors = [];
    for (let i = 0; i < filteredCandidates.length; i++) {
      const candidateItem = filteredCandidates[i];
      const label = getCandidateLogLabel(candidateItem, i);
      console.log(`${LOG_PREFIX} 🧪 尝试${actionName}${label}`);

      try {
        const result = await executor(candidateItem.candidate, candidateItem, i);
        if (result?.success === false) {
          errors.push(`${label}: ${result.error || result.message || '执行失败'}`);
          continue;
        }

        console.log(`${LOG_PREFIX} ✅ ${actionName}${label}执行成功`);
        return {
          success: true,
          candidate: candidateItem.candidate,
          candidateScore: candidateItem.score,
          attemptIndex: i,
          ...(result || {}),
        };
      } catch (error) {
        const message = error?.message || String(error);
        console.warn(`${LOG_PREFIX} ⚠️ ${actionName}${label}执行失败: ${message}`);
        errors.push(`${label}: ${message}`);
      }
    }

    return {
      success: false,
      error: errors.join(' | ') || `${actionName}候选重试全部失败`,
    };
  }

  async function fillInputElement(el, value) {
    const nextValue = value == null ? '' : String(value);
    el.focus();
    await sleep(80);

    if (window.setNativeValue) {
      window.setNativeValue(el, nextValue);
    } else {
      el.value = nextValue;
    }

    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: nextValue,
    }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    await sleep(120);

    const currentValue = String(el.value || '').trim();
    if (currentValue !== nextValue.trim()) {
      throw new Error(`输入校验失败: 期望"${nextValue.trim()}", 实际"${currentValue}"`);
    }
  }

  async function fillRichTextElement(el, value) {
    const nextValue = value == null ? '' : String(value);
    el.focus();
    await sleep(80);
    el.innerHTML = '';
    el.textContent = '';

    if (document.execCommand) {
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, nextValue);
    } else {
      el.textContent = nextValue;
    }

    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: nextValue,
    }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(120);

    const currentText = String(el.textContent || el.innerText || '').trim();
    if (nextValue.trim() && !currentText.includes(nextValue.trim().slice(0, Math.min(20, nextValue.trim().length)))) {
      throw new Error(`富文本校验失败: 未检测到目标内容`);
    }
  }

  async function performActionClick(el, description = '元素') {
    if (!el) {
      return { success: false, message: `${description}不存在` };
    }

    try {
      el.scrollIntoView({ block: 'center', inline: 'center' });
      await sleep(200);
    } catch (e) {
      // ignore
    }

    try {
      if (typeof el.click === 'function') {
        el.click();
      } else {
        throw new Error('element.click 不可用');
      }
      await sleep(200);
      return { success: true, message: '直接 click 成功' };
    } catch (error) {
      console.warn(`${LOG_PREFIX} ⚠️ 直接 click 失败，切换 trusted click:`, error);
    }

    return performTrustedClickFallback(el, description);
  }

  function getElementCenter(el) {
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      rect,
    };
  }

  function summarizeElement(el) {
    if (!el) return null;

    const rect = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      text: String(el.textContent || '').trim().slice(0, 120),
      className: typeof el.className === 'string' ? el.className.slice(0, 200) : '',
      id: el.id || '',
      disabled: !!(el.disabled || el.getAttribute('disabled') !== null),
      selector: (() => {
        try {
          return generateSelector(el);
        } catch (error) {
          return '';
        }
      })(),
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  }

  function showClickDiagnosticPoint(x, y, label = 'AI') {
    try {
      const point = document.createElement('div');
      point.className = '__ai_click_diagnostic_point__';
      point.style.cssText = [
        'position:fixed',
        `left:${Math.round(x) - 8}px`,
        `top:${Math.round(y) - 8}px`,
        'width:16px',
        'height:16px',
        'border-radius:999px',
        'background:#ff2d55',
        'border:2px solid #fff',
        'box-shadow:0 0 0 2px rgba(255,45,85,0.35)',
        'z-index:2147483647',
        'pointer-events:none',
      ].join(';');

      const tag = document.createElement('div');
      tag.textContent = label;
      tag.style.cssText = [
        'position:fixed',
        `left:${Math.round(x) + 12}px`,
        `top:${Math.round(y) - 12}px`,
        'padding:2px 6px',
        'border-radius:6px',
        'background:rgba(17,24,39,0.92)',
        'color:#fff',
        'font-size:12px',
        'line-height:1.2',
        'z-index:2147483647',
        'pointer-events:none',
      ].join(';');

      document.documentElement.appendChild(point);
      document.documentElement.appendChild(tag);

      setTimeout(() => {
        point.remove();
        tag.remove();
      }, 2500);
    } catch (error) {
      console.warn(`${LOG_PREFIX} ⚠️ 绘制点击诊断点失败:`, error);
    }
  }

  function logClickDiagnostics(targetEl, description = '目标按钮') {
    if (!targetEl) {
      console.warn(`${LOG_PREFIX} ⚠️ 无法记录点击诊断，目标元素为空: ${description}`);
      return;
    }

    const { x, y } = getElementCenter(targetEl);
    const hitElement = document.elementFromPoint(x, y);
    showClickDiagnosticPoint(x, y, 'AI');

    console.log(`${LOG_PREFIX} 🎯 点击诊断[${description}] 目标元素:`, summarizeElement(targetEl));
    console.log(`${LOG_PREFIX} 🎯 点击诊断[${description}] elementFromPoint命中:`, summarizeElement(hitElement));

    if (hitElement && hitElement !== targetEl) {
      const targetContainsHit = targetEl.contains(hitElement);
      const hitContainsTarget = hitElement.contains(targetEl);
      console.log(`${LOG_PREFIX} 🎯 点击诊断[${description}] 命中关系:`, {
        targetContainsHit,
        hitContainsTarget,
      });
    }
  }

  function diagnosePublishReadiness(targetEl) {
    if (!targetEl) {
      return { ready: false, reason: '目标元素为空' };
    }

    const summary = summarizeElement(targetEl);
    const hitElement = document.elementFromPoint(
      Math.round(summary.rect.left + summary.rect.width / 2),
      Math.round(summary.rect.top + summary.rect.height / 2)
    );

    const diagnostics = {
      summary,
      hitElement: summarizeElement(hitElement),
      disabled: summary.disabled,
      visible: isVisible(targetEl),
      text: summary.text,
    };

    if (summary.disabled) {
      return { ready: false, reason: '按钮处于 disabled 状态', diagnostics };
    }

    if (!isVisible(targetEl)) {
      return { ready: false, reason: '按钮当前不可见', diagnostics };
    }

    return { ready: true, diagnostics };
  }

  async function dismissBlockingOverlays() {
    const overlaySelectors = ['.semi-modal-content', '[role="dialog"]', '.semi-modal', '.semi-popover', '.semi-portal'];
    const dismissTexts = ['暂不设置', '以后再说', '我知道了', '知道了', '关闭', '取消', '稍后', '跳过'];
    const overlayHints = ['设置竖封面', '竖封面获取更多流量', '搜索场景获流预览', '个人页获客预览'];
    let closedCount = 0;

    for (const selector of overlaySelectors) {
      const overlays = Array.from(document.querySelectorAll(selector));
      for (const overlay of overlays) {
        if (!isVisible(overlay)) continue;
        const overlayText = normalizeText(overlay.textContent || '');
        const buttons = Array.from(overlay.querySelectorAll('button, [role="button"], span, div'));
        const rankedButtons = buttons
          .filter(btn => isVisible(btn))
          .map((btn) => {
            const text = normalizeText(btn.textContent || '');
            const className = String(btn.className || '');
            let score = 0;

            if (text && dismissTexts.some(keyword => text.includes(normalizeText(keyword)))) score += 40;
            if (/close|dismiss|cancel/.test(className)) score += 20;
            if (/^(x|×)$/.test(text)) score += 30;
            if (/设置竖封面|竖封面获取更多流量/.test(overlayText) && /暂不设置|取消|关闭|x|×/.test(text || '')) score += 25;
            if (/设置竖封面/.test(text) || /知道了/.test(text) && /设置竖封面|竖封面获取更多流量/.test(overlayText)) score -= 20;

            return { btn, text, score };
          })
          .sort((a, b) => b.score - a.score);

        let dismissBtn = rankedButtons.find(item => item.score > 0)?.btn || null;
        if (!dismissBtn && overlayHints.some(hint => overlayText.includes(normalizeText(hint)))) {
          dismissBtn = buttons.find(btn => {
            const text = normalizeText(btn.textContent || '');
            const className = String(btn.className || '');
            return /^(x|×)$/.test(text) || /close/.test(className);
          }) || null;
        }

        if (dismissBtn) {
          console.log(`${LOG_PREFIX} 🧹 检测到干扰弹层，尝试关闭:`, {
            overlay: overlayText.slice(0, 80),
            button: summarizeElement(dismissBtn),
          });
          const clickResult = await performActionClick(dismissBtn, '干扰弹层按钮');
          if (clickResult.success) {
            closedCount++;
            await sleep(500);
          }
        }
      }
    }

    return { success: closedCount > 0, closedCount };
  }

  async function performTrustedClickFallback(el, description = '目标按钮') {
    if (!el) {
      return { success: false, message: `${description}不存在` };
    }

    try {
      el.scrollIntoView({ block: 'center', inline: 'center' });
      await sleep(300);
    } catch (e) {
      // ignore
    }

    const { x, y, rect } = getElementCenter(el);
    if (!rect.width || !rect.height) {
      return { success: false, message: `${description}不可见或尺寸为0` };
    }

    if (window.browserAPI && typeof window.browserAPI.nativeClick === 'function') {
      try {
        const result = await window.browserAPI.nativeClick(x, y);
        if (result && result.success) {
          console.log(`${LOG_PREFIX} ✅ 已通过 nativeClick 点击${description}: (${Math.round(x)}, ${Math.round(y)})`);
          return { success: true, message: 'nativeClick 成功' };
        }
      } catch (error) {
        console.warn(`${LOG_PREFIX} ⚠️ nativeClick 失败:`, error);
      }
    }

    try {
      const mouseEventOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: 0,
      };
      el.dispatchEvent(new MouseEvent('mouseover', mouseEventOptions));
      await sleep(50);
      el.dispatchEvent(new MouseEvent('mousedown', mouseEventOptions));
      await sleep(50);
      el.dispatchEvent(new MouseEvent('mouseup', mouseEventOptions));
      await sleep(50);
      el.dispatchEvent(new MouseEvent('click', mouseEventOptions));
      console.log(`${LOG_PREFIX} ✅ 已通过鼠标事件序列点击${description}`);
      return { success: true, message: 'mouse event fallback 成功' };
    } catch (error) {
      console.warn(`${LOG_PREFIX} ⚠️ 鼠标事件序列点击失败:`, error);
      return { success: false, message: error.message || 'fallback 点击失败' };
    }
  }

  function detectPublishingInProgressState() {
    const selectors = [
      '[role="status"]',
      '[role="alert"]',
      '.semi-toast-content-text',
      '[class*="toast"]',
      '[class*="message"]',
      '[class*="progress"]',
      '[class*="loading"]',
      '[class*="spin"]',
      '[class*="modal"]',
      '[class*="dialog"]',
      'div',
      'span',
      'p',
    ];

    const hints = [
      /正在发布/,
      /发布中/,
      /提交中/,
      /处理中/,
      /上传中/,
      /检测中/,
      /审核中/,
      /作品还在上传中/,
      /请勿关闭页面/,
      /\d+\s*%/,
    ];

    const seen = new Set();
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        if (!node || seen.has(node) || !isVisible(node)) continue;
        seen.add(node);
        const text = String(node.textContent || '').trim();
        if (!text) continue;
        if (hints.some((pattern) => pattern.test(text))) {
          return {
            active: true,
            message: text.slice(0, 120),
            element: node,
          };
        }
      }
    }

    return { active: false, message: '' };
  }

  function detectManualInterventionRequirement() {
    const selectors = [
      '[role="alert"]',
      '[role="status"]',
      '.semi-toast-content-text',
      '.ant-message-custom-content',
      '[class*="toast"]',
      '[class*="message"]',
      '[class*="error"]',
      '[class*="warn"]',
      '[class*="notice"]',
      '.semi-modal-content',
      '[role="dialog"]',
      '.semi-modal',
      'div',
      'span',
      'p',
    ];

    const patterns = [
      /请填写/,
      /请完善/,
      /请补充/,
      /请选择/,
      /请上传/,
      /请设置/,
      /去填写/,
      /去完善/,
      /去设置/,
      /立即填写/,
      /立即完善/,
      /需要补充/,
      /必填/,
      /不能为空/,
      /未填写/,
      /未完善/,
      /资质/,
      /声明/,
      /实名/,
      /认证/,
      /手机号/,
      /联系方式/,
    ];

    const excludes = [
      /请设置封面后再发布/,
      /封面检测未通过/,
      /正在发布/,
      /发布中/,
      /处理中/,
      /检测中/,
      /上传中/,
    ];

    const seen = new Set();
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        if (!node || seen.has(node) || !isVisible(node)) continue;
        seen.add(node);
        const text = String(node.textContent || '').trim();
        if (!text || text.length > 120) continue;
        if (excludes.some((pattern) => pattern.test(text))) continue;
        if (patterns.some((pattern) => pattern.test(text))) {
          return {
            active: true,
            message: text,
            element: node,
          };
        }
      }
    }

    return { active: false, message: '' };
  }

  async function reportPublishTimeoutFailure(reason, details = {}) {
    const errorMsg = String(reason || '发布处理中超时').trim();
    console.error(`${LOG_PREFIX} ⏰ ${errorMsg}`, details);
    showAiUserNotice('发布超时', `${errorMsg}\n系统将按失败上报，请稍后回首页查看状态。`, 'error');

    if (window.sendStatisticsError) {
      await window.sendStatisticsError(getPublishId(), errorMsg, 'AI发布');
    }

    if (window.browserAPI && typeof window.browserAPI.sendToHome === 'function') {
      window.browserAPI.sendToHome({
        type: 'ai-publish-timeout',
        reason: errorMsg,
        details,
        url: window.location.href,
        timestamp: Date.now(),
      });
    }

    if (window.closeWindowWithMessage) {
      await window.closeWindowWithMessage('发布超时，刷新数据', 1000);
    }
  }

  async function monitorPublishProgress(options = {}) {
    const runtimeConfig = getAiPublishRuntimeConfig();
    const {
      timeoutMs = runtimeConfig.publishMonitorTimeoutMs,
      pollInterval = runtimeConfig.publishMonitorPollIntervalMs,
    } = options;

    const startTime = Date.now();
    let lastProgressMessage = '';

    while (Date.now() - startTime < timeoutMs) {
      await sleep(pollInterval);

      if (isSuccessLikePage(window.location.href)) {
        console.log(`${LOG_PREFIX} ✅ 发布进度监视器检测到成功页跳转`);
        return { success: true, message: '检测到成功页跳转' };
      }

      const progressState = detectPublishingInProgressState();
      if (progressState.active) {
        lastProgressMessage = progressState.message || lastProgressMessage;
        console.log(`${LOG_PREFIX} ⏳ 发布仍在处理中: ${lastProgressMessage}`);
      }

      const manualState = detectManualInterventionRequirement();
      if (manualState.active) {
        notifyManualIntervention(manualState.message || '发布过程中需要人工补充信息', {
          stage: 'publish_monitor',
        });
        return { success: false, manualRequired: true, message: manualState.message };
      }

      if (window.browserAPI && typeof window.browserAPI.aiDetectResult === 'function') {
        try {
          const resultDom = extractPageStructure('compact');
          const detectResult = await window.browserAPI.aiDetectResult(resultDom);
          if (detectResult?.success && detectResult.result) {
            const status = String(detectResult.result.status || '').toLowerCase();
            if (status === 'success') {
              console.log(`${LOG_PREFIX} ✅ 发布进度监视器检测到成功结果:`, detectResult.result);
              return { success: true, message: detectResult.result.message || '发布成功', result: detectResult.result };
            }
            if (status === 'failed' || status === 'error') {
              return { success: false, message: detectResult.result.message || '发布失败', result: detectResult.result };
            }
          }
        } catch (error) {
          console.warn(`${LOG_PREFIX} ⚠️ 发布进度监视器检测结果失败:`, error);
        }
      }
    }

    return {
      success: false,
      timeout: true,
      message: lastProgressMessage || '发布处理中超时，长时间未得到明确结果',
    };
  }

  async function verifyPublishTrigger() {
    const waitSteps = [1200, 1800, 2500, 3500];

    for (const waitMs of waitSteps) {
      await sleep(waitMs);

      const toastSelectors = [
        '.semi-toast-content-text',
        '.ant-message-custom-content',
        '[class*="toast"]',
        '[class*="message"]',
        '[role="alert"]',
        '[role="status"]',
      ];

      for (const selector of toastSelectors) {
        const nodes = document.querySelectorAll(selector);
        for (const node of nodes) {
          const text = (node.textContent || '').trim();
          if (!text) continue;
          console.log(`${LOG_PREFIX} 📨 点击后检测到页面反馈: ${text}`);
          if (isCoverRequiredMessage(text)) {
            return { success: false, message: text };
          }
          if (/请填写|请完善|请补充|请选择|去填写|去完善|去设置|必填|不能为空|资质|声明|实名|认证/.test(text)) {
            return { success: false, message: text, manualRequired: true };
          }
          return { success: true, message: text, inProgress: /正在发布|发布中|提交中|处理中|上传中|检测中/.test(text) };
        }
      }

      const manualState = detectManualInterventionRequirement();
      if (manualState.active) {
        console.log(`${LOG_PREFIX} 📨 点击后检测到人工介入提示: ${manualState.message}`);
        return { success: false, message: manualState.message, manualRequired: true };
      }

      const progressState = detectPublishingInProgressState();
      if (progressState.active) {
        console.log(`${LOG_PREFIX} 📨 点击后检测到发布处理中状态: ${progressState.message}`);
        return { success: true, message: progressState.message, inProgress: true };
      }

      const publishButton = resolvePublishElement('');
      if (publishButton) {
        const disabled = publishButton.disabled || publishButton.getAttribute('disabled') !== null;
        const text = (publishButton.textContent || '').trim();
        if (disabled || /发布中|提交中|处理中|上传中/.test(text)) {
          console.log(`${LOG_PREFIX} 📨 点击后检测到按钮状态变化: ${text || 'disabled'}`);
          return { success: true, message: text || '按钮状态已变化', inProgress: true };
        }
      }
    }

    return { success: false, message: '未检测到明确的点击反馈' };
  }

  function isCoverRequiredMessage(message = '') {
    const text = String(message || '').trim();
    return (
      text.includes('请设置封面后再发布') ||
      text.includes('封面检测未通过') ||
      text.includes('封面') && text.includes('发布') ||
      text.includes('cover_required_intercept')
    );
  }

  function getCoverCheckText() {
    const selectors = [
      '.cover-check [class*="title-"]',
      '.cover-check',
      '[class*="cover-check"] [class*="title-"]',
      '[class*="coverCheck"] [class*="title-"]',
    ];

    for (const selector of selectors) {
      try {
        const node = document.querySelector(selector);
        const text = normalizeText(node?.textContent || '');
        if (text) return text;
      } catch (error) {
        // ignore selector errors
      }
    }

    const allNodes = Array.from(document.querySelectorAll('div, span, p'));
    for (const node of allNodes) {
      if (!isVisible(node)) continue;
      const text = normalizeText(node.textContent || '');
      if (/封面检测/.test(text)) return text;
    }

    return '';
  }

  function isCoverAppliedText(text = '') {
    return /封面检测通过|应用此封面|已应用|当前封面|使用中/.test(normalizeText(text));
  }

  function looksLikeCoverCandidate(el) {
    if (!el || !isVisible(el)) return false;
    const meta = collectElementMeta(el);
    const rect = el.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return false;

    const text = normalizeText(meta.text || '');
    const className = String(meta.className || '');
    const ariaLabel = normalizeText(meta.attributes?.['aria-label'] || '');
    const title = normalizeText(meta.attributes?.title || '');
    const dataKeys = Object.keys(meta.attributes || {}).join(' ');
    const hasPreview = !!el.querySelector('img, canvas, video');
    const hintText = `${text} ${ariaLabel} ${title} ${className} ${dataKeys}`;

    if (/取消|关闭|上传|重新上传|音乐|声明|标签|位置/.test(text)) return false;
    if (/封面|cover|推荐|template|模板/.test(hintText)) return true;
    return hasPreview && rect.width >= 80 && rect.height >= 80;
  }

  function getRankedCoverCandidates() {
    const selectors = [
      '[class*="recommendCover-"]',
      '[class*="recommend-cover"]',
      '[class*="coverRecommend"]',
      '[class*="coverItem"]',
      '[class*="cover-item"]',
      '[class*="coverCard"]',
      '[class*="cover-card"]',
    ];

    const seen = new Set();
    const candidates = [];

    function pushCandidate(el, reason = '') {
      if (!el || seen.has(el) || !looksLikeCoverCandidate(el)) return;
      seen.add(el);
      let score = 0;
      const meta = collectElementMeta(el);
      const rect = el.getBoundingClientRect();
      const text = normalizeText(meta.text || '');
      const className = String(meta.className || '');
      const attrText = normalizeText(JSON.stringify(meta.attributes || {}));

      if (/封面|cover/.test(`${className} ${attrText}`)) score += 20;
      if (/推荐|recommend/.test(`${text} ${className} ${attrText}`)) score += 16;
      if (/选择封面|应用此封面|设为封面/.test(text)) score += 18;
      if (el.querySelector('img, canvas, video')) score += 10;
      if (rect.width >= 100 && rect.height >= 100) score += 6;
      if (reason) score += 4;

      candidates.push({ candidate: el, score, reason });
    }

    selectors.forEach((selector) => {
      try {
        document.querySelectorAll(selector).forEach((el) => pushCandidate(el, selector));
      } catch (error) {
        // ignore selector errors
      }
    });

    const allNodes = Array.from(document.querySelectorAll('div, button, li, span'));
    allNodes.forEach((el) => pushCandidate(el, 'generic'));

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }

  async function waitForCoverApplied(timeoutMs = 12000) {
    const startTime = Date.now();
    let lastText = '';

    while (Date.now() - startTime < timeoutMs) {
      const text = getCoverCheckText();
      if (text) {
        lastText = text;
        console.log(`${LOG_PREFIX} 🧪 封面状态轮询: ${text}`);
      }
      if (isCoverAppliedText(text)) {
        return { success: true, message: text || '封面检测通过' };
      }
      await sleep(800);
    }

    return { success: false, message: lastText || '等待封面状态更新超时' };
  }

  async function applyRecommendedCover() {
    console.log(`${LOG_PREFIX} 🖼️ 开始执行封面兜底流程...`);
    const preOverlayResult = await dismissBlockingOverlays();
    if (preOverlayResult.success) {
      console.log(`${LOG_PREFIX} 🧹 选封面前已关闭 ${preOverlayResult.closedCount} 个干扰弹层`);
    }

    const candidates = getRankedCoverCandidates();
    console.log(`${LOG_PREFIX} 📋 封面候选摘要:`, candidates.map((item, index) => ({
      index: index + 1,
      score: item.score,
      reason: item.reason,
      summary: summarizeElement(item.candidate),
    })));

    if (candidates.length === 0) {
      return { success: false, message: '未找到推荐封面元素' };
    }

    let lastError = '';
    for (let i = 0; i < candidates.length; i++) {
      const candidateItem = candidates[i];
      const coverInput = candidateItem.candidate;
      const label = `候选#${i + 1}`;
      console.log(`${LOG_PREFIX} 🖼️ 尝试封面${label}:`, summarizeElement(coverInput));
      logClickDiagnostics(coverInput, `封面${label}`);

      const clickResult = await performTrustedClickFallback(coverInput, `推荐封面${label}`);
      if (!clickResult.success) {
        lastError = clickResult.message || '点击推荐封面失败';
        continue;
      }

      await sleep(1000);
      const confirmResult = await handlePossibleConfirmDialog({
        preferredTexts: ['确定', '确认', '应用此封面', '设为封面', '完成'],
        dialogKeywords: ['封面', '应用此封面', '确认应用'],
        allowLooseMatch: true,
        includeAcknowledge: false,
        required: false,
        scene: 'cover',
      });
      if (confirmResult.success) {
        console.log(`${LOG_PREFIX} ✅ 封面确认弹窗已处理`);
      } else {
        console.log(`${LOG_PREFIX} ℹ️ ${confirmResult.message || '当前未检测到封面确认弹窗'}，继续校验封面状态`);
      }

      const coverAppliedResult = await waitForCoverApplied();
      if (coverAppliedResult.success) {
        console.log(`${LOG_PREFIX} ✅ 封面检测通过`);
        return { success: true, message: coverAppliedResult.message || '封面检测通过' };
      }

      lastError = coverAppliedResult.message || '封面设置后仍未检测到通过状态';
      console.warn(`${LOG_PREFIX} ⚠️ 封面${label} 未生效: ${lastError}`);
    }

    return {
      success: false,
      message: lastError || '封面设置后仍未检测到通过状态',
    };
  }

  async function handlePossibleConfirmDialog(options = {}) {
    const dialogSelectors = ['.semi-modal-content', '[role="dialog"]', '.semi-modal'];
    const {
      preferredTexts = ['确认', '继续发布', '发布', '确定'],
      dialogKeywords = [],
      allowLooseMatch = true,
      includeAcknowledge = false,
      required = false,
      scene = 'generic',
    } = Array.isArray(options)
      ? { preferredTexts: options }
      : (options || {});

    const buttonTexts = includeAcknowledge
      ? Array.from(new Set([...preferredTexts, '知道了', '我知道了']))
      : preferredTexts;

    for (const dialogSelector of dialogSelectors) {
      const dialogs = Array.from(document.querySelectorAll(dialogSelector));
      for (const dialog of dialogs) {
        if (!isVisible(dialog)) continue;
        const dialogText = normalizeText(dialog.textContent || '');
        if (
          dialogKeywords.length > 0 &&
          !dialogKeywords.some(keyword => dialogText.includes(normalizeText(keyword)))
        ) {
          continue;
        }
        const buttons = Array.from(dialog.querySelectorAll('button, [role="button"], span, div'));
        const sortedButtons = buttons
          .filter(btn => isVisible(btn))
          .map((btn) => {
            const text = normalizeText(btn.textContent || '');
            const className = String(btn.className || '');
            let score = 0;
            if (buttonTexts.some(keyword => text.includes(normalizeText(keyword)))) score += 20;
            if (/primary|confirm|sure|ok/.test(className)) score += 12;
            if (/取消|关闭|返回|稍后|跳过|我知道了|知道了/.test(text) && !includeAcknowledge) score -= 30;
            if (/应用此封面|确认应用此封面|设为封面|确定/.test(text)) score += 18;
            if (/是否确认应用此封面|封面/.test(dialogText)) score += 8;
            if (/继续发布|确认发布|立即发布/.test(text)) score += 12;
            return { btn, text, score };
          })
          .sort((a, b) => b.score - a.score);

        const confirmBtn = sortedButtons.find(item => item.score > 0)?.btn;

        if (confirmBtn) {
          console.log(`${LOG_PREFIX} 🪟 检测到确认弹窗，尝试点击确认按钮`, {
            dialog: dialogText.slice(0, 80),
            button: summarizeElement(confirmBtn),
          });
          logClickDiagnostics(confirmBtn, '确认弹窗按钮');
          const clickResult = await performActionClick(confirmBtn, '确认弹窗按钮');
          await sleep(800);
          return clickResult;
        }

        const confirmLikeNode = allowLooseMatch
          ? Array.from(dialog.querySelectorAll('button, [role="button"]')).find(btn => {
            const text = normalizeText(btn.textContent || '');
            if (!text) return false;
            if (!includeAcknowledge && /我知道了|知道了/.test(text)) return false;
            return /确定|确认|应用|完成|继续|发布/.test(text);
          })
          : null;

        if (confirmLikeNode) {
          console.log(`${LOG_PREFIX} 🪟 检测到确认弹窗，使用宽松候选点击`);
          logClickDiagnostics(confirmLikeNode, '确认弹窗宽松候选');
          const clickResult = await performActionClick(confirmLikeNode, '确认弹窗按钮');
          await sleep(800);
          return clickResult;
        }
      }
    }

    return {
      success: false,
      message: required ? `未检测到${scene}确认弹窗` : `未检测到${scene}确认弹窗`,
      skipped: !required,
    };
  }

  async function triggerPublishWithCandidates(publishAction, filteredPlan, execResult) {
    const candidates = getRankedPublishCandidates(publishAction?.selector || '').slice(0, 4);
    console.log(`${LOG_PREFIX} 📋 发布按钮候选摘要:`, candidates.map((item, index) => ({
      index: index + 1,
      score: item.score,
      summary: summarizeElement(item.candidate),
    })));

    if (candidates.length === 0) {
      return {
        success: false,
        error: `AI 未找到可点击的发布按钮: ${publishAction?.selector || ''}`,
        actions: execResult.results,
        skippedActions: filteredPlan.skippedActions,
      };
    }

    const errors = [];
    for (let i = 0; i < candidates.length; i++) {
      const candidateItem = candidates[i];
      const publishEl = candidateItem.candidate;
      const label = getCandidateLogLabel(candidateItem, i);
      console.log(`${LOG_PREFIX} 🚀 尝试发布按钮${label}`);

      const preCoverCheckNode = document.querySelector('.cover-check [class*="title-"]');
      const preCoverCheckText = (preCoverCheckNode?.textContent || '').trim();
      if (preCoverCheckText && !preCoverCheckText.includes('封面检测通过')) {
        console.warn(`${LOG_PREFIX} ⚠️ 发布前检测到封面未通过: ${preCoverCheckText}`);
        const coverResult = await applyRecommendedCover();
        if (coverResult.success) {
          console.log(`${LOG_PREFIX} ✅ 发布前封面兜底成功: ${coverResult.message}`);
        } else {
          console.warn(`${LOG_PREFIX} ⚠️ 发布前封面兜底失败: ${coverResult.message}`);
        }
      }

      const overlayResult = await dismissBlockingOverlays();
      if (overlayResult.success) {
        console.log(`${LOG_PREFIX} 🧹 发布前已关闭 ${overlayResult.closedCount} 个干扰弹层`);
      }
      logClickDiagnostics(publishEl, `发布按钮${label}`);
      const readiness = diagnosePublishReadiness(publishEl);
      console.log(`${LOG_PREFIX} 🩺 发布按钮就绪诊断[${label}]:`, readiness);

      if (!readiness.ready) {
        errors.push(`${label}: ${readiness.reason}`);
        continue;
      }

      let clicked = false;
      const hitSummary = readiness.diagnostics?.hitElement;
      let effectiveClickTarget = publishEl;
      try {
        const { x, y } = getElementCenter(publishEl);
        const hitElement = document.elementFromPoint(x, y);
        if (hitElement && hitElement !== publishEl) {
          const publishContainsHit = publishEl.contains(hitElement);
          const hitContainsPublish = hitElement.contains(publishEl);
          if (publishContainsHit || hitContainsPublish) {
            effectiveClickTarget = findBestPublishClickTarget(hitElement) || hitElement;
            console.log(`${LOG_PREFIX} 🎯 命中元素与目标不同，改用真实命中链路点击:`, {
              hit: summarizeElement(hitElement),
              final: summarizeElement(effectiveClickTarget),
            });
          }
        }
      } catch (error) {
        console.warn(`${LOG_PREFIX} ⚠️ 读取真实命中元素失败:`, error);
      }

      effectiveClickTarget = findBestPublishClickTarget(effectiveClickTarget) || effectiveClickTarget;
      console.log(`${LOG_PREFIX} 🎯 最终发布点击目标:`, summarizeElement(effectiveClickTarget));

      if (typeof window.clickWithRetry === 'function') {
        const clickResult = await window.clickWithRetry(effectiveClickTarget, 3, 500, true);
        if (clickResult.success) {
          clicked = true;
          console.log(`${LOG_PREFIX} ✅ ${label} 已通过 clickWithRetry 点击`);
        } else {
          console.warn(`${LOG_PREFIX} ⚠️ ${label} clickWithRetry 失败，切换 trusted click: ${clickResult.message}`);
          const fallbackResult = await performTrustedClickFallback(effectiveClickTarget, '发布按钮');
          if (fallbackResult.success) {
            clicked = true;
          } else {
            errors.push(`${label}: ${clickResult.message || fallbackResult.message || '点击失败'}`);
            continue;
          }
        }
      } else {
        const fallbackResult = await performTrustedClickFallback(effectiveClickTarget, '发布按钮');
        if (fallbackResult.success) {
          clicked = true;
        } else {
          errors.push(`${label}: ${fallbackResult.message || '点击失败'}`);
          continue;
        }
      }

      if (clicked) {
        const confirmResult = await handlePossibleConfirmDialog({
          preferredTexts: ['确认', '继续发布', '发布', '确定'],
          dialogKeywords: ['发布', '确认', '继续'],
          allowLooseMatch: true,
          includeAcknowledge: false,
          required: false,
          scene: 'publish',
        });
        if (confirmResult.success) {
          console.log(`${LOG_PREFIX} ✅ ${label} 已处理确认弹窗`);
        } else {
          console.log(`${LOG_PREFIX} ℹ️ ${label} ${confirmResult.message || '无需处理发布确认弹窗'}`);
        }

        const verifyResult = await verifyPublishTrigger();
        if (verifyResult.success) {
          return {
            success: true,
            message: verifyResult.message,
            candidate: publishEl,
            candidateScore: candidateItem.score,
          };
        }

        if (verifyResult.manualRequired) {
          notifyManualIntervention(verifyResult.message || '发布前还需要人工补充信息', {
            stage: 'publish_after_click',
            candidate: summarizeElement(publishEl),
          });
          return {
            success: false,
            manualRequired: true,
            error: verifyResult.message || '需要人工补充信息后再继续发布',
            actions: execResult.results,
            skippedActions: filteredPlan.skippedActions,
          };
        }

        if (isCoverRequiredMessage(verifyResult.message)) {
          console.warn(`${LOG_PREFIX} ⚠️ 点击发布后检测到封面拦截，尝试补封面后重试`);
          const coverResult = await applyRecommendedCover();
          if (coverResult.success) {
            console.log(`${LOG_PREFIX} ✅ 封面兜底成功，准备重新点击发布按钮`);

            const retryClickTarget = findBestPublishClickTarget(publishEl) || publishEl;
            const retryClickResult = await performTrustedClickFallback(retryClickTarget, '发布按钮(封面兜底后重试)');
            if (retryClickResult.success) {
              const retryVerify = await verifyPublishTrigger();
              if (retryVerify.success) {
                return {
                  success: true,
                  message: retryVerify.message,
                  candidate: retryClickTarget,
                  candidateScore: candidateItem.score,
                };
              }
              if (retryVerify.manualRequired) {
                notifyManualIntervention(retryVerify.message || '补封面后仍需人工补充信息', {
                  stage: 'publish_retry_after_cover',
                  candidate: summarizeElement(retryClickTarget),
                });
                return {
                  success: false,
                  manualRequired: true,
                  error: retryVerify.message || '需要人工补充信息后再继续发布',
                  actions: execResult.results,
                  skippedActions: filteredPlan.skippedActions,
                };
              }
              errors.push(`${label}: 封面兜底后重试发布仍无反馈(${retryVerify.message})`);
              continue;
            }

            errors.push(`${label}: 封面兜底后重试点击失败(${retryClickResult.message})`);
            continue;
          }

          errors.push(`${label}: 封面兜底失败(${coverResult.message})`);
          continue;
        }

        errors.push(`${label}: 点击后未检测到发布反馈(${verifyResult.message})`);
      }
    }

    return {
      success: false,
      error: errors.join(' | ') || '所有发布按钮候选均未触发发布反馈',
      actions: execResult.results,
      skippedActions: filteredPlan.skippedActions,
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
  async function executeAction(action, publishData = {}) {
    console.log(`${LOG_PREFIX} 执行步骤 ${action.step}: ${action.action} - ${action.description}`);

    try {
      switch (action.action) {
        case 'fill': {
          const result = await tryCandidates(
            action,
            async (el) => {
              await fillInputElement(el, action.value);
              return { success: true, element: el };
            },
            { minScore: 10, maxAttempts: 4, actionName: '填写输入框' }
          );
          if (!result.success) {
            return { success: false, error: result.error || `元素未找到: ${action.selector}` };
          }
          console.log(`${LOG_PREFIX} ✅ 已填写: ${action.value.substring(0, 30)}...`);
          break;
        }

        case 'fill_rich': {
          const result = await tryCandidates(
            action,
            async (el) => {
              await fillRichTextElement(el, action.value);
              return { success: true, element: el };
            },
            { minScore: 10, maxAttempts: 4, actionName: '填写富文本' }
          );
          if (!result.success) {
            return { success: false, error: result.error || `元素未找到: ${action.selector}` };
          }
          console.log(`${LOG_PREFIX} ✅ 已填写富文本: ${action.value.substring(0, 30)}...`);
          break;
        }

        case 'click': {
          const result = await tryCandidates(
            action,
            async (el) => {
              const clickResult = await performActionClick(el, action.description || '元素');
              if (!clickResult.success) {
                return { success: false, error: clickResult.message || `点击失败: ${action.selector}` };
              }
              return { success: true, element: el };
            },
            { minScore: 5, maxAttempts: 4, actionName: '点击元素' }
          );
          if (!result.success) {
            return { success: false, error: result.error || `元素未找到: ${action.selector}` };
          }
          console.log(`${LOG_PREFIX} ✅ 已点击: ${action.description}`);
          break;
        }

        case 'select': {
          const result = await tryCandidates(
            action,
            async (el) => {
              if (el.tagName === 'SELECT') {
                el.value = action.value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return { success: true, element: el };
              }

              const clickResult = await performActionClick(el, action.description || '下拉选择器');
              if (!clickResult.success) {
                return { success: false, error: clickResult.message || `打开下拉失败: ${action.selector}` };
              }

              await sleep(300);
              const optionCandidates = Array.from(document.querySelectorAll('[role="option"], .semi-select-option, .option, li, .semi-tree-option'));
              const matchedOption = optionCandidates.find(option => {
                const text = (option.textContent || '').trim();
                return text === String(action.value).trim() || text.includes(String(action.value).trim());
              });

              if (!matchedOption) {
                return { success: false, error: `未找到下拉选项: ${action.value}` };
              }

              const optionClickResult = await performActionClick(matchedOption, `选项:${action.value}`);
              if (!optionClickResult.success) {
                return { success: false, error: optionClickResult.message || `选择选项失败: ${action.value}` };
              }

              return { success: true, element: el, optionElement: matchedOption };
            },
            { minScore: 5, maxAttempts: 4, actionName: '选择下拉项' }
          );
          if (!result.success) {
            return { success: false, error: result.error || `元素未找到: ${action.selector}` };
          }
          console.log(`${LOG_PREFIX} ✅ 已选择: ${action.value}`);
          break;
        }

        case 'check': {
          const result = await tryCandidates(
            action,
            async (el) => {
              const inputEl = el.matches('input[type="checkbox"], input[type="radio"]')
                ? el
                : el.querySelector('input[type="checkbox"], input[type="radio"]');
              if (inputEl && inputEl.checked) {
                return { success: true, element: el, alreadyChecked: true };
              }
              const checkClickResult = await performActionClick(el, action.description || '勾选项');
              if (!checkClickResult.success) {
                return { success: false, error: checkClickResult.message || `勾选失败: ${action.selector}` };
              }
              const afterInput = el.matches('input[type="checkbox"], input[type="radio"]')
                ? el
                : el.querySelector('input[type="checkbox"], input[type="radio"]');
              if (afterInput && !afterInput.checked) {
                return { success: false, error: '勾选后状态未改变' };
              }
              return { success: true, element: el };
            },
            { minScore: 5, maxAttempts: 4, actionName: '勾选选项' }
          );
          if (!result.success) {
            return { success: false, error: result.error || `元素未找到: ${action.selector}` };
          }
          if (result.alreadyChecked) {
            console.log(`${LOG_PREFIX} ℹ️ 已是选中状态，跳过点击: ${action.description}`);
            break;
          }
          console.log(`${LOG_PREFIX} ✅ 已勾选: ${action.description}`);
          break;
        }

        case 'upload': {
          return await handleUploadAction(action, publishData);
        }

        case 'publish': {
          const publishEl = resolvePublishElement(action.selector);
          if (!publishEl) {
            console.warn(`${LOG_PREFIX} ⚠️ 发布按钮未找到: ${action.selector}`);
            return { success: false, error: `发布按钮未找到: ${action.selector}` };
          }
          console.log(`${LOG_PREFIX} 🔘 发布按钮已识别: ${action.selector}`);
          return { success: true, isPublishButton: true, selector: action.selector, element: publishEl };
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

  function buildPublishDataHints(publishData) {
    const hints = {
      title: [],
      content: [],
      schedule: [],
      tags: [],
      category: [],
      media: [],
    };

    const normalized = publishData && typeof publishData === 'object' ? publishData : {};

    function visit(value, path = '') {
      if (value == null) return;

      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return;
        const lowerPath = path.toLowerCase();
        if (/title|caption/.test(lowerPath)) hints.title.push(trimmed);
        if (/intro|content|description|summary|text/.test(lowerPath)) hints.content.push(trimmed);
        if (/send_time|schedule|publish.*time|time/.test(lowerPath)) hints.schedule.push(trimmed);
        if (/tag|topic|keyword/.test(lowerPath)) hints.tags.push(trimmed);
        if (/category|label/.test(lowerPath)) hints.category.push(trimmed);
        if (/video|image|cover|thumb|url/.test(lowerPath)) hints.media.push(trimmed);
        return;
      }

      if (typeof value === 'number' || typeof value === 'boolean') {
        const lowerPath = path.toLowerCase();
        if (/send_set|schedule|timing/.test(lowerPath)) {
          hints.schedule.push(String(value));
        }
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, `${path}[${index}]`));
        return;
      }

      if (typeof value === 'object') {
        Object.entries(value).forEach(([key, child]) => {
          visit(child, path ? `${path}.${key}` : key);
        });
      }
    }

    visit(normalized);

    Object.keys(hints).forEach(key => {
      hints[key] = Array.from(new Set(hints[key].filter(Boolean)));
    });

    return hints;
  }

  function shouldSkipActionForMissingParam(action, hints) {
    if (!action || !action.action) {
      return { skip: true, reason: '动作无效' };
    }

    if (action.action === 'publish' || action.action === 'upload') {
      return { skip: false };
    }

    const haystack = [
      action.description,
      action.selector,
      action.field,
      action.value,
    ].filter(Boolean).join(' ').toLowerCase();

    const actionValue = typeof action.value === 'string' ? action.value.trim() : action.value;
    const hasNonEmptyValue = !(
      actionValue == null ||
      actionValue === '' ||
      (Array.isArray(actionValue) && actionValue.length === 0)
    );

    if ((action.action === 'fill' || action.action === 'fill_rich' || action.action === 'select') && !hasNonEmptyValue) {
      return { skip: true, reason: '填写/选择动作缺少非空 value' };
    }

    if (/标题|title|caption/.test(haystack)) {
      return hints.title.length > 0
        ? { skip: false }
        : { skip: true, reason: '未提供标题参数' };
    }

    if (/简介|正文|描述|内容|summary|intro|content|text/.test(haystack)) {
      return hints.content.length > 0
        ? { skip: false }
        : { skip: true, reason: '未提供正文参数' };
    }

    if (/定时|发布时间|schedule|time/.test(haystack)) {
      return hints.schedule.length > 0
        ? { skip: false }
        : { skip: true, reason: '未提供定时参数' };
    }

    if (/标签|话题|topic|tag|keyword/.test(haystack)) {
      return hints.tags.length > 0
        ? { skip: false }
        : { skip: true, reason: '未提供标签/话题参数' };
    }

    if (/分类|category|label/.test(haystack)) {
      return hints.category.length > 0
        ? { skip: false }
        : { skip: true, reason: '未提供分类参数' };
    }

    if (/封面|图片|视频|cover|image|video|thumb/.test(haystack)) {
      return hints.media.length > 0
        ? { skip: false }
        : { skip: true, reason: '未提供媒体参数' };
    }

    return { skip: false };
  }

  function filterActionsByPublishData(actions, publishData) {
    const hints = buildPublishDataHints(publishData);
    const filteredActions = [];
    const skippedActions = [];

    for (const action of actions || []) {
      const decision = shouldSkipActionForMissingParam(action, hints);
      if (decision.skip) {
        skippedActions.push({ ...action, skipReason: decision.reason });
        continue;
      }
      filteredActions.push(action);
    }

    return { filteredActions, skippedActions, hints };
  }

  /**
   * 批量执行操作（按步骤顺序，每步间隔 500ms）
   */
  async function executeActions(actions, publishData = {}) {
    const results = [];
    let publishButton = null;
    const uploadResults = [];

    for (const action of actions) {
      const result = await executeAction(action, publishData);
      results.push({ step: action.step, action: action.action, ...result });

      if (result.isPublishButton) {
        publishButton = {
          ...action,
          resolvedElement: result.element || null,
        };
      }
      if (result.uploaded) {
        uploadResults.push({ ...action, mediaKind: result.mediaKind });
      }

      // 每步间隔，等待页面响应
      await sleep(500);
    }

    return { results, publishButton, uploadResults };
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
    let domData = extractPageStructure('normal');
    console.log(`${LOG_PREFIX} 提取到 ${domData.elementCount}/${domData.rawElementCount} 个可交互元素 (mode=${domData.snapshotMode})`);

    if (domData.elementCount === 0) {
      console.error(`${LOG_PREFIX} ❌ 页面没有找到可交互元素`);
      return { success: false, error: '页面没有找到可交互元素' };
    }

    // Step 2: 调用 AI 分析
    console.log(`${LOG_PREFIX} 🤖 步骤2: AI 分析页面结构...`);
    let analyzeResult = await window.browserAPI.aiAnalyzePage(domData, publishData);

    if (!analyzeResult.success && isContextWindowLimitError(analyzeResult.error)) {
      console.warn(`${LOG_PREFIX} ⚠️ 上下文超限，切换 compact 快照重试...`);
      domData = extractPageStructure('compact');
      console.log(`${LOG_PREFIX} compact 模式提取 ${domData.elementCount}/${domData.rawElementCount} 个可交互元素`);
      analyzeResult = await window.browserAPI.aiAnalyzePage(domData, publishData);
    }

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

    const filteredPlan = filterActionsByPublishData(aiResult.actions, publishData);
    if (filteredPlan.skippedActions.length > 0) {
      console.log(`${LOG_PREFIX} ⏭️ 因缺少参数跳过 ${filteredPlan.skippedActions.length} 个动作`);
      filteredPlan.skippedActions.forEach(action => {
        console.log(`${LOG_PREFIX}   - 跳过 ${action.action} ${action.description || action.selector || ''} | reason=${action.skipReason}`);
      });
    }

    // Step 3: 执行填写操作
    console.log(`${LOG_PREFIX} ✍️ 步骤3: 执行表单填写...`);
    const execResult = await executeActions(filteredPlan.filteredActions, publishData);

    if (execResult.uploadResults.length > 0) {
      console.log(`${LOG_PREFIX} ✅ 已完成 ${execResult.uploadResults.length} 个上传动作`);
      execResult.uploadResults.forEach(upload => {
        console.log(`${LOG_PREFIX}   - ${upload.mediaKind}: ${upload.selector}`);
      });
    }

    // Step 4: 处理发布按钮
    if (execResult.publishButton && autoPublish) {
      console.log(`${LOG_PREFIX} 🚀 步骤4: 自动点击发布按钮...`);
      await sleep(1000);
      const publishResult = await triggerPublishWithCandidates(execResult.publishButton, filteredPlan, execResult);
      if (!publishResult.success) {
        return publishResult;
      }
      console.log(`${LOG_PREFIX} ✅ 发布按钮候选已触发发布反馈: ${publishResult.message}`);

        // Step 5: 检测结果
        if (autoDetectResult) {
          console.log(`${LOG_PREFIX} 🔍 步骤5: 检测发布结果...`);
          const runtimeConfig = getAiPublishRuntimeConfig();
          console.log(`${LOG_PREFIX} ⚙️ 当前平台发布监视配置:`, runtimeConfig);
          const monitorResult = await monitorPublishProgress({
            timeoutMs: runtimeConfig.publishMonitorTimeoutMs,
            pollInterval: runtimeConfig.publishMonitorPollIntervalMs,
          });

          if (monitorResult.success) {
            return {
              success: true,
              result: monitorResult.result || { status: 'success', message: monitorResult.message },
              actions: execResult.results,
            };
          }

          if (monitorResult.manualRequired) {
            return {
              success: false,
              manualRequired: true,
              error: monitorResult.message || '发布过程中需要人工介入',
              actions: execResult.results,
            };
          }

          if (monitorResult.timeout) {
            await reportPublishTimeoutFailure(monitorResult.message, {
              stage: 'post_publish_monitor',
              publishFeedback: publishResult.message,
            });
            return {
              success: false,
              timeout: true,
              error: monitorResult.message,
              actions: execResult.results,
            };
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
      uploadResults: execResult.uploadResults,
      actions: execResult.results,
      skippedActions: filteredPlan.skippedActions,
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

  if (window.__AI_PUBLISH_DISABLE_AUTO_START__) {
    console.log(`${LOG_PREFIX} ⏸️ 检测到禁用自动流程标记，仅暴露 API，不自动接管发布流程`);
    return;
  }

  if (window.__DOUYIN_SCRIPT_LOADED__) {
    console.log(`${LOG_PREFIX} ⏸️ 检测到抖音专用脚本已接管，仅保留 AI API 供兜底调用`);
    return;
  }

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

  function isSuccessLikePage(url = window.location.href) {
    const lowerUrl = String(url || '').toLowerCase();
    return (
      lowerUrl.includes('/content/manage') ||
      lowerUrl.includes('/creator-micro/content/manage') ||
      lowerUrl.includes('manage') ||
      lowerUrl.includes('success')
    );
  }

  function isPublishingInProgressPage() {
    return detectPublishingInProgressState().active;
  }

  function isLikelyPublishPage() {
    const currentUrl = String(window.location.href || '').toLowerCase();
    if (!currentUrl.includes('/content/upload')) {
      return false;
    }

    const publishCandidates = [
      ...Array.from(document.querySelectorAll('button, [role="button"], span, div')).filter(el => {
        const text = (el.textContent || '').trim();
        return text === '发布' || text.includes('立即发布') || text.includes('发布作品');
      }),
    ];

    const titleCandidates = document.querySelectorAll('input, textarea, [contenteditable="true"]');
    const fileCandidates = document.querySelectorAll('input[type="file"], [class*="upload"], [class*="Upload"]');

    return publishCandidates.length > 0 && (titleCandidates.length > 0 || fileCandidates.length > 0);
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

      if (currentUrl === INITIAL_URL && isPublishingInProgressPage()) {
        console.log(`${LOG_PREFIX} ℹ️ 页面仍在发布页，但检测到发布处理中状态，继续等待`);
        return;
      }

      if (currentUrl === INITIAL_URL && !isLikelyPublishPage()) {
        console.warn(`${LOG_PREFIX} ⚠️ 当前 URL 未变，但页面已不像发布页，暂停自动化`);
        clearInterval(urlCheckInterval);
        reportRedirectError(INITIAL_URL, `${currentUrl} (页面身份异常)`);
        return;
      }

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
          if (isSuccessLikePage(currentUrl)) {
            console.log(`${LOG_PREFIX} ✅ 检测到成功/管理页跳转: ${currentUrl}`);
            clearInterval(urlCheckInterval);
            return;
          }

          if (isLikelyPublishPage()) {
            console.log(`${LOG_PREFIX} ℹ️ 同域名发布页内跳转: ${currentUrl}`);
            return;
          }

          if (isPublishingInProgressPage()) {
            console.log(`${LOG_PREFIX} ℹ️ 同域名页面存在发布处理中状态: ${currentUrl}`);
            return;
          }

          console.warn(`${LOG_PREFIX} ⚠️ 同域名但页面已不再像发布页: ${currentUrl}`);
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
