const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

class ScriptManager {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.scriptsDir = path.join(baseDir, 'injected-scripts');
    this.manifestPath = path.join(this.scriptsDir, 'manifest.json');
    this.manifest = {};
    this.configLoaded = false; // 标记配置是否已加载
    this.configLoadPromise = null; // 配置加载 Promise（用于等待异步加载完成）

    this.init();
  }

  // 初始化脚本目录和清单文件
  init() {
    try {
      // 确保脚本目录存在
      fs.ensureDirSync(this.scriptsDir);

      // 加载或创建清单文件
      if (fs.existsSync(this.manifestPath)) {
        this.manifest = fs.readJsonSync(this.manifestPath);
      } else {
        this.manifest = { scripts: {} };
        this.saveManifest();
      }

      // 先同步加载本地配置（确保有基础配置）
      this.loadLocalConfig();

      // 然后异步加载远程配置（如果启用了远程模式）
      this.configLoadPromise = this.loadRemoteConfigAsync();

      console.log('ScriptManager initialized:', this.scriptsDir);
      console.log('Loaded scripts:', Object.keys(this.manifest.scripts).length);
    } catch (err) {
      console.error('Failed to initialize ScriptManager:', err);
    }
  }

  // 🔑 加载本地配置文件（同步）
  loadLocalConfig() {
    try {
      const configPath = path.join(this.scriptsDir, 'scripts-config.json');

      if (!fs.existsSync(configPath)) {
        console.log('[ScriptManager] scripts-config.json not found locally');
        this.remoteConfig = { enabled: false };
        return;
      }

      const config = fs.readJsonSync(configPath);
      this.applyConfig(config, 'local');
    } catch (err) {
      console.error('[ScriptManager] Failed to load local config:', err);
      this.remoteConfig = { enabled: false };
    }
  }

  // 🔑 异步加载远程配置文件
  async loadRemoteConfigAsync() {
    // 如果没有启用远程模式，直接返回
    if (!this.remoteConfig || !this.remoteConfig.enabled) {
      console.log('[ScriptManager] 远程配置未启用，跳过远程加载');
      this.configLoaded = true;
      return;
    }

    try {
      // 确定配置文件 URL
      const isDevMode = !require('electron').app.isPackaged;
      const baseUrl = isDevMode && this.remoteConfig.devBaseUrl
        ? this.remoteConfig.devBaseUrl
        : this.remoteConfig.baseUrl;

      const configUrl = baseUrl + 'scripts-config.json?v=' + Date.now();

      console.log('[ScriptManager] 🌐 开始加载远程配置:', configUrl);

      // 使用 fetch 加载远程配置
      const { net } = require('electron');
      const request = net.request(configUrl);

      const remoteConfig = await new Promise((resolve, reject) => {
        let data = '';

        request.on('response', (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
          }

          response.on('data', (chunk) => {
            data += chunk.toString();
          });

          response.on('end', () => {
            try {
              const config = JSON.parse(data);
              resolve(config);
            } catch (e) {
              reject(new Error('Invalid JSON: ' + e.message));
            }
          });
        });

        request.on('error', (error) => {
          reject(error);
        });

        // 设置超时
        setTimeout(() => {
          request.abort();
          reject(new Error('Request timeout'));
        }, this.remoteConfig.timeout || 10000);

        request.end();
      });

      // 应用远程配置
      this.applyConfig(remoteConfig, 'remote');
      console.log('[ScriptManager] ✅ 远程配置加载成功');
      this.configLoaded = true;
    } catch (err) {
      console.error('[ScriptManager] ❌ 远程配置加载失败，使用本地配置:', err.message);
      this.configLoaded = true;
      // 失败时已经有本地配置作为后备
    }
  }

  // 🔑 应用配置（统一处理本地和远程配置）
  applyConfig(config, source = 'unknown') {
    try {
      // 加载远程配置设置
      if (config.remoteConfig) {
        this.remoteConfig = config.remoteConfig;
        console.log(`[ScriptManager] Remote config loaded from ${source}:`, this.remoteConfig.enabled ? 'ENABLED' : 'DISABLED');
      }

      if (config.scripts && typeof config.scripts === 'object') {
        console.log(`[ScriptManager] Loading ${Object.keys(config.scripts).length} scripts from ${source} config`);

        // 将配置文件中的脚本加载到 manifest
        for (const [url, scriptFile] of Object.entries(config.scripts)) {
          // 支持两种格式：字符串（单个脚本）和数组（多个脚本，依赖注入）
          const scriptFiles = Array.isArray(scriptFile) ? scriptFile : [scriptFile];

          // 远程模式下不验证本地文件是否存在
          if (this.remoteConfig && this.remoteConfig.enabled) {
            this.manifest.scripts[url] = {
              filename: scriptFiles,
              url: url,
              savedAt: new Date().toISOString(),
              source: source
            };
            const filesDisplay = Array.isArray(scriptFiles)
              ? scriptFiles.join(' -> ')
              : scriptFiles;
            console.log(`[ScriptManager] ✓ Loaded: ${url} -> ${filesDisplay}`);
          } else {
            // 本地模式下验证文件是否存在
            const allFilesExist = scriptFiles.every(file => {
              const scriptPath = path.join(this.scriptsDir, file);
              return fs.existsSync(scriptPath);
            });

            if (allFilesExist) {
              this.manifest.scripts[url] = {
                filename: scriptFiles,
                url: url,
                savedAt: new Date().toISOString(),
                source: source
              };
              const filesDisplay = Array.isArray(scriptFiles)
                ? scriptFiles.join(' -> ')
                : scriptFiles;
              console.log(`[ScriptManager] ✓ Loaded: ${url} -> ${filesDisplay}`);
            } else {
              const missingFiles = scriptFiles.filter(file => {
                const scriptPath = path.join(this.scriptsDir, file);
                return !fs.existsSync(scriptPath);
              });
              console.warn(`[ScriptManager] ✗ Script file(s) not found for URL: ${url}`);
              console.warn(`[ScriptManager]   Missing: ${missingFiles.join(', ')}`);
            }
          }
        }
      }
    } catch (err) {
      console.error(`[ScriptManager] Failed to apply config from ${source}:`, err);
    }
  }

  // 将 URL 转换为安全的文件名
  urlToFilename(url) {
    // 使用 MD5 哈希确保文件名唯一且安全
    const hash = crypto.createHash('md5').update(url).digest('hex');
    return `${hash}.js`;
  }

  // 保存清单文件
  saveManifest() {
    try {
      fs.writeJsonSync(this.manifestPath, this.manifest, { spaces: 2 });
    } catch (err) {
      console.error('Failed to save manifest:', err);
    }
  }

  // 保存脚本到文件
  async saveScript(url, script) {
    try {
      const filename = this.urlToFilename(url);
      const filepath = path.join(this.scriptsDir, filename);

      if (script && script.trim()) {
        // 保存脚本内容到文件
        await fs.writeFile(filepath, script, 'utf-8');

        // 更新清单
        this.manifest.scripts[url] = {
          filename: filename,
          url: url,
          savedAt: new Date().toISOString(),
          size: script.length
        };
      } else {
        // 如果脚本为空，删除文件和记录
        if (fs.existsSync(filepath)) {
          await fs.remove(filepath);
        }
        delete this.manifest.scripts[url];
      }

      this.saveManifest();
      return { success: true };
    } catch (err) {
      console.error('Failed to save script:', err);
      return { success: false, error: err.message };
    }
  }

  // 从文件读取脚本（或生成远程加载器）
  async getScript(url) {
    try {
      // 🔑 等待远程配置加载完成（如果正在加载）
      if (this.configLoadPromise && !this.configLoaded) {
        console.log('[ScriptManager] ⏳ 等待远程配置加载完成...');
        await this.configLoadPromise;
        console.log('[ScriptManager] ✅ 远程配置加载完成，继续获取脚本');
      }

      // 1. 首先尝试精确匹配
      let scriptInfo = this.manifest.scripts[url];

      // 2. 如果没有精确匹配，尝试模式匹配
      if (!scriptInfo) {
        for (const [pattern, info] of Object.entries(this.manifest.scripts)) {
          if (this.urlMatchesPattern(url, pattern)) {
            scriptInfo = info;
            console.log(`📌 URL pattern matched: ${pattern} -> ${url}`);
            break;
          }
        }
      }

      if (!scriptInfo) {
        return '';
      }

      // 支持单个脚本或多个脚本（数组）
      const filenames = Array.isArray(scriptInfo.filename)
        ? scriptInfo.filename
        : [scriptInfo.filename];

      console.log(`[ScriptManager] 加载脚本:`, filenames);

      // 🔑 检查是否启用远程加载（主进程 fetch + executeJavaScript 注入，绕过 CSP）
      if (this.remoteConfig && this.remoteConfig.enabled) {
        console.log(`[ScriptManager] 🌐 使用远程加载模式（主进程 fetch）`);
        return this.fetchRemoteScripts(filenames);
      }

      // 本地加载模式：按顺序读取所有脚本文件，并连接内容
      const scriptContents = [];
      for (const filename of filenames) {
        const filepath = path.join(this.scriptsDir, filename);

        if (fs.existsSync(filepath)) {
          const content = await fs.readFile(filepath, 'utf-8');
          scriptContents.push(`// ===== ${filename} =====\n${content}`);
          console.log(`[ScriptManager] ✓ 已加载: ${filename} (${content.length} chars)`);
        } else {
          console.warn(`[ScriptManager] ✗ 文件不存在: ${filename}`);
        }
      }

      // 将所有脚本内容连接起来，用分隔符分开
      return scriptContents.join('\n\n');
    } catch (err) {
      console.error('Failed to read script:', err);
      return '';
    }
  }

  // 🔑 从远程服务器获取单个脚本的文本内容（主进程级别，绕过 CSP）
  fetchRemoteScript(scriptUrl) {
    const timeout = this.remoteConfig.timeout || 10000;

    return new Promise((resolve, reject) => {
      const { net } = require('electron');
      const request = net.request(scriptUrl);
      let data = '';

      request.on('response', (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode} for ${scriptUrl}`));
          return;
        }

        response.on('data', (chunk) => {
          data += chunk.toString();
        });

        response.on('end', () => {
          resolve(data);
        });
      });

      request.on('error', (error) => {
        reject(error);
      });

      const timer = setTimeout(() => {
        request.abort();
        reject(new Error(`Timeout loading ${scriptUrl}`));
      }, timeout);

      request.on('close', () => {
        clearTimeout(timer);
      });

      request.end();
    });
  }

  // 🔑 从远程服务器按顺序获取多个脚本并拼接为文本
  async fetchRemoteScripts(filenames) {
    const isDevMode = !require('electron').app.isPackaged;
    const baseUrl = isDevMode && this.remoteConfig.devBaseUrl
      ? this.remoteConfig.devBaseUrl
      : this.remoteConfig.baseUrl;

    console.log(`[ScriptManager] 🌐 主进程 fetch 远程脚本, baseUrl: ${baseUrl}, files: ${filenames.join(', ')}`);

    const scriptContents = [];
    let loadedCount = 0;
    let failedCount = 0;

    for (const filename of filenames) {
      const scriptUrl = baseUrl + filename + '?v=' + Date.now();
      try {
        const content = await this.fetchRemoteScript(scriptUrl);
        scriptContents.push(`// ===== ${filename} (remote) =====\n${content}`);
        loadedCount++;
        console.log(`[ScriptManager] ✅ 远程加载成功: ${filename} (${content.length} chars)`);
      } catch (err) {
        failedCount++;
        console.error(`[ScriptManager] ❌ 远程加载失败: ${filename}:`, err.message);

        // 如果配置了回退到本地，尝试读取本地文件
        if (this.remoteConfig.fallbackToLocal !== false) {
          const localPath = path.join(this.scriptsDir, filename);
          if (fs.existsSync(localPath)) {
            const localContent = await fs.readFile(localPath, 'utf-8');
            scriptContents.push(`// ===== ${filename} (local fallback) =====\n${localContent}`);
            console.log(`[ScriptManager] 🔄 回退到本地: ${filename} (${localContent.length} chars)`);
          } else {
            console.warn(`[ScriptManager] ⚠️ 本地文件也不存在: ${filename}`);
          }
        }
      }
    }

    console.log(`[ScriptManager] 📊 远程加载完成: 成功 ${loadedCount}, 失败 ${failedCount}`);
    return scriptContents.join('\n\n');
  }

  // 🔑 生成远程脚本加载器（已废弃，保留兼容）
  generateRemoteLoader(filenames) {
    // 根据环境选择 baseUrl
    // 通过检查是否在开发模式下运行来决定使用哪个 URL
    const isDevMode = !require('electron').app.isPackaged;
    const baseUrl = isDevMode && this.remoteConfig.devBaseUrl
      ? this.remoteConfig.devBaseUrl
      : this.remoteConfig.baseUrl;

    const timeout = this.remoteConfig.timeout || 10000;
    const fallbackToLocal = this.remoteConfig.fallbackToLocal !== false;

    console.log(`[ScriptManager] 🌐 生成加载器, baseUrl: ${baseUrl}, files: ${filenames.join(', ')}`);

    // 生成统一加载器脚本
    const loaderScript = `
(async function() {
  'use strict';

  const REMOTE_BASE = ${JSON.stringify(baseUrl)};
  const SCRIPTS = ${JSON.stringify(filenames)};
  const TIMEOUT = ${timeout};
  const FALLBACK_TO_LOCAL = ${fallbackToLocal};

  console.log('[RemoteLoader] 🚀 开始加载远程脚本:', SCRIPTS);
  console.log('[RemoteLoader] 📡 远程地址:', REMOTE_BASE);

  // 加载单个脚本
  function loadScript(url, filename) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url + '?v=' + Date.now(); // 禁用缓存
      script.async = false; // 保证执行顺序

      // 超时处理
      const timeoutId = setTimeout(() => {
        script.onload = script.onerror = null;
        reject(new Error('Timeout loading ' + filename));
      }, TIMEOUT);

      script.onload = () => {
        clearTimeout(timeoutId);
        console.log('[RemoteLoader] ✅ 加载成功:', filename);
        resolve();
      };

      script.onerror = (err) => {
        clearTimeout(timeoutId);
        console.error('[RemoteLoader] ❌ 加载失败:', filename, err);
        reject(new Error('Failed to load ' + filename));
      };

      document.head.appendChild(script);
    });
  }

  // 按顺序加载所有脚本
  let loadedCount = 0;
  let failedCount = 0;

  for (const filename of SCRIPTS) {
    try {
      await loadScript(REMOTE_BASE + filename, filename);
      loadedCount++;
    } catch (err) {
      console.error('[RemoteLoader] 加载出错:', err.message);
      failedCount++;

      // 如果配置了回退到本地，这里无法直接回退（因为本地脚本需要通过 Electron 注入）
      // 但我们可以标记失败，让后续逻辑处理
      if (!FALLBACK_TO_LOCAL) {
        throw err; // 如果不允许回退，直接抛出错误
      }
    }
  }

  console.log('[RemoteLoader] 📊 加载完成: 成功 ' + loadedCount + ', 失败 ' + failedCount);

  // 🔑 所有脚本加载完成后，调用初始化函数（如果存在）
  if (typeof window.__scriptInit === 'function') {
    console.log('[RemoteLoader] 🎯 调用 __scriptInit()');
    try {
      await window.__scriptInit();
    } catch (initErr) {
      console.error('[RemoteLoader] __scriptInit 执行出错:', initErr);
    }
  }

  // 触发自定义事件，通知脚本加载完成
  window.dispatchEvent(new CustomEvent('remoteScriptsLoaded', {
    detail: { loaded: loadedCount, failed: failedCount, scripts: SCRIPTS }
  }));

})();
`;

    return loaderScript;
  }

  // URL 模式匹配
  urlMatchesPattern(url, pattern) {
    // 支持 * 通配符
    // 例如: http://localhost:5173/* 匹配 http://localhost:5173/任何路径

    // 将模式转换为正则表达式
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // 转义正则特殊字符
      .replace(/\*/g, '.*'); // 将 * 替换为 .*

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(url);
  }

  // 获取所有已保存的脚本列表
  getAllScripts() {
    return Object.entries(this.manifest.scripts).map(([url, info]) => ({
      url,
      filename: info.filename,
      savedAt: info.savedAt,
      size: info.size
    }));
  }

  // 删除指定 URL 的脚本
  async deleteScript(url) {
    try {
      const scriptInfo = this.manifest.scripts[url];
      if (!scriptInfo) {
        return { success: false, error: 'Script not found' };
      }

      const filepath = path.join(this.scriptsDir, scriptInfo.filename);

      if (fs.existsSync(filepath)) {
        await fs.remove(filepath);
      }

      delete this.manifest.scripts[url];
      this.saveManifest();

      return { success: true };
    } catch (err) {
      console.error('Failed to delete script:', err);
      return { success: false, error: err.message };
    }
  }

  // 导出所有脚本到指定目录
  async exportScripts(targetDir) {
    try {
      await fs.ensureDir(targetDir);

      // 复制所有脚本文件
      for (const [url, info] of Object.entries(this.manifest.scripts)) {
        const sourceFile = path.join(this.scriptsDir, info.filename);
        // 使用更友好的文件名：使用 URL 的一部分
        const safeName = this.getSafeFilename(url);
        const targetFile = path.join(targetDir, `${safeName}.js`);

        if (fs.existsSync(sourceFile)) {
          await fs.copy(sourceFile, targetFile);
        }
      }

      // 导出清单文件
      const exportManifest = {
        exportedAt: new Date().toISOString(),
        scripts: this.manifest.scripts
      };
      await fs.writeJson(path.join(targetDir, 'manifest.json'), exportManifest, { spaces: 2 });

      return { success: true, count: Object.keys(this.manifest.scripts).length };
    } catch (err) {
      console.error('Failed to export scripts:', err);
      return { success: false, error: err.message };
    }
  }

  // 从目录导入脚本
  async importScripts(sourceDir) {
    try {
      const manifestFile = path.join(sourceDir, 'manifest.json');

      if (!fs.existsSync(manifestFile)) {
        return { success: false, error: 'Manifest file not found' };
      }

      const importManifest = await fs.readJson(manifestFile);
      let importedCount = 0;

      for (const [url, info] of Object.entries(importManifest.scripts)) {
        const sourceFile = path.join(sourceDir, info.filename);

        if (fs.existsSync(sourceFile)) {
          const content = await fs.readFile(sourceFile, 'utf-8');
          await this.saveScript(url, content);
          importedCount++;
        }
      }

      return { success: true, count: importedCount };
    } catch (err) {
      console.error('Failed to import scripts:', err);
      return { success: false, error: err.message };
    }
  }

  // 获取安全的文件名（用于导出）
  getSafeFilename(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.replace(/\./g, '_');
      const pathname = urlObj.pathname.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
      return `${hostname}${pathname}`;
    } catch {
      return url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
    }
  }

  // 清空所有脚本
  async clearAll() {
    try {
      // 删除所有脚本文件
      for (const info of Object.values(this.manifest.scripts)) {
        const filepath = path.join(this.scriptsDir, info.filename);
        if (fs.existsSync(filepath)) {
          await fs.remove(filepath);
        }
      }

      // 清空清单
      this.manifest = { scripts: {} };
      this.saveManifest();

      return { success: true };
    } catch (err) {
      console.error('Failed to clear all scripts:', err);
      return { success: false, error: err.message };
    }
  }
}

module.exports = ScriptManager;
