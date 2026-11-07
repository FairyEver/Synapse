# 用户自定义网页应用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户把任意 HTTP(S) 网页保存为账号级自定义应用，在 Synapse 主窗口、独立窗口和账号同步 Dock 中像内置应用一样使用。

**Architecture:** 云端保存应用记录、图标、最小删除墓碑和带 revision 的完整 Dock 布局；桌面主进程负责认证请求、账号级缓存、幂等写入和原生 `WebContentsView`。所有自定义应用共用按电脑持久化的 Chromium session，renderer 只提供应用壳层、创建管理 UI 和网页视图占位。

**Tech Stack:** Electron 44.9.3、React 19、TypeScript 6、Prisma/PostgreSQL、NestJS、Zod、shadcn/Radix、Vitest、DataRepository、ServiceRegistry、IpcRegistry、EventBus。

**Spec:** `docs/superpowers/specs/2026-11-07-custom-web-apps-design.md`

## Global Constraints

- 自定义应用只支持 `kind = "web"` 和绝对 `http:` / `https:` URL。
- 应用名称 trim 后必须有 1 到 64 个 Unicode code point；URL 最长 2048 字符，不允许 URL 内嵌用户名或密码。
- 每个账号最多 100 个有效自定义应用。
- 每个自定义应用最多同时存在 5 个网页弹窗。
- 图标由桌面主进程归一化为 128×128 PNG，最大 128 KiB；服务端再次校验并只接受 PNG。
- 删除应用写入最小墓碑 `userId + appId + deletedAt`，墓碑保留到账号删除；业务行和图标引用硬删除。
- 幂等操作记录保留 7 天；删除墓碑不随该清理任务删除。
- 所有自定义应用和网页弹窗共用 `persist:synapse-custom-web`，不随 Synapse 账号切换清除。
- 网页内容不加载 preload，不允许 Node integration，必须启用 sandbox、context isolation 和 webSecurity。
- 网页权限按 allowlist：只允许 `mediaKeySystem`，其余 permission、fullscreen 和 device permission 全部拒绝。
- 顶栏只显示后退、前进、刷新、在浏览器打开，不显示地址栏。
- 每次全新应用实例或独立窗口都从起始 URL 开始；同一运行内切走再返回保留当前页面和历史。
- 应用配置与完整 Dock 布局按同一 Synapse 账号跨设备同步；网页 Cookie 只按电脑保存。
- 断线、认证失效、旧服务端或非法云端数据时缓存应用只读，离线写入一律不支持。
- 自定义应用不是 System App，不增加 MCP、Workflow、Automation、Deep Link 或移动端入口。
- 使用现有 shadcn/Radix 组件和主题 token；不硬编码颜色，不新增依赖。
- 主进程敏感操作使用 PermissionGuard/AuditSink；Renderer 只通过窄类型化 preload bridge 访问能力。
- 日志和审计不得记录完整 URL、Cookie、图标字节或网页标题。
- 每个任务完成前运行本任务列出的专项测试；最终再运行完整 shared/server/desktop 测试、typecheck 和 hard constraints。
- 用户要求不推送；每个任务只创建本地提交。

## Review Focus

- 云端删除正在运行或已固定的应用时，应用视图、独立窗口、Dock 和编辑表单都必须同步消失，不能出现幽灵入口或未处理异常。
- 原生 `WebContentsView` 在窗口缩放、Dock/顶栏变化、应用切换，以及 Dialog、菜单、Popover 展开时必须被正确约束或隐藏，不能遮住 Synapse UI。
- Account A 的缓存、迟到请求、live revision 和视图不得泄漏给 Account B；登录失效后自定义应用关闭，但内置应用仍可使用。
- 并发创建、修改、删除、Dock 移动和响应丢失必须保持幂等；删除优先，旧设备不能复活墓碑，旧 Dock 快照不能覆盖新布局。
- OAuth/`window.open` 必须保留 opener 与共享 Cookie，同时非法协议、权限请求、非 HTTP(S) 导航和弹窗轰炸必须被拒绝。

---

### Task 1: Shared Contracts And App Catalog

**Files:**
- Create: `shared/src/custom-apps.ts`
- Create: `shared/src/custom-apps.test.ts`
- Modify: `shared/src/index.ts`
- Modify: `shared/src/live.ts`
- Modify: `shared/src/live.test.ts`
- Modify: `desktop/src/modules/apps/types.ts`
- Modify: `desktop/src/modules/apps/dock.ts`
- Test: `desktop/src/modules/apps/__tests__/dock.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `SYSTEM_APP_IDS`, `SynapseSystemAppId`, `CustomAppId`, `SynapseAppId`, `CustomAppCreateInput`, `CustomAppUpdateInput`, `CustomAppDockAction`, `CustomAppDockOperation`, `CustomAppsChangedPayload`, `DEFAULT_DOCK_APP_IDS`, `DOCK_CATALOG_VERSION`, `CUSTOM_APPS_API_PATHS`, `customAppIdSchema`, `customAppCreateInputSchema`, `customAppUpdateInputSchema`, `customAppDockActionSchema`, `customAppDockOperationSchema`, `parseCustomAppUrl(value)`, `normalizeCustomAppDockIds(values, knownCustomIds)`, and `applyCustomAppDockAction(values, action, knownCustomIds)`.

- [ ] **Step 1: Write failing shared contract tests**

```ts
expect(customAppIdSchema.parse("cwa_123e4567-e89b-42d3-a456-426614174000"))
  .toBe("cwa_123e4567-e89b-42d3-a456-426614174000")
expect(parseCustomAppUrl("javascript:alert(1)")).toBeNull()
expect(parseCustomAppUrl("https://user:pass@example.com")).toBeNull()
expect(parseCustomAppUrl("https://example.com/app?a=1")).toBe("https://example.com/app?a=1")
const appId = "cwa_123e4567-e89b-42d3-a456-426614174000"
expect(normalizeCustomAppDockIds(
  [appId, "ghost", appId, "agent"],
  new Set([appId]),
)).toEqual([appId, "agent", "launcher"])
expect(applyCustomAppDockAction(
  ["agent", "launcher"],
  { type: "pin", appId },
  new Set([appId]),
)).toEqual(["agent", appId, "launcher"])
expect(customAppSnapshotSchema.safeParse({
  schemaVersion: 1,
  revision: 1,
  initialized: true,
  dockCatalogVersion: 1,
  apps: [{ ...customAppDtoFixture(), kind: "future-kind" }],
  dockAppIds: ["launcher"],
  dockMigrationIds: [],
}).success).toBe(true)
expect(LIVE_MESSAGE_TYPES.customAppsChanged).toBe("custom-apps.changed")
```

- [ ] **Step 2: Run the shared tests and verify they fail**

Run: `pnpm --filter @synapse/shared exec vitest run src/custom-apps.test.ts src/live.test.ts`

Expected: FAIL because the custom app contract and live message type do not exist.

- [ ] **Step 3: Implement the shared contracts**

Define the IDs, schemas, DTOs, exact API paths, URL parser, Dock normalization/reducer, default Dock order, catalog version, and `customAppsChanged` live envelope union. `SynapseAppId` is the union of `SynapseSystemAppId | CustomAppId`. Snapshot/app schemas accept unknown future `kind` strings; renderer only projects known `web` apps and preserves unknown Dock IDs without rendering them. `CustomAppDockAction` contains the user intent; `CustomAppDockOperation` adds the client-generated `operationId`. Move the canonical `SYSTEM_APP_IDS` literal into `shared/src/custom-apps.ts`; keep `desktop/src/modules/apps/types.ts` as a typed re-export. Derive `DEFAULT_DOCK_APP_IDS` from the shared catalog in `desktop/src/modules/apps/dock.ts`.

The Dock reducer must never write a display-filtered list back to the server. `pin` inserts before `launcher`; `unpin` ignores `launcher`; `move` uses `beforeAppId: string | null`; `restore-default` returns `DEFAULT_DOCK_APP_IDS`; `apply-migrations` stores each migration ID once and applies its move/insert operations atomically.

- [ ] **Step 4: Run the shared and Dock tests**

Run: `pnpm --filter @synapse/shared exec vitest run src/custom-apps.test.ts src/live.test.ts && pnpm --filter @synapse/desktop exec vitest run src/modules/apps/__tests__/dock.test.ts`

Expected: PASS, including the unchanged 9-item default Dock.

- [ ] **Step 5: Commit**

```bash
git add shared/src/custom-apps.ts shared/src/custom-apps.test.ts shared/src/index.ts shared/src/live.ts shared/src/live.test.ts desktop/src/modules/apps/types.ts desktop/src/modules/apps/dock.ts desktop/src/modules/apps/__tests__/dock.test.ts
git commit -m "feat: 建立自定义网页应用共享契约"
```

---

### Task 2: Prisma Models And Server Dock Reducer

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20261107120000_custom_apps/migration.sql`
- Create: `server/src/custom-apps/custom-app-dock.ts`
- Create: `server/src/custom-apps/custom-app-dock.spec.ts`

**Interfaces:**
- Consumes: Task 1 shared ID schemas, default Dock, operation schema and reducer.
- Produces: `UserCustomApp`, `UserCustomAppTombstone`, `UserCustomAppIconAsset`, `UserCustomAppSettings`, `UserCustomAppOperation`; `normalizeServerDockLayout(dockAppIds, options): string[]`; `applyServerDockAction(current, action, options): { dockAppIds: string[]; dockMigrationIds: string[] }`.

- [ ] **Step 1: Write failing Dock reducer tests**

```ts
it("removes deleted custom apps and orphans without dropping known hidden system apps", () => {
  expect(normalizeServerDockLayout(["agent", "cwa_deleted", "workflow", "ghost", "agent"], {
    knownCustomAppIds: new Set(),
  })).toEqual(["agent", "workflow", "launcher"])
})

it("applies a migration once on the latest layout", () => {
  const once = applyServerDockAction(["agent", "launcher"], {
    type: "apply-migrations",
    migrations: [{
      id: "dock.test.v1",
      operations: [{ kind: "insert-before", appId: "drive", targetAppId: "launcher" }],
    }],
  }, { knownCustomAppIds: new Set(), appliedMigrationIds: [] })
  expect(once.dockAppIds).toEqual(["agent", "drive", "launcher"])
  expect(once.dockMigrationIds).toEqual(["dock.test.v1"])
})
```

- [ ] **Step 2: Run the reducer tests and verify they fail**

Run: `pnpm --filter @synapse/server exec vitest run src/custom-apps/custom-app-dock.spec.ts`

Expected: FAIL because the server reducer and Prisma models do not exist.

- [ ] **Step 3: Add the migration and reducer**

Add new tables only; do not add a non-null column to an existing populated table. Give `UserCustomApp` a nullable `iconId`, `kind`, `version`, timestamps and a user relation. Give tombstones a composite primary key `(userId, appId)`. Give settings a `revision`, `initializedAt`, `dockAppIds`, `dockMigrationIds` and `dockCatalogVersion`. Give operation receipts `(userId, operationId)` uniqueness and `expiresAt`.

The reducer delegates ordering semantics to Task 1, validates known custom IDs, preserves hidden System App IDs, always restores `launcher`, and never returns duplicate IDs.

- [ ] **Step 4: Run the reducer test and Prisma validation**

Run: `pnpm --filter @synapse/server exec vitest run src/custom-apps/custom-app-dock.spec.ts && pnpm --filter @synapse/server exec prisma validate`

Expected: PASS and schema validation succeeds.

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20261107120000_custom_apps/migration.sql server/src/custom-apps/custom-app-dock.ts server/src/custom-apps/custom-app-dock.spec.ts
git commit -m "feat: 增加自定义应用云端数据模型"
```

---

### Task 3: Server Snapshot, App CRUD, Tombstones And Icons

**Files:**
- Create: `server/src/custom-apps/custom-apps.module.ts`
- Create: `server/src/custom-apps/custom-apps.controller.ts`
- Create: `server/src/custom-apps/custom-apps.service.ts`
- Create: `server/src/custom-apps/custom-app-icons.service.ts`
- Create: `server/src/custom-apps/custom-apps.controller.spec.ts`
- Create: `server/src/custom-apps/custom-apps.service.spec.ts`
- Create: `server/src/custom-apps/custom-app-icons.service.spec.ts`
- Modify: `server/src/app.module.ts`

**Interfaces:**
- Consumes: Task 1 DTOs/schemas and Task 2 models/reducer.
- Produces:

```ts
class CustomAppsService {
  snapshot(userId: string): Promise<CustomAppSnapshotDto>
  create(userId: string, input: CustomAppCreateInput): Promise<CustomAppSnapshotDto>
  update(userId: string, id: CustomAppId, input: CustomAppUpdateInput): Promise<CustomAppSnapshotDto>
  delete(userId: string, id: CustomAppId, input: { operationId: string }): Promise<CustomAppSnapshotDto>
}

class CustomAppIconsService {
  stagePng(input: { userId: string; appId: CustomAppId; png: Buffer }): Promise<{ iconId: string; iconUrl: string }>
  resolve(iconId: string): Promise<{ stream: NodeJS.ReadableStream; mimeType: "image/png"; size: bigint; etag: string | null } | null>
}
```

- [ ] **Step 1: Write failing controller and service tests**

```ts
it("scopes every route to the authenticated user", async () => {
  await request(app.getHttpServer()).get("/api/custom-apps/snapshot").expect(200)
  expect(service.snapshot).toHaveBeenCalledWith("user-1")
})

it("does not resurrect a tombstoned app", async () => {
  prisma.userCustomAppTombstone.findUnique.mockResolvedValue({ userId: "user-1", appId: appId, deletedAt: new Date() })
  await expect(service.create("user-1", createInput()))
    .rejects.toBeInstanceOf(ConflictException)
})

it("hard-deletes the app and removes its Dock id in one transaction", async () => {
  await service.delete("user-1", appId, { operationId: "delete-1" })
  expect(transaction.userCustomAppTombstone.create).toHaveBeenCalled()
  expect(transaction.userCustomApp.delete).toHaveBeenCalledWith({ where: { id: appId } })
  expect(transaction.userCustomAppSettings.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ dockAppIds: ["agent", "launcher"], revision: { increment: 1 } }),
  }))
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @synapse/server exec vitest run src/custom-apps/custom-apps.controller.spec.ts src/custom-apps/custom-apps.service.spec.ts`

Expected: FAIL because the module, routes and services do not exist.

- [ ] **Step 3: Implement authenticated CRUD and icon storage**

Use `@UseGuards(UserAuthGuard)` on `/api/custom-apps`. Parse every body with shared Zod schemas and reject invalid names, URLs and IDs before service calls. Use `PlatformMediaStorage`, pending/active/delete_pending icon states, and only `image/png`. Return the complete snapshot after every successful mutation. Enforce the 100-app limit and operation receipts inside the same database transaction as the mutation.

The public icon controller must support `GET` and `HEAD` at `/api/custom-apps/icons/:iconId`, return 404 once the app is deleted or the asset is no longer active, and set `Cache-Control: public, max-age=31536000, immutable`, `Content-Type: image/png`, `X-Content-Type-Options: nosniff`, and `Cross-Origin-Resource-Policy: cross-origin`. A scheduled cleanup removes stale pending/delete_pending icon objects without delaying app mutations.

Partial updates merge changed fields; concurrent edits to the same field use the last committed value. Delete wins over stale edit and never clears the device web session.

- [ ] **Step 4: Run the controller, service and icon tests**

Run: `pnpm --filter @synapse/server exec vitest run src/custom-apps/custom-apps.controller.spec.ts src/custom-apps/custom-apps.service.spec.ts src/custom-apps/custom-app-icons.service.spec.ts`

Expected: PASS, including account isolation, tombstone precedence and icon 404 behavior.

- [ ] **Step 5: Commit**

```bash
git add server/src/custom-apps server/src/app.module.ts
git commit -m "feat: 提供自定义应用云端接口与图标存储"
```

---

### Task 4: Server Dock Operations, Bootstrap And Live Revisions

**Files:**
- Modify: `server/src/custom-apps/custom-apps.service.ts`
- Modify: `server/src/custom-apps/custom-apps.controller.ts`
- Create: `server/src/custom-apps/custom-app-events.ts`
- Create: `server/src/custom-apps/custom-app-events.spec.ts`
- Modify: `server/src/custom-apps/custom-apps.service.spec.ts`
- Modify: `server/src/custom-apps/custom-apps.controller.spec.ts`
- Modify: `server/src/custom-apps/custom-apps.module.ts`

**Interfaces:**
- Consumes: Task 1 operations, Task 2 reducer, Task 3 service transaction patterns.
- Produces: `bootstrap(userId, input): Promise<CustomAppSnapshotDto>`, `applyDockOperation(userId, input): Promise<CustomAppSnapshotDto>`, `CustomAppEvents.publish(userId, revision): void`.

- [ ] **Step 1: Write failing bootstrap and live-event tests**

```ts
it("initializes Dock once from the first device", async () => {
  await expect(service.bootstrap("user-1", {
    operationId: "bootstrap-1",
    dockAppIds: ["agent", "database", "launcher"],
    dockMigrationIds: ["dock.mail-apps-introduction.v1"],
  })).resolves.toMatchObject({
    initialized: true,
    dockAppIds: ["agent", "database", "launcher"],
  })
})

it("broadcasts the new revision after commit", async () => {
  await service.applyDockOperation("user-1", {
    operationId: "move-1",
    type: "move",
    appId: "drive",
    beforeAppId: "agent",
  })
  expect(live.broadcastToUser).toHaveBeenCalledWith("user-1", expect.objectContaining({
    type: LIVE_MESSAGE_TYPES.customAppsChanged,
    payload: { revision: 2 },
  }))
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @synapse/server exec vitest run src/custom-apps/custom-apps.service.spec.ts src/custom-apps/custom-apps.controller.spec.ts`

Expected: FAIL because bootstrap and live publication are missing.

- [ ] **Step 3: Implement atomic Dock operations and live publication**

Add `POST /api/custom-apps/bootstrap` and `POST /api/custom-apps/dock/operations`. Bootstrap only writes when `initializedAt` is null. Dock operations always apply to the latest row under a transaction; use operation receipts for retry idempotency, reject a reused operationId with a different request hash, and delete receipts older than 7 days in a scheduled cleanup. `restore-default` uses `DEFAULT_DOCK_APP_IDS` from shared, not a client list. Publish `customAppsChanged` after a successful commit and never roll back the DB when broadcast fails.

- [ ] **Step 4: Run the server custom-app tests**

Run: `pnpm --filter @synapse/server exec vitest run src/custom-apps`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/custom-apps
git commit -m "feat: 同步自定义应用 Dock 并广播云端修订"
```

---

### Task 5: Desktop Cloud Catalog, Cache And Account Lifecycle

**Files:**
- Create: `desktop/electron/runtime/data-repo/schemas/custom-apps.ts`
- Modify: `desktop/electron/runtime/data-repo/schemas/index.ts`
- Create: `desktop/electron/runtime/data-repo/__tests__/custom-apps-schema.test.ts`
- Create: `desktop/electron/services/custom-apps/catalog-service.ts`
- Create: `desktop/electron/services/custom-apps/mutation-service.ts`
- Create: `desktop/electron/services/custom-apps/__tests__/catalog-service.test.ts`
- Modify: `desktop/electron/services/live-connection-service.ts`
- Modify: `desktop/electron/services/__tests__/live-connection-service.test.ts`
- Create: `desktop/electron/modules/custom-apps/ipc.ts`
- Create: `desktop/electron/modules/custom-apps/__tests__/ipc.test.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Modify: `desktop/electron/bootstrap/registry.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/scripts/build/generate-ipc.mjs`
- Create (generated): `desktop/electron/generated/ipc-channels.generated.ts`

**Interfaces:**
- Consumes: Task 1 snapshot/API contracts, Task 4 server endpoints, existing AccountService, DataRepository and LiveConnectionService.
- Produces: `CustomAppsSyncState`, `CustomAppsClientState`, `CustomAppsCatalogService`, the account-keyed local snapshot namespace and generated `customApps` bridge methods.

```ts
type CustomAppsSyncState = "signed-out" | "loading" | "ready" | "offline" | "unsupported" | "error"
type CustomAppsClientState = {
  accountId: string | null
  snapshot: CustomAppSnapshotDto | null
  syncState: CustomAppsSyncState
  errorCode: string | null
}

interface CustomAppsCatalogService {
  getState(): CustomAppsClientState
  subscribe(listener: (state: CustomAppsClientState) => void): () => void
  refresh(reason: string): Promise<void>
  create(input: CustomAppCreateInput): Promise<CustomAppSnapshotDto>
  update(id: CustomAppId, input: CustomAppUpdateInput): Promise<CustomAppSnapshotDto>
  delete(id: CustomAppId): Promise<CustomAppSnapshotDto>
  bootstrapDock(input: { operationId: string; dockAppIds: string[]; dockMigrationIds: string[] }): Promise<CustomAppSnapshotDto>
  applyDockOperation(operation: CustomAppDockOperation): Promise<CustomAppSnapshotDto>
}
```

- [ ] **Step 1: Write failing cache, account and live tests**

```ts
it("serves the last valid cache read-only while the cloud is offline", async () => {
  await catalog.seedCache("user-1", snapshot(4))
  account.setAuthenticatedOffline("user-1")
  await catalog.refresh("startup")
  expect(catalog.getState()).toMatchObject({
    accountId: "user-1",
    syncState: "offline",
    snapshot: expect.objectContaining({ revision: 4 }),
  })
})

it("discards a snapshot request after account switch", async () => {
  const pending = catalog.refresh("focus")
  account.switchTo("user-2")
  await pending
  expect(catalog.getState().accountId).toBe("user-2")
  expect(catalog.getState().snapshot?.revision).not.toBe(4)
})

it("does not replace the last good cache with an invalid snapshot", async () => {
  await catalog.seedCache("user-1", snapshot(4))
  account.setAuthenticatedOnline("user-1")
  api.snapshot.mockResolvedValueOnce({ schemaVersion: 1, revision: 5, apps: "invalid" })
  await catalog.refresh("startup")
  expect(catalog.getState().snapshot?.revision).toBe(4)
  expect(catalog.getState().syncState).toBe("error")
})

it("emits an account event for custom app live changes", async () => {
  await live.handleMessage(customAppsChangedMessage(8), "client-1", "user-1", 1)
  expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
    domain: "account",
    type: "custom-apps.changed",
    payload: { revision: 8 },
  }))
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @synapse/desktop exec vitest run electron/runtime/data-repo/__tests__/custom-apps-schema.test.ts electron/services/custom-apps/__tests__/catalog-service.test.ts electron/services/__tests__/live-connection-service.test.ts`

Expected: FAIL because the cache, catalog, mutation service and accounting of live revisions do not exist.

- [ ] **Step 3: Implement the main-process catalog**

Add local-only namespace `app.custom-apps.snapshots`, keyed by account ID and containing the last validated snapshot plus `cachedAt`. Use `AccountService.captureAccountRequestScope()` around every network request and reject responses whose account/auth revision changed. Use `fetchAuthenticated` with shared API paths. Debounce live reloads by revision, retry after failure, and emit `account`/`custom-apps.changed` from `LiveConnectionService`.

The catalog state machine must be:

```ts
signed out -> no custom apps
authenticated + no cache -> loading; failures -> offline/unsupported
authenticated + cache -> loading with cache; success -> ready
authenticated + cache + network failure -> offline
unauthenticated/expired -> clear active state, keep per-account cache
```

Expose only `getState`, `subscribe`, `refresh` and the mutation methods through the generated bridge. Add `customAppsChanged` as a supported envelope in the shared live protocol from Task 1.

- [ ] **Step 4: Regenerate IPC and run the focused desktop tests**

Run: `pnpm --filter @synapse/desktop run generate:ipc && pnpm --filter @synapse/desktop exec vitest run electron/runtime/data-repo/__tests__/custom-apps-schema.test.ts electron/services/custom-apps/__tests__/catalog-service.test.ts electron/services/__tests__/live-connection-service.test.ts electron/modules/custom-apps/__tests__/ipc.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/runtime/data-repo/schemas/custom-apps.ts desktop/electron/runtime/data-repo/schemas/index.ts desktop/electron/runtime/data-repo/__tests__/custom-apps-schema.test.ts desktop/electron/services/custom-apps desktop/electron/services/live-connection-service.ts desktop/electron/services/__tests__/live-connection-service.test.ts desktop/electron/modules/custom-apps desktop/electron/bootstrap/ipc-registry.ts desktop/electron/bootstrap/registry.ts desktop/electron/bootstrap/descriptors.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/scripts/build/generate-ipc.mjs desktop/electron/generated/ipc-channels.generated.ts
git commit -m "feat: 同步自定义应用配置与账号缓存"
```

---

### Task 6: Unified App Center And Custom App Management UI

**Files:**
- Create: `desktop/src/modules/custom-apps/context.tsx`
- Create: `desktop/src/modules/custom-apps/app-adapter.ts`
- Create: `desktop/src/modules/custom-apps/create-edit-dialog.tsx`
- Create: `desktop/src/modules/custom-apps/icon-picker.tsx`
- Create: `desktop/src/modules/custom-apps/delete-dialog.tsx`
- Create: `desktop/src/modules/custom-apps/__tests__/app-adapter.test.ts`
- Create: `desktop/src/modules/custom-apps/__tests__/create-edit-dialog.test.tsx`
- Modify: `desktop/src/modules/apps/types.ts`
- Modify: `desktop/src/modules/apps/components/app-launcher-list.tsx`
- Modify: `desktop/src/modules/apps/components/dock-app-menu-items.tsx`
- Modify: `desktop/src/app-shell/components/app-shell-dock.tsx`
- Modify: `desktop/src/modules/settings/components/dock-panel.tsx`
- Modify: `desktop/src/modules/settings/components/sortable-dock-item.tsx`
- Modify: `desktop/src/App.tsx`
- Create: `desktop/electron/services/custom-apps/favicon-service.ts`
- Create: `desktop/electron/services/custom-apps/__tests__/favicon-service.test.ts`
- Modify: `desktop/electron/modules/custom-apps/ipc.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/src/modules/apps/__tests__/system-app-header-architecture.test.ts`

**Interfaces:**
- Consumes: Task 1 shared types, Task 5 custom app state/mutations and existing System App manifests.
- Produces: `AppIconDescriptor`, `AppCatalogEntry`, `buildAppCatalog(systemApps, customState)`, `FaviconService`, `CustomAppContext`, and the create/edit/delete launcher UI.

```ts
type AppIconDescriptor =
  | { kind: "lucide"; icon: LucideIcon }
  | { kind: "image"; src: string }

type AppCatalogEntry =
  | {
      kind: "system"
      id: SynapseSystemAppId
      name: string
      category: AppCategoryId | null
      icon: AppIconDescriptor
      removable: boolean
      pinnable: boolean
    }
  | {
      kind: "custom-web"
      id: CustomAppId
      name: string
      category: "custom"
      icon: AppIconDescriptor
      removable: true
      pinnable: true
      app: CustomAppDto
    }

interface FavoriteIconResult {
  pngBase64: string
  dataUrl: string
}

interface FaviconService {
  fetchFavicon(startUrl: string): Promise<FavoriteIconResult | null>
  chooseIcon(): Promise<FavoriteIconResult | null>
}

function buildAppCatalog(
  systemApps: readonly SynapseSystemAppManifest[],
  customState: CustomAppsClientState,
): AppCatalogEntry[]
```

- [ ] **Step 1: Write failing adapter and form tests**

```ts
it("merges built-in and custom apps without changing built-in categories", () => {
  expect(buildAppCatalog(listSystemApps(), snapshotWithApps(customApp("阅读"))))
    .toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "agent", kind: "system", category: "collaboration" }),
      expect.objectContaining({ id: customApp("阅读").id, kind: "custom-web", category: "custom" }),
    ]))
})

it("creates a custom app with a local icon override", async () => {
  await renderCreateDialog()
  typeText("名称", "阅读")
  typeText("网址", "https://example.com/read")
  await chooseLocalIcon("custom-icon.png")
  clickButton("创建")
  expect(bridge.customApps.app.create).toHaveBeenCalledWith({
    operationId: expect.any(String),
    name: "阅读",
    startUrl: "https://example.com/read",
    iconSource: "custom",
    iconPngBase64: "iVBOR...",
  })
})

it("falls back to the generic globe when favicon discovery fails", async () => {
  const result = await favicon.fetchFavicon("https://broken.example")
  expect(result).toBeNull()
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @synapse/desktop exec vitest run src/modules/custom-apps/__tests__/app-adapter.test.ts src/modules/custom-apps/__tests__/create-edit-dialog.test.tsx electron/services/custom-apps/__tests__/favicon-service.test.ts`

Expected: FAIL because the custom app adapter and form do not exist.

- [ ] **Step 3: Implement the unified catalog and management UI**

Add “自定义应用” to the launcher filters and a “新建自定义应用” action. Keep built-in `systemAppPresentation` unchanged; custom entries use the server icon URL or the Lucide `Globe` fallback. Unknown future `kind` values are omitted from the visible catalog without dropping their Dock IDs from the cloud snapshot. Extend Dock and launcher menus with custom app edit/delete actions while preserving existing System App menu rows.

Implement the dialog as a small shadcn form with exactly `图标`, `名称`, `网址`, `取消`, `创建/保存`; no extra explanatory paragraph. Trigger favicon discovery when a valid URL is blurred and the icon has not been manually overridden. Favicon discovery runs only in the main process against the custom web session, follows at most 3 redirects, times out after 5 seconds, reads at most 512 KiB, accepts image responses, and normalizes to PNG before returning a data URL. Local icon selection uses the native file dialog, accepts up to 2 MiB of PNG/JPEG/WebP, normalizes to 128×128 PNG, and returns only a data URL/base64 payload, never a path.

Use the current account/sync state to disable all mutating controls when offline, signed out, syncing, or unsupported. Do not auto-pin newly created apps.

Sort custom apps by `createdAt, id`. Editing a custom app’s URL does not navigate a running WebContents; if `iconSource === "favicon"`, refresh the favicon during save, while `iconSource === "custom"` preserves the user image.

After a custom icon is selected, the edit form exposes “使用网站图标” to clear it. Deletion uses a separate confirmation dialog naming the app; remote deletion shows no confirmation.

- [ ] **Step 4: Run adapter, dialog, menu and favicon tests**

Run: `pnpm --filter @synapse/desktop exec vitest run src/modules/custom-apps/__tests__ src/modules/apps/__tests__/app-launcher.test.tsx src/modules/apps/__tests__/system-app-header-architecture.test.ts src/modules/settings/components/__tests__/dock-panel.test.tsx electron/services/custom-apps/__tests__/favicon-service.test.ts`

Expected: PASS, with existing built-in app expectations unchanged.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/custom-apps desktop/src/modules/apps/types.ts desktop/src/modules/apps/components/app-launcher-list.tsx desktop/src/modules/apps/components/dock-app-menu-items.tsx desktop/src/modules/apps/__tests__/system-app-header-architecture.test.ts desktop/src/app-shell/components/app-shell-dock.tsx desktop/src/modules/settings/components/dock-panel.tsx desktop/src/modules/settings/components/sortable-dock-item.tsx desktop/src/App.tsx desktop/electron/services/custom-apps/favicon-service.ts desktop/electron/services/custom-apps/__tests__/favicon-service.test.ts desktop/electron/modules/custom-apps/ipc.ts desktop/electron/preload.ts desktop/src/types/bridge.ts
git commit -m "feat: 在应用中心管理自定义网页应用"
```

---

### Task 7: Secure Shared Web Session

**Files:**
- Create: `desktop/electron/services/custom-apps/web-session.ts`
- Create: `desktop/electron/services/custom-apps/__tests__/web-session.test.ts`
- Modify: `desktop/electron/services/custom-apps/catalog-service.ts`
- Modify: `desktop/electron/modules/custom-apps/ipc.ts`

**Interfaces:**
- Consumes: Task 1 `parseCustomAppUrl`, Task 5 catalog service, and Task 6 favicon/icon result types.
- Produces: `CUSTOM_WEB_PARTITION`, `getCustomWebSession()`, `isAllowedCustomWebUrl(value)` and `configureCustomWebSession(session, deps)`.

```ts
const CUSTOM_WEB_PARTITION = "persist:synapse-custom-web"
function getCustomWebSession(): Session
function isAllowedCustomWebUrl(value: string): boolean
function configureCustomWebSession(session: Session, deps?: {
  readonly onDownload?: (item: DownloadItem, webContents: WebContents) => void
}): () => void
```

- [ ] **Step 1: Write failing session security tests**

```ts
it("uses one persistent partition for all custom apps", () => {
  expect(getCustomWebSession().partition).toBe(CUSTOM_WEB_PARTITION)
})

it.each([
  "file:///tmp/secret",
  "data:text/html,hello",
  "javascript:alert(1)",
  "synapse://app/agent",
])("blocks non-web navigation %s", (url) => {
  expect(isAllowedCustomWebUrl(url)).toBe(false)
})

it("allows only mediaKeySystem permission", async () => {
  await configureCustomWebSession(session)
  expect(session.setPermissionRequestHandler).toHaveBeenCalled()
  expect(session.setPermissionCheckHandler).toHaveBeenCalled()
  expect(session.setDevicePermissionHandler).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @synapse/desktop exec vitest run electron/services/custom-apps/__tests__/web-session.test.ts`

Expected: FAIL because the shared session policy does not exist.

- [ ] **Step 3: Implement the session policy**

Resolve the session with `session.fromPartition(CUSTOM_WEB_PARTITION)`. Install permission, permission-check and device-permission handlers once per session. Allow only `mediaKeySystem`; deny media, display capture, geolocation, notifications, clipboards, storage access, pointer/keyboard lock, fullscreen, window management, local fonts, idle detection, speaker selection, open external, unknown and all devices. Configure download interception with a save dialog; cancellation is a normal outcome. Do not add a preload, Node integration or arbitrary session access to renderer.

- [ ] **Step 4: Run the session tests**

Run: `pnpm --filter @synapse/desktop exec vitest run electron/services/custom-apps/__tests__/web-session.test.ts`

Expected: PASS, and the existing security tests remain green.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/custom-apps/web-session.ts desktop/electron/services/custom-apps/__tests__/web-session.test.ts desktop/electron/services/custom-apps/catalog-service.ts desktop/electron/modules/custom-apps/ipc.ts
git commit -m "feat: 建立自定义应用共享安全网页会话"
```

---

### Task 8: WebContentsView Runtime And Viewport Bounds

**Files:**
- Create: `desktop/electron/services/custom-apps/runtime-service.ts`
- Create: `desktop/electron/services/custom-apps/__tests__/runtime-service.test.ts`
- Create: `desktop/src/modules/custom-apps/web-app-content.tsx`
- Create: `desktop/src/modules/custom-apps/web-app-viewport.tsx`
- Create: `desktop/src/modules/custom-apps/__tests__/web-app-content.test.tsx`
- Modify: `desktop/electron/modules/custom-apps/ipc.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`

**Interfaces:**
- Consumes: Task 5 custom app records, Task 7 shared session, Task 6 viewport bridge and existing System App shell primitives.
- Produces: `CustomWebAppViewState`, `CustomWebAppNavigationAction`, `CustomWebAppRuntimeService`, `CustomWebAppContent` and `CustomWebAppViewport`.

```ts
type CustomWebAppViewState = {
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  currentUrl: string | null
  error: "none" | "load_failed" | "certificate"
}

type CustomWebAppNavigationAction = "back" | "forward" | "reload" | "open-external"

interface CustomWebAppRuntimeService {
  attach(host: BrowserWindow, appId: CustomAppId): Promise<void>
  setBounds(host: BrowserWindow, bounds: { x: number; y: number; width: number; height: number }): void
  detach(host: BrowserWindow): void
  setOccluded(host: BrowserWindow, occluded: boolean): void
  navigate(host: BrowserWindow, action: CustomWebAppNavigationAction): Promise<void>
  state(host: BrowserWindow): CustomWebAppViewState
  destroyApp(appId: CustomAppId): void
  destroyAll(): void
}
```

- [ ] **Step 1: Write failing runtime tests**

```ts
it("retains history when an app is detached and reattached", async () => {
  await runtime.attach(host, appId)
  runtime.detach(host)
  await runtime.attach(host, appId)
  expect(createdViews[0].webContents.reload).not.toHaveBeenCalled()
  expect(attachedView).toBe(createdViews[0])
})

it("clamps a viewport below the app header and inside the window", () => {
  host.getContentBounds.mockReturnValue({ x: 0, y: 0, width: 1200, height: 700 })
  runtime.setBounds(host, { x: -10, y: 48, width: 1200, height: 900 })
  expect(createdView.setBounds).toHaveBeenCalledWith({ x: 0, y: 48, width: 1200, height: 652 })
})

it("destroys the view when the app is deleted remotely", async () => {
  await runtime.attach(host, appId)
  runtime.destroyApp(appId)
  expect(createdViews[0].webContents.destroy).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @synapse/desktop exec vitest run electron/services/custom-apps/__tests__/runtime-service.test.ts`

Expected: FAIL because the runtime service does not exist.

- [ ] **Step 3: Implement the runtime and viewport bridge**

Create one `WebContentsView` per app/host, attach it to `BrowserWindow.contentView`, and keep the WebContents in a map while the host is inactive. Initialize the view only after the host renderer has a valid app record. Load the configured `startUrl` only on the first attach for that host/app; reattaching must not reload. Use `did-navigate`, `did-navigate-in-page`, `did-start-loading`, `did-stop-loading` and `did-fail-load` to update state. Reject invalid bounds and clamp them to the current content bounds. Keep views hidden while detached or occluded. Do not install a certificate-error bypass handler. Add a React placeholder using `ResizeObserver`; send bounds through the validated IPC bridge. Do not expose `webContents` or `Session` to renderer.

- [ ] **Step 4: Run runtime and viewport tests**

Run: `pnpm --filter @synapse/desktop exec vitest run electron/services/custom-apps/__tests__/runtime-service.test.ts src/modules/custom-apps/__tests__/web-app-content.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/custom-apps/runtime-service.ts desktop/electron/services/custom-apps/__tests__/runtime-service.test.ts desktop/src/modules/custom-apps/web-app-content.tsx desktop/src/modules/custom-apps/web-app-viewport.tsx desktop/src/modules/custom-apps/__tests__/web-app-content.test.tsx desktop/electron/modules/custom-apps/ipc.ts desktop/electron/preload.ts desktop/src/types/bridge.ts
git commit -m "feat: 运行自定义网页应用原生视图"
```

---

### Task 9: Custom App Window, Popups And Toolbar

**Files:**
- Create: `desktop/electron/services/custom-apps/window-service.ts`
- Create: `desktop/electron/services/custom-apps/__tests__/window-service.test.ts`
- Create: `desktop/src/modules/custom-apps/custom-app-window-app.tsx`
- Create: `desktop/src/modules/custom-apps/web-app-toolbar-actions.tsx`
- Create: `desktop/src/modules/custom-apps/__tests__/custom-app-window-app.test.tsx`
- Modify: `desktop/electron/services/custom-apps/runtime-service.ts`
- Modify: `desktop/electron/services/custom-apps/web-session.ts`
- Modify: `desktop/electron/modules/custom-apps/ipc.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/src/modules/apps/system-app-window-app.tsx`
- Modify: `desktop/src/main.tsx`
- Modify: `desktop/src/App.tsx`

**Interfaces:**
- Consumes: Task 7 shared session, Task 8 runtime/view state, Task 5 custom app bridge.
- Produces: `CustomWebAppWindowService`, `planCustomWebAppWindowOpen(input)`, `custom-app-window` renderer host and approved toolbar bridge actions.

```ts
interface CustomWebAppWindowService {
  open(appId: CustomAppId): Promise<void>
  close(appId: CustomAppId): void
  closeAll(): void
}

function planCustomWebAppWindowOpen(input: {
  url: string
  activePopupCount: number
}): { action: "allow" | "deny" }
```

- [ ] **Step 1: Write failing window, popup and toolbar tests**

```ts
it("opens one independent window at the configured start URL", async () => {
  await windows.open(appId)
  await windows.open(appId)
  expect(createWindow).toHaveBeenCalledTimes(1)
  expect(loadURL).toHaveBeenCalledWith(expect.stringContaining("window=custom-app"))
  expect(focus).toHaveBeenCalledTimes(1)
})

it("allows OAuth window.open with shared cookies and blocks file URLs", () => {
  expect(planCustomWebAppWindowOpen({ url: "https://login.example.com", activePopupCount: 0 })).toEqual({ action: "allow" })
  expect(planCustomWebAppWindowOpen({ url: "file:///tmp/secret", activePopupCount: 0 })).toEqual({ action: "deny" })
  expect(planCustomWebAppWindowOpen({ url: "https://login.example.com", activePopupCount: 5 })).toEqual({ action: "deny" })
})

it("renders only the four approved toolbar actions", () => {
  render(<WebAppToolbarActions state={readyState()} />)
  expect(screen.getByLabelText("后退")).toBeTruthy()
  expect(screen.getByLabelText("前进")).toBeTruthy()
  expect(screen.getByLabelText("刷新")).toBeTruthy()
  expect(screen.getByLabelText("在浏览器打开")).toBeTruthy()
  expect(screen.queryByRole("textbox")).toBeNull()
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @synapse/desktop exec vitest run electron/services/custom-apps/__tests__/window-service.test.ts src/modules/custom-apps/__tests__/custom-app-window-app.test.tsx`

Expected: FAIL because custom app windows and toolbar actions do not exist.

- [ ] **Step 3: Implement the independent window and popup policy**

`window-service` opens `window=custom-app&appId=<id>`, uses the existing system app window bounds, keeps one window per custom app, and prevents page titles from replacing the window title. Its first view loads the current app `startUrl`. Page-created windows use the shared session, preserve opener/postMessage, allow only HTTP(S), and are bounded per app. On close or app deletion, destroy the app’s view and child popups.

The main and system-app window hosts branch to `CustomWebAppContent` for custom app IDs before calling the system-only `SystemAppContent`. `CustomWebAppContent` uses `SystemAppWindowShell` for toolbar actions and the runtime view; the toolbar never renders an address bar. `App.tsx` must support the custom app ID, switch to the launcher after deletion, and preserve system app branches unchanged.

“在浏览器打开” always uses the current main-frame HTTP(S) URL and asks the existing guarded shell opener; it never falls back to the start URL or an invalid scheme.

- [ ] **Step 4: Run window, toolbar and app shell tests**

Run: `pnpm --filter @synapse/desktop exec vitest run electron/services/custom-apps/__tests__/window-service.test.ts src/modules/custom-apps/__tests__/custom-app-window-app.test.tsx src/modules/apps/__tests__/system-app-window-app.test.tsx src/modules/apps/__tests__/system-app-header-architecture.test.ts`

Expected: PASS and existing System App window behavior remains unchanged.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/custom-apps/window-service.ts desktop/electron/services/custom-apps/__tests__/window-service.test.ts desktop/src/modules/custom-apps/custom-app-window-app.tsx desktop/src/modules/custom-apps/web-app-toolbar-actions.tsx desktop/src/modules/custom-apps/__tests__/custom-app-window-app.test.tsx desktop/electron/services/custom-apps/runtime-service.ts desktop/electron/services/custom-apps/web-session.ts desktop/electron/modules/custom-apps/ipc.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/src/modules/apps/system-app-window-app.tsx desktop/src/main.tsx desktop/src/App.tsx
git commit -m "feat: 支持自定义网页应用独立窗口与新窗口"
```

---

### Task 10: Cloud-Synced Dock And Legacy Bootstrap

**Files:**
- Create: `desktop/src/modules/custom-apps/use-cloud-dock.ts`
- Create: `desktop/src/modules/custom-apps/__tests__/use-cloud-dock.test.tsx`
- Modify: `desktop/src/modules/apps/hooks/use-dock-preferences.ts`
- Modify: `desktop/src/modules/settings/components/dock-panel.tsx`
- Modify: `desktop/src/modules/settings/components/sortable-dock-item.tsx`
- Modify: `desktop/src/modules/settings/components/__tests__/dock-panel.test.tsx`
- Modify: `desktop/src/app-shell/components/app-shell-dock.tsx`
- Modify: `desktop/src/App.tsx`
- Modify: `desktop/electron/services/custom-apps/catalog-service.ts`
- Modify: `desktop/electron/services/custom-apps/__tests__/catalog-service.test.ts`
- Modify: `desktop/src/modules/apps/__tests__/dock.test.ts`
- Modify: `docs/agents/capability-registry.md`
- Modify: `docs/agents/module-boundaries.md`

**Interfaces:**
- Consumes: Task 2 server Dock model, Task 4 Dock operations/bootstrap, Task 5 catalog state, Task 6 unified app catalog and existing `DockPanel`.
- Produces: `CloudDockState`, `useCloudDock(options)`, `listVisibleDockEntries(customState, knownCustomIds)` and cloud-authoritative Dock rendering.

```ts
type CloudDockState = {
  appIds: readonly SynapseAppId[]
  canEdit: boolean
  saving: boolean
  add(appId: SynapseAppId): Promise<boolean>
  remove(appId: SynapseAppId): Promise<boolean>
  move(appId: SynapseAppId, direction: DockMoveDirection): Promise<boolean>
  reorder(activeId: SynapseAppId, overId: SynapseAppId): Promise<boolean>
  restoreDefault(): Promise<boolean>
}

function useCloudDock(options: {
  workflowEntryVisible: boolean
  customState: CustomAppsClientState
}): CloudDockState

function listVisibleDockEntries(
  customState: CustomAppsClientState,
  options: {
    knownCustomIds: ReadonlySet<CustomAppId>
    workflowEntryVisible: boolean
  },
): AppCatalogEntry[]
```

- [ ] **Step 1: Write failing Dock sync and state tests**

```ts
it("uses the first device's legacy Dock once and then follows the cloud layout", async () => {
  await catalog.bootstrapDock({
    operationId: "bootstrap-1",
    dockAppIds: ["agent", "database", "launcher"],
    dockMigrationIds: [],
  })
  const state = catalog.getState()
  expect(state.snapshot?.dockAppIds).toEqual(["agent", "database", "launcher"])
  expect(catalog.bootstrapDock).toHaveBeenCalledTimes(1)
})

it("disables built-in Dock edits while signed out", async () => {
  const state = renderCloudDock({ syncState: "signed-out", snapshot: null })
  expect(state.canEdit).toBe(false)
})

it("removes a remotely deleted custom app from the visible Dock", () => {
  expect(listVisibleDockEntries(
    stateWithDock(["agent", "cwa_deleted", "launcher"]),
    {
      knownCustomIds: new Set([customApp("kept").id]),
      workflowEntryVisible: false,
    },
  ).map((entry) => entry.id)).toEqual(["agent", "launcher"])
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @synapse/desktop exec vitest run src/modules/custom-apps/__tests__/use-cloud-dock.test.tsx desktop/electron/services/custom-apps/__tests__/catalog-service.test.ts src/modules/apps/__tests__/dock.test.ts`

Expected: FAIL because Dock still reads only local System App IDs.

- [ ] **Step 3: Implement cloud Dock authority**

While authenticated and synced, `App.tsx`, the Dock, settings panel and launcher use the cloud snapshot. Use `useDockPreferences` only as the legacy fallback for signed-out/cache-less built-in apps; the new Dock editor never writes `core.config.dockAppIds` or `dockMigrationIds`. On first authenticated snapshot with `initialized = false`, submit the current local layout through bootstrap. Compare `dockCatalogVersion` and `dockMigrationIds` with the shared catalog and submit missing `apply-migrations` once. On remote revision updates, normalize unknown/deleted IDs for display and preserve known hidden workflow IDs. Disable all Dock mutations when signed out, offline, loading, or unsupported. Keep the launcher required and preserve the existing default order.

Update the capability registry and module-boundaries notes with the exact custom-app non-System-App boundary and Dock authority change.

- [ ] **Step 4: Run Dock tests and hard constraints**

Run: `pnpm --filter @synapse/desktop exec vitest run src/modules/custom-apps/__tests__/use-cloud-dock.test.tsx desktop/electron/services/custom-apps/__tests__/catalog-service.test.ts src/modules/apps/__tests__/dock.test.ts src/modules/settings/components/__tests__/dock-panel.test.tsx && pnpm --filter @synapse/desktop run check:hard-constraints`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/custom-apps/use-cloud-dock.ts desktop/src/modules/custom-apps/__tests__/use-cloud-dock.test.tsx desktop/src/modules/apps/hooks/use-dock-preferences.ts desktop/src/modules/settings/components/dock-panel.tsx desktop/src/modules/settings/components/sortable-dock-item.tsx desktop/src/modules/settings/components/__tests__/dock-panel.test.tsx desktop/src/app-shell/components/app-shell-dock.tsx desktop/src/App.tsx desktop/electron/services/custom-apps/catalog-service.ts desktop/electron/services/custom-apps/__tests__/catalog-service.test.ts desktop/src/modules/apps/__tests__/dock.test.ts docs/agents/capability-registry.md docs/agents/module-boundaries.md
git commit -m "feat: 将 Dock 布局改为账号级自定义应用配置"
```

---

### Task 11: Native View Occlusion, End-To-End Coverage And Release Notes

**Files:**
- Create: `desktop/src/modules/custom-apps/native-surface-occlusion.tsx`
- Create: `desktop/src/modules/custom-apps/__tests__/native-surface-occlusion.test.tsx`
- Modify: `desktop/src/modules/custom-apps/web-app-content.tsx`
- Modify: `desktop/src/modules/custom-apps/web-app-viewport.tsx`
- Modify: `desktop/src/App.tsx`
- Modify: `desktop/src/main.tsx`
- Modify: `desktop/src/app-shell/components/app-shell-layout.tsx`
- Modify: `desktop/src/components/ui/alert-dialog.tsx`
- Modify: `desktop/src/components/ui/context-menu.tsx`
- Modify: `desktop/src/components/ui/dialog.tsx`
- Modify: `desktop/src/components/ui/dropdown-menu.tsx`
- Modify: `desktop/src/components/ui/hover-card.tsx`
- Modify: `desktop/src/components/ui/menubar.tsx`
- Modify: `desktop/src/components/ui/popover.tsx`
- Modify: `desktop/src/components/ui/select.tsx`
- Modify: `desktop/src/components/ui/sheet.tsx`
- Create: `desktop/src/modules/custom-apps/__tests__/custom-apps-integration.test.tsx`
- Modify: `RELEASE_NOTES_PENDING.md`

**Interfaces:**
- Consumes: Tasks 5–10 custom app state, web runtime, windows and Dock.
- Produces: `NativeSurfaceOcclusionProvider`, `useNativeSurfaceOcclusion(open)` and end-to-end custom app behavior.

```ts
function NativeSurfaceOcclusionProvider(props: { children: ReactNode }): JSX.Element
function useNativeSurfaceOcclusion(open: boolean): void
```

- [ ] **Step 1: Write failing occlusion and integration tests**

```ts
it("hides the native view while a dialog or menu is open", async () => {
  render(<NativeSurfaceOcclusionProvider><CustomWebAppContent appId={appId} /></NativeSurfaceOcclusionProvider>)
  openMenu()
  expect(bridge.customApps.view.setOccluded).toHaveBeenCalledWith({ occluded: true })
  closeMenu()
  expect(bridge.customApps.view.setOccluded).toHaveBeenLastCalledWith({ occluded: false })
})

it("hands a deleted active app back to the launcher without throwing", async () => {
  bridge.customApps.snapshot.onChanged.mockImplementationOnce((listener) => {
    listener(snapshotWithoutApp(appId))
    return () => undefined
  })
  expect(screen.queryByText("应用出现问题")).toBeNull()
  expect(screen.getByText("应用中心")).toBeTruthy()
})

it("closes custom app windows when authentication changes account", async () => {
  await openCustomAppWindow(appId)
  account.switchTo("user-2")
  expect(customWindows.closeAll).toHaveBeenCalled()
  expect(customRuntime.destroyAll).toHaveBeenCalled()
})

it("keeps right-click and form controls above the webpage view", async () => {
  // Exercise the dock settings menu and edit form while a fake viewport is mounted.
  expect(document.querySelector("[data-embedded-system-app-header]")).not.toBeNull()
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @synapse/desktop exec vitest run src/modules/custom-apps/__tests__/native-surface-occlusion.test.tsx src/modules/custom-apps/__tests__/custom-apps-integration.test.tsx`

Expected: FAIL because overlay leases and remote-delete integration are missing.

- [ ] **Step 3: Implement occlusion and finish integration**

Wrap the main and custom-app renderer roots in the occlusion provider. Portaled interactive surfaces acquire a lease while open and release on close; the provider sends a single occluded boolean to the active custom app viewport. Nested surfaces must not release the view early. Do not recreate or reload WebContents when occluding. Update the shared UI primitives only through the hook, keeping their existing visual markup unchanged. Ensure account switching/remote deletion closes views and windows and navigates the main shell back to the launcher without a blocking error.

Add a user-facing release note covering custom web apps, shared device login state, account-synced Dock, and read-only offline behavior. Do not describe implementation details.

- [ ] **Step 4: Run the full relevant verification suite**

Run:

```bash
pnpm --filter @synapse/shared test
pnpm --filter @synapse/server test
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: all pass. Do not claim real menu, OAuth, download, upload, window-resize or visual acceptance without launching the app when the user authorizes it.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/custom-apps desktop/src/App.tsx desktop/src/main.tsx desktop/src/app-shell/components/app-shell-layout.tsx desktop/src/components/ui/alert-dialog.tsx desktop/src/components/ui/context-menu.tsx desktop/src/components/ui/dialog.tsx desktop/src/components/ui/dropdown-menu.tsx desktop/src/components/ui/hover-card.tsx desktop/src/components/ui/menubar.tsx desktop/src/components/ui/popover.tsx desktop/src/components/ui/select.tsx desktop/src/components/ui/sheet.tsx RELEASE_NOTES_PENDING.md
git commit -m "feat: 完成自定义网页应用交互与异常恢复"
```

## Self-Review

- Spec coverage: shared identity/contracts, cloud models/API, icons, tombstones, live revisions, catalog cache, offline/read-only, launcher, WebContentsView, shared session, permissions, navigation, popups, windows, Dock bootstrap/authority, occlusion, docs and release notes each have an owning task.
- Type consistency: `CustomAppId`, `CustomAppSnapshotDto`, `CustomAppDockOperation`, `CustomAppsClientState`, `AppCatalogEntry`, `CustomWebAppNavigationAction` and `useCloudDock` are introduced before their consumers.
- Review Focus coverage: remote delete → Task 9/11; native bounds and overlays → Task 8/11; account isolation → Task 5/10; concurrency/idempotency → Tasks 2/4/10; OAuth/protocol/permissions → Tasks 7/9.
- No implementation is included beyond interfaces, exact tests, validation commands and commit boundaries.
