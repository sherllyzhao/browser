const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright-core');

const REPO_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(REPO_DIR, 'docs', 'debug');
const TARGET_URL = 'https://mp.toutiao.com/profile_v4/graphic/publish?from=toutiao_pc';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function tag() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function ensureDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function main() {
  await ensureDir();
  const app = await electron.launch({ args: ['.'], cwd: REPO_DIR });
  const t = tag();
  const jsonPath = path.join(OUTPUT_DIR, `toutiao-actions-${t}.json`);
  const pngPath = path.join(OUTPUT_DIR, `toutiao-actions-${t}.png`);

  try {
    await app.evaluate(async ({ BrowserWindow }, { targetUrl }) => {
      let win = global.__TT_ACTION_WINDOW__;
      if (!win || win.isDestroyed()) {
        win = new BrowserWindow({
          width: 1440,
          height: 980,
          show: true,
          title: '头条动作探针',
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
          }
        });
        global.__TT_ACTION_WINDOW__ = win;
      }
      await win.loadURL(targetUrl);
    }, { targetUrl: TARGET_URL });

    const start = Date.now();
    while (Date.now() - start < 120000) {
      const ready = await app.evaluate(async () => {
        const win = global.__TT_ACTION_WINDOW__;
        const s = await win.webContents.executeJavaScript(
          `(() => !!document.querySelector('textarea[placeholder*="标题"]') && !!document.querySelector('.ProseMirror,[contenteditable="true"]'))()`,
          true
        );
        return !!s;
      });
      if (ready) break;
      await sleep(2000);
    }

    const result = await app.evaluate(async () => {
      const win = global.__TT_ACTION_WINDOW__;
      return win.webContents.executeJavaScript(
        `(() => {
          const delay = ms => new Promise(r => setTimeout(r, ms));
          const text = el => (el?.textContent || '').trim();
          const rect = el => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
          };
          const visible = el => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.width > 8 && r.height > 8;
          };
          const ser = el => ({
            tag: el.tagName.toLowerCase(),
            cls: (el.className || '').toString(),
            txt: text(el).slice(0, 80),
            rect: rect(el),
            html: (el.outerHTML || '').slice(0, 500)
          });

          const snapshot = (label) => {
            const buttons = Array.from(document.querySelectorAll('button')).filter(visible).map(ser).slice(0, 120);
            const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map(ser);
            const coverEls = Array.from(document.querySelectorAll('[class*="cover"], [id*="cover"]')).filter(visible).map(ser).slice(0, 120);
            const plusEls = Array.from(document.querySelectorAll('*')).filter(el => {
              if (!visible(el)) return false;
              const t = text(el);
              return t === '+' || t.includes('添加封面') || t.includes('封面');
            }).map(ser).slice(0, 120);
            const toast = Array.from(document.querySelectorAll('*')).map(el => text(el)).find(t => t.includes('不能为空') || t.includes('失败') || t.includes('成功')) || '';
            return {
              label,
              href: location.href,
              title: document.title,
              buttons,
              fileInputs,
              coverEls,
              plusEls,
              toast,
              bodySample: (document.body?.innerText || '').slice(0, 1200)
            };
          };

          const run = async () => {
            const out = [];

            // 关掉引导气泡
            const knowBtn = Array.from(document.querySelectorAll('button,span,div')).find(el => text(el) === '我知道了');
            if (knowBtn) knowBtn.click();
            await delay(300);
            out.push(snapshot('initial'));

            // 尝试点封面区域
            const coverBtn =
              Array.from(document.querySelectorAll('button')).find(el => text(el).includes('添加封面')) ||
              Array.from(document.querySelectorAll('*')).find(el => {
                if (!visible(el)) return false;
                const cls = (el.className || '').toString();
                const t = text(el);
                return cls.includes('cover') && (t === '+' || t.includes('添加') || t.includes('封面'));
              }) ||
              Array.from(document.querySelectorAll('*')).find(el => visible(el) && text(el) === '+');

            if (coverBtn) {
              coverBtn.click();
            }
            await delay(900);
            out.push(snapshot('after-cover-click'));

            // 点定时发布
            const scheduleBtn = Array.from(document.querySelectorAll('button')).find(el => text(el) === '定时发布');
            if (scheduleBtn) scheduleBtn.click();
            await delay(900);
            out.push(snapshot('after-schedule-click'));

            // 点预览并发布
            const publishBtn = Array.from(document.querySelectorAll('button')).find(el => text(el) === '预览并发布');
            if (publishBtn) publishBtn.click();
            await delay(1200);
            out.push(snapshot('after-publish-click'));

            return out;
          };

          return run();
        })()`,
        true
      );
    });

    const image = await app.evaluate(async () => {
      const win = global.__TT_ACTION_WINDOW__;
      const img = await win.webContents.capturePage();
      return img.toPNG().toString('base64');
    });

    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
    fs.writeFileSync(pngPath, Buffer.from(image, 'base64'));
    console.log('[actions] saved:', jsonPath);
    console.log('[actions] screenshot:', pngPath);
  } finally {
    try {
      await app.evaluate(() => {
        const win = global.__TT_ACTION_WINDOW__;
        if (win && !win.isDestroyed()) win.close();
      });
    } catch (_) {}
    await app.close();
  }
}

main().catch(err => {
  console.error('[actions] ❌', err.message || err);
  process.exit(1);
});
