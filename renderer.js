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
const scriptPanel = document.getElementById('scriptPanel');
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

  // 加载该 URL 对应的脚本
  const savedScript = await window.electronAPI.getInjectScript(url);
  scriptEditor.value = savedScript;

  // 刷新脚本列表
  await loadScriptList();
});

// 脚本注入面板
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

clearScriptBtn.addEventListener('click', async () => {
  if (confirm('确定要清除此页面的注入脚本吗？')) {
    scriptEditor.value = '';
    await window.electronAPI.setInjectScript(currentUrl, '');
    await loadScriptList(); // 刷新脚本列表
    alert('脚本已清除！');
  }
});

// 脚本管理按钮
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

exportBtn.addEventListener('click', async () => {
  const result = await window.electronAPI.exportScripts();

  if (result.canceled) return;

  if (result.success) {
    alert(`成功导出 ${result.count} 个脚本！`);
  } else {
    alert('导出失败：' + (result.error || '未知错误'));
  }
});

openFolderBtn.addEventListener('click', async () => {
  await window.electronAPI.openScriptsFolder();
});

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

// 初始化
(async () => {
  // 确保面板初始状态正确
  scriptPanel.style.right = '-400px';
  scriptPanel.style.display = 'flex'; // 确保面板是显示的

  // 初始化新窗口模式按钮状态
  const modeResult = await window.electronAPI.getNewWindowMode();
  updateNewWindowModeButton(modeResult.openInNewWindow);

  // 加载脚本列表
  await loadScriptList();

  const url = await window.electronAPI.getCurrentUrl();
  if (url) {
    currentUrl = url;
    currentUrlDisplay.textContent = url;
    urlInput.value = url;
    scriptUrlDisplay.textContent = url;

    const savedScript = await window.electronAPI.getInjectScript(url);
    scriptEditor.value = savedScript;
  }

  console.log('初始化完成，面板初始位置:', window.getComputedStyle(scriptPanel).right);
})();
