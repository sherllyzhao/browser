# AI File Lock（并行协作文件锁）

> 目的：避免 Codex 与 Claude Code 同时修改同一文件导致冲突。

## 使用规则

1. 开工前先在下表登记锁。
2. 仅可修改自己锁定的文件。
3. 完成后将 `status` 改为 `done`，并补充 `commit`。
4. 公共文件（如 `README.md`、`package.json`）默认需要先沟通再锁定。

## 锁表

| owner | branch | files | task | start_at | status | commit | note |
|---|---|---|---|---|---|---|---|
| codex | `codex/feat-example` | `main.js, renderer.js` | 登录提示优化 | 2026-03-07 10:00 | in_progress | - | - |
| claude | `claude/fix-example` | `injected-scripts/sohu-publish.js` | 搜狐发布修复 | 2026-03-07 10:05 | in_progress | - | - |

## 状态定义

- `in_progress`: 正在开发，其他协作者不可改同文件。
- `done`: 已完成并提交，文件锁释放。
- `blocked`: 卡住等待协作，备注中写明阻塞原因。

## 快速复制模板

```md
| owner | branch | files | task | start_at | status | commit | note |
|---|---|---|---|---|---|---|---|
| codex | `codex/xxx` | `a.js, b.js` | xxx | YYYY-MM-DD HH:mm | in_progress | - | - |
```

