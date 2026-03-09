const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright-core');

const REPO_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(REPO_DIR, 'docs', 'debug');
const TARGET_URL = 'https://mp.toutiao.com/profile_v4/graphic/publish?from=toutiao_pc';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nowTag() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function nowCN() {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}

async function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function openWindow(app) {
  return app.evaluate(async ({ BrowserWindow }, { targetUrl }) => {
    let win = global.__TT_PUBLISH_ONCE_WINDOW__;
    if (!win || win.isDestroyed()) {
      win = new BrowserWindow({
        width: 1460,
        height: 980,
        show: true,
        title: '头条真实发布-单次',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false
        }
      });
      global.__TT_PUBLISH_ONCE_WINDOW__ = win;
    }
    await win.loadURL(targetUrl);
    return { ok: true, url: win.webContents.getURL() };
  }, { targetUrl: TARGET_URL });
}

async function waitReady(app, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await app.evaluate(async () => {
      const win = global.__TT_PUBLISH_ONCE_WINDOW__;
      if (!win || win.isDestroyed()) return { ok: false, reason: 'no-window' };
      const payload = await win.webContents.executeJavaScript(
        `(() => {
          const hasTitle = !!document.querySelector('textarea[placeholder*="标题"], input[placeholder*="标题"]');
          const hasEditor = !!document.querySelector('.ProseMirror, [contenteditable="true"]');
          return {
            href: location.href,
            title: document.title,
            hasTitle,
            hasEditor
          };
        })()`,
        true
      );
      return { ok: true, payload };
    });
    if (status.ok && status.payload.hasTitle && status.payload.hasEditor) {
      return status.payload;
    }
    await sleep(2000);
  }
  throw new Error('未进入可编辑发布页（可能未登录）');
}

async function runPublish(app, publishTitle, publishContent, mode = 'immediate') {
  return app.evaluate(async (_, { publishTitleArg, publishContentArg, modeArg }) => {
    const win = global.__TT_PUBLISH_ONCE_WINDOW__;
    if (!win || win.isDestroyed()) return { success: false, reason: 'no-window' };

    return win.webContents.executeJavaScript(
      `(async () => {
        const publishTitle = ${JSON.stringify(publishTitleArg)};
        const publishContent = ${JSON.stringify(publishContentArg)};
        const publishMode = ${JSON.stringify(modeArg || 'immediate')};
        const delay = ms => new Promise(r => setTimeout(r, ms));
        const logs = [];
        const push = (step, extra = {}) => logs.push({ step, ...extra });
        const textOf = el => (el?.textContent || '').trim();
        const visible = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) return false;
          const st = window.getComputedStyle(el);
          if (!st) return true;
          if (st.display === 'none' || st.visibility === 'hidden') return false;
          if (Number(st.opacity || '1') === 0) return false;
          return true;
        };

        const findTitleInput = () => {
          const selectors = [
            'textarea[placeholder*="请输入文章标题"]',
            'textarea[placeholder*="文章标题"]',
            'textarea[placeholder*="标题"]',
            'input[placeholder*="标题"]'
          ];
          for (const selector of selectors) {
            const list = Array.from(document.querySelectorAll(selector));
            const v = list.find(el => visible(el) && el.getBoundingClientRect().width > 120);
            if (v) return v;
            if (list[0]) return list[0];
          }
          return null;
        };

        const findEditor = () => {
          const list = Array.from(document.querySelectorAll('.ProseMirror, [contenteditable="true"]'));
          return list.find(visible) || list[0] || null;
        };

        const findButton = (matcher, allowHidden = false) => {
          const list = Array.from(document.querySelectorAll('button')).filter(btn => matcher(textOf(btn), btn));
          if (list.length === 0) return null;
          const v = list.find(visible);
          if (v) return v;
          return allowHidden ? list[0] : null;
        };

        const clickButton = (btn) => {
          if (!btn) return false;
          try { btn.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch (_) {}
          btn.click();
          return true;
        };

        const findVisibleHint = () => {
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
            '[class*="tips"]'
          ];
          for (const selector of selectors) {
            const list = document.querySelectorAll(selector);
            for (const el of list) {
              if (!visible(el)) continue;
              const t = textOf(el);
              if (!t || t.length > 180) continue;
              if (/标题不能为空|还需输入|封面|失败|错误|请先/.test(t)) return t;
            }
          }
          return '';
        };

        const readToast = () => {
          const selectors = [
            '.byte-message-notice-content-text',
            '.byte-message-content',
            '.semi-toast-content-text',
            '.arco-message-content'
          ];
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            const t = textOf(el);
            if (t && t.length < 180) return t;
          }
          return '';
        };

        const isPreviewLayerVisible = () => {
          const signals = [
            '仅支持预览',
            '返回编辑',
            '确认发布'
          ];
          const candidates = Array.from(document.querySelectorAll('button,div,span,p'));
          return candidates.some(el => {
            if (!visible(el)) return false;
            const t = textOf(el);
            return t && signals.some(s => t.includes(s));
          });
        };

        const findVisibleButtonByText = (buttonText) => {
          const buttons = Array.from(document.querySelectorAll('button'));
          return buttons.find(btn => visible(btn) && textOf(btn) === buttonText) || null;
        };

        // 1) 标题
        const titleInput = findTitleInput();
        if (!titleInput) return { success: false, reason: 'title-input-not-found', logs };
        titleInput.focus();
        const prev = titleInput.value;
        try {
          const proto = titleInput.tagName.toLowerCase() === 'textarea'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(titleInput, publishTitle);
          else titleInput.value = publishTitle;
        } catch (_) {
          titleInput.value = publishTitle;
        }
        if (titleInput._valueTracker) titleInput._valueTracker.setValue(prev);
        try {
          titleInput.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true, cancelable: true, inputType: 'insertText', data: publishTitle
          }));
        } catch (_) {}
        titleInput.dispatchEvent(new InputEvent('input', {
          bubbles: true, cancelable: true, inputType: 'insertText', data: publishTitle
        }));
        titleInput.dispatchEvent(new Event('change', { bubbles: true }));
        titleInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        await delay(900);
        push('title-filled', { value: titleInput.value || '' });

        // 2) 正文
        const editor = findEditor();
        if (!editor) return { success: false, reason: 'editor-not-found', logs };
        editor.focus();
        editor.innerHTML = '';
        for (const line of publishContent.split('\\n').map(s => s.trim()).filter(Boolean)) {
          const p = document.createElement('p');
          p.textContent = line;
          editor.appendChild(p);
        }
        editor.dispatchEvent(new InputEvent('input', {
          bubbles: true, cancelable: true, inputType: 'insertText', data: publishContent
        }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
        await delay(700);
        push('content-filled', { len: (editor.innerText || '').trim().length });

        // 3) 封面
        const coverRoot = document.querySelector('.article-cover, .pgc-edit-cell .edit-label');
        if (coverRoot && coverRoot.scrollIntoView) {
          coverRoot.scrollIntoView({ behavior: 'auto', block: 'center' });
          await delay(250);
        }
        const coverTrigger = Array.from(document.querySelectorAll('.article-cover-add, [class*="cover-add"]')).find(visible);
        if (!coverTrigger) return { success: false, reason: 'cover-trigger-not-found', logs };
        coverTrigger.click();
        await delay(900);

        const fileInput = Array.from(document.querySelectorAll('input[type="file"]')).find(el => {
          const accept = (el.getAttribute('accept') || '').toLowerCase();
          return accept.includes('image') || accept.includes('png') || accept.includes('jpg') || accept === 'image/*';
        }) || document.querySelector('input[type="file"]');
        if (!fileInput) return { success: false, reason: 'cover-file-input-not-found', logs };

        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#2563eb';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.font = '48px sans-serif';
        ctx.fillText('Toutiao Cover Test', 40, 96);
        ctx.font = '36px sans-serif';
        ctx.fillText(new Date().toLocaleString(), 40, 160);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const file = new File([blob], 'tt-auto-cover.png', { type: 'image/png' });
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        await delay(1200);

        const modalConfirmBtn = findButton((t, btn) => {
          const txt = t || textOf(btn);
          return txt === '确定' || txt === '完成' || txt === '使用';
        }, true);
        if (modalConfirmBtn && !modalConfirmBtn.disabled) {
          clickButton(modalConfirmBtn);
          push('cover-confirm-clicked', { text: textOf(modalConfirmBtn) });
          await delay(1000);
        }

        const isCoverReady = () =>
          !!document.querySelector(
            '.article-cover-images img, .article-cover img, [class*="cover"] img, .article-cover-images [class*="uploaded"], .article-cover-images [class*="image"]'
          ) || !!Array.from(document.querySelectorAll('.article-cover-images button, .article-cover button, .article-cover-images div'))
            .find(el => /编辑|替换|预览/.test(textOf(el)));

        let coverReady = false;
        for (let i = 0; i < 8; i++) {
          coverReady = isCoverReady();
          if (coverReady) break;
          await delay(700);
        }
        push('cover-ready', { coverReady });
        if (!coverReady) {
          const hint = findVisibleHint();
          return { success: false, reason: 'cover-not-ready', hint, logs };
        }

        if (publishMode === 'schedule_probe') {
          const scheduleBtn = findButton((t) => t === '定时发布', true);
          if (!scheduleBtn) {
            return { success: false, reason: 'schedule-btn-not-found', logs };
          }
          clickButton(scheduleBtn);
          await delay(900);
          const modalOpened = Array.from(document.querySelectorAll(
            '.byte-modal-wrapper, .byte-modal, .semi-modal, .arco-modal, [class*="picker"], [class*="calendar"], [class*="popover"]'
          )).some(el => visible(el) && /(定时|发布时间|选择时间)/.test(textOf(el)));
          push('schedule-opened', { modalOpened });
          if (!modalOpened) {
            return { success: false, reason: 'schedule-modal-not-opened', logs };
          }
          const cancelBtn = findButton((t) => t === '取消' || t === '关闭' || t.includes('返回修改'), true);
          if (cancelBtn) {
            clickButton(cancelBtn);
            await delay(500);
            push('schedule-cancel-clicked', { text: textOf(cancelBtn) });
          }
          return { success: true, reason: 'schedule-probe-ok', href: location.href, logs };
        }

        // 4) 发布
        let publishBtn = null;
        for (let i = 0; i < 8; i++) {
          publishBtn =
            findButton((t) => t === '预览并发布' || t === '发布' || t.includes('发布文章'), true) ||
            document.querySelector('button.publish-btn-last, button[class*="publish-btn-last"]');
          if (publishBtn && !publishBtn.disabled) break;
          await delay(600);
        }
        if (!publishBtn) return { success: false, reason: 'publish-btn-not-found', logs };

        const clickText = textOf(publishBtn);
        clickButton(publishBtn);
        push('publish-clicked', { text: clickText });
        await delay(1200);

        if (publishMode === 'preview_only') {
          let previewReady = false;
          for (let i = 0; i < 20; i++) {
            const backBtn = findVisibleButtonByText('返回编辑');
            const previewHint = isPreviewLayerVisible();
            if (backBtn || previewHint) {
              previewReady = true;
              push('preview-layer-ready', { attempt: i + 1, hasBackBtn: !!backBtn, previewHint });
              break;
            }
            await delay(400);
          }
          return {
            success: previewReady,
            reason: previewReady ? 'preview-opened' : 'preview-not-opened',
            href: location.href,
            logs
          };
        }

        // 二次确认：必须先等预览层稳定出现，再点确认发布
        let previewReady = false;
        for (let i = 0; i < 20; i++) {
          const backBtn = findVisibleButtonByText('返回编辑');
          const previewHint = isPreviewLayerVisible();
          if (backBtn || previewHint) {
            previewReady = true;
            push('preview-layer-ready', { attempt: i + 1, hasBackBtn: !!backBtn, previewHint });
            break;
          }
          await delay(400);
        }

        let secondConfirmed = false;
        for (let i = 0; i < 30; i++) {
          const confirmBtn = findVisibleButtonByText('确认发布') || findVisibleButtonByText('立即发布');
          if (confirmBtn && !confirmBtn.disabled) {
            clickButton(confirmBtn);
            push('secondary-confirm-clicked', { text: textOf(confirmBtn), attempt: i + 1 });
            secondConfirmed = true;
            await delay(1000);
            break;
          }
          await delay(400);
        }
        if (!secondConfirmed) {
          const visibleButtons = Array.from(document.querySelectorAll('button'))
            .filter(visible)
            .map(btn => textOf(btn))
            .filter(Boolean)
            .slice(0, 30);
          push('secondary-confirm-missing', { previewLayer: isPreviewLayerVisible(), previewReady, visibleButtons });
        }

        // 5) 等待结果
        const start = Date.now();
        const timeout = 80000;
        while (Date.now() - start < timeout) {
          await delay(1200);
          const href = location.href;
          if (
            href.includes('/profile_v4/graphic/manage') ||
            href.includes('/profile_v4/graphic/articles')
          ) {
            return { success: true, reason: 'list-page', href, logs };
          }

          const toast = readToast();
          if (toast) {
            if (/发布成功|提交成功|成功/.test(toast)) {
              return { success: true, reason: 'toast-success', toast, href, logs };
            }
            if (/失败|错误|异常|不能为空|请先|违规|超限|驳回/.test(toast)) {
              return { success: false, reason: 'toast-failed', toast, href, logs };
            }
          }

          const hint = findVisibleHint();
          if (hint) {
            return { success: false, reason: 'validation-hint', hint, href, logs };
          }
        }
        if (isPreviewLayerVisible()) {
          return { success: false, reason: 'need-secondary-confirm', href: location.href, logs };
        }
        return { success: false, reason: 'timeout', href: location.href, logs };
      })()`,
      true
    );
  }, { publishTitleArg: publishTitle, publishContentArg: publishContent, modeArg: mode });
}

async function capture(app, pngPath) {
  const result = await app.evaluate(async () => {
    const win = global.__TT_PUBLISH_ONCE_WINDOW__;
    if (!win || win.isDestroyed()) return { ok: false, reason: 'no-window' };
    const image = await win.webContents.capturePage();
    return { ok: true, pngBase64: image.toPNG().toString('base64') };
  });
  if (!result.ok) return result;
  fs.writeFileSync(pngPath, Buffer.from(result.pngBase64, 'base64'));
  return { ok: true };
}

async function getPublishWindowUrl(app) {
  try {
    return await app.evaluate(() => {
      const win = global.__TT_PUBLISH_ONCE_WINDOW__;
      if (!win || win.isDestroyed()) return '';
      return win.webContents.getURL() || '';
    });
  } catch (_) {
    return '';
  }
}

async function close(app) {
  try {
    await app.evaluate(() => {
      const win = global.__TT_PUBLISH_ONCE_WINDOW__;
      if (win && !win.isDestroyed()) win.close();
    });
  } catch (_) {}
}

async function main() {
  await ensureOutputDir();
  const app = await electron.launch({ args: ['.'], cwd: REPO_DIR });
  const tag = nowTag();
  const mode = (process.argv[2] || 'immediate').toLowerCase();
  const holdMs = Number(process.argv[3] || '120000');
  const jsonPath = path.join(OUTPUT_DIR, `toutiao-publish-once-${tag}.json`);
  const pngPath = path.join(OUTPUT_DIR, `toutiao-publish-once-${tag}.png`);

  const publishTitle = `头条发文流程测试-${nowCN()}`;
  const publishContent = [
    '这是一篇发布流程联调测试文章。',
    '主要用于检查标题、正文、封面与提交流程是否正常。',
    `测试时间：${nowCN()}`
  ].join('\\n');

  try {
    const opened = await openWindow(app);
    console.log('[publish-once] open:', opened.url);
    await waitReady(app, 120000);

    let result;
    try {
      result = await runPublish(app, publishTitle, publishContent, mode);
    } catch (error) {
      const currentUrl = await getPublishWindowUrl(app);
      if (
        currentUrl.includes('/profile_v4/graphic/manage') ||
        currentUrl.includes('/profile_v4/graphic/articles')
      ) {
        result = {
          success: true,
          reason: 'list-page-after-navigation',
          href: currentUrl,
          logs: [{ step: 'execution-context-destroyed', message: error.message || String(error) }]
        };
      } else {
        throw error;
      }
    }
    await capture(app, pngPath);
    fs.writeFileSync(jsonPath, JSON.stringify({
      runAt: nowCN(),
      mode,
      publishTitle,
      publishContent,
      result
    }, null, 2), 'utf8');

    console.log('[publish-once] result saved:', jsonPath);
    console.log('[publish-once] screenshot saved:', pngPath);
    console.log('[publish-once] success:', !!result?.success);
    if (result?.reason) console.log('[publish-once] reason:', result.reason);
    if (result?.toast) console.log('[publish-once] toast:', result.toast);
    if (result?.hint) console.log('[publish-once] hint:', result.hint);

    if (mode === 'preview_only' && result?.success) {
      console.log('[publish-once] preview_hold_ms:', holdMs);
      await sleep(holdMs);
    }
  } finally {
    await close(app);
    await app.close();
  }
}

main().catch(err => {
  console.error('[publish-once] ❌', err.message || err);
  process.exit(1);
});
