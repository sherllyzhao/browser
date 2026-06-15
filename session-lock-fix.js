// ==================== Session 并发控制修复方案 ====================
//
// 问题根因：
// 多个发布窗口同时打开时，并发操作同一个 session 的 cookies：
//   窗口A: 清空 → 恢复cookies[A]
//   窗口B: 清空 → 恢复cookies[B]  (并发执行)
//   窗口C: 清空 → 恢复cookies[C]  (并发执行)
//
// 竞态场景：
//   T1: 窗口A清空完成
//   T2: 窗口B清空完成（把A的也清了）
//   T3: 窗口A恢复cookies[A]
//   T4: 窗口C清空完成（把A恢复的又删了）
//   T5: 窗口B恢复cookies[B]
//   结果：只有B的cookies有效，A和C失败
//
// 解决方案：
// 对每个 session partition 添加操作队列，确保清空+恢复操作串行执行
//
// ==================== 代码修复 ====================

// 1. 在 accountSessions 声明下方（main.js:13097附近）添加：

// Session 操作队列（按 partition 分组）
const sessionOperationQueues = new Map();

/**
 * 获取 session 的操作队列
 * @param {string} partitionName - session 分区名
 * @returns {Promise<any>[]} 队列数组
 */
function getSessionOperationQueue(partitionName) {
  if (!sessionOperationQueues.has(partitionName)) {
    sessionOperationQueues.set(partitionName, []);
  }
  return sessionOperationQueues.get(partitionName);
}

/**
 * 在 session 操作队列中执行异步操作（串行）
 * @param {string} partitionName - session 分区名
 * @param {Function} operation - 要执行的异步操作
 * @param {string} label - 操作标签（用于日志）
 * @returns {Promise<any>} 操作结果
 */
async function executeInSessionQueue(partitionName, operation, label = 'unknown') {
  const queue = getSessionOperationQueue(partitionName);

  // 创建一个 promise，等待前面所有操作完成
  const previousOperation = queue.length > 0 ? queue[queue.length - 1] : Promise.resolve();

  // 创建当前操作的 promise
  const currentOperation = previousOperation
    .catch(() => {
      // 前一个操作失败不影响当前操作
      console.warn(`[Session Queue] 前序操作失败，继续执行: ${label}`);
    })
    .then(async () => {
      const startTime = Date.now();
      console.log(`[Session Queue][${partitionName}] 🚀 开始执行: ${label}`);
      try {
        const result = await operation();
        const duration = Date.now() - startTime;
        console.log(`[Session Queue][${partitionName}] ✅ 完成 (${duration}ms): ${label}`);
        return result;
      } catch (err) {
        const duration = Date.now() - startTime;
        console.error(`[Session Queue][${partitionName}] ❌ 失败 (${duration}ms): ${label}`, err.message);
        throw err;
      }
    });

  // 将当前操作加入队列
  queue.push(currentOperation);

  // 清理已完成的操作（保持队列不会无限增长）
  currentOperation.finally(() => {
    const index = queue.indexOf(currentOperation);
    if (index > -1 && queue.length > 10) {
      // 只保留最近 10 个操作
      queue.splice(0, queue.length - 10);
    }
  });

  return currentOperation;
}

// 2. 修改 openManagedChildWindow 中的 session 恢复逻辑
//    在 main.js:9862 附近，将整个 sessionData 处理包裹在队列中：

// 原代码（9862-10249行）：
// if (effectiveSessionData) {
//   ... 清空和恢复 cookies ...
// }

// 修改为：
if (effectiveSessionData) {
  console.log('[Window Manager] ========== 检测到 sessionData，开始自动清空并恢复会话数据 ==========');

  // 🔑 核心修复：将清空+恢复操作放入 session 队列中串行执行
  const partitionName = `persist:${options.platform}_${options.accountId}`;
  const windowLabel = `窗口${newWindow.id}`;

  await executeInSessionQueue(partitionName, async () => {
    // ==== 原有的所有清空和恢复逻辑移到这里 ====
    // （从 main.js:9865 的预检开始，到 10249 的 catch 结束）

    // 🛡️ 本地优先策略：检查本地 session 是否已有有效登录态
    let shouldSkipSessionRestore = false;
    // ... 原有的所有预检和决策逻辑 ...

    if (shouldSkipSessionRestore) {
      console.log('[Window Manager] ⏭️ 已跳过 sessionData 清空恢复，沿用本地永久 session');
      publishLoadingWindow?.finishStep?.(0);
      publishLoadingWindow?.finishStep?.(1);
      publishLoadingWindow?.activateStep?.(2);
    } else {
      // 1. 清空该账号的所有 cookies
      const cookies = await windowSession.cookies.get({});
      console.log(`[Window Manager][${windowLabel}] 找到 ${cookies.length} 个旧 cookies，开始清空...`);

      let deletedCount = 0;
      for (const cookie of cookies) {
        try {
          const protocol = cookie.secure ? 'https' : 'http';
          const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
          const cookieUrl = `${protocol}://${domain}${cookie.path || '/'}`;
          await windowSession.cookies.remove(cookieUrl, cookie.name);
          deletedCount++;
        } catch (err) {
          console.error(`[Window Manager][${windowLabel}] 删除 cookie 失败 (${cookie.name}):`, err.message);
        }
      }
      console.log(`[Window Manager][${windowLabel}] ✅ cookies 清空完成，删除了 ${deletedCount} 个`);

      // 2. 恢复新的会话数据
      // ... 原有的所有解析和恢复逻辑 ...

      // 3. 刷盘
      await flushSessionStorageData(windowSession, `Window Manager:restore-session-${windowLabel}`);
      await new Promise(resolve => setTimeout(resolve, 120));

      publishLoadingWindow?.finishStep?.(1);
      publishLoadingWindow?.activateStep?.(2);
    }
  }, `${windowLabel}-session-restore`);

  console.log(`[Window Manager][${windowLabel}] ========== 会话数据处理完成（已排队执行）==========`);
}

// ==================== 预期效果 ====================
//
// 修复后的执行顺序（5个窗口同时打开）：
//   队列: [窗口A] → [窗口B] → [窗口C] → [窗口D] → [窗口E]
//
// T1: 窗口A 清空 → 恢复 → 刷盘 (完成) ✅
// T2: 窗口B 清空 → 恢复 → 刷盘 (完成) ✅
// T3: 窗口C 清空 → 恢复 → 刷盘 (完成) ✅
// T4: 窗口D 清空 → 恢复 → 刷盘 (完成) ✅
// T5: 窗口E 清空 → 恢复 → 刷盘 (完成) ✅
//
// 结果：所有窗口都成功恢复各自的 cookies
//
// ==================== 性能影响 ====================
//
// - 延迟增加：每个窗口需等待前面的窗口完成（约 200-500ms/窗口）
// - 总时间：5个窗口从"并发失败"变为"串行成功"
//   修复前：0.5s 打开所有窗口，但只有1-2个成功
//   修复后：2-3s 打开所有窗口，全部成功
// - 用户体验：loading 窗口显示进度，用户可接受
//
// ==================== 测试方法 ====================
//
// 1. 在首页同时选择5个账号发布
// 2. 观察日志中的 [Session Queue] 标记
// 3. 验证所有窗口都能正常登录和发布
//
// ==================== 后续优化 ====================
//
// 如果用户抱怨速度慢，可以优化：
// 1. 提前预热 session（在选择账号时就开始恢复 cookies）
// 2. 相同账号的窗口共享 session，不重复恢复
// 3. 使用更细粒度的锁（只锁 cookie 操作，不锁整个流程）
//
