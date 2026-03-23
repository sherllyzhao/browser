/**
 * AI 发布运行时配置
 * 说明：
 * 1. default 为全平台默认配置
 * 2. platformOverrides 按平台覆盖默认配置
 */
(function () {
  'use strict';

  if (window.__AI_PUBLISH_RUNTIME_CONFIG__) {
    return;
  }

  window.__AI_PUBLISH_RUNTIME_CONFIG__ = {
    default: {
      publishMonitorTimeoutMs: 120000,
      publishMonitorPollIntervalMs: 5000,
    },
    platformOverrides: {
      douyin: {
        publishMonitorTimeoutMs: 120000,
      },
    },
  };
})();
