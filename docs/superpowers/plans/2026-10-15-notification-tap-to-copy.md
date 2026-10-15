# 通知点按复制（copyOnTap）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让发送方可以在通知上声明「这条的正文是拿来用的」，用户点一下手机上的通知横幅就把正文拿到剪贴板；桌面消息中心与 iOS 通知详情的「复制正文」对任何通知都可用。

**Architecture:** 一个可选布尔 `copyOnTap` 从发送侧（MCP / Workflow / 开放 API）贯穿到服务端 `UserNotification` 新列、APNs payload 根、再到 iOS 的 `didReceive` 点按处理；客户端的「复制正文」是各自界面上的独立入口，不读这个开关。

**Tech Stack:** NestJS + Prisma + PostgreSQL（服务端）、Electron + React 19 + TypeScript（桌面）、SwiftUI + swift-testing（iOS，`SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`）。

**Spec:** `docs/superpowers/specs/2026-10-15-notification-tap-to-copy-design.md`

## Global Constraints

- **上线顺序：服务端 → 桌面端 → iOS，不能乱。** 服务端 `desktopWriteSchema` 是 `.strict()`，旧服务端收到带 `copyOnTap` 的桌面请求会直接 400；反方向（旧 iOS 读新 payload）只多一个被忽略的键，安全。
- **能力版本不 bump。** 仍是 `app.system_notifier.notification.trigger@1.0.0`（`desktop/app-capabilities/system-notifier/shared/capability.ts:13`）。MCP 工具数仍为 1，Workflow 节点数仍为 1，Deep Link 与 Automation Action 无新增。
- **`copyOnTap` 只带 `true`。** `false` 与字段缺省在每个层面都是同一件事；任何一层写 `copyOnTap: false` 都是错的。
- **复制只含 `body`，不含 `title`。**
- **只接受布尔真值。** iOS 端 `userInfo["copyOnTap"]` 必须 `as? Bool == true` 才算数，字符串一律按假（避免 `"false"` 被当成真）。
- **开放 API 的 query 只认字面量 `1`。** 其余任何值一律按关处理，不报错——那条形状的全部价值就是「粘上去就能用」。
- **桌面原生横幅不加任何监听器。** System Notifier V1 设计明确 adapter 不安装 `show` / `click` / `close` / `reply` / `action`；这条边界本轮不动。
- **不新增依赖。** 不引入新的 npm / Swift 包。
- **不新建剪贴板封装。** 桌面 renderer 沿用现有 `navigator.clipboard.writeText` + `toast`；iOS 复用 `DesignSystem/Clipboard.swift` + `NoticeBar`。
- **生产代码禁止 `console.log` 当日志。**
- **iOS 详情页复制入口的形制（工具栏还是底部按钮）由 `apple-design` 引导阅读 Apple 官方原文后确定**，并同时核对 iPhone 与 iPadOS；本计划给出的写法只是可用起点。

## Review Focus

这五类输入或情况是 spec 隐含、但没有一条任务天然会去覆盖的，最容易在真机上咬人。每一类在下面都落到具体任务里的具体测试：

1. **点通知时 App 并不需要联网。** 用户点的是锁屏上的横幅，那一刻可能完全没有网络、也可能 App 刚被系统杀掉冷启动。复制必须已经发生，且「已复制正文」提示仍要出现——不能依赖回查接口的成败。（Task 6）
2. **带目标的通知被点按。** 终端待回复、站内信、待办这类通知点一下要去别的地方。`copyOnTap` 为真时也必须只复制、不改变路由；由通知上的动作按钮（「允许一次」「拒绝」）触发时则完全不该复制。（Task 6）
3. **`level: "passive"` 或发送开关关闭。** 这种通知手机上根本没有横幅可点，但 App 内详情页的「复制正文」仍然要在。（Task 1、Task 7）
4. **「复制正文」取到的是不是用户看到的那一段。** 站内信还在加载或读取失败时要有回退；云盘互动通知缺快照时要有回退。（Task 5、Task 7）
5. **新旧版本混跑。** 桌面新版本 + 旧服务端必须被 `.strict()` 挡在门外（所以服务端先上），而旧 iOS 收到多出的 payload 键必须照常工作。（Task 1、Task 3）

---

### Task 1: 服务端内部路径 — 落库与推送

**Files:**
- Modify: `server/prisma/schema.prisma`（`model UserNotification`，`url` 之后、`level` 之前插入一列）
- Create: `server/prisma/migrations/20261015120000_user_notification_copy_on_tap/migration.sql`
- Modify: `server/src/notifications/notification.controller.ts:51-61`
- Modify: `server/src/notifications/notification.service.ts`（`CreateNotificationInput`、`createInTransaction`、`create`、`deliverCommitted`）
- Modify: `server/src/mobile-live/mobile-push.service.ts:137-152`
- Test: `server/src/notifications/notification.service.spec.ts`、`server/src/notifications/notification.controller.spec.ts`、`server/src/mobile-live/mobile-push.service.spec.ts`

**Interfaces:**
- Produces: `CreateNotificationInput.copyOnTap?: boolean`；`MobilePushService.sendNotification(userId, push)` 的 `push` 多一个必填 `copyOnTap: boolean`；APNs payload 根上多一个布尔键 `copyOnTap`。
- Consumes: 无（本任务是链条的第一环）。

- [ ] **Step 1: 先写服务层失败测试**

在 `server/src/notifications/notification.service.spec.ts` 里，给夹具 `record` 加一列（这一行不改，TypeScript 会立刻报缺字段——那正是我们要的失败）：

```ts
const record: UserNotification = {
  id: "message-1", userId: "user-1", source: "external", sourceKey: "external:key:request",
  title: "部署完成", body: "已更新", group: null, url: null, copyOnTap: false, level: "active",
  targetId: null, deviceId: null, readAt: null, resolvedAt: null, deletedAt: null, createdAt,
}
```

在同一个 `describe` 里追加三个用例：

```ts
  it("writes copyOnTap through to storage", async () => {
    const { service, prisma } = harness()
    await service.create({ userId: "user-1", source: "system-notifier", title: "绕口令", body: "四是四", copyOnTap: true })
    expect(prisma.userNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ copyOnTap: true }),
    })
  })

  it("carries the stored flag into the phone push", async () => {
    const { service, prisma, push } = harness()
    prisma.userNotification.create.mockResolvedValueOnce({ ...record, source: "system-notifier", copyOnTap: true })
    await service.create({ userId: "user-1", source: "system-notifier", title: "绕口令", body: "四是四", copyOnTap: true })
    // 首次投递这条调用不带 signal，所以断言只有两个参数。
    expect(push.sendNotification).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ copyOnTap: true }),
    )
  })

  it("keeps a passive copyable message in the account without pushing it", async () => {
    const { service, prisma, push } = harness()
    prisma.userNotification.create.mockResolvedValueOnce({ ...record, source: "system-notifier", level: "passive", copyOnTap: true })
    await service.create({ userId: "user-1", source: "system-notifier", title: "绕口令", body: "四是四", copyOnTap: true })
    expect(prisma.userNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ copyOnTap: true }),
    })
    expect(push.sendNotification).not.toHaveBeenCalled()
  })

  it("forwards the stored flag when a retry redelivers the message", async () => {
    const { service, prisma, push } = harness()
    prisma.userNotification.findFirst.mockResolvedValueOnce({ ...record, source: "system-notifier", copyOnTap: true })
    await service.deliverCommitted("user-1", "message-1")
    // 重投这条走 record 而不是入参；补投递会把 signal 一起传下去，所以这里是三个参数。
    expect(push.sendNotification).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ copyOnTap: true }),
      undefined,
    )
  })
```

在 `server/src/notifications/notification.controller.spec.ts` 的 `describe("NotificationController", ...)` 里追加一个用例，钉住桌面写入形状只吃布尔：

```ts
  it("rejects a non-boolean copyOnTap on the desktop write path", async () => {
    const service = { create: vi.fn(async () => ({ id: "n1", createdAt: new Date("2026-10-15T08:00:00Z") })) }
    const endpoint = new NotificationController(service as never)
    const request = { user: { id: "writer" } }

    await endpoint.createFromDesktop(request as never, {
      source: "system-notifier", title: "标题", body: "正文", copyOnTap: true,
    })
    expect(service.create).toHaveBeenLastCalledWith(expect.objectContaining({ copyOnTap: true }))

    await expect(endpoint.createFromDesktop(request as never, {
      source: "system-notifier", title: "标题", body: "正文", copyOnTap: "true",
    })).rejects.toMatchObject({ status: 400 })
  })
```

在 `server/src/mobile-live/mobile-push.service.spec.ts` 里，给夹具与 `stubApns` 旁边加一个读 payload 的小工具，并追加一个用例：

```ts
/** 取最后一次发给 APNs 的 payload。`request.end` 是 `vi.fn`，参数就是 JSON 字符串。 */
function lastPayload(request: EventEmitter & Record<string, unknown>): Record<string, unknown> {
  const calls = (request.end as { mock: { calls: unknown[][] } }).mock.calls
  return JSON.parse(String(calls.at(-1)?.[0])) as Record<string, unknown>
}
```

```ts
const push = { title: "标题", body: "正文", level: "active" as const, group: null, id: "n1", copyOnTap: false }
```

```ts
  it("puts copyOnTap in the payload root so the phone can read it back", async () => {
    const { service } = makeService()
    const { request } = stubApns({ status: 200 })

    await service.sendNotification("user-1", { ...push, copyOnTap: true })

    const payload = lastPayload(request)
    expect(payload.copyOnTap).toBe(true)
    // 复制发生在 App 里，投递途中不改写内容，所以不需要 service extension。
    expect(payload.aps).not.toHaveProperty("mutable-content")
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @synapse/server exec vitest run src/notifications/notification.service.spec.ts src/notifications/notification.controller.spec.ts src/mobile-live/mobile-push.service.spec.ts`
Expected: FAIL —— `copyOnTap` 不在 `UserNotification` 类型上、`sendNotification` 的入参类型缺字段、`desktopWriteSchema` 会因 `.strict()` 把新键判成 400。

- [ ] **Step 3: 加列与迁移**

`server/prisma/schema.prisma` 的 `model UserNotification`，在 `url` 与 `level` 之间插入：

```prisma
  copyOnTap   Boolean   @default(false)
```

`server/prisma/migrations/20261015120000_user_notification_copy_on_tap/migration.sql`：

```sql
ALTER TABLE "UserNotification" ADD COLUMN "copyOnTap" BOOLEAN NOT NULL DEFAULT false;
```

> 只有一列带默认值的布尔，PostgreSQL 上不重写表。若部署前的迁移风险扫描仍然拦截，按既有流程核验生产库后用 `ALLOW_RISKY_MIGRATIONS=1` 放行，**不要**为了绕过检查改迁移形状。

- [ ] **Step 4: 服务端把字段接下来**

`server/src/notifications/notification.controller.ts` 的 `desktopWriteSchema` 增加一行：

```ts
const desktopWriteSchema = z.object({
  source: z.enum(DESKTOP_NOTIFICATION_SOURCES),
  sourceKey: z.string().min(8).max(160).optional(),
  title: z.string().trim().min(1).max(64),
  body: z.string().trim().min(1).max(512),
  // 链接与分组复用开放 API 的同一份 schema：同一条消息不该因为传参形状不同被区别对待。
  group: notificationGroupSchema.optional(),
  url: notificationUrlSchema.optional(),
  copyOnTap: z.boolean().optional(),
  targetId: z.string().min(1).max(120).optional(),
  deviceId: z.string().min(1).max(120).optional(),
}).strict()
```

`server/src/notifications/notification.service.ts`：

```ts
export type CreateNotificationInput = {
  userId: string
  source: NotificationSource
  sourceKey?: string
  title: string
  body: string
  group?: string
  url?: string
  copyOnTap?: boolean
  level?: NotificationLevel
  targetId?: string
  deviceId?: string
}
```

`createInTransaction` 的 `create` 与 `create` 的 `data` 各加一列（Prisma 收到 `undefined` 就用列默认值 `false`）：

```ts
      create: { userId: input.userId, source: input.source, sourceKey: input.sourceKey, title: input.title.slice(0, 64),
        body: input.body.slice(0, 512), group: input.group, url: input.url, copyOnTap: input.copyOnTap,
        level: input.level ?? "active", targetId: input.targetId, deviceId: input.deviceId },
```

```ts
          group: input.group,
          url: input.url,
          copyOnTap: input.copyOnTap,
          level: input.level ?? "active",
```

两处 `this.push.sendNotification(...)` 的入参加上 `copyOnTap`（`deliverCommitted` 与 `create` 里各一处，两处都从记录读，不读入参）：

```ts
    const outcome = await this.push.sendNotification(userId, { id: record.id, title: record.title, body: record.body, level: record.level as NotificationLevel, group: record.group, copyOnTap: record.copyOnTap }, signal)
```

```ts
        : this.push.sendNotification(input.userId, {
          id: record.id,
          title: record.title,
          body: record.body,
          level: record.level as NotificationLevel,
          group: record.group,
          copyOnTap: record.copyOnTap,
        })
```

`toNotificationProjection` 不用改：它 spread 整条记录，新列自动出现在列表与详情响应里。

- [ ] **Step 5: 推送 payload 带上开关**

`server/src/mobile-live/mobile-push.service.ts`：

```ts
  async sendNotification(userId: string, push: {
    id: string
    title: string
    body: string
    level: "active" | "passive" | "timeSensitive"
    group: string | null
    /** 用户在手机上点这条通知时，App 会把正文复制到剪贴板。 */
    copyOnTap: boolean
  }, signal?: AbortSignal): Promise<PushOutcome> {
    return this.sendToAllDevices(userId, {
      title: push.title,
      body: push.body,
      category: "SYNAPSE_NOTIFICATION",
      threadId: push.group ?? push.id,
      data: { notificationId: push.id, notificationLevel: push.level, copyOnTap: push.copyOnTap },
      level: push.level,
    }, signal)
  }
```

`terminalApprovalContent` / `meetingTranscriptionContent` 不动：那两类通知都带目标，点按去的是别处，复制不适用。

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm --filter @synapse/server exec vitest run src/notifications src/mobile-live`
Expected: PASS

- [ ] **Step 7: 类型检查与生成**

Run: `pnpm --filter @synapse/server exec prisma generate && pnpm --filter @synapse/server run typecheck`
Expected: 通过，无输出错误

- [ ] **Step 8: 提交**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20261015120000_user_notification_copy_on_tap/migration.sql server/src/notifications/notification.controller.ts server/src/notifications/notification.service.ts server/src/notifications/notification.service.spec.ts server/src/notifications/notification.controller.spec.ts server/src/mobile-live/mobile-push.service.ts server/src/mobile-live/mobile-push.service.spec.ts
git commit -m "feat: 通知落库与推送带上点按复制开关

服务端 UserNotification 增加 copyOnTap 列，桌面写入与开放 API 的请求体
都能带这个可选布尔；账号消息的 APNs payload 在根上多一个 copyOnTap，
供手机点按横幅时决定要不要把正文写进剪贴板。passive 通知照旧只入库不推送。"
```

---

### Task 2: 开放 API 三个形状都能表达这个开关

**Files:**
- Modify: `server/src/open-api/open-api-contract.ts:38-64`、`:294-313`
- Test: `server/src/notifications/notification.controller.spec.ts`、`server/src/open-api/open-api-contract.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `NotificationService.create` 接受 `copyOnTap?: boolean`。
- Produces: `openApiNotificationMessageSchema` 与 `openApiNotificationQuerySchema` 都能产出 `copyOnTap`；`GET /api/open/v1/notifications/{key}/{title}/{body}?copyOnTap=1` 生效。

- [ ] **Step 1: 先写失败测试**

在 `server/src/notifications/notification.controller.spec.ts` 的 `describe("OpenNotificationController", ...)` 里追加。

注意解构名：本文件的辅助函数就叫 `controller()`，所以**不能**写成 `const { controller } = controller()` —— 那个绑定在自身初始化式里处于 TDZ，一律抛 `ReferenceError`，与实现无关。照该文件既有写法把它重命名为 `endpoint`：

```ts
  it("sends copyOnTap through both request-body shapes", async () => {
    const { controller: endpoint, service, request } = controller()
    const message = { title: "标题", body: "正文", copyOnTap: true }

    // 整体式：密钥与消息在同一个请求体里。
    await endpoint.createWithKeyInBody(request as never, { ...message, key: exampleKey })
    expect(service.create).toHaveBeenLastCalledWith(expect.objectContaining({ copyOnTap: true }))

    // 表单式：密钥是 URL 段，消息来自请求体。
    await endpoint.createWithKeyInPath(request as never, message)
    expect(service.create).toHaveBeenLastCalledWith(expect.objectContaining({ copyOnTap: true }))
  })

  it("treats only a literal 1 in the path shape's query as copy-on-tap", async () => {
    const { controller: endpoint, service, request } = controller()
    const path = { key: exampleKey, title: "标题", body: "正文" }

    await endpoint.createFromPath(request as never, path, { copyOnTap: "1" })
    expect(service.create).toHaveBeenLastCalledWith(expect.objectContaining({ copyOnTap: true }))

    // 拼错、留空、重复成数组都按缺省处理：这条形状的价值是粘上去就能用，
    // 不该因为一个开关把整条链接判成无效。断言的是「没有 true」，不是「等于 false」——
    // 关掉与没写只有一个表示。
    for (const wrong of ["yes", "", "0", ["1", "0"]]) {
      await endpoint.createFromPath(request as never, path, { copyOnTap: wrong })
      const lastInput = service.create.mock.calls.at(-1)?.[0] as Record<string, unknown>
      expect(lastInput.copyOnTap).toBeUndefined()
    }
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @synapse/server exec vitest run src/notifications/notification.controller.spec.ts`
Expected: FAIL —— 第一个用例是 `copyOnTap: undefined`，第二个是 `false`（query 里那个键现在被忽略）。

- [ ] **Step 3: 扩展契约 schema**

`server/src/open-api/open-api-contract.ts`：

```ts
export const openApiNotificationMessageSchema = z.object({
  title: notificationTitleSchema,
  body: notificationBodySchema,
  group: notificationGroupSchema.optional(),
  url: notificationUrlSchema.optional(),
  level: notificationLevelSchema.default("active"),
  copyOnTap: z.boolean().optional(),
}).strict()
```

```ts
/**
 * 路径式放不下 JSON 体，开关只能走 query。
 *
 * 只认字面量 `1`：其余任何值（`0`、空串、拼错、重复出现变成数组）一律按关处理，**不报错**
 * —— 这条形状的全部价值就是「粘上去就能用」，不该为了一个开关把整条链接判成无效。
 * 所以用 `z.unknown()` 接住任何形状再自己比，而不是让类型校验在那里把请求打回。
 *
 * 转出来的是 `true | undefined` 而不是 `true | false`：全局约定是「任何一层都不写 `false`」，
 * 关掉与没写只能有一个表示，否则就多出一个能和数据默认值互相矛盾的位。
 */
const notificationCopyOnTapQuerySchema = z
  .unknown()
  .optional()
  .transform((value) => (value === "1" ? true : undefined))

export const openApiNotificationQuerySchema = z.object({
  group: notificationGroupSchema.optional(),
  url: notificationUrlSchema.optional(),
  level: notificationLevelSchema.default("active"),
  copyOnTap: notificationCopyOnTapQuerySchema,
})
```

在 `OPEN_API_NOTIFICATION_PATH_SEND_PATH` 的 `parameters` 里，`level` 之后加一条：

```ts
          { name: "copyOnTap", in: "query", required: false, description: "传 `1` 时，用户在手机上点这条通知即把正文复制到剪贴板。", schema: { type: "string", enum: ["1"] } },
```

`SendNotificationRequest` / `SendNotificationWithKeyRequest` 两个 JSON Schema 由 `toContractJsonSchema` 从 zod 生成，不需要手改。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @synapse/server exec vitest run src/notifications src/open-api`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/open-api/open-api-contract.ts server/src/notifications/notification.controller.spec.ts
git commit -m "feat: 开放 API 的三种通知发送形状支持点按复制

两个请求体形状接受可选 copyOnTap 布尔；密钥、标题、正文都在 URL 段的路径式
用 ?copyOnTap=1 表达，只认字面量 1，其余值按关处理而不把链接判成无效。"
```

---

### Task 3: 桌面 MCP 触发路径 — 校验与账号写入

**Files:**
- Modify: `desktop/app-capabilities/system-notifier/shared/schema.ts`
- Modify: `desktop/synapse-capabilities/shared/app-domain.ts:470-493`
- Modify: `desktop/app-capabilities/system-notifier/main/service.ts:101-115`
- Modify: `desktop/electron/services/account-service.ts:540-554`
- Test: `desktop/app-capabilities/system-notifier/shared/__tests__/schema.test.ts`、`desktop/app-capabilities/system-notifier/main/__tests__/service.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `POST /api/notifications/desktop` 接受 `copyOnTap`。
- Produces: `SystemNotificationInput.copyOnTap?: boolean`；`systemNotificationAccountWrite` 原样透出它；MCP 工具 schema 多一个可选 `copyOnTap`。

- [ ] **Step 1: 先写失败测试**

`desktop/app-capabilities/system-notifier/shared/__tests__/schema.test.ts` 追加：

```ts
  it("carries copyOnTap only when it is true", () => {
    const base = { title: "标题", body: "正文" }
    expect(validateSystemNotificationInput({ ...base, copyOnTap: true })).toEqual({
      ok: true,
      data: { title: "标题", body: "正文", copyOnTap: true },
    })
    // 关掉和没写是同一件事，留两种表示就多一个能互相矛盾的位。
    expect(validateSystemNotificationInput({ ...base, copyOnTap: false })).toEqual({ ok: true, data: base })
    expect(validateSystemNotificationInput(base)).toEqual({ ok: true, data: base })
  })

  it("rejects a non-boolean copyOnTap as the last field check", () => {
    expect(invalid({ title: "标题", body: "正文", copyOnTap: "true" })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      error: "Invalid system notification input.",
      data: { field: "copyOnTap", reason: "type" },
    })
  })
```

`desktop/app-capabilities/system-notifier/main/__tests__/service.test.ts` 追加（若该文件尚未导入 `systemNotificationAccountWrite`，一并补进 import）：

```ts
  it("passes copyOnTap through the account write", () => {
    expect(systemNotificationAccountWrite({ title: "标题", body: "正文", copyOnTap: true })).toEqual({
      source: "system-notifier",
      title: "标题",
      body: "正文",
      copyOnTap: true,
    })
    expect(systemNotificationAccountWrite({ title: "标题", body: "正文" })).toEqual({
      source: "system-notifier",
      title: "标题",
      body: "正文",
    })
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @synapse/desktop exec vitest run app-capabilities/system-notifier`
Expected: FAIL —— `copyOnTap` 现在是 `unknown_field`。

- [ ] **Step 3: 扩展校验器**

`desktop/app-capabilities/system-notifier/shared/schema.ts`：

```ts
export const SYSTEM_NOTIFICATION_INVALID_FIELDS = ["request", "title", "body", "url", "group", "copyOnTap"] as const
```

```ts
export interface SystemNotificationInput {
  readonly title: string
  readonly body: string
  readonly group?: string
  readonly url?: string
  /** 为真表示：用户点这条通知时把正文复制到剪贴板。缺省与 false 是同一件事。 */
  readonly copyOnTap?: boolean
}
```

```ts
const ACCEPTED_KEYS = new Set<string>(["title", "body", "url", "group", "copyOnTap"])
```

在 `validateSystemNotificationInput` 里 `group` 那一步之后、`return { ok: true, ... }` 之前插入：

```ts
  // 开关排在最后：它是一个布尔，不是内容，没有理由排在任何文本字段前面。
  if (request.copyOnTap !== undefined && typeof request.copyOnTap !== "boolean") {
    return invalid("copyOnTap", "type")
  }
```

并把成功分支的 `data` 改成：

```ts
    data: {
      title: request.title as string,
      body: request.body as string,
      ...(request.url !== undefined ? { url: request.url as string } : {}),
      ...(request.group !== undefined ? { group: request.group as string } : {}),
      ...(request.copyOnTap === true ? { copyOnTap: true as const } : {}),
    },
```

- [ ] **Step 4: 让映射函数透出它**

`desktop/app-capabilities/system-notifier/main/service.ts`：

```ts
export function systemNotificationAccountWrite(input: SystemNotificationInput): {
  readonly source: "system-notifier"
  readonly title: string
  readonly body: string
  readonly group?: string
  readonly url?: string
  readonly copyOnTap?: boolean
} {
  return {
    source: "system-notifier",
    title: input.title,
    body: input.body,
    ...(input.url !== undefined ? { url: input.url } : {}),
    ...(input.group !== undefined ? { group: input.group } : {}),
    ...(input.copyOnTap === true ? { copyOnTap: true } : {}),
  }
}
```

`desktop/electron/services/account-service.ts` 的 `createInternalNotification` 入参类型加一行：

```ts
  async createInternalNotification(input: {
    source: DesktopNotificationSource
    sourceKey?: string
    title: string
    body: string
    group?: string
    url?: string
    copyOnTap?: boolean
    targetId?: string
    deviceId?: string
  }): Promise<DesktopNotificationOutcome> {
```

- [ ] **Step 5: 工具 schema 与描述**

`desktop/synapse-capabilities/shared/app-domain.ts` 的工具 `description` 里，`url` 那句之后插入一句（描述是检索面，中文短语是索引材料，别省）：

```
Use it also when the text itself is what the user wants to take away — a passphrase, a command, a short piece to paste elsewhere: set copyOnTap and one tap on the phone's notification puts the body in their clipboard. Chinese intent: 复制给我, 写一段发我手机上.
```

`inputSchema.properties` 里 `group` 之后加：

```ts
          copyOnTap: {
            type: "boolean",
            description: "Set true when the body itself is what the user wants to take away: one tap on the phone's notification copies the body to the clipboard. The title is never copied. Defaults to false.",
          },
```

`required: ["title", "body"]` 与 `additionalProperties: false` 都不变。

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm --filter @synapse/desktop exec vitest run app-capabilities/system-notifier synapse-capabilities`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add desktop/app-capabilities/system-notifier/shared/schema.ts desktop/app-capabilities/system-notifier/shared/__tests__/schema.test.ts desktop/app-capabilities/system-notifier/main/service.ts desktop/app-capabilities/system-notifier/main/__tests__/service.test.ts desktop/synapse-capabilities/shared/app-domain.ts desktop/electron/services/account-service.ts
git commit -m "feat: 发送通知的 MCP 工具支持点按复制开关

System Notifier 的公开输入增加可选 copyOnTap；校验只放行布尔并在为真时才带出
这个键（关掉与没写是同一件事），账号写入映射函数原样透出，工具描述补上
「要的是那段文字本身」这一层意图词，便于按用户说法命中。"
```

---

### Task 4: Workflow 发送通知节点

**Files:**
- Modify: `desktop/app-capabilities/system-notifier/workflow-node/schema.ts`
- Modify: `desktop/app-capabilities/system-notifier/workflow-node/manifest.ts`
- Modify: `desktop/app-capabilities/system-notifier/workflow-node/executor.main.ts:18-22`
- Test: `desktop/app-capabilities/system-notifier/workflow-node/__tests__/executor.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `SystemNotificationInput.copyOnTap?: boolean` 与 `validateSystemNotificationInput`。
- Produces: 节点 config 多一个 `copyOnTap: boolean`；渲染侧由 `configFields` 声明式渲染，不需要改面板代码。

- [ ] **Step 1: 先写失败测试**

在 `desktop/app-capabilities/system-notifier/workflow-node/__tests__/executor.test.ts` 的既有 describe 里，用文件里已有的 `executionInput({ runtimeDeps })` 构造方式追加：

```ts
  it("asks for copy-on-tap only when the node config says so", async () => {
    const trigger = vi.fn().mockReturnValue({ success: true })
    const input = executionInput({
      config: { title: "标题", body: "正文", variables: [], copyOnTap: true },
      runtimeDeps: { resolveService: () => ({ trigger }) } as never,
    })

    await expect(systemNotifierNodeExecutor.execute(input)).resolves.toMatchObject({ status: "success" })

    expect(trigger).toHaveBeenCalledWith(
      expect.objectContaining({ copyOnTap: true }),
      expect.anything(),
    )
  })

  it("leaves copy-on-tap out entirely when the node config is off or absent", async () => {
    const trigger = vi.fn().mockReturnValue({ success: true })
    const input = executionInput({
      config: { title: "标题", body: "正文", variables: [], copyOnTap: false },
      runtimeDeps: { resolveService: () => ({ trigger }) } as never,
    })

    await expect(systemNotifierNodeExecutor.execute(input)).resolves.toMatchObject({ status: "success" })

    const [firstCall] = trigger.mock.calls
    expect(firstCall?.[0]).toEqual({ title: "标题", body: "正文" })
  })
```

第二个用例断言的是**整个入参对象相等**，不是 `not.objectContaining`：这样「关掉」与「没写」产出同一种形状这件事被真正钉住了，而不是只钉住「没有 true」。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @synapse/desktop exec vitest run app-capabilities/system-notifier/workflow-node`
Expected: FAIL —— `copyOnTap` 被 `.strict()` 的 config schema 拒掉。

- [ ] **Step 3: 节点 config 与面板字段**

`desktop/app-capabilities/system-notifier/workflow-node/schema.ts`：

```ts
export const systemNotifierNodeConfigSchema = z.object({
  title: z.string().refine((value) => value.length > 0, "通知标题必填"),
  body: z.string().refine((value) => value.length > 0, "通知正文必填"),
  variables: z.array(variableBindingSchema).default([]),
  // `.default(false)` 让旧工作流（config 里没有这个键）照常解析。
  copyOnTap: z.boolean().default(false),
}).strict()
```

`desktop/app-capabilities/system-notifier/workflow-node/manifest.ts`：

```ts
  defaultConfig: {
    title: "",
    body: "",
    variables: [],
    copyOnTap: false,
  },
```

```ts
  configFields: [
    { name: "title", kind: "text", label: "标题" },
    { name: "body", kind: "text", label: "正文" },
    { name: "copyOnTap", kind: "boolean", label: "点按复制正文" },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
  ],
```

- [ ] **Step 4: 执行器把它交给校验器**

`desktop/app-capabilities/system-notifier/workflow-node/executor.main.ts`：

```ts
      const interpolated = {
        title: interpolatePromptSafely(input.config.title, input.resolvedVariables),
        body: interpolatePromptSafely(input.config.body, input.resolvedVariables),
        // 它不是文本，没有插值可言，照 config 原样带过去。
        ...(input.config.copyOnTap ? { copyOnTap: true } : {}),
      }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @synapse/desktop exec vitest run app-capabilities/system-notifier workflow-nodes`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add desktop/app-capabilities/system-notifier/workflow-node/schema.ts desktop/app-capabilities/system-notifier/workflow-node/manifest.ts desktop/app-capabilities/system-notifier/workflow-node/executor.main.ts desktop/app-capabilities/system-notifier/workflow-node/__tests__/executor.test.ts
git commit -m "feat: 工作流的发送通知节点支持点按复制正文

节点 config 增加 copyOnTap 布尔（缺省 false，旧工作流照常解析），面板按
configFields 声明式渲染一个开关，执行器把它原样带进既有的输入校验。"
```

---

### Task 5: 桌面消息中心「复制正文」

**Files:**
- Create: `desktop/src/app-shell/notification-detail-text.ts`
- Create: `desktop/src/app-shell/__tests__/notification-detail-text.test.ts`
- Modify: `desktop/src/app-shell/components/message-center.tsx:48-50`、`:95-108`、`:140-142`
- Modify: `desktop/src/types/notification-center.ts`

**Interfaces:**
- Consumes: 无（不读 `copyOnTap`；任何通知的详情都能复制）。
- Produces: `notificationDetailText(item, mailBody)` 与 `discussionContentLabel(meta)`，供 `message-center.tsx` 使用。

- [ ] **Step 1: 先写失败测试**

**先把下面 Step 6 那一行类型补上再动手。** 本步的夹具构造的是完整的 `SynapseNotification`，而 `copyOnTap` 是必填列，所以不先加类型的话，下一步的「失败」会是一个 TS2741 类型错误，而不是我们要看的「模块不存在」。

`desktop/src/app-shell/__tests__/notification-detail-text.test.ts`：

```ts
import { describe, expect, it } from "vitest"
import { notificationDetailText } from "../notification-detail-text"
import type { SynapseNotification } from "@/types/notification-center"

function notification(overrides: Partial<SynapseNotification> = {}): SynapseNotification {
  return {
    id: "n1", source: "system-notifier", title: "标题", body: "正文",
    group: null, url: null, copyOnTap: false, level: "active",
    targetId: null, deviceId: null, readAt: null, resolvedAt: null,
    createdAt: "2026-10-15T08:00:00.000Z",
    ...overrides,
  }
}

describe("notificationDetailText", () => {
  it("copies the plain body", () => {
    expect(notificationDetailText(notification(), null)).toBe("正文")
  })

  it("copies the mail body once it has loaded", () => {
    const item = notification({ source: "mail", targetId: "m1" })
    expect(notificationDetailText(item, "来信正文")).toBe("来信正文")
  })

  it("falls back to the notification body when the mail has not loaded", () => {
    const item = notification({ source: "mail", targetId: "m1" })
    expect(notificationDetailText(item, null)).toBe("正文")
  })

  it("joins the discussion snapshot in the order the detail page shows it", () => {
    const item = notification({
      source: "drive-discussion",
      driveDiscussion: {
        kind: "annotation",
        action: "replied",
        snapshot: {
          detailTitle: "文档标题",
          content: "本次回复",
          original: { kind: "text", text: "原文" },
          replyTo: { authorName: "某人", content: "被回复的内容" },
        },
      },
    })
    expect(notificationDetailText(item, null)).toBe("评论原文\n原文\n\n回复对象 · 某人\n被回复的内容\n\n回复\n本次回复")
  })

  it("falls back to the body when the snapshot is missing", () => {
    const item = notification({ source: "drive-discussion", driveDiscussion: { kind: "annotation", action: "created" } })
    expect(notificationDetailText(item, null)).toBe("正文")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @synapse/desktop exec vitest run src/app-shell/__tests__/notification-detail-text.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 写这个纯函数模块**

`desktop/src/app-shell/notification-detail-text.ts`：

```ts
import type { DriveDiscussionNotificationMetadata } from "@synapse/shared"
import type { SynapseNotification } from "@/types/notification-center"

/** 文档互动通知正文区那一段的标题词。列表与详情共用同一个词。 */
export function discussionContentLabel(meta?: DriveDiscussionNotificationMetadata): string {
  return meta?.action === "replied" ? "回复" : meta?.kind === "message" ? "文末留言" : "评论"
}

/**
 * 「复制正文」到底复制哪一段。
 *
 * 取的是**详情页显示的那一份**，不是原始 `item.body`：按钮叫复制正文，用户复制到的就该是
 * 他看到的那一段。两处回退也照这个标准 —— 站内信还在加载或读取失败时，页面上显示的就是
 * 通知自带的摘要；云盘互动缺快照时，页面上显示的也是它。
 *
 * 提成纯函数是因为这条判断有三个分支加两处回退，而在组件里它只会是一行看不出边界的表达式。
 */
export function notificationDetailText(item: SynapseNotification, mailBody: string | null): string {
  if (item.source === "drive-discussion") {
    const snapshot = item.driveDiscussion?.snapshot
    if (!snapshot) return item.body
    const sections = [
      snapshot.original
        ? `${snapshot.original.kind === "image" ? "评论图片" : "评论原文"}\n${snapshot.original.text}`
        : null,
      snapshot.replyTo
        ? `回复对象 · ${snapshot.replyTo.authorName}\n${snapshot.replyTo.content || "无文本内容"}`
        : null,
      `${discussionContentLabel(item.driveDiscussion)}\n${snapshot.content || "无文本内容"}`,
    ]
    return sections.filter((section): section is string => section !== null).join("\n\n")
  }
  if (item.source === "mail" && item.targetId) return mailBody ?? item.body
  return item.body
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @synapse/desktop exec vitest run src/app-shell/__tests__/notification-detail-text.test.ts`
Expected: PASS

- [ ] **Step 5: 接进消息中心**

`desktop/src/app-shell/components/message-center.tsx`：

删掉本文件里 `discussionContentLabel` 的本地定义（第 48-50 行），改从新模块 import；并在文件顶部 import 区加上 `notificationDetailText`：

```ts
import { discussionContentLabel, notificationDetailText } from "@/app-shell/notification-detail-text"
```

在 `copyNotificationId` 下面加：

```ts
async function copyNotificationBody(item: SynapseNotification, mailBody: string | null) {
  try {
    await navigator.clipboard.writeText(notificationDetailText(item, mailBody))
    toast("正文已复制")
  } catch { toast.error("复制失败") }
}
```

`notificationActions` 变成（`copy-body` 排在「复制 ID」之前，且列表右键菜单共用这个数组，会自动一起获得）：

```ts
function notificationActions(center: Center, item: SynapseNotification, mailBody: string | null) {
  return [
    { id: "read", label: item.readAt ? "标记为未读" : "标记为已读", run: () => { void center.setRead(item, !item.readAt) } },
    { id: "copy-body", label: "复制正文", run: () => { void copyNotificationBody(item, mailBody) } },
    { id: "copy-id", label: "复制 ID", run: () => { void copyNotificationId(item) } },
    { id: "delete", label: "删除通知", destructive: true, run: () => center.remove(item) },
  ]
}
```

`MessageDetail` 里 `mail` 已经算好了，直接把它传进去（两处调用点：详情页的 `DropdownMenuContent` 与列表项的 `ContextMenuContent`；列表项没有 mail，传 `null`）：

```tsx
          {notificationActions(center, item, mail?.body ?? null).map((action) => <DropdownMenuItem key={action.id} variant={action.destructive ? "destructive" : "default"} onSelect={action.run}>{action.label}</DropdownMenuItem>)}
```

```tsx
                  </button></ContextMenuTrigger><ContextMenuContent>{notificationActions(center, item, null).map((action) => <ContextMenuItem key={action.id} variant={action.destructive ? "destructive" : "default"} onSelect={action.run}>{action.label}</ContextMenuItem>)}</ContextMenuContent></ContextMenu>
```

- [ ] **Step 6: DTO 镜像补上这一列**

`desktop/src/types/notification-center.ts` 的 `SynapseNotification`，在 `url` 之后加：

```ts
  readonly copyOnTap: boolean
```

（这是服务端 DTO 的逐字段镜像，与 `deviceId` 一样眼下没有消费方；加上它是为了让这份镜像保持完整，而不是留一个读不出来的缺口。）

- [ ] **Step 7: 跑测试与类型检查**

Run: `pnpm --filter @synapse/desktop exec vitest run src/app-shell && pnpm --filter @synapse/desktop run check:hard-constraints`
Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add desktop/src/app-shell/notification-detail-text.ts desktop/src/app-shell/__tests__/notification-detail-text.test.ts desktop/src/app-shell/components/message-center.tsx desktop/src/types/notification-center.ts
git commit -m "feat: 桌面消息中心详情增加复制正文

菜单里新增「复制正文」，排在复制 ID 之前，列表右键与详情下拉共用同一组操作。
复制的是详情页显示的那一份：站内信已加载时取原信正文、云盘互动取快照三段、
其余取通知正文，两处回退都照「所见即所得」。判断提成纯函数并有测试覆盖。"
```

---

### Task 6: iOS 点按通知即复制

**Files:**
- Create: `SynapseMobile/SynapseMobile/Core/Push/NotificationTapCopy.swift`
- Modify: `SynapseMobile/SynapseMobile/Core/Push/NotificationRouter.swift`
- Modify: `SynapseMobile/SynapseMobile/App/AppDelegate.swift:79-143`
- Modify: `SynapseMobile/SynapseMobile/Features/Root/RootView.swift:501-545`
- Test: `SynapseMobile/SynapseMobileTests/NotificationTapCopyTests.swift`

**Interfaces:**
- Consumes: Task 1 的 APNs payload 根上的 `copyOnTap`；`DesignSystem/Clipboard.swift` 的 `Clipboard.copy(_:)`。
- Produces: `NotificationTapCopy.body(from:contentBody:actionIdentifier:)`；`NotificationRouter.noteCopiedBody()` / `consumeCopiedBody()`。

- [ ] **Step 1: 先写失败测试**

`SynapseMobile/SynapseMobileTests/NotificationTapCopyTests.swift`：

```swift
import Foundation
import Testing
import UserNotifications

@testable import SynapseMobile

/// 点按复制这条路上唯一需要判断的东西：这一次点按要不要复制，复制什么。
///
/// 提出来测，是因为 delegate 那个方法跑在还没有 scene 的时刻，既难构造也难断言，
/// 而「字符串 `"false"` 算不算真」「动作按钮算不算点按」恰恰是最容易写错的两格。
@MainActor
struct NotificationTapCopyTests {
    @Test func copiesTheBodyOnAPlainTap() {
        let body = NotificationTapCopy.body(
            from: ["copyOnTap": true],
            contentBody: "四是四，十是十",
            actionIdentifier: UNNotificationDefaultActionIdentifier
        )
        #expect(body == "四是四，十是十")
    }

    @Test func ignoresAnythingButABooleanTrue() {
        for value in ["true", "1", "false", 1, 0] as [Any] {
            let body = NotificationTapCopy.body(
                from: ["copyOnTap": value],
                contentBody: "正文",
                actionIdentifier: UNNotificationDefaultActionIdentifier
            )
            #expect(body == nil, "copyOnTap = \(value) 不该被当成真")
        }
    }

    @Test func ignoresEverythingWhenTheFlagIsAbsentOrFalse() {
        #expect(NotificationTapCopy.body(from: [:], contentBody: "正文", actionIdentifier: UNNotificationDefaultActionIdentifier) == nil)
        #expect(NotificationTapCopy.body(from: ["copyOnTap": false], contentBody: "正文", actionIdentifier: UNNotificationDefaultActionIdentifier) == nil)
    }

    @Test func ignoresAnActionButton() {
        // 「允许一次」「拒绝」这类动作按钮不是「点开看看」，不该往剪贴板里塞东西。
        let body = NotificationTapCopy.body(
            from: ["copyOnTap": true],
            contentBody: "正文",
            actionIdentifier: "TERMINAL_APPROVE"
        )
        #expect(body == nil)
    }

    @Test func theCopiedNoticeIsConsumedExactlyOnce() {
        let router = NotificationRouter.shared
        router.discard()
        router.noteCopiedBody()
        #expect(router.consumeCopiedBody())
        #expect(!router.consumeCopiedBody())
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run:

```bash
xcodebuild test -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 15,OS=18.6' \
  -only-testing:SynapseMobileTests/NotificationTapCopyTests
```

Expected: FAIL —— `NotificationTapCopy` 与 `noteCopiedBody` 都不存在（编译不过）。

> 设备名用 `xcrun simctl list devices available` 里实际存在的那个。**选单个测试函数时 `-only-testing` 必须带括号**（`SynapseMobileTests/NotificationTapCopyTests/copiesTheBodyOnAPlainTap()`），不带括号会静默跑 0 个用例而结果是绿的。

- [ ] **Step 3: 写判断函数**

`SynapseMobile/SynapseMobile/Core/Push/NotificationTapCopy.swift`：

```swift
import Foundation
import UserNotifications

/// 一条通知被点按时要不要复制正文，以及复制什么。
///
/// 只有两件事能让它成立：这是一次**普通点按**（不是锁屏上那个动作按钮），并且服务端在
/// payload 根上带了 `copyOnTap: true`。开关只认布尔真值 —— `as? Bool` 对字符串一律返回
/// nil，正好挡住 `"false"` 被当成真的那类错误。
enum NotificationTapCopy {
    static func body(
        from userInfo: [AnyHashable: Any],
        contentBody: String,
        actionIdentifier: String
    ) -> String? {
        guard actionIdentifier == UNNotificationDefaultActionIdentifier else { return nil }
        guard userInfo["copyOnTap"] as? Bool == true else { return nil }
        return contentBody
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2
Expected: PASS

- [ ] **Step 5: 一次性提示的停放位**

`SynapseMobile/SynapseMobile/Core/Push/NotificationRouter.swift`，在 `pending` 旁边加一个同级的一次性标记（复制发生在 `AppDelegate` 里，那里拿不到 `SynapseAppModel`，说不了提示）：

```swift
    /// Non-nil until the UI consumes it.
    var pending: Destination?

    /// 这条通知被点开时已经把正文复制进剪贴板了，等界面有能力说话时补一句提示。
    ///
    /// 与 `pending` 同一个道理：复制那一刻可能还没有 scene，而提示只能由界面来说。
    private var copiedBody = false
```

```swift
    func noteCopiedBody() {
        copiedBody = true
    }

    func consumeCopiedBody() -> Bool {
        defer { copiedBody = false }
        return copiedBody
    }
```

`discard()` 里一并清掉（上一个账号点开的那条通知不该在下一个人登录后冒出一句提示）：

```swift
    func discard() {
        pending = nil
        copiedBody = false
    }
```

- [ ] **Step 6: AppDelegate 里复制，路由一个字不改**

`SynapseMobile/SynapseMobile/App/AppDelegate.swift` 的 `didReceive`，在 `let info = response.notification.request.content.userInfo` 之后、`notificationId` 那一段**之前**插入：

```swift
        // 复制要排在路由前面，而且只读推送里那一段正文：用户点的是锁屏上的横幅，
        // 那一刻可能完全没有网络、App 也可能刚被系统杀掉，回查正文的成败不该决定
        // 这段文字到不到得了他的剪贴板。
        if let copied = NotificationTapCopy.body(
            from: info,
            contentBody: response.notification.request.content.body,
            actionIdentifier: response.actionIdentifier
        ) {
            Clipboard.copy(copied)
            NotificationRouter.shared.noteCopiedBody()
        }
```

其余每一行都不动：`notificationId` 照旧 `.message(id:)`，`meetingId` 与终端会话照旧。

- [ ] **Step 7: RootView 把提示说出来**

`RootView` 已经有唯一一处消费去向的地方：`.task` 在冷启动时**无条件**调一次 `handleRoute(NotificationRouter.shared.consume())`（可能带目标，也可能是 `nil`），`.onChange(of: NotificationRouter.shared.pending)` 负责热启动那一路。所以把提示的消费放进 `handleRoute` 就够了——冷启动那条路一定会经过它，而带 `copyOnTap` 的通知（`system-notifier` 与开放 API 的 `external`）一定带 `notificationId`，热启动那一路也一定调得到它。

`SynapseMobile/SynapseMobile/Features/Root/RootView.swift` 的 `handleRoute`，改成：

```swift
    private func handleRoute(_ destination: NotificationRouter.Destination?) {
        // 复制在 AppDelegate 里已经发生，这里只负责把提示说出来。用 defer 是因为它同时
        // 覆盖「有目标可去」和「没什么可去」两条路 —— 没有目标不等于没复制过。
        let copiedBody = NotificationRouter.shared.consumeCopiedBody()
        defer { if copiedBody { model.notice("已复制正文", tone: .success) } }

        guard let destination else { return }
        beginNavigationRequest()
        switch destination {
        // …（以下分支一个字不改）
        }
    }
```

- [ ] **Step 8: 跑测试确认通过**

Run: 同 Step 2 的命令（换成整个 `SynapseMobileTests` 亦可）
Expected: PASS

> 若这一轮出现意外的红，先单独跑该用例再查 diff：`AppConfigurationTests` 与 `SessionRestoreTests` 会抢同一个全局，可能一红一绿，也可能卡死整轮。不要为它改产品代码。

- [ ] **Step 9: 提交**

```bash
git add SynapseMobile/SynapseMobile/Core/Push/NotificationTapCopy.swift SynapseMobile/SynapseMobile/Core/Push/NotificationRouter.swift SynapseMobile/SynapseMobile/App/AppDelegate.swift SynapseMobile/SynapseMobile/Features/Root/RootView.swift SynapseMobile/SynapseMobileTests/NotificationTapCopyTests.swift
git commit -m "feat: 手机上点通知横幅即把正文复制到剪贴板

点按判定提成 NotificationTapCopy：只认普通点按与布尔真值，动作按钮和字符串
一律不复制。复制在 AppDelegate 里同步完成，不依赖回查，冷启动与离线同样有效；
「已复制正文」由 NotificationRouter 的一次性标记带到界面上再说。"
```

---

### Task 7: iOS 通知详情页的复制入口

**Files:**
- Create: `SynapseMobile/SynapseMobile/Features/Inbox/NotificationDetailText.swift`
- Create: `SynapseMobile/SynapseMobileTests/NotificationDetailTextTests.swift`
- Modify: `SynapseMobile/SynapseMobile/Features/Inbox/NotificationView.swift:97-99`、`:159-199`
- Modify: `SynapseMobile/SynapseMobile/Features/Inbox/NotificationStore.swift:45-68`

**Interfaces:**
- Consumes: `DesignSystem/Clipboard.swift` 的 `Clipboard.copy(_:saying:on:)`、`App/NoticeBar` 的提示条、`NotificationText.discussionContentLabel(_:)`。
- Produces: `NotificationDetailText.value(for:)`；详情页一个「复制正文」入口；`SynapseNotification.copyOnTap: Bool?` 字段。

- [ ] **Step 1: 先写失败测试**

`SynapseMobile/SynapseMobileTests/NotificationDetailTextTests.swift`：

```swift
import Foundation
import Testing

@testable import SynapseMobile

/// 「复制正文」取的是不是用户看到的那一段。
///
/// 与桌面同一条标准：详情页上摊开成什么样，复制到的就是什么样。云盘互动那条通知在页面上
/// 是三段，复制成摘要就会和用户读到的话对不上。
@MainActor
struct NotificationDetailTextTests {
    private func notification(
        source: String = "system-notifier",
        body: String = "正文",
        driveDiscussion: DriveDiscussionNotificationMetadata? = nil
    ) -> SynapseNotification {
        SynapseNotification(
            id: "n1", source: source, title: "标题", body: body, group: nil, url: nil,
            level: "active", targetId: nil, deviceId: nil, readAt: nil, resolvedAt: nil,
            createdAt: "2026-10-15T08:00:00.000Z", driveDiscussion: driveDiscussion
        )
    }

    @Test func copiesThePlainBody() {
        #expect(NotificationDetailText.value(for: notification()) == "正文")
    }

    @Test func joinsTheDiscussionSnapshotInTheOrderThePageShowsIt() {
        let item = notification(
            source: "drive-discussion",
            driveDiscussion: DriveDiscussionNotificationMetadata(
                kind: "annotation",
                action: "replied",
                snapshot: .init(detailTitle: "文档标题", content: "本次回复", original: .init(kind: "text", text: "原文"), replyTo: .init(authorName: "某人", content: "被回复的内容"))
            )
        )
        #expect(NotificationDetailText.value(for: item) == "评论原文\n原文\n\n回复对象 · 某人\n被回复的内容\n\n回复\n本次回复")
    }

    @Test func fallsBackToTheBodyWhenTheSnapshotIsMissing() {
        let item = notification(source: "drive-discussion", driveDiscussion: DriveDiscussionNotificationMetadata(kind: "annotation", action: "created"))
        #expect(NotificationDetailText.value(for: item) == "正文")
    }
}
```

`s DriveDiscussionNotificationSnapshot` 目前只有 `Decodable`，测试需要直接构造它——照 `DriveDiscussionNotificationMetadata` 已有的写法给它补一个显式 `init(detailTitle:content:original:replyTo:)`（字段与 `CodingKeys` 都不动）。

- [ ] **Step 2: 跑测试确认失败**

Run:

```bash
xcodebuild test -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 15,OS=18.6' \
  -only-testing:SynapseMobileTests/NotificationDetailTextTests
```

Expected: FAIL —— `NotificationDetailText` 不存在。

- [ ] **Step 3: 写这个纯函数**

`SynapseMobile/SynapseMobile/Features/Inbox/NotificationDetailText.swift`：

```swift
import Foundation

/// 「复制正文」在手机上复制哪一段。
///
/// 与桌面同一条标准：取**详情页显示的那一份**，不是原始 `body`。云盘互动那条通知在详情页上
/// 摊开成三段（评论原文 / 回复对象 / 本次内容），照 `body` 复制给出去的是摘要，和用户读到的
/// 不是同一段话。
enum NotificationDetailText {
    static func value(for item: SynapseNotification) -> String {
        guard item.source == "drive-discussion", let snapshot = item.driveDiscussion?.snapshot else {
            return item.body
        }
        var sections: [String] = []
        if let original = snapshot.original {
            sections.append("\(original.kind == "image" ? "评论图片" : "评论原文")\n\(original.text)")
        }
        if let reply = snapshot.replyTo {
            sections.append("回复对象 · \(reply.authorName)\n\(reply.content.isEmpty ? "无文本内容" : reply.content)")
        }
        sections.append("\(NotificationText.discussionContentLabel(item))\n\(snapshot.content.isEmpty ? "无文本内容" : snapshot.content)")
        return sections.joined(separator: "\n\n")
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2
Expected: PASS

- [ ] **Step 5: DTO 镜像补上这一列**

`SynapseMobile/SynapseMobile/Features/Inbox/NotificationStore.swift` 的 `SynapseNotification`：

```swift
struct SynapseNotification: Decodable, Identifiable {
    let id: String
    let source: String
    let title: String
    let body: String
    let group: String?
    let url: String?
    let copyOnTap: Bool?
    let level: String
    let targetId: String?
    let deviceId: String?
    let readAt: String?
    let resolvedAt: String?
    let createdAt: String
    let driveDiscussion: DriveDiscussionNotificationMetadata?

    init(id: String, source: String, title: String, body: String, group: String?, url: String?, copyOnTap: Bool? = nil,
         level: String, targetId: String?, deviceId: String?, readAt: String?, resolvedAt: String?, createdAt: String,
         driveDiscussion: DriveDiscussionNotificationMetadata? = nil) {
        self.id = id; self.source = source; self.title = title; self.body = body
        self.group = group; self.url = url; self.copyOnTap = copyOnTap; self.level = level
        self.targetId = targetId; self.deviceId = deviceId; self.readAt = readAt
        self.resolvedAt = resolvedAt; self.createdAt = createdAt; self.driveDiscussion = driveDiscussion
    }
}
```

必须是 `Bool?` 而不是 `Bool`：它是自动合成的 `Decodable` 的一格，非可选时少这个键会让**整页通知解码失败**，而这个字段眼下没有任何消费方 —— 为它冒整页打不开的险不值。默认值 `nil` 让既有调用点一行都不用改。

- [ ] **Step 6: 给详情页加复制入口**

先按 `apple-design` 读通知详情这类页面的官方依据，定下入口形制（工具栏按钮还是底部按钮、用哪种符号、标签文案），再落到 `NotificationView.swift`。下面是可用起点：`NotificationFullTextView` 目前只拿到 `item` 与 `onOpen`，需要再拿一个 `model`。

`NotificationView.swift:97-99` 的构造点改成：

```swift
                if let item = readingNotification {
                    NotificationFullTextView(item: item, onOpen: open, model: model)
                }
```

`NotificationFullTextView`（`:159-199`）加参数与工具栏：

```swift
private struct NotificationFullTextView: View {
    let item: SynapseNotification
    let onOpen: (SynapseNotification) -> Void
    let model: SynapseAppModel

    var body: some View {
        ScrollView {
            // …（内容一字不改）
        }
        .navigationTitle("通知")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("复制正文") {
                    Clipboard.copy(NotificationDetailText.value(for: item), saying: "已复制正文", on: model)
                }
            }
        }
    }
}
```

`Clipboard.copy(_:saying:on:)` 已经自带触感与提示条（`DesignSystem/Clipboard.swift`），这里不新造实现。

- [ ] **Step 7: 构建确认编译通过**

Run:

```bash
xcodebuild build -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 15,OS=18.6'
```

Expected: BUILD SUCCEEDED

- [ ] **Step 8: 提交**

```bash
git add SynapseMobile/SynapseMobile/Features/Inbox/NotificationDetailText.swift SynapseMobile/SynapseMobile/Features/Inbox/NotificationView.swift SynapseMobile/SynapseMobile/Features/Inbox/NotificationStore.swift SynapseMobile/SynapseMobileTests/NotificationDetailTextTests.swift
git commit -m "feat: 手机通知详情页可以复制正文

详情页增加「复制正文」，复用 DesignSystem 的剪贴板写入与提示条；复制的是页面上
显示的那一段（云盘互动通知取快照三段，其余取正文），与桌面同一条标准。通知 DTO
补上 copyOnTap 这一格（可选，眼下无消费方），避免少键时整页通知解码失败。"
```

---

### Task 8: 技能包与规则文档

**Files:**
- Modify: `desktop/app-capabilities/synapse-skill/skill-package/app/index.md:161-187`
- Modify: `desktop/app-capabilities/synapse-skill/skill-package/app/api-reference.md:253-274`
- Modify: `desktop/app-capabilities/synapse-skill/skill-package/SKILL.md:54`
- Modify: `desktop/app-capabilities/synapse-skill/skill-package/workflow/index.md:278`
- Modify: `desktop/app-capabilities/synapse-skill/skill-package/workflow/api-reference.md:171`
- Modify: `desktop/docs/workflow-mcp-guide.md:220-251`
- Modify: `desktop/app-capabilities/synapse-skill/skill-package/notifications/index.md`、`notifications/api-reference.md`
- Modify: `docs/agents/capability-registry.md:74-78`
- Modify: `docs/agents/module-boundaries.md`（开放 API 段）
- Modify: `docs/superpowers/specs/2026-09-23-account-notification-center-design.md:35`
- Modify: `RELEASE_NOTES_PENDING.md`

**Interfaces:**
- Consumes: Task 3 / Task 4 / Task 5 / Task 7 的实际行为与字段名。
- Produces: 无代码接口。

- [ ] **Step 1: 发送侧技能文档**

`skill-package/app/index.md` 的 System Notifier 段，在讲 `url` 那一段之后另起一段：

```md
When the text itself is what the user wants to take away — a tongue twister, a passphrase, a command to paste elsewhere — put that text in `body` and set `copyOnTap: true`. One tap on the phone's notification then puts `body` into the clipboard, so the user does not have to open the app and select it by hand. `title` is only a label and is never copied. The body limit stays 256 Unicode code points, so something longer needs a `url` instead.
```

同段的 `Rules` 列表里，把「Do not add any field beyond `title`, `body`, `url`, and `group`」改成：

```md
- Do not add any field beyond `title`, `body`, `url`, `group`, and `copyOnTap`.
```

`skill-package/app/api-reference.md` 的入参列表加一行，并更新错误字段清单：

```md
- `copyOnTap` optional: boolean, defaults to false. When true, a plain tap on the phone's notification copies `body` to the clipboard. The title is never copied, and an action button on the notification never copies. Only the boolean `true` counts.
```

```md
Invalid input returns `INVALID_INPUT` with only `data.field` (`request`, `title`, `body`, `url`, `group`, or `copyOnTap`) and `data.reason` (…)
```

`skill-package/SKILL.md:54` 那一句旁边补一句同样的用法（它已经把 `url` 交给手机的做法写在这里，`copyOnTap` 属于同一类）。

- [ ] **Step 2: 工作流侧技能文档**

`skill-package/workflow/index.md:278`、`skill-package/workflow/api-reference.md:171`、`desktop/docs/workflow-mcp-guide.md:220-251` 三处节点说明各补一句：节点 config 多一个 `copyOnTap` 布尔，语义与 MCP 入参相同，`title` 不会被复制。

- [ ] **Step 3: 读取侧技能文档**

`skill-package/notifications/index.md` 与 `notifications/api-reference.md` 各加一句，并把它与既有的「复制引用」区分开：

```md
通知详情里可以「复制正文」，拿到的是页面上显示的那一段文字；这与复制 `synapse:notification:<id>` 引用是两件事 —— 引用是给 Agent 用来定位这条通知的，正文是给用户拿去用的。
```

- [ ] **Step 4: 规则文档**

`docs/agents/capability-registry.md` 在 System Notifier 的条目后追加一条带日期的说明（照该文件既有写法）：

```md
- System Notifier 的触发工具 2026-10-15 起增加可选 `copyOnTap`（布尔，缺省 false）：为真时用户在手机上点这条通知即把正文复制到剪贴板。桌面端另在消息中心详情提供「复制正文」，iOS 端在通知详情提供同一入口，两者对任何通知都可用、不读这个开关。开放 API 的两个请求体形状接受同名布尔，路径式用 `?copyOnTap=1`（只认字面量 `1`）。**MCP 工具数不变（仍 1）**，Workflow 节点仍为 1，Automation Action 与 Deep Link 无新增，三张表的注册数量都不动；能力版本仍为 `1.0.0`。
```

`docs/agents/module-boundaries.md` 的开放 API 段：把「不支持…复制动作…」改成只列仍然不支持的项，并写明现在支持的是哪一种复制。

`docs/superpowers/specs/2026-09-23-account-notification-center-design.md:35`：那句不支持清单里删掉「复制动作」，并加一条带日期的修订说明，指明只放开了「点按复制正文」一项，图片、铃声、重要警告、持续响铃、推送加密、自定义 TTL、多服务器与 Bark URL 兼容继续不支持；权威设计见 `2026-10-15-notification-tap-to-copy-design.md`。

- [ ] **Step 5: 发布说明**

`RELEASE_NOTES_PENDING.md` 追加一条面向用户的说明（说「得到什么」，不写路径与实现）：

```md
- 通知现在可以点一下就复制正文。对方发来一段文字，你在手机上点一下通知就拿到了它，不用打开应用手动选中。
```

- [ ] **Step 6: 提交**

```bash
git add desktop/app-capabilities/synapse-skill/skill-package desktop/docs/workflow-mcp-guide.md docs/agents/capability-registry.md docs/agents/module-boundaries.md docs/superpowers/specs/2026-09-23-account-notification-center-design.md RELEASE_NOTES_PENDING.md
git commit -m "docs: 技能与规则同步通知的点按复制能力

Synapse Skill 的发送侧说明什么时候该设 copyOnTap、读取侧说明详情页的复制正文
与复制引用的区别；能力清单、开放 API 边界与账号消息中心设计里「不支持复制动作」
那条一并修订，发布说明补一条面向用户的说明。"
```

---

### Task 9: 端到端验收

**Files:** 无（只跑验证，不改代码）

**Interfaces:**
- Consumes: Task 1–8 的全部产出。
- Produces: 一份可复述的验收结论。

- [ ] **Step 1: 服务端与共享包**

Run:

```bash
pnpm --filter @synapse/shared run build && pnpm --filter @synapse/server run typecheck && pnpm --filter @synapse/server run test
```

Expected: 全绿

- [ ] **Step 2: 桌面端**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints && pnpm --filter @synapse/desktop run test
```

Expected: 全绿

- [ ] **Step 3: 模拟器上验手机这条链**

模拟器**收不到真实的 APNs 横幅**（服务端长期固定走生产网关，模拟器拿到的是沙箱 token），所以这里用 `simctl push` 把一条和真实推送同形状的 payload 投进去。

先用生产环境起桌面端（手机与电脑登同一个账号，通知必须落在同一个服务端上）：

```bash
pnpm dev:desktop:prod
```

然后调 `app_system_notifier_notification_trigger` 发一条 `{ title: "绕口令", body: "<正文>", copyOnTap: true }`，在桌面消息中心里用「复制 ID」拿到那条通知的 `synapse:notification:<id>`，取出 `<id>`。

先 `open -a Simulator` 并保持窗口开着。把下面的 payload 存成 `/tmp/tap-to-copy.json`（把 `<id>` 换成刚拿到的那一个）：

```json
{
  "aps": {
    "alert": { "title": "绕口令", "body": "四是四，十是十，十四是十四，四十是四十。" },
    "sound": "default",
    "category": "SYNAPSE_NOTIFICATION"
  },
  "copyOnTap": true,
  "notificationId": "<id>",
  "notificationLevel": "active"
}
```

```bash
xcrun simctl push <device-udid> com.liy.SynapseMobile /tmp/tap-to-copy.json
```

在模拟器里点那条横幅，然后：

- 到任意输入框粘贴，粘出来的应当是**正文**，不是标题；
- 顶部出现一次「已复制正文」；
- 应用落到那条通知的详情页（`notificationId` 用的是真实 id，所以不该出现「无法打开这条通知」）。

Expected: 三条都对

- [ ] **Step 4: 装到手机验真实横幅**

桌面端保持在生产环境（`pnpm dev:desktop:prod`；手机连的是生产，桌面若连本地服务端，这条通知根本不会推到手机上）。

Run: `pnpm mobile:install`

装好后让服务端推一条带 `copyOnTap: true` 的通知，在手机上点横幅，同样粘贴确认。这一步是唯一能验到「真实推送 + 真实横幅」的地方，模拟器验过也要走这一遍。

- [ ] **Step 5: 回归两条老行为**

- 不带 `copyOnTap` 的通知点开：剪贴板**不变**，没有「已复制正文」提示。
- 终端待回复通知：点横幅照旧进对应会话；长按用「允许一次」/「拒绝」照旧工作，且不会写剪贴板。
