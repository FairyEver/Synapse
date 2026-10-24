# Agent Conversation Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在真实桌面对话中选择消息，预览并生成高清 PNG 长图，真正复制到系统剪贴板或保存至用户选择的文件。

**Architecture:** 原时间线就地选择，底部复用输入框容器；独立 hook 冻结消息和分页读取，预览复用消息正文与 Generated UI 的只读渲染。SnapDOM 3.3.7 在 renderer 生成 PNG，窄 Agent IPC 交给主进程验证、权限检查、审计后复制或原子保存。

**Tech Stack:** React 19 / TypeScript 6 / shadcn Radix / SnapDOM 3.3.7 / Electron 44 / Vitest。

**Spec:** `docs/prototypes/2026-10-24-conversation-share/README.md`，用户已批准新版原型并明确要求接入。

## Global Constraints

- 在当前目录和当前分支实现，不创建分支或 worktree，不启动应用或开发服务器。
- 只修改本功能文件；现有未提交的运行时、终端和安全改动不属于本任务。
- 不上传对话或创建公开链接。默认隐藏邮箱；标题和底部标识可选。按用户后续要求，图片不显示消息身份、时间、模型和顶部小标题。
- 不导出工具调用、思考、费用、日志或附件原文件；不选择流式回复。
- 图表只读预览不得保存表单状态或执行动作；长内容不得静默截断或降低清晰度。
- 固定 720 / 960 CSS px，2× / 3×，显式 DPR=1；校验 PNG 真实尺寸。
- 主进程写文件和剪贴板经过 PermissionGuard / AuditSink。新增 UI 私有 IPC，不新增 MCP、System App、Dock、Workflow、Automation 或 Deep Link 注册。

## Review Focus

- 历史分页 / 长正文：全选必须读取全部可选历史，选中的截断正文逐块读全；不前进、超预算或失败应明确报错。
- 会话切换 / 退出 / 重复点击：旧异步结果不能进入新会话，导出串行且失败后可重试。
- 图表、字体和图片：完成加载后捕获，渲染失败、资源缺失和尺寸降级不可报告成功。
- 剪贴板与保存：权限拒绝、系统写入失败、取消保存、目标文件变化不能报告成功或破坏已有文件。
- 原对话体验：主窗口与独立窗口共用入口；分享期间不自动贴底，不更改原会话、输入草稿或可视化状态。

## Task 1: 消息快照与安全 PNG 输出

**Files:** `desktop/src/modules/agent/share/`（类型、选择 / 历史 helper 和测试），`desktop/electron/services/agent-share-image-service.ts` 及测试，`desktop/electron/modules/agent/ipc-share.ts` 及 schema / handler 测试，preload / bridge / IPC generated。

**Interfaces:** `shareMessages(items, sending)` 筛选可分享消息；`loadShareHistory(bridge, target, signal)` 分页；`loadShareContent(bridge, target, messages, signal)` 读取完整正文；`agent.exportShareImage({ action: copy|save, pngBase64, fileName })` 返回 `{ success, filePath? }`，取消返回 false。

- [x] 先写并运行选择、分页游标、长正文、取消 / 旧结果及 PNG 输出的失败测试。
- [x] 实现有界消息快照、连续 / 按轮 / 批量选择，过滤诊断和流式内容。
- [x] 实现 PNG 验证、原生 ClipboardItem 写入、系统保存对话框与原子保存，覆盖失败、取消及权限审计。
- [x] 补 UI 专用 IPC schema、preload、bridge 并生成通道；运行专项测试。

## Task 2: 原位选择与高清预览

**Files:** `desktop/src/modules/agent/share/use-agent-share.ts`、选择栏 / 预览 / 图像 helper 与测试；Agent workspace、timeline、message toolbar / event；Generated UI 只读渲染；stick-to-bottom。

**Interfaces:** workspace 使用 share hook 状态；timeline 向 message event 传递选择上下文；预览拿完整不可变消息；图像 helper 返回校验后的 PNG Blob，hook 调用私有 IPC。

- [x] 先测试分享生命周期、Shift / 按轮操作、预览返回、会话切换和只读图表无写入。
- [x] 实现顶栏和单消息入口、原位复选框、替换输入框的选择栏，保持草稿和时间线位置。
- [x] 实现原型设置及只读正文 / 图表预览；等待字体、图片、图表，阻断资源错误和尺寸降级。
- [x] 添加 SnapDOM 固定依赖，实现 2× / 3× PNG 和真实复制 / 保存反馈。
- [x] 运行 renderer 相关回归测试与 typecheck。

## Task 3: 集成验证与交付

**Files:** 待发布说明、能力清单、Agent 指南、系统 Skill 说明及本计划。

- [x] 更新用户可感知发布说明与 UI 私有导出边界；能力和 MCP 数量保持不变。
- [x] 运行专项测试、desktop typecheck、IPC 生成一致性、hard constraints、renderer build 与项目测试。
- [x] 按 `requesting-code-review` 做一次独立只读审查，修复实际问题并回归。
- [x] 检查聚焦 diff，只提交本任务内容，本地提交不 push。

## Execution Record

- 2026-10-24：用户批准新版原型。当前工作区已有其他任务改动；依用户全局规则留在当前分支，覆盖 skill 的隔离目录默认建议。

- 2026-10-24 验证：Renderer 相关 248 项、Agent 主进程相关 173 项、preload 52 项及主 / 独立窗口草稿保留 2 项通过；新增核心文件 ESLint、完整 desktop typecheck、hard constraints、IPC codegen 一致性、renderer 与 Electron / preload 构建通过。
- 全量 desktop 首次 1,095 个测试文件通过、5 个文件失败（6 项）。本次引入的 ref 身份断言已改为验证真实节点 / null 转发，28 项相关会话测试通过；移动端 Git 超时以 2 workers 复测通过。余下 4 项旧断言分布于 bootstrap descriptors / registry 和 Agent 上下文文字，两类均未由本功能修改，对应此前已有失败记录；未扩大范围修复。
- 独立只读审查发现并修复：实时 / 持久化 ID 切换导致丢选和空摘录、Markdown 实体编码及 OpenUI 求值后的邮箱脱敏、混合模型历史的错误标注、最近完整轮次；复核确认 Important 项已解决。
- 没有启动客户端或浏览器；真实系统剪贴板粘贴及 PNG 像素验收尚未执行。超保存预算提示缩小范围，本轮不自动分图；不支持的嵌入内容明确拒绝，绝不静默截图缺失或降清晰度。

### 选择界面跟进

- 按用户提供的微信参考统一时间线左侧勾选列，移除整行选中背景与逐条按轮按钮，校准头像、正文与勾选框起始线，扩大点击区域。
- 消息内容点击支持选择 / Shift 连选；拖动文字不误选，选择期间拦截所有消息的原始动作，退出恢复。按轮操作跟随最后点击的消息，批量操作收进范围菜单；底栏单行优先、窄窗换行并保留实际布局高度。
- 相关 259 项回归、主 / 独立窗口草稿保留 2 项及按轮跟随点击复测通过；完整 desktop typecheck、相关文件 ESLint、hard constraints 与 renderer build 通过。独立只读复核无新增高置信问题。
- 未启动客户端或浏览器；窄窗实际像素、Chromium 原生文字选区与系统剪贴板 / 保存仍需实机验收。
