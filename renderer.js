// 隐藏开发工具栏和脚本按钮（统一使用公共头部）
const toolbar = document.querySelector('.toolbar');
const toggleScript = document.getElementById('toggleScript');
const scriptPanel = document.getElementById('scriptPanel');
if (toolbar) toolbar.style.display = 'none';
if (toggleScript) toggleScript.style.display = 'none';
if (scriptPanel) scriptPanel.style.display = 'none';

// ========== 公共头部显示/隐藏 ==========
const commonHeader = document.getElementById('__browser_common_header__');

// 初始化时检查是否需要隐藏头部
(async () => {
  if (window.electronAPI && window.electronAPI.getCurrentUrl) {
    try {
      const currentUrl = await window.electronAPI.getCurrentUrl();
      const isLoginPage = currentUrl && currentUrl.includes('login.html');
      if (isLoginPage && commonHeader) {
        commonHeader.style.display = 'none';
        console.log('[Common Header] 初始化：登录页隐藏头部');
      }
    } catch (err) {
      console.log('[Common Header] 初始化检查失败:', err);
    }
  }
})();

// 监听主进程发来的头部显示/隐藏事件
if (window.electronAPI && window.electronAPI.onToggleHeader) {
  window.electronAPI.onToggleHeader((show) => {
    console.log('[Common Header] 收到显示/隐藏指令:', show);
    if (commonHeader) {
      commonHeader.style.display = show ? 'flex' : 'none';
    }
  });
}

// ========== 公共头部按钮 ==========
const headerBackBtn = document.getElementById('headerBackBtn');
const headerNextBtn = document.getElementById('headerNextBtn');
const headerRefreshBtn = document.getElementById('headerRefreshBtn');
const headerDevBtn = document.getElementById('headerDevBtn');
const tabAigc = document.getElementById('__tab_aigc__');
const tabGeo = document.getElementById('__tab_geo__');

// AIGC 和 GEO 的 URL（根据环境）
const isProduction = window.electronAPI && window.electronAPI.isProduction;
const AIGC_URL = isProduction
  ? 'https://dev.china9.cn/aigc_browser/'
  : 'http://localhost:5173/';
const GEO_URL = isProduction
  ? 'https://zhjzt.china9.cn/jzt_all/#/geo/index'
  : 'http://localhost:8080/#/geo/index';
  //: 'http://172.16.6.17:8080/#/geo/index';

// 占位页面文件名（与 config.js 中 placeholderPages 保持一致）
const PLACEHOLDER_PAGES = ['not-available.html', 'not-auth.html', 'not-purchase.html', 'login.html'];

// 判断当前系统类型
function getCurrentSystem(url) {
  if (!url) return 'aigc';
  const urlLower = url.toLowerCase();

  // 检查占位页的查询参数（用于占位页保持正确的 Tab 选中状态）
  if (PLACEHOLDER_PAGES.some(page => urlLower.includes(page))) {
    try {
      const urlObj = new URL(url);
      const systemParam = urlObj.searchParams.get('system');
      if (systemParam === 'geo') return 'geo';
      if (systemParam === 'aigc') return 'aigc';
    } catch (e) {
      // URL 解析失败，继续使用默认逻辑
    }
  }

  // GEO 系统特征
  if (urlLower.includes(':8080') ||
      urlLower.includes('/geo/') ||
      urlLower.includes('/jzt_all/') ||
      urlLower.includes('jzt_dev') ||
      urlLower.includes('zhjzt') ||
      urlLower.includes('jzt')) {
    return 'geo';
  }

  // AIGC 系统特征
  if (urlLower.includes(':5173') ||
      urlLower.includes('/aigc_browser/') ||
      urlLower.includes('aigc')) {
    return 'aigc';
  }

  // 默认返回 aigc
  return 'aigc';
}

// 更新 Tab 选中状态
function updateActiveTab(url) {
  const system = getCurrentSystem(url);

  if (tabAigc) tabAigc.classList.remove('active');
  if (tabGeo) tabGeo.classList.remove('active');

  if (system === 'geo') {
    if (tabGeo) tabGeo.classList.add('active');
  } else {
    if (tabAigc) tabAigc.classList.add('active');
  }

  console.log('[Common Header] 当前系统:', system);
}

// 公共头部按钮点击事件
if (headerBackBtn) {
  headerBackBtn.onclick = async function() {
    await window.electronAPI.goBack();
  };
}

if (headerNextBtn) {
  headerNextBtn.onclick = async function() {
    await window.electronAPI.goForward();
  };
}

if (headerRefreshBtn) {
  headerRefreshBtn.onclick = async function() {
    await window.electronAPI.refreshPage();
  };
}

if (headerDevBtn) {
  headerDevBtn.onclick = async function() {
    // 打开主窗口的 DevTools（可以检查公共头部）
    await window.electronAPI.openMainDevTools();
  };
}

// 退出登录按钮 - 使用原生菜单（能浮在 BrowserView 之上）
const userInfoEl = document.getElementById('userInfo');

if (userInfoEl) {
  userInfoEl.addEventListener('click', async function(e) {
    e.stopPropagation();

    // 使用原生菜单
    if (window.electronAPI && window.electronAPI.showUserMenu) {
      console.log('[User Menu] 显示原生菜单');
      const result = await window.electronAPI.showUserMenu();
      console.log('[User Menu] 菜单选择结果:', result);

      if (result && result.selected && result.action === 'logout') {
        // 用户选择了退出登录
        if (confirm('确定要退出登录吗？')) {
          console.log('[Logout] 用户确认退出');

          try {
            // 清除用户信息
            if (window.electronAPI && window.electronAPI.removeGlobalData) {
              console.log('[Logout] 开始清除用户数据...');
              await window.electronAPI.removeGlobalData('user_info');
              await window.electronAPI.removeGlobalData('login_token');
              await window.electronAPI.removeGlobalData('login_expires');
              await window.electronAPI.removeGlobalData('login_gcc');
              await window.electronAPI.removeGlobalData('company_id');
              await window.electronAPI.removeGlobalData('siteInfo');
              await window.electronAPI.removeGlobalData('current_site');
              await window.electronAPI.removeGlobalData('current_site_id');
              await window.electronAPI.removeGlobalData('current_site_name');
              console.log('[Logout] ✅ 已清除用户信息');
            }

            // 🔑 清除 china9.cn 的 Cookie（避免旧 Cookie 如 users_unique_id 干扰下次登录）
            if (window.electronAPI && window.electronAPI.clearDomainCookies) {
              await window.electronAPI.clearDomainCookies('china9.cn');
              console.log('[Logout] ✅ 已清除 china9.cn Cookie');
            }

            // 跳转到登录页
            console.log('[Logout] 正在跳转到登录页...');
            await window.electronAPI.navigateToLogin();
            console.log('[Logout] ✅ 跳转成功');
          } catch (err) {
            console.error('[Logout] ❌ 退出登录失败:', err);
            alert('退出登录失败，请重试');
          }
        }
      }
    }
  });
}

// Tab 点击切换系统
if (tabAigc) {
  tabAigc.onclick = function() {
    if (tabAigc.classList.contains('active')) return;
    window.electronAPI.navigateTo(AIGC_URL);
  };
}

if (tabGeo) {
  tabGeo.onclick = function() {
    if (tabGeo.classList.contains('active')) return;
    window.electronAPI.navigateTo(GEO_URL);
  };
}

// ========== 站点下拉菜单 ==========
const currentSite = document.getElementById('currentSite');
const switchSiteBtn = document.getElementById('switchSiteBtn');
const siteDropdown = document.getElementById('siteDropdown');
const currentSiteName = document.getElementById('currentSiteName');

console.log('[Site Dropdown] Elements:', {
  currentSite: currentSite,
  switchSiteBtn: switchSiteBtn,
  siteDropdown: siteDropdown,
  currentSiteName: currentSiteName
});

// 站点列表数据（可以从 API 获取或通过 globalStorage 存储）
let siteList = [];
let currentSiteId = 1;

// 渲染站点列表
function renderSiteList() {
  if (!siteDropdown) return;

  siteDropdown.innerHTML = siteList.map(site => `
    <div class="site-item${site.id === currentSiteId ? ' active' : ''}" data-id="${site.id}" title="${site.name}">
      <div class="site-icon">${site.shortName.charAt(0)}</div>
      <span class="site-name" title="${site.name}">${site.name}</span>
      <svg class="check-icon" viewBox="0 0 1024 1024" fill="#409EFF">
        <path d="M912 190h-69.9c-9.8 0-19.1 4.5-25.1 12.2L404.7 724.5 207 474a32 32 0 0 0-25.1-12.2H112c-6.7 0-10.4 7.7-6.3 12.9l273.9 347c12.8 16.2 37.4 16.2 50.3 0l488.4-618.9c4.1-5.1.4-12.8-6.3-12.8z"/>
      </svg>
    </div>
  `).join('');

  // 绑定点击事件
  siteDropdown.querySelectorAll('.site-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      const id = parseInt(item.dataset.id);
      const site = siteList.find(s => s.id === id);
      if (site) {
        currentSiteId = id;
        if (currentSiteName) {
          currentSiteName.textContent = site.name;
        }

        // 更新选中状态
        siteDropdown.querySelectorAll('.site-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');

        // 关闭下拉菜单
        closeSiteDropdown();

        // 存储当前选中的站点
        if (window.electronAPI && window.electronAPI.setGlobalData) {
          await window.electronAPI.setGlobalData('current_site_id', id);
          await window.electronAPI.setGlobalData('current_site_name', site.name);
        }

        console.log('[Site Switch] 切换到站点:', site.name);
      }
    });
  });
}

// 打开下拉菜单
function openSiteDropdown() {
  if (currentSite) currentSite.classList.add('active');
  if (siteDropdown) siteDropdown.classList.add('show');
  // 通知主进程收缩 BrowserView 宽度，给下拉菜单腾出空间
  if (window.electronAPI && window.electronAPI.toggleSiteDropdown) {
    window.electronAPI.toggleSiteDropdown(true);
  }
}

// 关闭下拉菜单
function closeSiteDropdown() {
  if (currentSite) currentSite.classList.remove('active');
  if (siteDropdown) siteDropdown.classList.remove('show');
  // 通知主进程恢复 BrowserView 宽度
  if (window.electronAPI && window.electronAPI.toggleSiteDropdown) {
    window.electronAPI.toggleSiteDropdown(false);
  }
}

// 切换下拉菜单
function toggleSiteDropdown() {
  console.log('[Site Dropdown] toggleSiteDropdown called');
  console.log('[Site Dropdown] siteDropdown:', siteDropdown);
  console.log('[Site Dropdown] classList:', siteDropdown ? siteDropdown.classList : 'N/A');
  if (siteDropdown && siteDropdown.classList.contains('show')) {
    closeSiteDropdown();
  } else {
    openSiteDropdown();
  }
}

// 注意：站点下拉菜单点击事件在后面的 1004 行处理（使用 siteDropdownEl）
// 这里不再重复绑定，避免两个处理器冲突

// 点击外部关闭下拉菜单
document.addEventListener('click', (e) => {
  if (siteDropdown && siteDropdown.classList.contains('show')) {
    const siteManage = document.querySelector('.site-manage');
    if (siteManage && !siteManage.contains(e.target)) {
      closeSiteDropdown();
    }
  }
});

// 初始化站点列表
renderSiteList();

// 从 globalStorage 恢复选中的站点
(async () => {
  if (window.electronAPI && window.electronAPI.getGlobalData) {
    try {
      const savedSiteId = await window.electronAPI.getGlobalData('current_site_id');
      const savedSiteName = await window.electronAPI.getGlobalData('current_site_name');

      if (savedSiteId && savedSiteName) {
        currentSiteId = savedSiteId;
        if (currentSiteName) {
          currentSiteName.textContent = savedSiteName;
        }
        renderSiteList(); // 重新渲染以更新选中状态
        console.log('[Site] 已恢复站点:', savedSiteName);
      }
    } catch (err) {
      console.log('[Site] 恢复站点失败:', err);
    }
  }
})();

// UI 元素
const homeBtn = document.getElementById('homeBtn');
const backBtn = document.getElementById('backBtn');
const forwardBtn = document.getElementById('forwardBtn');
const refreshBtn = document.getElementById('refreshBtn');
const newWindowModeBtn = document.getElementById('newWindowModeBtn');
const urlInput = document.getElementById('urlInput');
const goBtn = document.getElementById('goBtn');
const devtoolsBtn = document.getElementById('devtoolsBtn');
const currentUrlDisplay = document.getElementById('currentUrl');

const toggleScriptBtn = document.getElementById('toggleScript');
// scriptPanel 已在文件开头定义，不再重复声明
const scriptUrlDisplay = document.getElementById('scriptUrl');
const scriptEditor = document.getElementById('scriptEditor');
const saveScriptBtn = document.getElementById('saveScriptBtn');
const executeNowBtn = document.getElementById('executeNowBtn');
const clearScriptBtn = document.getElementById('clearScriptBtn');

// 脚本管理元素
const scriptList = document.getElementById('scriptList');
const scriptCount = document.getElementById('scriptCount');
const importBtn = document.getElementById('importBtn');
const exportBtn = document.getElementById('exportBtn');
const openFolderBtn = document.getElementById('openFolderBtn');
const clearAllBtn = document.getElementById('clearAllBtn');

let currentUrl = '';

// 加载并显示脚本列表
async function loadScriptList() {
  const scripts = await window.electronAPI.getAllScripts();

  scriptCount.textContent = scripts.length;

  if (scripts.length === 0) {
    scriptList.innerHTML = '<div style="color: #95a5a6; font-size: 12px; text-align: center; padding: 10px;">暂无保存的脚本</div>';
    return;
  }

  scriptList.innerHTML = scripts.map(script => `
    <div class="script-item" data-url="${script.url}">
      <div class="script-item-url" title="${script.url}">${script.url}</div>
      <div class="script-item-size">${formatBytes(script.size)}</div>
      <button class="script-item-delete" data-url="${script.url}">删除</button>
    </div>
  `).join('');

  // 添加删除按钮事件
  scriptList.querySelectorAll('.script-item-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const url = btn.dataset.url;

      if (confirm(`确定要删除这个脚本吗？\n\n${url}`)) {
        const result = await window.electronAPI.deleteScript(url);
        if (result.success) {
          await loadScriptList();
          // 如果删除的是当前编辑的脚本，清空编辑器
          if (url === currentUrl) {
            scriptEditor.value = '';
          }
        } else {
          alert('删除失败：' + (result.error || '未知错误'));
        }
      }
    });
  });

  // 添加点击脚本项加载脚本
  scriptList.querySelectorAll('.script-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      if (e.target.classList.contains('script-item-delete')) return;

      const url = item.dataset.url;
      currentUrl = url;
      scriptUrlDisplay.textContent = url;
      urlInput.value = url;

      const script = await window.electronAPI.getInjectScript(url);
      scriptEditor.value = script;
    });
  });
}

// 格式化字节数
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// 导航功能
homeBtn.addEventListener('click', async () => {
  await window.electronAPI.goHome();
});

backBtn.addEventListener('click', async () => {
  await window.electronAPI.goBack();
});

forwardBtn.addEventListener('click', async () => {
  await window.electronAPI.goForward();
});

refreshBtn.addEventListener('click', async () => {
  await window.electronAPI.refreshPage();
});

devtoolsBtn.addEventListener('click', async () => {
  await window.electronAPI.openDevTools();
});

// 测试 Loading 效果按钮
const testLoadingBtn = document.getElementById('testLoadingBtn');
if (testLoadingBtn) {
  testLoadingBtn.addEventListener('click', async () => {
    // 模拟页面异常的脚本
    const testScript = `
      (function() {
        // 手动触发遮罩显示
        if (typeof window.hidePageAndShowMask === 'function') {
          window.hidePageAndShowMask();
          console.log('[测试] ✅ 已显示 Loading 遮罩');

          // 3秒后移除遮罩，恢复页面
          setTimeout(() => {
            const mask = document.getElementById('__page_loading_mask__');
            if (mask) mask.remove();
            document.body.style.visibility = '';
            document.body.style.opacity = '';
            console.log('[测试] ✅ 已恢复页面');
          }, 3000);
        } else {
          // 如果 common.js 未加载，手动创建遮罩
          document.body.style.visibility = 'hidden';
          document.body.style.opacity = '0';

          const mask = document.createElement('div');
          mask.id = '__page_loading_mask__';
          mask.innerHTML = '<style>@keyframes __loading_spin__{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style><div style="width:40px;height:40px;border:3px solid #f3f3f3;border-top:3px solid #3498db;border-radius:50%;animation:__loading_spin__ 1s linear infinite;"></div>';
          mask.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#fff;z-index:999999;display:flex;align-items:center;justify-content:center;';
          document.documentElement.appendChild(mask);

          console.log('[测试] ✅ 已显示 Loading 遮罩（手动创建）');

          // 3秒后恢复
          setTimeout(() => {
            const maskEl = document.getElementById('__page_loading_mask__');
            if (maskEl) maskEl.remove();
            document.body.style.visibility = '';
            document.body.style.opacity = '';
            console.log('[测试] ✅ 已恢复页面');
          }, 3000);
        }
      })()
    `;

    try {
      await window.electronAPI.executeScriptNow(testScript);
      console.log('[测试] 已执行测试脚本');
    } catch (err) {
      console.error('[测试] 执行失败:', err);
    }
  });
}

// 新窗口模式切换
newWindowModeBtn.addEventListener('click', async () => {
  const result = await window.electronAPI.toggleNewWindowMode();
  updateNewWindowModeButton(result.openInNewWindow);
});

// 更新新窗口模式按钮显示
function updateNewWindowModeButton(openInNewWindow) {
  if (openInNewWindow) {
    newWindowModeBtn.textContent = '🪟 新窗口';
    newWindowModeBtn.title = '当前模式：新窗口打开\n点击切换为当前窗口模式';
  } else {
    newWindowModeBtn.textContent = '🔗 当前窗口';
    newWindowModeBtn.title = '当前模式：当前窗口打开\n点击切换为新窗口模式';
  }
}

goBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (url) {
    await window.electronAPI.navigateTo(url);
  }
});

urlInput.addEventListener('keypress', async (e) => {
  if (e.key === 'Enter') {
    const url = urlInput.value.trim();
    if (url) {
      await window.electronAPI.navigateTo(url);
    }
  }
});

// 监听 URL 变化
window.electronAPI.onUrlChanged(async (url) => {
  currentUrl = url;
  currentUrlDisplay.textContent = url;
  urlInput.value = url;
  scriptUrlDisplay.textContent = url;

  // 更新公共头部的 Tab 选中状态
  updateActiveTab(url);

  // 加载该 URL 对应的脚本
  const savedScript = await window.electronAPI.getInjectScript(url);
  scriptEditor.value = savedScript;

  // 刷新脚本列表
  await loadScriptList();
});

// 脚本注入面板
if (toggleScriptBtn) {
  toggleScriptBtn.addEventListener('click', () => {
    console.log('按钮被点击了');

    // 检查面板当前状态
    const currentRight = window.getComputedStyle(scriptPanel).right;
    console.log('当前right值:', currentRight);

    // 判断面板是否打开
    const isOpen = currentRight === '0px';
    const willOpen = !isOpen;

    // 切换面板显示/隐藏
    if (willOpen) {
      scriptPanel.style.right = '0px';
      console.log('显示面板');
    } else {
      scriptPanel.style.right = '-400px';
      console.log('隐藏面板');
    }

    // 通知主进程调整 BrowserView 大小
    window.electronAPI.toggleScriptPanel(willOpen);

    // 延迟检查更新后的样式
    setTimeout(() => {
      console.log('更新后right值:', window.getComputedStyle(scriptPanel).right);
      console.log('面板位置:', scriptPanel.getBoundingClientRect());
    }, 100);
  });
}

if (saveScriptBtn) {
  saveScriptBtn.addEventListener('click', async () => {
    const script = scriptEditor.value;
    const result = await window.electronAPI.setInjectScript(currentUrl, script);

    if (result.success) {
      alert('脚本已保存到本地文件！下次访问此页面时会自动注入。');
      await loadScriptList(); // 刷新脚本列表
    } else {
      alert('保存失败！');
    }
  });
}

if (executeNowBtn) {
  executeNowBtn.addEventListener('click', async () => {
    const script = scriptEditor.value;
    if (!script.trim()) {
      alert('请输入脚本代码！');
      return;
    }

    const result = await window.electronAPI.executeScriptNow(script);

    if (result.success) {
      alert('脚本执行成功！');
    } else {
      alert('脚本执行失败：' + (result.error || '未知错误'));
    }
  });
}

if (clearScriptBtn) {
  clearScriptBtn.addEventListener('click', async () => {
    if (confirm('确定要清除此页面的注入脚本吗？')) {
      scriptEditor.value = '';
      await window.electronAPI.setInjectScript(currentUrl, '');
      await loadScriptList(); // 刷新脚本列表
      alert('脚本已清除！');
    }
  });
}

// 脚本管理按钮
if (importBtn) {
  importBtn.addEventListener('click', async () => {
    const result = await window.electronAPI.importScripts();

    if (result.canceled) return;

    if (result.success) {
      alert(`成功导入 ${result.count} 个脚本！`);
      await loadScriptList();
    } else {
      alert('导入失败：' + (result.error || '未知错误'));
    }
  });
}

if (exportBtn) {
  exportBtn.addEventListener('click', async () => {
    const result = await window.electronAPI.exportScripts();

    if (result.canceled) return;

    if (result.success) {
      alert(`成功导出 ${result.count} 个脚本！`);
    } else {
      alert('导出失败：' + (result.error || '未知错误'));
    }
  });
}

if (openFolderBtn) {
  openFolderBtn.addEventListener('click', async () => {
    await window.electronAPI.openScriptsFolder();
  });
}

if (clearAllBtn) {
  clearAllBtn.addEventListener('click', async () => {
    if (confirm('确定要清空所有已保存的脚本吗？此操作不可恢复！')) {
      const result = await window.electronAPI.clearAllScripts();

      if (result.success) {
        scriptEditor.value = '';
        await loadScriptList();
        alert('所有脚本已清空！');
      } else {
        alert('清空失败：' + (result.error || '未知错误'));
      }
    }
  });
}

// 加载用户信息
async function loadUserInfo() {
  if (!window.electronAPI || !window.electronAPI.getGlobalData) {
    console.log('[Common Header] electronAPI 不可用，无法加载用户信息');
    return;
  }

  try {
    // 检查当前是否在登录页
    const currentUrl = await window.electronAPI.getCurrentUrl();
    const isLoginPage = currentUrl && currentUrl.includes('login.html');
    const isGeoSystem = getCurrentSystem(currentUrl) === 'geo';

    // 如果在登录页，显示未登录状态
    if (isLoginPage) {
      var companyNameEl = document.getElementById('currentSiteName');
      var userPhoneEl = document.getElementById('userPhone');
      var userAvatarEl = document.getElementById('userAvatar');
      if (companyNameEl) {
        console.log(1)
        companyNameEl.textContent = '';
        companyNameEl.setAttribute('title', '');
        companyNameEl.style.visibility = 'visible';
      }
      if (userPhoneEl) userPhoneEl.textContent = '未登录';
      // 重置头像为默认
      if (userAvatarEl) {
        var avatarImg = userAvatarEl.querySelector('img');
        if (avatarImg) avatarImg.src = './assets/avatar.png';
      }
      console.log('[Common Header] 当前在登录页，显示未登录状态');
      return;
    }

    var userInfo = await window.electronAPI.getGlobalData('user_info');
    console.log('[Common Header] userInfo:', userInfo);

    if (userInfo) {
      // 更新公司名称（仅非 GEO 系统，GEO 系统显示站点名称）
      if (!isGeoSystem) {
        var companyNameEl = document.getElementById('currentSiteName');
        var currentSiteEl = document.getElementById('currentSite');
        if (companyNameEl && userInfo.companyName) {
          console.log(2)
          companyNameEl.textContent = userInfo.companyName;
          companyNameEl.setAttribute('title', userInfo.companyName);
          companyNameEl.style.visibility = 'visible';
          if (currentSiteEl) {
            currentSiteEl.title = userInfo.companyName;
          }
        }
      }

      // 更新用户手机号
      var userPhoneEl = document.getElementById('userPhone');
      var companyNameEl = document.getElementById('currentSiteName');
      if (companyNameEl){
        console.log(3)
        companyNameEl.textContent = await window.electronAPI.getGlobalData('current_site_name');
        companyNameEl.setAttribute('title', await window.electronAPI.getGlobalData('current_site_name'));
      }
      if (userPhoneEl) {
        userPhoneEl.textContent = '';
        if (userInfo.phone && userInfo.phone.length === 11) {
          userPhoneEl.textContent = userInfo.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
        }
      }

      // 更新用户头像
      var userAvatarEl = document.getElementById('userAvatar');
      if (userAvatarEl && userInfo.avatar) {
        var avatarImg = userAvatarEl.querySelector('img');
        if (avatarImg) {
          avatarImg.src = userInfo.avatar;
        }
      }
    } else {
      // 没有用户信息，隐藏公司名称区域（不显示"未登录"）
      if (!isGeoSystem) {
        var companyNameEl = document.getElementById('currentSiteName');
        if (companyNameEl) {
          console.log(4)
          companyNameEl.textContent = '';
          companyNameEl.setAttribute('title', '');
          companyNameEl.style.visibility = 'hidden';
        }
      }
      var userPhoneEl = document.getElementById('userPhone');
      if (userPhoneEl) userPhoneEl.textContent = '';
      var companyNameEl = document.getElementById('currentSiteName');
      if (companyNameEl){
        console.log(5)
        companyNameEl.textContent = await window.electronAPI.getGlobalData('current_site_name');
        companyNameEl.setAttribute('title', await window.electronAPI.getGlobalData('current_site_name'));
      }
    }
  } catch (err) {
    console.error('[Common Header] 加载用户信息失败:', err);
  }
}

// 站点管理相关元素
const siteManageEl = document.querySelector('.site-manage');
const currentSiteEl = document.getElementById('currentSite');
const currentSiteNameEl = document.getElementById('currentSiteName');
const siteDropdownEl = document.getElementById('siteDropdown');

// 当前站点列表缓存
let siteListCache = [];

// 获取站点列表 API
async function getSiteListApi() {
  const isDev = window.electronAPI && !window.electronAPI.isProduction;
  const apiBaseUrl = isDev ? 'https://jzt_dev_1.china9.cn/' : 'https://zhjzt.china9.cn/';
  const siteInfo = await window.electronAPI.getGlobalData('siteInfo');
  console.log("🚀 ~ getSiteListApi ~ siteInfo: ", siteInfo);
  let companyId = siteInfo.company_id;
  let siteId = siteInfo?.id;
  if(isDev){
    siteId = 255;
    companyId = 2;
  }

  const loginToken = String(await window.electronAPI.getGlobalData('login_token') || '');
  console.log('[Site] login_token:', loginToken, 'length:', loginToken.length);

  // 1.1
  const url1 = `${apiBaseUrl}newapi/site/lst?site_id=${siteId}&company_id=${companyId}`;
  console.log('[Site] 请求 site/lst:', url1);
  const response = await fetch(url1, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'token': loginToken,
      'access_token': loginToken,
    }
  });
  console.log('[Site] site/lst 响应状态:', response.status);
  if (!response.ok) {
    const errText = await response.text();
    console.error('[Site] site/lst 错误响应内容:', errText);
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const result = await response.json();

  // 2.0
  const userInfo = await window.electronAPI.getGlobalData('user_info');
  const result2Resp = await window.electronAPI.proxyFetch(`${apiBaseUrl}newapi/site/lsttwo?site_id=${siteId}&company_id=${companyId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'token': loginToken,
      'access_token': loginToken,
    },
  });
  console.log('[Site] site/lsttwo proxyFetch 结果:', result2Resp);
  if (!result2Resp.success || !result2Resp.ok) {
    console.error('[Site] site/lsttwo 错误详情:', JSON.stringify(result2Resp.data));
    throw new Error(`HTTP error! status: ${result2Resp.status || result2Resp.error}`);
  }
  const result2 = result2Resp.data;

  return result.data.concat(result2.data) || [];
}

// 切换站点 API
async function changeSiteApi(newSiteId, oldSiteId, companyId) {
  const isDev = window.electronAPI && !window.electronAPI.isProduction;
  const apiBaseUrl = isDev ? 'https://jzt_dev_1.china9.cn/' : 'https://zhjzt.china9.cn/';
  const token = await window.electronAPI.getGlobalData('login_token');

  const resp = await window.electronAPI.proxyFetch(`${apiBaseUrl}newapi/site/change?id=${newSiteId}&site_id=${oldSiteId}&company_id=${companyId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'token': token,
      'access_token': token,
    }
  });

  if (!resp.success || !resp.ok) {
    throw new Error(`HTTP error! status: ${resp.status || resp.error}`);
  }

  const result = resp.data;
  console.log('[Site] 切换站点接口返回:', result);
  return result;
}

// 选择站点
async function selectSite(site, skipApiCall = false) {
  const newName = site.web_name || '';
  const oldSiteId = currentSiteId;
  const isNewSite = currentSiteId !== site.id;

  // 只在需要时更新 DOM，避免跳动
  if (isNewSite) {
    currentSiteId = site.id;
  }

  if (currentSiteNameEl) {
    if (currentSiteNameEl.textContent !== newName) {
      currentSiteNameEl.textContent = newName;
      currentSiteNameEl.setAttribute('title', newName);
    }
    currentSiteNameEl.style.visibility = 'visible';
  }

  if (currentSiteEl && currentSiteEl.title !== newName) {
    currentSiteEl.title = newName;
  }

  // 更新下拉列表选中状态
  if (siteDropdownEl) {
    siteDropdownEl.querySelectorAll('.site-item').forEach(item => {
      item.classList.toggle('active', parseInt(item.dataset.siteId) === site.id);
    });
  }

  // 保存当前选择的站点
  if (window.electronAPI && window.electronAPI.setGlobalData) {
    await window.electronAPI.setGlobalData('current_site', site);
  }
  console.log('[Site] 已选择站点:', site);

  // 如果是切换到新站点，调用接口并刷新页面
  if (isNewSite && !skipApiCall && oldSiteId) {
    try {
      const siteInfo = await window.electronAPI.getGlobalData('siteInfo');
      let companyId = siteInfo.company_id;
      const isDev = window.electronAPI && !window.electronAPI.isProduction;
      if(isDev){
        companyId = 2
      }
      await changeSiteApi(site.id, oldSiteId, companyId);
      console.log('[Site] 切换站点成功');

      // 更新 Cookie 中的 site_id
      const cookieDomain = '.china9.cn';
      const cookieUrl = 'https://zhjzt.china9.cn';
      await window.electronAPI.setCookie({
        url: cookieUrl,
        name: 'site_id',
        value: String(site.id),
        domain: cookieDomain,
        path: '/',
        secure: true,
        httpOnly: false
      });
      console.log('[Site] ✅ 已更新 Cookie site_id:', site.id);

      // 显示全局加载遮罩（隐藏 BrowserView，让遮罩覆盖整个浏览器）
      const loadingMask = document.getElementById('__global_loading_mask__');
      if (loadingMask) {
        loadingMask.classList.add('show');
      }
      await window.electronAPI.showGlobalLoading();
      console.log('[Site] 显示加载遮罩，隐藏 BrowserView');

      // 刷新 BrowserView 页面
      console.log('[Site] 刷新页面...');
      setTimeout(async () => {
        if(site.tz_url){
          window.electronAPI.navigateTo(site.tz_url);
        }else{
          await window.electronAPI.refreshPage();
        }

        // 刷新后隐藏遮罩、恢复 BrowserView
        setTimeout(async () => {
          await window.electronAPI.hideGlobalLoading();
          if (loadingMask) {
            loadingMask.classList.remove('show');
          }
          console.log('[Site] 隐藏加载遮罩，恢复 BrowserView');
        }, 500);
      }, 2000)
    } catch (err) {
      console.error('[Site] 切换站点接口失败:', err);
      // 出错时隐藏遮罩、恢复 BrowserView
      await window.electronAPI.hideGlobalLoading();
      const loadingMask = document.getElementById('__global_loading_mask__');
      if (loadingMask) {
        loadingMask.classList.remove('show');
      }
    }
  }
}

// 加载站点列表（根据当前系统类型决定是否显示）
async function loadSiteList(url) {
  try {
    const currentUrl = url || await window.electronAPI.getCurrentUrl();
    const system = getCurrentSystem(currentUrl);

    // 获取站点管理元素（每次重新获取，确保能找到）
    const siteManage = document.querySelector('.site-manage');

    console.log('[Site] 当前系统:', system, '当前URL:', currentUrl);
    console.log('[Site] siteManage 元素:', siteManage);

    // 只有 GEO 系统才显示站点管理
    if (system !== 'geo') {
      console.log('[Site] 进入非GEO分支');
      // 非 GEO 系统，清空站点缓存
      siteListCache = [];
      if (siteManage) {
        siteManage.style.display = 'none';
        console.log('[Site] 非GEO系统，已隐藏站点管理');
      } else {
        console.log('[Site] 非GEO系统，但找不到站点管理元素');
      }
      return;
    }

    console.log('[Site] 进入GEO分支，准备加载站点列表');

    // GEO 系统显示站点管理
    if (siteManage) {
      siteManage.style.display = '';
    }

    // 先清空缓存，确保获取新数据
    siteListCache = [];

    // 加载站点列表
    const siteData = await getSiteListApi();
    console.log('[Site] 站点数据:', siteData);

    // 处理返回的数据结构（可能是数组或对象）
    const sites = Array.isArray(siteData) ? siteData : (siteData?.list || [siteData]);
    siteListCache = sites;
    if(sites.length === 0){
      console.log('[Site] 没有站点列表，跳转到功能暂未开放页面');

      var companyNameEl = document.getElementById('currentSiteName');
      if (companyNameEl) {
        await window.electronAPI.getGlobalData('current_site_name');
      }
      // 添加 system=geo 参数，让占位页保持 GEO Tab 选中状态
      const notAvailablePath = 'file:///' + __dirname.replace(/\\/g, '/') + '/' + PLACEHOLDER_PAGES[0] + '?system=geo';
      await window.electronAPI.navigateCurrentWindow(notAvailablePath);
      return;
    }

    // 恢复之前选择的站点，或默认选择第一个（跳过接口调用）
    const savedSite = await window.electronAPI.getGlobalData('current_site');
    if (savedSite && sites.find(s => s.id === savedSite.id)) {
      await selectSite(savedSite, true); // 恢复时跳过接口调用
    } else if (sites.length > 0) {
      await selectSite(sites[0], true); // 默认选择时跳过接口调用
    }

  } catch (err) {
    console.error('[Site] loadSiteList 出错:', err);
  }
}

// 站点下拉菜单点击事件 - 使用原生菜单（能浮在 BrowserView 之上）
if (currentSiteEl) {
  currentSiteEl.addEventListener('click', async (e) => {
    e.stopPropagation();

    // 使用原生菜单，可以悬浮在 BrowserView 之上
    if (window.electronAPI && window.electronAPI.showSiteMenu && siteListCache.length > 0) {
      console.log('[Site Dropdown] 显示原生菜单, 站点数量:', siteListCache.length);
      const result = await window.electronAPI.showSiteMenu(siteListCache, currentSiteId);
      console.log('[Site Dropdown] 菜单选择结果:', result);

      if (result && result.selected) {
        // 用户选择了站点，从缓存中找到完整的站点对象
        const selectedSite = siteListCache.find(s => s.id === result.siteId);
        if (selectedSite) {
          await selectSite(selectedSite);
        }
      }
    } else {
      console.log('[Site Dropdown] 原生菜单不可用或站点列表为空');
    }
  });
}

// 点击其他地方关闭下拉菜单
document.addEventListener('click', (e) => {
  if (siteDropdownEl && !siteDropdownEl.contains(e.target) && !currentSiteEl?.contains(e.target)) {
    siteDropdownEl.classList.remove('show');
    if (currentSiteEl) currentSiteEl.classList.remove('active');
  }
});

// 初始化
(async () => {
  console.log('[初始化] 开始...');

  // 立即从存储中恢复站点名称，避免显示跳动
  try {
    const savedSite = await window.electronAPI.getGlobalData('current_site');
    if (savedSite && savedSite.web_name) {
      const siteNameEl = document.getElementById('currentSiteName');
      if (siteNameEl) {
        siteNameEl.textContent = savedSite.web_name;
        siteNameEl.style.visibility = 'visible';
      }
      currentSiteId = savedSite.id;
      console.log('[初始化] 已恢复站点:', savedSite.web_name);
    }
  } catch (err) {
    console.log('[初始化] 恢复站点失败:', err);
  }

  // 先加载用户信息（放在最前面，避免被其他错误中断）
  try {
    await loadUserInfo();
    console.log('[初始化] loadUserInfo 完成');
  } catch (err) {
    console.error('[初始化] loadUserInfo 失败:', err);
  }

  // 确保面板初始状态正确
  if (scriptPanel) {
    scriptPanel.style.right = '-400px';
    scriptPanel.style.display = 'flex';
  }
  console.log('[初始化] scriptPanel 设置完成');

  // 初始化新窗口模式按钮状态
  try {
    const modeResult = await window.electronAPI.getNewWindowMode();
    updateNewWindowModeButton(modeResult.openInNewWindow);
    console.log('[初始化] newWindowMode 完成');
  } catch (err) {
    console.error('[初始化] newWindowMode 失败:', err);
  }

  // 加载脚本列表
  try {
    await loadScriptList();
    console.log('[初始化] loadScriptList 完成');
  } catch (err) {
    console.error('[初始化] loadScriptList 失败:', err);
  }

  const url = await window.electronAPI.getCurrentUrl();
  console.log('[初始化] 当前URL:', url);

  // 根据系统类型设置站点管理的初始显示状态
  const initSystem = getCurrentSystem(url);
  const siteManageInit = document.querySelector('.site-manage');
  if (siteManageInit) {
    siteManageInit.style.display = initSystem === 'geo' ? '' : 'none';
    console.log('[初始化] 站点管理初始状态:', initSystem === 'geo' ? '显示' : '隐藏');
  }

  if (url) {
    currentUrl = url;
    if (currentUrlDisplay) currentUrlDisplay.textContent = url;
    if (urlInput) urlInput.value = url;
    if (scriptUrlDisplay) scriptUrlDisplay.textContent = url;

    // 初始化公共头部的 Tab 选中状态
    console.log('[初始化] 准备调用 updateActiveTab');
    updateActiveTab(url);
    console.log('[初始化] updateActiveTab 完成');

    // 加载站点列表（根据系统类型显示/隐藏）
    try {
      console.log('[初始化] 准备调用 loadSiteList');
      await loadSiteList(url);
      console.log('[初始化] loadSiteList 完成');
    } catch (err) {
      console.error('[初始化] loadSiteList 失败:', err);
    }

    try {
      const savedScript = await window.electronAPI.getInjectScript(url);
      if (scriptEditor) scriptEditor.value = savedScript;
    } catch (err) {
      console.error('[初始化] getInjectScript 失败:', err);
    }
  } else {
    // 默认选中 AIGC Tab
    updateActiveTab('');
  }

  console.log('[初始化] 完成');

  // 防抖：记录上次加载的系统类型和时间，避免重复调用
  let lastSystem = url ? getCurrentSystem(url) : '';
  let lastLoadTime = Date.now();
  let isLoadingSiteList = false;

  // 监听 URL 变化事件
  if (window.electronAPI && window.electronAPI.onUrlChanged) {
    window.electronAPI.onUrlChanged(async (newUrl) => {
      console.log('[URL Changed]', newUrl);

      // URL 变化时重新加载用户信息（解决登录后跳转用户信息不更新的问题）
      try {
        await loadUserInfo();
      } catch (err) {
        console.error('[URL Changed] loadUserInfo 失败:', err);
      }

      const newSystem = getCurrentSystem(newUrl);

      currentUrl = newUrl;
      if (currentUrlDisplay) currentUrlDisplay.textContent = newUrl;
      if (urlInput) urlInput.value = newUrl;
      if (scriptUrlDisplay) scriptUrlDisplay.textContent = newUrl;

      // 更新 Tab 选中状态
      updateActiveTab(newUrl);

      // 立即更新站点管理的显示/隐藏状态（不受防抖影响）
      const siteManage = document.querySelector('.site-manage');
      if (siteManage) {
        siteManage.style.display = newSystem === 'geo' ? '' : 'none';
        console.log('[URL Changed] 站点管理显示:', newSystem === 'geo' ? '显示' : '隐藏');
      }

      // 防抖：如果系统类型相同且距离上次不到 1000ms，跳过 API 调用
      const now = Date.now();
      if (newSystem === lastSystem && now - lastLoadTime < 1000) {
        console.log('[URL Changed] 跳过 API 调用，系统类型未变化:', newSystem);
        return;
      }

      // 如果正在加载中，跳过 API 调用
      if (isLoadingSiteList) {
        console.log('[URL Changed] 跳过 API 调用，正在加载中');
        return;
      }

      // 只有 GEO 系统才需要加载站点列表
      if (newSystem !== 'geo') {
        lastSystem = newSystem;
        lastLoadTime = now;
        return;
      }

      lastSystem = newSystem;
      lastLoadTime = now;

      // 加载站点列表
      isLoadingSiteList = true;
      loadSiteList(newUrl)
        .catch(err => {
          console.error('[URL Changed] loadSiteList 失败:', err);
        })
        .finally(() => {
          isLoadingSiteList = false;
        });

      // 加载对应的脚本
      window.electronAPI.getInjectScript(newUrl).then(script => {
        if (scriptEditor) scriptEditor.value = script;
      });
    });
  }

  console.log('初始化完成，面板初始位置:', window.getComputedStyle(scriptPanel).right);
})();
