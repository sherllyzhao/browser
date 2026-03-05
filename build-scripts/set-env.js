/**
 * 构建脚本：在打包前设置环境配置
 *
 * 用法：
 *   node build-scripts/set-env.js dev
 *   node build-scripts/set-env.js prod
 */

const fs = require('fs');
const path = require('path');

const env = process.argv[2] || 'dev';

if (!['dev', 'prod'].includes(env)) {
  console.error('❌ 错误：环境参数必须是 dev 或 prod');
  process.exit(1);
}

// 定义环境配置
const envConfig = {
  dev: {
    aigcPage: 'https://dev.china9.cn',
    geoPage: 'https://jzt_dev_1.china9.cn',
    apiDomain: 'https://apidev.china9.cn',
  },
  prod: {
    aigcPage: 'https://www.china9.cn',
    geoPage: 'https://zhjzt.china9.cn',
    apiDomain: 'https://api.china9.cn',
  }
};

const config = envConfig[env];

// 1. 修改 domain-config.js
const configPath = path.join(__dirname, '..', 'domain-config.js');
let configContent = fs.readFileSync(configPath, 'utf-8');

configContent = configContent.replace(
  /const ENV = (?:process\.env\.BUILD_ENV \|\| )?'(?:dev|prod)';.*$/m,
  `const ENV = '${env}'; // 'dev' | 'prod'`
);

fs.writeFileSync(configPath, configContent, 'utf-8');

// 2. 修改 login.html 中的 fallback 配置
const loginPath = path.join(__dirname, '..', 'login.html');
let loginContent = fs.readFileSync(loginPath, 'utf-8');

const fallbackConfig = env === 'prod'
  ? `      // fallback 默认配置
      domainConfig = {
        isProduction: true,
        aigcUrl: '${config.aigcPage}/aigc_browser/',
        geoUrl: '${config.geoPage}/jzt_all/#/geo/dashboard',
        cookieUrl: '${config.aigcPage}',
        cookieDomain: '.china9.cn',
        domains: {
          aigcPage: '${config.aigcPage}',
          geoPage: '${config.geoPage}',
          apiDomain: '${config.apiDomain}'
        }
      };`
  : `      // fallback 默认配置
      domainConfig = {
        isProduction: false,
        aigcUrl: 'http://localhost:5173/',
        geoUrl: 'http://localhost:8080/geo/dashboard',
        cookieUrl: 'https://dev.china9.cn',
        cookieDomain: '.china9.cn',
        domains: {
          aigcPage: 'https://dev.china9.cn',
          geoPage: 'https://jzt_dev_1.china9.cn',
          apiDomain: 'https://apidev.china9.cn'
        }
      };`;

loginContent = loginContent.replace(
  /\/\/ fallback 默认配置[\s\S]*?};/m,
  fallbackConfig
);

fs.writeFileSync(loginPath, loginContent, 'utf-8');

// 3. 修改 renderer.js 中的硬编码域名
const rendererPath = path.join(__dirname, '..', 'renderer.js');
let rendererContent = fs.readFileSync(rendererPath, 'utf-8');

// 直接替换为固定值（因为打包后 isProduction 总是 true，无法区分 dev/prod）
const aigcUrl = `${config.aigcPage}/aigc_browser/`;
const geoUrl = `${config.geoPage}/jzt_all/#/geo/dashboard`;

// 替换 AIGC_URL 和 GEO_URL 的定义（包括三元表达式）
rendererContent = rendererContent.replace(
  /const AIGC_URL = (?:isProduction\s*\?\s*'[^']+'\s*:\s*'[^']+';|'[^']+';)/,
  `const AIGC_URL = '${aigcUrl}';`
);

rendererContent = rendererContent.replace(
  /const GEO_URL = (?:isProduction\s*\?\s*'[^']+'\s*:\s*'[^']+';|'[^']+';)/,
  `const GEO_URL = '${geoUrl}';`
);

// 替换所有 apiBaseUrl 的赋值（保留判断逻辑，但修改 prod 值）
const geoApiProd = `${config.geoPage}/`;
rendererContent = rendererContent.replace(
  /const apiBaseUrl = (?:isDev \? '[^']+' : '[^']+';|'[^']+';)/g,
  `const apiBaseUrl = '${geoApiProd}';`
);

// 替换 cookieUrl（固定值）
const cookieUrlValue = config.geoPage;
rendererContent = rendererContent.replace(
  /const cookieUrl = (?:isDev \? '[^']+' : '[^']+';|'[^']+';)/g,
  `const cookieUrl = '${cookieUrlValue}';`
);

fs.writeFileSync(rendererPath, rendererContent, 'utf-8');

// 4. 修改 injected-scripts/common.js 中的硬编码域名
const commonPath = path.join(__dirname, '..', 'injected-scripts', 'common.js');
let commonContent = fs.readFileSync(commonPath, 'utf-8');

// 修改 getStatisticsUrl 中的硬编码（支持匹配两种格式）
const geoApiUrl = config.geoPage;
commonContent = commonContent.replace(
  /return `https:\/\/(?:jzt_dev_1|zhjzt)\.china9\.cn\/api\/geo\/\$\{endpoint\}`;/g,
  `return \`${geoApiUrl}/api/geo/\${endpoint}\`;`
);

fs.writeFileSync(commonPath, commonContent, 'utf-8');

console.log(`✅ 已设置环境为: ${env}`);
console.log(`📝 domain-config.js: ${configPath}`);
console.log(`📝 login.html: ${loginPath}`);
console.log(`📝 renderer.js: ${rendererPath}`);
console.log(`📝 common.js: ${commonPath}`);
