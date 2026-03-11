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

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const app = await electron.launch({ args: ['.'], cwd: REPO_DIR });
  const tag = nowTag();
  const outPath = path.join(OUTPUT_DIR, `toutiao-dom-detail-${tag}.json`);

  try {
    await app.evaluate(async ({ BrowserWindow }, { targetUrl }) => {
      let win = global.__TT_INSPECT_WINDOW__;
      if (!win || win.isDestroyed()) {
        win = new BrowserWindow({
          width: 1400,
          height: 960,
          show: true,
          title: '头条DOM细节采样',
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
          }
        });
        global.__TT_INSPECT_WINDOW__ = win;
      }
      await win.loadURL(targetUrl);
    }, { targetUrl: TARGET_URL });

    const start = Date.now();
    let ready = false;
    while (Date.now() - start < 120000) {
      const status = await app.evaluate(async () => {
        const win = global.__TT_INSPECT_WINDOW__;
        if (!win || win.isDestroyed()) return { ok: false };
        const s = await win.webContents.executeJavaScript(`
          (() => {
            const title = document.querySelector('textarea[placeholder*="标题"], input[placeholder*="标题"]');
            const editor = document.querySelector('.ProseMirror, [contenteditable="true"]');
            return { href: location.href, hasTitle: !!title, hasEditor: !!editor };
          })()
        `, true);
        return { ok: true, ...s };
      });
      if (status.ok && status.hasTitle && status.hasEditor) {
        ready = true;
        break;
      }
      await sleep(2000);
    }

    if (!ready) {
      throw new Error('未进入可采样状态（可能未登录）');
    }

    const detail = await app.evaluate(async () => {
      const win = global.__TT_INSPECT_WINDOW__;
      const data = await win.webContents.executeJavaScript(`
        (() => {
          const rectInfo = el => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
          };

          const serialize = (el) => ({
            tag: el.tagName.toLowerCase(),
            className: el.className || '',
            id: el.id || '',
            placeholder: el.getAttribute('placeholder') || '',
            text: (el.textContent || '').trim().slice(0, 120),
            value: 'value' in el ? (el.value || '').slice(0, 120) : '',
            attrs: Array.from(el.attributes || []).reduce((m, a) => {
              if (a.name === 'style') return m;
              m[a.name] = a.value;
              return m;
            }, {}),
            rect: rectInfo(el),
            outerHTML: (el.outerHTML || '').slice(0, 1200)
          });

          const titleLike = Array.from(document.querySelectorAll('textarea,input,[contenteditable="true"],div,p,h1,h2')).filter(el => {
            const ph = el.getAttribute('placeholder') || '';
            const dp = el.getAttribute('data-placeholder') || '';
            const txt = (el.textContent || '').trim();
            return ph.includes('标题') || dp.includes('标题') || txt.includes('请输入文章标题');
          });

          const editor = document.querySelector('.ProseMirror');
          const editorChildren = editor ? Array.from(editor.children).slice(0, 20).map(serialize) : [];

          const buttons = Array.from(document.querySelectorAll('button')).map(serialize).slice(0, 80);
          const textareas = Array.from(document.querySelectorAll('textarea')).map(serialize).slice(0, 50);
          const inputs = Array.from(document.querySelectorAll('input')).map(serialize).slice(0, 80);
          const contenteditables = Array.from(document.querySelectorAll('[contenteditable="true"]')).map(serialize).slice(0, 50);

          return {
            href: location.href,
            title: document.title,
            titleLike: titleLike.map(serialize),
            editor: editor ? serialize(editor) : null,
            editorChildren,
            textareas,
            inputs,
            contenteditables,
            buttons,
            bodySample: (document.body?.innerText || '').slice(0, 2000)
          };
        })()
      `, true);

      const image = await win.webContents.capturePage();
      return { data, pngBase64: image.toPNG().toString('base64') };
    });

    fs.writeFileSync(outPath, JSON.stringify(detail.data, null, 2), 'utf8');
    fs.writeFileSync(outPath.replace('.json', '.png'), Buffer.from(detail.pngBase64, 'base64'));
    console.log('[inspect] saved:', outPath);
  } finally {
    try {
      await app.evaluate(() => {
        const win = global.__TT_INSPECT_WINDOW__;
        if (win && !win.isDestroyed()) win.close();
      });
    } catch (_) {}
    await app.close();
  }
}

main().catch(err => {
  console.error('[inspect] ❌', err.message || err);
  process.exit(1);
});
