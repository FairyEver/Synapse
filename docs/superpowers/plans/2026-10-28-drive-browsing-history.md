# 云盘浏览历史 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Follow the user's current-branch constraint; no new branch/worktree. Independent server, desktop and browser files may be delegated after the shared contract is fixed.

**Goal:** 在现有桌面云盘中找回浏览器账号下每次成功打开的分享链接。
**Architecture:** PostgreSQL 保存本人访问事件及私有搜索快照；网页就绪上报与服务端顶层导航采集共用服务；桌面通过 AccountService 的私有 IPC 查询、清空，外链复用既有能力。
**Tech Stack:** NestJS / Prisma / PostgreSQL、Electron / React / Radix Sheet、现有 pnpm / Vitest。
**Spec:** `docs/superpowers/specs/2026-10-28-drive-browsing-history-design.md`

## Global Constraints

- 同一账号对同一链接只保留一条记录，重复打开刷新标题、作者和访问时间并排到最前；仅同一 visitId 重试幂等。
- 不显示表头、数量、排序说明或行内类型文字；只有搜索框和类型选择。
- 不改 APNS、更新/打包逻辑，不执行数据库迁移/部署，不新增依赖。
- 历史仅本人可见，不公开作者私有身份字段，不存密码、token、正文。

## Review Focus

- 浏览器 cookie 账号与桌面/Bearer 账号不同，必须归属浏览器。
- iframe、资源与 MCP 抓取不得成为历史；密码页/错误页不记成功。
- 相同链接多次打开独立保存，React 重挂载/上报重试不得多记同一事件。
- 清空、换账号、搜索/翻页交错时，不回填旧账号或旧条件结果。
- 私有搜索字段不出现在公开 DTO、分享元数据或日志；链接不带密码。

### Task 1: 服务端事件持久化与浏览器采集接口

**Files:** 新建 `server/src/drive/drive-browsing-history.service.ts` 及测试；修改 Prisma schema / SQL migration、DriveModule / Controller。
**Interfaces:** shared `DriveBrowsingHistoryListInput`, `DriveBrowsingHistoryEntryDto`, `DriveBrowsingHistoryPageDto`；GET/DELETE `/api/drive/browsing-history`；POST `/api/drive/browser/shares/:shareId[/items/:itemId]/visits` 接收 `{visitId: UUID}`。分享访问依赖现有密码 cookie；记录归属仅验证 web session cookie。

- [x] 先写账号隔离、同链接独立访问/事件幂等、搜索/游标、清空和导航过滤测试，执行确认缺失行为。
- [x] 实现有界查询、私有索引、成功访问采集与故障日志，生成迁移，不执行数据库写入。
- [x] 运行服务端专项测试及 typecheck，修复失败。

### Task 2: 桌面私有 IPC 与精简 Sheet

**Files:** AccountService / account IPC / preload / bridge；drive 顶栏、history hook / Sheet 及测试。
**Interfaces:** `window.synapse.drive.browsingHistory.list(input?)` / `.clear()`；返回 Task 1 shared 契约；路径见上，查询参数 query/kind/cursor/limit。

- [x] 先写 IPC 校验、搜索/翻页与账号切换隔离、清空确认、默认浏览器打开的交互测试，运行红灯。
- [x] 实现服务调用、生成 IPC、复用现有 Sheet/InputGroup/NativeSelect 和外链 opener。
- [x] 执行桌面专项测试、typecheck、硬约束与 IPC 一致性检查。

### Task 3: 网页成功访问上报

**Files:** dashboard API、drive-browser 访问 hook / page 及测试。
**Interfaces:** Task 1 visits POST；每次导航 UUID，同次访问的重复 effect 共用 ID，ready 后上报，不报 owner/未就绪/失败，账号由服务端 cookie 验证。

- [x] 先测成功访问/匿名/重复 effect、换目标再返回的新事件与失败路径。
- [x] 实现集中 API 与 hook，后台刷新及分页不生成新访问。
- [x] 运行网页专项测试和 typecheck。

### Task 4: 集成、文档和交付

- [x] 更新发布说明、模块边界、能力清单和系统 Skill 的 UI 私有例外。
- [x] 检查所有 diff，运行最小充分跨层验证并完成独立审查；只提交本任务文件，不 push。
- [x] 明确迁移尚未执行与线上尚未部署，提供提交和迁移位置。

## 最终验证与交付记录

- 桌面完整 `pnpm --filter @synapse/desktop run test --maxWorkers=4`：1116 个文件、11464 项通过；2 个既有原生 SDK 测试跳过。
- 服务端完整 `pnpm --filter @synapse/server run test --maxWorkers=4`：164 个文件、2070 项通过。
- 网页完整 `pnpm --filter @synapse/dashboard exec vitest run --maxWorkers=4`：110 个文件、944 项通过。
- desktop 全部 TypeScript 项目、server typecheck、dashboard tsc、desktop 硬约束、IPC 生成一致性、相关 desktop ESLint、网页 Drive 埋点检查通过；Prisma schema validate 与客户端生成通过（验证使用无真实凭据的假连接串，不连接数据库）。
- 独立审查提出的三个问题均已补回归并修复：清空后旧访问重试恢复、清空失败与搜索交错卡住、BFCache 恢复遗漏访问。另补齐默认浏览器异常的过期作用域隔离、认证重试身份绑定和清空后关闭重开的刷新。
- 首轮扩大测试出现 workspace-files 的 Git 预算/超时、scheduler 取消时序、Drive 搜索超时/后续行缺失，以及修复中的两项历史清空竞态。对应 4 个文件串行复跑 279 项通过；源码固定后上述桌面全量再次通过。服务端早期全量发生连接重置/文件上传超时，以及搜索长度约束对齐过程中的回归失败；最终完整重跑全部通过，未放宽断言或超时。
- 本次只在原 main 工作区实施并本地提交，不 push。未启动产品应用或浏览器，也未进行真实账号/真实数据库 E2E、数据库迁移或部署。
- 上线需要应用 `server/prisma/migrations/20261028192000_drive_browsing_history/migration.sql`，并发布对应服务端、网页与桌面产物。迁移只新增独立表，回滚代码可保留该表，不需要破坏性删表；旧代码不消费历史数据。
