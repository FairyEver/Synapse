# 牌桌响应式操作区 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 宽屏右栏操作，窄屏三按钮底栏，其余内容按需展开。
**Architecture:** Table 统一管理 log/bet/menu 互斥状态，以同一 ResizeObserver 测量内容宽度和画布。HumanControls 保留现有业务 hook，窄屏弹层复用共享 Popover，SidePanel 复用共享 Tabs。新增局部响应式样式覆盖旧布局，不重构牌桌反馈和声音。
**Tech Stack:** React 19 / TypeScript / Radix / Vitest。
**Spec:** `docs/superpowers/specs/2026-10-31-poker-responsive-controls-design.md`

## Global Constraints

当前目录、当前分支；保留既有未提交改动。850px 内容宽度切换；1440×900 contain。无新依赖、无应用启动、无部署。只提交本任务增量。

## Review Focus

- 全下或跟注耗尽筹码不能绕过确认。
- 响应未知后收起金额面板，原 actionId 仍可重试。
- 新手、行动序号、控制权及视角变化关闭旧金额面板，不能提交迟到意图。
- 没有座位、AI 控制、暂离或仅有 allin 合法动作时仍能找到正确操作。
- 窄屏弹层与日志不挤压画布，宽屏日志展开不改变右栏宽度。

### Task 1: 操作面板与响应式布局

**Files:** Table.tsx、HumanControls.tsx、SidePanel.tsx、PokerControlPopover.tsx、styles/responsive-controls.css、lib/table-layout.ts、__tests__/responsive-controls.test.tsx（均在 poker 模块）。
**Interfaces:** HumanControls 增加 compact、activePanel、onPanelChange、menuTrigger/menuId；Table 管理互斥面板并按内容宽度传入 compact。外部业务 hook 与 API 不变。

- [x] 新增回归测试：展开加注不提交、金额确认、全下取消与确认、未知结果重试、快照变化关闭旧面板、日志/菜单互斥、内容宽度切换及完整画布。
- [x] 运行新测试，确认因缺少新交互失败。
- [x] 实现共用右栏、三按钮底栏及局部按需弹层；复用现有校验与业务调用。
- [x] 新测试及扑克专项通过。

### Task 2: 规则、发布说明和交付

- [x] 同步 game-hall 指南、module-boundaries、ui-and-product 和待发布说明。
- [x] 运行 desktop typecheck、check:hard-constraints 和相关 lint；按改动风险补充组件/样式验证。
- [x] 独立审阅本任务增量，修复实质问题。
- [x] 仅暂存本任务增量并本地提交，保留已有未提交内容，不 push。

## 执行记录

- 用户已明确要求按原型实现，直接在当前会话执行，不再次请求方案或执行方式批准。
- 不创建 worktree；用户当前目录与分支规则优先于 Skill 默认隔离流程。

- 验证：扑克专项 19 个文件、124 项测试通过；desktop 完整 typecheck、Renderer 构建、hard constraints、相关 ESLint 通过。修复后又运行 Renderer 与测试类型检查及专项测试。
- 独立审阅确认的两项 P2 已复现并修复：金额/管理浮层切换不再抢焦点；陪练标签保持管理组件挂载，添加重试保留 creationId。额外覆盖仅可全下时取消关闭面板。
- 未启动桌面应用或浏览器，真实窗口的视觉与遮挡未做人工验收。构建仍有既有大包体积/插件耗时提示。
- 提交隔离：Table、HumanControls、指南和发布说明已有其他任务未提交内容；只提交当前响应式操作区增量，保留原有动画、音效、金额反馈等工作区改动。
- 对仅含本任务增量的提交快照另行验证：4 个组件测试文件、45 项测试通过；同一快照的 Renderer 与测试 TypeScript 配置检查通过。
