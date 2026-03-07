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

async function openProbeWindow(app) {
  return app.evaluate(async ({ BrowserWindow }, { targetUrl }) => {
    let win = global.__TT_FLOW_WINDOW__;
    if (!win || win.isDestroyed()) {
      win = new BrowserWindow({
        width: 1400,
        height: 960,
        show: true,
        title: '头条发布动作联调',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false
        }
      });
      global.__TT_FLOW_WINDOW__ = win;
    }
    await win.loadURL(targetUrl);
    return { ok: true, url: win.webContents.getURL() };
  }, { targetUrl: TARGET_URL });
}

async function getPageStatus(app) {
  return app.evaluate(async () => {
    const win = global.__TT_FLOW_WINDOW__;
    if (!win || win.isDestroyed()) return { ok: false, reason: 'no-window' };
    const payload = await win.webContents.executeJavaScript(`
      (() => {
        const href = location.href;
        const titleInput = document.querySelector('textarea[placeholder*="标题"], input[placeholder*="标题"]');
        const editor = document.querySelector('#root .ProseMirror, .ProseMirror, [contenteditable="true"]');
        const publishBtn = Array.from(document.querySelectorAll('button')).find(btn => {
          const t = (btn.textContent || '').trim();
          return t === '预览并发布' || t === '发布' || t.includes('发布文章');
        });
        return {
          href,
          title: document.title,
          hasTitleInput: !!titleInput,
          hasEditor: !!editor,
          hasPublishBtn: !!publishBtn,
          bodySample: (document.body?.innerText || '').slice(0, 400)
        };
      })()
    `, true);
    return { ok: true, payload };
  });
}

async function runFlow(app) {
  return app.evaluate(async () => {
    const win = global.__TT_FLOW_WINDOW__;
    if (!win || win.isDestroyed()) return { ok: false, reason: 'no-window' };

    return win.webContents.executeJavaScript(`
      (async () => {
        const delay = ms => new Promise(r => setTimeout(r, ms));
        const out = { steps: [], success: false };
        const push = (step, extra = {}) => out.steps.push({ step, ...extra });

        const findTitleInput = () =>
          document.querySelector('textarea[placeholder*="标题"], input[placeholder*="标题"], textarea[placeholder*="填写标题"], input[placeholder*="填写标题"]');

        const findEditor = () =>
          document.querySelector('#root .ProseMirror, .ProseMirror, [contenteditable="true"]');

        const findPublishBtn = () => {
          const buttons = Array.from(document.querySelectorAll('button'));
          return buttons.find(btn => (btn.textContent || '').trim() === '预览并发布')
            || buttons.find(btn => (btn.textContent || '').trim() === '发布')
            || buttons.find(btn => (btn.textContent || '').includes('发布'));
        };

        const titleInput = findTitleInput();
        if (!titleInput) {
          push('title-input-not-found');
          return out;
        }
        const testTitle = '自动联调-' + new Date().toLocaleString();
        titleInput.focus();
        try {
          const proto = titleInput.tagName.toLowerCase() === 'textarea'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
          const valueSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (valueSetter) {
            valueSetter.call(titleInput, testTitle);
          } else {
            titleInput.value = testTitle;
          }
        } catch (_) {
          titleInput.value = testTitle;
        }
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        titleInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: testTitle }));
        titleInput.dispatchEvent(new Event('change', { bubbles: true }));
        titleInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        await delay(250);
        push('title-filled', { value: testTitle, finalValue: titleInput.value || '' });

        await delay(300);

        const editor = findEditor();
        if (!editor) {
          push('editor-not-found');
          return out;
        }
        editor.focus();
        editor.innerHTML = '';
        const p1 = document.createElement('p');
        p1.textContent = '这是一条自动联调内容，用于验证头条发布页选择器。';
        const p2 = document.createElement('p');
        p2.textContent = '联调时间：' + new Date().toLocaleString();
        editor.appendChild(p1);
        editor.appendChild(p2);
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: p1.textContent }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
        push('editor-filled', { len: (editor.innerText || '').trim().length });

        await delay(700);

        const publishBtn = findPublishBtn();
        if (!publishBtn) {
          push('publish-btn-not-found');
          return out;
        }

        const publishText = (publishBtn.textContent || '').trim();
        push('publish-btn-found', { text: publishText, disabled: !!publishBtn.disabled });
        if (publishBtn.disabled) {
          push('publish-btn-disabled');
          return out;
        }

        publishBtn.click();
        push('publish-btn-clicked', { text: publishText });
        await delay(1200);

        const titleErrorEl = Array.from(document.querySelectorAll('*')).find(el => {
          const t = (el.textContent || '').trim();
          return t.includes('标题不能为空');
        });
        if (titleErrorEl) {
          push('title-still-empty-error', { text: (titleErrorEl.textContent || '').trim() });
        }

        const allButtons = Array.from(document.querySelectorAll('button'));
        const confirmLike = allButtons
          .map(btn => ({ text: (btn.textContent || '').trim(), className: btn.className || '' }))
          .filter(x => x.text && (x.text.includes('确认') || x.text.includes('发布') || x.text.includes('取消') || x.text.includes('关闭')));
        push('after-first-click-buttons', { buttons: confirmLike.slice(0, 20) });

        // 为避免误发，优先尝试点取消/关闭
        const cancelBtn = allButtons.find(btn => {
          const t = (btn.textContent || '').trim();
          return t === '取消' || t === '关闭' || t.includes('返回修改');
        });
        if (cancelBtn) {
          cancelBtn.click();
          push('cancel-clicked', { text: (cancelBtn.textContent || '').trim() });
          out.success = true;
          return out;
        }

        // 没找到取消，只记录现场，不再继续二次确认
        push('cancel-not-found');
        out.success = true;
        return out;
      })();
    `, true);
  });
}

async function capture(app, filePath) {
  const result = await app.evaluate(async () => {
    const win = global.__TT_FLOW_WINDOW__;
    if (!win || win.isDestroyed()) return { ok: false, reason: 'no-window' };
    const image = await win.webContents.capturePage();
    return { ok: true, pngBase64: image.toPNG().toString('base64') };
  });
  if (!result.ok) return result;
  fs.writeFileSync(filePath, Buffer.from(result.pngBase64, 'base64'));
  return { ok: true };
}

async function close(app) {
  try {
    await app.evaluate(async () => {
      const win = global.__TT_FLOW_WINDOW__;
      if (win && !win.isDestroyed()) win.close();
    });
  } catch (_) {}
}

async function main() {
  await ensureOutputDir();
  const app = await electron.launch({ args: ['.'], cwd: REPO_DIR });
  const tag = nowTag();
  const jsonPath = path.join(OUTPUT_DIR, `toutiao-flow-${tag}.json`);
  const pngPath = path.join(OUTPUT_DIR, `toutiao-flow-${tag}.png`);

  try {
    const open = await openProbeWindow(app);
    console.log('[flow] open:', open.url);

    const started = Date.now();
    let ready = false;
    while (Date.now() - started < 120000) {
      const status = await getPageStatus(app);
      if (status.ok) {
        const p = status.payload;
        console.log(`[flow] href=${p.href.slice(0, 120)} title=${p.title} hasTitle=${p.hasTitleInput} hasEditor=${p.hasEditor} hasPublish=${p.hasPublishBtn}`);
        if (p.hasTitleInput && p.hasEditor) {
          ready = true;
          break;
        }
      }
      await sleep(2000);
    }

    if (!ready) {
      throw new Error('未进入头条发布编辑态（可能未登录）');
    }

    const result = await runFlow(app);
    await capture(app, pngPath);
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
    console.log('[flow] result saved:', jsonPath);
    console.log('[flow] screenshot saved:', pngPath);
    console.log('[flow] success:', !!result?.success);
  } finally {
    await close(app);
    await app.close();
  }
}

main().catch(err => {
  console.error('[flow] ❌', err.message || err);
  process.exit(1);
});
