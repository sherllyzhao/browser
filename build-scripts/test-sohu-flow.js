const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright-core');

const REPO_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(REPO_DIR, 'docs', 'debug');
const TARGET_URL = 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nowTag() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function openProbeWindow(app) {
  return app.evaluate(async ({ BrowserWindow }, { targetUrl }) => {
    let win = global.__SOHU_FLOW_WINDOW__;
    if (!win || win.isDestroyed()) {
      win = new BrowserWindow({
        width: 1400,
        height: 960,
        show: true,
        title: '搜狐发布页联调',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false
        }
      });
      global.__SOHU_FLOW_WINDOW__ = win;
    }
    await win.loadURL(targetUrl);
    return { ok: true, url: win.webContents.getURL() };
  }, { targetUrl: TARGET_URL });
}

async function getPageStatus(app) {
  return app.evaluate(async () => {
    const win = global.__SOHU_FLOW_WINDOW__;
    if (!win || win.isDestroyed()) return { ok: false, reason: 'no-window' };
    const payload = await win.webContents.executeJavaScript(`
      (() => {
        const href = location.href;
        const titleInput = document.querySelector('.publish-title input');
        const introTextarea = document.querySelector('.abstract textarea');
        const editor = document.querySelector('#editor .ql-editor, .ql-editor[contenteditable="true"], [contenteditable="true"]');
        return {
          href,
          title: document.title,
          hasTitleInput: !!titleInput,
          hasIntroTextarea: !!introTextarea,
          hasEditor: !!editor,
          bodySample: (document.body?.innerText || '').slice(0, 300)
        };
      })()
    `, true);
    return { ok: true, payload };
  });
}

async function runFlow(app) {
  return app.evaluate(async () => {
    const win = global.__SOHU_FLOW_WINDOW__;
    if (!win || win.isDestroyed()) return { ok: false, reason: 'no-window' };
    return win.webContents.executeJavaScript(`
      (async () => {
        const out = { steps: [], success: false };
        const push = (step, extra = {}) => out.steps.push({ step, ...extra });
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

        const titleInput = document.querySelector('.publish-title input');
        const introTextarea = document.querySelector('.abstract textarea');
        const editor = document.querySelector('#editor .ql-editor, .ql-editor[contenteditable="true"], [contenteditable="true"]');

        if (!titleInput) {
          push('title-input-not-found');
          return out;
        }
        if (!introTextarea) {
          push('intro-textarea-not-found');
          return out;
        }
        if (!editor) {
          push('editor-not-found');
          return out;
        }

        const title = '自动联调-SOHU-' + new Date().toLocaleString();
        titleInput.focus();
        titleInput.value = '';
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        titleInput.value = title;
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        titleInput.dispatchEvent(new Event('change', { bubbles: true }));
        push('title-filled', { value: title, finalValue: titleInput.value || '' });

        const intro = '这是搜狐发布页自动冒烟摘要。';
        introTextarea.focus();
        introTextarea.value = '';
        introTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        introTextarea.value = intro;
        introTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        introTextarea.dispatchEvent(new Event('change', { bubbles: true }));
        push('intro-filled', { value: intro, finalValue: introTextarea.value || '' });

        editor.focus();
        editor.innerHTML = '';
        const p1 = document.createElement('p');
        p1.textContent = '这是一条搜狐富文本冒烟内容。';
        const p2 = document.createElement('p');
        p2.textContent = '联调时间：' + new Date().toLocaleString();
        editor.appendChild(p1);
        editor.appendChild(p2);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
        await delay(600);

        const textLen = (editor.innerText || editor.textContent || '').trim().length;
        push('editor-filled', { len: textLen });

        out.success = textLen > 0 && !!(titleInput.value || '').trim() && !!(introTextarea.value || '').trim();
        return out;
      })();
    `, true);
  });
}

async function capture(app, filePath) {
  const result = await app.evaluate(async () => {
    const win = global.__SOHU_FLOW_WINDOW__;
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
      const win = global.__SOHU_FLOW_WINDOW__;
      if (win && !win.isDestroyed()) win.close();
    });
  } catch (_) {}
}

async function main() {
  ensureOutputDir();
  const app = await electron.launch({ args: ['.'], cwd: REPO_DIR });
  const tag = nowTag();
  const jsonPath = path.join(OUTPUT_DIR, `sohu-flow-${tag}.json`);
  const pngPath = path.join(OUTPUT_DIR, `sohu-flow-${tag}.png`);

  try {
    const open = await openProbeWindow(app);
    console.log('[sohu-flow] open:', open.url);

    const started = Date.now();
    let ready = false;
    while (Date.now() - started < 120000) {
      const status = await getPageStatus(app);
      if (status.ok) {
        const p = status.payload;
        console.log(`[sohu-flow] href=${p.href.slice(0, 120)} title=${p.title} hasTitle=${p.hasTitleInput} hasIntro=${p.hasIntroTextarea} hasEditor=${p.hasEditor}`);
        if (p.hasTitleInput && p.hasIntroTextarea && p.hasEditor) {
          ready = true;
          break;
        }
      }
      await sleep(2000);
    }

    if (!ready) {
      throw new Error('未进入搜狐发布编辑态（可能未登录或页面结构变化）');
    }

    const result = await runFlow(app);
    await capture(app, pngPath);
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
    console.log('[sohu-flow] result saved:', jsonPath);
    console.log('[sohu-flow] screenshot saved:', pngPath);
    console.log('[sohu-flow] success:', !!result?.success);
  } finally {
    await close(app);
    await app.close();
  }
}

main().catch(err => {
  console.error('[sohu-flow] ❌', err.message || err);
  process.exit(1);
});
