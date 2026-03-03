# CDP 原生点击与浏览器事件信任机制（isTrusted）

## 背景

在自动化场景中，需要通过脚本模拟用户点击操作。但浏览器有一套事件信任机制，会区分"真实用户操作"和"脚本模拟操作"。

## 浏览器的 `isTrusted` 机制

每个 DOM 事件对象都有一个**只读**属性 `event.isTrusted`：

| 事件来源 | `isTrusted` 值 | 说明 |
|---------|:--------------:|------|
| 用户真实操作（鼠标/键盘） | `true` | 操作系统层面产生的硬件输入事件 |
| JS 代码触发（`element.click()`、`dispatchEvent`） | `false` | 脚本模拟的事件 |

**关键点**：`isTrusted` 是浏览器内核级别的保护，JavaScript 无法伪造或覆盖。

## 为什么 JS 模拟点击有时不生效

### 1. 框架层面的信任检查

Vue、React 等现代前端框架，以及很多平台页面会检查事件是否可信：

```javascript
element.addEventListener('click', (e) => {
  if (!e.isTrusted) return; // 拒绝脚本触发的点击
  // 真正的业务逻辑...
});
```

### 2. 浏览器原生行为限制

某些浏览器原生行为**只响应可信事件**：

- `<input type="file">` 的文件选择弹窗
- `window.open()` 在部分浏览器中需要可信事件上下文
- 某些表单提交、全屏请求（`requestFullscreen`）等

### 3. 结果

用 `element.click()` 或 `new MouseEvent()` + `dispatchEvent()` 模拟点击时，事件确实触发了，但**目标组件会忽略它**。

## CDP（Chrome DevTools Protocol）解决方案

### 原理

CDP 的 `Input.dispatchMouseEvent` 在**浏览器引擎层面**注入输入事件，和真实鼠标硬件事件走的是同一条处理管线：

```
真实鼠标 → OS → Chromium Input Pipeline → 生成 isTrusted=true 的事件
CDP 注入  →      Chromium Input Pipeline → 生成 isTrusted=true 的事件
JS 脚本   →      DOM API                 → 生成 isTrusted=false 的事件
```

CDP 绕过了 DOM API 层，直接在 Chromium 的 input pipeline 中注入事件，所以产生的事件 `isTrusted === true`。

### 实现代码（main.js 中的 `native-click` handler）

```javascript
ipcMain.handle('native-click', async (event, x, y) => {
  const webContents = event.sender;
  const xi = Math.round(x);
  const yi = Math.round(y);

  const dbg = webContents.debugger;
  try { dbg.attach('1.3'); } catch (e) { /* 可能已 attach */ }

  // 1. 移动鼠标到目标位置（触发 hover 状态等）
  await dbg.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: xi, y: yi
  });

  // 2. 按下鼠标左键
  await dbg.sendCommand('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: xi, y: yi, button: 'left', clickCount: 1
  });

  // 3. 释放鼠标左键
  await dbg.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: xi, y: yi, button: 'left', clickCount: 1
  });

  try { dbg.detach(); } catch (e) { /* ignore */ }
  return { success: true, x: xi, y: yi };
});
```

### 为什么需要三步

完整模拟一次真实点击的三个阶段：

1. **`mouseMoved`** — 鼠标移动到目标位置，触发 `mouseenter`、`mouseover`、`hover` 等状态
2. **`mousePressed`** — 鼠标按下，触发 `mousedown` 事件
3. **`mouseReleased`** — 鼠标释放，触发 `mouseup` + `click` 事件

如果跳过 `mouseMoved`，某些框架可能检测到"鼠标从未移动到该元素上"而不响应点击。

### 在注入脚本中调用

```javascript
// 注入脚本中通过 preload 暴露的 API 调用
const result = await window.browserAPI.nativeClick(x, y);
// result: { success: true, x: 100, y: 200 }
```

## 方案对比总结

| 方案 | `isTrusted` | 可靠性 | 适用场景 |
|------|:-----------:|:------:|---------|
| `element.click()` | `false` | 低 | 简单 HTML 元素，无信任检查时 |
| `new MouseEvent()` + `dispatchEvent()` | `false` | 低 | 同上 |
| CDP `Input.dispatchMouseEvent` | **`true`** | **高** | Vue/React 组件、有信任检查的平台页面 |

## 注意事项

1. **坐标精度**：传入的 `x`, `y` 需要是相对于 viewport 的精确坐标，可通过 `element.getBoundingClientRect()` 获取
2. **Debugger 生命周期**：`attach` 和 `detach` 需要成对调用，代码中用 try-catch 处理已 attach 的情况
3. **CDP 协议版本**：使用 `'1.3'` 版本，是 Chromium 支持的稳定版本
4. **性能**：CDP 调用是异步的，比直接 JS 调用稍慢，但对自动化场景影响不大
