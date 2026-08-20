// 诊断工具：检查首页一直转圈的原因
// 使用方法：在浏览器按 F12，打开 Console，粘贴运行此代码

(function diagnoseLoadingSpinner() {
    console.log('%c========== 首页加载诊断工具 ==========', 'color: #2196F3; font-size: 16px; font-weight: bold');

    // 1. 页面基本信息
    console.log('%c[1] 页面基本信息', 'color: #FF9800; font-weight: bold; font-size: 14px');
    console.log('  当前 URL:', window.location.href);
    console.log('  readyState:', document.readyState);
    console.log('  body 存在:', !!document.body);
    console.log('  body HTML 长度:', (document.body?.innerHTML || '').length);
    console.log('  body 文本长度:', (document.body?.innerText || '').trim().length);
    console.log('  body 子元素数:', document.body?.children?.length || 0);

    // 2. 检查关键元素（Vue/React 应用）
    console.log('%c[2] 关键元素检测', 'color: #FF9800; font-weight: bold; font-size: 14px');
    const keySelectors = [
        '#app',           // Vue 根元素
        '#root',          // React 根元素
        '#__nuxt',        // Nuxt 根元素
        '#layout',        // 通用布局元素
        '[data-v-app]',   // Vue app 属性
        'main',           // 主内容区
        'header',         // 页头
        'nav',            // 导航
    ];
    keySelectors.forEach(selector => {
        const el = document.querySelector(selector);
        if (el) {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            console.log(`  ${selector}:`, {
                存在: true,
                可见: style.display !== 'none' && style.visibility !== 'hidden',
                尺寸: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
                子元素: el.children.length
            });
        } else {
            console.log(`  ${selector}: ❌ 不存在`);
        }
    });

    // 3. 检查是否有 loading 遮罩
    console.log('%c[3] Loading 遮罩检测', 'color: #FF9800; font-weight: bold; font-size: 14px');
    const loadingSelectors = [
        '.loading',
        '.spinner',
        '.ant-spin',
        '.el-loading-mask',
        '.nprogress-busy',
        '.v-progress-circular',
        '[class*="loading"]',
        '[class*="spinner"]',
    ];
    loadingSelectors.forEach(selector => {
        const el = document.querySelector(selector);
        if (el) {
            const style = window.getComputedStyle(el);
            console.log(`  ${selector}:`, {
                存在: true,
                可见: style.display !== 'none',
                zIndex: style.zIndex
            });
        }
    });

    // 4. 可见元素统计
    console.log('%c[4] 可见元素统计', 'color: #FF9800; font-weight: bold; font-size: 14px');
    const hasVisibleElement = (el, minSize = 24) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number(style.opacity || '1') !== 0
            && rect.width >= minSize
            && rect.height >= minSize;
    };
    const allElements = Array.from(document.querySelectorAll('body *'));
    const visibleElements = allElements.slice(0, 100).filter(el => hasVisibleElement(el, 12));
    console.log('  前 100 个元素中可见的:', visibleElements.length, '个');
    console.log('  body 尺寸:', {
        width: Math.round(document.body.getBoundingClientRect().width),
        height: Math.round(document.body.getBoundingClientRect().height)
    });

    // 5. 检查是否是源代码文本页（CSS/JSON）
    console.log('%c[5] 页面类型检测', 'color: #FF9800; font-weight: bold; font-size: 14px');
    const bodyText = (document.body?.innerText || '').trim();
    const bodyTextPreview = bodyText.slice(0, 500);
    const cssPatterns = [/@charset/i, /@font-face/i, /display\s*:\s*flex/i, /position\s*:\s*absolute/i];
    const jsonPatterns = [/"userAgent"/, /"appViewConfig"/, /"layerId"/];
    const cssMatchCount = cssPatterns.filter(p => p.test(bodyTextPreview)).length;
    const jsonMatchCount = jsonPatterns.filter(p => p.test(bodyTextPreview)).length;
    const startsLikeJson = /^[\[{]/.test(bodyTextPreview);

    console.log('  body 文本预览:', bodyTextPreview.slice(0, 200));
    console.log('  CSS 特征匹配:', cssMatchCount, '个');
    console.log('  JSON 特征匹配:', jsonMatchCount, '个');
    console.log('  看起来像 CSS 源码:', cssMatchCount >= 3);
    console.log('  看起来像 JSON 源码:', startsLikeJson && jsonMatchCount >= 2);

    // 6. 控制台错误
    console.log('%c[6] 控制台错误', 'color: #FF9800; font-weight: bold; font-size: 14px');
    console.log('  请向上查看是否有红色错误信息');

    // 7. 给出诊断建议
    console.log('%c========== 诊断建议 ==========', 'color: #4CAF50; font-size: 16px; font-weight: bold');

    const bodyHtmlLen = (document.body?.innerHTML || '').length;
    const bodyTextLen = bodyText.length;
    const childCount = document.body?.children?.length || 0;
    const hasAppRoot = !!document.querySelector('#app, #root, #__nuxt');
    const hasVisibleContent = visibleElements.length >= 2;

    if (bodyHtmlLen < 100) {
        console.log('%c❌ 页面几乎没有内容（HTML < 100 字符）', 'color: #f44336; font-weight: bold');
        console.log('   可能原因：页面加载失败、被拦截、或权限问题');
    } else if (cssMatchCount >= 3 && childCount <= 2) {
        console.log('%c❌ 页面显示的是 CSS 源代码文本', 'color: #f44336; font-weight: bold');
        console.log('   原因：浏览器将 CSS 文件当成 HTML 渲染了');
        console.log('   解决方案：需要修复路由或刷新页面');
    } else if (startsLikeJson && jsonMatchCount >= 2 && childCount <= 2) {
        console.log('%c❌ 页面显示的是 JSON 源代码文本', 'color: #f44336; font-weight: bold');
        console.log('   原因：浏览器将 JSON 数据当成 HTML 渲染了');
        console.log('   解决方案：需要修复路由或刷新页面');
    } else if (!hasAppRoot) {
        console.log('%c⚠️ 未找到 Vue/React 根元素 (#app / #root)', 'color: #ff9800; font-weight: bold');
        console.log('   可能原因：SPA 应用尚未初始化、JavaScript 报错');
        console.log('   解决方案：检查上方控制台错误，或等待更长时间');
    } else if (!hasVisibleContent) {
        console.log('%c⚠️ 页面有元素但都不可见', 'color: #ff9800; font-weight: bold');
        console.log('   可能原因：CSS 未加载、元素被隐藏、渲染错误');
        console.log('   解决方案：检查网络面板 CSS 是否加载成功');
    } else {
        console.log('%c✅ 页面看起来已正常渲染', 'color: #4CAF50; font-weight: bold');
        console.log('   但浏览器仍显示转圈，可能是守卫判定过于严格');
        console.log('   请将此诊断结果截图发给开发者');
    }

    console.log('%c========== 诊断完成 ==========', 'color: #2196F3; font-size: 16px; font-weight: bold');

    // 返回诊断结果供程序化调用
    return {
        url: window.location.href,
        htmlLength: bodyHtmlLen,
        textLength: bodyTextLen,
        childCount: childCount,
        hasAppRoot: hasAppRoot,
        hasVisibleContent: hasVisibleContent,
        looksLikeCssSource: cssMatchCount >= 3 && childCount <= 2,
        looksLikeJsonSource: startsLikeJson && jsonMatchCount >= 2 && childCount <= 2
    };
})();
