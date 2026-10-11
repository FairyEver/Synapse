# 云端待办事项 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供桌面、iPhone / iPadOS 与 Synapse Skill 共用的个人云端待办，支持手动和 AI 增删改查、截止时间与云端提醒。

**Architecture:** PostgreSQL 是唯一业务数据源，服务端统一实施身份隔离、字段校验、版本比较与幂等事务。提醒通过服务端 worker、现有账号通知及持久 outbox 投递；桌面使用账号认证客户端和窄 IPC，iOS 使用现有 APIClient，客户端仅保留内存视图。

**Tech Stack:** 现有 NestJS / Prisma / PostgreSQL / Nest Schedule，Electron 41 / React 19 / TypeScript 6 / shadcn Radix Nova / Tailwind 4，SwiftUI / URLSession / XCTest，pnpm / Vitest。

**Spec:** [已确认设计](../specs/2026-10-11-cloud-todos-design.md)，[已认可原型](../../prototypes/2026-10-11-cloud-todos/README.md)。

状态：用户于 2026-10-11 确认书面设计和本实施计划，选择当前会话顺序开发、最后独立审查。实施进行中；步骤勾选与验收记录只依据实际结果。

## Global Constraints

- 个人账号数据，不属于项目、团队、选中的电脑或本机 Database；所有接口使用当前认证身份，调用者不能指定 `userId`。
- 不使用本地 SQLite、DataRepository、文件或浏览器持久存储保存待办正文、草稿或离线写入队列；退出或切换账号清空内存及跳转目标。
- 不新增依赖、生产环境变量、开放 API 密钥 scopes 或 COS 域；复用现有认证、通知、调度与数据库备份。
- 桌面单列、无应用内侧栏，只有「未完成 / 全部」，普通进入默认「未完成」。`bg-surface` 上用一个现有 `Card` / `bg-card` 承载列表，浅色为白色，深色沿用主题。
- System App ID 与 namespace 为 `todos`；允许用户固定 Dock 和独立窗口，默认不固定 Dock。不新增 Workflow / Automation 节点。
- 桌面沿用现有壳层、组件和主题 token；标准尺寸「新建」操作，不增加页面 CSS、自定义颜色、卡片嵌套、统计卡片或搜索栏。
- iOS 最低部署版本保持 18.0；系统 List、segmented Picker、Form、DatePicker、sheet，复用主页导航栈和唯一 SynapseAppModel。
- 手机底栏保持「主页 / 终端 / 通知 / 我的」；待办可用性不受所选电脑在线状态影响，不进入终端待处理统计，不改变通知计数的 99 上限。
- `APNS_USE_SANDBOX` 保持 `false`；系统权限、Focus、桌面本机通知与静音开关继续生效，不承诺物理横幅恰好一次。
- 标题 trim 后必填，最多 200 个 Unicode 码点；备注最多 10,000 个 Unicode 码点，空值为 null。提醒分钟精度，秒与毫秒必须为 0。
- 分页 offset 默认 0，limit 默认 50、最多 100；query 最多 200 个 Unicode 码点，按标题与备注作不区分大小写的字面包含匹配。
- 提醒选项 `none / at_due / before_due / custom`；相对提前量只允许 10、60、1440 分钟。新增或改变提醒必须晚于服务器当前时间。
- 初始 version 为 1；实际变更递增。幂等收据保留 24 小时，创建请求标识另随条目保留；删除墓碑保留 90 天，完成历史保留到用户删除。
- 提醒扫描每 30 秒、每批最多 100 项；到期不超过 24 小时才补偿，从原提醒时刻超过 24 小时停止外部投递重试。
- 日志与审计只包含账号 / 条目 ID、操作、版本、结果；不写标题、备注、推送正文、完整请求体或凭据。
- 只修改本任务范围；执行前重新检查现有未提交改动，每个阶段只提交本任务文件，不 push。部署、发版、启动应用或原生运行验收遵守用户明确授权范围。

## Review Focus

1. 200 个非 BMP 字符应合法，201 个应拒绝；UTF-16 长度不能冒充 Unicode 码点数，孤立 surrogate / NUL 返回 400（Task 1）。
2. 提交已成功但响应丢失：重试复用同一请求 ID；刷新凭据继续请求，同账号退出再登录也必须拒绝旧请求回填（Task 1、3、5）。
3. 翻页、实时刷新与切换筛选同时发生：按 ID 去重，迟到页不得覆盖较新版本或混入另一个筛选（Task 4、5）。
4. 完成后的撤销与另一端编辑相撞：撤销返回 409 并重读，不覆盖新内容；编辑失败保留草稿（Task 4、5）。
5. 旧服务器缺少整个接口与单项不可访问不同；深链目标可能不在第一页，登录或用户新导航后旧目标不能抢回页面（Task 3、4、6）。

---

## 文件职责与依赖

| 单元 | 实施目录与责任 | 依赖 |
| --- | --- | --- |
| Task 1 | `shared/src/todos.ts`：线协议与纯校验；`server/src/todos/`：归属、事务、分页、CAS、幂等 | 无 |
| Task 2 | 待办 worker 与 outbox；现有通知服务新增事务内创建 / 提交后投递边界；账号实时事件 | Task 1 |
| Task 3 | `desktop/app-capabilities/todos/`：认证请求、权限、IPC / MCP；系统 Skill 待办指南 | Task 1、2 |
| Task 4 | `desktop/src/modules/todos/`：数据 hook、表单 hook、列表与编辑组件；应用注册与消息中心目标 | Task 3 |
| Task 5 | `SynapseMobile/.../Features/Todos/`：DTO、内存 store、草稿与时间；APIClient / 实时 / 身份接线 | Task 1、2 |
| Task 6 | iOS 原生列表和表单、主页入口、通知 / 深链定位 | Task 5 |
| Task 7 | 跨端验收、注册清单、长期规则、发布说明及最终检查 | Task 1–6 |

执行前先读各任务对应的根 AGENTS 文档路由，并重新发现相关设计。服务端通知、移动运行时、System App 壳层与 MCP 包装工具的既有硬约束不因新增应用失效。Task 1–6 每次实现用户可感知能力时立即追加本任务发布说明和对应规则；Task 7 复核，不延迟到发版才补写。

## Task 1：共享契约与有事务保证的账号 API

**Files:**
- Create: `shared/src/todos.ts`、`shared/scripts/build-todo-contracts.mjs`、`shared/src/todos.test.ts`。
- Create: `server/src/todos/todos.module.ts`、`todos.controller.ts`、`todos.service.ts`、`todo.schemas.ts`、`todo.repository.ts`、`todo-idempotency.ts`（均位于 `server/src/todos/`）。
- Create: `server/prisma/migrations/20261011000100_cloud_todos/migration.sql`、`server/test/todos-e2e-database-guard.mjs`、`server/test/todos-commit.e2e.spec.ts`。
- Modify: `shared/src/index.ts`、`shared/package.json`、`server/prisma/schema.prisma`、`server/src/app.module.ts`、`server/package.json`。
- Test: `server/src/todos/todo.schemas.spec.ts`、`server/src/todos/todos.service.spec.ts`、`server/src/todos/todos-http.spec.ts`（新增），以及以上 shared / e2e 测试。

**Interfaces:**
- Produces: `TodoFilter = 'pending' | 'all'`、`TodoReminderKind = 'none' | 'at_due' | 'before_due' | 'custom'`、`TodoReminderStatus = 'none' | 'pending' | 'sent' | 'cancelled' | 'expired'`。
- Produces: `TodoFieldsInput { title: string; note?: string | null; dueAt?: string | null; reminder?: TodoReminderKind; offsetMinutes?: 10 | 60 | 1440 | null; remindAt?: string | null }`。
- Produces: `TodoCreateInput = TodoFieldsInput & { clientRequestId: string }`；`TodoUpdateInput = Partial<TodoFieldsInput> & { expectedVersion: number; clientRequestId: string }`；`TodoCompletionInput { completed: boolean; expectedVersion: number; clientRequestId: string }`；`TodoDeleteInput { expectedVersion: number; clientRequestId: string }`。
- Produces: `TodoListInput { filter?: TodoFilter; query?: string; offset?: number; limit?: number }`；`TodoPageDto { items: TodoItemDto[]; nextOffset: number | null }`；`TodoDeleteResult { id: string; version: number; deleted: true }`。
- Produces: `TodoItemDto` 含设计 §4.1 除 `userId / deletedAt` 外所有字段；可选值显式为 null，时间为 UTC RFC 3339 字符串。`TodoChangedPayload { id: string; version: number }`；`TodoLocator = { id: string; reference?: never } | { reference: string; id?: never }`。
- Produces: `countTodoCodePoints(value: string): number`、`parseTodoReference(value: string): string | null`，以及后续任务共用的 DTO / 输入类型，导出子入口 `@synapse/shared/todo-contracts`。
- Produces: `TodosService.list(userId: string, input: TodoListInput): Promise<TodoPageDto>`、`get(userId: string, id: string): Promise<TodoItemDto>`、`create(userId: string, input: TodoCreateInput): Promise<TodoItemDto>`、`update(userId: string, id: string, input: TodoUpdateInput): Promise<TodoItemDto>`、`setCompleted(userId: string, id: string, input: TodoCompletionInput): Promise<TodoItemDto>`、`delete(userId: string, id: string, input: TodoDeleteInput): Promise<TodoDeleteResult>`。

- [x] **Step 1：建立字段、HTTP 和真实 PostgreSQL 回归用例。** 固定时钟，创建两个测试账号；真实事务测试不以 mock 的“锁已调用”代替竞争结果。

| 测试名 | 必须断言的测试代码 / 值 |
| --- | --- |
| `unicode_code_point_limits` | `expect(countTodoCodePoints('😀'.repeat(200))).toBe(200)`；201 个标题 / 10001 个备注返回 400；200 / 10000 个接受；孤立 surrogate 和 NUL 为 400 |
| `strict_patch_and_time_validation` | `expect(status).toBe(400)`：未知字段、伪造 userId / completedAt、缺截止的相对提醒、非 10/60/1440 提前量、秒不为 0、无偏移或非法日期、新设过去提醒；缺省保留，null 清空 |
| `owned_lookup_and_literal_query` | `expect(otherOwnerStatus).toBe(404)`；不存在与已删除同为 404；`query='%'` 只匹配含百分号的本人条目；limit 101 被拒绝，默认 items 不超过 50 |
| `two_writers_one_version` | `expect(statuses.sort()).toEqual([200, 409])`；真实并发写同一版本，只递增一次，冲突码 `TODO_VERSION_CONFLICT` |
| `commit_then_lost_response_retry` | 相同 UUID + 相同规范内容重放：`expect(count).toBe(1)`、`expect(replayed.version).toBe(original.version)`；同 UUID 改内容为 409 / `TODO_REQUEST_CONFLICT` |
| `create_key_survives_receipt_cleanup` | 清理 24 小时收据后再次提交原创建键，`expect(count).toBe(1)`；保留原创建摘要，异内容仍冲突 |
| `reminder_generation_and_completion` | 标题 / 备注编辑代际不变；自定提醒下仅改截止代际不变；相对提醒时间变化代际递增；完成取消 pending，恢复不补发 sent / 过去提醒 |
| `stable_page_order` | 未完成按 dueAt 升序、null 后置，再 createdAt / id 升序；全部将完成项按 completedAt / id 倒序放后；最后 `expect(nextOffset).toBeNull()` |

- [x] **Step 2：运行红灯测试。** `pnpm --filter @synapse/shared run test src/todos.test.ts`；`pnpm --filter @synapse/server run test src/todos`。预期因契约 / 服务尚未实现失败，不把缺数据库或无测试文件视为红灯证据。
- [x] **Step 3：实现单点类型与校验。** shared 只用现有 TypeScript；子入口从同一 source 生成 ESM 与 CJS / 类型声明，沿用 notification 子入口模式。服务端 Zod strict schema 调用码点校验，合法带偏移时间规范为 UTC；补丁合成完整候选条目后一次校验。`parseTodoReference` 只接受 `synapse://todos/<id>`，ID 为 `[A-Za-z0-9_-]{1,200}`，拒绝 query、fragment、额外路径与编码分隔符。
- [x] **Step 4：实现模型、事务与六条 API。** 新增 `TodoItem / TodoMutationReceipt`，创建原始请求 ID 与摘要、索引、账号内唯一键； mutation 摘要包括操作、目标、规范内容和 expectedVersion。事务先判幂等，再锁定本人条目并比较版本，变更与响应收据共同提交；delete 推进版本并软删除。完成 / 触发使用同一行锁协议。路由严格按设计 §5.1，使用 UserAuthGuard，DELETE 结果为 `TodoDeleteResult`；错误固定 code，无正文日志。
- [x] **Step 5：实现安全 e2e 入口并运行绿灯。** 新增 `test:todos:e2e`，先校验测试专用 `TODOS_E2E_DATABASE_URL`：PostgreSQL、仅 loopback、库名以 `_e2e` 结尾；通过后才给迁移 / Vitest 子进程设置 DATABASE_URL，绝不输出连接串。只运行 `test/todos-commit.e2e.spec.ts`，不误跑另一领域 e2e。先 `pnpm --filter @synapse/server run prisma:generate` 更新新增模型的客户端，再运行 Step 2、`pnpm --filter @synapse/server run test:todos:e2e`、`pnpm --filter @synapse/server run typecheck`，预期全部通过；没有独立测试库则明确记录未运行，不替换成生产库。
- [x] **Step 6：同步账号云端归属规则与发布说明并提交。** 提交摘要：`feat: 增加账号云端待办接口与版本幂等事务`。只暂存本 Task 实际变更文件。

## Task 2：云端提醒、事务 outbox 与账号变更事件

**Files:**
- Create: `server/src/todos/todo-reminder.worker.ts`、`todo-reminder-outbox.ts`、`todo-events.ts`、`todo-reminder.worker.spec.ts`、`todo-reminder-outbox.spec.ts`。
- Create: `server/prisma/migrations/20261011000200_todo_reminder_outbox/migration.sql`、`server/test/todo-reminder-races.e2e.spec.ts`。
- Modify: `server/prisma/schema.prisma`、`server/src/todos/todos.module.ts`、`server/src/todos/todos.service.ts`、`server/src/notifications/notification.service.ts`、`server/src/notifications/notification.service.spec.ts`。
- Modify: `shared/src/notifications.ts`、`shared/src/live.ts`、`shared/src/index.ts`、`server/package.json`。复用现有两端 gateway 的发送方法，不要求修改其业务实现。
- Test: 新增 `shared/src/todo-events.test.ts`，上列 worker / outbox / e2e，既有 `server/src/notifications/notification-http.spec.ts`。

**Interfaces:**
- Consumes: Task 1 的 `TodoItemDto / TodoChangedPayload` 和相同行锁协议。
- Produces: `NotificationService.createInTransaction(tx: Prisma.TransactionClient, input: CreateNotificationInput & { sourceKey: string }): Promise<UserNotification>`，只创建或取得唯一通知，不发布、不推送。
- Produces: `NotificationService.deliverCommitted(userId: string, notificationId: string): Promise<void>`，读取已提交账号通知并复用实时 / APNs 投递；不会再创建记录。现有 `PushOutcome.failed > 0` 或 `skipped === true` 必须转换为可重试失败，不能把 resolved Promise 当成推送成功；没有注册推送设备不算失败。
- Produces: `TodoReminderWorker.scanDue(now: Date): Promise<void>`；`TodoReminderOutbox.deliverPending(now: Date): Promise<void>`；`TodoEvents.publish(userId: string, payload: TodoChangedPayload): void`，提交后按账号广播 `todos.changed`。

- [x] **Step 1：建立调度、竞争与失败用例。** 测试中 `now` 固定，fake timer 不等待真实 30 秒；竞争测试在 PostgreSQL 显式交错两个事务。

| 测试名 | 必须断言的测试代码 / 值 |
| --- | --- |
| `cancel_before_trigger` / `trigger_before_cancel` | 完成 / 删除先提交：`expect(notificationCount).toBe(0)`；触发先提交：`expect(notificationCount).toBe(1)`，通知保留 |
| `old_generation_and_two_workers` | 两 worker、旧代际和重启重扫：`expect(sourceKeys).toEqual(['todo:'+id+':'+generation])`，唯一通知和唯一 outbox |
| `outage_window_boundary` | 到期 24 小时内 pending 补偿；大于 24 小时 `expect(status).toBe('expired')`；完成 / 取消项均不补偿；每批不超过 100 |
| `transaction_has_no_network` | 事务 rollback 后 `expect(pushCalls).toBe(0)`、`expect(eventCalls).toBe(0)`；提交后 version 加 1，事件只有 id / version |
| `delivery_retry_reuses_notification` | 首次推送失败后重试 `expect(notificationIds).toEqual([sameId, sameId])`；通知行数为 1；已读 / 删除不再弹外部横幅；超过原 remindAt + 24h 停止 |
| `resolved_failed_push_is_retried` | 网关返回 `{ sent: 0, failed: 1, skipped: false }` 或未配置而 skipped 时，`expect(outbox.status).not.toBe('delivered')`；无推送设备的 0 / 0 不无限重试 |
| `server_owned_source` | 用户 / 桌面发送 API 伪造 `todo-reminder` 被拒绝；`expect(DESKTOP_NOTIFICATION_SOURCES).not.toContain('todo-reminder')`；配置仍为生产 APNs |

- [x] **Step 2：运行红灯。** `pnpm --filter @synapse/server run test src/todos/todo-reminder`；`pnpm --filter @synapse/shared run test src/todo-events.test.ts`，预期新增接口 / 行为失败。
- [x] **Step 3：实现同锁触发事务。** 每 30 秒扫描至多 100 项，锁定后重验本人 / 未完成 / 未删除 / 当前代际与时间。通知使用账号内 sourceKey 唯一键，通知 upsert、sent 状态、version 与 outbox 同事务；不在已失败的 PostgreSQL 事务里捕获唯一冲突后继续写。标题「待办提醒」，正文仅标题，source `todo-reminder`、targetId、active 级别。
- [x] **Step 4：实现持久投递与清理。** `TodoReminderDelivery` 保存通知 ID、账号、代际、原提醒时间、尝试次数、下次尝试时间、租约与结果；领取租约 60 秒，失败 1 分钟起指数退避、上限 15 分钟，截止于原 remindAt + 24h。投递在事务外且 await 结果，崩溃后继续；已读 / 删除跳过外部横幅，事件失败后进入重试。按设计清理 24 小时收据、90 天墓碑及已结束 outbox，不碰其他业务数据。
- [x] **Step 5：接通提交后广播并运行绿灯。** TodoModule 复用已导出的 NotificationModule、LiveModule、MobileLiveModule，避免注入循环；不为现有 gateway 增加平行通知接口。只扩展共享 `NOTIFICATION_SOURCES`；`todos.changed` 是 server-to-client 消息，客户端不能向服务器伪造。事件只按账号扇出，电脑离线不妨碍 REST / 提醒。e2e 脚本追加精确 reminder 测试文件。先运行 `pnpm --filter @synapse/server run prisma:generate`，再运行 Step 2、`pnpm --filter @synapse/server run test src/notifications`、`pnpm --filter @synapse/server run test:todos:e2e` 和 server typecheck，全部通过。
- [x] **Step 6：同步提醒 / 通知来源规则与发布说明并提交。** 摘要：`feat: 支持云端待办提醒及取消去重投递`。不改变 System Notifier 对外发送或其他通知来源的成功语义。

## Task 3：桌面认证适配、窄 IPC、MCP 与系统 Skill

**Files:**
- Create: `desktop/app-capabilities/todos/main/service.ts`、`dispatcher.ts`、`ipc.ts`；`desktop/app-capabilities/todos/shared/capability.ts`、`schema.ts`、`manifest.ts`。
- Create: `desktop/synapse-capabilities/shared/todos-domain.ts`、`desktop/src/lib/todos-api.ts`、`desktop/app-capabilities/todos/main/__tests__/service.test.ts`、`dispatcher.test.ts`。
- Modify: `desktop/electron/bootstrap/descriptors.ts`、`desktop/electron/bootstrap/ipc-registry.ts`、`desktop/electron/preload.ts`、`desktop/src/types/bridge.ts`、`desktop/electron/services/live-connection-service.ts`、`desktop/synapse-capabilities/shared/registry.ts`。
- Create: `desktop/app-capabilities/synapse-skill/skill-package/todos/index.md`、`api-reference.md`；`docs/agent-guides/todos.md`。
- Modify: `desktop/app-capabilities/synapse-skill/skill-package/SKILL.md`、`desktop/synapse-capabilities/shared/__tests__/registry.test.ts`。
- Test: 上列测试；新增 `desktop/app-capabilities/todos/main/__tests__/ipc.test.ts`、`desktop/synapse-capabilities/shared/__tests__/todos-domain.test.ts`。

**Interfaces:**
- Consumes: Task 1 的输入 / DTO；现有 `AccountService.fetchAuthenticated`、`onBeforeIdentityChange` 与 ServiceRegistry / IpcRegistry / PermissionGuard / AuditSink；Task 2 的实时事件。
- Produces: `TodoCloudService.list(input: TodoListInput): Promise<TodoPageDto>`、`get(locator: TodoLocator): Promise<TodoItemDto>`、`create(input: TodoCreateInput): Promise<TodoItemDto>`、`update(id: string, input: TodoUpdateInput): Promise<TodoItemDto>`、`setCompleted(id: string, input: TodoCompletionInput): Promise<TodoItemDto>`、`delete(id: string, input: TodoDeleteInput): Promise<TodoDeleteResult>`。
- Produces: `window.synapse.todos.item` 具有同签名的六个方法及 UI-only `onChanged(listener: (event: TodoChangedPayload) => void): () => void`、`onReset(listener: () => void): () => void`；身份变化前发 reset，确保同号重登也清草稿。`desktop/src/lib/todos-api.ts` 的 `todosApi` 是 renderer 唯一调用入口。
- Produces: 规范 action `app.todos.item.list / get / create / update / set_completed / delete`；索引名 `app_todos_item_list / get / create / update / set_completed / delete`。IPC / MCP 调用同一权限与服务层。

- [x] **Step 1：建立接线回归用例。**

| 测试名 | 必须断言的测试代码 / 值 |
| --- | --- |
| `six_indexed_actions_two_public_tools` | 六个索引可检索调用，`expect(publicToolNames).toEqual(['search', 'invoke'])`；onChanged / onReset 不进 MCP 索引 |
| `refresh_is_not_identity_change` | 401 刷新后完成一次原请求，`expect(sentRequestIds).toEqual([sameId, sameId])`；无额外 Authorization 实现 |
| `same_user_relogin_drops_old_result` | 旧请求挂起、退出再登录同一 userId、释放旧响应：`expect(publishedOldResults).toEqual([])`；切到另一账号同样拒绝 |
| `missing_endpoint_is_not_missing_item` | list 的 404 为服务器不支持提示；get 的 404 为事项不可访问；HTTP / 网络 / 409 code 保留，不返回伪空列表 |
| `permission_and_audit_metadata` | 拒绝网络权限时 `expect(httpCalls).toBe(0)`；审计不含 title / note / 完整请求；ID 与 reference 双传 / 非法路由为参数错误 |

- [x] **Step 2：运行红灯。** `pnpm --filter @synapse/desktop run test app-capabilities/todos/main synapse-capabilities/shared/__tests__/todos-domain.test.ts`，预期缺实现 / 接线失败。
- [x] **Step 3：实现集中 cloud service。** 使用既有认证请求处理 base URL、超时、refresh；service 在身份即将变化时递增 generation，异步前后检查，即使 userId 相同也不能回填。同次超时重试保留原 UUID / 原 payload，不跨 24 小时自动重放，错误归一保留 status / code，不持久化草稿或请求队列。
- [x] **Step 4：接入能力包与 bridge。** dispatcher strict 校验后经网络权限与审计调用 service；在 descriptors 组装，在 IpcRegistry 注册，用 EventBus 传递账号所属变更与身份 reset。preload 只暴露类型化六方法与订阅，禁止裸 ipcRenderer / webContents.send。修改注册源后运行 `pnpm --filter @synapse/desktop run generate:ipc`，不手改生成文件。
- [x] **Step 5：编写 Skill / Agent 指南。** 列出准确 schema、offset / nextOffset、UTC 分钟精度、version / UUID；AI 修改前检索并精读唯一对象，同名和缺时间才澄清，明确授权 CRUD 直接执行；如实报告失败，不把保存提醒说成已弹通知。不增加第三个公开 MCP 工具或 Workflow / Automation 能力。
- [x] **Step 6：运行绿灯与边界检查。** Step 2、`pnpm --filter @synapse/desktop run test synapse-capabilities/shared/__tests__/registry.test.ts`、desktop typecheck、`check:ipc-codegen`、`check:hard-constraints` 全部通过；共享子入口在 Electron CommonJS 与 renderer ESM 均可加载。
- [x] **Step 7：同步六项能力、指南与发布说明并提交。** 摘要：`feat: 通过 Synapse Skill 和桌面桥接维护云端待办`；此时不提前登记尚未完成的应用 UI / 路由数量。

## Task 4：桌面白色卡片列表、编辑与通知目标

**Files:**
- Create: `desktop/src/modules/todos/app-definition.ts`、`app-manifest.ts`、`assets/icon.svg`、`index.tsx`、`use-todos.ts`、`use-todo-editor.ts`、`todo-list.tsx`、`todo-row.tsx`、`todo-editor.tsx`、`todo-time.ts`。
- Create: `desktop/electron/bootstrap/todos-protocol-handlers.ts`、`desktop/electron/bootstrap/__tests__/todos-protocol-handlers.test.ts`。
- Modify: `desktop/src/modules/apps/types.ts`、`desktop/src/modules/apps/definitions.ts`、`desktop/src/modules/apps/registry.ts`、`desktop/src/modules/apps/visibility.ts`、`desktop/src/modules/apps/components/system-app-content.tsx`、`desktop/src/modules/apps/system-app-window-app.tsx`。
- Modify: `desktop/electron/services/system-app-window-service.ts`、`desktop/electron/modules/apps/ipc.ts`、`desktop/electron/preload.ts`、`desktop/src/types/bridge.ts`。
- Modify: `desktop/app-capabilities/manifest-registry.ts`、`desktop/electron/bootstrap/app-ready.ts`、`desktop/src/app-shell/hooks/use-message-center.ts`、`desktop/src/app-shell/components/message-center.tsx`。
- Test: 新增 `desktop/src/modules/todos/__tests__/use-todos.test.tsx`、`todo-editor.test.tsx`、`todos-navigation.test.tsx`、`todo-time.test.ts`；修改既有 apps registry / header architecture、message-center、`desktop/electron/modules/apps/__tests__/ipc.test.ts`、`desktop/electron/services/__tests__/system-app-window-service.test.ts`。

**Interfaces:**
- Consumes: Task 3 的 `todosApi` 与六方法 / 订阅，当前账号和 live 状态；Task 1 的 reference parser。
- Produces: `useTodos()` 返回 `items / filter / nextOffset / loading / error` 及 `setFilter(filter: TodoFilter): void`、`refresh(): Promise<void>`、`loadMore(): Promise<void>`、`setCompleted(item: TodoItemDto, completed: boolean): Promise<TodoItemDto>`、`remove(item: TodoItemDto): Promise<void>`。
- Produces: `useTodoEditor()` 管理内存草稿、UUID、校验 / 冲突与提交；展示组件不 fetch、不做鉴权路由副作用。
- Produces: `TodoOpenRequest { requestId: string; id: string }`，System App open options 中的 `todoOpenRequest`；`parseTodoReference` → window open → auth-ready → 单条 get / 打开编辑界面，打开本身不写入。
- Produces: UI-only `window.synapse.apps.onTodoOpenRequest(listener: (request: TodoOpenRequest) => void): () => void`，主窗口和独立窗口用同一目标消费规则。

- [x] **Step 1：建立用户可见行为回归用例。**

| 测试名 | 必须断言的测试代码 / 值 |
| --- | --- |
| `pending_all_complete_restore` | 首次只见未完成；完成响应成功才移除；全部可恢复；`expect(writeCalls).toHaveLength(1)`，没有第三个标签 / 搜索 / app 侧栏 |
| `page_filter_version_race` | 重复 ID 的 v3 + v2 只留 v3；未完成页迟到不进入全部的新视图；实时刷新使 offset 重置 0；刷新失败保留已加载条目 |
| `undo_after_other_client_edit` | 完成拿 v2，另一端更新到 v3，撤销仍发 expectedVersion 2；`expect(errorCode).toBe('TODO_VERSION_CONFLICT')`，重读 v3，不覆盖 |
| `failed_save_retains_draft` | 400 / 409 / 超时后 `expect(draft.title).toBe(editedTitle)`；重试复用 UUID；账号变化清空草稿；提交中禁重复动作 |
| `target_beyond_first_page_and_stale_navigation` | 深链直接 get 目标，已完成切全部；未登录等待；目标不在首 50 条仍可打开；用户新导航或换账号后 `expect(oldTargetOpened).toBe(false)` |
| `notification_is_read_only_target` | 消息中心先按现有规则已读，再打开 todos；`expect(todoMutationCalls).toHaveLength(0)`；不存在 / 删除 / 非本人统一必要错误 |

- [x] **Step 2：运行红灯。** `pnpm --filter @synapse/desktop run test src/modules/todos electron/bootstrap/__tests__/todos-protocol-handlers.test.ts`，预期缺页面 / 路由行为失败。
- [x] **Step 3：实现数据与编辑 hooks。** 分开账号 generation、读取序号、筛选序号；订阅 onReset 立即清列表、草稿、撤销反馈与目标，不只比较 userId。进入页面、回到前台与 live 重连都补读。分页按 ID / version 合并，旧页面不能覆盖新数据。保存后重读当前数据；所有失败保留草稿；无网络阻止提交且不排队。完成撤销用成功回执版本，不自动跨冲突重放；删除确认具体标题，没有删除撤销。
- [x] **Step 4：按已认可原型实现 UI。** 复用现有 SystemAppWindowShell / EmbeddedSystemAppShell，居中 tabs，标准尺寸新建。一张 Card 承载列表，行不再加卡片；必要空 / 错 / 加载状态、菜单和独立完成控件。Dialog 使用既有表单、日期与时间组合；日期辅助逻辑置于 todo-time。图标使用已有图标几何与主题语义，透明资源，不设计独立配色。
- [x] **Step 5：注册应用与目标。** id / namespace `todos`、用户可固定 Dock、默认不固定；主窗口与独立窗口均接同一内容，不重复顶栏。应用 open options 的 strict schema 仅允许 todos 携带 todoOpenRequest；现有窗口通过 EventBus 送新目标，新窗口按现有受控 query 初始化，preload / bridge 添加 UI-only `apps.onTodoOpenRequest`。深链严格解析一个 ID，所有账号 / 导航竞争复验；消息中心新增来源「待办提醒」与动作「查看待办」。桌面原生横幅继续由现有 System Notifier 单向呈现，不添加 click 回调或扩展其公开能力。
- [x] **Step 6：运行绿灯。** 先运行 desktop `generate:ipc` 更新新增目标事件；Step 2、apps registry / system-app-header-architecture / system-app-window-app、apps IPC / system-app-window-service、message-center 与 use-message-center 专项测试、desktop typecheck、`check:ipc-codegen`、`check:hard-constraints` 通过。组件测试以可见操作断言，白卡片外观与三宿主检查列入 Task 7，不能仅靠 className 断言声称视觉已验收。
- [x] **Step 7：同步 System App / 路由 / Dock 清单和发布说明并提交。** 摘要：`feat: 增加桌面云端待办应用与通知定位`。

## Task 5：iOS 账号 API、内存状态与实时同步

**Files:**
- Create: `SynapseMobile/SynapseMobile/Features/Todos/TodoModels.swift`、`TodoStore.swift`、`TodoDraft.swift`、`TodoTime.swift`。
- Modify: `SynapseMobile/SynapseMobile/Core/Networking/APIClient.swift`、`SynapseMobile/SynapseMobile/Core/Protocol/LiveProtocol.swift`、`SynapseMobile/SynapseMobile/Core/Realtime/RealtimeClient.swift`、`SynapseMobile/SynapseMobile/App/SynapseAppModel.swift`。
- Test: 新增 `SynapseMobile/SynapseMobileTests/TodoAPIContractTests.swift`、`TodoStoreTests.swift`、`TodoTimeTests.swift`；既有 `APIAuthLifecycleTests.swift`、`RealtimeAuthTests.swift`。

**Interfaces:**
- Consumes: Task 1 同名 Swift Codable DTO / input / result；现有 APIError 的 status / code、唯一 APIClient 与 `accountIdentityGeneration / isCurrentAccount`。
- Produces: `APIClient.listTodos(_ input: TodoListInput) async throws -> TodoPageDto`、`getTodo(id: String) async throws -> TodoItemDto`、`createTodo(_ input: TodoCreateInput) async throws -> TodoItemDto`、`updateTodo(id: String, input: TodoUpdateInput) async throws -> TodoItemDto`、`setTodoCompleted(id: String, input: TodoCompletionInput) async throws -> TodoItemDto`、`deleteTodo(id: String, input: TodoDeleteInput) async throws -> TodoDeleteResult`。
- Produces: `@MainActor @Observable TodoStore`，`reset(accountGeneration: Int)`、`selectFilter(_ filter: TodoFilter)`、`reload(using api: APIClient) async`、`loadMore(using api: APIClient) async`、`save(_ draft: TodoDraft, using api: APIClient) async throws -> TodoItemDto`、`setCompleted(_ item: TodoItemDto, completed: Bool, using api: APIClient) async throws -> TodoItemDto`、`remove(_ item: TodoItemDto, using api: APIClient) async throws`。
- Produces: `TodoDraft` 保存编辑目标 `id / expectedVersion`（新建为 nil）、当前字段与稳定 `clientRequestId: UUID`；`TodoPatchField<Value: Codable>` 的 `absent / null / value(Value)` 用于可清空字段，避免 `encodeIfPresent` 丢失 null。撤销使用成功完成回执的版本与一个新的反向请求 ID。
- Produces: `RealtimeClient.onTodosChanged: ((TodoChangedPayload) -> Void)?`，只解码服务器事件，由 AppModel 更新当前账号 TodoStore。

- [x] **Step 1：用现有 URLProtocol 测试模式建立真实 JSON / 认证回归。** Swift `String.count` 是 grapheme 数，不能用于 API 的码点上限；用 unicodeScalars 并校验合法性。

| 测试名 | 必须断言的测试代码 / 值 |
| --- | --- |
| `wire_null_patch_and_retry_uuid` | Codable 区分字段缺省与 null；PATCH 保留未改字段；401 refresh / 超时重试 UUID 不变；请求与 Task 1 完全一致 |
| `reset_same_account_rejects_late_result` | 捕获 generation 1 请求，退出 / 同号重登 reset 到 3，释放旧响应：`XCTAssertTrue(store.items.isEmpty)`；草稿 / target 清空 |
| `page_filter_version_race` | 相同 ID v3 / v2 只留 v3；迟到 pending 页不能回填 all；刷新失败保留已加载 items 与错误；断开所选电脑 REST 仍可用 |
| `conflict_draft_and_undo` | 409 保留草稿，原 expectedVersion 不自动改成新版本；撤销冲突重读；提交期间只有一个网络 mutation |
| `instant_and_unicode_contract` | 200 个非 BMP 标题可保存；组合字符按标量计数；上海 / 洛杉矶显示不同但 UTC 相同；DST 转换不手写偏移，发送秒 / 毫秒为 0 |
| `unsupported_server_distinct_from_item_404` | list 404 显示升级 / 不可用状态；get 404 显示目标无法访问；均不能回退本地库或伪空列表 |

- [x] **Step 2：构建并运行红灯单测。** 先 `xcrun simctl list devices available` 取得真实可用 UDID；构建命令为下方公共 iOS 命令。新增方法缺失应导致编译 / 测试失败，Simulator 不可用只是验证缺口。
- [x] **Step 3：实现 APIClient 六方法与 Codable 类型。** 在现有 APIClient 文件内调用 private send，沿用统一认证 / 超时 / 归一化，禁止另建客户端或在 View 中手写 URLSession。patch 用明确 absent / null / value 编码，日期固定 wire 精度。
- [x] **Step 4：实现单一 TodoStore 与时间 / 草稿。** AppModel 持有并在身份变化同步 reset；异步捕获账号 generation / 筛选 generation / 读序号，返回前复验。相同 ID 不倒退版本，切筛选重读，重连 / 前台 / 进入补读；实时事件不依赖 selected desktop。编辑草稿与列表刷新分离，账号改变才清空，不落 UserDefaults、文件、SQLite 或 Keychain 正文。
- [x] **Step 5：运行绿灯并同步移动契约。** 构建成功，TodoAPIContractTests / TodoStoreTests / TodoTimeTests、APIAuthLifecycleTests / RealtimeAuthTests 全部编译；本轮没有原生测试运行授权，因此未执行测试断言；按部署版本 iOS 18.0 编译，项目使用同步目录，不手改 PBX 文件枚举或升部署版本。运行测试会启动测试宿主 / 模拟器，须在用户明确要求运行原生测试时执行并保留结果；本计划不启动。
- [x] **Step 6：同步移动账号归属与发布说明并提交。** 摘要：`feat: 为 iOS 增加云端待办数据与账号同步`。

## Task 6：iOS 原生列表、主页入口与通知定位

**Files:**
- Create: `SynapseMobile/SynapseMobile/Features/Todos/TodosView.swift`、`TodoRow.swift`、`TodoEditorSheet.swift`、`TodoNavigation.swift`。
- Modify: `SynapseMobile/SynapseMobile/Features/Home/HomeView.swift`、`SynapseMobile/SynapseMobile/Features/Home/HomeRoute.swift`、`SynapseMobile/SynapseMobile/Features/Root/RootView.swift`、`SynapseMobile/SynapseMobile/Core/Push/NotificationRouter.swift`、`SynapseMobile/SynapseMobile/Features/Inbox/NotificationDestination.swift`。
- Test: 新增 `SynapseMobile/SynapseMobileTests/TodoNavigationTests.swift`、`TodoDraftTests.swift`；修改 `NotificationDeepLinkTests.swift`、`NotificationDestinationTests.swift`。
- Create: `docs/superpowers/acceptance/2026-10-11-cloud-todos.md`，记录跨端与原生界面验收矩阵及未执行项。

**Interfaces:**
- Consumes: Task 5 的 TodoStore / APIClient / TodoDraft；现有 HomeRoute、RootView、NotificationRouter、NotificationStore 已读逻辑。
- Produces: HomeRoute `.todos`；notification destination `.todo(id: String)`；`TodoNavigation` 只维护内存 target / navigation generation，`open(id: String, accountGeneration: Int)`、`cancel()` 与异步结果归属判定。
- Produces: `TodosView` 的 List / 两状态 Picker / 新建，`TodoEditorSheet` 的标题、备注、截止时间与提醒 Form；所有写入使用 Task 5 store，View 只发意图。

- [ ] **Step 1：建立导航与草稿回归。**

| 测试名 | 必须断言的测试代码 / 值 |
| --- | --- |
| `reference_is_single_read_only_id` | query / fragment / 多段 / 编码斜杠全部拒绝，合法 `synapse://todos/abc` 只读取 abc；`XCTAssertEqual(mutationCount, 0)` |
| `cold_login_and_completed_target` | 未登录 target 等账号就绪；单条 get 找到已完成项切 all 并打开，即使不在首 50 条；读取失败统一“事项已删除或无法访问” |
| `new_navigation_cancels_pending_target` | 等待登录 / 网络时用户回主页或换账号，释放旧请求后 `XCTAssertNil(oldTarget)`；不会跳到终端 / 换电脑 |
| `draft_survives_view_changes` | 旋转 / 缩放 / 列表刷新不替换 draft；取消不写；提醒默认 none、自定可无截止、相对无截止显示必要校验 |

- [ ] **Step 2：构建并运行红灯。** 公共 iOS 构建命令；已获原生测试授权时运行 TodoNavigationTests / TodoDraftTests / NotificationDeepLinkTests / NotificationDestinationTests，预期缺待办目的地行为失败。
- [ ] **Step 3：实现系统界面。** HomeView 加「待办事项」行，复用一个主页栈。List 行完成控件与编辑正文分离，菜单可完成 / 恢复 / 删除；sheet 左取消右添加 / 保存，系统 Form / DatePicker / 提醒 Picker。表单失败保留，删除确认标题；List / sheet 自适应 iPhone 与 iPadOS，底栏不改，使用系统语义颜色和可访问操作名。
- [ ] **Step 4：接入通知和路由。** 从现有通知 ID 重取通知，再解析 source / target，不信任推送文字；沿用已读语义，登录就绪后单条读取。普通主页进入 pending，已完成目标切 all；待目标请求与用户导航按 generation 复验，已删除 / 非本人不泄漏内容。
- [ ] **Step 5：按 Apple 依据填写原生验收矩阵。** 沿用设计 §10 的 Lists / Sheets / Layout / Accessibility 等官方依据；记录 iPhone、iPadOS 全窗 / 窄窗、动态字体、VoiceOver、深浅色、键盘 / 指针与最低 iOS 18。构建 / 单测不能标记原生界面或真实推送“已验收”；没有设备或运行授权的项目明确待验收，不补假截图。
- [ ] **Step 6：运行绿灯与提交。** 公共构建成功，获授权的 Step 2 测试通过；更新主页 / 目标移动规则和发布说明。摘要：`feat: 增加 iOS 待办入口与原生编辑提醒界面`。

## Task 7：跨端验收、能力清单与交付检查

**Files:**
- Modify: `docs/agents/capability-registry.md`、`docs/agents/module-boundaries.md`、`docs/agents/mobile-runtime-contracts.md`、`docs/superpowers/specs/2026-09-23-account-notification-center-design.md`。
- Modify: `docs/agent-guides/todos.md`、`server/README.md`、`SynapseMobile/README.md`、`RELEASE_NOTES_PENDING.md`、本计划、Task 6 验收矩阵。
- Test: Task 1–6 的 contract / 事务 / worker / bridge / UI / Swift 测试；新契约与既有通知 / 认证回归。

**Interfaces:**
- Consumes: 六个账号 API、六个 MCP 索引、桌面与 iOS 同一账号 DTO / event / deep link，Task 6 的验收证据。
- Produces: 与真实实现一致的规则、注册数量、用户发布说明与验证记录；确认 `+1 System App / +6 MCP 索引 / +1 桌面路由`，iOS 路由另 `+1`，用户可固定 Dock但默认不固定，Workflow / Automation 增量 0。

- [ ] **Step 1：增加跨层契约断言。** 复用固定 JSON 夹具验证 shared / server / desktop DTO；Swift 测试用同字段和值。`expect(capabilityActions).toHaveLength(6)`；UI bridge 与 MCP 映射均覆盖同六 action；通知 query 不能伪造来源，变更事件无正文，System Notifier 公共 schema 不增加新字段。
- [ ] **Step 2：执行最小充分静态与自动化检查。** 使用下方公共命令，不调用 dev / 发版命令。所有测试应通过，记下真实 PostgreSQL 测试是否运行；通过最小充分检查后不重复扩大测试，除非新失败或改动需要。
- [ ] **Step 3：完成有运行授权的实际链路。** 桌面手动新建 → AI 查询 / 修改 → iOS 同账号读取；完成后取消提醒、全部恢复；另一个账号不可见；电脑关闭时云端仍产出提醒。生产推送在 TestFlight / App Store 设备检验，不改 APNs 网关；区分账号通知与系统横幅证据。没有运行授权 / 设备的项列为待验收，不称已完整验收。
- [ ] **Step 4：核对 UI / 包产物与注册。** 验收桌面启动台内嵌、Dock、独立窗口的白卡片和单顶栏；iOS 按 Task 6 矩阵。新能力包 / Skill 资源涉及正式包时，运行 `check:packaged-asar` 并核对新生成产物，不用旧包的检查冒充；仅在允许打包的范围生成本地包，不运行 release / push。重数能力清单的真实总数并解释例外，不能简单替换猜测的基数。
- [ ] **Step 5：完成独立审查。** 使用用户选择执行方式所要求的审查流程；逐任务方式每任务审查再集成审查，当前会话方式完成后一次独立全量审查。处理发现的任务范围内缺陷并重跑受影响检查，不顺手重构。
- [ ] **Step 6：更新最终文档、检查 diff / 暂存区并提交。** 规则与 Skill 均描述真实能力；发布说明面向用户，不写代码流水账；保留他人改动。摘要：`docs: 同步云端待办能力规则与验收结果`。交付列出本地提交、已通过验证与尚待设备 / 部署验证的项目；没有授权不部署、不发版、不 push。

## 公共验证命令与执行边界

下列命令在对应实现完成后运行，本计划阶段未运行产品测试或启动应用。

```bash
pnpm --filter @synapse/shared run test
pnpm --filter @synapse/server run prisma:generate
pnpm --filter @synapse/server run test src/todos src/notifications
pnpm --filter @synapse/server run test:todos:e2e
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/desktop run test app-capabilities/todos synapse-capabilities/shared/__tests__/todos-domain.test.ts synapse-capabilities/shared/__tests__/registry.test.ts src/modules/todos src/modules/apps/__tests__/registry.test.ts src/modules/apps/__tests__/system-app-header-architecture.test.ts src/modules/apps/__tests__/system-app-window-app.test.tsx src/app-shell/hooks/__tests__/use-message-center.test.tsx src/app-shell/components/__tests__/message-center.test.tsx electron/bootstrap/__tests__/todos-protocol-handlers.test.ts electron/modules/apps/__tests__/ipc.test.ts electron/services/__tests__/system-app-window-service.test.ts
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:ipc-codegen
pnpm --filter @synapse/desktop run check:hard-constraints
```

不启动原生应用的 iOS 构建：

```bash
xcodebuild build-for-testing -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath SynapseMobile/build/todos-tests CODE_SIGNING_ALLOWED=NO
```

获原生测试运行授权后先发现设备，再用真实 UDID 替换下列占位符；运行结果包括 XCTest 的通过数 / 失败数。不可用设备或未运行不能记为通过。

```bash
xcrun simctl list devices available
xcodebuild test-without-building -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile -destination 'platform=iOS Simulator,id=<已发现的UDID>' -derivedDataPath SynapseMobile/build/todos-tests -only-testing:SynapseMobileTests/TodoAPIContractTests -only-testing:SynapseMobileTests/TodoStoreTests -only-testing:SynapseMobileTests/TodoTimeTests -only-testing:SynapseMobileTests/TodoNavigationTests -only-testing:SynapseMobileTests/TodoDraftTests -only-testing:SynapseMobileTests/APIAuthLifecycleTests -only-testing:SynapseMobileTests/RealtimeAuthTests -only-testing:SynapseMobileTests/NotificationDeepLinkTests -only-testing:SynapseMobileTests/NotificationDestinationTests
```

## 自审与交接

实施前审阅此计划及设计；选择逐任务子代理执行，或当前会话顺序执行并在最后独立审查。本计划建议当前会话顺序执行：七个阶段共享账号、事务、通知与接口，接口依赖连续，顺序实现便于保持两端一致。用户已选择当前会话顺序执行并在最后独立审查。

计划自审已完成：设计界面对应 Task 4 / 6，数据与一致性对应 Task 1 / 3 / 5，提醒对应 Task 2，AI 对应 Task 3，整体验收与文档对应 Task 7；Review Focus 五项均有具名断言。现有 Modify 路径和本地文档链接已核对，后续 Task 才修改的新增文件明确归属于前置任务。任务完成时勾选步骤并记录真实检查结果。
