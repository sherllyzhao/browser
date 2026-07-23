const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const REPO_DIR = path.resolve(__dirname, '..');
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'tengxun-hover-probe.html');
const OUTPUT_DIR = path.join(REPO_DIR, 'docs', 'debug');

function tag() {
  return new Date().toISOString().replace(/[:.]/g, '-');
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
    console.error('[txh-hover] failed to launch electron:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
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
        .slice(0, 60);

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
        } catch (e) {
          // 可能已经 attach，继续尝试发送命令。
        }

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

      const success = (useSendInput && !sendInputError) || (useCdp && !cdpError);
      return {
        success,
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
        try { activeDebugger.detach(); } catch (e) { /* ignore */ }
      }
    }
  });
}

async function runElectronProbe() {
  const { app, BrowserWindow, ipcMain } = require('electron');
  const fixtureUrl = pathToFileURL(FIXTURE_PATH).href;
  const preloadPath = path.join(REPO_DIR, 'content-preload.js');
  const runTag = tag();
  const jsonPath = path.join(OUTPUT_DIR, `tengxun-hover-probe-${runTag}.json`);
  const pngPath = path.join(OUTPUT_DIR, `tengxun-hover-probe-${runTag}.png`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  registerNativeMouseHover(ipcMain, BrowserWindow);

  await app.whenReady();
  let win = null;
  try {
    win = new BrowserWindow({
      width: 980,
      height: 720,
      show: true,
      title: '腾讯号 hover 探针',
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    win.focus();
    await win.loadURL(fixtureUrl);

    const result = await win.webContents.executeJavaScript('window.__txProbe.runAll()', true);
    const image = await win.webContents.capturePage();

    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
    fs.writeFileSync(pngPath, image.toPNG());

    for (const scenario of result) {
      const after = scenario.after || {};
      console.log(`[txh-hover] ${scenario.label}`);
      console.log(`  tipExists=${after.tipExists} tipText=${after.tipText || '<empty>'}`);
      console.log(`  buttonDisabled=${after.buttonDisabled} pointerEvents=${after.publishTextPointerEvents}`);
      console.log(`  elementAtCenter=${after.elementAtTextCenter?.tag || '<none>'}.${after.elementAtTextCenter?.className || ''}`);
      console.log(`  native=${JSON.stringify(after.nativeResult || {})}`);
      console.log(`  events=${(after.eventLog || []).slice(-8).join(' | ') || '<none>'}`);
    }

    console.log(`[txh-hover] saved: ${jsonPath}`);
    console.log(`[txh-hover] screenshot: ${pngPath}`);
  } finally {
    if (win && !win.isDestroyed()) win.close();
    app.quit();
  }
}

if (process.versions.electron) {
  runElectronProbe().catch(err => {
    console.error('[txh-hover] failed:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
} else {
  launchWithElectron();
}
