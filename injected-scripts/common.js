// 等待元素出现的通用函数
function waitForElement(selector, timeout = 30000, checkInterval = 200) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        let timeoutId;

        function check() {
            try {
                let el;
                if (typeof selector === "string") {
                    el = document.querySelector(selector);
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
