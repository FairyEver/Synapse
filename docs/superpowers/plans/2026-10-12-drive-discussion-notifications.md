# 云盘评论与留言通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Markdown 云盘文档出现新评论、新留言或新回复后，相关账号收到带摘要和具体内容直达链接的通知。

**Architecture:** 现有 Drive 创建服务在同一 Prisma 事务中保存内容、账号通知、定位目标和专属 outbox。提交后通过已有 NotificationService / Live / APNs 投递；网页定位入口先验证本人通知，再使用原有 owner/share 阅读权限，客户端复用现有通知界面。

**Tech Stack:** 现有 NestJS、Prisma 6、PostgreSQL、Nest Schedule、TypeScript 6、React 19、TanStack Router/Query、shadcn/Radix、Electron 41、SwiftUI、Swift Testing、pnpm 和 Vitest。

**Spec:** [已确认设计](../specs/2026-10-12-drive-discussion-notifications-design.md)。

状态：书面设计已确认；本计划待审阅及选择执行方式，所有步骤均未实施。本文中的新文件、方法和 HTTP 接口是拟实施契约，不是现有 API。

## Global Constraints

- 仅新评论讨论、新评论回复、新文末留言、新留言回复触发；编辑、删除、解决、重新打开不触发，历史创建事件不补发。
- 新评论与留言通知所有者；回复通知所有者、发起人和直接被回复者，按账号去重并排除操作者本人与失效账号。
- 文案角色优先级为直接被回复者、发起人、所有者；首评只产生一个创建事件。
- 来源为服务端拥有的 `drive-discussion`，只扩展 `NOTIFICATION_SOURCES`，不加入 `DESKTOP_NOTIFICATION_SOURCES`；普通 `active`，分组 `drive`。
- 正文摘要最多 120 个 Unicode code point，合并空白并预留省略号；标题不超过现有 64 字符，正文不超过现有 512 字符存储上限；不展示作者邮箱。
- 内容、通知、目标和 outbox 同事务；事务内不执行 Live / APNs / 外部网络请求，提交后推送失败不回滚内容。
- 后台每 30 秒、最多 100 条；租约 60 秒、每 20 秒续租，重试从 1 分钟倍增至最多 15 分钟，提交后超过 24 小时停止；通知保留 90 天。
- 已读、删除或已清理的通知停止外部投递；重试复用通知 ID，不保证物理横幅恰好一次。
- HTTPS 定位路径为 `/notifications/<notificationId>/open`，不带密码、Bearer、refresh token、cookie、正文或权限参数。
- 其他收件人只用其原参与记录中的分享来源；旧记录缺少来源时仍通知新回复，链接明确不可访问，不猜测或新建分享。
- 阅读、打开通知不改变讨论解决状态、正文、版本、协同状态或业务权限；锚点失效仍展示讨论，不在浏览器猜测重挂。
- 不增加依赖、通知设置、站内信、外部渠道、System App、Dock、Workflow/Automation 节点、MCP tool 或 `synapse://` 路由。
- 桌面横幅不加点击回调；System Notifier 公开契约不变；`APNS_USE_SANDBOX` 保持 `false`。
- 复用集中客户端、现有组件、主题和标准按钮；禁止自定义颜色、普通内联样式、卡片套卡片和冗余文案。
- 修改 iOS 可视内容前使用 apple-design；保持当前导航、iPhone/iPadOS 运行时、网页身份及账号取消规则。
- 不记录文案、摘要、文件名、URL、密码或 cookie；只记录 ID、次数和固定原因。
- 只提交本任务文件，不 push；不启动开发服务、浏览器、Playwright、应用或 Simulator，不部署或发版。原生运行及真实横幅验收等待相应授权。

## Review Focus

1. 多身份重合及“自己回复自己”不能漏通知其他相关人，也不能向操作者发送通知（Task 2）。
2. HTTP 超时重试和多个 worker 同时投递不能多建账号通知；旧 lease token 不能回写新租约（Task 2、3）。
3. 旧讨论没有分享来源、原分享被停用、文件移出分享后，不得寻找新的公开链接替代（Task 4）。
4. 通知目标不在当前显示区域、原文锚点失效或讨论已解决，仍应打开具体讨论，不能修改状态或反复抢焦点（Task 5）。
5. 登录、取消、同账号重新登录和不同账号切换时，迟到结果不能打开旧账号目标；旧端未知来源/可选字段不能使通知列表解码失败（Task 1、5、6、7）。

---

## 文件职责与依赖

Task 1 固定共享契约和数据库结构；Task 2 接入创建事务；Task 3 实现投递；Task 4 实现受保护目标解析；Task 5 完成网页承接及具体定位；Task 6/7 完成桌面/手机入口；Task 8 进行跨边界验证与指南同步。执行时顺序推进，最终验证完成前不交付部分链路。

服务端新代码放 `server/src/drive/`，共享定位放 `shared/src/`，网页开页流程放 `dashboard/src/features/drive-browser/`。通知模块只按 Prisma 关联投影元数据，不导入 DriveModule，避免循环依赖。下述 Create 文件均属于本任务拟新增；Modify 文件是已核对的现有文件。

## Task 1：共享定位契约与通知存储

**Files:** Create `shared/src/drive-discussion.ts`、`shared/src/drive-discussion.test.ts`、`shared/src/notifications.test.ts`、`server/prisma/migrations/20261012000100_drive_discussion_notifications/migration.sql`。Modify `shared/src/index.ts`、`shared/src/notifications.ts`、`server/prisma/schema.prisma`、`server/src/notifications/notification.service.ts`、`desktop/src/types/notification-center.ts`、`desktop/src/app-shell/components/message-center.tsx`。Test `server/src/notifications/notification.service.spec.ts`、`server/src/notifications/notification-http.spec.ts`。

**Interfaces:**

```ts
type DriveDiscussionNotificationMetadata = {
  readonly kind: 'annotation' | 'message'; readonly action: 'created' | 'replied'
}
type DriveDiscussionNotificationDto = {
  readonly id: string; readonly source: string; readonly url: string | null
  readonly readAt: string | null; readonly driveDiscussion?: DriveDiscussionNotificationMetadata
}
type DriveDiscussionLocation =
  | { readonly kind: 'annotation'; readonly threadId: string; readonly commentId: string }
  | { readonly kind: 'message'; readonly messageId: string; readonly commentId: string | null }
type DriveDiscussionOpenResult =
  | { readonly status: 'ready'; readonly browserUrl: string }
  | { readonly status: 'unavailable'; readonly message: '文档已删除或无法访问' }
function buildDriveDiscussionFragment(location: DriveDiscussionLocation): string
function parseDriveDiscussionFragment(hash: string): DriveDiscussionLocation | null
function buildDriveDiscussionNotificationOpenUrl(origin: string, notificationId: string): string
function isDriveDiscussionNotificationOpenPath(pathname: string): boolean
function getDriveDiscussionActionLabel(meta?: DriveDiscussionNotificationMetadata | null):
  '查看评论' | '查看留言' | '查看回复' | '查看文档'
```

片段格式为 `#discussion=annotation&threadId=<id>&commentId=<id>` 或 `#discussion=message&messageId=<id>[&commentId=<id>]`。ID 为 1–120 字符的 `[A-Za-z0-9_-]`，拒绝额外字段、重复字段、错误类别组合和编码分隔符；非讨论片段返回 null，不破坏现有标题目录锚点。生产 open URL 只接受 HTTPS origin；open path helper 只接受 `/notifications/<合法单一ID>/open`，供路由、回跳和开发 fallback 共用。

- [ ] **Step 1：写契约和来源边界红灯测试。** 固定 `round_trips_exact_reply` 断言 parse(build(location)) 等于原输入；`rejects_duplicate_or_cross_kind_ids` 断言混合 thread/message、重复 commentId、`%2F` 和非法字符均为 null；`server_source_cannot_be_forged` 断言 desktop/internal 发送 `source='drive-discussion'` 返回 400，公开通知入口仍固定 external。覆盖元数据缺省和未知来源可读取回退。
- [ ] **Step 2：运行红灯。** `pnpm --filter @synapse/shared run test src/drive-discussion.test.ts src/notifications.test.ts`；`pnpm --filter @synapse/server run test src/notifications/notification-http.spec.ts`。新增行为断言失败才是红灯，不把缺少依赖或未找到测试当证据。
- [ ] **Step 3：实现契约与迁移。** 四个原始内容模型 `DriveAnnotationThread`、`DriveAnnotationComment`、`DriveMessage`、`DriveMessageComment` 增加可空 `sourceShareId`，存内部 DriveShare ID，旧值保持 null，不做猜测回填。新增 `DriveDiscussionNotificationTarget`：`id`、唯一 `notificationId`、`itemId`、`kind`、`action`、可空 `threadId/messageId/commentId/sourceShareId`、`createdAt`；只向通知做 Cascade 外键，目标内容被删除时保留通知历史。用 CHECK 约束保证类别字段组合。新增 `DriveDiscussionNotificationDelivery`：唯一 `notificationId`、`userId`、`pending/delivered/skipped/expired` 状态、`attempts`、`nextAttemptAt`、`leaseUntil`、`leaseToken`、`failureReason`、时间戳及认领索引。
- [ ] **Step 4：实现读取投影。** 通知 list/get 按关联仅追加 `driveDiscussion?: {kind, action}`，不输出内部分享引用或整条目标记录，不制造 N+1 查询；保持既有分页和 count 语义。desktop DTO 增加可选元数据，来源 label map 补“文档互动”，使共享 source 扩展后类型仍完整。
- [ ] **Step 5：运行绿灯并提交。** 先 `pnpm --filter @synapse/server run prisma:generate`，再运行 Step 2、`pnpm --filter @synapse/shared run typecheck`、`pnpm --filter @synapse/server run typecheck`。不对本地业务库执行迁移。提交摘要：`feat: 定义云盘互动通知来源、定位契约和持久投递存储`。

## Task 2：创建事务、收件人和通知文案

**Files:** Create `server/src/drive/drive-discussion-notification.types.ts`、`drive-discussion-notification-copy.ts`、`drive-discussion-notification.service.ts` 及各自对应 `.spec.ts`（types 无独立镜像测试）。Modify `server/src/drive/drive-annotation.service.ts`、`drive-message.service.ts`、`drive.service.ts`、`drive.module.ts`；Test 现有 `drive-annotation.service.spec.ts`、`drive-message.service.spec.ts`。

**Interfaces:**

```ts
type DriveDiscussionParticipant = { userId: string; sourceShareId: string | null }
type DriveDiscussionEvent = {
  kind: 'annotation' | 'message'; action: 'created' | 'replied'
  item: { id: string; userId: string; name: string }
  actor: { userId: string; handle: string }; body: string
  root: { id: string; author: DriveDiscussionParticipant }
  targetCommentId: string | null; directlyRepliedTo: DriveDiscussionParticipant | null
}
type DriveDiscussionRecipient = DriveDiscussionParticipant & { role: 'direct' | 'starter' | 'owner' }
type DriveDiscussionDeliveryRef = { userId: string; notificationId: string }
function collectDriveDiscussionRecipients(event: DriveDiscussionEvent): DriveDiscussionRecipient[]
function buildDriveDiscussionNotificationCopy(event: DriveDiscussionEvent, recipient: DriveDiscussionRecipient):
  { title: string; body: string; sourceKey: string; meta: DriveDiscussionNotificationMetadata }
DriveDiscussionNotificationService.enqueue(tx: Prisma.TransactionClient, event: DriveDiscussionEvent):
  Promise<DriveDiscussionDeliveryRef[]>
```

`DriveService.resolveShareAnnotationAccess` 的内部返回值追加真实 `sourceShareId: string`，值来自已验证 share.id，不接收客户端内部引用。owner 内容来源为 null，share 内容保存该内部 ID。新编排服务是生产必需依赖，不能因注入缺失而悄悄跳过通知。

- [ ] **Step 1：写收件人和八类文案红灯测试。** `nested_reply_notifies_owner_starter_and_parent` 使用 actor=王五、owner=你、starter=张三、parent=李四，断言 3 个唯一收件人；`self_reply_keeps_other_recipients` 排除李四但保留你和张三；`role_overlap_prefers_direct` 断言同人只一条且 role=direct；`owner_root_has_no_recipients` 断言空数组。八类标题逐字断言设计 §3，正文断言 Unicode 截断、合并空白、纯文本和无邮箱。
- [ ] **Step 2：写服务原子性红灯测试并运行。** 注入 enqueue 失败，断言创建失败且不发布协同事件、不调用投递；已有幂等线程/留言重放不再 enqueue；首评只一次；edit/delete/status 更新全部零 enqueue。运行 `pnpm --filter @synapse/server run test src/drive/drive-discussion-notification src/drive/drive-annotation.service.spec.ts src/drive/drive-message.service.spec.ts`。
- [ ] **Step 3：实现纯收件人和文案。** 优先级 direct/starter/owner，排除 actor 后在 enqueue 中查询 `User.status='active'`。摘要复用现有 Markdown 解析依赖提取纯文本，不增加依赖；标题保留动作与关系并缩短文档名/handle，避免 UTF-16 截断留下孤立 surrogate。来源键严格采用设计 §5 三种格式。
- [ ] **Step 4：接入六个创建方法。** 评论 owner/share 根创建和回复、留言 create/createComment 在事务内复验 item/root/parent，保存内容与来源，再调用 enqueue；通知使用已有 `createInTransaction`，附加目标、URL和 outbox 同事务。按通知/事件唯一键 upsert，不修改现有内容创建的公开输入或幂等能力。创建与删除按 item → root → parent 的固定锁顺序协调，删除先提交则拒绝回复，创建先提交则允许其历史通知保留；只调整对应删除路径的事务锁，不重构无关方法。
- [ ] **Step 5：验证提交后边界。** 审计和 collaborationBus 只在成功提交后执行；本任务先完成持久通知，不直接通过 create() 再发一条消息。运行 Step 2、`pnpm --filter @synapse/server run typecheck`。提交摘要：`feat: 评论和留言创建时按相关人原子生成去重通知`。

## Task 3：提交后投递、租约和失败重试

**Files:** Create `server/src/drive/drive-discussion-notification-outbox.ts`、`drive-discussion-notification-outbox.spec.ts`。Modify `server/src/drive/drive.module.ts`、`drive-annotation.service.ts`、`drive-message.service.ts`；Test `server/src/notifications/notification.service.spec.ts`。

**Interfaces:** Consumes Task 2 的 `DriveDiscussionDeliveryRef[]` 与现有 `NotificationService.deliverCommitted(userId, notificationId, signal?)`。Produces `DriveDiscussionNotificationOutbox.deliverIds(ids: readonly string[], now: Date): Promise<void>`、`deliverPending(now: Date): Promise<void>`、`driveDiscussionRetryDelay(attempt: number): number`；两种 deliver 都经过同一个认领/租约流程。

- [ ] **Step 1：写时间和竞争红灯。** `retry_reuses_existing_notification` 断言同一 ID、0 次新建；`expired_worker_cannot_finish_new_lease` 断言旧 token 更新 0 行；`read_or_deleted_is_skipped` 断言不发；`deadline_is_checked_per_record` 把处理时间推进至后续项超过 24 小时，断言 expired；延迟断言第 1 次 60,000 ms、增长封顶 900,000 ms。APNs failed/skipped 可重试，无注册设备不误判失败。
- [ ] **Step 2：运行红灯。** `pnpm --filter @synapse/server run test src/drive/drive-discussion-notification-outbox.spec.ts src/notifications/notification.service.spec.ts`。
- [ ] **Step 3：实现 outbox。** `FOR UPDATE SKIP LOCKED` 每批 100 条，token 与 60 秒期限同事务写入；发送前复验，20 秒续租，失败/失租/到期用 AbortSignal 终止。只按当前 token 完成记录；逐条用实际处理时间检查截止，不能复用批次开始时间。每 30 秒补偿，终态记录随 90 天保留清理，通知物理清理级联目标/outbox。
- [ ] **Step 4：接入立即投递。** 六个创建入口提交后将本次 refs 交给 deliverIds，异步投递异常只记录固定失败原因，由持久任务补偿，不让已提交内容的 API 返回失败。立即投递与后台扫描不能各走一条裸发送路径。
- [ ] **Step 5：绿灯并提交。** 运行 Step 2、Task 2 创建测试和 server typecheck。提交摘要：`feat: 云盘互动通知支持提交后投递、租约和失败重试`。

## Task 4：受保护的通知目标解析

**Files:** Create `server/src/drive/drive-discussion-notification-target.service.ts`、`drive-discussion-notification-target.controller.ts` 及对应 `.spec.ts`。Modify `server/src/drive/drive.service.ts`、`drive.module.ts`；Test `server/src/notifications/notification-http.spec.ts`。

**Interfaces:** Consumes Task 1 的目标表、`DriveDiscussionOpenResult` 和 fragment builder。Produces `DriveDiscussionNotificationTargetService.resolve(userId: string, notificationId: string): Promise<DriveDiscussionOpenResult>` 与拟新增 `GET /api/notifications/:id/drive-target`（UserAuthGuard，只有 id，无收件人/分享覆写字段）。DriveService 增加 `getDiscussionBrowserUrl(input: {userId: string; itemId: string; sourceShareId: string | null}): Promise<string | null>`，仅返回 owner/share 导航路径，不返回文档字节或密码。

- [ ] **Step 1：写权限红灯。** `another_account_cannot_resolve` 断言他人或已删除通知统一 404；source 非 drive-discussion 或目标不匹配同样不能解析。`owner_does_not_need_share` 断言 owner 路径；`legacy_missing_origin_does_not_find_replacement` 断言 unavailable 且不会调用分享列表；`disabled_expired_or_moved_out_share_is_unavailable` 分别覆盖停用、过期、子文件移出分享和分享根被删。
- [ ] **Step 2：运行红灯。** `pnpm --filter @synapse/server run test src/drive/drive-discussion-notification-target src/notifications/notification-http.spec.ts`。
- [ ] **Step 3：实现只读解析。** 按当前 userId 查通知/目标关联，owner 复用 requireOwnedItem 语义；非 owner 按保存的内部 share 引用检查有效期、启停、根与子文件包含关系，复用 DriveService 内部查找逻辑。不调用任意“最新分享”替代。受密码保护时只返回原 share 导航路径，让阅读器做既有解锁，不能借定位接口返回正文、免密 cookie 或密码。
- [ ] **Step 4：构造目标片段。** 只用服务器记录中的完整 thread/message/comment ID 生成 Task 1 片段和既有 `buildOwnerDriveBrowserUrl` / `buildShareDriveBrowserUrl`。目标内容删除由已经获得阅读权限的阅读器区分提示，权限失败优先返回文档不可访问，不泄露内容存在性。
- [ ] **Step 5：绿灯并提交。** 运行 Step 2、server typecheck；确认 DriveModule 导入 NotificationModule，后者不反向导入 DriveModule。提交摘要：`feat: 按本人通知和原分享权限解析云盘讨论直达目标`。

## Task 5：网页开页、登录承接与具体内容定位

**Files:** Create `dashboard/src/routes/notifications/$notificationId/open.tsx`、`dashboard/src/features/drive-browser/drive-discussion-notification-page.tsx`、`use-drive-discussion-notification.ts`、`use-drive-discussion-location.ts` 及三个 feature 对应 `.test.tsx`；Create `dashboard/src/lib/require-dashboard-session.ts`。Modify `dashboard/src/routes/_authenticated/route.tsx`、`dashboard/src/lib/api.ts`、`dashboard/src/lib/dashboard-redirect.ts`、`dashboard/src/features/auth/sign-in/components/user-auth-form.tsx`、`dashboard/vite.config.ts`、`server/nginx.conf`、`dashboard/src/features/drive-browser/drive-browser-page.tsx`、`drive-comments-rail.tsx`、`drive-messages-section.tsx`、`renderers/drive-renderer-shell.tsx`、`renderers/markdown-renderer.tsx`、`renderers/mdxeditor-renderer.tsx`、`renderers/drive-document-editor-comments.tsx`。Test `dashboard/vite.config.test.ts`、`dashboard/src/lib/dashboard-redirect.test.ts`、`drive-browser-page.test.tsx`、`drive-comments-rail.test.tsx`、`drive-messages-section.test.tsx`、`renderers/markdown-renderer.test.tsx`、`renderers/drive-document-editor-comments.test.tsx`。

**Interfaces:** Consumes Task 1 的 `DriveDiscussionNotificationDto`。Central API adds `discussionNotificationApi.get(id: string): Promise<DriveDiscussionNotificationDto>`、`markRead(id: string): Promise<{ok:true}>`、`resolveTarget(id: string): Promise<DriveDiscussionOpenResult>`，使用现有 request 包装。Produces `requireDashboardSession(location: Pick<Location, 'pathname'|'search'|'hash'>): void`，复用当前 auth store，未登录抛集中 router redirect。`isRootNotificationDashboardRedirect(value: string|undefined): boolean` 用 Task 1 path helper，现有 share/public redirect 判定保持原意。`useDriveDiscussionNotification(id: string)` → `{status: 'loading'|'error'|'unavailable'|'ready'; error: string|null; retry(): void}`；它负责 GET 本人通知、PATCH 已读、GET target 和经校验的同源导航，绑定 `auth.user.sessionId` 与请求 generation。`useDriveDiscussionLocation(itemId: string)` → `{location: DriveDiscussionLocation|null; requestKey: string; consume(): void; cancel(): void}`，每次导航目标只消费一次。

- [ ] **Step 1：写路由与身份红灯。** 未登录保留原通知路径，登录后返回 root `/notifications/.../open`，不能被加成 `/console/notifications/...`；禁止外站 redirect、伪造 browserUrl 和未知 source。写 `cancelled_or_old_account_cannot_navigate`、`same_account_relogin_invalidates_old_request`，按网页 sessionId/请求 generation 失效旧请求，不只比较账号显示身份。
- [ ] **Step 2：写定位红灯。** 新通知先 get/read/resolve 再导航；read 失败不得跳。评论定位准确 comment ID；留言定位根或嵌套回复；resolved/orphaned 讨论仍展开但不执行 status mutation；target 消费后 refetch 不再次 scroll/focus；密码失败、重试、成功后保留定位片段。删除目标显示设计 §7 文案，非法片段不会 querySelector 任意选择器。
- [ ] **Step 3：运行红灯。** `pnpm --dir dashboard exec vitest run src/features/drive-browser/drive-discussion-notification-page.test.tsx src/features/drive-browser/use-drive-discussion-notification.test.tsx src/features/drive-browser/use-drive-discussion-location.test.tsx src/features/drive-browser/drive-messages-section.test.tsx vite.config.test.ts src/lib/dashboard-redirect.test.ts`。这是 Node/jsdom 单测，不运行 test:browser。
- [ ] **Step 4：实现集中路由与开页。** 从现有认证 route 提取 guard 到 require-dashboard-session，共用 beforeLoad，不在页面 useEffect 重复判断 token。新增根路径页面使用现有 Alert/加载/重试组件，所有请求由 hook 和 api.ts 管理；user-auth-form 的登录回跳同时识别原有 public/share 判定和新的严格 notification 判定，不把受保护通知路径归为公开分享。生产 nginx 为 `/notifications/` 承接 console SPA，Vite history fallback 同步该严格路径；不修改全站默认 location 或管理员鉴权。按现有流程生成 routeTree.gen.ts，不手写生成文件。
- [ ] **Step 5：实现一次性阅读器定位。** Shell 将经校验的 location 传到 Markdown/MDX 的现有评论和留言控制器，讨论展开与定位复用现有状态及 refs；为确切 comment ID 建受控 ref 映射，不从原文内容搜索。当前留言 API 已返回全部根留言和全部有效回复，无分页字段；利用返回全集定位，测试目标在第 100 个根留言及深层回复，不新增虚假分页 API。锚点失效可聚焦讨论卡片；renderer 切换或刷新不重复抢焦点，用户新导航取消旧请求。
- [ ] **Step 6：绿灯并提交。** 运行 Step 3 和上述既有阅读器测试、`pnpm --filter @synapse/dashboard run tsc`、`pnpm --filter @synapse/dashboard run check:drive-telemetry`、`pnpm --filter @synapse/dashboard run build`。新增遥测只使用稳定分类，不能带目标 ID、URL或内容。提交摘要：`feat: 文档互动通知支持登录承接和评论留言精确定位`。

## Task 6：桌面消息中心接入

**Files:** Modify `desktop/src/app-shell/components/message-center.tsx`、`desktop/src/app-shell/hooks/use-message-center.ts`、`desktop/src/types/notification-center.ts`。Test `desktop/src/app-shell/components/__tests__/message-center.test.tsx`、`desktop/src/app-shell/hooks/__tests__/use-message-center.test.tsx`、`desktop/electron/services/__tests__/account-service.test.ts`。

**Interfaces:** Consumes Task 1 metadata/action label/open URL builder、现有 `account.notifications.read({id})` 和 `shell.openExternal(url)`；不新增 IPC。浏览器目标最终由 Task 5 页端重取本人服务器记录决定，桌面不能根据缓存 targetId 直接拼文档路径。

- [ ] **Step 1：写交互红灯。** `discussion_actions_match_kind_and_action` 覆盖查看评论/留言/回复以及缺元数据时查看文档；`discussion_url_is_built_from_trusted_origin_and_id` 断言忽略缓存中伪造的外站 URL、仅使用部署 origin 和通知 ID；`identity_change_after_read_stops_open` 在 read pending 时换账号，断言不调用 shell。来源筛选与 unread/pending 交集、全部已读范围保持现有语义。
- [ ] **Step 2：运行红灯。** `pnpm --filter @synapse/desktop run test src/app-shell/components/__tests__/message-center.test.tsx src/app-shell/hooks/__tests__/use-message-center.test.tsx electron/services/__tests__/account-service.test.ts`。
- [ ] **Step 3：实现通知动作。** 查看正文沿用现有阅读区；drive-discussion 按部署 origin 构造 HTTPS open URL，走已读操作并在每次 await 后复验账号与当前导航意图，再通过 shell bridge 打开。失败保留摘要和必要错误提示，日志只记固定原因。新动作使用标准 Button；本机通知/静音设置和原生横幅保持现有路径。
- [ ] **Step 4：绿灯并提交。** 运行 Step 2、`pnpm --filter @synapse/desktop run typecheck`、`pnpm --filter @synapse/desktop run check:hard-constraints`。提交摘要：`feat: 桌面消息中心支持文档互动筛选和直达操作`。

## Task 7：手机通知列表与 APNs 统一打开

**Files:** Modify `SynapseMobile/SynapseMobile/Features/Inbox/NotificationStore.swift`、`NotificationDestination.swift`、`NotificationText.swift`、`NotificationView.swift`、`SynapseMobile/SynapseMobile/Features/Root/RootView.swift`。Test `SynapseMobile/SynapseMobileTests/NotificationDestinationTests.swift`、`NotificationDeepLinkTests.swift`、`NotificationStoreReadTests.swift`、`NotificationTextTests.swift`、`NotificationStoreMutationTests.swift`。

**Interfaces:** Add optional `DriveDiscussionNotificationMetadata: Decodable {kind: String; action: String}` to SynapseNotification，保留现有初始化方式并给新增 metadata 参数默认 nil，不令旧测试 fixture 构造失效；字段缺省/null 可解码，未知 kind/action 用查看文档回退。Consumes 既有 `.message(id: String)`、`SynapseAppModel.readNotification(_:) -> SynapseNotification?`、`NotificationDestination.resolve(_:)`、RootView.openNotification 和同源 WebLink。不新增 NotificationRouter destination 或原生登录客户端。

- [ ] **Step 1：写 Swift Testing 红灯。** `discussion_list_and_push_use_message_id_entry` 断言列表点击与推送都走 `.message(id)`，不从列表缓存直接打开；`fresh_read_controls_discussion_destination` 当前记录更新 URL/metadata 后只用新值；`read_failure_cancel_or_account_change_stops_navigation` 覆盖失败、取消和身份变化。`optional_metadata_keeps_legacy_payload_decodable` 及未知 kind/action 使用查看文档回退，不使整页解码失败。通知动作和来源文案逐字验证。
- [ ] **Step 2：编译红灯。** 运行公共 iOS build-for-testing 命令。新增接口/断言不匹配才是红灯，缺 SDK 或编译器不可用是环境缺口。未经授权不执行 Simulator 测试；Swift 测试运行留待真实原生验收授权。
- [ ] **Step 3：接通现有入口。** NotificationView 对 drive-discussion 同 todo-reminder 一样先路由 `.message(id)`；RootView 沿用本次 readNotification 返回记录、request UUID 和 account generation 判断。同源网页仍通过既有 WebLink/WKWebView 与 Console Cookie 查询/必要确认，不把原生 token 放 URL；打开动作不依赖选中电脑是否在线。
- [ ] **Step 4：构建验证并提交。** 重跑公共 build-for-testing；已获得原生测试授权时再按发现的 Simulator UDID 运行本任务五个测试 suite。未经授权的真实 iPhone/iPadOS、系统推送和网页验收明确列为未运行，不声称已覆盖。提交摘要：`feat: 手机评论留言通知复用推送入口直达具体讨论`。

## Task 8：真实事务验证、能力指南和交付检查

**Files:** Create `server/test/e2e-database-guard.mjs`、`drive-discussion-e2e-database-guard.mjs`、`drive-discussion-commit.e2e.spec.ts`、`drive-discussion-delivery-races.e2e.spec.ts`、`server/src/drive/drive-discussion-e2e-guard.spec.ts`。Modify `server/test/todos-e2e-database-guard.mjs`、`problem-feedback-e2e-database-guard.mjs`、`server/package.json`、`desktop/synapse-capabilities/shared/drive-domain.ts`、`desktop/synapse-capabilities/shared/drive-domain.test.ts`、`desktop/app-capabilities/account/shared/notification-mcp.ts`、`desktop/app-capabilities/synapse-skill/skill-package/drive/index.md`、`drive/api-reference.md`、`notifications/index.md`、`notifications/api-reference.md`、`docs/agents/module-boundaries.md`、`docs/agents/mobile-runtime-contracts.md`、`docs/agents/capability-registry.md`、`docs/superpowers/specs/2026-09-23-account-notification-center-design.md`、`docs/superpowers/specs/2026-06-21-drive-markdown-annotations-design.md`、`RELEASE_NOTES_PENDING.md`。

**Interfaces:** Shared test helper `requireLoopbackE2eDatabase(value: string|undefined, envName: string): string` 校验 PostgreSQL、loopback hostname、库名以 `_e2e` 结尾，不输出连接串。新 script `test:drive-discussion:e2e` 使用 `DRIVE_DISCUSSION_E2E_DATABASE_URL`，先 guard、构建已有 workspace 依赖，才向迁移和两个精确 e2e 测试子进程传 DATABASE_URL。已有两个领域 guard 包装共享函数，保持原安全条件与已有公开 helper 名，避免第三份重复校验。

- [ ] **Step 1：写并运行安全入口红灯。** 无变量、外网 host、非 PostgreSQL、非 `_e2e` 库名均拒绝，校验失败时不 spawn migrate/测试，不输出用户名密码。`pnpm --filter @synapse/server run test src/drive/drive-discussion-e2e-guard.spec.ts`。
- [ ] **Step 2：写真实 PostgreSQL 验收测试。** 使用唯一测试账号/文件 ID，只清理本 suite 自己创建的行，禁止无条件 deleteMany。`notification_failure_rolls_back_content` 断言故障后内容/通知/目标/outbox 均为零；`reply_delete_race_respects_commit_order` 测两种顺序；`same_event_keeps_one_record_per_user`、`old_lease_cannot_complete_after_new_claim`、`read_during_retry_stops_later_delivery` 断言实际事务结果而非 mock 锁调用。新旧 source 混合列表、统计、来源筛选和 API-key/desktop 冒充拒绝一并覆盖。
- [ ] **Step 3：实现安全脚本并运行 e2e。** `pnpm --filter @synapse/server run test:drive-discussion:e2e`，预期两个 suite 全部通过。没有独立测试库时报告验证缺口，绝不复用业务 DATABASE_URL、生产库或自动创建/清理现有数据库。
- [ ] **Step 4：同步指南与发布说明。** Drive 创建类 MCP description 明确服务端自动通知，工具名、数量、schema 和权限保持不变；通知列表 source schema 复用共享来源。Skill 指南提醒 Agent 不另发重复通知，说明摘要/链接和旧来源缺失的限制。能力表数量不变，补网页定位与通知来源例外；发布说明只写用户得到的评论/留言通知和直达行为，不写代码路径或把待运行验收冒充完成。
- [ ] **Step 5：运行最终充分验证。** 按下方公共命令运行涉及领域；已通过的同一检查不重复跑，除非本步又修改其覆盖范围。核对 diff、迁移无旧数据清理、共享输出、生产 route fallback、MCP 数量、通知源边界和所有未运行的原生验收。
- [ ] **Step 6：审阅和提交。** 根据用户选择的执行方式完成独立审查或阶段审查，修复可验证问题；只提交本任务代码、测试、指南和发布说明，不提交他人改动、不 push。提交摘要：`test: 验证云盘互动通知事务边界并同步使用指南`。最终报告实现范围、实际通过项及原生验收缺口。

## 公共验证命令

以下命令在实施阶段使用，本轮不运行产品测试或构建。

```bash
pnpm --filter @synapse/shared run test src/drive-discussion.test.ts src/notifications.test.ts
pnpm --filter @synapse/server run test src/drive/drive-discussion src/drive/drive-annotation.service.spec.ts src/drive/drive-message.service.spec.ts src/notifications
pnpm --filter @synapse/server run test:drive-discussion:e2e
pnpm --filter @synapse/server run typecheck
pnpm --dir dashboard exec vitest run src/features/drive-browser/drive-discussion-notification-page.test.tsx src/features/drive-browser/use-drive-discussion-notification.test.tsx src/features/drive-browser/use-drive-discussion-location.test.tsx src/features/drive-browser/drive-browser-page.test.tsx src/features/drive-browser/drive-comments-rail.test.tsx src/features/drive-browser/drive-messages-section.test.tsx src/features/drive-browser/renderers/markdown-renderer.test.tsx src/features/drive-browser/renderers/drive-document-editor-comments.test.tsx vite.config.test.ts src/lib/dashboard-redirect.test.ts
pnpm --filter @synapse/dashboard run tsc
pnpm --filter @synapse/dashboard run check:drive-telemetry
pnpm --filter @synapse/dashboard run build
pnpm --filter @synapse/desktop run test src/app-shell/components/__tests__/message-center.test.tsx src/app-shell/hooks/__tests__/use-message-center.test.tsx electron/services/__tests__/account-service.test.ts synapse-capabilities/shared/drive-domain.test.ts app-capabilities/account/main/__tests__/mcp-path.test.ts
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
xcodebuild build-for-testing -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath SynapseMobile/build/drive-discussion-tests CODE_SIGNING_ALLOWED=NO
```

原生测试只有用户授权后运行：先 `xcrun simctl list devices available` 取得真实 UDID，然后将下面的 `SIMULATOR_UDID` 设为该发现值；不猜设备名或 UDID。

```bash
xcodebuild test-without-building -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile -destination "platform=iOS Simulator,id=$SIMULATOR_UDID" -derivedDataPath SynapseMobile/build/drive-discussion-tests -only-testing:SynapseMobileTests/NotificationDestinationTests -only-testing:SynapseMobileTests/NotificationDeepLinkTests -only-testing:SynapseMobileTests/NotificationStoreReadTests -only-testing:SynapseMobileTests/NotificationTextTests -only-testing:SynapseMobileTests/NotificationStoreMutationTests
```

若实施没有触及打包结构，不要求重打 Electron 包；若改变运行时资源或打包边界，追加 `pnpm --filter @synapse/desktop run check:packaged-asar`，并记录正式包验证。部署按迁移/服务端 → 网页 → 桌面 → 手机执行，仍需明确发版/部署授权。

## 计划自审映射

| 设计要求 | 承接任务 |
| --- | --- |
| §1 范围与所有入口一致 | Task 2、8 |
| §2 收件人、去重、首评、自回复 | Task 2 |
| §3 八类文案、摘要、安全显示、渠道 | Task 1、2、6、7 |
| §4 职责、服务端来源和无注入循环 | Task 1、2、4 |
| §5 原子性、幂等、可靠投递和日志 | Task 2、3、8 |
| §6 原分享、历史来源缺失、登录及取消 | Task 1、4、5、6、7 |
| §7 具体评论、留言、已解决及失效锚点 | Task 5 |
| §8 MCP、Skill、规则及发布说明 | Task 8 |
| §9 数据库、跨端兼容和上线边界 | Task 8、公共验证命令 |

只有计划审阅通过并选定执行方式后开始实施。执行时再使用 using-git-worktrees 检查隔离需求；本轮仅提交设计状态和本计划。
