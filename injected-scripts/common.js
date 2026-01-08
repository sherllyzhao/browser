// ===========================
// common.js - 公共工具库
// ===========================
// 防止重复加载（检查关键函数是否已存在）

if (typeof window.uploadVideo === 'function' &&
    typeof window.waitForElement === 'function' &&
    typeof window.setNativeValue === 'function') {
    console.log('[common.js] ⚠️ common.js 已加载，跳过重复定义');
    console.log('[common.js] 当前窗口:', window.location.href);
} else {

console.log('[common.js] ✅ common.js 开始加载...');
console.log('[common.js] 当前窗口:', window.location.href);

// 标记为已加载
window.__COMMON_JS_LOADED__ = true;

// ===========================
// 页面状态检查 - 防止异常渲染
// ===========================
window.checkPageState = function(scriptName = '脚本') {
  // 检查 body 是否存在
  if (!document.body) {
    console.error(`[${scriptName}] ❌ 页面异常：document.body 不存在`);
    return false;
  }

  // 检查页面内容是否异常（CSS代码被当作文本显示）
  const bodyText = document.body.innerText || '';

  // 如果页面内容包含大量CSS选择器特征，说明渲染异常
  // 使用通用的CSS语法特征，不依赖特定框架类名
  const cssPatterns = [
    // 通用CSS属性（任何网站都会有）
    'text-decoration:none',
    'background-color:transparent',
    'background-color:rgba(',
    'cursor:pointer',
    'border-radius:',
    'font-size:',
    'line-height:',
    'padding:',
    'margin:',
    'display:block',
    'display:flex',
    'position:absolute',
    'position:relative',
    // CSS选择器语法特征
    '.where(',
    ':hover{',
    ':focus{',
    '::before{',
    '::after{',
    '@media ',
    // 常见框架类名前缀（覆盖多个框架）
    '.ant-',      // Ant Design
    '.semi-',     // Semi Design
    '.el-',       // Element UI
    '.van-',      // Vant
    '.arco-',     // Arco Design
    '.weui-',     // WeUI
    '.css-'       // CSS Modules 生成的类名
  ];

  let cssMatchCount = 0;
  for (const pattern of cssPatterns) {
    if (bodyText.includes(pattern)) {
      cssMatchCount++;
    }
  }

  // 如果匹配了3个以上CSS特征，认为页面渲染异常
  if (cssMatchCount >= 3) {
    console.error(`[${scriptName}] ❌ 检测到页面渲染异常（CSS代码被当作文本显示）`);
    console.error(`[${scriptName}] 匹配的CSS特征数量:`, cssMatchCount);
    return false;
  }

  return true;
};

// 隐藏页面内容并显示加载遮罩（纯CSS loading动画）
window.hidePageAndShowMask = function() {
  // 隐藏 body 内容
  if (document.body) {
    document.body.style.visibility = 'hidden';
    document.body.style.opacity = '0';
  }

  // 添加白色遮罩层 + loading动画
  if (!document.getElementById('__page_loading_mask__')) {
    const mask = document.createElement('div');
    mask.id = '__page_loading_mask__';
    mask.innerHTML = `
      <style>
        @keyframes __loading_spin__ {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
      <div style="width:40px;height:40px;border:3px solid #f3f3f3;border-top:3px solid #3498db;border-radius:50%;animation:__loading_spin__ 1s linear infinite;"></div>
    `;
    mask.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#fff;z-index:999999;display:flex;align-items:center;justify-content:center;';
    document.documentElement.appendChild(mask);
  }
};

// 页面状态检查并自动刷新（检测到异常时先隐藏页面）
window.checkPageStateAndReload = function(scriptName = '脚本', reloadDelay = 2000) {
  if (!window.checkPageState(scriptName)) {
    // 立即隐藏页面内容，显示loading动画
    window.hidePageAndShowMask();

    console.error(`[${scriptName}] ❌ 页面状态异常，${reloadDelay/1000}秒后刷新页面...`);
    setTimeout(() => {
      window.location.reload();
    }, reloadDelay);
    return false;
  }
  return true;
};

// 等待元素出现的通用函数
window.waitForElement = function(selector, timeout = 30000, checkInterval = 200, ele = document) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        let timeoutId;

        function check() {
            try {
                let el;
                if (typeof selector === "string") {
                    el = ele.querySelector(selector);
                } else if (typeof selector === "function") {
                    // 如果是函数，调用它获取元素
                    el = selector();
                } else {
                    // 否则直接使用（可能已经是元素了）
                    el = selector;
                }

                if (el) {
                    clearTimeout(timeoutId);
                    resolve(el);
                    return;
                }

                if (Date.now() - startTime > timeout) {
                    clearTimeout(timeoutId);
                    reject(new Error(`找不到元素: ${selector}`));
                    return;
                }

                timeoutId = setTimeout(check, checkInterval);
            } catch (error) {
                clearTimeout(timeoutId);
                reject(error);
            }
        }

        check();
    });
};

// 重试机制
window.retryOperation = async function(operation, maxRetries = 3, delay = 1000) {
    // alert(`Starting operation with ${maxRetries} maximum retries`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // alert(`=== ATTEMPT ${attempt}/${maxRetries} ===
        // Executing operation...`);

        try {
            const result = await operation();
            // alert(`✅ ATTEMPT ${attempt} SUCCESS!
            // Operation completed successfully`);
            return result;
        } catch (error) {
            // alert(`❌ ATTEMPT ${attempt} FAILED
            // Error: ${error.message}`);

            if (attempt === maxRetries) {
                // alert(`❌ MAX RETRIES REACHED
                // Failed after ${maxRetries} attempts`);
                throw error;
            }

            const waitTime = delay * attempt;
            // alert(`🔄 RETRYING... (${attempt}/${maxRetries})
            // Waiting ${waitTime}ms before next attempt`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
};

// 发送消息到父窗口
window.sendMessageToParent = function(message) {
    console.log('[sendMessageToParent] 发送消息到父窗口:', message);

    // 使用 browserAPI (运营助手浏览器)
    if (window.browserAPI?.sendToHome) {
        try {
            window.browserAPI.sendToHome(message);
            console.log('[sendMessageToParent] ✅ 已通过 browserAPI.sendToHome 发送');
            return true;
        } catch (e) {
            console.error('[sendMessageToParent] ❌ browserAPI.sendToHome 失败:', e);
        }
    } else {
        console.warn('[sendMessageToParent] ⚠️ browserAPI.sendToHome 不可用');
    }

    return false;
};

// 安全地上传文件到input元素
window.uploadFileToInput = async function(inputElement, file) {
    if (!inputElement || !file) {
        //alert('Upload failed: Invalid input element or file');
        return false;
    }

    try {
        // 方法1: 使用DataTransfer API
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        inputElement.files = dataTransfer.files;

        // 方法2: 尝试触发change事件
        if (typeof inputElement.dispatchEvent === 'function') {
            const changeEvent = new Event("change", { bubbles: true });
            inputElement.dispatchEvent(changeEvent);
        }

        // 方法3: 尝试触发input事件
        if (typeof inputElement.dispatchEvent === 'function') {
            const inputEvent = new Event("input", { bubbles: true });
            inputElement.dispatchEvent(inputEvent);
        }

        return true;

    } catch (error) {
        //alert('File upload failed: ' + error.message);
        return false;
    }
};

// 通用文件下载函数（绕过跨域限制）
window.downloadFile = async function(url, defaultType = 'application/octet-stream') {
    if (!url) {
        throw new Error('Download URL is required');
    }

    console.log('[downloadFile] 开始下载:', url);

    let blob;
    let contentType = defaultType;

    // 优先使用主进程下载（绕过跨域限制）
    if (window.browserAPI?.downloadVideo) {
        console.log('[downloadFile] 使用主进程下载...');
        const result = await window.browserAPI.downloadVideo(url);

        if (!result.success) {
            throw new Error('Download failed: ' + result.error);
        }

        // 将 base64 转换为 Blob
        const binaryString = atob(result.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        blob = new Blob([bytes], { type: result.contentType });
        contentType = result.contentType;
        console.log('[downloadFile] 主进程下载成功，大小:', result.size, 'bytes, 类型:', contentType);
    } else {
        // 回退到 fetch（可能有跨域问题）
        console.log('[downloadFile] browserAPI.downloadVideo 不可用，使用 fetch...');
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('HTTP error! status: ' + response.status);
        }
        blob = await response.blob();
        contentType = response.headers.get('Content-Type') || blob.type || defaultType;
    }

    return { blob, contentType };
};

// 上传视频到input元素
window.uploadVideo = async function(dataObj, shadowRoot = undefined) {
    const pathImage = dataObj?.video?.video?.url;
    console.log("🚀 ~ uploadVideo ~ pathImage: ", pathImage);
    if (!pathImage) {
        //alert('No video URL found');
        return;
    }

    console.log('[uploadVideo] 开始下载视频:', pathImage);

    let blob;
    let contentType = 'video/mp4';

    // 优先使用主进程下载（绕过跨域限制）
    if (window.browserAPI?.downloadVideo) {
        console.log('[uploadVideo] 使用主进程下载...');
        const result = await window.browserAPI.downloadVideo(pathImage);

        if (!result.success) {
            throw new Error('Video download failed: ' + result.error);
        }

        // 将 base64 转换为 Blob
        const binaryString = atob(result.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        blob = new Blob([bytes], { type: result.contentType });
        contentType = result.contentType;
        console.log('[uploadVideo] 主进程下载成功，大小:', result.size, 'bytes');
    } else {
        // 回退到 fetch（可能有跨域问题）
        console.log('[uploadVideo] browserAPI.downloadVideo 不可用，使用 fetch...');
        const response = await fetch(pathImage);
        if (!response.ok) {
            throw new Error('HTTP error! status: ' + response.status);
        }
        blob = await response.blob();
        contentType = response.headers.get('Content-Type') || blob.type || 'video/mp4';
    }

    // 从 URL 或 Content-Type 中提取文件扩展名
    let extension = '.mp4'; // 默认扩展名
    if (pathImage.includes('.')) {
        const urlExt = pathImage.split('.').pop().split('?')[0].toLowerCase();
        if (['mp4', 'mov', 'avi', 'webm', 'mkv', 'flv'].includes(urlExt)) {
            extension = '.' + urlExt;
        }
    } else if (contentType.includes('mp4')) {
        extension = '.mp4';
    } else if (contentType.includes('webm')) {
        extension = '.webm';
    } else if (contentType.includes('quicktime')) {
        extension = '.mov';
    }

    // 构建文件名，确保有扩展名
    let fileName = dataObj?.video?.formData?.title || 'video';
    if (!fileName.toLowerCase().endsWith(extension.toLowerCase())) {
        fileName = fileName + extension;
    }

    const file = new File([blob], fileName, {type: contentType});

    // 等待上传按钮
    //alert('Looking for upload input...');
    let uploadInput;
    if (!shadowRoot) {
        // alert('wujie-app has no shadow root, trying to access iframe directly');
        // 如果没有Shadow DOM，尝试直接查找iframe
        uploadInput = await waitForElement('input[type="file"]', 3000);
    } else {
        // 深入Shadow DOM查找
        uploadInput = await deepShadowSearch(shadowRoot, 'input[type="file"]', 3);
    }

    // 执行文件上传
    //alert('Uploading file: ' + file.name);
    await uploadFileToInput(uploadInput, file);

    // 等待上传完成并填写表单
    await new Promise(resolve => setTimeout(resolve, 3000));
};

/* 给react的input、checkbox、radio赋值 */
window.setNativeValue = function(el, value) {
    if (!el) return false;

    const previousValue = el.value;

    if (el.type === "checkbox" || el.type === "radio") {
        if ((!!value && !el.checked) || (!!!value && el.checked)) {
            el.click();
        }
    } else {
        el.value = value;
    }

    const tracker = el._valueTracker;
    if (tracker) {
        tracker.setValue(previousValue);
    }

    // 'change' instead of 'input', see https://github.com/facebook/react/issues/11488#issuecomment-381590324
    try {
        // 安全地触发事件 - 完整的事件序列
        if (typeof el.dispatchEvent === 'function') {
            // 先触发input事件
            el.dispatchEvent(new InputEvent("input", {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: value
            }));
            // 再触发change事件
            el.dispatchEvent(new Event("change", { bubbles: true }));
            // 最后触发blur确保React更新
            el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
        } else if (typeof el.onchange === 'function') {
            el.onchange(new Event("change"));
        } else {
            // 如果所有方法都不可用，尝试其他事件
            if (typeof el.dispatchEvent === 'function') {
                el.dispatchEvent(new Event("input", { bubbles: true }));
            } else if (typeof el.oninput === 'function') {
                el.oninput(new Event("input"));
            }
        }
        return true;
    } catch (error) {
        // alert('setNativeValue error: ' + error.message);
        return false;
    }
};

// 等待Shadow DOM中的元素
window.waitForShadowElement = function(hostSelector, shadowSelector, timeout = 30000) {
    return window.waitForElement(hostSelector, timeout).then(host => {
        if (!host.shadowRoot) {
            throw new Error(`Host element has no shadow root: ${hostSelector}`);
        }
        return window.waitForElement(() => host.shadowRoot.querySelector(shadowSelector), timeout);
    });
};

// 深度搜索Shadow DOM中的元素（修复版 - 防止白屏）
window.deepShadowSearch = function(rootElement, selector, maxDepth = 3) {
    return new Promise((resolve, reject) => {
        let resolved = false; // 防止多次 resolve

        function searchInShadow(element, depth) {
            // 已经找到了，直接返回
            if (resolved) {
                return;
            }

            // 超过最大深度
            if (depth > maxDepth) {
                return;
            }

            // 在当前元素中查找
            try {
                const found = element.querySelector(selector);
                if (found && !resolved) {
                    resolved = true;
                    resolve(found);
                    return;
                }
            } catch (error) {
                // querySelector 可能在某些情况下失败，继续搜索
            }

            // 查找Shadow DOM
            if (element.shadowRoot && !resolved) {
                searchInShadow(element.shadowRoot, depth + 1);
            }

            // 查找iframe
            if (!resolved) {
                const iframes = element.querySelectorAll('iframe');
                for (const iframe of iframes) {
                    if (resolved) break; // 已找到，退出循环
                    try {
                        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                        if (iframeDoc) {
                            searchInShadow(iframeDoc, depth + 1);
                        }
                    } catch (error) {
                        // 跨域iframe无法访问，跳过
                    }
                }
            }

            // 递归查找子元素中的 Shadow DOM（不递归普通子元素，避免爆炸）
            if (!resolved && depth < maxDepth) {
                const children = element.children || [];
                for (const child of children) {
                    if (resolved) break; // 已找到，退出循环
                    if (child.nodeType === Node.ELEMENT_NODE && child.shadowRoot) {
                        searchInShadow(child, depth + 1);
                    }
                }
            }
        }

        searchInShadow(rootElement, 0);

        // 如果一直没找到，延迟 reject（给递归一点时间）
        setTimeout(() => {
            if (!resolved) {
                reject(new Error(`找不到元素: ${selector}`));
            }
        }, 100);
    });
};

// ===========================
// 公共发布方法
// ===========================

// 根据环境获取 API 域名
window.getApiDomain = function() {
    // 生产环境使用 api.china9.cn，开发环境使用 apidev.china9.cn
    const isProduction = window.browserAPI?.isProduction;
    return isProduction ? 'https://api.china9.cn' : 'https://apidev.china9.cn';
};

// 根据主窗口域名获取统计接口 URL
window.getStatisticsUrl = async function(isError = false) {
    const endpoint = isError ? 'tjlogerror' : 'tjlog';
    const apiDomain = window.getApiDomain();

    // 特殊域名映射（覆盖默认逻辑）
    const specialUrlMap = {
        'jzt_dev_1.china9.cn': `https://jzt_dev_1.china9.cn/api/geo/${endpoint}`,
        'zhjzt.china9.cn': `https://zhjzt.china9.cn/api/geo/${endpoint}`,
        '172.16.6.17:8080': `https://jzt_dev_1.china9.cn/api/geo/${endpoint}`,
        'localhost:8080': `https://jzt_dev_1.china9.cn/api/geo/${endpoint}`,
    };

    let url = `${apiDomain}/api/mediaauth/${endpoint}`; // 默认值（根据环境自动选择）
    try {
        if (window.browserAPI && window.browserAPI.getMainUrl) {
            const mainInfo = await window.browserAPI.getMainUrl();
            // 检查是否有特殊映射
            if (mainInfo.success && specialUrlMap[mainInfo.host]) {
                url = specialUrlMap[mainInfo.host];
            }
            // localhost:5173 等其他情况使用默认值（根据 isProduction 判断）
        }
    } catch (e) {
        console.warn('[统计接口] 获取主窗口 URL 失败，使用默认地址:', e);
    }
    return url;
}

// 发送统计接口（发布成功时调用）
window.sendStatistics = async function(publishId, platform = '') {
    const scanData = { data: JSON.stringify({ id: publishId }) };
    try {
        console.log(`[${platform || '发布'}] 📤 发送成功统计接口，ID: ${publishId}`);
        const url = await getStatisticsUrl(false);
        console.log(`[${platform || '发布'}] 统计接口地址: ${url}`);
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(scanData),
        });
        console.log(`[${platform || '发布'}] ✅ 成功统计接口请求成功`);
        return { success: true, response };
    } catch (e) {
        console.error(`[${platform || '发布'}] ❌ 成功统计接口请求失败:`, e);
        return { success: false, error: e };
    }
};

// 发送错误统计接口（发布失败时调用）
window.sendStatisticsError = async function(publishId, statusText, platform = '') {
    const scanData = { data: JSON.stringify({ id: publishId, status_text: statusText }) };
    try {
        console.log(`[${platform || '发布'}] 📤 发送失败统计接口，ID: ${publishId}, 错误: ${statusText}`);
        const url = await getStatisticsUrl(true);
        console.log(`[${platform || '发布'}] 统计接口地址: ${url}`);
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(scanData),
        });
        console.log(`[${platform || '发布'}] ✅ 失败统计接口请求成功`);
        return { success: true, response };
    } catch (e) {
        console.error(`[${platform || '发布'}] ❌ 失败统计接口请求失败:`, e);
        return { success: false, error: e };
    }
};

// 带重试的点击按钮（改进版 - 等待按钮可用后再点击）
// defaultMessage: 当没有捕获到平台提示时返回的默认消息（用于小红书等跳页面代表成功的平台）
window.clickWithRetry = async function(element, maxRetries = 3, delay = 300, captureMessage = false, defaultMessage = '发布成功') {
    if (!element) {
        console.error('[clickWithRetry] 元素不存在');
        return { success: false, message: '元素不存在' };
    }

    for (let i = 0; i < maxRetries; i++) {
        // 检查按钮是否可点击
        if (element.offsetParent === null || element.disabled) {
            console.log(`[clickWithRetry] 第 ${i + 1}/${maxRetries} 次尝试：按钮不可用（hidden or disabled）`);
            if (i < maxRetries - 1) {
                console.log(`[clickWithRetry] 等待 ${delay}ms 后重试...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            } else {
                console.error('[clickWithRetry] ❌ 按钮始终不可用，所有重试失败');
                return { success: false, message: '按钮不可用' };
            }
        }

        // 尝试点击按钮
        try {
            console.log(`[clickWithRetry] 第 ${i + 1}/${maxRetries} 次点击按钮`);

            // 如果需要捕获提示信息，设置监听器
            let capturedMessage = '';
            let messageObserver = null;
            const allMessages = []; // 收集所有捕获的消息

            if (captureMessage) {
                console.log("🚀 ~ clickWithRetry ~ captureMessage: ", captureMessage);
                // 需要忽略的中间状态消息
                const ignoredMessages = ['正在发布', '正在提交', '正在上传', '加载中', '处理中'];

                // 创建 MutationObserver 监听页面新增的提示元素
                messageObserver = new MutationObserver((mutations) => {
                    for (const mutation of mutations) {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType === 1) { // Element node
                                // 检查是否是提示元素（常见的提示组件）
                                const element = node;
                                const classList = element.classList ? Array.from(element.classList).join(' ') : '';
                                const className = element.className || '';

                                // 匹配常见的提示类名
                                if (
                                    classList.includes('toast') ||
                                    classList.includes('message') ||
                                    classList.includes('notification') ||
                                    classList.includes('ant-message') ||
                                    classList.includes('el-message') ||
                                    classList.includes('van-toast') ||
                                    classList.includes('semi-toast') ||
                                    classList.includes('weui-toast') ||
                                    classList.includes('cheetah-message') ||  // 百家号
                                    className.includes('toast') ||
                                    className.includes('message') ||
                                    className.includes('cheetah-message')  // 百家号
                                ) {
                                    // 优先查找具体的文本容器（更精确）
                                    let text = '';

                                    // Semi Design toast
                                    const semiText = element.querySelector('.semi-toast-content-text');
                                    if (semiText) {
                                        text = semiText.textContent || semiText.innerText || '';
                                    }

                                    // Ant Design message
                                    if (!text) {
                                        const antText = element.querySelector('.ant-message-custom-content');
                                        if (antText) {
                                            text = antText.textContent || antText.innerText || '';
                                        }
                                    }

                                    // Element UI message
                                    if (!text) {
                                        const elText = element.querySelector('.el-message__content');
                                        if (elText) {
                                            text = elText.textContent || elText.innerText || '';
                                        }
                                    }

                                    // 百家号 Cheetah UI message（注意：第一个span是图标，第二个span是文本）
                                    if (!text) {
                                        const cheetahText = element.querySelector('.cheetah-message-error span:last-child') ||
                                                           element.querySelector('.cheetah-message-custom-content span:last-child');
                                        if (cheetahText) {
                                            text = cheetahText.textContent || cheetahText.innerText || '';
                                        }
                                    }

                                    // 回退：使用整个元素的文本
                                    if (!text) {
                                        text = element.textContent || element.innerText || '';
                                    }

                                    if (text.trim()) {
                                        allMessages.push(text.trim());
                                    }
                                }

                                // 递归检查子元素（查找所有可能的 toast 容器）
                                const toastElements = element.querySelectorAll('[class*="toast"], [class*="message"], [class*="notification"], [class*="cheetah-message"]');
                                for (const toast of toastElements) {
                                    // 优先查找具体的文本容器
                                    let text = '';

                                    // 百家号 Cheetah UI（优先检查，因为结构特殊）
                                    const cheetahText = toast.querySelector('.cheetah-message-error span:last-child') ||
                                                       toast.querySelector('.cheetah-message-custom-content span:last-child');
                                    if (cheetahText) {
                                        text = cheetahText.textContent || cheetahText.innerText || '';
                                    }

                                    // Semi Design toast
                                    if (!text) {
                                        const semiText = toast.querySelector('.semi-toast-content-text');
                                        if (semiText) {
                                            text = semiText.textContent || semiText.innerText || '';
                                        }
                                    }

                                    // 回退：使用整个元素的文本
                                    if (!text) {
                                        text = toast.textContent || toast.innerText || '';
                                    }

                                    if (text.trim()) {
                                        allMessages.push(text.trim());
                                    }
                                }
                            }
                        }
                    }
                });

                // 开始监听整个 body 的变化
                messageObserver.observe(document.body, {
                    childList: true,
                    subtree: true
                });
            }

            // 点击按钮
            if (typeof element.click === 'function') {
                element.click();
            } else {
                // 如果 click 方法不可用，使用事件
                element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            }

            console.log('[clickWithRetry] ✅ 点击成功');

            // 如果需要捕获提示信息，等待提示出现
            if (captureMessage) {
                console.log('[clickWithRetry] ⏳ 等待提示信息出现（3秒）...');
                await new Promise(resolve => setTimeout(resolve, 3000));

                // 停止监听
                if (messageObserver) {
                    messageObserver.disconnect();
                }

                // 从收集的消息中筛选最后一条有意义的消息（排除中间状态）
                const ignoredMessages = ['正在发布', '正在提交', '正在上传', '加载中', '处理中'];
                if (allMessages.length > 0) {
                    // 从后往前找第一条不是中间状态的消息
                    for (let j = allMessages.length - 1; j >= 0; j--) {
                        const msg = allMessages[j];
                        const isIgnored = ignoredMessages.some(ignored => msg.includes(ignored));
                        if (!isIgnored) {
                            capturedMessage = msg;
                            break;
                        }
                    }
                    // 如果所有消息都是中间状态，就取最后一条
                    if (!capturedMessage && allMessages.length > 0) {
                        capturedMessage = allMessages[allMessages.length - 1];
                    }
                    console.log('[clickWithRetry] 📨 最终捕获到提示信息:', capturedMessage);
                    console.log('[clickWithRetry] 📋 所有捕获的消息:', allMessages);
                }

                // 如果没有通过 MutationObserver 捕获到，尝试直接查找现有的提示元素
                if (!capturedMessage) {
                    const possibleSelectors = [
                        '.cheetah-message-custom-content.cheetah-message-error span:last-child',  // 百家号错误提示（优先，第一个span是图标）
                        '.cheetah-message-custom-content span:last-child',  // 百家号普通提示
                        '.d-toast-description',  // 小红书 toast
                        '.semi-toast-content-text',  // 抖音 toast
                        '.ant-message-custom-content',  // Ant Design
                        '.el-message__content',  // Element UI
                        '[class*="toast"]',
                        '[class*="message"]',
                        '[class*="notification"]',
                        '.ant-message',
                        '.el-message',
                        '.van-toast',
                        '.semi-toast',
                        '.weui-toast'
                    ];

                    for (const selector of possibleSelectors) {
                        try {
                            const elements = document.querySelectorAll(selector);
                            for (const el of elements) {
                                // 检查元素是否可见
                                if (el.offsetParent !== null) {
                                    const text = el.textContent || el.innerText || '';
                                    if (text.trim()) {
                                        capturedMessage = text.trim();
                                        console.log('[clickWithRetry] 📨 捕获到提示信息（现有元素）:', capturedMessage);
                                        break;
                                    }
                                }
                            }
                            if (capturedMessage) break;
                        } catch (e) {
                            // 忽略选择器错误
                        }
                    }
                }

                return {
                    success: true,
                    message: capturedMessage || defaultMessage
                };
            }

            return { success: true, message: '点击成功' };
        } catch (e) {
            console.error(`[clickWithRetry] 第 ${i + 1}/${maxRetries} 次点击失败:`, e.message);
            if (i < maxRetries - 1) {
                console.log(`[clickWithRetry] 等待 ${delay}ms 后重试...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    console.error('[clickWithRetry] ❌ 所有点击尝试均失败');
    return { success: false, message: '所有点击尝试均失败' };
};

// 发送成功消息并关闭窗口
// 🔑 增加默认延迟到 2500ms，确保消息有足够时间到达 Vue 应用
window.closeWindowWithMessage = async function(message = '发布成功，刷新数据', delay = 2500) {
    console.log(`[closeWindow] 发送消息: ${message}`);
    window.sendMessageToParent(message);

    // 🔑 额外等待 500ms 确保 IPC 消息已发送到主进程
    await new Promise(resolve => setTimeout(resolve, 500));

    if (delay > 0) {
        console.log(`[closeWindow] 等待 ${delay}ms 确保消息到达...`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    // 开发环境下跳过关闭窗口，方便测试
    if (!window.browserAPI.isProduction) {
        console.log('[closeWindow] ⚠️ 开发环境，跳过关闭窗口');
        return true;
    }

    try {
        console.log('[closeWindow] 尝试关闭窗口...');
        await window.browserAPI.closeCurrentWindow();
        console.log('[closeWindow] ✅ 窗口已关闭');
        return true;
    } catch (e) {
        console.error('[closeWindow] ❌ 关闭窗口失败:', e);
        return false;
    }
};

// 延迟执行（Promise 包装的 setTimeout）
window.delay = function(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
};

console.log('[common.js] ✅ common.js 加载完成');
console.log('[common.js] 已定义函数: waitForElement, retryOperation, sendMessageToParent, uploadFileToInput, downloadFile, uploadVideo, setNativeValue, waitForShadowElement, deepShadowSearch, sendStatistics, clickWithRetry, closeWindowWithMessage, delay');

} // 结束 if-else 块，所有函数在 else 块内定义

// 定义全局别名，确保向后兼容
if (typeof waitForElement === 'undefined') window.waitForElement && (waitForElement = window.waitForElement);
if (typeof retryOperation === 'undefined') window.retryOperation && (retryOperation = window.retryOperation);
if (typeof sendMessageToParent === 'undefined') window.sendMessageToParent && (sendMessageToParent = window.sendMessageToParent);
if (typeof uploadFileToInput === 'undefined') window.uploadFileToInput && (uploadFileToInput = window.uploadFileToInput);
if (typeof downloadFile === 'undefined') window.downloadFile && (downloadFile = window.downloadFile);
if (typeof uploadVideo === 'undefined') window.uploadVideo && (uploadVideo = window.uploadVideo);
if (typeof setNativeValue === 'undefined') window.setNativeValue && (setNativeValue = window.setNativeValue);
if (typeof waitForShadowElement === 'undefined') window.waitForShadowElement && (waitForShadowElement = window.waitForShadowElement);
if (typeof deepShadowSearch === 'undefined') window.deepShadowSearch && (deepShadowSearch = window.deepShadowSearch);
if (typeof sendStatistics === 'undefined') window.sendStatistics && (sendStatistics = window.sendStatistics);
if (typeof sendStatisticsError === 'undefined') window.sendStatisticsError && (sendStatisticsError = window.sendStatisticsError);
if (typeof getStatisticsUrl === 'undefined') window.getStatisticsUrl && (getStatisticsUrl = window.getStatisticsUrl);
if (typeof clickWithRetry === 'undefined') window.clickWithRetry && (clickWithRetry = window.clickWithRetry);
if (typeof closeWindowWithMessage === 'undefined') window.closeWindowWithMessage && (closeWindowWithMessage = window.closeWindowWithMessage);
if (typeof delay === 'undefined') window.delay && (delay = window.delay);

// ===========================
// 前端拦截自定义协议（如 bitbrowser://）
// ===========================
(function() {
  // 阻止的协议列表
  const blockedProtocols = ['bitbrowser:', 'mqqwpa:', 'weixin:', 'alipays:', 'tbopen:'];

  // 检查 URL 是否是被阻止的协议
  function isBlockedProtocol(url) {
    if (!url || typeof url !== 'string') return false;
    const lowerUrl = url.toLowerCase();
    return blockedProtocols.some(protocol => lowerUrl.startsWith(protocol));
  }

  // 拦截链接点击
  document.addEventListener('click', function(e) {
    const target = e.target.closest('a');
    if (target && target.href && isBlockedProtocol(target.href)) {
      console.log('[ProtocolBlock] ❌ 阻止链接点击:', target.href);
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }, true);

  // 拦截 window.open
  const originalWindowOpen = window.open;
  window.open = function(url, ...args) {
    if (isBlockedProtocol(url)) {
      console.log('[ProtocolBlock] ❌ 阻止 window.open:', url);
      return null;
    }
    return originalWindowOpen.call(window, url, ...args);
  };

  // 拦截 location.assign
  const originalAssign = window.location.assign;
  if (originalAssign) {
    window.location.assign = function(url) {
      if (isBlockedProtocol(url)) {
        console.log('[ProtocolBlock] ❌ 阻止 location.assign:', url);
        return;
      }
      return originalAssign.call(window.location, url);
    };
  }

  // 拦截 location.replace
  const originalReplace = window.location.replace;
  if (originalReplace) {
    window.location.replace = function(url) {
      if (isBlockedProtocol(url)) {
        console.log('[ProtocolBlock] ❌ 阻止 location.replace:', url);
        return;
      }
      return originalReplace.call(window.location, url);
    };
  }

  // 拦截 location.href 设置（通过 defineProperty）
  try {
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    if (locationDescriptor && locationDescriptor.set) {
      // 无法直接覆盖 location，尝试通过 MutationObserver 监控 iframe
    }
  } catch (e) {
    // 忽略错误
  }

  console.log('[ProtocolBlock] ✅ 前端协议拦截已启用');
})();
