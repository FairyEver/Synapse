# 云盘文件搜索实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 按已确认的云盘原型交付可用文件搜索，保持现有顶栏、表格与行内操作。

**Architecture:** 扩展既有 `app.drive.item_tree.list` 的查询条件，在服务端递归树过滤后统计、排序、分页；不新增 capability。通过现有 AccountService 与类型化 IPC 接入桌面，独立搜索 hook 管理输入、请求代际、分页和返回状态，现有列表继续承担文件操作。

**Tech Stack:** React 19、现有 shadcn/Radix Nova、Electron 类型化 IPC、NestJS、Prisma/PostgreSQL、Vitest。

**Spec:** `docs/prototypes/2026-10-20-drive-search/README.md`（用户已确认并明确要求实现）。

## Global Constraints

- 在当前仓库、当前 main 分支开发，不创建分支或 worktree，不新增依赖。
- 搜索入口位于“同步管理”左侧；点击后在原导航行展开输入与筛选。保留名称、更新时间、操作三列及现有行内操作。
- 全盘 / 当前文件夹及子文件夹；文件名与扩展名匹配，不读取正文。大小写、全角归一化，多关键词共同匹配。
- 类型、更新时间、分享状态与排序在服务端分页前完成；沿用每批 100 项、加载更多。
- 保留账号权限和普通云盘可见性，排除回收站、公开素材与其上传中间态。
- 新增/修改能力参数必须同步 IPC、MCP 描述/schema、系统 Skill 指南、能力清单及待发布说明。
- 使用现有组件与主题 token，禁止自定义 CSS、颜色和普通内联样式；不启动应用、浏览器或开发服务器。

## Review Focus

- 只命中第 101 项以后或深层子目录时仍能搜索；筛选统计与续页必须来自相同匹配集。
- 快速输入、清除、中文组词、切换账号/目录后，迟到响应不能覆盖当前结果。
- 文件移动、重命名或删除后按 ID 定位并复查父链；目标不在目录首批时仍可见。
- 同名文件展示真实父级路径；搜索结果不能继承当前浏览目录的错误同步关系。
- 清除筛选、返回搜索结果、预览关闭与操作刷新不丢失查询条件，不改变分享、删除、同步的实际作用对象。

## Task 1: 递归搜索契约与服务端

**Files:** `shared/src/drive.ts`、新的 `shared/src/drive-search.ts`；`server/src/drive/drive.service.ts`、`drive.controller.ts` 及相应测试。

**Interfaces:** 扩展 `DriveItemTreeListInput`，接受 `query?`、`fileType?`、`updatedAfter?`、`shareStatus?`、`sort?`，继续返回 `DriveItemTreeListPageDto`。无新条件时保留既有树顺序。

- [x] 先写失败测试：深层/跨页匹配、多词全角、类型/有效分享/日期组合、排序、权限与生命周期隔离、SQL 过滤先于分页。
- [x] 增加共享查询规则；在既有递归查询中增加过滤与排序，计数和分页使用同一匹配集；内存测试分支保持同口径。
- [x] 运行 shared 与 server Drive 专项，确认从失败到通过。

## Task 2: 桌面桥接与能力一致性

**Files:** `desktop/electron/services/account-service.ts`、`desktop/electron/modules/account/ipc.ts`、`desktop/electron/capabilities/drive-dispatcher.ts`、`desktop/synapse-capabilities/shared/drive-domain.ts`、`desktop/src/types/bridge.ts` 及生成的 IPC/preload 描述。

**Interfaces:** 既有 `app.drive.item_tree.list` 增加相同查询字段；新增其 UI IPC 映射 `window.synapse.drive.itemTree.list(input)`，不增加工具数量。

- [x] 先写失败测试：参数校验、HTTP query 编码、dispatcher 转发、返回 path/分页字段保留。
- [x] 按现有 AccountService 客户端、IpcRegistry 与 capability PermissionGuard/AuditSink 路径接入并生成描述。
- [x] 运行账户 IPC/客户端、Drive dispatcher 与工具域专项。

## Task 3: 现有页面搜索入口与交互

**Files:** 新增 `desktop/src/modules/drive/` 搜索 hook、控件与高亮薄组件；小范围修改 `index.tsx`、必要同步路径适配及现有测试。

**Interfaces:** 搜索 hook 独立管理展开、查询/筛选、请求代际、100 项加载更多、历史和返回状态；列表接收逐项真实路径/祖先信息及定位回调，不复制原文件操作。

- [x] 先写失败测试：实际入口位置/列保持不变、IME/防抖/迟到响应、无结果/重试、组合过滤、定位后返回、跨页目标和账号清理。
- [x] 将入口注入 `DriveToolbarActions.children`；在导航行展开 InputGroup，在原表格显示搜索条目、高亮和父路径；沿用原预览、更多和文件操作。
- [x] 运行搜索与现有 Drive/UI 壳层专项；修复真实失败，不放宽断言。
- [x] 同步 Skill/API 指南、能力表例外说明、模块规则和待发布说明；运行 typecheck、hard constraints、renderer build 和 diff 检查。
- [x] 完整检查变更、独立审查，处理重要问题；仅提交本次文件，中文本地提交，不 push。

## 执行记录

- 用户已明确授权按确认原型实现，在当前目录 main 内连续执行；不重复发起设计或分支授权。

- Task 1: complete — shared 全套 274 项、server Drive service/controller 253 项通过；名称归一化、过滤先于统计/分页、权限与生命周期隔离、参数化 SQL、无效条件均已验证。
- Task 2: complete — AccountService HTTP 编码、IPC 校验、dispatcher、真实 preload 桥与工具注册专项通过；IPC codegen 同步，Drive 工具数量保持 76。
- Task 3: complete — 桌面 Drive、preload、账号客户端/IPC、dispatcher、能力域/注册表及工具路由共 591 项通过。搜索 hook 覆盖 IME、防抖、迟到响应、账号隔离、分页、暂停恢复与失败重试；页面覆盖入口顺序、原三列、预览、定位、取消分享和删除后刷新。
- Final review: fresh read-only reviewer — 发现两项 Important，均已完成 RED→GREEN：暂停搜索期间修改文件导致旧结果及普通目录快照恢复；跨层父子结果导致父目录漏显含同步项。修复后以上桌面 591 项全绿，无遗留审查项。
- 验证：shared build/test、server typecheck、desktop 全量 typecheck、Renderer/Electron 构建、Renderer ESLint、hard constraints、IPC codegen 与 git diff --check。
- 安装包检查限制：check:packaged-asar 扫描本机既有 release/mac-arm64 产物，因缺少已有 Mobile Workspace/Todo 模块及资源失败；未把旧安装包视为本次构建验证，未启动应用或执行部署。
