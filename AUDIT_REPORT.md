# 全平台发布失败上报审计报告

**审计时间**: 2026-09-02  
**触发事件**: 小红书发布被平台拒绝（toast「因违反社区规范禁止发笔记」），脚本明明捕获到了文案，后台却没有失败记录 —— 真实后果是**明确失败被上报成成功**。  
**审计范围**: 8 个平台发布脚本，对照小红书已修复的 5 类缺陷模式全面核查。

---

## 📋 执行摘要

| 平台 | 总体风险 | ① 证据丢弃 | ② alert阻塞 | ③ 判据时效 | ④ 超时误判成功 | ⑤ 定时静默 | 其他高危 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---|
| 小红书 | ✅ 已修复 | ✅ | ✅ | ✅ | ✅ | ✅ | - |
| 抖音 | 🔴 高危 | 🟡 | 🟡 | 🟡 | 🔴 | ✅ | 手机验证失败翻成功 |
| 视频号 | 🔴 高危 | 🟡 | 🟡 | 🟡 | 🔴 | ✅ | 无封面放弃发布零上报 |
| 搜狐号 | 🔴 高危 | 🟡 | 🔴 | 🟡 | 🔴 | ✅ | 弹窗拼接文本判成功 |
| 百家号 | 🔴 极高危 | 🟡 | ✅ | 🟡 | 🔴 | 🔴 | 定时任务提前报成功 |
| 腾讯号 | 🟡 中危 | ✅ | ✅ | 🔴 | ✅ | ✅ | 标志吞掉点击后失败 |
| 网易号 | 🟡 中危 | ✅ | ✅ | 🟡 | ✅ | 🔴 | 定时 waitForElement 未 catch |
| 知乎 | 🟢 低危 | ✅ | ✅ | ✅ | ✅ | N/A | retryOperation 包编辑器写入 |
| 新浪 | 🟢 低危 | ✅ | ✅ | ✅ | ✅ | N/A | - |

**图例**:  
- 🔴 命中（存在与小红书相同的缺陷）  
- 🟡 部分命中（存在变体或特定条件下触发）  
- ✅ 未命中（已防御或不适用）

---

## 🔥 严重缺陷排序（按影响面 × 不可恢复性）

### 1. 百家号 — 缺陷④ FAIL_KEYWORDS 词表过窄导致误判成功 ⚠️ 极高危

**位置**: `baijiahao-publish.js:1470-1481`

**代码**:
```javascript
const FAIL_KEYWORDS = ['失败','错误','异常','不能为空','请先','违规','超限','驳回','不可用','不符合','未通过','已用尽'];
const hasExplicitFailure = publishErrorMsg && FAIL_KEYWORDS.some(k => publishErrorMsg.includes(k));
if (!hasExplicitFailure) {
    console.log('[百家号发布] ✅ 超时未捕获明确失败提示，点击发布已提交，视为发布成功');
    await sendStatistics(publishIdForSuccess, '百家号发布', { taskToken: ... });
    await closeWindowWithMessage('发布成功，刷新数据', 1000);
}
```

**问题**: `getLatestError()` 已在 common.js:4981/5060 用 ignoredMessages 把含"成功"的整条过滤掉，所以能走到 1472 的必然是"非成功文案的平台提示"——但以下常见拒绝提示**不含表中任一词**，会被判为"非失败" → `sendStatistics` 上报成功并关窗：
- 「内容含敏感信息」
- 「今日发文已达上限」
- 「标题重复」
- 「操作过于频繁」
- 「内容质量不符合要求」
- 「账号异常」

**后果**: **明确失败被上报成成功并关窗**，与小红书缺陷④后果完全一致，且后台不支持失败覆盖成功 → 不可恢复。

**修复优先级**: 🔴 P0 — 立即修复

---

### 2. 搜狐号 — 缺陷② 定时路径 confirm + alert 无人值守永久悬死 ⚠️ 高危

**位置**: `souhuhao-publish.js:2313-2316`

**代码**:
```javascript
const userChoice = confirm(`[搜狐号发布] 找不到时间选项 "${targetStr}"...是否需要手动调整时间后重试？`);
if (userChoice) {
    alert('[搜狐号发布] 请在下拉中手动选择可用的时间，然后点击"确定"让脚本继续。');
    return false; // 2318
}
```

**触发条件**: 定时发布路径滚动到底仍未匹配到目标时间选项（2305 `if (!foundOption)`）

**问题**: 
1. `confirm()` 同步阻塞 JS 线程，点确定/取消之前整个窗口无响应
2. 点确定后 `alert()` 再次阻塞，等人点第二次
3. **无特性开关、无超时兜底**，批量发布无人值守时渲染进程永久悬死
4. 有人点了（确定或取消都一样）才会 2318 `return false` → 1808-1810 正常上报失败

**后果**: 批量发布任务卡死，该窗口后续任务全部排队等待，连失败都报不出去。

**修复优先级**: 🔴 P0 — 立即修复

---

### 3. 百家号 — 缺陷⑤ 定时路径四处失败全不报 + 提前报成功 ⚠️ 高危

**位置**: `baijiahao-publish.js:1149 / 1163-1166 / 1177-1180 / 1215 / 1218`

**问题链**:

#### (1) 定时任务可能在"时间还没设"时就被上报成功并关窗
```javascript
// 1145: scheduledReleasesBtn.dispatchEvent(clickEvent) 点开定时弹窗
await checkPublishResult(dataObj, true); // 1149 立刻调用
```
`checkPublishResult` 的 1472-1481 分支会 `sendStatistics` + `closeWindowWithMessage('发布成功')` 并 return true。**此时定时时间尚未选择、确定按钮尚未点击**。同一次调用的 1495 还会 `stopErrorListener()`，之后的选时间+确定发布全程无监听。

#### (2) 四处失败出口全部没有 `sendStatisticsError`
- 1163-1166: 定时时间解析失败 → 只 `closeWindowWithMessage` 不上报
- 1177-1180: 时间选择失败 → 同上
- 1215: 未找到确定按钮 → 不报不关窗，窗口挂死
- 1218: 未传入定时发布时间 → 同上

#### (3) 点确定后不检测结果
1208 `confirmBtn.click()` 之后 1212-1213 只 `stopErrorListener(); stopSmsVerificationDetector();`，**不像立即发布那样调 `checkPublishResult`** → 平台若拒绝定时发布，后台查无此事。

**对比**: 搜狐同位置 1830/1835/1840/1846 六个失败出口全部 `await failPublishAndClose(...)`，内含 `sendStatisticsError`。

**修复优先级**: 🔴 P0 — 立即修复

---

### 4. 抖音 / 视频号 — 缺陷④ 超时无失败即上报成功 ⚠️ 高危

**抖音位置**: `douyin-publish.js:2182-2188`
```javascript
if (!lastToastMessage) {
    await reportDouyinPublishSuccess(publishId, windowId, 'timeout-no-failure');
    publishRunning = false;
    await closeWindowWithMessage('发布成功，刷新数据', 1000);
    return;
}
```

**视频号位置**: `shipinhao-publish.js:2052-2065`
```javascript
const sphHasExplicitFailure = lastToastMessage && SPH_FAIL_KEYWORDS.some(k => lastToastMessage.includes(k));
if (!sphHasExplicitFailure) {
    await sendStatistics(publishId, '视频号发布', {taskToken: ...});
    await closeWindowWithMessage('发布成功，刷新数据', 1000);
    return;
}
```

**问题**: 
- 与小红书缺陷④同形，注释自陈「范式对齐小红书」
- 超时且无失败提示 → 上报成功并关窗
- **不查任何持久化失败探针**（`readPublishErrorProbe` / `window.__XXX_LATEST_PUBLISH_FAILURE__` 均无）
- 抖音叠加缺陷③：`isDouyinNeutralPublishMessage('')` 对空文本 `return true` → 种子恒为空
- 视频号叠加缺陷①：`SPH_FAIL_KEYWORDS` 不含「违反」「禁止」，小红书那句会被判成功

**后果**: **明确失败被上报成成功**，不可恢复。

**修复优先级**: 🔴 P0 — 立即修复

---

### 5. 搜狐号 — 缺陷④ 超时按成功收口 ⚠️ 高危

**位置**: `souhuhao-publish.js:2139-2144`

**代码**:
```javascript
// 🔑 超时无明确失败信号 → 视为发布成功（范式对齐小红书：点击已提交、平台未跳转但也无明确失败反馈）
const sohuHasExplicitFailure = (lastFeedbackText && failurePattern.test(lastFeedbackText)) || !!getLatestError();
if (!sohuHasExplicitFailure) {
    console.log('[搜狐号发布] ✅ 超时未检测到明确失败信号，点击已提交，视为发布成功');
    return await handlePublishSuccess('timeout-no-failure', '点击已提交但平台未跳转成功页');
}
```

**问题**: 
- 2141 这道守卫几乎是**死代码**：两个来源在循环内 2110-2114（`getLatestError` → failPublishAndClose）和 2126-2129（`failurePattern` → failPublishAndClose）都会提前 return，只剩"最后一次检查到 120 秒边界之间"这一个窗口有效
- 收口前未查任何持久化失败探针（全文无 `readPublishErrorProbe`，该函数仅被 common.js 与小红书调用）
- 缺陷③残留：latch 只认 2 个选择器（common.js:5096-5097 `.ne-snackbar-item-description` / `.el-message--error`），只出现在 `.cheetah-*` / `.alert-dialog` 且在 1500ms 轮询间隙内消失的失败提示会永久丢失

**后果**: 超时 → `handlePublishSuccess` → `sendStatistics` + 关窗。

**修复优先级**: 🔴 P0 — 立即修复

---

## 🟡 中危缺陷

### 6. 腾讯号 — 缺陷③ 点击后完全没有失败判据

**位置**: `tengxvnhao-publish.js:2911-2923`

**代码**:
```javascript
publishBtn.dispatchEvent(clickEvent);
await AICreatePopup();
await handleProtocolPopup(() => { publishBtn.dispatchEvent(clickEvent); });
// 直接结束，不轮询、不读 getLatestError()、无超时
```

**问题**: 
- `getLatestError()` 的全部消费点（890/1885/2370/2398/2423/2556/2571/2588/2959）都在点击**之前**
- MutationObserver（common.js:4980 `createErrorListener`）仍在往 `capturedErrors` 记录，但点击后再无读者
- 点击后几秒才弹的平台驳回提示被记下后随窗口一起丢掉

**后果**: 点击后的平台拒绝提示全部丢失，无人上报。

**修复优先级**: 🟡 P1

---

### 7. 腾讯号 — `__sohuPublishSuccessFlag` 标志吞掉点击后失败

**位置**: `tengxvnhao-publish.js:3016-3023`

**代码**:
```javascript
if (window.__sohuPublishSuccessFlag) {
    console.warn("发布已点击，跳过失败上报，交给成功页流程处理");
    return;
}
```

**问题**: 该标志在点击**之前**就置位（2879、2893；定时路径 2806、2820） → "点了但失败"落到沉默。配合缺陷③ 等于点击后所有失败都无人上报。

**修复优先级**: 🟡 P1

---

### 8. 网易号 — 缺陷⑤ 定时路径两处失败不上报 + waitForElement 未 catch 死代码

**位置**: `wangyihao-publish.js:1626-1636`

**代码**:
```javascript
if (!timeSelectSuccess) {
    console.error(...'时间选择失败');
    stopErrorListener();
    await closeWindowWithMessage('定时时间选择失败', 1000);
    // 缺 return
} else {
    stopErrorListener();
    await closeWindowWithMessage('定时发布弹窗未打开', 1000);
    return;
}
```

**问题**: 
- 两条失败出口无 `sendStatisticsError`
- `stopErrorListener()` 同时把延迟失败监听关掉
- 定时分支**从不写 publishId**（`localStorage.setItem(getPublishSuccessKey(), ...)` 全文只在 1668 的直发分支），publish-success.js 拿不到 publishId，所以定时发布既不报失败也不报成功
- 1619 `const scheduledModal = await waitForElement('.ne-modal-container');` 未加 `.catch(() => null)`，而 common.js:1110 超时是 `reject(new Error(...))`，导致 1631-1636 的 else 是死代码，该 rejection 落在 1869-1871 的 `setTimeout(async () => { await tryUploadImage(0); })` 内、1874 的 catch 只覆盖调度前同步错误 → **未处理拒绝 + 窗口悬死 + 零上报**

**修复优先级**: 🟡 P1

---

### 9. 网易号 — 缺陷③ `capturedErrors` 只增不清

**位置**: `wangyihao-publish.js:1159 / 1228 / 1242`

**问题**: 
- `capturedErrors` 全文只有 1159 声明和 1228/1242 两处 push，**没有任何 clear 入口**（腾讯侧有 `clearLatestErrors` 且调用 8 次）
- 点击后 1721/1749 的 `getLatestError()` 可能返回填表/上传阶段的旧提示并当作发布失败原因上报（错误归因）

**修复优先级**: 🟡 P1

---

## 🟢 其他可疑点（不直接导致假成功，但会造成静默失败或误判）

### 10. 视频号 — 无封面放弃发布且零上报

**位置**: `shipinhao-publish.js:1252-1256`

**代码**:
```javascript
const customCoverList = dataObj.element.cover2;
if(!customCoverList || customCoverList.length === 0) {
    console.log('[视频号发布][自定义封面图] 未配置自定义封面图，跳过');
    return; // ← 处在 publishApi 函数体层(1247)
}
```

**问题**: 这个 `return` 跳过的是 1917-1925 的表单错误检查、1929 的按钮等待、1963 的点击和全部上报；`publishRunning` 停在 true（仅 1971/2006/2072/2082 会复位），窗口不关、后台无任何记录。

**修复**: 改为 `await sendStatisticsError(publishId, "未配置自定义封面图", "视频号发布"); await closeWindowWithMessage(...); return;`

---

### 11. 抖音 — 手机验证场景把已报的失败翻成成功

**位置**: `douyin-publish.js:727-795 + 2116-2126 + 2182-2188`

**链路**: 
1. `reportDouyinPhoneVerifyFailure` 在 756 先 `sendStatisticsError`
2. 793-794 注释「返回 false 表示不要退出轮询」
3. 轮询 2119 拿到 false 后 `continue`，而 `phoneVerifyMessage` 从不写入 `lastToastMessage`
4. 90 秒后 2182 判空成立 → 2184 上报成功 → 2186 关窗「发布成功，刷新数据」

**问题**: 与 785/787 注释「不设置 publishRunning = false」「不关闭窗口，让轮询继续」以及 751 横幅「窗口将保持打开，请勿关闭」直接矛盾。方向性也不对称：common.js:3346-3360、3399-3413 只在 `resultType === "error"` 时检查已有成功锁并跳过，`sendStatistics` 从不查 `hasErrorMemoryLock`，所以先失败后成功一律放行。

---

### 12. 抖音 / 视频号 — `stopErrorListener` 未声明导致 catch 块死代码

**位置**: `douyin-publish.js:2645` / `shipinhao-publish.js:2364`

**代码**:
```javascript
} catch (e) {
    stopErrorListener?.(); // ← 未声明标识符
    console.error('[抖音发布] ❌ 填写表单失败:', e);
    await sendStatisticsError(publishId, finalError.message || '填写表单失败', ...); // ← 死代码
    await closeWindowWithMessage(...); // ← 死代码
}
```

**问题**: `stopErrorListener` 在两文件内仅此一处出现，common.js 也未挂 `window.stopErrorListener`；`?.()` 只防 null/undefined 值不防未声明绑定 → 抛 ReferenceError，catch 内紧随其后的 `sendStatisticsError` 与 `closeWindowWithMessage` 全成死代码。填表彻底失败时既不上报也不关窗。`xiaohongshu-publish.js:1528` 同款写法。

---

### 13. 搜狐号 — 成功判据跑在整段弹窗拼接文本上

**位置**: `souhuhao-publish.js:1158 / 2122`

**问题**: `readPublishFeedbackText()` 把 `.cheetah-modal` / `.pushtimeout-dialog` 等整个弹窗的 textContent 用 `' | '` 拼接返回，2122 `successPattern.test(feedbackText)` 直接测这个拼接串，**弹窗内任意位置出现「已提交」「发布成功」类字样即立刻上报成功关窗**（例如弹窗标题"发布成功提示"、按钮文案"查看已发布文章"都会命中）。

---

### 14. 百家号 / 搜狐号 — 封面上传按钮空指针 / 图片等待超时值不一致

**百家号 baijiahao-publish.js:1111**:
```javascript
let submitCoverBtn = null; // 1092
// 1096-1102 的循环只在按钮文案含"确定"时赋值
// 1115 的 else 只覆盖"`.cheetah-btn-primary` 一个都没有"的情况
submitCoverBtn.dispatchEvent(clickEvent); // ← 可为 null
```
跑在 `setTimeout(async () => { await tryUploadImage(0); })` 里，两层 catch（1393、1410）都抓不到 → 未捕获 rejection，静默死窗。

**搜狐号 souhuhao-publish.js:1581 vs 1646**:
```javascript
const waitForImageOrError = async (timeout = 30000) => { // 🔑 增加到 30 秒
    // ...
};
await waitForImageOrError(10000); // 1646 只传 10 秒
```
注释与实际生效值差 3 倍，会更频繁进入 1908 起的"上传失败"分支。

---

### 15. 知乎 / 新浪 — retryOperation 包编辑器写入导致正文重复/缺段

**位置**: `zhihu-publish.js:419,605` / `xinlang-publish.js:同结构`

**问题**: 
- `fillFormData` 被 `retryOperation(async () => await fillFormData(...), 3, 2000)` 包住
- 填表主流程用 `setTimeout` 调度（知乎 974/1390/…），catch 只覆盖调度前同步错误
- catch 分支会先把 `fillFormRunning` 复位成 false 再 `closeWindowWithMessage`，关窗那步一旦抛错，外层 retryOperation 就会把「标题 + 正文 + 封面」整篇重跑一遍
- `fillFormRunning` 是瞬时锁，拦不住这种复位后的重入（知乎 79-83 的 `fillFormDone` 是修复此问题的终态标志，但新浪未同步）

**后果**: 正文重复（Draft.js/ProseMirror paste 是插入非覆盖）或缺段（验证失败只 return false 且调用点不接返回值）。

**已知问题**: 见 [[retry-nonidempotent-editor-write]]。

---

## 📝 架构分类

根据超时收口行为，8 个平台分为三类：

| 类型 | 平台 | 超时收口 | 误报风险 |
|------|------|---------|---------|
| **激进型** | 抖音、视频号、搜狐、百家号 | 按成功上报 | 🔴 高（不可恢复） |
| **沉默型** | 腾讯、网易、知乎、新浪 | 既不报成功也不报失败 | 🟡 中（漏报） |
| **已修复** | 小红书 | 补查探针 → 成功 | 🟢 低 |

**激进型的共性问题**:
- 都有「范式对齐小红书」或类似注释，但对齐的是**未修复前**的小红书
- 都未实现持久化失败探针（`readPublishErrorProbe` / 模块级变量）
- 超时时一律按成功收口，一旦误报就不可恢复（后台不支持失败覆盖成功）

**沉默型的特征**:
- 从不调用 `sendStatistics` 或仅在成功页调用
- 超时/未知情况下既不报成功也不报失败，全权委托 publish-success.js
- 误报风险低，但漏报（后台无记录）在定时路径仍可能发生

---

## 🎯 修复建议优先级

### P0（本周必须修复）

1. **百家号缺陷④** — `FAIL_KEYWORDS` 补充「上限」「敏感」「重复」「频繁」「质量」「账号异常」
2. **搜狐缺陷②** — confirm/alert 换 `showPublishToast`，或加特性开关 + 5 分钟超时强制收口
3. **百家号缺陷⑤** — 定时路径失败出口补 `sendStatisticsError`；1149 `checkPublishResult` 移到 1208 点确定之后
4. **抖音/视频号缺陷④** — 超时收口前补查失败探针（参考小红书实现）

### P1（本月内修复）

5. **腾讯缺陷③** — 点击后补轮询或至少读一次 `getLatestError`
6. **腾讯标志吞失败** — `__sohuPublishSuccessFlag` 移到点击之后、成功页检测之前
7. **网易缺陷⑤** — 定时路径补上报；1619 `waitForElement` 加 `.catch(() => null)`
8. **网易缺陷③** — `capturedErrors` 在点击前调用 `clearLatestErrors`（需先在 common.js 暴露该函数）

### P2（下版本修复）

9. 视频号无封面零上报
10. 抖音手机验证翻成功
11. 抖音/视频号 `stopErrorListener` 未声明
12. 搜狐成功判据拼接文本
13. 百家号封面按钮空指针
14. 知乎/新浪 retryOperation 包编辑器写入

---

## 📦 建议统一修复方案

### 方案 A: 持久化失败探针（推荐）

**适用**: 激进型四平台（抖音/视频号/搜狐/百家号）

**步骤**:
1. 在各自 publish.js 顶部注册探针（参考小红书）:
   ```javascript
   let xxxLatestPublishFailure = null;
   const setXxxPublishFailure = (text, source) => {
       const classified = categorizeFailureText(text); // 复用 common.js
       if (classified) {
           xxxLatestPublishFailure = classified;
           window.__XXX_LATEST_PUBLISH_FAILURE__ = classified;
           console.error(`[XXX发布] ❌ 记录失败信号(${source}):`, classified);
       }
       return classified;
   };
   registerPublishErrorProbe(() => xxxLatestPublishFailure || window.__XXX_LATEST_PUBLISH_FAILURE__);
   ```

2. 点击后立即分类（如果 `clickWithTrustedRetry` 返回 message）:
   ```javascript
   if (window.isFeatureEnabled?.("FIX_XXX_FAILURE_REPORT")) {
       const clickFailure = setXxxPublishFailure(clickResult.message, "click-toast");
       if (clickFailure) {
           // 立即上报失败并关窗
       }
   }
   ```

3. 超时收口前补查:
   ```javascript
   if (!lastFailureMessage && window.isFeatureEnabled?.("FIX_XXX_FAILURE_REPORT")) {
       const probed = readPublishErrorProbe();
       if (probed) {
           lastFailureMessage = probed;
           console.error('[XXX发布] ❌ 超时兜底命中失败探针');
       }
   }
   
   if (!lastFailureMessage) {
       // 才按成功收口
   }
   ```

### 方案 B: 失败词表扩充（辅助）

**百家号 / 视频号**:
```javascript
const FAIL_KEYWORDS = [
    '失败','错误','异常','不能为空','请先','违规','超限','驳回','不可用','不符合','未通过','已用尽',
    // 新增：
    '上限','敏感','重复','频繁','质量','账号异常','违反','禁止','限流','风控','风险'
];
```

### 方案 C: 定时路径规范（通用）

**所有平台**:
1. 定时失败出口必须 `sendStatisticsError`
2. 点确定后必须检测结果（不能只 `stopErrorListener` 就走人）
3. `waitForElement` / `waitForXxx` 必须 `.catch(() => null)` 或 try-catch 包住

---

## 🔍 验证清单（修复后必测）

### 功能测试

- [ ] 平台明确拒绝（违规/限流/敏感/上限）→ 后台有失败记录
- [ ] 定时时间解析失败 → 后台有失败记录
- [ ] 定时时间选不上 → 后台有失败记录
- [ ] 定时确定后平台拒绝 → 后台有失败记录
- [ ] 超时（90s/120s）且无任何提示 → 后台按成功 or 无记录（沉默型）
- [ ] 超时但实际失败了（toast 消失了才读）→ 后台有失败记录（探针兜底）

### 回归测试

- [ ] 正常发布（立即 + 定时）→ 后台有成功记录
- [ ] 登录页守卫 → 不报失败、不关窗
- [ ] 批量发布无人值守 → 不弹 alert/confirm/prompt
- [ ] SPA 重复注入 → 不产生并发实例

---

## 📚 参考资料

- 小红书修复: `FIX_XIAOHONGSHU_FAILURE_REPORT` (v1.2.20)
- 测试套件: `test-xiaohongshu-failure-report.js` (35 项全过)
- 记忆文档: `.claude/projects/D----------/memory/xhs-failure-report-dropped-evidence.md`
- 其他已知问题:
  - `[[login-probe-selfharm-antipatterns]]` — 登录态检测自伤四连
  - `[[retry-nonidempotent-editor-write]]` — 重试非幂等编辑器写入
  - `[[publish-report-optimistic-strategy]]` — 全平台发布上报策略

---

**审计完成时间**: 2026-09-02 15:47  
**审计人员**: Claude Code (Opus 4.8)  
**审计方法**: 
- 静态代码分析（全文读取 8 个文件，总计 ~16000 行）
- 模式匹配审计（对照小红书已修复的 5 类缺陷）
- 4 个并发子代理分组审计（知乎+新浪、搜狐+百家号、腾讯+网易、抖音+视频号）
- 交叉验证（不同代理的发现相互印证）
