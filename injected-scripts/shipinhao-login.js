// 把所有storage和cookie都清空，然后刷新页面

(function() {
  // 使用 window.name 作为标记，刷新后会保留
  if (window.name === 'shipinhao_cleared') {
    console.log('已清空过一次，跳过重复执行');
    return;
  }

  try {
    // 标记已执行
    window.name = 'shipinhao_cleared';

    // 清空 localStorage
    localStorage.clear();

    // 清空 sessionStorage
    sessionStorage.clear();

    // 清空当前域名的所有 cookies
    document.cookie.split(";").forEach(function(c) {
      const eqPos = c.indexOf("=");
      const name = eqPos > -1 ? c.substr(0, eqPos).trim() : c.trim();
      if (name) {
        document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
        document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=" + document.domain;
      }
    });

    console.log('已清空所有 storage 和 cookies');

    // 刷新页面
    location.reload();
  } catch (error) {
    console.error('清空 storage 和 cookies 时出错:', error);
    location.reload();
  }
})();
