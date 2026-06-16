# 失败诊断与分类功能验证报告

## 📋 任务概述

为发布脚本添加按钮 disabled 原因诊断和失败原因标准化分类功能，提升错误上报的准确性和可分析性。

---

## ✅ 完成的工作

### 1. Common.js 基础设施（通用工具）

#### 新增 4 个核心函数

| 函数 | 功能 | 测试覆盖 |
|------|------|---------|
| `FAILURE_CATEGORIES` | 失败分类枚举（9种类型） | ✅ 18项 |
| `categorizeFailure()` | 自动分类失败原因 | ✅ 18项 |
| `collectFormDiagnostics()` | 收集表单状态诊断 | ✅ 8项 |
| `diagnoseButtonDisabled()` | 按钮disabled原因诊断 | ✅ 10项 |

#### 增强 sendStatisticsError()

- ✅ 自动调用 `categorizeFailure()` 推断失败类别
- ✅ 添加 `failure_category` 字段到上报数据（方便后台统计分析）
- ✅ 支持 `extraFields` 参数传递结构化诊断信息
- ✅ 向后兼容：旧调用无需改动，自动受益

#### 修复认证正则漏洞

- **问题**：`登录失效` 无法匹配「登录已失效」「登录状态过期」等常见文案
- **修复**：正则改为 `/登录.{0,4}(失效|过期|超时)|重新登录|认证失败|账号.{0,4}异常/`
- **效果**：覆盖更多认证失败变体

---

### 2. 平台发布脚本集成

#### 百家号 (baijiahao-publish.js)

**位置**：行 945-1001（按钮 disabled 检测处）

**改动**：
```javascript
// 🔴 收集表单诊断信息
const formDiagnostics = window.collectFormDiagnostics({
  platform: 'baijiahao',
  selectors: {
    title: '.news-editor-pc input[placeholder*="标题"]',
    content: '.news-editor-pc iframe',
    coverImage: "[class*='-imglist'] [class*='-selectedItem'] img",
  },
  required: { title: true, content: true, coverImage: true }
});

// 🔴 诊断按钮原因
const buttonDiagnosis = window.diagnoseButtonDisabled(publishBtn, formDiagnostics, [getLatestError()]);

// 🔴 生成人类可读失败原因
let failureReason = buttonDiagnosis?.recommendation || '发布按钮不可用';

// 🔴 上报时自动分类（由 sendStatisticsError 内部处理）
await sendStatisticsError(publishId, failureReason, '百家号发布', null, {
  categorizeContext: { buttonDisabled: true },
  diagnosis: {
    form: formDiagnostics?.summary,
    formIssues: formDiagnostics?.issues,
    buttonReasons: buttonDiagnosis?.disabledReasons
  }
});
```

**效果**：
- 原来：「发布按钮不可用，可能不符合发布要求，或者发文次数已用尽」
- 现在：「请检查: title: 必填字段为空」（具体指出哪个字段缺失）

---

#### 搜狐号 (souhuhao-publish.js)

**位置**：行 983-1021（按钮 disabled 检测处）

**改动**：与百家号类似，但表单选择器不同
```javascript
selectors: {
  title: 'input[placeholder*="标题"]',
  content: '.editor-content',
  coverImage: '.select-image img',
}
```

**复用**：通过 `failPublishAndClose()` 函数传递诊断后的 `failureReason`

---

#### 抖音 (douyin-publish.js)

**位置**：行 860-909（catch 块）

**改动**：在 catch 块中识别按钮 disabled 错误，补充诊断
```javascript
} catch (error) {
  let errorDetail = error.message || '发布过程出错';
  
  // 🔴 识别按钮 disabled 错误
  if (errorDetail.includes('发布按钮') && errorDetail.includes('不可用')) {
    const publishBtn = document.querySelector(".button-dhlUZE");
    const formDiagnostics = window.collectFormDiagnostics({
      platform: 'douyin',
      selectors: {
        title: '.editor-kit-root-container .semi-input',
        content: '.zone-container',
        video: '[class*="upload-progress-style"]',
      },
      required: { title: true, video: true }
    });
    const buttonDiagnosis = window.diagnoseButtonDisabled(publishBtn, formDiagnostics, []);
    
    if (buttonDiagnosis?.recommendation) {
      errorDetail = buttonDiagnosis.recommendation;
    }
  }
  
  await sendStatisticsError(publishId, errorDetail, '抖音发布');
}
```

**特点**：抖音使用 retryOperation 循环等待按钮可用，失败后抛异常到 catch，因此诊断逻辑在 catch 块中

---

## 🧪 测试验证

### 自动化测试

**文件**：`test-diagnostics.js`

**覆盖**：
- ✅ 18 项分类规则测试（包括修复后的认证正则）
- ✅ 8 项表单诊断测试（空值、已填、元素不存在、非输入元素）
- ✅ 10 项按钮诊断测试（null、可用、表单问题、平台错误、兜底）
- ✅ 2 项端到端联动测试

**结果**：**38/38 通过** ✅

### 语法检查

```bash
node --check injected-scripts/common.js          # ✅ 通过
node --check injected-scripts/baijiahao-publish.js # ✅ 通过
node --check injected-scripts/souhuhao-publish.js  # ✅ 通过
node --check injected-scripts/douyin-publish.js    # ✅ 通过
```

---

## 📊 上报数据结构变化

### 旧格式（改动前）
```json
{
  "id": "123",
  "status_text": "发布按钮不可用，可能不符合发布要求，或者发文次数已用尽",
  "context": { "url": "...", "timestamp": "..." }
}
```

### 新格式（改动后）
```json
{
  "id": "123",
  "status_text": "请检查: title: 必填字段为空",
  "failure_category": "form_validation",
  "diagnosis": {
    "form": "缺少必填字段: title",
    "formIssues": ["title: 必填字段为空"],
    "buttonReasons": ["表单验证未通过"]
  },
  "context": { "url": "...", "timestamp": "..." }
}
```

**新增字段说明**：
- `failure_category`：标准化分类（枚举值，方便后台统计）
- `diagnosis`：结构化诊断详情（可选，按钮 disabled 场景下有）

---

## 🎯 业务价值

### 1. 失败原因更精准

**示例对比**：
| 场景 | 旧错误信息 | 新错误信息 |
|------|-----------|-----------|
| 标题为空 | 发布按钮不可用，可能不符合发布要求，或者发文次数已用尽 | 请检查: title: 必填字段为空 |
| 封面缺失 | 发布按钮不可用... | 请检查: coverImage: 必填字段为空 |
| 平台提示敏感词 | 发布按钮不可用... | 平台提示: 内容含敏感词 |

### 2. 后台可统计分析

`failure_category` 枚举值：
- `form_validation` - 表单验证错误（标题为空、内容不合规）
- `upload_failed` - 上传失败（图片/视频）
- `network_error` - 网络错误
- `platform_limit` - 平台限制（发文次数用尽）
- `timeout` - 超时
- `auth_required` - 需要认证（登录失效）
- `button_disabled` - 按钮不可用（未明确原因）
- `script_error` - 脚本异常
- `unknown` - 未知错误

**后台可用 SQL 统计**：
```sql
SELECT failure_category, COUNT(*) 
FROM publish_errors 
WHERE created_at > '2026-06-01' 
GROUP BY failure_category;
```

### 3. 向后兼容

- ✅ 所有旧的 `sendStatisticsError()` 调用无需改动
- ✅ 自动推断分类，添加 `failure_category` 字段
- ✅ 旧调用不传 `extraFields`，仍正常工作

---

## 🔧 维护建议

### 新平台接入

新平台发布脚本按以下模式集成：

```javascript
// 1. 检测按钮 disabled
if (publishBtn.disabled || publishBtn.classList.contains('disabled')) {
  
  // 2. 收集表单诊断
  const formDiagnostics = window.collectFormDiagnostics({
    platform: 'newplatform',
    selectors: { title: '#title', content: '#content' },
    required: { title: true, content: true }
  });
  
  // 3. 诊断按钮原因
  const buttonDiagnosis = window.diagnoseButtonDisabled(
    publishBtn, 
    formDiagnostics, 
    [getLatestError()]
  );
  
  // 4. 生成人类可读失败原因
  const failureReason = buttonDiagnosis?.recommendation || '发布按钮不可用';
  
  // 5. 上报（自动分类）
  await sendStatisticsError(publishId, failureReason, '新平台发布', null, {
    categorizeContext: { buttonDisabled: true },
    diagnosis: {
      form: formDiagnostics?.summary,
      formIssues: formDiagnostics?.issues,
      buttonReasons: buttonDiagnosis?.disabledReasons
    }
  });
}
```

### 分类规则扩展

如需新增失败分类，修改 `common.js`:

```javascript
window.FAILURE_CATEGORIES = {
  // ... 现有分类
  NEW_CATEGORY: 'new_category',  // 新增
};

window.categorizeFailure = function (errorMessage, context = {}) {
  const msg = String(errorMessage || '').toLowerCase();
  
  // 新增匹配规则（放在最前面，优先级高）
  if (/新规则关键词/.test(msg)) {
    return {
      category: window.FAILURE_CATEGORIES.NEW_CATEGORY,
      message: errorMessage,
      detail: { type: 'new', originalMessage: errorMessage }
    };
  }
  
  // ... 现有规则
};
```

---

## 📝 文件清单

| 文件 | 改动行数 | 说明 |
|------|---------|------|
| `injected-scripts/common.js` | +240 | 新增4个诊断函数 + 增强sendStatisticsError |
| `injected-scripts/baijiahao-publish.js` | +38 | 按钮disabled处集成诊断 |
| `injected-scripts/souhuhao-publish.js` | +38 | 同上 |
| `injected-scripts/douyin-publish.js` | +44 | catch块中补充诊断 |
| `test-diagnostics.js` | +177 (新增) | 自动化测试 |
| `VERIFICATION_REPORT.md` | +XXX (新增) | 本报告 |

---

## ✅ 验收标准

- [x] common.js 新增4个诊断工具函数
- [x] sendStatisticsError 自动添加 failure_category 字段
- [x] 百家号、搜狐号、抖音 3个平台集成诊断功能
- [x] 38个自动化测试全部通过
- [x] 语法检查全部通过
- [x] 向后兼容（旧调用仍正常工作）
- [x] 修复认证正则漏洞

---

**报告生成时间**：2026-06-16
**测试状态**：✅ 全部通过
**就绪状态**：✅ 可发布
