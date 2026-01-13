/**
 * 运营助手配置文件
 *
 * 包含：
 * - API 基础地址配置
 * - 各平台保存会话接口
 * - 各平台 Cookie 域名
 */

module.exports = {
  // API 基础地址（默认值，实际会从主窗口 URL 自动获取）
  apiBaseUrl: 'https://dev.china9.cn',

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
  }
};
