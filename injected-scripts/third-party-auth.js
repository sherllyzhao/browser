/**
 * 第三方授权页面注入脚本
 * 适用于抖音、快手等第三方平台的授权页面
 *
 * 使用方法：
 * 1. 在运营助手浏览器的脚本管理中，为授权页面 URL 配置此脚本
 * 2. 例如：https://open.douyin.com/platform/oauth/* -> douyin-auth.js
 */

(function() {
  'use strict';

  // ===========================
  // 页面状态检查 - 防止异常渲染
  // ===========================
  if (typeof window.checkPageStateAndReload === 'function') {
    if (!window.checkPageStateAndReload('第三方授权')) {
      return;
    }
  }

  console.log('[第三方授权] 脚本已加载');
  console.log('[第三方授权] 当前 URL:', window.location.href);

  // ===========================
  // 1. 获取传递的数据
  // ===========================

  const urlParams = new URLSearchParams(window.location.search);
  const companyId = urlParams.get('company_id');
  const transferId = urlParams.get('transfer_id');

  if (companyId) {
    console.log('[第三方授权] 接收到 Company ID:', companyId);
    window.__COMPANY_ID__ = companyId;
  }

  if (transferId) {
    console.log('[第三方授权] 接收到 Transfer ID:', transferId);
    window.__TRANSFER_ID__ = transferId;
  }

  // ===========================
  // 2. 存储到 sessionStorage（方便授权回调页面获取）
  // ===========================

  if (companyId) {
    sessionStorage.setItem('auth_company_id', companyId);
  }

  if (transferId) {
    sessionStorage.setItem('auth_transfer_id', transferId);
  }

  // ===========================
  // 3. 监听授权成功（根据具体平台调整）
  // ===========================

  /**
   * 抖音授权成功检测
   * 当 URL 包含 code 参数时，表示授权成功
   */
  function checkDouyinAuthSuccess() {
    const code = urlParams.get('code');
    const state = urlParams.get('state');

    if (code) {
      console.log('[抖音授权] 检测到授权码:', code);

      // 将授权码和 company_id 一起发送给后端
      sendAuthCodeToBackend({
        platform: 'douyin',
        code: code,
        state: state,
        company_id: companyId || window.__COMPANY_ID__
      });

      // 通知父窗口授权成功
      notifyParentWindow('授权成功');

      return true;
    }

    return false;
  }

  /**
   * 发送授权码到后端
   */
  async function sendAuthCodeToBackend(data) {
    try {
      console.log('[第三方授权] 正在发送授权数据到后端:', data);

      // 这里需要替换成你们实际的后端接口
      const response = await fetch('/api/short-video/auth/callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
      });

      const result = await response.json();
      console.log('[第三方授权] 后端响应:', result);

      if (result.success || result.code === 200) {
        console.log('[第三方授权] 授权成功');
        return true;
      } else {
        console.error('[第三方授权] 授权失败:', result.message);
        return false;
      }

    } catch (error) {
      console.error('[第三方授权] 发送授权数据失败:', error);
      return false;
    }
  }

  /**
   * 通知父窗口
   */
  function notifyParentWindow(message) {
    console.log('[第三方授权] 通知父窗口:', message);

    // 方式 1: window.opener
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage(message, '*');
        console.log('[第三方授权] 已通过 opener.postMessage 通知');
      } catch (e) {
        console.error('[第三方授权] postMessage 失败:', e);
      }
    }

    // 方式 2: browserAPI（如果在运营助手浏览器中）
    if (window.browserAPI?.sendToHome) {
      try {
        window.browserAPI.sendToHome(message);
        console.log('[第三方授权] 已通过 browserAPI 通知');
      } catch (e) {
        console.error('[第三方授权] browserAPI 通知失败:', e);
      }
    }
  }

  // ===========================
  // 4. 页面加载完成后执行检测
  // ===========================

  window.addEventListener('load', () => {
    console.log('[第三方授权] 页面加载完成，开始检测授权状态');

    // 延迟一下，确保页面完全加载
    setTimeout(() => {
      // 检测是否授权成功
      const isSuccess = checkDouyinAuthSuccess();

      if (isSuccess) {
        // 延迟 2 秒后关闭窗口
        setTimeout(() => {
          console.log('[第三方授权] 准备关闭窗口');
          window.close();
        }, 2000);
      }
    }, 500);
  });

  // ===========================
  // 5. 监听 URL 变化（单页应用）
  // ===========================

  // 监听 pushState 和 replaceState
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function() {
    originalPushState.apply(history, arguments);
    checkDouyinAuthSuccess();
  };

  history.replaceState = function() {
    originalReplaceState.apply(history, arguments);
    checkDouyinAuthSuccess();
  };

  // 监听 hashchange
  window.addEventListener('hashchange', () => {
    checkDouyinAuthSuccess();
  });

  // ===========================
  // 6. 暴露全局方法（供手动调用）
  // ===========================

  window.__AUTH_HELPER__ = {
    getCompanyId: () => companyId || sessionStorage.getItem('auth_company_id'),
    getTransferId: () => transferId || sessionStorage.getItem('auth_transfer_id'),
    notifySuccess: () => notifyParentWindow('授权成功'),
    sendAuthCode: sendAuthCodeToBackend
  };

  console.log('[第三方授权] 脚本初始化完成');
  console.log('[第三方授权] 全局方法已暴露: window.__AUTH_HELPER__');

})();
