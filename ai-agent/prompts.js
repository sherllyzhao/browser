/**
 * AI Agent Prompt 模板
 * 用于页面分析、表单填写、结果检测
 */

const ANALYZE_PAGE_PROMPT = `你是一个网页表单自动化助手，同时也是一个负责验收自动化结果的测试员。你的任务是分析网页的 DOM 结构，识别所有可交互的表单元素，并根据用户提供的发布数据生成精确的填写指令。在输出动作前，你还要从测试员视角检查这些动作是否会遗漏必填字段、误操作无关区域，或导致流程无法按预期执行。

## 规则
1. 只返回纯 JSON，不要包含 markdown 代码块标记、解释或其他文字
2. selector 必须是页面中存在的、能唯一定位元素的 CSS 选择器
3. 对于 contenteditable 的富文本编辑器，使用 fill_rich 动作
4. 对于普通 input/textarea，使用 fill 动作
5. 对于需要点击选择的（如下拉菜单），使用 click 然后 fill 或 click 选项
6. 将"发布"或"提交"按钮的操作放在最后，action 设为 "publish"
7. 如果有文件上传区域（视频/图片），action 设为 "upload"，标注 field 字段名
8. 忽略不相关的元素（导航栏、侧边栏、广告等）
9. 如果页面不是表单/发布页面，返回 {"isForm": false, "reason": "原因说明"}
10. 只能为“发布数据中明确存在且非空”的字段生成 fill / fill_rich / select / check / click 动作
11. 如果某个字段没有对应参数，禁止为了“清空”“占位”“默认值”去点击或填写相关 DOM
12. publish 动作可以保留在最后，但前置字段动作必须严格受发布参数约束
13. 以测试员视角自检生成的动作，确保关键字段与发布参数一致，且不会因为缺少前置步骤而无法执行
14. 如果页面状态不足以支持可靠执行，返回 {"isForm": false, "reason": "原因说明"}，不要猜测
15. 注意操作后的提示信息，自行分析是成功还是失败或是无关紧要的提示，根据提示信息判断是否需要继续执行后续动作
16. 自行处理弹窗、确认框等交互元素，确保不会因为弹窗而影响自动化流程

## 返回格式
{
  "isForm": true,
  "pageName": "页面名称（如：抖音视频发布页）",
  "actions": [
    {"step": 1, "action": "fill", "selector": "CSS选择器", "value": "要填写的值", "description": "填写标题"},
    {"step": 2, "action": "fill_rich", "selector": "CSS选择器", "value": "要填写的值", "description": "填写正文"},
    {"step": 3, "action": "click", "selector": "CSS选择器", "description": "展开分类下拉"},
    {"step": 4, "action": "upload", "selector": "CSS选择器", "field": "video_url", "description": "上传视频"},
    {"step": 5, "action": "publish", "selector": "CSS选择器", "description": "点击发布按钮"}
  ]
}`;

const DETECT_RESULT_PROMPT = `你是一个网页状态分析助手，同时也是修改完成后的测试员。用户刚刚点击了发布/提交按钮，请分析当前页面的 DOM 状态，判断操作是否成功，并从测试验收角度确认当前结果是否说明流程按预期工作。

## 判断依据
1. 成功标志：出现"发布成功"、"已发布"、"提交成功"等提示；页面跳转到作品管理/列表页；出现成功图标/动画
2. 失败标志：出现错误提示（红色文字、toast、弹窗）；表单字段标红/报错；出现"请填写"、"格式错误"等提示
3. 进行中：页面仍在加载、有 loading 动画、进度条未完成
4. 不确定：页面没有明显的成功或失败标志

## 规则
1. 只返回纯 JSON，不要包含 markdown 代码块标记或其他文字
2. 如果有具体的错误信息，完整提取到 errorDetail 中
3. 优先判断是否满足“按预期工作”的验收标准；只有完成检测后，才允许认为可以通知用户验收
4. 如果证据不足，不要把结果判定为 success，应返回 unknown 或 pending 并说明原因

## 返回格式
{
  "status": "success" | "failed" | "pending" | "unknown",
  "message": "结果的简短描述",
  "errorDetail": "如果失败，具体的错误信息（无则为空字符串）"
}`;

/**
 * 构建页面分析的用户消息
 * @param {Object} domData - 精简的 DOM 结构
 * @param {Object} publishData - 发布数据
 * @returns {Array} messages 数组
 */
function buildAnalyzeMessages(domData, publishData) {
  // 精简 publishData，只保留需要填写的字段
  const simplifiedData = simplifyPublishData(publishData);

  return [
    { role: 'system', content: ANALYZE_PAGE_PROMPT },
    {
      role: 'user',
      content: `页面DOM结构:${JSON.stringify(domData)}\n发布数据:${JSON.stringify(simplifiedData)}`
    }
  ];
}

/**
 * 构建结果检测的用户消息
 * @param {Object} domData - 点击发布后的 DOM 结构
 * @returns {Array} messages 数组
 */
function buildDetectMessages(domData) {
  return [
    { role: 'system', content: DETECT_RESULT_PROMPT },
    {
      role: 'user',
      content: `点击发布后的页面状态:${JSON.stringify(domData)}`
    }
  ];
}

/**
 * 精简发布数据，去掉不需要填写的字段（如 ID、时间戳等）
 */
function simplifyPublishData(data) {
  if (!data) return {};
  const result = {};
  const MAX_STRING_LENGTH = 500;
  const MAX_ARRAY_ITEMS = 10;
  const keepLeafFields = [
    'title', 'content', 'description', 'intro', 'tags', 'keywords',
    'category', 'cover', 'video_url', 'image_urls', 'sendlog',
    'text', 'summary', 'topic', 'topics', 'send_time', 'send_set',
    'url', 'label', 'caption'
  ];

  function truncateString(value) {
    const str = String(value || '');
    return str.length > MAX_STRING_LENGTH ? `${str.slice(0, MAX_STRING_LENGTH)}...` : str;
  }

  function isRelevantMediaPath(path, key) {
    const lowerPath = `${path}.${key}`.toLowerCase();
    return (
      lowerPath.includes('video') ||
      lowerPath.includes('image') ||
      lowerPath.includes('cover') ||
      lowerPath.includes('thumb')
    );
  }

  function shouldKeepPrimitive(key, path) {
    const lowerKey = key.toLowerCase();
    if (keepLeafFields.includes(lowerKey)) {
      if (lowerKey === 'url') {
        return isRelevantMediaPath(path, key);
      }
      return true;
    }
    return false;
  }

  function normalizeArray(arr) {
    return arr
      .slice(0, MAX_ARRAY_ITEMS)
      .map(item => {
        if (item == null) return null;
        if (typeof item === 'string') return truncateString(item);
        if (typeof item === 'number' || typeof item === 'boolean') return item;
        return null;
      })
      .filter(item => item !== null);
  }

  function extract(obj, prefix = '') {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;

      if (value == null) continue;

      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        if (shouldKeepPrimitive(key, prefix)) {
          result[path] = typeof value === 'string' ? truncateString(value) : value;
        }
        continue;
      }

      if (Array.isArray(value)) {
        if (shouldKeepPrimitive(key, prefix)) {
          const normalized = normalizeArray(value);
          if (normalized.length > 0) {
            result[path] = normalized;
          }
        }
        continue;
      }

      if (typeof value === 'object') {
        extract(value, path);
      }
    }
  }

  extract(data);
  return result;
}

module.exports = {
  ANALYZE_PAGE_PROMPT,
  DETECT_RESULT_PROMPT,
  buildAnalyzeMessages,
  buildDetectMessages,
  simplifyPublishData,
};

