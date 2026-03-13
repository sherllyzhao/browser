"""
分析头条发布页的 JS 文件，检测 Chromium 106 不支持的 API
"""
from playwright.sync_api import sync_playwright
import re

# Chromium 106 不支持的 API 列表
MODERN_APIS = [
    # Chrome 110+
    (r'\btoSorted\b', 'Array.toSorted (Chrome 110+)'),
    (r'\btoReversed\b', 'Array.toReversed (Chrome 110+)'),
    (r'\btoSpliced\b', 'Array.toSpliced (Chrome 110+)'),
    (r'\.with\s*\(', 'Array.with (Chrome 110+)'),
    # Chrome 111+
    (r'\bisWellFormed\b', 'String.isWellFormed (Chrome 111+)'),
    (r'\btoWellFormed\b', 'String.toWellFormed (Chrome 111+)'),
    # Chrome 117+
    (r'Object\.groupBy\b', 'Object.groupBy (Chrome 117+)'),
    (r'Map\.groupBy\b', 'Map.groupBy (Chrome 117+)'),
    # Chrome 119+
    (r'Promise\.withResolvers\b', 'Promise.withResolvers (Chrome 119+)'),
    # Chrome 122+
    (r'\.intersection\b', 'Set.intersection (Chrome 122+)'),
    (r'\.symmetricDifference\b', 'Set.symmetricDifference (Chrome 122+)'),
    # Other
    (r'\bstructuredClone\b', 'structuredClone (Chrome 98+, should be fine)'),
    (r'\.at\s*\(', '.at() (Chrome 92+, should be fine)'),
    (r'\bhasOwn\b', 'Object.hasOwn (Chrome 93+, should be fine)'),
    (r'crypto\.randomUUID', 'crypto.randomUUID (Chrome 92+)'),
    # CSS/DOM newer APIs
    (r'\bcontentVisibility\b', 'content-visibility (Chrome 85+)'),
    (r'\bnavigation\b\.', 'Navigation API (Chrome 102+)'),
    (r'\bscheduler\b\.', 'Scheduler API (Chrome 94+)'),
]

def main():
    js_errors = []
    js_urls = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36'
        )
        page = context.new_page()

        # 捕获 console 错误
        page.on('console', lambda msg: js_errors.append(f'[{msg.type}] {msg.text}') if msg.type in ('error', 'warning') else None)

        # 捕获 JS 文件 URL
        page.on('response', lambda resp: js_urls.append(resp.url) if '.js' in resp.url and resp.status == 200 else None)

        print('=== 导航到头条创作平台 ===')
        try:
            page.goto('https://mp.toutiao.com/profile_v4/graphic/publish', timeout=15000, wait_until='domcontentloaded')
        except Exception as e:
            print(f'导航异常（可能重定向到登录页）: {e}')

        page.wait_for_timeout(5000)

        # 截图
        page.screenshot(path='/tmp/toutiao_page.png', full_page=True)
        print(f'\n截图已保存: /tmp/toutiao_page.png')
        print(f'当前 URL: {page.url}')

        # 输出 console 错误
        print(f'\n=== Console 错误/警告 ({len(js_errors)} 条) ===')
        for err in js_errors[:20]:
            print(f'  {err}')

        # 分析 JS 文件
        print(f'\n=== 加载的 JS 文件 ({len(js_urls)} 个) ===')
        api_findings = {}

        for url in js_urls:
            if 'toutiao.com' not in url and 'bytedance' not in url and 'snssdk' not in url:
                continue
            try:
                resp = page.request.get(url)
                if resp.ok:
                    content = resp.text()
                    for pattern, api_name in MODERN_APIS:
                        matches = re.findall(pattern, content)
                        if matches and 'should be fine' not in api_name:
                            if api_name not in api_findings:
                                api_findings[api_name] = []
                            short_url = url.split('/')[-1][:60]
                            api_findings[api_name].append(f'{short_url} ({len(matches)} matches)')
            except Exception as e:
                pass

        print(f'\n=== 检测到的现代 API（Chromium 106 不支持） ===')
        if api_findings:
            for api, files in sorted(api_findings.items()):
                print(f'\n  ❌ {api}:')
                for f in files[:3]:
                    print(f'     - {f}')
        else:
            print('  ✅ 未检测到明显的不兼容 API（可能需要登录后分析发布页 JS）')

        browser.close()

    print('\n=== 分析完成 ===')

if __name__ == '__main__':
    main()
