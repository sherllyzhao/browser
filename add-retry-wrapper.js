/**
 * 为所有平台的发布脚本添加外层兜底重试
 * 使用方法：在每个平台的 fillFormData 函数最外层添加重试包装
 */

// 通用的重试包装模板
const RETRY_WRAPPER_TEMPLATE = `
// 🔴 将所有核心填表逻辑包装在一个函数中，便于外层兜底重试
const executeAllFormSteps = async () => {
  // ===== 原有的所有填表逻辑放这里 =====
  __ORIGINAL_LOGIC__
  // ===== 原有逻辑结束 =====
};

// 🔴 最外层兜底重试：即使单步骤重试都失败，外层还会重试整个流程2次
try {
  await retryOperation(executeAllFormSteps, 2, 3000);
  console.log('[__PLATFORM__] ✅ 所有表单填写完成');
} catch (finalError) {
  console.error('[__PLATFORM__] ❌ 填表流程失败（外层重试2次后）:', finalError);
  stopErrorListener?.();
  const publishId = dataObj?.video?.dyPlatform?.id || dataObj?.video?.formData?.id;
  if (publishId) {
    await sendStatisticsError(publishId, finalError.message || '填写表单失败', '__PLATFORM__');
  }
  await closeWindowWithMessage('填写表单失败，刷新数据', 1000);
}
`;

// 各平台的配置
const PLATFORMS = [
  { file: 'douyin-publish.js', name: '抖音发布' },
  { file: 'xiaohongshu-publish.js', name: '小红书发布' },
  { file: 'baijiahao-publish.js', name: '百家号发布' },
  { file: 'shipinhao-publish.js', name: '视频号发布' },
  { file: 'toutiao-publish.js', name: '头条发布' },
  { file: 'zhihu-publish.js', name: '知乎发布' },
  { file: 'souhuhao-publish.js', name: '搜狐号发布' },
  { file: 'wangyihao-publish.js', name: '网易号发布' },
  { file: 'tengxvnhao-publish.js', name: '腾讯号发布' }
];

console.log('所有平台需要手动添加外层重试包装：');
console.log('1. 找到 fillFormData 函数');
console.log('2. 将核心逻辑包装到 executeAllFormSteps 函数中');
console.log('3. 用 retryOperation 包装 executeAllFormSteps');
console.log('');
console.log('模板：');
console.log(RETRY_WRAPPER_TEMPLATE);
