# 登录后首页转圈问题修复方案 (1.2.7)

## 问题现象

用户反馈：登录成功后，首页一直显示"正在加载页面..."的转圈动画，无法进入。

## 根因分析

通过代码分析，有 3 个可能的触发点：

### 1. CSS/JSON 源码文本误判（最可能）

**位置**: `main.js` 6100-6114 行

**问题**: `inspectBrowserViewReadiness()` 检测页面是否是"CSS/JSON 源代码文本"的判定条件过于严格：

```javascript
const looksLikeCssSource = (cssTextMatchCount >= 4 || hasBrowserHeaderCss) && childCount <= 2 && visibleSampleElements <= 3;
const looksLikeJsonSource = bodyTextPreview.length > 800 && startsLikeJson && jsonTextMarkerCount >= 3 && childCount <= 2 && visibleSampleElements <= 3;
```

**后果**: 
- 如果误判为源码文本 → 返回 `ready: false`
- 守卫永不结束 → 加载遮罩一直显示
- 用户看到的就是无限转圈

### 2. 首屏守卫超时弹窗被抑制

**位置**: `main.js` 5849-5854, 5877-5879 行

**问题**: 
- `shouldShowPageErrorDialog()` 有 15 秒冷却期
- `isShowingPageErrorDialog` 防重入锁
- 如果用户快速重启/刷新，弹窗会被抑制，遮罩就会一直显示

### 3. 登录页跳转后守卫未正确启动

**位置**: `login.html` 1312-1316 行

```javascript
if (window.browserAPI && window.browserAPI.navigateCurrentWindow) {
  await window.browserAPI.navigateCurrentWindow(targetUrl);
} else {
  window.location.href = targetUrl;
}
```

**问题**: 登录页跳转使用 `navigateCurrentWindow` 或 `window.location.href`，但不确定是否触发了 `beginStartupLoadGuard`。

---

## 修复方案

### 方案 A: 放宽 CSS/JSON 源码判定条件（推荐，代码修改）

**修改位置**: `main.js` 6100-6101 行

**修改前**:
```javascript
const looksLikeCssSource = (cssTextMatchCount >= 4 || hasBrowserHeaderCss) && childCount <= 2 && visibleSampleElements <= 3;
const looksLikeJsonSource = bodyTextPreview.length > 800 && startsLikeJson && jsonTextMarkerCount >= 3 && childCount <= 2 && visibleSampleElements <= 3;
```

**修改后**:
```javascript
// 放宽判定条件，减少误判：提高特征匹配阈值、降低元素数要求、增加文本长度要求
const looksLikeCssSource = cssTextMatchCount >= 6 && childCount <= 1 && visibleSampleElements === 0 && bodyTextPreview.length > 2000;
const looksLikeJsonSource = bodyTextPreview.length > 2000 && startsLikeJson && jsonTextMarkerCount >= 5 && childCount <= 1 && visibleSampleElements === 0;
```

**理由**:
- CSS 特征匹配从 `>= 4` 提高到 `>= 6`（减少误判）
- 子元素数从 `<= 2` 降低到 `<= 1`（真正的源码页基本只有 1 个 `<pre>` 或 `<body>`）
- 可见元素从 `<= 3` 降低到 `=== 0`（正常页面至少有几个可见元素）
- 增加文本长度要求 `> 2000`（短文本不太可能是完整源码）
- JSON 标记匹配从 `>= 3` 提高到 `>= 5`

**风险**: 极低。放宽条件只会让更多正常页面通过检查，不会引入新问题。

---

### 方案 B: 增加守卫强制超时兜底（代码修改 + 特性开关）

**新增特性开关**: `FIX_LOGIN_SPINNER_FORCE_TIMEOUT`

**修改位置**: `main.js` 6240 行后，在 `scheduleStartupReadinessCheck` 函数开始处

**新增逻辑**:
```javascript
function scheduleStartupReadinessCheck(reason, delayMs = STARTUP_LOAD_READY_CHECK_DELAY) {
  if (!startupLoadGuard.active) return;
  clearStartupLoadGuardTimer();

  // 【FIX_LOGIN_SPINNER_FORCE_TIMEOUT】强制超时兜底：
  // 如果守卫持续激活超过 STARTUP_LOAD_MAX_WAIT_MS (20秒) 且没有弹过对话框，
  // 直接结束守卫（避免误判导致永久转圈）
  if (FIX_LOGIN_SPINNER_FORCE_TIMEOUT) {
    const elapsed = Date.now() - startupLoadGuard.startedAt;
    if (elapsed > STARTUP_LOAD_MAX_WAIT_MS && !isShowingPageErrorDialog && Date.now() - lastPageErrorDialogAt > 60000) {
      console.warn('[Startup Guard] ⚠️ 守卫激活超过最大等待时间且未弹窗，强制结束（避免永久转圈）:', elapsed);
      finishStartupLoadGuard('force-timeout-fallback');
      return;
    }
  }

  startupLoadGuard.timer = setTimeout(safeAsyncHandler('Startup Guard readiness timer', async () => {
    // ... 原有逻辑
```

**特性配置**: `injected-scripts/common.js`
```javascript
const FIX_LOGIN_SPINNER_FORCE_TIMEOUT = {
  name: 'FIX_LOGIN_SPINNER_FORCE_TIMEOUT',
  version: '1.2.7',
  enabled: true,
  description: '登录后转圈强制超时兜底：守卫持续 >20s 未弹窗时自动结束'
};
```

**理由**: 即使源码判定逻辑有其他未预见的边界情况，这个兜底也能保证最多 20 秒后自动恢复。

**风险**: 极低。只在异常情况（守卫超时且未弹窗）时触发。

---

### 方案 C: 简化方案 - 仅放宽判定 + 日志增强（最稳妥）

**步骤 1**: 应用方案 A 的代码修改

**步骤 2**: 增强日志输出（`main.js` 6102 行后）

```javascript
if (looksLikeCssSource || looksLikeJsonSource) {
  console.warn('[Startup Guard] ⚠️ 页面被判定为源码文本:', {
    type: looksLikeCssSource ? 'CSS' : 'JSON',
    cssMatchCount: cssTextMatchCount,
    jsonMarkerCount: jsonTextMarkerCount,
    childCount,
    visibleSampleElements,
    textPreview: bodyTextPreview.slice(0, 200),
    href: location.href
  });
  return {
    ready: false,
    reason: looksLikeCssSource ? 'css-source-text' : 'json-source-text',
    // ... 其他字段
  };
}
```

**理由**: 
- 如果修复后仍有问题，日志能帮助快速定位具体是哪种判定触发了
- 不引入新的特性开关，减少复杂度

---

## 推荐方案：方案 A + 日志增强

**操作步骤**:

1. 修改 `main.js` 6100-6101 行（放宽判定）
2. 在 6102 行后增加日志输出（方便后续诊断）
3. 不需要新增特性开关
4. 打包 1.2.7 便携版

**预期效果**:
- 减少 CSS/JSON 源码误判（最主要的触发原因）
- 如果仍有问题，日志能快速定位
- 不引入新的复杂度和潜在风险

---

## 用户侧诊断脚本（保留）

如果修复后仍有问题，用户可以在转圈页面按 F12 运行诊断脚本（已提供）：

**文件**: `D:\浏览器\运营助手\diagnose-loading-spinner.js`

**快速版本**（让用户直接在 Console 粘贴）: 见 `首页转圈问题诊断.md`

---

## 发布清单

- [x] 修改 `main.js` 6100-6101 行（放宽判定条件）
- [x] 修改 `main.js` 6102 行后（增加日志输出）
- [ ] 测试：手动访问 CSS/JSON 源码 URL，确认仍能正确拦截
- [ ] 测试：正常登录流程，确认不会误判
- [ ] 打包 1.2.7 便携版
- [ ] 更新 `browserVersion.json`（版本号 + 下载链接）

---

## 回滚方案

如果 1.2.7 引入新问题，回滚很简单：

1. 恢复 `main.js` 6100-6101 行为原始条件
2. 打包 1.2.6（或让用户使用已有的 1.2.6 包）

因为只改了判定阈值，不涉及逻辑结构变化，回滚无风险。
