# 新站内信与新邮件触发器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加两种收信触发器，复用现有执行器，提供包含正文的信件变量，在线及时触发、恢复后补收且不重复自动调用执行器。

**Architecture:** 来源适配器分别负责站内信和本机 IMAP 邮箱的权威接收边界、分页补查和只读正文。独立协调服务使用本机持久队列与去重账本，向原有 Automation 执行通道提交事件；现有自动化配置和运行历史继续使用原存储，不整体迁移。

**Tech Stack:** Electron 44、React 19、TypeScript 6、shadcn/Radix Nova、DataRepository SQLite/JSON、NestJS、Prisma/PostgreSQL、既有 ImapFlow/MailParser、Vitest、pnpm 12.16.1；不新增依赖。

**Spec:** [已确认设计](../specs/2026-11-05-automation-mail-triggers-design.md)。执行者必须同时阅读设计和本计划；本文件中的新路径、类型和签名是拟新增实现，不表示当前已经存在。

## Global Constraints

- 在 `/Users/liyang/Documents/code/github/Synapse` 当前分支工作；计划编写时为 `main`。未经明确授权不得创建/切换分支或使用其他 worktree，不推送、不部署、不发版。
- 只实现「收到新的站内信」「收到新的邮件」，一个触发器对应一个现有执行器。默认任意新信，外部邮件可选全部账号或一个指定账号，不增加其他筛选。
- 首次启用/重新启用必须联网确认来源起点，失败保持未启用；没有延迟自动启用。启用成功后离线不关闭有效时间段，恢复后补触发。
- 去重按自动化和来源收件身份持久保存；独立于最近 100 条运行历史。失败、取消或结果不明的执行不自动重放。
- 同一自动化逐封串行，忙时保留队列；通用 `overlapPolicy: skip` 和 `missedRunPolicy` 不得导致邮件丢弃，不改变其他触发器语义。
- 正文执行前按需读取，不标记已读，不下载附件字节、不加载远程图片。沿用 **5 MiB** 读取上限；空正文合法，截断/失败不能冒充完整正文。
- 兜底补查间隔 **60 秒**，配置集中到 `desktop/config.ts`，不增加用户配置。
- 队列、订阅、进度和去重命名空间均 `transferPolicy: local-only`。不把正文写入这些记录、日志或审计元数据。
- 身份至少包含服务端来源和 SY 用户 ID；异步执行使用额外运行时代际与取消信号。Renderer 只能通过既有类型化 bridge 访问账号。
- 只改必要文件；不启动开发服务器、浏览器、Playwright 或应用。仅修改文档的当前阶段不运行产品测试。
- 先读 `CLAUDE.md`、`docs/agents/execution-rules.md`、`repository-guide.md`、`workflow-and-capabilities.md`、`module-boundaries.md`、`capability-registry.md` 及 `.claude/rules/api.md`、`testing.md`。UI 任务另读 `ui-and-product.md`、`.claude/rules/{frontend,design,ui-rules}.md`、`desktop/components.json`、`desktop/src/styles/globals.css` 和已有组件。
- 每项实现采用失败测试 → 最小实现 → 专项验证；本地提交只含本任务文件，提交摘要用中文。所有命令从仓库根运行，测试使用单次运行。

## Review Focus

1. 长事务中的站内信晚于起点确认才提交：必须归入新信，不能只按 `sentAt` 漏掉；Task 2 提交顺序并发测试。
2. 来源起点已保存、启用配置尚未提交时进程退出：不得后台自行启用；Task 4 故障点恢复测试。
3. 运行历史超过 100 条并裁剪后再次发现同一封信：不能再次执行；Task 6 持久去重测试。
4. 新账号接入、用户切换或 IMAP 世代变化与旧正文响应交错：旧结果不能执行，其他正常来源继续运行；Tasks 3、5、8 代际测试。
5. 用户修改已有任务时配置与新订阅只有一半保存成功：旧订阅不能被静默替换；Tasks 4、9 原子引用与恢复测试。

## 文件职责与依赖

新增主要文件如下；每项完整的修改/测试文件在对应 Task 中列出。

| 文件/目录 | 职责 |
| --- | --- |
| `desktop/electron/services/automation-mail-triggers/types.ts` | 主进程协调层的身份、边界、引用、来源接口和持久记录类型 |
| 同目录 `repository.ts` | SQLite 待处理账本、游标、去重、执行提交 CAS |
| 同目录 `internal-source.ts`、`external-source.ts` | 对接两个来源，不能自行访问它们的内部数据库或凭据 |
| 同目录 `activation.ts` | 在线准备边界与启用引用的提交/恢复 |
| 同目录 `payload.ts`、`service.ts` | 正文变量准备、补查、串行投递与恢复 |
| `desktop/electron/runtime/data-repo/schemas/automation-mail-triggers.ts` | 本机 schema、原子字段、字节预算与范围索引 |
| `server/src/mail/mail-receipt-feed.ts` | 站内信提交边界锁与本人增量收件查询 |
| `desktop/app-capabilities/mail/main/automation-receipts.ts` | 邮箱 service 内部的 UID 边界、有限同步及定位查询 |
| `desktop/automation-trigger-packages/builtin/mail-{internal-received,received}/` | 两个触发器的 schema/manifest/main/renderer；仅外部邮件有配置表单 |

依赖顺序：Task 1 → Tasks 2、3 → Task 4 → Tasks 5、6 → Task 7 → Tasks 8、9 → Task 10。此为功能内部的开发顺序，不授权并行代理或新建工作目录。

## Task 1: 持久队列、来源契约与去重存储

**Files:** 新增上述 `types.ts`、`repository.ts`、`schemas/automation-mail-triggers.ts`、`automation-mail-triggers/__tests__/repository.test.ts`；修改 `desktop/electron/runtime/data-repo/schemas/index.ts`，补充 `__tests__/schemas.test.ts` 和 `__tests__/repository.test.ts`。

**Interfaces:** 在 `types.ts` 定义：
- `MailTriggerIdentity = { apiOrigin: string; ownerId: string }`；运行时代际单独由 `MailTriggerContext = { identity: MailTriggerIdentity; generation: number; signal: AbortSignal }` 承载，不持久化 AbortSignal。
- `MailSourceBoundary` 为带 `kind` 的来源联合：站内信存十进制字符串 `receiptSequence` 和服务端 UTC；邮箱存 `accountId/folderId/endpointEpoch/uidValidity/uidNext`。序列与 UID 不用浮点数猜测。
- `MailReceiptRef` 包含 `sourceKey`、稳定 `receiptKey`、可选本机 `messageId`、来源定位、`receivedAt: string | null`，不带正文。`sourceKey` 包含身份和端点世代，不包含秘密。
- `MailReceiptPage = { receipts: MailReceiptRef[]; nextCursor: string; complete: boolean }`；`nextCursor` 代表实际扫描到的边界，空结果也可安全推进。
- `PreparedMailPayload` 具有设计中的 10 个共用字段，外部邮件额外包含 3 个账号字段；`attachments` 是元数据 JSON 字符串。
- `MailReceiptSource` 提供 `prepare(context, accountId?): Promise<MailSourceBoundary[]>`、`scan(context, boundary, cursor, limit): Promise<MailReceiptPage>`、`hydrate(context, receipt): Promise<PreparedMailPayload>`。两个适配器均满足此接口。
- `MailTriggerRepository` 提供 `prepareSubscription(input: PrepareSubscriptionInput): Promise<string>`、`getSubscription(id: string): Promise<SubscriptionRow | null>`、`enqueuePage(subscriptionId: string, sourceKey: string, expectedRevision: number, page: MailReceiptPage): Promise<boolean>`、`nextPending(automationId: string): Promise<DeliveryRow | null>`、`commitDispatch(deliveryId: string, expectedRevision: number, runId: string): Promise<boolean>`、`finishDispatch(deliveryId: string, result: DeliveryOutcome): Promise<void>`。`PrepareSubscriptionInput` 包含 identity、automationId、分源边界；持久行把 identity 展平为 ownerId/apiOrigin 标量，便于声明索引。`SubscriptionRow` 包含 id/schemaVersion/ownerId/apiOrigin/automationId/revision/state/createdAt/可选 endedAt；`SourceRow` 增加 subscriptionId/sourceKey/boundary/cursor/revision/状态和停止边界证明；`DeliveryRow` 包含 ownerId/apiOrigin/automationId/subscriptionId/receipt/sourceKey/orderKey/revision/state/可选 runId、retryAt、诊断码。`DeliveryOutcome` 为 success/failed/unknown/skipped 与不含正文的诊断。具体字段校验随该任务定义，不使用裸 `unknown` 传递业务内容。

- [ ] **1. 写失败测试。** `it('persists a single dispatch claim across reopen', ...)`：以真实临时 DataRepository 验证并发相同页只入队一次、游标写入失败不丢待处理、跨重开保留去重、不同自动化独立、跨 owner/origin 隔离、已提交不能再次 CAS 提交、移除运行历史不移除去重。关键断言：`expect(await repo.commitDispatch(id, revision, runId)).toBe(false)`（第二次提交）。
- [ ] **2. 确认失败。** `pnpm --filter @synapse/desktop run test electron/services/automation-mail-triggers/__tests__/repository.test.ts`；应因新模块尚不存在失败。
- [ ] **3. 实现存储。** 新增 `app.automation-mail.subscriptions`、`sources`、`deliveries` 三个 SQLite schema，均 v1、local-only、atomic，单记录最多 64 KiB。根订阅只保存引用和标量；每个来源单独一行，不能把全部账号塞入一个无限增长数组。投递保留终态作为去重账本，不因运行裁剪清理。
- [ ] **4. 实现索引与批次。** 声明身份/automation/source 范围索引，以及 `(automationId,state,orderKey)` 待处理索引；revision 和 state 是 CAS 字段。每页最多 50 个引用，加游标/guard 不超过现有 128 项、256 KiB 原子预算；超预算缩小本页，不截断记录。`receiptKey` 用来源稳定身份的 SHA-256，投递 ID 不含启用代际，保证重启用仍去重。
- [ ] **5. 验证与提交。** 运行步骤 2 及 schema/repository 专项测试，全部通过；逐项检查 diff 后提交 `feat: 为收信自动化增加本机持久队列与去重账本`。

## Task 2: 站内信权威接收起点和增量接口

**Files:** 新增 `server/src/mail/mail-receipt-feed.ts`、`mail-receipt-feed.spec.ts`、`server/prisma/migrations/20261105120000_mail_receipt_sequence/migration.sql`、`server/test/mail-receipt-feed.e2e.spec.ts`、`mail-triggers-e2e-database-guard.mjs`；修改 `server/prisma/schema.prisma`、`server/src/mail/{mail.service,mail.controller,mail.module}.ts`、`server/src/admin/admin-mail-broadcast.service.ts`、两种发送 service 的现有测试、`server/package.json`。新增 `internal-source.ts` 与 `__tests__/internal-source.test.ts`，修改 `desktop/electron/services/account-service.ts` 及其测试。

**Interfaces:** 新类 `MailReceiptFeed`：`checkpoint(userId: string): Promise<{receiptSequence: string; serverTime: string}>`，`changes(userId, {after, through?, limit}): Promise<{items: {messageId: string; receiptSequence: string; sentAt: string}[]; nextAfter: string; through: string; complete: boolean}>`。新增本人鉴权的 `POST /api/mail-internal/automation/checkpoint`、`GET /api/mail-internal/automation/changes`，不注册 MCP。AccountService 新增同名语义的 `mailAutomationCheckpoint(signal)`、`mailAutomationChanges(input, signal)`，封装现有认证请求并校验调用前后身份。`InternalMailReceiptSource` 实现 Task 1 来源接口。

- [ ] **1. 写失败测试。** `it('includes late committed receipts after the confirmed boundary', ...)`，断言 `expect(page.items.map(x => x.messageId)).toEqual([newMessage.id])`；补未登录拒绝、不能指定他人 userId、序列字符串校验、limit 1–50、超过 50 封可续页、同 sentAt 不漏、已读不影响、删除不可见、游标越界拒绝、旧服务器 404 明确不能启用。服务端普通/公告发送都必须参加同一提交边界协议。
- [ ] **2. 确认失败。** `pnpm --filter @synapse/server run test src/mail/mail-receipt-feed.spec.ts src/mail/mail-http.spec.ts src/admin/admin-mail-broadcast.service.spec.ts`；新增断言应失败。桌面适配器运行其专项测试，应因缺接口失败。
- [ ] **3. 实现稳定提交顺序。** `MailRecipient` 新增 `deliverySequence BigInt @default(autoincrement()) @unique` 及 `(userId, deletedAt, deliverySequence)` 索引，迁移保留原消息/副本 ID、已读、软删除和附件。所有新增收件副本的事务在分配序列前取得同一 PostgreSQL transaction advisory lock；普通发送、公告和 checkpoint 均调用 `withMailReceiptFence(tx)`。该 helper 使用固定命名空间锁键，不调用业务外部资源；锁随提交/回滚释放。
- [ ] **4. 实现 checkpoint/changes。** checkpoint 使用 ReadCommitted 事务：先取得锁，再用下一条 SQL 查询当前用户含已软删除副本的最大序列及数据库时间；不得在等待锁前取快照。增量固定 `through` 后按本人可见副本序列升序 `take: limit + 1`，返回引用而非全文。序列是收件边界，sentAt 是展示/排序时间，不能用旧 sentAt 排除晚提交的新副本。重试和读取不写通知、不改已读。
- [ ] **5. 验证真正的并发边界。** 增加隔离 PG 测试：A 事务持锁写入未提交，B checkpoint 等待；A 提交后 B 必须把 A 纳入既有边界；B 先确认时 A 的后续序列必须出现在 changes。覆盖回滚空洞和公告批量收件。复用 `server/test/e2e-database-guard.mjs`，只允许显式 `MAIL_TRIGGERS_E2E_DATABASE_URL` 的 loopback `_e2e` 库。新增 package script `test:mail-triggers:e2e`，沿用现有 todos 脚本的 guard → shared build → 仅专用 URL 的迁移/生成 → `vitest run --config vitest.e2e.config.ts test/mail-receipt-feed.e2e.spec.ts` 流程；获授权后执行 `pnpm --filter @synapse/server run test:mail-triggers:e2e`。**当前不执行数据库写入或迁移；实际并发验收须另获该专用测试库写入授权，未执行不得标通过。** 迁移回滚参考单独 SQL：停用新触发器后移除新增字段/索引，原信件不动，不自动执行回滚。
- [ ] **6. 验证与提交。** 运行 server/desktop 对应专项、`pnpm --filter @synapse/server run prisma:generate`、server typecheck；不运行 `prisma migrate deploy/dev` 对业务库。提交 `feat: 为站内信提供稳定接收边界和本人增量查询`，注明真实数据库并发验收是否完成。

## Task 3: 外部邮箱 UID 起点与独立补查

**Files:** 新增 `desktop/app-capabilities/mail/main/automation-receipts.ts`、`main/__tests__/automation-receipts.test.ts`、协调目录 `external-source.ts` 与专项测试；修改 `mail/main/{service,sync,repository,mutations}.ts`、`mail/shared/types.ts`、`desktop/electron/runtime/data-repo/schemas/mail.ts`，补充 `mail/main/__tests__/protocol.test.ts`、`sync-fixtures.ts` 中实际需要的夹具，不改凭据 schema 或公开 mail 动作。

**Interfaces:** `MailService.prepareAutomationReceipts(context, accountId?): Promise<MailSourceBoundary[]>` 与 `scanAutomationReceipts(context, boundary, cursor, limit): Promise<MailReceiptPage>` 作为主进程内部方法，内部转换并复验 MailContext；`ExternalMailReceiptSource` 仅调用这些方法。`MailAutomationReceipts` 通过 MailAccounts 的受控会话和 MailSync 有界索引能力工作，不开放原生连接。

- [ ] **1. 写失败测试。** `it('collects 151 post-boundary receipts across first-sync pages', ...)` 断言 `expect(uniqueReceipts).toHaveLength(151)` 且旧 UID 交集为空；覆盖账号唯一/全部/指定、全部中一个认证失败则整个初次启用失败、无账号失败、暂停不可启用、非收件箱排除、snapshot 到入队间新 UID 可补收、首次索引 baseline 不吞新信、unknown receivedAt 保留待核验。
- [ ] **2. 确认失败。** `pnpm --filter @synapse/desktop run test app-capabilities/mail/main/__tests__/automation-receipts.test.ts electron/services/automation-mail-triggers/__tests__/external-source.test.ts`。
- [ ] **3. 实现起点和扫描。** prepare 实际 SELECT 当前 inbox，记录 UIDVALIDITY、UIDNEXT、账号端点世代；连接失败不能拿缓存成功。每次 scan 固定本轮 UIDNEXT 上界并验证世代，按 UID 范围读取至多 50 个头，使用现有元数据保存逻辑；序列起点独立于系统通知 baseline。信件 receivedAt 始终来自 INTERNALDATE；日期缺失不猜测。UIDNEXT 是权威存在边界，不用本机时间倒推服务器时钟。
- [ ] **4. 实现有界定位索引。** 仅给 messages 的 MailRecord 增加可选 `receiptSource: string`、`receiptUid: number` 投影及 `(ownerId,accountId,receiptSource,receiptUid)` 声明式索引；保存时由 locator/端点世代推导，旧记录通过有界同步补齐。不要在适配器按每封扫描整个邮箱，不通过业务 SQL 查询。重复索引保留原 em ID、正文缓存、标志和通知基线。
- [ ] **5. 固定身份异常行为。** 对端点/UIDVALIDITY 变化、账号移除、已移动或来源身份无法证明的候选返回稳定诊断并暂停该来源自动投递，不清空旧去重、不匹配相同 UID/Message-ID 猜测。在原始索引保存不可变 `originReceiptKey`；本机移动得到明确 UID 映射时沿用该 key 和 em ID，不能根据当前 locator 生成另一份收信身份。覆盖移出/移回收件箱仍只执行一次。新增账号单独 prepare，失败不阻塞其他既有来源。
- [ ] **6. 验证与提交。** 跑步骤 2 及现有 sync、notifications、context 测试；加入旧正文响应在 owner/代际切换后失效的断言。提交 `feat: 为邮件自动化增加独立UID起点和有界补收`。

## Task 4: 在线启用、停用与配置切换的提交协议

**Files:** 新增 `activation.ts`、`__tests__/activation.test.ts`；修改 `automation/{types,item-repository,automation-service}.ts`、`desktop/automation-trigger-packages/types.shared.ts`、`runtime/data-repo/schemas/placeholders.ts` 中 AutomationItem 私有可选字段校验及对应 repository/service 测试。

**Interfaces:** `MailTriggerActivation.prepare(context: MailTriggerContext, item: AutomationItem): Promise<{subscriptionId: string}>`、`commitItem(previous: AutomationItem | null, candidate: AutomationItem, prepared: {subscriptionId: string}): Promise<AutomationItem>`、`recoverBindings(): Promise<void>`、`disable(item: AutomationItem): Promise<AutomationItem>`。`AutomationItem` 只在内部存储层增加 `mailSubscription?: { id: string; stoppedAt?: string }`；公开 create/update 不接受它，renderer/MCP DTO 不暴露它。主进程 TriggerDefinition 增加可选 `activationRequired?: true`，AutomationService 提供按 trigger ID 注册的 `attachTriggerLifecycle(triggerId, provider): () => void`；provider 负责 prepare/commit/disable/recover，Core 不硬编码两种邮件 ID，required 且 provider 未就绪时拒绝启用。既有 JSON namespace 不改 backend。

- [ ] **1. 写失败测试。** `it('does not activate an unreferenced prepared subscription after restart', ...)`，断言 `expect(restoredItem.enabled).toBe(false)`、`expect(executor).not.toHaveBeenCalled()`。所有启用入口（create enabled、setEnabled、update enabled、保存并启用）都要联网准备；部分源失败不写 enabled。配置提交后、worker 启动前崩溃可恢复补收。配置切换失败保留原配置/订阅，执行器改名/修改不重置起点；恢复前再次启用不能绕过旧未完成关闭记录。
- [ ] **2. 确认失败。** `pnpm --filter @synapse/desktop run test electron/services/automation-mail-triggers/__tests__/activation.test.ts electron/services/automation/__tests__/automation-service.test.ts electron/services/automation/__tests__/item-repository.test.ts`。
- [ ] **3. 实现引用提交。** 先保存不可执行的来源边界行，来源全部 ready 后保存根订阅，再通过已有 item 写入互斥队列，一次 JSON 原子 upsert 同时保存 `enabled:true` 和私有订阅 ID。只有被当前已启用 item 引用、身份匹配的根订阅才有效，孤立 ready 行永不执行；不要尝试跨 JSON/SQLite 使用 `commitBatch`，也不因启动恢复把孤立行自动挂回 item。随机订阅 ID 防止失败请求被后续 configVersion 意外复用。
- [ ] **4. 实现停用与修改。** 停用先一次保存 `enabled:false` 和停止时刻，再关闭时间段/取消准备上下文；进程中断时由 item 的停止标记恢复关闭。已入队且来自旧有效时间段的信件保留；停用期间新信排除。范围/类型变化先完成新 prepare 再一次切换 item 引用，旧 pending 标记配置变更跳过；同类执行器变动仍遵守其既有 `initiallyDisabled` 安全策略。无法证明停用时间边界的离线候选保持待核验，不用错误时钟擅自执行。
- [ ] **5. 验证与提交。** 覆盖每个 await 前后故障注入、身份变化、同时启停和旧服务不可用；恢复仅做本机一致性判断，网络补查仍在后台。通过步骤 2 后提交 `feat: 为收信触发器增加联网启用与可恢复订阅切换`。

## Task 5: 只读正文与信件变量

**Files:** 新增 `payload.ts`、`__tests__/payload.test.ts`；实现来源适配器的 `hydrate`；修改 `mail/main/service.ts` 增加内部只读 payload 方法，复用 `mail/main/mime.ts` 与 body chunk；补充 `desktop/electron/action-runtime/__tests__/template-variables.test.ts`、`mail/main/__tests__/mime.test.ts`（按现有同职责测试位置落位）。

**Interfaces:** `buildMailTriggerEvent(identity, payload, discoveredAt): AutomationTriggerEvent` 放在 `payload.ts`，事件 source 为 `mail-internal` 或 `mail`，type 为 `message.received`；payload 严格匹配设计 10+3 字段。`hydrate` 在当前 context 中完成后再次校验，不持久保存正文。

- [ ] **1. 写失败测试。** `it('hydrates full body without changing Seen or fetching attachments', ...)`，断言 `expect(payload.body).toBe(fullText)`、`expect(storeFlags).not.toHaveBeenCalled()`、`expect(downloadAttachment).not.toHaveBeenCalled()`；两种来源填入全部字段，组织/公告不展开隐藏收件名单，HTML-only 变纯文本、空正文成功、multipart 不取附件、5 MiB 边界/截断/中途失败不调用执行器。
- [ ] **2. 确认失败。** `pnpm --filter @synapse/desktop run test electron/services/automation-mail-triggers/__tests__/payload.test.ts electron/action-runtime/__tests__/template-variables.test.ts`。
- [ ] **3. 实现 payload。** 站内信用 messageGet 的 body，不拼 quote 或其他会话；外部邮件用现有 MailContent/分块服务的 text，已有 MIME fallback 负责 HTML 文本提取，不引入另一个 HTML 解析器。metadata 不完整时显式准备失败，不能把未知附件写为零。URL 复用已有两种深链。不使用 UI 的选择信件逻辑，避免其自动已读行为。
- [ ] **4. 验证替换与隐私。** 测试 `buildAutomationTemplateVariables` 得到 body 原文及附件 JSON，Agent/Command/Script/HTTP/Workflow 既有白名单替换可消费，未知变量仍明确失败；邮件数据不提升为权限/系统指令、不自动 shell 转义。正文不进入 coordinator 日志、run metadata 或审计。
- [ ] **5. 验证与提交。** 重跑步骤 2、mime 和既有 action 专项，提交 `feat: 为收信自动化提供只读正文和统一信件变量`。

## Task 6: 持久投递 worker 与原执行通道接合

**Files:** 新增 `service.ts`、`__tests__/service.test.ts`、`__tests__/recovery.test.ts`；修改 `automation/{automation-service,execution-service,run-repository}.ts` 和对应测试、`desktop/config.ts`。

**Interfaces:** `AutomationMailTriggerService.start(): Promise<void>`、`stop(): Promise<void>`、`reconcile(reason: string): Promise<void>`。AutomationService 新增内部 `runDurableEvent({automationId, subscriptionId, runId, event, identitySignal, commitStart}): Promise<{kind:'busy'|'obsolete'} | {kind:'settled';run:AutomationRun}>`；ID 为 string，event 为 AutomationTriggerEvent，identitySignal 为 AbortSignal，`commitStart(): Promise<boolean>` 调用 Task 1 CAS。`AutomationRunItemOptions` 增加仅内部使用的 `reservedRunId?: string`、`scopeSignal?: AbortSignal`；run repository 支持该 ID 幂等创建，拒绝覆盖不同 automation 的已存在 ID。

- [ ] **1. 写失败测试。** `it('does not redispatch a receipt after pruning 101 run records and reopening', ...)`，断言该 receipt 对应 `expect(executor).toHaveBeenCalledTimes(1)`；覆盖实时/补查同信并发、跨重启、队列 151 封、两条自动化独立、慢执行器和手动运行占槽不丢邮件。断网、休眠和退出后正文读取重试只发生在执行提交之前。
- [ ] **2. 确认失败。** `pnpm --filter @synapse/desktop run test electron/services/automation-mail-triggers/__tests__/service.test.ts electron/services/automation-mail-triggers/__tests__/recovery.test.ts`。
- [ ] **3. 实现补查与 worker。** reconcile 以来源分页入队和推进游标的同一原子批次落盘；每次轮转处理一个最多 50 引用的来源页，避免单账号饥饿。加入中文注释的 `AUTOMATION_MAIL_RECONCILE_INTERVAL_MS = 60_000`；准备失败采用 1/5/30/60 秒封顶退避，成功后重置，定时器 unref 并随 stop/身份变化清理。
- [ ] **4. 实现执行提交。** `runDurableEvent` 与现有 runningItemIds 共用执行槽；忙时立即返回 busy，pending 不变。持槽后验证最新 item 和订阅，再 CAS 保存稳定 run ID/已提交状态，随后才调用原 execution.runItem。scopeSignal 与原执行 controller.signal 合并，账号切换取消旧身份执行；停用只取消准备/补查上下文，不取消此 identitySignal，保持已开始执行不因停用中止。不要经会重新广播给所有任务的 `acceptEvent` 投递单个持久事件。commitStart 失败、停用或订阅失效不得调用执行器。
- [ ] **5. 实现恢复/终态。** 未提交的准备项恢复后重取正文；永久正文/访问失败生成关联投递的 failed 运行记录并保留去重，执行器调用为零。已提交而无明确完成结果的项产生关联原 run ID 的 failed 记录，error 为「执行结果不明，未自动重试」，不新增公开 run status。执行器异常/取消/超时保留去重；终态落盘失败下次恢复也不重放。提交标记前后及 run 创建失败均注入崩溃，断言 executor 调用计数至多 1；原 Webhook 内存队列测试保持通过。
- [ ] **6. 验证与提交。** 跑步骤 2 及 automation execution/run/service 专项、日志敏感值断言，提交 `feat: 接通收信自动化的串行投递和崩溃恢复`。

## Task 7: 触发器注册、邮箱选择和变量发现

**Files:** 新增 `desktop/automation-trigger-packages/builtin/mail-internal-received/{schema,manifest,index.shared,index.main,index.renderer}.ts`，外部 `mail-received/` 同五文件及 `config.renderer.tsx`、`use-mail-accounts.ts`；共用变量声明放 `builtin/mail-trigger-variables.ts`。修改 `desktop/electron/services/automation/builtin-triggers.ts`、`desktop/src/automation-triggers/builtin-triggers.ts`，补充两端 registry 测试、`desktop/src/automation-triggers/__tests__/mail-received-config-form.test.tsx` 和 `modules/automation/editor/__tests__/inline-editor.test.tsx`。

**Interfaces:** 两个注册 ID 固定为设计值。站内信 strict 空对象；外部 strict `{accountId?: string}`，不接受额外筛选。包的 runtime 只匹配对应 source/type，所有身份/订阅授权仍由持久协调层检查。`useMailTriggerAccounts(): {status, accounts, reload}` 只经现有 mail bridge 分页查询当前身份账号，表单只消费该 hook。

- [ ] **1. 写失败测试。** `it('selects all accounts without silently replacing a missing saved account', ...)`，断言回到全部时 `expect(onChange).toHaveBeenLastCalledWith({})`、账号缺失时保留原 accountId 并显示不可用；发现列表由 3 增为 5 个、两类默认 config 为 `{}`、多页账号完整、加载失败、用户切换时旧请求失效、两种 body 变量均可复制。
- [ ] **2. 确认失败。** `pnpm --filter @synapse/desktop run test src/automation-triggers/__tests__/mail-received-config-form.test.tsx src/automation-triggers/__tests__/trigger-registry.test.tsx electron/services/automation/__tests__/trigger-registry.test.ts`；renderer 和 main 分开执行验收。
- [ ] **3. 实现注册与表单。** 按同目录 Webhook 的 shared/main/renderer 分离模式，两种 main definition 均声明 Task 4 的 activationRequired。Select 显示「全部邮箱账号」及账号名称/地址，使用共享组件默认尺寸，不新增说明段落。文案仅保留「邮箱账号」、必要加载/空/错误/不可用状态，不新增执行器专属 UI。
- [ ] **4. 验证入口。** 编辑保存、保存并启用、列表启用、MCP create/update/setEnabled 均调用 Task 4 公共 service；无法联网确认时显示错误并保持未启用。公开 IPC/schema 不接收私有订阅引用。无信件上下文的手动运行报明确错误，不能用最新邮件替代样本。
- [ ] **5. 验证与提交。** 跑步骤 2 和 inline editor/IPC 专项。账号选择器实际展开状态的桌面/窄屏视觉验收需后续用户授权启动应用后完成，当前不启动并在交付记录待验；组件测试不冒充视觉验收。提交 `feat: 增加新站内信和新邮件触发器配置入口`。

## Task 8: 后台生命周期、事件与身份取消

**Files:** 修改 `desktop/electron/bootstrap/{descriptors,registry}.ts`、`bootstrap/__tests__/registry.test.ts`、`app-ready.test.ts`；新增 `automation-mail-triggers/__tests__/lifecycle.test.ts`；必要时只在 `mail/main/service.ts` 增加主进程事件订阅方法。

**Interfaces:** 注册 `core.automation-mail-triggers`，`startupPhase: 'background'`、`criticality: 'degraded'`，依赖 core.automation/core.mail/core.data-repository/core.event-bus。实例通过窄 attach 方法将 Task 4 lifecycle provider 绑定 AutomationService；core.automation 不反向依赖 coordinator，防止服务循环。启动恢复只调度后台任务，不等待网络。

- [ ] **1. 写失败测试。** `it('ignores late hydration from the previous account generation', ...)`，在切换账号后 resolve 旧正文，断言 `expect(executor).not.toHaveBeenCalled()`；窗口创建不等待收信补查，启动/唤醒/重连/邮箱索引事件触发 reconcile，通知关闭和关闭面板仍处理，注销/退出释放计时器和 listener。provider 尚未就绪的启用请求明确失败，不能绕过联网准备。
- [ ] **2. 确认失败。** `pnpm --filter @synapse/desktop run test electron/services/automation-mail-triggers/__tests__/lifecycle.test.ts electron/bootstrap/__tests__/registry.test.ts electron/bootstrap/__tests__/app-ready.test.ts`。
- [ ] **3. 实现 wiring。** 复用 accountService.onBeforeIdentityChange/onStateChanged、EventBus 站内信通知变化和 mailbox changes、powerMonitor suspend/resume；提示只促使权威补查。监听器全部返回 detach，换代 abort 旧 context。源不可用只停该源，60 秒兜底不自动启用未启用项。
- [ ] **4. 验证与提交。** 跑步骤 2 与服务注册拓扑检查，提交 `feat: 接入收信自动化后台恢复与身份切换取消`。

## Task 9: 备份导入、删除和诊断隔离

**Files:** 修改 `desktop/electron/services/config-backup-service.ts`、`services/__tests__/config-backup-service.test.ts`、`runtime/data-repo/{repository,factory}.ts` 与其测试、`bootstrap/descriptors.ts`、`automation/automation-service.ts`、`automation-mail-triggers/repository.ts`；新增协调目录 `transfer.ts`、`__tests__/transfer.test.ts`，补充已有 automation module 测试。

**Interfaces:** `transfer.ts` 增加 `sanitizeImportedMailAutomation(item: AutomationItem): AutomationItem`，置 enabled=false 并删除私有订阅引用。DataRepositoryImpl 构造配置及 file-backed factory 增加可选 `importTransforms: Readonly<Record<string, (value: unknown) => unknown>>`；bootstrap 为 automation.items 注入适配器，变换后仍走 schema 校验，runtime 不导入业务模块，也不硬编码 trigger ID。删除 `deleteAutomationState(automationId: string): Promise<void>` 仅清理本机引用与队列，保留失败恢复标记直至完成。

- [ ] **1. 写失败测试。** `it('imports mail automation disabled while retaining local dedupe', ...)`，断言 `expect(imported.enabled).toBe(false)`、`expect(imported.mailSubscription).toBeUndefined()`、`expect(await repo.commitDispatch(oldId, oldRevision, runId)).toBe(false)`；导出包不含三种本机 namespace 或正文，伪造导入 local-only 在任何写入前拒绝。直接 DataRepository import、配置备份 import、merge/replace、恢复失败回滚均不能使旧邮件自动重播。
- [ ] **2. 确认失败。** `pnpm --filter @synapse/desktop run test electron/services/automation-mail-triggers/__tests__/transfer.test.ts electron/services/__tests__/config-backup-service.test.ts electron/runtime/data-repo/__tests__/repository.test.ts`。
- [ ] **3. 实现传输与删除。** 无关 namespace 的导入语义保持原样；清理仅按 automationId 有界分页，只在显式 automationDelete 执行，不响应导入 replace 期间的临时 remove 事件而销毁去重。结果不明沿用 failed+明确错误，账本保留 runId 和信件引用；不向 portable 的运行历史增加邮箱引用或正文，不扩展公共状态枚举、不新增逐信重放或私有查询 IPC。
- [ ] **4. 验证与提交。** 通过步骤 2、账号隔离与日志脱敏专项，提交 `fix: 防止恢复或删除收信自动化时重播历史邮件`。

## Task 10: 文档、发布说明和整体验证

**Files:** 修改 `docs/agents/{capability-registry,module-boundaries}.md`、`desktop/app-capabilities/synapse-skill/skill-package/automation/{index,api-reference}.md`、`mail/index.md`、`mail-internal/index.md`、`RELEASE_NOTES_PENDING.md`；新增 `automation-mail-triggers/__tests__/end-to-end.test.ts`，使用假来源+真实临时 DataRepository+受控 executor，不连接真实用户邮箱。

- [ ] **1. 写并运行端到端失败测试。** `it('backfills each enabled receipt once through the existing executor', ...)`：一条站内信自动化、一条指定邮箱自动化；启用→同时到信→关闭→离线新信→恢复→历史裁剪→重复扫描→正文变量执行；断言 `expect(dispatchesFor(receiptId)).toHaveLength(1)`、停用时/其他邮箱调用数均为 0、原消息已读状态未改变。`dispatchesFor` 仅为本测试对受控 executor 调用记录的筛选 fixture。再用故障点覆盖未知结果不重放。
- [ ] **2. 修复本次集成缺口并重跑。** `pnpm --filter @synapse/desktop run test electron/services/automation-mail-triggers`，Task 2 server mail/broadcast 专项，以及 renderer 的账号选择、registry、inline editor 专项；不重复无关的完整测试。
- [ ] **3. 完成必要工程检查。** 分别执行 `pnpm --filter @synapse/desktop run typecheck`、`check:hard-constraints`、`check:ipc-codegen`、`check:ui-tracking-coverage`；`pnpm --filter @synapse/server run typecheck`。以上简写检查名均通过同一 `pnpm --filter @synapse/desktop run <name>` 调用。新增模块改动构建依赖图时执行 desktop build:renderer/build:electron 和 server build；未改 ASAR/worker/native 资源不额外打包，涉及这些边界则按仓库规则补 check:packaged-asar。
- [ ] **4. 同步契约与文案。** 核对触发器数量从 3 到 5，Automation capability/MCP 数量不因触发器增加而变化；全局数字按执行时实际注册清单核对，不复制旧文档快照。系统 Skill 说明联网启用、默认全部/指定、变量、补收和不自动重放；发布说明面向用户描述新增能力，不写代码路径。正文和凭据不进入示例或诊断。
- [ ] **5. 记录实际验证边界。** 独立记录 server PG 提交顺序测试、账号选择器展开视觉验收和真实邮件账号验收是否执行。未获对应数据库写入/运行应用授权时列待验，不能用 mock、类型检查或关闭态截图代替。当前计划本身不授权迁移、部署、真实收发信。
- [ ] **6. 最终检查与本地提交。** `git diff --check`，检查暂存只含本功能代码/测试/规则/发布说明；提交 `feat: 完成收信自动化触发器及补收去重交付`（没有剩余改动不空提交）。最终报告各提交、真实验证结果、结果不明不重放的限制及未部署状态。

## 实施前置与回退

- 站内信新接口依赖 additive Prisma migration 和服务端版本；旧服务返回不支持时不能启用站内信触发器，既有其他自动化照常工作。迁移文件可随代码提交，执行到任何数据库须另行授权。
- 严格提交顺序验收需要隔离 PostgreSQL，并发模拟测试不能替代真实数据库锁/提交测试；使用上面的专用变量和 guard 后仍须用户授权。
- 桌面回退先停用这两类任务并停止后台 worker，保留去重账本和待处理记录；不可通过清空邮箱数据、去重或重置起点回退。旧程序遇到未知 trigger 应按现有 needs_update 处理，不能当普通手动任务运行。
- 服务端回退只停止新接口/恢复旧应用，新增 nullable-free 序列字段可暂留不影响旧代码；只有确认不再使用新任务并单独授权后才执行字段/索引回滚。普通站内信、通知 outbox、附件和用户数据不删。

## 计划自检

- 范围与筛选、变量、联网启用、补触发/去重、串行与失败、账号隔离、导入和注册说明分别由 Tasks 1–10 覆盖；设计要求没有留空任务。
- 所有跨任务共享类型在 Task 1 定义，来源各自落实 prepare/scan/hydrate，Task 4 定义启用原子引用，Task 6 定义单条持久执行入口；没有把 JSON namespace 当作 SQLite 原子批次使用。
- Review Focus 五项均有指定测试；未知时间/身份不明 fail closed，执行结果不明不自动重放。真正 PG 与视觉验收分别记录授权前提和待验状态。
- 本计划不实现产品代码；勾选框均保持未执行。执行方式由用户确认后，按本计划头部指定技能继续。
