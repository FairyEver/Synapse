# Webhook Live Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build cloud Webhooks that receive external requests on `/webhooks/<publicId>/<secret>`, broadcast them over Synapse Live to every online desktop client for the owner, and let desktop Automations react through a new Webhook trigger with request variables.

**Architecture:** Add `@synapse/shared` as the single protocol package, then migrate Live messages to shared envelopes before adding Webhook delivery messages. Server owns Webhook persistence, URL secret validation, delivery records, Nginx routing, and Live broadcast counts; dashboard owns user Webhook management; desktop owns Live downlink handling and local Automation trigger matching.

**Tech Stack:** pnpm workspace, TypeScript, NestJS, Prisma/PostgreSQL, ws, React, TanStack Router/Query/Table, shadcn/ui, Electron main process, Vitest.

---

## File Map

Shared protocol:

- Create: `shared/package.json` - workspace package metadata for `@synapse/shared`.
- Create: `shared/tsconfig.json` - standalone strict TypeScript config.
- Create: `shared/src/index.ts` - barrel exports.
- Create: `shared/src/live.ts` - Live envelope, message constants, DTOs, guards.
- Create: `shared/src/webhook.ts` - Webhook DTOs, delivery payload, helper constants.
- Modify: `pnpm-workspace.yaml` - include `shared`.
- Modify: `server/package.json`, `dashboard/package.json`, `desktop/package.json` - depend on `@synapse/shared`.

Server:

- Modify: `server/prisma/schema.prisma` - add `UserWebhook`, `WebhookDelivery`, and `User.webhooks`.
- Create: `server/prisma/migrations/<timestamp>_user_webhooks/migration.sql`.
- Create: `server/src/webhooks/webhook-token.ts` - public id, secret, hash, timing-safe validation, URL masking.
- Create: `server/src/webhooks/webhook-sanitize.ts` - query/header/body summary and secret-safe preview.
- Create: `server/src/webhooks/webhook.service.ts` - management, receive, retention.
- Create: `server/src/webhooks/webhook.controller.ts` - dashboard management and public receive routes.
- Create: `server/src/webhooks/webhook.module.ts`.
- Create: `server/src/webhooks/*.spec.ts`.
- Modify: `server/src/app.module.ts` - import `WebhookModule`.
- Modify: `server/src/live/live.types.ts`, `server/src/live/live-desktop.gateway.ts`, `server/src/live/live-client-registry.ts`, `server/src/live/*.spec.ts` - migrate shared envelope and add user broadcast.
- Modify: `server/nginx.conf`, `deploy.sh`, `restart.sh`, `server/src/deploy-config.spec.ts`, `server/README.md`.

Dashboard:

- Modify: `dashboard/src/lib/api.ts` - import/use shared Webhook DTOs, add dashboard Webhook calls.
- Modify: `dashboard/src/components/layout/data/sidebar-data.ts` - add user Webhooks navigation.
- Create: `dashboard/src/features/webhooks/index.tsx`.
- Create: `dashboard/src/features/webhooks/webhook-deliveries-sheet.tsx`.
- Create: `dashboard/src/features/webhooks/webhook-url-dialog.tsx`.
- Create: `dashboard/src/features/webhooks/webhook-error.ts`.
- Create: `dashboard/src/features/webhooks/*.test.tsx` and helper tests.
- Create: `dashboard/src/routes/_authenticated/webhooks/index.tsx`.

Desktop:

- Modify: `desktop/electron/services/live-connection-service.ts` and test - parse shared envelopes and dispatch Webhook messages.
- Create: `desktop/electron/services/live-webhook-delivery-handler.ts` and test.
- Modify: Electron bootstrap/service registry wiring where `AutomationService` and `LiveConnectionService` are composed.
- Create: `desktop/automation-trigger-packages/builtin/webhook/*`.
- Modify: `desktop/src/automation-triggers/builtin-triggers.ts`.
- Modify: `desktop/electron/services/automation/builtin-triggers.ts` or current main trigger registration file.
- Modify: `desktop/electron/action-runtime/template-variables.ts` and tests.
- Add IPC/API surface for listing server Webhooks from the logged-in desktop account if no suitable helper already exists.

Docs/release:

- Modify: `RELEASE_NOTES_PENDING.md`.

---

### Task 1: Add `@synapse/shared` Protocol Package

**Files:**
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/index.ts`
- Create: `shared/src/live.ts`
- Create: `shared/src/webhook.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `server/package.json`
- Modify: `dashboard/package.json`
- Modify: `desktop/package.json`
- Test: `shared/src/live.test.ts`
- Test: `shared/src/webhook.test.ts`

- [ ] **Step 1: Write shared Live protocol tests**

Create `shared/src/live.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  LIVE_MESSAGE_TYPES,
  createLiveEnvelope,
  isLiveDesktopClientMessage,
  isLiveDesktopServerMessage,
} from "./live"

describe("shared live protocol", () => {
  it("creates stable envelopes with namespaced message types", () => {
    const envelope = createLiveEnvelope(LIVE_MESSAGE_TYPES.ping, {
      sentAt: "2026-06-06T10:00:00.000Z",
    }, {
      id: "msg-1",
      sentAt: "2026-06-06T10:00:01.000Z",
    })

    expect(envelope).toEqual({
      type: "live.ping",
      id: "msg-1",
      sentAt: "2026-06-06T10:00:01.000Z",
      payload: { sentAt: "2026-06-06T10:00:00.000Z" },
    })
  })

  it("recognizes client heartbeat messages and rejects malformed envelopes", () => {
    expect(isLiveDesktopClientMessage(createLiveEnvelope(LIVE_MESSAGE_TYPES.hello, {
      clientInstanceId: "client-a",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
    }, { id: "msg-1", sentAt: "2026-06-06T10:00:00.000Z" }))).toBe(true)

    expect(isLiveDesktopClientMessage({
      type: "live.hello",
      id: "msg-1",
      sentAt: "2026-06-06T10:00:00.000Z",
      payload: { clientInstanceId: "client-a" },
    })).toBe(false)
  })

  it("recognizes server webhook delivery messages", () => {
    expect(isLiveDesktopServerMessage(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.webhookDeliveryReceived,
      {
        deliveryId: "delivery-1",
        webhook: { id: "db-id", publicId: "wh_abc", name: "GitHub" },
        request: {
          method: "POST",
          url: "https://synapse.test/webhooks/wh_abc/***",
          query: { event: "push" },
          headers: { "x-github-event": "push" },
          body: { repository: { full_name: "FairyEver/Synapse" } },
          contentType: "application/json",
          receivedAt: "2026-06-06T10:00:00.000Z",
        },
      },
      { id: "msg-2", sentAt: "2026-06-06T10:00:01.000Z" },
    ))).toBe(true)
  })
})
```

- [ ] **Step 2: Write shared Webhook DTO tests**

Create `shared/src/webhook.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  WEBHOOK_DELIVERY_STATUS,
  WEBHOOK_PUBLIC_PATH_PREFIX,
  isWebhookDeliveryReceivedPayload,
} from "./webhook"

describe("shared webhook protocol", () => {
  it("defines the public path prefix and delivery statuses once", () => {
    expect(WEBHOOK_PUBLIC_PATH_PREFIX).toBe("/webhooks")
    expect(WEBHOOK_DELIVERY_STATUS.accepted).toBe("accepted")
    expect(WEBHOOK_DELIVERY_STATUS.rejected).toBe("rejected")
  })

  it("validates delivery payload shape", () => {
    expect(isWebhookDeliveryReceivedPayload({
      deliveryId: "delivery-1",
      webhook: { id: "webhook-1", publicId: "wh_abc", name: "A" },
      request: {
        method: "POST",
        url: "https://synapse.test/webhooks/wh_abc/***",
        query: {},
        headers: {},
        body: { ok: true },
        receivedAt: "2026-06-06T10:00:00.000Z",
      },
    })).toBe(true)
  })
})
```

- [ ] **Step 3: Run tests and confirm they fail**

Run:

```bash
pnpm --filter @synapse/shared test
```

Expected: fail because `@synapse/shared` and the tested files do not exist.

- [ ] **Step 4: Add shared workspace package**

Create `shared/package.json`:

```json
{
  "name": "@synapse/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "typescript": "6.0.2",
    "vitest": "^4.1.5"
  }
}
```

Create `shared/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts"]
}
```

Modify `pnpm-workspace.yaml`:

```yaml
packages:
  - shared
  - desktop
  - website
  - server
  - dashboard
  - auto
  - auto/web
  - templates/shadcn-admin

onlyBuiltDependencies:
  - electron
```

Add `"@synapse/shared": "workspace:*"` to dependencies in `server/package.json`, `dashboard/package.json`, and `desktop/package.json`.

- [ ] **Step 5: Implement shared Live protocol**

Create `shared/src/live.ts`:

```ts
import { isWebhookDeliveryReceivedPayload } from "./webhook"

export const LIVE_MESSAGE_TYPES = {
  hello: "live.hello",
  welcome: "live.welcome",
  ping: "live.ping",
  pong: "live.pong",
  webhookDeliveryReceived: "webhook.delivery.received",
} as const

export type LiveMessageType = typeof LIVE_MESSAGE_TYPES[keyof typeof LIVE_MESSAGE_TYPES]

export interface LiveEnvelope<TType extends string, TPayload> {
  readonly type: TType
  readonly id: string
  readonly sentAt: string
  readonly payload: TPayload
}

export interface LiveDesktopHelloPayload {
  readonly clientInstanceId: string
  readonly appVersion: string
  readonly platform: string
  readonly deviceName: string
}

export interface LiveDesktopWelcomePayload {
  readonly connectionId: string
  readonly serverTime: string
  readonly heartbeatIntervalMs: number
  readonly heartbeatTimeoutMs: number
}

export interface LiveDesktopPingPayload {
  readonly sentAt: string
}

export interface LiveDesktopPongPayload {
  readonly serverTime: string
}

export type LiveDesktopClientMessage =
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.hello, LiveDesktopHelloPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.ping, LiveDesktopPingPayload>

export type LiveDesktopServerMessage =
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.welcome, LiveDesktopWelcomePayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.pong, LiveDesktopPongPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.webhookDeliveryReceived, import("./webhook").WebhookDeliveryReceivedPayload>

export function createLiveEnvelope<TType extends LiveMessageType, TPayload>(
  type: TType,
  payload: TPayload,
  metadata: { readonly id: string; readonly sentAt: string },
): LiveEnvelope<TType, TPayload> {
  return { type, id: metadata.id, sentAt: metadata.sentAt, payload }
}

export function isLiveEnvelope(value: unknown): value is LiveEnvelope<string, unknown> {
  if (!isRecord(value)) return false
  return typeof value.type === "string" &&
    typeof value.id === "string" &&
    typeof value.sentAt === "string" &&
    "payload" in value &&
    isRecord(value.payload)
}

export function isLiveDesktopClientMessage(value: unknown): value is LiveDesktopClientMessage {
  if (!isLiveEnvelope(value)) return false
  if (value.type === LIVE_MESSAGE_TYPES.hello) return isHelloPayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.ping) return isPingPayload(value.payload)
  return false
}

export function isLiveDesktopServerMessage(value: unknown): value is LiveDesktopServerMessage {
  if (!isLiveEnvelope(value)) return false
  if (value.type === LIVE_MESSAGE_TYPES.welcome) return isWelcomePayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.pong) return isPongPayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.webhookDeliveryReceived) {
    return isWebhookDeliveryReceivedPayload(value.payload)
  }
  return false
}

function isHelloPayload(value: unknown): value is LiveDesktopHelloPayload {
  return isRecord(value) &&
    nonEmptyString(value.clientInstanceId) &&
    nonEmptyString(value.appVersion) &&
    nonEmptyString(value.platform) &&
    nonEmptyString(value.deviceName)
}

function isWelcomePayload(value: unknown): value is LiveDesktopWelcomePayload {
  return isRecord(value) &&
    nonEmptyString(value.connectionId) &&
    nonEmptyString(value.serverTime) &&
    positiveNumber(value.heartbeatIntervalMs) &&
    positiveNumber(value.heartbeatTimeoutMs)
}

function isPingPayload(value: unknown): value is LiveDesktopPingPayload {
  return isRecord(value) && nonEmptyString(value.sentAt)
}

function isPongPayload(value: unknown): value is LiveDesktopPongPayload {
  return isRecord(value) && nonEmptyString(value.serverTime)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}
```

- [ ] **Step 6: Implement shared Webhook protocol**

Create `shared/src/webhook.ts`:

```ts
export const WEBHOOK_PUBLIC_PATH_PREFIX = "/webhooks"

export const WEBHOOK_DELIVERY_STATUS = {
  accepted: "accepted",
  rejected: "rejected",
  broadcastFailed: "broadcast_failed",
} as const

export interface WebhookDeliveryReceivedPayload {
  readonly deliveryId: string
  readonly webhook: {
    readonly id: string
    readonly publicId: string
    readonly name: string
  }
  readonly request: {
    readonly method: string
    readonly url: string
    readonly query: Record<string, string | readonly string[]>
    readonly headers: Record<string, string>
    readonly body: unknown
    readonly bodyText?: string
    readonly contentType?: string
    readonly receivedAt: string
    readonly remoteAddress?: string
  }
}

export interface DashboardWebhookDto {
  readonly id: string
  readonly publicId: string
  readonly name: string
  readonly enabled: boolean
  readonly maskedUrl: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastDeliveryAt?: string
  readonly lastDeliveryStatus?: string
}

export interface DashboardWebhookSecretResult {
  readonly webhook: DashboardWebhookDto
  readonly url: string
}

export interface WebhookDeliveryDto {
  readonly id: string
  readonly webhookId: string
  readonly method: string
  readonly path: string
  readonly query: unknown
  readonly headers: unknown
  readonly bodyKind: string
  readonly bodySize: number
  readonly bodyPreview?: string
  readonly receivedAt: string
  readonly onlineClientCount: number
  readonly sentClientCount: number
  readonly failedClientCount: number
  readonly status: string
  readonly error?: string
}

export function isWebhookDeliveryReceivedPayload(value: unknown): value is WebhookDeliveryReceivedPayload {
  if (!isRecord(value)) return false
  if (!nonEmptyString(value.deliveryId)) return false
  if (!isRecord(value.webhook) || !nonEmptyString(value.webhook.id) ||
    !nonEmptyString(value.webhook.publicId) || !nonEmptyString(value.webhook.name)) return false
  if (!isRecord(value.request)) return false
  return nonEmptyString(value.request.method) &&
    nonEmptyString(value.request.url) &&
    isRecord(value.request.query) &&
    isStringRecord(value.request.headers) &&
    nonEmptyString(value.request.receivedAt)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}
```

Create `shared/src/index.ts`:

```ts
export * from "./live"
export * from "./webhook"
```

- [ ] **Step 7: Verify shared package**

Run:

```bash
pnpm install --lockfile-only
pnpm --filter @synapse/shared test
pnpm --filter @synapse/shared typecheck
```

Expected: tests and typecheck pass; `pnpm-lock.yaml` updates with workspace metadata only.

- [ ] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml shared server/package.json dashboard/package.json desktop/package.json
git commit -m "feat(shared): add live webhook protocol package"
```

---

### Task 2: Migrate Live Heartbeat To Shared Envelope And Add User Broadcast

**Files:**
- Modify: `server/src/live/live.types.ts`
- Modify: `server/src/live/live-desktop.gateway.ts`
- Modify: `server/src/live/live-client-registry.ts`
- Modify: `server/src/live/live-desktop.gateway.spec.ts`
- Modify: `server/src/live/live-client-registry.spec.ts`
- Modify: `desktop/electron/services/live-connection-service.ts`
- Modify: `desktop/electron/services/__tests__/live-connection-service.test.ts`

- [ ] **Step 1: Update server Live tests to expect envelope messages**

In `server/src/live/live-desktop.gateway.spec.ts`, update hello/ping sends and welcome/pong expectations to use:

```ts
const hello = {
  type: "live.hello",
  id: "msg-hello",
  sentAt: "2026-06-06T10:00:00.000Z",
  payload: {
    clientInstanceId: "client-a",
    appVersion: "0.2.253",
    platform: "darwin-arm64",
    deviceName: "MacBook",
  },
}

const ping = {
  type: "live.ping",
  id: "msg-ping",
  sentAt: "2026-06-06T10:00:01.000Z",
  payload: { sentAt: "2026-06-06T10:00:01.000Z" },
}
```

Expected server responses:

```ts
expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
  type: "live.welcome",
  payload: {
    connectionId: "connection-1",
    heartbeatIntervalMs: 20_000,
    heartbeatTimeoutMs: 45_000,
  },
})
expect(JSON.parse(socket.sent[1] ?? "{}")).toMatchObject({
  type: "live.pong",
  payload: {
    serverTime: "2026-06-06T10:00:01.000Z",
  },
})
```

Add a broadcast test:

```ts
it("broadcasts a server message to every online socket for one user", () => {
  const first = new FakeSocket()
  const second = new FakeSocket()
  const other = new FakeSocket()
  gateway.bindAuthenticatedSocket(first as never, { userId: "user-1" })
  gateway.bindAuthenticatedSocket(second as never, { userId: "user-1" })
  gateway.bindAuthenticatedSocket(other as never, { userId: "user-2" })

  first.emit("message", JSON.stringify(helloFor("client-a")))
  second.emit("message", JSON.stringify(helloFor("client-b")))
  other.emit("message", JSON.stringify(helloFor("client-c")))

  const result = gateway.broadcastToUser("user-1", {
    type: "webhook.delivery.received",
    id: "delivery-msg-1",
    sentAt: "2026-06-06T10:00:02.000Z",
    payload: webhookDeliveryPayload(),
  })

  expect(result).toEqual({
    onlineClientCount: 2,
    sentClientCount: 2,
    failedClientCount: 0,
  })
  expect(first.sent.some((item) => JSON.parse(item).type === "webhook.delivery.received")).toBe(true)
  expect(second.sent.some((item) => JSON.parse(item).type === "webhook.delivery.received")).toBe(true)
  expect(other.sent.some((item) => JSON.parse(item).type === "webhook.delivery.received")).toBe(false)
})
```

- [ ] **Step 2: Run server Live tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/server test -- src/live/live-desktop.gateway.spec.ts src/live/live-client-registry.spec.ts
```

Expected: fail because server still parses legacy message shapes and lacks `broadcastToUser`.

- [ ] **Step 3: Migrate server Live implementation**

In `server/src/live/live.types.ts`, re-export shared types:

```ts
export type {
  LiveDesktopClientMessage,
  LiveDesktopHelloPayload as LiveDesktopHello,
  LiveDesktopPingPayload as LiveDesktopPing,
  LiveDesktopPongPayload as LiveDesktopPong,
  LiveDesktopServerMessage,
  LiveDesktopWelcomePayload as LiveDesktopWelcome,
} from "@synapse/shared"
```

In `server/src/live/live-desktop.gateway.ts`:

- import `LIVE_MESSAGE_TYPES`, `createLiveEnvelope`, `isLiveDesktopClientMessage`, and `LiveDesktopServerMessage` from `@synapse/shared`.
- replace direct `record.type === "hello"` with `message.type === LIVE_MESSAGE_TYPES.hello`.
- read hello fields from `message.payload`.
- send welcome with `createLiveEnvelope(LIVE_MESSAGE_TYPES.welcome, payload, metadata)`.
- send pong with `createLiveEnvelope(LIVE_MESSAGE_TYPES.pong, payload, metadata)`.
- implement:

```ts
broadcastToUser(userId: string, message: LiveDesktopServerMessage): {
  readonly onlineClientCount: number
  readonly sentClientCount: number
  readonly failedClientCount: number
} {
  const clients = this.registry.listOnlineByUser(userId)
  let sentClientCount = 0
  let failedClientCount = 0

  for (const client of clients) {
    if (!client.connectionId) continue
    const socket = this.socketsByConnectionId.get(client.connectionId)
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      failedClientCount += 1
      continue
    }
    try {
      sendJson(socket, message)
      sentClientCount += 1
    } catch {
      failedClientCount += 1
    }
  }

  return {
    onlineClientCount: clients.length,
    sentClientCount,
    failedClientCount,
  }
}
```

In `server/src/live/live-client-registry.ts`, add:

```ts
listOnlineByUser(userId: string): LiveClientInstance[] {
  return this.listByUser(userId).filter((client) => client.status === "online" && Boolean(client.connectionId))
}
```

- [ ] **Step 4: Migrate desktop Live tests**

In `desktop/electron/services/__tests__/live-connection-service.test.ts`, change expected open send to:

```ts
expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
  type: "live.hello",
  payload: {
    clientInstanceId: "client-a",
    appVersion: "0.2.253",
    platform: `${process.platform}-${process.arch}`,
    deviceName: "MacBook",
  },
})
```

Change incoming welcome/pong emits to:

```ts
socket.emit("message", JSON.stringify({
  type: "live.welcome",
  id: "msg-welcome",
  sentAt: "2026-06-06T10:00:01.000Z",
  payload: {
    connectionId: "conn-a",
    serverTime: "2026-06-06T10:00:01.000Z",
    heartbeatIntervalMs: 20_000,
    heartbeatTimeoutMs: 45_000,
  },
}))
```

```ts
socket.emit("message", JSON.stringify({
  type: "live.pong",
  id: "msg-pong",
  sentAt: "2026-06-06T10:00:05.000Z",
  payload: { serverTime: "2026-06-06T10:00:05.000Z" },
}))
```

- [ ] **Step 5: Migrate desktop Live implementation**

In `desktop/electron/services/live-connection-service.ts`:

- import shared Live helpers.
- send hello as `createLiveEnvelope(LIVE_MESSAGE_TYPES.hello, payload, metadata)`.
- send ping as `createLiveEnvelope(LIVE_MESSAGE_TYPES.ping, payload, metadata)`.
- parse incoming JSON with `isLiveDesktopServerMessage`.
- handle `LIVE_MESSAGE_TYPES.welcome` using `record.payload`.
- handle `LIVE_MESSAGE_TYPES.pong` using `record.payload`.
- for unknown malformed objects, structured-warn only `{ messageType }`.

Add a private message id helper:

```ts
private createMessageId(): string {
  return `live_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
```

- [ ] **Step 6: Verify Live migration**

Run:

```bash
pnpm --filter @synapse/server test -- src/live
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/live-connection-service.test.ts
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/live desktop/electron/services/live-connection-service.ts desktop/electron/services/__tests__/live-connection-service.test.ts
git commit -m "feat(live): use shared envelope protocol"
```

---

### Task 3: Add Server Webhook Persistence, Tokens, And Management APIs

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/<timestamp>_user_webhooks/migration.sql`
- Create: `server/src/webhooks/webhook-token.ts`
- Create: `server/src/webhooks/webhook-token.spec.ts`
- Create: `server/src/webhooks/webhook.service.ts`
- Create: `server/src/webhooks/webhook.controller.ts`
- Create: `server/src/webhooks/webhook.module.ts`
- Create: `server/src/webhooks/webhook.service.spec.ts`
- Create: `server/src/webhooks/webhook.controller.spec.ts`
- Modify: `server/src/app.module.ts`

- [ ] **Step 1: Write token tests**

Create `server/src/webhooks/webhook-token.spec.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  createWebhookPublicId,
  createWebhookSecret,
  hashWebhookSecret,
  maskWebhookUrl,
  verifyWebhookSecret,
} from "./webhook-token"

describe("webhook-token", () => {
  it("creates URL-safe public ids and secrets", () => {
    expect(createWebhookPublicId(() => Buffer.alloc(24, 1))).toMatch(/^wh_[A-Za-z0-9_-]+$/)
    expect(createWebhookSecret(() => Buffer.alloc(32, 2))).toMatch(/^whsec_[A-Za-z0-9_-]+$/)
  })

  it("hashes and verifies secrets without storing raw values", () => {
    const secret = "whsec_secret"
    const hash = hashWebhookSecret(secret)

    expect(hash).not.toContain(secret)
    expect(verifyWebhookSecret(secret, hash)).toBe(true)
    expect(verifyWebhookSecret("whsec_other", hash)).toBe(false)
  })

  it("masks public URLs", () => {
    expect(maskWebhookUrl("https://synapse.test/webhooks/wh_abc/whsec_secret"))
      .toBe("https://synapse.test/webhooks/wh_abc/***")
  })
})
```

- [ ] **Step 2: Write service management tests**

Create `server/src/webhooks/webhook.service.spec.ts` with an in-memory Prisma-like harness or mocked Prisma methods matching existing server service tests. Required tests:

```ts
it("creates a webhook for the current user and returns the full URL once", async () => {
  const service = createWebhookServiceHarness({
    publicAppUrl: "https://synapse.test",
    publicId: "wh_public",
    secret: "whsec_secret",
  })

  const result = await service.createForUser("user-1", { name: "GitHub" })

  expect(result.url).toBe("https://synapse.test/webhooks/wh_public/whsec_secret")
  expect(result.webhook).toMatchObject({
    publicId: "wh_public",
    name: "GitHub",
    enabled: true,
    maskedUrl: "https://synapse.test/webhooks/wh_public/***",
  })
  expect(JSON.stringify(service.persistedWebhooks())).not.toContain("whsec_secret")
})
```

```ts
it("resets secret and invalidates the old secret hash", async () => {
  const service = createWebhookServiceHarness({
    publicAppUrl: "https://synapse.test",
    publicId: "wh_public",
    secretSequence: ["whsec_old", "whsec_new"],
  })
  const created = await service.createForUser("user-1", { name: "GitHub" })
  const reset = await service.resetSecret("user-1", created.webhook.id)

  expect(reset.url).toBe("https://synapse.test/webhooks/wh_public/whsec_new")
  expect(service.verifyStoredSecret("wh_public", "whsec_old")).toBe(false)
  expect(service.verifyStoredSecret("wh_public", "whsec_new")).toBe(true)
})
```

```ts
it("keeps users isolated when listing and mutating webhooks", async () => {
  const service = createWebhookServiceHarness()
  const own = await service.createForUser("user-1", { name: "Own" })
  await service.createForUser("user-2", { name: "Other" })

  await expect(service.updateForUser("user-2", own.webhook.id, { name: "Hack" }))
    .rejects.toThrow("Webhook not found")
  await expect(service.listForUser("user-1")).resolves.toHaveLength(1)
})
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/server test -- src/webhooks
```

Expected: fail because Webhook files do not exist.

- [ ] **Step 4: Add Prisma schema and migration**

Modify `server/prisma/schema.prisma`:

```prisma
model User {
  id                  String                 @id @default(cuid())
  email               String                 @unique
  displayName         String?                @db.VarChar(40)
  passwordHash        String
  passwordChangedAt   DateTime?
  status              UserStatus             @default(active)
  memberships         TeamMembership[]
  createdTeams        Team[]                 @relation("TeamCreator")
  sessions            UserSession[]
  desktopLoginCodes   DesktopLoginCode[]
  passwordResetTokens UserPasswordResetToken[]
  acceptedInvitations Invitation[]           @relation("AcceptedInvitations")
  createdInvitations  Invitation[]           @relation("UserCreatedInvitations")
  modulePermissions   UserModulePermission[]
  webhooks            UserWebhook[]
  createdAt           DateTime               @default(now())
  updatedAt           DateTime               @updatedAt
}
```

Append models from the spec exactly. Create migration SQL:

```sql
CREATE TABLE "UserWebhook" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "secretHash" TEXT NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserWebhook_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookDelivery" (
  "id" TEXT NOT NULL,
  "webhookId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "query" JSONB NOT NULL,
  "headers" JSONB NOT NULL,
  "bodyKind" TEXT NOT NULL,
  "bodySize" INTEGER NOT NULL,
  "bodyPreview" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "onlineClientCount" INTEGER NOT NULL,
  "sentClientCount" INTEGER NOT NULL,
  "failedClientCount" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "error" TEXT,

  CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserWebhook_publicId_key" ON "UserWebhook"("publicId");
CREATE INDEX "UserWebhook_userId_createdAt_idx" ON "UserWebhook"("userId", "createdAt");
CREATE INDEX "WebhookDelivery_webhookId_receivedAt_idx" ON "WebhookDelivery"("webhookId", "receivedAt");
CREATE INDEX "WebhookDelivery_userId_receivedAt_idx" ON "WebhookDelivery"("userId", "receivedAt");

ALTER TABLE "UserWebhook"
  ADD CONSTRAINT "UserWebhook_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_webhookId_fkey"
  FOREIGN KEY ("webhookId") REFERENCES "UserWebhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 5: Implement token helpers**

Create `server/src/webhooks/webhook-token.ts`:

```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

type RandomBytes = (size: number) => Buffer

export function createWebhookPublicId(random: RandomBytes = randomBytes): string {
  return `wh_${random(24).toString("base64url")}`
}

export function createWebhookSecret(random: RandomBytes = randomBytes): string {
  return `whsec_${random(32).toString("base64url")}`
}

export function hashWebhookSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex")
}

export function verifyWebhookSecret(secret: string, hash: string): boolean {
  const left = Buffer.from(hashWebhookSecret(secret), "hex")
  const right = Buffer.from(hash, "hex")
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function buildWebhookUrl(publicAppUrl: string, publicId: string, secret: string): string {
  const base = publicAppUrl.replace(/\/+$/u, "")
  return `${base}/webhooks/${encodeURIComponent(publicId)}/${encodeURIComponent(secret)}`
}

export function maskWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split("/")
    if (parts.length >= 4 && parts[1] === "webhooks") {
      parts[3] = "***"
      parsed.pathname = parts.join("/")
      return parsed.toString()
    }
  } catch {
    return url.replace(/\/webhooks\/([^/]+)\/[^/?#]+/u, "/webhooks/$1/***")
  }
  return url.replace(/\/webhooks\/([^/]+)\/[^/?#]+/u, "/webhooks/$1/***")
}
```

- [ ] **Step 6: Implement Webhook module APIs**

Implement `WebhookService` with methods:

```ts
listForUser(userId: string): Promise<DashboardWebhookDto[]>
createForUser(userId: string, input: { readonly name: string }, publicAppUrl: string): Promise<DashboardWebhookSecretResult>
updateForUser(userId: string, id: string, input: { readonly name?: string; readonly enabled?: boolean }): Promise<DashboardWebhookDto>
deleteForUser(userId: string, id: string): Promise<{ readonly ok: true }>
resetSecret(userId: string, id: string, publicAppUrl: string): Promise<DashboardWebhookSecretResult>
listDeliveriesForUser(userId: string, webhookId: string): Promise<WebhookDeliveryDto[]>
```

Implement controller routes:

```ts
@UseGuards(UserAuthGuard)
@Controller("/api/dashboard/webhooks")
export class WebhookDashboardController { /* methods for list/create/patch/delete/reset/deliveries */ }
```

Register with:

```ts
@Module({
  imports: [UserAuthModule, PrismaModule],
  controllers: [WebhookDashboardController],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhookModule {}
```

Import `WebhookModule` in `server/src/app.module.ts`.

- [ ] **Step 7: Verify server management**

Run:

```bash
pnpm --filter @synapse/server prisma:generate
pnpm --filter @synapse/server test -- src/webhooks
pnpm --filter @synapse/server typecheck
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add server/prisma server/src/webhooks server/src/app.module.ts
git commit -m "feat(server): add user webhook management"
```

---

### Task 4: Add Public Webhook Receive Endpoint And Delivery Broadcast

**Files:**
- Modify: `server/src/webhooks/webhook.service.ts`
- Modify: `server/src/webhooks/webhook.controller.ts`
- Create: `server/src/webhooks/webhook-sanitize.ts`
- Create: `server/src/webhooks/webhook-sanitize.spec.ts`
- Modify: `server/src/webhooks/webhook.service.spec.ts`
- Modify: `server/src/live/live-desktop.gateway.ts`

- [ ] **Step 1: Write sanitize tests**

Create `server/src/webhooks/webhook-sanitize.spec.ts`:

```ts
import { describe, expect, it } from "vitest"
import { sanitizeWebhookHeaders, summarizeWebhookBody } from "./webhook-sanitize"

describe("webhook sanitize", () => {
  it("normalizes headers and redacts sensitive values", () => {
    expect(sanitizeWebhookHeaders({
      "X-GitHub-Event": "push",
      Authorization: "Bearer secret",
      Cookie: "sid=secret",
    })).toEqual({
      "x-github-event": "push",
      authorization: "[redacted]",
      cookie: "[redacted]",
    })
  })

  it("summarizes JSON bodies without leaking token-like fields", () => {
    const summary = summarizeWebhookBody(
      Buffer.from(JSON.stringify({ ok: true, token: "sk-secret" })),
      "application/json",
    )

    expect(summary).toMatchObject({
      bodyKind: "json",
      bodySize: expect.any(Number),
      body: { ok: true, token: "[redacted]" },
    })
    expect(summary.bodyPreview).not.toContain("sk-secret")
  })
})
```

- [ ] **Step 2: Write public receive tests**

Add tests to `server/src/webhooks/webhook.service.spec.ts`:

```ts
it("accepts a webhook request, broadcasts to online clients, and stores delivery counts", async () => {
  const harness = createWebhookReceiveHarness({
    broadcastResult: { onlineClientCount: 2, sentClientCount: 2, failedClientCount: 0 },
  })
  const created = await harness.service.createForUser("user-1", { name: "GitHub" }, "https://synapse.test")

  const result = await harness.service.receivePublicWebhook({
    publicId: created.webhook.publicId,
    secret: harness.lastSecret(),
    method: "POST",
    path: `/webhooks/${created.webhook.publicId}/***`,
    query: { event: "push" },
    headers: { "x-github-event": "push" },
    body: Buffer.from(JSON.stringify({ repository: { full_name: "FairyEver/Synapse" } })),
    contentType: "application/json",
    remoteAddress: "127.0.0.1",
    publicAppUrl: "https://synapse.test",
  })

  expect(result.response).toMatchObject({ ok: true, deliveryId: expect.any(String) })
  expect(harness.broadcasts).toHaveLength(1)
  expect(harness.deliveries()).toEqual([
    expect.objectContaining({
      onlineClientCount: 2,
      sentClientCount: 2,
      failedClientCount: 0,
      status: "accepted",
    }),
  ])
})
```

```ts
it("keeps only the most recent 100 deliveries for each webhook", async () => {
  const harness = createWebhookReceiveHarness()
  const created = await harness.service.createForUser("user-1", { name: "GitHub" }, "https://synapse.test")

  for (let index = 0; index < 105; index += 1) {
    await harness.receive(created.webhook.publicId, harness.lastSecret(), { marker: index })
  }

  expect(harness.deliveries()).toHaveLength(100)
  expect(harness.deliveries()[0]?.bodyPreview).toContain("5")
})
```

```ts
it("rejects invalid secrets without broadcasting", async () => {
  const harness = createWebhookReceiveHarness()
  const created = await harness.service.createForUser("user-1", { name: "GitHub" }, "https://synapse.test")

  await expect(harness.receive(created.webhook.publicId, "wrong", {})).rejects.toThrow("Webhook not found")
  expect(harness.broadcasts).toHaveLength(0)
})
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/server test -- src/webhooks
```

Expected: receive and sanitize tests fail.

- [ ] **Step 4: Implement sanitize helpers**

Create `server/src/webhooks/webhook-sanitize.ts`:

```ts
const SENSITIVE_KEY = /authorization|cookie|token|secret|password|credential|api[-_]?key/i
const MAX_PREVIEW_CHARS = 2000

export function sanitizeWebhookHeaders(headers: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    const key = rawKey.toLowerCase()
    result[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : stringifyHeader(rawValue)
  }
  return result
}

export function summarizeWebhookBody(body: Buffer, contentType = ""): {
  readonly bodyKind: string
  readonly bodySize: number
  readonly body: unknown
  readonly bodyText?: string
  readonly bodyPreview?: string
} {
  const bodySize = body.byteLength
  if (contentType.includes("application/json")) {
    const parsed = JSON.parse(body.toString("utf8"))
    const redacted = redactValue(parsed)
    return {
      bodyKind: "json",
      bodySize,
      body: redacted,
      bodyPreview: preview(JSON.stringify(redacted)),
    }
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(body.toString("utf8"))
    const parsed = Object.fromEntries(params.entries())
    const redacted = redactValue(parsed)
    return {
      bodyKind: "form",
      bodySize,
      body: redacted,
      bodyPreview: preview(JSON.stringify(redacted)),
    }
  }
  if (contentType.startsWith("text/") || contentType === "") {
    const bodyText = body.toString("utf8")
    return {
      bodyKind: "text",
      bodySize,
      body: { text: bodyText },
      bodyText,
      bodyPreview: preview(bodyText),
    }
  }
  throw new Error("unsupported_content_type")
}

function stringifyHeader(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ")
  return typeof value === "string" ? value : String(value ?? "")
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue)
  if (!value || typeof value !== "object") return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redactValue(child)
  }
  return result
}

function preview(value: string): string {
  return value.length > MAX_PREVIEW_CHARS ? `${value.slice(0, MAX_PREVIEW_CHARS)}[truncated]` : value
}
```

- [ ] **Step 5: Implement receive service and controller route**

Add `receivePublicWebhook` to `WebhookService`. It should:

- find by `publicId`;
- verify secret hash;
- reject disabled hooks;
- parse/sanitize request;
- create delivery with initial counts;
- call `liveDesktopGateway.broadcastToUser`;
- update delivery counts;
- prune older deliveries beyond 100;
- return `{ ok: true, deliveryId, acceptedAt }`.

Add public route in `webhook.controller.ts`:

```ts
@Controller()
export class WebhookPublicController {
  constructor(private readonly webhooks: WebhookService) {}

  @All("/webhooks/:publicId/:secret")
  async receive(
    @Param("publicId") publicId: string,
    @Param("secret") secret: string,
    @Req() request: Request,
  ) {
    return this.webhooks.receivePublicWebhook({
      publicId,
      secret,
      method: request.method,
      path: request.path,
      query: request.query as Record<string, string | readonly string[]>,
      headers: request.headers,
      body: Buffer.isBuffer(request.body) ? request.body : Buffer.from(JSON.stringify(request.body ?? {})),
      contentType: request.headers["content-type"],
      remoteAddress: request.ip,
      publicAppUrl: process.env.APP_PUBLIC_URL ?? "http://localhost:3000",
    })
  }
}
```

Register raw body parsing for `/webhooks/` in the Nest bootstrap if existing body parser consumes the buffer before this controller. Keep the limit at `256kb`.

- [ ] **Step 6: Verify receive path**

Run:

```bash
pnpm --filter @synapse/server test -- src/webhooks src/live
pnpm --filter @synapse/server typecheck
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/webhooks server/src/live server/src/main.ts
git commit -m "feat(server): receive and broadcast webhooks"
```

---

### Task 5: Update Nginx And Deployment Checks

**Files:**
- Modify: `server/nginx.conf`
- Modify: `deploy.sh`
- Modify: `restart.sh`
- Modify: `server/src/deploy-config.spec.ts`
- Modify: `server/README.md`

- [ ] **Step 1: Add failing deployment config expectations**

In `server/src/deploy-config.spec.ts`, extend the health check test:

```ts
expect(deployScript).toContain("http://127.0.0.1:3000/webhooks/not-found/test")
expect(deployScript).toContain("webhook route")
```

Add a new test:

```ts
it("routes public webhooks through nginx instead of dashboard redirects", () => {
  const nginx = readRepoFile("server/nginx.conf")

  expect(nginx).toContain("location /webhooks/")
  expect(nginx).toContain("proxy_pass http://127.0.0.1:3001")
})
```

- [ ] **Step 2: Run deployment config test and confirm failure**

Run:

```bash
pnpm --filter @synapse/server test -- src/deploy-config.spec.ts
```

Expected: fail because Nginx and scripts do not include Webhook route checks.

- [ ] **Step 3: Update Nginx**

Insert before `location = /healthz` in `server/nginx.conf`:

```nginx
  location /webhooks/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
```

- [ ] **Step 4: Update deployment health checks**

In both `deploy.sh` and `restart.sh`, after dashboard redirect check, add:

```bash
check_not_redirect_to_dashboard() {
  local name=$1
  local url=$2
  local header_file
  local error_file
  local http_code
  local curl_status

  header_file=$(mktemp)
  error_file=$(mktemp)
  http_code=$(curl -sS -o /dev/null -D "$header_file" -w "%{http_code}" "$url" 2>"$error_file")
  curl_status=$?

  if [ "$curl_status" -eq 0 ] && ! grep -qi "^Location: /dashboard/" "$header_file"; then
    printf "%s ok (HTTP %s)\n" "$name" "$http_code"
  else
    printf "%s FAILED (HTTP %s, should not redirect to /dashboard/)\n" "$name" "$http_code"
    if [ -s "$error_file" ]; then
      sed -n '1,4p' "$error_file"
    fi
    print_file_preview "$header_file"
    record_failure
  fi

  rm -f "$header_file" "$error_file"
}

check_not_redirect_to_dashboard "webhook route" "http://127.0.0.1:3000/webhooks/not-found/test"
```

- [ ] **Step 5: Update README**

In `server/README.md`, update the deployment check sentence to include `/webhooks/not-found/test` as a public Webhook routing check.

- [ ] **Step 6: Verify deployment config**

Run:

```bash
pnpm --filter @synapse/server test -- src/deploy-config.spec.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add server/nginx.conf deploy.sh restart.sh server/src/deploy-config.spec.ts server/README.md
git commit -m "chore(server): route public webhooks through nginx"
```

---

### Task 6: Add Dashboard Webhook Management UI

**Files:**
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/components/layout/data/sidebar-data.ts`
- Create: `dashboard/src/routes/_authenticated/webhooks/index.tsx`
- Create: `dashboard/src/features/webhooks/index.tsx`
- Create: `dashboard/src/features/webhooks/webhook-url-dialog.tsx`
- Create: `dashboard/src/features/webhooks/webhook-deliveries-sheet.tsx`
- Create: `dashboard/src/features/webhooks/webhook-error.ts`
- Create tests under `dashboard/src/features/webhooks/`

- [ ] **Step 1: Write API and utility tests**

Create `dashboard/src/features/webhooks/webhook-error.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { getWebhookTableError } from './webhook-error'

describe('webhook-error', () => {
  it('uses error messages and falls back to request failure', () => {
    expect(getWebhookTableError(new Error('boom'))).toBe('boom')
    expect(getWebhookTableError(null)).toBeNull()
    expect(getWebhookTableError('x')).toBe('请求失败')
  })
})
```

Create `dashboard/src/components/layout/data/sidebar-data.test.ts` expectation for user nav:

```ts
expect(getSidebarData({ role: 'user', email: 'u@example.com', displayName: null }).navGroups
  .flatMap((group) => group.items)
  .map((item) => item.url)).toContain('/webhooks')
```

- [ ] **Step 2: Add dashboard API methods**

In `dashboard/src/lib/api.ts`, import shared types:

```ts
import type {
  DashboardWebhookDto,
  DashboardWebhookSecretResult,
  WebhookDeliveryDto,
} from '@synapse/shared'
```

Add to `dashboardApi`:

```ts
listWebhooks: () =>
  request<DashboardWebhookDto[]>(`${dashboardApiBasePath}/webhooks`),
createWebhook: (input: { name: string }) =>
  request<DashboardWebhookSecretResult>(`${dashboardApiBasePath}/webhooks`, {
    method: 'POST',
    body: JSON.stringify(input),
  }),
updateWebhook: (id: string, input: { name?: string; enabled?: boolean }) =>
  request<DashboardWebhookDto>(`${dashboardApiBasePath}/webhooks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  }),
deleteWebhook: (id: string) =>
  request<{ ok: true }>(`${dashboardApiBasePath}/webhooks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }),
resetWebhookSecret: (id: string) =>
  request<DashboardWebhookSecretResult>(
    `${dashboardApiBasePath}/webhooks/${encodeURIComponent(id)}/reset-secret`,
    { method: 'POST' }
  ),
listWebhookDeliveries: (id: string) =>
  request<WebhookDeliveryDto[]>(
    `${dashboardApiBasePath}/webhooks/${encodeURIComponent(id)}/deliveries`
  ),
```

- [ ] **Step 3: Add navigation and route**

Modify `dashboard/src/components/layout/data/sidebar-data.ts` user group to include:

```ts
{
  title: 'Webhooks',
  url: '/webhooks',
  icon: Webhook,
}
```

Import `Webhook` from `lucide-react`.

Create `dashboard/src/routes/_authenticated/webhooks/index.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import WebhooksPage from '@/features/webhooks'

export const Route = createFileRoute('/_authenticated/webhooks/')({
  component: WebhooksPage,
})
```

- [ ] **Step 4: Implement Webhooks page**

Create `dashboard/src/features/webhooks/index.tsx` with:

- `Header` title `Webhooks`;
- `Main`;
- `ServerDataTable`;
- `Dialog` for new/rename;
- `WebhookUrlDialog` after create/reset;
- `WebhookDeliveriesSheet` for records;
- `toast.success` for save/reset/delete.

Use columns:

```ts
const columns: ColumnDef<DashboardWebhookDto>[] = [
  { accessorKey: 'name', header: ({ column }) => <DataTableColumnHeader column={column} title='名称' /> },
  { accessorKey: 'enabled', header: ({ column }) => <DataTableColumnHeader column={column} title='状态' /> },
  { accessorKey: 'maskedUrl', header: ({ column }) => <DataTableColumnHeader column={column} title='URL' /> },
  { accessorKey: 'lastDeliveryAt', header: ({ column }) => <DataTableColumnHeader column={column} title='最近接收' /> },
  { accessorKey: 'createdAt', header: ({ column }) => <DataTableColumnHeader column={column} title='创建时间' /> },
  { id: 'actions', enableSorting: false, enableHiding: false, meta: { thClassName: 'text-right', tdClassName: 'text-right' } },
]
```

Keep empty text from `ServerDataTable` as `暂无数据`; add toolbar button `新建`.

- [ ] **Step 5: Implement URL dialog and deliveries sheet**

`WebhookUrlDialog` props:

```ts
type WebhookUrlDialogProps = {
  readonly open: boolean
  readonly url: string | null
  readonly onOpenChange: (open: boolean) => void
}
```

Render `Input readOnly value={url ?? ''}` and `复制` button. On clipboard failure, `toast.error('复制失败')`.

`WebhookDeliveriesSheet` props:

```ts
type WebhookDeliveriesSheetProps = {
  readonly open: boolean
  readonly webhook: DashboardWebhookDto | null
  readonly onOpenChange: (open: boolean) => void
}
```

Use `dashboardApi.listWebhookDeliveries(webhook.id)` when open and show method, status, counts, body size, received time. Do not show raw secret.

- [ ] **Step 6: Verify dashboard**

Run:

```bash
pnpm --filter @synapse/dashboard build
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/lib/api.ts dashboard/src/components/layout/data/sidebar-data.ts dashboard/src/routes/_authenticated/webhooks dashboard/src/features/webhooks dashboard/src/routeTree.gen.ts
git commit -m "feat(dashboard): add webhook management"
```

---

### Task 7: Dispatch Webhook Live Deliveries Into Desktop Automation

**Files:**
- Create: `desktop/electron/services/live-webhook-delivery-handler.ts`
- Create: `desktop/electron/services/__tests__/live-webhook-delivery-handler.test.ts`
- Modify: `desktop/electron/services/live-connection-service.ts`
- Modify: `desktop/electron/services/__tests__/live-connection-service.test.ts`
- Modify bootstrap file that creates/wires `liveConnectionService`

- [ ] **Step 1: Write handler tests**

Create `desktop/electron/services/__tests__/live-webhook-delivery-handler.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { LiveWebhookDeliveryHandler } from "../live-webhook-delivery-handler"

describe("LiveWebhookDeliveryHandler", () => {
  it("converts webhook delivery payloads into automation events", async () => {
    const automation = { acceptEvent: vi.fn().mockResolvedValue([]) }
    const handler = new LiveWebhookDeliveryHandler({ automation: automation as never })

    await handler.handle({
      deliveryId: "delivery-1",
      webhook: { id: "webhook-db", publicId: "wh_abc", name: "GitHub" },
      request: {
        method: "POST",
        url: "https://synapse.test/webhooks/wh_abc/***",
        query: { event: "push" },
        headers: { "x-github-event": "push" },
        body: { repository: { full_name: "FairyEver/Synapse" } },
        contentType: "application/json",
        receivedAt: "2026-06-06T10:00:00.000Z",
      },
    })

    expect(automation.acceptEvent).toHaveBeenCalledWith({
      source: "webhook",
      type: "webhook.delivery.received",
      receivedAt: "2026-06-06T10:00:00.000Z",
      payload: {
        deliveryId: "delivery-1",
        webhook: { id: "webhook-db", publicId: "wh_abc", name: "GitHub" },
        request: expect.objectContaining({
          method: "POST",
          query: { event: "push" },
        }),
      },
    })
  })
})
```

- [ ] **Step 2: Write Live service dispatch test**

In `desktop/electron/services/__tests__/live-connection-service.test.ts`, add:

```ts
it("dispatches valid webhook delivery messages to the webhook handler", async () => {
  const socket = new FakeSocket()
  const webhookHandler = { handle: vi.fn().mockResolvedValue(undefined) }
  const service = new LiveConnectionService({
    accountService: createAccountService() as never,
    clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
    createSocket: vi.fn(() => socket as never),
    webhookHandler: webhookHandler as never,
  })

  service.handleAccountState(authenticatedState)
  await flushPromises()
  socket.emit("message", JSON.stringify({
    type: "webhook.delivery.received",
    id: "msg-1",
    sentAt: "2026-06-06T10:00:01.000Z",
    payload: webhookDeliveryPayload(),
  }))

  expect(webhookHandler.handle).toHaveBeenCalledWith(webhookDeliveryPayload())
})
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/live-webhook-delivery-handler.test.ts electron/services/__tests__/live-connection-service.test.ts
```

Expected: fail because handler and constructor dependency do not exist.

- [ ] **Step 4: Implement handler**

Create `desktop/electron/services/live-webhook-delivery-handler.ts`:

```ts
import type { WebhookDeliveryReceivedPayload } from "@synapse/shared"
import type { AutomationService } from "./automation/automation-service"
import { createMainLogger } from "./log-store"

const logger = createMainLogger("service.live.webhook")

export class LiveWebhookDeliveryHandler {
  constructor(private readonly deps: { readonly automation: Pick<AutomationService, "acceptEvent"> }) {}

  async handle(payload: WebhookDeliveryReceivedPayload): Promise<void> {
    try {
      await this.deps.automation.acceptEvent({
        source: "webhook",
        type: "webhook.delivery.received",
        receivedAt: payload.request.receivedAt,
        payload: {
          deliveryId: payload.deliveryId,
          webhook: payload.webhook,
          request: {
            method: payload.request.method,
            query: payload.request.query,
            headers: payload.request.headers,
            body: payload.request.body,
            bodyText: payload.request.bodyText,
            contentType: payload.request.contentType,
            remoteAddress: payload.request.remoteAddress,
          },
        },
      })
    } catch (error) {
      logger.warn("Live webhook delivery dispatch failed.", {
        deliveryId: payload.deliveryId,
        webhookPublicId: payload.webhook.publicId,
        errorName: error instanceof Error ? error.name : typeof error,
      })
    }
  }
}
```

- [ ] **Step 5: Wire handler into Live service**

In `LiveConnectionServiceDeps`, add:

```ts
readonly webhookHandler?: Pick<LiveWebhookDeliveryHandler, "handle">
```

In `handleMessage`, after validating server message:

```ts
if (record.type === LIVE_MESSAGE_TYPES.webhookDeliveryReceived) {
  void this.webhookHandler?.handle(record.payload)
  return
}
```

Wire the real handler in bootstrap after `AutomationService` exists. Do not create a dependency cycle in renderer.

- [ ] **Step 6: Verify**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/live-webhook-delivery-handler.test.ts electron/services/__tests__/live-connection-service.test.ts
pnpm --filter @synapse/desktop run typecheck
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/live-connection-service.ts desktop/electron/services/live-webhook-delivery-handler.ts desktop/electron/services/__tests__/live-webhook-delivery-handler.test.ts desktop/electron/services/__tests__/live-connection-service.test.ts desktop/electron/main.ts
git commit -m "feat(desktop): dispatch live webhooks to automation"
```

---

### Task 8: Add Built-In Webhook Automation Trigger And Variables

**Files:**
- Create: `desktop/automation-trigger-packages/builtin/webhook/schema.ts`
- Create: `desktop/automation-trigger-packages/builtin/webhook/manifest.ts`
- Create: `desktop/automation-trigger-packages/builtin/webhook/index.shared.ts`
- Create: `desktop/automation-trigger-packages/builtin/webhook/runtime.main.ts`
- Create: `desktop/automation-trigger-packages/builtin/webhook/index.main.ts`
- Create: `desktop/automation-trigger-packages/builtin/webhook/index.renderer.ts`
- Create: `desktop/automation-trigger-packages/builtin/webhook/config.renderer.tsx`
- Create tests for runtime and config.
- Modify: `desktop/src/automation-triggers/builtin-triggers.ts`
- Modify main trigger registration.
- Modify: `desktop/electron/action-runtime/template-variables.ts`
- Modify: `desktop/electron/action-runtime/__tests__/template-variables.test.ts`

- [ ] **Step 1: Write runtime and variable tests**

Create `desktop/automation-trigger-packages/builtin/webhook/runtime.main.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { webhookTriggerRuntime } from "./runtime.main"

describe("webhookTriggerRuntime", () => {
  it("accepts matching webhook delivery events", () => {
    expect(webhookTriggerRuntime.shouldAcceptEvent?.({
      config: { webhookPublicId: "wh_abc", webhookName: "GitHub" },
      event: {
        source: "webhook",
        type: "webhook.delivery.received",
        receivedAt: "2026-06-06T10:00:00.000Z",
        payload: { webhook: { publicId: "wh_abc" } },
      },
    })).toBe(true)
  })

  it("rejects non-matching webhook delivery events", () => {
    expect(webhookTriggerRuntime.shouldAcceptEvent?.({
      config: { webhookPublicId: "wh_abc" },
      event: {
        source: "webhook",
        type: "webhook.delivery.received",
        receivedAt: "2026-06-06T10:00:00.000Z",
        payload: { webhook: { publicId: "wh_other" } },
      },
    })).toBe(false)
  })
})
```

Add to `desktop/electron/action-runtime/__tests__/template-variables.test.ts`:

```ts
it("builds short webhook trigger variables", () => {
  expect(buildAutomationTemplateVariables({
    triggerType: "builtin.webhook",
    triggerConfig: { webhookPublicId: "wh_abc" },
    triggeredBy: "trigger",
    triggeredAt: "2026-06-06T10:00:00.000Z",
    scheduledAt: "2026-06-06T10:00:00.000Z",
    automationId: "automation-1",
    automationName: "GitHub handler",
    event: {
      source: "webhook",
      type: "webhook.delivery.received",
      receivedAt: "2026-06-06T10:00:00.000Z",
      payload: {
        deliveryId: "delivery-1",
        webhook: { id: "db-id", publicId: "wh_abc", name: "GitHub" },
        request: {
          method: "POST",
          contentType: "application/json",
          headers: { authorization: "[redacted]", "x-github-event": "push" },
          query: { event: "push" },
          body: { repository: { full_name: "FairyEver/Synapse" } },
        },
      },
    },
  })).toEqual(expect.objectContaining({
    "trigger.deliveryId": "delivery-1",
    "trigger.webhook.publicId": "wh_abc",
    "trigger.webhook.name": "GitHub",
    "trigger.request.method": "POST",
    "trigger.request.contentType": "application/json",
    "trigger.payload.request.body.repository.full_name": "FairyEver/Synapse",
    "trigger.payload.request.headers.authorization": "[redacted]",
  }))
})
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run automation-trigger-packages/builtin/webhook electron/action-runtime/__tests__/template-variables.test.ts
```

Expected: fail because trigger package and short variables do not exist.

- [ ] **Step 3: Implement trigger package**

Create `schema.ts`:

```ts
import { z } from "zod"

export const webhookTriggerConfigSchema = z.object({
  webhookPublicId: z.string().trim().min(1),
  webhookName: z.string().trim().optional(),
}).strict()

export type WebhookTriggerConfig = z.infer<typeof webhookTriggerConfigSchema>
```

Create `manifest.ts`:

```ts
import type { AutomationTriggerManifest } from "../../types.shared"
import { webhookTriggerConfigSchema, type WebhookTriggerConfig } from "./schema"

export const webhookTriggerManifest = {
  id: "builtin.webhook",
  title: "Webhook",
  kind: "event",
  defaultConfig: { webhookPublicId: "" },
  configSchema: webhookTriggerConfigSchema,
  variables: [
    { key: "trigger.type", label: "触发器类型", group: "trigger" },
    { key: "trigger.triggeredAt", label: "触发时间", group: "trigger" },
    { key: "trigger.webhook.publicId", label: "Webhook ID", group: "config" },
    { key: "trigger.webhook.name", label: "Webhook 名称", group: "config" },
    { key: "trigger.deliveryId", label: "接收记录 ID", group: "event" },
    { key: "trigger.request.method", label: "请求方法", group: "event" },
    { key: "trigger.request.contentType", label: "Content-Type", group: "event" },
    { key: "trigger.request.bodyText", label: "文本 Body", group: "event" },
    { key: "trigger.payload.request.query.<key>", label: "Query 参数", group: "event", dynamic: true },
    { key: "trigger.payload.request.headers.<key>", label: "Header", group: "event", dynamic: true },
    { key: "trigger.payload.request.body.<path>", label: "Body 字段", group: "event", dynamic: true },
  ],
} satisfies AutomationTriggerManifest<WebhookTriggerConfig>
```

Create `runtime.main.ts`:

```ts
import type { AutomationTriggerRuntime } from "../../types.shared"
import type { WebhookTriggerConfig } from "./schema"

export const webhookTriggerRuntime = {
  shouldAcceptEvent({ config, event }) {
    const payload = event.payload as { readonly webhook?: { readonly publicId?: unknown } }
    return event.source === "webhook" &&
      event.type === "webhook.delivery.received" &&
      payload.webhook?.publicId === config.webhookPublicId
  },
  getReschedulePolicy() {
    return { mode: "none" }
  },
} satisfies AutomationTriggerRuntime<WebhookTriggerConfig>
```

Create shared/main/renderer entry files following cron/interval package patterns.

- [ ] **Step 4: Implement renderer config**

Create `config.renderer.tsx` that:

- calls a desktop bridge method to list current account Webhooks;
- renders a shadcn `Select`;
- writes `{ webhookPublicId, webhookName }` on selection;
- renders `登录后可选择 Webhook` when not logged in;
- renders `加载失败` and `重试` on failure.

Use existing form components and Tailwind token utilities only.

- [ ] **Step 5: Register trigger**

Add renderer registration in `desktop/src/automation-triggers/builtin-triggers.ts`:

```ts
import { webhookRendererTriggerDefinition } from "../../automation-trigger-packages/builtin/webhook/index.renderer"

rendererAutomationTriggerRegistry.register(webhookRendererTriggerDefinition)
```

Add main registration where cron and interval main trigger definitions are registered:

```ts
import { webhookTriggerDefinition } from "../../../automation-trigger-packages/builtin/webhook/index.main"

registry.register(webhookTriggerDefinition)
```

- [ ] **Step 6: Extend template variables**

In `desktop/electron/action-runtime/template-variables.ts`, after `flattenValue("trigger.payload", ...)`, add:

```ts
const payload = input.event.payload as Record<string, unknown>
const webhook = isRecord(payload.webhook) ? payload.webhook : null
const request = isRecord(payload.request) ? payload.request : null

if (typeof payload.deliveryId === "string") variables["trigger.deliveryId"] = payload.deliveryId
if (webhook) {
  if (typeof webhook.id === "string") variables["trigger.webhook.id"] = webhook.id
  if (typeof webhook.publicId === "string") variables["trigger.webhook.publicId"] = webhook.publicId
  if (typeof webhook.name === "string") variables["trigger.webhook.name"] = webhook.name
}
if (request) {
  if (typeof request.method === "string") variables["trigger.request.method"] = request.method
  if (typeof request.contentType === "string") variables["trigger.request.contentType"] = request.contentType
  if (typeof request.bodyText === "string") variables["trigger.request.bodyText"] = request.bodyText
}
```

Add local `isRecord`.

- [ ] **Step 7: Verify desktop trigger**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run automation-trigger-packages/builtin/webhook electron/action-runtime/__tests__/template-variables.test.ts src/automation-triggers
pnpm --filter @synapse/desktop run typecheck
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add desktop/automation-trigger-packages/builtin/webhook desktop/src/automation-triggers desktop/electron/services/automation desktop/electron/action-runtime
git commit -m "feat(automation): add webhook trigger"
```

---

### Task 9: Final Integration, Generated Files, Release Notes, And Verification

**Files:**
- Modify generated route/tree or IPC files if project scripts update them.
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Regenerate codegen artifacts**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
pnpm --filter @synapse/desktop run generate:definitions-registry
pnpm --filter @synapse/dashboard build
```

Expected: generated files update only where new routes/IPC definitions require it.

- [ ] **Step 2: Add release note**

Append to `RELEASE_NOTES_PENDING.md` under the current pending section:

```md
- Added cloud Webhooks: logged-in users can create Webhook URLs in the dashboard, receive external calls through the server, and trigger local desktop Automations with request query, headers, and body variables.
```

- [ ] **Step 3: Run full focused verification**

Run:

```bash
pnpm --filter @synapse/shared test
pnpm --filter @synapse/shared typecheck
pnpm --filter @synapse/server test -- src/webhooks src/live src/deploy-config.spec.ts
pnpm --filter @synapse/server typecheck
pnpm --filter @synapse/dashboard build
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/live-connection-service.test.ts electron/services/__tests__/live-webhook-delivery-handler.test.ts electron/action-runtime/__tests__/template-variables.test.ts automation-trigger-packages/builtin/webhook src/automation-triggers
pnpm --filter @synapse/desktop run typecheck
```

Expected: all commands pass.

- [ ] **Step 4: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: pass. If it fails, fix only the files touched by this feature and rerun.

- [ ] **Step 5: Final status check**

Run:

```bash
git status --short
```

Expected: only intended files remain modified.

- [ ] **Step 6: Commit**

```bash
git add RELEASE_NOTES_PENDING.md shared server dashboard desktop pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat: add webhook live automation"
```

---

## Self-Review Notes

Spec coverage:

- Dashboard Webhook management: Tasks 3 and 6.
- Public URL `/webhooks/<publicId>/<secret>`: Tasks 3, 4, and 5.
- Multiple user clients and broadcast: Tasks 2 and 4.
- Shared protocol package: Task 1.
- Unified Live envelope including heartbeat: Task 2.
- Automation Webhook trigger and variables: Tasks 7 and 8.
- Receive/broadcast records capped to 100: Task 4.
- Nginx routing: Task 5.
- Security and redaction: Tasks 3, 4, 6, 8.
- Verification and release notes: Task 9.

Execution notes:

- Do not start dev servers unless a verification step explicitly requires runtime behavior.
- Do not use Browser/Chrome/Playwright for this implementation unless the user asks for visual verification.
- Keep dashboard UI inside existing shadcn/ui primitives and `ServerDataTable`.
- Keep cloud Webhook code separate from the existing desktop `AutomationIngressService`.
