const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright-core');

const REPO_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(REPO_DIR, 'docs', 'debug');
const TARGET_URL = 'https://creator.xiaohongshu.com/publish/publish?target=image';
const PRELOAD_PATH = path.join(REPO_DIR, 'content-preload.js');
const SAMPLE_IMAGE_PATH = path.join(REPO_DIR, 'logo1.png');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 zh.Cloud-browse/1.0';
const SAMPLE_HTML = [
  '<p>First line <strong>bold</strong></p>',
  '<p>Second paragraph</p>',
  '<p>Line with break<br>continued line</p>',
  '<p>Final paragraph</p>',
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
  await electronApp.evaluate(async ({ BrowserWindow, session }, { targetUrl, preloadPath, userAgent }) => {
    let win = global.__XHS_INTRO_UPLOAD_PROBE_WINDOW__;
    if (!win || win.isDestroyed()) {
      const probeSession = session.fromPartition('persist:xhs-intro-probe');
      probeSession.setUserAgent(userAgent);

      win = new BrowserWindow({
        width: 1440,
        height: 960,
        show: true,
        title: 'XHS Intro Upload Probe',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          preload: preloadPath,
          session: probeSession,
          backgroundThrottling: false,
        },
      });

      global.__XHS_INTRO_UPLOAD_PROBE_WINDOW__ = win;
    }

    await win.loadURL(targetUrl);
  }, {
    targetUrl: TARGET_URL,
    preloadPath: PRELOAD_PATH,
    userAgent: USER_AGENT,
  });
}

async function getProbePage(electronApp) {
  const start = Date.now();
  while (Date.now() - start < 60000) {
    for (const page of electronApp.windows()) {
      const url = page.url();
      if (url && url.startsWith(TARGET_URL)) {
        return page;
      }
    }
    await sleep(1000);
  }
  throw new Error('probe page not found');
}

async function collectFrameStates(page, label) {
  const frames = page.frames();
  const states = [];

  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    try {
      const payload = await frame.evaluate((currentLabel) => {
        const text = document.body ? (document.body.innerText || '') : '';
        const editor = document.querySelector('.tiptap-container .ProseMirror, .ProseMirror, [contenteditable="true"]');
        const titleInput = document.querySelector(".d-input-wrapper .d-input input, input[placeholder*='标题'], textarea[placeholder*='标题']");
        const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map((node, inputIndex) => ({
          index: inputIndex,
          accept: node.getAttribute('accept') || '',
          multiple: !!node.multiple,
          className: node.className || '',
          id: node.id || '',
        }));

        return {
          label: currentLabel,
          href: location.href,
          title: document.title,
          readyState: document.readyState,
          hasEditor: !!editor,
          hasTitleInput: !!titleInput,
          fileInputs,
          bodyTextSample: text.slice(0, 1500),
        };
      }, label);

      states.push({
        frameIndex: index,
        frameName: frame.name(),
        frameUrl: frame.url(),
        ...payload,
      });
    } catch (error) {
      states.push({
        frameIndex: index,
        frameName: frame.name(),
        frameUrl: frame.url(),
        error: error.message,
      });
    }
  }

  return states;
}

function pickFrameState(frameStates, mode) {
  if (mode === 'file') {
    return frameStates.find(state => Array.isArray(state.fileInputs) && state.fileInputs.length > 0)
      || frameStates.find(state => (state.bodyTextSample || '').includes('上传图片'))
      || frameStates[0];
  }

  if (mode === 'editor') {
    return frameStates.find(state => state.hasTitleInput && state.hasEditor)
      || frameStates.find(state => state.hasEditor || state.hasTitleInput)
      || frameStates[0];
  }

  return frameStates.find(state => (state.bodyTextSample || '').trim())
    || frameStates[0];
}

async function dumpPageState(page, label) {
  const frameStates = await collectFrameStates(page, label);
  const picked = pickFrameState(frameStates, 'default');
  return {
    label,
    pageUrl: page.url(),
    frameCount: frameStates.length,
    pickedFrameIndex: picked ? picked.frameIndex : -1,
    picked,
    frameStates,
  };
}

async function uploadSampleImage(page) {
  await page.waitForLoadState('domcontentloaded');

  const uploadTab = page.getByText('上传图文', { exact: true });
  if (await uploadTab.count()) {
    await uploadTab.first().click().catch(() => {});
  }

  const start = Date.now();
  let targetFrame = null;
  let frameStates = [];

  while (Date.now() - start < 120000) {
    frameStates = await collectFrameStates(page, 'upload-search');
    const picked = pickFrameState(frameStates, 'file');
    if (picked && Array.isArray(picked.fileInputs) && picked.fileInputs.length > 0) {
      targetFrame = page.frames()[picked.frameIndex];
      break;
    }
    await page.waitForTimeout(2000);
  }

  if (!targetFrame) {
    throw new Error(`file input not found: ${JSON.stringify(frameStates)}`);
  }

  const inputs = targetFrame.locator('input[type="file"]');
  const count = await inputs.count();
  let selectedIndex = 0;
  const inputMeta = [];

  for (let index = 0; index < count; index++) {
    const meta = await inputs.nth(index).evaluate(node => ({
      accept: node.getAttribute('accept') || '',
      multiple: !!node.multiple,
      className: node.className || '',
      id: node.id || '',
    }));
    inputMeta.push({ index, ...meta });

    if ((meta.accept || '').toLowerCase().includes('image')) {
      selectedIndex = index;
      break;
    }
  }

  await inputs.nth(selectedIndex).setInputFiles(SAMPLE_IMAGE_PATH);
  return { selectedIndex, inputMeta, frameStates };
}

async function waitForEditorReady(page) {
  const start = Date.now();
  let lastState = null;

  while (Date.now() - start < 180000) {
    lastState = await dumpPageState(page, 'wait-editor');
    const picked = pickFrameState(lastState.frameStates || [], 'editor');
    if (picked && picked.hasTitleInput && picked.hasEditor) {
      return {
        ...lastState,
        pickedFrameIndex: picked.frameIndex,
        picked,
      };
    }
    await page.waitForTimeout(2000);
  }

  throw new Error(`editor not ready: ${JSON.stringify(lastState)}`);
}

async function runIntroProbe(page) {
  const frameStates = await collectFrameStates(page, 'run-intro');
  const picked = pickFrameState(frameStates, 'editor');
  if (!picked || typeof picked.frameIndex !== 'number') {
    throw new Error(`editor frame not found: ${JSON.stringify(frameStates)}`);
  }

  const frame = page.frames()[picked.frameIndex];
  return frame.evaluate(async (sampleHtml) => {
    function htmlToPlainText(html) {
      if (!html) {
        return '';
      }

      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;

      tempDiv.querySelectorAll('br').forEach(node => {
        node.replaceWith('\n');
      });

      tempDiv.querySelectorAll('p, div, li, section, article, blockquote').forEach(node => {
        if (node.nextSibling) {
          node.insertAdjacentText('afterend', '\n');
        }
      });

      return (tempDiv.textContent || '')
        .replace(/\u00A0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function normalizeEditorText(text) {
      return (text || '')
        .replace(/\u00A0/g, ' ')
        .replace(/\r/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function normalizeCompareText(text) {
      return normalizeEditorText(text).replace(/\s+/g, ' ').trim();
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
      if (!normalized) {
        return '<p><br></p>';
      }

      const lines = normalized.split('\n');
      if (lines.length === 0) {
        return '<p><br></p>';
      }

      return lines.map(line => {
        const trimmedLine = line.trim();
        return trimmedLine ? `<p>${escapeHtml(trimmedLine)}</p>` : '<p><br></p>';
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
          const { state } = view;
          const { schema } = state;
          const paraType = schema.nodes.paragraph || schema.nodes.para || schema.nodes.text_block;
          if (paraType) {
            const lines = normalized.split('\n').map(line => line.trim()).filter(Boolean);
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
        const lines = normalized.split('\n').map(line => line.trim()).filter(Boolean);
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

      return { ok: false, method: null, current: readCurrent(), log };
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
  }, SAMPLE_HTML);
}

async function main() {
  ensureDir(OUTPUT_DIR);
  const electronApp = await electron.launch({
    args: ['.'],
    cwd: REPO_DIR,
  });

  try {
    await sleep(2500);
    await createProbeWindow(electronApp);
    const page = await getProbePage(electronApp);

    console.log('[xhs-upload-probe] target page found:', page.url());
    console.log('[xhs-upload-probe] stay on the publish page; the probe will upload a local image automatically.');

    const beforeUpload = await dumpPageState(page, 'before-upload');
    console.log('[xhs-upload-probe] before upload:', JSON.stringify(beforeUpload, null, 2));

    const uploadInfo = await uploadSampleImage(page);
    console.log('[xhs-upload-probe] upload input:', JSON.stringify(uploadInfo, null, 2));

    const readyState = await waitForEditorReady(page);
    console.log('[xhs-upload-probe] editor ready:', JSON.stringify(readyState, null, 2));

    const probeResult = await runIntroProbe(page);
    console.log('[xhs-upload-probe] intro result:', JSON.stringify(probeResult, null, 2));

    const tag = nowTag();
    const jsonPath = path.join(OUTPUT_DIR, `xhs-intro-after-upload-${tag}.json`);
    const pngPath = path.join(OUTPUT_DIR, `xhs-intro-after-upload-${tag}.png`);

    const finalState = await dumpPageState(page, 'after-probe');
    await page.screenshot({ path: pngPath, fullPage: true });
    fs.writeFileSync(jsonPath, JSON.stringify({
      sampleHtml: SAMPLE_HTML,
      sampleImagePath: SAMPLE_IMAGE_PATH,
      beforeUpload,
      uploadInfo,
      readyState,
      finalState,
      probeResult,
    }, null, 2), 'utf8');

    console.log('[xhs-upload-probe] artifacts:');
    console.log(jsonPath);
    console.log(pngPath);

    if (!probeResult.ok) {
      process.exitCode = 2;
    }
  } finally {
    await electronApp.close();
  }
}

main().catch(err => {
  console.error('[xhs-upload-probe] fatal:', err && err.stack ? err.stack : err);
  process.exit(1);
});
