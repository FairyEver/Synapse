# 自动化页面内编辑 Implementation Plan

> **For agentic workers:** 使用 superpowers:executing-plans 在当前 main 分支内实施。用户已批准设计并要求执行，不重复申请批准；不另建分支或 worktree。

**Goal:** 自动化新建、编辑和运行记录均在当前页面完成。
**Architecture:** AutomationModule 管理列表/编辑状态与会话草稿；编辑 hook 管理加载、校验、保存与离开保护；现有注册表和表单保持复用。删除专用窗口入口。
**Tech Stack:** React 19、TypeScript 6、shadcn/Radix、Vitest。
**Spec:** docs/superpowers/specs/2026-11-05-automation-inline-editor-design.md

## Global Constraints

- 当前仓库、当前 main 分支，不新增依赖、不启动应用、不改变运行时数据模型。
- 用户已批准设计并授权实施；最终仅本地提交，不 push。

## Review Focus

- 首次保存后再次保存只能更新；失败和连续点击不得产生重复记录。
- 仅保存应保留后端实时启停状态，不能用旧快照覆盖。
- 返回、切换应用、关闭及保存中离开不得静默丢失编辑。
- 异步加载/保存取消、历史记录切换不能回写已离开的页面。
- 窄屏纵向布局及长表单必须可滚动，页脚可用。

### Task 1: 页面内编辑、保存与草稿保护

**Files:** `desktop/src/modules/automation/index.tsx`、`editor/editor-form.tsx`、`hooks/use-automation-editor.ts`、`types.ts` 及组件测试。
**Interfaces:** 编辑器接受 mode、initialSession、initialTab、onBack(session?)、onSaved；session 包含 draft、item? 和 savedDraft，用于恢复同一会话。

- [x] 更新入口测试并增加首次保存后二次保存、页内重命名、草稿暂存与返回保护测试；先运行确认失败。
- [x] 实现 hook 和页内表单，复用 TriggerExecutorBuilder；保存后不关闭窗口。增加列表搜索与状态筛选，返回保持状态。
- [x] 运行自动化模块测试，确认关键流程通过。

### Task 2: 配套表面与旧窗口退役

**Files:** 运行记录组件、CronInput、trigger-executor-builder、trigger-variables、automation IPC、preload/bridge、main.tsx、生成 IPC 及相关测试。
**Interfaces:** AutomationRunsPanel 接受 item、busy、onStopRun；Cron 配置和变量无需 Dialog。

- [x] 更新相关测试，确认旧入口和弹窗行为不再符合断言。
- [x] 运行记录、Cron 与变量在页内呈现；删除专用编辑窗口 service、Renderer 入口和仅为其服务的私有 IPC，重新生成通道。
- [x] 运行相关组件与 IPC/preload 测试。

### Task 3: 文档、验证与本地提交

**Files:** RELEASE_NOTES_PENDING.md、docs/agents/capability-registry.md、module-boundaries.md、相关历史规格。

- [x] 更新产品边界及注册表例外，说明 UI 私有入口移除，公开工具数量不变。
- [x] 运行相关测试、desktop typecheck、check:hard-constraints、check:ipc-codegen 和 Renderer 构建；检查全量测试结果。
- [x] 请求独立代码审查，处理影响行为的发现并验证。检查暂存区，仅提交本次改动，中文提交信息，不推送。

## 执行与验证结果

- 当前 main 分支实施；没有新建分支或 worktree，没有启动应用、浏览器、部署或推送。
- 独立只读审查提出三项行为问题：暂存草稿离开保护、手写 Cron 与模板同步、历史重试响应顺序。均先建立失败回归测试，再修复并通过验证。另覆盖保存重复提交、首次保存后更新同一 ID、迟到名称/窗口焦点刷新，以及三种宿主共用顶栏。
- 最终 desktop 全量测试：11,496 通过、2 跳过（1,124 个文件通过、2 个文件跳过）。desktop typecheck、改动范围 ESLint、Renderer 构建、硬约束、IPC codegen 和 diff whitespace 检查均通过。
- 未进行运行中应用的实际视觉验收；窄窗口、滚动和菜单展开视觉仍需人工在应用中验收。
- 发布说明、模块边界、能力清单和系统 Skill 使用说明已同步；公开工具数量与 schema 不变。
