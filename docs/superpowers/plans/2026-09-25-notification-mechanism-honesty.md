# 通知机制的三处「名不副实」修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让通知链路的三个契约说真话——「没发出去」不再无声无息、「桌面写入入口」的名字与授权边界一致、设置字段名与它实际门控的东西一致。

**Architecture:** 三处改动互不依赖，各自落地：结果类型进 `@synapse/shared`（服务端运行时引用、桌面只引用类型），服务端把「本次没有发出」记成固定诊断；写入路由新增 `/api/notifications/desktop` 并保留旧路径作已发布构建的兼容入口，`source` 枚举由 shared 单一来源派生；设置升 v3，把 `enabled` / `syncToAccount` 改名成 `localEnabled` / `sendEnabled`，走已有的 v1→v2 迁移与 revive 链。

**Tech Stack:** TypeScript、NestJS + Prisma（server）、Electron 主进程 + zod（desktop）、vitest（两侧）、DataRepository JSON 命名空间迁移。

**Spec:** `docs/superpowers/specs/2026-07-23-system-notifier-v1-design.md`（权威规格）、`docs/superpowers/specs/2026-09-23-account-notification-center-design.md`、`docs/agents/module-boundaries.md`

## Global Constraints

- 用户可见行为不变：开关标签仍是「发送通知 / 本机通知 / 静音通知」，MCP 与 Workflow 的成功响应仍是固定 `{ success: true }`；本次三处修正都不改变调用契约。
- 公开输入仍是精确的 `{ title, body }`，不加字段。
- `{ success: true }` 不新增任何「已发送 / 已送达」含义；本次只补**本地诊断**，不把发送结果回给调用方。
- 生产代码禁止 `console.log`；诊断只走 `SystemNotifierService` 的固定 stage / reason + 聚合计数，绝不带正文、错误原文或身份键。
- 迁移函数必须幂等，只向前。
- 路由改名必须保留 `/api/notifications/internal`，已发布的桌面构建仍在用它。
- 每个任务跑完：`cd desktop && npx vitest run <受影响路径>`、`npx tsc -p tsconfig.electron.json --noEmit`、`npx tsc -p tsconfig.test.json --noEmit`；服务端任务跑 `cd server && npx vitest run src/notifications`。
- 提交只带本次任务的文件，显式列路径，不用 `-A`（另一个 Agent 在同一分支上工作）。

---

### Task 1: 共享的桌面通知来源与结果类型

**Files:**
- Create: `shared/src/notifications.ts`
- Modify: `shared/src/index.ts`（加一条再导出）

**Interfaces:**
- Consumes: 无
- Produces:
  - `DESKTOP_NOTIFICATION_SOURCES: readonly ["system-notifier", "terminal-complete"]`
  - `type DesktopNotificationSource = "system-notifier" | "terminal-complete"`
  - `type DesktopNotificationOutcome = "sent" | "not_signed_in" | "offline"`

- [ ] **Step 1: 写文件**

```ts
/**
 * 桌面端自己发起的账号通知。
 *
 * 这张表是**唯一来源**：服务端的写入校验、桌面端的请求入参都从它派生，两侧不可能各写一份
 * 而互相漂移。它同时是授权边界——只列出桌面合法拥有的 source，服务端自有来源（外部开放
 * API、终端待处理、录音转写）不在其中，桌面不得冒充。
 */
export const DESKTOP_NOTIFICATION_SOURCES = ["system-notifier", "terminal-complete"] as const

export type DesktopNotificationSource = (typeof DESKTOP_NOTIFICATION_SOURCES)[number]

/**
 * 一次桌面写入的结果。请求失败不在这里——它表现为抛错。
 *
 * `sent` 只表示服务端接受了这条消息，不表示任何设备已经显示它。
 */
export type DesktopNotificationOutcome = "sent" | "not_signed_in" | "offline"
```

- [ ] **Step 2: 在 `shared/src/index.ts` 里再导出**

照该文件现有风格加一段 `export { ... } from "./notifications"` 与 `export type { ... } from "./notifications"`。

- [ ] **Step 3: 跑 shared 自己的测试与构建**

Run: `cd shared && pnpm run test`
Expected: 全绿；`package-entrypoint.test.ts` 若对导出面有断言，按它的报错补上新增导出。

- [ ] **Step 4: 提交**

```bash
git add shared/src/notifications.ts shared/src/index.ts
git commit -m "feat: 桌面通知的来源与结果类型进 shared 单一来源"
```

---

### Task 2: 桌面把「发没发出去」分成三种结果

**Files:**
- Modify: `desktop/electron/services/account-service.ts:478-494`
- Test: `desktop/electron/services/__tests__/account-service.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `DesktopNotificationSource`、`DesktopNotificationOutcome`
- Produces: `AccountService.createInternalNotification(input): Promise<DesktopNotificationOutcome>`

- [ ] **Step 1: 写失败测试**

在 `account-service.test.ts` 里加：

```ts
it("reports why a desktop notification was not written", async () => {
  const service = createAccountService() // 沿用文件里既有的夹具
  await expect(service.createInternalNotification({ source: "system-notifier", title: "标题", body: "正文" }))
    .resolves.toBe("not_signed_in")

  await service.applyState({ status: "authenticated", connectivity: "offline", profile: profileFixture })
  await expect(service.createInternalNotification({ source: "system-notifier", title: "标题", body: "正文" }))
    .resolves.toBe("offline")
})
```

（夹具名以文件现状为准：沿用文件里已有的账号状态构造方式；`profileFixture` 用现有的假资料。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run electron/services/__tests__/account-service.test.ts`
Expected: FAIL —— 现在返回 `undefined`。

- [ ] **Step 3: 改实现**

```ts
/**
 * 把一条消息写进账号消息中心。
 *
 * 返回它**为什么没写进去**，好让调用方留下可查的痕迹：未登录与离线都不发，请求本身失败时
 * 抛错。`sent` 只表示服务端接受了这条消息。
 */
async createInternalNotification(input: {
  source: DesktopNotificationSource
  sourceKey?: string
  title: string
  body: string
  targetId?: string
  deviceId?: string
}): Promise<DesktopNotificationOutcome> {
  if (this.state.status !== "authenticated") return "not_signed_in"
  if (this.state.connectivity !== "online") return "offline"
  await this.requestAuthenticatedJson<{ id: string }>("POST", `${apiBaseUrl()}/notifications/internal`, input, "通知同步失败。")
  return "sent"
}
```

类型从 `@synapse/shared` 以 `import type ... with { "resolution-mode": "import" }` 引入（主进程既有写法，见 `drive-dispatcher.ts`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npx vitest run electron/services/__tests__/account-service.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add desktop/electron/services/account-service.ts desktop/electron/services/__tests__/account-service.test.ts
git commit -m "feat: 桌面写入账号通知时区分未登录与离线"
```

---

### Task 3: 每一次没发出去的调用都留下固定诊断

**Files:**
- Modify: `desktop/app-capabilities/system-notifier/main/service.ts:127-148`
- Test: `desktop/app-capabilities/system-notifier/main/__tests__/service.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `createInternalNotification` 返回值；`SystemNotifierServicePorts.sync` 类型改为 `(input) => Promise<DesktopNotificationOutcome>`
- Produces: 固定诊断 `notification_sync` × {`disabled`, `settings_unavailable`, `not_signed_in`, `offline`, `sync_failed`}

- [ ] **Step 1: 写失败测试**

```ts
it("records one fixed diagnostic for every accepted call that sent nothing", async () => {
  const settings = settingsNamespace({ ...enabledSettings, sendEnabled: false })
  const logs = logger()
  const service = new SystemNotifierService(logs)
  await service.initialize({ settings: settings.port, adapter: { kind: "electron", show: vi.fn() } })
  service.trigger(input, context)
  expect(logs.warn).toHaveBeenCalledWith("System notifier diagnostic summary.", {
    stage: "notification_sync", reason: "disabled", count: 1,
  })
})

it("names the two ways the platform could not send", async () => {
  const settings = settingsNamespace({ ...enabledSettings })
  const logs = logger()
  const service = new SystemNotifierService(logs)
  await service.initialize({
    settings: settings.port,
    auditSink: { record: vi.fn() } as never,
    adapter: { kind: "electron", show: vi.fn() },
    sync: async () => "offline",
  })
  service.trigger(input, context)
  await flush()
  expect(logs.warn).toHaveBeenCalledWith("System notifier diagnostic summary.", {
    stage: "notification_sync", reason: "offline", count: 1,
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run app-capabilities/system-notifier/main/__tests__/service.test.ts`
Expected: FAIL —— 现在这两种情况什么都不记。

- [ ] **Step 3: 改实现**

```ts
trigger(input, context) {
  this.recordAudit(input, context)
  const settings = this.snapshot
  if (!settings) {
    this.diagnostics.record("notification_sync", "settings_unavailable")
    return { success: true }
  }
  if (!settings.sendEnabled) {
    this.diagnostics.record("notification_sync", "disabled")
    return { success: true }
  }
  if (!this.limiter.acquire(context.identityKey)) {
    this.diagnostics.record("rate_limit", "suppressed")
    return { success: true }
  }
  void this.sendToAccount(input)
  return { success: true }
}

private async sendToAccount(input: SystemNotificationInput): Promise<void> {
  if (!this.sync) return
  try {
    const outcome = await this.sync(input)
    if (outcome !== "sent") this.diagnostics.record("notification_sync", outcome)
  } catch {
    this.diagnostics.record("notification_sync", "sync_failed")
  }
}
```

`SystemNotifierLogReason` 增加 `"disabled" | "settings_unavailable" | "not_signed_in" | "offline"`，并更新一切 `settings.syncToAccount` 引用（本任务先改字段名引用为 `sendEnabled` **仅在 Task 5 落地后**生效——因此本任务继续用 `syncToAccount`，字段改名在 Task 5 一次性完成）。

- [ ] **Step 4: 跑测试确认通过，并跑整个能力包**

Run: `cd desktop && npx vitest run app-capabilities/system-notifier`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add desktop/app-capabilities/system-notifier/main/service.ts desktop/app-capabilities/system-notifier/main/__tests__/service.test.ts
git commit -m "feat: 通知没发出去时留下可查的固定诊断"
```

---

### Task 4: 桌面写入入口按授权改名

**Files:**
- Modify: `server/src/notifications/notification.controller.ts:46-68`
- Modify: `server/src/notifications/notification.controller.spec.ts`
- Modify: `desktop/electron/services/account-service.ts`（路径换成 `/notifications/desktop`）
- Modify: `desktop/electron/bootstrap/descriptors.ts:864-872`（`source` 用 shared 类型）

**Interfaces:**
- Consumes: Task 1 的 `DESKTOP_NOTIFICATION_SOURCES`
- Produces: 路由 `POST /api/notifications/desktop`（主）与 `POST /api/notifications/internal`（兼容）

- [ ] **Step 1: 写失败测试**

```ts
describe("desktop notification write", () => {
  it("accepts the desktop-owned sources on both the current and the legacy path", async () => {
    for (const source of ["system-notifier", "terminal-complete"]) {
      const { controller: endpoint, service } = desktopController()
      await expect(endpoint.createFromDesktop(request, { source, title: "标题", body: "正文" }))
        .resolves.toEqual({ id: "message-1" })
      expect(service.create.mock.calls[0]?.[0]).toMatchObject({ source, userId: "user-1" })
    }
  })

  it("refuses sources the desktop does not own", async () => {
    const { controller: endpoint } = desktopController()
    await expect(endpoint.createFromDesktop(request, { source: "external", title: "标题", body: "正文" }))
      .rejects.toThrow()
  })
})
```

再补一条断言两个 `@Post` 路径都在 `PATH_METADATA` 里（`Reflect.getMetadata("path", NotificationController.prototype.createFromDesktop)` 等于 `["desktop", "internal"]`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run src/notifications`
Expected: FAIL —— `createFromDesktop` 不存在。

- [ ] **Step 3: 改实现**

```ts
const desktopWriteSchema = z.object({
  source: z.enum(DESKTOP_NOTIFICATION_SOURCES),
  sourceKey: z.string().min(8).max(160).optional(),
  title: z.string().trim().min(1).max(64),
  body: z.string().trim().min(1).max(512),
  targetId: z.string().min(1).max(120).optional(),
  deviceId: z.string().min(1).max(120).optional(),
}).strict()

/**
 * 桌面端写自己账号的队列。
 *
 * 路径 `/desktop` 说的是授权范围：这条入口只接受桌面登录态，且只接受桌面自己拥有的 source
 * （见 shared 的 `DESKTOP_NOTIFICATION_SOURCES`）。`/internal` 是它从前叫的名字，已发布的
 * 桌面构建仍在用，保留为兼容入口；两者行为完全一致。
 */
@Post(["desktop", "internal"])
async createFromDesktop(@Req() request: AuthedRequest, @Body() body: unknown) {
  const parsed = desktopWriteSchema.safeParse(body)
  if (!parsed.success) throw badRequestFromZodError(parsed.error, "通知参数无效。")
  const item = await this.notifications.create({ ...parsed.data, userId: request.user.id })
  return { id: item.id }
}
```

服务端从 `@synapse/shared` 引入 `DESKTOP_NOTIFICATION_SOURCES`（该文件已运行时引用 `@synapse/shared`）。桌面侧把 URL 换成 `/notifications/desktop`。

- [ ] **Step 4: 跑两侧测试**

Run: `cd server && npx vitest run src/notifications` 与 `cd desktop && npx vitest run electron/services/__tests__/account-service.test.ts electron/bootstrap/__tests__/descriptors.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/src/notifications/notification.controller.ts server/src/notifications/notification.controller.spec.ts desktop/electron/services/account-service.ts desktop/electron/bootstrap/descriptors.ts
git commit -m "refactor: 桌面写入入口改名 /desktop，旧路径留作兼容"
```

---

### Task 5: 设置字段改 v3，让名字对上它门控的东西

**Files:**
- Modify: `desktop/app-capabilities/system-notifier/shared/schema.ts`
- Modify: `desktop/electron/runtime/data-repo/schemas/system-notifier.ts`
- Modify: `desktop/electron/runtime/data-repo/schemas/index.ts`、`desktop/electron/runtime/data-repo/index.ts`（导出名 V2 → V3）
- Modify: `desktop/electron/bootstrap/descriptors.ts`（命名空间泛型）
- Modify: `desktop/app-capabilities/system-notifier/main/service.ts`（读字段与补丁键）
- Modify: `desktop/app-capabilities/system-notifier/renderer/index.tsx` 与它的测试
- Test: `desktop/electron/runtime/data-repo/__tests__/system-notifier-schema.test.ts`、`desktop/electron/runtime/data-repo/__tests__/schemas.test.ts`、`desktop/app-capabilities/system-notifier/main/__tests__/service.test.ts`、`desktop/app-capabilities/system-notifier/main/__tests__/ipc.test.ts`

**Interfaces:**
- Produces: `{ schemaVersion: 3, sendEnabled: boolean, localEnabled: boolean, silent: boolean }`

- [ ] **Step 1: 写失败测试**

在 `system-notifier-schema.test.ts` 里加：

```ts
it("revives a v2 singleton into the v3 field names", async () => {
  await expect(readSingleton(
    { schemaVersion: 2, enabled: false, silent: true, syncToAccount: true },
    2,
  )).resolves.toEqual({ schemaVersion: 3, sendEnabled: true, localEnabled: false, silent: true })
})

it("revives a v1 singleton straight into v3", async () => {
  await expect(readSingleton({ schemaVersion: 1, enabled: true, silent: false }, 1))
    .resolves.toEqual({ schemaVersion: 3, sendEnabled: true, localEnabled: true, silent: false })
  await expect(readSingleton({ schemaVersion: 1, enabled: false, silent: false }, 1))
    .resolves.toEqual({ schemaVersion: 3, sendEnabled: false, localEnabled: false, silent: false })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npx vitest run electron/runtime/data-repo/__tests__/system-notifier-schema.test.ts`
Expected: FAIL —— 现在最高只到 v2。

- [ ] **Step 3: 改实现**

`shared/schema.ts`：`schemaVersion` 改 `z.literal(3)`，字段改 `sendEnabled` / `localEnabled` / `silent`，patch schema 与默认值同步，文档注释写明「`sendEnabled` 是发送总闸，`localEnabled` / `silent` 描述这台电脑收到账号消息时的呈现」。

`data-repo/schemas/system-notifier.ts`：`SystemNotifierSettingsEntryV3`；迁移链加 `2 → 3`：

```ts
function migrateSystemNotifierSettingsEntryV2ToV3(data: V2): V3 {
  return {
    schemaVersion: 3,
    sendEnabled: data.syncToAccount,
    localEnabled: data.enabled,
    silent: data.silent,
  }
}
```

revive 链按 v3 直通、v2 → 3、v1 → 2 → 3 三段写，与 `sound-notifier.ts` 的多段 revive 同形。

- [ ] **Step 4: 改名到全部引用点**

`settings.syncToAccount` → `settings.sendEnabled`、`settings.enabled` → `settings.localEnabled`；IPC patch 键同步；renderer 三颗开关的 `checked` 与 `onCheckedChange` 跟着改（**标签文案不动**）。`schemas.test.ts` 里的最小合法记录同步到 v3。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd desktop && npx vitest run electron/runtime/data-repo app-capabilities/system-notifier`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add desktop/app-capabilities/system-notifier desktop/electron/runtime/data-repo desktop/electron/bootstrap/descriptors.ts
git commit -m "refactor: 通知设置升 v3，字段名与门控对象对齐"
```

---

### Task 6: 规格、能力清单与发布说明同步

**Files:**
- Modify: `docs/superpowers/specs/2026-07-23-system-notifier-v1-design.md`
- Modify: `docs/superpowers/specs/2026-09-23-account-notification-center-design.md`
- Modify: `docs/agents/module-boundaries.md`
- Modify: `docs/agents/capability-registry.md`
- Modify: `desktop/app-capabilities/synapse-skill/skill-package/app/index.md`、`app/api-reference.md`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: 规格补第三次修订块，写清三件事**

- 每次「已接受但没有发出」的调用记一条 `notification_sync` 固定诊断，reason ∈ {`disabled`, `settings_unavailable`, `not_signed_in`, `offline`, `sync_failed`}；成功响应仍不因此改变。
- 写入入口新名字 `/api/notifications/desktop`，`/internal` 是已发布构建的兼容入口；`source` 由 shared 单一来源派生。
- 设置 v3 字段名与其门控对象的对应关系，以及 v2 → v3 的迁移规则。

- [ ] **Step 2: 其余文档同步**

- `module-boundaries.md` §Notifier：补「写入入口只接受桌面自有的 source，不得冒充服务端自有来源」「设置字段名即其门控对象」。
- `capability-registry.md`：把「发送通知 / 本机通知」的说明换成新字段名口径（注册表面与数量不变）。
- Skill 指南：`app/index.md` 与 `app/api-reference.md` 补一句「发送失败不会回给调用方，只留本地诊断」。
- `RELEASE_NOTES_PENDING.md`：诊断与字段改名都不是用户可感知变化 → **不加新条目**，只把现有条目里提到的开关名核对一遍。

- [ ] **Step 3: 提交**

```bash
git add docs/agents docs/superpowers/specs desktop/app-capabilities/synapse-skill RELEASE_NOTES_PENDING.md
git commit -m "docs: 通知写入入口、诊断与设置字段名的规格同步"
```

---

## Rollout

服务端改动是纯增量（新路径 + 旧的照用），因此**先部服务端再发桌面**最稳；反过来也不会坏，只是新桌面在服务端更新前调用 `/desktop` 会 404，此时正好落一条 `notification_sync / sync_failed` 诊断——这是本次改动的第一个收益。

## Self-Review

- **Spec coverage**：三处不合理各有任务——#1 成功与实际脱钩 → Task 1/2/3；#2 写入接口名不副实 → Task 4；#3 设置字段名不贴语义 → Task 5；文档 → Task 6。无遗漏。
- **Placeholder scan**：无 TBD；每个代码步骤都给了可落地的签名与关键实现；测试给了断言内容，夹具名以文件现状为准（已注明）。
- **Type consistency**：`DesktopNotificationSource` / `DesktopNotificationOutcome` 由 Task 1 定义，Task 2 用作返回值、Task 3 用作端口类型、Task 4 用作服务端 enum 来源，命名一致；Task 5 的字段名 `sendEnabled` / `localEnabled` / `silent` 在 schema、迁移、service、renderer 四处同名。
