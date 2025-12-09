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
async function uploadVideo(dataObj) {
    const pathImage = dataObj?.video?.video?.url;
    if (!pathImage) {
        //alert('No video URL found');
        return;
    }
    const response = await fetch(pathImage);
    if (!response.ok) {
        throw new Error('HTTP error! status: ' + response.status);
    }
    const blob = await response.blob();

    // 获取真实的 MIME 类型
    const contentType = response.headers.get('Content-Type') || blob.type || 'video/mp4';

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
    const uploadInput = await waitForElement('input[type="file"]', 15000);

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

// 检测上传进度是否完成
async function waitForUploadComplete(timeout = 120000) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const checkInterval = 500; // 每500ms检查一次

        function checkProgress() {
            try {
                // 检查进度条元素是否存在
                const progressBg = document.querySelector('.ant-progress-bg');

                if (!progressBg) {
                    // 如果进度条不存在，可能已经上传完成或还未开始
                    // 再检查一下是否有其他上传中的标识
                    const uploadingIndicator = document.querySelector('.ant-progress');
                    if (!uploadingIndicator) {
                        // 没有进度条元素，认为上传已完成
                        // alert('✅ No progress bar found, upload likely complete');
                        resolve(true);
                        return;
                    }
                } else {
                    // 进度条存在，检查宽度
                    const style = window.getComputedStyle(progressBg);
                    const width = style.width;
                    const widthPercent = parseFloat(width);
                    const parentWidth = parseFloat(window.getComputedStyle(progressBg.parentElement).width);
                    const percentage = (widthPercent / parentWidth) * 100;

                    // alert(`Upload progress: ${percentage.toFixed(2)}%`);

                    // 检查是否达到100%
                    if (percentage >= 99.9) {
                        // alert('✅ Upload complete (100%)');
                        resolve(true);
                        return;
                    }
                }

                // 检查是否超时
                if (Date.now() - startTime > timeout) {
                    reject(new Error('Upload timeout'));
                    return;
                }

                // 继续检查
                setTimeout(checkProgress, checkInterval);
            } catch (error) {
                reject(error);
            }
        }

        checkProgress();
    });
}
