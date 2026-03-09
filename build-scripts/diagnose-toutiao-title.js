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

async function ensureDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function main() {
  await ensureDir();
  const app = await electron.launch({ args: ['.'], cwd: REPO_DIR });
  const out = path.join(OUTPUT_DIR, `toutiao-title-diag-${nowTag()}.json`);

  try {
    await app.evaluate(async ({ BrowserWindow }, { url }) => {
      let win = global.__TT_TITLE_DIAG_WINDOW__;
      if (!win || win.isDestroyed()) {
        win = new BrowserWindow({
          width: 1400,
          height: 960,
          show: true,
          title: '头条标题诊断',
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
          }
        });
        global.__TT_TITLE_DIAG_WINDOW__ = win;
      }
      await win.loadURL(url);
    }, { url: TARGET_URL });

    const start = Date.now();
    while (Date.now() - start < 120000) {
      const ok = await app.evaluate(async () => {
        const win = global.__TT_TITLE_DIAG_WINDOW__;
        return win.webContents.executeJavaScript(
          `(() => !!document.querySelector('textarea[placeholder*="标题"], input[placeholder*="标题"]'))()`,
          true
        );
      });
      if (ok) break;
      await sleep(2000);
    }

    const result = await app.evaluate(async () => {
      const win = global.__TT_TITLE_DIAG_WINDOW__;
      return win.webContents.executeJavaScript(
        `(async () => {
          try {
            const delay = ms => new Promise(r => setTimeout(r, ms));
            const text = el => (el?.textContent || '').trim();
            const findInput = () => {
              const list = Array.from(document.querySelectorAll('textarea[placeholder*="标题"], input[placeholder*="标题"]'));
              return list.find(el => {
                const r = el.getBoundingClientRect();
                return r.width > 120 && r.height > 20;
              }) || list[0] || null;
            };

            const state = (label, input) => {
              const error = Array.from(document.querySelectorAll('*')).find(el => text(el).includes('标题不能为空'));
              const needText = Array.from(document.querySelectorAll('*')).find(el => text(el).includes('还需输入'));
              const titleWrap = input?.closest('div')?.parentElement;
              return {
                label,
                value: input ? input.value : '',
                placeholder: input ? input.getAttribute('placeholder') : '',
                needHint: needText ? text(needText) : '',
                titleError: error ? text(error) : '',
                titleWrapText: titleWrap ? text(titleWrap).slice(0, 300) : ''
              };
            };

            const input = findInput();
            if (!input) return { success: false, reason: 'no-input' };

            const reports = [];
            reports.push(state('initial', input));

            const v1 = '诊断A-' + new Date().toLocaleTimeString();
            input.focus();
            input.value = v1;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await delay(1200);
            reports.push(state('method-a-direct-value', input));

            const v2 = '诊断B-' + new Date().toLocaleTimeString();
            try {
              const proto = input.tagName.toLowerCase() === 'textarea'
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;
              const valueSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              if (valueSetter) valueSetter.call(input, v2);
              else input.value = v2;
            } catch (_) {
              input.value = v2;
            }
            input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: v2 }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await delay(1200);
            reports.push(state('method-b-native-setter', input));

            const v3 = '诊断C-' + new Date().toLocaleTimeString();
            input.focus();
            try {
              input.select();
            } catch (_) {}
            if (document.execCommand) {
              try {
                document.execCommand('insertText', false, v3);
              } catch (_) {
                input.value = v3;
              }
            } else {
              input.value = v3;
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await delay(1200);
            reports.push(state('method-c-execCommand', input));

            return { success: true, reports };
          } catch (error) {
            return { success: false, error: error?.message || String(error), stack: error?.stack || '' };
          }
        })()`,
        true
      );
    });

    fs.writeFileSync(out, JSON.stringify(result, null, 2), 'utf8');
    console.log('[title-diag] saved:', out);
  } finally {
    try {
      await app.evaluate(() => {
        const win = global.__TT_TITLE_DIAG_WINDOW__;
        if (win && !win.isDestroyed()) win.close();
      });
    } catch (_) {}
    await app.close();
  }
}

main().catch(err => {
  console.error('[title-diag] ❌', err.message || err);
  process.exit(1);
});
