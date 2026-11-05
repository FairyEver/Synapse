# 自动化 Claude Code 执行器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 自动化在后台新建内置 Claude Code 终端，以原生参数提交提示词，确认提交后结束自动化，并允许从记录进入终端。

**Architecture:** 新增 `builtin.claude-code` action，复用统一 CLI launcher。启动专用临时 Hook 生成匹配首条提示词的一次性回执，独立于通知开关。运行关联经既有 DataRepository 先于 PTY 保存；结果视图走现有终端导航。

**Tech Stack:** Electron、TypeScript、React、shadcn/Radix、Node 文件系统、Vitest；不新增依赖。

**Spec:** `docs/superpowers/specs/2026-11-05-automation-claude-code-executor-design.md`（用户已确认）。

## Global Constraints

- 在当前仓库、当前 main 分支执行；不创建分支或 worktree，不启动应用、浏览器或开发服务器。
- 配置仅 `projectId` 与 `prompt`，每次沿用当前默认供应商、模型和权限模式；每次创建独立会话。
- 启动参数通过 argv 传递，禁止固定延迟输入、模拟回车、自动审批或自动重发。
- 启动确认固定 60 秒；后续 CLI 生命周期归终端，不由已完成的自动化控制。
- PermissionGuard/AuditSink、凭据隔离、主题 token 与标准 Button 均沿用项目规则。
- 清理同时保留两个受支持类型，旧退役类型继续清理；记录渲染按 run.executorType。

## Review Focus

- 通知关闭、初始输入含多行/中文/连字符时仍准确确认，不能只因 PTY 已启动而成功。
- 取消或超时后回执迟到，不重发、不删除仍在使用的 settings，不改写终态。
- 用户已经打开其他终端时不切换焦点；定位目标失效时不重建。
- 编辑自动化更换执行器后，历史仍可按原类型进入准确终端。
- 备份恢复及删除候选并发转为新类型时，Worker 与写队列复验均不误删。

---

### Task 1: 原生首条提示词与独立回执

**Files:** 新增 `desktop/electron/modules/agent/claude-code-prompt-submission.ts` 及其 `__tests__/claude-code-prompt-submission.test.ts`；修改 `claude-code-terminal.ts` 及现有 launcher 测试。

**Interfaces:**
- `prepareClaudeCodePromptSubmission({ directory, nodePath, prompt, signal })` 返回 Hook 配置、仅进程环境、`wait(): Promise<void>`、`dispose(): void`、`ended(): Promise<void>`。
- launcher 输入增加可选 `initialPrompt`、`abortSignal`、`actor`；携带首条提示词时等待回执，其余调用行为保持原样。调用者 `onCreated` 先于 PTY 持久化关联。

- [x] 先写并运行失败测试：携带完整首条提示词 argv、通知关闭时独立回执、错误提示词不能确认、取消/超时/早退，以及后续 Hook 无害。
- [x] 实现受控临时 Hook、匹配摘要与随机标识、回执轮询及有界取消；使用 `core.process-environment.nodePath` 的现有 Node shim，不依赖系统 Node。摘要仅在进程环境，不写入 settings 或回执。
- [x] launcher 合并额外 UserPromptSubmit Hook，以 `--` 分隔首条提示词，校验 cwd，正确透传 actor。已启动的进程遇到确认失败时保留 settings 至会话结束。
- [x] 运行：`pnpm --filter @synapse/desktop exec vitest run electron/modules/agent/__tests__/claude-code-terminal.test.ts electron/modules/agent/__tests__/claude-code-prompt-submission.test.ts`；预期通过。

### Task 2: 执行器、持久化关联与清理

**Files:** 新增 `desktop/action-packages/builtin/claude-code/{schema,manifest,index,executor.main}.ts` 与 executor 测试；修改主进程 action registry/bootstrap、AutomationExecutionService、AutomationRunRepository、清理 Worker/监听/仓库及专项测试。

**Interfaces:**
- `createClaudeCodeAction({ launch })`，`launch` 沿用 Task 1 launcher 输入/返回。
- `ActionRuntimeContext.persistOutputs?(outputs: Record<string, unknown>): Promise<void>`；自动化执行时提供该回调，运行仓库 `updateOutputs(id, outputs)` 保存运行中的终端关联。
- 结果 outputs 为 `projectId`、`sessionId`；workspace 可通过目标 session 的现有导航解析。成功文案「已启动 Claude Code 并提交提示词」。
- 共享 `isSupportedAutomationExecutor(type: string): boolean` 作为清理白名单唯一依据。

- [x] 先写并运行失败测试：两类型发现、执行前关联、提交后成功、确认失败保留 session、取消后不重发、新类型恢复/并发复验不误删。
- [x] 实现严格配置 schema（拒绝额外字段）、变量展开、固定确认预算、结构化安全错误。将取消/异常路径已保存的 outputs 合并到最终运行结果。
- [x] 主进程注册新增 action，bootstrap 注入统一 launcher；白名单覆盖 Worker、监听和仓库队列。
- [x] 运行相关 executor、registry、execution-service、run-repository 和 cleanup 测试；预期通过。

### Task 3: 配置表单与运行记录终端入口

**Files:** 新增 action 的 `config.renderer.tsx`、`result.renderer.tsx` 及交互测试；新增共享 `desktop/src/lib/open-terminal-session.ts`；修改 Renderer registry、automation-runs-dialog 及对应测试。

**Interfaces:**
- `ClaudeCodeConfigForm` 沿用 ActionConfigFormComponent，仅项目和提示词。
- `ClaudeCodeResultView({ result })` 通过共享打开函数校验目标仍存在，并使用现有主窗口导航；已删除则提示「终端会话已不可用」。

- [x] 先写并运行失败测试：两类型选择、新表单不出现模型配置、运行原类型保持入口、主动点击才导航、失效目标不重建。
- [x] 复用现有 Field/Select/Textarea/Button；结果渲染以 run.executorType 为准，保留旧类型缺失时的通用 fallback。
- [x] 运行 Renderer registry、结果视图及 Automation 相关组件测试；预期通过。

### Task 4: 同步契约、验证与交付

**Files:** 修改 `desktop/synapse-capabilities/shared/automation-domain.ts`、系统 Skill 的 automation 指南、`docs/agents/{module-boundaries,capability-registry}.md`、设计状态与 `RELEASE_NOTES_PENDING.md`。

**Interfaces:** 公开 Automation/MCP 仍为 14 项，Automation Action 从 1 变 2；不新增 IPC、Workflow、Dock 或 Deep Link。

- [x] 更新公开发现与 create/update 描述、系统 Skill、边界和用户发布说明，覆盖既有文档中的 Agent-only 限制。
- [x] 运行必要专项测试、desktop typecheck、`check:hard-constraints`、`check:ipc-codegen`；检查打包边界，执行 `check:packaged-asar` 并如实记录可用候选包的限制。
- [x] 由一个新上下文 reviewer 审查完整改动；必要修复先建立回归测试。
- [x] 检查 diff 和暂存区，仅提交本任务文件；提交中文摘要，不 push，不部署，不声称完成了真实交互/焦点验收。

## 执行记录

- 用户已明确要求开始实施，采用本会话直接执行，不追加计划确认；遵循用户要求在当前 main 开发。
- 真实应用/浏览器验收未获启动授权，以可重复专项验证为本次自动验证范围，交付中明确运行时验收边界。

## 最终实施补充

- 提交前关联暂存为运行的可选 `pendingOutputs`，结束时合并到 result.outputs 并移除，避免未确认时呈现成功结果。
- 终端退出回调提前到 PTY 创建前注册；退出时最后读取一次已写入的回执，再清理临时目录，防止提交与退出竞争导致误判。
- 执行器使用窄启动契约，避免把具体 TerminalService 类型引入 Renderer 的编译图；未修改编译选项。
- 同工作区存在另一项自动化编辑器修改；本次提交仅包含执行器相关改动，共享发布说明、边界和测试文件按片段暂存。

验证补充：退出与提交的最后一次回执读取先于临时文件清理；收信恢复再次分类失败诊断时仅对 Claude Code 保留已确认的终端关联。相应回归先失败后通过。正式包扫描受旧验收失效链接阻断，真实应用/Windows/焦点验收未进行。

共享编辑器工作随后以 `e9ccfca7b` 提交，Claude Code 表单复用其 `ActionPromptField` 并透传触发变量；只为共用组件增加可选 placeholder，不改变 Agent 默认文案。表单变量入口回归先失败后通过。
