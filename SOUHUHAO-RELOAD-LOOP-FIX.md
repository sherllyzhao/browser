# 搜狐号发布页无限转圈问题修复指南

## 问题现象
浏览器打开搜狐号发布页后，一直显示"正在加载页面..."的转圈动画，无法进入正常页面。

## 问题原因分析

搜狐号发布脚本（`souhuhao-publish.js`）有多个自动刷新机制，可能形成无限刷新循环：

### 1. 白屏检测机制（最可能）
- **位置**: 代码行 169-175
- **触发条件**: 3 秒后检测不到 `.ne-editor`、`.publish-btn`、`.title-input` 等元素
- **行为**: 自动刷新页面，最多 3 次
- **问题**: 如果搜狐页面加载慢（>3秒），会触发刷新，导致页面永远加载不完

### 2. 渲染健康守卫
- **位置**: 代码行 187-255
- **触发条件**: 检测到编辑器缺失 + CSS 乱码特征
- **行为**: 自动刷新页面，最多 2 次

### 3. 必需元素恢复机制
- **位置**: 代码行 377-393
- **触发条件**: 必需元素连续缺失 3 次
- **行为**: 跳转到 firstPage 再跳回来

### 4. 发布数据恢复监听器
- **位置**: 代码行 460-497
- **触发条件**: 每 500ms 检测一次 URL，如果有发布数据会自动跳转

## 修复方案

### 🔧 方案 1：清理刷新计数器（立即生效，推荐优先尝试）

**步骤 1**: 打开浏览器开发者工具（F12）

**步骤 2**: 切换到 Console 标签

**步骤 3**: 粘贴并运行以下代码：

```javascript
// 清理所有搜狐号刷新计数器
(function clearSouhuhaoReloadCounters() {
    console.log('%c[修复工具] 开始清理搜狐号刷新计数器...', 'color: #2196F3; font-weight: bold');

    const keysToRemove = [
        // localStorage 键
        '搜狐号发布_RELOAD_RETRY_COUNT',
        '搜狐号_RELOAD_RETRY_COUNT',
        'SOUHUHAO_RELOAD_RETRY_COUNT',
        'sohu_publish_success_data',
        'PUBLISH_SUCCESS_DATA',
        
        // sessionStorage 键
        '__sohu_publish_render_unhealthy_reload_count__',
        '__sohuhao_required_element_miss_count__',
        '__sohuhao_publish_data_recover_count__',
        '__sohuhao_content_entry__',
    ];

    let removed = 0;

    // 清理 localStorage
    keysToRemove.forEach(key => {
        try {
            if (localStorage.getItem(key)) {
                localStorage.removeItem(key);
                console.log(`%c[修复工具] ✅ 已清理 localStorage.${key}`, 'color: #4CAF50');
                removed++;
            }
        } catch (e) {}
    });

    // 清理 sessionStorage
    keysToRemove.forEach(key => {
        try {
            if (sessionStorage.getItem(key)) {
                sessionStorage.removeItem(key);
                console.log(`%c[修复工具] ✅ 已清理 sessionStorage.${key}`, 'color: #4CAF50');
                removed++;
            }
        } catch (e) {}
    });

    // 清理全局标志
    delete window.__SH_SCRIPT_LOADED__;
    delete window.__sohuPublishSuccessFlag;
    delete window.__sohuPublishDataFirstPageWatcher__;
    delete window.__sohuRequiredElementRecovering__;

    console.log(`%c[修复工具] 🎉 清理完成，共清理 ${removed} 个计数器`, 'color: #FF9800; font-weight: bold');
    console.log('%c[修复工具] 请手动刷新页面（Ctrl+R 或 F5）', 'color: #2196F3; font-weight: bold');
})();
```

**步骤 4**: 手动刷新页面（Ctrl+R 或 F5）

---

### 🔧 方案 2：调整白屏检测延迟时间（已修改代码）

**修改内容**:
- 白屏检测延迟从 **3 秒** 增加到 **8 秒**
- 最大重试次数从 **3 次** 减少到 **2 次**

**生效方式**: 重启运营助手浏览器

**文件位置**: `D:\浏览器\运营助手\injected-scripts\souhuhao-publish.js` 第 174 行

---

### 🔧 方案 3：检查登录状态

搜狐号登录可能已过期，导致页面跳转到登录页，但脚本仍在尝试加载发布页。

**步骤 1**: 打开 Console，查看日志中是否有以下信息：
```
[搜狐号发布] 🔐 检测到登录页，暂停发布流程等待用户手动登录
```

**步骤 2**: 如果看到上述信息，说明需要重新登录：
1. 关闭当前发布窗口
2. 在首页重新授权搜狐号账号
3. 授权成功后再次尝试发布

---

### 🔧 方案 4：禁用白屏检测（最后手段）

如果以上方案都无效，可以临时禁用白屏检测：

**步骤 1**: 打开 `D:\浏览器\运营助手\injected-scripts\souhuhao-publish.js`

**步骤 2**: 找到第 169-175 行，注释掉白屏检测：

```javascript
// ===========================
// 🔑 搜狐号白屏检测和自动恢复（使用公共函数）
// ===========================
// if (typeof window.checkBlankPageAndReload === 'function') {
//     window.checkBlankPageAndReload('搜狐号发布', [
//         '.ne-editor',
//         '.publish-btn',
//         '.title-input'
//     ], 8000, 2);
// }
```

**步骤 3**: 重启运营助手浏览器

⚠️ **注意**: 禁用后，如果页面真的白屏，不会自动恢复，需要手动刷新。

---

## 诊断工具：查看当前状态

在 Console 中运行以下代码，查看当前页面状态：

```javascript
// 搜狐号发布页诊断工具
(function diagnoseSouhuhaoPublish() {
    console.log('%c========== 搜狐号发布页诊断报告 ==========', 'color: #2196F3; font-size: 14px; font-weight: bold');
    
    // 1. 页面基本信息
    console.log('%c[1] 页面基本信息', 'color: #FF9800; font-weight: bold');
    console.log('  URL:', window.location.href);
    console.log('  readyState:', document.readyState);
    console.log('  body 存在:', !!document.body);
    console.log('  body 文本长度:', (document.body?.innerText || '').length);
    
    // 2. 关键元素检测
    console.log('%c[2] 关键元素检测', 'color: #FF9800; font-weight: bold');
    const keySelectors = [
        '.ne-editor',
        '.publish-btn',
        '.title-input',
        '.publish-title input',
        '.abstract textarea',
        '#editor',
    ];
    keySelectors.forEach(selector => {
        const el = document.querySelector(selector);
        console.log(`  ${selector}:`, el ? '✅ 存在' : '❌ 不存在');
    });
    
    // 3. 刷新计数器状态
    console.log('%c[3] 刷新计数器状态', 'color: #FF9800; font-weight: bold');
    const counters = [
        ['localStorage', '搜狐号发布_RELOAD_RETRY_COUNT'],
        ['sessionStorage', '__sohu_publish_render_unhealthy_reload_count__'],
        ['sessionStorage', '__sohuhao_required_element_miss_count__'],
        ['sessionStorage', '__sohuhao_publish_data_recover_count__'],
    ];
    counters.forEach(([storage, key]) => {
        const value = window[storage].getItem(key);
        console.log(`  ${storage}.${key}:`, value || '(未设置)');
    });
    
    // 4. 全局标志
    console.log('%c[4] 全局标志', 'color: #FF9800; font-weight: bold');
    console.log('  __SH_SCRIPT_LOADED__:', !!window.__SH_SCRIPT_LOADED__);
    console.log('  __sohuPublishSuccessFlag:', !!window.__sohuPublishSuccessFlag);
    console.log('  __sohuPublishDataFirstPageWatcher__:', !!window.__sohuPublishDataFirstPageWatcher__);
    
    // 5. 错误信息
    console.log('%c[5] 最近的控制台错误', 'color: #FF9800; font-weight: bold');
    console.log('  请查看上方红色错误信息');
    
    console.log('%c========== 诊断完成 ==========', 'color: #2196F3; font-size: 14px; font-weight: bold');
})();
```

---

## 预防措施

### 1. 检查网络环境
- 确保网络连接稳定
- 搜狐号页面加载较慢时，可能触发白屏检测

### 2. 定期清理缓存
- 浏览器缓存过多可能导致加载变慢
- 建议每周清理一次：设置 → 清除浏览数据

### 3. 及时更新登录状态
- 搜狐号登录有效期较短
- 如果发布失败，优先检查是否需要重新授权

---

## 技术细节

### 白屏检测逻辑

```javascript
// 检测延迟：8000ms（8 秒）
// 最大重试：2 次
// 关键元素：.ne-editor, .publish-btn, .title-input

setTimeout(() => {
    if (!找到关键元素 && bodyText < 100) {
        刷新次数++;
        if (刷新次数 < 2) {
            location.reload(); // 刷新页面
        }
    }
}, 8000);
```

### 渲染健康守卫逻辑

```javascript
// 检测延迟：4000ms（4 秒）+ 2000ms（复查）
// 最大重试：2 次
// 触发条件：编辑器缺失 + CSS 乱码特征

setTimeout(() => {
    if (!编辑器存在 && 有CSS乱码特征) {
        刷新次数++;
        if (刷新次数 < 2) {
            location.reload(); // 刷新页面
        }
    }
}, 4000);
```

---

## 相关文件

- **发布脚本**: `D:\浏览器\运营助手\injected-scripts\souhuhao-publish.js`
- **公共库**: `D:\浏览器\运营助手\injected-scripts\common.js`
- **脚本配置**: `D:\浏览器\运营助手\injected-scripts\scripts-config.json`
- **修复工具**: `D:\浏览器\运营助手\fix-souhuhao-reload-loop.js`

---

## 更新日志

- **2026-08-20**: 初始版本，记录问题分析和修复方案
- **修改**: 白屏检测延迟从 3 秒增加到 8 秒，重试次数从 3 次减少到 2 次
