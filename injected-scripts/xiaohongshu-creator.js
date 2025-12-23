/**
 * 小红书创作者平台授权脚本
 * 用于处理授权流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(async function () {
    'use strict';

    // ===========================
    // 防止脚本重复注入
    // ===========================
    if (window.__DOUYIN_SCRIPT_LOADED__) {
        console.log('[小红书授权] ⚠️ 脚本已经加载过，跳过重复注入');
        return;
    }

    // ===========================
    // 页面状态检查 - 防止异常渲染
    // ===========================
    if (typeof window.checkPageStateAndReload === 'function') {
        if (!window.checkPageStateAndReload('小红书授权')) {
            return;
        }
    }

    window.__DOUYIN_SCRIPT_LOADED__ = true;

    console.log('═══════════════════════════════════════');
    console.log('✅ 小红书授权脚本已注入');
    console.log('📍 当前 URL:', window.location.href);
    console.log('🕐 注入时间:', new Date().toLocaleString());
    console.log('═══════════════════════════════════════');

    // 检查 common.js 是否已加载
    if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
        console.error('[小红书授权] ❌ common.js 未加载！脚本可能无法正常工作');
    } else {
        console.log('[小红书授权] ✅ common.js 已加载，工具函数可用');
    }

    // ===========================
    // 1. 从 URL 获取授权数据
    // ===========================

    const urlParams = new URLSearchParams(window.location.search);
    const companyId = await window.browserAPI.getGlobalData('company_id');
    const transferId = urlParams.get('transfer_id');

    console.log('[小红书授权] URL 参数:', {
        companyId,
        transferId
    });

    // 存储授权数据到全局
    window.__AUTH_DATA__ = {
        companyId,
        transferId,
        timestamp: Date.now()
    };

    // ===========================
    // 2. 发送消息到父窗口的辅助函数（使用 common.js）
    // ===========================

    // ===========================
    // 3. 暴露全局方法供手动调用
    // ===========================

    window.__DOUYIN_AUTH__ = {
        // 发送授权成功消息
        notifySuccess: () => {
            sendMessageToParent('授权成功');
        },

        // 发送自定义消息
        sendMessage: (message) => {
            sendMessageToParent(message);
        },

        // 获取授权数据
        getAuthData: () => window.__AUTH_DATA__,
    };

    // ===========================
    // 4. 显示调试信息横幅
    // ===========================

    // ===========================
    // 5. 接收来自父窗口的消息（必须在发送 页面加载完成 之前注册！）
    // ===========================
    console.log('[小红书授权] 注册消息监听器...');

    // 防重复标志：确保数据只处理一次
    let isProcessing = false;
    let hasProcessed = false;

    // 防重复检查
    if (isProcessing) {
        console.warn('[小红书授权] ⚠️ 正在处理中，忽略重复消息');
        return;
    }
    if (hasProcessed) {
        console.warn('[小红书授权] ⚠️ 已经处理过，忽略重复消息');
        return;
    }

    // 标记为正在处理
    isProcessing = true;

    // 更新全局变量
    if (message.data) {
        window.__AUTH_DATA__ = {
            ...window.__AUTH_DATA__,
            message: JSON.parse(message.data),
            receivedAt: Date.now()
        };
        console.log('[小红书授权] ✅ 授权数据已更新:', window.__AUTH_DATA__);
        const messageData = JSON.parse(message.data);
        console.log("🚀 ~  ~ messageData: ", messageData);

        // 等待页面元素加载完成
        await waitForElement('.account-name', 15000);

        // 检查昵称元素是否有内容
        const titleEle = document.querySelector('.account-name');
        if (!titleEle || !titleEle.innerText) {
            // alert('Account name element not ready, waiting...');
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // 收集用户信息
        const accountNameEle = await waitForElement('.account-name', 5000);
        const avatarEle = await waitForElement('.avatar img', 5000);
        const followerCountEle = await waitForElement('.static.description-text >div:nth-of-type(2) .numerical', 5000);
        const favoritingCountEle = await waitForElement('.static.description-text >div:nth-of-type(1) .numerical', 5000);
        const totalFavoritedEle = await waitForElement('.static.description-text >div:nth-of-type(3) .numerical', 5000);
        const uidEle = await waitForElement('.others.description-text > div:nth-of-type(1)', 5000);

        const scanData = {
            data: JSON.stringify({
                nickname: accountNameEle.innerText,
                avatar: avatarEle.getAttribute('src'),
                follower_count: followerCountEle.innerText,
                video: 0,
                uid: uidEle.innerText.replace('小红书账号: ', ''),
                favoriting_count: favoritingCountEle.innerText,
                total_favorited: totalFavoritedEle.innerText,
                company_id: await window.browserAPI.getGlobalData('company_id')
            })
        };

        console.log('[小红书授权] 📤 准备发送数据到接口...');
        // 发送数据到服务器
        const apiResponse = await fetch('https://apidev.china9.cn/api/mediaauth/xhsinfo', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(scanData)
        });

        // 检查响应状态
        if (!apiResponse.ok) {
            throw new Error(`Statistics API failed with status: ${apiResponse.status}`);
        }

        const apiResult = await apiResponse.json();
        console.log('[小红书授权] 📥 接口响应:', apiResult);

        if (apiResult && 'code' in apiResult && apiResult.code === 200) {
            console.log('[小红书授权] ✅ 数据发送成功');

            // 标记已完成（防止重复发送）
            hasProcessed = true;

            // API 成功后通知父页面刷新
            sendMessageToParent('授权成功，刷新数据');

            // 统计接口成功后关闭弹窗
            setTimeout(() => {
                window.browserAPI.closeCurrentWindow();
            }, 1000);

            // 检查是否有保存的发布页URL（从发布页跳转过来的）
            /* const savedPublishUrl = localStorage.getItem('XHS_PUBLISH_URL');

            if (savedPublishUrl) {
              console.log('[小红书授权] 🔄 检测到发布页URL，准备跳转:', savedPublishUrl);
              // 清除发布页URL标记（避免重复跳转）
              localStorage.removeItem('XHS_PUBLISH_URL');
              // 跳转回发布页（由发布页脚本的数据恢复功能接管）
              setTimeout(() => {
                window.location.href = savedPublishUrl;
              }, 1000);
            } else {
              console.log('[小红书授权] ℹ️ 没有发布页URL，关闭窗口');
              // 统计接口成功后关闭弹窗
              setTimeout(() => {
                window.browserAPI.closeCurrentWindow();
              }, 1000);
            } */
        } else {
            throw new Error(apiResult.msg || apiResult.message || 'Data collection failed');
        }
    }

    // 重置处理标志（无论成功或失败）
    isProcessing = false;
    console.log('[小红书授权] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);

    // ===========================
    // 6. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
    // ===========================

    // 页面加载完成后向父窗口发送消息
    console.log('[小红书授权] 页面加载完成，发送 页面加载完成 消息');
    sendMessageToParent('页面加载完成');

    console.log('═══════════════════════════════════════');
    console.log('✅ 小红书授权脚本初始化完成');
    console.log('📝 全局方法: window.__DOUYIN_AUTH__');
    console.log('  - notifySuccess()  : 发送授权成功消息');
    console.log('  - sendMessage(msg) : 发送自定义消息');
    console.log('  - getAuthData()    : 获取授权数据');
    console.log('  - sendAuthCode(code): 发送授权码');
    console.log('═══════════════════════════════════════');

})();

