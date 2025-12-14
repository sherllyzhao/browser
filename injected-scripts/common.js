// 等待元素出现的通用函数
function waitForElement(selector, timeout = 30000, checkInterval = 200, ele = document) {
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
                    reject(new Error(`Element not found: ${selector}`));
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
}

// 重试机制
async function retryOperation(operation, maxRetries = 3, delay = 1000) {
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
}

// 发送消息到父窗口
function sendMessageToParent(message) {
    console.log('发送消息到父窗口:', message);

    // 方式 2: 使用 browserAPI (运营助手浏览器)
    if (window.browserAPI?.sendToHome) {
        try {
            window.browserAPI.sendToHome(message);
            console.log('✅ 已通过 browserAPI.sendToHome 发送');
            return true;
        } catch (e) {
            console.error('❌ browserAPI.sendToHome 失败:', e);
        }
    } else {
        console.warn('⚠️ browserAPI 不可用');
    }

    return false;
}

// 安全地上传文件到input元素
async function uploadFileToInput(inputElement, file) {
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
}

// 上传视频到input元素
async function uploadVideo(dataObj, shadowRoot = undefined) {
    const pathImage = dataObj?.video?.video?.url;
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
}

/* 给react的input、checkbox、radio赋值 */
const setNativeValue = (el, value) => {
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
function waitForShadowElement(hostSelector, shadowSelector, timeout = 30000) {
    return waitForElement(hostSelector, timeout).then(host => {
        if (!host.shadowRoot) {
            throw new Error(`Host element has no shadow root: ${hostSelector}`);
        }
        return waitForElement(() => host.shadowRoot.querySelector(shadowSelector), timeout);
    });
}

// 深度搜索Shadow DOM中的元素
function deepShadowSearch(rootElement, selector, maxDepth = 3) {
    return new Promise((resolve, reject) => {
        function searchInShadow(element, depth) {
            if (depth > maxDepth) {
                reject(new Error(`Max shadow depth reached: ${maxDepth}`));
                return;
            }

            // 在当前元素中查找
            const found = element.querySelector(selector);
            if (found) {
                resolve(found);
                return;
            }

            // 查找Shadow DOM
            if (element.shadowRoot) {
                searchInShadow(element.shadowRoot, depth + 1);
            }

            // 查找iframe
            const iframes = element.querySelectorAll('iframe');
            for (const iframe of iframes) {
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                    if (iframeDoc) {
                        searchInShadow(iframeDoc, depth + 1);
                    }
                } catch (error) {
                    // 跨域iframe无法访问，跳过
                }
            }

            // 递归查找子元素
            const children = element.children || element.childNodes;
            for (const child of children) {
                if (child.nodeType === Node.ELEMENT_NODE) {
                    searchInShadow(child, depth + 1);
                }
            }

            reject(new Error(`Element not found: ${selector}`));
        }

        searchInShadow(rootElement, 0);
    });
}
