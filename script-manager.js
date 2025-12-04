const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

class ScriptManager {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.scriptsDir = path.join(baseDir, 'injected-scripts');
    this.manifestPath = path.join(this.scriptsDir, 'manifest.json');
    this.manifest = {};

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

      // 加载 scripts-config.json 配置
      this.loadScriptsConfig();

      console.log('ScriptManager initialized:', this.scriptsDir);
      console.log('Loaded scripts:', Object.keys(this.manifest.scripts).length);
    } catch (err) {
      console.error('Failed to initialize ScriptManager:', err);
    }
  }

  // 加载 scripts-config.json 配置文件
  loadScriptsConfig() {
    try {
      const configPath = path.join(this.scriptsDir, 'scripts-config.json');

      if (!fs.existsSync(configPath)) {
        console.log('scripts-config.json not found, skipping...');
        return;
      }

      const config = fs.readJsonSync(configPath);

      if (config.scripts && typeof config.scripts === 'object') {
        console.log(`Loading ${Object.keys(config.scripts).length} scripts from scripts-config.json`);

        // 将配置文件中的脚本加载到 manifest
        for (const [url, scriptFile] of Object.entries(config.scripts)) {
          const scriptPath = path.join(this.scriptsDir, scriptFile);

          if (fs.existsSync(scriptPath)) {
            // 使用配置文件中的文件名，不重新生成哈希
            this.manifest.scripts[url] = {
              filename: scriptFile,
              url: url,
              savedAt: new Date().toISOString(),
              source: 'config' // 标记这是从配置文件加载的
            };
            console.log(`✓ Loaded: ${url} -> ${scriptFile}`);
          } else {
            console.warn(`✗ Script file not found: ${scriptPath} for URL: ${url}`);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load scripts-config.json:', err);
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

  // 从文件读取脚本
  async getScript(url) {
    try {
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

      const filepath = path.join(this.scriptsDir, scriptInfo.filename);

      if (fs.existsSync(filepath)) {
        const content = await fs.readFile(filepath, 'utf-8');
        return content;
      }

      return '';
    } catch (err) {
      console.error('Failed to read script:', err);
      return '';
    }
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
