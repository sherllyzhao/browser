/**
 * 🔑 公共域名配置文件
 *
 * 集中维护所有环境的域名配置
 * 可被主进程、渲染进程、注入脚本等多个地方使用
 *
 * 环境切换：只需修改 ENV 的值即可切换所有域名
 *   - 'dev'  → 所有 URL 指向开发环境（apidev.china9.cn / dev.china9.cn）
 *   - 'prod' → 所有 URL 指向生产环境（api.china9.cn / www.china9.cn）
 */

// ===========================
// 🔑 唯一环境开关 — 改这一个值，全部切换
// ===========================
// 打包时会被 build-scripts/set-env.js 自动替换为 'dev' 或 'prod'
const ENV = 'prod'; // 'dev' | 'prod'

// ===========================
// 🔑 域名映射表（dev / prod 两套）
// ===========================
const DOMAINS = {
  dev: {
    // AIGC 系统
    aigcPage:          'https://dev.china9.cn',           // AIGC 前端页面
    aigcPath:          '/aigc_browser/',                   // AIGC 前端路径

    // GEO 系统（建站通）
    geoPage:           'https://jzt_dev_1.china9.cn',     // GEO 前端页面
    geoPath:           '/jzt_all/#/geo/index',            // GEO 前端路径

    // API 接口
    apiDomain:         'https://apidev.china9.cn',        // API 接口域名

    // Cookie 配置
    cookieUrl:         'https://dev.china9.cn',           // Cookie 设置用的 URL
    cookieDomain:      '.china9.cn',                      // Cookie 的 domain 属性

    // 版本检查
    versionCheckUrl:   'https://apidev.china9.cn/api/newmedia/downloadyunexe',

    // 登录跳转检测
    authRedirect:      'account.china9.cn',

    // 远程脚本 baseUrl
    remoteScriptsBase: 'http://localhost:5173/injected-scripts/',

    // 统计接口特殊域名映射
    statisticsHosts: {
      'jzt_dev_1.china9.cn': 'https://jzt_dev_1.china9.cn',
      '172.16.6.17:8080':    'https://jzt_dev_1.china9.cn',
      'localhost:8080':      'https://jzt_dev_1.china9.cn',
    },
  },
  prod: {
    // AIGC 系统
    aigcPage:          'https://www.china9.cn',           // AIGC 前端页面
    aigcPath:          '/aigc_browser/',                   // AIGC 前端路径

    // GEO 系统（建站通）
    geoPage:           'https://zhjzt.china9.cn',         // GEO 前端页面
    geoPath:           '/jzt_all/#/geo/index',            // GEO 前端路径

    // API 接口
    apiDomain:         'https://api.china9.cn',           // API 接口域名

    // Cookie 配置
    cookieUrl:         'https://www.china9.cn',           // Cookie 设置用的 URL
    cookieDomain:      '.china9.cn',                      // Cookie 的 domain 属性

    // 版本检查
    versionCheckUrl:   'https://api.china9.cn/api/newmedia/downloadyunexe',

    // 登录跳转检测
    authRedirect:      'account.china9.cn',

    // 远程脚本 baseUrl
    remoteScriptsBase: 'https://zcloud.obs.cn-north-4.myhuaweicloud.com/static/injected-scripts/',
    //remoteScriptsBase: 'http://localhost:5173/injected-scripts/',

    // 统计接口特殊域名映射
    statisticsHosts: {
      'zhjzt.china9.cn': 'https://zhjzt.china9.cn',
    },
  },
};

// 当前生效的域名配置
const domains = DOMAINS[ENV] || DOMAINS.dev;

// ===========================
// 🔑 开发环境域名列表（用于 isDevHost 判断）
// ===========================
const DEV_HOSTS = [
  'localhost:5173',
  'localhost:8080',
  '127.0.0.1:5173',
  '127.0.0.1:8080',
  'dev.china9.cn',
  'www.dev.china9.cn',
  'apidev.china9.cn',
  '172.16.6.17:8080',
  'jzt_dev_1.china9.cn',
];

// ===========================
// 🔑 便捷函数
// ===========================

/**
 * 获取 AIGC 首页完整 URL
 * @returns {string}
 */
function getAigcUrl() {
  return domains.aigcPage + domains.aigcPath;
}

/**
 * 获取 GEO 首页完整 URL
 * @returns {string}
 */
function getGeoUrl() {
  return domains.aigcPage + domains.aigcPath + '#/geo/dashboard';
}

/**
 * 获取 API 接口域名
 * @returns {string} 如 https://apidev.china9.cn
 */
function getApiDomainUrl() {
  return domains.apiDomain;
}

/**
 * 获取 Cookie 设置用的 URL
 * @returns {string} 如 https://dev.china9.cn
 */
function getCookieUrl() {
  return domains.cookieUrl;
}

/**
 * 获取 Cookie 的 domain 属性
 * @returns {string} 如 .china9.cn
 */
function getCookieDomain() {
  return domains.cookieDomain;
}

/**
 * 获取版本检查 URL（打包环境用远程，非打包用 localhost）
 * @param {boolean} isProduction - 是否为打包环境
 * @returns {string}
 */
function getVersionCheckUrlByEnv(isProduction) {
  if (!isProduction) return 'http://localhost:5173/browserVersion.json';
  return domains.versionCheckUrl;
}

/**
 * 获取统计接口 URL（根据主窗口域名）
 * @param {string} host - 主窗口域名
 * @param {boolean} isError - 是否为错误上报
 * @returns {string}
 */
function getStatisticsUrl(host, isError = false) {
  const endpoint = isError ? 'tjlogerror' : 'tjlog';

  // 检查特殊域名映射
  if (domains.statisticsHosts[host]) {
    return `${domains.statisticsHosts[host]}/api/geo/${endpoint}`;
  }

  // 默认使用 API 域名
  return `${domains.apiDomain}/api/geo/${endpoint}`;
}

// ===========================
// 🔑 其他配置（来自原 config.js）
// ===========================

// API 基础地址（默认值，实际会从主窗口 URL 自动获取）
const apiBaseUrl = domains.aigcPage;

// 各平台保存会话的接口路径
const platformApis = {
  douyin: '/api/mediaauth/douyininfo',
  xiaohongshu: '/api/mediaauth/xhsinfo',
  baijiahao: '/api/mediaauth/bjhinfo',
  weixin: '/api/mediaauth/sphinfo',
  shipinhao: '/api/mediaauth/sphinfo'
};

// 各平台的 Cookie 域名（用于过滤）
const platformDomains = {
  douyin: ['douyin.com'],
  xiaohongshu: ['xiaohongshu.com'],
  baijiahao: ['baidu.com'],
  weixin: ['weixin.qq.com', 'mp.weixin.qq.com'],
  shipinhao: ['channels.weixin.qq.com']
};

// 平台登录凭证 Cookie 名称（用于判断登录状态）
const platformLoginCookies = {
  douyin: ['sessionid', 'sessionid_ss', 'passport_csrf_token', 'sid_guard', 'uid_tt', 'uid_tt_ss'],
  xiaohongshu: ['web_session', 'websectiga', 'sec_poison_id'],
  weixin: ['wxuin', 'pass_ticket'],
  baijiahao: ['BDUSS', 'STOKEN'],
  shipinhao: ['wxuin', 'pass_ticket']
};

// 平台短名称到长名称的映射
const platformNameMap = {
  'dy': 'douyin',
  'xhs': 'xiaohongshu',
  'sph': 'shipinhao',
  'bjh': 'baijiahao',
  'wx': 'weixin'
};

// 平台 ID 到短名称的映射（来自后台 media.id）
const platformIdMap = {
  1: 'dy',    // 抖音
  4: 'bjh',   // 百家号
  6: 'xhs',   // 小红书
  7: 'sph'    // 视频号
};

// 各平台发布页 URL
const platformPublishUrls = {
  dy: 'https://creator.douyin.com/creator-micro/content/upload',
  xhs: 'https://creator.xiaohongshu.com/publish/publish?from=homepage&target=video&openFilePicker=true',
  sph: 'https://channels.weixin.qq.com/platform/post/create',
  bjh: 'https://baijiahao.baidu.com/builder/rc/edit?type=news&is_from_cms=1'
};

// 占位页面文件名（用于权限检查、未登录等场景）
const placeholderPages = {
  notAvailable: 'not-available.html',  // 功能暂未开放页面
  notAuth: 'not-auth.html',            // 未登录页面
  notPurchase: 'not-purchase.html',    // 未购买产品页面
  login: 'login.html'                  // 登录页面
};

// ===========================
// 🔑 导出配置
// ===========================

// 用于 Node.js（主进程）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ENV,
    DOMAINS,
    domains,
    DEV_HOSTS,
    getAigcUrl,
    getGeoUrl,
    getApiDomainUrl,
    getCookieUrl,
    getCookieDomain,
    getVersionCheckUrlByEnv,
    getStatisticsUrl,
    // 其他配置
    apiBaseUrl,
    platformApis,
    platformDomains,
    platformLoginCookies,
    platformNameMap,
    platformIdMap,
    platformPublishUrls,
    placeholderPages,
  };
}

// 用于浏览器（渲染进程、注入脚本）
if (typeof window !== 'undefined') {
  window.DOMAIN_CONFIG = {
    ENV,
    DOMAINS,
    domains,
    DEV_HOSTS,
    getAigcUrl,
    getGeoUrl,
    getApiDomainUrl,
    getCookieUrl,
    getCookieDomain,
    getVersionCheckUrlByEnv,
    getStatisticsUrl,
    // 其他配置
    apiBaseUrl,
    platformApis,
    platformDomains,
    platformLoginCookies,
    platformNameMap,
    platformIdMap,
    platformPublishUrls,
    placeholderPages,
  };
}
