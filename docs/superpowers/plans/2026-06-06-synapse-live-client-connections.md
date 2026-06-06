# Synapse Live Client Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Synapse Live so logged-in desktop clients maintain authenticated WebSocket connections, reconnect politely, and expose per-device online state to administrators, normal users, and desktop settings.

**Architecture:** The server owns a single-instance `LiveModule` with an in-memory registry, `ws` desktop gateway, HTTP snapshot APIs, and SSE dashboard streams. The desktop Electron main process owns connection lifecycle and exposes local status through IPC. The dashboard keeps HTTP/SSE calls inside `dashboard/src/lib/api.ts` and renders compact status in existing settings/users surfaces.

**Tech Stack:** NestJS 11, Prisma-free runtime registry, `ws`, React 19, TanStack Query/Table, Electron main process services, shadcn/ui, TypeScript, Vitest.

---

## File Structure

Server files:

- Create `server/src/live/live.types.ts`: protocol, DTO, and status types shared inside the server live module.
- Create `server/src/live/live-client-registry.ts`: in-memory source of truth for connected client instances.
- Create `server/src/live/live-stream.service.ts`: admin/user-scoped server-sent event subscriptions.
- Create `server/src/live/live-query.service.ts`: snapshot DTO mapper for admin and user views.
- Create `server/src/live/live-desktop.gateway.ts`: `ws` upgrade handling and desktop protocol lifecycle.
- Create `server/src/live/live.controller.ts`: HTTP snapshot and SSE endpoints.
- Create `server/src/live/live.module.ts`: Nest module wiring.
- Create tests under `server/src/live/*.spec.ts`.
- Modify `server/src/app.module.ts`: import `LiveModule`.
- Modify `server/src/main.ts`: attach the Live desktop gateway to the Nest HTTP server before `app.listen`.
- Modify `server/package.json`: add `ws` and `@types/ws`.

Desktop files:

- Create `desktop/src/types/live.ts`: renderer-safe Live status/event types.
- Create `desktop/electron/services/live-client-id-store.ts`: stable `clientInstanceId` persistence.
- Create `desktop/electron/services/live-reconnect-policy.ts`: bounded jittered backoff.
- Create `desktop/electron/services/live-connection-service.ts`: WebSocket lifecycle in Electron main.
- Create `desktop/electron/modules/live/ipc.ts`: IPC API and event schemas.
- Create tests under `desktop/electron/services/__tests__/` and `desktop/electron/modules/live/__tests__/`.
- Modify `desktop/electron/services/account-service.ts`: expose safe access-token/base-url hooks for Live and notify Live on account state changes.
- Modify `desktop/electron/main.ts`: wire `liveConnectionService` to EventBus and AccountService.
- Modify `desktop/electron/bootstrap/ipc-registry.ts`: register the Live IPC module.
- Modify `desktop/electron/preload.ts`: expose `window.synapse.live`.
- Modify `desktop/src/types/bridge.ts`: add Live bridge shape.
- Modify `desktop/src/modules/settings/components/account-panel.tsx`: show server connection.
- Create `desktop/src/modules/settings/components/live-connection-panel.tsx`: small account settings row.

Dashboard files:

- Modify `dashboard/src/lib/api.ts`: add Live types, snapshot API methods, and EventSource stream subscriptions.
- Create `dashboard/src/features/users/live-client-utils.ts`: aggregate device counts/status labels for user table.
- Create `dashboard/src/features/users/user-live-clients-sheet.tsx`: admin client detail sheet.
- Modify `dashboard/src/features/users/index.tsx`: add `客户端` column and detail action.
- Create tests in `dashboard/src/features/users/live-client-utils.test.ts`.
- Modify `dashboard/src/features/settings/profile-settings.tsx`: add normal-user client list section.

Release notes:

- Modify `RELEASE_NOTES_PENDING.md`: add a user-facing note about Synapse Live connection status.

---

### Task 1: Server Live Types And Registry

**Files:**

- Create: `server/src/live/live.types.ts`
- Create: `server/src/live/live-client-registry.ts`
- Test: `server/src/live/live-client-registry.spec.ts`

- [ ] **Step 1: Write the failing registry tests**

Create `server/src/live/live-client-registry.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { LiveClientRegistry } from "./live-client-registry"

describe("LiveClientRegistry", () => {
  it("allows one user to keep multiple client instances online", () => {
    const registry = new LiveClientRegistry()
    const now = new Date("2026-06-06T10:00:00.000Z")

    registry.register({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-a",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
      now,
    })
    registry.register({
      userId: "user-1",
      clientInstanceId: "client-b",
      connectionId: "conn-b",
      appVersion: "0.2.253",
      platform: "win32-x64",
      deviceName: "Workstation",
      now,
    })

    expect(registry.listByUser("user-1").map((client) => client.clientInstanceId).sort()).toEqual([
      "client-a",
      "client-b",
    ])
    expect(registry.listByUser("user-1").every((client) => client.status === "online")).toBe(true)
  })

  it("supersedes the old connection for the same client instance", () => {
    const registry = new LiveClientRegistry()
    const onSupersede = vi.fn()

    registry.register({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-old",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
      now: new Date("2026-06-06T10:00:00.000Z"),
      onSupersede,
    })
    registry.register({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-new",
      appVersion: "0.2.254",
      platform: "darwin-arm64",
      deviceName: "MacBook Pro",
      now: new Date("2026-06-06T10:01:00.000Z"),
      onSupersede,
    })

    expect(onSupersede).toHaveBeenCalledWith("conn-old")
    expect(registry.listByUser("user-1")).toMatchObject([
      {
        clientInstanceId: "client-a",
        connectionId: "conn-new",
        appVersion: "0.2.254",
        deviceName: "MacBook Pro",
        status: "online",
      },
    ])
  })

  it("marks clients stale and offline by heartbeat age", () => {
    const registry = new LiveClientRegistry({
      heartbeatTimeoutMs: 30_000,
      staleGraceMs: 30_000,
    })

    registry.register({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-a",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
      now: new Date("2026-06-06T10:00:00.000Z"),
    })

    registry.markStaleClients(new Date("2026-06-06T10:00:31.000Z"))
    expect(registry.listByUser("user-1")[0]?.status).toBe("stale")

    registry.markStaleClients(new Date("2026-06-06T10:01:02.000Z"))
    expect(registry.listByUser("user-1")[0]).toMatchObject({
      status: "offline",
      connectionId: null,
      disconnectReason: "heartbeat_timeout",
    })
  })

  it("marks a specific connection offline on close", () => {
    const registry = new LiveClientRegistry()
    registry.register({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-a",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
      now: new Date("2026-06-06T10:00:00.000Z"),
    })

    registry.markDisconnected({
      connectionId: "conn-a",
      now: new Date("2026-06-06T10:02:00.000Z"),
      reason: "socket_close",
    })

    expect(registry.listByUser("user-1")[0]).toMatchObject({
      status: "offline",
      connectionId: null,
      disconnectedAt: "2026-06-06T10:02:00.000Z",
      disconnectReason: "socket_close",
    })
  })
})
```

- [ ] **Step 2: Run the failing registry tests**

Run:

```bash
pnpm --filter @synapse/server run test -- src/live/live-client-registry.spec.ts
```

Expected: FAIL because `server/src/live/live-client-registry.ts` does not exist.

- [ ] **Step 3: Add Live types**

Create `server/src/live/live.types.ts`:

```ts
export type LiveClientStatus = "online" | "stale" | "offline"

export type LiveClientDisconnectReason =
  | "socket_close"
  | "socket_error"
  | "heartbeat_timeout"
  | "superseded"
  | "auth_failed"

export interface LiveClientInstance {
  readonly userId: string
  readonly clientInstanceId: string
  readonly connectionId: string | null
  readonly status: LiveClientStatus
  readonly appVersion: string
  readonly platform: string
  readonly deviceName: string
  readonly connectedAt: string | null
  readonly lastSeenAt: string | null
  readonly disconnectedAt?: string
  readonly disconnectReason?: LiveClientDisconnectReason
}

export interface LiveClientPublicDto {
  readonly userId?: string
  readonly clientInstanceId: string
  readonly status: LiveClientStatus
  readonly appVersion: string
  readonly platform: string
  readonly deviceName: string
  readonly connectedAt: string | null
  readonly lastSeenAt: string | null
  readonly disconnectedAt?: string
  readonly disconnectReason?: LiveClientDisconnectReason
}

export interface LiveDesktopHello {
  readonly type: "hello"
  readonly clientInstanceId: string
  readonly appVersion: string
  readonly platform: string
  readonly deviceName: string
}

export interface LiveDesktopWelcome {
  readonly type: "welcome"
  readonly connectionId: string
  readonly serverTime: string
  readonly heartbeatIntervalMs: number
  readonly heartbeatTimeoutMs: number
}

export interface LiveDesktopPing {
  readonly type: "ping"
  readonly sentAt: string
}

export interface LiveDesktopPong {
  readonly type: "pong"
  readonly serverTime: string
}

export type LiveDesktopClientMessage = LiveDesktopHello | LiveDesktopPing
export type LiveDesktopServerMessage = LiveDesktopWelcome | LiveDesktopPong

export interface LiveClientChangedEvent {
  readonly type: "live.client.changed"
  readonly client: LiveClientPublicDto
  readonly occurredAt: string
}
```

- [ ] **Step 4: Implement the registry**

Create `server/src/live/live-client-registry.ts`:

```ts
import { Injectable } from "@nestjs/common"
import type {
  LiveClientDisconnectReason,
  LiveClientInstance,
} from "./live.types"

export interface LiveClientRegistryOptions {
  readonly heartbeatTimeoutMs?: number
  readonly staleGraceMs?: number
}

interface RegisterInput {
  readonly userId: string
  readonly clientInstanceId: string
  readonly connectionId: string
  readonly appVersion: string
  readonly platform: string
  readonly deviceName: string
  readonly now: Date
  readonly onSupersede?: (connectionId: string) => void
}

interface DisconnectInput {
  readonly connectionId: string
  readonly now: Date
  readonly reason: LiveClientDisconnectReason
}

const defaultHeartbeatTimeoutMs = 45_000
const defaultStaleGraceMs = 45_000

@Injectable()
export class LiveClientRegistry {
  private readonly heartbeatTimeoutMs: number
  private readonly staleGraceMs: number
  private readonly clientsByKey = new Map<string, LiveClientInstance>()
  private readonly keyByConnectionId = new Map<string, string>()

  constructor(options: LiveClientRegistryOptions = {}) {
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? defaultHeartbeatTimeoutMs
    this.staleGraceMs = options.staleGraceMs ?? defaultStaleGraceMs
  }

  register(input: RegisterInput): LiveClientInstance {
    const key = clientKey(input.userId, input.clientInstanceId)
    const previous = this.clientsByKey.get(key)
    if (previous?.connectionId && previous.connectionId !== input.connectionId) {
      this.keyByConnectionId.delete(previous.connectionId)
      input.onSupersede?.(previous.connectionId)
    }

    const nowIso = input.now.toISOString()
    const client: LiveClientInstance = {
      userId: input.userId,
      clientInstanceId: input.clientInstanceId,
      connectionId: input.connectionId,
      status: "online",
      appVersion: input.appVersion,
      platform: input.platform,
      deviceName: input.deviceName,
      connectedAt: nowIso,
      lastSeenAt: nowIso,
    }
    this.clientsByKey.set(key, client)
    this.keyByConnectionId.set(input.connectionId, key)
    return client
  }

  touch(connectionId: string, now: Date): LiveClientInstance | null {
    const key = this.keyByConnectionId.get(connectionId)
    if (!key) return null
    const client = this.clientsByKey.get(key)
    if (!client) return null
    const next: LiveClientInstance = {
      ...client,
      status: "online",
      lastSeenAt: now.toISOString(),
      disconnectedAt: undefined,
      disconnectReason: undefined,
    }
    this.clientsByKey.set(key, next)
    return next
  }

  markDisconnected(input: DisconnectInput): LiveClientInstance | null {
    const key = this.keyByConnectionId.get(input.connectionId)
    if (!key) return null
    const client = this.clientsByKey.get(key)
    if (!client || client.connectionId !== input.connectionId) return null
    this.keyByConnectionId.delete(input.connectionId)
    const next: LiveClientInstance = {
      ...client,
      connectionId: null,
      status: "offline",
      disconnectedAt: input.now.toISOString(),
      disconnectReason: input.reason,
    }
    this.clientsByKey.set(key, next)
    return next
  }

  markStaleClients(now: Date): LiveClientInstance[] {
    const changed: LiveClientInstance[] = []
    for (const [key, client] of this.clientsByKey) {
      if (!client.connectionId || !client.lastSeenAt) continue
      const age = now.getTime() - new Date(client.lastSeenAt).getTime()
      if (age > this.heartbeatTimeoutMs + this.staleGraceMs) {
        this.keyByConnectionId.delete(client.connectionId)
        const next = {
          ...client,
          connectionId: null,
          status: "offline" as const,
          disconnectedAt: now.toISOString(),
          disconnectReason: "heartbeat_timeout" as const,
        }
        this.clientsByKey.set(key, next)
        changed.push(next)
      } else if (age > this.heartbeatTimeoutMs && client.status !== "stale") {
        const next = { ...client, status: "stale" as const }
        this.clientsByKey.set(key, next)
        changed.push(next)
      }
    }
    return changed
  }

  listAll(): LiveClientInstance[] {
    return [...this.clientsByKey.values()].sort(compareClients)
  }

  listByUser(userId: string): LiveClientInstance[] {
    return this.listAll().filter((client) => client.userId === userId)
  }
}

function clientKey(userId: string, clientInstanceId: string): string {
  return `${userId}:${clientInstanceId}`
}

function compareClients(left: LiveClientInstance, right: LiveClientInstance): number {
  return `${left.userId}:${left.clientInstanceId}`.localeCompare(`${right.userId}:${right.clientInstanceId}`)
}
```

- [ ] **Step 5: Run the registry tests**

Run:

```bash
pnpm --filter @synapse/server run test -- src/live/live-client-registry.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/live/live.types.ts server/src/live/live-client-registry.ts server/src/live/live-client-registry.spec.ts
git commit -m "feat(server): add live client registry"
```

---

### Task 2: Server Live Query And Stream Services

**Files:**

- Create: `server/src/live/live-query.service.ts`
- Create: `server/src/live/live-stream.service.ts`
- Test: `server/src/live/live-query.service.spec.ts`
- Test: `server/src/live/live-stream.service.spec.ts`

- [ ] **Step 1: Write failing query service tests**

Create `server/src/live/live-query.service.spec.ts`:

```ts
import { describe, expect, it } from "vitest"
import { LiveClientRegistry } from "./live-client-registry"
import { LiveQueryService } from "./live-query.service"

describe("LiveQueryService", () => {
  it("returns admin client snapshots with user ids", () => {
    const registry = new LiveClientRegistry()
    registry.register({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-a",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
      now: new Date("2026-06-06T10:00:00.000Z"),
    })
    const service = new LiveQueryService(registry)

    expect(service.listAdminClients()).toEqual([
      expect.objectContaining({
        userId: "user-1",
        clientInstanceId: "client-a",
        status: "online",
      }),
    ])
  })

  it("returns user snapshots without leaking other users", () => {
    const registry = new LiveClientRegistry()
    registry.register({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-a",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
      now: new Date("2026-06-06T10:00:00.000Z"),
    })
    registry.register({
      userId: "user-2",
      clientInstanceId: "client-b",
      connectionId: "conn-b",
      appVersion: "0.2.253",
      platform: "win32-x64",
      deviceName: "Workstation",
      now: new Date("2026-06-06T10:00:00.000Z"),
    })
    const service = new LiveQueryService(registry)

    expect(service.listUserClients("user-1")).toEqual([
      expect.not.objectContaining({ userId: "user-2" }),
    ])
    expect(service.listUserClients("user-1")[0]).not.toHaveProperty("userId")
  })
})
```

- [ ] **Step 2: Write failing stream service tests**

Create `server/src/live/live-stream.service.spec.ts`:

```ts
import { firstValueFrom, take, toArray } from "rxjs"
import { describe, expect, it } from "vitest"
import { LiveStreamService } from "./live-stream.service"

describe("LiveStreamService", () => {
  it("streams every event to admins", async () => {
    const service = new LiveStreamService()
    const events = firstValueFrom(service.adminEvents().pipe(take(1), toArray()))

    service.publish({
      type: "live.client.changed",
      occurredAt: "2026-06-06T10:00:00.000Z",
      client: {
        userId: "user-1",
        clientInstanceId: "client-a",
        status: "online",
        appVersion: "0.2.253",
        platform: "darwin-arm64",
        deviceName: "MacBook",
        connectedAt: "2026-06-06T10:00:00.000Z",
        lastSeenAt: "2026-06-06T10:00:00.000Z",
      },
    })

    await expect(events).resolves.toHaveLength(1)
  })

  it("streams only matching user events to normal users", async () => {
    const service = new LiveStreamService()
    const events = firstValueFrom(service.userEvents("user-1").pipe(take(1), toArray()))

    service.publish({
      type: "live.client.changed",
      occurredAt: "2026-06-06T10:00:00.000Z",
      client: {
        userId: "user-2",
        clientInstanceId: "client-b",
        status: "online",
        appVersion: "0.2.253",
        platform: "win32-x64",
        deviceName: "Workstation",
        connectedAt: "2026-06-06T10:00:00.000Z",
        lastSeenAt: "2026-06-06T10:00:00.000Z",
      },
    })
    service.publish({
      type: "live.client.changed",
      occurredAt: "2026-06-06T10:00:01.000Z",
      client: {
        userId: "user-1",
        clientInstanceId: "client-a",
        status: "online",
        appVersion: "0.2.253",
        platform: "darwin-arm64",
        deviceName: "MacBook",
        connectedAt: "2026-06-06T10:00:01.000Z",
        lastSeenAt: "2026-06-06T10:00:01.000Z",
      },
    })

    await expect(events).resolves.toEqual([
      expect.objectContaining({
        client: expect.objectContaining({ clientInstanceId: "client-a" }),
      }),
    ])
  })
})
```

- [ ] **Step 3: Run the failing service tests**

Run:

```bash
pnpm --filter @synapse/server run test -- src/live/live-query.service.spec.ts src/live/live-stream.service.spec.ts
```

Expected: FAIL because query and stream services do not exist.

- [ ] **Step 4: Implement the query service**

Create `server/src/live/live-query.service.ts`:

```ts
import { Injectable } from "@nestjs/common"
import { LiveClientRegistry } from "./live-client-registry"
import type { LiveClientInstance, LiveClientPublicDto } from "./live.types"

@Injectable()
export class LiveQueryService {
  constructor(private readonly registry: LiveClientRegistry) {}

  listAdminClients(): LiveClientPublicDto[] {
    return this.registry.listAll().map((client) => toPublicDto(client, { includeUserId: true }))
  }

  listAdminUserClients(userId: string): LiveClientPublicDto[] {
    return this.registry.listByUser(userId).map((client) => toPublicDto(client, { includeUserId: true }))
  }

  listUserClients(userId: string): LiveClientPublicDto[] {
    return this.registry.listByUser(userId).map((client) => toPublicDto(client, { includeUserId: false }))
  }
}

export function toPublicDto(
  client: LiveClientInstance,
  options: { readonly includeUserId: boolean },
): LiveClientPublicDto {
  return {
    ...(options.includeUserId ? { userId: client.userId } : undefined),
    clientInstanceId: client.clientInstanceId,
    status: client.status,
    appVersion: client.appVersion,
    platform: client.platform,
    deviceName: client.deviceName,
    connectedAt: client.connectedAt,
    lastSeenAt: client.lastSeenAt,
    disconnectedAt: client.disconnectedAt,
    disconnectReason: client.disconnectReason,
  }
}
```

- [ ] **Step 5: Implement the stream service**

Create `server/src/live/live-stream.service.ts`:

```ts
import { Injectable } from "@nestjs/common"
import { filter, map, Observable, Subject } from "rxjs"
import type { LiveClientChangedEvent } from "./live.types"

@Injectable()
export class LiveStreamService {
  private readonly events = new Subject<LiveClientChangedEvent>()

  publish(event: LiveClientChangedEvent): void {
    this.events.next(event)
  }

  adminEvents(): Observable<LiveClientChangedEvent> {
    return this.events.asObservable()
  }

  userEvents(userId: string): Observable<LiveClientChangedEvent> {
    return this.events.asObservable().pipe(
      filter((event) => event.client.userId === userId),
      map((event) => ({
        ...event,
        client: {
          ...event.client,
          userId: undefined,
        },
      })),
    )
  }
}
```

- [ ] **Step 6: Run the service tests**

Run:

```bash
pnpm --filter @synapse/server run test -- src/live/live-query.service.spec.ts src/live/live-stream.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/live/live-query.service.ts server/src/live/live-query.service.spec.ts server/src/live/live-stream.service.ts server/src/live/live-stream.service.spec.ts
git commit -m "feat(server): add live query streams"
```

---

### Task 3: Server HTTP Snapshot And SSE APIs

**Files:**

- Create: `server/src/live/live.controller.ts`
- Create: `server/src/live/live.module.ts`
- Test: `server/src/live/live.controller.spec.ts`
- Modify: `server/src/app.module.ts`
- Modify: `server/src/app.module.spec.ts`

- [ ] **Step 1: Write failing controller tests**

Create `server/src/live/live.controller.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { LiveController } from "./live.controller"
import type { LiveQueryService } from "./live-query.service"
import type { LiveStreamService } from "./live-stream.service"

function createController(query: Partial<LiveQueryService> = {}, stream: Partial<LiveStreamService> = {}) {
  return new LiveController(query as LiveQueryService, stream as LiveStreamService)
}

describe("LiveController", () => {
  it("returns all live clients for admins", () => {
    const listAdminClients = vi.fn().mockReturnValue([{ userId: "user-1", clientInstanceId: "client-a" }])
    const controller = createController({ listAdminClients })

    expect(controller.listAdminClients()).toEqual([{ userId: "user-1", clientInstanceId: "client-a" }])
    expect(listAdminClients).toHaveBeenCalledWith()
  })

  it("returns one user's live clients for admins", () => {
    const listAdminUserClients = vi.fn().mockReturnValue([{ userId: "user-1", clientInstanceId: "client-a" }])
    const controller = createController({ listAdminUserClients })

    expect(controller.listAdminUserClients("user-1")).toEqual([{ userId: "user-1", clientInstanceId: "client-a" }])
    expect(listAdminUserClients).toHaveBeenCalledWith("user-1")
  })

  it("returns only current user's live clients for dashboard users", () => {
    const listUserClients = vi.fn().mockReturnValue([{ clientInstanceId: "client-a" }])
    const controller = createController({ listUserClients })

    expect(controller.listDashboardClients({ user: { id: "user-1" } } as never)).toEqual([{ clientInstanceId: "client-a" }])
    expect(listUserClients).toHaveBeenCalledWith("user-1")
  })
})
```

- [ ] **Step 2: Update AppModule test before implementation**

Modify `server/src/app.module.spec.ts`:

```ts
import { LiveModule } from "./live/live.module"
```

Add this assertion inside the existing test:

```ts
    expect(importsOf(AppModule)).toEqual(expect.arrayContaining([LiveModule]))
```

Add this helper at the bottom:

```ts
function importsOf(moduleType: object): unknown[] {
  return Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleType) ?? []
}
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
pnpm --filter @synapse/server run test -- src/live/live.controller.spec.ts src/app.module.spec.ts
```

Expected: FAIL because `LiveController` and `LiveModule` do not exist.

- [ ] **Step 4: Implement controller and module**

Create `server/src/live/live.controller.ts`:

```ts
import { Controller, Get, Param, Req, Sse, UseGuards } from "@nestjs/common"
import { map } from "rxjs"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import type { AdminRequest } from "../admin-auth/admin-auth.guard"
import { UserAuthGuard, type AuthenticatedUserRequest } from "../auth/user-auth.guard"
import { LiveQueryService } from "./live-query.service"
import { LiveStreamService } from "./live-stream.service"

@Controller()
export class LiveController {
  constructor(
    private readonly query: LiveQueryService,
    private readonly streams: LiveStreamService,
  ) {}

  @UseGuards(AdminAuthGuard)
  @Get("/api/admin/live-clients")
  listAdminClients() {
    return this.query.listAdminClients()
  }

  @UseGuards(AdminAuthGuard)
  @Get("/api/admin/users/:id/live-clients")
  listAdminUserClients(@Param("id") userId: string) {
    return this.query.listAdminUserClients(userId)
  }

  @UseGuards(AdminAuthGuard)
  @Sse("/api/admin/live/stream")
  adminStream(@Req() _request: AdminRequest) {
    return this.streams.adminEvents().pipe(map((event) => ({ type: event.type, data: event })))
  }

  @UseGuards(UserAuthGuard)
  @Get("/api/dashboard/live-clients")
  listDashboardClients(@Req() request: AuthenticatedUserRequest) {
    return this.query.listUserClients(request.user!.id)
  }

  @UseGuards(UserAuthGuard)
  @Sse("/api/dashboard/live/stream")
  dashboardStream(@Req() request: AuthenticatedUserRequest) {
    return this.streams.userEvents(request.user!.id).pipe(map((event) => ({ type: event.type, data: event })))
  }
}
```

Create `server/src/live/live.module.ts`:

```ts
import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { LiveClientRegistry } from "./live-client-registry"
import { LiveController } from "./live.controller"
import { LiveDesktopGateway } from "./live-desktop.gateway"
import { LiveQueryService } from "./live-query.service"
import { LiveStreamService } from "./live-stream.service"

@Module({
  imports: [AdminAuthModule, UserAuthModule],
  controllers: [LiveController],
  providers: [
    LiveClientRegistry,
    LiveDesktopGateway,
    LiveQueryService,
    LiveStreamService,
  ],
  exports: [LiveDesktopGateway],
})
export class LiveModule {}
```

Create a temporary `server/src/live/live-desktop.gateway.ts` skeleton so the module compiles until Task 4:

```ts
import { Injectable } from "@nestjs/common"

@Injectable()
export class LiveDesktopGateway {
  attach(): void {
    return
  }
}
```

- [ ] **Step 5: Import LiveModule in AppModule**

Modify `server/src/app.module.ts`:

```ts
import { LiveModule } from "./live/live.module"
```

Add `LiveModule` in the `imports` array after `UserAuthModule`:

```ts
    UserAuthModule,
    LiveModule,
    TeamsModule,
```

- [ ] **Step 6: Run controller and module tests**

Run:

```bash
pnpm --filter @synapse/server run test -- src/live/live.controller.spec.ts src/app.module.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/app.module.ts server/src/app.module.spec.ts server/src/live/live.controller.ts server/src/live/live.controller.spec.ts server/src/live/live.module.ts server/src/live/live-desktop.gateway.ts
git commit -m "feat(server): expose live client APIs"
```

---

### Task 4: Server Desktop WebSocket Gateway

**Files:**

- Modify: `server/package.json`
- Modify: `server/src/live/live-desktop.gateway.ts`
- Test: `server/src/live/live-desktop.gateway.spec.ts`
- Modify: `server/src/main.ts`

- [ ] **Step 1: Add dependency entries before implementation**

Modify `server/package.json`:

```json
"ws": "^8.20.0"
```

under `dependencies`, and:

```json
"@types/ws": "^8.18.1"
```

under `devDependencies`.

Run:

```bash
pnpm install --lockfile-only
```

Expected: `pnpm-lock.yaml` updates with `ws` for `@synapse/server`.

- [ ] **Step 2: Write gateway tests**

Create `server/src/live/live-desktop.gateway.spec.ts`:

```ts
import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import { LiveDesktopGateway, parseLiveDesktopMessage } from "./live-desktop.gateway"
import type { LiveClientRegistry } from "./live-client-registry"
import type { LiveStreamService } from "./live-stream.service"
import type { UserAuthService } from "../auth/user-auth.service"

class FakeSocket extends EventEmitter {
  readonly sent: string[] = []
  close = vi.fn()
  terminate = vi.fn()
  send(payload: string) {
    this.sent.push(payload)
  }
}

describe("parseLiveDesktopMessage", () => {
  it("parses a valid hello message", () => {
    expect(parseLiveDesktopMessage(JSON.stringify({
      type: "hello",
      clientInstanceId: "client-a",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
    }))).toMatchObject({ type: "hello", clientInstanceId: "client-a" })
  })

  it("returns null for invalid payloads", () => {
    expect(parseLiveDesktopMessage("{")).toBeNull()
    expect(parseLiveDesktopMessage(JSON.stringify({ type: "hello", clientInstanceId: "" }))).toBeNull()
  })
})

describe("LiveDesktopGateway", () => {
  it("registers a client after hello and responds to ping", async () => {
    const socket = new FakeSocket()
    const register = vi.fn().mockReturnValue({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-test",
      status: "online",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
      connectedAt: "2026-06-06T10:00:00.000Z",
      lastSeenAt: "2026-06-06T10:00:00.000Z",
    })
    const touch = vi.fn().mockReturnValue({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-test",
      status: "online",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
      connectedAt: "2026-06-06T10:00:00.000Z",
      lastSeenAt: "2026-06-06T10:00:01.000Z",
    })
    const publish = vi.fn()
    const gateway = new LiveDesktopGateway(
      { verifyAccessToken: vi.fn() } as unknown as UserAuthService,
      { register, touch, markDisconnected: vi.fn() } as unknown as LiveClientRegistry,
      { publish } as unknown as LiveStreamService,
      { randomId: () => "conn-test", now: () => new Date("2026-06-06T10:00:00.000Z") },
    )

    gateway.bindAuthenticatedSocket(socket as never, { userId: "user-1" })
    socket.emit("message", JSON.stringify({
      type: "hello",
      clientInstanceId: "client-a",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
    }))
    socket.emit("message", JSON.stringify({ type: "ping", sentAt: "2026-06-06T10:00:01.000Z" }))

    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-test",
    }))
    expect(touch).toHaveBeenCalledWith("conn-test", expect.any(Date))
    expect(socket.sent.map((item) => JSON.parse(item).type)).toEqual(["welcome", "pong"])
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: "live.client.changed" }))
  })
})
```

- [ ] **Step 3: Run failing gateway tests**

Run:

```bash
pnpm --filter @synapse/server run test -- src/live/live-desktop.gateway.spec.ts
```

Expected: FAIL because `parseLiveDesktopMessage` and real gateway behavior do not exist.

- [ ] **Step 4: Implement gateway**

Replace `server/src/live/live-desktop.gateway.ts` with:

```ts
import { randomUUID } from "node:crypto"
import type { Server as HttpServer, IncomingMessage } from "node:http"
import { Injectable, Logger } from "@nestjs/common"
import { WebSocketServer, WebSocket, RawData } from "ws"
import { UserAuthService } from "../auth/user-auth.service"
import { LiveClientRegistry } from "./live-client-registry"
import { LiveStreamService } from "./live-stream.service"
import { toPublicDto } from "./live-query.service"
import type {
  LiveClientInstance,
  LiveDesktopClientMessage,
  LiveDesktopHello,
  LiveDesktopServerMessage,
} from "./live.types"

interface GatewayClock {
  readonly randomId: () => string
  readonly now: () => Date
}

const heartbeatIntervalMs = 20_000
const heartbeatTimeoutMs = 45_000

@Injectable()
export class LiveDesktopGateway {
  private readonly logger = new Logger(LiveDesktopGateway.name)
  private server: WebSocketServer | null = null
  private readonly socketsByConnectionId = new Map<string, WebSocket>()

  constructor(
    private readonly auth: UserAuthService,
    private readonly registry: LiveClientRegistry,
    private readonly streams: LiveStreamService,
    private readonly clock: GatewayClock = { randomId: randomUUID, now: () => new Date() },
  ) {}

  attach(httpServer: HttpServer): void {
    if (this.server) return
    this.server = new WebSocketServer({ noServer: true })
    setInterval(() => {
      for (const client of this.registry.markStaleClients(this.clock.now())) {
        this.publish(client)
      }
    }, heartbeatTimeoutMs)
    httpServer.on("upgrade", (request, socket, head) => {
      if (upgradePath(request) !== "/api/live/desktop") return
      void this.authenticateUpgrade(request)
        .then((authResult) => {
          if (!authResult) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
            socket.destroy()
            return
          }
          this.server!.handleUpgrade(request, socket, head, (ws) => {
            this.bindAuthenticatedSocket(ws, authResult)
          })
        })
        .catch((error) => {
          this.logger.warn({ errorName: error instanceof Error ? error.name : typeof error }, "Live upgrade failed")
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
          socket.destroy()
        })
    })
  }

  bindAuthenticatedSocket(socket: WebSocket, auth: { readonly userId: string }): void {
    const connectionId = this.clock.randomId()
    let registered = false
    this.socketsByConnectionId.set(connectionId, socket)

    socket.on("message", (payload) => {
      const message = parseLiveDesktopMessage(payload)
      if (!message) {
        socket.close(1003, "invalid_message")
        return
      }
      if (message.type === "hello") {
        const client = this.registry.register({
          userId: auth.userId,
          clientInstanceId: message.clientInstanceId,
          connectionId,
          appVersion: message.appVersion,
          platform: message.platform,
          deviceName: message.deviceName,
          now: this.clock.now(),
          onSupersede: (oldConnectionId) => {
            this.socketsByConnectionId.get(oldConnectionId)?.close(1000, "superseded")
            this.socketsByConnectionId.delete(oldConnectionId)
          },
        })
        registered = true
        this.publish(client)
        sendJson(socket, {
          type: "welcome",
          connectionId,
          serverTime: this.clock.now().toISOString(),
          heartbeatIntervalMs,
          heartbeatTimeoutMs,
        })
        return
      }
      if (!registered) {
        socket.close(1008, "hello_required")
        return
      }
      const client = this.registry.touch(connectionId, this.clock.now())
      if (client) this.publish(client)
      sendJson(socket, { type: "pong", serverTime: this.clock.now().toISOString() })
    })

    socket.on("close", () => {
      this.socketsByConnectionId.delete(connectionId)
      const client = this.registry.markDisconnected({
        connectionId,
        now: this.clock.now(),
        reason: "socket_close",
      })
      if (client) this.publish(client)
    })

    socket.on("error", () => {
      this.socketsByConnectionId.delete(connectionId)
      const client = this.registry.markDisconnected({
        connectionId,
        now: this.clock.now(),
        reason: "socket_error",
      })
      if (client) this.publish(client)
    })
  }

  private async authenticateUpgrade(request: IncomingMessage): Promise<{ userId: string } | null> {
    const token = readBearerToken(request.headers.authorization)
    if (!token) return null
    const result = await this.auth.verifyAccessToken(token)
    return { userId: result.userId }
  }

  private publish(client: LiveClientInstance): void {
    this.streams.publish({
      type: "live.client.changed",
      occurredAt: this.clock.now().toISOString(),
      client: toPublicDto(client, { includeUserId: true }),
    })
  }
}

export function parseLiveDesktopMessage(payload: RawData | string): LiveDesktopClientMessage | null {
  const text = typeof payload === "string" ? payload : payload.toString("utf8")
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const record = parsed as Record<string, unknown>
  if (record.type === "ping" && typeof record.sentAt === "string") {
    return { type: "ping", sentAt: record.sentAt }
  }
  if (record.type !== "hello") return null
  const hello = {
    type: "hello",
    clientInstanceId: stringField(record.clientInstanceId),
    appVersion: stringField(record.appVersion),
    platform: stringField(record.platform),
    deviceName: stringField(record.deviceName),
  } satisfies LiveDesktopHello
  return hello.clientInstanceId && hello.appVersion && hello.platform && hello.deviceName ? hello : null
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function sendJson(socket: WebSocket, message: LiveDesktopServerMessage): void {
  socket.send(JSON.stringify(message))
}

function readBearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header
  const [scheme, token] = value?.split(/\s+/, 2) ?? []
  return scheme?.toLowerCase() === "bearer" && token ? token : null
}

function upgradePath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? "/", "http://localhost").pathname
  } catch {
    return "/"
  }
}
```

- [ ] **Step 5: Attach gateway in main.ts**

Modify `server/src/main.ts`:

```ts
import { LiveDesktopGateway } from "./live/live-desktop.gateway"
```

Replace:

```ts
  await app.listen(env.port)
```

with:

```ts
  app.get(LiveDesktopGateway).attach(app.getHttpServer())
  await app.listen(env.port)
```

- [ ] **Step 6: Run gateway tests and typecheck**

Run:

```bash
pnpm --filter @synapse/server run test -- src/live/live-desktop.gateway.spec.ts
pnpm --filter @synapse/server run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/package.json pnpm-lock.yaml server/src/main.ts server/src/live/live-desktop.gateway.ts server/src/live/live-desktop.gateway.spec.ts
git commit -m "feat(server): accept live desktop websockets"
```

---

### Task 5: Desktop Live Connection Core

**Files:**

- Create: `desktop/src/types/live.ts`
- Create: `desktop/electron/services/live-client-id-store.ts`
- Create: `desktop/electron/services/live-reconnect-policy.ts`
- Create: `desktop/electron/services/live-connection-service.ts`
- Test: `desktop/electron/services/__tests__/live-client-id-store.test.ts`
- Test: `desktop/electron/services/__tests__/live-reconnect-policy.test.ts`
- Test: `desktop/electron/services/__tests__/live-connection-service.test.ts`
- Modify: `desktop/electron/services/account-service.ts`

- [ ] **Step 1: Write failing desktop Live utility tests**

Create `desktop/electron/services/__tests__/live-reconnect-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createLiveReconnectDelay } from "../live-reconnect-policy"

describe("createLiveReconnectDelay", () => {
  it("caps reconnect delay and adds deterministic jitter", () => {
    const delay = createLiveReconnectDelay({ attempt: 20, random: () => 1 })

    expect(delay).toBe(156_000)
  })

  it("starts near two seconds", () => {
    const delay = createLiveReconnectDelay({ attempt: 0, random: () => 0 })

    expect(delay).toBe(2_000)
  })
})
```

Create `desktop/electron/services/__tests__/live-client-id-store.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { LiveClientIdStore } from "../live-client-id-store"

describe("LiveClientIdStore", () => {
  it("reuses an existing client instance id", async () => {
    const namespace = {
      getSingleton: vi.fn().mockResolvedValue({ clientInstanceId: "client-existing" }),
      setSingleton: vi.fn(),
    }
    const store = new LiveClientIdStore({ namespace: namespace as never, createId: () => "client-new" })

    await expect(store.getOrCreate()).resolves.toBe("client-existing")
    expect(namespace.setSingleton).not.toHaveBeenCalled()
  })

  it("creates and stores a new client instance id", async () => {
    const namespace = {
      getSingleton: vi.fn().mockResolvedValue(null),
      setSingleton: vi.fn().mockResolvedValue(undefined),
    }
    const store = new LiveClientIdStore({ namespace: namespace as never, createId: () => "client-new" })

    await expect(store.getOrCreate()).resolves.toBe("client-new")
    expect(namespace.setSingleton).toHaveBeenCalledWith({ clientInstanceId: "client-new" })
  })
})
```

- [ ] **Step 2: Run failing utility tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- electron/services/__tests__/live-reconnect-policy.test.ts electron/services/__tests__/live-client-id-store.test.ts
```

Expected: FAIL because Live utility files do not exist.

- [ ] **Step 3: Add renderer-safe Live types**

Create `desktop/src/types/live.ts`:

```ts
export type SynapseLiveStatus = "connected" | "reconnecting" | "disconnected" | "unauthenticated"

export type SynapseLiveServerClientStatus = "online" | "stale" | "offline"

export interface SynapseLiveState {
  readonly status: SynapseLiveStatus
  readonly clientInstanceId: string | null
  readonly connectedAt: string | null
  readonly lastSeenAt: string | null
  readonly lastError: string | null
}

export interface SynapseLiveStateChangedEvent {
  readonly state: SynapseLiveState
}

export interface SynapseLiveClient {
  readonly userId?: string
  readonly clientInstanceId: string
  readonly status: SynapseLiveServerClientStatus
  readonly appVersion: string
  readonly platform: string
  readonly deviceName: string
  readonly connectedAt: string | null
  readonly lastSeenAt: string | null
  readonly disconnectedAt?: string
  readonly disconnectReason?: string
}
```

- [ ] **Step 4: Implement reconnect policy**

Create `desktop/electron/services/live-reconnect-policy.ts`:

```ts
interface LiveReconnectDelayInput {
  readonly attempt: number
  readonly random?: () => number
}

const baseDelayMs = 2_000
const normalCapMs = 30_000
const longFailureCapMs = 120_000
const longFailureAttempt = 8
const jitterRatio = 0.3

export function createLiveReconnectDelay(input: LiveReconnectDelayInput): number {
  const random = input.random ?? Math.random
  const exponential = baseDelayMs * 2 ** Math.max(0, input.attempt)
  const cap = input.attempt >= longFailureAttempt ? longFailureCapMs : normalCapMs
  const capped = Math.min(exponential, cap)
  return Math.round(capped + capped * jitterRatio * random())
}
```

- [ ] **Step 5: Implement client id store**

Create `desktop/electron/services/live-client-id-store.ts`:

```ts
import { randomUUID } from "node:crypto"
import path from "node:path"
import { app, safeStorage } from "electron"
import { EncryptedJsonNamespace } from "../runtime/data-repo/backends/encrypted-json"

const LIVE_CLIENT_NAMESPACE = "core.live-client"

type PersistedLiveClient = {
  clientInstanceId?: string
}

type LiveClientIdStoreDeps = {
  readonly namespace?: EncryptedJsonNamespace<PersistedLiveClient>
  readonly createId?: () => string
}

function createNamespace(): EncryptedJsonNamespace<PersistedLiveClient> {
  return new EncryptedJsonNamespace<PersistedLiveClient>({
    name: LIVE_CLIENT_NAMESPACE,
    schemaVersion: 1,
    backend: "encrypted-json",
    filePath: path.join(app.getPath("userData"), "data-v1", `${LIVE_CLIENT_NAMESPACE}.bin`),
    safeStorage,
  })
}

export class LiveClientIdStore {
  private readonly namespace: EncryptedJsonNamespace<PersistedLiveClient>
  private readonly createId: () => string

  constructor(deps: LiveClientIdStoreDeps = {}) {
    this.namespace = deps.namespace ?? createNamespace()
    this.createId = deps.createId ?? randomUUID
  }

  async getOrCreate(): Promise<string> {
    const current = await this.namespace.getSingleton()
    const existing = current?.clientInstanceId?.trim()
    if (existing) return existing
    const clientInstanceId = this.createId()
    await this.namespace.setSingleton({ ...(current ?? {}), clientInstanceId })
    return clientInstanceId
  }
}
```

- [ ] **Step 6: Add account service hooks for Live**

Modify `desktop/electron/services/account-service.ts`:

Export the base URL helper near `apiBaseUrl`:

```ts
export function getAccountApiBaseUrl(isPackaged: boolean): string {
  return apiBaseUrl(isPackaged)
}
```

Add public methods inside `AccountService`:

```ts
  getAccessTokenForLive(): string | null {
    return this.accessToken
  }

  getApiBaseUrlForLive(): string {
    return apiBaseUrl(this.isPackaged)
  }
```

- [ ] **Step 7: Implement Live connection service**

Create `desktop/electron/services/live-connection-service.ts`:

```ts
import os from "node:os"
import { app } from "electron"
import WebSocket from "ws"
import type { SynapseAccountState } from "../../src/types/account"
import type { SynapseLiveState } from "../../src/types/live"
import type { EventBus } from "../runtime/event-bus"
import { createMainLogger } from "./log-store"
import { createLiveReconnectDelay } from "./live-reconnect-policy"
import { LiveClientIdStore } from "./live-client-id-store"
import type { AccountService } from "./account-service"

const logger = createMainLogger("service.live")

type LiveConnectionServiceDeps = {
  readonly accountService: AccountService
  readonly clientIdStore?: LiveClientIdStore
  readonly createSocket?: (url: string, options: { headers: Record<string, string> }) => WebSocket
  readonly setTimeout?: typeof setTimeout
  readonly clearTimeout?: typeof clearTimeout
}

export class LiveConnectionService {
  private readonly accountService: AccountService
  private readonly clientIdStore: LiveClientIdStore
  private readonly createSocket: (url: string, options: { headers: Record<string, string> }) => WebSocket
  private readonly setTimer: typeof setTimeout
  private readonly clearTimer: typeof clearTimeout
  private eventBus: EventBus | null = null
  private socket: WebSocket | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private reconnectAttempt = 0
  private state: SynapseLiveState = {
    status: "unauthenticated",
    clientInstanceId: null,
    connectedAt: null,
    lastSeenAt: null,
    lastError: null,
  }

  constructor(deps: LiveConnectionServiceDeps) {
    this.accountService = deps.accountService
    this.clientIdStore = deps.clientIdStore ?? new LiveClientIdStore()
    this.createSocket = deps.createSocket ?? ((url, options) => new WebSocket(url, options))
    this.setTimer = deps.setTimeout ?? setTimeout
    this.clearTimer = deps.clearTimeout ?? clearTimeout
  }

  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus
  }

  getState(): SynapseLiveState {
    return this.state
  }

  handleAccountState(state: SynapseAccountState): void {
    if (state.status !== "authenticated") {
      this.close("unauthenticated")
      this.setState({ status: "unauthenticated", clientInstanceId: null, connectedAt: null, lastSeenAt: null, lastError: null })
      return
    }
    void this.connect()
  }

  async connect(): Promise<void> {
    const accessToken = this.accountService.getAccessTokenForLive()
    if (!accessToken) {
      await this.accountService.refreshFromStorage()
      const refreshedToken = this.accountService.getAccessTokenForLive()
      if (!refreshedToken) {
        this.setState({ ...this.state, status: "unauthenticated", lastError: "账号未登录" })
        return
      }
    }
    const token = this.accountService.getAccessTokenForLive()
    if (!token) return
    const clientInstanceId = await this.clientIdStore.getOrCreate()
    const url = liveSocketUrl(this.accountService.getApiBaseUrlForLive())
    this.close("reconnect")
    this.setState({ ...this.state, status: "reconnecting", clientInstanceId })
    const socket = this.createSocket(url, { headers: { Authorization: `Bearer ${token}` } })
    this.socket = socket

    socket.on("open", () => {
      const now = new Date().toISOString()
      this.reconnectAttempt = 0
      this.setState({ status: "connected", clientInstanceId, connectedAt: now, lastSeenAt: now, lastError: null })
      socket.send(JSON.stringify({
        type: "hello",
        clientInstanceId,
        appVersion: app.getVersion(),
        platform: `${process.platform}-${process.arch}`,
        deviceName: os.hostname(),
      }))
    })
    socket.on("message", (payload) => {
      this.handleMessage(String(payload))
    })
    socket.on("close", () => {
      if (this.socket === socket) this.scheduleReconnect("连接已断开")
    })
    socket.on("error", (error) => {
      logger.warn("Live socket error.", { errorName: error instanceof Error ? error.name : typeof error })
      if (this.socket === socket) this.scheduleReconnect("连接失败")
    })
  }

  close(reason = "closed"): void {
    if (this.reconnectTimer) {
      this.clearTimer(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.heartbeatTimer) {
      this.clearTimer(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.socket) {
      const socket = this.socket
      this.socket = null
      socket.close(1000, reason)
    }
  }

  private handleMessage(payload: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      return
    }
    if (!parsed || typeof parsed !== "object") return
    const type = (parsed as Record<string, unknown>).type
    if (type === "welcome") {
      const interval = Number((parsed as Record<string, unknown>).heartbeatIntervalMs)
      this.startHeartbeat(Number.isFinite(interval) && interval > 0 ? interval : 20_000)
      this.setState({ ...this.state, status: "connected", lastSeenAt: new Date().toISOString(), lastError: null })
      return
    }
    if (type === "pong") {
      this.setState({ ...this.state, status: "connected", lastSeenAt: new Date().toISOString(), lastError: null })
    }
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeatTimer) this.clearTimer(this.heartbeatTimer)
    this.heartbeatTimer = this.setTimer(() => {
      this.heartbeatTimer = null
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: "ping", sentAt: new Date().toISOString() }))
        this.startHeartbeat(intervalMs)
      }
    }, intervalMs)
  }

  private scheduleReconnect(error: string): void {
    if (this.state.status === "unauthenticated") return
    this.socket = null
    const delay = createLiveReconnectDelay({ attempt: this.reconnectAttempt })
    this.reconnectAttempt += 1
    this.setState({ ...this.state, status: "reconnecting", lastError: error })
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delay)
  }

  private setState(nextState: SynapseLiveState): void {
    this.state = nextState
    this.eventBus?.emit({
      domain: "live",
      type: "live.stateChanged",
      payload: { state: nextState },
      timestamp: new Date().toISOString(),
    })
  }
}

function liveSocketUrl(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = "/api/live/desktop"
  url.search = ""
  return url.toString()
}
```

- [ ] **Step 8: Write Live connection service test**

Create `desktop/electron/services/__tests__/live-connection-service.test.ts` with a fake socket EventEmitter:

```ts
import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import { LiveConnectionService } from "../live-connection-service"

class FakeSocket extends EventEmitter {
  readonly sent: string[] = []
  close = vi.fn()
  send(payload: string) {
    this.sent.push(payload)
  }
}

describe("LiveConnectionService", () => {
  it("connects after authenticated account state", async () => {
    const socket = new FakeSocket()
    const accountService = {
      getAccessTokenForLive: vi.fn().mockReturnValue("access-token"),
      getApiBaseUrlForLive: vi.fn().mockReturnValue("http://localhost:3000/api"),
      refreshFromStorage: vi.fn(),
    }
    const service = new LiveConnectionService({
      accountService: accountService as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket: vi.fn(() => socket as never),
    })

    service.handleAccountState({
      status: "authenticated",
      profile: {
        user: { id: "user-1", email: "u@example.com", displayName: null, status: "active" },
        teams: [],
        syncedAt: "2026-06-06T10:00:00.000Z",
      },
    })
    await Promise.resolve()
    socket.emit("open")

    expect(service.getState()).toMatchObject({ status: "connected", clientInstanceId: "client-a" })
    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({ type: "hello", clientInstanceId: "client-a" })
  })

  it("closes the socket when account becomes unauthenticated", async () => {
    const socket = new FakeSocket()
    const service = new LiveConnectionService({
      accountService: {
        getAccessTokenForLive: vi.fn().mockReturnValue("access-token"),
        getApiBaseUrlForLive: vi.fn().mockReturnValue("http://localhost:3000/api"),
        refreshFromStorage: vi.fn(),
      } as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket: vi.fn(() => socket as never),
    })

    service.handleAccountState({
      status: "authenticated",
      profile: {
        user: { id: "user-1", email: "u@example.com", displayName: null, status: "active" },
        teams: [],
        syncedAt: "2026-06-06T10:00:00.000Z",
      },
    })
    await Promise.resolve()
    service.handleAccountState({ status: "unauthenticated" })

    expect(socket.close).toHaveBeenCalled()
    expect(service.getState().status).toBe("unauthenticated")
  })
})
```

- [ ] **Step 9: Run desktop Live service tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- electron/services/__tests__/live-reconnect-policy.test.ts electron/services/__tests__/live-client-id-store.test.ts electron/services/__tests__/live-connection-service.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add desktop/src/types/live.ts desktop/electron/services/account-service.ts desktop/electron/services/live-client-id-store.ts desktop/electron/services/live-reconnect-policy.ts desktop/electron/services/live-connection-service.ts desktop/electron/services/__tests__/live-client-id-store.test.ts desktop/electron/services/__tests__/live-reconnect-policy.test.ts desktop/electron/services/__tests__/live-connection-service.test.ts
git commit -m "feat(desktop): add live connection service"
```

---

### Task 6: Desktop Live IPC And Settings UI

**Files:**

- Create: `desktop/electron/modules/live/ipc.ts`
- Test: `desktop/electron/modules/live/__tests__/ipc.test.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/main.ts`
- Create: `desktop/src/modules/settings/components/live-connection-panel.tsx`
- Modify: `desktop/src/modules/settings/components/account-panel.tsx`
- Test: `desktop/src/modules/settings/components/__tests__/live-connection-panel.test.tsx`

- [ ] **Step 1: Write failing IPC module test**

Create `desktop/electron/modules/live/__tests__/ipc.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { liveIpcModule } from "../ipc"

describe("liveIpcModule", () => {
  it("declares live invoke and event channels", () => {
    expect(liveIpcModule.id).toBe("live")
    expect(liveIpcModule.methods.getState.channel).toBe("synapse:live:get-state")
    expect(liveIpcModule.events.stateChanged.channel).toBe("synapse:events:live")
  })

  it("validates live state changed events", () => {
    expect(() => liveIpcModule.events.stateChanged.payload.parse({
      domain: "live",
      type: "live.stateChanged",
      payload: {
        state: {
          status: "connected",
          clientInstanceId: "client-a",
          connectedAt: "2026-06-06T10:00:00.000Z",
          lastSeenAt: "2026-06-06T10:00:01.000Z",
          lastError: null,
        },
      },
      timestamp: "2026-06-06T10:00:01.000Z",
    })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run failing IPC test**

Run:

```bash
pnpm --filter @synapse/desktop run test -- electron/modules/live/__tests__/ipc.test.ts
```

Expected: FAIL because Live IPC module does not exist.

- [ ] **Step 3: Implement Live IPC module**

Create `desktop/electron/modules/live/ipc.ts`:

```ts
import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import { liveConnectionService } from "../../services/live-connection-service-instance"

const liveStateSchema = z.object({
  status: z.enum(["connected", "reconnecting", "disconnected", "unauthenticated"]),
  clientInstanceId: z.string().nullable(),
  connectedAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  lastError: z.string().nullable(),
})

const liveStateChangedDomainEventSchema = z.object({
  domain: z.literal("live"),
  type: z.literal("live.stateChanged"),
  payload: z.object({ state: liveStateSchema }),
  timestamp: z.string(),
})

export const liveIpcModule: IpcModule = {
  id: "live",
  methods: {
    getState: {
      kind: "invoke",
      channel: "synapse:live:get-state",
      request: z.void(),
      response: liveStateSchema,
      handler: async () => liveConnectionService.getState(),
    },
  },
  events: {
    stateChanged: {
      kind: "event",
      channel: "synapse:events:live",
      payload: liveStateChangedDomainEventSchema,
    },
  },
}
```

Create `desktop/electron/services/live-connection-service-instance.ts`:

```ts
import { accountService } from "./account-service"
import { LiveConnectionService } from "./live-connection-service"

export const liveConnectionService = new LiveConnectionService({ accountService })
```

- [ ] **Step 4: Register IPC and expose bridge**

Modify `desktop/electron/bootstrap/ipc-registry.ts`:

```ts
import { liveIpcModule } from "../modules/live/ipc"
```

Register it beside `accountIpcModule`:

```ts
  registry.register(liveIpcModule, ctx)
```

Modify `desktop/electron/preload.ts` by adding a `live` bridge object beside `account`:

```ts
    live: {
      getState: () => ipcRenderer.invoke("synapse:live:get-state"),
      onStateChanged: (listener) => subscribeValidatedEvent(
        "synapse:events:live",
        listener,
      ),
    },
```

Modify `desktop/src/types/bridge.ts`:

```ts
import type {
  SynapseLiveState,
  SynapseLiveStateChangedEvent,
} from "./live"
```

Add to the bridge interface:

```ts
  live?: {
    getState: () => Promise<SynapseLiveState>
    onStateChanged: (listener: (event: SynapseLiveStateChangedEvent) => void) => () => void
  }
```

- [ ] **Step 5: Wire main process Live service**

Modify `desktop/electron/main.ts`:

```ts
import { liveConnectionService } from "./services/live-connection-service-instance"
```

After `accountService.setEventBus(eventBus)` add:

```ts
      liveConnectionService.setEventBus(eventBus)
      accountService.onStateChanged((state) => {
        liveConnectionService.handleAccountState(state)
      })
```

After a successful startup refresh, explicitly feed the current account state:

```ts
        void accountService.refreshFromStorage().then((state) => {
          liveConnectionService.handleAccountState(state)
        })
```

Use this in place of the existing bare `void accountService.refreshFromStorage()` call.

- [ ] **Step 6: Write settings panel render test**

Create `desktop/src/modules/settings/components/__tests__/live-connection-panel.test.tsx`:

```ts
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { LiveConnectionPanel } from "../live-connection-panel"

describe("LiveConnectionPanel", () => {
  it("renders connected state", () => {
    const html = renderToStaticMarkup(
      <LiveConnectionPanel
        state={{
          status: "connected",
          clientInstanceId: "client-a",
          connectedAt: "2026-06-06T10:00:00.000Z",
          lastSeenAt: "2026-06-06T10:00:01.000Z",
          lastError: null,
        }}
      />,
    )

    expect(html).toContain("服务器连接")
    expect(html).toContain("已连接")
  })
})
```

- [ ] **Step 7: Implement settings panel**

Create `desktop/src/modules/settings/components/live-connection-panel.tsx`:

```tsx
import { useEffect, useState } from "react"
import { Wifi, WifiOff } from "lucide-react"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { SettingsFieldRow } from "@/modules/settings/components/settings-field-row"
import { SettingsGroup } from "@/modules/settings/components/settings-group"
import { StatusPill } from "@/modules/settings/components/status-pill"
import type { SynapseLiveState } from "@/types/live"

const defaultState: SynapseLiveState = {
  status: "unauthenticated",
  clientInstanceId: null,
  connectedAt: null,
  lastSeenAt: null,
  lastError: null,
}

function liveStatusLabel(status: SynapseLiveState["status"]): string {
  if (status === "connected") return "已连接"
  if (status === "reconnecting") return "重连中"
  if (status === "disconnected") return "未连接"
  return "未登录"
}

function LiveConnectionPanel(props: { readonly state?: SynapseLiveState }) {
  const [state, setState] = useState<SynapseLiveState>(props.state ?? defaultState)

  useEffect(() => {
    if (props.state) return
    const bridge = getSynapseBridge()
    if (!bridge?.live) return
    let cancelled = false
    void bridge.live.getState().then((nextState) => {
      if (!cancelled) setState(nextState)
    })
    const unsubscribe = bridge.live.onStateChanged((event) => setState(event.state))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [props.state])

  const active = state.status === "connected"
  const Icon = active ? Wifi : WifiOff

  return (
    <SettingsGroup>
      <SettingsFieldRow label="服务器连接">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <StatusPill
            active={active}
            activeLabel={liveStatusLabel(state.status)}
            inactiveLabel={liveStatusLabel(state.status)}
          />
        </div>
        {state.lastError ? (
          <p className="mt-2 text-sm text-muted-foreground">{state.lastError}</p>
        ) : null}
      </SettingsFieldRow>
    </SettingsGroup>
  )
}

export { LiveConnectionPanel }
```

Modify `desktop/src/modules/settings/components/account-panel.tsx`:

```tsx
import { LiveConnectionPanel } from "@/modules/settings/components/live-connection-panel"
```

Render under `AccountUserControl`:

```tsx
      <LiveConnectionPanel />
```

- [ ] **Step 8: Generate IPC, run tests and typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
pnpm --filter @synapse/desktop run test -- electron/modules/live/__tests__/ipc.test.ts src/modules/settings/components/__tests__/live-connection-panel.test.tsx
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/generated/ipc-channels.generated.ts desktop/electron/bootstrap/ipc-registry.ts desktop/electron/main.ts desktop/electron/modules/live desktop/electron/preload.ts desktop/electron/services/live-connection-service-instance.ts desktop/src/types/bridge.ts desktop/src/types/live.ts desktop/src/modules/settings/components/account-panel.tsx desktop/src/modules/settings/components/live-connection-panel.tsx desktop/src/modules/settings/components/__tests__/live-connection-panel.test.tsx
git commit -m "feat(desktop): show live connection status"
```

---

### Task 7: Dashboard Live API, Stream Subscriptions, And User Table Aggregates

**Files:**

- Modify: `dashboard/src/lib/api.ts`
- Create: `dashboard/src/features/users/live-client-utils.ts`
- Test: `dashboard/src/features/users/live-client-utils.test.ts`
- Create: `dashboard/src/features/users/user-live-clients-sheet.tsx`
- Modify: `dashboard/src/features/users/index.tsx`

- [ ] **Step 1: Write failing aggregate tests**

Create `dashboard/src/features/users/live-client-utils.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { getLiveClientSummary } from './live-client-utils'
import type { LiveClientRow } from '@/lib/api'

describe('getLiveClientSummary', () => {
  it('counts online clients for a user', () => {
    const clients: LiveClientRow[] = [
      client({ userId: 'user-1', clientInstanceId: 'client-a', status: 'online' }),
      client({ userId: 'user-1', clientInstanceId: 'client-b', status: 'offline' }),
      client({ userId: 'user-2', clientInstanceId: 'client-c', status: 'online' }),
    ]

    expect(getLiveClientSummary('user-1', clients)).toEqual({
      label: '1 台在线',
      onlineCount: 1,
      totalCount: 2,
      hasStale: false,
    })
  })

  it('shows offline when no client is online', () => {
    expect(getLiveClientSummary('user-1', [
      client({ userId: 'user-1', clientInstanceId: 'client-a', status: 'offline' }),
    ])).toMatchObject({ label: '离线', onlineCount: 0, totalCount: 1 })
  })
})

function client(input: Pick<LiveClientRow, 'userId' | 'clientInstanceId' | 'status'>): LiveClientRow {
  return {
    ...input,
    appVersion: '0.2.253',
    platform: 'darwin-arm64',
    deviceName: 'MacBook',
    connectedAt: null,
    lastSeenAt: null,
  }
}
```

- [ ] **Step 2: Run failing dashboard tests**

Run:

```bash
pnpm --filter @synapse/dashboard run tsc
pnpm --filter @synapse/dashboard exec vitest run src/features/users/live-client-utils.test.ts
```

Expected: FAIL because `LiveClientRow` and `live-client-utils.ts` do not exist.

- [ ] **Step 3: Add API types and methods**

Modify `dashboard/src/lib/api.ts`:

```ts
export type LiveClientRow = {
  userId?: string
  clientInstanceId: string
  status: 'online' | 'stale' | 'offline'
  appVersion: string
  platform: string
  deviceName: string
  connectedAt: string | null
  lastSeenAt: string | null
  disconnectedAt?: string
  disconnectReason?: string
}
```

Add stream helpers near the request helpers:

```ts
export type LiveClientChangedEvent = {
  type: 'live.client.changed'
  occurredAt: string
  client: LiveClientRow
}

function subscribeJsonEvent<T>(
  path: string,
  eventName: string,
  listener: (event: T) => void
) {
  const source = new EventSource(path, { withCredentials: true })
  const handler = (event: MessageEvent<string>) => {
    try {
      listener(JSON.parse(event.data) as T)
    } catch {
      return
    }
  }
  source.addEventListener(eventName, handler)
  return () => {
    source.removeEventListener(eventName, handler)
    source.close()
  }
}
```

Add to `adminApi`:

```ts
  listLiveClients: () =>
    request<LiveClientRow[]>(`${adminApiBasePath}/live-clients`),
  listUserLiveClients: (id: string) =>
    request<LiveClientRow[]>(
      `${adminApiBasePath}/users/${encodeURIComponent(id)}/live-clients`
    ),
  subscribeLiveClients: (listener: (event: LiveClientChangedEvent) => void) =>
    subscribeJsonEvent<LiveClientChangedEvent>(
      `${adminApiBasePath}/live/stream`,
      'live.client.changed',
      listener
    ),
```

Add to `dashboardApi`:

```ts
  listLiveClients: () =>
    request<LiveClientRow[]>(`${dashboardApiBasePath}/live-clients`),
  subscribeLiveClients: (listener: (event: LiveClientChangedEvent) => void) =>
    subscribeJsonEvent<LiveClientChangedEvent>(
      `${dashboardApiBasePath}/live/stream`,
      'live.client.changed',
      listener
    ),
```

- [ ] **Step 4: Implement aggregate helper**

Create `dashboard/src/features/users/live-client-utils.ts`:

```ts
import type { LiveClientRow } from '@/lib/api'

export type LiveClientSummary = {
  label: string
  onlineCount: number
  totalCount: number
  hasStale: boolean
}

export function getLiveClientSummary(userId: string, clients: readonly LiveClientRow[]): LiveClientSummary {
  const userClients = clients.filter((client) => client.userId === userId)
  const onlineCount = userClients.filter((client) => client.status === 'online').length
  const hasStale = userClients.some((client) => client.status === 'stale')
  return {
    label: onlineCount > 0 ? `${onlineCount} 台在线` : '离线',
    onlineCount,
    totalCount: userClients.length,
    hasStale,
  }
}
```

- [ ] **Step 5: Add user live clients sheet**

Create `dashboard/src/features/users/user-live-clients-sheet.tsx`:

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import type { AdminUserRow, LiveClientRow } from '@/lib/api'

type UserLiveClientsSheetProps = {
  open: boolean
  user: AdminUserRow | null
  clients: readonly LiveClientRow[]
  onOpenChange: (open: boolean) => void
}

function statusLabel(status: LiveClientRow['status']) {
  if (status === 'online') return '在线'
  if (status === 'stale') return '连接异常'
  return '离线'
}

export function UserLiveClientsSheet({
  open,
  user,
  clients,
  onOpenChange,
}: UserLiveClientsSheetProps) {
  const userClients = user ? clients.filter((client) => client.userId === user.id) : []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='sm:max-w-xl'>
        <SheetHeader>
          <SheetTitle>客户端</SheetTitle>
        </SheetHeader>
        <div className='mt-6 space-y-3'>
          {userClients.length === 0 ? (
            <p className='text-sm text-muted-foreground'>暂无客户端</p>
          ) : (
            userClients.map((client) => (
              <div key={client.clientInstanceId} className='grid gap-2 border-b pb-3 text-sm last:border-b-0'>
                <div className='flex items-center justify-between gap-3'>
                  <span className='min-w-0 truncate font-medium'>{client.deviceName}</span>
                  <Badge variant={client.status === 'online' ? 'default' : 'secondary'}>
                    {statusLabel(client.status)}
                  </Badge>
                </div>
                <div className='grid gap-1 text-muted-foreground sm:grid-cols-2'>
                  <span>平台 {client.platform}</span>
                  <span>版本 {client.appVersion}</span>
                  <span>最后心跳 {client.lastSeenAt ? new Date(client.lastSeenAt).toLocaleString('zh-CN') : '-'}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 6: Modify UsersPage**

Modify `dashboard/src/features/users/index.tsx`:

Replace the existing React import with `useEffect` included, then add feature imports:

```ts
import { useEffect, useState } from 'react'
import { getLiveClientSummary } from './live-client-utils'
import { UserLiveClientsSheet } from './user-live-clients-sheet'
```

Add state:

```ts
  const [liveClientsUser, setLiveClientsUser] = useState<AdminUserRow | null>(null)
```

Add query:

```ts
  const { data: liveClients = [] } = useQuery({
    queryKey: ['admin-live-clients'],
    queryFn: adminApi.listLiveClients,
    refetchInterval: 30_000,
  })
```

Add a live stream invalidation effect after the query:

```ts
  useEffect(() => {
    return adminApi.subscribeLiveClients(() => {
      void queryClient.invalidateQueries({ queryKey: ['admin-live-clients'] })
    })
  }, [queryClient])
```

Add a column before `createdAt`:

```tsx
    {
      id: 'liveClients',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='客户端' />
      ),
      cell: ({ row }) => {
        const summary = getLiveClientSummary(row.original.id, liveClients)
        return (
          <Button
            variant='ghost'
            className='h-8 px-2'
            onClick={() => setLiveClientsUser(row.original)}
          >
            {summary.label}
          </Button>
        )
      },
      enableSorting: false,
    },
```

Render sheet below `UserModulePermissionsSheet`:

```tsx
        <UserLiveClientsSheet
          open={liveClientsUser !== null}
          user={liveClientsUser}
          clients={liveClients}
          onOpenChange={(open) => {
            if (!open) setLiveClientsUser(null)
          }}
        />
```

- [ ] **Step 7: Run dashboard checks**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/users/live-client-utils.test.ts
pnpm --filter @synapse/dashboard run tsc
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add dashboard/src/lib/api.ts dashboard/src/features/users/index.tsx dashboard/src/features/users/live-client-utils.ts dashboard/src/features/users/live-client-utils.test.ts dashboard/src/features/users/user-live-clients-sheet.tsx
git commit -m "feat(dashboard): show user live clients"
```

---

### Task 8: Dashboard Normal User Client Section

**Files:**

- Modify: `dashboard/src/features/settings/profile-settings.tsx`

- [ ] **Step 1: Extract status label helper**

Add near the top of `dashboard/src/features/settings/profile-settings.tsx`:

```ts
function liveClientStatusLabel(status: 'online' | 'stale' | 'offline') {
  if (status === 'online') return '在线'
  if (status === 'stale') return '连接异常'
  return '离线'
}
```

- [ ] **Step 2: Add Live clients query**

Inside `ProfileSettings`, after the `dashboard-me` query:

```ts
  const {
    data: liveClients = [],
    isLoading: isLiveClientsLoading,
  } = useQuery({
    queryKey: ['dashboard-live-clients'],
    queryFn: dashboardApi.listLiveClients,
    enabled: authUser?.role === 'user',
    refetchInterval: 30_000,
  })
```

- [ ] **Step 3: Subscribe to dashboard user Live stream**

Inside `ProfileSettings`, after the Live clients query:

```ts
  useEffect(() => {
    if (authUser?.role !== 'user') return
    return dashboardApi.subscribeLiveClients(() => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard-live-clients'] })
    })
  }, [authUser?.role, queryClient])
```

- [ ] **Step 4: Render client list under profile fields**

Inside the existing `max-w-xl space-y-6` block, after the profile form:

```tsx
          <div className='space-y-3'>
            <h3 className='text-lg font-medium'>客户端</h3>
            {isLiveClientsLoading ? (
              <div className='text-sm text-muted-foreground'>加载中...</div>
            ) : liveClients.length === 0 ? (
              <div className='text-sm text-muted-foreground'>暂无客户端</div>
            ) : (
              <div className='space-y-3'>
                {liveClients.map((client) => (
                  <div key={client.clientInstanceId} className='grid gap-2 border-b pb-3 text-sm last:border-b-0'>
                    <div className='flex items-center justify-between gap-3'>
                      <span className='min-w-0 truncate font-medium'>{client.deviceName}</span>
                      <Badge variant={client.status === 'online' ? 'default' : 'secondary'}>
                        {liveClientStatusLabel(client.status)}
                      </Badge>
                    </div>
                    <div className='grid gap-1 text-muted-foreground sm:grid-cols-2'>
                      <span>平台 {client.platform}</span>
                      <span>版本 {client.appVersion}</span>
                      <span>最后心跳 {client.lastSeenAt ? new Date(client.lastSeenAt).toLocaleString('zh-CN') : '-'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
```

- [ ] **Step 5: Run dashboard typecheck**

Run:

```bash
pnpm --filter @synapse/dashboard run tsc
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/features/settings/profile-settings.tsx
git commit -m "feat(dashboard): show my live clients"
```

---

### Task 9: Release Notes And Full Verification

**Files:**

- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add a bullet to `RELEASE_NOTES_PENDING.md` under the current pending section:

```md
- 新增 Synapse Live 连接状态：桌面端登录后会和服务器保持实时连接，管理后台可以查看用户的在线客户端，用户也能在设置里查看自己的客户端连接状态。
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm --filter @synapse/server run test -- src/live
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/dashboard exec vitest run src/features/users/live-client-utils.test.ts
pnpm --filter @synapse/dashboard run tsc
pnpm --filter @synapse/desktop run test -- electron/services/__tests__/live-reconnect-policy.test.ts electron/services/__tests__/live-client-id-store.test.ts electron/services/__tests__/live-connection-service.test.ts electron/modules/live/__tests__/ipc.test.ts src/modules/settings/components/__tests__/live-connection-panel.test.tsx
pnpm --filter @synapse/desktop run typecheck
```

Expected: all commands PASS.

- [ ] **Step 3: Run hard constraints for Electron boundary changes**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Check for forbidden UI style patterns**

Run:

```bash
rg -n "style=\\{\\{|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|bg-\\[|text-\\[|gradient|emoji|console\\.log" dashboard/src/features/users dashboard/src/features/settings desktop/src/modules/settings
```

Expected: no matches from the Synapse Live changes.

- [ ] **Step 5: Commit verification note**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note synapse live connection status"
```

---

## Self-Review Checklist

- Spec coverage: server WebSocket, multi-client identity, admin/user snapshots, dashboard streams, desktop reconnect, desktop settings, and dashboard UI are mapped to tasks.
- No Redis or multi-instance implementation is included.
- No old license, activation, durable device authorization, or lease model is introduced.
- Current online truth remains in server memory.
- Dashboard API calls stay in `dashboard/src/lib/api.ts`.
- Desktop WebSocket lifecycle stays in Electron main process.
- UI changes use existing shadcn components and token utilities.
- Verification avoids starting dev servers or browser previews.
