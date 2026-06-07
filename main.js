const { app, BrowserWindow, BrowserView, ipcMain, session, dialog, Menu, globalShortcut, nativeImage, Tray, protocol, shell, net, safeStorage, webContents: electronWebContents } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');
const ScriptManager = require('./script-manager');
const config = require('./domain-config');

// 应用版本号（从 package.json 读取，改版本只需改 package.json）
const APP_VERSION = app.getVersion();

function getLegacyWindowsGpuWorkaroundInfo() {
  // Win7/Win8 GPU 合成层在新 Chromium 下常导致页面白屏（典型如搜狐号 .ne-editor）
  // Windows NT 版本号：Win7=6.1, Win8=6.2, Win8.1=6.3, Win10/11=10.0
  if (process.platform !== 'win32') {
    return { shouldDisableHardwareAcceleration: false, release: '' };
  }

  try {
    const release = os.release();
    const major = Number.parseInt(release.split('.')[0], 10);
    return {
      shouldDisableHardwareAcceleration: Number.isInteger(major) && major < 10,
      release
    };
  } catch (e) {
    console.error('[启动] Windows 版本检测失败:', e);
    return { shouldDisableHardwareAcceleration: false, release: '' };
  }
}

const legacyWindowsGpuWorkaround = getLegacyWindowsGpuWorkaroundInfo();
const shouldDisableHardwareAcceleration = legacyWindowsGpuWorkaround.shouldDisableHardwareAcceleration;

if (shouldDisableHardwareAcceleration) {
  console.log(`[启动] 检测到旧版 Windows (${legacyWindowsGpuWorkaround.release})，禁用硬件加速以规避白屏问题`);
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu-compositing');
  // 🩹 裸开关：彻底禁用 GPU，强制纯软件渲染。disableHardwareAcceleration() 仅为软禁用，
  // GPU 进程仍会尝试初始化；旧版 Windows（尤其 32 位 Electron 跑 64 位 Win7）下合成器
  // 常出图失败导致白屏（典型如视频号发布页），--disable-gpu 比软禁用更彻底。
  app.commandLine.appendSwitch('disable-gpu');
} else {
  console.log('[启动] 当前系统保留 GPU 硬件加速');
}

let mainWindow;
let browserView;
let scriptManager;
let isQuitting = false; // 标记是否正在退出
let isScriptPanelOpen = false; // 跟踪脚本面板状态
const isProduction = app.isPackaged; // 是否生产环境
const useLocalDevServer = process.env.USE_LOCAL_DEV_SERVER === '1';
let tray = null; // 托盘图标对象
let openInNewWindow = false; // 新窗口模式状态
let heartbeatInterval = null;
let autoSaveInterval = null;
let destroyedWindowCleanupInterval = null;
const windowContextMap = new Map();
const windowPublishDataMap = new Map();
const sessionRequestGuardConfig = new WeakMap();
let shutdownStarted = false;

// 跨平台图标路径
function getAppIconPath() {
  if (process.platform === 'darwin') {
    return path.join(__dirname, 'icon.png');
  }
  return path.join(__dirname, 'icon.ico');
}

// 使用与 Electron 内核版本一致的标准 Chrome UA，避免 sec-ch-ua 与 UA 主版本不一致触发风控
function buildStandardUserAgent() {
  const chromeVersion = process.versions.chrome || '106.0.0.0';
  const major = String(chromeVersion).split('.')[0] || '106';
  if (process.platform === 'darwin') {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  }
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}
const STANDARD_USER_AGENT = buildStandardUserAgent();
const TAGGED_USER_AGENT = `${STANDARD_USER_AGENT} zh.Cloud-browse/1.0`;

function shouldUseStandardUserAgentForUrl(rawUrl = '') {
  const shouldUseStandardUserAgentForHostname = (hostname = '') => {
    const host = String(hostname || '').toLowerCase();
    return host === 'douyin.com'
      || host.endsWith('.douyin.com')
      || host === 'channels.weixin.qq.com'
      || host.endsWith('.channels.weixin.qq.com')
      || host === 'weixin.qq.com'
      || host.endsWith('.weixin.qq.com')
      || host === 'wx.qq.com'
      || host.endsWith('.wx.qq.com');
  };

  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return shouldUseStandardUserAgentForHostname(hostname);
  } catch (_) {
    const urlText = String(rawUrl || '').toLowerCase();
    return urlText.includes('douyin.com')
      || urlText.includes('channels.weixin.qq.com')
      || urlText.includes('weixin.qq.com')
      || urlText.includes('wx.qq.com');
  }
}

function applyScopedWindowUserAgent(targetWebContents, rawUrl, label = 'Window') {
  if (!targetWebContents || targetWebContents.isDestroyed()) return;
  const useStandardUserAgent = shouldUseStandardUserAgentForUrl(rawUrl);
  const userAgent = useStandardUserAgent ? STANDARD_USER_AGENT : TAGGED_USER_AGENT;
  targetWebContents.setUserAgent(userAgent);
  console.log(`[${label}] User-Agent 已设置为${useStandardUserAgent ? '标准 UA' : '带标识 UA'}:`, rawUrl || '-');
}

function shouldUseStandardUserAgentForRequest(details = {}) {
  if (!shouldUseStandardUserAgentForUrl(details.url || '')) {
    return false;
  }
  const requestWebContents = getWebContentsByRequest(details);
  if (browserView?.webContents && requestWebContents && requestWebContents.id === browserView.webContents.id) {
    return false;
  }
  return true;
}

function installBrokenPipeGuard(stream, streamName) {
  if (!stream || typeof stream.on !== 'function') return;

  stream.on('error', (err) => {
    if (err && err.code === 'EPIPE') {
      return;
    }
    try {
      const detail = err && err.stack ? err.stack : (err && err.message ? err.message : String(err));
      fs.appendFileSync(
        path.join(__dirname, 'main-process-stream-error.log'),
        `[${new Date().toISOString()}] ${streamName}: ${detail}\n`,
        'utf8'
      );
    } catch (_) {
      // 避免日志防护本身再次引发异常
    }
  });
}

installBrokenPipeGuard(process.stdout, 'stdout');
installBrokenPipeGuard(process.stderr, 'stderr');

const SESSION_DIAGNOSTIC_LOG_NAME = '运营助手-本次报错.log';
const SESSION_DIAGNOSTIC_MAX_LINE_LENGTH = 6000;
const SESSION_DIAGNOSTIC_MAX_HEADER_KEYS = 40;
const SESSION_DIAGNOSTIC_SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
  'x-xsrf-token',
  'x-token',
  'token'
]);
let sessionDiagnosticLogPath = '';
let sessionDiagnosticLogReady = false;
let sessionDiagnosticLogDisabled = false;
let sessionDiagnosticConsoleWrapped = false;
const sessionDiagnosticNetworkRequests = new WeakMap();
const sessionDiagnosticNetworkInstalled = new WeakSet();

function truncateDiagnosticText(text) {
  if (text.length <= SESSION_DIAGNOSTIC_MAX_LINE_LENGTH) {
    return text;
  }
  return `${text.slice(0, SESSION_DIAGNOSTIC_MAX_LINE_LENGTH)}... [truncated length=${text.length}]`;
}

function redactDiagnosticText(value) {
  return truncateDiagnosticText(String(value || '')
    .replace(/([?&](?:token|access_token|refresh_token|authorization|password|passwd|secret|sessionData)=)[^&\s]+/gi, '$1[已脱敏]')
    .replace(/((?:cookieString|authorization|access_token|refresh_token|token|password|passwd|secret|sessionData)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,}\]]+)/gi, '$1[已脱敏]')
    .replace(/("(?:cookieString|authorization|access_token|refresh_token|token|password|passwd|secret|sessionData)"\s*:\s*)"[^"]*"/gi, '$1"[已脱敏]"')
    .replace(/\r?\n/g, '\\n'));
}

function createDiagnosticJsonReplacer() {
  const seen = new WeakSet();
  return (key, value) => {
    if (/cookieString|authorization|access_token|refresh_token|token|password|passwd|secret|sessionData/i.test(key)) {
      return '[已脱敏]';
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack
      };
    }
    if (value && typeof value === 'object') {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    if (typeof value === 'string' && value.length > 1000) {
      return `${value.slice(0, 1000)}... [length=${value.length}]`;
    }
    return value;
  };
}

function formatDiagnosticArg(arg) {
  if (arg instanceof Error) {
    return redactDiagnosticText(arg.stack || arg.message || String(arg));
  }
  if (typeof arg === 'string') {
    return redactDiagnosticText(arg);
  }
  try {
    return redactDiagnosticText(JSON.stringify(arg, createDiagnosticJsonReplacer()));
  } catch (_) {
    return redactDiagnosticText(String(arg));
  }
}

function getSessionNetworkRequestMap(targetSession) {
  let requestMap = sessionDiagnosticNetworkRequests.get(targetSession);
  if (!requestMap) {
    requestMap = new Map();
    sessionDiagnosticNetworkRequests.set(targetSession, requestMap);
  }
  return requestMap;
}

function getPortableExecutableDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }
  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    return path.dirname(process.env.PORTABLE_EXECUTABLE_FILE);
  }
  return '';
}

function getDiagnosticHeaderValue(headers, headerName) {
  if (!headers || !headerName) {
    return undefined;
  }
  const key = Object.keys(headers).find(item => item.toLowerCase() === headerName.toLowerCase());
  if (!key) {
    return undefined;
  }
  return headers[key];
}

function sanitizeDiagnosticHeaders(headers = {}) {
  const output = {};
  let count = 0;

  for (const key of Object.keys(headers)) {
    const normalizedKey = key.toLowerCase();
    if (count >= SESSION_DIAGNOSTIC_MAX_HEADER_KEYS) {
      output.__truncated__ = `只展示前 ${SESSION_DIAGNOSTIC_MAX_HEADER_KEYS} 个 header`;
      break;
    }
    if (SESSION_DIAGNOSTIC_SENSITIVE_HEADER_NAMES.has(normalizedKey)) {
      output[key] = '[已脱敏]';
    } else {
      const value = headers[key];
      output[key] = Array.isArray(value)
        ? value.map(item => redactDiagnosticText(item)).slice(0, 8)
        : redactDiagnosticText(value);
    }
    count++;
  }

  return output;
}

function summarizeDiagnosticUploadData(uploadData = []) {
  if (!Array.isArray(uploadData) || uploadData.length === 0) {
    return null;
  }

  let bytes = 0;
  let rawParts = 0;
  let fileParts = 0;
  let blobParts = 0;

  for (const item of uploadData) {
    if (!item) continue;
    if (item.bytes) {
      rawParts++;
      bytes += Buffer.isBuffer(item.bytes) ? item.bytes.length : Buffer.byteLength(String(item.bytes));
    }
    if (item.file) {
      fileParts++;
    }
    if (item.blobUUID) {
      blobParts++;
    }
  }

  return {
    parts: uploadData.length,
    rawParts,
    fileParts,
    blobParts,
    bytes
  };
}

function getNetworkRequestScope(targetSession) {
  const configForSession = sessionRequestGuardConfig.get(targetSession);
  return `network ${configForSession?.label || 'session'}`;
}

function buildNetworkRequestBase(details = {}) {
  return {
    requestId: details.id,
    method: details.method,
    resourceType: details.resourceType,
    url: details.url,
    webContentsId: details.webContentsId || 0,
    frameId: details.frameId,
    parentFrameId: details.parentFrameId,
    referrer: details.referrer || '',
    upload: summarizeDiagnosticUploadData(details.uploadData)
  };
}

function getNetworkDurationMs(targetSession, requestId) {
  const requestMap = getSessionNetworkRequestMap(targetSession);
  const started = requestMap.get(requestId);
  return started ? Date.now() - started.startedAt : null;
}

function appendNetworkDiagnosticLog(targetSession, level, eventName, details = {}, extra = {}) {
  appendSessionDiagnosticLog(level, getNetworkRequestScope(targetSession), [{
    event: eventName,
    ...buildNetworkRequestBase(details),
    ...extra
  }]);
}

function installSessionNetworkDiagnostics(targetSession) {
  if (!targetSession?.webRequest || sessionDiagnosticNetworkInstalled.has(targetSession)) {
    return;
  }
  sessionDiagnosticNetworkInstalled.add(targetSession);

  targetSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...(details.requestHeaders || {}) };
    if (shouldUseStandardUserAgentForRequest(details)) {
      requestHeaders['User-Agent'] = STANDARD_USER_AGENT;
    }
    appendNetworkDiagnosticLog(targetSession, 'INFO', 'send-headers', details, {
      requestHeaders: sanitizeDiagnosticHeaders(requestHeaders)
    });
    callback({ requestHeaders });
  });

  targetSession.webRequest.onBeforeRedirect((details) => {
    appendNetworkDiagnosticLog(targetSession, 'INFO', 'redirect', details, {
      statusCode: details.statusCode,
      statusLine: details.statusLine,
      redirectURL: details.redirectURL,
      ip: details.ip || '',
      fromCache: !!details.fromCache,
      durationMs: getNetworkDurationMs(targetSession, details.id),
      responseHeaders: sanitizeDiagnosticHeaders(details.responseHeaders || {})
    });
  });

  targetSession.webRequest.onCompleted((details) => {
    const requestMap = getSessionNetworkRequestMap(targetSession);
    const durationMs = getNetworkDurationMs(targetSession, details.id);
    requestMap.delete(details.id);

    const level = details.statusCode >= 400 ? 'WARN' : 'INFO';
    appendNetworkDiagnosticLog(targetSession, level, 'completed', details, {
      statusCode: details.statusCode,
      statusLine: details.statusLine,
      ip: details.ip || '',
      fromCache: !!details.fromCache,
      durationMs,
      contentType: getDiagnosticHeaderValue(details.responseHeaders, 'content-type') || '',
      contentLength: getDiagnosticHeaderValue(details.responseHeaders, 'content-length') || '',
      responseHeaders: sanitizeDiagnosticHeaders(details.responseHeaders || {})
    });
  });

  targetSession.webRequest.onErrorOccurred((details) => {
    const requestMap = getSessionNetworkRequestMap(targetSession);
    const durationMs = getNetworkDurationMs(targetSession, details.id);
    requestMap.delete(details.id);

    appendNetworkDiagnosticLog(targetSession, 'ERROR', 'error', details, {
      error: details.error || '',
      fromCache: !!details.fromCache,
      durationMs
    });
  });
}

function getSessionDiagnosticCandidateDirs() {
  const preferredDir = getPortableExecutableDir() || (app.isPackaged ? path.dirname(process.execPath) : __dirname);
  const fallbackDir = app.getPath('userData');
  return Array.from(new Set([preferredDir, fallbackDir].filter(Boolean)));
}

function initializeSessionDiagnosticLog() {
  if (sessionDiagnosticLogReady || sessionDiagnosticLogDisabled) {
    return sessionDiagnosticLogReady;
  }

  const failures = [];
  for (const dir of getSessionDiagnosticCandidateDirs()) {
    const logPath = path.join(dir, SESSION_DIAGNOSTIC_LOG_NAME);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const header = [
        '资海云运营助手 - 本次运行报错日志',
        '说明: 只记录当前这次打开程序期间的诊断信息；正常退出时会自动删除。',
        '范围: 主进程错误、页面错误、加载失败、渲染进程异常、网络请求开始/请求头/重定向/完成/失败。',
        '隐私: cookie、authorization、token、password、sessionData、上传内容等敏感信息会脱敏或只记录大小。',
        `启动时间: ${new Date().toLocaleString()}`,
        `应用版本: ${APP_VERSION}`,
        `Electron: ${process.versions.electron || ''}`,
        `Chrome: ${process.versions.chrome || ''}`,
        `Node: ${process.versions.node || ''}`,
        `系统: ${process.platform} ${os.release()}`,
        `执行文件: ${process.execPath}`,
        `便携版外层目录: ${getPortableExecutableDir() || '-'}`,
        `日志路径: ${logPath}`,
        '========================================',
        ''
      ].join('\n');
      fs.writeFileSync(logPath, header, 'utf8');
      sessionDiagnosticLogPath = logPath;
      sessionDiagnosticLogReady = true;
      if (failures.length > 0) {
        appendSessionDiagnosticLog('WARN', 'diagnostic', [
          `首选日志目录不可写，已切换备用目录: ${failures.map(item => `${item.dir} (${item.error})`).join('; ')}`
        ]);
      }
      return true;
    } catch (err) {
      failures.push({ dir, error: err && err.message ? err.message : String(err) });
    }
  }

  sessionDiagnosticLogDisabled = true;
  return false;
}

function appendSessionDiagnosticLog(level, scope, args = []) {
  if (!initializeSessionDiagnosticLog()) {
    return;
  }
  try {
    const message = args.map(formatDiagnosticArg).join(' ');
    const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${message}\n`;
    fs.appendFileSync(sessionDiagnosticLogPath, line, 'utf8');
  } catch (_) {
    // 日志不能影响主流程
  }
}

function removeSessionDiagnosticLog() {
  if (!sessionDiagnosticLogPath) {
    return;
  }
  try {
    if (fs.existsSync(sessionDiagnosticLogPath)) {
      fs.unlinkSync(sessionDiagnosticLogPath);
    }
  } catch (_) {
    // 退出清理失败不阻塞应用退出
  }
}

function wrapConsoleForSessionDiagnostics() {
  if (sessionDiagnosticConsoleWrapped) {
    return;
  }
  sessionDiagnosticConsoleWrapped = true;

  const wrapMethod = (method, level) => {
    const original = console[method];
    console[method] = function(...args) {
      appendSessionDiagnosticLog(level, 'main-process', args);
      return original.apply(console, args);
    };
  };

  wrapMethod('warn', 'WARN');
  wrapMethod('error', 'ERROR');
}

function safeGetWebContentsUrl(webContents) {
  try {
    if (!webContents || webContents.isDestroyed()) {
      return '';
    }
    return webContents.getURL();
  } catch (_) {
    return '';
  }
}

function describeWebContentsForDiagnostics(webContents, label) {
  const parts = [label || 'webContents'];
  try {
    parts.push(`#${webContents.id}`);
  } catch (_) {}
  try {
    if (typeof webContents.getType === 'function') {
      parts.push(`type=${webContents.getType()}`);
    }
  } catch (_) {}
  return parts.join(' ');
}

function getConsoleMessageLevel(level) {
  if (typeof level === 'number') {
    if (level >= 3) return 'ERROR';
    if (level >= 2) return 'WARN';
    return 'INFO';
  }
  const normalized = String(level || '').toUpperCase();
  if (normalized.includes('ERROR')) return 'ERROR';
  if (normalized.includes('WARN')) return 'WARN';
  return 'INFO';
}

function attachSessionDiagnosticWebContents(webContents, label = 'webContents') {
  if (!webContents || webContents.__sessionDiagnosticAttached) {
    return;
  }

  try {
    Object.defineProperty(webContents, '__sessionDiagnosticAttached', {
      value: true,
      configurable: false,
      enumerable: false
    });
  } catch (_) {
    webContents.__sessionDiagnosticAttached = true;
  }

  const scope = () => describeWebContentsForDiagnostics(webContents, label);

  webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const levelName = getConsoleMessageLevel(level);
    if (levelName !== 'WARN' && levelName !== 'ERROR') {
      return;
    }
    appendSessionDiagnosticLog(levelName, scope(), [
      message,
      `source=${sourceId || '-'}`,
      `line=${line || 0}`,
      `url=${safeGetWebContentsUrl(webContents) || '-'}`
    ]);
  });

  webContents.on('preload-error', (_event, preloadPath, error) => {
    appendSessionDiagnosticLog('ERROR', scope(), [
      'preload-error',
      `preload=${preloadPath || '-'}`,
      error
    ]);
  });

  webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (errorCode === -3) {
      return;
    }
    appendSessionDiagnosticLog('ERROR', scope(), [
      'did-fail-load',
      `code=${errorCode}`,
      `description=${errorDescription || '-'}`,
      `url=${validatedURL || safeGetWebContentsUrl(webContents) || '-'}`,
      `mainFrame=${isMainFrame !== false}`
    ]);
  });

  webContents.on('render-process-gone', (_event, details) => {
    appendSessionDiagnosticLog('ERROR', scope(), [
      'render-process-gone',
      details,
      `url=${safeGetWebContentsUrl(webContents) || '-'}`
    ]);
  });

  webContents.on('unresponsive', () => {
    appendSessionDiagnosticLog('WARN', scope(), [
      'unresponsive',
      `url=${safeGetWebContentsUrl(webContents) || '-'}`
    ]);
  });
}

function installSessionDiagnosticLogger() {
  initializeSessionDiagnosticLog();
  wrapConsoleForSessionDiagnostics();

  process.on('uncaughtExceptionMonitor', (error, origin) => {
    appendSessionDiagnosticLog('ERROR', 'process', ['uncaughtExceptionMonitor', `origin=${origin || '-'}`, error]);
  });

  process.on('unhandledRejection', (reason) => {
    appendSessionDiagnosticLog('ERROR', 'process', ['unhandledRejection', reason]);
  });

  process.on('warning', (warning) => {
    appendSessionDiagnosticLog('WARN', 'process', [warning]);
  });

  app.on('before-quit', () => {
    appendSessionDiagnosticLog('INFO', 'app', ['before-quit']);
  });

  app.on('quit', () => {
    removeSessionDiagnosticLog();
  });
}

installSessionDiagnosticLogger();

function isFirstPartyHost(hostname = '') {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  return host === 'localhost' ||
         host === '127.0.0.1' ||
         host === '172.16.6.17' ||
         host === 'china9.cn' ||
         host.endsWith('.china9.cn');
}

function isFirstPartyUrl(rawUrl = '') {
  try {
    const parsed = new URL(rawUrl);
    return isFirstPartyHost(parsed.hostname);
  } catch (_) {
    return false;
  }
}

function setHeaderCaseInsensitive(headers, key, value) {
  const targetKey = Object.keys(headers).find(k => k.toLowerCase() === key.toLowerCase()) || key;
  headers[targetKey] = value;
}

function removeHeaderCaseInsensitive(headers, key) {
  const targetKey = Object.keys(headers).find(k => k.toLowerCase() === key.toLowerCase());
  if (targetKey) {
    delete headers[targetKey];
  }
}

function normalizeCookieSameSite(rawSameSite = '', secure = false) {
  const value = String(rawSameSite || '').trim().toLowerCase();
  if (value === 'lax' || value === 'strict') {
    return value;
  }
  if (value === 'no_restriction') {
    return secure ? 'no_restriction' : '';
  }
  return '';
}

function assignCookieSameSite(cookieDetails, rawSameSite) {
  const normalizedSameSite = normalizeCookieSameSite(rawSameSite, !!cookieDetails.secure);
  if (normalizedSameSite) {
    cookieDetails.sameSite = normalizedSameSite;
  }
}

function isHostOnlyCookie(cookie) {
  return !!cookie?.domain && !String(cookie.domain).startsWith('.');
}

function buildCookieUrlForSet(cookie) {
  const host = String(cookie?.domain || '').replace(/^\./, '');
  const pathName = cookie?.path && String(cookie.path).startsWith('/') ? cookie.path : '/';
  return `${cookie?.secure ? 'https' : 'http'}://${host}${pathName}`;
}

function buildCookieSetDetails(cookie, expirationDate = undefined) {
  const cookieDetails = {
    url: buildCookieUrlForSet(cookie),
    name: cookie.name,
    value: cookie.value || '',
    path: cookie.path || '/',
    secure: !!cookie.secure,
    httpOnly: !!cookie.httpOnly
  };
  if (!isHostOnlyCookie(cookie) && cookie.domain) {
    cookieDetails.domain = cookie.domain;
  }
  assignCookieSameSite(cookieDetails, cookie.sameSite);
  if (expirationDate !== undefined) {
    cookieDetails.expirationDate = expirationDate;
  } else if (cookie.expirationDate) {
    cookieDetails.expirationDate = cookie.expirationDate;
  }
  return cookieDetails;
}

function cloneSerializable(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function parseSessionData(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
      if (typeof parsed === 'string') {
        parsed = JSON.parse(parsed);
      }
    } catch (_) {
      return null;
    }
  }

  return parsed;
}

function extractSessionCookiesArray(sessionData) {
  const parsed = parseSessionData(sessionData);
  if (!parsed) {
    return [];
  }

  if (Array.isArray(parsed)) {
    const cookies = [];
    for (const item of parsed) {
      const parsedItem = parseSessionData(item);
      if (parsedItem && Array.isArray(parsedItem.cookies)) {
        cookies.push(...parsedItem.cookies);
        continue;
      }
      if (parsedItem && parsedItem.name && parsedItem.domain) {
        cookies.push(parsedItem);
      }
    }
    return cookies;
  }

  if (Array.isArray(parsed.cookies)) {
    return parsed.cookies;
  }

  if (typeof parsed === 'object') {
    const cookies = [];
    for (const value of Object.values(parsed)) {
      if (value && typeof value === 'object' && Array.isArray(value.cookies)) {
        cookies.push(...value.cookies);
      }
    }
    return cookies;
  }

  return [];
}

function normalizeSessionTimestamp(value) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }

  // Backend data historically uses ms, but tolerate Unix seconds.
  return timestamp < 100000000000 ? timestamp * 1000 : timestamp;
}

function extractSessionTimestamp(sessionData, depth = 0) {
  if (depth > 4) {
    return 0;
  }

  const parsed = parseSessionData(sessionData);
  if (!parsed) {
    return 0;
  }

  if (Array.isArray(parsed)) {
    return parsed.reduce((latest, item) => {
      return Math.max(latest, extractSessionTimestamp(item, depth + 1));
    }, 0);
  }

  if (typeof parsed !== 'object') {
    return 0;
  }

  let latest = Math.max(
    normalizeSessionTimestamp(parsed.timestamp),
    normalizeSessionTimestamp(parsed.updatedAt),
    normalizeSessionTimestamp(parsed.updated_at),
    normalizeSessionTimestamp(parsed.updateTime),
    normalizeSessionTimestamp(parsed.saveTime)
  );

  if (parsed.sessionData) {
    latest = Math.max(latest, extractSessionTimestamp(parsed.sessionData, depth + 1));
  }

  for (const value of Object.values(parsed)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    if (Array.isArray(value.cookies) || value.sessionData) {
      latest = Math.max(latest, extractSessionTimestamp(value, depth + 1));
    }
  }

  return latest;
}

function mergeSessionRestoreData(baseSessionData, cookiesSourceData, timestamp = 0) {
  const parsedBase = parseSessionData(baseSessionData);
  const mergedSessionData = parsedBase && typeof parsedBase === 'object' && !Array.isArray(parsedBase)
    ? (cloneSerializable(parsedBase) || parsedBase)
    : {};
  const cookies = extractSessionCookiesArray(cookiesSourceData);

  if (cookies.length > 0) {
    mergedSessionData.cookies = cookies;
  }

  const mergedDomains = Array.from(new Set([
    ...collectSessionDomains(baseSessionData),
    ...collectSessionDomains(cookiesSourceData)
  ]));
  if (mergedDomains.length > 0) {
    if (!mergedSessionData.domain) {
      mergedSessionData.domain = mergedDomains[0];
    }
    mergedSessionData.domains = mergedDomains;
    mergedSessionData.cookieDomains = mergedDomains;
  }

  const mergedTimestamp = Math.max(
    normalizeSessionTimestamp(timestamp),
    extractSessionTimestamp(baseSessionData),
    extractSessionTimestamp(cookiesSourceData)
  );
  if (mergedTimestamp) {
    mergedSessionData.timestamp = mergedTimestamp;
  }

  return mergedSessionData;
}

const SHIPINHAO_LOGIN_HOST = 'channels.weixin.qq.com';
const SHIPINHAO_LOGIN_COOKIE_DOMAINS = new Set([
  'channels.weixin.qq.com',
  'weixin.qq.com',
  'wx.qq.com',
  'mp.weixin.qq.com'
]);
const SHIPINHAO_SESSION_COOKIE_DOMAINS = [
  'channels.weixin.qq.com',
  'weixin.qq.com',
  'mp.weixin.qq.com',
  'wx.qq.com',
  'qq.com'
];
const SHIPINHAO_PARENT_COOKIE_DOMAINS = new Set(['qq.com']);
const SHIPINHAO_LOGIN_COOKIE_NAMES = new Set([
  'sessionid',
  'wxuin',
  'pass_ticket',
  'wxsid',
  'wxload'
]);
const SHIPINHAO_LOGIN_RESET_PARAMS = [
  'shipinhao_reset_login',
  'shipinhao_force_reset',
  'force_reset',
  'reset_login',
  'clear_login'
];

function normalizeSessionCookieDomain(domain) {
  return String(domain || '').toLowerCase().replace(/^\./, '');
}

function isShipinhaoSessionMigrationDomain(domain) {
  return SHIPINHAO_SESSION_COOKIE_DOMAINS.includes(normalizeSessionCookieDomain(domain));
}

function matchesShipinhaoSessionCookieDomain(cookieDomain, targetDomain) {
  const normalizedCookieDomain = normalizeSessionCookieDomain(cookieDomain);
  const normalizedTargetDomain = normalizeSessionCookieDomain(targetDomain);
  if (!normalizedCookieDomain || !normalizedTargetDomain) {
    return false;
  }
  if (normalizedTargetDomain === 'qq.com') {
    return normalizedCookieDomain === 'qq.com';
  }
  return normalizedCookieDomain === normalizedTargetDomain
    || normalizedCookieDomain.endsWith(`.${normalizedTargetDomain}`);
}

function matchesGenericCookieDomain(cookieDomain, targetDomain) {
  const normalizedCookieDomain = normalizeSessionCookieDomain(cookieDomain);
  const normalizedTargetDomain = normalizeSessionCookieDomain(targetDomain);
  if (!normalizedCookieDomain || !normalizedTargetDomain) {
    return false;
  }
  return normalizedCookieDomain.includes(normalizedTargetDomain)
    || normalizedTargetDomain.includes(normalizedCookieDomain);
}

function shouldMigrateCookieForDomain(cookieDomain, requestedDomain) {
  if (isShipinhaoSessionMigrationDomain(requestedDomain)) {
    return SHIPINHAO_SESSION_COOKIE_DOMAINS.some(domain => matchesShipinhaoSessionCookieDomain(cookieDomain, domain));
  }
  return matchesGenericCookieDomain(cookieDomain, requestedDomain);
}

function isShipinhaoLoginUrl(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    const hostname = String(parsedUrl.hostname || '').toLowerCase();
    const pathname = String(parsedUrl.pathname || '').toLowerCase();
    return hostname === SHIPINHAO_LOGIN_HOST
      && (pathname.includes('login.html') || pathname === '/' || pathname === '');
  } catch (_) {
    return false;
  }
}

function isTruthyResetParamValue(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  return ['1', 'true', 'yes', 'y'].includes(String(value).trim().toLowerCase());
}

function hasShipinhaoLoginResetRequest(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    if (!isShipinhaoLoginUrl(parsedUrl.toString())) {
      return false;
    }
    return SHIPINHAO_LOGIN_RESET_PARAMS.some(key => isTruthyResetParamValue(parsedUrl.searchParams.get(key)));
  } catch (_) {
    return false;
  }
}

function buildShipinhaoLoginForceResetUrl(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    if (!isShipinhaoLoginUrl(parsedUrl.toString()) || parsedUrl.searchParams.has('force_reset')) {
      return null;
    }
    if (!hasShipinhaoLoginResetRequest(parsedUrl.toString())) {
      return null;
    }
    parsedUrl.searchParams.set('force_reset', '1');
    return parsedUrl.toString();
  } catch (_) {
    return null;
  }
}

function shouldClearShipinhaoLoginCookie(cookie) {
  const normalizedDomain = String(cookie?.domain || '').toLowerCase().replace(/^\./, '');
  const cookieName = String(cookie?.name || '').toLowerCase();
  if (!normalizedDomain || !cookieName) {
    return false;
  }
  if (!SHIPINHAO_LOGIN_COOKIE_NAMES.has(cookieName)) {
    return false;
  }

  for (const domain of SHIPINHAO_LOGIN_COOKIE_DOMAINS) {
    if (normalizedDomain === domain || normalizedDomain.endsWith(`.${domain}`)) {
      return true;
    }
  }

  for (const domain of SHIPINHAO_PARENT_COOKIE_DOMAINS) {
    if (normalizedDomain === domain || normalizedDomain.endsWith(`.${domain}`)) {
      return true;
    }
  }

  return false;
}

async function clearShipinhaoLoginCookiesFromSession(targetSession, eventName) {
  if (!targetSession || !targetSession.cookies) {
    return 0;
  }

  const cookies = await targetSession.cookies.get({});
  let deletedCount = 0;

  for (const cookie of cookies) {
    if (!shouldClearShipinhaoLoginCookie(cookie)) {
      continue;
    }

    const host = String(cookie.domain || '').toLowerCase().replace(/^\./, '');
    const pathName = cookie.path && String(cookie.path).startsWith('/') ? cookie.path : '/';
    const protocol = cookie.secure ? 'https' : 'http';
    const urlsToTry = Array.from(new Set([
      `${protocol}://${host}${pathName}`,
      `https://${host}${pathName}`,
      `http://${host}${pathName}`,
      `${protocol}://${host}/`,
      `https://${host}/`,
      `http://${host}/`
    ]));

    for (const cookieUrl of urlsToTry) {
      try {
        await targetSession.cookies.remove(cookieUrl, cookie.name);
        deletedCount++;
        console.log(`[Window Manager] 🧹 [${eventName}] 已清理视频号旧 cookie: ${cookie.name} @ ${cookie.domain}`);
        break;
      } catch (_) {
        // 尝试下一种 URL 形式。
      }
    }
  }

  try {
    await targetSession.flushStorageData();
  } catch (flushErr) {
    console.warn(`[Window Manager] ⚠️ [${eventName}] flushStorageData 失败: ${flushErr.message}`);
  }

  console.log(`[Window Manager] 🧹 [${eventName}] 视频号登录前 cookie 清理完成，共删除 ${deletedCount} 个`);
  return deletedCount;
}

function createShipinhaoLoginResetGuard(targetWindow, windowLabel) {
  let shipinhaoLoginResetInFlight = false;

  return (navUrl, eventName, event = null) => {
    const resetUrl = buildShipinhaoLoginForceResetUrl(navUrl);
    if (!resetUrl) {
      return false;
    }

    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }

    if (shipinhaoLoginResetInFlight) {
      console.log(`[Window Manager] 🔧 [${eventName}] 视频号登录 reset 已在处理，忽略重复导航: ${navUrl}`);
      return true;
    }

    shipinhaoLoginResetInFlight = true;
    console.log(`[Window Manager] 🔧 [${eventName}] 视频号登录页显式重置，清理旧 cookie 并追加 force_reset=1: ${resetUrl}`);

    (async () => {
      try {
        if (!targetWindow || targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
          return;
        }

        await clearShipinhaoLoginCookiesFromSession(targetWindow.webContents.session, `${windowLabel}:${eventName}`);
        if (!targetWindow.isDestroyed() && !targetWindow.webContents.isDestroyed()) {
          await targetWindow.webContents.loadURL(resetUrl);
        }
      } catch (resetErr) {
        console.error(`[Window Manager] ❌ [${eventName}] 视频号登录 reset 处理失败:`, resetErr);
      } finally {
        shipinhaoLoginResetInFlight = false;
      }
    })();

    return true;
  };
}

// 🛡️ 检查 windowSession 中是否已有「有效登录态 cookie」
// 任一 platformLoginCookies 配置项存在即视为已登录
async function hasValidLoginCookies(windowSession, platform) {
  if (!windowSession || !platform) return false;
  const loginCookieNames = config.platformLoginCookies && config.platformLoginCookies[platform];
  if (!Array.isArray(loginCookieNames) || loginCookieNames.length === 0) {
    return false;
  }
  try {
    const cookies = await windowSession.cookies.get({});
    const cookieNames = new Set(cookies.filter(c => c && c.value).map(c => c.name));
    const hit = loginCookieNames.find(name => cookieNames.has(name));
    if (hit) {
      console.log(`[hasValidLoginCookies] ✅ 本地 session 已登录（命中 cookie: ${hit}）, platform=${platform}`);
      return true;
    }
    console.log(`[hasValidLoginCookies] ⚠️ 本地 session 未检测到登录态, platform=${platform}, 期望任一: [${loginCookieNames.join(', ')}]`);
    return false;
  } catch (err) {
    console.warn('[hasValidLoginCookies] 取 cookies 失败:', err.message);
    return false;
  }
}

// 🧬 比对本地 session 与 sessionData 是否同一账号（基于 platformIdentityCookies）
// 返回:
//   true  - 同账号（本地优先）
//   false - 换账号（走 sessionData 覆盖）
//   null  - 无法验证（任一侧缺身份 cookie），由调用方决定保守策略
async function matchAccountIdentity(windowSession, sessionData, platform) {
  if (!windowSession || !platform) return null;
  const identityNames = config.platformIdentityCookies && config.platformIdentityCookies[platform];
  if (!Array.isArray(identityNames) || identityNames.length === 0) {
    return null;
  }
  try {
    const localCookies = await windowSession.cookies.get({});
    const localMap = new Map();
    for (const c of localCookies) {
      if (c && identityNames.includes(c.name) && c.value) {
        localMap.set(c.name, c.value);
      }
    }

    const remoteCookies = extractSessionCookiesArray(sessionData) || [];
    const remoteMap = new Map();
    for (const c of remoteCookies) {
      if (c && identityNames.includes(c.name) && c.value) {
        remoteMap.set(c.name, c.value);
      }
    }

    if (localMap.size === 0 || remoteMap.size === 0) {
      console.log(`[matchAccountIdentity] ℹ️ 任一侧缺身份 cookie，无法验证（local=${localMap.size}, remote=${remoteMap.size}）`);
      return null;
    }

    let comparedCount = 0;
    let matchedCount = 0;
    for (const name of identityNames) {
      const lv = localMap.get(name);
      const rv = remoteMap.get(name);
      if (lv && rv) {
        comparedCount++;
        if (lv === rv) {
          matchedCount++;
        }
      }
    }
    if (comparedCount === 0) {
      console.log('[matchAccountIdentity] ℹ️ 双方没有共同的身份 cookie 字段，无法验证');
      return null;
    }
    const same = matchedCount === comparedCount;
    console.log(`[matchAccountIdentity] ${same ? '✅ 同账号' : '🔄 换账号'}（比对 ${comparedCount} 字段，匹配 ${matchedCount} 个）`);
    return same;
  } catch (err) {
    console.warn('[matchAccountIdentity] 比对账号失败:', err.message);
    return null;
  }
}

function collectSessionDomains(sessionData) {
  const parsed = parseSessionData(sessionData);
  const domains = new Set();

  if (!parsed) {
    return [];
  }

  if (Array.isArray(parsed)) {
    parsed.forEach(item => {
      collectSessionDomains(item).forEach(domain => domains.add(domain));
    });
    return Array.from(domains);
  }

  if (typeof parsed === 'object') {
    if (typeof parsed.domain === 'string' && parsed.domain.trim()) {
      domains.add(parsed.domain.trim());
    }
    if (Array.isArray(parsed.domains)) {
      parsed.domains.forEach(domain => {
        if (typeof domain === 'string' && domain.trim()) {
          domains.add(domain.trim());
        }
      });
    }
    if (Array.isArray(parsed.cookieDomains)) {
      parsed.cookieDomains.forEach(domain => {
        if (typeof domain === 'string' && domain.trim()) {
          domains.add(domain.trim());
        }
      });
    }
  }

  extractSessionCookiesArray(parsed).forEach(cookie => {
    if (cookie && typeof cookie.domain === 'string' && cookie.domain.trim()) {
      const normalizedDomain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
      if (normalizedDomain) {
        domains.add(normalizedDomain);
      }
    }
  });

  return Array.from(domains);
}

function sessionDataHasStoragePayload(sessionData) {
  const parsed = parseSessionData(sessionData);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return false;
  }

  return (
    (parsed.localStorage && Object.keys(parsed.localStorage).length > 0)
    || (parsed.sessionStorage && Object.keys(parsed.sessionStorage).length > 0)
    || (parsed.indexedDB && Object.keys(parsed.indexedDB).length > 0)
  );
}

function pickSessionStorageForOrigin(storagePayload, targetOrigin = '', targetUrl = '') {
  if (!storagePayload || typeof storagePayload !== 'object' || Array.isArray(storagePayload)) {
    return null;
  }

  const candidateKeys = [];
  if (targetOrigin) {
    candidateKeys.push(targetOrigin);
  }

  try {
    const parsed = new URL(targetUrl || targetOrigin || '');
    if (parsed.origin) {
      candidateKeys.push(parsed.origin);
    }
    if (parsed.hostname) {
      candidateKeys.push(parsed.hostname);
      candidateKeys.push(`.${parsed.hostname}`);
    }
  } catch (_) {
    // noop
  }

  const normalizedKeys = Array.from(new Set(candidateKeys.filter(Boolean)));
  for (const key of normalizedKeys) {
    const direct = storagePayload[key];
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct;
    }
  }

  const entries = Object.entries(storagePayload);
  const looksLikeGroupedByDomain = entries.some(([key, value]) => {
    return (key.startsWith('http://') || key.startsWith('https://') || key.includes('.'))
      && value && typeof value === 'object' && !Array.isArray(value);
  });

  if (looksLikeGroupedByDomain) {
    return null;
  }

  return storagePayload;
}

function buildEffectiveSessionRestoreData(cachedSessionData, incomingSessionData) {
  const parsedCached = parseSessionData(cachedSessionData);
  if (!parsedCached) {
    return {
      sessionData: incomingSessionData,
      source: incomingSessionData ? 'incoming-session' : 'none'
    };
  }

  const parsedIncoming = parseSessionData(incomingSessionData);
  if (!parsedIncoming) {
    return {
      sessionData: cachedSessionData,
      source: 'latest-cache'
    };
  }

  const cachedHasStorage = sessionDataHasStoragePayload(parsedCached);
  const incomingHasStorage = sessionDataHasStoragePayload(parsedIncoming);
  const cachedTimestamp = extractSessionTimestamp(parsedCached);
  const incomingTimestamp = extractSessionTimestamp(parsedIncoming);
  const cachedCookies = extractSessionCookiesArray(parsedCached);
  const incomingCookies = extractSessionCookiesArray(parsedIncoming);
  const hasComparableTimestamps = cachedTimestamp > 0 && incomingTimestamp > 0;

  if (!cachedHasStorage && incomingHasStorage) {
    const mergedSessionData = cloneSerializable(parsedIncoming) || {};
    const shouldUseCachedCookies = cachedCookies.length > 0
      && (!incomingCookies.length || !incomingTimestamp || cachedTimestamp >= incomingTimestamp);

    if (shouldUseCachedCookies) {
      mergedSessionData.cookies = cachedCookies;
    } else if (!Array.isArray(mergedSessionData.cookies)) {
      mergedSessionData.cookies = incomingCookies;
    }

    const mergedDomains = Array.from(new Set([
      ...collectSessionDomains(parsedIncoming),
      ...collectSessionDomains(parsedCached)
    ]));
    if (mergedDomains.length > 0) {
      if (!mergedSessionData.domain) {
        mergedSessionData.domain = mergedDomains[0];
      }
      mergedSessionData.domains = mergedDomains;
      mergedSessionData.cookieDomains = mergedDomains;
    }
    const mergedTimestamp = Math.max(cachedTimestamp, incomingTimestamp);
    if (mergedTimestamp) {
      mergedSessionData.timestamp = mergedTimestamp;
    }

    return {
      sessionData: mergedSessionData,
      source: shouldUseCachedCookies ? 'latest-cache+incoming-storage' : 'incoming-session'
    };
  }

  if (cachedHasStorage && !incomingHasStorage && incomingCookies.length > 0 && incomingTimestamp > cachedTimestamp) {
    return {
      sessionData: mergeSessionRestoreData(parsedCached, parsedIncoming, incomingTimestamp),
      source: 'incoming-cookies+latest-cache-storage'
    };
  }

  if (incomingTimestamp > 0 && (!cachedTimestamp || incomingTimestamp > cachedTimestamp)) {
    return {
      sessionData: incomingSessionData,
      source: 'incoming-session'
    };
  }

  if (!hasComparableTimestamps && !cachedHasStorage && !incomingHasStorage && incomingCookies.length > cachedCookies.length) {
    return {
      sessionData: incomingSessionData,
      source: 'incoming-session'
    };
  }

  return {
    sessionData: cachedSessionData,
    source: 'latest-cache'
  };
}

const SESSION_SNAPSHOT_TTL_SECONDS = 30 * 24 * 3600;
const SESSION_SNAPSHOT_TTL_MS = SESSION_SNAPSHOT_TTL_SECONDS * 1000;

function getSessionSnapshotExpirationDate(nowSeconds = Math.floor(Date.now() / 1000)) {
  return nowSeconds + SESSION_SNAPSHOT_TTL_SECONDS;
}

function isSessionSnapshotExpired(snapshot) {
  const timestamp = Number(snapshot?.timestamp || 0);
  if (!timestamp) {
    return false;
  }
  return Date.now() - timestamp > SESSION_SNAPSHOT_TTL_MS;
}

// 🔐 登录页 URL 识别模式（全局共用，覆盖所有平台变体）
// /login - 通用、小红书、视频号 login.html、搜狐 /mpfe/v4/login
// /userauth - 腾讯号 om.qq.com/userAuth/index
// /userlogin - 兜底通用
// /loginpage, /cgi-bin/login - 微信公众号
// passport. - 抖音、搜狐、网易、新浪等账号中心
// account.qq.com - 腾讯账号中心
const GLOBAL_LOGIN_URL_PATTERNS = [
  '/login',
  '/userauth',
  '/userlogin',
  '/loginpage',
  '/cgi-bin/login',
  'passport.',
  '/sso/',
  '/auth/',
  '/signin',
  'account.qq.com',
  'security.weibo.com'
];

function isLoginPageUrl(u) {
  if (!u) return false;
  const lower = String(u).toLowerCase();
  return GLOBAL_LOGIN_URL_PATTERNS.some(p => lower.includes(p));
}

const STATIC_RESOURCE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.css', '.map', '.ico',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.json', '.txt', '.xml', '.pdf', '.mp4', '.webm'
]);
const GENERIC_TEXTUAL_MIME_TYPES = new Set([
  'text/plain',
  'application/octet-stream',
  'binary/octet-stream',
  'text/octet-stream',
  'application/unknown'
]);
const JAVASCRIPT_MIME_TYPES = new Set([
  'application/javascript',
  'text/javascript',
  'application/x-javascript'
]);
const CSS_MIME_TYPES = new Set([
  'text/css'
]);

function getUrlInfo(rawUrl = '') {
  try {
    const parsed = new URL(rawUrl);
    return {
      href: parsed.href,
      origin: parsed.origin,
      pathname: parsed.pathname || '/',
      search: parsed.search || ''
    };
  } catch (_) {
    const sanitized = String(rawUrl || '').split(/[?#]/)[0];
    return {
      href: String(rawUrl || ''),
      origin: '',
      pathname: sanitized || '/',
      search: ''
    };
  }
}

function getUrlPathExtension(rawUrl = '') {
  const { pathname } = getUrlInfo(rawUrl);
  return path.posix.extname(String(pathname || '').toLowerCase());
}

function isStaticResourceUrl(rawUrl = '') {
  const { pathname } = getUrlInfo(rawUrl);
  const normalizedPath = String(pathname || '').toLowerCase();
  if (!normalizedPath || normalizedPath === '/' || normalizedPath === '/index.html') {
    return false;
  }
  const ext = getUrlPathExtension(rawUrl);
  return STATIC_RESOURCE_EXTENSIONS.has(ext);
}

function normalizeContentTypeHeaderValue(rawValue) {
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function setResponseHeaderValue(responseHeaders, headerName, value) {
  const existingKey = Object.keys(responseHeaders || {}).find(key => key.toLowerCase() === headerName.toLowerCase());
  responseHeaders[existingKey || headerName] = [value];
}

function resolvePatchedContentType(details = {}) {
  const resourceType = String(details.resourceType || '').toLowerCase();
  const ext = getUrlPathExtension(details.url || '');
  const isScriptLike = resourceType === 'script' || ext === '.js' || ext === '.mjs' || ext === '.cjs';
  const isStylesheetLike = resourceType === 'stylesheet' || ext === '.css';

  if (isStylesheetLike) {
    return 'text/css; charset=utf-8';
  }
  if (isScriptLike) {
    return 'application/javascript; charset=utf-8';
  }
  return '';
}

function shouldOverrideContentType(rawContentType = '', patchedContentType = '') {
  if (!patchedContentType) return false;

  const currentMimeType = normalizeContentTypeHeaderValue(rawContentType);
  if (!currentMimeType) return true;

  const patchedMimeType = normalizeContentTypeHeaderValue(patchedContentType);
  if (currentMimeType === patchedMimeType) return false;

  if (patchedMimeType === 'text/css') {
    return GENERIC_TEXTUAL_MIME_TYPES.has(currentMimeType) && !CSS_MIME_TYPES.has(currentMimeType);
  }

  if (patchedMimeType === 'application/javascript') {
    return GENERIC_TEXTUAL_MIME_TYPES.has(currentMimeType) && !JAVASCRIPT_MIME_TYPES.has(currentMimeType);
  }

  return false;
}

function shouldApplyContentTypePatch(details = {}) {
  const resourceType = String(details.resourceType || '').toLowerCase();
  const mimeType = resolvePatchedContentType(details);
  if (!mimeType) {
    return { shouldPatch: false, mimeType: '' };
  }
  if (resourceType === 'mainframe' || resourceType === 'subframe') {
    return { shouldPatch: false, mimeType: '' };
  }
  return { shouldPatch: true, mimeType };
}

function isMainFrameRequest(details = {}) {
  const resourceType = String(details.resourceType || '').toLowerCase();
  return resourceType === 'mainframe' || resourceType === 'main_frame' || resourceType === 'main-frame';
}

function getWebContentsByRequest(details = {}) {
  const id = Number(details.webContentsId || 0);
  if (!id || !electronWebContents || typeof electronWebContents.fromId !== 'function') {
    return null;
  }

  try {
    return electronWebContents.fromId(id);
  } catch (_) {
    return null;
  }
}

function resolveMainFrameResourceRedirect(details = {}) {
  const requestUrl = details.url || '';
  if (!isMainFrameRequest(details) || !isStaticResourceUrl(requestUrl)) {
    return '';
  }

  const requestWebContents = getWebContentsByRequest(details);
  if (browserView?.webContents && requestWebContents && requestWebContents.id === browserView.webContents.id) {
    return resolveBrowserViewRecoveryTarget(browserView.webContents.getURL());
  }

  const ownerWindow = requestWebContents ? BrowserWindow.fromWebContents(requestWebContents) : null;
  const context = ownerWindow ? windowContextMap.get(ownerWindow.id) : null;
  if (context?.expectedPageUrl && !isStaticResourceUrl(context.expectedPageUrl)) {
    return context.expectedPageUrl;
  }

  if (startupLoadGuard.active && isBrowserViewDocumentUrl(startupLoadGuard.targetUrl)) {
    return startupLoadGuard.targetUrl;
  }

  return '';
}

function installSessionRequestGuard(targetSession, label, options = {}) {
  if (!targetSession?.webRequest) return;

  const current = sessionRequestGuardConfig.get(targetSession) || {
    label,
    blockBitbrowser: true,
    blockMainFrameResources: true,
    upgradeMp163: false
  };
  const merged = {
    ...current,
    ...options,
    label
  };
  sessionRequestGuardConfig.set(targetSession, merged);
  installSessionNetworkDiagnostics(targetSession);

  targetSession.webRequest.onBeforeRequest((details, callback) => {
    const configForSession = sessionRequestGuardConfig.get(targetSession) || merged;
    const requestUrl = details.url || '';
    const requestMap = getSessionNetworkRequestMap(targetSession);
    requestMap.set(details.id, {
      startedAt: Date.now(),
      method: details.method,
      url: requestUrl,
      resourceType: details.resourceType
    });

    appendNetworkDiagnosticLog(targetSession, 'INFO', 'start', details);

    if (configForSession.blockBitbrowser && requestUrl.toLowerCase().startsWith('bitbrowser:')) {
      appendNetworkDiagnosticLog(targetSession, 'WARN', 'cancelled', details, {
        reason: 'blocked-bitbrowser-protocol'
      });
      requestMap.delete(details.id);
      console.log(`[${configForSession.label} WebRequest] ❌ Blocked bitbrowser protocol:`, requestUrl);
      callback({ cancel: true });
      return;
    }

    if (configForSession.blockMainFrameResources) {
      const redirectUrl = resolveMainFrameResourceRedirect(details);
      if (redirectUrl && redirectUrl !== requestUrl) {
        appendNetworkDiagnosticLog(targetSession, 'WARN', 'redirect-by-guard', details, {
          reason: 'main-frame-static-resource',
          redirectURL: redirectUrl
        });
        console.warn(`[${configForSession.label} WebRequest] ⚠️ 主框架静态资源导航已改回页面: ${requestUrl} → ${redirectUrl}`);
        callback({ redirectURL: redirectUrl });
        return;
      }
    }

    if (configForSession.upgradeMp163 && requestUrl.startsWith('http://mp.163.com/')) {
      const httpsUrl = requestUrl.replace('http://mp.163.com/', 'https://mp.163.com/');
      appendNetworkDiagnosticLog(targetSession, 'INFO', 'redirect-by-guard', details, {
        reason: 'upgrade-mp163-http-to-https',
        redirectURL: httpsUrl
      });
      console.log(`[${configForSession.label} WebRequest] 🔒 HTTP→HTTPS: ${requestUrl}`);
      callback({ redirectURL: httpsUrl });
      return;
    }

    callback({});
  });

  console.log(`[Session] ✅ ${label} 请求守卫已安装`, {
    blockBitbrowser: merged.blockBitbrowser,
    blockMainFrameResources: merged.blockMainFrameResources,
    upgradeMp163: merged.upgradeMp163
  });
}

function normalizeContextPurpose(options = {}) {
  if (options.windowContext && typeof options.windowContext.purpose === 'string') {
    return options.windowContext.purpose;
  }
  if (options.publishData) return 'publish';
  if (options.useTemporarySession) return 'auth';
  return 'child';
}

function buildWindowContext(targetUrl, options = {}) {
  const baseInfo = getUrlInfo(targetUrl);
  const provided = options.windowContext && typeof options.windowContext === 'object'
    ? options.windowContext
    : {};

  return {
    purpose: normalizeContextPurpose(options),
    platform: provided.platform || options.platform || options.publishData?.platform || '',
    contentType: provided.contentType || options.publishData?.contentType || '',
    expectedPageUrl: provided.expectedPageUrl || targetUrl,
    safeOrigin: provided.safeOrigin || baseInfo.origin || '',
    bootstrapUrl: provided.bootstrapUrl || (baseInfo.origin ? `${baseInfo.origin}/` : ''),
    guardResourceUrls: provided.guardResourceUrls !== false && !!options.publishData,
    bootstrapInProgress: false,
    guardRedirectInFlight: false,
    guardRedirectCount: 0,
    createdAt: Date.now()
  };
}

function matchesExpectedPage(currentUrl = '', expectedUrl = '') {
  if (!currentUrl || !expectedUrl) return false;
  if (currentUrl === expectedUrl) return true;

  try {
    const current = new URL(currentUrl);
    const expected = new URL(expectedUrl);
    if (current.origin !== expected.origin || current.pathname !== expected.pathname) {
      return false;
    }
    if (!expected.search) {
      return true;
    }
    const expectedParams = new URLSearchParams(expected.search);
    const currentParams = new URLSearchParams(current.search);
    for (const [key, value] of expectedParams.entries()) {
      if (currentParams.get(key) !== value) {
        return false;
      }
    }
    return true;
  } catch (_) {
    return currentUrl.startsWith(expectedUrl);
  }
}

function sanitizeDebugPrefix(prefixRaw = 'debug') {
  return String(prefixRaw || 'debug').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'debug';
}

function writeDebugDumpFile(prefix, payload) {
  try {
    const dumpDir = path.join(app.getPath('userData'), 'debug-dumps');
    if (!fs.existsSync(dumpDir)) {
      fs.mkdirSync(dumpDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${sanitizeDebugPrefix(prefix)}-${timestamp}.json`;
    const filePath = path.join(dumpDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return filePath;
  } catch (error) {
    console.error('[Debug Dump] ❌ 写入失败:', error.message);
    return '';
  }
}

async function captureWindowDebugDump(targetWindow, reason, currentURL) {
  if (!targetWindow || targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
    return '';
  }

  const windowId = targetWindow.id;
  const context = windowContextMap.get(windowId) || null;
  let pageSnapshot = null;

  try {
    pageSnapshot = await targetWindow.webContents.executeJavaScript(`
      (() => ({
        href: location.href,
        title: document.title || '',
        readyState: document.readyState,
        bodyText: (document.body?.innerText || '').slice(0, 2000),
        bodyHtml: (document.body?.innerHTML || '').slice(0, 2000)
      }))()
    `, true);
  } catch (error) {
    pageSnapshot = { captureError: error.message };
  }

  return writeDebugDumpFile('publish-window-anomaly', {
    reason,
    currentURL,
    capturedAt: new Date().toISOString(),
    windowId,
    context,
    pageSnapshot
  });
}

async function inspectSourceTextDocument(webContents) {
  if (!webContents || webContents.isDestroyed()) {
    return { isSourceTextDocument: false, reason: 'webcontents-destroyed' };
  }

  try {
    return await webContents.executeJavaScript(`
      (() => {
        if (!document.body) {
          return { isSourceTextDocument: false, reason: 'no-body' };
        }

        const hasEditor = !!document.querySelector(
          '[contenteditable="true"], .public-DraftEditor-content, .ProseMirror, .ql-editor, .tox, .CodeMirror, .monaco-editor'
        );
        if (hasEditor) {
          return { isSourceTextDocument: false, reason: 'editor-present' };
        }

        const body = document.body;
        const bodyText = (body.innerText || '').trim().slice(0, 5000);
        const visibleElementCount = Array.from(document.querySelectorAll('body *'))
          .slice(0, 120)
          .filter((el) => {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none'
              && style.visibility !== 'hidden'
              && Number(style.opacity || '1') !== 0
              && rect.width >= 12
              && rect.height >= 12;
          })
          .length;

        const cssPatterns = [
          '@charset',
          '@font-face',
          ':hover{',
          ':focus{',
          '@media ',
          '@keyframes ',
          'text-decoration:none',
          'background-color:transparent',
          'display:block',
          'position:absolute'
        ];
        const jsonMarkers = [
          '"userAgent"',
          '"appViewConfig"',
          '"layerId"',
          '"currentTab"',
          '"notifications"',
          '"zhuanlan.zhihu.com"',
          '"ctx"',
          '"register"'
        ];
        const cssScore = cssPatterns.filter((pattern) => bodyText.includes(pattern)).length;
        const jsonScore = jsonMarkers.filter((pattern) => bodyText.includes(pattern)).length;
        const startsLikeJson = /^[{\\[]/.test(bodyText) || /^"[^"]+"\\s*:/.test(bodyText);
        const compactTextDocument = body.children.length <= 2 && visibleElementCount <= 3;
        const isCssSource = compactTextDocument && cssScore >= 3;
        const isJsonSource = compactTextDocument && bodyText.length > 800 && startsLikeJson && jsonScore >= 3;

        return {
          isSourceTextDocument: isCssSource || isJsonSource,
          reason: isCssSource ? 'css-source-text' : (isJsonSource ? 'json-source-text' : 'normal'),
          cssScore,
          jsonScore,
          visibleElementCount,
          childCount: body.children.length,
          href: location.href
        };
      })()
    `, true);
  } catch (error) {
    return { isSourceTextDocument: false, reason: error.message || String(error) };
  }
}

async function maybeRecoverPublishWindow(targetWindow, currentURL, reason = 'unknown') {
  if (!targetWindow || targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
    return { redirected: false };
  }

  // 🛡️ 登录页不要回跳：当用户在发布窗口扫码/登录时，URL 是 om.qq.com/userAuth、mp.sohu.com/mpfe/v4/login 等
  // 若误判为"资源页"会触发 loadURL 回跳，打断用户登录流程
  if (isLoginPageUrl(currentURL)) {
    return { redirected: false };
  }

  const context = windowContextMap.get(targetWindow.id);
  if (!context || !context.guardResourceUrls || context.bootstrapInProgress || !currentURL || currentURL === 'about:blank') {
    return { redirected: false };
  }
  const matchedExpectedPage = matchesExpectedPage(currentURL, context.expectedPageUrl);
  const sourceTextState = await inspectSourceTextDocument(targetWindow.webContents) || {};
  const isSourceTextDocument = !!sourceTextState.isSourceTextDocument;
  const isResourcePage = isStaticResourceUrl(currentURL) || isSourceTextDocument;
  if (matchedExpectedPage && !isSourceTextDocument) {
    return { redirected: false };
  }
  if (!isResourcePage) {
    return { redirected: false };
  }
  if (context.guardRedirectInFlight) {
    return { redirected: true, deduped: true };
  }
  if ((context.guardRedirectCount || 0) >= 3) {
    console.warn(`[Publish Window Guard] ⚠️ 资源页恢复已达到上限，停止自动回跳: windowId=${targetWindow.id}, url=${currentURL}`);
    return { redirected: false, limitReached: true };
  }

  context.guardRedirectInFlight = true;
  context.guardRedirectCount = (context.guardRedirectCount || 0) + 1;
  console.warn(`[Publish Window Guard] ⚠️ 检测到资源/源码页异常: windowId=${targetWindow.id}, reason=${reason}, url=${currentURL}, state=${sourceTextState.reason}`);
  const dumpPath = await captureWindowDebugDump(targetWindow, reason, currentURL);
  if (dumpPath) {
    console.warn(`[Publish Window Guard] 调试快照已写入: ${dumpPath}`);
  }

  try {
    await targetWindow.webContents.loadURL(context.expectedPageUrl);
  } catch (error) {
    console.error('[Publish Window Guard] ❌ 回跳发布页失败:', error.message);
  } finally {
    setTimeout(() => {
      const latest = windowContextMap.get(targetWindow.id);
      if (latest) {
        latest.guardRedirectInFlight = false;
      }
    }, 1500);
  }

  return { redirected: true };
}

function summarizeGlobalStorageValue(key, value) {
  if (key === 'publish_data') {
    const length = typeof value === 'string' ? value.length : JSON.stringify(value || '').length;
    return `[publish_data length=${length}]`;
  }

  // 记住密码相关字段：日志脱敏，绝不打印明文密码（PIPL 第 51 条去标识化）
  if (key === 'saved_accounts') {
    const list = Array.isArray(value) ? value : [];
    return `[saved_accounts count=${list.length} usernames=${list.map(a => maskSensitive(a?.username)).join(',')}]`;
  }
  if (key === 'pending_switch_account') {
    const obj = value && typeof value === 'object' ? value : {};
    return `[pending_switch username=${maskSensitive(obj.username)} tab=${obj.tab || ''}]`;
  }

  if (/^publish_data_window_\d+$/.test(key)) {
    const obj = value && typeof value === 'object' ? value : null;
    const title = obj?.element?.title || obj?.video?.video?.title || '';
    const platform = obj?.platform || '';
    const windowId = obj?.windowId || '';
    return { key, platform, windowId, title };
  }

  if (typeof value === 'string') {
    if (value.length <= 240) return value;
    return `${value.slice(0, 120)}... [length=${value.length}]`;
  }

  if (value && typeof value === 'object') {
    const preview = {};
    for (const keyName of Object.keys(value).slice(0, 8)) {
      const item = value[keyName];
      preview[keyName] = typeof item === 'string' && item.length > 80
        ? `${item.slice(0, 40)}... [length=${item.length}]`
        : item;
    }
    return preview;
  }

  return value;
}

function getPublishWindowIdFromStorageKey(key) {
  const match = String(key || '').match(/^publish_data_window_(\d+)$/);
  return match ? Number(match[1]) : null;
}

function rememberWindowPublishData(windowId, publishData) {
  const numericWindowId = Number(windowId);
  if (!Number.isFinite(numericWindowId) || !publishData || typeof publishData !== 'object') {
    return false;
  }
  try {
    windowPublishDataMap.set(numericWindowId, cloneSerializable(publishData));
  } catch (_) {
    windowPublishDataMap.set(numericWindowId, publishData);
  }
  return true;
}

function rememberWindowPublishDataFromStorageKey(key, value) {
  const windowId = getPublishWindowIdFromStorageKey(key);
  if (windowId === null) {
    return false;
  }
  return rememberWindowPublishData(windowId, value);
}

function getWindowPublishData(windowId) {
  const publishDataKey = `publish_data_window_${windowId}`;
  if (globalStorage[publishDataKey]) {
    return globalStorage[publishDataKey];
  }
  if (windowPublishDataMap.has(windowId)) {
    return windowPublishDataMap.get(windowId);
  }
  const numericWindowId = Number(windowId);
  if (Number.isFinite(numericWindowId) && windowPublishDataMap.has(numericWindowId)) {
    return windowPublishDataMap.get(numericWindowId);
  }
  return null;
}

function beginShutdown(source = 'unknown') {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  console.log(`[Shutdown] 开始退出清理，来源: ${source}`);

  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }
  if (destroyedWindowCleanupInterval) {
    clearInterval(destroyedWindowCleanupInterval);
    destroyedWindowCleanupInterval = null;
  }
  if (tray) {
    try {
      tray.destroy();
    } catch (error) {
      console.warn('[Shutdown] 销毁托盘失败:', error.message);
    }
    tray = null;
  }

  for (const child of childWindows.slice()) {
    if (child && !child.isDestroyed()) {
      try {
        child.close();
      } catch (error) {
        console.warn('[Shutdown] 关闭子窗口失败:', error.message);
      }
    }
  }

  try {
    app.releaseSingleInstanceLock();
    console.log('[Shutdown] ✅ 已提前释放单实例锁');
  } catch (error) {
    console.warn('[Shutdown] 释放单实例锁失败:', error.message);
  }
}
let isHandlingExpiredToken = false; // 防止过期处理重复触发
let isNavigatingToLogin = false; // 防止 navigateToLoginInternal 重入
let loginRestorePromise = null; // 防止 tryRestoreLoginWithToken 并发重入
let isShowingSessionExpiredDialog = false;
let isShowingPageErrorDialog = false;
let lastPageErrorDialogAt = 0;
let blankScreenConsecutive = 0;
const BLANK_SCREEN_CHECK_INTERVAL = 90 * 1000;
const BLANK_SCREEN_CONSECUTIVE_THRESHOLD = 2;
const FORCE_BARE_TOUTIAO = true;
const STARTUP_LOAD_READY_CHECK_DELAY = 900;
const STARTUP_LOAD_MAX_RECOVERIES = 2;
const STARTUP_LOAD_MAX_WAIT_MS = 20000;
const REFRESH_LOAD_READY_CHECK_DELAY = 600;
const REFRESH_LOAD_MAX_WAIT_MS = 15000;

let browserLoadingState = {
  visible: true,
  text: '正在加载页面...'
};

let startupLoadGuard = {
  active: false,
  targetUrl: '',
  reloadCount: 0,
  startedAt: 0,
  timer: null
};

let refreshLoadGuard = {
  active: false,
  startedAt: 0,
  timer: null
};
let browserViewResourceRecovery = {
  inFlight: false,
  lastUrl: '',
  startedAt: 0,
  sourceTextCount: 0
};

// 全局数据持久化存储（存储到文件，应用重启后仍然保留）
let globalStorage = {};
const getGlobalStoragePath = () => path.join(app.getPath('userData'), 'global-storage.json');
const getLocalPlatformConfigPath = () => path.join(__dirname, 'injected-scripts', 'platform-config.json');

async function fetchJsonWithElectronNet(targetUrl, timeout = 10000) {
  return await new Promise((resolve, reject) => {
    const request = net.request(targetUrl);
    let timer = null;

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      let raw = '';
      response.on('data', (chunk) => {
        raw += chunk.toString();
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(new Error(`Invalid JSON: ${error.message}`));
        }
      });
    });

    request.on('error', (error) => {
      reject(error);
    });

    timer = setTimeout(() => {
      request.abort();
      reject(new Error('Request timeout'));
    }, timeout);

    request.on('close', () => {
      if (timer) clearTimeout(timer);
    });

    request.end();
  });
}

function loadLocalPlatformConfig() {
  const configPath = getLocalPlatformConfigPath();
  const content = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(content);
}

async function loadRuntimePlatformConfig() {
  const configPath = getLocalPlatformConfigPath();
  const remoteUrl = `${config.domains.remoteScriptsBase}platform-config.json?v=${Date.now()}`;

  if (!app.isPackaged) {
    const localConfig = loadLocalPlatformConfig();
    return {
      success: true,
      source: 'local',
      path: configPath,
      config: localConfig
    };
  }

  try {
    const remoteConfig = await fetchJsonWithElectronNet(remoteUrl, 10000);
    return {
      success: true,
      source: 'remote',
      url: remoteUrl,
      config: remoteConfig
    };
  } catch (error) {
    console.error('[PlatformConfig] 远程加载失败，回退本地配置:', error.message);
    const localConfig = loadLocalPlatformConfig();
    return {
      success: true,
      source: 'local-fallback',
      path: configPath,
      remoteUrl,
      fallbackReason: error.message,
      config: localConfig
    };
  }
}

// 加载持久化数据
// 需要加密存储的敏感字段（safeStorage 透明加解密，磁盘上为密文）
// Why: PIPL 第 51 条要求采取加密等技术措施保护个人信息；防止文件被拷走后明文泄露
const SENSITIVE_GLOBAL_KEYS = [
  'login_token',
  'login_gcc',
  'user_info',
  'siteInfo',
  'platformAccounts',
  'saved_accounts',          // 记住密码：已保存账号列表（含密码），必须加密落盘
  'pending_switch_account'   // 账号切换中转标志（含密码），login.html 读取后即删
];
const ENCRYPTED_PREFIX = 'enc:v1:';

function encryptIfPossible(value) {
  try {
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
      console.warn('[Global Storage] ⚠️ safeStorage 不可用，敏感字段（含记住的密码）将以明文落盘，请检查系统密钥环/DPAPI');
      return value;
    }
    const json = JSON.stringify(value);
    const buf = safeStorage.encryptString(json);
    return ENCRYPTED_PREFIX + buf.toString('base64');
  } catch (err) {
    console.error('[Global Storage] 加密失败，回退明文:', err.message);
    return value;
  }
}

function decryptIfNeeded(value) {
  try {
    if (typeof value !== 'string' || !value.startsWith(ENCRYPTED_PREFIX)) return value;
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
      console.warn('[Global Storage] safeStorage 不可用，无法解密');
      return null;
    }
    const buf = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64');
    const json = safeStorage.decryptString(buf);
    return JSON.parse(json);
  } catch (err) {
    console.error('[Global Storage] 解密失败:', err.message);
    return null;
  }
}

// 敏感值日志脱敏：保留前 4 后 4，中间用 *** 代替
// Why: PIPL 第 51 条要求处理个人信息时采取"去标识化"措施；防止日志被收集时泄露敏感信息
function maskSensitive(value, keepHead = 4, keepTail = 4) {
  if (value === null || value === undefined) return value;
  const str = String(value);
  if (str.length <= keepHead + keepTail) return '***';
  return str.slice(0, keepHead) + '***' + str.slice(-keepTail);
}

function loadGlobalStorage() {
  try {
    const storagePath = getGlobalStoragePath();
    if (fs.existsSync(storagePath)) {
      const data = fs.readFileSync(storagePath, 'utf8');
      const raw = JSON.parse(data);

      // 解密敏感字段（兼容历史明文：未加密的字段直接保留，下次保存时会自动加密）
      let migrated = false;
      for (const key of SENSITIVE_GLOBAL_KEYS) {
        if (key in raw) {
          const decoded = decryptIfNeeded(raw[key]);
          if (decoded !== raw[key]) raw[key] = decoded;
          else if (typeof raw[key] !== 'string' || !raw[key].startsWith(ENCRYPTED_PREFIX)) {
            // 历史明文 → 触发下次保存时加密
            migrated = true;
          }
        }
      }
      globalStorage = raw;
      console.log('[Global Storage] ✅ 已从文件加载数据:', storagePath);
      if (migrated) {
        console.log('[Global Storage] 检测到历史明文敏感字段，将在下次保存时自动加密');
        saveGlobalStorage();
      }
    } else {
      console.log('[Global Storage] 文件不存在，使用空存储');
    }
  } catch (err) {
    console.error('[Global Storage] ❌ 加载数据失败:', err);
    globalStorage = {};
  }
}

// 保存持久化数据
function saveGlobalStorage() {
  try {
    const storagePath = getGlobalStoragePath();
    // 浅克隆 + 加密敏感字段，不影响内存中的 globalStorage 结构（业务侧仍读明文）
    const toWrite = { ...globalStorage };
    for (const key of SENSITIVE_GLOBAL_KEYS) {
      if (key in toWrite && toWrite[key] !== undefined && toWrite[key] !== null) {
        toWrite[key] = encryptIfPossible(toWrite[key]);
      }
    }
    fs.writeFileSync(storagePath, JSON.stringify(toWrite, null, 2), 'utf8');
    console.log('[Global Storage] ✅ 数据已保存到文件:', storagePath);
  } catch (err) {
    console.error('[Global Storage] ❌ 保存数据失败:', err);
  }
}

// 检测是否为便携版（通过检查是否在标准安装目录）
// 便携版特征：生产环境 + 不在 Program Files/ProgramData 目录
const execPathLower = process.execPath.toLowerCase();
const isInstalled = execPathLower.includes('program files') ||
                    execPathLower.includes('programdata') ||
                    execPathLower.includes('\\windows\\');
const isPortable = isProduction && !isInstalled;

// 设置用户数据路径
if (isProduction) {
  if (isPortable) {
    // 便携版：数据存储在固定的 %LOCALAPPDATA%\运营助手-Portable 目录
    // 这样无论 exe 放在哪个位置，数据都在同一个地方，不会因为移动 exe 而丢失数据
    const portableDataPath = path.join(process.env.LOCALAPPDATA || app.getPath('appData'), '资海云运营助手-Portable');

    // 确保目录存在
    if (!fs.existsSync(portableDataPath)) {
      try {
        fs.mkdirSync(portableDataPath, { recursive: true });
        console.log('[Portable Mode] 已创建数据目录:', portableDataPath);
      } catch (err) {
        console.error('[Portable Mode] 创建目录失败:', err);
      }
    }

    app.setPath('userData', portableDataPath);
    console.log('[Portable Mode] ✅ 便携版模式启用');
    console.log('[Portable Mode] 数据存储在固定位置:', portableDataPath);
  } else {
    // 安装版：使用系统默认路径
    console.log('[Installed Mode] 使用系统 AppData 目录:', app.getPath('userData'));
  }
}

// 登录页地址（本地 HTML 文件）
// 🔑 用 pathToFileURL 正确编码路径（中文/空格/特殊字符），避免裸拼 file:// 导致 MIME 识别失败、CSS 渲染成文字
const LOGIN_URL = require('url').pathToFileURL(path.join(__dirname, 'login.html')).href;
const LOGIN_FILE_PATH = path.join(__dirname, 'login.html'); // 用于 loadFile()，避免 file:// MIME 类型问题

// 首页地址（开发和生产环境都使用登录页）
const HOME_URL = LOGIN_URL;
const PUBLISH_LOADING_PAGE = 'publish-loading.html';

// 加载本地页面（使用 loadFile 确保 MIME 类型正确，解决 CSS 渲染成文字的问题）
// 如果 loadFile 失败（如 mklink 符号链接导致中文路径编码异常），则用正确编码的 file:// URL 重试
function loadLocalPage(webContents, pageName) {
  const filePath = path.join(__dirname, pageName);
  console.log(`[loadLocalPage] 使用 loadFile 加载: ${filePath}`);
  return webContents.loadFile(filePath).catch(err => {
    console.warn(`[loadLocalPage] loadFile 失败 (${err.code || err.message})，尝试 loadURL fallback`);
    // 使用 URL 构造器正确编码中文路径（符号链接/特殊路径场景）
    const fileUrl = require('url').pathToFileURL(filePath).href;
    console.log(`[loadLocalPage] fallback loadURL: ${fileUrl}`);
    return webContents.loadURL(fileUrl);
  });
}

function createPublishLoadingWindow(options = {}) {
  const appIcon = nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));
  const loadingWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: '正在打开发布窗口',
    show: false,
    center: true,
    autoHideMenuBar: true,
    backgroundColor: '#fffaf0',
    icon: appIcon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  const query = {
    platform: options.publishData?.platform || options.platform || '',
    contentType: options.publishData?.contentType || ''
  };
  loadingWindow.loadFile(path.join(__dirname, PUBLISH_LOADING_PAGE), { query }).catch(err => {
    if (!loadingWindow.isDestroyed()) {
      console.warn('[Window Manager] 加载发布 loading 页失败:', err.message);
    }
  });
  loadingWindow.once('ready-to-show', () => {
    if (!loadingWindow.isDestroyed() && !loadingWindow.isVisible()) {
      loadingWindow.show();
    }
  });
  setTimeout(() => {
    if (!loadingWindow.isDestroyed() && !loadingWindow.isVisible()) {
      loadingWindow.show();
    }
  }, 500);

  // 🪄 步骤状态联动：在窗口对象上挂载 updateStep / finishStep / activateStep 工具
  // 页面未加载完成时先入队，did-finish-load 后批量应用，再切换为直接执行模式
  const stepQueue = [];
  let pageReady = false;

  const applyStep = (index, status) => {
    if (!loadingWindow || loadingWindow.isDestroyed()) return;
    const wc = loadingWindow.webContents;
    if (!wc || wc.isDestroyed()) return;
    const safeIndex = Number(index);
    const safeStatus = JSON.stringify(String(status || 'active'));
    wc.executeJavaScript(
      `(typeof window.__setLoadingStep==='function')&&window.__setLoadingStep(${safeIndex}, ${safeStatus});`,
      true
    ).catch(() => {});
  };

  loadingWindow.webContents.once('did-finish-load', () => {
    pageReady = true;
    while (stepQueue.length) {
      const { index, status } = stepQueue.shift();
      applyStep(index, status);
    }
  });

  loadingWindow.updateStep = (index, status) => {
    if (!loadingWindow || loadingWindow.isDestroyed()) return;
    if (!pageReady) {
      stepQueue.push({ index, status });
      return;
    }
    applyStep(index, status);
  };
  // 语义糖
  loadingWindow.activateStep = (index) => loadingWindow.updateStep(index, 'active');
  loadingWindow.finishStep = (index) => loadingWindow.updateStep(index, 'done');

  return loadingWindow;
}

// 安全调用 loading 窗口步骤更新，避免散落判空逻辑
function safeUpdateLoadingStep(loadingWindow, index, status) {
  if (!loadingWindow || loadingWindow.isDestroyed()) return;
  if (typeof loadingWindow.updateStep === 'function') {
    loadingWindow.updateStep(index, status);
  }
}

function shouldShowPageErrorDialog() {
  const now = Date.now();
  if (now - lastPageErrorDialogAt < 15000) return false;
  lastPageErrorDialogAt = now;
  return true;
}

async function showSessionExpiredDialog(source) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (isShowingSessionExpiredDialog) return;
  isShowingSessionExpiredDialog = true;
  try {
    await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: '登录已过期',
      message: '登录已过期，请重新登录。',
      detail: source ? `来源：${source}` : undefined,
      buttons: ['回到登录页'],
      defaultId: 0,
      noLink: true
    });
  } finally {
    isShowingSessionExpiredDialog = false;
  }
}

async function showPageErrorDialog({ title, message, detail, buttons }) {
  if (!mainWindow || mainWindow.isDestroyed()) return { response: 2 };
  if (isShowingPageErrorDialog) return { response: 2 };
  if (!shouldShowPageErrorDialog()) return { response: 2 };
  isShowingPageErrorDialog = true;
  try {
    return await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title,
      message,
      detail,
      buttons: buttons || ['重新加载', '回到登录页', '关闭'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    });
  } finally {
    isShowingPageErrorDialog = false;
  }
}

function clearStartupLoadGuardTimer() {
  if (startupLoadGuard.timer) {
    clearTimeout(startupLoadGuard.timer);
    startupLoadGuard.timer = null;
  }
}

function clearRefreshLoadGuardTimer() {
  if (refreshLoadGuard.timer) {
    clearTimeout(refreshLoadGuard.timer);
    refreshLoadGuard.timer = null;
  }
}

function setBrowserLoadingState(partialState = {}) {
  browserLoadingState = {
    ...browserLoadingState,
    ...partialState
  };

  if (browserView && browserView.webContents && !browserView.webContents.isDestroyed()) {
    if (browserLoadingState.visible) {
      browserView.setBounds({ x: 0, y: -10000, width: 0, height: 0 });
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      updateBrowserViewBounds(isScriptPanelOpen);
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('browser-loading-state', browserLoadingState);
  }
}

function beginStartupLoadGuard(targetUrl) {
  clearStartupLoadGuardTimer();
  startupLoadGuard = {
    active: true,
    targetUrl,
    reloadCount: 0,
    startedAt: Date.now(),
    timer: null
  };
  setBrowserLoadingState({ visible: true, text: '正在加载页面...' });
  console.log('[Startup Guard] ✅ 已开启首屏守卫:', targetUrl);
}

function finishStartupLoadGuard(reason = 'ready') {
  if (!startupLoadGuard.active) return;
  clearStartupLoadGuardTimer();
  startupLoadGuard.active = false;
  setBrowserLoadingState({ visible: false, text: '正在加载页面...' });
  console.log('[Startup Guard] ✅ 首屏守卫结束:', reason);
}

function beginRefreshLoadGuard(text = '正在刷新页面...') {
  clearRefreshLoadGuardTimer();
  refreshLoadGuard = {
    active: true,
    startedAt: Date.now(),
    timer: null
  };
  setBrowserLoadingState({ visible: true, text });
  console.log('[Refresh Guard] ✅ 已开启刷新守卫');
}

function finishRefreshLoadGuard(reason = 'ready') {
  if (!refreshLoadGuard.active) return;
  clearRefreshLoadGuardTimer();
  refreshLoadGuard.active = false;
  setBrowserLoadingState({ visible: false, text: '正在加载页面...' });
  console.log('[Refresh Guard] ✅ 刷新守卫结束:', reason);
}

async function inspectBrowserViewReadiness() {
  if (!browserView || !browserView.webContents || browserView.webContents.isDestroyed()) {
    return { ready: false, reason: 'browserview-destroyed' };
  }

  return browserView.webContents.executeJavaScript(`
    (() => {
      try {
        if (!document || !document.body) {
          return { ready: false, reason: 'no-body' };
        }

        const body = document.body;
        const htmlLength = (body.innerHTML || '').replace(/\\s+/g, '').length;
        const textLength = (body.innerText || '').trim().length;
        const childCount = body.children ? body.children.length : 0;
        const bodyRect = body.getBoundingClientRect();

        const hasVisibleElement = (el, minSize = 24) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number(style.opacity || '1') !== 0
            && rect.width >= minSize
            && rect.height >= minSize;
        };

        const appRootSelectors = ['#app', '#root', '#__nuxt', '#layout', '[data-v-app]'];
        const rootVisible = appRootSelectors.some((selector) => {
          try {
            return hasVisibleElement(document.querySelector(selector));
          } catch (_) {
            return false;
          }
        });

        const visibleChildren = Array.from(body.children || []).some((el) => hasVisibleElement(el));
        const hasKnownSpinner = !!document.querySelector('.loading, .spinner, .ant-spin, .el-loading-mask, .nprogress-busy, .v-progress-circular');
        const meaningfulVisualElement = !!document.querySelector(
          'main, section, article, aside, header, footer, nav, table, ul, ol, li, form, img, svg, canvas, video, iframe, [role=\"main\"], [role=\"dialog\"]'
        );
        const visibleSampleElements = Array.from(document.querySelectorAll('body *'))
          .slice(0, 80)
          .filter((el) => hasVisibleElement(el, 12))
          .length;
        const bodyTextPreview = (body.innerText || '').trim().slice(0, 5000);
        const cssTextPatterns = [
          '@charset',
          '@font-face',
          ':hover{',
          ':focus{',
          '@media ',
          '@keyframes ',
          'text-decoration:none',
          'background-color:transparent',
          'display:block',
          'position:absolute'
        ];
        const cssTextMatchCount = cssTextPatterns.filter((pattern) => bodyTextPreview.includes(pattern)).length;
        const jsonTextMarkers = [
          '"userAgent"',
          '"appViewConfig"',
          '"layerId"',
          '"currentTab"',
          '"notifications"',
          '"zhuanlan.zhihu.com"',
          '"ctx"',
          '"register"'
        ];
        const jsonTextMarkerCount = jsonTextMarkers.filter((pattern) => bodyTextPreview.includes(pattern)).length;
        const startsLikeJson = /^[{\\[]/.test(bodyTextPreview) || /^"[^"]+"\\s*:/.test(bodyTextPreview);
        const looksLikeCssSource = cssTextMatchCount >= 3 && childCount <= 2 && visibleSampleElements <= 3;
        const looksLikeJsonSource = bodyTextPreview.length > 800 && startsLikeJson && jsonTextMarkerCount >= 3 && childCount <= 2 && visibleSampleElements <= 3;
        if (looksLikeCssSource || looksLikeJsonSource) {
          return {
            ready: false,
            reason: looksLikeCssSource ? 'css-source-text' : 'json-source-text',
            htmlLength,
            textLength,
            childCount,
            visibleSampleElements,
            cssTextMatchCount,
            jsonTextMarkerCount,
            href: location.href
          };
        }
        const bodyHasViewportSize = bodyRect.width >= 200 && bodyRect.height >= 120;
        const likelyRenderedShell = htmlLength > 1000 && childCount >= 3 && bodyHasViewportSize;
        const ready = (
          htmlLength > 80 && (
            textLength > 0
            || rootVisible
            || visibleChildren
            || hasKnownSpinner
            || meaningfulVisualElement
            || visibleSampleElements >= 2
            || likelyRenderedShell
          )
        );

        return {
          ready,
          reason: ready ? 'visual-ready' : 'visual-not-ready',
          htmlLength,
          textLength,
          childCount,
          bodyWidth: Math.round(bodyRect.width || 0),
          bodyHeight: Math.round(bodyRect.height || 0),
          rootVisible,
          visibleChildren,
          hasKnownSpinner,
          meaningfulVisualElement,
          visibleSampleElements,
          likelyRenderedShell,
          href: location.href
        };
      } catch (err) {
        return {
          ready: false,
          reason: err && err.message ? err.message : String(err)
        };
      }
    })()
  `, true);
}

function retryStartupLoad(reason) {
  if (!startupLoadGuard.active) return false;
  if (!browserView || !browserView.webContents || browserView.webContents.isDestroyed()) return false;
  if (startupLoadGuard.reloadCount >= STARTUP_LOAD_MAX_RECOVERIES) return false;

  clearStartupLoadGuardTimer();
  startupLoadGuard.reloadCount += 1;
  const targetUrl = startupLoadGuard.targetUrl || browserView.webContents.getURL() || LOGIN_URL;
  const retryText = startupLoadGuard.reloadCount === 1
    ? '页面加载较慢，正在重试...'
    : '页面仍未恢复，正在再次尝试...';

  setBrowserLoadingState({ visible: true, text: retryText });
  console.warn(`[Startup Guard] ⚠️ ${reason}，准备第 ${startupLoadGuard.reloadCount} 次恢复: ${targetUrl}`);

  setTimeout(() => {
    if (!browserView || !browserView.webContents || browserView.webContents.isDestroyed()) return;
    const loadPromise = targetUrl.startsWith('file://')
      ? loadLocalPage(browserView.webContents, path.basename(targetUrl))
      : browserView.webContents.loadURL(targetUrl);
    loadPromise.catch(err => {
      console.error('[Startup Guard] ❌ 恢复加载失败:', err);
    });
  }, 1200);

  return true;
}

function scheduleStartupReadinessCheck(reason, delayMs = STARTUP_LOAD_READY_CHECK_DELAY) {
  if (!startupLoadGuard.active) return;
  clearStartupLoadGuardTimer();

  startupLoadGuard.timer = setTimeout(async () => {
    if (!startupLoadGuard.active) return;
    if (!browserView || !browserView.webContents || browserView.webContents.isDestroyed()) return;

    const elapsed = Date.now() - startupLoadGuard.startedAt;
    if (elapsed > STARTUP_LOAD_MAX_WAIT_MS) {
      console.warn(`[Startup Guard] ⚠️ 首屏等待超时: ${elapsed}ms`);
      if (retryStartupLoad(`首屏等待超时 ${elapsed}ms`)) return;

      finishStartupLoadGuard('timeout');
      const result = await showPageErrorDialog({
        title: '页面加载较慢',
        message: '启动页加载超时，是否尝试恢复？',
        detail: `触发点: ${reason}，等待时长: ${elapsed}ms`
      });

      if (result.response === 0) {
        beginStartupLoadGuard(startupLoadGuard.targetUrl || LOGIN_URL);
        browserView.webContents.reload();
      } else if (result.response === 1) {
        await navigateToLoginInternal('startup_load_timeout');
      }
      return;
    }

    try {
      const state = await inspectBrowserViewReadiness();
      if (state.ready) {
        console.log('[Startup Guard] ✅ 首屏渲染检查通过:', state);
        finishStartupLoadGuard(reason);
        return;
      }

      console.warn('[Startup Guard] ⚠️ 首屏仍未就绪:', state);
      if (browserView.webContents.isLoading()) {
        scheduleStartupReadinessCheck(`${reason}:still-loading`, 1200);
        return;
      }

      if (retryStartupLoad(`首屏检查未通过 (${state.reason || 'unknown'})`)) return;

      finishStartupLoadGuard('visual-check-failed');
      const result = await showPageErrorDialog({
        title: '页面可能空白',
        message: '启动后页面仍未正常渲染，是否尝试恢复？',
        detail: `原因: ${state.reason || 'unknown'} | html=${state.htmlLength || 0} text=${state.textLength || 0} child=${state.childCount || 0}`
      });

      if (result.response === 0) {
        beginStartupLoadGuard(startupLoadGuard.targetUrl || browserView.webContents.getURL() || LOGIN_URL);
        browserView.webContents.reload();
      } else if (result.response === 1) {
        await navigateToLoginInternal('blank_screen_startup');
      }
    } catch (err) {
      console.warn('[Startup Guard] ⚠️ 首屏检查执行失败:', err.message || err);
      if (browserView.webContents.isLoading()) {
        scheduleStartupReadinessCheck(`${reason}:check-failed-while-loading`, 1200);
        return;
      }

      if (retryStartupLoad(`首屏检查失败 (${err.message || err})`)) return;
      finishStartupLoadGuard('check-failed');
    }
  }, delayMs);
}

function scheduleRefreshReadinessCheck(reason, delayMs = REFRESH_LOAD_READY_CHECK_DELAY) {
  if (!refreshLoadGuard.active) return;
  clearRefreshLoadGuardTimer();

  refreshLoadGuard.timer = setTimeout(async () => {
    if (!refreshLoadGuard.active) return;
    if (!browserView || !browserView.webContents || browserView.webContents.isDestroyed()) return;

    const elapsed = Date.now() - refreshLoadGuard.startedAt;
    if (elapsed > REFRESH_LOAD_MAX_WAIT_MS) {
      console.warn(`[Refresh Guard] ⚠️ 刷新等待超时: ${elapsed}ms`);
      finishRefreshLoadGuard('timeout');
      return;
    }

    try {
      const state = await inspectBrowserViewReadiness();
      if (state.ready) {
        console.log('[Refresh Guard] ✅ 刷新渲染检查通过:', state);
        finishRefreshLoadGuard(reason);
        return;
      }

      console.warn('[Refresh Guard] ⚠️ 刷新后页面仍未就绪:', state);
      if (browserView.webContents.isLoading()) {
        scheduleRefreshReadinessCheck(`${reason}:still-loading`, 900);
        return;
      }

      scheduleRefreshReadinessCheck(`${reason}:visual-not-ready`, 900);
    } catch (err) {
      console.warn('[Refresh Guard] ⚠️ 刷新检查执行失败:', err.message || err);
      if (browserView.webContents.isLoading()) {
        scheduleRefreshReadinessCheck(`${reason}:check-failed-while-loading`, 900);
        return;
      }
      finishRefreshLoadGuard('check-failed');
    }
  }, delayMs);
}

function getDefaultProjectHomeUrl() {
  return globalStorage.last_project === 'geo' ? config.getGeoUrl() : config.getAigcUrl();
}

function isBrowserViewDocumentUrl(rawUrl = '') {
  const url = String(rawUrl || '').trim();
  if (!url || url === 'about:blank') return false;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  if (isStaticResourceUrl(url)) return false;
  if (isLoginPageUrl(url)) return false;
  if (config?.domains?.authRedirect && url.includes(config.domains.authRedirect)) return false;

  const placeholderPages = Object.values(config?.placeholderPages || {});
  if (placeholderPages.some(page => page && url.includes(page))) {
    return false;
  }

  return true;
}

function shouldRecoverBrowserViewResourceUrl(rawUrl = '') {
  if (!rawUrl || rawUrl === 'about:blank') return false;
  if (!isStaticResourceUrl(rawUrl)) return false;
  return isFirstPartyUrl(rawUrl) || startupLoadGuard.active;
}

function resolveBrowserViewRecoveryTarget(preferredUrl = '') {
  const candidate = String(preferredUrl || '').trim();
  if (isBrowserViewDocumentUrl(candidate)) {
    return candidate;
  }

  if (startupLoadGuard.active && isBrowserViewDocumentUrl(startupLoadGuard.targetUrl)) {
    return startupLoadGuard.targetUrl;
  }

  return getDefaultProjectHomeUrl();
}

async function recoverBrowserViewFromResourcePage(currentUrl, reason = 'unknown', preferredUrl = '') {
  if (!browserView || !browserView.webContents || browserView.webContents.isDestroyed()) {
    return false;
  }
  if (!shouldRecoverBrowserViewResourceUrl(currentUrl)) {
    return false;
  }
  if (browserViewResourceRecovery.inFlight) {
    console.warn('[BrowserView Resource Guard] 已在恢复中，跳过重复触发:', currentUrl);
    return true;
  }

  const targetUrl = resolveBrowserViewRecoveryTarget(preferredUrl);
  if (!targetUrl || targetUrl === currentUrl) {
    return false;
  }

  browserViewResourceRecovery = {
    inFlight: true,
    lastUrl: currentUrl,
    startedAt: Date.now()
  };

  console.warn(`[BrowserView Resource Guard] 检测到主窗口落到资源页，准备恢复 (${reason}): ${currentUrl} -> ${targetUrl}`);
  if (!startupLoadGuard.active) {
    beginRefreshLoadGuard('页面异常，正在恢复...');
  }

  try {
    const loadPromise = targetUrl.startsWith('file://')
      ? loadLocalPage(browserView.webContents, path.basename(targetUrl))
      : browserView.webContents.loadURL(targetUrl);
    await loadPromise;
    console.log('[BrowserView Resource Guard] ✅ 已恢复到目标页面:', targetUrl);
  } catch (error) {
    console.error('[BrowserView Resource Guard] ❌ 恢复失败:', error.message || error);
  } finally {
    setTimeout(() => {
      browserViewResourceRecovery.inFlight = false;
    }, 1500);
  }

  return true;
}

async function recoverBrowserViewFromSourceTextPage(reason = 'unknown', preferredUrl = '') {
  if (!browserView || !browserView.webContents || browserView.webContents.isDestroyed()) {
    return false;
  }

  const currentUrl = browserView.webContents.getURL();
  if (!isBrowserViewDocumentUrl(currentUrl)) {
    return false;
  }
  if (!isFirstPartyUrl(currentUrl) && !startupLoadGuard.active) {
    return false;
  }
  if (browserViewResourceRecovery.inFlight) {
    console.warn('[BrowserView Source Guard] 已在恢复中，跳过重复触发:', currentUrl);
    return true;
  }

  const sourceTextState = await inspectSourceTextDocument(browserView.webContents) || {};
  if (!sourceTextState.isSourceTextDocument) {
    if (browserViewResourceRecovery.lastUrl !== currentUrl) {
      browserViewResourceRecovery.sourceTextCount = 0;
    }
    return false;
  }

  const previousUrl = browserViewResourceRecovery.lastUrl;
  const previousCount = previousUrl === currentUrl ? (browserViewResourceRecovery.sourceTextCount || 0) : 0;
  if (previousCount >= 3) {
    console.warn(`[BrowserView Source Guard] ⚠️ 源码页恢复已达到上限，停止自动回跳: ${currentUrl}`);
    return false;
  }

  const preferredTargetUrl = resolveBrowserViewRecoveryTarget(preferredUrl);
  const targetUrl = preferredTargetUrl && preferredTargetUrl !== currentUrl
    ? preferredTargetUrl
    : getDefaultProjectHomeUrl();
  browserViewResourceRecovery = {
    inFlight: true,
    lastUrl: currentUrl,
    startedAt: Date.now(),
    sourceTextCount: previousCount + 1
  };

  console.warn(`[BrowserView Source Guard] 检测到主窗口显示源码文本，准备恢复 (${reason}): ${currentUrl} -> ${targetUrl}, state=${sourceTextState.reason}`);
  if (!startupLoadGuard.active) {
    beginRefreshLoadGuard('页面异常，正在恢复...');
  }

  try {
    await browserView.webContents.loadURL(targetUrl);
    console.log('[BrowserView Source Guard] ✅ 已恢复到目标页面:', targetUrl);
  } catch (error) {
    console.error('[BrowserView Source Guard] ❌ 恢复失败:', error.message || error);
  } finally {
    setTimeout(() => {
      browserViewResourceRecovery.inFlight = false;
    }, 1500);
  }

  return true;
}

function resolvePostRestoreUrl(preferredUrl) {
  const targetUrl = String(preferredUrl || '').trim();
  const isHttpUrl = targetUrl.startsWith('http://') || targetUrl.startsWith('https://');
  const isLoginLike = targetUrl.includes('login.html') || targetUrl.includes('#/login') || targetUrl.includes('/login');

  if (isHttpUrl && !isLoginLike) {
    return targetUrl;
  }

  return getDefaultProjectHomeUrl();
}

async function restoreLoginCookiesToSession(targetSession, savedToken, savedExpires) {
  await targetSession.cookies.set({
    url: 'http://localhost:5173/',
    name: 'token',
    value: savedToken,
    path: '/',
    expirationDate: savedExpires,
    secure: false,
    sameSite: 'lax'
  });
  await targetSession.cookies.set({
    url: 'http://localhost:5173/',
    name: 'access_token',
    value: savedToken,
    path: '/',
    expirationDate: savedExpires,
    secure: false,
    sameSite: 'lax'
  });

  await targetSession.cookies.set({
    url: config.getCookieUrl(),
    name: 'token',
    value: savedToken,
    domain: config.getCookieDomain(),
    path: '/',
    expirationDate: savedExpires,
    secure: true
  });
  await targetSession.cookies.set({
    url: config.getCookieUrl(),
    name: 'access_token',
    value: savedToken,
    domain: config.getCookieDomain(),
    path: '/',
    expirationDate: savedExpires,
    secure: true
  });

  if (globalStorage.login_gcc) {
    await targetSession.cookies.set({
      url: 'http://localhost:5173/',
      name: 'gcc',
      value: globalStorage.login_gcc,
      path: '/',
      expirationDate: savedExpires,
      secure: false,
      sameSite: 'lax'
    });
    await targetSession.cookies.set({
      url: config.getCookieUrl(),
      name: 'gcc',
      value: globalStorage.login_gcc,
      domain: config.getCookieDomain(),
      path: '/',
      expirationDate: savedExpires,
      secure: true
    });
  }

  const siteInfo = globalStorage.siteInfo;
  if (siteInfo && siteInfo.id) {
    const siteIdStr = String(siteInfo.id);
    await targetSession.cookies.set({ url: 'http://localhost:5173/', name: 'site_id', value: siteIdStr, path: '/', secure: false, sameSite: 'lax' });
    await targetSession.cookies.set({ url: 'http://localhost:8080/', name: 'site_id', value: siteIdStr, path: '/', secure: false, sameSite: 'lax' });
    await targetSession.cookies.set({ url: config.getCookieUrl(), name: 'site_id', value: siteIdStr, domain: config.getCookieDomain(), path: '/', secure: true });

    await targetSession.cookies.set({ url: 'http://localhost:5173/', name: 'china_site_id', value: siteIdStr, path: '/', secure: false, sameSite: 'lax' });
    await targetSession.cookies.set({ url: 'http://localhost:8080/', name: 'china_site_id', value: siteIdStr, path: '/', secure: false, sameSite: 'lax' });
    await targetSession.cookies.set({ url: config.getCookieUrl(), name: 'china_site_id', value: siteIdStr, domain: config.getCookieDomain(), path: '/', secure: true });

    console.log('[Auth Restore] ✅ site_id/china_site_id Cookie 已恢复:', maskSensitive(siteIdStr));
  }

  const userInfo = globalStorage.user_info;
  if (userInfo && userInfo.company && userInfo.company.unique_id) {
    const uniqueId = String(userInfo.company.unique_id);
    await targetSession.cookies.set({ url: 'http://localhost:5173/', name: 'company_unique_id', value: uniqueId, path: '/', secure: false, sameSite: 'lax' });
    await targetSession.cookies.set({ url: 'http://localhost:8080/', name: 'company_unique_id', value: uniqueId, path: '/', secure: false, sameSite: 'lax' });
    await targetSession.cookies.set({ url: config.getCookieUrl(), name: 'company_unique_id', value: uniqueId, domain: config.getCookieDomain(), path: '/', secure: true });

    await targetSession.cookies.set({ url: 'http://localhost:5173/', name: 'unique_id', value: uniqueId, path: '/', secure: false, sameSite: 'lax' });
    await targetSession.cookies.set({ url: 'http://localhost:8080/', name: 'unique_id', value: uniqueId, path: '/', secure: false, sameSite: 'lax' });
    await targetSession.cookies.set({ url: config.getCookieUrl(), name: 'unique_id', value: uniqueId, domain: config.getCookieDomain(), path: '/', secure: true });

    console.log('[Auth Restore] ✅ company_unique_id/unique_id Cookie 已恢复:', maskSensitive(uniqueId));
  }
}

async function tryRestoreLoginWithToken(preferredUrl) {
  if (loginRestorePromise) {
    console.log('[Auth Restore] ⏳ 登录恢复已在进行中，复用当前任务');
    return loginRestorePromise;
  }

  loginRestorePromise = (async () => {
    const savedToken = globalStorage.login_token;
    const savedExpires = Number(globalStorage.login_expires || 0);
    const now = Math.floor(Date.now() / 1000);

    if (!savedToken || !savedExpires || savedExpires <= now) {
      console.log('[Auth Restore] ℹ️ 未找到有效 token，跳过自动恢复');
      return false;
    }

    const targetSession = browserView?.webContents && !browserView.webContents.isDestroyed()
      ? browserView.webContents.session
      : persistentSession;

    if (!targetSession) {
      console.warn('[Auth Restore] ⚠️ Session 不可用，无法恢复登录状态');
      return false;
    }

    const resumeUrl = resolvePostRestoreUrl(preferredUrl);
    console.log('[Auth Restore] 开始使用本地 token 恢复登录状态:', resumeUrl);

    try {
      await restoreLoginCookiesToSession(targetSession, savedToken, savedExpires);
      await targetSession.flushStorageData();

      if (browserView?.webContents && !browserView.webContents.isDestroyed()) {
        await browserView.webContents.loadURL(resumeUrl);
      }

      console.log('[Auth Restore] ✅ 登录状态恢复成功');
      return true;
    } catch (error) {
      console.error('[Auth Restore] ❌ 登录状态恢复失败:', error);
      return false;
    }
  })();

  try {
    return await loginRestorePromise;
  } finally {
    loginRestorePromise = null;
  }
}

// 🔴 为 session 添加 Content-Type 修复拦截器（解决 CSS/JS 乱码问题）
// 仅在响应头缺失或明显错误时修正，避免把真实 HTML/文档页误判成代码资源
// ⚠️ 注意：不影响富文本编辑器，只处理脚本/样式静态资源
function addContentTypeFix(targetSession, label) {
  targetSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders || {};
    const ct = responseHeaders['content-type'] || responseHeaders['Content-Type'];
    const patchPlan = shouldApplyContentTypePatch(details);

    // 只修复脚本/样式资源，且仅在 Content-Type 缺失或明显错误时修正
    if (patchPlan.shouldPatch && shouldOverrideContentType(ct, patchPlan.mimeType)) {
      setResponseHeaderValue(responseHeaders, 'Content-Type', patchPlan.mimeType);
    }

    // 修复跨站 Set-Cookie 被屏蔽的问题：
    // Chromium 对缺少 SameSite 的 cookie 默认用 Lax，跨站请求时会被屏蔽
    // 自动补上 SameSite=None; Secure 使 cookie 能正常存储到对应域名
    const cookieKey = Object.keys(responseHeaders).find(k => k.toLowerCase() === 'set-cookie');
    if (cookieKey) {
      // 解析请求 URL 的 hostname，用于判断"自身域 .xxx" 应不应该去掉前导点
      let requestHostname = '';
      try {
        requestHostname = new URL(details.url || '').hostname.toLowerCase();
      } catch (_) {}

      responseHeaders[cookieKey] = responseHeaders[cookieKey].map(cookie => {
        if (!/SameSite/i.test(cookie)) {
          cookie += '; SameSite=None; Secure';
        }
        // 🔑 修复 cookie 重复存储：当 Set-Cookie 携带 Domain=.{当前请求主机} 时去掉整段 Domain 属性。
        // WeChat 视频号登录会同时下发：
        //   Set-Cookie: sessionid=A                              (无 Domain → host-only)
        //   Set-Cookie: sessionid=B; Domain=.channels.weixin.qq.com (domain-cookie，与 host-only 是两个存储项)
        // Chromium 以 (name, domain, host-only flag) 作为唯一键，两份并存，请求时同时发送，后端拿到旧的值 → "登录失败"。
        // 去掉 dot-prefix 自身域 Domain 属性后，Set-Cookie 退化为 host-only，与无 Domain 的版本合并成同一存储项，新值覆盖旧值。
        // 仅匹配 dot-domain 去点后等于当前请求 hostname 的情况，不影响真正的父域共享 cookie（如 Domain=.weixin.qq.com）。
        if (requestHostname) {
          cookie = cookie.replace(/;\s*Domain\s*=\s*\.([^;\s]+)/i, (match, dotDomain) => {
            const normalizedDomain = String(dotDomain).toLowerCase();
            return normalizedDomain === requestHostname ? '' : match;
          });
        }
        return cookie;
      });
    }

    callback({ responseHeaders });
  });
  console.log(`[Session] ✅ ${label} Content-Type 修复 + Set-Cookie SameSite 修复拦截器已添加`);
}

console.log('[Config] LOGIN_URL:', LOGIN_URL);

// 所有可能的首页地址（用于消息路由判断，从 config 集中配置构建）
const configuredHomeUrls = [];
if (config.DOMAINS) {
  ['dev', 'prod'].forEach((env) => {
    const envDomains = config.DOMAINS[env];
    if (!envDomains) return;
    if (envDomains.aigcPage && envDomains.aigcPath) {
      configuredHomeUrls.push(envDomains.aigcPage + envDomains.aigcPath);
    }
    if (envDomains.geoPage && envDomains.geoPath) {
      configuredHomeUrls.push(envDomains.geoPage + envDomains.geoPath);
    }
  });
}

const HOME_URLS = Array.from(new Set([
  'http://localhost:5173/',
  config.getAigcUrl(),             // AIGC 首页
  'http://172.16.6.17:8080/',
  'http://localhost:8080/',
  config.getGeoUrl(),              // GEO 首页
  LOGIN_URL,  // 登录页也作为首页处理
  ...configuredHomeUrls
].filter(Boolean)));

// 判断 URL 是否为首页
function isHomeUrl(url) {
  return HOME_URLS.some(homeUrl => url.startsWith(homeUrl));
}

function isToutiaoHost(hostname = '') {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  return host === 'toutiao.com' ||
         host.endsWith('.toutiao.com') ||
         host === 'toutiaostatic.com' ||
         host.endsWith('.toutiaostatic.com');
}

function isToutiaoUrl(rawUrl = '') {
  try {
    const parsed = new URL(rawUrl);
    return isToutiaoHost(parsed.hostname);
  } catch (_) {
    return false;
  }
}

function shouldSkipScriptInjection(url = '') {
  return FORCE_BARE_TOUTIAO && isToutiaoUrl(url);
}

const childWindows = []; // 跟踪所有打开的子窗口
const toutiaoBarePublishState = new Map();

function getStatisticsHostFromMainContext() {
  const context = getStatisticsContextFromMain();
  return context.host;
}

function getStatisticsContextFromMain() {
  const candidates = [
    browserView && !browserView.webContents.isDestroyed() ? browserView.webContents.getURL() : '',
    globalStorage.last_page_url || ''
  ];

  for (const rawUrl of candidates) {
    if (!rawUrl) continue;
    try {
      const parsed = new URL(rawUrl);
      return {
        url: rawUrl,
        host: parsed.host || ''
      };
    } catch (_) {}
  }

  return { url: '', host: '' };
}

function getMainStatisticsUrl(isError = false) {
  const endpoint = isError ? 'tjlogerror' : 'tjlog';
  const { url: currentUrl, host } = getStatisticsContextFromMain();
  const specialUrlMap = {
    'jzt_dev_1.china9.cn': `https://jzt_dev_1.china9.cn/api/geo/${endpoint}`,
    'zhjzt.china9.cn': `https://zhjzt.china9.cn/api/geo/${endpoint}`,
    '172.16.6.17:8080': `https://jzt_dev_1.china9.cn/api/geo/${endpoint}`,
    'localhost:8080': `https://jzt_dev_1.china9.cn/api/geo/${endpoint}`
  };

  if (host && specialUrlMap[host]) {
    return specialUrlMap[host];
  }

  if (currentUrl && (currentUrl.includes('/geo/') || currentUrl.includes('#/geo'))) {
    const devHosts = ['localhost:5173', '127.0.0.1:5173', 'dev.china9.cn', 'www.dev.china9.cn'];
    const isDev = devHosts.some(h => host.toLowerCase() === h);
    const geoDomain = isDev ? 'https://jzt_dev_1.china9.cn' : 'https://zhjzt.china9.cn';
    return `${geoDomain}/api/geo/${endpoint}`;
  }

  return `${config.getApiDomainUrl()}/api/mediaauth/${endpoint}`;
}

function sendMainStatisticsError(publishId, statusText, platform = '', extraContext = {}) {
  return new Promise((resolve) => {
    try {
      const { url: currentUrl, host } = getStatisticsContextFromMain();
      const url = getMainStatisticsUrl(true);
      const payload = {
        data: JSON.stringify({
          id: publishId || '',
          status_text: statusText || '发布失败',
          context: {
            platform: platform || 'unknown',
            timestamp: new Date().toISOString(),
            source: 'main-process',
            currentUrl,
            ...extraContext
          }
        })
      };

      console.log(`[${platform || '发布'}] 📤 主进程发送失败统计接口:`, {
        publishId: publishId || '',
        statusText,
        url,
        host
      });

      const request = net.request({
        method: 'POST',
        url
      });
      request.setHeader('Content-Type', 'application/json');
      request.on('response', (response) => {
        let body = '';
        response.on('data', chunk => { body += chunk.toString(); });
        response.on('end', () => {
          console.log(`[${platform || '发布'}] ✅ 主进程失败统计接口响应:`, {
            statusCode: response.statusCode,
            body: body.slice(0, 500)
          });
          resolve({ success: response.statusCode >= 200 && response.statusCode < 300, statusCode: response.statusCode, body });
        });
      });
      request.on('error', (error) => {
        console.error(`[${platform || '发布'}] ❌ 主进程失败统计接口请求失败:`, error);
        resolve({ success: false, error: error.message || String(error) });
      });
      request.write(JSON.stringify(payload));
      request.end();
    } catch (error) {
      console.error(`[${platform || '发布'}] ❌ 构造主进程失败统计接口请求失败:`, error);
      resolve({ success: false, error: error.message || String(error) });
    }
  });
}

function sendMainStatistics(publishId, platform = '', extraContext = {}) {
  return new Promise((resolve) => {
    try {
      const { url: currentUrl, host } = getStatisticsContextFromMain();
      const url = getMainStatisticsUrl(false);
      const payload = {
        data: JSON.stringify({
          id: publishId || '',
          context: {
            platform: platform || 'unknown',
            timestamp: new Date().toISOString(),
            source: 'main-process',
            currentUrl,
            ...extraContext
          }
        })
      };

      console.log(`[${platform || '发布'}] 📤 主进程发送成功统计接口:`, {
        publishId: publishId || '',
        url,
        host
      });

      const request = net.request({
        method: 'POST',
        url
      });
      request.setHeader('Content-Type', 'application/json');
      request.on('response', (response) => {
        let body = '';
        response.on('data', chunk => { body += chunk.toString(); });
        response.on('end', () => {
          console.log(`[${platform || '发布'}] ✅ 主进程成功统计接口响应:`, {
            statusCode: response.statusCode,
            body: body.slice(0, 500)
          });
          resolve({ success: response.statusCode >= 200 && response.statusCode < 300, statusCode: response.statusCode, body });
        });
      });
      request.on('error', (error) => {
        console.error(`[${platform || '发布'}] ❌ 主进程成功统计接口请求失败:`, error);
        resolve({ success: false, error: error.message || String(error) });
      });
      request.write(JSON.stringify(payload));
      request.end();
    } catch (error) {
      console.error(`[${platform || '发布'}] ❌ 构造主进程成功统计接口请求失败:`, error);
      resolve({ success: false, error: error.message || String(error) });
    }
  });
}

function firstNonEmptyValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
      continue;
    }
    if (Array.isArray(value)) {
      const nested = firstNonEmptyValue(...value);
      if (nested) return nested;
      continue;
    }
    if (typeof value === 'object') {
      const nested = firstNonEmptyValue(
        value.url,
        value.src,
        value.uri,
        value.href,
        value.origin,
        value.value,
        value.path,
        value.file_url
      );
      if (nested) return nested;
      continue;
    }
    return String(value);
  }
  return '';
}

function extractToutiaoCoverUrl(publishData = {}) {
  const element = publishData?.element || {};
  const video = publishData?.video?.video || {};
  const formData = publishData?.video?.formData || {};
  const sendlog = video?.sendlog || element?.sendlog || {};

  return firstNonEmptyValue(
    video.cover,
    video.cover_url,
    video.coverUrl,
    video.cover_uri,
    video.thumb_uri,
    video.thumb,
    video.thumb_url,
    video.poster,
    video.poster_url,
    video.url,
    formData.cover,
    formData.cover_url,
    formData.coverUrl,
    formData.cover_uri,
    formData.thumb_uri,
    formData.thumb_url,
    formData.url,
    element.cover,
    element.cover_url,
    element.coverUrl,
    element.cover_uri,
    element.thumb_uri,
    element.thumb_url,
    element.thumb,
    element.poster,
    element.poster_url,
    element.image,
    element.image_url,
    element.imageUrl,
    element.url,
    element.pic,
    element.pic_url,
    element.pics,
    element.images,
    element.covers,
    sendlog.cover,
    sendlog.cover_url,
    sendlog.coverUrl,
    sendlog.thumb_uri,
    sendlog.image,
    sendlog.images
  );
}

function extractToutiaoPublishPayload(publishData = {}) {
  return {
    rawTitle: publishData?.video?.video?.title || publishData?.element?.title || '',
    intro: publishData?.video?.video?.intro || publishData?.element?.intro || '',
    rawContent: publishData?.video?.video?.content || publishData?.element?.content || '',
    cover: extractToutiaoCoverUrl(publishData),
    sendSet: publishData?.video?.formData?.send_set ?? publishData?.element?.formData?.send_set ?? 1,
    sendTime: publishData?.video?.formData?.send_time || publishData?.video?.dyPlatform?.send_time || publishData?.element?.formData?.send_time || '',
    publishId: publishData?.video?.dyPlatform?.id || publishData?.element?.id || '',
    rawSendSet: publishData?.video?.formData?.send_set ?? publishData?.element?.formData?.send_set,
    rawSendTime: publishData?.video?.formData?.send_time || publishData?.video?.dyPlatform?.send_time || publishData?.element?.formData?.send_time || ''
  };
}

async function waitForToutiaoPublishData(windowId, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const publishData = getWindowPublishData(windowId);
    if (publishData) {
      return publishData;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return null;
}

const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB 限制

function downloadImageAsBase64(downloadUrl, redirectCount = 0) {
  return new Promise((resolve) => {
    if (!downloadUrl) {
      resolve({ success: false, error: 'No URL provided' });
      return;
    }

    if (redirectCount > 5) {
      resolve({ success: false, error: 'Too many redirects' });
      return;
    }

    const protocol = downloadUrl.startsWith('https') ? https : http;
    const request = protocol.get(downloadUrl, {
      headers: {
        'User-Agent': STANDARD_USER_AGENT
      }
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        let redirectUrl = response.headers.location;
        if (!redirectUrl.startsWith('http')) {
          const urlObj = new URL(downloadUrl);
          redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
        }
        resolve(downloadImageAsBase64(redirectUrl, redirectCount + 1));
        return;
      }

      if (response.statusCode !== 200) {
        resolve({ success: false, error: `HTTP error: ${response.statusCode}` });
        return;
      }

      const contentLength = parseInt(response.headers['content-length'], 10);
      if (contentLength && contentLength > MAX_IMAGE_SIZE) {
        response.destroy();
        resolve({ success: false, error: `File too large: ${Math.round(contentLength / 1024 / 1024)}MB` });
        return;
      }

      const chunks = [];
      let totalSize = 0;
      const contentType = response.headers['content-type'] || 'image/jpeg';

      response.on('data', (chunk) => {
        totalSize += chunk.length;
        if (totalSize > MAX_IMAGE_SIZE) {
          response.destroy();
          resolve({ success: false, error: `Download exceeded size limit: ${Math.round(totalSize / 1024 / 1024)}MB` });
          return;
        }
        chunks.push(chunk);
      });

      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          success: true,
          data: buffer.toString('base64'),
          contentType,
          size: buffer.length
        });
      });

      response.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });

    request.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    request.setTimeout(30000, () => {
      request.destroy();
      resolve({ success: false, error: 'Download timeout (30s)' });
    });
  });
}

function postMessageToHomePages(message) {
  const messageStr = JSON.stringify(message);
  console.log('[Toutiao Bare Publish] 📣 准备通知首页:', message);

  if (browserView && !browserView.webContents.isDestroyed()) {
    browserView.webContents.executeJavaScript(`
      (function() {
        const homeUrls = ${JSON.stringify(HOME_URLS)};
        const currentUrl = window.location.href;
        const isHome = homeUrls.some(url => currentUrl.startsWith(url));
        if (isHome) {
          console.log('[Toutiao Bare Publish] BrowserView 首页收到主进程转发:', ${messageStr});
          window.postMessage({ type: 'FROM_OTHER_PAGE', data: ${messageStr} }, '*');
        }
      })();
    `).catch(err => console.error('[Toutiao Bare Publish] Failed to notify BrowserView:', err));
  }

  childWindows.forEach((childWindow, index) => {
    if (childWindow && !childWindow.isDestroyed()) {
      childWindow.webContents.executeJavaScript(`
        (function() {
          const homeUrls = ${JSON.stringify(HOME_URLS)};
          const currentUrl = window.location.href;
          const isHome = homeUrls.some(url => currentUrl.startsWith(url));
          if (isHome) {
            console.log('[Toutiao Bare Publish] ChildWindow 首页收到主进程转发:', ${messageStr});
            window.postMessage({ type: 'FROM_OTHER_PAGE', data: ${messageStr} }, '*');
          }
        })();
      `).catch(err => console.error(`[Toutiao Bare Publish] Failed to notify child window ${index}:`, err));
    }
  });
}

function notifyToutiaoBarePublishFailure(data) {
  const payload = {
    type: 'toutiao-bare-publish-refresh',
    data: {
      ...data,
      refresh: true,
      message: '发布失败，刷新数据',
      timestamp: Date.now()
    }
  };
  console.log('[Toutiao Bare Publish] 🔄 发送失败刷新通知:', payload);
  postMessageToHomePages(payload);
  postMessageToHomePages('发布失败，刷新数据');
}

function notifyToutiaoBarePublishSuccess(data) {
  const payload = {
    type: 'toutiao-bare-publish-refresh',
    data: {
      ...data,
      refresh: true,
      message: '发布成功，刷新数据',
      timestamp: Date.now()
    }
  };
  console.log('[Toutiao Bare Publish] ✅ 发送成功刷新通知:', payload);
  postMessageToHomePages(payload);
  postMessageToHomePages('发布成功，刷新数据');
}

function writeMainDebugDump(prefix, content) {
  try {
    const prefixRaw = typeof prefix === 'string' ? prefix : 'debug';
    const safePrefix = prefixRaw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'debug';
    const dumpDir = path.join(app.getPath('userData'), 'debug-dumps');
    if (!fs.existsSync(dumpDir)) {
      fs.mkdirSync(dumpDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${safePrefix}-${timestamp}.json`;
    const filePath = path.join(dumpDir, fileName);
    const serialized = typeof content === 'string' ? content : JSON.stringify(content ?? null, null, 2);
    fs.writeFileSync(filePath, serialized, 'utf8');
    console.log('[Debug Dump] ✅ 主进程调试文件已写入:', filePath);
    return filePath;
  } catch (err) {
    console.error('[Debug Dump] ❌ 主进程调试文件写入失败:', err);
    return '';
  }
}

function buildToutiaoBarePublishScript(payload) {
  return `
    (async () => {
      const payload = ${JSON.stringify(payload)};
      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      const textOf = (el) => (el?.textContent || '').trim();
      const visible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return false;
        const style = window.getComputedStyle(el);
        if (!style) return true;
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity || '1') === 0) return false;
        return true;
      };
      const parsePlainTextFromHtml = (html) => {
        if (!html) return '';
        if (typeof html !== 'string') return String(html);
        if (!/[<>]/.test(html)) return html.trim();
        const temp = document.createElement('div');
        temp.innerHTML = html;
        return (temp.innerText || temp.textContent || '').trim();
      };
      const normalizeTitle = (title) => {
        const clean = String(title || '').trim();
        return clean || '测试文章';
      };
      const normalizeContent = (content, intro, title) => {
        const contentText = parsePlainTextFromHtml(content).trim();
        if (contentText) return contentText;
        const introText = parsePlainTextFromHtml(intro).trim();
        if (introText) return introText;
        return String(title || '测试文章').trim() || '测试文章';
      };
      const setNativeValue = (el, value) => {
        const proto = el.tagName.toLowerCase() === 'textarea'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        const prev = el.value;
        if (setter) setter.call(el, value);
        else el.value = value;
        if (el._valueTracker) el._valueTracker.setValue(prev);
      };
      const findTitleInput = () => {
        const selectors = [
          'textarea[placeholder*="请输入文章标题"]',
          'textarea[placeholder*="文章标题"]',
          'textarea[placeholder*="标题"]',
          'input[placeholder*="标题"]'
        ];
        for (const selector of selectors) {
          const list = Array.from(document.querySelectorAll(selector));
          const target = list.find(el => visible(el) && el.getBoundingClientRect().width > 120);
          if (target) return target;
          if (list[0]) return list[0];
        }
        return null;
      };
      const findEditor = () => {
        const list = Array.from(document.querySelectorAll('.ProseMirror, [contenteditable="true"]')).filter(el => !el.closest('input, textarea'));
        return list.find(visible) || list[0] || null;
      };
      const findButton = (matcher, allowHidden = false) => {
        const list = Array.from(document.querySelectorAll('button')).filter(btn => matcher(textOf(btn), btn));
        if (list.length === 0) return null;
        const target = list.find(visible);
        if (target) return target;
        return allowHidden ? list[0] : null;
      };
      const clickButton = (btn) => {
        if (!btn) return false;
        try { btn.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch (_) {}
        btn.click();
        return true;
      };
      const readToast = () => {
        const selectors = [
          '.byte-message-notice-content-text',
          '.byte-message-content',
          '.semi-toast-content-text',
          '.arco-message-content'
        ];
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          const text = textOf(el);
          if (text && text.length < 180) return text;
        }
        return '';
      };
      const findVisibleHint = () => {
        const selectors = [
          '.byte-form-item-help',
          '.byte-form-item-msg',
          '.byte-form-item-explain',
          '.byte-message-content',
          '.byte-message-notice-content-text',
          '.semi-toast-content-text',
          '.arco-message-content',
          '[class*="error"]',
          '[class*="hint"]',
          '[class*="tips"]'
        ];
        for (const selector of selectors) {
          const nodes = document.querySelectorAll(selector);
          for (const el of nodes) {
            if (!visible(el)) continue;
            const text = textOf(el);
            if (!text || text.length > 180) continue;
            if (/标题不能为空|还需输入|封面|失败|错误|请先|违规|超限|驳回/.test(text)) return text;
          }
        }
        return '';
      };
      const findCoverUploadError = () => {
        const selectors = [
          '.pic-select-image-item.size-err',
          '.pic-select-image-item .size-err',
          '.pic-select-image-item .error',
          '[class*="size-err"]',
          '[class*="image-item-error"]'
        ];
        for (const selector of selectors) {
          const nodes = document.querySelectorAll(selector);
          for (const el of nodes) {
            if (!visible(el)) continue;
            const text = textOf(el) || textOf(el.parentElement) || '';
            if (!text) continue;
            if (/尺寸过小|尺寸不足|图片过小|分辨率过低|上传失败|格式不支持|封面.*失败/.test(text)) {
              return text;
            }
          }
        }
        return '';
      };
      const isPreviewLayerVisible = () => {
        const signals = ['仅支持预览', '返回编辑', '确认发布', '立即发布'];
        return Array.from(document.querySelectorAll('button,div,span,p')).some(el => {
          if (!visible(el)) return false;
          const text = textOf(el);
          return text && signals.some(signal => text.includes(signal));
        });
      };
      const findVisibleButtonByText = (buttonText) => {
        return Array.from(document.querySelectorAll('button')).find(btn => visible(btn) && textOf(btn) === buttonText) || null;
      };
      const findFooterScheduleButton = () => {
        const selectors = [
          'button.publish-btn:not(.publish-btn-last)',
          'button[class*="publish-btn"]:not(.publish-btn-last):not([class*="publish-btn-last"])',
          '.publish-footer button:not(.publish-btn-last)',
          '.publish-footer-content button:not(.publish-btn-last)'
        ];
        for (const selector of selectors) {
          const list = Array.from(document.querySelectorAll(selector));
          const target = list.find(btn => visible(btn) && textOf(btn) === '定时发布');
          if (target) return target;
        }
        return findButton((t, btn) => {
          if (!visible(btn)) return false;
          const cls = (btn.className || '').toString();
          return t === '定时发布' && cls.includes('publish-btn') && !cls.includes('publish-btn-last');
        }, true);
      };
      const findScheduleModal = () => {
        return Array.from(document.querySelectorAll(
          '[role="dialog"], .byte-modal, .byte-modal-wrap, .byte-modal-content, [class*="picker"], [class*="calendar"], [class*="popover"]'
        )).find(el => {
          if (!visible(el)) return false;
          const titleEl = el.querySelector('.byte-modal-title');
          const titleText = textOf(titleEl) || textOf(el);
          return /(定时|发布时间|选择时间)/.test(titleText);
        }) || null;
      };
      const findModalButton = (modal, matcher) => {
        if (!modal) return null;
        const list = Array.from(modal.querySelectorAll('button'));
        return list.find(btn => visible(btn) && matcher(textOf(btn), btn)) || null;
      };
      const parseScheduleParts = (sendTime) => {
        const value = String(sendTime || '').trim();
        if (!value) return null;
        const normalized = value.replace(/\\//g, '-').replace('T', ' ');
        const match = normalized.match(/(\\d{4})-(\\d{1,2})-(\\d{1,2})\\s+(\\d{1,2}):(\\d{1,2})/);
        if (!match) return null;
        const month = Number(match[2]);
        const day = Number(match[3]);
        const hour = Number(match[4]);
        const minute = Number(match[5]);
        if ([month, day, hour, minute].some(Number.isNaN)) return null;
        return {
          dayText: String(month).padStart(2, '0') + '月' + String(day).padStart(2, '0') + '日',
          hourText: String(hour),
          minuteText: String(minute)
        };
      };
      const clickElement = (el) => {
        if (!el) return false;
        try { el.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch (_) {}
        try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } catch (_) {}
        try { el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch (_) {}
        try { el.click(); } catch (_) {}
        return true;
      };
      const findScheduleSelectTriggers = (modal) => {
        if (!modal) return [];
        const selectors = [
          '.byte-select-view',
          '.byte-select-trigger',
          '[class*="select"][class*="view"]',
          '[class*="select"][class*="trigger"]'
        ];
        for (const selector of selectors) {
          const list = Array.from(modal.querySelectorAll(selector)).filter(visible);
          if (list.length >= 3) return list.slice(0, 3);
        }
        const fallbacks = Array.from(modal.querySelectorAll('input, button, div, span')).filter(el => {
          if (!visible(el)) return false;
          const text = textOf(el);
          return /^\d{2}月\d{2}日$/.test(text) || /^\d{1,2}$/.test(text);
        });
        return fallbacks.slice(0, 3);
      };
      const pickDropdownOption = async (trigger, expectedText) => {
        if (!trigger || !expectedText) return false;
        clickElement(trigger);
        await delay(400);
        const findOption = () => {
          const selectors = [
            '.byte-select-option',
            '.byte-option',
            '[role="option"]',
            '.byte-dropdown-menu-item',
            '.byte-select-dropdown .byte-select-option-inner',
            '.byte-select-option-inner'
          ];
          for (const selector of selectors) {
            const list = Array.from(document.querySelectorAll(selector));
            const exact = list.find(el => visible(el) && textOf(el) === expectedText);
            if (exact) return exact;
          }
          const generic = Array.from(document.querySelectorAll('li, div, span, button')).find(el => {
            if (!visible(el)) return false;
            return textOf(el) === expectedText;
          });
          return generic || null;
        };
        const optionStart = Date.now();
        let option = null;
        while (Date.now() - optionStart < 5000) {
          option = findOption();
          if (option) break;
          await delay(200);
        }
        if (!option) return false;
        clickElement(option);
        await delay(500);
        return true;
      };
      const ensureCoverFile = async () => {
        if (!payload.coverData || !payload.coverContentType) {
          return null;
        }
        const binary = atob(payload.coverData);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        let ext = '.jpg';
        const contentType = String(payload.coverContentType || 'image/jpeg').toLowerCase();
        if (contentType.includes('png')) ext = '.png';
        if (contentType.includes('webp')) ext = '.webp';
        if (contentType.includes('gif')) ext = '.gif';
        if (contentType.includes('bmp')) ext = '.bmp';
        return new File([bytes], 'toutiao-cover' + ext, { type: payload.coverContentType });
      };
      const waitForCoverReady = async (timeoutMs = 12000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const coverError = findCoverUploadError();
          if (coverError) {
            return { ready: false, error: coverError };
          }
          const ready = !!document.querySelector(
            '.article-cover-images img, .article-cover img, [class*="cover"] img, .article-cover-images [class*="uploaded"], .article-cover-images [class*="image"]'
          ) || !!Array.from(document.querySelectorAll('.article-cover-images button, .article-cover button, .article-cover-images div'))
            .find(el => /编辑|替换|预览/.test(textOf(el)));
          if (ready) return { ready: true, error: '' };
          await delay(600);
        }
        return { ready: false, error: findCoverUploadError() };
      };
      const tryUploadCover = async (coverUrl, title) => {
        const coverRoot = document.querySelector('.article-cover, .pgc-edit-cell .edit-label');
        if (coverRoot && coverRoot.scrollIntoView) {
          coverRoot.scrollIntoView({ behavior: 'auto', block: 'center' });
          await delay(250);
        }
        const coverTrigger = Array.from(document.querySelectorAll('.article-cover-add, [class*="cover-add"]')).find(visible);
        if (!coverTrigger) return { ok: false, reason: 'cover-trigger-not-found' };
        coverTrigger.click();
        await delay(900);
        const fileInput = Array.from(document.querySelectorAll('input[type="file"]')).find(el => {
          const accept = (el.getAttribute('accept') || '').toLowerCase();
          return accept.includes('image') || accept.includes('png') || accept.includes('jpg') || accept === 'image/*';
        }) || document.querySelector('input[type="file"]');
        if (!fileInput) return { ok: false, reason: 'cover-file-input-not-found' };
        const file = await ensureCoverFile();
        if (!file) return { ok: false, reason: coverUrl ? 'cover-download-failed' : 'cover-missing' };
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        await delay(1200);
        const modalConfirmBtn = findButton((t) => t === '确定' || t === '完成' || t === '使用', true);
        if (modalConfirmBtn && !modalConfirmBtn.disabled) {
          clickButton(modalConfirmBtn);
          await delay(1000);
        }
        const coverState = await waitForCoverReady(12000);
        if (!coverState.ready) {
          return {
            ok: false,
            reason: coverState.error ? 'cover-invalid' : 'cover-not-ready',
            hint: coverState.error || findVisibleHint()
          };
        }
        return { ok: true };
      };
      const trySetSchedule = async (sendSet, sendTime) => {
        if (+sendSet !== 2 || !sendTime) return { ok: true, skipped: true };
        const scheduleParts = parseScheduleParts(sendTime);
        if (!scheduleParts) {
          return { ok: false, reason: 'schedule-time-invalid', hint: String(sendTime || '') };
        }
        const scheduleBtn = findFooterScheduleButton();
        if (!scheduleBtn) return { ok: false, reason: 'schedule-btn-not-found' };
        clickButton(scheduleBtn);
        await delay(900);

        const modalStart = Date.now();
        let scheduleModal = null;
        while (Date.now() - modalStart < 8000) {
          scheduleModal = findScheduleModal();
          if (scheduleModal) break;
          await delay(300);
        }
        if (!scheduleModal) return { ok: false, reason: 'schedule-modal-not-opened' };
        const triggers = findScheduleSelectTriggers(scheduleModal);
        if (triggers.length < 3) {
          return {
            ok: false,
            reason: 'schedule-select-trigger-not-found',
            hint: textOf(scheduleModal).slice(0, 200)
          };
        }

        const pickedDay = await pickDropdownOption(triggers[0], scheduleParts.dayText);
        const pickedHour = await pickDropdownOption(triggers[1], scheduleParts.hourText);
        const pickedMinute = await pickDropdownOption(triggers[2], scheduleParts.minuteText);
        if (!pickedDay || !pickedHour || !pickedMinute) {
          return {
            ok: false,
            reason: 'schedule-option-pick-failed',
            hint: JSON.stringify({
              expected: scheduleParts,
              pickedDay,
              pickedHour,
              pickedMinute
            })
          };
        }
        await delay(800);

        const confirmBtn = findModalButton(scheduleModal, (t) => {
          if (!t) return false;
          if (/取消|关闭|返回/.test(t)) return false;
          return t === '确定' || t === '确认' || t === '完成' || t === '发布' || t.includes('定时发布');
        });
        if (!confirmBtn || confirmBtn.disabled) {
          return {
            ok: false,
            reason: 'schedule-confirm-not-found',
            hint: textOf(scheduleModal).slice(0, 200)
          };
        }
        clickButton(confirmBtn);
        await delay(1000);
        return { ok: true, modal: true, confirmText: textOf(confirmBtn) };
      };

      const title = normalizeTitle(payload.rawTitle);
      const content = normalizeContent(payload.rawContent, payload.intro, title);
      const logs = [];
      const push = (step, extra = {}) => logs.push({ step, ...extra, ts: Date.now() });
      push('start', {
        href: location.href,
        title,
        cover: payload.cover || '',
        sendSet: payload.sendSet,
        sendTime: payload.sendTime,
        rawSendSet: payload.rawSendSet,
        rawSendTime: payload.rawSendTime
      });

      const readyStart = Date.now();
      let titleInput = null;
      let editor = null;
      while (Date.now() - readyStart < 120000) {
        titleInput = findTitleInput();
        editor = findEditor();
        if (titleInput && editor) break;
        await delay(1000);
      }
      if (!titleInput || !editor) {
        return { success: false, reason: 'editor-not-ready', href: location.href, logs };
      }

      titleInput.focus();
      setNativeValue(titleInput, title);
      try {
        titleInput.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true, cancelable: true, inputType: 'insertText', data: title
        }));
      } catch (_) {}
      titleInput.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: title
      }));
      titleInput.dispatchEvent(new Event('change', { bubbles: true }));
      titleInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      await delay(900);
      push('title-filled', { value: titleInput.value || '' });

      editor.focus();
      editor.innerHTML = '';
      for (const line of content.split('\\n').map(s => s.trim()).filter(Boolean)) {
        const p = document.createElement('p');
        p.textContent = line;
        editor.appendChild(p);
      }
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: content
      }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      editor.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      await delay(900);
      push('content-filled', { length: (editor.innerText || '').trim().length });

      const coverResult = await tryUploadCover(payload.cover, title);
      push('cover-finished', coverResult);
      if (!coverResult.ok) {
        return { success: false, reason: coverResult.reason || 'cover-failed', hint: coverResult.hint || '', href: location.href, logs };
      }

      const scheduleResult = await trySetSchedule(payload.sendSet, payload.sendTime);
      push('schedule-finished', scheduleResult);
      if (!scheduleResult.ok) {
        return { success: false, reason: scheduleResult.reason || 'schedule-failed', hint: scheduleResult.hint || '', href: location.href, logs };
      }
      if (+payload.sendSet === 2) {
        let schedulePreviewReady = false;
        for (let i = 0; i < 20; i++) {
          const backBtn = findVisibleButtonByText('返回编辑');
          const previewHint = isPreviewLayerVisible();
          const finalScheduleBtn = findVisibleButtonByText('定时发布');
          if ((backBtn || previewHint) && finalScheduleBtn && !finalScheduleBtn.disabled) {
            schedulePreviewReady = true;
            push('schedule-preview-ready', {
              attempt: i + 1,
              hasBackBtn: !!backBtn,
              previewHint,
              finalButtonText: textOf(finalScheduleBtn)
            });
            clickButton(finalScheduleBtn);
            push('schedule-final-clicked', { text: textOf(finalScheduleBtn), attempt: i + 1 });
            await delay(1200);
            break;
          }
          await delay(400);
        }
        if (!schedulePreviewReady) {
          return {
            success: false,
            reason: 'schedule-preview-not-ready',
            hint: findVisibleHint(),
            href: location.href,
            logs
          };
        }

        const scheduleWaitStart = Date.now();
        const scheduleTimeout = 80000;
        let lastToast = '';
        while (Date.now() - scheduleWaitStart < scheduleTimeout) {
          await delay(1200);
          const href = location.href;
          if (href.includes('/profile_v4/graphic/manage') || href.includes('/profile_v4/graphic/articles')) {
            return { success: true, reason: 'schedule-list-page', href, logs, publishId: payload.publishId };
          }
          const toast = readToast();
          if (toast) {
            lastToast = toast;
            if (/成功|已设置|已预约|定时/.test(toast) && !/失败|错误/.test(toast)) {
              return { success: true, reason: 'schedule-toast-success', toast, href, logs, publishId: payload.publishId };
            }
            if (/失败|错误|无效|请先|过期/.test(toast)) {
              return { success: false, reason: 'schedule-toast-error', toast, href, logs };
            }
          }
        }
        return { success: false, reason: 'schedule-result-timeout', toast: lastToast, href: location.href, logs };
      }

      let publishBtn = null;
      for (let i = 0; i < 8; i++) {
        publishBtn =
          findButton((t) => t === '预览并发布' || t === '发布' || t.includes('发布文章'), true) ||
          document.querySelector('button.publish-btn-last, button[class*="publish-btn-last"]');
        if (publishBtn && !publishBtn.disabled) break;
        await delay(600);
      }
      if (!publishBtn) {
        return { success: false, reason: 'publish-btn-not-found', hint: findVisibleHint(), href: location.href, logs };
      }

      clickButton(publishBtn);
      push('publish-clicked', { text: textOf(publishBtn) });
      await delay(1200);

      let previewReady = false;
      for (let i = 0; i < 20; i++) {
        const backBtn = findVisibleButtonByText('返回编辑');
        const previewHint = isPreviewLayerVisible();
        if (backBtn || previewHint) {
          previewReady = true;
          push('preview-ready', { attempt: i + 1, hasBackBtn: !!backBtn, previewHint });
          break;
        }
        await delay(400);
      }

      let secondConfirmed = false;
      for (let i = 0; i < 30; i++) {
        const confirmBtn = findVisibleButtonByText('确认发布') || findVisibleButtonByText('立即发布');
        if (confirmBtn && !confirmBtn.disabled) {
          clickButton(confirmBtn);
          push('secondary-confirm-clicked', { text: textOf(confirmBtn), attempt: i + 1 });
          secondConfirmed = true;
          await delay(1000);
          break;
        }
        await delay(400);
      }
      if (!secondConfirmed) {
        push('secondary-confirm-missing', { previewReady, hint: findVisibleHint() });
      }

      const resultStart = Date.now();
      const timeout = 80000;
      let lastToast = '';
      while (Date.now() - resultStart < timeout) {
        await delay(1200);
        const href = location.href;
        if (href.includes('/profile_v4/graphic/manage') || href.includes('/profile_v4/graphic/articles')) {
          return { success: true, reason: 'list-page', href, logs, publishId: payload.publishId };
        }
        const toast = readToast();
        if (toast) {
          lastToast = toast;
          if (/发布成功|提交成功|成功/.test(toast)) {
            return { success: true, reason: 'toast-success', toast, href, logs, publishId: payload.publishId };
          }
          if (/失败|错误|异常|不能为空|请先|违规|超限|驳回/.test(toast)) {
            return { success: false, reason: 'toast-failed', toast, href, logs, publishId: payload.publishId };
          }
        }
        const hint = findVisibleHint();
        if (hint) {
          return { success: false, reason: 'validation-hint', hint, href, logs, publishId: payload.publishId };
        }
      }

      return {
        success: false,
        reason: isPreviewLayerVisible() ? 'need-secondary-confirm' : 'timeout',
        toast: lastToast,
        hint: findVisibleHint(),
        href: location.href,
        logs,
        publishId: payload.publishId
      };
    })()
  `;
}

async function maybeRunBareToutiaoPublish(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
    return;
  }

  const currentURL = targetWindow.webContents.getURL();
  if (!shouldSkipScriptInjection(currentURL) || !currentURL.includes('/profile_v4/graphic/publish')) {
    return;
  }

  const windowId = targetWindow.id;
  const state = toutiaoBarePublishState.get(windowId);
  if (state === 'running' || state === 'done') {
    return;
  }

  toutiaoBarePublishState.set(windowId, 'running');
  try {
    const publishData = await waitForToutiaoPublishData(windowId, 15000);
    if (!publishData) {
      console.warn(`[Toutiao Bare Publish] ⚠️ 未找到窗口 ${windowId} 的发布数据`);
      toutiaoBarePublishState.set(windowId, 'idle');
      return;
    }

    const payload = extractToutiaoPublishPayload(publishData);
    if (payload.cover) {
      const coverDownload = await downloadImageAsBase64(payload.cover);
      if (!coverDownload.success) {
        await sendMainStatisticsError(payload.publishId || '', `封面下载失败: ${coverDownload.error || 'unknown error'}`, '头条发布', {
          reason: 'cover-download-failed',
          windowId,
          href: currentURL
        });
        console.error('[Toutiao Bare Publish] ❌ 封面下载失败:', {
          windowId,
          cover: payload.cover,
          error: coverDownload.error
        });
        postMessageToHomePages({
          type: 'toutiao-bare-publish-result',
          data: {
            windowId,
            success: false,
            reason: 'cover-download-failed',
            toast: '',
            hint: `封面下载失败: ${coverDownload.error || 'unknown error'}`,
            href: currentURL,
            publishId: payload.publishId || '',
            timestamp: Date.now()
          }
        });
        notifyToutiaoBarePublishFailure({
          windowId,
          publishId: payload.publishId || '',
          reason: 'cover-download-failed',
          hint: `封面下载失败: ${coverDownload.error || 'unknown error'}`,
          href: currentURL
        });
        toutiaoBarePublishState.set(windowId, 'failed');
        return;
      }
      payload.coverData = coverDownload.data;
      payload.coverContentType = coverDownload.contentType || 'image/jpeg';
      payload.coverSize = coverDownload.size || 0;
    }
    console.log('[Toutiao Bare Publish] 开始自动发布:', {
      windowId,
      title: payload.rawTitle,
      cover: payload.cover,
      coverSize: payload.coverSize || 0,
      sendSet: payload.sendSet,
      sendTime: payload.sendTime,
      rawSendSet: payload.rawSendSet,
      rawSendTime: payload.rawSendTime
    });
    writeMainDebugDump('toutiao-bare-before-run', {
      stage: 'before-run',
      windowId,
      currentURL,
      payload
    });

    const result = await targetWindow.webContents.executeJavaScript(buildToutiaoBarePublishScript(payload), true);
    console.log('[Toutiao Bare Publish] 执行结果:', { windowId, result });
    writeMainDebugDump('toutiao-bare-result', {
      stage: 'result',
      windowId,
      currentURL,
      payload,
      result
    });

    if (!result?.success) {
      const failureText = result?.hint || result?.toast || result?.reason || '发布失败';
      await sendMainStatisticsError(payload.publishId || '', failureText, '头条发布', {
        reason: result?.reason || 'bare-publish-failed',
        windowId,
        href: result?.href || currentURL
      });
      notifyToutiaoBarePublishFailure({
        windowId,
        publishId: payload.publishId || '',
        reason: result?.reason || 'bare-publish-failed',
        hint: result?.hint || '',
        toast: result?.toast || '',
        href: result?.href || currentURL
      });
    }

    postMessageToHomePages({
      type: 'toutiao-bare-publish-result',
      data: {
        windowId,
        success: !!result?.success,
        reason: result?.reason || '',
        toast: result?.toast || '',
        hint: result?.hint || '',
        href: result?.href || currentURL,
        publishId: payload.publishId || '',
        timestamp: Date.now()
      }
    });

    if (result?.success) {
      if (payload.publishId) {
        await sendMainStatistics(payload.publishId, '头条发布', {
          reason: result?.reason || 'bare-publish-success',
          windowId,
          href: result?.href || currentURL
        });
      }
      notifyToutiaoBarePublishSuccess({
        windowId,
        publishId: payload.publishId || '',
        reason: result?.reason || 'bare-publish-success',
        href: result?.href || currentURL
      });
      toutiaoBarePublishState.set(windowId, 'done');
      setTimeout(() => {
        if (!targetWindow.isDestroyed()) {
          targetWindow.close();
        }
      }, 1200);
      return;
    }

    toutiaoBarePublishState.set(windowId, 'failed');
  } catch (err) {
    console.error(`[Toutiao Bare Publish] ❌ 窗口 ${windowId} 自动发布失败:`, err);
    const currentURLForError = !targetWindow.isDestroyed() && !targetWindow.webContents.isDestroyed()
      ? targetWindow.webContents.getURL()
      : '';
    writeMainDebugDump('toutiao-bare-exception', {
      stage: 'exception',
      windowId,
      currentURL: currentURLForError,
      error: {
        message: err?.message || String(err),
        stack: err?.stack || ''
      }
    });
    await sendMainStatisticsError('', err?.message || '头条裸发布异常', '头条发布', {
      reason: 'bare-publish-exception',
      windowId,
      href: currentURLForError
    });
    notifyToutiaoBarePublishFailure({
      windowId,
      publishId: '',
      reason: 'bare-publish-exception',
      hint: err?.message || '头条裸发布异常',
      href: currentURLForError
    });
    toutiaoBarePublishState.set(windowId, 'failed');
  }
}

// ===========================
// 单实例锁定 - 确保只运行一个浏览器实例
// ===========================
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // 如果获取不到锁，说明已有实例在运行，退出当前实例
  console.log('[Single Instance] 检测到已有实例运行，退出当前实例');
  app.quit();
} else {
  // 当第二个实例启动时，聚焦到第一个实例的窗口
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('[Single Instance] 检测到第二个实例启动，聚焦到主窗口');
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// 在 app.whenReady() 之前注册自定义协议方案，使其可以被拦截
protocol.registerSchemesAsPrivileged([
  { scheme: 'bitbrowser', privileges: { standard: false, secure: false, bypassCSP: false, allowServiceWorkers: false, supportFetchAPI: false, corsEnabled: false } }
]);
console.log('[Protocol] 已注册 bitbrowser 协议方案');

// 优化：限制最大子窗口数量，防止内存泄漏
const MAX_CHILD_WINDOWS = 5;

// 优化：定期清理已销毁的窗口引用
function cleanupDestroyedWindows() {
  for (let i = childWindows.length - 1; i >= 0; i--) {
    if (!childWindows[i] || childWindows[i].isDestroyed()) {
      childWindows.splice(i, 1);
    }
  }
  console.log('[Window Manager] 清理后窗口数量:', childWindows.length);
}

// ===========================
// 自动更新功能
// ===========================

/**
 * 比较版本号
 * @param {string} v1 版本号1
 * @param {string} v2 版本号2
 * @returns {number} v1 > v2 返回 1，v1 < v2 返回 -1，相等返回 0
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

/**
 * 开发环境域名列表（从 config.js 集中配置）
 */
const DEV_HOSTS = config.DEV_HOSTS;

/**
 * 获取需要跳转到登录页的 URL 模式列表（从 config 集中配置构建）
 * @returns {string[]}
 */
function getLoginRedirectUrls() {
  const aigcDomain = config.domains.aigcPage.replace('https://', '').replace('http://', '');
  return [
    aigcDomain + '/#/home',
    'china9.cn/#/home',
    aigcDomain + '/aigc_browser/#/login',
    'china9.cn/aigc_browser/#/login',
    'localhost:5173/#/home',
    'localhost:5173/#/login',
    'localhost:8080/#/home',
    'localhost:8080/#/login'
  ];
}

/**
 * 根据域名判断是否为开发环境
 * @param {string} host - 域名
 * @returns {boolean}
 */
function isDevHost(host) {
  if (!host) return false;
  const h = host.toLowerCase();
  return DEV_HOSTS.some(devHost => h === devHost || h.endsWith('.' + devHost));
}

/**
 * 获取版本检查 API 地址（根据主窗口域名动态判断）
 * @returns {string} API URL
 */
function getVersionCheckUrl() {
  // 尝试从 browserView 获取当前 URL
  if (browserView && browserView.webContents) {
    try {
      const currentUrl = browserView.webContents.getURL();
      if (currentUrl) {
        const urlObj = new URL(currentUrl);
        if (isDevHost(urlObj.host)) {
          console.log('[Update] 检测到开发环境:', urlObj.host);
          if (useLocalDevServer) {
            console.log('[Update] 使用本地版本文件: http://localhost:5173/browserVersion.json');
            return 'http://localhost:5173/browserVersion.json';
          }
          return config.domains.versionCheckUrl;
        } else {
          console.log('[Update] 检测到生产环境:', urlObj.host);
          return config.domains.versionCheckUrl;
        }
      }
    } catch (e) {
      console.warn('[Update] 解析 URL 失败:', e);
    }
  }

  // 回退逻辑：根据打包状态判断
  return config.getVersionCheckUrlByEnv(isProduction);
}

/**
 * 检查更新
 * @returns {Promise<{hasUpdate: boolean, version?: string, url?: string, error?: string}>}
 */
async function checkForUpdate() {
  return new Promise((resolve) => {
    const versionUrl = getVersionCheckUrl();
    const isLocal = versionUrl.startsWith('http://localhost');
    const method = isLocal ? 'GET' : 'POST';
    console.log('[Update] 检查更新:', versionUrl, '方法:', method);

    const urlObj = new URL(versionUrl);
    const httpModule = urlObj.protocol === 'https:' ? https : http;

    const requestOptions = {
      method: method,
      timeout: 10000,
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    };

    // POST 请求需要设置 Content-Type
    if (!isLocal) {
      requestOptions.headers['Content-Type'] = 'application/json';
    }

    const req = httpModule.request(versionUrl, requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          console.log('[Update] 服务器响应:', result);

          if (result.code === 200 && result.data) {
            const remoteVersion = result.data.version;
            const downloadUrl = result.data.url;

            console.log(`[Update] 当前版本: ${APP_VERSION}, 服务器版本: ${remoteVersion}`);

            if (compareVersions(remoteVersion, APP_VERSION) > 0) {
              console.log('[Update] 发现新版本!');
              resolve({
                hasUpdate: true,
                version: remoteVersion,
                url: downloadUrl
              });
            } else {
              console.log('[Update] 已是最新版本');
              resolve({ hasUpdate: false });
            }
          } else {
            console.log('[Update] 响应格式错误:', result);
            resolve({ hasUpdate: false, error: '响应格式错误' });
          }
        } catch (err) {
          console.error('[Update] 解析响应失败:', err.message);
          resolve({ hasUpdate: false, error: err.message });
        }
      });
      res.on('error', (err) => {
        console.error('[Update] 响应流错误:', err.message);
        resolve({ hasUpdate: false, error: err.message });
      });
    });

    req.on('error', (err) => {
      console.error('[Update] 请求失败:', err.message);
      resolve({ hasUpdate: false, error: err.message });
    });

    req.on('timeout', () => {
      console.error('[Update] 请求超时');
      req.destroy();
      resolve({ hasUpdate: false, error: '请求超时' });
    });

    // http.request() 需要手动调用 end()（http.get() 会自动调用）
    req.end();
  });
}

/**
 * 显示更新对话框
 * @param {string} newVersion 新版本号
 * @param {string} downloadUrl 下载地址
 */
async function showUpdateDialog(newVersion, downloadUrl) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.log('[Update] 主窗口不可用，无法显示更新对话框');
    return;
  }

  console.log('[Update] 显示更新对话框, 新版本:', newVersion);

  const result = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    buttons: ['稍后更新', '立即下载'],
    defaultId: 1,
    cancelId: 0,
    title: '发现新版本',
    message: `发现新版本 v${newVersion}`,
    detail: `当前版本: v${APP_VERSION}\n新版本: v${newVersion}\n\n点击"立即下载"将在浏览器中打开下载链接。\n下载完成后请手动安装新版本。`
  });

  if (result.response === 1) {
    // 用户选择立即下载
    console.log('[Update] 用户选择下载, URL:', downloadUrl);

    // 使用系统默认浏览器打开下载链接
    shell.openExternal(downloadUrl);

    // 提示用户
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['确定'],
      title: '下载已开始',
      message: '下载链接已在浏览器中打开',
      detail: '下载完成后，请关闭当前程序并运行新版本安装包进行更新。'
    });
  } else {
    console.log('[Update] 用户选择稍后更新');
  }
}

/**
 * 启动时检查更新（延迟执行，避免影响启动速度）
 */
function scheduleUpdateCheck() {
  // 延迟 5 秒后检查更新，避免影响启动速度
  setTimeout(async () => {
    console.log('[Update] 开始检查更新...');
    const updateInfo = await checkForUpdate();

    if (updateInfo.hasUpdate && updateInfo.version && updateInfo.url) {
      await showUpdateDialog(updateInfo.version, updateInfo.url);
    }
  }, 5000);
}

// 简易文件日志（用于打包后调试 fetchSiteInfo）
const geoLogPath = path.join(app.getPath('userData'), 'geo-check.log');
function geoLog(msg) {
  const timestamp = new Date().toLocaleString('zh-CN');
  const line = `[${timestamp}] ${msg}\n`;
  console.log('[fetchSiteInfo]', msg);
  try { fs.appendFileSync(geoLogPath, line, 'utf8'); } catch (e) { /* ignore */ }
}

/**
 * 获取建站通站点信息（从服务器获取最新数据）
 * 每次导航到 GEO 页面前调用，确保 is_geo 状态为最新
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
async function fetchSiteInfo() {
  geoLog('🚀 开始获取站点信息...');
  const userInfo = globalStorage.user_info;
  const companyUniqueId = userInfo?.company?.unique_id;
  geoLog('company_unique_id: ' + (companyUniqueId || '无'));

  if (!companyUniqueId) {
    geoLog('⚠️ 无 company_unique_id，无法获取站点信息');
    return { success: false, error: '无 company_unique_id' };
  }

  const apiBaseUrl = config.domains.geoPage;
  const requestUrl = `${apiBaseUrl}/newapi/site/info?company_unique_id=${companyUniqueId}`;
  geoLog('🌐 请求: ' + requestUrl + ' (ENV=' + (config.CURRENT_ENV || config.ENV) + ')');

  // 使用 Electron net 模块发请求（走 Chromium 网络栈，与普通浏览器行为一致）
  // 手动从 persist:browserview session 获取 cookies 并附加到请求头
  async function doRequest() {
    // 先从 session 获取对应域名的 cookies
    const ses = session.fromPartition('persist:browserview');
    const urlObj = new URL(requestUrl);
    const domain = urlObj.hostname;
    let cookieString = '';
    try {
      const allCookies = await ses.cookies.get({});
      const domainCookies = allCookies.filter(cookie => {
        const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
        return cookieDomain.includes(domain) || domain.includes(cookieDomain);
      });
      cookieString = domainCookies.map(c => {
        const value = /[^\x00-\xff]/.test(c.value) ? encodeURIComponent(c.value) : c.value;
        return `${c.name}=${value}`;
      }).join('; ');
      geoLog('🍪 cookies: ' + domainCookies.length + ' 个, cookieString: ' + cookieString.substring(0, 200));
      // 同步发送到 renderer 控制台
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('main-log', '[fetchSiteInfo] 🍪 cookies: ' + domainCookies.length + ' 个, cookieString: ' + cookieString.substring(0, 200));
      }
    } catch (cookieErr) {
      geoLog('⚠️ 获取 cookies 失败: ' + cookieErr.message);
    }

    return new Promise((resolve) => {
      try {
        const request = net.request({
          method: 'GET',
          url: requestUrl,
          partition: 'persist:browserview'
        });

        request.setHeader('Accept', 'application/json, text/plain, */*');
        request.setHeader('User-Agent', 'Mozilla/5.0 zh.Cloud-browse');
        if (cookieString) {
          request.setHeader('Cookie', cookieString);
        }

        let responseData = '';
        let timeoutId = setTimeout(() => {
          geoLog('❌ 请求超时 (10秒)');
          request.abort();
          resolve({ success: false, error: '请求超时' });
        }, 10000);

        request.on('response', (response) => {
          geoLog('📥 响应状态码: ' + response.statusCode);
          response.on('data', (chunk) => {
            responseData += chunk.toString();
          });
          response.on('end', () => {
            clearTimeout(timeoutId);
            try {
              const result = JSON.parse(responseData);
              if (result.data) {
                resolve({ success: true, data: result.data });
              } else {
                geoLog('⚠️ 响应无 data 字段: ' + JSON.stringify(result).substring(0, 200));
                resolve({ success: false, error: '响应无 data 字段' });
              }
            } catch (err) {
              geoLog('❌ 解析响应失败: ' + err.message);
              resolve({ success: false, error: err.message });
            }
          });
        });

        request.on('error', (err) => {
          clearTimeout(timeoutId);
          geoLog('❌ 请求失败: ' + err.message);
          resolve({ success: false, error: err.message });
        });

        request.end();
      } catch (err) {
        geoLog('❌ 创建请求失败: ' + err.message);
        resolve({ success: false, error: err.message });
      }
    });
  }

  // 带重试逻辑：如果返回的 is_geo 为 null 且无 web_name，视为不完整数据，最多重试 2 次
  const MAX_RETRIES = 2;
  let lastResult = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      geoLog('🔄 第 ' + attempt + ' 次重试（上次返回 is_geo 为 null）...');
      await new Promise(r => setTimeout(r, 1000)); // 重试间隔 1 秒
    }

    lastResult = await doRequest();

    if (!lastResult.success) {
      geoLog('❌ 第 ' + (attempt + 1) + ' 次请求失败: ' + lastResult.error);
      continue;
    }

    const data = lastResult.data;
    geoLog('📦 第 ' + (attempt + 1) + ' 次响应: is_geo=' + data.is_geo + ', web_name=' + (data.web_name || '无') + ', id=' + (data.id || '无'));

    // 如果返回了完整数据（有 id 和 web_name），立即使用
    if (data.id && data.web_name) {
      geoLog('✅ 获取到完整站点数据');
      globalStorage.siteInfo = data;
      saveGlobalStorage();
      geoLog('💾 已更新 globalStorage.siteInfo');
      return { success: true, data: data };
    }

    // 如果 is_geo 不为 null（即明确为 0 或 1），也可以使用（可能是部分数据但权限字段有效）
    if (data.is_geo !== null && data.is_geo !== undefined) {
      geoLog('✅ is_geo 有明确值: ' + data.is_geo + '（数据不完整但权限字段有效）');
      globalStorage.siteInfo = data;
      saveGlobalStorage();
      geoLog('💾 已更新 globalStorage.siteInfo');
      return { success: true, data: data };
    }

    // is_geo 为 null 且无完整数据，继续重试
    geoLog('⚠️ 返回数据不完整 (is_geo=null, 无id/web_name)，可能命中了数据不全的节点');
  }

  // 所有重试完毕，使用最后一次的结果
  if (lastResult && lastResult.success) {
    geoLog('⚠️ 重试 ' + MAX_RETRIES + ' 次后仍返回不完整数据，使用最后一次结果');
    globalStorage.siteInfo = lastResult.data;
    saveGlobalStorage();
    return { success: true, data: lastResult.data };
  }

  geoLog('❌ 所有请求均失败');
  return lastResult || { success: false, error: '所有请求均失败' };
}

function createWindow() {
  // 使用 nativeImage 创建图标（支持高 DPI）
  const appIcon = nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));

  // 创建主窗口
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: '资海云运营助手',
    show: false, // 先隐藏窗口，等内容准备好再显示
    autoHideMenuBar: isProduction, // 生产环境自动隐藏菜单栏
    backgroundColor: '#f2f7fa', // 设置背景色避免白闪
    icon: appIcon, // 使用 nativeImage 加载的图标
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      backgroundThrottling: false // 禁用后台节流，防止长时间不操作页面空白
    }
  });
  attachSessionDiagnosticWebContents(mainWindow.webContents, 'main-window');

  // 窗口准备好后立即显示
  let windowShown = false;
  const showWindow = () => {
    if (!windowShown) {
      windowShown = true;
      mainWindow.show();
    }
  };
  mainWindow.once('ready-to-show', showWindow);
  // 保险措施：最多等待 2 秒后强制显示
  setTimeout(showWindow, 2000);

  // 为主窗口打开开发者工具（用于调试控制面板）
  // mainWindow.webContents.openDevTools();

  // 加载浏览器控制界面
  // 🔑 用 .catch 兜底：loadFile 失败时（特殊路径/符号链接/中文路径）改用 pathToFileURL 正确编码的 file:// 重试，避免白屏或 CSS 渲染成文字
  mainWindow.loadFile('index.html').catch(err => {
    console.warn('[mainWindow] index.html loadFile 失败，改用 pathToFileURL 兜底:', err && err.message);
    mainWindow.loadURL(require('url').pathToFileURL(path.join(__dirname, 'index.html')).href);
  });
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('browser-loading-state', browserLoadingState);
  });

  // 监听窗口即将关闭事件，保存 session 数据
  mainWindow.on('close', async (e) => {
    if (!isQuitting) {
      e.preventDefault();
      isQuitting = true;
      beginShutdown('main-window-close');

      console.log('========================================');
      console.log('[Window Close] 窗口关闭，正在保存 Session 数据...');

      if (browserView) {
        try {
          // 🔑 只保存项目类型（aigc/geo），不保存具体页面URL
          const currentUrl = browserView.webContents.getURL();
          if (currentUrl && !currentUrl.includes('login.html')) {
            // 判断是哪个项目
            if (currentUrl.includes('aigc_browser') || currentUrl.includes('localhost:5173')) {
              globalStorage.last_project = 'aigc';
              console.log('[Window Close] 💾 记录项目类型: aigc');
            } else if (currentUrl.includes('jzt_all') || currentUrl.includes('geo') ||
                       currentUrl.includes('localhost:8080') || currentUrl.includes('172.16.6.17:8080')) {
              globalStorage.last_project = 'geo';
              console.log('[Window Close] 💾 记录项目类型: geo');
            } else {
              // 第三方平台页面，不记录
              console.log('[Window Close] 第三方平台页面，不记录项目类型');
            }
            // 清除旧的 last_page_url（如果存在）
            delete globalStorage.last_page_url;
          } else {
            // 如果在登录页退出，不保存
            delete globalStorage.last_project;
            delete globalStorage.last_page_url;
            console.log('[Window Close] 在登录页退出，不保存项目类型');
          }
          saveGlobalStorage();

          const ses = browserView.webContents.session;
          const cookies = await ses.cookies.get({});
          console.log(`[Window Close] 当前共有 ${cookies.length} 个 cookies`);

          // 将所有会话 Cookie 转换为持久化 Cookie（设置 1 年过期时间）
          const oneYearFromNow = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);
          let convertedCount = 0;

          for (const cookie of cookies) {
            if (cookie.session) {
              // 会话 Cookie，需要转换为持久化 Cookie
              const persistentCookie = buildCookieSetDetails(cookie, oneYearFromNow);
              await ses.cookies.set(persistentCookie);
              convertedCount++;
            }
          }

          console.log(`[Window Close] ✅ 转换了 ${convertedCount} 个会话 Cookie 为持久化 Cookie`);

          await ses.flushStorageData();
          console.log('[Window Close] ✅ Session 数据已写入磁盘');
          if (isPortable) {
            console.log(`[Window Close] 💾 便携版数据已保存到: ${app.getPath('userData')}`);
          }
          console.log('========================================');
        } catch (err) {
          console.error('[Window Close] ❌ 保存 Session 数据失败:', err);
        }
      }

      setTimeout(() => {
        mainWindow.destroy();
      }, 200); // 给更多时间确保数据写入磁盘
    }
  });

  // 获取或创建持久化 session（禁用 HTTP 缓存，只保留 cookies 和 storage）
  const persistentSession = session.fromPartition('persist:browserview', { cache: false });

  // 持久化 session 已禁用 HTTP 缓存，启动期不再额外清理 cache/code cache。
  // 之前的清理动作会在部分 Windows 机器上触发磁盘缓存异常，反而放大首屏白屏概率。
  const clearCachePromise = Promise.resolve().then(() => {
    console.log('[Session] ℹ️ 已跳过启动期缓存清理，首屏恢复改由启动守卫负责');
  });

  // 在 session 级别拦截自定义协议和主框架静态资源误导航
  installSessionRequestGuard(persistentSession, '持久化 session', {
    blockBitbrowser: true,
    blockMainFrameResources: true
  });

  // 🔴 修复外部页面 CSS/JS 乱码
  addContentTypeFix(persistentSession, '持久化 session');

  // 打印 session 存储路径
  console.log('========================================');
  console.log('[Session] Session 配置信息:');
  console.log('[Session] userData 路径:', app.getPath('userData'));
  console.log('[Session] Session 存储路径:', persistentSession.getStoragePath());
  console.log('[Session] 是否便携版:', isPortable);
  if (isPortable) {
    console.log('[Session] 💾 便携版模式 - 数据将保存到应用程序目录');
  }
  console.log('========================================');

  // 默认浏览器 UA 保持应用标识；只在命中抖音窗口时临时切标准 UA。
  const customUA = TAGGED_USER_AGENT;
  persistentSession.setUserAgent(customUA);
  console.log('User-Agent set to:', customUA);

  // 监听下载事件
  persistentSession.on('will-download', (event, item, webContents) => {
    const url = item.getURL();
    const filename = item.getFilename();
    console.log('[Download] 开始下载:', url);
    console.log('[Download] 文件名:', filename);

    // 让用户选择保存位置（使用默认文件名）
    const savePath = dialog.showSaveDialogSync(mainWindow, {
      title: '保存文件',
      defaultPath: filename,
      filters: [
        { name: '所有文件', extensions: ['*'] }
      ]
    });

    if (savePath) {
      item.setSavePath(savePath);
      console.log('[Download] 保存到:', savePath);

      item.on('updated', (event, state) => {
        if (state === 'progressing') {
          if (!item.isPaused()) {
            const received = item.getReceivedBytes();
            const total = item.getTotalBytes();
            const percent = total > 0 ? Math.round(received / total * 100) : 0;
            console.log(`[Download] 进度: ${percent}% (${received}/${total})`);
          }
        }
      });

      item.once('done', (event, state) => {
        if (state === 'completed') {
          console.log('[Download] ✅ 下载完成:', savePath);
          dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '下载完成',
            message: '文件下载成功',
            detail: `保存位置: ${savePath}`,
            buttons: ['确定']
          });
        } else {
          console.log('[Download] ❌ 下载失败:', state);
          dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: '下载失败',
            message: '文件下载失败',
            detail: `状态: ${state}`,
            buttons: ['确定']
          });
        }
      });
    } else {
      // 用户取消了保存
      console.log('[Download] 用户取消保存');
      item.cancel();
    }
  });

  // 创建 BrowserView 用于显示网页内容
  browserView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'content-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // 禁用沙箱以支持 window.opener
      webSecurity: false, // 禁用跨域限制，允许下载外部视频资源
      session: persistentSession, // 直接使用 session 对象
      backgroundThrottling: false, // 禁用后台节流，防止视频被暂停
      autoplayPolicy: 'no-user-gesture-required' // 允许自动播放视频
    }
  });
  attachSessionDiagnosticWebContents(browserView.webContents, 'browser-view');
  browserView.webContents.setUserAgent(TAGGED_USER_AGENT);
  console.log('BrowserView User-Agent set to:', TAGGED_USER_AGENT);

  // 设置背景色避免白屏
  browserView.setBackgroundColor('#f2f7fa');

  browserView.webContents.on('did-start-loading', () => {
    if (startupLoadGuard.active) {
      const text = startupLoadGuard.reloadCount > 0 ? '页面加载较慢，正在恢复...' : '正在加载页面...';
      setBrowserLoadingState({ visible: true, text });
      return;
    }

    if (refreshLoadGuard.active) {
      setBrowserLoadingState({ visible: true, text: '正在刷新页面...' });
    }
  });

  browserView.webContents.on('did-stop-loading', () => {
    if (startupLoadGuard.active) {
      scheduleStartupReadinessCheck('did-stop-loading', 700);
      return;
    }

    if (refreshLoadGuard.active) {
      scheduleRefreshReadinessCheck('did-stop-loading', 400);
    }
  });

  // 🔍 P3: 渲染进程崩溃监听 - 方便远程排查白屏问题
  browserView.webContents.on('render-process-gone', (event, details) => {
    console.error('[BrowserView] ❌ 渲染进程已退出！');
    console.error('[BrowserView] 退出原因:', details.reason);
    console.error('[BrowserView] 退出码:', details.exitCode);
    if (details.reason !== 'killed') {
      (async () => {
        const result = await showPageErrorDialog({
          title: '页面异常',
          message: '页面渲染进程异常退出，是否尝试恢复？',
          detail: `原因: ${details.reason} 退出码: ${details.exitCode}`
        });
        if (result.response === 0) {
          try {
            browserView.webContents.reload();
          } catch (err) {
            console.error('[BrowserView] ❌ 重新加载失败:', err);
          }
        } else if (result.response === 1) {
          await navigateToLoginInternal('render_process_gone');
        }
      })();
    }
  });

  browserView.webContents.on('did-fail-load', async (event, errorCode, errorDescription, validatedURL) => {
    console.error('[BrowserView] ❌ 页面加载失败！');
    console.error('[BrowserView] 错误码:', errorCode);
    console.error('[BrowserView] 错误描述:', errorDescription);
    console.error('[BrowserView] 失败 URL:', validatedURL);
    if (errorCode === -3) return; // 忽略导航中止
    if (startupLoadGuard.active && retryStartupLoad(`did-fail-load ${errorCode}: ${errorDescription}`)) {
      return;
    }
    finishStartupLoadGuard('did-fail-load');
    const result = await showPageErrorDialog({
      title: '页面加载失败',
      message: '页面加载失败，是否重试？',
      detail: `错误码: ${errorCode} 描述: ${errorDescription}`
    });
    if (result.response === 0) {
      try {
        browserView.webContents.reload();
      } catch (err) {
        console.error('[BrowserView] ❌ 重试加载失败:', err);
      }
    } else if (result.response === 1) {
      await navigateToLoginInternal('did_fail_load');
    }
  });

  browserView.webContents.on('unresponsive', () => {
    console.warn('[BrowserView] ⚠️ 页面无响应！');
  });

  browserView.webContents.on('responsive', () => {
    console.log('[BrowserView] ✅ 页面已恢复响应');
  });

  mainWindow.setBrowserView(browserView);
  updateBrowserViewBounds();

  // ========== 定期心跳，保持页面活跃 ==========
  // 防止 Chromium 长时间不操作时对页面进行后台节流
  const HEARTBEAT_INTERVAL = 30 * 1000; // 每 30 秒发送一次心跳
  heartbeatInterval = setInterval(async () => {
    if (!browserView || browserView.webContents.isDestroyed()) return;
    if (browserView.webContents.isLoading()) return;
    const currentUrl = browserView.webContents.getURL();
    if (!currentUrl || currentUrl === 'about:blank') return;

    try {
      // 执行一个简单的 JavaScript 代码，保持页面活跃
      // 这会防止 Chromium 对页面进行后台节流
      await browserView.webContents.executeJavaScript(`
        (function() {
          // 更新一个全局变量，标记页面仍然活跃
          window.__browserHeartbeat__ = Date.now();
          // 触发一个自定义事件，让页面知道浏览器仍在监控
          const event = new CustomEvent('__browser_heartbeat__', { detail: { timestamp: Date.now() } });
          document.dispatchEvent(event);
        })()
      `, true);

      console.log('[BrowserView] 💓 心跳信号已发送，保持页面活跃');
    } catch (err) {
      console.warn('[BrowserView] ⚠️ 心跳信号发送失败:', err.message);
    }
  }, HEARTBEAT_INTERVAL);

  mainWindow.on('closed', () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    clearStartupLoadGuardTimer();
  });

  // 监听窗口大小变化
  mainWindow.on('resize', () => {
    updateBrowserViewBounds(isScriptPanelOpen);
  });

  // 等待 BrowserView 完全附加到窗口后再加载 URL
  // 使用 process.nextTick 确保 BrowserView 已经完全准备好
  process.nextTick(async () => {
    console.log('=== 首页加载开始 ===');
    console.log(`[BrowserView] isProduction: ${isProduction}`);

    console.log('[BrowserView] 启动期缓存清理已改为后台执行，不阻塞首页');
    clearCachePromise.catch(() => {});

    // 检查是否有保存的登录 token
    const savedToken = globalStorage.login_token;
    const savedExpires = globalStorage.login_expires;
    const now = Math.floor(Date.now() / 1000);

    let startUrl = LOGIN_URL;

    if (savedToken && savedExpires && savedExpires > now) {
      // 有有效的 token，恢复 Cookie 并跳转到首页
      console.log('[BrowserView] 发现有效的登录 token，正在恢复登录状态...');
      console.log('[BrowserView] Token 过期时间:', new Date(savedExpires * 1000).toLocaleString());

      try {
        // 恢复 Cookie 到 session
        const ses = persistentSession;

        // 为 localhost 设置 Cookie
        await ses.cookies.set({
          url: 'http://localhost:5173/',
          name: 'token',
          value: savedToken,
          path: '/',
          expirationDate: savedExpires,
          secure: false,
          sameSite: 'lax'
        });
        await ses.cookies.set({
          url: 'http://localhost:5173/',
          name: 'access_token',
          value: savedToken,
          path: '/',
          expirationDate: savedExpires,
          secure: false,
          sameSite: 'lax'
        });

        // 为 .china9.cn 设置 Cookie
        await ses.cookies.set({
          url: config.getCookieUrl(),
          name: 'token',
          value: savedToken,
          domain: config.getCookieDomain(),
          path: '/',
          expirationDate: savedExpires,
          secure: true
        });
        await ses.cookies.set({
          url: config.getCookieUrl(),
          name: 'access_token',
          value: savedToken,
          domain: config.getCookieDomain(),
          path: '/',
          expirationDate: savedExpires,
          secure: true
        });

        // 恢复 gcc Cookie（如果有）
        if (globalStorage.login_gcc) {
          await ses.cookies.set({
            url: 'http://localhost:5173/',
            name: 'gcc',
            value: globalStorage.login_gcc,
            path: '/',
            expirationDate: savedExpires,
            secure: false,
            sameSite: 'lax'
          });
          await ses.cookies.set({
            url: config.getCookieUrl(),
            name: 'gcc',
            value: globalStorage.login_gcc,
            domain: config.getCookieDomain(),
            path: '/',
            expirationDate: savedExpires,
            secure: true
          });
        }

        // 恢复 site_id、china_site_id、company_unique_id、unique_id Cookie
        const siteInfo = globalStorage.siteInfo;
        const userInfo = globalStorage.user_info;
        if (siteInfo && siteInfo.id) {
          const siteIdStr = String(siteInfo.id);
          // site_id
          await ses.cookies.set({ url: 'http://localhost:5173/', name: 'site_id', value: siteIdStr, path: '/', secure: false, sameSite: 'lax' });
          await ses.cookies.set({ url: 'http://localhost:8080/', name: 'site_id', value: siteIdStr, path: '/', secure: false, sameSite: 'lax' });
          await ses.cookies.set({ url: config.getCookieUrl(), name: 'site_id', value: siteIdStr, domain: config.getCookieDomain(), path: '/', secure: true });
          // china_site_id
          await ses.cookies.set({ url: 'http://localhost:5173/', name: 'china_site_id', value: siteIdStr, path: '/', secure: false, sameSite: 'lax' });
          await ses.cookies.set({ url: 'http://localhost:8080/', name: 'china_site_id', value: siteIdStr, path: '/', secure: false, sameSite: 'lax' });
          await ses.cookies.set({ url: config.getCookieUrl(), name: 'china_site_id', value: siteIdStr, domain: config.getCookieDomain(), path: '/', secure: true });
          console.log('[BrowserView] ✅ site_id/china_site_id Cookie 已恢复:', maskSensitive(siteIdStr));
        }
        if (userInfo && userInfo.company && userInfo.company.unique_id) {
          const uniqueId = String(userInfo.company.unique_id);
          // company_unique_id
          await ses.cookies.set({ url: 'http://localhost:5173/', name: 'company_unique_id', value: uniqueId, path: '/', secure: false, sameSite: 'lax' });
          await ses.cookies.set({ url: 'http://localhost:8080/', name: 'company_unique_id', value: uniqueId, path: '/', secure: false, sameSite: 'lax' });
          await ses.cookies.set({ url: config.getCookieUrl(), name: 'company_unique_id', value: uniqueId, domain: config.getCookieDomain(), path: '/', secure: true });
          // unique_id
          await ses.cookies.set({ url: 'http://localhost:5173/', name: 'unique_id', value: uniqueId, path: '/', secure: false, sameSite: 'lax' });
          await ses.cookies.set({ url: 'http://localhost:8080/', name: 'unique_id', value: uniqueId, path: '/', secure: false, sameSite: 'lax' });
          await ses.cookies.set({ url: config.getCookieUrl(), name: 'unique_id', value: uniqueId, domain: config.getCookieDomain(), path: '/', secure: true });
          console.log('[BrowserView] ✅ company_unique_id/unique_id Cookie 已恢复:', maskSensitive(uniqueId));
        }

        await ses.flushStorageData();
        console.log('[BrowserView] ✅ 登录状态已恢复');

        // 🔑 根据上次退出的项目类型，跳转到对应首页
        const savedProject = globalStorage.last_project;
        if (savedProject === 'geo') {
          // 直接跳转到 geo 首页，不检查权限
          startUrl = config.getGeoUrl();
          console.log('[BrowserView] 📍 恢复到 geo 项目首页:', startUrl);
        } else {
          // 默认 aigc 项目首页
          startUrl = config.getAigcUrl();
          console.log('[BrowserView] 📍 恢复到 aigc 项目首页:', startUrl);
        }
      } catch (err) {
        console.error('[BrowserView] ❌ 恢复登录状态失败:', err);
        startUrl = LOGIN_URL;
      }
    } else {
      console.log('[BrowserView] 没有有效的登录 token，显示登录页');
      if (savedToken && savedExpires) {
        console.log('[BrowserView] Token 已过期，过期时间:', new Date(savedExpires * 1000).toLocaleString());
        // 清除过期的 token
        delete globalStorage.login_token;
        delete globalStorage.login_expires;
        delete globalStorage.login_gcc;
        saveGlobalStorage();
        await showSessionExpiredDialog('启动校验');
      }
    }

    console.log(`[BrowserView] 准备加载: ${startUrl}`);
    console.log('===================');

    // 根据初始 URL 设置头部显示状态
    isHeaderHidden = startUrl.includes('login.html');
    updateBrowserViewBounds(isScriptPanelOpen);

    // 🔴 本地文件使用 loadFile，远程URL使用 loadURL（避免 file:// MIME 类型问题）
    let loadPage;
    if (startUrl.startsWith('file://')) {
      loadPage = loadLocalPage(browserView.webContents, path.basename(startUrl));
    } else {
      loadPage = browserView.webContents.loadURL(startUrl);
    }

    beginStartupLoadGuard(startUrl);

    loadPage
      .then(() => {
        console.log('[BrowserView] ✅ 页面加载调用成功');
        scheduleStartupReadinessCheck('loadPage.then', 1000);
      })
      .catch(async err => {
        console.error('[BrowserView] ❌ 页面加载失败:', err);
        if (startupLoadGuard.active && retryStartupLoad(`initial-load failed: ${err.message || err}`)) {
          return;
        }

        finishStartupLoadGuard('initial-load-failed');
        const result = await showPageErrorDialog({
          title: '页面加载失败',
          message: '启动页加载失败，是否重试？',
          detail: err.message || String(err)
        });

        if (result.response === 0) {
          beginStartupLoadGuard(startUrl);
          const retryLoad = startUrl.startsWith('file://')
            ? loadLocalPage(browserView.webContents, path.basename(startUrl))
            : browserView.webContents.loadURL(startUrl);
          retryLoad.catch(e => {
            console.error('[BrowserView] ❌ 重试失败:', e);
          });
        } else if (result.response === 1) {
          await navigateToLoginInternal('load_page_failed_startup');
        }
      });
  });

  // 脚本注入函数（提取为公共函数，可复用）
  const injectScriptForUrl = async (webContents, url, retryCount = 0) => {
    // 检查 webContents 是否已销毁
    if (!webContents || webContents.isDestroyed()) {
      return;
    }

    // 获取窗口 ID 用于调试
    const windowId = webContents.id;
    const isNewWindow = !childWindows.some(win => win?.webContents?.id === windowId) && browserView?.webContents?.id !== windowId;

    console.log('==================================================');
    console.log(`[Script Injection] Window ID: ${windowId} ${isNewWindow ? '(New Window)' : '(Main/BrowserView)'}`);
    console.log('[Script Injection] Checking URL:', url);
    if (shouldSkipScriptInjection(url)) {
      console.log('[Script Injection] Skip for Toutiao URL:', url);
      return;
    }

    // 页面状态预检查脚本 - 检测CSS代码是否被当作文本显示
    // 如果异常，保持隐藏状态；如果正常，移除预防性隐藏样式
    const pageCheckScript = `
      (function() {
        if (!document.body) return { ready: false, reason: 'no body' };

        // 🔑 跳过包含富文本编辑器的页面（TinyMCE, CKEditor, Quill, wangEditor 等）
        const richEditorSelectors = [
          '.tiny-textarea', '.tox', '.tox-tinymce', '.mce-container', '.mce-content-body',
          '.ck-editor', '.ck-content', '[data-tiny-editor]',
          '.ql-editor', '.ql-container', '.quill',
          '.w-e-text', '.w-e-toolbar', '[data-wangeditor]',
          '.CodeMirror', '.monaco-editor',
          '[contenteditable="true"]',
          'iframe[id*="editor"]', 'iframe[id*="tinymce"]'
        ];
        const hasRichEditor = richEditorSelectors.some(sel => document.querySelector(sel));

        // 🔑 检查 URL 路径，跳过可能包含编辑器的页面
        const editorPaths = ['/edit', '/editor', '/publish', '/create', '/write', '/article', '/content'];
        const isEditorPage = editorPaths.some(p => window.location.pathname.includes(p) || window.location.hash.includes(p));

        if (hasRichEditor || isEditorPage) {
          console.log('[Page Check] 检测到富文本编辑器或编辑页面，跳过CSS检测');
          const preHideStyle = document.getElementById('__pre_hide_style__');
          if (preHideStyle) preHideStyle.remove();
          if (document.body) {
            document.body.style.visibility = '';
            document.body.style.opacity = '';
          }
          return { ready: true, reason: 'editor-detected' };
        }

        const bodyText = document.body.innerText || '';
        const cssPatterns = [
          'text-decoration:none',
          'background-color:transparent',
          'cursor:pointer',
          'border-radius:',
          'display:block',
          'position:absolute',
          ':hover{',
          '@media '
        ];

        let cssMatchCount = 0;
        for (const pattern of cssPatterns) {
          if (bodyText.includes(pattern)) cssMatchCount++;
        }

        if (cssMatchCount >= 3) {
          // 页面异常，保持隐藏状态，添加遮罩 + loading动画
          if (!document.getElementById('__page_loading_mask__')) {
            const mask = document.createElement('div');
            mask.id = '__page_loading_mask__';
            mask.innerHTML = '<style>@keyframes __loading_spin__{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style><div style="width:40px;height:40px;border:3px solid #f3f3f3;border-top:3px solid #3498db;border-radius:50%;animation:__loading_spin__ 1s linear infinite;"></div>';
            mask.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#fff;z-index:999999;display:flex;align-items:center;justify-content:center;';
            document.documentElement.appendChild(mask);
          }

          return { ready: false, reason: 'css-as-text', matchCount: cssMatchCount };
        }

        // 页面正常，移除预防性隐藏样式
        const preHideStyle = document.getElementById('__pre_hide_style__');
        if (preHideStyle) preHideStyle.remove();
        if (document.body) {
          document.body.style.visibility = '';
          document.body.style.opacity = '';
        }

        return { ready: true };
      })()
    `;

    // 🔑 页面状态检测 - 只在登录页和首页检测 CSS 渲染异常
    // 其他页面（可能包含富文本编辑器）跳过检测，避免白屏问题
    const safeCheckUrls = ['login.html', '/#/', '/aigc_browser/', '/jzt_all/', 'localhost:5173/', 'localhost:8080/'];
    const shouldCheckPage = safeCheckUrls.some(pattern => url.includes(pattern)) &&
                            !url.includes('/edit') && !url.includes('/publish') &&
                            !url.includes('/create') && !url.includes('/article');

    if (shouldCheckPage) {
      try {
        // 先检查页面状态
        const pageState = await webContents.executeJavaScript(pageCheckScript);

        if (!pageState.ready) {
          console.log(`[Script Injection] ⚠️ 页面状态异常: ${pageState.reason}，已隐藏页面内容`);

          // 最多重试2次，每次间隔1.5秒，然后刷新
          if (retryCount < 2) {
            console.log(`[Script Injection] ⏳ ${1.5}秒后重试 (第${retryCount + 1}次)...`);
            setTimeout(() => {
              injectScriptForUrl(webContents, url, retryCount + 1);
            }, 1500);
            return;
          } else {
            console.log('[Script Injection] ❌ 页面持续异常，刷新页面...');
            webContents.reload();
            return;
          }
        }
      } catch (checkErr) {
        // 检查脚本执行失败，可能页面还没准备好
        if (!checkErr.message.includes('destroyed')) {
          console.log('[Script Injection] ⚠️ 页面检查失败:', checkErr.message);
          if (retryCount < 2) {
            setTimeout(() => {
              injectScriptForUrl(webContents, url, retryCount + 1);
            }, 1000);
            return;
          }
        }
      }
    }

    // 注入公共头（已移至浏览器级别 index.html，不再每页注入）
    // 保留此注释以便将来参考，公共头现在固定在 index.html 中，不会随页面切换而闪烁

    // 注入对应的自定义脚本
    const script = await scriptManager.getScript(url);

    if (script) {
      // 再次检查（异步操作后可能已销毁）
      if (webContents.isDestroyed()) {
        return;
      }
      console.log('[Script Injection] Script found! Total length:', script.length);
      console.log('[Script Injection] Preview:', script.substring(0, 150) + '...');
      console.log('✅ [Script Injection] Executing...');
      try {
        const result = await webContents.executeJavaScript(script);
        console.log('✅ [Script Injection] Script executed successfully!');
        console.log('[Script Injection] Execution result:', result);
      } catch (err) {
        // 忽略窗口销毁导致的错误
        if (!err.message.includes('destroyed')) {
          console.error('❌ [Script Injection] Script execution error:', err);
        }
      }
    } else {
      // 没有脚本时，只显示简单的调试信息
      console.log('ℹ️ [Script Injection] No script configured for this URL');
    }
    console.log('==================================================');
  };

  // BrowserView 的脚本注入函数
  const injectScriptForCurrentPage = async () => {
    // 检查 webContents 是否已销毁
    if (!browserView || browserView.webContents.isDestroyed()) {
      return;
    }
    const currentURL = browserView.webContents.getURL();
    console.log(`[Navigation] 页面加载完成 → ${currentURL}`);
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send('url-changed', currentURL);
    await injectScriptForUrl(browserView.webContents, currentURL);
  };

  // 拦截导航请求，阻止自定义协议（如 bitbrowser://）触发系统对话框
  browserView.webContents.on('will-navigate', (event, url) => {
    if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
      console.log('[Navigation] ❌ Blocked non-http protocol:', url);
      event.preventDefault();
    }
  });

  // 拦截 iframe 导航请求，阻止自定义协议
  browserView.webContents.on('will-frame-navigate', (event) => {
    const url = event.url;
    if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
      console.log('[Frame Navigation] ❌ Blocked non-http protocol:', url);
      event.preventDefault();
    }
  });

  // 预防性隐藏脚本 - 在导航开始时立即隐藏页面，防止用户看到异常内容
  const preHideScript = `
    (function() {
      // 立即注入隐藏样式（比 DOM 操作更早生效）
      if (!document.getElementById('__pre_hide_style__')) {
        const style = document.createElement('style');
        style.id = '__pre_hide_style__';
        style.textContent = 'body { visibility: hidden !important; opacity: 0 !important; }';
        document.head ? document.head.appendChild(style) : document.documentElement.appendChild(style);
      }
    })()
  `;

  // 🔑 记录跳转到无权限页面前的 URL（用于保持 header 选中状态）
  let lastValidUrl = null;
  let pendingNavigationUrl = null;  // 记录用户点击的原始目标 URL

  // 监听用户点击链接（在导航开始前触发，可捕获原始目标 URL）
  browserView.webContents.on('will-navigate', (event, url) => {
    console.log(`[Navigation] 用户点击链接 → ${url}`);
    if (shouldSkipScriptInjection(url)) {
      console.log('[Navigation] 🧼 主 BrowserView 命中 Toutiao，改为裸窗口打开:', url);
      event.preventDefault();
      pendingNavigationUrl = null;
      setImmediate(async () => {
        const result = await openManagedChildWindow(url);
        if (!result.success) {
          console.error('[Navigation] ❌ 打开 Toutiao 裸窗口失败:', result.error);
        }
      });
      return;
    }
    if (shouldRecoverBrowserViewResourceUrl(url)) {
      console.warn('[Navigation] ⚠️ 阻止主窗口跳转到静态资源页:', url);
      event.preventDefault();
      recoverBrowserViewFromResourcePage(url, 'will-navigate', lastValidUrl).catch(err => {
        console.error('[Navigation] ❌ 静态资源页恢复失败:', err);
      });
      return;
    }
    // 记录用户点击的目标 URL（即使会被重定向）
    if (isBrowserViewDocumentUrl(url)) {
      pendingNavigationUrl = url;
    }
  });

  // 监听 hash 路由变化（Vue 前端路由跳转）
  browserView.webContents.on('did-navigate-in-page', (event, url) => {
    console.log(`[Navigation] Hash 路由变化 → ${url}`);
    // 记录 hash 路由变化的 URL（前端路由跳转到的目标页面）
    if (isBrowserViewDocumentUrl(url)) {
      pendingNavigationUrl = url;
      lastValidUrl = url;
    }
  });

  // 监听页面导航开始
  browserView.webContents.on('did-start-navigation', (event, url) => {
    console.log(`[Navigation] 导航开始 → ${url}`);

    // 🔑 提前拦截 account.china9.cn/login，阻止页面显示
    if (url.includes(config.domains.authRedirect + '/login')) {
      console.log('[Navigation] ⚠️ 检测到统一登录页，停止导航');
      console.log('[Navigation] pendingNavigationUrl:', pendingNavigationUrl);
      console.log('[Navigation] lastValidUrl:', lastValidUrl);

      // 延迟执行，避免在导航事件中直接触发新导航导致浏览器崩溃
      setImmediate(() => {
        if (browserView && !browserView.webContents.isDestroyed()) {
          // 优先使用 pendingNavigationUrl（用户点击的原始目标），其次使用 lastValidUrl
          const urlToSend = pendingNavigationUrl || lastValidUrl;

          // 根据目标 URL 判断系统类型，传递给 not-available.html
          let systemParam = 'aigc';
          if (urlToSend) {
            const urlLower = urlToSend.toLowerCase();
            if (urlLower.includes(':8080') ||
                urlLower.includes('/geo/') ||
                urlLower.includes('/jzt_all/') ||
                urlLower.includes('jzt_dev')) {
              systemParam = 'geo';
            }
          }
          console.log('[Navigation] 系统类型:', systemParam);

          // 加载占位页，带上 system 参数
          browserView.webContents.loadFile(path.join(__dirname, config.placeholderPages.notAuth), { query: { system: systemParam } });

          // 🔑 发送目标页面 URL 给 renderer，保持 header 选中状态
          if (mainWindow && !mainWindow.isDestroyed() && urlToSend) {
            console.log('[Navigation] 发送 URL 到 renderer:', urlToSend);
            mainWindow.webContents.send('url-changed', urlToSend);
          }
        }
        // 清空 pendingNavigationUrl
        pendingNavigationUrl = null;
      });
      return;
    }

    // 记录有效的 URL（排除本地文件和特殊页面）
    if (isBrowserViewDocumentUrl(url)) {
      lastValidUrl = url;
    }
    // 清空 pendingNavigationUrl（导航成功开始）
    pendingNavigationUrl = null;

    // 【已禁用】预防性隐藏脚本 - 会导致 TinyMCE 白屏且对 CSS 渲染异常无效
    // if (browserView && !browserView.webContents.isDestroyed()) {
    //   browserView.webContents.executeJavaScript(preHideScript).catch(() => {});
    // }
  });

  // 监听页面导航完成
  browserView.webContents.on('did-navigate', async (event, url) => {
    console.log(`[Navigation] 导航完成 → ${url}`);
    if (shouldRecoverBrowserViewResourceUrl(url)) {
      const recovered = await recoverBrowserViewFromResourcePage(url, 'did-navigate', lastValidUrl);
      if (recovered) {
        return;
      }
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('url-changed', url);
    // 根据 URL 判断是否需要隐藏公共头部
    updateHeaderVisibility(url);

    // 🔑 检查是否是需要跳转登录页的特定 URL
    const loginRedirectUrls = getLoginRedirectUrls();

    // account.china9.cn/login 已在 did-start-navigation 中提前拦截

    const shouldRedirectToLogin = loginRedirectUrls.some(pattern => url.includes(pattern));
    if (shouldRedirectToLogin) {
      console.log('[Auth Check] ⚠️ 检测到登录/首页重定向URL');
      if (!isNavigatingToLogin) {
        // 先尝试用本地 token 恢复登录（避免 PHP session 过期时误清还有效的 token）
        const restored = await tryRestoreLoginWithToken(lastValidUrl);
        if (!restored) {
          console.log('[Auth Check] Token 无效，跳转到本地登录页');
          await navigateToLoginInternal('login_redirect_url');
        }
      }
      return;
    }

    // 🔑 检查登录状态（Cookie 中的 token, access_token, PHPSESSID）
    // 排除：登录页、本地文件、第三方平台授权页、正在跳转登录页
    if (isNavigatingToLogin) return;
    const shouldCheckAuth = url.startsWith('http://') || url.startsWith('https://');
    const isLoginPage = url.includes('login.html') || url.includes('/login');
    const isLocalFile = url.startsWith('file://');
    const isThirdPartyAuth = url.includes('douyin.com') || url.includes('xiaohongshu.com') ||
                             url.includes('baidu.com') || url.includes('weixin.qq.com') ||
                             url.includes('channels.weixin.qq.com');

    if (shouldCheckAuth && !isLoginPage && !isLocalFile && !isThirdPartyAuth) {
      try {
        const ses = browserView.webContents.session;
        const cookies = await ses.cookies.get({});

        // 检查必要的 Cookie 是否存在
        // 注意：只检查 token 和 access_token，不检查 PHPSESSID
        // PHPSESSID 是服务器端设置的会话 Cookie，首次访问时还没有
        const hasToken = cookies.some(c => c.name === 'token' && c.value);
        const hasAccessToken = cookies.some(c => c.name === 'access_token' && c.value);

        console.log(`[Auth Check] token: ${hasToken}, access_token: ${hasAccessToken}`);

        if (!hasToken || !hasAccessToken) {
          console.log('[Auth Check] ⚠️ 缺少登录凭证，跳转到登录页');
          // 清除过期的登录信息
          delete globalStorage.login_token;
          delete globalStorage.login_expires;
          delete globalStorage.login_gcc;
          saveGlobalStorage();
          // 跳转到登录页（通过 navigateToLoginInternal 统一走防重入逻辑）
          await navigateToLoginInternal('cookie_missing');
          return;
        }
      } catch (err) {
        console.error('[Auth Check] 检查 Cookie 失败:', err);
      }
    }
  });

  // 🔑 监听页面 DOM 准备完成（刷新页面时也会触发）
  browserView.webContents.on('dom-ready', async () => {
    if (startupLoadGuard.active) {
      scheduleStartupReadinessCheck('dom-ready', 800);
    } else if (refreshLoadGuard.active) {
      scheduleRefreshReadinessCheck('dom-ready', 500);
    }

    const url = browserView.webContents.getURL();
    console.log(`[DOM Ready] 页面准备完成 → ${url}`);

    const recoveredSourceText = await recoverBrowserViewFromSourceTextPage('dom-ready', lastValidUrl);
    if (recoveredSourceText) {
      return;
    }

    // 🔑 检查是否是需要跳转登录页的特定 URL
    const loginRedirectUrls = getLoginRedirectUrls();

    // account.china9.cn/login 已在 did-start-navigation 中提前拦截

    const shouldRedirectToLogin = loginRedirectUrls.some(pattern => url.includes(pattern));
    if (shouldRedirectToLogin) {
      console.log('[Auth Check - DOM Ready] ⚠️ 检测到登录/首页重定向URL');
      if (!isNavigatingToLogin) {
        const restored = await tryRestoreLoginWithToken(lastValidUrl);
        if (!restored) {
          console.log('[Auth Check - DOM Ready] Token 无效，跳转到本地登录页');
          await navigateToLoginInternal('login_redirect_dom_ready');
        }
      }
      return;
    }

    // 检查登录状态（与 did-navigate 相同的逻辑）
    // 正在跳转登录页时跳过
    if (isNavigatingToLogin) return;
    const shouldCheckAuth = url.startsWith('http://') || url.startsWith('https://');
    const isLoginPage = url.includes('login.html') || url.includes('/login');
    const isLocalFile = url.startsWith('file://');
    const isThirdPartyAuth = url.includes('douyin.com') || url.includes('xiaohongshu.com') ||
                             url.includes('baidu.com') || url.includes('weixin.qq.com') ||
                             url.includes('channels.weixin.qq.com');

    if (shouldCheckAuth && !isLoginPage && !isLocalFile && !isThirdPartyAuth) {
      try {
        const ses = browserView.webContents.session;
        const cookies = await ses.cookies.get({});

        const hasToken = cookies.some(c => c.name === 'token' && c.value);
        const hasAccessToken = cookies.some(c => c.name === 'access_token' && c.value);

        console.log(`[Auth Check - DOM Ready] token: ${hasToken}, access_token: ${hasAccessToken}`);

        if (!hasToken || !hasAccessToken) {
          console.log('[Auth Check - DOM Ready] ⚠️ 缺少登录凭证，跳转到登录页');
          await navigateToLoginInternal('cookie_missing_dom_ready');
          return;
        }
      } catch (err) {
        console.error('[Auth Check - DOM Ready] 检查 Cookie 失败:', err);
      }
    }
  });

  // 页面异常检测脚本（在 dom-ready 时尽早执行）
  const earlyPageCheckScript = `
    (function() {
      // 延迟一小段时间等待内容渲染
      setTimeout(() => {
        if (!document.body) return;

        // 跳过包含富文本编辑器的页面（TinyMCE, CKEditor 等）
        const hasRichEditor = document.querySelector('.tiny-textarea, .tox, .tox-tinymce, .mce-container, .ck-editor, [data-tiny-editor]');
        if (hasRichEditor) {
          console.log('[Early Check] 检测到富文本编辑器，跳过CSS检测');
          const preHideStyle = document.getElementById('__pre_hide_style__');
          if (preHideStyle) preHideStyle.remove();
          if (document.body) {
            document.body.style.visibility = '';
            document.body.style.opacity = '';
          }
          return;
        }

        const bodyText = document.body.innerText || '';
        const cssPatterns = [
          'text-decoration:none',
          'background-color:transparent',
          'cursor:pointer',
          'border-radius:',
          'display:block',
          'position:absolute',
          ':hover{',
          '@media '
        ];

        let cssMatchCount = 0;
        for (const pattern of cssPatterns) {
          if (bodyText.includes(pattern)) cssMatchCount++;
        }

        if (cssMatchCount >= 3) {
          console.error('[Early Check] 检测到页面渲染异常，准备刷新页面');
          // 保持隐藏状态，添加 loading 遮罩
          if (!document.getElementById('__page_loading_mask__')) {
            const mask = document.createElement('div');
            mask.id = '__page_loading_mask__';
            mask.innerHTML = '<style>@keyframes __loading_spin__{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style><div style="width:40px;height:40px;border:3px solid #f3f3f3;border-top:3px solid #3498db;border-radius:50%;animation:__loading_spin__ 1s linear infinite;"></div>';
            mask.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#fff;z-index:999999;display:flex;align-items:center;justify-content:center;';
            document.documentElement.appendChild(mask);
          }
          // 1.5秒后刷新页面
          setTimeout(() => window.location.reload(), 1500);
        } else {
          // 页面正常，移除预防性隐藏样式，显示页面
          console.log('[Early Check] 页面渲染正常，显示页面');
          const preHideStyle = document.getElementById('__pre_hide_style__');
          if (preHideStyle) preHideStyle.remove();
          // 确保 body 可见
          if (document.body) {
            document.body.style.visibility = '';
            document.body.style.opacity = '';
          }
        }
      }, 100); // 增加延迟到100ms，确保内容渲染完成
    })()
  `;

  // 【临时禁用】在 dom-ready 时尽早检测页面状态（比 did-finish-load 更早）
  // browserView.webContents.on('dom-ready', () => {
  //   console.log('[Navigation] DOM Ready，执行早期页面检测...');
  //   if (browserView && !browserView.webContents.isDestroyed()) {
  //     browserView.webContents.executeJavaScript(earlyPageCheckScript).catch(() => {});
  //   }
  // });

  // 监听页面内导航（如 hash 变化）- 单页应用路由切换
  browserView.webContents.on('did-navigate-in-page', async (event, url) => {
    console.log(`[Navigation] 页面内跳转 → ${url}`);
    if (!mainWindow || mainWindow.isDestroyed()) return;

    // 检测自己平台登录页（含 dev/prod 远程域名 + 本地 localhost），尝试恢复登录或跳转到本地登录页
    const isOwnLoginInPage =
        (url.includes('china9.cn') ||
         url.includes('localhost:5173') ||
         url.includes('localhost:8080')) &&
        url.includes('#/login');
    if (isOwnLoginInPage) {
      console.log('[Navigation] 🔄 检测到自己平台登录页(in-page)');
      if (!isNavigatingToLogin) {
        const restored = await tryRestoreLoginWithToken(lastValidUrl);
        if (!restored) {
          console.log('[Navigation] Token 无效，跳转到本地登录页');
          await navigateToLoginInternal('remote_login_in_page');
        }
      }
      return;
    }

    // 🔑 检测 token 有效性（登录检查优先于权限检查）
    // 仅在访问自己平台时检测，不影响第三方平台
    // 正在跳转登录页时跳过
    if (isNavigatingToLogin) return;
    const isOwnPlatform = url.includes('china9.cn') || url.includes('localhost:5173') || url.includes('localhost:8080');
    if (isOwnPlatform && !url.includes('login.html') && !url.includes('#/login')) {
      const savedToken = globalStorage.login_token;
      const savedExpires = globalStorage.login_expires;
      const now = Math.floor(Date.now() / 1000);

      if (!savedToken || !savedExpires || savedExpires <= now) {
        console.log('[Navigation] ⚠️ Token 无效或已过期，跳转到登录页...');
        if (!isHandlingExpiredToken) {
          isHandlingExpiredToken = true;
          await showSessionExpiredDialog('页面内跳转');
          await navigateToLoginInternal('token_expired_in_page');
          setTimeout(() => { isHandlingExpiredToken = false; }, 2000);
        }
        return;
      }
    }

    mainWindow.webContents.send('url-changed', url);
    // 根据 URL 判断是否需要隐藏公共头部
    updateHeaderVisibility(url);
    console.log('[SPA Navigation] Hash/path changed, injecting script...');
    // 单页应用路由切换时也需要注入脚本
    await injectScriptForCurrentPage();
  });

  browserView.webContents.on('did-finish-load', async () => {
    if (startupLoadGuard.active) {
      scheduleStartupReadinessCheck('did-finish-load', 900);
    } else if (refreshLoadGuard.active) {
      scheduleRefreshReadinessCheck('did-finish-load', 500);
    }

    await recoverBrowserViewFromSourceTextPage('did-finish-load', lastValidUrl);
  });

  // 监听页面加载完成，注入自定义脚本
  browserView.webContents.on('did-finish-load', injectScriptForCurrentPage);

  // 监听完整页面导航，检测远程登录页和 GEO 权限
  // 注意：token 有效性检查已统一在上方的 async did-navigate handler 中处理，这里不再重复检测
  browserView.webContents.on('did-navigate', async (event, url) => {
    console.log(`[Navigation] 页面导航(补充检测) → ${url}`);

    // 检测远程登录页，尝试恢复登录或跳转到本地登录页
    if (url.includes('dev.china9.cn/aigc_browser/#/login') ||
        (url.includes('china9.cn') && url.includes('#/login'))) {
      console.log('[Navigation] 🔄 检测到远程登录页(did-navigate)');
      if (!isNavigatingToLogin) {
        const restored = await tryRestoreLoginWithToken(lastValidUrl);
        if (!restored) {
          console.log('[Navigation] Token 无效，跳转到本地登录页');
          await navigateToLoginInternal('remote_login_navigate');
        }
      }
      return;
    }

  });

  // 监听新窗口请求 - 默认行为：总是打开新窗口（类似正常浏览器）
  browserView.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[Window Open] Request to open:', url);
    const isBareToutiao = shouldSkipScriptInjection(url);

    // 过滤自定义协议（如 bitbrowser://），阻止系统弹出"需要使用新应用"对话框
    if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
      console.log('[Window Open] ❌ Blocked non-http protocol:', url);
      return { action: 'deny' };
    }

    // 检测下载 URL（包含 /download 或 /api/bucket/download 等）
    if (url && (url.includes('/api/bucket/download') || url.includes('/download?') || url.includes('/download/'))) {
      console.log('[Window Open] 📥 检测到下载链接:', url);

      // 尝试从 URL 参数中提取实际的文件 URL
      let actualUrl = url;
      try {
        const urlObj = new URL(url);
        const fileUrl = urlObj.searchParams.get('url');
        if (fileUrl) {
          actualUrl = fileUrl;
          console.log('[Window Open] 📥 提取到实际文件 URL:', actualUrl);
        }
      } catch (e) {
        console.log('[Window Open] ⚠️ URL 解析失败，使用原始 URL');
      }

      // 异步触发下载，不阻塞
      setImmediate(() => {
        browserView.webContents.downloadURL(actualUrl);
      });

      return { action: 'deny' }; // 阻止打开新窗口
    }

    console.log('[Window Open] ✅ Opening new window for:', url);

    if (isBareToutiao) {
      console.log('[Window Open] 🧼 Toutiao 裸窗口，跳过 preload 和脚本注入');
    }

    const webPreferences = {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // 禁用沙箱以支持 window.opener
      session: browserView.webContents.session, // 使用相同的 session
      backgroundThrottling: false, // 禁用后台节流，防止视频被暂停
      autoplayPolicy: 'no-user-gesture-required' // 允许自动播放视频
    };
    if (!isBareToutiao) {
      webPreferences.preload = path.join(__dirname, 'content-preload.js');
    }

    // 使用 allow 模式，保持 window.opener 引用
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 1200,
        height: 800,
        webPreferences: {
          preload: path.join(__dirname, 'content-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false, // 禁用沙箱以支持 window.opener
          session: browserView.webContents.session, // 使用相同的 session
          backgroundThrottling: false, // 禁用后台节流，防止视频被暂停
          autoplayPolicy: 'no-user-gesture-required' // 允许自动播放视频
        }
      }
    };
  });

  // 监听新窗口创建完成（用于添加脚本注入等功能）
  browserView.webContents.on('did-create-window', (newWindow, details = {}) => {
    console.log('[Window Created] New window created');
    attachSessionDiagnosticWebContents(newWindow.webContents, 'child-window');
    applyScopedWindowUserAgent(newWindow.webContents, details?.url || '', 'Window Created');

    // 添加到子窗口列表
    childWindows.push(newWindow);
    const ensureShipinhaoLoginForceReset = createShipinhaoLoginResetGuard(newWindow, 'did-create-window');

    // 拦截子窗口的导航请求，阻止自定义协议（如 bitbrowser://）触发系统对话框
    newWindow.webContents.on('will-navigate', (event, url) => {
      applyScopedWindowUserAgent(newWindow.webContents, url, 'Window Created Navigate');
      if (ensureShipinhaoLoginForceReset(url, 'will-navigate-login-reset', event)) return;
      if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
        console.log('[New Window] ❌ Blocked non-http protocol:', url);
        event.preventDefault();
      }
    });

    // 拦截子窗口 iframe 导航请求，阻止自定义协议
    newWindow.webContents.on('will-frame-navigate', (event) => {
      const url = event.url;
      if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
        console.log('[New Window Frame] ❌ Blocked non-http protocol:', url);
        event.preventDefault();
      }
    });

    // 拦截子窗口重定向请求，阻止自定义协议
    newWindow.webContents.on('will-redirect', (event, url) => {
      console.log('[New Window Redirect] 检测到重定向:', url);
      if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
        console.log('[New Window Redirect] ❌ Blocked non-http protocol:', url);
        event.preventDefault();
      }
    });

    // 监听子窗口导航开始（用于调试）
    newWindow.webContents.on('did-start-navigation', (event, url, isInPlace, isMainFrame) => {
      console.log('[New Window Navigation] 导航开始:', url, 'isMainFrame:', isMainFrame);
      if (isMainFrame && ensureShipinhaoLoginForceReset(url, 'did-start-navigation-login-reset')) return;
      if (url && url.toLowerCase().startsWith('bitbrowser:')) {
        console.log('[New Window Navigation] ⚠️ 检测到 bitbrowser 协议导航!');
      }
      // 【已禁用】预防性隐藏脚本 - 会干扰正常页面渲染
      // if (newWindow && !newWindow.isDestroyed() && !newWindow.webContents.isDestroyed()) {
      //   newWindow.webContents.executeJavaScript(preHideScript).catch(() => {});
      // }
    });

    // 拦截子窗口打开新窗口的请求，阻止自定义协议
    newWindow.webContents.setWindowOpenHandler(({ url }) => {
      console.log('[New Window Open] Request to open:', url);
      const isBareToutiao = shouldSkipScriptInjection(url);

      // 过滤自定义协议（如 bitbrowser://）
      if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
        console.log('[New Window Open] ❌ Blocked non-http protocol:', url);
        return { action: 'deny' };
      }

      if (isBareToutiao) {
        console.log('[New Window Open] 🧼 Toutiao 裸窗口，跳过 preload 和脚本注入');
      }
      console.log('[New Window Open] ✅ Allowing:', url);
      const webPreferences = {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        session: browserView.webContents.session,
        backgroundThrottling: false, // 禁用后台节流，防止视频被暂停
        autoplayPolicy: 'no-user-gesture-required' // 允许自动播放视频
      };
      if (!isBareToutiao) {
        webPreferences.preload = path.join(__dirname, 'content-preload.js');
      }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1200,
          height: 800,
          webPreferences
        }
      };
    });

    // 忽略页面的 beforeunload 事件，允许直接关闭窗口
    newWindow.webContents.on('will-prevent-unload', (event) => {
      console.log('[Window Manager] 忽略页面的 beforeunload 事件，强制关闭窗口');
      event.preventDefault();
    });

    // 保存窗口 ID
    const windowId = newWindow.id;
    // 标记是否正在保存中（防止重复触发）
    let isSavingSession = false;

    // 🔐 维护窗口"上次 URL"，用于 did-navigate 检测登录页跳转
    let lastNavUrl = '';
    // 登录页 URL 识别模式（覆盖各平台变体）
    // /login - 通用、小红书、视频号 login.html、搜狐 /mpfe/v4/login
    // /userauth - 腾讯号 om.qq.com/userAuth/index
    // /userlogin - 兜底通用
    // /loginpage, /cgi-bin/login - 微信公众号
    // passport. - 抖音、搜狐、网易、新浪等账号中心
    // account.qq.com - 腾讯账号中心
    const LOGIN_URL_PATTERNS = [
      '/login',
      '/userauth',
      '/userlogin',
      '/loginpage',
      '/cgi-bin/login',
      'passport.',
      '/sso/',
      '/auth/',
      '/signin',
      'account.qq.com',
      'security.weibo.com'
    ];
    const isLoginPageUrl = (u) => {
      if (!u) return false;
      const lower = u.toLowerCase();
      return LOGIN_URL_PATTERNS.some(p => lower.includes(p));
    };

    // 公共方法：检测从登录页跳回业务页时触发 cookies 保存（同时被 did-navigate / did-navigate-in-page 复用）
    const tryPersistAfterLoginNavigate = async (navUrl, eventName) => {
      // 🛡️ 窗口已销毁则不处理，避免对已释放对象操作引发 crash (0xC0000005)
      if (newWindow.isDestroyed() || newWindow.webContents.isDestroyed()) return;
      const prevWasLogin = isLoginPageUrl(lastNavUrl);
      const currIsLogin = isLoginPageUrl(navUrl);
      lastNavUrl = navUrl;

      if (!prevWasLogin || currIsLogin) return;

      const accountInfo = windowAccountMap.get(windowId);
      if (!accountInfo && !hasWindowSessionSaveCandidate(windowId)) return;
      if (isSavingSession) {
        console.log(`[did-create-window] 🔐 正在保存中，跳过 ${eventName} 触发的保存`);
        return;
      }

      console.log(`[did-create-window] 🔐 [${eventName}] 检测到从登录页跳回业务页 (windowId=${windowId})，触发 cookies 保存...`);

      // 🛡️ 防误触发：SPA 跳一下登录页又立刻跳回（用户没真登录），cookies 是访客的不该保存
      // 必须确认本地 session 有真实登录态才保存，避免空触发污染后台
      const navPublishData = getWindowPublishData(windowId);
      const navPlatform = accountInfo?.platform || navPublishData?.platform || null;
      let navHasLogin = false;
      try {
        if (navPlatform && newWindow.webContents && !newWindow.webContents.isDestroyed()) {
          navHasLogin = await hasValidLoginCookies(newWindow.webContents.session, navPlatform);
        }
      } catch (loginCheckErr) {
        console.warn('[did-create-window] ⚠️ did-navigate 登录态预检异常:', loginCheckErr.message);
      }
      if (navPlatform && !navHasLogin) {
        console.log(`[did-create-window] 🚫 [${eventName}] 本地无真实登录态，跳过保存（可能是 SPA 跳一下登录页又跳回的误触发）`);
        return;
      }

      isSavingSession = true;
      try {
        // 🆕 优先走脚本侧 __publishSaveSession__（与 close handler 同款），避免主进程轻量 {id, cookies} 格式被后台拒
        let result = null;
        let scriptResult = null;
        try {
          scriptResult = await runPublishSaveSessionScript(newWindow, navPlatform, `did-create-window:${eventName}`);
          if (scriptResult && scriptResult.success) {
            console.log(`[did-create-window] 🔐 [${eventName}] ✅ 脚本保存成功`);
            let cacheSyncResult = null;
            if (navPlatform === 'shipinhao') {
              try {
                cacheSyncResult = await syncLatestSessionCacheFromWindow(newWindow, windowId, `script-save:${eventName}`);
                console.log(`[did-create-window] 🔐 [${eventName}] 视频号本地最新会话缓存同步结果:`, cacheSyncResult);
              } catch (cacheSyncErr) {
                console.warn(`[did-create-window] ⚠️ [${eventName}] 视频号本地最新会话缓存同步异常:`, cacheSyncErr.message);
              }
            }
            result = {
              success: true,
              accountInfo: { platform: navPlatform, accountId: accountInfo?.accountId || String(getPublishBackendAccountId(navPublishData) || '') },
              backendAccountId: cacheSyncResult?.backendAccountId || getPublishBackendAccountId(navPublishData) || scriptResult.uid,
              platformUid: scriptResult.uid,
              cookieCount: scriptResult.cookieCount,
              statusCode: scriptResult.status,
              response: scriptResult.response,
              source: 'script',
              cacheSyncResult
            };
          }
        } catch (scriptErr) {
          console.warn(`[did-create-window] ⚠️ [${eventName}] 脚本侧保存异常: ${scriptErr.message}`);
        }

        if (!result) {
          if (navPlatform === 'shipinhao') {
            console.log(`[did-create-window] 🛟 [${eventName}] 视频号脚本保存未成功，走主进程兜底写入本地最新会话缓存。scriptResult:`, scriptResult);
            result = await saveWindowSessionToBackend(newWindow, windowId, {
              eventName,
              navUrl,
              scriptResult,
              reason: 'shipinhao-relogin-navigation-fallback'
            });
          } else {
            console.log(`[did-create-window] 🚫 [${eventName}] 脚本路径未成功，跳过主进程兜底（避免轻量格式被拒）。scriptResult:`, scriptResult);
            return;
          }
        }
        console.log(`[did-create-window] 🔐 [${eventName}] 重登录后保存结果:`, result);
        if (browserView && !browserView.webContents.isDestroyed() && result && result.success) {
          const publishData = getWindowPublishData(windowId);
          browserView.webContents.send('session-updated', {
            windowId: windowId,
            platform: result.accountInfo?.platform || accountInfo?.platform,
            accountId: result.accountInfo?.accountId || accountInfo?.accountId,
            backendAccountId: result.backendAccountId,
            success: result.success,
            cookieCount: result.cookieCount,
            publishData: publishData,
            reason: 'relogin'
          });
        }
      } catch (err) {
        console.error(`[did-create-window] 🔐 [${eventName}] 重登录后保存失败:`, err);
      } finally {
        isSavingSession = false;
      }
    };

    // 🔐 监听 URL 跳转：从登录页跳回业务页时（说明用户重新登录成功）触发 cookies 保存到后台
    newWindow.webContents.on('did-navigate', async (_e, navUrl) => {
      if (ensureShipinhaoLoginForceReset(navUrl, 'did-navigate-login-reset')) return;
      await tryPersistAfterLoginNavigate(navUrl, 'did-navigate');
    });

    // 🔑 监听窗口关闭前事件，尝试保存登录信息（如果是多账号模式窗口）
    newWindow.on('close', async (e) => {
      console.log('[did-create-window] ========== 窗口关闭前 ==========');
      console.log('[did-create-window] windowId:', windowId);
      console.log('[did-create-window] URL:', newWindow.webContents.getURL());

      // 防止重复触发
      if (isSavingSession) {
        console.log('[did-create-window] 正在保存中，忽略重复触发');
        return;
      }

      // 检查是否是多账号模式的窗口（虽然 did-create-window 创建的窗口通常不是）
      const accountInfo = windowAccountMap.get(windowId);
      if (accountInfo || hasWindowSessionSaveCandidate(windowId)) {
        // 阻止窗口立即关闭，等待保存完成
        e.preventDefault();
        isSavingSession = true;

        console.log('[did-create-window] 发现可保存的发布窗口，等待保存会话数据完成后再关闭');

        try {
          const publishDataForSave = getWindowPublishData(windowId);
          const targetPlatform = accountInfo?.platform
            || publishDataForSave?.platform
            || null;
          let hasRealLogin = true;
          if (targetPlatform === 'shipinhao' && newWindow.webContents && !newWindow.webContents.isDestroyed()) {
            try {
              hasRealLogin = await hasValidLoginCookies(newWindow.webContents.session, targetPlatform);
            } catch (loginCheckErr) {
              hasRealLogin = false;
              console.warn('[did-create-window] ⚠️ 关闭前视频号登录态预检异常:', loginCheckErr.message);
            }
          }

          if (targetPlatform === 'shipinhao' && !hasRealLogin) {
            console.log('[did-create-window] 🚫 视频号发布窗口关闭前未检测到真实登录态，跳过保存接口调用');
            isSavingSession = false;
            newWindow.destroy();
            return;
          }

          // 调用公共函数保存登录信息
          const result = await saveWindowSessionToBackend(newWindow, windowId);
          console.log('[did-create-window] 保存结果:', result);

          // 通知首页：会话数据已更新
          if (browserView && !browserView.webContents.isDestroyed() && result.success) {
            const publishData = getWindowPublishData(windowId);
            browserView.webContents.send('session-updated', {
              windowId: windowId,
              platform: result.accountInfo?.platform || accountInfo?.platform,
              accountId: result.accountInfo?.accountId || accountInfo?.accountId,
              backendAccountId: result.backendAccountId,
              success: result.success,
              cookieCount: result.cookieCount,
              cookies: result.cookies || [],
              publishData: publishData,
              timestamp: Date.now()
            });
            console.log('[did-create-window] ✅ 已通知首页会话数据已更新');
          }
        } catch (err) {
          console.error('[did-create-window] ❌ 保存会话数据时出错:', err);
        } finally {
          // 保存完成（无论成功失败），销毁窗口
          console.log('[did-create-window] 保存完成，销毁窗口');
          newWindow.destroy();
        }
      } else {
        console.log('[did-create-window] 非多账号模式窗口，直接关闭');
      }
    });

    // 监听窗口关闭事件
    newWindow.on('closed', () => {
      const index = childWindows.indexOf(newWindow);
      if (index > -1) {
        childWindows.splice(index, 1);
        console.log('[Window Manager] 窗口已关闭，当前窗口数量:', childWindows.length);
      }
      toutiaoBarePublishState.delete(windowId);
      windowPublishDataMap.delete(windowId);
      // 清理发布数据，避免残留数据影响后续授权窗口
      const pdKey = `publish_data_window_${windowId}`;
      if (globalStorage[pdKey]) {
        delete globalStorage[pdKey];
        saveGlobalStorage();
        console.log(`[Window Manager] 🧹 已清理发布数据: ${pdKey}`);
      }
    });

    // 开发环境自动打开 DevTools
    if (!isProduction) {
      newWindow.webContents.openDevTools();
    }

    // 【已禁用】新窗口早期页面检测 - 会误判正常页面导致不必要的刷新
    // newWindow.webContents.on('dom-ready', () => {
    //   console.log('[New Window] DOM Ready，执行早期页面检测...');
    //   if (newWindow && !newWindow.isDestroyed() && !newWindow.webContents.isDestroyed()) {
    //     newWindow.webContents.executeJavaScript(earlyPageCheckScript).catch(() => {});
    //   }
    // });

    // 为新窗口添加脚本注入
    newWindow.webContents.on('did-finish-load', async () => {
      const currentURL = newWindow.webContents.getURL();
      console.log('[New Window] Page loaded:', currentURL);
      if (shouldSkipScriptInjection(currentURL)) {
        console.log('[New Window] Skip script injection for Toutiao:', currentURL);
        await maybeRunBareToutiaoPublish(newWindow);
        return;
      }
      await injectScriptForUrl(newWindow.webContents, currentURL);
    });

    // 监听新窗口内的导航（SPA 路由）
    newWindow.webContents.on('did-navigate-in-page', async (event, url) => {
      console.log('[New Window] SPA Navigation:', url);
      // 🔐 SPA 路由也触发登录回跳保存（覆盖腾讯号 userAuth、搜狐 mpfe/v4/login 等单页应用登录路径）
      // 加存活守卫，避免窗口销毁后访问已释放对象导致 crash (0xC0000005)
      try {
        if (!newWindow.isDestroyed() && !newWindow.webContents.isDestroyed()) {
          await tryPersistAfterLoginNavigate(url, 'did-navigate-in-page');
        }
      } catch (persistErr) {
        console.error('[New Window] 🔐 SPA 路由保存异常（已忽略）:', persistErr);
      }
      if (newWindow.isDestroyed() || newWindow.webContents.isDestroyed()) return;
      if (shouldSkipScriptInjection(url)) {
        console.log('[New Window] Skip script injection for Toutiao:', url);
        await maybeRunBareToutiaoPublish(newWindow);
        return;
      }
      await injectScriptForUrl(newWindow.webContents, url);
    });
  });
}

// 是否隐藏公共头部（登录页时隐藏）
let isHeaderHidden = false;

function updateBrowserViewBounds(scriptPanelOpen = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!browserView || !browserView.webContents || browserView.webContents.isDestroyed()) return;
  if (browserLoadingState.visible) {
    browserView.setBounds({ x: 0, y: -10000, width: 0, height: 0 });
    return;
  }

  const { width, height } = mainWindow.getContentBounds();
  // 公共头部高度 50px（登录页时隐藏）
  // 开发工具栏已移除，统一使用公共头部
  const headerHeight = isHeaderHidden ? 0 : 50;
  const toolbarHeight = 0; // 工具栏已移除
  const totalTopOffset = headerHeight + toolbarHeight;
  const viewWidth = scriptPanelOpen ? width - 400 : width;
  browserView.setBounds({ x: 0, y: totalTopOffset, width: viewWidth, height: height - totalTopOffset });
}

// 根据 URL 判断是否需要隐藏公共头部
function updateHeaderVisibility(url) {
  const isLoginPage = url && url.includes('login.html');
  const shouldHideHeader = isLoginPage;

  if (isHeaderHidden !== shouldHideHeader) {
    isHeaderHidden = shouldHideHeader;
    // 通知渲染进程隐藏/显示头部
    mainWindow.webContents.send('toggle-header', !isHeaderHidden);
    // 更新 BrowserView 边界
    updateBrowserViewBounds(isScriptPanelOpen);
    console.log('[Header] 公共头部:', isHeaderHidden ? '隐藏' : '显示');
  }
}

// 跳转到登录页（统一入口，防重入）
async function navigateToLoginInternal(source) {
  if (isNavigatingToLogin) {
    console.log(`[navigateToLoginInternal] 已在跳转中，忽略来源: ${source}`);
    return;
  }
  isNavigatingToLogin = true;
  console.log(`[navigateToLoginInternal] 开始跳转到登录页，来源: ${source}`);

  try {
    if (!browserView || browserView.webContents.isDestroyed()) {
      console.error('[navigateToLoginInternal] BrowserView 不可用');
      return;
    }

    // 🔑 退出登录时清除所有登录相关数据
    console.log('[navigateToLoginInternal] 清除退出登录数据...');

    // 1. 清除 globalStorage 中的登录数据
    delete globalStorage.last_page_url;
    delete globalStorage.login_token;
    delete globalStorage.login_expires;
    delete globalStorage.login_gcc;
    delete globalStorage.company_id;
    delete globalStorage.user_info;
    delete globalStorage.siteInfo;
    delete globalStorage.current_site;
    delete globalStorage.current_site_id;
    delete globalStorage.current_site_name;
    saveGlobalStorage();
    console.log('[navigateToLoginInternal] ✅ 已清除 globalStorage 数据');

    // 2. 清除 Cookies（token, access_token, gcc, site_id 等）
    try {
      const ses = browserView.webContents.session;
      const cookies = await ses.cookies.get({});
      console.log(`[navigateToLoginInternal] 当前有 ${cookies.length} 个 cookies，开始清除登录相关 cookies...`);

      const cookiesToClear = ['token', 'access_token', 'gcc', 'site_id'];

      let deletedCount = 0;
      for (const cookie of cookies) {
        if (cookiesToClear.includes(cookie.name)) {
          const cookieUrl = `${cookie.secure ? 'https' : 'http'}://${cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain}${cookie.path}`;
          try {
            await ses.cookies.remove(cookieUrl, cookie.name);
            deletedCount++;
            console.log(`[navigateToLoginInternal] ✓ 删除 Cookie: ${cookie.name} @ ${cookie.domain}`);
          } catch (err) {
            console.error(`[navigateToLoginInternal] ✗ 删除 Cookie 失败: ${cookie.name} @ ${cookie.domain}`, err.message);
          }
        }
      }

      // 也清除 localhost 的 cookies
      await ses.cookies.remove('http://localhost:5173/', 'token').catch(() => {});
      await ses.cookies.remove('http://localhost:5173/', 'access_token').catch(() => {});
      await ses.cookies.remove('http://localhost:5173/', 'gcc').catch(() => {});
      await ses.cookies.remove('http://localhost:5173/', 'site_id').catch(() => {});

      await ses.flushStorageData();
      console.log(`[navigateToLoginInternal] ✅ 已清除 ${deletedCount} 个登录相关 cookies`);
    } catch (err) {
      console.error('[navigateToLoginInternal] ❌ 清除 cookies 失败:', err);
    }

    // 隐藏公共头部
    isHeaderHidden = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('toggle-header', false);
    }
    updateBrowserViewBounds(isScriptPanelOpen);

    // 使用 loadFile 加载登录页（避免 file:// 中文路径编码问题）
    await loadLocalPage(browserView.webContents, 'login.html');

    // 通知 renderer URL 变化
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('url-changed', LOGIN_URL);
    }

    console.log('[navigateToLoginInternal] ✅ 已跳转到登录页');
  } catch (err) {
    console.error('[navigateToLoginInternal] ❌ 跳转失败:', err);
  } finally {
    // 延迟重置标志，防止快速重入
    setTimeout(() => {
      isNavigatingToLogin = false;
    }, 1000);
  }
}

// 启动时检查并清理损坏的数据
async function validateAndCleanupUserData() {
  const fs = require('fs').promises;
  const fsSync = require('fs');
  const userDataPath = app.getPath('userData');
  const sessionPath = path.join(userDataPath, 'Partitions', 'persist_browserview');
  const firstRunMarker = path.join(userDataPath, '.first_run_completed');

  console.log('[Startup] 检查用户数据完整性...');
  console.log('[Startup] 用户数据路径:', userDataPath);

  // 检查是否是首次运行（仅开发环境）
  if (!isProduction && !fsSync.existsSync(firstRunMarker)) {
    console.log('[Startup] 🆕 检测到首次运行（开发环境），清除旧的用户数据...');

    try {
      // 删除整个 Session 目录
      if (fsSync.existsSync(sessionPath)) {
        fsSync.rmSync(sessionPath, { recursive: true, force: true });
        console.log('[Startup] ✅ 已清除旧的 Session 数据');
      }

      // 创建首次运行标记
      await fs.writeFile(firstRunMarker, new Date().toISOString());
      console.log('[Startup] ✅ 已创建首次运行标记');

      return true;
    } catch (err) {
      console.error('[Startup] ⚠️ 清除数据失败:', err);
    }
  }

  // 💡 开发提示：如需重新清除所有数据，请删除文件：
  // Windows: %APPDATA%\运营助手\.first_run_completed
  // 或直接删除整个目录：%APPDATA%\运营助手
  console.log('[Startup] 💡 如需清除所有数据，请删除:', firstRunMarker);

  try {
    // 检查 Session 目录是否存在
    try {
      await fs.access(sessionPath);
    } catch (err) {
      console.log('[Startup] ✅ Session 目录不存在（首次运行）');
      return true;
    }

    // 检查 Cookies 文件
    const cookiesFile = path.join(sessionPath, 'Cookies');
    const cookiesJournalFile = path.join(sessionPath, 'Cookies-journal');

    try {
      await fs.access(cookiesFile);
      const stats = await fs.stat(cookiesFile);

      // 检查文件大小是否异常（小于 100 字节可能损坏）
      if (stats.size < 100) {
        console.log('[Startup] ⚠️ Cookies 文件大小异常:', stats.size, 'bytes');
        throw new Error('Cookies file corrupted');
      }

      // 检查是否存在 journal 文件（表示上次未正常关闭）
      try {
        await fs.access(cookiesJournalFile);
        console.log('[Startup] ⚠️ 检测到 Cookies-journal 文件，上次可能未正常关闭');
        // 删除 journal 文件，让 SQLite 自动修复
        await fs.unlink(cookiesJournalFile);
        console.log('[Startup] ✅ 已删除 Cookies-journal 文件');
      } catch (err) {
        // journal 文件不存在是正常的
      }

      console.log('[Startup] ✅ 用户数据检查通过');
      return true;
    } catch (err) {
      console.error('[Startup] ❌ 检测到数据损坏:', err.message);

      // 备份损坏的数据
      const backupPath = path.join(userDataPath, `Backup_${Date.now()}`);
      try {
        const fsSync = require('fs');
        fsSync.cpSync(sessionPath, backupPath, { recursive: true });
        console.log('[Startup] 📦 已备份损坏数据到:', backupPath);
      } catch (backupErr) {
        console.error('[Startup] ⚠️ 备份失败:', backupErr.message);
      }

      // 删除损坏的数据
      const fsSync = require('fs');
      fsSync.rmSync(sessionPath, { recursive: true, force: true });
      console.log('[Startup] 🔧 已清理损坏数据，将重新初始化');

      return true;
    }
  } catch (err) {
    console.error('[Startup] 数据检查失败:', err);
    return false;
  }
}

// createTray 创建托盘图标
function createTray() {
  const icon = path.join(__dirname, 'icon.ico')
  tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => win.show()
    },
    {
      label: '退出',
      click: () => app.quit()
    }
  ])

  tray.setToolTip('应用名称')
  tray.setContextMenu(contextMenu)
}

if (shouldDisableHardwareAcceleration) {
  console.log('[GPU] ✅ 已仅对旧版 Windows 禁用 GPU 硬件加速（防止白屏）');
} else {
  console.log('[GPU] ✅ 已保留 GPU 硬件加速（避免动画噪点/渲染降级）');
}

// 🛡️ 反自动化检测 - 在 app.whenReady() 之前设置
// 禁用 Blink 的 AutomationControlled 特征，避免被网站检测为自动化浏览器
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
// 禁用自动化扩展
app.commandLine.appendSwitch('disable-extensions');
// 使用正常的渲染模式
app.commandLine.appendSwitch('disable-dev-shm-usage');
// 禁用沙箱 - 防止某些企业安全策略或杀毒软件拦截渲染进程
app.commandLine.appendSwitch('no-sandbox');
// 🛡️ 安全软件兼容性优化（电脑管家/360等）
// 禁用渲染进程代码完整性检查 - 防止安全软件的DLL注入校验导致renderer崩溃
app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity');
if (shouldDisableHardwareAcceleration) {
  // GPU进程合并到主进程 - 已禁用硬件加速，独立GPU进程无意义，减少进程数降低安全软件误报
  app.commandLine.appendSwitch('in-process-gpu');
}
// 防止后台窗口被节流 - 避免安全软件的"性能优化"功能干扰发布窗口
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
console.log('[AntiDetection] ✅ 已禁用 AutomationControlled 特征');
console.log('[Sandbox] ✅ 已添加 no-sandbox fallback');
console.log(`[Compatibility] ✅ 已添加安全软件兼容性优化（RendererCodeIntegrity禁用/${shouldDisableHardwareAcceleration ? 'GPU合并/' : ''}防后台节流）`);

app.whenReady().then(async () => {
  // ⚠️ 不要使用 app.setAsDefaultProtocolClient('bitbrowser')
  // 这会导致错误: "Unable to find Electron app at D:\浏览器\运营助手\bitbrowser\cc"
  // 原因: Windows 会将 bitbrowser://cc 的路径部分作为命令行参数传递给应用

  // 移除之前错误注册的协议处理程序（清理注册表）
  if (process.platform === 'win32') {
    app.removeAsDefaultProtocolClient('bitbrowser');
    console.log('[Protocol] 已移除 bitbrowser:// 协议注册');
  }

  // 注册自定义协议拦截器，阻止 bitbrowser:// 等协议触发系统对话框
  protocol.registerStringProtocol('bitbrowser', (request, callback) => {
    console.log('[Protocol] ❌ Blocked bitbrowser:// protocol request:', request.url);
    callback(''); // 返回空内容
  });
  console.log('[Protocol] ✅ 已注册 bitbrowser:// 协议拦截器');

  // 全局拦截所有 webContents 的协议导航
  app.on('web-contents-created', (event, webContents) => {
    attachSessionDiagnosticWebContents(webContents, 'global-webContents');

    // 为每个 webContents 添加协议拦截
    webContents.on('will-navigate', (event, url) => {
      if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:') && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('file:')) {
        console.log('[Global] ❌ Blocked non-http navigation:', url);
        event.preventDefault();
      }
    });

    webContents.on('will-frame-navigate', (event) => {
      const url = event.url;
      if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:') && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('file:')) {
        console.log('[Global Frame] ❌ Blocked non-http navigation:', url);
        event.preventDefault();
      }
    });

    webContents.setWindowOpenHandler(({ url }) => {
      if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
        console.log('[Global WindowOpen] ❌ Blocked non-http:', url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });
  });
  console.log('[App] ✅ 已添加全局 webContents 协议拦截');

  // 设置 Windows 任务栏应用程序用户模型 ID（确保任务栏图标正确显示）
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.zhcloud.browser');
    console.log('[App] 已设置 AppUserModelId: com.zhcloud.browser');
  }

  // 设置日志文件（便携版和生产环境）
  if (isProduction) {
    const logPath = path.join(app.getPath('userData'), 'app.log');
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    // 保存原始 console 方法
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    // 重定向 console 输出到文件和控制台
    console.log = function(...args) {
      const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
      logStream.write(`[LOG ${new Date().toLocaleString()}] ${msg}\n`);
      originalLog.apply(console, args);
    };

    console.error = function(...args) {
      const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
      logStream.write(`[ERROR ${new Date().toLocaleString()}] ${msg}\n`);
      originalError.apply(console, args);
    };

    console.warn = function(...args) {
      const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
      logStream.write(`[WARN ${new Date().toLocaleString()}] ${msg}\n`);
      originalWarn.apply(console, args);
    };

    console.log('=================================');
    console.log('📝 日志文件已启用');
    console.log('📂 日志路径:', logPath);
    console.log('=================================');
  }

  console.log('=================================');
  console.log('应用启动 - Cookie 持久化已启用');
  console.log(`app.isPackaged: ${app.isPackaged}`);
  console.log(`isProduction: ${isProduction}`);
  console.log(`isPortable: ${isPortable}`);
  console.log(`环境: ${isProduction ? '生产环境' : '开发环境'}`);
  console.log(`首页URL: ${HOME_URL}`);
  console.log(`execPath: ${process.execPath}`);
  console.log(`userData路径: ${app.getPath('userData')}`);
  console.log('=================================');

  // 启动时验证数据完整性
  await validateAndCleanupUserData();

  // 加载全局持久化数据（如 company_id）
  loadGlobalStorage();

  // 生产环境立即移除菜单（必须在创建窗口之前）
  if (isProduction) {
    Menu.setApplicationMenu(null);
    console.log('[Menu] ✅ 生产环境菜单已完全移除');
  }

  // 初始化脚本管理器
  // 生产环境使用 app.asar.unpacked 路径，开发环境使用 __dirname
  let scriptsBaseDir = __dirname;
  if (app.isPackaged) {
    scriptsBaseDir = __dirname.replace('app.asar', 'app.asar.unpacked');
  }
  console.log('Scripts base dir:', scriptsBaseDir);
  scriptManager = new ScriptManager(scriptsBaseDir);

  createWindow();
  createTray();

  // 启动后检查更新（延迟执行，避免影响启动速度）
  scheduleUpdateCheck();

  // 注册全局快捷键：只打开公共头部（主窗口）的 DevTools (Ctrl+Shift+F11)
  globalShortcut.register('CommandOrControl+Shift+F11', () => {
    console.log('[DevTools] 公共头部 DevTools 快捷键触发');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // 注册全局快捷键后门打开 DevTools (Ctrl+Shift+F12)
  globalShortcut.register('CommandOrControl+Shift+F12', () => {
    console.log('[DevTools] 后门快捷键触发');
    // 打开当前聚焦窗口的 DevTools
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.webContents.toggleDevTools();
    }
    // 也打开 BrowserView 的 DevTools
    if (browserView && !browserView.webContents.isDestroyed()) {
      browserView.webContents.toggleDevTools();
    }
  });

  // 注册全局快捷键后门清除指定域名的 Cookies (Ctrl+Alt+C)
  console.log('[Main] 尝试注册清除 Cookies 快捷键: Ctrl+Alt+C');
  const registerResult = globalShortcut.register('CommandOrControl+Alt+C', async () => {
    console.log('[Clear Cookies] ========== 后门快捷键触发 ==========');

    // 使用 Electron 的对话框让用户输入域名
    const { dialog } = require('electron');

    console.log('[Clear Cookies] 显示选择对话框...');
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['取消', '清除所有登录状态', '清除指定域名'],
      defaultId: 2,
      title: '清除 Cookies',
      message: '选择要清除的范围：',
      detail: '清除所有：删除所有网站的登录状态\n清除指定域名：删除特定网站的登录状态（如：douyin.com）'
    });

    console.log('[Clear Cookies] 用户选择:', result.response);

    if (result.response === 0) {
      // 取消
      console.log('[Clear Cookies] 用户取消操作');
      return;
    }

    if (result.response === 1) {
      // 清除所有
      console.log('[Clear Cookies] 开始清除所有登录状态...');
      if (browserView && !browserView.webContents.isDestroyed()) {
        const ses = browserView.webContents.session;
        const cookiesBefore = await ses.cookies.get({});
        console.log(`[Clear Cookies] 清除前有 ${cookiesBefore.length} 个 cookies`);

        // 先导航到空白页，避免页面正在使用存储数据导致冲突卡死
        console.log('[Clear Cookies] 先导航到空白页...');
        await browserView.webContents.loadURL('about:blank');
        // 等待一小段时间确保页面完全卸载
        await new Promise(resolve => setTimeout(resolve, 100));

        await ses.clearStorageData({
          storages: ['cookies', 'localstorage', 'sessionstorage']
        });

        const cookiesAfter = await ses.cookies.get({});
        console.log(`[Clear Cookies] 清除后有 ${cookiesAfter.length} 个 cookies`);
        console.log('[Clear Cookies] ✅ 已清除所有登录状态');

        // 清除完成后导航回首页
        console.log('[Clear Cookies] 导航回首页...');
        loadLocalPage(browserView.webContents, 'login.html');

        await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: '清除成功',
          message: '已清除所有网站的登录状态',
          detail: `删除了 ${cookiesBefore.length} 个 cookies\n\n页面将自动刷新`,
          buttons: ['确定']
        });
      }
      return;
    }

    if (result.response === 2) {
      // 清除指定域名
      console.log('[Clear Cookies] 用户选择清除指定域名，准备显示输入窗口...');

      // 直接使用简化的prompt对话框
      const { BrowserWindow } = require('electron');
      const appIcon = nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));

      const inputWindow = new BrowserWindow({
        width: 500,
        height: 220,
        parent: mainWindow,
        modal: true,
        show: false,
        autoHideMenuBar: true,
        icon: appIcon, // 使用 nativeImage 加载的图标
        webPreferences: {
          nodeIntegration: true,  // 启用nodeIntegration以便使用ipcRenderer
          contextIsolation: false  // 关闭上下文隔离
        }
      });

      console.log('[Clear Cookies] 输入窗口已创建');

      // 监听来自输入窗口的域名
      let receivedDomain = null;
      ipcMain.once('submit-domain', async (event, domain) => {
        console.log('[Clear Cookies] 收到域名:', domain);
        receivedDomain = domain;

        if (domain && browserView && !browserView.webContents.isDestroyed()) {
          console.log('[Clear Cookies] 开始清除域名:', domain);

          const ses = browserView.webContents.session;
          const cookies = await ses.cookies.get({});
          console.log(`[Clear Cookies] 当前共有 ${cookies.length} 个 cookies`);

          let deletedCount = 0;
          for (const cookie of cookies) {
            // 匹配域名（包括子域名）
            const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
            const shouldDelete = cookieDomain.includes(domain) || domain.includes(cookieDomain);

            if (shouldDelete) {
              const cookieUrl = `${cookie.secure ? 'https' : 'http'}://${cookieDomain}${cookie.path}`;
              try {
                await ses.cookies.remove(cookieUrl, cookie.name);
                deletedCount++;
                console.log(`[Clear Cookies] ✓ 删除: ${cookie.name} @ ${cookie.domain}`);
              } catch (err) {
                console.error(`[Clear Cookies] ✗ 删除失败: ${cookie.name} @ ${cookie.domain}`, err.message);
              }
            }
          }

          console.log(`[Clear Cookies] ========== 清除完成 ==========`);
          console.log(`[Clear Cookies] ✅ 共删除 ${deletedCount} 个 cookies`);

          // 通知首页刷新指定域名的授权状态
          browserView.webContents.send('cookies-cleared', { type: 'domain', domain: domain, count: deletedCount });
          console.log('[Clear Cookies] 📤 已通知首页刷新授权状态');

          await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '清除成功',
            message: `已清除域名 "${domain}" 的登录状态`,
            detail: `共删除 ${deletedCount} 个 cookies\n\n刷新页面即可看到效果`,
            buttons: ['确定']
          });
        } else {
          console.log('[Clear Cookies] 域名为空或browserView不可用');
        }
      });

      inputWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>清除指定域名的 Cookies</title>
          <style>
            body {
              font-family: 'Microsoft YaHei', Arial, sans-serif;
              padding: 30px;
              background: #f5f5f5;
              margin: 0;
            }
            .container {
              background: white;
              padding: 25px;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h3 {
              margin: 0 0 15px 0;
              color: #333;
              font-size: 16px;
            }
            input {
              width: 100%;
              padding: 10px;
              border: 2px solid #ddd;
              border-radius: 4px;
              font-size: 14px;
              box-sizing: border-box;
              font-family: 'Microsoft YaHei', Arial, sans-serif;
            }
            input:focus {
              outline: none;
              border-color: #ee0a24;
            }
            .buttons {
              margin-top: 20px;
              display: flex;
              gap: 10px;
              justify-content: flex-end;
            }
            button {
              padding: 10px 24px;
              border: none;
              border-radius: 4px;
              cursor: pointer;
              font-size: 14px;
              font-family: 'Microsoft YaHei', Arial, sans-serif;
            }
            .cancel {
              background: #e0e0e0;
              color: #333;
            }
            .submit {
              background: #ee0a24;
              color: white;
            }
            .cancel:hover {
              background: #d0d0d0;
            }
            .submit:hover {
              background: #d00a20;
            }
            .hint {
              font-size: 12px;
              color: #666;
              margin-top: 10px;
              line-height: 1.5;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h3>🔑 输入要清除的域名</h3>
            <input type="text" id="domain" placeholder="例如: douyin.com 或 creator.douyin.com" autofocus />
            <div class="hint">💡 提示: 只输入主域名(如 douyin.com)将清除所有相关子域名的登录状态</div>
            <div class="buttons">
              <button class="cancel" onclick="window.close()">取消</button>
              <button class="submit" onclick="submit()">清除</button>
            </div>
          </div>
          <script>
            const { ipcRenderer } = require('electron');
            console.log('输入窗口脚本已加载');

            document.getElementById('domain').focus();
            document.getElementById('domain').addEventListener('keypress', (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            });

            function submit() {
              const domain = document.getElementById('domain').value.trim();
              console.log('用户输入域名:', domain);
              if (domain) {
                console.log('发送域名到主进程:', domain);
                ipcRenderer.send('submit-domain', domain);
                window.close();
              } else {
                alert('请输入域名！');
              }
            }
          </script>
        </body>
        </html>
      `)}`);

      inputWindow.once('ready-to-show', () => {
        console.log('[Clear Cookies] 输入窗口准备完成，显示窗口');
        inputWindow.show();
      });

      inputWindow.on('close', () => {
        console.log('[Clear Cookies] 输入窗口已关闭');
      });
    }
  });

  if (registerResult) {
    console.log('[Main] ✅ 清除 Cookies 快捷键注册成功 (Ctrl+Alt+C)');
  } else {
    console.error('[Main] ❌ 清除 Cookies 快捷键注册失败，可能被占用');
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      isQuitting = false; // 重置标志
      shutdownStarted = false;
      createWindow();
    }
  });

  // 定期保存 session 数据（每 30 秒）
  autoSaveInterval = setInterval(async () => {
    if (browserView && !browserView.webContents.isDestroyed()) {
      try {
        const ses = browserView.webContents.session;
        const cookies = await ses.cookies.get({});
        await ses.flushStorageData();
        console.log(`[Auto-Save] ✅ Session 数据已保存 - ${cookies.length} 个 cookies`);
        if (isPortable) {
          console.log(`[Auto-Save] 便携版数据路径: ${app.getPath('userData')}`);
        }
      } catch (err) {
        console.error('[Auto-Save] ❌ 保存失败:', err);
      }
    }
  }, 30000);

  // 优化：定期清理已销毁的窗口引用（每 60 秒）
  destroyedWindowCleanupInterval = setInterval(() => {
    cleanupDestroyedWindows();
    // 强制垃圾回收（如果可用）
    if (global.gc) {
      global.gc();
      console.log('[Memory] 强制垃圾回收完成');
    }
  }, 60000);
});

app.on('window-all-closed', function () {
  beginShutdown('window-all-closed');
  // 注销所有全局快捷键
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  beginShutdown('before-quit');
});

// IPC 处理程序

// 🔑 获取域名配置（供渲染进程使用）
ipcMain.handle('get-domain-config', () => {
  return {
    ENV: config.CURRENT_ENV || config.ENV,
    isProduction: isProduction,
    domains: config.domains,
    // 便捷 URL（根据 ENV 配置）
    aigcUrl: config.getAigcUrl(),
    geoUrl: config.getGeoUrl(),
    apiDomain: config.getApiDomainUrl(),
    cookieUrl: config.getCookieUrl(),
    cookieDomain: config.getCookieDomain(),
    DEV_HOSTS: config.DEV_HOSTS
  };
});

ipcMain.handle('get-platform-config', async () => {
  return await loadRuntimePlatformConfig();
});

// 获取当前应用版本
ipcMain.handle('get-app-version', () => {
  return APP_VERSION;
});

// 手动检查更新（可由前端触发）
ipcMain.handle('check-for-update', async () => {
  const updateInfo = await checkForUpdate();

  if (updateInfo.hasUpdate && updateInfo.version && updateInfo.url) {
    // 显示更新对话框
    await showUpdateDialog(updateInfo.version, updateInfo.url);
  }

  return updateInfo;
});

// 获取新窗口模式状态
ipcMain.handle('get-new-window-mode', () => {
  return { openInNewWindow };
});

// 切换新窗口模式
ipcMain.handle('toggle-new-window-mode', () => {
  openInNewWindow = !openInNewWindow;
  return { openInNewWindow };
});

// 检查 Session 状态（用于检测登录状态是否被清除）
ipcMain.handle('check-session-status', async () => {
  try {
    if (!browserView || browserView.webContents.isDestroyed()) {
      return { hasSession: false, cookieCount: 0, reason: 'browserView不可用' };
    }

    const ses = browserView.webContents.session;
    const cookies = await ses.cookies.get({});

    // 检查特定平台的登录凭证 cookies（不只是数量，而是关键的登录 cookie）
    const douyinCookies = cookies.filter(c => c.domain.includes('douyin.com'));
    const xiaohongshuCookies = cookies.filter(c => c.domain.includes('xiaohongshu.com'));
    const weixinCookies = cookies.filter(c => c.domain.includes('weixin.qq.com'));
    const baijiahaoCookies = cookies.filter(c => c.domain.includes('baidu.com'));

    // 检查关键登录凭证（这些 cookie 存在才表示真正登录）
    // 扩大检测范围，避免漏检
    const douyinLoggedIn = douyinCookies.some(c =>
      c.name === 'sessionid' ||
      c.name === 'sessionid_ss' ||
      c.name === 'passport_csrf_token' ||
      c.name === 'sid_guard' ||
      c.name === 'uid_tt' ||
      c.name === 'uid_tt_ss' ||
      c.name === 'ttwid' ||
      c.name === 'passport_auth_status'
    );

    const xiaohongshuLoggedIn = xiaohongshuCookies.some(c =>
      c.name === 'web_session' ||
      c.name === 'websectiga' ||
      c.name === 'sec_poison_id' ||
      c.name === 'a1' ||
      c.name === 'webId'
    );

    const weixinLoggedIn = weixinCookies.some(c =>
      c.name === 'wxuin' ||
      c.name === 'pass_ticket' ||
      c.name === 'slave_user' ||
      c.name === 'slave_sid'
    );

    const baijiahaoLoggedIn = baijiahaoCookies.some(c =>
      c.name === 'BDUSS' ||
      c.name === 'STOKEN' ||
      c.name === 'BAIDUID' ||
      c.name === 'BIDUPSID'
    );

    const platformStatus = {
      douyin: { count: douyinCookies.length, loggedIn: douyinLoggedIn },
      xiaohongshu: { count: xiaohongshuCookies.length, loggedIn: xiaohongshuLoggedIn },
      weixin: { count: weixinCookies.length, loggedIn: weixinLoggedIn },
      baijiahao: { count: baijiahaoCookies.length, loggedIn: baijiahaoLoggedIn }
    };

    console.log('[Session Check] Cookie 统计:', {
      total: cookies.length,
      douyin: `${douyinCookies.length} cookies, loggedIn: ${douyinLoggedIn}`,
      xiaohongshu: `${xiaohongshuCookies.length} cookies, loggedIn: ${xiaohongshuLoggedIn}`,
      weixin: `${weixinCookies.length} cookies, loggedIn: ${weixinLoggedIn}`,
      baijiahao: `${baijiahaoCookies.length} cookies, loggedIn: ${baijiahaoLoggedIn}`
    });

    return {
      hasSession: cookies.length > 0,
      cookieCount: cookies.length,
      platforms: platformStatus
    };
  } catch (err) {
    console.error('[Session Check] 检查失败:', err);
    return { hasSession: false, cookieCount: 0, error: err.message };
  }
});

// 原生鼠标点击（通过 CDP 发送可信事件，用于自动化点击 Vue 组件等场景）
ipcMain.handle('native-click', async (event, x, y) => {
  try {
    const webContents = event.sender;
    if (!webContents || webContents.isDestroyed()) {
      return { success: false, error: 'webContents 不可用' };
    }

    const xi = Math.round(x);
    const yi = Math.round(y);

    // 使用 Chrome DevTools Protocol 发送鼠标事件（最可靠的方式）
    const dbg = webContents.debugger;
    try { dbg.attach('1.3'); } catch (e) { /* 可能已 attach */ }

    await dbg.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: xi, y: yi
    });
    await dbg.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: xi, y: yi, button: 'left', clickCount: 1
    });
    await dbg.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: xi, y: yi, button: 'left', clickCount: 1
    });

    try { dbg.detach(); } catch (e) { /* ignore */ }

    return { success: true, x: xi, y: yi };
  } catch (err) {
    console.error('[Native Click] 失败:', err);
    return { success: false, error: err.message };
  }
});

// 原生鼠标移动（优先 Electron 原生输入，CDP 兜底，不触发点击）
ipcMain.handle('native-mouse-move', async (event, x, y, options = {}) => {
  let didAttachDebugger = false;
  let activeDebugger = null;

  try {
    const webContents = event.sender;
    if (!webContents || webContents.isDestroyed()) {
      return { success: false, error: 'webContents 不可用' };
    }

    const xi = Math.round(Number(x));
    const yi = Math.round(Number(y));
    if (!Number.isFinite(xi) || !Number.isFinite(yi)) {
      return { success: false, error: '坐标无效' };
    }

    const moveOptions = options && typeof options === 'object' ? options : {};
    const requestedMethod = moveOptions.method === 'cdp' ? 'cdp' : 'sendInputEvent';
    let sendInputError = null;

    try {
      const senderWindow = BrowserWindow.fromWebContents(webContents);
      if (senderWindow && !senderWindow.isDestroyed()) {
        if (senderWindow.isMinimized()) senderWindow.restore();
        senderWindow.focus();
      } else if (browserView && webContents === browserView.webContents && mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
      if (typeof webContents.focus === 'function') {
        webContents.focus();
      }
    } catch (focusErr) {
      console.warn('[Native Mouse Move] focus 窗口失败，继续发送鼠标事件:', focusErr.message);
    }

    if (requestedMethod !== 'cdp') {
      try {
        if (moveOptions.enter) {
          webContents.sendInputEvent({
            type: 'mouseEnter',
            x: xi,
            y: yi,
            movementX: 0,
            movementY: 0
          });
        }
        webContents.sendInputEvent({
          type: 'mouseMove',
          x: xi,
          y: yi,
          movementX: 0,
          movementY: 0
        });
        return { success: true, x: xi, y: yi, method: 'sendInputEvent' };
      } catch (err) {
        sendInputError = err;
        console.warn('[Native Mouse Move] sendInputEvent 失败，尝试 CDP:', err);
      }
    }

    const dbg = webContents.debugger;
    activeDebugger = dbg;
    try {
      dbg.attach('1.3');
      didAttachDebugger = true;
    } catch (e) {
      // 可能已经 attach，继续尝试发送命令。
    }

    await dbg.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: xi,
      y: yi,
      button: 'none',
      clickCount: 0
    });

    return {
      success: true,
      x: xi,
      y: yi,
      method: 'cdp',
      fallbackFrom: sendInputError ? sendInputError.message : undefined
    };
  } catch (err) {
    console.error('[Native Mouse Move] 失败:', err);
    return { success: false, error: err.message };
  } finally {
    if (didAttachDebugger && activeDebugger) {
      try { activeDebugger.detach(); } catch (e) { /* ignore */ }
    }
  }
});

// 原生连续 hover：一次性发送多个鼠标移动点，避免逐点 IPC 让平台 hover 状态断掉
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
      } else if (browserView && webContents === browserView.webContents && mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
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

// 导航到指定 URL（BrowserView）
ipcMain.handle('navigate-to', async (event, url) => {
  if (shouldSkipScriptInjection(url)) {
    return openManagedChildWindow(url);
  }
  if (browserView) {
    browserView.webContents.loadURL(url);
    return { success: true };
  }
  return { success: false, error: 'No browser view available' };
});

// 导航到登录页
ipcMain.handle('navigate-to-login', async () => {
  await navigateToLoginInternal('ipc');
});

// 跳转到本地 HTML 页面（用于从远程页面跳转到 not-available.html 等本地页面）
ipcMain.handle('navigate-to-local-page', async (event, pageName) => {
  if (browserView) {
    // 解析 query 参数（如 'not-purchase.html?system=geo'）
    const [baseName, queryString] = pageName.split('?');
    const query = {};
    if (queryString) {
      queryString.split('&').forEach(pair => {
        const [key, val] = pair.split('=');
        if (key) query[key] = val || '';
      });
    }

    // 安全检查：只允许跳转到指定的本地页面
    const allowedPages = Object.values(config.placeholderPages);
    if (!allowedPages.includes(baseName)) {
      console.log('[Main] ❌ 不允许跳转到未知页面:', baseName);
      return { success: false, error: '不允许跳转到该页面' };
    }

    console.log('[Main] 跳转到本地页面:', baseName, 'query:', query);
    if (Object.keys(query).length > 0) {
      browserView.webContents.loadFile(path.join(__dirname, baseName), { query });
    } else {
      loadLocalPage(browserView.webContents, baseName);
    }
    return { success: true };
  }
  return { success: false, error: 'browserView 不可用' };
});

// 获取指定域名的所有 Cookies（包括 HttpOnly）
ipcMain.handle('get-domain-cookies', async (event, domain) => {
  try {
    if (!browserView || browserView.webContents.isDestroyed()) {
      return { success: false, error: 'browserView 不可用' };
    }

    const ses = browserView.webContents.session;
    const cookies = await ses.cookies.get({});

    // 过滤指定域名的 cookies
    const domainCookies = cookies.filter(cookie => {
      const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
      return cookieDomain.includes(domain) || domain.includes(cookieDomain);
    });

    // 转换为 cookie 字符串格式：name=value; name2=value2
    // 对包含非 ISO-8859-1 字符的值进行编码，避免 fetch header 报错
    const cookieString = domainCookies.map(c => {
      const value = /[^\x00-\xff]/.test(c.value) ? encodeURIComponent(c.value) : c.value;
      return `${c.name}=${value}`;
    }).join('; ');

    console.log(`[Get Cookies] 获取 ${domain} 的 cookies: ${domainCookies.length} 个`);
    return { success: true, cookies: cookieString, count: domainCookies.length };
  } catch (err) {
    console.error('[Get Cookies] 获取失败:', err);
    return { success: false, error: err.message };
  }
});

// 代理 fetch 请求（自动带上 BrowserView session 的 cookies）
ipcMain.handle('proxy-fetch', async (event, url, options = {}) => {
  try {
    if (!browserView) {
      return { success: false, error: 'BrowserView 不存在' };
    }

    const ses = browserView.webContents.session;

    // 从 session 获取该 URL 对应域名的 cookies（除非 withCookies 为 false）
    const urlObj = new URL(url);
    let cookieString = '';
    if (options.withCookies !== false) {
      const allCookies = await ses.cookies.get({});
      const domain = urlObj.hostname;
      const domainCookies = allCookies.filter(cookie => {
        const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
        return cookieDomain.includes(domain) || domain.includes(cookieDomain);
      });
      cookieString = domainCookies.map(c => {
        const value = /[^\x00-\xff]/.test(c.value) ? encodeURIComponent(c.value) : c.value;
        return `${c.name}=${value}`;
      }).join('; ');
      console.log(`[Proxy Fetch] ${options.method || 'GET'} ${url}, cookies: ${domainCookies.length} 个`);
    } else {
      console.log(`[Proxy Fetch] ${options.method || 'GET'} ${url}, cookies: skipped`);
    }

    // 合并 headers，加上 Cookie 和 User-Agent
    const headers = { ...(options.headers || {}) };
    if (cookieString) {
      headers['Cookie'] = cookieString;
    }
    if (!headers['User-Agent']) {
      headers['User-Agent'] = 'zh.Cloud-browse';
    }

    // 使用 Node.js http/https 发请求
    const result = await new Promise((resolve, reject) => {
      const mod = urlObj.protocol === 'https:' ? https : http;
      const req = mod.request(url, {
        method: options.method || 'GET',
        headers: headers,
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let jsonData;
          try {
            jsonData = JSON.parse(data);
          } catch (e) {
            jsonData = data;
          }
          resolve({
            success: true,
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            data: jsonData,
            cookieString: cookieString || ''
          });
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });

    console.log(`[Proxy Fetch] 响应状态: ${result.status}`);
    return result;
  } catch (err) {
    console.error('[Proxy Fetch] 请求失败:', err);
    return { success: false, error: err.message };
  }
});

// 🔁 跨域代理 fetch（使用调用方 webContents 自己的 session）
// 用于发布脚本跨域请求平台接口（如 card.weibo.com 跨域调 mp.sina.com.cn）
// 与 proxy-fetch（BrowserView session）的区别：这里用调用方窗口的 session，适合发布窗口
ipcMain.handle('proxy-fetch-window-session', async (event, url, options = {}) => {
  try {
    const senderWC = event.sender;
    if (!senderWC || senderWC.isDestroyed()) {
      return { success: false, error: 'webContents 不存在或已销毁' };
    }
    const ses = senderWC.session;
    const urlObj = new URL(url);

    // 取该 URL 域名对应的 cookies
    let cookieString = '';
    if (options.withCookies !== false) {
      const allCookies = await ses.cookies.get({});
      const domain = urlObj.hostname;
      const domainCookies = allCookies.filter(cookie => {
        const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
        return cookieDomain.includes(domain) || domain.includes(cookieDomain);
      });
      cookieString = domainCookies.map(c => {
        const value = /[^\x00-\xff]/.test(c.value) ? encodeURIComponent(c.value) : c.value;
        return `${c.name}=${value}`;
      }).join('; ');
      console.log(`[Proxy Fetch WindowSession] ${options.method || 'GET'} ${url}, cookies: ${domainCookies.length} 个`);
    }

    const headers = { ...(options.headers || {}) };
    if (cookieString) headers['Cookie'] = cookieString;
    if (!headers['User-Agent']) headers['User-Agent'] = senderWC.userAgent || 'zh.Cloud-browse';
    if (!headers['Referer']) headers['Referer'] = `${urlObj.protocol}//${urlObj.hostname}/`;

    const result = await new Promise((resolve, reject) => {
      const mod = urlObj.protocol === 'https:' ? https : http;
      const req = mod.request(url, {
        method: options.method || 'GET',
        headers: headers,
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let jsonData;
          try { jsonData = JSON.parse(data); } catch (e) { jsonData = data; }
          resolve({
            success: true,
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            data: jsonData
          });
        });
      });
      req.on('error', (err) => reject(err));
      if (options.body) req.write(options.body);
      req.end();
    });

    console.log(`[Proxy Fetch WindowSession] 响应状态: ${result.status}`);
    return result;
  } catch (err) {
    console.error('[Proxy Fetch WindowSession] 请求失败:', err);
    return { success: false, error: err.message };
  }
});

// 刷新页面
ipcMain.handle('refresh-page', async () => {
  if (browserView) {
    beginRefreshLoadGuard('正在刷新页面...');
    browserView.webContents.reload();
  }
});

ipcMain.handle('get-browser-loading-state', async () => browserLoadingState);

// 显示全局加载遮罩（隐藏 BrowserView）
ipcMain.handle('show-global-loading', async (event, options = {}) => {
  if (browserView && mainWindow) {
    setBrowserLoadingState({
      visible: true,
      text: options && options.text ? options.text : (browserLoadingState.text || '正在加载页面...')
    });
    console.log('[Loading] 显示全局加载遮罩，隐藏 BrowserView');
    return { success: true };
  }
  return { success: false };
});

// 隐藏全局加载遮罩（恢复 BrowserView）
ipcMain.handle('hide-global-loading', async () => {
  if (browserView && mainWindow) {
    setBrowserLoadingState({ visible: false, text: '正在加载页面...' });
    console.log('[Loading] 隐藏全局加载遮罩，恢复 BrowserView');
    return { success: true };
  }
  return { success: false };
});

// 打开 DevTools
ipcMain.handle('open-devtools', async () => {
  if (browserView) {
    browserView.webContents.openDevTools();
  }
});

// 打开主窗口（公共头部）的 DevTools
ipcMain.handle('open-main-devtools', async () => {
  if (mainWindow) {
    mainWindow.webContents.openDevTools();
  }
});

// 获取当前 URL
ipcMain.handle('get-current-url', async () => {
  if (browserView) {
    return browserView.webContents.getURL();
  }
  return '';
});

// 返回首页
ipcMain.handle('go-home', async () => {
  if (browserView) {
    loadLocalPage(browserView.webContents, 'login.html');
  }
});

// 后退
ipcMain.handle('go-back', async () => {
  if (browserView && browserView.webContents.canGoBack()) {
    browserView.webContents.goBack();
  }
});

// 前进
ipcMain.handle('go-forward', async () => {
  if (browserView && browserView.webContents.canGoForward()) {
    browserView.webContents.goForward();
  }
});

// 从内容页面触发后退（支持 BrowserView 和子窗口）
ipcMain.handle('content-go-back', async (event) => {
  try {
    // 检查是否来自 BrowserView
    if (browserView && event.sender === browserView.webContents) {
      if (browserView.webContents.canGoBack()) {
        browserView.webContents.goBack();
        return { success: true };
      }
      return { success: false, error: 'Cannot go back' };
    }

    // 检查是否来自子窗口
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && senderWindow.webContents.canGoBack()) {
      senderWindow.webContents.goBack();
      return { success: true };
    }

    return { success: false, error: 'Cannot go back' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 从内容页面触发前进（支持 BrowserView 和子窗口）
ipcMain.handle('content-go-forward', async (event) => {
  try {
    // 检查是否来自 BrowserView
    if (browserView && event.sender === browserView.webContents) {
      if (browserView.webContents.canGoForward()) {
        browserView.webContents.goForward();
        return { success: true };
      }
      return { success: false, error: 'Cannot go forward' };
    }

    // 检查是否来自子窗口
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && senderWindow.webContents.canGoForward()) {
      senderWindow.webContents.goForward();
      return { success: true };
    }

    return { success: false, error: 'Cannot go forward' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 从内容页面触发刷新（支持 BrowserView 和子窗口）
ipcMain.handle('content-refresh', async (event) => {
  try {
    // 检查是否来自 BrowserView
    if (browserView && event.sender === browserView.webContents) {
      beginRefreshLoadGuard('正在刷新页面...');
      browserView.webContents.reload();
      return { success: true };
    }

    // 检查是否来自子窗口
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && !senderWindow.isDestroyed()) {
      senderWindow.webContents.reload();
      return { success: true };
    }

    return { success: false, error: 'Cannot refresh' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 检查是否能后退（支持 BrowserView 和子窗口）
ipcMain.handle('content-can-go-back', async (event) => {
  try {
    // 检查是否来自 BrowserView
    if (browserView && event.sender === browserView.webContents) {
      return { canGoBack: browserView.webContents.canGoBack() };
    }

    // 检查是否来自子窗口
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && !senderWindow.isDestroyed()) {
      return { canGoBack: senderWindow.webContents.canGoBack() };
    }

    return { canGoBack: false };
  } catch (err) {
    return { canGoBack: false };
  }
});

// 检查是否能前进（支持 BrowserView 和子窗口）
ipcMain.handle('content-can-go-forward', async (event) => {
  try {
    // 检查是否来自 BrowserView
    if (browserView && event.sender === browserView.webContents) {
      return { canGoForward: browserView.webContents.canGoForward() };
    }

    // 检查是否来自子窗口
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && !senderWindow.isDestroyed()) {
      return { canGoForward: senderWindow.webContents.canGoForward() };
    }

    return { canGoForward: false };
  } catch (err) {
    return { canGoForward: false };
  }
});

// 打开 DevTools（支持 BrowserView 和子窗口）
ipcMain.handle('content-open-devtools', async (event) => {
  try {
    // 检查是否来自 BrowserView
    if (browserView && event.sender === browserView.webContents) {
      browserView.webContents.openDevTools();
      return { success: true };
    }

    // 检查是否来自子窗口
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && !senderWindow.isDestroyed()) {
      senderWindow.webContents.openDevTools();
      return { success: true };
    }

    return { success: false, error: 'Cannot open DevTools' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 设置注入脚本
ipcMain.handle('set-inject-script', async (event, url, script) => {
  return await scriptManager.saveScript(url, script);
});

// 获取已保存的脚本
ipcMain.handle('get-inject-script', async (event, url) => {
  return await scriptManager.getScript(url);
});

// 立即执行脚本（用于测试）
ipcMain.handle('execute-script-now', async (event, script) => {
  if (browserView && script) {
    try {
      await browserView.webContents.executeJavaScript(script);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: 'No script provided' };
});

// 从内容页面发送消息到首页
ipcMain.on('content-to-home', (event, message) => {
  console.log('[IPC] 收到 content-to-home 消息:', message);
  console.log('[IPC] HOME_URLS:', HOME_URLS);

  const messageStr = JSON.stringify(message);

  // 向 BrowserView 发送消息（无论当前是否为首页，让页面自行判断）
  if (browserView && !browserView.webContents.isDestroyed()) {
    browserView.webContents.executeJavaScript(`
      (function() {
        const homeUrls = ${JSON.stringify(HOME_URLS)};
        const currentUrl = window.location.href;
        const isHome = homeUrls.some(url => currentUrl.startsWith(url));
        console.log('[Main→BrowserView] HOME_URLS:', homeUrls);
        console.log('[Main→BrowserView] currentUrl:', currentUrl);
        console.log('[Main→BrowserView] isHome:', isHome);
        if (isHome) {
          console.log('[Main→BrowserView] ✅ 向首页发送消息:', ${messageStr});
          window.postMessage({ type: 'FROM_OTHER_PAGE', data: ${messageStr} }, '*');
        }
      })();
    `).catch(err => console.error('[Main] Failed to send message to home (BrowserView):', err));
  }

  // 同时向所有子窗口广播，让首页自行接收
  childWindows.forEach((childWindow, index) => {
    if (childWindow && !childWindow.isDestroyed()) {
      childWindow.webContents.executeJavaScript(`
        (function() {
          const homeUrls = ${JSON.stringify(HOME_URLS)};
          const currentUrl = window.location.href;
          const isHome = homeUrls.some(url => currentUrl.startsWith(url));
          console.log('[Main→ChildWindow${index}] currentUrl:', currentUrl, 'isHome:', isHome);
          if (isHome) {
            console.log('[Main→ChildWindow${index}] ✅ 向首页发送消息:', ${messageStr});
            window.postMessage({ type: 'FROM_OTHER_PAGE', data: ${messageStr} }, '*');
          }
        })();
      `).catch(err => console.error(`[Main] Failed to send message to child window ${index}:`, err));
    }
  });
});

// 从首页发送消息到其他页面
ipcMain.on('home-to-content', (event, message) => {
  console.log('[IPC] 收到 home-to-content 消息:', message);
  console.log('[IPC] 当前打开的子窗口数量:', childWindows.length);

  // 序列化消息一次，用于日志和传输
  const messageStr = JSON.stringify(message);

  // 向 BrowserView 中的非首页发送消息
  if (browserView) {
    browserView.webContents.executeJavaScript(`
      (function() {
        const homeUrls = ${JSON.stringify(HOME_URLS)};
        const isHome = homeUrls.some(url => window.location.href.startsWith(url));
        console.log('[Main] 检查是否为首页:', window.location.href, 'isHome:', isHome);
        if (!isHome) {
          const messageData = ${messageStr};
          console.log('[Main] 向其他页面发送消息:', messageData);
          window.postMessage({ type: 'FROM_HOME', data: messageData }, '*');
        }
      })();
    `).catch(err => console.error('[Main] Failed to send message to BrowserView:', err));
  }

  // 向所有子窗口广播消息
  childWindows.forEach((childWindow, index) => {
    if (childWindow && !childWindow.isDestroyed()) {
      console.log(`[IPC] 向子窗口 ${index} 发送消息`);
      childWindow.webContents.executeJavaScript(`
        (function() {
          const messageData = ${messageStr};
          console.log('[Child Window] 收到来自首页的消息:', messageData);
          window.postMessage({ type: 'FROM_HOME', data: messageData }, '*');
        })();
      `).catch(err => console.error(`[Main] Failed to send message to child window ${index}:`, err));
    }
  });
});

// 从控制面板转发消息到当前页面
ipcMain.on('main-to-content', (event, message) => {
  if (browserView) {
    browserView.webContents.executeJavaScript(`
      window.postMessage({ type: 'FROM_MAIN', data: ${JSON.stringify(message)} }, '*');
    `).catch(err => console.error('Failed to send message to content:', err));
  }
});

// 调整 BrowserView 大小以适应脚本面板
ipcMain.on('script-panel-toggle', (event, isOpen) => {
  isScriptPanelOpen = isOpen;
  updateBrowserViewBounds(isOpen);
});

// ========== 站点选择弹窗（自定义样式，悬浮在所有内容之上） ==========
let siteMenuWindow = null;

ipcMain.handle('show-site-menu', async (event, sites, currentSiteId) => {
  // 如果已有菜单窗口，先关闭
  if (siteMenuWindow && !siteMenuWindow.isDestroyed()) {
    siteMenuWindow.close();
    siteMenuWindow = null;
    return { selected: false };
  }

  return new Promise((resolve) => {
    // 获取主窗口的内容区域位置（屏幕坐标）
    const contentBounds = mainWindow.getContentBounds();
    const menuWidth = 280;
    const menuHeight = Math.min(sites.length * 56 + 16, 400);

    // 计算菜单位置：对齐站点选择器，header 下方
    const menuX = contentBounds.x + contentBounds.width - menuWidth - 160; // 往左移对齐站点选择器
    const menuY = contentBounds.y + 55; // header 高度 50px + 5px 间距

    console.log('[Site Menu] Creating menu window at:', menuX, menuY);
    console.log('[Site Menu] Content bounds:', contentBounds);

    siteMenuWindow = new BrowserWindow({
      width: menuWidth,
      height: menuHeight,
      x: menuX,
      y: menuY,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true, // 始终在最上层，避免被 BrowserView 挡住
      show: false, // 先不显示，等加载完成后再显示
      parent: mainWindow,
      modal: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    // 加载完成后显示并聚焦
    siteMenuWindow.once('ready-to-show', () => {
      if (siteMenuWindow && !siteMenuWindow.isDestroyed()) {
        siteMenuWindow.show();
        siteMenuWindow.focus();
        console.log('[Site Menu] Window shown');
      }
    });

    // 点击窗口外部时关闭
    siteMenuWindow.on('blur', () => {
      if (siteMenuWindow && !siteMenuWindow.isDestroyed()) {
        siteMenuWindow.close();
        siteMenuWindow = null;
        resolve({ selected: false });
      }
    });

    siteMenuWindow.on('closed', () => {
      siteMenuWindow = null;
    });

    // 监听站点选择
    ipcMain.once('site-selected', (e, siteId, siteName) => {
      if (siteMenuWindow && !siteMenuWindow.isDestroyed()) {
        siteMenuWindow.close();
        siteMenuWindow = null;
      }
      resolve({ selected: true, siteId, siteName });
    });

    // 生成菜单 HTML（过滤无效站点数据）
    const validSites = sites.filter(s => s && typeof s === 'object' && (s.web_name || s.name));
    const sitesJson = JSON.stringify(validSites);
    const menuHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body {
            background: transparent !important;
            overflow: hidden;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
          }
          .menu {
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            padding: 8px 0;
            max-height: 304px;
            overflow-y: auto;
          }
          .menu-item {
            display: flex;
            align-items: center;
            padding: 12px 16px;
            cursor: pointer;
            transition: background 0.15s;
          }
          .menu-item:hover {
            background: #F5F7FA;
          }
          .menu-item.active {
            background: #ECF5FF;
          }
          .site-icon {
            width: 28px;
            height: 28px;
            border-radius: 6px;
            background: #E4E7ED;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
            color: #909399;
            margin-right: 12px;
            flex-shrink: 0;
          }
          .menu-item.active .site-icon {
            background: #409EFF;
            color: #fff;
          }
          .site-name {
            flex: 1;
            font-size: 14px;
            color: #303133;
            word-break: break-all;
          }
          .menu-item.active .site-name {
            color: #409EFF;
            font-weight: 500;
          }
          .check-icon {
            width: 16px;
            height: 16px;
            margin-left: 8px;
            opacity: 0;
          }
          .menu-item.active .check-icon {
            opacity: 1;
          }
        </style>
      </head>
      <body>
        <div class="menu" id="menu"></div>
        <script>
          const { ipcRenderer } = require('electron');
          const sites = ${sitesJson};
          console.log("🚀 ~  ~ sites: ", sites);
          const currentSiteId = ${JSON.stringify(currentSiteId)};

          const menu = document.getElementById('menu');
          sites.forEach(site => {
            const item = document.createElement('div');
            item.className = 'menu-item' + (site.id === currentSiteId ? ' active' : '');
            const siteName = site.web_name || site.name || '';
            item.innerHTML = \`
              <div class="site-icon">\${siteName.charAt(0)}</div>
              <span class="site-name" title="\${siteName}">\${siteName}</span>
              <svg class="check-icon" viewBox="0 0 1024 1024" fill="#409EFF">
                <path d="M912 190h-69.9c-9.8 0-19.1 4.5-25.1 12.2L404.7 724.5 207 474a32 32 0 0 0-25.1-12.2H112c-6.7 0-10.4 7.7-6.3 12.9l273.9 347c12.8 16.2 37.4 16.2 50.3 0l488.4-618.9c4.1-5.1.4-12.8-6.3-12.8z"/>
              </svg>
            \`;
            item.onclick = () => {
              ipcRenderer.send('site-selected', site.id, siteName);
            };
            menu.appendChild(item);
          });
        </script>
      </body>
      </html>
    `;

    siteMenuWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(menuHtml)}`);
  });
});

// 用户菜单窗口
let userMenuWindow = null;

ipcMain.handle('show-user-menu', async (event) => {
  // 如果已有菜单窗口，先关闭
  if (userMenuWindow && !userMenuWindow.isDestroyed()) {
    userMenuWindow.close();
    userMenuWindow = null;
    return { selected: false };
  }

  return new Promise((resolve) => {
    let settled = false;
    let acting = false; // 切换分支主动关窗时，抑制 blur 误触发 finish
    const contentBounds = mainWindow.getContentBounds();
    const menuWidth = 248;

    // 工具函数
    const escapeHtml = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const maskPhoneForMenu = (phone) => {
      const digits = String(phone || '').replace(/\D/g, '');
      if (digits.length === 11) return digits.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
      return phone || '';
    };
    // 默认头像（内联 SVG，避免 data: 页面无法解析相对路径）
    const DEFAULT_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#EBEEF5"/><circle cx="20" cy="16" r="7" fill="#C0C4CC"/><path d="M6 37c0-8 6-13 14-13s14 5 14 13" fill="#C0C4CC"/></svg>'
    );

    // 读取并构造账号列表（脱敏，绝不含密码）
    const buildAccountList = () => {
      const accounts = Array.isArray(globalStorage.saved_accounts) ? globalStorage.saved_accounts : [];
      const userInfo = globalStorage.user_info || {};
      const curUid = String(userInfo.unique_id || userInfo.uid || '');
      const curPhone = String(userInfo.phone || userInfo.mobile || userInfo.tel || '');
      const curName = String(userInfo.user_name || userInfo.username || userInfo.account || '');
      return accounts.map((acc, index) => {
        const phone = String(acc.phone || '');
        const name = acc.nickname || maskPhoneForMenu(acc.phone) || acc.username || '账号';
        const subRaw = maskPhoneForMenu(acc.phone) || acc.username || '';
        const accUid = String(acc.uid || '');
        // 优先用后端稳定主键 uid 判定当前账号，phone/username 仅作降级兜底
        const isCurrent = (!!curUid && !!accUid && curUid === accUid)
          || (!!curPhone && !!phone && curPhone === phone)
          || (!!curName && !!acc.username && curName === acc.username);
        return {
          index,
          name,
          sub: (subRaw && subRaw !== name) ? subRaw : '',
          avatar: acc.avatar || '',
          isCurrent
        };
      });
    };

    // 动态高度：每项 54，分隔线 9，退出 44，容器内边距 12，账号区最多显示 6 项
    const computeHeight = (count) => {
      const visible = Math.min(count, 6);
      return visible * 54 + (count > 0 ? 9 : 0) + 44 + 12;
    };

    // 生成菜单 HTML
    const buildMenuHtml = (list) => {
      const itemsHtml = list.map((a) => {
        const av = a.avatar ? escapeHtml(a.avatar) : DEFAULT_AVATAR;
        const rowAttr = a.isCurrent ? '' : ` data-action="switch:${a.index}"`;
        const badge = a.isCurrent ? '<span class="acc-badge">当前</span>' : '';
        const subHtml = a.sub ? `<div class="acc-sub">${escapeHtml(a.sub)}</div>` : '';
        return `
          <div class="acc-item${a.isCurrent ? ' current' : ''}"${rowAttr}>
            <img class="acc-avatar" src="${av}" onerror="this.onerror=null;this.src='${DEFAULT_AVATAR}'">
            <div class="acc-info">
              <div class="acc-name">${escapeHtml(a.name)}${badge}</div>
              ${subHtml}
            </div>
            <div class="acc-del" data-action="remove:${a.index}" title="删除此账号">×</div>
          </div>`;
      }).join('');
      const accountSection = list.length
        ? `<div class="acc-list">${itemsHtml}</div><div class="divider"></div>`
        : '';
      return `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            html, body { background: transparent !important; overflow: hidden; }
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
            .menu { background: #fff; border-radius: 10px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16); padding: 6px; }
            .acc-list { max-height: 324px; overflow-y: auto; }
            .acc-item { display: flex; align-items: center; padding: 8px 10px; border-radius: 8px; cursor: pointer; gap: 10px; transition: background 0.15s; }
            .acc-item:hover { background: #F5F7FA; }
            .acc-item.current, .acc-item.current:hover { cursor: default; background: transparent; }
            .acc-avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; background: #EBEEF5; flex-shrink: 0; }
            .acc-info { flex: 1; min-width: 0; }
            .acc-name { font-size: 14px; color: #303133; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px; }
            .acc-badge { font-size: 11px; color: #3E7AFF; background: #ECF3FF; border-radius: 4px; padding: 1px 5px; flex-shrink: 0; }
            .acc-sub { font-size: 12px; color: #909399; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .acc-del { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #C0C4CC; flex-shrink: 0; font-size: 18px; line-height: 1; }
            .acc-del:hover { background: #FEF0F0; color: #F56C6C; }
            .divider { height: 1px; background: #F0F0F0; margin: 4px 8px; }
            .menu-item { display: flex; align-items: center; padding: 10px 12px; border-radius: 8px; cursor: pointer; transition: background 0.15s; font-size: 14px; color: #F56C6C; gap: 8px; }
            .menu-item:hover { background: #FEF0F0; }
            .menu-item svg { width: 16px; height: 16px; }
          </style>
        </head>
        <body>
          <div class="menu">
            ${accountSection}
            <div class="menu-item" data-action="logout">
              <svg viewBox="0 0 1024 1024" fill="#F56C6C">
                <path d="M868.352 495.616l-160-160a32 32 0 0 0-45.248 45.248L761.376 479.136l-409.376 0a32 32 0 0 0 0 64l409.376 0-98.272 98.272a32 32 0 1 0 45.248 45.248l160-160a32 32 0 0 0 0-45.248z"/>
                <path d="M448 800 224 800 224 224l224 0a32 32 0 0 0 0-64L192 160a32 32 0 0 0-32 32l0 640a32 32 0 0 0 32 32l256 0a32 32 0 0 0 0-64z"/>
              </svg>
              <span>退出登录</span>
            </div>
          </div>
          <script>
            const { ipcRenderer } = require('electron');
            document.querySelectorAll('[data-action]').forEach(function (el) {
              el.addEventListener('click', function (ev) {
                ev.stopPropagation();
                ipcRenderer.send('user-menu-action', el.getAttribute('data-action'));
              });
            });
          </script>
        </body>
        </html>
      `;
    };

    const cleanup = () => {
      ipcMain.removeListener('user-menu-action', onAction);
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      acting = false;
      cleanup();
      if (userMenuWindow && !userMenuWindow.isDestroyed()) {
        userMenuWindow.close();
        userMenuWindow = null;
      }
      resolve(result);
    };

    // 渲染（含尺寸/位置），window 已存在时为原地刷新
    const renderMenu = () => {
      const list = buildAccountList();
      const menuHeight = computeHeight(list.length);
      const menuX = contentBounds.x + contentBounds.width - menuWidth - 12;
      const menuY = contentBounds.y + 55;
      if (userMenuWindow && !userMenuWindow.isDestroyed()) {
        userMenuWindow.setBounds({ x: menuX, y: menuY, width: menuWidth, height: menuHeight });
        userMenuWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildMenuHtml(list))}`);
      }
      return { menuX, menuY, menuHeight };
    };

    // 菜单动作处理（可重复响应：删除后原地刷新并重新挂载监听）
    const onAction = async (e, action) => {
      try {
        if (action === 'logout') {
          finish({ selected: true, action: 'logout' });
          return;
        }

        if (typeof action === 'string' && action.startsWith('switch:')) {
          acting = true; // 抑制下方主动 close 触发的 blur
          const index = parseInt(action.slice(7), 10);
          // 先关闭浮层，避免与确认弹窗争夺焦点
          if (userMenuWindow && !userMenuWindow.isDestroyed()) {
            userMenuWindow.close();
            userMenuWindow = null;
          }
          const accounts = Array.isArray(globalStorage.saved_accounts) ? globalStorage.saved_accounts : [];
          const acc = accounts[index];
          if (!acc || !acc.username) {
            finish({ selected: false, action: null });
            return;
          }
          const display = acc.nickname || maskPhoneForMenu(acc.phone) || acc.username || '该账号';
          const { response } = await dialog.showMessageBox(mainWindow, {
            type: 'question',
            buttons: ['取消', '确定切换'],
            defaultId: 1,
            cancelId: 0,
            title: '切换账号',
            message: `确定切换到「${display}」吗？`,
            detail: '将退出当前账号，并使用所选账号自动重新登录。'
          });
          if (response === 1) {
            // 清理上一个账号残留数据（navigateToLoginInternal 未覆盖的部分），确保切换干净
            delete globalStorage.company_id;
            delete globalStorage.siteInfo;
            delete globalStorage.current_site;
            globalStorage.pending_switch_account = {
              username: acc.username,
              password: acc.password,
              tab: acc.tab || 'aigc',
              ts: Date.now()
            };
            saveGlobalStorage();
            console.log('[User Menu] 切换账号 →', maskSensitive(acc.username));
            await navigateToLoginInternal('switch_account');
            finish({ selected: true, action: 'switch' });
          } else {
            finish({ selected: false, action: null });
          }
          return;
        }

        if (typeof action === 'string' && action.startsWith('remove:')) {
          const index = parseInt(action.slice(7), 10);
          // 注：saved_accounts 为读改写全量；login.html(登录页) 与本菜单(已登录态) 不会同时存在，无并发写
          const accounts = Array.isArray(globalStorage.saved_accounts) ? globalStorage.saved_accounts : [];
          if (index >= 0 && index < accounts.length) {
            const removed = accounts.splice(index, 1)[0];
            globalStorage.saved_accounts = accounts;
            saveGlobalStorage();
            console.log('[User Menu] 删除已保存账号:', removed ? maskSensitive(removed.username) : index);
          }
          // 原地刷新并重新挂载监听（窗口保持打开）
          // loadURL 会重建 data: 页渲染进程，期间可能瞬时失焦，用 acting 抑制 blur 误关菜单
          acting = true;
          ipcMain.once('user-menu-action', onAction);
          renderMenu();
          setTimeout(() => { acting = false; }, 200);
          return;
        }

        // 未知动作：重新挂载监听，避免菜单失效
        ipcMain.once('user-menu-action', onAction);
      } catch (err) {
        console.error('[User Menu] 处理动作失败:', err);
        finish({ selected: false, action: null });
      }
    };

    // 初始尺寸与位置
    const list0 = buildAccountList();
    const initHeight = computeHeight(list0.length);
    const initX = contentBounds.x + contentBounds.width - menuWidth - 12;
    const initY = contentBounds.y + 55;
    console.log('[User Menu] Creating menu window at:', initX, initY, '账号数:', list0.length);

    userMenuWindow = new BrowserWindow({
      width: menuWidth,
      height: initHeight,
      x: initX,
      y: initY,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      parent: mainWindow,
      modal: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    userMenuWindow.once('ready-to-show', () => {
      if (userMenuWindow && !userMenuWindow.isDestroyed()) {
        userMenuWindow.show();
        userMenuWindow.focus();
      }
    });

    userMenuWindow.on('blur', () => {
      // 失焦关闭（删除原地刷新不关窗；切换分支主动关窗时 acting=true 抑制误触发）
      if (acting) return;
      finish({ selected: false, action: null });
    });

    userMenuWindow.on('closed', () => {
      userMenuWindow = null;
    });

    ipcMain.once('user-menu-action', onAction);

    userMenuWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildMenuHtml(list0))}`);
  });
});

// 公司切换菜单窗口
let companyMenuWindow = null;

ipcMain.handle('show-company-menu', async (event, companies, currentUniqueId) => {
  // 如果已有菜单窗口，先关闭
  if (companyMenuWindow && !companyMenuWindow.isDestroyed()) {
    companyMenuWindow.close();
    companyMenuWindow = null;
    return { selected: false };
  }

  return new Promise((resolve) => {
    const contentBounds = mainWindow.getContentBounds();
    const menuWidth = 320;
    const menuHeight = Math.min(companies.length * 56 + 16, 400);

    // 计算菜单位置：对齐公司切换按钮
    const menuX = contentBounds.x + contentBounds.width - menuWidth - 300;
    const menuY = contentBounds.y + 55;

    console.log('[Company Menu] Creating menu window at:', menuX, menuY);

    companyMenuWindow = new BrowserWindow({
      width: menuWidth,
      height: menuHeight,
      x: menuX,
      y: menuY,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      parent: mainWindow,
      modal: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    companyMenuWindow.once('ready-to-show', () => {
      if (companyMenuWindow && !companyMenuWindow.isDestroyed()) {
        companyMenuWindow.show();
        companyMenuWindow.focus();
        console.log('[Company Menu] Window shown');
      }
    });

    companyMenuWindow.on('blur', () => {
      if (companyMenuWindow && !companyMenuWindow.isDestroyed()) {
        companyMenuWindow.close();
        companyMenuWindow = null;
        resolve({ selected: false });
      }
    });

    companyMenuWindow.on('closed', () => {
      companyMenuWindow = null;
    });

    ipcMain.once('company-selected', (e, uniqueId, companyName) => {
      if (companyMenuWindow && !companyMenuWindow.isDestroyed()) {
        companyMenuWindow.close();
        companyMenuWindow = null;
      }
      resolve({ selected: true, uniqueId, companyName });
    });

    const validCompanies = companies.filter(c => c && typeof c === 'object' && (c.name || c.abbreviation));
    const companiesJson = JSON.stringify(validCompanies);
    const menuHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body {
            background: transparent !important;
            overflow: hidden;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
          }
          .menu {
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            padding: 8px 0;
            max-height: 384px;
            overflow-y: auto;
          }
          .menu-item {
            display: flex;
            align-items: center;
            padding: 12px 16px;
            cursor: pointer;
            transition: background 0.15s;
          }
          .menu-item:hover {
            background: #F5F7FA;
          }
          .menu-item.active {
            background: #FFF7ED;
          }
          .company-logo {
            width: 28px;
            height: 28px;
            border-radius: 6px;
            background: #E4E7ED;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
            color: #909399;
            margin-right: 12px;
            flex-shrink: 0;
            overflow: hidden;
          }
          .company-logo img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }
          .menu-item.active .company-logo {
            background: #FF8C00;
            color: #fff;
          }
          .company-name {
            flex: 1;
            font-size: 14px;
            color: #303133;
            word-break: break-all;
          }
          .menu-item.active .company-name {
            color: #FF8C00;
            font-weight: 500;
          }
          .check-icon {
            width: 16px;
            height: 16px;
            margin-left: 8px;
            opacity: 0;
          }
          .menu-item.active .check-icon {
            opacity: 1;
          }
        </style>
      </head>
      <body>
        <div class="menu" id="menu"></div>
        <script>
          const { ipcRenderer } = require('electron');
          const companies = ${companiesJson};
          const currentUniqueId = ${JSON.stringify(currentUniqueId)};

          const menu = document.getElementById('menu');
          companies.forEach(company => {
            const item = document.createElement('div');
            item.className = 'menu-item' + (company.unique_id === currentUniqueId ? ' active' : '');
            const displayName = company.abbreviation || company.name || '';
            const logoHtml = company.logo
              ? '<img src="' + company.logo + '" alt="">'
              : displayName.charAt(0);
            item.innerHTML =
              '<div class="company-logo">' + logoHtml + '</div>' +
              '<span class="company-name" title="' + (company.name || '') + '">' + displayName + '</span>' +
              '<svg class="check-icon" viewBox="0 0 1024 1024" fill="#FF8C00">' +
                '<path d="M912 190h-69.9c-9.8 0-19.1 4.5-25.1 12.2L404.7 724.5 207 474a32 32 0 0 0-25.1-12.2H112c-6.7 0-10.4 7.7-6.3 12.9l273.9 347c12.8 16.2 37.4 16.2 50.3 0l488.4-618.9c4.1-5.1.4-12.8-6.3-12.8z"/>' +
              '</svg>';
            item.onclick = () => {
              ipcRenderer.send('company-selected', company.unique_id, displayName);
            };
            menu.appendChild(item);
          });
        </script>
      </body>
      </html>
    `;

    companyMenuWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(menuHtml));
  });
});

function isShipinhaoPublishPageUrl(rawUrl = '') {
  try {
    const parsedUrl = new URL(rawUrl);
    return String(parsedUrl.hostname || '').toLowerCase() === 'channels.weixin.qq.com'
      && String(parsedUrl.pathname || '').toLowerCase().includes('/platform/post/create');
  } catch (_) {
    return String(rawUrl || '').toLowerCase().includes('channels.weixin.qq.com/platform/post/create');
  }
}

async function inspectShipinhaoPublishVisualState(targetWebContents) {
  if (!targetWebContents || targetWebContents.isDestroyed()) {
    return { ready: false, reason: 'webContents-destroyed' };
  }

  try {
    return await targetWebContents.executeJavaScript(`
      (() => {
        const publishSelectors = [
          '.post-short-title-wrap',
          '.input-editor',
          '.form-btns',
          '.weui-desktop-btn',
          '.post-time-wrap',
          '.ant-progress-text',
          '.ant-progress',
          '.upload-wrapper',
          '#fullScreenVideo',
          'input[type="file"]'
        ];
        const hasVisibleElement = (el) => {
          try {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none'
              && style.visibility !== 'hidden'
              && Number(style.opacity || '1') !== 0
              && rect.width >= 8
              && rect.height >= 8;
          } catch (_) {
            return false;
          }
        };

        const wujieApp = document.querySelector('wujie-app');
        const shadowRoot = wujieApp && wujieApp.shadowRoot ? wujieApp.shadowRoot : null;
        const roots = shadowRoot ? [document, shadowRoot] : [document];
        let hitSelector = '';
        for (const selector of publishSelectors) {
          if (roots.some(root => root.querySelector(selector))) {
            hitSelector = selector;
            break;
          }
        }

        let visibleElementCount = 0;
        roots.forEach(root => {
          Array.from(root.querySelectorAll('*')).slice(0, 180).forEach(el => {
            if (hasVisibleElement(el)) {
              visibleElementCount += 1;
            }
          });
        });

        const bodyTextLength = document.body ? (document.body.innerText || '').trim().length : 0;
        const bodyHtmlLength = document.body ? document.body.innerHTML.length : 0;
        const ready = !!hitSelector || visibleElementCount >= 3 || bodyTextLength >= 20;
        return {
          ready,
          reason: ready ? 'visual-ready' : 'visual-not-ready',
          href: location.href,
          readyState: document.readyState,
          bodyHtmlLength,
          bodyTextLength,
          visibleElementCount,
          wujieApp: !!wujieApp,
          shadowRoot: !!shadowRoot,
          shadowChildren: shadowRoot ? shadowRoot.childElementCount : 0,
          hitSelector: hitSelector || '无'
        };
      })()
    `, true);
  } catch (error) {
    return {
      ready: false,
      reason: 'inspect-error',
      error: error && error.message ? error.message : String(error)
    };
  }
}

async function waitForShipinhaoPublishVisualReady(targetWindow, timeoutMs = 12000, intervalMs = 700) {
  const startedAt = Date.now();
  let lastSnapshot = null;

  while (Date.now() - startedAt < timeoutMs) {
    if (!targetWindow || targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
      return { ready: false, reason: 'window-destroyed', snapshot: lastSnapshot };
    }

    let currentUrl = '';
    try {
      currentUrl = targetWindow.webContents.getURL();
    } catch (_) {}

    if (!isShipinhaoPublishPageUrl(currentUrl)) {
      return { ready: true, reason: 'navigated-away', currentUrl, snapshot: lastSnapshot };
    }

    lastSnapshot = await inspectShipinhaoPublishVisualState(targetWindow.webContents);
    if (lastSnapshot.ready) {
      console.warn('[Shipinhao BlankGuard] 发布页可见内容已就绪:', lastSnapshot);
      return { ready: true, reason: 'visual-ready', snapshot: lastSnapshot };
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  console.warn('[Shipinhao BlankGuard] 等待发布页可见内容超时，仍显示窗口；页面侧保留一次刷新兜底:', lastSnapshot);
  return { ready: false, reason: 'timeout', snapshot: lastSnapshot };
}

// 统一的新窗口创建逻辑
// options.useTemporarySession: true 时使用临时 session（不保存登录状态，用于授权页）
// options.platform + options.accountId: 使用指定账号的持久化 session（多账号模式）
async function openManagedChildWindow(url, options = {}) {
  if (!url) {
    return { success: false, error: 'No URL provided' };
  }

  // 🔑 视频号登录重置只在显式 reset 参数下执行。
  // 普通发布窗口掉到 channels.weixin.qq.com/login.html 时不能自动追加 force_reset，
  // 否则会清掉刚恢复的账号 session，并触发登录页 reload 打断扫码。
  // 仅匹配 channels.weixin.qq.com（视频号），不影响 mp.weixin.qq.com（公众号）等其他子域。
  const shipinhaoLoginResetUrl = buildShipinhaoLoginForceResetUrl(url);
  if (shipinhaoLoginResetUrl) {
    url = shipinhaoLoginResetUrl;
    console.log('[Window Manager] 🔧 视频号登录显式重置 URL 追加 force_reset=1:', url);
  }

  const isShipinhaoPublishUrl = isShipinhaoPublishPageUrl(url);

  // ⏱ 全链路阶段性耗时基准时间
  const __WM_T0__ = Date.now();
  const __wmTs = () => `T+${Date.now() - __WM_T0__}ms`;
  let publishLoadingWindow = null;
  const closePublishLoadingWindow = (reason) => {
    if (publishLoadingWindow && !publishLoadingWindow.isDestroyed()) {
      console.log(`[Window Manager][${__wmTs()}] 🧹 关闭发布 loading 窗口 (${reason})`);
      publishLoadingWindow.destroy();
    }
    publishLoadingWindow = null;
  };

  try {
    const appIcon = nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));

    // 根据参数决定使用哪个 session
    // 优先级：platform + accountId > useTemporarySession > 默认持久化 session
    let windowSession;
    let sessionType = 'default';

    // 调试日志：打印完整的 options
    console.log('[Window Manager] ========== 收到 open-new-window 请求 ==========');
    console.log(`[Window Manager][${__wmTs()}] 🕐 入口时间: ${new Date().toLocaleString()}`);
    console.log('[Window Manager] URL:', url);
    console.log('[Window Manager] options:', JSON.stringify(options, null, 2));
    console.log('[Window Manager] options.platform:', options.platform);
    console.log('[Window Manager] options.accountId:', options.accountId);
    console.log('[Window Manager] options.sessionData:', options.sessionData ? '有数据' : '无数据');
    const isBareToutiao = shouldSkipScriptInjection(url);
    if (isBareToutiao) {
      console.log('[Window Manager] 🧼 Toutiao 裸窗口，跳过 preload 和脚本注入');
    }
    const shouldShowPublishLoadingWindow = !!options.publishData && !options.useTemporarySession;
    if (shouldShowPublishLoadingWindow) {
      publishLoadingWindow = createPublishLoadingWindow(options);
      console.log(`[Window Manager][${__wmTs()}] 🎬 已打开发布 loading 窗口，后台准备真实发布窗口`);
      // 🪄 步骤联动：默认从「恢复账号登录状态」开始
      publishLoadingWindow?.activateStep?.(0);
    }

    if (options.platform && options.accountId) {
      // 多账号模式：使用指定账号的持久化 session
      windowSession = getAccountSession(options.platform, options.accountId);
      sessionType = 'account';
      console.log(`[Window Manager] 使用账号 session: ${options.platform}/${options.accountId}`);
      console.log(`[Window Manager] options.sessionData 存在: ${!!options.sessionData}`);
      console.log(`[Window Manager] options.sessionData 类型: ${typeof options.sessionData}`);
      if (options.sessionData) {
        console.log(`[Window Manager] options.sessionData 是数组: ${Array.isArray(options.sessionData)}`);
        if (Array.isArray(options.sessionData)) {
          console.log(`[Window Manager] options.sessionData 长度: ${options.sessionData.length}`);
        }
      }

      const backendAccountId = getPublishBackendAccountId(options.publishData);
      const cachedSessionData = getLatestSessionCache(options.platform, backendAccountId);
      const sessionRestore = buildEffectiveSessionRestoreData(cachedSessionData, options.sessionData);
      const effectiveSessionData = sessionRestore.sessionData;
      const effectiveSessionSource = sessionRestore.source;
      options.sessionData = effectiveSessionData;
      if (cachedSessionData) {
        console.log(`[Window Manager] ✅ 命中本地最新会话缓存: platform=${options.platform}, backendAccountId=${backendAccountId}`);
      }
      console.log(`[Window Manager] 当前会话恢复来源: ${effectiveSessionSource}`);
      if (effectiveSessionData && options.publishData?.element && typeof options.publishData.element === 'object') {
        try {
          const serializedEffectiveSession = typeof effectiveSessionData === 'string'
            ? effectiveSessionData
            : JSON.stringify(effectiveSessionData);
          options.publishData = {
            ...options.publishData,
            element: {
              ...options.publishData.element,
              cookies: serializedEffectiveSession
            }
          };
          console.log(`[Window Manager] 🔄 已将实际使用的会话快照回写到 publishData.element.cookies, source=${effectiveSessionSource}`);
        } catch (serializeErr) {
          console.warn('[Window Manager] ⚠️ 回写 publishData.element.cookies 失败:', serializeErr.message);
        }
      }

      // 如果提供了 sessionData，先清空旧的 cookies，再恢复新的会话数据
      if (effectiveSessionData) {
        console.log('[Window Manager] ========== 检测到 sessionData，开始自动清空并恢复会话数据 ==========');

        // 🛡️ 本地优先策略：检查本地 session 是否已有有效登录态
        // 场景：用户在发布窗口手动登录后，新 cookies 可能未及时同步到后台
        // 如果本地登录态有效且账号匹配，跳过 sessionData 覆盖，避免擦掉本地最新登录态
        let shouldSkipSessionRestore = false;
        const shouldForceIncomingSessionRestore = !!cachedSessionData
          && String(effectiveSessionSource || '').startsWith('incoming');
        try {
          const localHasLogin = await hasValidLoginCookies(windowSession, options.platform);
          if (localHasLogin) {
            // 多账号模式：persist:<platform>_<accountId> 是该账号专属空间
            // 该 session 内一旦存在有效登录态，必然是该账号最新的登录信息
            // （重新授权时已通过 migrate-cookies-to-account-session 写入新 cookies）
            // 所以无需再比对 element.cookies 里可能过期的身份 cookie 字面值
            const isMultiAccountMode = !!(options.platform && options.accountId);
            if (isMultiAccountMode) {
              const identityMatch = await matchAccountIdentity(windowSession, effectiveSessionData, options.platform);
              if (identityMatch === false) {
                console.log(`[Window Manager] 🔄 多账号模式检测到本地 session 与后台 sessionData 身份不一致，走清空恢复 (platform=${options.platform}, accountId=${options.accountId})`);
              } else if (shouldForceIncomingSessionRestore) {
                console.log(`[Window Manager] 🔄 多账号模式比较结果选择后台/传入会话 (${effectiveSessionSource})，不跳过 sessionData 恢复`);
              } else {
                shouldSkipSessionRestore = true;
                const matchDesc = identityMatch === true ? '身份匹配' : '身份无法验证（保守保留本地）';
                console.log(`[Window Manager] 🛡️ 多账号模式本地登录态有效且${matchDesc}，跳过 sessionData 清空恢复 (platform=${options.platform}, accountId=${options.accountId})`);
              }
            } else {
              const identityMatch = await matchAccountIdentity(windowSession, effectiveSessionData, options.platform);
              if (identityMatch !== false && !shouldForceIncomingSessionRestore) {
                shouldSkipSessionRestore = true;
                const matchDesc = identityMatch === true ? '匹配' : '无法验证（保守保留本地）';
                console.log(`[Window Manager] 🛡️ 本地登录态有效且账号${matchDesc}，跳过 sessionData 清空恢复`);
              } else {
                const reason = identityMatch === false
                  ? '检测到换账号（身份 cookie 不匹配）'
                  : `比较结果选择后台/传入会话 (${effectiveSessionSource})`;
                console.log(`[Window Manager] 🔄 ${reason}，走 sessionData 清空恢复`);
              }
            }
          } else {
            console.log('[Window Manager] ℹ️ 本地无登录态，走 sessionData 清空恢复');
          }
        } catch (preCheckErr) {
          console.warn('[Window Manager] ⚠️ 本地登录态预检异常，按原流程清空恢复:', preCheckErr.message);
        }

        if (shouldSkipSessionRestore) {
          console.log('[Window Manager] ⏭️ 已跳过 sessionData 清空恢复，沿用本地永久 session');
          // 🪄 本地登录态有效，前两步视作已就绪，进入「加载目标发布页面」
          publishLoadingWindow?.finishStep?.(0);
          publishLoadingWindow?.finishStep?.(1);
          publishLoadingWindow?.activateStep?.(2);
        } else {
        try {
          // 1. 清空该账号的所有 cookies
          const cookies = await windowSession.cookies.get({});
          console.log(`[Window Manager] 找到 ${cookies.length} 个旧 cookies，开始清空...`);

          let deletedCount = 0;
          for (const cookie of cookies) {
            try {
              const protocol = cookie.secure ? 'https' : 'http';
              const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
              const cookieUrl = `${protocol}://${domain}${cookie.path || '/'}`;
              await windowSession.cookies.remove(cookieUrl, cookie.name);
              deletedCount++;
            } catch (err) {
              console.error(`[Window Manager] 删除 cookie 失败 (${cookie.name}):`, err.message);
            }
          }
          console.log(`[Window Manager][${__wmTs()}] ✅ cookies 清空完成，删除了 ${deletedCount} 个`);

          // 2. 恢复新的会话数据
          // 支持多种数据格式：
          // - 格式1: {cookies: [{...}, ...]} - getFullSessionData 返回的格式
          // - 格式2: [{...}, ...] - 直接的 cookies 数组
          // - 格式3: ["{...}", ...] - JSON 字符串数组（每个字符串是一个 cookie）
          // - 格式4: ["{domain, timestamp, cookies: [...]}"] - 包装的 session 数据（element.cookies 的实际格式）
          let sessionData = cloneSerializable(effectiveSessionData);

          // 如果是字符串，先尝试解析（可能需要解析多次，因为可能有双重 JSON 编码）
          if (typeof sessionData === 'string') {
            console.log('[Window Manager] sessionData 是字符串，长度:', sessionData.length);
            console.log('[Window Manager] sessionData 前100字符:', sessionData.substring(0, 100));
            try {
              sessionData = JSON.parse(sessionData);
              // 检查是否还是字符串（双重编码）
              if (typeof sessionData === 'string') {
                console.log('[Window Manager] 检测到双重 JSON 编码，再次解析...');
                sessionData = JSON.parse(sessionData);
              }
            } catch (parseErr) {
              console.error('[Window Manager] ❌ sessionData 解析失败:', parseErr.message);
              throw new Error('会话数据解析失败: ' + parseErr.message);
            }
          }

          console.log('[Window Manager] 解析后 sessionData 类型:', typeof sessionData);
          console.log('[Window Manager] 解析后 sessionData 是数组:', Array.isArray(sessionData));
          if (sessionData && typeof sessionData === 'object' && !Array.isArray(sessionData)) {
            console.log('[Window Manager] sessionData keys:', Object.keys(sessionData));
            console.log('[Window Manager] sessionData.domain:', sessionData.domain);
            console.log('[Window Manager] sessionData.cookies 存在:', !!sessionData.cookies);
            console.log('[Window Manager] sessionData.cookies 是数组:', Array.isArray(sessionData.cookies));
            if (Array.isArray(sessionData.cookies)) {
              console.log('[Window Manager] sessionData.cookies 长度:', sessionData.cookies.length);
            }
          }

          const hasStoragePayload =
            !isShipinhaoPublishUrl
            &&
            !!(sessionData
              && typeof sessionData === 'object'
              && !Array.isArray(sessionData)
              && (
                (sessionData.localStorage && Object.keys(sessionData.localStorage).length > 0)
                || (sessionData.sessionStorage && Object.keys(sessionData.sessionStorage).length > 0)
                || (sessionData.indexedDB && Object.keys(sessionData.indexedDB).length > 0)
              ));

          // 1.5 🔑 只有快照里真的带了 storage 数据，才值得做一次重清理
          if (isShipinhaoPublishUrl) {
            console.log(`[Window Manager][${__wmTs()}] ⏭️ 视频号发布页跳过 storage 清理，仅恢复 cookies，避免目标页加载阶段崩溃`);
          } else if (hasStoragePayload) {
            try {
              await windowSession.clearStorageData({
                storages: ['appcache', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cachestorage']
              });
              console.log(`[Window Manager][${__wmTs()}] ✅ 其他 storage 已彻底清理 (localstorage/indexdb/serviceworkers/cachestorage 等)`);
            } catch (clearErr) {
              console.warn(`[Window Manager][${__wmTs()}] ⚠️ storage 清理异常: ${clearErr.message}`);
            }
          } else {
            console.log(`[Window Manager][${__wmTs()}] ℹ️ 当前会话快照不含 storage 数据，跳过 clearStorageData`);
          }

          // 获取 cookies 数组
          let cookiesArray = [];

          if (Array.isArray(sessionData)) {
            console.log('[Window Manager] sessionData 是数组，长度:', sessionData.length);

            // 检查数组第一个元素来判断格式
            if (sessionData.length > 0) {
              let firstItem = sessionData[0];

              // 如果第一个元素是字符串，先解析
              if (typeof firstItem === 'string') {
                try {
                  firstItem = JSON.parse(firstItem);
                  console.log('[Window Manager] 解析后的第一个元素 keys:', Object.keys(firstItem));
                } catch (e) {
                  console.error('[Window Manager] 第一个元素解析失败');
                }
              }

              // 格式4: 解析后的对象包含 cookies 字段（这是 element.cookies 的实际格式）
              if (firstItem && firstItem.cookies && Array.isArray(firstItem.cookies)) {
                console.log('[Window Manager] 检测到数据格式4: [{domain, timestamp, cookies: [...]}]');
                // 遍历所有元素，提取 cookies
                for (let item of sessionData) {
                  let parsed = item;
                  if (typeof item === 'string') {
                    try {
                      parsed = JSON.parse(item);
                    } catch (e) {
                      continue;
                    }
                  }
                  if (parsed.cookies && Array.isArray(parsed.cookies)) {
                    cookiesArray = cookiesArray.concat(parsed.cookies);
                  }
                }
                console.log(`[Window Manager] 从格式4提取到 ${cookiesArray.length} 个 cookies`);
              }
              // 格式2/3: 第一个元素是 cookie 对象（有 name 和 domain 字段）
              else if (firstItem && firstItem.name && firstItem.domain) {
                console.log('[Window Manager] 检测到数据格式: 直接的 cookies 数组');
                // 需要解析每个元素
                for (let item of sessionData) {
                  if (typeof item === 'string') {
                    try {
                      cookiesArray.push(JSON.parse(item));
                    } catch (e) {
                      continue;
                    }
                  } else {
                    cookiesArray.push(item);
                  }
                }
              }
              else {
                console.warn('[Window Manager] ⚠️ 无法识别的数组元素格式:', firstItem);
              }
            }
          } else if (sessionData && sessionData.cookies && Array.isArray(sessionData.cookies)) {
            // 格式1：包含 cookies 字段
            cookiesArray = sessionData.cookies;
            console.log('[Window Manager] 检测到数据格式: {cookies: [...]}');
          } else if (sessionData && typeof sessionData === 'object' && !Array.isArray(sessionData)) {
            // 格式5：多域名格式 {".163.com": {cookies: [...]}, "mp.163.com": {cookies: [...]}}
            // 网易号等平台使用多域名存储 cookies
            const keys = Object.keys(sessionData);
            let isMultiDomain = false;
            for (const key of keys) {
              const val = sessionData[key];
              if (val && typeof val === 'object' && val.cookies && Array.isArray(val.cookies)) {
                isMultiDomain = true;
                cookiesArray = cookiesArray.concat(val.cookies);
                console.log(`[Window Manager] 从域名 ${key} 提取到 ${val.cookies.length} 个 cookies`);
              }
            }
            if (isMultiDomain) {
              console.log(`[Window Manager] 检测到数据格式5（多域名）: 共 ${cookiesArray.length} 个 cookies`);
            } else {
              console.warn('[Window Manager] ⚠️ 无法识别的 sessionData 格式, keys:', keys);
            }
          } else {
            console.warn('[Window Manager] ⚠️ 无法识别的 sessionData 格式');
          }

          cookiesArray = dedupeCookiesForSessionSave(options.platform, cookiesArray, 'window-restore');

          if (cookiesArray.length > 0) {
            console.log(`[Window Manager][${__wmTs()}] 开始恢复 ${cookiesArray.length} 个新 cookies...`);

            let restoredCount = 0;
            const keyCookieNames = ['sessionid', 'sessionid_ss', 'pass_ticket', 'wxuin', 'web_session', 'BDUSS', 'STOKEN', 'uuid_v2'];
            const foundKeyCookies = [];
            for (let cookieItem of cookiesArray) {
              try {
                // 如果是字符串，需要先解析（格式3）
                let cookie = cookieItem;
                if (typeof cookieItem === 'string') {
                  try {
                    cookie = JSON.parse(cookieItem);
                  } catch (e) {
                    console.error('[Window Manager] Cookie 解析失败:', cookieItem.substring(0, 50));
                    continue;
                  }
                }

                // 检查必要字段
                if (!cookie.name || !cookie.domain) {
                  console.warn('[Window Manager] Cookie 缺少必要字段:', cookie);
                  continue;
                }

                const cookieDetails = buildCookieSetDetails(
                  cookie,
                  cookie.expirationDate || Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
                );
                await windowSession.cookies.set(cookieDetails);
                restoredCount++;
                if (keyCookieNames.includes(cookie.name)) {
                  foundKeyCookies.push(`${cookie.name}(${cookie.domain})`);
                }
              } catch (cookieErr) {
                console.error(`[Window Manager] Cookie 恢复失败:`, cookieErr.message);
              }
            }
            console.log(`[Window Manager][${__wmTs()}] ✅ 恢复完成，成功恢复 ${restoredCount} 个 cookies`);
            // 🪄 cookies 已落盘：「恢复账号登录状态」完成，切换到「同步平台 Cookie 和 Storage」
            publishLoadingWindow?.finishStep?.(0);
            publishLoadingWindow?.activateStep?.(1);
            console.log(`[Window Manager][${__wmTs()}] 🗝 关键登录 cookie 命中:`, foundKeyCookies.length > 0 ? foundKeyCookies : '⚠️ 无（可能影响登录状态）');

            // 🔑 恢复后主动校验：重新读取实际写入的 cookies，判断是否与期望一致
            // 场景：部分机器磁盘/权限异常导致 set 表面成功但实际未持久化
            try {
                const verifyCookies = await windowSession.cookies.get({});
                console.log(`[Window Manager][${__wmTs()}] 🔎 校验：实际读回 cookies 数量=${verifyCookies.length}，期望≈${restoredCount}`);

                const verifyKeyNames = new Set();
                for (const c of verifyCookies) {
                    if (keyCookieNames.includes(c.name)) {
                        verifyKeyNames.add(`${c.name}(${c.domain})`);
                    }
                }
                const verifyList = Array.from(verifyKeyNames);
                console.log(`[Window Manager][${__wmTs()}] 🔎 校验：关键 cookie 实际存在:`, verifyList.length > 0 ? verifyList : '⚠️ 无');

                // 阈值：实际数小于期望数的 50%，或者恢复过程中发现关键 cookie 但读回后丢失，触发重试一次
                const shouldRetry = (verifyCookies.length < Math.max(1, Math.floor(restoredCount * 0.5)))
                    || (foundKeyCookies.length > 0 && verifyList.length === 0);

                if (shouldRetry) {
                    console.warn(`[Window Manager][${__wmTs()}] ⚠️ cookies 写入不完整，尝试重写一次...`);
                    let retryWrite = 0;
                    for (let cookieItem of cookiesArray) {
                        try {
                            let cookie = cookieItem;
                            if (typeof cookieItem === 'string') {
                                try { cookie = JSON.parse(cookieItem); } catch (_) { continue; }
                            }
                            if (!cookie.name || !cookie.domain) continue;
                            const cookieDetails = buildCookieSetDetails(
                                cookie,
                                cookie.expirationDate || (Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60)
                            );
                            await windowSession.cookies.set(cookieDetails);
                            retryWrite++;
                        } catch (_) {}
                    }
                    console.log(`[Window Manager][${__wmTs()}] 🔁 重写完成: ${retryWrite} 个`);
                }
            } catch (verifyErr) {
                console.error(`[Window Manager][${__wmTs()}] ❌ cookies 校验失败:`, verifyErr.message);
            }
          }

          // 🔑 强制刷新到磁盘，确保数据完全持久化
          console.log(`[Window Manager][${__wmTs()}] ⏳ 第一次 flushStorageData...`);
          try {
            await windowSession.flushStorageData();
            console.log(`[Window Manager][${__wmTs()}] ✅ 第一次 flush 完成`);
          } catch (flushErr1) {
            console.warn(`[Window Manager][${__wmTs()}] ⚠️ 第一次 flush 异常: ${flushErr1.message}`);
          }

          // 保留一次短等待给 Cookie Store 收敛，但避免打开窗口时明显卡顿。
          console.log(`[Window Manager][${__wmTs()}] ⏳ 等待 120ms 让会话写入收敛...`);
          await new Promise(resolve => setTimeout(resolve, 120));

          console.log(`[Window Manager][${__wmTs()}] ✅ 等待完成，准备创建窗口`);
          // 🪄 Storage 已收敛：「同步平台 Cookie 和 Storage」完成，进入「加载目标发布页面」
          publishLoadingWindow?.finishStep?.(1);
          publishLoadingWindow?.activateStep?.(2);

          console.log(`[Window Manager][${__wmTs()}] ========== 会话数据处理完成 ==========`);
        } catch (err) {
          console.error(`[Window Manager][${__wmTs()}] ❌ 会话数据处理失败:`, err);
          console.error(`[Window Manager][${__wmTs()}] 🧾 错误堆栈:`, err.stack);
          // 不影响窗口创建，继续执行
        }
        }  // end of else (!shouldSkipSessionRestore)
      }
    } else if (options.useTemporarySession) {
      // 创建一个唯一的临时 session（不持久化，窗口关闭后数据丢失）
      const tempSessionId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      windowSession = session.fromPartition(tempSessionId, { cache: false }); // 禁用缓存，避免 CSS 渲染异常
      sessionType = 'temporary';
      console.log('[Window Manager] 使用临时 session:', tempSessionId);

      // 为临时 session 配置相同的 User-Agent（与持久化 session 保持一致）
      const customUA = TAGGED_USER_AGENT;
      windowSession.setUserAgent(customUA);
      console.log('[Window Manager] 临时 session User-Agent 已设置');

      // 为临时 session 添加统一请求守卫（阻止 bitbrowser:// 和主框架静态资源误导航）
      installSessionRequestGuard(windowSession, '临时 session', {
        blockBitbrowser: true,
        blockMainFrameResources: true
      });
      addContentTypeFix(windowSession, '临时 session');
    } else {
      // 使用与主 BrowserView 相同的持久化 session
      windowSession = browserView.webContents.session;
      sessionType = 'persistent';
      console.log('[Window Manager] 使用持久化 session');
    }

    if (isShipinhaoLoginUrl(url)) {
      if (hasShipinhaoLoginResetRequest(url)) {
        console.log(`[Window Manager][${__wmTs()}] 🧹 视频号登录页显式重置，首包前清理旧 cookie`);
        await clearShipinhaoLoginCookiesFromSession(windowSession, 'initial-shipinhao-login');
      } else {
        console.log(`[Window Manager][${__wmTs()}] ⏭️ 视频号普通登录页不清身份 cookie，仅安装去重监听，避免破坏可复用登录态`);
      }
    }

    if (options.platform === 'shipinhao' || isShipinhaoCookieUrl(url)) {
      installShipinhaoCookieDedup(windowSession, `视频号窗口 ${sessionType}`);
    }

    const windowWebPreferences = {
      contextIsolation: true,
      nodeIntegration: false,
      session: windowSession,
      backgroundThrottling: false, // 禁用后台节流，防止视频被暂停
      autoplayPolicy: 'no-user-gesture-required' // 允许自动播放视频
    };
    if (!isBareToutiao) {
      windowWebPreferences.preload = path.join(__dirname, 'content-preload.js');
      // 🩹 把"旧版 Windows"标志透传给 content-preload（渲染进程读不到主进程的 shouldDisableHardwareAcceleration）。
      // 仅 Win7/8 注入；content-preload 据此决定是否启用视频号白屏巡检兜底，确保 Win10/11 完全不执行该巡检。
      if (shouldDisableHardwareAcceleration) {
        windowWebPreferences.additionalArguments = ['--yyzs-legacy-windows=1'];
      }
    }

    const newWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false,
      icon: appIcon, // 使用 nativeImage 加载的图标
      webPreferences: windowWebPreferences
    });
    applyScopedWindowUserAgent(newWindow.webContents, url, 'Window Manager');
    const ensureShipinhaoLoginForceReset = createShipinhaoLoginResetGuard(newWindow, 'managed-window');
    // 账号/发布窗口必须等 cookie/storage 恢复和目标页加载完成后再显示。
    // 否则用户可能先看到登录扫码页，随后被后续 bootstrap/loadURL 导航刷新打断。
    const shouldDelayInitialShow = sessionType === 'account' || !!options.sessionData || !!options.publishData;
    let allowManagedShow = !shouldDelayInitialShow;
    const showImmediately = sessionType === 'temporary' && !shouldDelayInitialShow;
    if (showImmediately && !newWindow.isDestroyed() && !newWindow.isVisible()) {
      newWindow.show();
      console.log(`[Window Manager][${__wmTs()}] 🚀 窗口已立即显示，后台继续恢复会话数据`);
    } else if (shouldDelayInitialShow) {
      console.log(`[Window Manager][${__wmTs()}] 🕒 账号/发布窗口延迟显示，等待会话恢复和目标页加载完成`);
    }
    const windowContext = buildWindowContext(url, options);
    windowContextMap.set(newWindow.id, windowContext);
    console.log('[Window Manager] 窗口上下文:', windowContext);
    const showManagedWindow = (reason) => {
      const currentContext = windowContextMap.get(newWindow.id);
      if (currentContext?.bootstrapInProgress) {
        console.log(`[Window Manager] bootstrap 进行中，暂不显示窗口 (${reason})`);
        return;
      }
      if (!allowManagedShow) {
        console.log(`[Window Manager] 会话恢复/目标页加载未完成，暂不显示窗口 (${reason})`);
        return;
      }
      if (!newWindow.isDestroyed() && !newWindow.isVisible()) {
        newWindow.show();
        console.log(`[Window Manager] 已显示窗口 (${reason})`);
        // 🩹 旧版 Windows 软件渲染下，show() 后常出现「DOM 已就绪但合成器不出图」的白屏
        //（Electron 已知问题：show:false 窗口显示后需触发一次重绘才贴图）。
        // 仅 Win7/8 执行：微调窗口高度 +1px 再还原，强制合成器重绘一帧。Win10/11 不执行。
        if (shouldDisableHardwareAcceleration) {
          try {
            const __redrawBounds = newWindow.getBounds();
            newWindow.setBounds({ ...__redrawBounds, height: __redrawBounds.height + 1 });
            setTimeout(() => {
              try {
                if (!newWindow.isDestroyed()) newWindow.setBounds(__redrawBounds);
              } catch (_) {}
            }, 60);
          } catch (redrawErr) {
            console.warn('[Window Manager] 强制重绘失败:', redrawErr && redrawErr.message ? redrawErr.message : redrawErr);
          }
        }
      }
      // 🪄 最后一步「加载目标发布页面」完成，留 220ms 让用户看到对勾再销毁 loading 窗口
      publishLoadingWindow?.finishStep?.(2);
      setTimeout(() => closePublishLoadingWindow(reason), 220);
    };
    const showFallbackTimer = setTimeout(() => showManagedWindow('fallback-timeout'), 12000);
    let targetShowFallbackTimer = null;
    const clearShowTimers = () => {
      clearTimeout(showFallbackTimer);
      if (targetShowFallbackTimer) {
        clearTimeout(targetShowFallbackTimer);
        targetShowFallbackTimer = null;
      }
    };
    newWindow.once('ready-to-show', () => showManagedWindow('ready-to-show'));
    newWindow.once('closed', clearShowTimers);
    newWindow.once('closed', () => closePublishLoadingWindow('real-window-closed'));
    const publishDataKey = `publish_data_window_${newWindow.id}`;
    if (options.publishData && typeof options.publishData === 'object') {
      if (globalStorage[publishDataKey]) {
        delete globalStorage[publishDataKey];
        console.log(`[Window Manager] 🧹 清理旧发布数据: ${publishDataKey}`);
      }
      globalStorage[publishDataKey] = {
        ...options.publishData,
        windowId: newWindow.id,
        createdAt: options.publishData.createdAt || Date.now()
      };
      rememberWindowPublishData(newWindow.id, globalStorage[publishDataKey]);
      console.log(`[Window Manager] ✅ 已预写入发布数据: ${publishDataKey}`);
    } else if (isBareToutiao && globalStorage[publishDataKey]) {
      delete globalStorage[publishDataKey];
      windowPublishDataMap.delete(newWindow.id);
      console.log(`[Window Manager] 🧹 清理头条窗口旧发布数据: ${publishDataKey}`);
    }
    if (options.publishData || isBareToutiao) {
      saveGlobalStorage();
    }

    // 添加到子窗口列表
    childWindows.push(newWindow);
    console.log('[Window Manager] 新窗口已添加，当前窗口数量:', childWindows.length);

    // 如果是多账号模式，记录窗口和账号的映射关系
    if (sessionType === 'account' && options.platform && options.accountId) {
      windowAccountMap.set(newWindow.id, {
        platform: options.platform,
        accountId: options.accountId
      });
      console.log(`[Window Manager] 记录窗口账号映射: windowId=${newWindow.id}, platform=${options.platform}, accountId=${options.accountId}`);
      if (options.platform === 'shipinhao') {
        installShipinhaoWindowAutoSave(newWindow, newWindow.id, windowSession, `视频号窗口自动保存 ${newWindow.id}`);
      }
    }
    if (options.publishData?.platform === 'shipinhao') {
      installShipinhaoWindowAutoSave(newWindow, newWindow.id, windowSession, `视频号发布窗口自动保存 ${newWindow.id}`);
    }

    // 忽略页面的 beforeunload 事件，允许直接关闭窗口
    newWindow.webContents.on('will-prevent-unload', (event) => {
      console.log('[Window Manager] 忽略页面的 beforeunload 事件，强制关闭窗口');
      event.preventDefault();
    });

    // 保存窗口 ID，避免在 closed 事件中访问已销毁的窗口对象
    const windowId = newWindow.id;
    const shouldBlockShipinhaoLoginSelfReload = (navUrl) => {
      if (!isShipinhaoLoginUrl(navUrl)) return false;
      if (newWindow.isDestroyed() || newWindow.webContents.isDestroyed()) return false;

      const currentUrl = newWindow.webContents.getURL();
      if (!isShipinhaoLoginUrl(currentUrl)) return false;

      const currentContext = windowContextMap.get(windowId);
      const hasPublishData = !!getWindowPublishData(windowId);
      return currentContext?.purpose === 'publish' || hasPublishData;
    };

    // 标记是否正在保存中（防止重复触发）
    let isSavingSession = false;

    // 🔐 维护窗口"上次 URL"，用于 did-navigate 检测登录页跳转
    let lastNavUrl = '';
    // 登录页 URL 识别模式（覆盖各平台变体）
    // /login - 通用、小红书、视频号 login.html、搜狐 /mpfe/v4/login
    // /userauth - 腾讯号 om.qq.com/userAuth/index
    // /userlogin - 兜底通用
    // /loginpage, /cgi-bin/login - 微信公众号
    // passport. - 抖音、搜狐、网易、新浪等账号中心
    // account.qq.com - 腾讯账号中心
    const LOGIN_URL_PATTERNS = [
      '/login',
      '/userauth',
      '/userlogin',
      '/loginpage',
      '/cgi-bin/login',
      'passport.',
      '/sso/',
      '/auth/',
      '/signin',
      'account.qq.com',
      'security.weibo.com'
    ];
    const isLoginPageUrl = (u) => {
      if (!u) return false;
      const lower = u.toLowerCase();
      return LOGIN_URL_PATTERNS.some(p => lower.includes(p));
    };

    // 公共方法：检测从登录页跳回业务页时触发 cookies 保存（同时被 did-navigate / did-navigate-in-page 复用）
    const tryPersistAfterLoginNavigate = async (navUrl, eventName) => {
      // 🛡️ 窗口已销毁则不处理，避免对已释放对象操作引发 crash (0xC0000005)
      if (newWindow.isDestroyed() || newWindow.webContents.isDestroyed()) return;
      const prevWasLogin = isLoginPageUrl(lastNavUrl);
      const currIsLogin = isLoginPageUrl(navUrl);
      lastNavUrl = navUrl;

      if (!prevWasLogin || currIsLogin) return;

      const accountInfo = windowAccountMap.get(windowId);
      if (!accountInfo && !hasWindowSessionSaveCandidate(windowId)) return;
      if (isSavingSession) {
        console.log(`[Window Manager] 🔐 正在保存中，跳过 ${eventName} 触发的保存`);
        return;
      }

      console.log(`[Window Manager] 🔐 [${eventName}] 检测到从登录页跳回业务页 (windowId=${windowId})，触发 cookies 保存...`);

      // 🛡️ 防误触发：SPA 跳一下登录页又立刻跳回（用户没真登录），cookies 是访客的不该保存
      // 必须确认本地 session 有真实登录态才保存，避免空触发污染后台
      const navPublishData = getWindowPublishData(windowId);
      const navPlatform = accountInfo?.platform || navPublishData?.platform || null;
      let navHasLogin = false;
      try {
        if (navPlatform && newWindow.webContents && !newWindow.webContents.isDestroyed()) {
          navHasLogin = await hasValidLoginCookies(newWindow.webContents.session, navPlatform);
        }
      } catch (loginCheckErr) {
        console.warn('[Window Manager] ⚠️ did-navigate 登录态预检异常:', loginCheckErr.message);
      }
      if (navPlatform && !navHasLogin) {
        console.log(`[Window Manager] 🚫 [${eventName}] 本地无真实登录态，跳过保存（可能是 SPA 跳一下登录页又跳回的误触发）`);
        return;
      }

      isSavingSession = true;
      try {
        // 🆕 优先走脚本侧 __publishSaveSession__（与 close handler 同款），避免主进程轻量 {id, cookies} 格式被后台拒
        let result = null;
        let scriptResult = null;
        try {
          scriptResult = await runPublishSaveSessionScript(newWindow, navPlatform, `Window Manager:${eventName}`);
          if (scriptResult && scriptResult.success) {
            console.log(`[Window Manager] 🔐 [${eventName}] ✅ 脚本保存成功`);
            let cacheSyncResult = null;
            if (navPlatform === 'shipinhao') {
              try {
                cacheSyncResult = await syncLatestSessionCacheFromWindow(newWindow, windowId, `script-save:${eventName}`);
                console.log(`[Window Manager] 🔐 [${eventName}] 视频号本地最新会话缓存同步结果:`, cacheSyncResult);
              } catch (cacheSyncErr) {
                console.warn(`[Window Manager] ⚠️ [${eventName}] 视频号本地最新会话缓存同步异常:`, cacheSyncErr.message);
              }
            }
            result = {
              success: true,
              accountInfo: { platform: navPlatform, accountId: accountInfo?.accountId || String(getPublishBackendAccountId(navPublishData) || '') },
              backendAccountId: cacheSyncResult?.backendAccountId || getPublishBackendAccountId(navPublishData) || scriptResult.uid,
              platformUid: scriptResult.uid,
              cookieCount: scriptResult.cookieCount,
              statusCode: scriptResult.status,
              response: scriptResult.response,
              source: 'script',
              cacheSyncResult
            };
          }
        } catch (scriptErr) {
          console.warn(`[Window Manager] ⚠️ [${eventName}] 脚本侧保存异常: ${scriptErr.message}`);
        }

        if (!result) {
          if (navPlatform === 'shipinhao') {
            console.log(`[Window Manager] 🛟 [${eventName}] 视频号脚本保存未成功，走主进程兜底写入本地最新会话缓存。scriptResult:`, scriptResult);
            result = await saveWindowSessionToBackend(newWindow, windowId, {
              eventName,
              navUrl,
              scriptResult,
              reason: 'shipinhao-relogin-navigation-fallback'
            });
          } else {
            console.log(`[Window Manager] 🚫 [${eventName}] 脚本路径未成功，跳过主进程兜底（避免轻量格式被拒）。scriptResult:`, scriptResult);
            return;
          }
        }
        console.log(`[Window Manager] 🔐 [${eventName}] 重登录后保存结果:`, result);
        if (browserView && !browserView.webContents.isDestroyed() && result && result.success) {
          const publishData = getWindowPublishData(windowId);
          browserView.webContents.send('session-updated', {
            windowId: windowId,
            platform: result.accountInfo?.platform || accountInfo?.platform,
            accountId: result.accountInfo?.accountId || accountInfo?.accountId,
            backendAccountId: result.backendAccountId,
            success: result.success,
            cookieCount: result.cookieCount,
            publishData: publishData,
            reason: 'relogin'
          });
        }
      } catch (err) {
        console.error(`[Window Manager] 🔐 [${eventName}] 重登录后保存失败:`, err);
      } finally {
        isSavingSession = false;
      }
    };

    // 🔐 监听 URL 跳转：从登录页跳回业务页时（说明用户重新登录成功）触发 cookies 保存到后台
    newWindow.webContents.on('did-navigate', async (_e, navUrl) => {
      await tryPersistAfterLoginNavigate(navUrl, 'did-navigate');
    });

    // 🔑 监听窗口关闭前事件，保存最新会话数据到后台
    // 使用 e.preventDefault() 阻止立即关闭，等待保存完成后再销毁窗口
    newWindow.on('close', async (e) => {
      console.log('[Window Manager] ========== 窗口关闭前 ==========');
      console.log('[Window Manager] windowId:', windowId);

      // 防止重复触发
      if (isSavingSession) {
        console.log('[Window Manager] 正在保存中，忽略重复触发');
        return;
      }

      // 检查是否是多账号模式的窗口，需要保存登录信息
      const accountInfo = windowAccountMap.get(windowId);
      if (accountInfo || hasWindowSessionSaveCandidate(windowId)) {
        // 阻止窗口立即关闭，等待保存完成
        e.preventDefault();
        isSavingSession = true;

        console.log('[Window Manager] 检测到可保存的发布窗口，等待保存会话数据完成后再关闭');

        try {
          // 🆕 脚本优先策略：所有平台的发布脚本侧用 creator 同款接口上报，成功则跳过主进程兜底
          // 主进程的 {id, cookies} 轻量格式被后台拒绝（400 授权失败），脚本侧用完整 data 格式
          const scriptSupportedPlatforms = ['tengxunhao', 'sohuhao', 'douyin', 'baijiahao', 'toutiao', 'wangyihao', 'zhihu', 'xinlang', 'xiaohongshu', 'shipinhao'];
          const publishDataForSave = getWindowPublishData(windowId);
          const targetPlatform = accountInfo?.platform
            || publishDataForSave?.platform
            || null;
          let hasRealLogin = true;
          if (targetPlatform === 'shipinhao' && newWindow.webContents && !newWindow.webContents.isDestroyed()) {
            try {
              hasRealLogin = await hasValidLoginCookies(newWindow.webContents.session, targetPlatform);
            } catch (loginCheckErr) {
              hasRealLogin = false;
              console.warn('[Window Manager] ⚠️ 关闭前视频号登录态预检异常:', loginCheckErr.message);
            }
          }

          if (targetPlatform === 'shipinhao' && !hasRealLogin) {
            console.log('[Window Manager] 🚫 视频号发布窗口关闭前未检测到真实登录态，跳过脚本保存和后台保存');
            isSavingSession = false;
            newWindow.destroy();
            return;
          }

          let scriptResult = null;
          if (targetPlatform && scriptSupportedPlatforms.includes(targetPlatform)) {
            try {
              console.log('[Window Manager] 🔐 尝试脚本侧保存:', targetPlatform);
              const code = `(async () => {
                if (typeof window.__publishSaveSession__ === 'function') {
                  try {
                    return await window.__publishSaveSession__(${JSON.stringify(targetPlatform)});
                  } catch (e) { return { success: false, error: e && e.message }; }
                }
                return { success: false, error: '__publishSaveSession__ 未注册' };
              })()`;
              scriptResult = await Promise.race([
                newWindow.webContents.executeJavaScript(code),
                new Promise((_, rej) => setTimeout(() => rej(new Error('脚本侧保存超时')), 30000))
              ]);
              console.log('[Window Manager] 🔐 脚本侧保存结果:', scriptResult);

              // 🛟 如果 __publishSaveSession__ 未注册，强制注入 common.js 后重试一次
              if (scriptResult && !scriptResult.success && /未注册/.test(scriptResult.error || '')) {
                console.log('[Window Manager] 🔁 __publishSaveSession__ 未注册，强制注入 common.js 后重试');
                try {
                  const commonPath = path.join(__dirname, 'injected-scripts', 'common.js');
                  const commonCode = fs.readFileSync(commonPath, 'utf-8');
                  await newWindow.webContents.executeJavaScript(commonCode);
                  console.log('[Window Manager] 🔁 common.js 已强制注入，重试调用');
                  scriptResult = await Promise.race([
                    newWindow.webContents.executeJavaScript(code),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('脚本侧保存超时')), 30000))
                  ]);
                  console.log('[Window Manager] 🔁 重试结果:', scriptResult);
                } catch (retryErr) {
                  console.warn('[Window Manager] ⚠️ 强制注入重试失败:', retryErr.message);
                }
              }
            } catch (scriptErr) {
              console.warn('[Window Manager] ⚠️ 脚本侧保存异常，兜底走主进程:', scriptErr.message);
              scriptResult = null;
            }
          }

          let result;
          if (scriptResult && scriptResult.success) {
            console.log('[Window Manager] ✅ 脚本保存成功，跳过主进程兜底');
            let cacheSyncResult = null;
            if (targetPlatform === 'shipinhao') {
              try {
                cacheSyncResult = await syncLatestSessionCacheFromWindow(newWindow, windowId, 'script-save:window-close');
                console.log('[Window Manager] 视频号本地最新会话缓存同步结果:', cacheSyncResult);
              } catch (cacheSyncErr) {
                console.warn('[Window Manager] ⚠️ 视频号本地最新会话缓存同步异常:', cacheSyncErr.message);
              }
            }
            result = {
              success: true,
              accountInfo: { platform: targetPlatform, accountId: accountInfo?.accountId || String(getPublishBackendAccountId(publishDataForSave) || '') },
              backendAccountId: cacheSyncResult?.backendAccountId || getPublishBackendAccountId(publishDataForSave) || scriptResult.uid,
              platformUid: scriptResult.uid,
              cookieCount: scriptResult.cookieCount,
              cookies: [],
              statusCode: scriptResult.status,
              response: scriptResult.response,
              source: 'script',
              cacheSyncResult
            };
          } else {
            // 🛡️ 主进程兜底前先检查本地 session 是否有真实登录态 + publishData 是否存在
            // 场景：发布页跳到登录页（cookies 是访客/失效的），或 publishData 已被清理
            // 任一条件不满足都跳过保存，避免覆盖后台已有的好数据
            let hasLogin = false;
            let publishDataMissing = false;
            try {
              if (targetPlatform && newWindow.webContents && !newWindow.webContents.isDestroyed()) {
                hasLogin = await hasValidLoginCookies(newWindow.webContents.session, targetPlatform);
              }
            } catch (loginCheckErr) {
              console.warn('[Window Manager] ⚠️ 登录态预检异常:', loginCheckErr.message);
            }
            publishDataMissing = !getWindowPublishData(windowId);

            const shouldSkip = targetPlatform && (!hasLogin || publishDataMissing);
            console.log(`[Window Manager] 兜底前判断: targetPlatform=${targetPlatform}, hasLogin=${hasLogin}, publishDataMissing=${publishDataMissing}, shouldSkip=${shouldSkip}`);

            if (shouldSkip) {
              console.log('[Window Manager] 🚫 跳过保存避免覆盖后台数据');
              result = {
                success: false,
                accountInfo: { platform: targetPlatform, accountId: accountInfo?.accountId || '' },
                error: '跳过保存（' + (!hasLogin ? '无登录态' : '') + (publishDataMissing ? (!hasLogin ? '+' : '') + 'publishData缺失' : '') + '）',
                source: 'skip-save',
                scriptResult: scriptResult
              };
            } else {
              console.log('[Window Manager] 🛟 走主进程兜底 saveWindowSessionToBackend');
              let currentUrl = '';
              try {
                if (newWindow.webContents && !newWindow.webContents.isDestroyed()) {
                  currentUrl = newWindow.webContents.getURL();
                }
              } catch (_) {}
              result = await saveWindowSessionToBackend(newWindow, windowId, { scriptResult, currentUrl });
            }
          }
          console.log('[Window Manager] 保存结果:', result);

          // 🔍 转发保存结果到首页 DevTools 控制台（覆盖所有路径：script/skip-save/main-fallback）
          try {
            if (browserView && !browserView.webContents.isDestroyed()) {
              const diagPayload = {
                windowId,
                source: result?.source || 'unknown',
                success: !!result?.success,
                platform: result?.accountInfo?.platform || accountInfo?.platform || '未知',
                accountId: result?.accountInfo?.accountId || accountInfo?.accountId || '无',
                backendAccountId: result?.backendAccountId || '无',
                cookieCount: result?.cookieCount != null ? String(result.cookieCount) : '0',
                statusCode: result?.statusCode != null ? String(result.statusCode) : '-',
                error: result?.error || '无',
                response: result?.response,
                scriptResult: scriptResult || null,
                currentUrl: (() => { try { return newWindow.webContents.getURL(); } catch (_) { return ''; } })()
              };
              const tag = result?.success ? '[Save Session ✅]' : '[Save Session ❌]';
              const logCode = `console.${result?.success ? 'log' : 'warn'}(${JSON.stringify(tag)}, ${JSON.stringify(diagPayload)});`;
              browserView.webContents.executeJavaScript(logCode).catch(() => {});
            }
          } catch (_) {}

          // 通知首页：会话数据已更新
          if (browserView && !browserView.webContents.isDestroyed() && result.success) {
            const publishData = getWindowPublishData(windowId);
            browserView.webContents.send('session-updated', {
              windowId: windowId,
              platform: result.accountInfo?.platform || accountInfo?.platform,
              accountId: result.accountInfo?.accountId || accountInfo?.accountId,
              backendAccountId: result.backendAccountId,
              success: result.success,
              cookieCount: result.cookieCount,
              cookies: result.cookies || [],
              publishData: publishData,
              timestamp: Date.now()
            });
            console.log('[Window Manager] ✅ 已通知首页会话数据已更新');
          }
        } catch (err) {
          console.error('[Window Manager] ❌ 保存会话数据时出错:', err);
        } finally {
          // 保存完成（无论成功失败），销毁窗口
          console.log('[Window Manager] 保存完成，销毁窗口');
          newWindow.destroy();
        }
      }
      // 非多账号模式窗口直接关闭，不做处理
    });

    // 监听窗口关闭事件
    newWindow.on('closed', () => {
      const closedWindowContext = windowContextMap.get(windowId) || null;
      const index = childWindows.indexOf(newWindow);
      if (index > -1) {
        childWindows.splice(index, 1);
        console.log('[Window Manager] 窗口已关闭，当前窗口数量:', childWindows.length);
      }
      if (browserView && !browserView.webContents.isDestroyed()) {
        browserView.webContents.send('managed-window-closed', {
          windowId,
          timestamp: Date.now(),
          context: closedWindowContext
        });
        console.log('[Window Manager] 已通知首页子窗口关闭:', windowId);
      }
      windowContextMap.delete(windowId);
      windowPublishDataMap.delete(windowId);
      toutiaoBarePublishState.delete(windowId);
      // 清理发布数据，避免残留数据影响后续授权窗口
      if (globalStorage[publishDataKey]) {
        delete globalStorage[publishDataKey];
        saveGlobalStorage();
        console.log(`[Window Manager] 🧹 已清理发布数据: ${publishDataKey}`);
      }
      // 清理窗口账号映射
      if (windowAccountMap.has(windowId)) {
        windowAccountMap.delete(windowId);
        console.log(`[Window Manager] 清理窗口账号映射: windowId=${windowId}`);
      }
      // 清理授权窗口标记
      const authFlagKey = `auth_mode_window_${windowId}`;
      if (globalStorage[authFlagKey]) {
        delete globalStorage[authFlagKey];
        saveGlobalStorage();
        console.log(`[Window Manager] 🏷️ 已清理授权窗口标记: ${authFlagKey}`);
      }
    });

    // 开发环境自动打开 DevTools
    if (!isProduction) {
      newWindow.webContents.openDevTools();
    }

    // 🔧 HTTP→HTTPS 升级：163.com 的 subscribe_v3 会 302 到 http://mp.163.com/subscribe_v4
    // HTTP 页面拿不到 Secure cookies → 以为没登录 → 跳登录页 → 死循环
    // 方案：三重拦截
    //   1. will-navigate：拦截页面 JS 发起的 HTTP 导航
    //   2. did-navigate：拦截服务端 302 重定向落地的 HTTP 页面（will-navigate 抓不到 302）
    //   3. onBeforeRequest：网络层拦截所有 HTTP 子请求（API 调用等），解决 Mixed Content
    newWindow.webContents.on('did-start-navigation', (_event, navUrl, _isInPlace, isMainFrame) => {
      if (isMainFrame) {
        if (shouldBlockShipinhaoLoginSelfReload(navUrl)) {
          console.warn('[Shipinhao LoginGuard] 检测到发布窗口登录页同页重载请求，等待 will-navigate 拦截:', navUrl);
          return;
        }
        ensureShipinhaoLoginForceReset(navUrl, 'did-start-navigation-login-reset');
      }
    });
    newWindow.webContents.on('will-navigate', (event, navUrl) => {
      if (shouldBlockShipinhaoLoginSelfReload(navUrl)) {
        console.warn('[Shipinhao LoginGuard] 已阻止发布窗口视频号登录页同页 reload:', navUrl);
        event.preventDefault();
        return;
      }
      if (ensureShipinhaoLoginForceReset(navUrl, 'will-navigate', event)) return;
      if (navUrl.startsWith('http://mp.163.com/')) {
        const httpsUrl = navUrl.replace('http://mp.163.com/', 'https://mp.163.com/');
        console.log(`[Window Nav] 🔒 HTTP→HTTPS (will-navigate): ${navUrl} → ${httpsUrl}`);
        event.preventDefault();
        newWindow.webContents.loadURL(httpsUrl);
      }
    });
    newWindow.webContents.on('did-navigate', (event, navUrl) => {
      if (ensureShipinhaoLoginForceReset(navUrl, 'did-navigate-nav-reset')) return;
      // 302 重定向落地后立刻跳 HTTPS，防止页面 JS 在 HTTP 下执行并触发登录循环
      if (navUrl.startsWith('http://mp.163.com/')) {
        const httpsUrl = navUrl.replace('http://mp.163.com/', 'https://mp.163.com/');
        console.log(`[Window Nav] 🔒 HTTP→HTTPS (did-navigate 302 落地): ${navUrl} → ${httpsUrl}`);
        newWindow.webContents.loadURL(httpsUrl);
      }
    });

    // 🔧 163.com Mixed Content 修复：session 网络层拦截所有 HTTP 请求，升级为 HTTPS
    // 页面在 HTTPS 上运行，但 163.com 自己的 JS 发 HTTP API 请求（如 navinfo.do）被 Mixed Content 拦截
    // 仅对非共享 session 设置（避免影响主窗口 BrowserView 的其他页面）
    if (sessionType !== 'persistent') {
      installSessionRequestGuard(windowSession, '窗口 session', {
        blockBitbrowser: true,
        blockMainFrameResources: true,
        upgradeMp163: true
      });
    }

    // 🔧 授权窗口标记：供注入脚本区分「授权流程」vs「发布掉登录恢复」
    // 临时 session = 授权窗口，窗口 ID 可能复用导致残留 publish_data 被误读
    if (sessionType === 'temporary') {
      const authFlagKey = `auth_mode_window_${newWindow.id}`;
      globalStorage[authFlagKey] = true;
      saveGlobalStorage();
      console.log(`[Window Manager] 🏷️ 已标记授权窗口: ${authFlagKey}`);
    }

    // 🔑 为新窗口添加脚本注入（使用 dom-ready 而不是 did-finish-load，更早注入）
    // dom-ready 在 DOM 准备好但在 DOMContentLoaded 之前触发，可以更早执行脚本
    newWindow.webContents.on('dom-ready', async () => {
      const currentURL = newWindow.webContents.getURL();
      console.log('[New Window API] DOM ready:', currentURL);
      const currentContext = windowContextMap.get(newWindow.id);
      if (currentContext?.bootstrapInProgress) {
        console.log('[New Window API] 跳过 bootstrap 页面注入:', currentURL);
        return;
      }
      const recovered = await maybeRecoverPublishWindow(newWindow, currentURL, 'dom-ready');
      if (recovered.redirected) {
        return;
      }
      if (shouldSkipScriptInjection(currentURL)) {
        console.log('[New Window API] Skip script injection for Toutiao:', currentURL);
        return;
      }

      // 🔑 优先注入脚本（越早越好，防止页面 JS 先执行导致跳转问题）
      await scriptManager.getScript(currentURL).then(async (script) => {
        if (script) {
          console.log('[New Window API] Injecting script on dom-ready...');
          try {
            await newWindow.webContents.executeJavaScript(script);
            console.log('[New Window API] Script injected successfully');
          } catch (err) {
            console.error('[New Window API] Script injection error:', err);
          }
        }
      });
    });

    // 页面完全加载后通知首页 + 补充脚本注入（作为 dom-ready 的保底机制）
    newWindow.webContents.on('did-finish-load', async () => {
      const currentURL = newWindow.webContents.getURL();
      console.log('[New Window API] Page loaded:', currentURL);
      const currentContext = windowContextMap.get(newWindow.id);
      if (currentContext?.bootstrapInProgress) {
        console.log('[New Window API] bootstrap 页面加载完成，跳过通知和注入:', currentURL);
        return;
      }
      const recovered = await maybeRecoverPublishWindow(newWindow, currentURL, 'did-finish-load');
      if (recovered.redirected) {
        return;
      }

      // 通知首页：新窗口页面加载完成
      if (browserView && !browserView.webContents.isDestroyed()) {
        browserView.webContents.send('window-loaded', {
          url: currentURL,
          windowId: newWindow.id,
          timestamp: Date.now()
        });
        console.log('[New Window API] 已通知首页窗口加载完成');
      }

      // 🔑 补充脚本注入（与 did-create-window 保持一致）
      // dom-ready 可能因远程脚本拉取延迟导致注入失败，did-finish-load 作为保底
      if (shouldSkipScriptInjection(currentURL)) {
        console.log('[New Window API] Skip script injection for Toutiao:', currentURL);
        await maybeRunBareToutiaoPublish(newWindow);
      } else {
        await injectScriptForUrl(newWindow.webContents, currentURL);
      }
    });

    newWindow.webContents.on('did-navigate', async (event, navUrl) => {
      console.log('[New Window API] Navigation:', navUrl);
      const currentContext = windowContextMap.get(newWindow.id);
      if (currentContext?.bootstrapInProgress) {
        console.log('[New Window API] bootstrap 导航完成，跳过导航守卫:', navUrl);
        return;
      }
      await maybeRecoverPublishWindow(newWindow, navUrl, 'did-navigate');
    });

    // 监听新窗口内的导航（SPA 路由）
    newWindow.webContents.on('did-navigate-in-page', async (event, navUrl) => {
      console.log('[New Window API] SPA Navigation:', navUrl);
      if (ensureShipinhaoLoginForceReset(navUrl, 'did-navigate-in-page-reset')) return;
      // 🔐 SPA 路由也触发登录回跳保存（覆盖腾讯号 userAuth、搜狐 mpfe/v4/login 等单页应用登录路径）
      // 加存活守卫，避免窗口销毁后访问已释放对象导致 crash (0xC0000005)
      try {
        if (!newWindow.isDestroyed() && !newWindow.webContents.isDestroyed()) {
          await tryPersistAfterLoginNavigate(navUrl, 'did-navigate-in-page');
        }
      } catch (persistErr) {
        console.error('[New Window API] 🔐 SPA 路由保存异常（已忽略）:', persistErr);
      }
      if (newWindow.isDestroyed() || newWindow.webContents.isDestroyed()) return;
      const currentContext = windowContextMap.get(newWindow.id);
      if (currentContext?.bootstrapInProgress) {
        console.log('[New Window API] bootstrap SPA 导航，跳过脚本注入:', navUrl);
        return;
      }
      const recovered = await maybeRecoverPublishWindow(newWindow, navUrl, 'did-navigate-in-page');
      if (recovered.redirected) {
        return;
      }
      if (shouldSkipScriptInjection(navUrl)) {
        console.log('[New Window API] Skip script injection for Toutiao:', navUrl);
        await maybeRunBareToutiaoPublish(newWindow);
        return;
      }
      const script = await scriptManager.getScript(navUrl);
      if (script) {
        try {
          await newWindow.webContents.executeJavaScript(script);
          console.log('[New Window API] Script re-injected on navigation');
        } catch (err) {
          console.error('[New Window API] Script re-injection error:', err);
        }
      }
      await injectScriptForUrl(newWindow.webContents, navUrl);
    });

    // 🔑 检查是否需要预设 storage（解决首次打开跳转首页/掉登录的问题）
    // 问题原因：页面脚本在 dom-ready 前就执行，读取了旧的 localStorage / sessionStorage 值
    // 解决方案：先加载 bootstrap，按目标域写入 storage，再导航到目标 URL
    let localStorageData = null;
    let sessionStorageData = null;

    if (options.sessionData) {
      let sessionData = options.sessionData;
      // 解析 sessionData
      if (typeof sessionData === 'string') {
        try {
          sessionData = JSON.parse(sessionData);
          if (typeof sessionData === 'string') {
            sessionData = JSON.parse(sessionData);
          }
        } catch (e) {
          console.warn(`[Window Manager][${__wmTs()}] ⚠️ localStorage 预扫描阶段的 sessionData 解析失败（忽略）: ${e.message}`);
        }
      }

      if (sessionData && typeof sessionData === 'object' && !Array.isArray(sessionData)) {
        const urlInfo = getUrlInfo(url);
        const targetOrigin = windowContext?.safeOrigin || urlInfo.origin || '';
        localStorageData = pickSessionStorageForOrigin(sessionData.localStorage, targetOrigin, url);
        sessionStorageData = pickSessionStorageForOrigin(sessionData.sessionStorage, targetOrigin, url);

        if (localStorageData && Object.keys(localStorageData).length > 0) {
          console.log(`[Window Manager][${__wmTs()}] 🔑 检测到 localStorage 数据 (key 数=${Object.keys(localStorageData).length}):`, Object.keys(localStorageData));
        } else {
          console.log(`[Window Manager][${__wmTs()}] ℹ️ sessionData 中无当前域 localStorage 数据，跳过预设`);
        }

        if (sessionStorageData && Object.keys(sessionStorageData).length > 0) {
          console.log(`[Window Manager][${__wmTs()}] 🔑 检测到 sessionStorage 数据 (key 数=${Object.keys(sessionStorageData).length}):`, Object.keys(sessionStorageData));
        } else {
          console.log(`[Window Manager][${__wmTs()}] ℹ️ sessionData 中无当前域 sessionStorage 数据，跳过预设`);
        }
      } else {
        console.log(`[Window Manager][${__wmTs()}] ℹ️ sessionData 不含可预设的 storage 数据，跳过预设`);
      }
    }

    // 如果有 storage 数据需要预设，先加载 bootstrap
    if (
      (localStorageData && Object.keys(localStorageData).length > 0)
      || (sessionStorageData && Object.keys(sessionStorageData).length > 0)
    ) {
      console.log(`[Window Manager][${__wmTs()}] 🔄 预设 storage，先加载 bootstrap...`);

      if (windowContext) {
        windowContext.bootstrapInProgress = true;
      }

      try {
        const primaryBootstrap = windowContext?.bootstrapUrl || getUrlInfo(url).origin || url;
        // 只加载文档型 bootstrap。静态资源（favicon/robots/json/css）一旦作为主文档加载，
        // 就可能把源码文本直接展示给用户。
        const bootstrapCandidates = [primaryBootstrap].filter(candidate => candidate && !isStaticResourceUrl(candidate));
        console.log(`[Window Manager][${__wmTs()}] 🔄 bootstrap 候选列表:`, bootstrapCandidates);

        let bootstrapLoaded = false;
        let lastBootstrapErr = null;
        for (const candidateUrl of bootstrapCandidates) {
          const bootstrapStartTs = Date.now();
          try {
            console.log(`[Window Manager][${__wmTs()}] 🔄 尝试加载 bootstrap: ${candidateUrl}`);
            await newWindow.loadURL(candidateUrl);
            console.log(`[Window Manager][${__wmTs()}] ✅ bootstrap 加载成功: ${candidateUrl} (${Date.now() - bootstrapStartTs}ms)`);
            bootstrapLoaded = true;
            break;
          } catch (loadErr) {
            lastBootstrapErr = loadErr;
            console.warn(`[Window Manager][${__wmTs()}] ⚠️ bootstrap 失败 (${candidateUrl}): ${loadErr.message}，尝试下一个候选`);
          }
        }

        if (!bootstrapLoaded) {
          console.error(`[Window Manager][${__wmTs()}] ❌ 所有 bootstrap 候选均失败，跳过 localStorage 预设`);
          if (lastBootstrapErr) {
            console.error(`[Window Manager][${__wmTs()}] 🧾 最后一次错误:`, lastBootstrapErr.stack || lastBootstrapErr.message);
          }
        } else {
          await new Promise(resolve => setTimeout(resolve, 100));

          // 设置 localStorage / sessionStorage
          const storagePresetScript = `
          (function() {
            const localData = ${JSON.stringify(localStorageData || {})};
            const sessionData = ${JSON.stringify(sessionStorageData || {})};
            console.log('[预设 storage] 开始设置...', {
              localKeys: Object.keys(localData),
              sessionKeys: Object.keys(sessionData)
            });

            for (const key in localData) {
              try {
                localStorage.setItem(key, localData[key]);
                console.log('[预设 localStorage] 已设置:', key);
              } catch (e) {
                console.error('[预设 localStorage] 设置失败:', key, e);
              }
            }

            for (const key in sessionData) {
              try {
                sessionStorage.setItem(key, sessionData[key]);
                console.log('[预设 sessionStorage] 已设置:', key);
              } catch (e) {
                console.error('[预设 sessionStorage] 设置失败:', key, e);
              }
            }
            console.log('[预设 storage] 完成');
          })();
        `;

          await newWindow.webContents.executeJavaScript(storagePresetScript);
          console.log(`[Window Manager][${__wmTs()}] ✅ storage 预设完成`);

          // 等待一下确保 storage 写入
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (err) {
        console.error(`[Window Manager][${__wmTs()}] ❌ storage 预设失败: ${err.message}`);
        console.error(`[Window Manager][${__wmTs()}] 🧾 错误堆栈:`, err.stack);
      } finally {
        if (windowContext) {
          windowContext.bootstrapInProgress = false;
        }
      }
    }

    // 加载目标 URL
    console.log(`[Window Manager][${__wmTs()}] 🚀 loadURL 目标页: ${url}`);
    const targetLoadPromise = newWindow.loadURL(url);
    if (shouldDelayInitialShow) {
      targetShowFallbackTimer = setTimeout(() => {
        allowManagedShow = true;
        showManagedWindow('target-load-timeout');
      }, 30000);
    } else {
      allowManagedShow = true;
    }
    targetLoadPromise
      .then(() => {
        console.log(`[Window Manager][${__wmTs()}] ✅ 目标页加载完成，windowId=${newWindow.id}`);
      })
      .catch(err => {
        console.error(`[Window Manager][${__wmTs()}] ❌ 目标页加载失败: ${err.message || err}`);
      })
      .finally(async () => {
        clearShowTimers();
        if (isShipinhaoPublishUrl) {
          try {
            const visualResult = await waitForShipinhaoPublishVisualReady(newWindow);
            // 🩹 主进程级白屏巡检：这里只记录，不再自动 reload。
            // 视频号扫码/重登时任何自动刷新都会打断二维码确认和 session 落盘，导致“刚扫就刷新、登录保存不上”。
            if (visualResult && visualResult.ready === false && shouldDisableHardwareAcceleration
                && !newWindow.isDestroyed() && !newWindow.webContents.isDestroyed()) {
              console.warn('[Shipinhao BlankGuard] 主进程检测发布页疑似白屏，已禁用自动 reloadIgnoringCache，仅记录诊断');
            }
          } catch (waitErr) {
            console.warn('[Shipinhao BlankGuard] 等待发布页可见内容异常:', waitErr && waitErr.message ? waitErr.message : waitErr);
          }
        }
        allowManagedShow = true;
        showManagedWindow(isShipinhaoPublishUrl ? 'target-load-finished-visual-check' : 'target-load-finished');
      });
    console.log(`[Window Manager][${__wmTs()}] ✅ loadURL 已发出，windowId=${newWindow.id}`);
    return { success: true, windowId: newWindow.id };
  } catch (err) {
    console.error(`[Window Manager][${__wmTs()}] ❌ openManagedChildWindow 顶层异常:`, err);
    console.error(`[Window Manager][${__wmTs()}] 🧾 错误堆栈:`, err.stack);
    closePublishLoadingWindow('open-error');
    return { success: false, error: err.message };
  }
}

// 从内容页面打开新窗口（始终创建新窗口，不受模式影响）
ipcMain.handle('open-new-window', async (event, url, options = {}) => {
  return openManagedChildWindow(url, options);
});

// 从内容页面在当前窗口打开 URL
ipcMain.handle('navigate-current-window', async (event, url) => {
  if (!url) {
    return { success: false, error: 'No URL provided' };
  }

  try {
    if (shouldSkipScriptInjection(url)) {
      return openManagedChildWindow(url);
    }
    if (browserView) {
      browserView.webContents.loadURL(url);
      return { success: true };
    }
    return { success: false, error: 'No browser view available' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 关闭当前窗口（仅对子窗口有效，不能关闭主窗口）
ipcMain.handle('close-current-window', async (event) => {
  console.log('[Window Manager] ========== 收到关闭窗口请求 ==========');
  try {
    // 查找发送请求的窗口
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    console.log('[Window Manager] senderWindow:', senderWindow ? 'Found' : 'NULL');
    console.log('[Window Manager] mainWindow:', mainWindow ? 'Exists' : 'NULL');
    console.log('[Window Manager] senderWindow === mainWindow:', senderWindow === mainWindow);
    console.log('[Window Manager] childWindows.length:', childWindows.length);
    console.log('[Window Manager] event.sender.getType():', event.sender.getType());

    // 如果是主窗口，拒绝关闭
    if (senderWindow === mainWindow) {
      console.log('[Window Manager] ❌ 拒绝关闭主窗口');
      return { success: false, error: 'Cannot close main window' };
    }

    // 如果 senderWindow 是 null，可能是来自 BrowserView
    if (!senderWindow) {
      console.log('[Window Manager] ⚠️ senderWindow 为 null，可能来自 BrowserView');
      console.log('[Window Manager] ⚠️ 尝试查找包含此 webContents 的窗口...');

      // 遍历所有子窗口，查找匹配的 webContents
      for (let i = 0; i < childWindows.length; i++) {
        const child = childWindows[i];
        if (child && !child.isDestroyed() && child.webContents === event.sender) {
          console.log(`[Window Manager] ✅ 在子窗口列表中找到匹配窗口 [${i}]`);
          child.close();
          return { success: true };
        }
      }

      console.log('[Window Manager] ❌ 未在子窗口列表中找到匹配窗口');
      return { success: false, error: 'Sender is BrowserView, not a window' };
    }

    // 如果是子窗口，关闭它
    if (senderWindow && !senderWindow.isDestroyed()) {
      const isChildWindow = childWindows.includes(senderWindow);
      console.log('[Window Manager] isChildWindow:', isChildWindow);

      if (isChildWindow) {
        console.log('[Window Manager] ✅ 关闭子窗口');
        senderWindow.close();
        return { success: true };
      } else {
        console.log('[Window Manager] ⚠️ 窗口存在但不在子窗口列表中');
      }
    }

    console.log('[Window Manager] ❌ No window to close');
    return { success: false, error: 'No window to close' };
  } catch (err) {
    console.error('[Window Manager] ❌ 关闭窗口失败:', err);
    return { success: false, error: err.message };
  }
});

// 获取当前窗口的 ID（用于新窗口识别自己）
ipcMain.handle('get-window-id', async (event) => {
  try {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow) {
      return { success: true, windowId: senderWindow.id };
    }
    // 可能是 BrowserView
    if (browserView && event.sender === browserView.webContents) {
      return { success: true, windowId: 'main', isMainView: true };
    }
    return { success: false, error: 'Cannot determine window' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-window-context', async (event) => {
  try {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      if (browserView && event.sender === browserView.webContents) {
        return { success: true, context: { purpose: 'main' } };
      }
      return { success: false, error: 'Cannot determine window' };
    }

    return {
      success: true,
      context: windowContextMap.get(senderWindow.id) || null
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 获取主窗口（BrowserView）的 URL（用于获取首页域名）
ipcMain.handle('get-main-url', async () => {
  try {
    if (browserView && !browserView.webContents.isDestroyed()) {
      const url = browserView.webContents.getURL();
      // 解析出域名
      const urlObj = new URL(url);
      return {
        success: true,
        url: url,
        origin: urlObj.origin,  // 如 https://dev.china9.cn
        host: urlObj.host,      // 如 dev.china9.cn
        protocol: urlObj.protocol // 如 https:
      };
    }
    return { success: false, error: 'BrowserView 不可用' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ========== 脚本管理功能 ==========

// 获取所有已保存的脚本列表
ipcMain.handle('get-all-scripts', async () => {
  return scriptManager.getAllScripts();
});

// 删除指定脚本
ipcMain.handle('delete-script', async (event, url) => {
  return await scriptManager.deleteScript(url);
});

// 清空所有脚本
ipcMain.handle('clear-all-scripts', async () => {
  return await scriptManager.clearAll();
});

// 导出脚本到指定目录
ipcMain.handle('export-scripts', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: '选择导出目录'
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }

  return await scriptManager.exportScripts(result.filePaths[0]);
});

// 从目录导入脚本
ipcMain.handle('import-scripts', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择要导入的脚本目录'
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }

  return await scriptManager.importScripts(result.filePaths[0]);
});

// 打开脚本存储目录
ipcMain.handle('open-scripts-folder', async () => {
  const { shell } = require('electron');
  await shell.openPath(scriptManager.scriptsDir);
  return { success: true };
});

// ========== Cookie 调试功能 ==========

// 获取当前所有 Cookies
ipcMain.handle('get-cookies', async () => {
  if (browserView) {
    const cookies = await browserView.webContents.session.cookies.get({});
    console.log(`[Cookie Debug] Total cookies: ${cookies.length}`);
    cookies.forEach(c => {
      console.log(`  - ${c.name} @ ${c.domain} (expires: ${c.expirationDate ? new Date(c.expirationDate * 1000).toLocaleString() : 'session'})`);
    });
    return { success: true, count: cookies.length, cookies };
  }
  return { success: false, error: 'No browser view' };
});

// 手动保存 Session 数据
ipcMain.handle('flush-session', async () => {
  if (browserView) {
    const ses = browserView.webContents.session;
    const cookies = await ses.cookies.get({});
    console.log(`[Manual Save] Flushing ${cookies.length} cookies to disk...`);
    await ses.flushStorageData();
    console.log('[Manual Save] Session data flushed successfully');
    return { success: true, cookieCount: cookies.length };
  }
  return { success: false, error: 'No browser view' };
});

// 获取 Session 存储路径
ipcMain.handle('get-session-path', async () => {
  if (browserView) {
    const storagePath = browserView.webContents.session.getStoragePath();
    console.log(`[Session Path] ${storagePath}`);
    return { success: true, path: storagePath };
  }
  return { success: false };
});

// ========== 设置 Cookie（跨域支持） ==========
ipcMain.handle('set-cookie', async (event, cookieData) => {
  console.log('[Set Cookie] ========== API 调用 ==========');
  console.log('[Set Cookie] 请求设置 Cookie:', cookieData);

  if (!cookieData || !cookieData.name || !cookieData.value) {
    return { success: false, error: 'Cookie name 和 value 不能为空' };
  }

  if (browserView && !browserView.webContents.isDestroyed()) {
    try {
      const ses = browserView.webContents.session;

      // 构建 Cookie 对象 - URL 必须提供
      if (!cookieData.url) {
        return { success: false, error: 'Cookie url 不能为空' };
      }

      const cookie = {
        url: cookieData.url,
        name: cookieData.name,
        value: cookieData.value,
        path: cookieData.path || '/',
        secure: cookieData.secure !== undefined ? cookieData.secure : false,
        httpOnly: cookieData.httpOnly || false
      };
      assignCookieSameSite(cookie, cookieData.sameSite);

      // 只有明确提供 domain 时才设置（localhost 不需要 domain）
      if (cookieData.domain) {
        cookie.domain = cookieData.domain;
      }

      // 设置过期时间
      if (cookieData.expirationDate) {
        cookie.expirationDate = cookieData.expirationDate;
      } else if (cookieData.expires) {
        // 支持 Date 对象或时间戳
        cookie.expirationDate = typeof cookieData.expires === 'number'
          ? Math.floor(cookieData.expires / 1000)  // 毫秒转秒
          : Math.floor(new Date(cookieData.expires).getTime() / 1000);
      }

      console.log('[Set Cookie] 实际设置的 Cookie:', cookie);
      await ses.cookies.set(cookie);
      console.log('[Set Cookie] ✅ Cookie 设置成功');

      // 强制刷新到磁盘，确保持久化
      await ses.flushStorageData();
      console.log('[Set Cookie] ✅ Session 数据已刷新到磁盘');

      // 验证 Cookie 是否设置成功
      const cookies = await ses.cookies.get({ name: cookieData.name });
      console.log('[Set Cookie] 验证结果:', cookies);

      return { success: true };
    } catch (err) {
      console.error('[Set Cookie] ❌ 设置失败:', err);
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: 'BrowserView 不可用' };
});

// ========== 迁移临时 Session 的 Cookies 到持久化 Session ==========
// 用于授权窗口（临时session）授权成功后，把登录状态复制到持久化session
ipcMain.handle('migrate-cookies-to-persistent', async (event, domain) => {
  console.log('[Cookie Migration] ========== API 调用 ==========');
  console.log('[Cookie Migration] 请求迁移域名:', domain);

  if (!domain) {
    return { success: false, error: '域名不能为空' };
  }

  try {
    // 获取调用者的 session（临时 session）
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      return { success: false, error: '无法获取发送者窗口' };
    }

    const tempSession = senderWindow.webContents.session;
    const persistentSession = browserView.webContents.session;

    // 检查是否是不同的 session
    if (tempSession === persistentSession) {
      console.log('[Cookie Migration] ⚠️ 已经是持久化 session，跳过迁移');
      return { success: true, migratedCount: 0, message: '已经是持久化 session' };
    }

    // 获取临时 session 中指定域名的 cookies
    const tempCookies = await tempSession.cookies.get({});
    console.log(`[Cookie Migration] 临时 session 共有 ${tempCookies.length} 个 cookies`);

    const isShipinhaoMigration = isShipinhaoSessionMigrationDomain(domain);
    const migrationDomains = isShipinhaoMigration ? SHIPINHAO_SESSION_COOKIE_DOMAINS : [domain];
    console.log('[Cookie Migration] 实际迁移域集合:', migrationDomains);

    // 过滤出指定域名的 cookies
    const domainCookies = tempCookies.filter(cookie => {
      return shouldMigrateCookieForDomain(cookie.domain, domain);
    });

    console.log(`[Cookie Migration] 找到 ${domainCookies.length} 个 ${migrationDomains.join(', ')} 的 cookies`);

    if (domainCookies.length === 0) {
      return { success: false, error: `没有找到 ${domain} 的 cookies` };
    }

    // 先清除持久化 session 中该域名的旧 cookies（避免冲突）
    const oldCookies = await persistentSession.cookies.get({});
    for (const cookie of oldCookies) {
      const shouldDelete = shouldMigrateCookieForDomain(cookie.domain, domain);
      if (shouldDelete) {
        const cookieDomain = normalizeSessionCookieDomain(cookie.domain);
        const cookieUrl = `${cookie.secure ? 'https' : 'http'}://${cookieDomain}${cookie.path}`;
        try {
          await persistentSession.cookies.remove(cookieUrl, cookie.name);
          console.log(`[Cookie Migration] ✓ 清除旧 cookie: ${cookie.name}`);
        } catch (err) {
          // 忽略删除失败
        }
      }
    }

    // 将临时 session 的 cookies 复制到持久化 session
    let migratedCount = 0;
    const oneYearFromNow = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);

    const cookiesToMigrate = isShipinhaoMigration
      ? dedupeCookiesForSessionSave('shipinhao', domainCookies, 'migrate-cookies-to-persistent')
      : domainCookies;

    if (isShipinhaoMigration) {
      installShipinhaoCookieDedup(persistentSession, '视频号授权迁移持久化 session');
    }

    for (const cookie of cookiesToMigrate) {
      try {
        const newCookie = buildCookieSetDetails(cookie, cookie.expirationDate || oneYearFromNow);
        await persistentSession.cookies.set(newCookie);
        migratedCount++;
        console.log(`[Cookie Migration] ✓ 迁移: ${cookie.name} @ ${cookie.domain}`);
      } catch (err) {
        console.error(`[Cookie Migration] ✗ 迁移失败: ${cookie.name} @ ${cookie.domain}`, err.message);
      }
    }

    // 刷新到磁盘
    await persistentSession.flushStorageData();
    if (isShipinhaoMigration) {
      await dedupShipinhaoCookiesOnce(persistentSession, '视频号授权迁移持久化 session');
    }

    console.log(`[Cookie Migration] ========== 迁移完成 ==========`);
    console.log(`[Cookie Migration] ✅ 共迁移 ${migratedCount}/${domainCookies.length} 个 cookies`);

    return { success: true, migratedCount, totalFound: domainCookies.length, domains: migrationDomains };
  } catch (err) {
    console.error('[Cookie Migration] 迁移失败:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('migrate-cookies-to-account-session', async (event, domain, platform, accountId) => {
  console.log('[Cookie Migration] ========== 迁移到账号 Session ==========');
  console.log('[Cookie Migration] 请求参数:', { domain, platform, accountId });

  if (!domain || !platform || !accountId) {
    return { success: false, error: 'domain/platform/accountId 不能为空' };
  }

  try {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      return { success: false, error: '无法获取发送者窗口' };
    }

    const sourceSession = senderWindow.webContents.session;
    const targetSession = getAccountSession(platform, accountId);

    if (sourceSession === targetSession) {
      console.log('[Cookie Migration] ℹ️ 当前已在目标账号 session，跳过迁移');
      return { success: true, migratedCount: 0, message: 'already-in-target-session' };
    }

    const sourceCookies = await sourceSession.cookies.get({});
    console.log(`[Cookie Migration] 源 session 共有 ${sourceCookies.length} 个 cookies`);

    const isShipinhaoAccountMigration = platform === 'shipinhao' && isShipinhaoSessionMigrationDomain(domain);
    const migrationDomains = isShipinhaoAccountMigration ? SHIPINHAO_SESSION_COOKIE_DOMAINS : [domain];
    console.log('[Cookie Migration] 实际迁移域集合:', migrationDomains);

    const domainCookies = sourceCookies.filter(cookie => {
      return isShipinhaoAccountMigration
        ? shouldMigrateCookieForDomain(cookie.domain, domain)
        : matchesGenericCookieDomain(cookie.domain, domain);
    });

    console.log(`[Cookie Migration] 找到 ${domainCookies.length} 个 ${migrationDomains.join(', ')} 的 cookies`);
    if (domainCookies.length === 0) {
      return { success: false, error: `没有找到 ${domain} 的 cookies` };
    }

    const targetCookies = await targetSession.cookies.get({});
    for (const cookie of targetCookies) {
      const shouldDelete = isShipinhaoAccountMigration
        ? shouldMigrateCookieForDomain(cookie.domain, domain)
        : matchesGenericCookieDomain(cookie.domain, domain);
      if (!shouldDelete) {
        continue;
      }
      try {
        const cookieDomain = normalizeSessionCookieDomain(cookie.domain);
        const cookieUrl = `${cookie.secure ? 'https' : 'http'}://${cookieDomain}${cookie.path}`;
        await targetSession.cookies.remove(cookieUrl, cookie.name);
      } catch (_) {
        // ignore
      }
    }

    let migratedCount = 0;
    const dedupedDomainCookies = dedupeCookiesForSessionSave(platform, domainCookies, 'migrate-cookies-to-account-session');
    const oneYearFromNow = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);
    for (const cookie of dedupedDomainCookies) {
      try {
        const newCookie = buildCookieSetDetails(cookie, cookie.expirationDate || oneYearFromNow);
        await targetSession.cookies.set(newCookie);
        migratedCount++;
      } catch (err) {
        console.error(`[Cookie Migration] 迁移到账号 session 失败: ${cookie.name} @ ${cookie.domain}`, err.message);
      }
    }

    await targetSession.flushStorageData();
    if (isShipinhaoAccountMigration) {
      await dedupShipinhaoCookiesOnce(targetSession, '视频号授权迁移账号 session');
    }
    console.log('[Cookie Migration] ✅ 账号 session 迁移完成:', { platform, accountId, domain, migratedCount });
    return { success: true, migratedCount, totalFound: domainCookies.length, dedupedCount: dedupedDomainCookies.length, domains: migrationDomains };
  } catch (err) {
    console.error('[Cookie Migration] 迁移到账号 session 失败:', err);
    return { success: false, error: err.message };
  }
});

// ========== 清除指定域名的 Cookies ==========
ipcMain.handle('clear-domain-cookies', async (event, domain) => {
  console.log('[Clear Cookies] ========== API 调用 ==========');
  console.log('[Clear Cookies] 请求清除域名:', domain);

  if (!domain) {
    return { success: false, error: '域名不能为空' };
  }

  try {
    // 获取调用者的 session（可能是 BrowserView 或子窗口）
    let ses = null;
    let sessionSource = '';

    // 检查是否来自 BrowserView
    if (browserView && event.sender === browserView.webContents) {
      ses = browserView.webContents.session;
      sessionSource = 'BrowserView';
    } else {
      // 检查是否来自子窗口
      const senderWindow = BrowserWindow.fromWebContents(event.sender);
      if (senderWindow) {
        ses = senderWindow.webContents.session;
        sessionSource = `子窗口 (ID: ${senderWindow.id})`;
      }
    }

    if (!ses) {
      console.error('[Clear Cookies] 无法获取 session');
      return { success: false, error: '无法获取 session' };
    }

    console.log(`[Clear Cookies] Session 来源: ${sessionSource}`);
    const cookies = await ses.cookies.get({});
    console.log(`[Clear Cookies] 当前共有 ${cookies.length} 个 cookies`);

    let deletedCount = 0;
    for (const cookie of cookies) {
      // 匹配域名（包括子域名）
      const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
      const shouldDelete = cookieDomain.includes(domain) || domain.includes(cookieDomain);

      // 调试：显示所有 Cookie 的匹配情况
      if (cookie.domain.includes('weixin') || cookie.domain.includes('channels')) {
        console.log(`[Clear Cookies] 检查: ${cookie.name} @ ${cookie.domain}, 匹配: ${shouldDelete}`);
      }

      if (shouldDelete) {
        // 使用原始域名（保留点）构建 URL
        // 对于 .channels.weixin.qq.com，需要使用去掉点的域名作为 host
        const urlHost = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
        const cookieUrl = `${cookie.secure ? 'https' : 'http'}://${urlHost}${cookie.path}`;

        console.log(`[Clear Cookies] 尝试删除: ${cookie.name} @ ${cookie.domain}`);
        console.log(`[Clear Cookies] Cookie 详情:`, {
          name: cookie.name,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite
        });
        console.log(`[Clear Cookies] 使用 URL: ${cookieUrl}`);

        try {
          await ses.cookies.remove(cookieUrl, cookie.name);
          deletedCount++;
          console.log(`[Clear Cookies] ✓ 删除成功: ${cookie.name} @ ${cookie.domain}`);
        } catch (err) {
          console.error(`[Clear Cookies] ✗ 删除失败: ${cookie.name} @ ${cookie.domain}`, err.message);

          // 如果删除失败，尝试多种 URL 格式
          const urlsToTry = [
            `${cookie.secure ? 'https' : 'http'}://${cookie.domain}${cookie.path}`, // 带点的域名
            `${cookie.secure ? 'https' : 'http'}://${urlHost}/`, // 根路径
            `${cookie.secure ? 'https' : 'http'}://${cookie.domain}/`, // 带点的域名 + 根路径
          ];

          let retrySuccess = false;
          for (const tryUrl of urlsToTry) {
            try {
              console.log(`[Clear Cookies] 重试 URL: ${tryUrl}`);
              await ses.cookies.remove(tryUrl, cookie.name);
              deletedCount++;
              retrySuccess = true;
              console.log(`[Clear Cookies] ✓ 重试成功: ${cookie.name} @ ${cookie.domain} (URL: ${tryUrl})`);
              break;
            } catch (retryErr) {
              console.error(`[Clear Cookies] ✗ 重试失败 (${tryUrl}):`, retryErr.message);
            }
          }

          if (!retrySuccess) {
            console.error(`[Clear Cookies] ❌ 所有重试都失败了: ${cookie.name} @ ${cookie.domain}`);
          }
        }
      }
    }

    console.log(`[Clear Cookies] ========== 清除完成 ==========`);
    console.log(`[Clear Cookies] ✅ 共删除 ${deletedCount} 个 cookies`);

    return { success: true, deletedCount };
  } catch (err) {
    console.error('[Clear Cookies] 清除失败:', err);
    return { success: false, error: err.message };
  }
});

// ========== 视频号同名 Cookie 去重 ==========
ipcMain.handle('dedupe-shipinhao-cookies', async (event) => {
  try {
    let targetSession = null;
    let sessionSource = '';

    if (browserView && event.sender === browserView.webContents) {
      targetSession = browserView.webContents.session;
      sessionSource = 'BrowserView';
    } else {
      const senderWindow = BrowserWindow.fromWebContents(event.sender);
      if (senderWindow) {
        targetSession = senderWindow.webContents.session;
        sessionSource = `子窗口 (ID: ${senderWindow.id})`;
      }
    }

    if (!targetSession) {
      return { success: false, error: '无法获取当前 session' };
    }

    const removedCount = await dedupShipinhaoCookiesOnce(targetSession, `视频号手动去重 ${sessionSource}`);
    installShipinhaoCookieDedup(targetSession, `视频号手动去重 ${sessionSource}`);
    return { success: true, removedCount };
  } catch (err) {
    console.error('[Shipinhao Cookie Dedupe] 手动去重失败:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('clear-shipinhao-login-identity-cookies', async (event) => {
  try {
    let targetSession = null;
    let sessionSource = '';

    if (browserView && event.sender === browserView.webContents) {
      targetSession = browserView.webContents.session;
      sessionSource = 'BrowserView';
    } else {
      const senderWindow = BrowserWindow.fromWebContents(event.sender);
      if (senderWindow) {
        targetSession = senderWindow.webContents.session;
        sessionSource = `子窗口 (ID: ${senderWindow.id})`;
      }
    }

    if (!targetSession) {
      return { success: false, error: '无法获取当前 session' };
    }

    const deletedCount = await clearShipinhaoIdentityCookiesFromSession(targetSession, `视频号登录页清理 ${sessionSource}`);
    installShipinhaoCookieDedup(targetSession, `视频号登录页清理 ${sessionSource}`);
    return { success: true, deletedCount };
  } catch (err) {
    console.error('[Shipinhao Cookie Clear] 登录页身份 cookie 清理失败:', err);
    return { success: false, error: err.message };
  }
});

// ========== 全局数据存储（用于跨页面数据传递） ==========

// 存储数据
ipcMain.handle('global-storage-set', async (event, key, value) => {
  console.log('[Global Storage] 存储数据:', key, '=', summarizeGlobalStorageValue(key, value));
  globalStorage[key] = value;
  if (rememberWindowPublishDataFromStorageKey(key, value)) {
    console.log('[Global Storage] 🧷 已更新发布数据内存备份:', key);
  }
  saveGlobalStorage(); // 持久化保存
  return { success: true };
});

// 获取数据
ipcMain.handle('global-storage-get', async (event, key) => {
  let value = globalStorage[key];
  const publishWindowId = getPublishWindowIdFromStorageKey(key);
  if ((value === undefined || value === null) && publishWindowId !== null) {
    value = getWindowPublishData(publishWindowId);
  }
  console.log('[Global Storage] 获取数据:', key, '=', summarizeGlobalStorageValue(key, value));
  return { success: true, value };
});

// 删除数据
ipcMain.handle('global-storage-remove', async (event, key) => {
  console.log('[Global Storage] 删除数据:', key);
  const publishWindowId = getPublishWindowIdFromStorageKey(key);
  if (publishWindowId !== null && globalStorage[key]) {
    rememberWindowPublishData(publishWindowId, globalStorage[key]);
    console.log('[Global Storage] 🧷 删除前保留发布数据内存备份:', key);
  }
  delete globalStorage[key];
  saveGlobalStorage(); // 持久化保存
  return { success: true };
});

// 获取所有数据
ipcMain.handle('global-storage-get-all', async () => {
  console.log('[Global Storage] 获取所有数据 keys:', Object.keys(globalStorage));
  return { success: true, data: { ...globalStorage } };
});

// 清空所有数据
ipcMain.handle('global-storage-clear', async () => {
  console.log('[Global Storage] 清空所有数据');
  globalStorage = {};
  saveGlobalStorage(); // 持久化保存
  return { success: true };
});

// 调试：将内容页面传来的文本保存到 userData/debug-dumps 目录
ipcMain.handle('write-debug-file', async (event, payload = {}) => {
  try {
    const prefixRaw = typeof payload.prefix === 'string' ? payload.prefix : 'debug';
    const safePrefix = prefixRaw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'debug';
    const content = typeof payload.content === 'string'
      ? payload.content
      : JSON.stringify(payload.content ?? null, null, 2);

    const dumpDir = path.join(app.getPath('userData'), 'debug-dumps');
    if (!fs.existsSync(dumpDir)) {
      fs.mkdirSync(dumpDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${safePrefix}-${timestamp}.json`;
    const filePath = path.join(dumpDir, fileName);
    fs.writeFileSync(filePath, content, 'utf8');

    console.log('[Debug Dump] ✅ 已写入文件:', filePath, `(${content.length} chars)`);
    return { success: true, filePath, fileName, size: content.length };
  } catch (err) {
    console.error('[Debug Dump] ❌ 写入失败:', err);
    return { success: false, error: err.message };
  }
});

// ========== 视频下载功能（通过主进程绕过跨域限制） ==========
// 优化：添加文件大小限制，防止内存溢出
const MAX_VIDEO_SIZE = 200 * 1024 * 1024; // 200MB 限制

ipcMain.handle('download-video', async (event, url) => {
  console.log('[Video Download] 开始下载:', url);

  if (!url) {
    return { success: false, error: 'No URL provided' };
  }

  // 内部下载函数，支持重定向
  const downloadWithRedirect = (downloadUrl, redirectCount = 0) => {
    return new Promise((resolve) => {
      if (redirectCount > 5) {
        resolve({ success: false, error: 'Too many redirects' });
        return;
      }

      const https = require('https');
      const http = require('http');
      const protocol = downloadUrl.startsWith('https') ? https : http;

      const request = protocol.get(downloadUrl, {
        headers: {
          'User-Agent': STANDARD_USER_AGENT
        }
      }, (response) => {
        // 处理重定向
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          let redirectUrl = response.headers.location;
          // 处理相对路径重定向
          if (!redirectUrl.startsWith('http')) {
            const urlObj = new URL(downloadUrl);
            redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
          }
          console.log('[Video Download] 重定向到:', redirectUrl);
          resolve(downloadWithRedirect(redirectUrl, redirectCount + 1));
          return;
        }

        if (response.statusCode !== 200) {
          resolve({ success: false, error: `HTTP error: ${response.statusCode}` });
          return;
        }

        // 优化：检查文件大小
        const contentLength = parseInt(response.headers['content-length'], 10);
        if (contentLength && contentLength > MAX_VIDEO_SIZE) {
          response.destroy();
          resolve({ success: false, error: `File too large: ${Math.round(contentLength / 1024 / 1024)}MB (max ${MAX_VIDEO_SIZE / 1024 / 1024}MB)` });
          return;
        }

        const chunks = [];
        let totalSize = 0;
        const contentType = response.headers['content-type'] || 'video/mp4';

        response.on('data', (chunk) => {
          totalSize += chunk.length;
          // 优化：实时检查大小，防止超限
          if (totalSize > MAX_VIDEO_SIZE) {
            response.destroy();
            resolve({ success: false, error: `Download exceeded size limit: ${Math.round(totalSize / 1024 / 1024)}MB` });
            return;
          }
          chunks.push(chunk);
        });

        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const base64Data = buffer.toString('base64');
          console.log('[Video Download] 下载完成，大小:', buffer.length, 'bytes');

          // 优化：立即清理 chunks 数组释放内存
          chunks.length = 0;

          resolve({
            success: true,
            data: base64Data,
            contentType: contentType,
            size: buffer.length
          });
        });

        response.on('error', (err) => {
          console.error('[Video Download] 响应错误:', err);
          resolve({ success: false, error: err.message });
        });
      });

      request.on('error', (err) => {
        console.error('[Video Download] 请求错误:', err);
        resolve({ success: false, error: err.message });
      });

      // 优化：增加超时时间到 120 秒
      request.setTimeout(120000, () => {
        request.destroy();
        resolve({ success: false, error: 'Download timeout (120s)' });
      });
    });
  };

  try {
    return await downloadWithRedirect(url);
  } catch (err) {
    console.error('[Video Download] 异常:', err);
    return { success: false, error: err.message };
  }
});

// ========== 图片下载功能（通过主进程绕过跨域限制） ==========
ipcMain.handle('download-image', async (event, url) => {
  console.log('[Image Download] 开始下载:', url);

  if (!url) {
    return { success: false, error: 'No URL provided' };
  }

  try {
    return await downloadImageAsBase64(url);
  } catch (err) {
    console.error('[Image Download] 异常:', err);
    return { success: false, error: err.message };
  }
});

// ========== 文件下载功能（从内容页面触发） ==========
ipcMain.handle('trigger-download', async (event, url) => {
  console.log('[Trigger Download] 收到下载请求:', url);

  if (!url) {
    return { success: false, error: 'No URL provided' };
  }

  try {
    // 触发下载
    if (browserView && !browserView.webContents.isDestroyed()) {
      browserView.webContents.downloadURL(url);
      return { success: true };
    }
    return { success: false, error: 'BrowserView not available' };
  } catch (err) {
    console.error('[Trigger Download] 错误:', err);
    return { success: false, error: err.message };
  }
});

// ========== 第三方窗口关闭前保存登录信息的公共函数 ==========
// 用于在窗口关闭前自动上传最新的登录信息到后台

function getPublishBackendAccountId(publishData) {
  return publishData?.element?.account_info?.id
    || publishData?.element?.accountInfo?.id
    || publishData?.account_info?.id
    || publishData?.accountInfo?.id
    || publishData?.element?.media_auth_id
    || publishData?.element?.mediaAuthId
    || null;
}

function buildLatestSessionCacheKey(platform, backendAccountId) {
  if (!platform || !backendAccountId) {
    return '';
  }
  return `latest_session_${platform}_${backendAccountId}`;
}

function getLatestSessionCache(platform, backendAccountId) {
  const cacheKey = buildLatestSessionCacheKey(platform, backendAccountId);
  if (!cacheKey) {
    return null;
  }
  const snapshot = globalStorage[cacheKey] || null;
  if (!snapshot) {
    return null;
  }
  if (isSessionSnapshotExpired(snapshot)) {
    delete globalStorage[cacheKey];
    saveGlobalStorage();
    console.log(`[Save Session] ⏰ 本地最新会话缓存已过期，已清理: ${cacheKey}`);
    return null;
  }
  if (snapshot.sessionData) {
    const restoreData = cloneSerializable(snapshot.sessionData) || snapshot.sessionData;
    if (restoreData && typeof restoreData === 'object' && !Array.isArray(restoreData)) {
      if (!restoreData.timestamp && snapshot.timestamp) {
        restoreData.timestamp = snapshot.timestamp;
      }
      if (!restoreData.domain && snapshot.domain) {
        restoreData.domain = snapshot.domain;
      }
      if ((!Array.isArray(restoreData.cookieDomains) || restoreData.cookieDomains.length === 0) && Array.isArray(snapshot.cookieDomains)) {
        restoreData.cookieDomains = snapshot.cookieDomains;
      }
      if (!restoreData.source && snapshot.source) {
        restoreData.source = snapshot.source;
      }
    }
    return restoreData;
  }
  return snapshot;
}

const SHIPINHAO_SAVE_DEDUP_COOKIE_NAMES = new Set(['sessionid', 'wxuin', 'pass_ticket', 'wxsid', 'wxload']);

function normalizeCookieDomainForSave(domain) {
  return String(domain || '').toLowerCase().replace(/^\./, '');
}

function buildCookieStorageKey(cookie) {
  return [
    String(cookie?.name || ''),
    String(cookie?.domain || '').toLowerCase(),
    cookie?.path || '/',
    cookie?.secure ? '1' : '0'
  ].join('|');
}

function shouldPreferCookieCandidate(currentEntry, candidateEntry) {
  const current = currentEntry.cookie;
  const candidate = candidateEntry.cookie;
  const currentHasValue = current.value !== undefined && current.value !== null && String(current.value) !== '';
  const candidateHasValue = candidate.value !== undefined && candidate.value !== null && String(candidate.value) !== '';
  if (currentHasValue !== candidateHasValue) {
    return candidateHasValue;
  }

  const currentExpires = Number(current.expirationDate || 0);
  const candidateExpires = Number(candidate.expirationDate || 0);
  if (currentExpires !== candidateExpires) {
    return candidateExpires > currentExpires;
  }

  return candidateEntry.index > currentEntry.index;
}

function getShipinhaoCookieDomainPriority(cookie) {
  const rawDomain = String(cookie?.domain || '').toLowerCase();
  const domain = rawDomain.replace(/^\./, '');
  if (domain === 'channels.weixin.qq.com') return 60;
  if (domain === 'weixin.qq.com') return 45;
  if (domain === 'mp.weixin.qq.com') return 35;
  if (domain === 'wx.qq.com') return 30;
  if (domain === 'qq.com') return 20;
  return 0;
}

function shouldPreferShipinhaoCookie(currentEntry, candidateEntry) {
  const currentPriority = getShipinhaoCookieDomainPriority(currentEntry.cookie);
  const candidatePriority = getShipinhaoCookieDomainPriority(candidateEntry.cookie);
  if (currentPriority !== candidatePriority) {
    return candidatePriority > currentPriority;
  }

  const current = currentEntry.cookie;
  const candidate = candidateEntry.cookie;
  const currentHasValue = current.value !== undefined && current.value !== null && String(current.value) !== '';
  const candidateHasValue = candidate.value !== undefined && candidate.value !== null && String(candidate.value) !== '';
  if (currentHasValue !== candidateHasValue) {
    return candidateHasValue;
  }

  const currentExpires = Number(current.expirationDate || 0);
  const candidateExpires = Number(candidate.expirationDate || 0);
  if (currentExpires !== candidateExpires) {
    return candidateExpires > currentExpires;
  }

  return candidateEntry.index > currentEntry.index;
}

function dedupeCookiesForSessionSave(platform, cookiesArray, source = 'session-save') {
  if (!Array.isArray(cookiesArray) || cookiesArray.length === 0) {
    return [];
  }

  const exactMap = new Map();
  cookiesArray.forEach((cookie, index) => {
    if (!cookie || !cookie.name || !cookie.domain) {
      return;
    }
    const entry = {
      cookie: { ...cookie },
      index
    };
    const key = buildCookieStorageKey(entry.cookie);
    const current = exactMap.get(key);
    const useShipinhaoPreference = platform === 'shipinhao'
      && SHIPINHAO_SAVE_DEDUP_COOKIE_NAMES.has(String(entry.cookie.name || ''))
      && isShipinhaoCookieDomain(entry.cookie.domain);
    const shouldPrefer = useShipinhaoPreference
      ? shouldPreferShipinhaoCookie
      : shouldPreferCookieCandidate;
    if (!current || shouldPrefer(current, entry)) {
      exactMap.set(key, entry);
    }
  });

  let entries = Array.from(exactMap.values());
  if (platform === 'shipinhao') {
    const grouped = new Map();
    const passthrough = [];
    entries.forEach(entry => {
      const cookie = entry.cookie;
      const name = String(cookie.name || '');
      const domain = normalizeCookieDomainForSave(cookie.domain);
      if (SHIPINHAO_SAVE_DEDUP_COOKIE_NAMES.has(name)
        && (domain === 'channels.weixin.qq.com'
          || domain === 'weixin.qq.com'
          || domain === 'mp.weixin.qq.com'
          || domain === 'wx.qq.com'
          || domain === 'qq.com')) {
        const groupKey = `${name}|${cookie.path || '/'}`;
        const current = grouped.get(groupKey);
        if (!current || shouldPreferShipinhaoCookie(current, entry)) {
          grouped.set(groupKey, entry);
        }
      } else {
        passthrough.push(entry);
      }
    });
    entries = passthrough.concat(Array.from(grouped.values()));
  }

  entries.sort((a, b) => a.index - b.index);
  const result = entries.map(entry => entry.cookie);
  if (result.length !== cookiesArray.length) {
    console.log(`[Save Session] 🧹 ${source} cookies 去重: ${cookiesArray.length} -> ${result.length} (platform=${platform || 'unknown'})`);
  }
  return result;
}

function saveLatestSessionCache({ platform, backendAccountId, cookieDomains, cookiesArray, sessionData = null, source = 'window-close' }) {
  const cacheKey = buildLatestSessionCacheKey(platform, backendAccountId);
  const dedupedCookiesArray = dedupeCookiesForSessionSave(platform, cookiesArray, `${source}:cache`);
  if (!cacheKey || dedupedCookiesArray.length === 0) {
    return null;
  }

  const normalizedSessionData = parseSessionData(sessionData);
  const clonedSessionData = normalizedSessionData
    ? (cloneSerializable(normalizedSessionData) || normalizedSessionData)
    : null;
  const mergedCookieDomains = Array.from(new Set([
    ...(Array.isArray(cookieDomains) ? cookieDomains : []),
    ...collectSessionDomains(normalizedSessionData)
  ]));

  let sessionDataPayload;
  if (clonedSessionData && typeof clonedSessionData === 'object' && !Array.isArray(clonedSessionData)) {
    sessionDataPayload = clonedSessionData;
  } else {
    sessionDataPayload = {};
  }
  sessionDataPayload.cookies = dedupeCookiesForSessionSave(
    platform,
    Array.isArray(sessionDataPayload.cookies) && sessionDataPayload.cookies.length > 0
      ? sessionDataPayload.cookies
      : dedupedCookiesArray,
    `${source}:cache-sessionData`
  );
  if (mergedCookieDomains.length > 0) {
    if (!sessionDataPayload.domain) {
      sessionDataPayload.domain = mergedCookieDomains[0];
    }
    sessionDataPayload.domains = mergedCookieDomains;
    sessionDataPayload.cookieDomains = mergedCookieDomains;
  }
  sessionDataPayload.timestamp = Date.now();
  if (!sessionDataPayload.source) {
    sessionDataPayload.source = source;
  }

  const payload = {
    platform,
    backendAccountId,
    domain: mergedCookieDomains[0] || '',
    cookieDomains: mergedCookieDomains,
    cookies: dedupedCookiesArray,
    sessionData: sessionDataPayload,
    timestamp: Date.now(),
    source
  };

  globalStorage[cacheKey] = payload;
  saveGlobalStorage();
  console.log(`[Save Session] 💾 已写入本地最新会话缓存: ${cacheKey}, cookies=${dedupedCookiesArray.length}`);
  return payload;
}

function getApiOriginForSessionSave() {
  let apiOrigin = config.apiBaseUrl;
  if (browserView && !browserView.webContents.isDestroyed()) {
    try {
      const mainUrl = browserView.webContents.getURL();
      const urlObj = new URL(mainUrl);
      if (urlObj.origin && !urlObj.origin.includes('file://')) {
        apiOrigin = urlObj.origin;
      }
    } catch (urlErr) {
      console.error('[Save Session] 解析主窗口 URL 失败:', urlErr);
    }
  }
  return apiOrigin;
}

async function buildSessionSaveAuthHeaders(apiOrigin) {
  const headers = {};
  const token = String(globalStorage.login_token || '');
  if (token) {
    headers.token = token;
    headers.access_token = token;
  }

  if (browserView && !browserView.webContents.isDestroyed()) {
    try {
      const ses = browserView.webContents.session;
      const apiUrl = new URL(apiOrigin);
      const domain = apiUrl.hostname;
      const allCookies = await ses.cookies.get({});
      const domainCookies = allCookies.filter(cookie => {
        const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
        return cookieDomain.includes(domain) || domain.includes(cookieDomain);
      });
      const cookieString = domainCookies.map(cookie => {
        const value = /[^\x00-\xff]/.test(cookie.value) ? encodeURIComponent(cookie.value) : cookie.value;
        return `${cookie.name}=${value}`;
      }).join('; ');
      if (cookieString) {
        headers.Cookie = cookieString;
      }
      console.log(`[Save Session] 主站认证 cookies: ${domainCookies.length} 个`);
    } catch (err) {
      console.warn('[Save Session] 读取主站认证 cookies 失败:', err.message);
    }
  }

  headers.Origin = apiOrigin;
  headers.Referer = `${apiOrigin.replace(/\/$/, '')}/`;
  return headers;
}

async function getFullSessionDataFromWebContents(webContents, domain) {
  if (!webContents || webContents.isDestroyed()) {
    return { success: false, error: 'webContents 不可用' };
  }

  try {
    console.log('[Session Data] ========== 开始获取完整会话数据 ==========');
    console.log('[Session Data] 目标域名:', domain);

    const ses = webContents.session;
    const allCookies = await ses.cookies.get({});
    const domainCookies = allCookies.filter(cookie => {
      const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
      return cookieDomain.includes(domain) || domain.includes(cookieDomain);
    });

    const targetExpiration = getSessionSnapshotExpirationDate();
    const cookiesArray = domainCookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      expirationDate: targetExpiration
    }));
    console.log(`[Session Data] Cookies: ${cookiesArray.length} 个`);

    let storageData = { localStorage: {}, sessionStorage: {} };
    try {
      storageData = await webContents.executeJavaScript(`
        (() => {
          const result = { localStorage: {}, sessionStorage: {} };
          try {
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              result.localStorage[key] = localStorage.getItem(key);
            }
          } catch (e) {
            console.error('获取 localStorage 失败:', e);
          }
          try {
            for (let i = 0; i < sessionStorage.length; i++) {
              const key = sessionStorage.key(i);
              result.sessionStorage[key] = sessionStorage.getItem(key);
            }
          } catch (e) {
            console.error('获取 sessionStorage 失败:', e);
          }
          return result;
        })()
      `);
      console.log(`[Session Data] localStorage: ${Object.keys(storageData.localStorage).length} 项`);
      console.log(`[Session Data] sessionStorage: ${Object.keys(storageData.sessionStorage).length} 项`);
    } catch (err) {
      console.error('[Session Data] 获取 Storage 失败:', err.message);
    }

    let indexedDBData = {};
    try {
      indexedDBData = await webContents.executeJavaScript(`
        (async function() {
          const result = {};
          try {
            const databases = await indexedDB.databases();
            console.log('[IndexedDB] 发现数据库:', databases.length);

            for (const dbInfo of databases) {
              const dbName = dbInfo.name;
              if (!dbName) continue;

              try {
                const db = await new Promise((resolve, reject) => {
                  const request = indexedDB.open(dbName);
                  request.onsuccess = () => resolve(request.result);
                  request.onerror = () => reject(request.error);
                });

                const dbData = {
                  version: db.version,
                  stores: {}
                };

                const storeNames = Array.from(db.objectStoreNames);
                for (const storeName of storeNames) {
                  try {
                    const tx = db.transaction(storeName, 'readonly');
                    const store = tx.objectStore(storeName);
                    const allData = await new Promise((resolve, reject) => {
                      const request = store.getAll();
                      request.onsuccess = () => resolve(request.result);
                      request.onerror = () => reject(request.error);
                    });

                    if (allData.length <= 1000) {
                      dbData.stores[storeName] = allData;
                    } else {
                      dbData.stores[storeName] = allData.slice(0, 1000);
                      dbData.stores[storeName + '_truncated'] = true;
                    }
                  } catch (storeErr) {
                    console.error('[IndexedDB] 读取 store 失败:', storeName, storeErr);
                  }
                }

                db.close();
                result[dbName] = dbData;
              } catch (dbErr) {
                console.error('[IndexedDB] 打开数据库失败:', dbName, dbErr);
              }
            }
          } catch (e) {
            console.error('[IndexedDB] 获取数据库列表失败:', e);
          }
          return result;
        })()
      `);
      console.log(`[Session Data] IndexedDB: ${Object.keys(indexedDBData).length} 个数据库`);
    } catch (err) {
      console.error('[Session Data] 获取 IndexedDB 失败:', err.message);
    }

    const sessionData = {
      domain,
      timestamp: Date.now(),
      cookies: cookiesArray,
      localStorage: storageData.localStorage,
      sessionStorage: storageData.sessionStorage,
      indexedDB: indexedDBData
    };

    const dataSize = JSON.stringify(sessionData).length;
    console.log(`[Session Data] ========== 获取完成 ==========`);
    console.log(`[Session Data] 总数据大小: ${Math.round(dataSize / 1024)} KB`);

    return { success: true, data: sessionData, size: dataSize };
  } catch (err) {
    console.error('[Session Data] 获取失败:', err);
    return { success: false, error: err.message };
  }
}

function evaluateSessionSaveResponse(statusCode, responseJson, responseText) {
  if (!(statusCode >= 200 && statusCode < 300)) {
    return {
      success: false,
      error: `HTTP ${statusCode}`,
      detail: responseText
    };
  }

  if (responseJson && typeof responseJson === 'object') {
    if (responseJson.success === false) {
      return {
        success: false,
        error: responseJson.msg || responseJson.message || '后台返回 success=false',
        detail: responseJson
      };
    }

    if (Object.prototype.hasOwnProperty.call(responseJson, 'code')) {
      const numericCode = Number(responseJson.code);
      if (Number.isFinite(numericCode) && ![0, 1, 200].includes(numericCode)) {
        return {
          success: false,
          error: responseJson.msg || responseJson.message || `后台返回业务码 ${responseJson.code}`,
          detail: responseJson
        };
      }
    }
  }

  return { success: true };
}

function hasWindowSessionSaveCandidate(windowId) {
  if (windowAccountMap.get(windowId)) {
    return true;
  }
  return !!getWindowPublishData(windowId);
}

const PUBLISH_SAVE_SESSION_PLATFORMS = new Set([
  'tengxunhao',
  'sohuhao',
  'douyin',
  'baijiahao',
  'toutiao',
  'wangyihao',
  'zhihu',
  'xinlang',
  'xiaohongshu',
  'shipinhao'
]);

function isPublishSaveSessionUnregisteredResult(result) {
  return result && !result.success && /未注册/.test(result.error || '');
}

function buildPublishSaveSessionScript(platform) {
  return `(async () => {
    if (typeof window.__publishSaveSession__ === 'function') {
      try { return await window.__publishSaveSession__(${JSON.stringify(platform)}); }
      catch (e) { return { success: false, error: e && e.message }; }
    }
    return { success: false, error: '__publishSaveSession__ 未注册' };
  })()`;
}

async function runPublishSaveSessionScript(targetWindow, platform, logPrefix) {
  if (!platform || !PUBLISH_SAVE_SESSION_PLATFORMS.has(platform)) {
    return null;
  }
  if (!targetWindow || targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
    return { success: false, error: '窗口已销毁' };
  }

  const code = buildPublishSaveSessionScript(platform);
  const executeSave = async (stage) => {
    if (!targetWindow || targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
      return { success: false, error: '窗口已销毁' };
    }
    const result = await Promise.race([
      targetWindow.webContents.executeJavaScript(code),
      new Promise((_, rej) => setTimeout(() => rej(new Error('脚本侧保存超时')), 30000))
    ]);
    console.log(`[${logPrefix}] 🔐 脚本保存结果(${stage}):`, result);
    return result;
  };

  let scriptResult = await executeSave('initial');
  if (isPublishSaveSessionUnregisteredResult(scriptResult)) {
    console.log(`[${logPrefix}] 🔁 __publishSaveSession__ 未注册，等待脚本注入完成后重试`);
    await new Promise(resolve => setTimeout(resolve, 800));
    scriptResult = await executeSave('wait-retry');
  }

  if (isPublishSaveSessionUnregisteredResult(scriptResult)) {
    console.log(`[${logPrefix}] 🔁 __publishSaveSession__ 仍未注册，强制注入 common.js 后重试`);
    try {
      const commonPath = path.join(__dirname, 'injected-scripts', 'common.js');
      const commonCode = fs.readFileSync(commonPath, 'utf-8');
      await targetWindow.webContents.executeJavaScript(commonCode);
      scriptResult = await executeSave('common-retry');
    } catch (retryErr) {
      console.warn(`[${logPrefix}] ⚠️ 强制注入 common.js 重试失败:`, retryErr.message);
    }
  }

  return scriptResult;
}

async function collectWindowSessionSaveContext(targetWindow, windowId) {
  if (!targetWindow || targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
    console.log('[Save Session] ⚠️ 窗口已销毁，跳过保存');
    return { success: false, error: '窗口已销毁' };
  }

  const windowContext = windowContextMap.get(windowId) || null;
  const publishData = getWindowPublishData(windowId);
  const mappedAccountInfo = windowAccountMap.get(windowId) || null;
  const inferredPlatform = mappedAccountInfo?.platform || publishData?.platform || windowContext?.platform || null;
  const inferredAccountId = mappedAccountInfo?.accountId
    || String(getPublishBackendAccountId(publishData) || `shared_${windowId}`);
  const accountInfo = inferredPlatform ? {
    platform: inferredPlatform,
    accountId: inferredAccountId
  } : null;

  if (!accountInfo) {
    console.log('[Save Session] ⚠️ 该窗口没有可识别的平台上下文，跳过保存');
    return { success: false, error: '缺少平台上下文' };
  }

  console.log('[Save Session] 平台:', accountInfo.platform, '账号ID:', accountInfo.accountId);

  if (!publishData) {
    console.log('[Save Session] ⚠️ 未找到发布数据，跳过保存');
    return { success: false, error: '未找到发布数据' };
  }

  const backendAccountId = getPublishBackendAccountId(publishData);

  const saveSessionApi = publishData?.element?.saveSessionApi
    || publishData?.element?.save_session_api
    || config.platformApis[accountInfo.platform];

  let cookieDomains = config.platformDomains[accountInfo.platform] || [];
  const elementCookies = publishData?.element?.cookies;
  if (elementCookies) {
    try {
      const cookiesData = typeof elementCookies === 'string' ? JSON.parse(elementCookies) : elementCookies;
      if (cookiesData.domain) {
        cookieDomains = Array.from(new Set([...(cookieDomains || []), cookiesData.domain]));
        console.log('[Save Session] 从 element.cookies 合并 domain:', cookieDomains);
      }
    } catch (parseErr) {
      console.error('[Save Session] 解析 element.cookies 失败:', parseErr);
    }
  }

  if (!saveSessionApi) {
    console.log('[Save Session] ⚠️ 未找到保存接口配置，跳过保存');
    return { success: false, error: '未找到保存接口配置' };
  }

  if (cookieDomains.length === 0) {
    console.log('[Save Session] ⚠️ 未找到 cookie domain 配置，跳过保存');
    return { success: false, error: '未找到 cookie domain 配置' };
  }

  if (!backendAccountId) {
    console.log('[Save Session] ⚠️ 未找到账号 ID（account_info.id），跳过保存');
    return { success: false, error: '未找到账号 ID' };
  }

  const windowSession = targetWindow.webContents.session;
  const allCookies = await windowSession.cookies.get({});
  const platformCookies = allCookies.filter(cookie => {
    const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
    return cookieDomains.some(domain => cookieDomain.includes(domain) || domain.includes(cookieDomain));
  });
  const snapshotExpirationDate = getSessionSnapshotExpirationDate();

  console.log(`[Save Session] 找到 ${platformCookies.length} 个平台相关 cookies (domains: ${cookieDomains.join(', ')})`);
  if (platformCookies.length === 0) {
    console.log('[Save Session] ⚠️ 未找到平台相关 cookies，跳过保存');
    return { success: false, error: '未找到平台相关 cookies' };
  }

  let cookiesArray = platformCookies.map(cookie => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: snapshotExpirationDate
  }));
  cookiesArray = dedupeCookiesForSessionSave(accountInfo.platform, cookiesArray, 'window-close:platformCookies');

  let fullSessionSnapshot = null;
  try {
    const sessionDomains = cookieDomains.length > 0 ? cookieDomains : [platformCookies[0]?.domain].filter(Boolean);
    const mergedSessionData = {
      domain: sessionDomains[0] || '',
      cookieDomains: sessionDomains,
      domains: sessionDomains,
      timestamp: Date.now(),
      cookies: [],
      localStorage: {},
      sessionStorage: {},
      indexedDB: {}
    };

    mergedSessionData.cookies.push(...cookiesArray);
    const seenSessionCookieKeys = new Set(cookiesArray.map(cookie => buildCookieStorageKey(cookie)));
    const normalizedDomains = Array.from(new Set(sessionDomains
      .filter(Boolean)
      .map(domain => domain.startsWith('.') ? domain.slice(1) : domain)));

    for (const domain of normalizedDomains) {
      const sessionResult = await getFullSessionDataFromWebContents(targetWindow.webContents, domain);
      if (!sessionResult?.success || !sessionResult.data) {
        continue;
      }

      if (Array.isArray(sessionResult.data.cookies)) {
        sessionResult.data.cookies.forEach(cookie => {
          const dedupeKey = [
            cookie.name,
            cookie.domain,
            cookie.path || '/',
            cookie.secure ? '1' : '0'
          ].join('|');
          if (!seenSessionCookieKeys.has(dedupeKey)) {
            seenSessionCookieKeys.add(dedupeKey);
            cookie.expirationDate = snapshotExpirationDate;
            mergedSessionData.cookies.push(cookie);
          }
        });
      }

      if (sessionResult.data.localStorage && Object.keys(sessionResult.data.localStorage).length > 0) {
        mergedSessionData.localStorage[domain] = sessionResult.data.localStorage;
      }
      if (sessionResult.data.sessionStorage && Object.keys(sessionResult.data.sessionStorage).length > 0) {
        mergedSessionData.sessionStorage[domain] = sessionResult.data.sessionStorage;
      }
      if (sessionResult.data.indexedDB && Object.keys(sessionResult.data.indexedDB).length > 0) {
        mergedSessionData.indexedDB[domain] = sessionResult.data.indexedDB;
      }
    }

    mergedSessionData.cookies = dedupeCookiesForSessionSave(accountInfo.platform, mergedSessionData.cookies, 'window-close:fullSessionSnapshot');

    if (mergedSessionData.cookies.length > 0) {
      fullSessionSnapshot = mergedSessionData;
      console.log(`[Save Session] 📦 已采集完整会话快照: cookies=${mergedSessionData.cookies.length}, localStorageDomains=${Object.keys(mergedSessionData.localStorage).length}, indexedDBDomains=${Object.keys(mergedSessionData.indexedDB).length}`);
    }
  } catch (sessionSnapshotErr) {
    console.warn('[Save Session] ⚠️ 采集完整会话快照失败，回退为 cookies-only:', sessionSnapshotErr.message);
  }

  const apiOrigin = getApiOriginForSessionSave();
  console.log('[Save Session] 后台 API 域名:', apiOrigin);
  console.log('[Save Session] 保存接口路径:', saveSessionApi);
  console.log('[Save Session] 账号 ID:', backendAccountId);

  return {
    success: true,
    accountInfo,
    publishData,
    backendAccountId,
    saveSessionApi,
    cookieDomains,
    cookiesArray,
    sessionData: fullSessionSnapshot,
    apiOrigin
  };
}

async function uploadSessionToBackend({ apiOrigin, saveSessionApi, backendAccountId, cookieDomains, cookiesArray, accountInfo }) {
  const uploadCookiesArray = dedupeCookiesForSessionSave(accountInfo?.platform, cookiesArray, 'backend-upload');
  const postData = JSON.stringify({
    id: backendAccountId,
    cookies: JSON.stringify({ domain: cookieDomains[0], cookies: uploadCookiesArray })
  });

  const apiUrl = new URL(saveSessionApi, apiOrigin);
  const protocol = apiUrl.protocol === 'https:' ? https : http;
  const authHeaders = await buildSessionSaveAuthHeaders(apiOrigin);
  const requestHeaders = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData),
    ...authHeaders
  };

  return new Promise((resolve) => {
    const req = protocol.request({
      hostname: apiUrl.hostname,
      port: apiUrl.port || (apiUrl.protocol === 'https:' ? 443 : 80),
      path: `${apiUrl.pathname}${apiUrl.search}`,
      method: 'POST',
      headers: requestHeaders,
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', chunk => {
        data += chunk;
      });
      res.on('end', () => {
        let responseJson = null;
        try {
          responseJson = JSON.parse(data);
        } catch (_) {
          responseJson = null;
        }

        const evaluation = evaluateSessionSaveResponse(res.statusCode || 0, responseJson, data);
        if (!evaluation.success) {
          console.error('[Save Session] ❌ 后台未接受会话数据:', {
            statusCode: res.statusCode,
            error: evaluation.error,
            response: String(data || '').substring(0, 300)
          });
          resolve({
            success: false,
            error: evaluation.error,
            statusCode: res.statusCode,
            response: responseJson || data
          });
          return;
        }

        console.log('[Save Session] ✅ 会话数据已保存到后台, status:', res.statusCode, '响应:', String(data || '').substring(0, 200));
        resolve({
          success: true,
          statusCode: res.statusCode,
          response: responseJson || data,
          cookieCount: uploadCookiesArray.length,
          cookies: uploadCookiesArray,
          backendAccountId
        });
      });
    });

    req.on('error', (err) => {
      console.error('[Save Session] ❌ 保存会话数据到后台失败:', err.message);
      resolve({ success: false, error: err.message });
    });

    req.on('timeout', () => {
      console.error('[Save Session] ❌ 保存请求超时');
      req.destroy();
      resolve({ success: false, error: '请求超时' });
    });

    req.write(postData);
    req.end();
  });
}

async function syncLatestSessionCacheFromWindow(targetWindow, windowId, source = 'script-save') {
  const context = await collectWindowSessionSaveContext(targetWindow, windowId);
  if (!context.success) {
    return context;
  }

  const localCacheSnapshot = saveLatestSessionCache({
    platform: context.accountInfo.platform,
    backendAccountId: context.backendAccountId,
    cookieDomains: context.cookieDomains,
    cookiesArray: context.cookiesArray,
    sessionData: context.sessionData,
    source
  });

  if (!localCacheSnapshot) {
    return {
      success: false,
      error: '未生成本地最新会话缓存',
      accountInfo: context.accountInfo,
      backendAccountId: context.backendAccountId
    };
  }

  return {
    success: true,
    accountInfo: context.accountInfo,
    backendAccountId: context.backendAccountId,
    cookieCount: context.cookiesArray.length,
    source: 'latest-cache-sync'
  };
}

async function persistWindowSessionToBackend(targetWindow, windowId, source = 'window-close') {
  const context = await collectWindowSessionSaveContext(targetWindow, windowId);
  if (!context.success) {
    return context;
  }

  const localCacheSnapshot = saveLatestSessionCache({
    platform: context.accountInfo.platform,
    backendAccountId: context.backendAccountId,
    cookieDomains: context.cookieDomains,
    cookiesArray: context.cookiesArray,
    sessionData: context.sessionData,
    source
  });

  const uploadResult = await uploadSessionToBackend(context);
  if (!uploadResult?.success && context.accountInfo?.platform === 'shipinhao' && localCacheSnapshot) {
    console.warn('[Save Session] ⚠️ 视频号后台保存失败，但本地最新会话缓存已写入，按本地保存成功处理:', uploadResult?.error);
    return {
      success: true,
      localOnly: true,
      backendUploaded: false,
      backendError: uploadResult?.error,
      backendStatusCode: uploadResult?.statusCode,
      statusCode: uploadResult?.statusCode,
      response: uploadResult?.response,
      source: 'local-cache',
      cookieCount: context.cookiesArray.length,
      cookies: context.cookiesArray,
      publishData: context.publishData,
      accountInfo: context.accountInfo,
      backendAccountId: context.backendAccountId,
      sessionData: context.sessionData
    };
  }
  return {
    ...uploadResult,
    publishData: context.publishData,
    accountInfo: context.accountInfo,
    backendAccountId: context.backendAccountId
  };
}

/**
 * 保存窗口的登录信息到后台
 * @param {BrowserWindow} targetWindow - 要保存的窗口
 * @param {number} windowId - 窗口 ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function saveWindowSessionToBackend(targetWindow, windowId, extraDebugInfo) {
  console.log('[Save Session] ========== 窗口关闭前保存登录信息 ==========');
  console.log('[Save Session] windowId:', windowId);
  let result;
  try {
    result = await persistWindowSessionToBackend(targetWindow, windowId, 'window-close');
    console.log('[Save Session] ========== 保存完成 ==========');
  } catch (err) {
    console.error('[Save Session] ❌ 保存失败:', err);
    result = { success: false, error: err.message };
  }

  // 🔍 把保存结果转发到首页 BrowserView 的 DevTools 控制台（F12 可见，打包后也能看）
  try {
    if (browserView && !browserView.webContents.isDestroyed()) {
      const platformDesc = result?.accountInfo?.platform || '未知';
      const backendIdDesc = result?.backendAccountId || '无';
      const cookieCountDesc = result?.cookieCount != null ? String(result.cookieCount) : '0';
      const errDesc = result?.error || '无';
      const statusCodeDesc = result?.statusCode != null ? String(result.statusCode) : '-';

      const diagPayload = {
        windowId,
        platform: platformDesc,
        backendAccountId: backendIdDesc,
        cookieCount: cookieCountDesc,
        statusCode: statusCodeDesc,
        success: !!result?.success,
        error: errDesc,
        response: result?.response,
        source: result?.source,
        publishData: getWindowPublishData(windowId),
        windowAccountMap: windowAccountMap.get(windowId) || null,
        extraDebugInfo: extraDebugInfo || null
      };

      const tag = result?.success ? '[Save Session ✅]' : '[Save Session ❌]';
      const code = `console.${result?.success ? 'log' : 'warn'}(${JSON.stringify(tag)}, ${JSON.stringify(diagPayload)});`;
      browserView.webContents.executeJavaScript(code).catch(() => {});
    }
  } catch (logErr) {
    console.warn('[Save Session] ⚠️ 转发日志失败:', logErr.message);
  }

  return result;
}

// ========== 多账号管理功能 ==========
// 账号 Session 缓存（避免重复创建）
const accountSessions = new Map();

// 生成唯一账号 ID
function generateAccountId(platform) {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 6);
  return `${platform}_${timestamp}_${random}`;
}

// 获取或创建账号的 Session
function getAccountSession(platform, accountId) {
  const partitionName = `persist:${platform}_${accountId}`;

  // 检查缓存
  if (accountSessions.has(partitionName)) {
    console.log(`[Account Session] 从缓存获取 session: ${partitionName}`);
    return accountSessions.get(partitionName);
  }

  // 创建新的持久化 session（禁用 HTTP 缓存，避免 CSS 渲染异常）
  const accountSession = session.fromPartition(partitionName, { cache: false });

  // 配置 User-Agent（与主 session 保持一致）
  const customUA = TAGGED_USER_AGENT;
  accountSession.setUserAgent(customUA);

  // 添加统一请求守卫（阻止 bitbrowser://、主框架静态资源误导航，并兼容网易号 HTTP）
  installSessionRequestGuard(accountSession, `账号 session ${partitionName}`, {
    blockBitbrowser: true,
    blockMainFrameResources: true,
    upgradeMp163: true
  });

  // 缓存 session
  accountSessions.set(partitionName, accountSession);
  console.log(`[Account Session] 创建新 session: ${partitionName}`);
  addContentTypeFix(accountSession, `账号 session ${partitionName}`);

  // 🔑 视频号 cookie 去重监听器：每当有新 cookie 写入，立即删除同名同 path 但 domain 不同的旧版本
  // WeChat 会用 Domain=channels.weixin.qq.com（host-only）和 Domain=.channels.weixin.qq.com（domain-cookie）
  // 同时下发同名 sessionid/wxuin，导致请求时一并发送，后端拿到旧值 → "登录失败"。
  // 通过监听 cookie 变化主动去重，无论 cookie 是 Set-Cookie 头还是 JS 设置都能覆盖。
  if (platform === 'shipinhao') {
    installShipinhaoCookieDedup(accountSession, partitionName);
  }

  return accountSession;
}

// 标记视频号 cookie 去重状态，避免重复监听和递归触发
const shipinhaoDedupInstalledSessions = new WeakSet();
const shipinhaoDedupInProgress = new WeakSet();
const shipinhaoDedupRetryTimers = new WeakMap();
const shipinhaoPreferredCookieBySession = new WeakMap();
const shipinhaoAutoSaveInstalledWindows = new WeakSet();

// 关注的同名 cookie：WeChat 登录态关键凭证
const SHIPINHAO_DEDUP_COOKIE_NAMES = new Set(['sessionid', 'wxuin', 'pass_ticket', 'wxsid', 'wxload']);

// 关注的域：channels.weixin.qq.com 及其父域 .weixin.qq.com / .qq.com
function isShipinhaoCookieDomain(domain) {
  const d = String(domain || '').toLowerCase().replace(/^\./, '');
  return d === 'channels.weixin.qq.com'
    || d === 'weixin.qq.com'
    || d === 'mp.weixin.qq.com'
    || d === 'wx.qq.com'
    || d === 'qq.com';
}

function isShipinhaoCookieUrl(rawUrl = '') {
  try {
    const parsedUrl = new URL(rawUrl);
    return isShipinhaoCookieDomain(parsedUrl.hostname);
  } catch (_) {
    return false;
  }
}

function buildShipinhaoCookieGroupKey(cookie) {
  return `${String(cookie?.name || '')}|${cookie?.path || '/'}`;
}

function rememberShipinhaoPreferredCookie(targetSession, cookie) {
  if (!targetSession || !cookie || !SHIPINHAO_DEDUP_COOKIE_NAMES.has(cookie.name) || !isShipinhaoCookieDomain(cookie.domain)) {
    return;
  }

  let preferredByGroup = shipinhaoPreferredCookieBySession.get(targetSession);
  if (!preferredByGroup) {
    preferredByGroup = new Map();
    shipinhaoPreferredCookieBySession.set(targetSession, preferredByGroup);
  }

  preferredByGroup.set(buildShipinhaoCookieGroupKey(cookie), {
    name: cookie.name,
    value: cookie.value || '',
    domain: cookie.domain,
    path: cookie.path || '/',
    secure: !!cookie.secure,
    httpOnly: !!cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: cookie.expirationDate
  });
}

function buildShipinhaoCookieUrl(cookie) {
  const host = String(cookie?.domain || '').toLowerCase().replace(/^\./, '');
  const pathName = cookie?.path && String(cookie.path).startsWith('/') ? cookie.path : '/';
  return `${cookie?.secure ? 'https' : 'http'}://${host}${pathName}`;
}

function isSameShipinhaoCookieStoreEntry(left, right, includeValue = true) {
  if (!left || !right) return false;
  const sameIdentity = String(left.name || '') === String(right.name || '')
    && String(left.domain || '').toLowerCase() === String(right.domain || '').toLowerCase()
    && (left.path || '/') === (right.path || '/');
  if (!sameIdentity || !includeValue) return sameIdentity;
  return String(left.value || '') === String(right.value || '');
}

async function hasShipinhaoCookieStoreEntry(targetSession, cookie) {
  const candidates = await targetSession.cookies.get({ name: cookie.name });
  return candidates.some(candidate => isSameShipinhaoCookieStoreEntry(candidate, cookie));
}

async function getShipinhaoCookieGroup(targetSession, name, path = '/') {
  const allCookies = await targetSession.cookies.get({ name });
  return allCookies.filter(cookie => SHIPINHAO_DEDUP_COOKIE_NAMES.has(cookie.name)
    && isShipinhaoCookieDomain(cookie.domain)
    && (cookie.path || '/') === (path || '/'));
}

function formatShipinhaoCookieForLog(cookie) {
  const value = String(cookie?.value || '');
  return `${cookie?.name || ''}@${cookie?.domain || ''}${cookie?.path || '/'}(valueLen=${value.length})`;
}

function buildShipinhaoCookieRemovalUrls(cookie) {
  const host = String(cookie?.domain || '').toLowerCase().replace(/^\./, '');
  const pathName = cookie?.path && String(cookie.path).startsWith('/') ? cookie.path : '/';
  const protocols = cookie?.secure ? ['https', 'http'] : ['http', 'https'];
  const hosts = new Set([host]);
  if (host === 'qq.com' || host === 'weixin.qq.com' || host === 'wx.qq.com') {
    hosts.add('channels.weixin.qq.com');
  }

  const paths = new Set([pathName, '/']);
  const urls = [];
  for (const protocol of protocols) {
    for (const candidateHost of hosts) {
      if (!candidateHost) continue;
      for (const candidatePath of paths) {
        urls.push(`${protocol}://${candidateHost}${candidatePath}`);
      }
    }
  }
  return Array.from(new Set(urls));
}

function buildShipinhaoCookieSetDetails(cookie, expirationDate = undefined) {
  return buildCookieSetDetails(cookie, expirationDate);
}

async function expireExactShipinhaoCookie(targetSession, cookie, label) {
  for (const cookieUrl of buildShipinhaoCookieRemovalUrls(cookie)) {
    try {
      await targetSession.cookies.remove(cookieUrl, cookie.name);
      if (!(await hasShipinhaoCookieStoreEntry(targetSession, cookie))) {
        return true;
      }
    } catch (rmErr) {
      console.warn(`[${label}] ⚠️ remove cookie 失败: ${cookie.name} @ ${cookie.domain} (${cookieUrl}): ${rmErr.message}`);
    }
  }

  const expiredDetails = buildShipinhaoCookieSetDetails(cookie, 1);
  expiredDetails.value = '';
  try {
    await targetSession.cookies.set(expiredDetails);
    if (!(await hasShipinhaoCookieStoreEntry(targetSession, cookie))) {
      return true;
    }
  } catch (setErr) {
    console.warn(`[${label}] ⚠️ 精确过期 cookie 失败: ${cookie.name} @ ${cookie.domain}: ${setErr.message}`);
  }

  try {
    const remaining = await targetSession.cookies.get({ name: cookie.name });
    const stillThere = remaining.filter(candidate => isSameShipinhaoCookieStoreEntry(candidate, cookie, false));
    console.warn(`[${label}] ⚠️ cookie 删除后仍存在: ${cookie.name} @ ${cookie.domain}${cookie.path || '/'}，剩余 ${stillThere.length} 条`);
  } catch (_) {
    // ignore diagnostic failure
  }

  return false;
}

async function replaceShipinhaoCookieGroupWithKeeper(targetSession, group, keeper, label) {
  const nonKeeperCookies = group.filter(cookie => !isSameShipinhaoCookieStoreEntry(cookie, keeper));
  let touched = false;

  for (const cookie of group) {
    const deleted = await expireExactShipinhaoCookie(targetSession, cookie, label);
    touched = touched || deleted;
  }

  try {
    await targetSession.cookies.set(buildShipinhaoCookieSetDetails(keeper));
    touched = true;
  } catch (keepErr) {
    console.warn(`[${label}] ⚠️ 重新写入保留 cookie 失败: ${keeper.name} @ ${keeper.domain}: ${keepErr.message}`);
  }

  const remaining = await getShipinhaoCookieGroup(targetSession, keeper.name, keeper.path || '/');
  const removed = nonKeeperCookies.filter(oldCookie => !remaining.some(candidate => isSameShipinhaoCookieStoreEntry(candidate, oldCookie))).length;
  const keeperStillExists = remaining.some(candidate => isSameShipinhaoCookieStoreEntry(candidate, keeper));

  if (!keeperStillExists) {
    console.warn(`[${label}] ⚠️ 保留 cookie 复写后仍不存在: ${formatShipinhaoCookieForLog(keeper)}`);
  }

  if (remaining.length > 1) {
    console.warn(`[${label}] ⚠️ 同名 cookie 清理后仍重复: ${keeper.name}${keeper.path || '/'} -> ${remaining.length} 条: ${remaining.map(formatShipinhaoCookieForLog).join(', ')}`);
  }

  return { removed, touched, remaining };
}

async function clearShipinhaoIdentityCookiesFromSession(targetSession, label) {
  if (!targetSession || !targetSession.cookies) return 0;

  let deletedCount = 0;
  try {
    const allCookies = await targetSession.cookies.get({});
    const identityCookies = allCookies.filter(cookie => SHIPINHAO_DEDUP_COOKIE_NAMES.has(cookie.name)
      && isShipinhaoCookieDomain(cookie.domain));

    for (const cookie of identityCookies) {
      const deleted = await expireExactShipinhaoCookie(targetSession, cookie, label);
      if (deleted) {
        deletedCount++;
        console.log(`[${label}] 登录页清理旧身份 cookie: ${cookie.name} @ ${cookie.domain}`);
      }
    }

    if (deletedCount > 0 && typeof targetSession.flushStorageData === 'function') {
      await targetSession.flushStorageData();
    }
  } catch (err) {
    console.warn(`[${label}] 登录页身份 cookie 清理异常: ${err.message}`);
  }

  return deletedCount;
}

function findRememberedShipinhaoKeeper(targetSession, group) {
  const preferredByGroup = shipinhaoPreferredCookieBySession.get(targetSession);
  if (!preferredByGroup || !group || group.length === 0) {
    return null;
  }

  const remembered = preferredByGroup.get(buildShipinhaoCookieGroupKey(group[0]));
  if (!remembered) {
    return null;
  }

  return group.find(cookie => cookie.name === remembered.name
    && String(cookie.domain || '').toLowerCase() === String(remembered.domain || '').toLowerCase()
    && (cookie.path || '/') === (remembered.path || '/')
    && String(cookie.value || '') === String(remembered.value || '')) || null;
}

// 执行一次视频号同名 cookie 去重。
//   - 传 keepCookie（监听器场景）：仅处理该 name+path 一组，保留刚写入的那一条，删 domain 不同的其余；
//   - 不传 keepCookie（初始扫描场景）：遍历全部关注 name，按 name+path 分组；
//     每组保留 host-only 优先，否则保留过期最晚的，删其余。
async function dedupShipinhaoCookiesOnce(targetSession, label, keepCookie = null) {
  if (!targetSession || !targetSession.cookies) return 0;
  if (shipinhaoDedupInProgress.has(targetSession)) {
    scheduleShipinhaoCookieDedup(targetSession, label, 800);
    return 0;
  }
  shipinhaoDedupInProgress.add(targetSession);
  let removed = 0;
  let touched = false;
  try {
    const names = keepCookie ? [keepCookie.name] : Array.from(SHIPINHAO_DEDUP_COOKIE_NAMES);
    for (const name of names) {
      const all = await targetSession.cookies.get({ name });
      const cookies = all.filter(c => isShipinhaoCookieDomain(c.domain));
      if (cookies.length <= 1) continue;

      // 按 path 分组（监听器场景只关心 keepCookie.path 这一组）
      const byPath = new Map();
      for (const c of cookies) {
        if (keepCookie && (c.path || '/') !== (keepCookie.path || '/')) continue;
        const key = c.path || '/';
        if (!byPath.has(key)) byPath.set(key, []);
        byPath.get(key).push(c);
      }

      for (const group of byPath.values()) {
        if (group.length <= 1) continue;
        let keeper;
        if (keepCookie) {
          keeper = group.find(c => c.domain === keepCookie.domain
            && (c.path || '/') === (keepCookie.path || '/')
            && String(c.value || '') === String(keepCookie.value || ''))
            || group.find(c => c.domain === keepCookie.domain
              && (c.path || '/') === (keepCookie.path || '/'))
            || group[0];
        } else {
          const rememberedKeeper = findRememberedShipinhaoKeeper(targetSession, group);
          const bestEntry = group.reduce((best, cookie, index) => {
            const entry = { cookie, index };
            return !best || shouldPreferShipinhaoCookie(best, entry) ? entry : best;
          }, null);
          keeper = rememberedKeeper || bestEntry?.cookie || group[group.length - 1];
        }

        const cleanup = await replaceShipinhaoCookieGroupWithKeeper(targetSession, group, keeper, label);
        touched = touched || cleanup.touched;

        for (const old of group) {
          if (isSameShipinhaoCookieStoreEntry(old, keeper)) continue;
          const stillThere = cleanup.remaining.some(candidate => isSameShipinhaoCookieStoreEntry(candidate, old));
          if (!stillThere) {
            console.log(`[${label}] 🧹 去重同名 cookie: ${formatShipinhaoCookieForLog(old)} (保留 ${formatShipinhaoCookieForLog(keeper)})`);
          }
        }
        removed += cleanup.removed;
      }
    }
    if ((removed > 0 || touched) && typeof targetSession.flushStorageData === 'function') {
      await targetSession.flushStorageData();
    }
  } catch (err) {
    console.warn(`[${label}] ⚠️ cookie 去重处理异常: ${err.message}`);
  } finally {
    shipinhaoDedupInProgress.delete(targetSession);
  }
  return removed;
}

function scheduleShipinhaoCookieDedup(targetSession, label, delayMs = 800) {
  if (!targetSession || !targetSession.cookies) return;

  const existingTimer = shipinhaoDedupRetryTimers.get(targetSession);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const retryTimer = setTimeout(() => {
    shipinhaoDedupRetryTimers.delete(targetSession);
    dedupShipinhaoCookiesOnce(targetSession, `${label}:延迟复扫`).then(count => {
      if (count > 0) {
        console.log(`[${label}] ✅ 延迟复扫去重完成，共清理 ${count} 个重复 cookie`);
      }
    }).catch(err => {
      console.warn(`[${label}] ⚠️ 延迟复扫去重异常: ${err.message}`);
    });
  }, delayMs);

  shipinhaoDedupRetryTimers.set(targetSession, retryTimer);
}

function installShipinhaoCookieDedup(targetSession, label) {
  if (!targetSession || !targetSession.cookies) return;
  if (shipinhaoDedupInstalledSessions.has(targetSession)) return;
  shipinhaoDedupInstalledSessions.add(targetSession);

  targetSession.cookies.on('changed', async (_event, cookie, cause, removed) => {
    // 只处理新增/覆盖事件，跳过 expired/evicted/我们自己删除产生的事件
    if (removed) return;
    if (cause !== 'explicit' && cause !== 'overwrite') return;
    if (!SHIPINHAO_DEDUP_COOKIE_NAMES.has(cookie.name)) return;
    if (!isShipinhaoCookieDomain(cookie.domain)) return;
    rememberShipinhaoPreferredCookie(targetSession, cookie);
    await dedupShipinhaoCookiesOnce(targetSession, label, cookie);
    scheduleShipinhaoCookieDedup(targetSession, label, 1200);
  });

  console.log(`[${label}] ✅ 视频号 cookie 去重监听器已安装`);

  // 启动时立即扫描一次历史遗留的重复 cookie（例如打开窗口时尚未登录就已有 2 条重复）
  dedupShipinhaoCookiesOnce(targetSession, label).then(count => {
    if (count > 0) {
      console.log(`[${label}] ✅ 初始扫描去重完成，共清理 ${count} 个历史重复 cookie`);
    }
  });
  scheduleShipinhaoCookieDedup(targetSession, label, 1800);
}

function installShipinhaoWindowAutoSave(targetWindow, windowId, targetSession, label) {
  if (!targetWindow || !targetSession || !targetSession.cookies) return;
  if (shipinhaoAutoSaveInstalledWindows.has(targetWindow)) return;
  shipinhaoAutoSaveInstalledWindows.add(targetWindow);

  let saveTimer = null;
  let saveInFlight = false;
  let lastSavedAt = 0;

  const clearTimer = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  };

  const scheduleSave = (cookie, cause) => {
    if (saveInFlight) {
      return;
    }

    const now = Date.now();
    const waitMs = Math.max(3500, 12000 - (now - lastSavedAt), 0);
    clearTimer();
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      if (saveInFlight || targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
        return;
      }

      const accountInfo = windowAccountMap.get(windowId);
      const publishDataForSave = getWindowPublishData(windowId);
      const targetPlatform = accountInfo?.platform || publishDataForSave?.platform || null;
      if (targetPlatform !== 'shipinhao') {
        return;
      }

      saveInFlight = true;
      lastSavedAt = Date.now();
      try {
        console.log(`[${label}] 检测到视频号身份 cookie 变化，自动保存登录态: ${cookie.name} @ ${cookie.domain}, cause=${cause}`);
        const result = await saveWindowSessionToBackend(targetWindow, windowId);
        console.log(`[${label}] 视频号 cookie 变化自动保存结果:`, result);

        if (result?.success && browserView && !browserView.webContents.isDestroyed()) {
          browserView.webContents.send('session-updated', {
            windowId,
            platform: result.accountInfo?.platform || targetPlatform,
            accountId: result.accountInfo?.accountId || accountInfo?.accountId || String(getPublishBackendAccountId(publishDataForSave) || ''),
            success: true,
            cookieCount: result.cookieCount,
            publishData: result.publishData || publishDataForSave,
            timestamp: Date.now()
          });
        }
      } catch (err) {
        console.warn(`[${label}] 视频号 cookie 变化自动保存失败:`, err.message);
      } finally {
        saveInFlight = false;
      }
    }, waitMs);
  };

  const onCookieChanged = (_event, cookie, cause, removed) => {
    if (removed) return;
    if (!SHIPINHAO_DEDUP_COOKIE_NAMES.has(cookie.name)) return;
    if (!isShipinhaoCookieDomain(cookie.domain)) return;
    scheduleSave(cookie, cause);
  };

  targetSession.cookies.on('changed', onCookieChanged);
  targetWindow.once('closed', () => {
    clearTimer();
    try {
      targetSession.cookies.removeListener('changed', onCookieChanged);
    } catch (_) {
      // ignore cleanup failure
    }
  });

  console.log(`[${label}] 视频号关键 cookie 自动保存监听器已安装`);
}

// 删除账号的 Session 数据
async function deleteAccountSession(platform, accountId) {
  const partitionName = `persist:${platform}_${accountId}`;

  // 从缓存中移除
  if (accountSessions.has(partitionName)) {
    const accountSession = accountSessions.get(partitionName);
    try {
      // 清除 session 数据
      await accountSession.clearStorageData();
      console.log(`[Account Session] 已清除 session 数据: ${partitionName}`);
    } catch (err) {
      console.error(`[Account Session] 清除 session 数据失败: ${partitionName}`, err);
    }
    accountSessions.delete(partitionName);
  }

  // 尝试删除磁盘上的 session 目录
  const sessionPath = path.join(app.getPath('userData'), 'Partitions', partitionName.replace('persist:', ''));
  if (fs.existsSync(sessionPath)) {
    try {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log(`[Account Session] 已删除 session 目录: ${sessionPath}`);
    } catch (err) {
      console.error(`[Account Session] 删除 session 目录失败: ${sessionPath}`, err);
    }
  }
}

// 初始化 platformAccounts 数据结构
function ensurePlatformAccounts() {
  if (!globalStorage.platformAccounts) {
    globalStorage.platformAccounts = {
      douyin: [],
      xiaohongshu: [],
      baijiahao: [],
      weixin: [],
      shipinhao: []
    };
    saveGlobalStorage();
  }
  return globalStorage.platformAccounts;
}

// 获取指定平台的所有账号
ipcMain.handle('get-accounts', async (event, platform) => {
  console.log('[Account Manager] 获取账号列表:', platform);

  const platformAccounts = ensurePlatformAccounts();
  const accounts = platformAccounts[platform] || [];

  console.log(`[Account Manager] ${platform} 共有 ${accounts.length} 个账号`);
  return { success: true, accounts };
});

// 获取所有平台的所有账号
ipcMain.handle('get-all-accounts', async () => {
  console.log('[Account Manager] 获取所有平台账号');

  const platformAccounts = ensurePlatformAccounts();
  return { success: true, platformAccounts };
});

// 添加账号
ipcMain.handle('add-account', async (event, platform, accountInfo) => {
  console.log('[Account Manager] 添加账号:', platform, accountInfo);

  const platformAccounts = ensurePlatformAccounts();

  if (!platformAccounts[platform]) {
    platformAccounts[platform] = [];
  }

  // 检查是否已存在（通过 platformUid 去重）
  if (accountInfo.platformUid) {
    const existing = platformAccounts[platform].find(a => a.platformUid === accountInfo.platformUid);
    if (existing) {
      console.log('[Account Manager] 账号已存在，更新信息:', existing.id);
      // 更新现有账号信息
      existing.nickname = accountInfo.nickname || existing.nickname;
      existing.avatar = accountInfo.avatar || existing.avatar;
      existing.lastUsedAt = Date.now();
      saveGlobalStorage();
      return { success: true, accountId: existing.id, isNew: false };
    }
  }

  // 创建新账号
  const accountId = accountInfo.id || generateAccountId(platform);
  const newAccount = {
    id: accountId,
    nickname: accountInfo.nickname || '未命名账号',
    avatar: accountInfo.avatar || '',
    platformUid: accountInfo.platformUid || '',
    createdAt: Date.now(),
    lastUsedAt: Date.now()
  };

  platformAccounts[platform].push(newAccount);
  saveGlobalStorage();

  console.log('[Account Manager] ✅ 账号添加成功:', accountId);
  return { success: true, accountId, isNew: true };
});

// 删除账号
ipcMain.handle('remove-account', async (event, platform, accountId) => {
  console.log('[Account Manager] 删除账号:', platform, accountId);

  const platformAccounts = ensurePlatformAccounts();

  if (!platformAccounts[platform]) {
    return { success: false, error: '平台不存在' };
  }

  const index = platformAccounts[platform].findIndex(a => a.id === accountId);
  if (index === -1) {
    return { success: false, error: '账号不存在' };
  }

  // 从列表中移除
  platformAccounts[platform].splice(index, 1);
  saveGlobalStorage();

  // 删除对应的 session 数据
  await deleteAccountSession(platform, accountId);

  console.log('[Account Manager] ✅ 账号删除成功:', accountId);
  return { success: true };
});

// 更新账号信息
ipcMain.handle('update-account', async (event, platform, accountId, updates) => {
  console.log('[Account Manager] 更新账号:', platform, accountId, updates);

  const platformAccounts = ensurePlatformAccounts();

  if (!platformAccounts[platform]) {
    return { success: false, error: '平台不存在' };
  }

  const account = platformAccounts[platform].find(a => a.id === accountId);
  if (!account) {
    return { success: false, error: '账号不存在' };
  }

  // 更新允许的字段
  if (updates.nickname !== undefined) account.nickname = updates.nickname;
  if (updates.avatar !== undefined) account.avatar = updates.avatar;
  if (updates.platformUid !== undefined) account.platformUid = updates.platformUid;
  account.lastUsedAt = Date.now();

  saveGlobalStorage();

  console.log('[Account Manager] ✅ 账号更新成功:', accountId);
  return { success: true, account };
});

// 检查账号是否已存在（通过平台用户 ID 判断）
ipcMain.handle('account-exists', async (event, platform, platformUid) => {
  console.log('[Account Manager] 检查账号是否存在:', platform, platformUid);

  const platformAccounts = ensurePlatformAccounts();

  if (!platformAccounts[platform]) {
    return { exists: false };
  }

  const account = platformAccounts[platform].find(a => a.platformUid === platformUid);
  if (account) {
    console.log('[Account Manager] 账号已存在:', account.id);
    return { exists: true, accountId: account.id, account };
  }

  return { exists: false };
});

// 获取账号信息
ipcMain.handle('get-account', async (event, platform, accountId) => {
  console.log('[Account Manager] 获取账号信息:', platform, accountId);

  const platformAccounts = ensurePlatformAccounts();

  if (!platformAccounts[platform]) {
    return { success: false, error: '平台不存在' };
  }

  const account = platformAccounts[platform].find(a => a.id === accountId);
  if (!account) {
    return { success: false, error: '账号不存在' };
  }

  return { success: true, account };
});

// 窗口账号信息存储（用于窗口获取自己对应的账号）
const windowAccountMap = new Map();

// 获取当前窗口的账号信息
ipcMain.handle('get-current-account', async (event) => {
  try {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      return { success: false, error: '无法获取发送者窗口' };
    }

    const windowId = senderWindow.id;
    const accountInfo = windowAccountMap.get(windowId);

    if (!accountInfo) {
      return { success: false, error: '该窗口没有关联账号' };
    }

    // 获取完整账号信息
    const platformAccounts = ensurePlatformAccounts();
    const account = platformAccounts[accountInfo.platform]?.find(a => a.id === accountInfo.accountId);

    return {
      success: true,
      platform: accountInfo.platform,
      accountId: accountInfo.accountId,
      account: account || null
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 迁移临时 Session 到新账号
ipcMain.handle('migrate-to-new-account', async (event, platform, accountInfo) => {
  console.log('[Account Manager] 迁移到新账号:', platform, accountInfo);

  try {
    // 获取调用者的 session（临时 session）
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      return { success: false, error: '无法获取发送者窗口' };
    }

    const tempSession = senderWindow.webContents.session;

    // 检查账号是否已存在
    const platformAccounts = ensurePlatformAccounts();
    let accountId;
    let isNew = true;

    if (accountInfo.platformUid) {
      const existing = platformAccounts[platform]?.find(a => a.platformUid === accountInfo.platformUid);
      if (existing) {
        accountId = existing.id;
        isNew = false;
        // 更新现有账号信息
        existing.nickname = accountInfo.nickname || existing.nickname;
        existing.avatar = accountInfo.avatar || existing.avatar;
        existing.lastUsedAt = Date.now();
        console.log('[Account Manager] 账号已存在，更新并迁移到:', accountId);
      }
    }

    if (!accountId) {
      // 创建新账号
      accountId = generateAccountId(platform);
      const newAccount = {
        id: accountId,
        nickname: accountInfo.nickname || '未命名账号',
        avatar: accountInfo.avatar || '',
        platformUid: accountInfo.platformUid || '',
        createdAt: Date.now(),
        lastUsedAt: Date.now()
      };

      if (!platformAccounts[platform]) {
        platformAccounts[platform] = [];
      }
      platformAccounts[platform].push(newAccount);
      console.log('[Account Manager] 创建新账号:', accountId);
    }

    saveGlobalStorage();

    // 获取目标账号的 session
    const targetSession = getAccountSession(platform, accountId);

    // 获取临时 session 中的所有 cookies
    const tempCookies = await tempSession.cookies.get({});
    console.log(`[Account Manager] 临时 session 共有 ${tempCookies.length} 个 cookies`);

    // 确定要迁移的域名
    const platformDomains = {
      douyin: ['douyin.com'],
      xiaohongshu: ['xiaohongshu.com'],
      baijiahao: ['baidu.com'],
      weixin: ['weixin.qq.com', 'mp.weixin.qq.com'],
      shipinhao: ['channels.weixin.qq.com', 'weixin.qq.com', 'mp.weixin.qq.com', 'wx.qq.com', 'qq.com']
    };

    const domains = platformDomains[platform] || [];

    // 过滤并迁移 cookies
    const oneYearFromNow = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);
    let migratedCount = 0;
    const filteredTempCookies = dedupeCookiesForSessionSave(
      platform,
      tempCookies.filter(cookie => {
        const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
        return domains.some(d => cookieDomain.includes(d) || d.includes(cookieDomain));
      }),
      'migrate-to-new-account'
    );

    for (const cookie of filteredTempCookies) {
      try {
        const newCookie = buildCookieSetDetails(cookie, cookie.expirationDate || oneYearFromNow);
        await targetSession.cookies.set(newCookie);
        migratedCount++;
      } catch (err) {
        console.error(`[Account Manager] 迁移 cookie 失败: ${cookie.name}`, err.message);
      }
    }

    // 刷新到磁盘
    await targetSession.flushStorageData();

    console.log(`[Account Manager] ✅ 迁移完成: ${migratedCount} 个 cookies`);
    return { success: true, accountId, isNew, migratedCount };
  } catch (err) {
    console.error('[Account Manager] 迁移失败:', err);
    return { success: false, error: err.message };
  }
});

// 检查账号登录状态
ipcMain.handle('check-account-login-status', async (event, platform, accountId) => {
  console.log('[Account Manager] 检查账号登录状态:', platform, accountId);

  try {
    const accountSession = getAccountSession(platform, accountId);
    const cookies = await accountSession.cookies.get({});

    // 平台登录凭证 cookie 名称
    const loginCookies = {
      douyin: ['sessionid', 'sessionid_ss', 'passport_csrf_token', 'sid_guard', 'uid_tt', 'uid_tt_ss'],
      xiaohongshu: ['web_session', 'websectiga', 'sec_poison_id', 'a1', 'webId'],
      baijiahao: ['BDUSS', 'STOKEN', 'BAIDUID'],
      weixin: ['wxuin', 'pass_ticket', 'slave_user', 'slave_sid'],
      shipinhao: ['sessionid', 'wxuin', 'pass_ticket', 'wxsid', 'wxload']
    };

    const requiredCookies = loginCookies[platform] || [];
    const hasLoginCookie = cookies.some(c => requiredCookies.includes(c.name));

    console.log(`[Account Manager] ${platform}/${accountId} 登录状态: ${hasLoginCookie}`);
    return { success: true, isLoggedIn: hasLoginCookie, cookieCount: cookies.length };
  } catch (err) {
    console.error('[Account Manager] 检查登录状态失败:', err);
    return { success: false, error: err.message };
  }
});

// ========== 获取完整会话数据（Cookies + Storage + IndexedDB） ==========
// 用于授权后将完整登录状态存储到后台
ipcMain.handle('get-full-session-data', async (event, domain) => {
  if (!domain) {
    return { success: false, error: '域名不能为空' };
  }

  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  let webContents;

  if (senderWindow) {
    webContents = senderWindow.webContents;
    console.log('[Session Data] 使用子窗口 session');
  } else if (browserView && !browserView.webContents.isDestroyed()) {
    webContents = browserView.webContents;
    console.log('[Session Data] 使用 BrowserView session');
  } else {
    return { success: false, error: 'session 不可用' };
  }

  return await getFullSessionDataFromWebContents(webContents, domain);
});

// ========== 恢复完整会话数据（Cookies + Storage + IndexedDB） ==========
// 用于发布时从后台获取的会话数据恢复到当前窗口
ipcMain.handle('restore-session-data', async (event, sessionDataStr) => {
  console.log('[Session Restore] ========== 开始恢复会话数据 ==========');

  if (!sessionDataStr) {
    return { success: false, error: '会话数据为空' };
  }

  try {
    // 解析会话数据
    let sessionData;
    try {
      sessionData = typeof sessionDataStr === 'string' ? JSON.parse(sessionDataStr) : sessionDataStr;
    } catch (parseErr) {
      return { success: false, error: '会话数据解析失败: ' + parseErr.message };
    }

    console.log('[Session Restore] 域名:', sessionData.domain);
    console.log('[Session Restore] 时间戳:', new Date(sessionData.timestamp).toLocaleString());

    // 获取调用者的 session 和 webContents
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    let ses;
    let webContents;

    if (senderWindow) {
      ses = senderWindow.webContents.session;
      webContents = senderWindow.webContents;
      console.log('[Session Restore] 使用子窗口 session');
    } else if (browserView && !browserView.webContents.isDestroyed()) {
      ses = browserView.webContents.session;
      webContents = browserView.webContents;
      console.log('[Session Restore] 使用 BrowserView session');
    } else {
      return { success: false, error: 'session 不可用' };
    }

    const results = {
      cookies: { restored: 0, failed: 0 },
      localStorage: { restored: 0, failed: 0 },
      sessionStorage: { restored: 0, failed: 0 },
      indexedDB: { restored: 0, failed: 0 }
    };

    // 1. 恢复 Cookies
    if (sessionData.cookies && Array.isArray(sessionData.cookies)) {
      sessionData.cookies = dedupeCookiesForSessionSave(null, sessionData.cookies, 'restore-session-data');
      console.log(`[Session Restore] 开始恢复 ${sessionData.cookies.length} 个 Cookies...`);

      for (const cookie of sessionData.cookies) {
        try {
          const cookieDetails = buildCookieSetDetails(
            cookie,
            cookie.expirationDate || Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
          );
          await ses.cookies.set(cookieDetails);
          results.cookies.restored++;
        } catch (cookieErr) {
          console.error(`[Session Restore] Cookie 恢复失败 (${cookie.name}):`, cookieErr.message);
          results.cookies.failed++;
        }
      }
      console.log(`[Session Restore] Cookies 恢复完成: ${results.cookies.restored} 成功, ${results.cookies.failed} 失败`);
    }

    // 2. 恢复 localStorage
    if (sessionData.localStorage && Object.keys(sessionData.localStorage).length > 0) {
      console.log(`[Session Restore] 开始恢复 ${Object.keys(sessionData.localStorage).length} 个 localStorage 项...`);

      try {
        const localStorageData = sessionData.localStorage;
        await webContents.executeJavaScript(`
          (function() {
            const data = ${JSON.stringify(localStorageData)};
            let restored = 0;
            let failed = 0;
            for (const [key, value] of Object.entries(data)) {
              try {
                localStorage.setItem(key, value);
                restored++;
              } catch (e) {
                console.error('localStorage 恢复失败:', key, e);
                failed++;
              }
            }
            return { restored, failed };
          })()
        `).then(result => {
          results.localStorage = result;
          console.log(`[Session Restore] localStorage 恢复完成: ${result.restored} 成功, ${result.failed} 失败`);
        });
      } catch (storageErr) {
        console.error('[Session Restore] localStorage 恢复失败:', storageErr.message);
      }
    }

    // 3. 恢复 sessionStorage
    if (sessionData.sessionStorage && Object.keys(sessionData.sessionStorage).length > 0) {
      console.log(`[Session Restore] 开始恢复 ${Object.keys(sessionData.sessionStorage).length} 个 sessionStorage 项...`);

      try {
        const sessionStorageData = sessionData.sessionStorage;
        await webContents.executeJavaScript(`
          (function() {
            const data = ${JSON.stringify(sessionStorageData)};
            let restored = 0;
            let failed = 0;
            for (const [key, value] of Object.entries(data)) {
              try {
                sessionStorage.setItem(key, value);
                restored++;
              } catch (e) {
                console.error('sessionStorage 恢复失败:', key, e);
                failed++;
              }
            }
            return { restored, failed };
          })()
        `).then(result => {
          results.sessionStorage = result;
          console.log(`[Session Restore] sessionStorage 恢复完成: ${result.restored} 成功, ${result.failed} 失败`);
        });
      } catch (storageErr) {
        console.error('[Session Restore] sessionStorage 恢复失败:', storageErr.message);
      }
    }

    // 4. 恢复 IndexedDB（复杂，可能需要页面刷新才能生效）
    if (sessionData.indexedDB && Object.keys(sessionData.indexedDB).length > 0) {
      console.log(`[Session Restore] 开始恢复 ${Object.keys(sessionData.indexedDB).length} 个 IndexedDB 数据库...`);

      try {
        const indexedDBData = sessionData.indexedDB;
        await webContents.executeJavaScript(`
          (async function() {
            const data = ${JSON.stringify(indexedDBData)};
            let restored = 0;
            let failed = 0;

            for (const [dbName, dbData] of Object.entries(data)) {
              try {
                // 打开数据库（使用保存的版本号）
                const db = await new Promise((resolve, reject) => {
                  const request = indexedDB.open(dbName, dbData.version || 1);

                  request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    // 创建 object stores
                    for (const storeName of Object.keys(dbData.stores || {})) {
                      if (!db.objectStoreNames.contains(storeName)) {
                        try {
                          db.createObjectStore(storeName, { autoIncrement: true });
                        } catch (e) {
                          console.warn('创建 object store 失败:', storeName, e);
                        }
                      }
                    }
                  };

                  request.onsuccess = () => resolve(request.result);
                  request.onerror = () => reject(request.error);
                });

                // 恢复数据到各个 object store
                for (const [storeName, storeData] of Object.entries(dbData.stores || {})) {
                  if (storeName.endsWith('_truncated')) continue;
                  if (!db.objectStoreNames.contains(storeName)) continue;

                  try {
                    const tx = db.transaction(storeName, 'readwrite');
                    const store = tx.objectStore(storeName);

                    // 清空现有数据
                    await new Promise((resolve, reject) => {
                      const clearReq = store.clear();
                      clearReq.onsuccess = resolve;
                      clearReq.onerror = reject;
                    });

                    // 写入保存的数据
                    for (const item of storeData) {
                      await new Promise((resolve, reject) => {
                        const addReq = store.add(item);
                        addReq.onsuccess = resolve;
                        addReq.onerror = () => resolve(); // 忽略单条失败
                      });
                    }

                    restored++;
                  } catch (storeErr) {
                    console.error('恢复 object store 失败:', storeName, storeErr);
                    failed++;
                  }
                }

                db.close();
              } catch (dbErr) {
                console.error('恢复数据库失败:', dbName, dbErr);
                failed++;
              }
            }

            return { restored, failed };
          })()
        `).then(result => {
          results.indexedDB = result;
          console.log(`[Session Restore] IndexedDB 恢复完成: ${result.restored} 成功, ${result.failed} 失败`);
        });
      } catch (idbErr) {
        console.error('[Session Restore] IndexedDB 恢复失败:', idbErr.message);
      }
    }

    console.log('[Session Restore] ========== 恢复完成 ==========');
    console.log('[Session Restore] 恢复统计:', results);

    return { success: true, results: results };
  } catch (err) {
    console.error('[Session Restore] 恢复失败:', err);
    return { success: false, error: err.message };
  }
});

// ========== 恢复账号会话数据（打开窗口之前调用） ==========
// 用于从后台获取的会话数据恢复到指定账号的 session
ipcMain.handle('restore-account-session', async (event, platform, accountId, sessionDataStr) => {
  console.log('[Account Session Restore] ========== 开始恢复账号会话数据 ==========');
  console.log('[Account Session Restore] 平台:', platform);
  console.log('[Account Session Restore] 账号ID:', accountId);

  if (!sessionDataStr) {
    return { success: false, error: '会话数据为空' };
  }

  try {
    // 解析会话数据
    let sessionData;
    try {
      sessionData = typeof sessionDataStr === 'string' ? JSON.parse(sessionDataStr) : sessionDataStr;
    } catch (parseErr) {
      return { success: false, error: '会话数据解析失败: ' + parseErr.message };
    }

    console.log('[Account Session Restore] 域名:', sessionData.domain);
    console.log('[Account Session Restore] 时间戳:', new Date(sessionData.timestamp).toLocaleString());

    // 获取账号对应的 session（与 getAccountSession/openNewWindow 保持同一分区）
    const sessionPartition = `persist:${platform}_${accountId}`;
    const targetSession = getAccountSession(platform, accountId);
    console.log('[Account Session Restore] 目标 Session 分区:', sessionPartition);

    const results = {
      cookies: { restored: 0, failed: 0 },
      // localStorage 和 sessionStorage 需要在窗口打开后通过页面脚本恢复
      // 因为无法在窗口打开前注入 JavaScript 到特定域名的上下文
      localStorage: { restored: 0, failed: 0, skipped: true },
      sessionStorage: { restored: 0, failed: 0, skipped: true },
      indexedDB: { restored: 0, failed: 0, skipped: true }
    };

    // 1. 恢复 Cookies（可以在窗口打开前恢复）
    if (sessionData.cookies && Array.isArray(sessionData.cookies)) {
      sessionData.cookies = dedupeCookiesForSessionSave(platform, sessionData.cookies, 'restore-account-session');
      console.log(`[Account Session Restore] 开始恢复 ${sessionData.cookies.length} 个 Cookies...`);

      for (const cookie of sessionData.cookies) {
        try {
          const cookieDetails = buildCookieSetDetails(
            cookie,
            cookie.expirationDate || Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
          );
          await targetSession.cookies.set(cookieDetails);
          results.cookies.restored++;
        } catch (cookieErr) {
          console.error(`[Account Session Restore] Cookie 恢复失败 (${cookie.name}):`, cookieErr.message);
          results.cookies.failed++;
        }
      }
      console.log(`[Account Session Restore] Cookies 恢复完成: ${results.cookies.restored} 成功, ${results.cookies.failed} 失败`);
    }

    console.log('[Account Session Restore] ========== 恢复完成 ==========');
    console.log('[Account Session Restore] 恢复统计:', results);
    console.log('[Account Session Restore] 提示: localStorage/sessionStorage/IndexedDB 需要在窗口打开后通过页面脚本恢复');

    return { success: true, results: results };
  } catch (err) {
    console.error('[Account Session Restore] 恢复失败:', err);
    return { success: false, error: err.message };
  }
});

// ========== 清空账号的所有 Cookies（窗口关闭前调用） ==========
// 用于清空发布窗口对应账号的登录状态
ipcMain.handle('clear-account-cookies', async (event, platform, accountId) => {
  console.log('[Clear Account Cookies] ========== 开始清空账号 Cookies ==========');
  console.log('[Clear Account Cookies] 平台:', platform);
  console.log('[Clear Account Cookies] 账号ID:', accountId);

  try {
    // 获取账号对应的 session（与 getAccountSession/openNewWindow 保持同一分区）
    const sessionPartition = `persist:${platform}_${accountId}`;
    const targetSession = getAccountSession(platform, accountId);
    console.log('[Clear Account Cookies] 目标 Session 分区:', sessionPartition);

    // 获取所有 cookies
    const cookies = await targetSession.cookies.get({});
    console.log(`[Clear Account Cookies] 找到 ${cookies.length} 个 cookies`);

    let deletedCount = 0;
    // 删除所有 cookies
    for (const cookie of cookies) {
      try {
        const protocol = cookie.secure ? 'https' : 'http';
        const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
        const url = `${protocol}://${domain}${cookie.path || '/'}`;
        await targetSession.cookies.remove(url, cookie.name);
        deletedCount++;
      } catch (err) {
        console.error(`[Clear Account Cookies] 删除失败 (${cookie.name}):`, err.message);
      }
    }

    console.log('[Clear Account Cookies] ========== 清空完成 ==========');
    console.log(`[Clear Account Cookies] 成功删除 ${deletedCount} 个 cookies`);

    return { success: true, deletedCount: deletedCount };
  } catch (err) {
    console.error('[Clear Account Cookies] 清空失败:', err);
    return { success: false, error: err.message };
  }
});

// ========== 一键清除所有授权数据（合规：满足用户删除权） ==========
ipcMain.handle('clear-all-auth-data', async () => {
  console.log('[Clear All Auth] ========== 开始清除所有授权数据 ==========');

  let deletedAccounts = 0;
  let deletedCookies = 0;
  let deletedSessions = 0;

  try {
    // 1. 清除所有平台账号及其独立 session
    const platformAccounts = ensurePlatformAccounts();
    const platforms = Object.keys(platformAccounts);

    for (const platform of platforms) {
      const accounts = platformAccounts[platform] || [];
      for (const account of accounts) {
        try {
          await deleteAccountSession(platform, account.id);
          deletedSessions++;
        } catch (err) {
          console.error(`[Clear All Auth] 删除 session 失败 (${account.id}):`, err.message);
        }
        deletedAccounts++;
      }
      platformAccounts[platform] = [];
    }
    saveGlobalStorage();
    console.log(`[Clear All Auth] ✅ 已清除 ${deletedAccounts} 个账号, ${deletedSessions} 个独立 session`);

    // 2. 清除 BrowserView 主 session 的所有 cookies
    if (browserView && !browserView.webContents.isDestroyed()) {
      const mainSession = browserView.webContents.session;
      const allCookies = await mainSession.cookies.get({});
      for (const cookie of allCookies) {
        try {
          const protocol = cookie.secure ? 'https' : 'http';
          const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
          const url = `${protocol}://${domain}${cookie.path || '/'}`;
          await mainSession.cookies.remove(url, cookie.name);
          deletedCookies++;
        } catch (err) {
          // 静默跳过单条失败
        }
      }
      console.log(`[Clear All Auth] ✅ 已清除 BrowserView 主 session ${deletedCookies} 个 cookies`);
    }

    // 3. 清除同意状态（下次需要重新同意）
    if (globalStorage.user_consent_auth_storage) {
      delete globalStorage.user_consent_auth_storage;
      saveGlobalStorage();
    }

    console.log('[Clear All Auth] ========== 清除完成 ==========');
    return { success: true, deletedAccounts, deletedCookies, deletedSessions };
  } catch (err) {
    console.error('[Clear All Auth] 清除失败:', err);
    return { success: false, error: err.message };
  }
});

// ========== 手动保存会话数据到后台（开发调试用） ==========
// 让发布脚本可以在不关闭窗口的情况下保存最新 cookies
ipcMain.handle('save-session-to-backend', async (event) => {
  console.log('[Save Session] ========== 手动保存会话数据 ==========');

  try {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      return { success: false, error: '无法获取发送者窗口' };
    }

    const windowId = senderWindow.id;
    console.log('[Save Session] 窗口ID:', windowId);
    const result = await persistWindowSessionToBackend(senderWindow, windowId, 'manual-save');

    if (result.success && browserView && !browserView.webContents.isDestroyed()) {
      browserView.webContents.send('session-updated', {
        windowId,
        platform: result.accountInfo?.platform,
        accountId: result.accountInfo?.accountId,
        success: result.success,
        cookieCount: result.cookieCount,
        publishData: result.publishData,
        timestamp: Date.now()
      });
      console.log('[Save Session] 已通知首页会话数据已更新（手动保存）');
    }

    return result;
  } catch (err) {
    console.error('[Save Session] 保存失败:', err);
    return { success: false, error: err.message };
  }
});
