const fs = require('fs');
const path = require('path');

const REPO_DIR = path.resolve(__dirname, '..');
const TARGET_URL = 'https://om.qq.com/main/creation/article';
const OUTPUT_DIR = path.join(REPO_DIR, 'docs', 'debug');
const LOGIN_WAIT_MS = Number(process.env.TXH_LOGIN_WAIT_MS) || 10 * 60 * 1000;
const POST_PROBE_HOLD_MS = Number(process.env.TXH_POST_PROBE_HOLD_MS) || 30 * 1000;

function tag() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function buildTaggedUserAgent() {
  const chromeVersion = process.versions.chrome || '106.0.0.0';
  const major = String(chromeVersion).split('.')[0] || '106';
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 zh.Cloud-browse/1.0`;
}

function launchWithElectron() {
  const { spawn } = require('child_process');
  const electronPath = require('electron');
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronPath, [__filename], {
    cwd: REPO_DIR,
    stdio: 'inherit',
    env: childEnv
  });

  child.on('exit', code => {
    process.exit(code || 0);
  });

  child.on('error', err => {
    console.error('[txh-live-hover] failed to launch electron:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

function pickUserDataPath(app) {
  if (process.env.YYZS_USER_DATA && fs.existsSync(process.env.YYZS_USER_DATA)) {
    return { path: process.env.YYZS_USER_DATA, reason: 'YYZS_USER_DATA' };
  }

  const appData = app.getPath('appData');
  const localAppData = process.env.LOCALAPPDATA || appData;
  const candidates = [
    path.join(appData, 'yunying-zhushou'),
    path.join(appData, '资海云运营助手'),
    path.join(localAppData, '资海云运营助手-Portable')
  ];

  const scored = candidates.map(candidate => {
    const partitionPath = path.join(candidate, 'Partitions', 'persist_browserview');
    const globalStoragePath = path.join(candidate, 'global-storage.json');
    let score = 0;
    if (fs.existsSync(partitionPath)) score += 10;
    if (fs.existsSync(globalStoragePath)) score += 4;
    if (fs.existsSync(candidate)) score += 1;
    return { path: candidate, score, partitionPath, globalStoragePath };
  });

  scored.sort((a, b) => b.score - a.score);
  const picked = scored[0];
  return {
    path: picked.path,
    reason: `score=${picked.score}, partition=${fs.existsSync(picked.partitionPath)}, globalStorage=${fs.existsSync(picked.globalStoragePath)}`
  };
}

function registerNativeMouseHover(ipcMain, BrowserWindow) {
  ipcMain.handle('native-mouse-hover', async (event, points = [], options = {}) => {
    let didAttachDebugger = false;
    let activeDebugger = null;
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    try {
      const webContents = event.sender;
      if (!webContents || webContents.isDestroyed()) {
        return { success: false, error: 'webContents 不可用' };
      }

      const normalizedPoints = (Array.isArray(points) ? points : [])
        .map(point => ({
          x: Math.round(Number(point?.x)),
          y: Math.round(Number(point?.y)),
          label: String(point?.label || '')
        }))
        .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
        .slice(0, 80);

      if (normalizedPoints.length === 0) {
        return { success: false, error: 'hover 点为空' };
      }

      const hoverOptions = options && typeof options === 'object' ? options : {};
      const intervalMs = Math.max(20, Math.min(Number(hoverOptions.intervalMs) || 90, 500));
      const holdMs = Math.max(0, Math.min(Number(hoverOptions.holdMs) || 1200, 5000));
      const useCdp = hoverOptions.useCdp !== false;
      const useSendInput = hoverOptions.useSendInput !== false;

      try {
        const senderWindow = BrowserWindow.fromWebContents(webContents);
        if (senderWindow && !senderWindow.isDestroyed()) {
          if (senderWindow.isMinimized()) senderWindow.restore();
          senderWindow.focus();
        }
        if (typeof webContents.focus === 'function') {
          webContents.focus();
        }
      } catch (focusErr) {
        console.warn('[Native Mouse Hover] focus 窗口失败，继续发送鼠标事件:', focusErr.message);
      }

      let sendInputError = null;
      if (useSendInput) {
        try {
          const firstPoint = normalizedPoints[0];
          webContents.sendInputEvent({
            type: 'mouseEnter',
            x: firstPoint.x,
            y: firstPoint.y,
            movementX: 0,
            movementY: 0
          });

          for (const point of normalizedPoints) {
            webContents.sendInputEvent({
              type: 'mouseMove',
              x: point.x,
              y: point.y,
              movementX: 0,
              movementY: 0
            });
            await sleep(intervalMs);
          }
        } catch (err) {
          sendInputError = err;
          console.warn('[Native Mouse Hover] sendInputEvent 序列失败:', err);
        }
      }

      let cdpError = null;
      if (useCdp) {
        const dbg = webContents.debugger;
        activeDebugger = dbg;
        try {
          dbg.attach('1.3');
          didAttachDebugger = true;
        } catch (_) {}

        try {
          for (const point of normalizedPoints) {
            await dbg.sendCommand('Input.dispatchMouseEvent', {
              type: 'mouseMoved',
              x: point.x,
              y: point.y,
              button: 'none',
              buttons: 0,
              clickCount: 0,
              pointerType: 'mouse'
            });
            await sleep(intervalMs);
          }
        } catch (err) {
          cdpError = err;
          console.warn('[Native Mouse Hover] CDP hover 序列失败:', err);
        }
      }

      if (holdMs > 0) {
        await sleep(holdMs);
      }

      return {
        success: (useSendInput && !sendInputError) || (useCdp && !cdpError),
        pointCount: normalizedPoints.length,
        lastPoint: normalizedPoints[normalizedPoints.length - 1],
        methods: {
          sendInput: useSendInput && !sendInputError,
          cdp: useCdp && !cdpError
        },
        errors: {
          sendInput: sendInputError ? sendInputError.message : undefined,
          cdp: cdpError ? cdpError.message : undefined
        }
      };
    } catch (err) {
      console.error('[Native Mouse Hover] 失败:', err);
      return { success: false, error: err.message };
    } finally {
      if (didAttachDebugger && activeDebugger) {
        try { activeDebugger.detach(); } catch (_) {}
      }
    }
  });
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getPageSnapshot(webContents) {
  return webContents.executeJavaScript(`(() => {
        const text = (document.body?.innerText || '').trim();
        return {
          href: location.href,
          title: document.title,
          readyState: document.readyState,
          bodyLength: text.length,
          hasPublishText: /发布/.test(text),
          hasCreationPath: location.href.includes('/main/creation/article'),
          hasLoginText: /登录|扫码|QQ|微信/.test(text.slice(0, 3000)),
          sample: text.slice(0, 500)
        };
      })()`, true);
}

function isLoginSnapshot(snapshot = {}) {
  const href = String(snapshot.href || '');
  const title = String(snapshot.title || '');
  return href.includes('/userAuth/')
    || title.includes('登录')
    || (!!snapshot.hasLoginText && !snapshot.hasPublishText);
}

function isPublishSnapshot(snapshot = {}) {
  const href = String(snapshot.href || '');
  return href.includes('/main/creation/article')
    && snapshot.bodyLength > 200
    && !isLoginSnapshot(snapshot);
}

async function waitForPageSettle(webContents, timeoutMs = 90000) {
  const start = Date.now();
  let last = null;

  while (Date.now() - start < timeoutMs) {
    try {
      last = await getPageSnapshot(webContents);
    } catch (err) {
      last = { error: err.message };
    }

    if (
      last
      && last.readyState === 'complete'
      && last.bodyLength > 200
      && (last.hasPublishText || last.hasLoginText || !last.hasCreationPath)
    ) {
      await wait(2500);
      return last;
    }
    await wait(1000);
  }

  return last || { error: 'timeout-no-snapshot' };
}

async function waitForLoginAndPublish(webContents, timeoutMs = LOGIN_WAIT_MS) {
  const start = Date.now();
  let lastLogAt = 0;
  let navigatedToTargetAfterLogin = false;
  let last = null;

  while (Date.now() - start < timeoutMs) {
    try {
      last = await getPageSnapshot(webContents);
    } catch (err) {
      last = { error: err.message };
    }

    if (isPublishSnapshot(last)) {
      await wait(2500);
      return { ready: true, reason: 'publish-page-ready', snapshot: last };
    }

    const now = Date.now();
    if (now - lastLogAt > 10000) {
      lastLogAt = now;
      console.log('[txh-live-hover] 等待登录/发布页:', JSON.stringify({
        elapsedMs: now - start,
        href: last?.href || '',
        title: last?.title || '',
        hasLoginText: !!last?.hasLoginText,
        hasPublishText: !!last?.hasPublishText
      }));
    }

    if (
      !navigatedToTargetAfterLogin
      && last
      && !isLoginSnapshot(last)
      && !String(last.href || '').includes('/main/creation/article')
      && String(last.href || '').includes('om.qq.com')
      && last.bodyLength > 200
    ) {
      navigatedToTargetAfterLogin = true;
      console.log('[txh-live-hover] 已离开登录页但未到发布页，重新导航真实发布页:', TARGET_URL);
      try {
        await webContents.loadURL(TARGET_URL);
      } catch (navErr) {
        console.warn('[txh-live-hover] 登录后重新导航发布页失败:', navErr.message);
      }
    }

    await wait(1000);
  }

  return { ready: false, reason: 'login-or-publish-timeout', snapshot: last };
}

function buildProbeSource() {
  return `(() => {
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const eventLog = [];

    function textOf(el) {
      return String(el?.textContent || '').replace(/\\s+/g, ' ').trim();
    }

    function visible(el) {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }

    function rectOf(el) {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom)
      };
    }

    function summarize(el) {
      if (!el) return null;
      return {
        tag: el.tagName?.toLowerCase?.() || '',
        id: el.id || '',
        className: String(el.className || '').slice(0, 240),
        text: textOf(el).slice(0, 160),
        disabled: typeof el.disabled === 'boolean' ? el.disabled : undefined,
        rect: rectOf(el),
        pointerEvents: getComputedStyle(el).pointerEvents
      };
    }

    function scorePublishButton(button) {
      const text = textOf(button);
      const cls = String(button.className || '');
      let score = 0;
      if (text === '发布') score += 20;
      if (text.includes('发布')) score += 8;
      if (button.disabled || button.matches?.('.is-disabled,[disabled]')) score += 6;
      if (/omui-button|primary/.test(cls)) score += 4;
      if (button.querySelector?.('[class*="tool_publish_button_text"]')) score += 12;
      return score;
    }

    function findPublishButton() {
      const buttons = Array.from(document.querySelectorAll('button'))
        .filter(button => textOf(button).includes('发布'))
        .filter(visible)
        .map(button => ({ button, score: scorePublishButton(button) }))
        .sort((a, b) => b.score - a.score);

      return buttons[0]?.button || null;
    }

    function findPublishTextElements(button) {
      const scoped = button ? Array.from(button.querySelectorAll('span[class*="tool_publish_button_text"], span')) : [];
      const global = Array.from(document.querySelectorAll('span[class*="tool_publish_button_text"], span'));
      return Array.from(new Set([...scoped, ...global]))
        .filter(el => textOf(el).includes('发布'))
        .filter(visible);
    }

    function getTextRect(el) {
      if (!el) return null;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !node.nodeValue.includes('发布')) node = walker.nextNode();

      if (node) {
        const range = document.createRange();
        const start = node.nodeValue.indexOf('发布');
        range.setStart(node, start);
        range.setEnd(node, start + 2);
        const rect = range.getBoundingClientRect();
        range.detach();
        if (rect.width > 0 && rect.height > 0) return rect;
      }

      return el.getBoundingClientRect();
    }

    function makeHoverPoints(target) {
      const rect = getTextRect(target);
      if (!rect || rect.width <= 0 || rect.height <= 0) return [];

      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const outsideX = Math.max(4, centerX - Math.max(120, rect.width + 80));
      return [
        { x: outsideX, y: centerY, label: 'outside-left' },
        { x: centerX - Math.max(1, rect.width * 0.45), y: centerY, label: 'publish-text-left' },
        { x: centerX, y: centerY, label: 'publish-text-center' },
        { x: centerX + Math.max(1, rect.width * 0.45), y: centerY, label: 'publish-text-right' },
        { x: centerX, y: centerY - Math.max(2, rect.height * 0.25), label: 'publish-text-top' },
        { x: centerX, y: centerY + Math.max(2, rect.height * 0.25), label: 'publish-text-bottom' },
        { x: centerX, y: centerY, label: 'publish-text-hold' }
      ].map(point => ({
        x: Math.round(point.x),
        y: Math.round(point.y),
        label: point.label
      }));
    }

    function applyPointerOverride() {
      let style = document.getElementById('__txh_live_pointer_override__');
      if (!style) {
        style = document.createElement('style');
        style.id = '__txh_live_pointer_override__';
        style.textContent = [
          '[class*="tool_right"], [class*="tool_right"] *',
          'button.omui-button, button.omui-button *',
          '[class*="tool_publish_button_text"], [class*="tool_public_tip"], [class*="public_tip"]',
          '{ pointer-events: auto !important; }'
        ].join('\\n');
        document.head.appendChild(style);
      }
    }

    function publicTips() {
      return Array.from(document.querySelectorAll('li[class*="tool_public_tip"], [class*="tool_public_tip"], li[class*="public_tip"], [class*="public_tip"]'))
        .filter(visible)
        .map(summarize)
        .slice(0, 20);
    }

    function candidateSummary() {
      const buttons = Array.from(document.querySelectorAll('button'))
        .filter(button => textOf(button).includes('发布') || String(button.className || '').includes('publish'))
        .filter(visible)
        .map(button => ({
          ...summarize(button),
          score: scorePublishButton(button),
          html: String(button.outerHTML || '').slice(0, 600)
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);

      const toolRight = Array.from(document.querySelectorAll('[class*="tool_right"], [class*="tool"]'))
        .filter(visible)
        .map(el => ({
          ...summarize(el),
          html: String(el.outerHTML || '').slice(0, 700)
        }))
        .slice(0, 30);

      return { buttons, toolRight };
    }

    function snapshot(label, nativeResult = null) {
      const button = findPublishButton();
      const textElements = findPublishTextElements(button);
      const target = textElements[0] || button;
      const points = makeHoverPoints(target);
      const centerPoint = points.find(point => point.label === 'publish-text-center') || points[0];
      return {
        label,
        href: location.href,
        title: document.title,
        hasBrowserAPI: !!window.browserAPI,
        hasNativeHover: typeof window.browserAPI?.nativeMouseHover === 'function',
        bodySample: String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 1600),
        button: summarize(button),
        publishTextElements: textElements.map(summarize).slice(0, 10),
        target: summarize(target),
        hoverPoints: points,
        elementAtCenter: centerPoint ? summarize(document.elementFromPoint(centerPoint.x, centerPoint.y)) : null,
        publicTips: publicTips(),
        candidates: candidateSummary(),
        nativeResult,
        eventLog: eventLog.slice(-160)
      };
    }

    function installEventLog() {
      if (window.__txhLiveEventLogInstalled) return;
      window.__txhLiveEventLogInstalled = true;
      const types = ['pointerenter', 'pointerover', 'pointermove', 'mouseenter', 'mouseover', 'mousemove', 'pointerleave', 'mouseleave', 'mouseout'];
      for (const type of types) {
        document.addEventListener(type, event => {
          const target = event.target;
          const summary = summarize(target);
          const cls = summary?.className || '';
          const txt = summary?.text || '';
          if (/publish|tool|button|omui|public/i.test(cls) || txt.includes('发布') || type.includes('enter') || type.includes('over')) {
            eventLog.push({
              type,
              trusted: event.isTrusted,
              target: summary,
              x: Math.round(event.clientX || 0),
              y: Math.round(event.clientY || 0),
              time: Date.now()
            });
            while (eventLog.length > 240) eventLog.shift();
          }
        }, true);
      }
    }

    async function runScenario(label, options = {}) {
      if (options.pointerOverride) applyPointerOverride();
      await delay(150);
      const before = snapshot(label + ':before');
      const target = findPublishTextElements(findPublishButton())[0] || findPublishButton();
      const points = makeHoverPoints(target);
      let nativeResult = null;

      if (typeof window.browserAPI?.nativeMouseHover === 'function' && points.length > 0) {
        nativeResult = await window.browserAPI.nativeMouseHover(points, {
          intervalMs: 110,
          holdMs: 1600,
          useSendInput: options.useSendInput !== false,
          useCdp: options.useCdp !== false
        });
        await delay(220);
      }

      const after = snapshot(label + ':after', nativeResult);
      return { label, before, after };
    }

    async function runAll() {
      installEventLog();
      const initial = snapshot('initial');
      const scenarios = [];
      scenarios.push(await runScenario('native-no-override', { pointerOverride: false }));
      scenarios.push(await runScenario('native-pointer-override-both', { pointerOverride: true }));
      scenarios.push(await runScenario('native-pointer-override-sendinput', { pointerOverride: true, useCdp: false }));
      scenarios.push(await runScenario('native-pointer-override-cdp', { pointerOverride: true, useSendInput: false }));
      return { initial, scenarios, final: snapshot('final') };
    }

    return runAll();
  })()`;
}

async function runElectronProbe() {
  const { app, BrowserWindow, ipcMain, session } = require('electron');
  const pickedUserData = pickUserDataPath(app);
  app.setPath('userData', pickedUserData.path);
  console.log('[txh-live-hover] userData:', pickedUserData.path);
  console.log('[txh-live-hover] userData reason:', pickedUserData.reason);

  await app.whenReady();
  registerNativeMouseHover(ipcMain, BrowserWindow);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const runTag = tag();
  const jsonPath = path.join(OUTPUT_DIR, `tengxun-live-hover-${runTag}.json`);
  const pngPath = path.join(OUTPUT_DIR, `tengxun-live-hover-${runTag}.png`);
  const preloadPath = path.join(REPO_DIR, 'content-preload.js');
  const windowSession = session.fromPartition('persist:browserview', { cache: false });
  windowSession.setUserAgent(buildTaggedUserAgent());

  let win = null;
  try {
    win = new BrowserWindow({
      width: 1360,
      height: 900,
      show: true,
      title: '腾讯号真实发布页 hover 探针',
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        session: windowSession,
        backgroundThrottling: false
      }
    });

    win.webContents.setUserAgent(buildTaggedUserAgent());
    win.focus();
    console.log('[txh-live-hover] loading:', TARGET_URL);
    await win.loadURL(TARGET_URL);
    let settle = await waitForPageSettle(win.webContents);
    console.log('[txh-live-hover] page settle:', JSON.stringify(settle));

    let loginWait = null;
    if (isLoginSnapshot(settle)) {
      console.log('[txh-live-hover] 检测到登录页，窗口会保持打开；请扫码登录，登录后此方再继续 hover 探测。');
      loginWait = await waitForLoginAndPublish(win.webContents);
      settle = loginWait.snapshot || settle;
      console.log('[txh-live-hover] login wait result:', JSON.stringify(loginWait));
    }

    if (!isPublishSnapshot(settle)) {
      const image = await win.webContents.capturePage();
      const output = {
        targetUrl: TARGET_URL,
        userData: pickedUserData,
        settle,
        loginWait,
        result: null,
        reason: 'publish-page-not-ready'
      };
      fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2), 'utf8');
      fs.writeFileSync(pngPath, image.toPNG());
      console.log('[txh-live-hover] 未进入发布页，本次不做 hover 探测，窗口再保留 30 秒:', settle?.href || '');
      console.log('[txh-live-hover] saved:', jsonPath);
      console.log('[txh-live-hover] screenshot:', pngPath);
      await wait(POST_PROBE_HOLD_MS);
      return;
    }

    const result = await win.webContents.executeJavaScript(buildProbeSource(), true);
    const image = await win.webContents.capturePage();
    const output = {
      targetUrl: TARGET_URL,
      userData: pickedUserData,
      settle,
      loginWait,
      result
    };

    fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2), 'utf8');
    fs.writeFileSync(pngPath, image.toPNG());

    const scenarios = result?.scenarios || [];
    console.log('[txh-live-hover] current:', result?.final?.href || settle?.href || '');
    console.log('[txh-live-hover] title:', result?.final?.title || settle?.title || '');
    console.log('[txh-live-hover] initial button:', JSON.stringify(result?.initial?.button || null));
    console.log('[txh-live-hover] initial tips:', JSON.stringify(result?.initial?.publicTips || []));
    for (const scenario of scenarios) {
      const after = scenario.after || {};
      console.log(`[txh-live-hover] ${scenario.label}`);
      console.log(`  native=${JSON.stringify(after.nativeResult || null)}`);
      console.log(`  target=${JSON.stringify(after.target || null)}`);
      console.log(`  elementAtCenter=${JSON.stringify(after.elementAtCenter || null)}`);
      console.log(`  tips=${JSON.stringify(after.publicTips || [])}`);
      console.log(`  eventTail=${JSON.stringify((after.eventLog || []).slice(-8))}`);
    }
    console.log('[txh-live-hover] saved:', jsonPath);
    console.log('[txh-live-hover] screenshot:', pngPath);

    await wait(POST_PROBE_HOLD_MS);
  } finally {
    try {
      await windowSession.flushStorageData();
      console.log('[txh-live-hover] session storage flushed');
    } catch (flushErr) {
      console.warn('[txh-live-hover] session storage flush failed:', flushErr.message);
    }
    if (win && !win.isDestroyed()) win.close();
    app.quit();
  }
}

if (process.versions.electron) {
  runElectronProbe().catch(err => {
    console.error('[txh-live-hover] failed:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
} else {
  launchWithElectron();
}
