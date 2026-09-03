/**
 * 视频号封面块早退检测
 *
 * 防止 shipinhao-publish.js 的封面处理块（try coverStep）里出现
 * 退出 publishApi 函数的 return 语句，导致发布流程提前终止。
 *
 * 根因：2026-09-02 混杂提交 e6e06e1 顺手把 return 塞进封面块，
 * 无自定义封面时直接退出 publishApi → 1961 点发布永不执行 →
 * publishRunning 永久卡 true → 窗口悬死 → 无任何上报。
 *
 * 修复：1247 行 try 加标签 coverStep，1255 行 return 改 break coverStep。
 *
 * 本测试通过作用域分析确保：封面块内所有 return; 语句的最近
 * 外层 FUNCTION 必须是封面块内部定义的函数，而非 publishApi 本身。
 */

const fs = require('fs');
const path = require('path');

// 剥掉注释、字符串、模板串、正则，防止误判
function stripLiterals(code) {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, '')           // 块注释
        .replace(/\/\/.*/g, '')                      // 行注释
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')         // 双引号字符串
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")         // 单引号字符串
        .replace(/`(?:[^`\\]|\\.|\$\{[^}]*\})*`/g, '``') // 模板串
        .replace(/\/(?:[^\/\\]|\\.)+\/[gimuy]*/g, '/r/'); // 正则
}

// 按 {} 解析作用域深度，记录每层是 FUNCTION 还是 BLOCK
function parseScopeStack(code) {
    const stripped = stripLiterals(code);
    const lines = stripped.split('\n');
    const scopes = []; // [{line, depth, type: 'FUNCTION' | 'BLOCK'}]
    let depth = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNo = i + 1;

        // 检测函数声明/表达式（关键词后跟 (
        if (/\b(?:function|async\s+function)\s*\w*\s*\(/.test(line) ||
            /\(\s*\)\s*=>/.test(line) ||
            /\w+\s*\([^)]*\)\s*\{/.test(line)) {
            scopes.push({ line: lineNo, depth, type: 'FUNCTION' });
        } else if (/{/.test(line)) {
            scopes.push({ line: lineNo, depth, type: 'BLOCK' });
        }

        // 更新深度
        const opens = (line.match(/{/g) || []).length;
        const closes = (line.match(/}/g) || []).length;
        depth += opens - closes;
    }

    return scopes;
}

// 找到某一行最近的外层 FUNCTION
function findNearestFunction(lineNo, scopes) {
    // 从后往前找，找到深度小于当前行且类型是 FUNCTION 的第一个
    for (let i = scopes.length - 1; i >= 0; i--) {
        const scope = scopes[i];
        if (scope.line < lineNo && scope.type === 'FUNCTION') {
            return scope;
        }
    }
    return null;
}

// 主测试
function testShipinhaoCoverEarlyReturn() {
    const scriptPath = path.join(__dirname, '../injected-scripts/shipinhao-publish.js');
    if (!fs.existsSync(scriptPath)) {
        throw new Error(`脚本文件不存在: ${scriptPath}`);
    }

    const code = fs.readFileSync(scriptPath, 'utf8');
    const lines = code.split('\n');
    const scopes = parseScopeStack(code);

    // 1. 找到 publishApi 函数的起始行（关键标记：async function publishApi）
    let publishApiLine = null;
    for (let i = 0; i < lines.length; i++) {
        if (/async\s+function\s+publishApi\s*\(/.test(lines[i])) {
            publishApiLine = i + 1;
            break;
        }
    }
    if (!publishApiLine) {
        throw new Error('未找到 publishApi 函数定义');
    }

    // 2. 找到封面块的范围（coverStep: { try { ... } }）
    let coverStepStart = null;
    let coverStepEnd = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // 匹配 coverStep: { 开头
        if (/coverStep:\s*\{/.test(line)) {
            coverStepStart = i + 1;
            // 找到这一行之后第一个与其缩进相同的 } (通常带 // end coverStep)
            const indent = line.match(/^\s*/)[0].length;
            for (let j = i + 1; j < lines.length; j++) {
                const nextLine = lines[j];
                const nextIndent = nextLine.match(/^\s*/)[0].length;
                if (nextIndent === indent && /^\s*\}\s*(\/\/.*coverStep.*)?$/.test(nextLine)) {
                    coverStepEnd = j + 1;
                    break;
                }
            }
            break;
        }
    }
    if (!coverStepStart || !coverStepEnd) {
        throw new Error('未找到 coverStep: {} 封面块');
    }

    console.log(`✅ 找到 publishApi 函数起始行: ${publishApiLine}`);
    console.log(`✅ 找到封面块范围: ${coverStepStart} ~ ${coverStepEnd}`);

    // 3. 扫描封面块内的所有 return; 语句
    const bareReturns = []; // [{lineNo, nearestFunc}]
    for (let i = coverStepStart - 1; i < coverStepEnd; i++) {
        const line = lines[i];
        const lineNo = i + 1;
        // 匹配裸 return; （前后无其他代码）
        if (/^\s*return;\s*(\/\/.*)?$/.test(line)) {
            const nearestFunc = findNearestFunction(lineNo, scopes);
            bareReturns.push({
                lineNo,
                line: line.trim(),
                nearestFunc: nearestFunc ? nearestFunc.line : null,
            });
        }
    }

    if (bareReturns.length === 0) {
        console.log('✅ 封面块内无 return; 语句（或已全部改为 break）');
        return;
    }

    // 4. 检查每个 return; 的最近外层 FUNCTION 是否是 publishApi
    const violations = bareReturns.filter(r => r.nearestFunc === publishApiLine);
    if (violations.length > 0) {
        console.error('❌ 封面块内发现退出 publishApi 的 return; 语句：');
        violations.forEach(v => {
            console.error(`   行 ${v.lineNo}: ${v.line}`);
            console.error(`   → 最近外层函数在行 ${v.nearestFunc} (publishApi)`);
        });
        throw new Error('封面块内不得有退出 publishApi 的 return 语句');
    }

    console.log('✅ 所有 return; 语句均位于封面块内部函数中，不会退出 publishApi');
    bareReturns.forEach(r => {
        console.log(`   行 ${r.lineNo}: ${r.line} (最近函数: 行 ${r.nearestFunc})`);
    });
}

// 运行测试
try {
    console.log('=== 视频号封面块早退检测 ===\n');
    testShipinhaoCoverEarlyReturn();
    console.log('\n✅ 测试通过');
    process.exit(0);
} catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    process.exit(1);
}
