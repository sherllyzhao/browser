/**
 * 运营助手配置文件
 *
 * 包含：
 * - 环境切换开关（ENV）
 * - 域名集中配置（DOMAINS）
 * - 开发环境域名列表（DEV_HOSTS）
 * - API 基础地址配置
 * - 各平台保存会话接口
 * - 各平台 Cookie 域名
 *
 * 注意：此文件在主进程（Node.js）中使用，不能访问 window 对象
 *
 * 🔑 环境切换：只需修改 ENV 的值即可切换所有域名
 *   - 'dev'  → 所有 URL 指向开发环境（apidev.china9.cn / dev.china9.cn）
 *   - 'prod' → 所有 URL 指向生产环境（api.china9.cn / www.china9.cn）
 */

// ===========================
// 🔑 唯一环境开关 — 改这一个值，全部切换
// ===========================
const ENV = 'dev'; // 'dev' | 'prod'

// ===========================
// 🔑 域名映射表（dev / prod 两套）
// ===========================
const DOMAINS = {
  dev: {
    aigcPage:          'https://dev.china9.cn',           // AIGC 前端页面
    aigcPath:          '/aigc_browser/',                   // AIGC 前端路径
    geoPage:           'https://jzt_dev_1.china9.cn',     // GEO（建站通）前端页面
    geoPath:           '/jzt_all/#/geo/index',            // GEO 前端路径
    apiDomain:         'https://apidev.china9.cn',        // API 接口域名
    cookieUrl:         'https://dev.china9.cn',           // Cookie 设置用的 URL
    cookieDomain:      '.china9.cn',                      // Cookie 的 domain 属性
    versionCheckUrl:   'https://apidev.china9.cn/api/newmedia/downloadyunexe',  // 版本检查
    authRedirect:      'account.china9.cn',               // 登录跳转检测关键字
    remoteScriptsBase: 'https://dev.china9.cn/aigc_browser/injected-scripts/',  // 远程脚本 baseUrl
    // 统计接口特殊域名映射
    statisticsHosts: {
      'jzt_dev_1.china9.cn': 'https://jzt_dev_1.china9.cn',
      '172.16.6.17:8080':    'https://jzt_dev_1.china9.cn',
      'localhost:8080':      'https://jzt_dev_1.china9.cn',
    },
  },
  prod: {
    aigcPage:          'https://www.china9.cn',           // AIGC 前端页面
    aigcPath:          '/aigc_browser/',                   // AIGC 前端路径
    geoPage:           'https://jzt_dev_1.china9.cn',     // GEO（建站通）前端页面（测试包用 jzt_dev_1）
    geoPath:           '/jzt_all/#/geo/index',            // GEO 前端路径
    apiDomain:         'https://api.china9.cn',           // API 接口域名
    cookieUrl:         'https://www.china9.cn',           // Cookie 设置用的 URL
    cookieDomain:      '.china9.cn',                      // Cookie 的 domain 属性
    versionCheckUrl:   'https://api.china9.cn/api/newmedia/downloadyunexe',     // 版本检查
    authRedirect:      'account.china9.cn',               // 登录跳转检测关键字
    remoteScriptsBase: 'https://www.china9.cn/aigc_browser/injected-scripts/',  // 远程脚本 baseUrl
    // 统计接口特殊域名映射
    statisticsHosts: {
      'jzt_dev_1.china9.cn': 'https://jzt_dev_1.china9.cn',
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
 * @param {boolean} isProduction - 是否为打包环境（app.isPackaged）
 * @returns {string}
 */
function getAigcUrl(isProduction) {
  if (!isProduction) return 'http://localhost:5173/';
  return domains.aigcPage + domains.aigcPath;
}

/**
 * 获取 GEO 首页完整 URL
 * @param {boolean} isProduction - 是否为打包环境
 * @returns {string}
 */
function getGeoUrl(isProduction) {
  if (!isProduction) return 'http://localhost:8080/geo/index';
  return domains.geoPage + domains.geoPath;
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

module.exports = {
  // 🔑 环境配置
  ENV,
  DOMAINS,
  domains,       // 当前生效的域名配置对象
  DEV_HOSTS,

  // 🔑 便捷函数
  getAigcUrl,
  getGeoUrl,
  getApiDomainUrl,
  getCookieUrl,
  getCookieDomain,
  getVersionCheckUrlByEnv,

  // API 基础地址（函数，根据 isProduction 参数动态返回）
  // 调用方式：config.getApiDomain(isProduction)
  getApiDomain: function(isProduction) {
    return domains.apiDomain;
  },

  // API 基础地址（默认值，实际会从主窗口 URL 自动获取）
  apiBaseUrl: domains.aigcPage,

  // 各平台保存会话的接口路径
  // 注意：现在改为由父页面在 element.saveSessionApi 中传入，此处仅作为备用/参考
  platformApis: {
    douyin: '/api/mediaauth/douyininfo',
    xiaohongshu: '/api/mediaauth/xhsinfo',
    baijiahao: '/api/mediaauth/bjhinfo',
    weixin: '/api/mediaauth/sphinfo',
    shipinhao: '/api/mediaauth/sphinfo'
  },

  // 各平台的 Cookie 域名（用于过滤）
  // 注意：现在改为从 element.cookies.domain 中提取，此处仅作为备用/参考
  platformDomains: {
    douyin: ['douyin.com'],
    xiaohongshu: ['xiaohongshu.com'],
    baijiahao: ['baidu.com'],
    weixin: ['weixin.qq.com', 'mp.weixin.qq.com'],
    shipinhao: ['channels.weixin.qq.com']
  },

  // 平台登录凭证 Cookie 名称（用于判断登录状态）
  platformLoginCookies: {
    douyin: ['sessionid', 'sessionid_ss', 'passport_csrf_token', 'sid_guard', 'uid_tt', 'uid_tt_ss'],
    xiaohongshu: ['web_session', 'websectiga', 'sec_poison_id'],
    weixin: ['wxuin', 'pass_ticket'],
    baijiahao: ['BDUSS', 'STOKEN'],
    shipinhao: ['wxuin', 'pass_ticket']
  },

  // 平台短名称到长名称的映射
  platformNameMap: {
    'dy': 'douyin',
    'xhs': 'xiaohongshu',
    'sph': 'shipinhao',
    'bjh': 'baijiahao',
    'wx': 'weixin'
  },

  // 平台 ID 到短名称的映射（来自后台 media.id）
  platformIdMap: {
    1: 'dy',    // 抖音
    4: 'bjh',   // 百家号
    6: 'xhs',   // 小红书
    7: 'sph'    // 视频号
  },

  // 各平台发布页 URL
  platformPublishUrls: {
    dy: 'https://creator.douyin.com/creator-micro/content/upload',
    xhs: 'https://creator.xiaohongshu.com/publish/publish?from=homepage&target=video&openFilePicker=true',
    sph: 'https://channels.weixin.qq.com/platform/post/create',
    bjh: 'https://baijiahao.baidu.com/builder/rc/edit?type=news&is_from_cms=1'
  },

  // 占位页面文件名（用于权限检查、未登录等场景）
  placeholderPages: {
    notAvailable: 'not-available.html',  // 功能暂未开放页面
    notAuth: 'not-auth.html',            // 未登录页面
    notPurchase: 'not-purchase.html',    // 未购买产品页面
    login: 'login.html'                  // 登录页面
  }
};
