const fs = require('fs');
const path = require('path');

const DEBUG_PORT = Number(process.env.CDP_PORT || 9222);
const TARGET_URL = 'https://om.qq.com/main/creation/article';
const REPO_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(REPO_DIR, 'docs', 'debug');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function tag() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function getJson(pathname) {
  const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}${pathname}`);
  if (!res.ok) {
    throw new Error(`${pathname} HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function connectCdp(wsUrl) {
  let id = 0;
  const pending = new Map();
  const ws = new WebSocket(wsUrl);

  ws.addEventListener('message', event => {
    let msg = null;
    try {
      msg = JSON.parse(event.data);
    } catch (_) {
      return;
    }

    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) {
        reject(new Error(`${msg.error.message || 'CDP error'} ${JSON.stringify(msg.error)}`));
      } else {
        resolve(msg.result || {});
      }
    }
  });

  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  return {
    async send(method, params = {}) {
      await opened;
      const callId = ++id;
      ws.send(JSON.stringify({ id: callId, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(callId, { resolve, reject });
        setTimeout(() => {
          if (pending.has(callId)) {
            pending.delete(callId);
            reject(new Error(`CDP timeout: ${method}`));
          }
        }, 30000);
      });
    },
    close() {
      try { ws.close(); } catch (_) {}
    }
  };
}

async function evaluate(target, expression, awaitPromise = true) {
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  try {
    await cdp.send('Runtime.enable');
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails));
    }
    return result.result?.value;
  } finally {
    cdp.close();
  }
}

async function dispatchMouse(target, points) {
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  try {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: points[0].x,
      y: points[0].y,
      button: 'none',
      buttons: 0,
      pointerType: 'mouse'
    });
    for (const point of points) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x,
        y: point.y,
        button: 'none',
        buttons: 0,
        pointerType: 'mouse'
      });
      await sleep(120);
    }
    await sleep(1200);
  } finally {
    cdp.close();
  }
}

function browserApiProbeSource() {
  return `(() => ({
    href: location.href,
    title: document.title,
    hasBrowserAPI: !!window.browserAPI,
    browserAPIKeys: window.browserAPI ? Object.keys(window.browserAPI).sort() : [],
    hasOpenNewWindow: typeof window.browserAPI?.openNewWindow === 'function'
  }))()`;
}

function openTencentSource() {
  return `window.browserAPI.openNewWindow(${JSON.stringify(TARGET_URL)}, { platform: 'tengxvnhao' })`;
}

function pageSnapshotSource() {
  return `(() => {
    const bodyText = String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
    return {
      href: location.href,
      title: document.title,
      readyState: document.readyState,
      bodyLength: bodyText.length,
      hasPublishText: bodyText.includes('发布'),
      hasLoginText: /登录|扫码|QQ|微信/.test(bodyText.slice(0, 3000)),
      bodySample: bodyText.slice(0, 1200)
    };
  })()`;
}

function hoverSetupSource() {
  return `(() => {
    const eventLog = [];
    const textOf = el => String(el?.textContent || '').replace(/\\s+/g, ' ').trim();
    const visible = el => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const rectOf = el => {
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
        left: Math.round(r.left),
        top: Math.round(r.top),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom)
      };
    };
    const summary = el => el ? {
      tag: el.tagName?.toLowerCase?.() || '',
      id: el.id || '',
      className: String(el.className || '').slice(0, 220),
      text: textOf(el).slice(0, 160),
      disabled: typeof el.disabled === 'boolean' ? el.disabled : undefined,
      pointerEvents: getComputedStyle(el).pointerEvents,
      rect: rectOf(el)
    } : null;
    const buttons = Array.from(document.querySelectorAll('button'))
      .filter(btn => visible(btn) && textOf(btn).includes('发布'));
    const publishButton = buttons.find(btn => textOf(btn) === '发布') || buttons[0] || null;
    const publishText = publishButton
      ? Array.from(publishButton.querySelectorAll('span[class*="tool_publish_button_text"], span[class*="tool_publish_buttons_text"], span'))
        .find(span => visible(span) && textOf(span).includes('发布'))
      : null;
    let style = document.getElementById('__txh_9222_pointer_override__');
    if (!style) {
      style = document.createElement('style');
      style.id = '__txh_9222_pointer_override__';
      style.textContent = [
        '[class*="tool_right"], [class*="tool_right"] *',
        '[class*="tool_content"], [class*="tool_content"] *',
        '[class*="tool_publish_buttons"], [class*="tool_publish_buttons"] *',
        '[class*="tool_publish_button_text"], [class*="tool_publish_buttons_text"]',
        'button[class*="omui-button"], button[class*="omui-button"] *',
        '[class*="tool_public_tip"], [class*="public_tip"]',
        '{ pointer-events: auto !important; }'
      ].join('\\n');
      document.head.appendChild(style);
    }
    if (!window.__txh9222EventLogInstalled) {
      window.__txh9222EventLogInstalled = true;
      for (const type of ['pointerenter', 'pointerover', 'pointermove', 'mouseenter', 'mouseover', 'mousemove']) {
        document.addEventListener(type, event => {
          const item = summary(event.target);
          if (!item) return;
          if (/tool|publish|button|omui/i.test(item.className) || item.text.includes('发布')) {
            eventLog.push({
              type,
              trusted: event.isTrusted,
              x: Math.round(event.clientX || 0),
              y: Math.round(event.clientY || 0),
              target: item
            });
            while (eventLog.length > 160) eventLog.shift();
          }
        }, true);
      }
    }
    window.__txh9222EventLog = eventLog;
    const target = publishText || publishButton;
    const r = target?.getBoundingClientRect();
    const points = r ? [
      { x: Math.round(Math.max(4, r.left + r.width / 2 - 140)), y: Math.round(r.top + r.height / 2), label: 'away-left' },
      { x: Math.round(r.left + r.width * 0.15), y: Math.round(r.top + r.height / 2), label: 'left' },
      { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), label: 'center' },
      { x: Math.round(r.right - r.width * 0.15), y: Math.round(r.top + r.height / 2), label: 'right' },
      { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.25), label: 'top' },
      { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), label: 'hold' }
    ] : [];
    const tips = Array.from(document.querySelectorAll('li[class*="tool_public_tip"], [class*="tool_public_tip"], li[class*="public_tip"], [class*="public_tip"]'))
      .filter(visible)
      .map(summary);
    return {
      href: location.href,
      title: document.title,
      publishButton: summary(publishButton),
      publishText: summary(publishText),
      elementAtCenter: points[2] ? summary(document.elementFromPoint(points[2].x, points[2].y)) : null,
      points,
      tips
    };
  })()`;
}

function hoverReadSource() {
  return `(() => {
    const textOf = el => String(el?.textContent || '').replace(/\\s+/g, ' ').trim();
    const visible = el => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const rectOf = el => {
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height)
      };
    };
    const summary = el => el ? {
      tag: el.tagName?.toLowerCase?.() || '',
      id: el.id || '',
      className: String(el.className || '').slice(0, 220),
      text: textOf(el).slice(0, 200),
      disabled: typeof el.disabled === 'boolean' ? el.disabled : undefined,
      pointerEvents: getComputedStyle(el).pointerEvents,
      rect: rectOf(el)
    } : null;
    return {
      href: location.href,
      title: document.title,
      tips: Array.from(document.querySelectorAll('li[class*="tool_public_tip"], [class*="tool_public_tip"], li[class*="public_tip"], [class*="public_tip"]'))
        .filter(visible)
        .map(summary),
      eventTail: (window.__txh9222EventLog || []).slice(-40)
    };
  })()`;
}

async function waitForTencentTarget(previousIds, timeoutMs = 60000) {
  const start = Date.now();
  let latest = [];
  while (Date.now() - start < timeoutMs) {
    latest = await getJson('/json/list');
    const direct = latest.find(target => target.type === 'page' && target.url.includes('om.qq.com'));
    if (direct) return direct;

    const fresh = latest.find(target => target.type === 'page' && !previousIds.has(target.id));
    if (fresh) return fresh;
    await sleep(1000);
  }
  return latest.find(target => target.type === 'page' && target.url.includes('om.qq.com')) || null;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const beforeTargets = await getJson('/json/list');
  const previousIds = new Set(beforeTargets.map(target => target.id));
  const probes = [];

  for (const target of beforeTargets.filter(item => item.type === 'page' && item.webSocketDebuggerUrl)) {
    try {
      probes.push({ target, probe: await evaluate(target, browserApiProbeSource()) });
    } catch (err) {
      probes.push({ target, error: err.message });
    }
  }

  const opener = probes.find(item => item.probe?.hasOpenNewWindow);
  if (!opener) {
    throw new Error(`9222 页面里没有找到 window.browserAPI.openNewWindow: ${JSON.stringify(probes, null, 2)}`);
  }

  console.log('[txh-9222] opener:', opener.probe.href, opener.probe.title);
  const openResult = await evaluate(opener.target, openTencentSource());
  console.log('[txh-9222] openNewWindow result:', JSON.stringify(openResult));

  let target = await waitForTencentTarget(previousIds);
  if (!target) {
    throw new Error('打开腾讯号后没有找到 om.qq.com DevTools target');
  }
  console.log('[txh-9222] target:', target.id, target.url, target.title);

  let snapshot = null;
  const start = Date.now();
  while (Date.now() - start < 10 * 60 * 1000) {
    const targets = await getJson('/json/list');
    target = targets.find(item => item.id === target.id) || targets.find(item => item.type === 'page' && item.url.includes('om.qq.com')) || target;
    snapshot = await evaluate(target, pageSnapshotSource());
    console.log('[txh-9222] snapshot:', JSON.stringify({
      href: snapshot.href,
      title: snapshot.title,
      bodyLength: snapshot.bodyLength,
      hasPublishText: snapshot.hasPublishText,
      hasLoginText: snapshot.hasLoginText
    }));

    if (snapshot.href.includes('/main/creation/article') && snapshot.hasPublishText && !snapshot.href.includes('/userAuth/')) {
      break;
    }
    await sleep(3000);
  }

  const beforeHover = await evaluate(target, hoverSetupSource());
  console.log('[txh-9222] hover target:', JSON.stringify({
    button: beforeHover.publishButton,
    text: beforeHover.publishText,
    elementAtCenter: beforeHover.elementAtCenter,
    pointCount: beforeHover.points?.length || 0,
    tips: beforeHover.tips
  }));

  if (beforeHover.points && beforeHover.points.length > 0) {
    await dispatchMouse(target, beforeHover.points);
  }
  const afterHover = await evaluate(target, hoverReadSource());
  console.log('[txh-9222] after hover tips:', JSON.stringify(afterHover.tips));
  console.log('[txh-9222] after hover eventTail:', JSON.stringify(afterHover.eventTail.slice(-12)));

  const output = {
    debugPort: DEBUG_PORT,
    targetUrl: TARGET_URL,
    opener: opener.probe,
    openResult,
    snapshot,
    beforeHover,
    afterHover
  };
  const outputPath = path.join(OUTPUT_DIR, `tengxun-9222-hover-${tag()}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
  console.log('[txh-9222] saved:', outputPath);
}

main().catch(err => {
  console.error('[txh-9222] failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
