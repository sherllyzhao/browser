const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright-core');

const REPO_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(REPO_DIR, 'docs', 'debug');
const TARGET_URL = 'https://mp.toutiao.com/profile_v4/graphic/publish?from=toutiao_pc';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function getMainViewStatus(electronApp) {
  return electronApp.evaluate(async () => {
    const win = global.__TT_PROBE_WINDOW__;
    if (!win || win.isDestroyed()) return { ok: false, reason: 'no-probe-window' };
    const url = win.webContents.getURL();
    const probe = await win.webContents.executeJavaScript(
      `(() => {
        const text = (document.body?.innerText || '').slice(0, 800);
        const titleInput = document.querySelector('textarea[placeholder*="标题"], input[placeholder*="标题"], textarea[placeholder*="填写标题"], input[placeholder*="填写标题"]');
        const editor = document.querySelector('#root .ProseMirror, .ProseMirror, [contenteditable="true"]');
        const publishBtn = Array.from(document.querySelectorAll('button')).find(btn => {
          const t = (btn.textContent || '').trim();
          return t === '发布' || t.includes('发布文章') || t.includes('确认发布');
        });
        return {
          href: location.href,
          title: document.title,
          readyState: document.readyState,
          hasTitleInput: !!titleInput,
          hasEditor: !!editor,
          hasPublishBtn: !!publishBtn,
          textHint: text
        };
      })()`,
      true
    );

    return { ok: true, url, probe };
  });
}

async function navigateToTarget(electronApp) {
  return electronApp.evaluate(async ({ BrowserWindow }, { targetUrl }) => {
    let probeWin = global.__TT_PROBE_WINDOW__;
    if (!probeWin || probeWin.isDestroyed()) {
      probeWin = new BrowserWindow({
        width: 1400,
        height: 960,
        show: true,
        title: '头条发布页探针',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false
        }
      });
      global.__TT_PROBE_WINDOW__ = probeWin;
    }
    await probeWin.loadURL(targetUrl);
    return { ok: true, current: probeWin.webContents.getURL() };
  }, { targetUrl: TARGET_URL });
}

async function collectDomSnapshot(electronApp) {
  return electronApp.evaluate(async () => {
    const win = global.__TT_PROBE_WINDOW__;
    if (!win || win.isDestroyed()) return { ok: false, reason: 'no-probe-window' };
    const payload = await win.webContents.executeJavaScript(
      `(() => {
        const uniq = arr => Array.from(new Set(arr.filter(Boolean)));

        const allButtons = Array.from(document.querySelectorAll('button')).map(btn => ({
          text: (btn.textContent || '').trim(),
          className: btn.className || '',
          disabled: !!btn.disabled
        })).filter(x => x.text);

        const inputs = Array.from(document.querySelectorAll('input, textarea')).map(el => ({
          tag: el.tagName.toLowerCase(),
          type: el.type || '',
          placeholder: el.placeholder || '',
          className: el.className || '',
          name: el.name || ''
        }));

        const editables = Array.from(document.querySelectorAll('[contenteditable="true"], .ProseMirror')).map(el => ({
          tag: el.tagName.toLowerCase(),
          className: el.className || '',
          textLen: (el.innerText || '').trim().length
        }));

        const titleCandidates = uniq([
          'textarea[placeholder*="标题"]',
          'input[placeholder*="标题"]',
          'textarea[placeholder*="填写标题"]',
          'input[placeholder*="填写标题"]',
          ...Array.from(document.querySelectorAll('textarea, input')).map(el => {
            const ph = el.placeholder || '';
            if (ph.includes('标题')) {
              const cls = (el.className || '').toString().trim().split(/\\s+/).filter(Boolean)[0];
              return cls ? el.tagName.toLowerCase() + '.' + cls : '';
            }
            return '';
          })
        ]);

        const editorCandidates = uniq([
          '#root .ProseMirror',
          '.ProseMirror',
          '[contenteditable="true"]'
        ]);

        const publishBtnCandidates = uniq([
          "button[class*='byte-btn-primary']",
          "[class*='garr-footer-publish-content'] button",
          ...Array.from(document.querySelectorAll('button')).map(btn => {
            const t = (btn.textContent || '').trim();
            if (!t) return '';
            if (t === '发布' || t.includes('发布文章') || t.includes('确认发布')) {
              const cls = (btn.className || '').toString().trim().split(/\\s+/).filter(Boolean)[0];
              return cls ? 'button.' + cls : 'button';
            }
            return '';
          })
        ]);

        return {
          href: location.href,
          title: document.title,
          readyState: document.readyState,
          titleCandidates,
          editorCandidates,
          publishBtnCandidates,
          inputs: inputs.slice(0, 120),
          buttons: allButtons.slice(0, 120),
          editables: editables.slice(0, 50),
          bodyTextSample: (document.body?.innerText || '').slice(0, 2000)
        };
      })()`,
      true
    );

    const image = await win.webContents.capturePage();
    return {
      ok: true,
      payload,
      pngBase64: image.toPNG().toString('base64')
    };
  });
}

async function main() {
  await ensureOutputDir();

  const electronApp = await electron.launch({
    args: ['.'],
    cwd: REPO_DIR
  });

  try {
    await sleep(2500);

    const navResult = await navigateToTarget(electronApp);
    if (!navResult.ok) {
      throw new Error(`导航失败: ${navResult.reason}`);
    }
    console.log('[probe] 已导航到目标页:', navResult.current);
    console.log('[probe] 请在弹出的窗口扫码登录头条，脚本会自动检测发布页结构...');

    const started = Date.now();
    const timeoutMs = 10 * 60 * 1000;
    let ready = false;
    let lastStatus = null;

    while (Date.now() - started < timeoutMs) {
      const status = await getMainViewStatus(electronApp);
      lastStatus = status;
      if (status.ok) {
        const p = status.probe || {};
        console.log(
          `[probe] url=${(p.href || status.url || '').slice(0, 120)} hasTitle=${!!p.hasTitleInput} hasEditor=${!!p.hasEditor} hasPublishBtn=${!!p.hasPublishBtn}`
        );
        if (p.hasTitleInput && p.hasEditor) {
          ready = true;
          break;
        }
      } else {
        console.log('[probe] 等待窗口就绪:', status.reason);
      }
      await sleep(3000);
    }

    if (!ready) {
      throw new Error(`超时：未检测到发布编辑结构。最后状态: ${JSON.stringify(lastStatus)}`);
    }

    const snap = await collectDomSnapshot(electronApp);
    if (!snap.ok) {
      throw new Error(`抓取失败: ${snap.reason}`);
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = path.join(OUTPUT_DIR, `toutiao-dom-${ts}.json`);
    const pngPath = path.join(OUTPUT_DIR, `toutiao-dom-${ts}.png`);

    fs.writeFileSync(jsonPath, JSON.stringify(snap.payload, null, 2), 'utf8');
    fs.writeFileSync(pngPath, Buffer.from(snap.pngBase64, 'base64'));

    console.log('[probe] ✅ DOM 结构已保存:');
    console.log(jsonPath);
    console.log(pngPath);
  } finally {
    try {
      await electronApp.evaluate(() => {
        const win = global.__TT_PROBE_WINDOW__;
        if (win && !win.isDestroyed()) {
          win.close();
        }
      });
    } catch (_) {}
    await electronApp.close();
  }
}

main().catch(err => {
  console.error('[probe] ❌', err.message || err);
  process.exit(1);
});
