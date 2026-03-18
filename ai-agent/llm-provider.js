/**
 * LLM Provider 抽象层
 * 支持 OpenAI 兼容格式的 API（Groq / 通义千问 / OpenRouter / 自定义）
 * 切换模型只需修改配置，无需改代码
 */
const https = require('https');
const http = require('http');

// 预置的服务商配置
const PRESET_PROVIDERS = {
  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'qwen/qwen3-4b:free',
  },
  qwen: {
    name: '通义千问（阿里云百炼）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-turbo',
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  cloudflare: {
    name: 'Cloudflare Workers AI',
    // baseUrl 需要动态拼接 Account ID: https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1
    baseUrl: '',
    defaultModel: '@cf/meta/llama-3.1-8b-instruct',
    needsAccountId: true,
    buildBaseUrl: (accountId) => `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
  },
  custom: {
    name: '自定义',
    baseUrl: '',
    defaultModel: '',
  },
};

class LLMProvider {
  constructor(config = {}) {
    const provider = config.provider || 'groq';
    const preset = PRESET_PROVIDERS[provider] || PRESET_PROVIDERS.custom;

    this.providerKey = provider;
    this.providerName = preset.name;
    // Cloudflare 需要用 accountId 动态拼接 baseUrl
    if (provider === 'cloudflare' && config.accountId) {
      this.baseUrl = preset.buildBaseUrl(config.accountId);
    } else {
      this.baseUrl = config.baseUrl || preset.baseUrl;
    }
    this.apiKey = config.apiKey || '';
    this.model = config.model || preset.defaultModel;
    this.timeout = config.timeout || 30000; // 30秒超时
    this.maxRetries = config.maxRetries || 2;
  }

  /**
   * 发送 Chat Completion 请求（OpenAI 兼容格式）
   * @param {Array} messages - [{role: 'system'|'user', content: '...'}]
   * @param {Object} options - {temperature, max_tokens, response_format}
   * @returns {Promise<string>} - LLM 返回的文本
   */
  async chat(messages, options = {}) {
    const url = `${this.baseUrl}/chat/completions`;
    const body = {
      model: this.model,
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.max_tokens || 4096,
    };

    // 部分模型支持 JSON mode
    if (options.response_format) {
      body.response_format = options.response_format;
    }

    console.log(`[AI Agent] 调用 ${this.providerName} (${this.model})...`);
    const startTime = Date.now();

    try {
      const response = await this._requestWithRetry(url, body);
      const elapsed = Date.now() - startTime;
      console.log(`[AI Agent] ✅ 响应成功，耗时 ${elapsed}ms`);

      if (response.choices && response.choices[0]) {
        return response.choices[0].message.content;
      }
      throw new Error('LLM 返回格式异常: ' + JSON.stringify(response));
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(`[AI Agent] ❌ 调用失败 (${elapsed}ms):`, error.message);
      throw error;
    }
  }

  /**
   * 发送 HTTP 请求
   */
  async _requestWithRetry(url, body) {
    let lastError = null;
    const maxAttempts = Math.max(1, this.maxRetries + 1);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (attempt > 1) {
          console.warn(`[AI Agent] 第 ${attempt}/${maxAttempts} 次重试 ${this.providerName} 请求...`);
        }
        return await this._request(url, body);
      } catch (error) {
        lastError = error;
        if (!this._shouldRetryNetworkError(error) || attempt >= maxAttempts) {
          throw this._decorateRequestError(error);
        }
        await this._sleep(800 * attempt);
      }
    }

    throw this._decorateRequestError(lastError);
  }

  _shouldRetryNetworkError(error) {
    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('client network socket disconnected') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('socket hang up') ||
      message.includes('network socket') ||
      message.includes('secure tls connection')
    );
  }

  _decorateRequestError(error) {
    const message = String(error?.message || error || '');
    if (this.providerKey === 'cloudflare' && this._shouldRetryNetworkError(error)) {
      return new Error(`${message}；Cloudflare Workers AI 网络/TLS 握手失败，通常是代理/VPN 或直连链路问题，不是 API Key 格式错误`);
    }
    return error instanceof Error ? error : new Error(message);
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _request(url, body) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        timeout: this.timeout,
      };

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(`API 错误 (${res.statusCode}): ${parsed.error?.message || data}`));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(new Error(`响应解析失败: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`请求超时 (${this.timeout}ms)`));
      });

      req.write(JSON.stringify(body));
      req.end();
    });
  }
}

module.exports = { LLMProvider, PRESET_PROVIDERS };

