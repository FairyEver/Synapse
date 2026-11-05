# Claude Code 单次模式 Implementation Plan

> **For agentic workers:** 使用 superpowers:executing-plans 在当前会话和当前分支实施，不创建分支或 worktree。

**Goal:** 为 Claude Code 自动化增加「单次模式」勾选框，保留默认交互行为，单次执行自然退出后清理终端。

**Architecture:** 可选 `singleRun` 从 Action schema / UI / executor 传至统一 launcher，仅在启用时添加原生 `--print`。复用 TerminalService 的退出清理，不增加 Stop 事件判断或强制终止逻辑。

**Tech Stack:** React、shadcn/Radix Checkbox、TypeScript、Zod、Vitest、内置 Claude Code / node-pty。

**Spec:** `docs/superpowers/specs/2026-11-05-automation-claude-code-single-run-design.md`

## Global Constraints

- 当前分支 `main`，不混入已有未提交改动，不新增依赖。
- 首条提交即完成自动化，60 秒仅限制启动确认；不改变调度周期和后续取消语义。
- `--print` 自然退出触发现有终态清理；不根据 Stop / 固定延迟强杀进程。
- 无提示词或 continuation 不允许启用单次模式。

## Review Focus

- 旧配置缺少布尔值时仍交互运行。
- 默认不勾选与显式 false 的运行参数一致。
- 真实主进程环境校验、回执及凭据不持久化边界保持。
- 单次 CLI 在 launcher 返回后退出，仍能清理终端和临时 settings。
- Stop Hook 继续执行不被提前关闭，其他会话不受影响。

### Task 1: 配置、启动参数与完整验证

**Files:** Action 包的 schema/manifest/config/executor 及测试；统一 `claude-code-terminal.ts` 及其测试；模块边界、能力清单、Automation Skill、发布说明与验收记录。

**Interfaces:** `ClaudeCodeActionConfig.singleRun?: boolean` → `LaunchAutomationClaudeCode` → `CreateClaudeCodeTerminalSessionInput.singleRun?: boolean`。

- [x] 写失败测试：旧配置、布尔校验、默认值、勾选与切回、透传以及两种终端生命周期。
- [x] 执行对应 Vitest 单测，确认因缺少字段和运行行为失败。
- [x] 最小实现：复用 Checkbox，透传可选布尔，按需添加 `--print`，校验有效使用范围。
- [x] 对应专项测试、desktop typecheck、硬约束及 IPC 生成检查通过。
- [x] 使用真实 CLI + TerminalService 验证两种模式与 Hook 继续执行；记录限制和结果。
- [x] 同步文档和发布说明，检查差异并仅提交本任务变更。

Pre-flight: 单任务，无跨任务接口冲突；用户已确认行为并明确要求本会话完成和自测，不重复请求方案批准。

验证结果：专项 55 项、真实 CLI 2 项及 typecheck/硬约束/IPC 检查通过。全量首跑 11408 通过、7 失败、2 跳过；过时系统 Skill 断言已修正，搜索超时用例独立复跑通过，移动端 Git 整份 80 项复跑通过。独立审阅未发现重要生产问题，并补强所有持久化快照的凭据检查。详见 `docs/agent-guides/automation-claude-code-single-run-acceptance.md`。
