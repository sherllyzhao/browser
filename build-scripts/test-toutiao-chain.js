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

async function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function openWindow(app) {
  return app.evaluate(async ({ BrowserWindow }, { targetUrl }) => {
    let win = global.__TT_CHAIN_WINDOW__;
    if (!win || win.isDestroyed()) {
      win = new BrowserWindow({
        width: 1440,
        height: 980,
        show: true,
        title: '头条链路压测',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false
        }
      });
      global.__TT_CHAIN_WINDOW__ = win;
    }
    await win.loadURL(targetUrl);
    return { ok: true, url: win.webContents.getURL() };
  }, { targetUrl: TARGET_URL });
}

async function waitEditorReady(app, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await app.evaluate(async () => {
      const win = global.__TT_CHAIN_WINDOW__;
      if (!win || win.isDestroyed()) return { ok: false, reason: 'no-window' };
      const s = await win.webContents.executeJavaScript(
        `(() => {
          const href = location.href;
          const titleInput = document.querySelector('textarea[placeholder*="标题"], input[placeholder*="标题"]');
          const editor = document.querySelector('.ProseMirror, [contenteditable="true"]');
          return { href, title: document.title, hasTitleInput: !!titleInput, hasEditor: !!editor };
        })()`,
        true
      );
      return { ok: true, ...s };
    });

    if (status.ok) {
      console.log(`[chain] href=${status.href.slice(0, 120)} hasTitle=${status.hasTitleInput} hasEditor=${status.hasEditor}`);
      if (status.hasTitleInput && status.hasEditor) return status;
    }
    await sleep(2000);
  }
  throw new Error('未进入可编辑发布页（可能未登录）');
}

async function runChain(app) {
  return app.evaluate(async () => {
    const win = global.__TT_CHAIN_WINDOW__;
    if (!win || win.isDestroyed()) return { ok: false, reason: 'no-window' };

    return win.webContents.executeJavaScript(
      `(() => {
        const delay = ms => new Promise(r => setTimeout(r, ms));
        const log = [];
        const push = (step, extra = {}) => log.push({ step, ...extra });
        const textOf = el => (el?.textContent || '').trim();
        const isVisible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) return false;
          const style = window.getComputedStyle(el);
          if (!style) return true;
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          if (Number(style.opacity || '1') === 0) return false;
          return true;
        };

        const setInputValue = (input, value) => {
          try {
            const proto = input.tagName.toLowerCase() === 'textarea'
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
            const valueSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (valueSetter) valueSetter.call(input, value);
            else input.value = value;
          } catch (_) {
            input.value = value;
          }
          try {
            input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
          } catch (_) {}
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        };

        const findVisible = (els) => els.find(isVisible);

        const findTitleInput = () =>
          findVisible(Array.from(document.querySelectorAll(
            'textarea[placeholder*="请输入文章标题"], textarea[placeholder*="文章标题"], textarea[placeholder*="标题"], input[placeholder*="标题"]'
          )))
          || document.querySelector('textarea[placeholder*="请输入文章标题"], textarea[placeholder*="文章标题"], textarea[placeholder*="标题"], input[placeholder*="标题"]');
        const findEditor = () => findVisible(Array.from(document.querySelectorAll('.ProseMirror, [contenteditable="true"]')));
        const findButton = (matcher, options = {}) => {
          const all = Array.from(document.querySelectorAll('button')).filter(btn => matcher(textOf(btn), btn));
          if (all.length === 0) return null;
          const visible = all.find(btn => isVisible(btn));
          if (visible) return visible;
          if (options.allowHidden) return all[0];
          return null;
        };
        const clickButton = (btn) => {
          if (!btn) return false;
          try {
            btn.scrollIntoView?.({ behavior: 'auto', block: 'center' });
          } catch (_) {}
          btn.click();
          return true;
        };
        const getFooterButtons = () => {
          const footer =
            document.querySelector('.garr-footer-publish-content') ||
            document.querySelector('[class*="garr-footer-publish-content"]') ||
            document.querySelector('[class*="footer"]');
          if (!footer) return [];
          return Array.from(footer.querySelectorAll('button'));
        };
        const findScheduleButton = () => {
          const byText = findButton((t) => t === '定时发布', { allowHidden: true });
          if (byText) return byText;
          const footerButtons = getFooterButtons();
          return footerButtons[1] || null;
        };
        const findPublishActionButton = () => {
          const byText = findButton((t) => t === '预览并发布' || t === '发布' || t.includes('发布文章'), { allowHidden: true });
          if (byText) return byText;
          const direct = document.querySelector('button.publish-btn-last, button[class*="publish-btn-last"]');
          if (direct) return direct;
          const footerButtons = getFooterButtons();
          return footerButtons[2] || null;
        };
        const findVisibleText = (patterns) => {
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
          const regs = patterns.map(p => (p instanceof RegExp ? p : new RegExp(p)));
          for (const selector of selectors) {
            const nodes = document.querySelectorAll(selector);
            for (const node of nodes) {
              if (!isVisible(node)) continue;
              const t = textOf(node);
              if (!t) continue;
              if (regs.some(reg => reg.test(t))) return t;
            }
          }
          return '';
        };

        const findToast = () => {
          const selectors = [
            '.byte-message-content',
            '.byte-message-notice-content-text',
            '.semi-toast-content-text',
            '.arco-message-content',
            '.syl-message-content'
          ];
          for (const s of selectors) {
            const el = document.querySelector(s);
            if (el && textOf(el)) return textOf(el);
          }
          return '';
        };

        const isLikelyModal = (el) => {
          const cls = (el.className || '').toString();
          return /modal|dialog|popup|drawer/i.test(cls);
        };

        const findCancelInModal = () => {
          const modalRoots = Array.from(document.querySelectorAll('*')).filter(isLikelyModal);
          const scope = modalRoots.length ? modalRoots[modalRoots.length - 1] : document;
          const buttons = Array.from(scope.querySelectorAll('button'));
          return buttons.find(btn => {
            const t = textOf(btn);
            return t === '取消' || t === '关闭' || t.includes('返回修改') || t.includes('继续编辑');
          }) || null;
        };

        const run = async () => {
          // 0) 填充标题、正文
          const titleInput = findTitleInput();
          const editor = findEditor();
          if (!titleInput || !editor) {
            push('prereq-missing', { hasTitleInput: !!titleInput, hasEditor: !!editor });
            return { success: false, log };
          }

          const title = '链路压测-' + new Date().toLocaleString();
          titleInput.focus();
          setInputValue(titleInput, title);
          await delay(800);
          const titleHint = findVisibleText([/还需输入\s*\d+\s*个字/, /标题不能为空/]);
          push('title-filled', { title, finalValue: titleInput.value || '', titleHint });

          editor.focus();
          editor.innerHTML = '';
          const p1 = document.createElement('p');
          p1.textContent = '这是头条发布链路压测正文。';
          const p2 = document.createElement('p');
          p2.textContent = '时间：' + new Date().toLocaleString();
          editor.appendChild(p1);
          editor.appendChild(p2);
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: p1.textContent }));
          editor.dispatchEvent(new Event('change', { bubbles: true }));
          await delay(300);
          push('editor-filled', { len: (editor.innerText || '').trim().length });

          // 1) 封面上传链路：点击封面加号 -> 找文件输入 -> 生成测试图片并上传
          const coverBlock = document.querySelector('.article-cover, .pgc-edit-cell .edit-label');
          if (coverBlock && coverBlock.scrollIntoView) {
            coverBlock.scrollIntoView({ behavior: 'auto', block: 'center' });
            await delay(300);
          }
          const coverTrigger =
            findVisible(Array.from(document.querySelectorAll('.article-cover-add'))) ||
            findVisible(Array.from(document.querySelectorAll('[class*="cover-add"]'))) ||
            findVisible(Array.from(document.querySelectorAll('button,div,span,p')).filter(el => textOf(el).includes('添加封面')));
          if (coverTrigger) {
            coverTrigger.click();
            push('cover-trigger-clicked', { text: textOf(coverTrigger) });
            await delay(1000);
          } else {
            push('cover-trigger-not-found');
          }

          let coverUploaded = false;
          const fileInput =
            Array.from(document.querySelectorAll('input[type="file"]')).find(el => {
              const accept = (el.getAttribute('accept') || '').toLowerCase();
              const cls = (el.className || '').toString().toLowerCase();
              return accept.includes('image') || cls.includes('upload') || cls.includes('cover');
            }) ||
            document.querySelector('input[type="file"]');

          if (fileInput) {
            push('cover-file-input-found', {
              accept: fileInput.getAttribute('accept') || '',
              className: (fileInput.className || '').toString()
            });
            const isImageInput = (() => {
              const accept = (fileInput.getAttribute('accept') || '').toLowerCase();
              return accept.includes('image') || accept.includes('png') || accept.includes('jpg') || accept === '';
            })();
            if (!isImageInput) {
              push('cover-file-input-suspect', { accept: fileInput.getAttribute('accept') || '' });
            }
            // 生成 1280x720 的测试 PNG 文件（避免尺寸过小）
            const canvas = document.createElement('canvas');
            canvas.width = 1280;
            canvas.height = 720;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#3b82f6';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#ffffff';
            ctx.font = '48px sans-serif';
            ctx.fillText('Toutiao Cover Test', 40, 90);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            const file = new File([blob], 'tt-chain-cover.png', { type: 'image/png' });
            const dt = new DataTransfer();
            dt.items.add(file);
            fileInput.files = dt.files;
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            await delay(1000);

            const modalConfirm = findButton((t) => t === '确定' || t === '完成' || t === '使用', { allowHidden: true });
            if (modalConfirm && !modalConfirm.disabled) {
              clickButton(modalConfirm);
              push('cover-modal-confirm-clicked', { text: textOf(modalConfirm) });
              await delay(800);
            } else {
              const modalCancel = findButton((t) => t === '取消' || t === '关闭', { allowHidden: true });
              if (modalCancel) {
                clickButton(modalCancel);
                push('cover-modal-cancel-clicked', { text: textOf(modalCancel) });
                await delay(400);
              }
            }

            const hasCoverPreview =
              !!document.querySelector('.article-cover-images img, .article-cover img, [class*="cover"] img') ||
              !!document.querySelector('.article-cover-images [class*="uploaded"], .article-cover-images [class*="image"]') ||
              !!Array.from(document.querySelectorAll('.article-cover-images button, .article-cover button, .article-cover-images div'))
                .find(el => /编辑|替换|预览/.test(textOf(el)));
            const coverError = findVisibleText([/封面.*不能为空/, /上传失败/, /格式不支持/, /请选择封面/]);
            coverUploaded = hasCoverPreview && !coverError;
            push('cover-upload-triggered', { hasCoverPreview, coverError });

            // 上传后页面会有异步处理，等待 footer 按钮恢复完整态
            let footerReady = false;
            for (let i = 0; i < 8; i++) {
              const footerTexts = getFooterButtons().map(btn => textOf(btn)).filter(Boolean);
              if (footerTexts.some(t => t.includes('预览并发布'))) {
                footerReady = true;
                push('cover-after-wait-ready', { attempt: i + 1, footerTexts });
                break;
              }
              await delay(700);
            }
            if (!footerReady) {
              const footerTexts = getFooterButtons().map(btn => textOf(btn)).filter(Boolean);
              push('cover-after-wait-timeout', { footerTexts });
            }
          } else {
            push('cover-file-input-not-found');
          }

          // 2) 定时发布链路：点击“定时发布”，检测弹层，再点取消/关闭
          let scheduleOpened = false;
          for (let attempt = 1; attempt <= 5; attempt++) {
            const scheduleBtn = findScheduleButton();
            if (!scheduleBtn) {
              await delay(600);
              continue;
            }
            clickButton(scheduleBtn);
            await delay(900);
            const modalSignals = Array.from(document.querySelectorAll(
              '.byte-modal-wrapper, .byte-modal, .semi-modal, .arco-modal, [class*="picker"], [class*="calendar"], [class*="popover"]'
            )).filter(el => isVisible(el) && /(定时|发布时间|选择时间)/.test(textOf(el)));
            scheduleOpened = modalSignals.length > 0;
            push('schedule-clicked', { attempt, opened: scheduleOpened, signalCount: modalSignals.length });

            if (scheduleOpened) {
              const cancel = findCancelInModal()
                || findButton((t) => t === '取消' || t === '关闭' || t.includes('返回修改'), { allowHidden: true });
              if (cancel) {
                clickButton(cancel);
                push('schedule-cancel-clicked', { text: textOf(cancel) });
                await delay(500);
              } else {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                await delay(300);
                push('schedule-cancel-not-found');
              }
              break;
            }
            await delay(700);
          }
          if (!scheduleOpened) {
            push('schedule-btn-not-found');
          }

          // 3) 二次确认链路：点击“预览并发布”，只检测确认弹层，不执行最终发布
          let secondConfirmSeen = false;
          let secondConfirmPath = '';
          let publishBtn = null;
          for (let attempt = 1; attempt <= 8; attempt++) {
            const candidate = findPublishActionButton();
            if (candidate) {
              publishBtn = candidate;
              if ((candidate.textContent || '').trim()) {
                push('publish-btn-ready', { attempt, text: (candidate.textContent || '').trim(), disabled: !!candidate.disabled });
              }
              if (!candidate.disabled) break;
            }
            await delay(700);
          }
          if (!publishBtn) {
            const allButtonTexts = Array.from(document.querySelectorAll('button'))
              .map(btn => textOf(btn))
              .filter(Boolean)
              .slice(0, 80);
            const bodySample = (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 260);
            push('button-scan', { allButtonTexts, bodySample });
            push('publish-btn-not-found');
            return { success: false, log };
          }
          const hrefBeforePublishClick = location.href;

          clickButton(publishBtn);
          push('publish-btn-clicked', { text: textOf(publishBtn), disabled: !!publishBtn.disabled });
          await delay(1200);

          const maybeConfirm = findButton((t) => t === '确认发布' || t === '发布' || t === '立即发布' || t.includes('确认'));
          const cancelInModal = findCancelInModal();
          const toastAfterClick = findToast();
          const nowHref = location.href;
          const validationText = findVisibleText([/标题不能为空/, /还需输入\s*\d+\s*个字/, /封面/, /请先/]);
          const publishBtnAfter = findButton((t) => t === '预览并发布' || t === '发布');
          const publishLoading = !!(publishBtn && (
            /loading|disabled/.test((publishBtn.className || '').toString().toLowerCase())
            || publishBtn.querySelector('[class*="loading"], [class*="spin"]')
          ));

          if (maybeConfirm || cancelInModal) {
            secondConfirmSeen = true;
            secondConfirmPath = 'confirm-modal';
            push('second-confirm-detected', {
              confirmText: maybeConfirm ? textOf(maybeConfirm) : '',
              cancelText: cancelInModal ? textOf(cancelInModal) : ''
            });
            if (cancelInModal) {
              cancelInModal.click();
              push('second-confirm-cancel-clicked', { text: textOf(cancelInModal) });
            }
          } else if (nowHref !== hrefBeforePublishClick || !publishBtnAfter) {
            secondConfirmSeen = true;
            secondConfirmPath = 'preview-state';
            push('second-confirm-preview-state', { href: location.href });
          } else if (toastAfterClick) {
            secondConfirmSeen = true;
            secondConfirmPath = 'toast-feedback';
            push('second-confirm-toast', { toastAfterClick });
          } else if (publishLoading && !validationText) {
            secondConfirmSeen = true;
            secondConfirmPath = 'submit-processing';
            push('second-confirm-processing', { className: (publishBtn.className || '').toString() });
          } else {
            push('second-confirm-not-detected', { toastAfterClick, validationText });
          }

          const titleError = findVisibleText([/标题不能为空/, /还需输入\s*\d+\s*个字/]);
          if (titleError) {
            push('title-error-visible', { text: titleError });
          }

          return {
            success: true,
            chain: {
              coverUploaded,
              scheduleOpened,
              secondConfirmSeen,
              secondConfirmPath
            },
            toast: findToast(),
            log
          };
        };

        return run();
      })()`,
      true
    );
  });
}

async function capture(app, pngPath) {
  const res = await app.evaluate(async () => {
    const win = global.__TT_CHAIN_WINDOW__;
    if (!win || win.isDestroyed()) return { ok: false, reason: 'no-window' };
    const image = await win.webContents.capturePage();
    return { ok: true, pngBase64: image.toPNG().toString('base64') };
  });
  if (!res.ok) return res;
  fs.writeFileSync(pngPath, Buffer.from(res.pngBase64, 'base64'));
  return { ok: true };
}

async function close(app) {
  try {
    await app.evaluate(() => {
      const win = global.__TT_CHAIN_WINDOW__;
      if (win && !win.isDestroyed()) win.close();
    });
  } catch (_) {}
}

async function main() {
  await ensureOutputDir();
  const app = await electron.launch({ args: ['.'], cwd: REPO_DIR });
  const tag = nowTag();
  const jsonPath = path.join(OUTPUT_DIR, `toutiao-chain-${tag}.json`);
  const pngPath = path.join(OUTPUT_DIR, `toutiao-chain-${tag}.png`);

  try {
    const opened = await openWindow(app);
    console.log('[chain] open:', opened.url);

    await waitEditorReady(app, 120000);
    const result = await runChain(app);
    await capture(app, pngPath);
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');

    console.log('[chain] result saved:', jsonPath);
    console.log('[chain] screenshot saved:', pngPath);
    console.log('[chain] success:', !!result?.success);
    if (result?.chain) {
      console.log('[chain] coverUploaded:', result.chain.coverUploaded);
      console.log('[chain] scheduleOpened:', result.chain.scheduleOpened);
      console.log('[chain] secondConfirmSeen:', result.chain.secondConfirmSeen);
    }
  } finally {
    await close(app);
    await app.close();
  }
}

main().catch(err => {
  console.error('[chain] ❌', err.message || err);
  process.exit(1);
});
