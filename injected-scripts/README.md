# 本地脚本配置使用指南

## 功能说明

你现在可以在本地维护一个配置文件 `injected-scripts/scripts-config.json`，将网址映射到对应的 JS 脚本文件，系统会自动在访问相应页面时注入这些脚本，无需在浏览器界面上手动操作。

## 配置文件位置

```
D:\浏览器\运营助手\injected-scripts\scripts-config.json
```

## 配置格式

```json
{
  "scripts": {
    "完整URL": "脚本文件名.js",
    "http://localhost:5173/": "auth.js",
    "https://example.com/login": "example-login.js"
  },
  "注释": [
    "在这里配置 URL 和对应的脚本文件",
    "URL 必须完整匹配(包括协议和端口)",
    "脚本文件放在同一目录下",
    "修改后重启应用即可生效"
  ]
}
```

## 使用步骤

### 1. 编辑配置文件

打开 `injected-scripts/scripts-config.json`，添加你的 URL 和脚本映射：

```json
{
  "scripts": {
    "http://localhost:5173/": "auth.js",
    "https://www.baidu.com/": "baidu-helper.js",
    "https://github.com/": "github-enhancer.js"
  }
}
```

### 2. 创建脚本文件

在 `injected-scripts` 目录下创建对应的 JS 文件：

**示例：auth.js**
```javascript
console.log('✅ 脚本已加载');

// 在页面顶部添加提示
const banner = document.createElement('div');
banner.textContent = '自定义脚本已加载';
banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#667eea;color:white;padding:10px;text-align:center;z-index:10000';
document.body.appendChild(banner);
```

### 3. 重启应用

修改配置文件或脚本文件后，重启浏览器应用，脚本会自动加载并在对应页面注入。

## 注意事项

- ✅ **URL 必须完整匹配**：包括协议（http/https）和端口号
- ✅ **脚本文件路径**：相对于 `injected-scripts` 目录
- ✅ **即时生效**：修改脚本文件后刷新页面即可，无需重启
- ✅ **配置生效**：修改配置文件（添加新URL映射）需要重启应用

## 脚本示例

### 自动填充表单

```javascript
document.addEventListener('DOMContentLoaded', () => {
  const username = document.querySelector('#username');
  const password = document.querySelector('#password');

  if (username) username.value = 'your-username';
  if (password) password.value = 'your-password';
});
```

### 修改页面样式

```javascript
const style = document.createElement('style');
style.textContent = `
  body { background: #f0f0f0 !important; }
  .ad-banner { display: none !important; }
`;
document.head.appendChild(style);
```

### 添加自定义按钮

```javascript
const button = document.createElement('button');
button.textContent = '快捷操作';
button.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;padding:10px;';
button.onclick = () => {
  alert('执行自定义操作');
};
document.body.appendChild(button);
```

## 调试技巧

1. **查看控制台**：打开浏览器的开发者工具，查看 Console 标签
2. **检查日志**：启动应用后，主控制台会显示加载的脚本信息
3. **错误排查**：如果脚本未生效，检查：
   - URL 是否完全匹配（注意协议、域名、端口、路径）
   - 脚本文件是否存在
   - JavaScript 语法是否正确
   - 是否有控制台错误信息

## 高级功能

### 支持多个页面使用同一脚本

你可以在配置中为多个URL指向同一个脚本文件：

```json
{
  "scripts": {
    "https://site1.com/": "common-helper.js",
    "https://site2.com/": "common-helper.js",
    "https://site3.com/": "common-helper.js"
  }
}
```

### 使用子目录组织脚本

```json
{
  "scripts": {
    "https://example.com/": "helpers/example.js"
  }
}
```

只需在 `injected-scripts` 目录下创建 `helpers` 子目录即可。

---

**祝你使用愉快！** 🎉
