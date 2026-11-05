# 自动化同页因果配置 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan in the current checkout. 用户已确认 HTML 原型并要求直接实施，不再等待计划审批，不切分支或 worktree。

**Goal:** 按已确认原型，把两步编辑器改为触发与执行同页配置，保留真实注册表、校验及保存保护。

**Architecture:** 编辑器继续使用现有 hook 和注册表配置组件。两侧类型菜单与折叠在节点内管理，提示词通过共享字段组件插入触发变量。保存和运行记录继续走已有 bridge/hooks。

**Tech Stack:** React 19、TypeScript、shadcn/Radix、Tailwind 4、Vitest。

**Spec:** `docs/superpowers/previews/2026-11-05-automation-feishu-prototype.html`，用户已在当前对话批准直接实施；同步更新 `docs/superpowers/specs/2026-11-05-automation-inline-editor-design.md`。

## Global Constraints

- 在当前 main 开发，只提交本任务文件；避开并行 Claude Code 后端改动。
- 不新增依赖、执行器、触发器、IPC、条件分支或调度语义。
- 复用共享组件与主题 token，不复制原型演示工具栏、虚构账号和运行记录。
- 保存动作随内容滚动，保留未保存离开、草稿、保存互斥和真实响应状态。

## Review Focus

- 更换一侧类型保留另一侧输入，旧变量失效时阻止保存。
- 收起节点再展开不丢失配置或未提交的局部输入。
- 变量在光标处插入，支持动态路径；切换类型更新变量集合。
- 编辑已启用记录时仅保存不覆盖启停状态；保存中禁止离开与重复提交。
- 宽窄容器均不溢出，Radix 菜单通过 Portal 脱离滚动裁切。

### Task 1: 同页配置与变量插入

**Files:** `desktop/src/modules/automation/editor/{editor-form,trigger-executor-builder}.tsx`、`desktop/src/action-runtime/{action-registry,action-prompt-field}.tsx/ts`、`desktop/action-packages/builtin/agent/config.renderer.tsx`、相关编辑器测试。

- [x] 先调整并运行交互测试，确认两侧同屏、菜单确认、失效变量、插入光标及保存保护在旧实现失败。
- [x] 实现双栏/纵向布局、节点类型菜单与折叠、流程摘要、页内保存以及已有记录的运行记录标签。
- [x] 提示词复用共享输入字段；配置组件可接收可选触发变量，非自动化使用保持原行为。
- [x] Cron/间隔生效日期与时间范围、Agent 会话/超时以折叠配置呈现；运行原有配置回归测试。
- [x] 运行编辑器、自动化模块、Agent 配置及共享顶栏交互测试，修复与现有行为的差异。

### Task 2: 规则同步与交付

**Files:** 现行编辑规格、`docs/agents/module-boundaries.md`、`docs/agents/capability-registry.md`、`RELEASE_NOTES_PENDING.md`。

- [x] 更新界面边界与发布说明；核对 MCP/Skill 未描述旧两步操作，能力数量不变。
- [x] 运行 desktop typecheck、hard constraints、IPC 检查及必要构建。
- [x] 独立审查本任务 diff，处理重要问题；只暂存本任务改动并中文本地提交，不 push。

## 验证记录

- 旧界面下新增同页交互测试 5 项失败，Cron inline 测试失败；实现后专项回归 161 项通过。
- 独立只读审查发现标题菜单额外 click 逻辑与 Radix pointerdown 冲突；补充连续点击关闭菜单测试，在修复前失败。按标准交互预期修复，最终 13 个文件、162 项测试通过。
- desktop 完整 typecheck、check:hard-constraints、check:ipc-codegen、build:renderer 均成功。构建仅有既有大 chunk 提示。
- 未启动应用/浏览器，实际桌面及窄容器展开态视觉验收尚未执行，不能以组件测试或构建替代。
- 未修改并发 Claude Code 执行器的后端、注册和运行记录实现；共享文档/模块测试只提交本任务的编辑界面部分。
