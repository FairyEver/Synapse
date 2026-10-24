# 邮箱文件夹右键管理实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在当前会话实施。

**Goal:** 普通邮件文件夹支持右键重命名和删除，新建保留在设置。

**Architecture:** 导航复用共享 ContextMenu 和 Dialog；模块 hook 调用已有 folder.rename/delete bridge，成功后更新文件夹及当前视图。

**Tech Stack:** React、TypeScript、现有 shadcn/Radix、Vitest。

**Spec:** 用户本轮明确要求；沿用 `docs/superpowers/specs/2026-10-23-mail-client-design.md` 的普通文件夹与空文件夹保护。

## Global Constraints

- 当前 main、当前目录开发，不新建分支或 worktree，不新增依赖或启动应用。
- 新建仍在设置；系统文件夹和虚拟视图不提供重命名或删除。
- 删除先确认，实际空目录校验沿用主进程；错误可见、请求期间禁止重复操作。
- 只提交本任务改动，保留已有 router/naming 和发布说明调整，不 push。

## Review Focus

- 右键非当前文件夹不切换列表；保存后只更改目标文件夹。
- 空白/换行名称不能提交；失败保留输入和错误。
- 删除失败保留目录；删除当前目录成功后返回全部邮件。
- 切换邮箱或身份后关闭旧弹窗，迟到响应不污染新视图。
- 系统文件夹（含 INBOX）及全部/星标/草稿虚拟视图不出现管理菜单。

### Task 1: 文件夹右键操作

**Files:** `desktop/src/modules/mail/navigation.tsx`、`folder-menu.tsx`、`layout.tsx`、`use-mail.ts`；测试 `__tests__/folder-menu.test.tsx`。

**Interfaces:** `useMail.changeFolder(action: "rename" | "delete", folderId: string, name?: string): Promise<void>`；导航传递同签名回调，菜单只持有弹窗状态。

- [x] 编写回归，覆盖右键入口、重命名、取消/确认删除、非空失败与身份切换。
- [x] 运行 `pnpm --filter @synapse/desktop exec vitest run src/modules/mail/__tests__/folder-menu.test.tsx`，观察因菜单缺失而失败。
- [x] 实现菜单、弹窗和 hook，复用已有接口与系统文件夹保护。
- [x] 运行邮件 Renderer 和 mutations 回归、desktop typecheck、hard constraints、UI tracking coverage。
- [x] 更新产品规格、能力清单说明与发布说明，审阅聚焦 diff 后本地中文提交。

## 执行记录

- Ruling: 用户已明确确定新建位置及右键操作范围，直接在当前会话实施，不重复征求设计/执行方式确认；遵守当前目录和最小充分验证规则。
- 回归先观察到 5 项因菜单不存在而失败，实现后通过。最终邮件 Renderer 与 mutations 共 15 个文件、98 项通过；完整 desktop typecheck、专项 ESLint、hard constraints、UI tracking coverage 通过。
- 独立只读审阅无阻断项；修复关闭弹窗丢失文件夹焦点的反馈，补充断言观察失败后通过：取消/重命名返回原文件夹，删除成功返回仍存在的当前导航项。
- Ruling: 工作中出现其他任务的 list-toolbar 改动，保留且排除本次提交；发布说明仅暂存本次新增条目。
