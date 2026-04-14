const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright-core');

const REPO_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(REPO_DIR, 'docs', 'debug');
const TARGET_URL = 'https://creator.xiaohongshu.com/publish/publish?target=image';
const PRELOAD_PATH = path.join(REPO_DIR, 'content-preload.js');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 zh.Cloud-browse/1.0';
const SAMPLE_HTML = [
  '<p>第一段 <strong>加粗</strong> 文本</p>',
  '<p>第二段</p>',
  '<p>第二段里的换行<br>这里是下一行</p>',
  '<p>第三段结尾</p>',
].join('');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nowTag() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function createProbeWindow(electronApp) {
  return electronApp.evaluate(async ({ BrowserWindow, session }, { targetUrl, preloadPath, userAgent }) => {
    let win = global.__XHS_INTRO_PROBE_WINDOW__;
    if (!win || win.isDestroyed()) {
      const probeSession = session.fromPartition('persist:xhs-intro-probe');
      probeSession.setUserAgent(userAgent);

      win = new BrowserWindow({
        width: 1440,
        height: 960,
        show: true,
        title: 'XHS Intro Probe',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          preload: preloadPath,
          session: probeSession,
          backgroundThrottling: false,
        },
      });

      global.__XHS_INTRO_PROBE_WINDOW__ = win;
    }

    await win.loadURL(targetUrl);
    return { ok: true, id: win.id, url: win.webContents.getURL() };
  }, {
    targetUrl: TARGET_URL,
    preloadPath: PRELOAD_PATH,
    userAgent: USER_AGENT,
  });
}

async function getProbeStatus(electronApp) {
  return electronApp.evaluate(async () => {
    const win = global.__XHS_INTRO_PROBE_WINDOW__;
    if (!win || win.isDestroyed()) {
      return { ok: false, reason: 'probe-window-missing' };
    }

    const page = await win.webContents.executeJavaScript(
      `(() => {
        const text = document.body ? (document.body.innerText || '') : '';
        const editor = document.querySelector('.tiptap-container .ProseMirror, .ProseMirror, [contenteditable="true"]');
        const titleInput = document.querySelector(".d-input-wrapper .d-input input, input[placeholder*='标题'], textarea[placeholder*='标题']");
        const loginHints = [
          '登录',
          '扫码',
          '手机号',
          '验证码',
          '授权'
        ];
        const textSample = text.slice(0, 1500);
        return {
          href: location.href,
          title: document.title,
          readyState: document.readyState,
          hasEditor: !!editor,
          hasTitleInput: !!titleInput,
          editorTextLength: editor ? ((editor.innerText || editor.textContent || '').trim().length) : 0,
          looksLikeLogin: loginHints.some(token => textSample.includes(token)),
          textSample,
        };
      })()`,
      true
    );

    return { ok: true, page };
  });
}

async function runIntroProbe(electronApp) {
  return electronApp.evaluate(async () => {
    const win = global.__XHS_INTRO_PROBE_WINDOW__;
    if (!win || win.isDestroyed()) {
      return { ok: false, error: 'probe-window-missing' };
    }

    return win.webContents.executeJavaScript(
      `(async () => {
        const sampleHtml = ${JSON.stringify(SAMPLE_HTML)};

        function htmlToPlainText(html) {
          if (!html) return '';
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = html;

          tempDiv.querySelectorAll('br').forEach(node => {
            node.replaceWith('\\n');
          });

          tempDiv.querySelectorAll('p, div, li, section, article, blockquote').forEach(node => {
            if (node.nextSibling) {
              node.insertAdjacentText('afterend', '\\n');
            }
          });

          return (tempDiv.textContent || '')
            .replace(/\\u00A0/g, ' ')
            .replace(/[ \\t]+\\n/g, '\\n')
            .replace(/\\n[ \\t]+/g, '\\n')
            .replace(/\\n{3,}/g, '\\n\\n')
            .trim();
        }

        function normalizeEditorText(text) {
          return (text || '')
            .replace(/\\u00A0/g, ' ')
            .replace(/\\r/g, '')
            .replace(/[ \\t]+\\n/g, '\\n')
            .replace(/\\n[ \\t]+/g, '\\n')
            .replace(/\\n{3,}/g, '\\n\\n')
            .trim();
        }

        function normalizeCompareText(text) {
          return normalizeEditorText(text).replace(/\\s+/g, ' ').trim();
        }

        function escapeHtml(text) {
          return (text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        function buildParagraphHtml(text) {
          const normalized = normalizeEditorText(text);
          if (!normalized) return '<p><br></p>';
          const lines = normalized.split('\\n');
          if (lines.length === 0) return '<p><br></p>';

          return lines.map(line => {
            const trimmedLine = line.trim();
            return trimmedLine ? '<p>' + escapeHtml(trimmedLine) + '</p>' : '<p><br></p>';
          }).join('');
        }

        function getProseMirrorView(editor) {
          try {
            const pmNode = editor.closest('.ProseMirror') || editor;
            if (pmNode.pmViewDesc && pmNode.pmViewDesc.view) {
              return pmNode.pmViewDesc.view;
            }
          } catch (_) {}

          try {
            let node = editor;
            while (node && node !== document.body) {
              if (node.pmViewDesc && node.pmViewDesc.view) {
                return node.pmViewDesc.view;
              }
              node = node.parentElement;
            }
          } catch (_) {}

          try {
            const allPm = document.querySelectorAll('.ProseMirror');
            for (const pm of allPm) {
              if (pm.pmViewDesc && pm.pmViewDesc.view) {
                return pm.pmViewDesc.view;
              }
            }
          } catch (_) {}

          return null;
        }

        async function delay(ms) {
          return new Promise(resolve => setTimeout(resolve, ms));
        }

        async function setIntroEditorContent(editor, text) {
          const normalized = normalizeEditorText(text);
          const expectedCompare = normalizeCompareText(normalized);
          const html = buildParagraphHtml(normalized);
          const log = [];
          const readCurrent = () => normalizeEditorText(editor.innerText || editor.textContent || '');
          const isExpected = value => normalizeCompareText(value) === expectedCompare;
          const selectAndClear = () => {
            editor.focus();
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(editor);
            selection.removeAllRanges();
            selection.addRange(range);
            document.execCommand('delete', false);
          };

          try {
            const view = getProseMirrorView(editor);
            log.push({ method: 'getProseMirrorView', found: !!view });
            if (view && typeof view.pasteHTML === 'function') {
              selectAndClear();
              await delay(100);
              view.focus();
              view.pasteHTML(html);
              await delay(250);
              const current = readCurrent();
              log.push({ method: 'view.pasteHTML', current });
              if (isExpected(current)) {
                return { ok: true, method: 'view.pasteHTML', current, log };
              }
            }
          } catch (error) {
            log.push({ method: 'view.pasteHTML', error: error.message });
          }

          try {
            const view = getProseMirrorView(editor);
            if (view) {
              const state = view.state;
              const schema = state.schema;
              const paraType = schema.nodes.paragraph || schema.nodes.para || schema.nodes.text_block;
              if (paraType) {
                const lines = normalized.split('\\n').map(line => line.trim()).filter(Boolean);
                const paragraphs = lines.length > 0
                  ? lines.map(line => paraType.create(null, [schema.text(line)]))
                  : [paraType.createAndFill ? paraType.createAndFill() : paraType.create(null, [])];
                const tr = state.tr.replaceWith(0, state.doc.content.size, paragraphs);
                view.dispatch(tr);
                await delay(250);
                const current = readCurrent();
                log.push({ method: 'pm.dispatch', current });
                if (isExpected(current)) {
                  return { ok: true, method: 'pm.dispatch', current, log };
                }
              }
            }
          } catch (error) {
            log.push({ method: 'pm.dispatch', error: error.message });
          }

          try {
            selectAndClear();
            await delay(100);
            const clipboardData = new DataTransfer();
            clipboardData.setData('text/html', html);
            clipboardData.setData('text/plain', normalized);
            const pasteEvent = new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              clipboardData,
            });
            editor.dispatchEvent(pasteEvent);
            await delay(250);
            const current = readCurrent();
            log.push({ method: 'paste-event', current });
            if (isExpected(current)) {
              return { ok: true, method: 'paste-event', current, log };
            }
          } catch (error) {
            log.push({ method: 'paste-event', error: error.message });
          }

          try {
            selectAndClear();
            await delay(100);
            const inserted = document.execCommand('insertHTML', false, html);
            await delay(250);
            const current = readCurrent();
            log.push({ method: 'insertHTML', inserted, current });
            if (inserted && isExpected(current)) {
              return { ok: true, method: 'insertHTML', current, log };
            }
          } catch (error) {
            log.push({ method: 'insertHTML', error: error.message });
          }

          try {
            selectAndClear();
            await delay(100);
            const lines = normalized.split('\\n').map(line => line.trim()).filter(Boolean);
            for (let index = 0; index < lines.length; index++) {
              if (index > 0) {
                document.execCommand('insertParagraph', false);
              }
              document.execCommand('insertText', false, lines[index]);
            }
            await delay(250);
            const current = readCurrent();
            log.push({ method: 'insertText', current });
            if (isExpected(current)) {
              return { ok: true, method: 'insertText', current, log };
            }
          } catch (error) {
            log.push({ method: 'insertText', error: error.message });
          }

          try {
            editor.innerHTML = html;
            editor.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertFromPaste',
              data: normalized,
            }));
            editor.dispatchEvent(new Event('change', { bubbles: true }));
            await delay(250);
            const current = readCurrent();
            log.push({ method: 'dom-fallback', current });
            if (isExpected(current)) {
              return { ok: true, method: 'dom-fallback', current, log };
            }
          } catch (error) {
            log.push({ method: 'dom-fallback', error: error.message });
          }

          return {
            ok: false,
            method: null,
            current: readCurrent(),
            log,
          };
        }

        const editor = document.querySelector('.tiptap-container .ProseMirror, .ProseMirror, [contenteditable="true"]');
        if (!editor) {
          return { ok: false, error: 'editor-not-found' };
        }

        const beforeText = normalizeEditorText(editor.innerText || editor.textContent || '');
        const targetText = htmlToPlainText(sampleHtml);
        const result = await setIntroEditorContent(editor, targetText);
        const afterText = normalizeEditorText(editor.innerText || editor.textContent || '');
        const afterHtml = editor.innerHTML;
        const view = getProseMirrorView(editor);
        const stateText = view ? normalizeEditorText(view.state.doc.textContent || '') : '';

        return {
          ok: result.ok,
          method: result.method,
          beforeText,
          targetText,
          afterText,
          stateText,
          afterHtml,
          log: result.log,
        };
      })()`,
      true
    );
  });
}

async function captureArtifacts(electronApp, basename) {
  return electronApp.evaluate(async () => {
    const win = global.__XHS_INTRO_PROBE_WINDOW__;
    if (!win || win.isDestroyed()) {
      return { ok: false, error: 'probe-window-missing' };
    }

    const page = await win.webContents.executeJavaScript(
      `(() => ({
        href: location.href,
        title: document.title,
        readyState: document.readyState,
        bodyTextSample: (document.body?.innerText || '').slice(0, 2000),
      }))()`,
      true
    );

    const image = await win.webContents.capturePage();
    return {
      ok: true,
      page,
      pngBase64: image.toPNG().toString('base64'),
    };
  });
}

async function closeProbeWindow(electronApp) {
  try {
    await electronApp.evaluate(async () => {
      const win = global.__XHS_INTRO_PROBE_WINDOW__;
      if (win && !win.isDestroyed()) {
        win.close();
      }
    });
  } catch (_) {}
}

async function main() {
  ensureDir(OUTPUT_DIR);
  const electronApp = await electron.launch({
    args: ['.'],
    cwd: REPO_DIR,
  });

  try {
    const created = await createProbeWindow(electronApp);
    console.log('[xhs-probe] window created:', created);
    console.log('[xhs-probe] Please log in to Xiaohongshu in the opened window if required.');

    const start = Date.now();
    const timeoutMs = 10 * 60 * 1000;
    let lastStatus = null;
    let ready = false;

    while (Date.now() - start < timeoutMs) {
      const status = await getProbeStatus(electronApp);
      lastStatus = status;

      if (status.ok) {
        const page = status.page;
        console.log(
          `[xhs-probe] url=${(page.href || '').slice(0, 120)} ready=${page.readyState} hasTitle=${!!page.hasTitleInput} hasEditor=${!!page.hasEditor} login=${!!page.looksLikeLogin} editorLen=${page.editorTextLength}`
        );

        if (page.hasTitleInput && page.hasEditor) {
          ready = true;
          break;
        }
      } else {
        console.log('[xhs-probe] waiting for window:', status.reason);
      }

      await sleep(3000);
    }

    if (!ready) {
      throw new Error(`timeout waiting for editor: ${JSON.stringify(lastStatus)}`);
    }

    const probeResult = await runIntroProbe(electronApp);
    const artifacts = await captureArtifacts(electronApp);
    const tag = nowTag();
    const jsonPath = path.join(OUTPUT_DIR, `xhs-intro-probe-${tag}.json`);
    const pngPath = path.join(OUTPUT_DIR, `xhs-intro-probe-${tag}.png`);

    fs.writeFileSync(jsonPath, JSON.stringify({
      sampleHtml: SAMPLE_HTML,
      probeResult,
      artifacts: artifacts.ok ? artifacts.page : artifacts,
    }, null, 2), 'utf8');

    if (artifacts.ok) {
      fs.writeFileSync(pngPath, Buffer.from(artifacts.pngBase64, 'base64'));
    }

    console.log('[xhs-probe] result:', JSON.stringify(probeResult, null, 2));
    console.log('[xhs-probe] artifacts:');
    console.log(jsonPath);
    if (artifacts.ok) {
      console.log(pngPath);
    }

    if (!probeResult.ok) {
      process.exitCode = 2;
    }
  } finally {
    await closeProbeWindow(electronApp);
    await electronApp.close();
  }
}

main().catch(err => {
  console.error('[xhs-probe] fatal:', err && err.stack ? err.stack : err);
  process.exit(1);
});
