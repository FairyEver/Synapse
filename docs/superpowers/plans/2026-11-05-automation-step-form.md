# 自动化两步表单与独立详情实施计划

**Goal:** 实施用户已确认的 HTML 原型及补充要求：新建、编辑共用两步表单；详情只读；页面无底栏，操作紧跟表单内容。

**Architecture:** 保留 Automation 数据模型、注册表、preload bridge 和保存/草稿保护；扩展共享 GuidedFlow 的页面形态，默认弹窗形态不变。列表区分查看详情与编辑，详情复用运行记录组件和现有启停逻辑。

**Tech Stack:** React、TypeScript、shadcn/Radix、Vitest；不新增依赖。

**Spec:** `docs/superpowers/specs/2026-11-05-automation-inline-editor-design.md`，以本次用户确认的两步原型取代旧双栏及保存后继续编辑要求。

## 约束与验收

- 在当前仓库 main 分支实施，不创建分支或 worktree，不启动应用、浏览器或开发服务器。
- 第一步只选择/配置触发条件，验证通过才进入第二步；第二步选择/配置执行操作并命名。回退保留两边配置，触发变量在第二步也可使用。
- 共用当前注册表及 ConfigForm，不硬编码触发器/执行器目录，不改变单触发器对应单执行器、调度和权限协议。
- 编辑回填、仅保存保持启停状态、新建默认停用、保存并启用、保存失败与重复提交保护均保留；成功后进入保存项详情。
- 列表行进入只读详情，行内编辑直接进入表单；详情保留概览、运行记录、编辑、启停及返回列表。
- 操作区属于表单滚动内容，不增加全宽、固定、sticky 或带分隔背景的底栏。
- 保留未保存离开和会话内暂存草稿保护，返回列表保留筛选。

## Task 1: 分步表单

Files: `components/guided-flow/index.tsx`、`modules/automation/editor/`、`hooks/use-automation-editor.ts`、`types.ts`。

- [x] 先增加交互测试，验证首次仅显示触发选择、配置校验后推进、操作位置、回退保留、编辑回填及保存状态；运行并确认旧实现失败。
- [x] 为 GuidedFlow 增加页面布局和最终操作 slot，保留已有弹窗默认行为；builder 只呈现当前步骤，选项复用 GuidedChoices。
- [x] 在 editor hook 管理步骤、第一步校验与草稿步骤恢复；移除编辑页运行记录标签及底栏。
- [x] 更新已有组件测试，保留 Cron/时间范围、变量、平台 Shell 默认值、Agent 配置和离开保护覆盖。

## Task 2: 详情及页面入口

Files: `modules/automation/detail/`、`modules/automation/index.tsx`、`components/automation-list*.tsx`。

- [x] 增加列表查看/显式编辑、保存成功详情、详情返回编辑及运行记录测试，确认旧实现失败。
- [x] 独立只读详情组件以文本展示配置，凭据字段脱敏，复用运行记录和启停操作；使用列表实时快照及保存返回值，避免旧快照覆盖刚保存项。
- [x] 区分列表查看/编辑回调，接入详情并保留列表筛选和暂存草稿。

## Task 3: 文档、验证及交付

- [x] 同步模块边界、当前规格、页面 UI 约束、能力清单说明及待发布说明；核对 MCP/系统 Skill，无工具契约变化则不改 schema。
- [x] 运行 automation、guided-flow 消费方与顶栏专项测试、desktop typecheck、hard constraints、必要 lint/renderer build；不触发远端 CI。
- 提交阶段：检查 diff 和暂存区，仅本任务文件创建中文本地提交，不 push。

## Review Focus

- 无效触发配置不能越过第一步，也不能因切换步骤丢失执行配置。
- 保存失败和保存中不应跳转详情、重复创建或放行导航。
- 已启用记录仅保存不能隐式停用；JS/Node 原有服务端启停策略以真实保存响应为准。
- 已暂存草稿在查看详情期间仍保护跨应用导航和关闭。
- 未注册类型及过期配置的详情仍能展示与进入修复；凭据不以明文出现。

## 执行记录

- 用户已明确批准原型并授权在当前对话直接实施，按已确认范围执行，未追加审批、分支或 worktree。
- 已使用独立只读审查，修正变量发现元数据不完整造成的旧配置误拦截、嵌套 source 参数漏检和详情 URL 凭据显示；补充回归用例。
- 变量校验仅检查本次替换触发类型后失效的已声明变量，不把可选展示元数据当完整运行时白名单；更换历史随暂存草稿保留。代码及结构化脚本输入不参与模板校验。
- 15 个相关测试文件、179 项测试通过，覆盖自动化、触发配置、共享向导其他使用方、运行记录与三种宿主顶栏；lint、硬约束、IPC codegen 和 Renderer 构建通过。
- 没有启动应用、浏览器或开发服务器，没有部署、远端 CI、数据库写入或推送。构建保留现有大 chunk 提示。
- 完整 desktop typecheck 的 Renderer、Electron、preload 检查已执行到测试类型检查；最终被同仓库并行邮件任务的 `desktop/app-capabilities/mail/main/__tests__/automation-receipts.test.ts:54`（缺少 originReceiptKey 类型）阻塞，本任务不修改该文件。相关源码编译无本任务类型错误。
