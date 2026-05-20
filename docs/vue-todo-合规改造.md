# Vue 项目（ai-media-edit）合规改造待办

> 配合 Electron 浏览器侧的合规改造（cookie 7 天过期、加密存储、清除 API），Vue 业务前端需要同步完成以下事项。
>
> **影响分支**：`master`、`分享`、`无感更新`（三个分支均需同步）
>
> **关联 Electron 改造**：
> - cookie `expirationDate` 一律延长为 7 天（`getFullSessionData` 内已实现）
> - `global-storage.json` 敏感字段 safeStorage 加密
> - 新增 `clearAllAuthData` IPC（一键清除所有授权数据）
> - 日志脱敏

---

## 一、用户协议 / 隐私政策（P0）

### 修改位置
通常位于：
- `src/views/login/protocol.vue` 或 `src/views/protocol/**`
- `src/components/agreement/**`
- 注册页 / 登录页底部"我已阅读并同意《用户协议》《隐私政策》"链接指向的页面

### 必须新增条款

```markdown
## 关于第三方平台登录凭证的存储

为提供"自动发布"功能，本产品需要在您主动授权后，临时保存您在第三方平台（抖音、
小红书、微信公众号、百家号、视频号等）的登录凭证（Cookie 及相关会话数据）。

### 数据范围
- Cookie 数据（包含 sessionid、user_token 等会话标识）
- 浏览器本地存储（localStorage、sessionStorage、IndexedDB）
- 平台用户公开信息（昵称、头像、用户 ID）

### 存储方式
- 服务器端加密存储，单独密钥保护
- 本地端使用操作系统级安全存储（Windows DPAPI / macOS Keychain）加密
- 第三方平台 Cookie 在本地客户端中过期时间统一设置为 7 天

### 使用目的
仅用于您主动发起的内容发布行为，不用于其他任何目的。

### 您的权利
- 您可随时在"账号管理"页面解除任一平台的授权
- 您可在"设置 → 数据管理"中一键清除所有授权数据
- 您可以通过客服联系我们删除服务器端存储的数据

### 数据保存期限
- 第三方平台凭证：自您最后一次使用之日起 7 天
- 我们不会将您的凭证用于自动续期或任何超出授权范围的行为
```

### 同步需要修改的位置
- 隐私政策 / 用户协议页面
- 注册页 / 登录页底部提示
- 应用首次启动的协议弹窗（如有）

---

## 二、首次单独同意弹窗（P0）

### 关键合规要求
依据《个人信息保护法》第 14 条，处理个人信息的同意必须是 **充分知情** 且 **自愿、明确** 的。**不能默认勾选**。

### 实现位置建议
- `src/views/short-video/components/AddAccount.vue` 内：用户点击"添加账号"按钮时，第一次必须先弹"授权确认"框
- 或者放在 App.vue 全局，首次启动时弹一次

### UI 要求

```vue
<el-dialog v-model="showAuthConsent" title="授权确认" :close-on-click-modal="false" :show-close="false">
  <div class="consent-content">
    <p>为提供"自动发布"功能，本产品将在您的客户端本地与我们的服务器保存您在第三方平台的登录凭证。</p>
    <ul>
      <li>保存范围：Cookie、localStorage 等会话数据</li>
      <li>保存期限：最长 7 天</li>
      <li>使用目的：仅用于您主动发起的内容发布</li>
      <li>加密方式：本地 safeStorage + 服务器端加密</li>
    </ul>
    <p>您可随时在"设置 → 数据管理"中清除所有授权数据。</p>

    <!-- 必须未勾选，强制用户主动勾选 -->
    <el-checkbox v-model="userAgreed">我已阅读并同意《用户协议》《隐私政策》以上述方式处理我的登录凭证</el-checkbox>
  </div>
  <template #footer>
    <el-button @click="rejectAuth">取消</el-button>
    <el-button type="primary" :disabled="!userAgreed" @click="confirmAuth">同意并继续授权</el-button>
  </template>
</el-dialog>
```

### 同意状态持久化

```js
// 用户首次同意后，写入持久化存储
async function confirmAuth() {
  await window.browserAPI.setGlobalData('user_consent_auth_storage', {
    agreed: true,
    timestamp: Date.now(),
    version: '1.0'  // 协议版本号，协议更新后需要重新弹
  });
  showAuthConsent.value = false;
  // 继续执行授权流程
}

// 检查是否已同意（每次添加账号前调用）
async function checkAuthConsent() {
  const consent = await window.browserAPI.getGlobalData('user_consent_auth_storage');
  if (!consent?.agreed || consent.version !== '1.0') {
    showAuthConsent.value = true;
    return false;
  }
  return true;
}
```

### 协议版本控制
协议更新后，提升 `version` 字段，强制用户重新阅读并同意。

---

## 三、一键清除所有授权数据 UI 入口（P0）

### 关键合规要求
依据《个人信息保护法》第 47 条，个人有权请求删除其个人信息。必须提供便捷的删除入口。

### 实现位置建议

| 入口 | 路径 |
|------|------|
| 主入口 | "我的" 或"设置"页 → "数据与隐私" → "清除所有授权数据" |
| 辅助入口 | 退出登录时弹窗询问"是否同时清除所有授权数据" |

### UI 示例

```vue
<!-- src/views/settings/DataPrivacy.vue（新增页面） -->
<template>
  <div class="data-privacy">
    <el-card>
      <h3>授权数据管理</h3>
      <p>清除后，您在所有第三方平台（抖音、小红书、公众号等）的授权数据将被彻底删除。</p>
      <p>下次发布前需要重新授权。</p>

      <el-button type="danger" @click="handleClearAll">一键清除所有授权数据</el-button>
    </el-card>
  </div>
</template>

<script setup>
import { ElMessageBox, ElMessage } from 'element-plus';

async function handleClearAll() {
  try {
    await ElMessageBox.confirm(
      '此操作将清除所有第三方平台的授权数据，且不可恢复。是否继续？',
      '确认清除',
      { type: 'warning', confirmButtonText: '确认清除', cancelButtonText: '取消' }
    );

    // 调用 Electron IPC（在浏览器宿主里才能调用）
    if (!window?.electronAPI?.clearAllAuthData) {
      ElMessage.error('当前环境不支持此操作');
      return;
    }

    const result = await window.electronAPI.clearAllAuthData();
    if (result.success) {
      ElMessage.success(`已清除 ${result.deletedAccounts} 个授权账号、${result.deletedCookies} 条 Cookie`);
      // 刷新本地账号列表
      await refreshAccountList();
    } else {
      ElMessage.error(result.error || '清除失败');
    }
  } catch (e) {
    if (e !== 'cancel') console.error(e);
  }
}
</script>
```

### IPC 接口约定（Electron 侧实现）

```js
// 调用方式
const result = await window.electronAPI.clearAllAuthData();

// 返回值
{
  success: true,
  deletedAccounts: 10,     // 删除的平台账号数
  deletedCookies: 200,     // 删除的 BrowserView session cookies 数
  deletedSessions: 10      // 删除的独立 session 数
}
// 或
{ success: false, error: '错误信息' }
```

> 由于此接口涉及不可恢复操作，Electron 侧已在 IPC 内部加二次校验日志。

---

## 四、注意事项 / Checklist

- [ ] 协议条款 **三个分支** 同步更新
- [ ] 同意弹窗未勾选不能继续（disabled 必须生效）
- [ ] 同意弹窗 **不能** `:show-close="false"` + 默认 `userAgreed = true`（默认勾选违法）
- [ ] 协议页面有版本号，更新后强制重新同意
- [ ] 清除按钮加二次确认（避免误触）
- [ ] 清除按钮在非 Electron 环境下置灰或隐藏（防止 H5 直接报错）
- [ ] 联调测试：在浏览器宿主里点击清除，确认平台账号列表立即清空
- [ ] 日志层面：清除操作要写后台审计日志（用户主动行为可追溯）

---

## 五、Electron 端配合提供的 API

| API | 调用方 | 用途 |
|-----|--------|------|
| `window.electronAPI.clearAllAuthData()` | Vue（控制面板 renderer） | 一键清除（仅控制面板可用） |
| `window.browserAPI.setGlobalData(key, value)` | Vue（BrowserView 内业务页） | 写入同意状态 |
| `window.browserAPI.getGlobalData(key)` | Vue（BrowserView 内业务页） | 读取同意状态 |

> 注意：Vue 业务页面运行在 **BrowserView 里**，调用的是 `window.browserAPI.*`，不是 `window.electronAPI.*`。但 `clearAllAuthData` 这种危险操作建议只在控制面板（`renderer.js`）侧调用。如果 Vue 必须调用，需要走 `sendToHome` 转发到首页再走 IPC，或单独暴露 `browserAPI.clearAllAuthData`。

**【需要 Electron 侧决定】**：`clearAllAuthData` 是否暴露到 `browserAPI`（即 BrowserView 内的业务 Vue 页面可直接调用）？

- 选项 A（**推荐**）：仅 `electronAPI` 暴露，业务 Vue 通过 `sendToHome` 通知首页执行
- 选项 B：`browserAPI` 也暴露，Vue 直接调用

---

## 附：合规改造完整时间线

| 阶段 | 内容 | 状态 |
|------|------|------|
| 已完成 | Electron 侧 cookie expirationDate 改为 now+7天 | ✅ |
| 进行中 | Electron 侧 clearAllAuthData / safeStorage / 日志脱敏 | ⏳ |
| 待办 | Vue 侧用户协议 / 同意弹窗 / 清除按钮 | 📋 |
| 待办 | 三个分支同步（master / 分享 / 无感更新） | 📋 |
