// 测试脚本：验证 common.js 中的失败分类与诊断工具
// 用 vm 沙箱提取真实函数源码运行，确保测的是真身而非副本
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'injected-scripts', 'common.js'), 'utf8');

// 提取从 FAILURE_CATEGORIES 到 getCurrentSystem 之前的诊断工具代码段
const startMarker = 'window.FAILURE_CATEGORIES = {';
const endMarker = '// 判断当前系统类型';
const startIdx = src.indexOf(startMarker);
const endIdx = src.indexOf(endMarker);
if (startIdx === -1 || endIdx === -1) {
  console.error('❌ 无法定位代码段边界');
  process.exit(1);
}
const code = src.slice(startIdx, endIdx);

// 构建 mock 沙箱
const sandbox = { window: {}, document: null, console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const { categorizeFailure, FAILURE_CATEGORIES, collectFormDiagnostics, diagnoseButtonDisabled } = sandbox.window;

let pass = 0, fail = 0;
const results = [];
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) pass++; else fail++;
  results.push(`${ok ? '✅' : '❌'} ${name} => 期望:${expected} 实际:${actual}`);
}

// ========== 测试 1: categorizeFailure 分类规则 ==========
console.log('\n===== categorizeFailure 分类测试 =====');
expect('标题不能为空', categorizeFailure('标题不能为空').category, FAILURE_CATEGORIES.FORM_VALIDATION);
expect('需要手机号认证', categorizeFailure('需要手机号认证').category, FAILURE_CATEGORIES.AUTH_REQUIRED);
expect('登录失效', categorizeFailure('登录已失效，请重新登录').category, FAILURE_CATEGORIES.AUTH_REQUIRED);
expect('内容违规', categorizeFailure('内容违规，审核未通过').category, FAILURE_CATEGORIES.FORM_VALIDATION);
expect('图片上传失败', categorizeFailure('图片上传失败').category, FAILURE_CATEGORIES.UPLOAD_FAILED);
expect('GIF不支持', categorizeFailure('格式不支持').category, FAILURE_CATEGORIES.UPLOAD_FAILED);
expect('发文次数已用尽', categorizeFailure('发文次数已用尽').category, FAILURE_CATEGORIES.PLATFORM_LIMIT);
expect('等待元素超时', categorizeFailure('等待元素超时').category, FAILURE_CATEGORIES.TIMEOUT);
expect('找不到元素', categorizeFailure('找不到元素: .btn').category, FAILURE_CATEGORIES.TIMEOUT);
expect('网络连接失败', categorizeFailure('网络连接失败').category, FAILURE_CATEGORIES.NETWORK_ERROR);
expect('脚本未加载', categorizeFailure('common.js 未加载').category, FAILURE_CATEGORIES.SCRIPT_ERROR);
expect('纯按钮禁用', categorizeFailure('发布按钮不可用', { buttonDisabled: true }).category, FAILURE_CATEGORIES.BUTTON_DISABLED);
expect('未知错误', categorizeFailure('莫名其妙的故障xyz').category, FAILURE_CATEGORIES.UNKNOWN);

// 优先级：具体表单原因 > 笼统按钮禁用（buttonDisabled=true 但消息含"必填"）
expect('表单原因优先于按钮', categorizeFailure('请检查: title: 必填字段为空', { buttonDisabled: true }).category, FAILURE_CATEGORIES.FORM_VALIDATION);

// hasUploadError / hasNetworkError context 提示
expect('context上传提示', categorizeFailure('xxx', { hasUploadError: true }).category, FAILURE_CATEGORIES.UPLOAD_FAILED);
expect('context网络提示', categorizeFailure('xxx', { hasNetworkError: true }).category, FAILURE_CATEGORIES.NETWORK_ERROR);

// 边界：空消息
expect('空消息', categorizeFailure('').category, FAILURE_CATEGORIES.UNKNOWN);
expect('null消息', categorizeFailure(null).category, FAILURE_CATEGORIES.UNKNOWN);

console.log(results.join('\n'));

// __APPEND_MARKER__

// ========== 测试 2: collectFormDiagnostics（需 mock document） ==========
console.log('\n===== collectFormDiagnostics 表单诊断测试 =====');

// mock 一个简单的 DOM 查询环境
function makeMockDoc(elements) {
  return {
    querySelector(sel) {
      return elements[sel] || null;
    }
  };
}

// 场景 A：标题为空（必填未填）、内容已填
sandbox.document = makeMockDoc({
  '#title': { tagName: 'INPUT', value: '' },
  '#content': { tagName: 'TEXTAREA', value: '这是正文内容' },
});
const diagA = collectFormDiagnostics({
  platform: 'test',
  selectors: { title: '#title', content: '#content' },
  required: { title: true, content: true },
});
expect('A-标题未填被检出', diagA.fields.title.valid, false);
expect('A-内容已填有效', diagA.fields.content.valid, true);
expect('A-issues含标题', diagA.issues.some(s => s.includes('title')), true);
expect('A-summary缺必填', diagA.summary.includes('缺少必填字段'), true);

// 场景 B：全部填写完整
sandbox.document = makeMockDoc({
  '#title': { tagName: 'INPUT', value: '标题已填' },
  '#content': { tagName: 'TEXTAREA', value: '正文已填' },
});
const diagB = collectFormDiagnostics({
  platform: 'test',
  selectors: { title: '#title', content: '#content' },
  required: { title: true, content: true },
});
expect('B-表单完整', diagB.summary, '表单填写完整');
expect('B-无issues', diagB.issues.length, 0);

// 场景 C：必填元素不存在（querySelector 返回 null）
sandbox.document = makeMockDoc({});
const diagC = collectFormDiagnostics({
  platform: 'test',
  selectors: { title: '#title' },
  required: { title: true },
});
expect('C-元素不存在', diagC.fields.title.exists, false);

// 场景 D：非输入元素用 textContent 取值
sandbox.document = makeMockDoc({
  '.editor': { tagName: 'DIV', textContent: '富文本内容' },
});
const diagD = collectFormDiagnostics({
  platform: 'test',
  selectors: { editor: '.editor' },
  required: { editor: true },
});
expect('D-div取textContent', diagD.fields.editor.filled, true);

// ========== 测试 3: diagnoseButtonDisabled ==========
console.log('\n===== diagnoseButtonDisabled 按钮诊断测试 =====');

// 场景 A：按钮为 null
const dbA = diagnoseButtonDisabled(null);
expect('A-按钮null', dbA.recommendation, '未找到发布按钮');

// 场景 B：按钮可用（非 disabled）
const enabledBtn = {
  disabled: false,
  classList: { contains: () => false },
  getAttribute: () => null,
};
const dbB = diagnoseButtonDisabled(enabledBtn);
expect('B-按钮可用', dbB.isDisabled, false);
expect('B-建议可用', dbB.recommendation, '发布按钮可用');

// 场景 C：按钮 disabled + 有表单问题 → 建议指向表单
const disabledBtn = {
  disabled: true,
  classList: { contains: (c) => c === 'disabled' },
  getAttribute: (a) => (a === 'disabled' ? '' : null),
};
const dbC = diagnoseButtonDisabled(disabledBtn, { issues: ['title: 必填字段为空'] }, []);
expect('C-检出disabled', dbC.isDisabled, true);
expect('C-含表单问题', dbC.formIssues.length, 1);
expect('C-建议指向表单', dbC.recommendation.includes('必填字段为空'), true);

// 场景 D：按钮 disabled + 无表单问题 + 有平台错误 → 建议指向平台提示
const dbD = diagnoseButtonDisabled(disabledBtn, { issues: [] }, ['内容含敏感词']);
expect('D-含平台错误', dbD.platformErrors.length, 1);
expect('D-建议指向平台', dbD.recommendation.includes('内容含敏感词'), true);

// 场景 E：按钮 disabled + 无任何线索 → 兜底建议
const dbE = diagnoseButtonDisabled(disabledBtn, { issues: [] }, []);
expect('E-兜底原因', dbE.disabledReasons.length > 0, true);
expect('E-兜底建议', dbE.recommendation.includes('请检查表单'), true);

// ========== 测试 4: 端到端联动（诊断 → 分类） ==========
console.log('\n===== 端到端联动测试 =====');
// 模拟百家号场景：按钮 disabled，表单诊断出标题为空，最终分类应为 form_validation
const e2eForm = { issues: ['title: 必填字段为空'], summary: '缺少必填字段: title' };
const e2eBtn = diagnoseButtonDisabled(disabledBtn, e2eForm, []);
const e2eCat = categorizeFailure(e2eBtn.recommendation, { buttonDisabled: true });
expect('E2E-诊断生成可读原因', e2eBtn.recommendation.includes('必填'), true);
expect('E2E-分类为表单验证', e2eCat.category, FAILURE_CATEGORIES.FORM_VALIDATION);

console.log(results.slice(-20).join('\n'));

console.log(`\n===== 测试汇总：通过 ${pass}，失败 ${fail} =====`);
process.exit(fail > 0 ? 1 : 0);
