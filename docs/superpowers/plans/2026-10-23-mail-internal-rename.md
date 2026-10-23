# 站内信领域改名 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有站内信的公开领域改为 `mail-internal`，保留历史数据和功能，为外部邮箱释放 `mail`。

**Architecture:** 先建立命名和迁移回归，再切换桌面、服务端及原有移动端引用。现有数据库物理实体和附件对象不搬迁；公开入口无兼容别名。全部任务完成后才可协调发布，不单独发布中间提交。

**Tech Stack:** 现有 Electron / React / TypeScript、DataRepository、NestJS / Prisma、Swift Foundation。此计划不新增依赖。

**Spec:** `docs/superpowers/specs/2026-10-23-mail-client-design.md`，重点 §5、§12。

## Global Constraints

- 本计划先于 `2026-10-23-mail-client.md` 执行；新邮箱不能在改名迁移完成前注册为 `mail`。
- 当前仓库、当前分支开发；不创建或使用其他 worktree，不启动应用、CI、部署或真实邮箱测试。
- 计划编写时已有无关修改：`desktop/electron/services/agent-runtime/synapse-tool-router.ts`、`desktop/synapse-capabilities/shared/naming.ts`。执行前重新检查，不能覆盖或混入提交。
- App ID / 路由 host 为 `mail-internal`，capability namespace 为 `mail_internal`，工具前缀为 `app_mail_internal_`。
- 两个领域分别使用 `synapse://mail/<id>`、`synapse://mail-internal/<id>`；此计划完成时只注册后者。
- 不保留旧兼容入口；不删除信件、附件、通知或历史审计；不改邮件正文里的旧链接。
- 不新增手机邮箱；手机仅更改现有站内信 API、source 和严格深链解析。
- 不改已发布 `dock.mail-introduction.v1` 条目；新迁移标记与配置原子保存。
- 每个任务通过相应验证后，仅暂存本任务文件并中文提交；所有用户可见变化同步更新 `RELEASE_NOTES_PENDING.md`。

## Review Focus

1. 曾移除站内信 Dock 图标的用户升级后不能重新被固定；历史备份重放不能把新邮箱误当旧站内信。（R1）
2. 已排队未投递的站内信通知升级后最多创建原来那一条，不能因 source 改名绕过去重。（R3）
3. 老 Agent 用旧工具名和旧发送 schema 调用不能触发任何新业务写入。（R2；新邮箱计划 C11）
4. 手机收到包含多段路径、query、编码斜杠的链接不能误开第一段 ID。（R4）
5. 站内信附件大文件经过 Nginx 和 body parser 仍沿原通道处理，不能在改 URL 后意外变成 JSON 请求。（R3）

## 文件布局与顺序

| 任务 | 主要产物 | 依赖 |
| --- | --- | --- |
| R1 | 纯配置迁移与历史输入回归 | 无 |
| R2 | 桌面 App、能力、IPC、深链及 Skill 改名 | R1 |
| R3 | API、通知 source 与数据迁移、管理台、发布脚本 | R2 的命名契约 |
| R4 | iOS 已有站内信引用、全链路静态验收和发布交接 | R2、R3 |

现有目录移动须保留 `git mv` 历史。服务端 `server/src/mail/`、Prisma `Mail*` 表、COS `mail/attachments/`、历史审计键及去重 `sourceKey=mail:<id>` 保持为内部实现细节，不属于旧公开入口。不为重命名制造数据库表搬迁。

### Task 1: R1 — 旧 App 身份迁移

**Files:**
- Create: `desktop/src/modules/apps/mail-internal-migration.ts`
- Test: `desktop/src/modules/apps/__tests__/mail-internal-migration.test.ts`（新）。生产读取/恢复接入及相关现有测试归 R2，避免新 App 尚未注册时先把配置迁到无法识别的 ID。

**Interfaces:** `migrateInternalMailConfig(config: unknown): unknown` 是现行 `SynapseConfig` 校验前的纯历史输入转换，输出由 R2 现行配置 schema 校验；声明迁移 ID `dock.mail-internal-rename.v1`。只对未完成迁移的历史配置，将其实际存在的 App 标识字段从 `mail` 改为 `mail-internal`，不递归改任意字符串。迁移模块不得运行时导入 App 注册表，避免历史迁移反过来加载 Renderer。

- [ ] 写失败测试，覆盖完成/未完成旧 introduction、用户移除、重复运行、旧备份转换和不修改输入。固定断言：
  ```ts
  expect(migrated.global.dockAppIds).toEqual(['mail-internal', 'launcher'])
  expect(migrateInternalMailConfig(migrated)).toEqual(migrated)
  expect(migrateInternalMailConfig(removed).global.dockAppIds).not.toContain('mail-internal')
  expect(original).toEqual(originalSnapshot)
  ```
- [ ] 运行 `pnpm --filter @synapse/desktop test src/modules/apps/__tests__/mail-internal-migration.test.ts`，确认因缺少迁移而失败。
- [ ] 实现纯迁移，并审查实际配置中的 Dock / 窗口 / App 偏好字段。原始历史 ID 在最终正常化前迁移：旧 Dock 操作按原顺序重放，随后 rename，再过滤有效新 App ID。历史迁移输入类型与公开 `SynapseSystemAppId` 分开，不能为通过类型检查保留旧 App 注册。新装配置预先标记完成；新装与已迁移配置中的 `mail` 留给未来外部邮箱。
- [ ] 复用既有版本迁移器实现纯转换并声明完成标记的计算；R1 不调用生产持久化，也不提前注册或激活新迁移。原子保存与写失败回归在 R2 接入时完成。
- [ ] 重跑 `pnpm --filter @synapse/desktop test src/modules/apps/__tests__/mail-internal-migration.test.ts`，全部 PASS。
- [ ] 检查暂存区只含本任务文件；提交 `fix: 保留站内信布局并迁移旧应用身份`。此阶段不发布。

### Task 2: R2 — 桌面领域、MCP、IPC 与深链改名

**Files:**
- Move: `desktop/src/modules/mail/` → `desktop/src/modules/mail-internal/`；`desktop/app-capabilities/mail/` → `desktop/app-capabilities/mail-internal/`
- Move: `desktop/synapse-capabilities/shared/mail-domain.ts`、`mail-input.ts` → 同目录 `mail-internal-domain.ts`、`mail-internal-input.ts`
- Move: `desktop/electron/capabilities/mail-dispatcher.ts` → `mail-internal-dispatcher.ts`；`desktop/electron/bootstrap/mail-protocol-handlers.ts` → `mail-internal-protocol-handlers.ts`，相应测试同步
- Move: `desktop/app-capabilities/synapse-skill/skill-package/mail/` → `mail-internal/`
- Modify: `desktop/src/modules/apps/{types.ts,definitions.ts,registry.ts,system-app-window-app.tsx,components/system-app-content.tsx}`；`desktop/electron/{services/system-app-window-service.ts,modules/apps/ipc.ts,modules/account/ipc.ts,preload.ts}`
- Modify: `desktop/src/modules/apps/dock.ts`、`desktop/electron/services/{config-store.ts,config-backup-service.ts}`、`desktop/src/lib/config.ts`、`desktop/src/types/config.ts` 及现有 dock / config-store / config-backup 测试
- Modify: `desktop/electron/{bootstrap/descriptors.ts,bootstrap/app-ready.ts,bootstrap/ipc-registry.ts,capabilities/action-router.ts}`；`desktop/synapse-capabilities/shared/{registry.ts,message-reference.ts}`
- Modify: `desktop/src/lib/mail-api.ts`、`desktop/src/components/mail-quick-reply-dialog.tsx`、`desktop/src/app-shell/{hooks/use-message-center.ts,components/message-center.tsx,notification-detail-text.ts}` 及其现有测试
- Test: `desktop/synapse-capabilities/shared/__tests__/{registry.test.ts,message-reference.test.ts}`、`desktop/electron/capabilities/__tests__/action-router.test.ts`、`desktop/tests/unit/api-mcp-capability-surface.test.ts`

**Interfaces:** 原 17 个 capability 和 schema 原样保持业务语义，域名换为 `app.mail_internal.*`；bridge 对应 `window.synapse.mailInternal.*`，不能继续挂在 `mail`。站内信 open request 改为 `mailInternalOpenRequest`，`createMailInternalProtocolHandlers` 只接受 `mail-internal` host。

- [ ] 写失败契约测试：17 个工具全在新域，旧域零注册；新链接同 ID 可解析，旧链接及 query/fragment/编码分隔符拒绝；普通 `get` 不设已读。固定断言：
  ```ts
  expect(internalTools).toHaveLength(17)
  expect(internalTools.every(t => t.name.startsWith('app_mail_internal_'))).toBe(true)
  expect(parseInternalMailReference('synapse://mail/x')).toBeNull()
  await expect(oldActionCall).rejects.toThrow('Unknown action:')
  expect(sendSpy).not.toHaveBeenCalled()
  ```
- [ ] 运行 `pnpm --filter @synapse/desktop test synapse-capabilities/shared/__tests__/message-reference.test.ts electron/capabilities/__tests__/action-router.test.ts`，确认旧注册使测试失败。
- [ ] 移动文件、改 imports 和领域常量，保留旧信件逻辑；更新 action-router 的 `mail_internal` 分发。MCP dispatcher 与 UI handler 共享原有服务端权限边界，不创建别名或旧 action 转译。借助 IPC 生成脚本更新 bridge，不手改生成产物。
- [ ] 新 App 定义就绪后，在读取/恢复的现行 App ID 校验前接入 R1。旧 Dock 操作先重放、随后 rename、最后过滤有效新 ID；配置与完成标记原子落盘，写成功前不更新缓存。增加真实配置加载与备份导入回归，覆盖旧 ID 不提前被过滤、已移除图标不复活、写盘失败保留原配置及标记；运行 `pnpm --filter @synapse/desktop test src/modules/apps/__tests__/dock.test.ts electron/services/__tests__/config-store.test.ts electron/services/__tests__/config-backup-service.test.ts`，全部 PASS。
- [ ] 把账号消息中心及站内信快捷回复的导航目标改到 `mail-internal`，更新系统 Skill 总索引与站内信指南链接；通知来源在 R3 同步。更新 capability-registry 和 module-boundaries 的当前状态、发布说明，并明确与 R3/R4 同批交付。
- [ ] 运行 `pnpm --filter @synapse/desktop run generate:ipc`、`pnpm --filter @synapse/desktop run check:ipc-codegen`，再运行 `pnpm --filter @synapse/desktop test src/modules/mail-internal electron/capabilities/__tests__/mail-internal-dispatcher.test.ts synapse-capabilities/shared/__tests__ tests/unit/api-mcp-capability-surface.test.ts`，全部 PASS；审查 `git diff --check`。
- [ ] 仅提交本任务文件：`refactor: 将桌面站内信能力和深链迁入 mail-internal 领域`。

### Task 3: R3 — 服务端、数据、管理台和发布通知改名

**Files:**
- Modify: `server/src/mail/{mail.controller.ts,mail.service.ts,mail-http.spec.ts,mail.service.spec.ts}`；`server/src/admin/{admin.controller.ts,admin-mail-broadcast-http.spec.ts}`
- Modify: `server/src/{app.module.ts,notifications/notification.service.ts,notifications/notification.service.spec.ts}`、`server/nginx.conf`、`shared/src/notifications.ts`
- Create: `server/prisma/migrations/20261023000100_mail_internal_namespace/migration.sql`、`server/src/mail/mail-internal-migration.spec.ts`
- Modify: `desktop/electron/services/account-service.ts` 及现有测试；`dashboard/src/lib/{api.ts,api.test.ts}`、`dashboard/src/{admin-routes.tsx,admin-routes.test.ts}`、`dashboard/src/components/layout/data/admin-sidebar-data.ts`
- Modify: `.agents/skills/synapse-release-publisher/scripts/{send-release-mail.mjs,send-release-mail.test.mjs}` 及该 Skill 中当前 API 说明
- Modify: `desktop/app-capabilities/synapse-skill/skill-package/{mail-internal/api-reference.md,notifications/api-reference.md}`；`docs/agents/module-boundaries.md`、`RELEASE_NOTES_PENDING.md`

**Interfaces:** 用户 API `/api/mail-internal/...`；管理 API `/api/admin/mail-internal/...`；管理台页面 `/mail-internal`（原 `/mail` 不重定向）；`UserNotification.source/group = 'mail-internal'`；系统生成 URL `synapse://mail-internal/<targetId>`。`sourceKey` 继续 `mail:<messageId>`，因此旧 outbox 重试仍受原唯一键保护。

- [ ] 为 HTTP 路由、附件 multipart、通知去重和迁移写失败测试：
  ```ts
  expect(await oldRoute()).toHaveProperty('status', 404)
  expect(await newRouteAsAuthorizedUser()).toHaveProperty('status', 200)
  expect(after.sourceKey).toBe(before.sourceKey)
  expect(after.readAt).toEqual(before.readAt)
  expect(notificationCountAfterOutboxRetry).toBe(1)
  expect(after.url).toBe(`synapse://mail-internal/${before.targetId}`)
  ```
- [ ] 运行 `pnpm --filter @synapse/server test src/mail/mail-http.spec.ts src/mail/mail-internal-migration.spec.ts src/notifications/notification.service.spec.ts`，确认当前旧路由/数据转换未满足断言。
- [ ] 更改 controller、account-service、管理台 API 和发布脚本；修正 app.module 的附件 body-parser 排除与 Nginx 独立附件 location。先通过 `rg` 补全当前调用者，排除历史设计文档、旧数据库迁移及用户正文；不修改只读 templates。
- [ ] 编写幂等 SQL：仅更新 `UserNotification.source='mail'` 的系统来源，group 为 mail 时改名，URL 仅在与该记录 targetId 构成的旧标准 URL 精确匹配时改写；保留 sourceKey、ID、readAt、deletedAt、createdAt。`MailNotificationOutbox` 无 source 字段，无需改表。新 outbox 投递直接产生新 source/URL。不要执行历史 `purge-legacy-mail.sql`，不要改变其历史语义。
- [ ] 用测试数据做转换断言和 SQL 静态检查；真实 PostgreSQL 迁移验证只在已授权、明确隔离的测试库执行，未配置时保留为发布前待验项，不能连接默认业务库。运行上述 server 测试、`pnpm --filter @synapse/server run typecheck`、`pnpm --filter @synapse/shared test`、`pnpm --filter @synapse/dashboard run tsc`、`node --test .agents/skills/synapse-release-publisher/scripts/send-release-mail.test.mjs`，全部 PASS。
- [ ] 提交 `refactor: 切换站内信 API 和通知领域并保留历史去重状态`。

### Task 4: R4 — 原有手机入口与跨端交接验收

**Files:**
- Modify: `SynapseMobile/SynapseMobile/Core/Networking/APIClient.swift`、`SynapseMobile/SynapseMobile/Features/Root/RootView.swift`、`SynapseMobile/SynapseMobile/Features/Inbox/NotificationDestination.swift`
- Create: `SynapseMobile/SynapseMobile/Core/Networking/InternalMailReference.swift`、`SynapseMobile/scripts/internal-mail-reference-check.swift`
- Modify: `SynapseMobile/SynapseMobileTests/{MailStoreTests.swift,NotificationDestinationTests.swift,NotificationDeepLinkTests.swift}`，项目文件仅在实际需要登记新源文件时修改
- Modify: `docs/agents/{capability-registry.md,module-boundaries.md,mobile-runtime-contracts.md}`、`RELEASE_NOTES_PENDING.md`
- Create: `docs/agent-guides/mail-internal-cutover.md`

**Interfaces:** `InternalMailReference.parse(_ url: URL) -> String?`，纯 Foundation，严格 host + 单路径段 + 无 query/fragment；现有业务 route enum `.mail` 可保留为 Swift 内部符号，用户可见标识只用 `mail-internal`。

- [ ] 写失败测试：有效新链接返回 ID；旧 host、双路径、编码斜杠、空 ID、query、fragment 全为 nil；通知新 source 跳转原有站内信页，绝不打开外部邮箱。
- [ ] 使用新建 Foundation harness 执行上述表驱动断言：`swiftc SynapseMobile/SynapseMobile/Core/Networking/InternalMailReference.swift SynapseMobile/scripts/internal-mail-reference-check.swift -o /tmp/synapse-internal-mail-reference-check`，再运行生成文件；实现前应失败。harness 使用 `@main`，不依赖 App 或模拟器启动。
- [ ] 接入 parser、替换 API 路径和通知 source；保持 Mail 页视觉、账户鉴权、附件下载和现有业务语义。更新所有生产路径引用，不扩展手机功能，不改 APNS_USE_SANDBOX。
- [ ] 重跑 harness，结果 PASS；运行 `xcodebuild -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/synapse-mail-internal-build CODE_SIGNING_ALLOWED=NO build-for-testing`，应 BUILD SUCCEEDED。这里只证明编译，XCTest 运行另需用户授权启动模拟器，不能写成测试已执行。
- [ ] 执行 desktop typecheck、hard-constraints、相关站内信/消息中心/路由测试。只在候选包已构建时运行 packaged-asar；不要用旧包检查结果冒充新包验证。
- [ ] 完成 cutover 指南：列出备份/隔离库预演/服务端+桌面+iOS 协调升级/旧版本失效说明/通知不重发/恢复步骤。用 `rg` 检查旧入口，剩余项必须属于历史资料、物理存储、迁移输入或去重键，记录理由。
- [ ] 提交 `fix: 同步手机站内信入口并完善改名迁移验收说明`。本计划结束不自动部署、发版或推送。

## 完成判定

R1–R4 全部完成后，现有站内信仍可读取、收发、回复/转发、附件和通知定位，入口全部为新领域；注册的站内信 MCP 数仍为 17。历史数据未清理、通知未重发、旧入口被拒绝。已执行检查与仍需真实环境的验收分开记录，然后进入邮箱客户端计划。

## 计划交接状态（2026-10-23）

已依据设计完成范围、接口、任务依赖和检查命令自检，补齐旧备份在 App ID 校验前迁移，以及桌面定义表和管理台路由测试的改动位置。R1–R4 已完成；Foundation 检查、iOS 编译、桌面类型与相关回归通过，证据见本计划 ledger。尚未部署、发版或操作真实业务数据库。
