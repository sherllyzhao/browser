/**
 * sync-features-version.js
 * 打包前置脚本：自动同步 common.js 中的特性开关版本号
 *
 * 使用场景：
 * - 每次改 package.json 版本后，打包前自动检查并更新 common.js 中
 *   所有 enabled=true 的特性开关的 version 字段
 *
 * 运行方式：
 * node build-scripts/sync-features-version.js
 */

const fs = require('fs');
const path = require('path');

// 读取 package.json 版本
const packageJsonPath = path.join(__dirname, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const currentVersion = packageJson.version;

console.log(`\n📦 特性版本同步工具`);
console.log(`当前版本: v${currentVersion}`);

// 读取 common.js
const commonJsPath = path.join(__dirname, '../injected-scripts/common.js');
let commonJsContent = fs.readFileSync(commonJsPath, 'utf-8');

// 提取特性配置块（从 __COMMON_JS_FEATURES__ 到 };）
const startMarker = 'window.__COMMON_JS_FEATURES__ = {';
const endMarker = '    };';

const startIdx = commonJsContent.indexOf(startMarker);
const endIdx = commonJsContent.indexOf(endMarker, startIdx);

if (startIdx === -1 || endIdx === -1) {
  console.error('❌ 找不到 __COMMON_JS_FEATURES__ 配置块');
  process.exit(1);
}

const featuresBlock = commonJsContent.substring(startIdx + startMarker.length, endIdx);
let updatedBlock = featuresBlock;

// 找出所有 enabled: true 且 version 不是当前版本的特性
// 按行处理，更可靠
const featuresToUpdate = [];
const lines = featuresBlock.split('\n');

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // 检查是否是特性名称行（以特性名: { 开头）
  const nameMatch = line.match(/^\s+(\w+):\s*\{/);
  if (!nameMatch) continue;

  const featureName = nameMatch[1];

  // 查找该特性的 enabled 和 version 字段
  let hasEnabledTrue = false;
  let oldVersion = null;
  let versionLineIdx = -1;

  for (let j = i + 1; j < lines.length; j++) {
    const checkLine = lines[j];

    // 遇到下一个特性，停止
    if (checkLine.match(/^\s+\w+:\s*\{/)) break;

    // 🔑 跳过注释行：末尾的 NEW_FEATURE_TEMPLATE 注释模板里也有 version:/enabled: 字样，
    //    不跳过会把「模板注释」误当成最后一个真实特性的版本行来更新
    if (checkLine.trim().startsWith('//')) continue;

    // 检查 enabled: true
    if (checkLine.includes('enabled:') && checkLine.includes('true')) {
      hasEnabledTrue = true;
    }

    // 检查 version
    const versionMatch = checkLine.match(/version:\s*['"]([^'"]+)['"]/);
    if (versionMatch) {
      oldVersion = versionMatch[1];
      versionLineIdx = j;
    }
  }

  // 如果 enabled=true 且 version 不是当前版本，记录要更新
  if (hasEnabledTrue && oldVersion && oldVersion !== currentVersion && versionLineIdx !== -1) {
    featuresToUpdate.push({
      name: featureName,
      oldVersion,
      lineIdx: i + versionLineIdx - i,  // 相对于 i 的行索引
      lineNumber: versionLineIdx
    });
  }
}

if (featuresToUpdate.length === 0) {
  console.log(`✅ 所有 enabled=true 的特性版本号已是最新（v${currentVersion}）`);
  process.exit(0);
}

// 更新特性版本
console.log(`\n🔄 发现 ${featuresToUpdate.length} 个需要更新的特性：`);

// 从后往前更新，防止行索引混乱
featuresToUpdate.sort((a, b) => b.lineNumber - a.lineNumber);

for (const feature of featuresToUpdate) {
  console.log(`  ${feature.name}: v${feature.oldVersion} → v${currentVersion}`);

  const lineIdx = feature.lineNumber;
  lines[lineIdx] = lines[lineIdx].replace(
    /version:\s*['"]([^'"]+)['"]/,
    `version: '${currentVersion}'`
  );
}

// 重新拼接内容
updatedBlock = lines.join('\n');
const newContent = commonJsContent.substring(0, startIdx + startMarker.length) +
                   updatedBlock +
                   commonJsContent.substring(endIdx);

// 写回文件
fs.writeFileSync(commonJsPath, newContent, 'utf-8');

console.log(`\n✅ 已更新 ${featuresToUpdate.length} 个特性的版本号`);
console.log(`📝 文件已保存: ${commonJsPath}`);
console.log(`\n✨ 版本同步完成，可以开始打包了\n`);
