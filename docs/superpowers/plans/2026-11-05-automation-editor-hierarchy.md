# 自动化编辑器视觉层级 Implementation Plan

> **For agentic workers:** 使用 superpowers:executing-plans 在当前 checkout 实施。用户已确认方向并要求直接重构，不再等待计划审批，不创建分支或 worktree。

**Goal:** 用浅灰工作区、白色配置面板和集中操作区重建自动化创建、详情与运行记录的层级。

**Architecture:** 只调整现有编辑器的布局和样式组合，继续复用注册表表单及编辑 hook。共享顶栏仍只放返回，名称和视图标签在其下方同一白色标题区排列。

**Tech Stack:** React 19、Tailwind 4、shadcn/Radix、Vitest。

**Spec:** `docs/superpowers/specs/2026-11-05-automation-inline-editor-design.md`，本轮用户确认的视觉调整同步写入该规格。

## Global Constraints

- 当前 main，使用主题 token 与已有组件，不新增依赖、IPC、MCP 或业务能力。
- 保留左右同页配置，移除中间箭头；窄容器纵向排列。
- 摘要与保存按钮同属白色操作区并随内容滚动，不设置固定或 sticky 底栏。
- 保留类型更换确认、折叠输入、变量插入、真实运行记录与保存/离开保护。

## Review Focus

- 名称在运行记录视图及保存中不可误改。
- 长名称、长字段与窄容器不撑宽布局。
- 两栏菜单通过 Portal 展开，键盘焦点与当前项状态正常。
- 保存动作仍在滚动表单内，失败时能看见错误并继续编辑。
- 深色主题通过相同 token 区分工作区与配置面板。

### Task 1: 重建层级并验证现有交互

**Files:** `desktop/src/modules/automation/editor/{editor-form,trigger-executor-builder}.tsx`、现行编辑规格、UI 与模块规则、`RELEASE_NOTES_PENDING.md`。

**Interfaces:** 保留 `AutomationEditorForm`、`TriggerExecutorBuilder` 的全部 props 和业务回调，无新增契约。

- [x] 调整名称/标签标题区、灰色双栏工作区、白色配置面板和摘要保存操作区。
- [x] 统一选择列表与已选节点的内边距、字号和对齐，保留标准控件尺寸。
- [x] 同步规格、模块边界、UI 规则和用户发布说明。
- [x] 运行现有自动化编辑与导航回归、desktop typecheck、硬约束及 renderer 构建；不为纯样式新增镜像实现的测试。
- [x] 使用可用浏览器检查实际组件渲染的宽/窄布局与展开菜单；若环境不可用，明确记录未完成的视觉验收。
- [x] 审查聚焦 diff 后中文本地提交，不 push。

## 执行记录

- 初始工作区干净，分支 main。
- 用户确认灰底、左右白面板、无中间箭头、顶部收拢名称与标签、底部摘要和保存操作随内容滚动。
- 只涉及视觉布局，复用已有交互测试，不新增与 Tailwind class 对应的断言。

### Task 2: 详情与运行历史统一视觉

用户在同一任务中追加：已创建自动化的详情和运行历史也使用 impeccable、unslop 重构，沿用确认的视觉方向直接实施。

**Files:** `detail/automation-detail.tsx`、`components/automation-runs-dialog.tsx`、共享结果展示及 Claude Code 结果包装、对应结果/历史回归测试、上述规则与说明。

- [x] 详情使用相同的顶部白色标题区和灰色工作区，触发/执行双栏白面板，运行策略独立白色分区；保持只读与分段修改入口。
- [x] 运行历史使用一个白色列表，统一状态、开始/结束时间与耗时，结果与终端操作按记录分组，保留错误、重试和停止。
- [x] 耗时仅在记录头显示一次，共享结果视图增加默认兼容的可选展示参数，测试覆盖保留其他指标及 Claude Code 终端入口。
- [x] 执行交互测试、类型检查、构建与真实组件宽窄视觉验收；最终检查、提交本次任务文件。

## 验证与交付

- 自动化及共享顶栏、结果展示回归覆盖 9 个文件 133 项测试。并行构建/类型检查期间，两项旧日期选择测试超时并污染后续断言；单独复查编辑器 26 项全部通过，详情/结果 44 项全部通过，未更改超时时间或弱化断言。最终限制为 2 个测试 worker 的完整复跑，9 个文件 133 项全部通过。
- desktop 全量 typecheck、硬约束和 renderer 构建通过；构建仅有既有的大 chunk 提醒。
- bsk 在已运行的 Vite 中渲染实际组件，使用隔离的预览数据，未启动服务或操作真实自动化。宽屏检查空白/已配置编辑器、展开类型菜单、详情及成功/失败历史；760px 下确认纵向排列和无横向溢出，暗色使用现有 surface/card token。预览不替代已安装 Electron 的真实调度验收，本次未修改调度业务。
- 截图保存在 `/tmp/synapse-automation-hierarchy/`，仅本地、无在线链接；临时预览位于忽略目录 `.superpowers/sdd/automation-editor-hierarchy/preview.html`，不进入提交。bsk 会话已停止。
- 只读审查未发现阻断问题。保持 main；仅本次视觉代码、测试、规则与说明进入本地提交，不 push、不部署。并发任务的 Claude Code singleRun 改动保留在原工作区。
