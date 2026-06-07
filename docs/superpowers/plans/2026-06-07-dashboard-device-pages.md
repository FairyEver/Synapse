# Dashboard Device Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add role-specific first-level dashboard device pages: admins see all devices read-only, normal users see and rename their own devices.

**Architecture:** Add persistent `UserDevice` records keyed by `userId + clientInstanceId`, upsert them from the existing Synapse Live hello flow, and merge persisted records with the in-memory Live registry for current status. Add read-only admin and user-scoped dashboard APIs, then build two dashboard routes with role-specific sidebar entries and shared device utilities.

**Tech Stack:** Prisma, NestJS, Synapse Live services, React 19, TanStack Router, TanStack Query/Table, shadcn/ui, TypeScript, Vitest.

---

## File Structure

Server:

- Modify `server/prisma/schema.prisma`: add `User.devices` relation and `UserDevice` model.
- Create `server/prisma/migrations/20260607000000_user_devices/migration.sql`: add the `UserDevice` table and indexes.
- Create `server/src/live/live-device.service.ts`: persistent device upsert, rename, list, and live-status merge logic.
- Create `server/src/live/live-device.service.spec.ts`: focused service tests with mocked Prisma and registry.
- Modify `server/src/live/live.module.ts`: register and export `LiveDeviceService`.
- Modify `server/src/live/live-desktop.gateway.ts`: call `LiveDeviceService.upsertFromHello()` after a valid hello is registered.
- Modify `server/src/live/live-desktop.gateway.spec.ts`: verify hello persists device metadata without changing the Live protocol.
- Modify `server/src/live/live.controller.ts`: add normal-user `GET /api/dashboard/devices` and `PATCH /api/dashboard/devices/:clientInstanceId`.
- Modify `server/src/live/live.controller.spec.ts`: verify user list, admin list, and user rename controller behavior.
- Modify `server/src/admin/admin.controller.ts`: add admin `GET /api/admin/devices` with audit.
- Modify `server/src/admin/admin.controller.spec.ts`: verify admin device reads call service and audit.

Dashboard:

- Modify `dashboard/src/lib/api.ts`: add `DashboardDeviceRow`, admin/user device API methods.
- Modify `dashboard/src/lib/api.test.ts`: verify endpoint paths and PATCH encoding.
- Create `dashboard/src/lib/device-utils.ts`: status labels, status badge variants, snapshot/SSE merge helpers.
- Create `dashboard/src/lib/device-utils.test.ts`: utility tests.
- Modify `dashboard/src/components/layout/data/sidebar-data.ts`: add role-specific `设备` and `我的设备` entries.
- Modify `dashboard/src/components/layout/data/sidebar-data.test.ts`: verify role-specific menu visibility.
- Use existing `dashboard/src/lib/dashboard-route-guards.ts` guards: `requireDashboardAdmin` for `/devices` and `requireDashboardUser` for `/my-devices`.
- Create `dashboard/src/routes/_authenticated/devices/index.tsx`: admin devices route guarded by `requireDashboardAdmin`.
- Create `dashboard/src/routes/_authenticated/my-devices/index.tsx`: normal-user devices route guarded by `requireDashboardUser`.
- Create `dashboard/src/features/devices/index.tsx`: admin read-only device table.
- Create `dashboard/src/features/my-devices/index.tsx`: normal-user device table and rename dialog.
- Modify `dashboard/src/features/settings/profile-settings.tsx`: remove embedded client list and Live subscription state.
- Modify `dashboard/src/features/users/index.tsx`: remove client detail action/sheet; keep compact aggregate column.
- Delete `dashboard/src/features/users/user-live-clients-sheet.tsx` after removing the user page detail action.
- Modify `dashboard/src/features/users/live-client-utils.ts`: keep user aggregate helpers there and move shared status labels/variants to `dashboard/src/lib/device-utils.ts`.

Docs:

- Modify `RELEASE_NOTES_PENDING.md`: add a user-facing note about device pages and normal-user rename.

## Task 1: Prisma Device Model

**Files:**

- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260607000000_user_devices/migration.sql`

- [ ] **Step 1: Add the Prisma model**

In `server/prisma/schema.prisma`, add the `devices` relation to `model User` after `webhooks`:

```prisma
  devices             UserDevice[]
```

Add this model after `UserSession`:

```prisma
model UserDevice {
  id               String   @id @default(cuid())
  userId           String
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  clientInstanceId String
  deviceName       String   @db.VarChar(120)
  displayName      String?  @db.VarChar(120)
  platform         String
  appVersion       String
  firstSeenAt      DateTime @default(now())
  lastSeenAt       DateTime @default(now())
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([userId, clientInstanceId])
  @@index([userId, lastSeenAt])
  @@index([lastSeenAt])
}
```

- [ ] **Step 2: Add the SQL migration**

Create `server/prisma/migrations/20260607000000_user_devices/migration.sql`:

```sql
CREATE TABLE "UserDevice" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientInstanceId" TEXT NOT NULL,
  "deviceName" VARCHAR(120) NOT NULL,
  "displayName" VARCHAR(120),
  "platform" TEXT NOT NULL,
  "appVersion" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserDevice_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "UserDevice"
  ADD CONSTRAINT "UserDevice_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "UserDevice_userId_clientInstanceId_key"
  ON "UserDevice"("userId", "clientInstanceId");

CREATE INDEX "UserDevice_userId_lastSeenAt_idx"
  ON "UserDevice"("userId", "lastSeenAt");

CREATE INDEX "UserDevice_lastSeenAt_idx"
  ON "UserDevice"("lastSeenAt");
```

- [ ] **Step 3: Generate Prisma client**

Run:

```bash
pnpm --filter @synapse/server run prisma:generate
```

Expected: PASS and Prisma client is generated with `userDevice`.

- [ ] **Step 4: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260607000000_user_devices/migration.sql
git commit -m "feat(server): add user device records"
```

## Task 2: LiveDeviceService

**Files:**

- Create: `server/src/live/live-device.service.ts`
- Create: `server/src/live/live-device.service.spec.ts`

- [ ] **Step 1: Write failing service tests**

Create `server/src/live/live-device.service.spec.ts`:

```ts
import { NotFoundException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { LiveClientRegistry } from "./live-client-registry"
import { LiveDeviceService } from "./live-device.service"

type StoredDevice = {
  id: string
  userId: string
  user?: { email: string }
  clientInstanceId: string
  deviceName: string
  displayName: string | null
  platform: string
  appVersion: string
  firstSeenAt: Date
  lastSeenAt: Date
  createdAt: Date
  updatedAt: Date
}

function storedDevice(input: Partial<StoredDevice> = {}): StoredDevice {
  const now = new Date("2026-06-07T10:00:00.000Z")
  return {
    id: "device-row-1",
    userId: "user-1",
    user: { email: "user@example.com" },
    clientInstanceId: "client-a",
    deviceName: "MacBook",
    displayName: null,
    platform: "darwin-arm64",
    appVersion: "0.2.253",
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
    ...input,
  }
}

function createPrisma(devices: StoredDevice[] = []) {
  const userDevice = {
    upsert: vi.fn(async ({ create, update }: { create: StoredDevice; update: Partial<StoredDevice> }) => {
      const existing = devices.find(
        (item) => item.userId === create.userId && item.clientInstanceId === create.clientInstanceId,
      )
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date("2026-06-07T10:02:00.000Z") })
        return existing
      }
      devices.push(create)
      return create
    }),
    findMany: vi.fn(async () => devices),
    findUnique: vi.fn(async ({ where }: { where: { userId_clientInstanceId: { userId: string; clientInstanceId: string } } }) =>
      devices.find(
        (item) =>
          item.userId === where.userId_clientInstanceId.userId &&
          item.clientInstanceId === where.userId_clientInstanceId.clientInstanceId,
      ) ?? null
    ),
    update: vi.fn(async ({ where, data }: { where: { userId_clientInstanceId: { userId: string; clientInstanceId: string } }; data: { displayName: string } }) => {
      const existing = devices.find(
        (item) =>
          item.userId === where.userId_clientInstanceId.userId &&
          item.clientInstanceId === where.userId_clientInstanceId.clientInstanceId,
      )
      if (!existing) throw new Error("not found")
      existing.displayName = data.displayName
      existing.updatedAt = new Date("2026-06-07T10:03:00.000Z")
      return existing
    }),
    count: vi.fn(async () => devices.length),
  }
  return { userDevice, $transaction: vi.fn(async (calls: unknown[]) => Promise.all(calls)) }
}

describe("LiveDeviceService", () => {
  it("upserts device metadata without clearing displayName", async () => {
    const devices = [storedDevice({ displayName: "Work Laptop" })]
    const prisma = createPrisma(devices)
    const service = new LiveDeviceService(prisma as never, new LiveClientRegistry())

    await service.upsertFromHello({
      userId: "user-1",
      clientInstanceId: "client-a",
      deviceName: "MacBook Pro",
      platform: "darwin-arm64",
      appVersion: "0.2.254",
      seenAt: new Date("2026-06-07T10:02:00.000Z"),
    })

    expect(prisma.userDevice.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId_clientInstanceId: {
          userId: "user-1",
          clientInstanceId: "client-a",
        },
      },
      update: expect.objectContaining({
        deviceName: "MacBook Pro",
        appVersion: "0.2.254",
        lastSeenAt: new Date("2026-06-07T10:02:00.000Z"),
      }),
    }))
    expect(devices[0]?.displayName).toBe("Work Laptop")
  })

  it("lists user devices with offline status when registry is empty", async () => {
    const service = new LiveDeviceService(createPrisma([storedDevice()]) as never, new LiveClientRegistry())

    await expect(service.listUserDevices("user-1")).resolves.toEqual([
      expect.objectContaining({
        clientInstanceId: "client-a",
        effectiveName: "MacBook",
        status: "offline",
        userEmail: undefined,
      }),
    ])
  })

  it("merges persisted devices with current live status", async () => {
    const registry = new LiveClientRegistry()
    registry.register({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-a",
      appVersion: "0.2.254",
      platform: "darwin-arm64",
      deviceName: "MacBook Pro",
      now: new Date("2026-06-07T10:05:00.000Z"),
    })
    const service = new LiveDeviceService(createPrisma([storedDevice({ displayName: "Desk Mac" })]) as never, registry)

    await expect(service.listUserDevices("user-1")).resolves.toEqual([
      expect.objectContaining({
        deviceName: "MacBook Pro",
        displayName: "Desk Mac",
        effectiveName: "Desk Mac",
        status: "online",
        connectedAt: "2026-06-07T10:05:00.000Z",
        lastSeenAt: "2026-06-07T10:05:00.000Z",
      }),
    ])
  })

  it("lists all devices for admins with user email and pagination", async () => {
    const service = new LiveDeviceService(createPrisma([storedDevice()]) as never, new LiveClientRegistry())

    await expect(service.listAdminDevices({ page: 1, pageSize: 20, sortBy: "lastSeenAt", sortOrder: "desc" })).resolves.toMatchObject({
      data: [
        {
          userId: "user-1",
          userEmail: "user@example.com",
          clientInstanceId: "client-a",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
  })

  it("renames only a user's own device", async () => {
    const service = new LiveDeviceService(createPrisma([storedDevice()]) as never, new LiveClientRegistry())

    await expect(service.renameUserDevice("user-1", "client-a", "  Laptop  ")).resolves.toMatchObject({
      displayName: "Laptop",
      effectiveName: "Laptop",
    })
  })

  it("rejects unknown devices during rename", async () => {
    const service = new LiveDeviceService(createPrisma([]) as never, new LiveClientRegistry())

    await expect(service.renameUserDevice("user-1", "missing", "Laptop")).rejects.toBeInstanceOf(NotFoundException)
  })
})
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
pnpm --filter @synapse/server run test -- src/live/live-device.service.spec.ts
```

Expected: FAIL because `LiveDeviceService` does not exist.

- [ ] **Step 3: Implement LiveDeviceService**

Create `server/src/live/live-device.service.ts`:

```ts
import { Injectable, Logger, NotFoundException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import { parsePagination, toPrismaArgs, type PaginatedResponse, type PaginationQuery } from "../common/pagination"
import { PrismaService } from "../prisma/prisma.service"
import { LiveClientRegistry } from "./live-client-registry"
import type { LiveClientInstance, LiveClientPublicDto } from "./live.types"

export type DashboardDeviceRow = {
  readonly userId?: string
  readonly userEmail?: string
  readonly clientInstanceId: string
  readonly deviceName: string
  readonly displayName: string | null
  readonly effectiveName: string
  readonly status: "online" | "stale" | "offline"
  readonly platform: string
  readonly appVersion: string
  readonly firstSeenAt: string
  readonly lastSeenAt: string | null
  readonly connectedAt: string | null
  readonly disconnectedAt?: string
  readonly disconnectReason?: string
}

type UpsertDeviceInput = {
  readonly userId: string
  readonly clientInstanceId: string
  readonly deviceName: string
  readonly platform: string
  readonly appVersion: string
  readonly seenAt: Date
}

type StoredDevice = Prisma.UserDeviceGetPayload<{
  include: { user: { select: { email: true } } }
}>

const adminDeviceSortFields = ["lastSeenAt", "firstSeenAt", "deviceName", "platform", "appVersion"] as const

@Injectable()
export class LiveDeviceService {
  private readonly logger = new Logger(LiveDeviceService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: LiveClientRegistry,
  ) {}

  async upsertFromHello(input: UpsertDeviceInput): Promise<void> {
    await this.prisma.userDevice.upsert({
      where: {
        userId_clientInstanceId: {
          userId: input.userId,
          clientInstanceId: input.clientInstanceId,
        },
      },
      create: {
        userId: input.userId,
        clientInstanceId: input.clientInstanceId,
        deviceName: input.deviceName,
        platform: input.platform,
        appVersion: input.appVersion,
        firstSeenAt: input.seenAt,
        lastSeenAt: input.seenAt,
      },
      update: {
        deviceName: input.deviceName,
        platform: input.platform,
        appVersion: input.appVersion,
        lastSeenAt: input.seenAt,
      },
    })
  }

  async listUserDevices(userId: string): Promise<DashboardDeviceRow[]> {
    const devices = await this.prisma.userDevice.findMany({
      where: { userId },
      include: { user: { select: { email: true } } },
      orderBy: { lastSeenAt: "desc" },
    })
    return devices.map((device) => this.toDeviceRow(device, { includeUser: false }))
  }

  async listAdminDevices(
    page: PaginationQuery = parsePagination(
      { sortBy: "lastSeenAt", sortOrder: "desc" },
      { allowedSortFields: adminDeviceSortFields },
    ),
  ): Promise<PaginatedResponse<DashboardDeviceRow>> {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.userDevice.findMany({
        ...toPrismaArgs(page),
        include: { user: { select: { email: true } } },
      }),
      this.prisma.userDevice.count(),
    ])
    return {
      data: data.map((device) => this.toDeviceRow(device, { includeUser: true })),
      total,
      page: page.page,
      pageSize: page.pageSize,
    }
  }

  async renameUserDevice(userId: string, clientInstanceId: string, displayName: string): Promise<DashboardDeviceRow> {
    const trimmed = displayName.trim()
    const existing = await this.prisma.userDevice.findUnique({
      where: { userId_clientInstanceId: { userId, clientInstanceId } },
      include: { user: { select: { email: true } } },
    })
    if (!existing) {
      throw new NotFoundException("设备不存在。")
    }

    const updated = await this.prisma.userDevice.update({
      where: { userId_clientInstanceId: { userId, clientInstanceId } },
      data: { displayName: trimmed },
      include: { user: { select: { email: true } } },
    })

    this.logger.log({
      userId,
      clientInstanceId,
    }, "Dashboard user device renamed")

    return this.toDeviceRow(updated, { includeUser: false })
  }

  private toDeviceRow(device: StoredDevice, options: { readonly includeUser: boolean }): DashboardDeviceRow {
    const liveClient = this.findLiveClient(device.userId, device.clientInstanceId)
    const lastSeenAt = latestIso(device.lastSeenAt.toISOString(), liveClient?.lastSeenAt)
    const effectiveName = device.displayName?.trim() || liveClient?.deviceName || device.deviceName || "未命名设备"

    return {
      ...(options.includeUser ? { userId: device.userId, userEmail: device.user.email } : undefined),
      clientInstanceId: device.clientInstanceId,
      deviceName: liveClient?.deviceName ?? device.deviceName,
      displayName: device.displayName,
      effectiveName,
      status: liveClient?.status ?? "offline",
      platform: liveClient?.platform ?? device.platform,
      appVersion: liveClient?.appVersion ?? device.appVersion,
      firstSeenAt: device.firstSeenAt.toISOString(),
      lastSeenAt,
      connectedAt: liveClient?.connectedAt ?? null,
      ...(liveClient?.disconnectedAt ? { disconnectedAt: liveClient.disconnectedAt } : undefined),
      ...(liveClient?.disconnectReason ? { disconnectReason: liveClient.disconnectReason } : undefined),
    }
  }

  private findLiveClient(userId: string, clientInstanceId: string): LiveClientInstance | LiveClientPublicDto | undefined {
    return this.registry
      .listByUser(userId)
      .find((client) => client.clientInstanceId === clientInstanceId)
  }
}

function latestIso(left: string | null | undefined, right: string | null | undefined): string | null {
  if (!left) return right ?? null
  if (!right) return left
  return Date.parse(right) > Date.parse(left) ? right : left
}
```

- [ ] **Step 4: Run service tests**

Run:

```bash
pnpm --filter @synapse/server run test -- src/live/live-device.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/live/live-device.service.ts server/src/live/live-device.service.spec.ts
git commit -m "feat(server): add live device service"
```

## Task 3: Server API And Live Upsert Wiring

**Files:**

- Modify: `server/src/live/live.module.ts`
- Modify: `server/src/live/live-desktop.gateway.ts`
- Modify: `server/src/live/live-desktop.gateway.spec.ts`
- Modify: `server/src/live/live.controller.ts`
- Modify: `server/src/live/live.controller.spec.ts`
- Modify: `server/src/admin/admin.controller.ts`
- Modify: `server/src/admin/admin.controller.spec.ts`

- [ ] **Step 1: Write failing controller and gateway tests**

In `server/src/live/live.controller.spec.ts`, add:

```ts
it("returns current user's persisted devices", () => {
  const listUserDevices = vi.fn().mockReturnValue([{ clientInstanceId: "client-a" }])
  const controller = createController({} as never, {} as never, { listUserDevices } as never)

  expect(controller.listDashboardDevices({ user: { id: "user-1" } } as never)).toEqual([
    { clientInstanceId: "client-a" },
  ])
  expect(listUserDevices).toHaveBeenCalledWith("user-1")
})

it("renames current user's device", async () => {
  const renameUserDevice = vi.fn().mockResolvedValue({ clientInstanceId: "client-a", displayName: "Laptop" })
  const controller = createController({} as never, {} as never, { renameUserDevice } as never)

  await expect(controller.renameDashboardDevice(
    "client-a",
    { displayName: " Laptop " },
    { user: { id: "user-1" } } as never,
  )).resolves.toMatchObject({ displayName: "Laptop" })
  expect(renameUserDevice).toHaveBeenCalledWith("user-1", "client-a", "Laptop")
})

it("rejects invalid dashboard device rename requests", () => {
  const renameUserDevice = vi.fn()
  const controller = createController({} as never, {} as never, { renameUserDevice } as never)

  expect(() => controller.renameDashboardDevice("client-a", { displayName: "" }, { user: { id: "user-1" } } as never))
    .toThrow("设备名称无效")
  expect(renameUserDevice).not.toHaveBeenCalled()
})
```

Update the test helper in the same file to accept the device service:

```ts
function createController(
  query: Partial<LiveQueryService> = {},
  stream: Partial<LiveStreamService> = {},
  devices: Partial<LiveDeviceService> = {},
) {
  return new LiveController(query as LiveQueryService, stream as LiveStreamService, devices as LiveDeviceService)
}
```

In `server/src/live/live-desktop.gateway.spec.ts`, add or update a hello test to include:

```ts
const devices = { upsertFromHello: vi.fn().mockResolvedValue(undefined) }
const gateway = createLiveDesktopGatewayForTest({
  auth: auth as never,
  registry,
  streams,
  devices: devices as never,
  clock,
})

// after socket emits valid hello:
expect(devices.upsertFromHello).toHaveBeenCalledWith({
  userId: "user-1",
  clientInstanceId: "client-a",
  deviceName: "MacBook",
  platform: "darwin-arm64",
  appVersion: "0.2.253",
  seenAt: new Date("2026-06-06T10:00:00.000Z"),
})
```

In `server/src/admin/admin.controller.spec.ts`, extend the "records audit logs for sensitive admin read endpoints" service stub:

```ts
listDevices: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 }),
```

Then add after the existing list calls:

```ts
await controller.listDevices({}, request)
expect(record).toHaveBeenCalledWith(expect.objectContaining({
  action: "admin.devices.list",
  targetType: "device",
  targetId: "list",
}))
```

- [ ] **Step 2: Run failing focused tests**

Run:

```bash
pnpm --filter @synapse/server run test -- src/live/live.controller.spec.ts src/live/live-desktop.gateway.spec.ts src/admin/admin.controller.spec.ts
```

Expected: FAIL because controller/gateway signatures and routes are not wired.

- [ ] **Step 3: Register LiveDeviceService**

Modify `server/src/live/live.module.ts`:

```ts
import { LiveDeviceService } from "./live-device.service"
```

Add it to providers and exports:

```ts
providers: [
  LiveClientRegistry,
  LiveDesktopGateway,
  LiveDeviceService,
  LiveQueryService,
  LiveStreamService,
],
exports: [LiveDesktopGateway, LiveDeviceService],
```

- [ ] **Step 4: Wire LiveDesktopGateway upsert**

Modify `server/src/live/live-desktop.gateway.ts`:

```ts
import { LiveDeviceService } from "./live-device.service"
```

Extend `LiveDesktopGatewayTestInput`:

```ts
readonly devices?: LiveDeviceService
```

Add constructor dependency:

```ts
private readonly devices: LiveDeviceService,
```

Update `createForTest`:

```ts
const gateway = new LiveDesktopGateway(input.auth, input.registry, input.streams, input.devices ?? {
  upsertFromHello: async () => undefined,
} as LiveDeviceService)
```

Inside valid hello handling, after `const client = this.registry.register(...)` and before `registeredClient = client`:

```ts
void this.devices.upsertFromHello({
  userId: auth.userId,
  clientInstanceId: hello.clientInstanceId,
  deviceName: hello.deviceName,
  platform: hello.platform,
  appVersion: hello.appVersion,
  seenAt: new Date(client.connectedAt ?? this.clock.now().toISOString()),
}).catch((error: unknown) => {
  this.logger.warn({
    clientInstanceId: hello.clientInstanceId,
    errorName: error instanceof Error ? error.name : typeof error,
    userId: auth.userId,
  }, "Live device upsert failed")
})
```

- [ ] **Step 5: Add LiveController device endpoints**

Modify `server/src/live/live.controller.ts` imports:

```ts
import { Body, Controller, Get, Param, Patch, Req, Sse, UseGuards } from "@nestjs/common"
import { z } from "zod"
import { badRequestFromZodError } from "../common/zod-validation"
import { LiveDeviceService } from "./live-device.service"
```

Add schema:

```ts
const dashboardDeviceRenameSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
}).strict()
```

Add constructor dependency:

```ts
private readonly devices: LiveDeviceService,
```

Add normal-user endpoints:

```ts
@UseGuards(UserAuthGuard)
@Get("/api/dashboard/devices")
listDashboardDevices(@Req() request: AuthenticatedUserRequest) {
  return this.devices.listUserDevices(request.user!.id)
}

@UseGuards(UserAuthGuard)
@Patch("/api/dashboard/devices/:clientInstanceId")
renameDashboardDevice(
  @Param("clientInstanceId") clientInstanceId: string,
  @Body() body: unknown,
  @Req() request: AuthenticatedUserRequest,
) {
  const result = dashboardDeviceRenameSchema.safeParse(body)
  if (!result.success) {
    throw badRequestFromZodError(result.error, "设备名称无效。")
  }
  return this.devices.renameUserDevice(request.user!.id, clientInstanceId, result.data.displayName)
}
```

- [ ] **Step 6: Add AdminController audit wrapper for devices**

Do not add device listing to `AdminService`; `AdminController` reads devices through `LiveDeviceService`. `server/src/admin/admin.module.ts` already imports `LiveModule`, so no module import change is required.

Modify `server/src/admin/admin.controller.ts`:

```ts
import { LiveDeviceService } from "../live/live-device.service"
```

Add constructor dependency:

```ts
private readonly liveDevices: LiveDeviceService,
```

Update tests' `createController()` helper to pass a default stub for the third constructor arg:

```ts
return new AdminController(
  service as AdminService,
  { record: vi.fn().mockResolvedValue(undefined), ...auditLog } as AuditLogService,
  { listAdminDevices: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 }) } as never,
)
```

Add endpoint:

```ts
@Get("/devices")
async listDevices(@Query() query: Record<string, unknown>, @Req() request?: AdminRequest) {
  const pagination = parsePagination(query, { allowedSortFields: ["lastSeenAt", "firstSeenAt", "deviceName", "platform", "appVersion"] })
  const result = await this.liveDevices.listAdminDevices(pagination)
  await this.recordAdminRead(request, {
    action: "admin.devices.list",
    targetType: "device",
    targetId: "list",
    detail: { page: pagination.page, pageSize: pagination.pageSize },
  })
  return result
}
```

- [ ] **Step 7: Run focused server tests**

Run:

```bash
pnpm --filter @synapse/server run test -- src/live/live-device.service.spec.ts src/live/live.controller.spec.ts src/live/live-desktop.gateway.spec.ts src/admin/admin.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/live server/src/admin/admin.controller.ts server/src/admin/admin.controller.spec.ts
git commit -m "feat(server): expose dashboard device APIs"
```

## Task 4: Dashboard API And Device Utilities

**Files:**

- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/lib/api.test.ts`
- Create: `dashboard/src/lib/device-utils.ts`
- Create: `dashboard/src/lib/device-utils.test.ts`

- [ ] **Step 1: Write failing dashboard API tests**

In `dashboard/src/lib/api.test.ts`, add:

```ts
describe('dashboard device APIs', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockJsonResponse(payload: unknown) {
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    )
  }

  it('uses normal-user device endpoints', async () => {
    const fetchMock = mockJsonResponse({ ok: true })

    await dashboardApi.listDevices()
    await dashboardApi.renameDevice('client/a', { displayName: 'Laptop' })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/dashboard/devices',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/dashboard/devices/client%2Fa',
      expect.objectContaining({
        body: JSON.stringify({ displayName: 'Laptop' }),
        credentials: 'include',
        method: 'PATCH',
      })
    )
  })

  it('uses admin device list endpoint with pagination and sorting', async () => {
    const fetchMock = mockJsonResponse({ data: [], total: 0, page: 1, pageSize: 20 })

    await adminApi.listDevices({ page: 2, pageSize: 50, sortBy: 'lastSeenAt', sortOrder: 'desc' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/devices?page=2&pageSize=50&sortBy=lastSeenAt&sortOrder=desc',
      expect.objectContaining({ credentials: 'include' })
    )
  })
})
```

- [ ] **Step 2: Write failing device utility tests**

Create `dashboard/src/lib/device-utils.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DashboardDeviceRow, LiveClientChangedEvent } from './api'
import {
  deviceStatusLabels,
  getDeviceObservedAt,
  mergeDeviceSnapshot,
  upsertDeviceLiveEvent,
} from './device-utils'

function device(input: Partial<DashboardDeviceRow> = {}): DashboardDeviceRow {
  return {
    clientInstanceId: 'client-a',
    deviceName: 'MacBook',
    displayName: null,
    effectiveName: 'MacBook',
    status: 'offline',
    platform: 'darwin-arm64',
    appVersion: '0.2.253',
    firstSeenAt: '2026-06-07T09:00:00.000Z',
    lastSeenAt: '2026-06-07T10:00:00.000Z',
    connectedAt: null,
    ...input,
  }
}

function event(input: Partial<LiveClientChangedEvent['client']> = {}): LiveClientChangedEvent {
  return {
    type: 'live.client.changed',
    occurredAt: '2026-06-07T10:05:00.000Z',
    client: {
      userId: 'user-1',
      clientInstanceId: 'client-a',
      status: 'online',
      appVersion: '0.2.254',
      platform: 'darwin-arm64',
      deviceName: 'MacBook Pro',
      connectedAt: '2026-06-07T10:05:00.000Z',
      lastSeenAt: '2026-06-07T10:05:00.000Z',
      ...input,
    },
  }
}

describe('device utilities', () => {
  it('provides restrained status labels', () => {
    expect(deviceStatusLabels).toEqual({
      online: '在线',
      stale: '不稳定',
      offline: '离线',
    })
  })

  it('uses latest observed timestamp', () => {
    expect(getDeviceObservedAt(device({
      connectedAt: '2026-06-07T10:10:00.000Z',
      lastSeenAt: '2026-06-07T10:11:00.000Z',
    }))).toBe(Date.parse('2026-06-07T10:11:00.000Z'))
  })

  it('merges newer snapshots without losing newer local events', () => {
    const current = [device({ status: 'online', lastSeenAt: '2026-06-07T10:05:00.000Z' })]
    const snapshot = [device({ status: 'stale', lastSeenAt: '2026-06-07T10:02:00.000Z' })]

    expect(mergeDeviceSnapshot(current, snapshot)).toEqual([
      expect.objectContaining({ status: 'online' }),
    ])
  })

  it('upserts matching live events by client and user scope', () => {
    const updated = upsertDeviceLiveEvent(
      [device({ userId: 'user-1', displayName: 'Desk Mac', effectiveName: 'Desk Mac' })],
      event(),
      { scope: 'admin' }
    )

    expect(updated).toEqual([
      expect.objectContaining({
        deviceName: 'MacBook Pro',
        effectiveName: 'Desk Mac',
        status: 'online',
        appVersion: '0.2.254',
      }),
    ])
  })

  it('ignores admin live events without user id', () => {
    const current = [device({ userId: 'user-1' })]
    expect(upsertDeviceLiveEvent(current, event({ userId: undefined }), { scope: 'admin' })).toBe(current)
  })
})
```

- [ ] **Step 3: Run failing dashboard tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/lib/api.test.ts src/lib/device-utils.test.ts
```

Expected: FAIL because API methods and utilities do not exist.

- [ ] **Step 4: Add API types and methods**

Modify `dashboard/src/lib/api.ts` after `LiveClientChangedEvent`:

```ts
export type DashboardDeviceRow = {
  userId?: string
  userEmail?: string
  clientInstanceId: string
  deviceName: string
  displayName: string | null
  effectiveName: string
  status: 'online' | 'stale' | 'offline'
  platform: string
  appVersion: string
  firstSeenAt: string
  lastSeenAt: string | null
  connectedAt: string | null
  disconnectedAt?: string
  disconnectReason?: string
}
```

Add to `dashboardApi`:

```ts
listDevices: () =>
  request<DashboardDeviceRow[]>(`${dashboardApiBasePath}/devices`),
renameDevice: (clientInstanceId: string, input: { displayName: string }) =>
  request<DashboardDeviceRow>(
    `${dashboardApiBasePath}/devices/${encodeURIComponent(clientInstanceId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    }
  ),
```

Add to `adminApi`:

```ts
listDevices: (options: PaginationOptions = {}) =>
  request<PaginatedResponse<DashboardDeviceRow>>(
    `${adminApiBasePath}/devices${paginationSuffix(options)}`
  ),
```

- [ ] **Step 5: Add device utilities**

Create `dashboard/src/lib/device-utils.ts`:

```ts
import type { DashboardDeviceRow, LiveClientChangedEvent } from './api'

export const deviceStatusLabels: Record<DashboardDeviceRow['status'], string> = {
  online: '在线',
  stale: '不稳定',
  offline: '离线',
}

export const deviceStatusVariants: Record<
  DashboardDeviceRow['status'],
  'default' | 'secondary' | 'outline'
> = {
  online: 'default',
  stale: 'secondary',
  offline: 'outline',
}

export function mergeDeviceSnapshot(
  current: readonly DashboardDeviceRow[],
  snapshot: readonly DashboardDeviceRow[]
): DashboardDeviceRow[] {
  const byKey = new Map<string, DashboardDeviceRow>()

  for (const device of current) {
    byKey.set(getDeviceKey(device), device)
  }

  for (const device of snapshot) {
    const key = getDeviceKey(device)
    const existing = byKey.get(key)
    if (!existing || getDeviceObservedAt(device) > getDeviceObservedAt(existing)) {
      byKey.set(key, device)
    }
  }

  return Array.from(byKey.values())
}

export function upsertDeviceLiveEvent(
  current: readonly DashboardDeviceRow[],
  event: LiveClientChangedEvent,
  options: { readonly scope: 'admin' | 'user' }
): DashboardDeviceRow[] {
  const liveClient = event.client
  if (options.scope === 'admin' && !liveClient.userId) {
    return current as DashboardDeviceRow[]
  }

  const index = current.findIndex((device) =>
    device.clientInstanceId === liveClient.clientInstanceId &&
    (options.scope === 'user' || device.userId === liveClient.userId)
  )

  if (index === -1) {
    return current as DashboardDeviceRow[]
  }

  return current.map((device, deviceIndex) => {
    if (deviceIndex !== index) return device
    const effectiveName = device.displayName?.trim() || liveClient.deviceName || device.deviceName || '未命名设备'
    return {
      ...device,
      deviceName: liveClient.deviceName,
      effectiveName,
      status: liveClient.status,
      platform: liveClient.platform,
      appVersion: liveClient.appVersion,
      lastSeenAt: liveClient.lastSeenAt ?? device.lastSeenAt,
      connectedAt: liveClient.connectedAt,
      ...(liveClient.disconnectedAt ? { disconnectedAt: liveClient.disconnectedAt } : { disconnectedAt: undefined }),
      ...(liveClient.disconnectReason ? { disconnectReason: liveClient.disconnectReason } : { disconnectReason: undefined }),
    }
  })
}

export function getDeviceObservedAt(device: Pick<DashboardDeviceRow, 'connectedAt' | 'lastSeenAt' | 'disconnectedAt'>) {
  return Math.max(
    parseDeviceTime(device.connectedAt),
    parseDeviceTime(device.lastSeenAt),
    parseDeviceTime(device.disconnectedAt)
  )
}

function getDeviceKey(device: DashboardDeviceRow) {
  return `${device.userId ?? 'self'}:${device.clientInstanceId}`
}

function parseDeviceTime(value: string | null | undefined) {
  if (!value) return 0
  const time = Date.parse(value)
  return Number.isNaN(time) ? 0 : time
}
```

- [ ] **Step 6: Run focused dashboard tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/lib/api.test.ts src/lib/device-utils.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/lib/api.ts dashboard/src/lib/api.test.ts dashboard/src/lib/device-utils.ts dashboard/src/lib/device-utils.test.ts
git commit -m "feat(dashboard): add device API helpers"
```

## Task 5: Dashboard Navigation And Routes

**Files:**

- Modify: `dashboard/src/components/layout/data/sidebar-data.ts`
- Modify: `dashboard/src/components/layout/data/sidebar-data.test.ts`
- Create: `dashboard/src/routes/_authenticated/devices/index.tsx`
- Create: `dashboard/src/routes/_authenticated/my-devices/index.tsx`

- [ ] **Step 1: Write failing sidebar tests**

Modify `dashboard/src/components/layout/data/sidebar-data.test.ts`:

```ts
it('shows my devices for normal users and hides admin devices', () => {
  const data = getSidebarData({
    email: 'user@example.com',
    displayName: 'Ada Lovelace',
    modulePermissions: [],
    role: 'user',
    sessionId: 'session-1',
  })

  expect(collectUrls(data)).toContain('/my-devices')
  expect(collectUrls(data)).not.toContain('/devices')
})

it('shows admin devices for admins and hides my devices', () => {
  const data = getSidebarData({
    email: 'admin@example.com',
    displayName: null,
    modulePermissions: [],
    role: 'admin',
    sessionId: 'session-1',
  })

  expect(collectUrls(data)).toContain('/devices')
  expect(collectUrls(data)).not.toContain('/my-devices')
})
```

- [ ] **Step 2: Run failing sidebar tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/components/layout/data/sidebar-data.test.ts
```

Expected: FAIL because menu entries do not exist.

- [ ] **Step 3: Add menu entries**

Modify `dashboard/src/components/layout/data/sidebar-data.ts` imports:

```ts
import {
  LayoutDashboard,
  Users,
  Shield,
  Mail,
  FileText,
  HardDrive,
  ScrollText,
  Settings,
  Command,
  Webhook,
  MonitorSmartphone,
} from 'lucide-react'
```

Add admin item after `用户管理`:

```ts
{
  title: '设备',
  url: '/devices',
  icon: MonitorSmartphone,
},
```

Add normal user item after `Webhooks`:

```ts
{
  title: '我的设备',
  url: '/my-devices',
  icon: MonitorSmartphone,
},
```

- [ ] **Step 4: Add route files**

Create `dashboard/src/routes/_authenticated/devices/index.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import DevicesPage from '@/features/devices'
import { requireDashboardAdmin } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/devices/')({
  beforeLoad: requireDashboardAdmin,
  component: DevicesPage,
})
```

Create `dashboard/src/routes/_authenticated/my-devices/index.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import MyDevicesPage from '@/features/my-devices'
import { requireDashboardUser } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/my-devices/')({
  beforeLoad: requireDashboardUser,
  component: MyDevicesPage,
})
```

- [ ] **Step 5: Add temporary page modules for route generation**

Create `dashboard/src/features/devices/index.tsx`:

```tsx
export default function DevicesPage() {
  return null
}
```

Create `dashboard/src/features/my-devices/index.tsx`:

```tsx
export default function MyDevicesPage() {
  return null
}
```

- [ ] **Step 6: Run tests and typecheck to regenerate routes**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/components/layout/data/sidebar-data.test.ts
pnpm --filter @synapse/dashboard run tsc
```

Expected: PASS. TanStack route generation updates `dashboard/src/routeTree.gen.ts`.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/components/layout/data/sidebar-data.ts dashboard/src/components/layout/data/sidebar-data.test.ts dashboard/src/routes/_authenticated/devices/index.tsx dashboard/src/routes/_authenticated/my-devices/index.tsx dashboard/src/features/devices/index.tsx dashboard/src/features/my-devices/index.tsx dashboard/src/routeTree.gen.ts
git commit -m "feat(dashboard): add device routes"
```

## Task 6: Normal User My Devices Page

**Files:**

- Modify: `dashboard/src/features/my-devices/index.tsx`
- Modify: `dashboard/src/features/settings/profile-settings.tsx`

- [ ] **Step 1: Implement My Devices page**

Replace `dashboard/src/features/my-devices/index.tsx` with:

```tsx
import { useEffect, useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { dashboardApi, type DashboardDeviceRow } from '@/lib/api'
import {
  deviceStatusLabels,
  deviceStatusVariants,
  mergeDeviceSnapshot,
  upsertDeviceLiveEvent,
} from '@/lib/device-utils'
import {
  DataTableColumnHeader,
  ServerDataTable,
} from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const maxDeviceNameLength = 120
const pageSizeOptions = {
  initial: 20,
}

export default function MyDevicesPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(pageSizeOptions.initial)
  const [devices, setDevices] = useState<DashboardDeviceRow[]>([])
  const [renameTarget, setRenameTarget] = useState<DashboardDeviceRow | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['dashboard-devices'],
    queryFn: dashboardApi.listDevices,
  })

  useEffect(() => {
    if (data) {
      setDevices((current) => mergeDeviceSnapshot(current, data))
    }
  }, [data])

  useEffect(() => {
    return dashboardApi.subscribeLiveClients(
      (event) => setDevices((current) => upsertDeviceLiveEvent(current, event, { scope: 'user' })),
      () => {
        void queryClient.invalidateQueries({ queryKey: ['dashboard-devices'] })
      }
    )
  }, [queryClient])

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(devices.length / pageSize))
    if (page > pageCount) {
      setPage(pageCount)
    }
  }, [devices.length, page, pageSize])

  const renameDevice = useMutation({
    mutationFn: ({ clientInstanceId, displayName }: { clientInstanceId: string; displayName: string }) =>
      dashboardApi.renameDevice(clientInstanceId, { displayName }),
    onSuccess: (updated) => {
      setDevices((current) =>
        current.map((device) =>
          device.clientInstanceId === updated.clientInstanceId ? updated : device
        )
      )
      queryClient.setQueryData<DashboardDeviceRow[]>(['dashboard-devices'], (current) =>
        current?.map((device) =>
          device.clientInstanceId === updated.clientInstanceId ? updated : device
        ) ?? [updated]
      )
      setRenameTarget(null)
      toast.success('已保存')
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })

  function openRename(device: DashboardDeviceRow) {
    setRenameTarget(device)
    setRenameValue(device.displayName ?? device.deviceName)
  }

  function saveRename() {
    const trimmed = renameValue.trim()
    if (!renameTarget || trimmed.length === 0 || trimmed.length > maxDeviceNameLength) return
    renameDevice.mutate({
      clientInstanceId: renameTarget.clientInstanceId,
      displayName: trimmed,
    })
  }

  const renameInvalid = renameValue.trim().length === 0 || renameValue.trim().length > maxDeviceNameLength
  const columns: ColumnDef<DashboardDeviceRow>[] = [
    {
      accessorKey: 'effectiveName',
      header: ({ column }) => <DataTableColumnHeader column={column} title='设备' />,
      cell: ({ row }) => <span className='font-medium'>{row.original.effectiveName}</span>,
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title='状态' />,
      cell: ({ row }) => (
        <Badge variant={deviceStatusVariants[row.original.status]}>
          {deviceStatusLabels[row.original.status]}
        </Badge>
      ),
    },
    {
      accessorKey: 'platform',
      header: ({ column }) => <DataTableColumnHeader column={column} title='平台' />,
    },
    {
      accessorKey: 'appVersion',
      header: ({ column }) => <DataTableColumnHeader column={column} title='版本' />,
    },
    {
      accessorKey: 'lastSeenAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title='最近在线' />,
      cell: ({ row }) => formatDeviceTime(row.original.lastSeenAt),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <div className='flex justify-end'>
          <Button variant='ghost' className='h-8 px-2' onClick={() => openRename(row.original)}>
            重命名
          </Button>
        </div>
      ),
      meta: {
        thClassName: 'text-right',
        tdClassName: 'text-right',
      },
      enableSorting: false,
      enableHiding: false,
    },
  ]
  const pagedDevices = devices.slice((page - 1) * pageSize, page * pageSize)

  return (
    <>
      <Header>
        <h1 className='text-lg font-semibold'>我的设备</h1>
      </Header>
      <Main>
        {isLoading ? (
          <div className='text-muted-foreground'>加载中...</div>
        ) : (
          <ServerDataTable
            columns={columns}
            data={pagedDevices}
            page={page}
            pageSize={pageSize}
            total={devices.length}
            error={isError ? error : undefined}
            onRetry={() => void refetch()}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </Main>
      <Dialog open={renameTarget !== null} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名设备</DialogTitle>
          </DialogHeader>
          <div className='space-y-2'>
            <Label htmlFor='device-display-name'>名称</Label>
            <Input
              id='device-display-name'
              value={renameValue}
              maxLength={maxDeviceNameLength}
              onChange={(event) => setRenameValue(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setRenameTarget(null)}>取消</Button>
            <Button disabled={renameInvalid || renameDevice.isPending} onClick={saveRename}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function formatDeviceTime(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN')
}
```

- [ ] **Step 2: Remove embedded device list from profile settings**

Modify `dashboard/src/features/settings/profile-settings.tsx`:

- Remove `useEffect`, `LiveClientRow`, and imports from `@/features/users/live-client-utils`.
- Remove `liveClientsSessionId`, `liveClients`, `liveClientSnapshot`, `isLiveClientsLoading`, and all Live subscription effects.
- Remove the `<div className='space-y-3'>` block whose heading is `客户端`.
- Keep profile load, display name form, and admin empty state unchanged.

The resulting top-level imports should start like:

```tsx
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { dashboardApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
```

- [ ] **Step 3: Run dashboard typecheck**

Run:

```bash
pnpm --filter @synapse/dashboard run tsc
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/features/my-devices/index.tsx dashboard/src/features/settings/profile-settings.tsx
git commit -m "feat(dashboard): add my devices page"
```

## Task 7: Admin Devices Page And User Page Cleanup

**Files:**

- Modify: `dashboard/src/features/devices/index.tsx`
- Modify: `dashboard/src/features/users/index.tsx`
- Delete: `dashboard/src/features/users/user-live-clients-sheet.tsx`

- [ ] **Step 1: Implement admin Devices page**

Replace `dashboard/src/features/devices/index.tsx` with:

```tsx
import { useEffect, useState } from 'react'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi, type DashboardDeviceRow } from '@/lib/api'
import {
  deviceStatusLabels,
  deviceStatusVariants,
  upsertDeviceLiveEvent,
} from '@/lib/device-utils'
import {
  DataTableColumnHeader,
  ServerDataTable,
  getServerTableSortQuery,
} from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'

const pageSizeOptions = {
  initial: 20,
}

export default function DevicesPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(pageSizeOptions.initial)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'lastSeenAt', desc: true },
  ])
  const [devices, setDevices] = useState<DashboardDeviceRow[]>([])
  const queryClient = useQueryClient()
  const sortQuery = getServerTableSortQuery(sorting)

  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['admin-devices', page, pageSize, sortQuery],
    queryFn: () => adminApi.listDevices({ page, pageSize, ...sortQuery }),
  })

  useEffect(() => {
    if (data?.data) {
      setDevices(data.data)
    }
  }, [data])

  useEffect(() => {
    return adminApi.subscribeLiveClients(
      (event) => setDevices((current) => upsertDeviceLiveEvent(current, event, { scope: 'admin' })),
      () => {
        void queryClient.invalidateQueries({ queryKey: ['admin-devices'] })
      }
    )
  }, [queryClient])

  const columns: ColumnDef<DashboardDeviceRow>[] = [
    {
      accessorKey: 'userEmail',
      header: ({ column }) => <DataTableColumnHeader column={column} title='用户' />,
      cell: ({ row }) => row.original.userEmail ?? '-',
    },
    {
      accessorKey: 'effectiveName',
      header: ({ column }) => <DataTableColumnHeader column={column} title='设备' />,
      cell: ({ row }) => <span className='font-medium'>{row.original.effectiveName}</span>,
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title='状态' />,
      cell: ({ row }) => (
        <Badge variant={deviceStatusVariants[row.original.status]}>
          {deviceStatusLabels[row.original.status]}
        </Badge>
      ),
    },
    {
      accessorKey: 'platform',
      header: ({ column }) => <DataTableColumnHeader column={column} title='平台' />,
    },
    {
      accessorKey: 'appVersion',
      header: ({ column }) => <DataTableColumnHeader column={column} title='版本' />,
    },
    {
      accessorKey: 'lastSeenAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title='最近在线' />,
      cell: ({ row }) => formatDeviceTime(row.original.lastSeenAt),
    },
    {
      accessorKey: 'firstSeenAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title='首次登记' />,
      cell: ({ row }) => formatDeviceTime(row.original.firstSeenAt),
    },
  ]

  return (
    <>
      <Header>
        <h1 className='text-lg font-semibold'>设备</h1>
      </Header>
      <Main>
        {isLoading ? (
          <div className='text-muted-foreground'>加载中...</div>
        ) : (
          <ServerDataTable
            columns={columns}
            data={devices}
            page={page}
            pageSize={pageSize}
            total={data?.total ?? devices.length}
            error={isError ? error : undefined}
            onRetry={() => void refetch()}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            sorting={sorting}
            onSortingChange={setSorting}
          />
        )}
      </Main>
    </>
  )
}

function formatDeviceTime(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN')
}
```

- [ ] **Step 2: Remove user detail sheet action**

Modify `dashboard/src/features/users/index.tsx`:

- Remove import of `UserLiveClientsSheet`.
- Remove `liveClientsUser` state.
- Remove the `客户端` button in the actions cell.
- Remove `selectedUserLiveClients`.
- Remove the `<UserLiveClientsSheet ... />` JSX block.
- Keep `liveClients` state, `listLiveClients`, SSE subscription, and `客户端` aggregate column.

The actions cell should become:

```tsx
cell: ({ row }) => (
  <div className='flex justify-end gap-2'>
    <Button
      variant='ghost'
      className='h-8 px-2'
      onClick={() => void permissionEditor.open(row.original)}
    >
      模块权限
    </Button>
    <Button
      variant='ghost'
      className='h-8 px-2'
      onClick={() => handleToggle(row.original)}
    >
      {row.original.status === 'active' ? '禁用' : '启用'}
    </Button>
  </div>
),
```

- [ ] **Step 3: Delete unused sheet**

Delete:

```bash
dashboard/src/features/users/user-live-clients-sheet.tsx
```

- [ ] **Step 4: Run dashboard typecheck**

Run:

```bash
pnpm --filter @synapse/dashboard run tsc
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/features/devices/index.tsx dashboard/src/features/users/index.tsx
git rm dashboard/src/features/users/user-live-clients-sheet.tsx
git commit -m "feat(dashboard): add admin devices page"
```

## Task 8: Release Notes And Final Validation

**Files:**

- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update release notes**

Add this note under `## 新增功能` in `RELEASE_NOTES_PENDING.md`:

```md
- 管理后台新增一级设备入口：管理员可以查看全部用户设备在线状态，普通用户可以在“我的设备”里查看并重命名自己的设备；离线设备也会保留在列表中，方便识别历史连接过的客户端。
```

- [ ] **Step 2: Run focused server tests**

Run:

```bash
pnpm --filter @synapse/server run test -- src/live/live-device.service.spec.ts src/live/live.controller.spec.ts src/live/live-desktop.gateway.spec.ts src/admin/admin.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run focused dashboard tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/lib/api.test.ts src/lib/device-utils.test.ts src/components/layout/data/sidebar-data.test.ts src/lib/dashboard-route-guards.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run typechecks**

Run:

```bash
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/dashboard run tsc
```

Expected: PASS.

- [ ] **Step 5: Run hard constraints if desktop code was touched**

This plan does not touch `desktop/`. Skip this step unless implementation drifts into `desktop/`.

- [ ] **Step 6: Commit release notes**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note dashboard device pages"
```

- [ ] **Step 7: Final status check**

Run:

```bash
git status --short
```

Expected: no output.

## Self-Review Notes

Spec coverage:

- Role-specific menus and routes are covered in Task 5.
- Persistent historical devices are covered in Tasks 1 and 2.
- Live hello upsert is covered in Task 3.
- Admin read-only devices are covered in Tasks 3 and 7.
- Normal-user rename is covered in Tasks 2, 3, and 6.
- Settings extraction and user management cleanup are covered in Tasks 6 and 7.
- Release notes are covered in Task 8.

Type consistency:

- Server DTO name is `DashboardDeviceRow`.
- Dashboard API type is also `DashboardDeviceRow`.
- Device rename field is consistently `displayName`.
- Routes are consistently `/devices` and `/my-devices`.
