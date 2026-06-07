# Webhook Delivery History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build user and admin Webhook delivery history pages while preserving delivery records after Webhook deletion.

**Architecture:** Keep Webhook management in the existing `WebhookService`, switch deletion to soft delete, and add paginated history query methods that return sanitized delivery summaries. Reuse shared DTOs across server and dashboard, and build one dashboard history feature that switches between user and admin APIs by current role.

**Tech Stack:** pnpm workspace, TypeScript, Prisma/PostgreSQL, NestJS, React, TanStack Router/Query/Table, shadcn/ui, Vitest.

---

## Source Spec

Implement the approved design in `docs/superpowers/specs/2026-06-07-webhook-delivery-history-design.md`.

Hard product decisions from the spec:

- Webhook deletion is soft delete.
- Deleted Webhooks no longer accept public requests.
- Deleted Webhook history and client receipts remain visible.
- Both ordinary users and admins get Webhook history.
- User and admin detail views both show sanitized summaries only.
- Dashboard history tables use `ServerDataTable`.
- Update `RELEASE_NOTES_PENDING.md`.

## File Map

Server data and service:

- Modify: `server/prisma/schema.prisma` - add `UserWebhook.deletedAt`, add delivery snapshot columns, prevent delivery loss on Webhook deletion.
- Create: `server/prisma/migrations/20260607090000_webhook_delivery_history/migration.sql` - add and backfill columns.
- Modify: `server/src/webhooks/webhook.service.ts` - soft delete, public lookup excludes deleted, delivery snapshot writes, paginated history methods.
- Modify: `server/src/webhooks/webhook.controller.ts` - add user history controller route.
- Modify: `server/src/webhooks/webhook.module.ts` - register the new controller export from `webhook.controller.ts`.
- Modify: `server/src/admin/admin.controller.ts` - add admin history route and audit read.
- Modify: `server/src/admin/admin.module.ts` - import `WebhookModule`.
- Modify tests: `server/src/webhooks/webhook.service.spec.ts`, `server/src/webhooks/webhook.controller.spec.ts`, `server/src/admin/admin.controller.spec.ts`.

Shared:

- Modify: `shared/src/webhook.ts` - add history DTOs and query option types.
- Existing barrel `shared/src/index.ts` already exports `webhook.ts`.
- Modify tests: `shared/src/webhook.test.ts`.

Dashboard API and UI:

- Modify: `dashboard/src/lib/api.ts` - add history response types and API methods.
- Modify: `dashboard/src/components/layout/data/sidebar-data.ts` and test - add `Webhook 历史` for users and admins.
- Create: `dashboard/src/routes/_authenticated/webhook-deliveries/index.tsx` - route with search validation.
- Create: `dashboard/src/features/webhook-deliveries/index.tsx` - role-aware page.
- Create: `dashboard/src/features/webhook-deliveries/webhook-delivery-history-columns.tsx` - table columns.
- Create: `dashboard/src/features/webhook-deliveries/webhook-delivery-history-detail-sheet.tsx` - delivery details.
- Create: `dashboard/src/features/webhook-deliveries/webhook-delivery-history-display.ts` - labels and formatting helpers.
- Create tests: `dashboard/src/features/webhook-deliveries/webhook-delivery-history-display.test.ts`.
- Modify: `dashboard/src/features/webhooks/index.tsx` - `记录` navigates to `/webhook-deliveries?webhookId=...`.
- Remove: `dashboard/src/features/webhooks/webhook-deliveries-sheet.tsx`.

Generated route tree:

- Modify only by running the dashboard typecheck/build path if the TanStack router plugin updates `dashboard/src/routeTree.gen.ts`.

Release:

- Modify: `RELEASE_NOTES_PENDING.md`.

---

### Task 1: Shared DTOs And Display Labels

**Files:**

- Modify: `shared/src/webhook.ts`
- Modify: `shared/src/webhook.test.ts`
- Modify: `dashboard/src/features/webhooks/webhook-display.ts`
- Create: `dashboard/src/features/webhook-deliveries/webhook-delivery-history-display.ts`
- Create: `dashboard/src/features/webhook-deliveries/webhook-delivery-history-display.test.ts`

- [ ] **Step 1: Write failing shared DTO tests**

Append these tests to `shared/src/webhook.test.ts`:

```ts
import type { WebhookDeliveryHistoryDto } from "./webhook"

it("exports a delivery history DTO that can carry deleted webhook and admin user summaries", () => {
  const row: WebhookDeliveryHistoryDto = {
    id: "delivery-1",
    webhookId: "webhook-1",
    method: "POST",
    path: "/webhooks/wh_public/***",
    query: { event: "push" },
    headers: { "x-github-event": "push" },
    bodyKind: "json",
    bodySize: 12,
    bodyPreview: "{\"ok\":true}",
    receivedAt: "2026-06-07T09:00:00.000Z",
    onlineClientCount: 2,
    sentClientCount: 2,
    failedClientCount: 0,
    acknowledgedClientCount: 1,
    clientReceipts: [],
    status: WEBHOOK_DELIVERY_STATUS.delivered,
    webhook: {
      id: "webhook-1",
      publicId: "wh_public",
      name: "GitHub",
      currentName: "GitHub",
      deletedAt: "2026-06-07T10:00:00.000Z",
    },
    user: {
      id: "user-1",
      email: "user@example.com",
      displayName: null,
    },
  }

  expect(row.webhook.deletedAt).toBe("2026-06-07T10:00:00.000Z")
  expect(row.user?.email).toBe("user@example.com")
})
```

- [ ] **Step 2: Run shared tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/shared test
```

Expected: fail with `WebhookDeliveryHistoryDto` missing from `shared/src/webhook.ts`.

- [ ] **Step 3: Add shared DTOs**

In `shared/src/webhook.ts`, add after `WebhookDeliveryDto`:

```ts
export interface WebhookDeliveryHistoryWebhookDto {
  readonly id: string
  readonly publicId: string
  readonly name: string
  readonly currentName?: string
  readonly deletedAt?: string
}

export interface WebhookDeliveryHistoryUserDto {
  readonly id: string
  readonly email: string
  readonly displayName: string | null
}

export interface WebhookDeliveryHistoryDto extends WebhookDeliveryDto {
  readonly webhook: WebhookDeliveryHistoryWebhookDto
  readonly user?: WebhookDeliveryHistoryUserDto
}
```

- [ ] **Step 4: Run shared tests and confirm pass**

Run:

```bash
pnpm --filter @synapse/shared test
```

Expected: pass.

- [ ] **Step 5: Add dashboard display helper tests**

Create `dashboard/src/features/webhook-deliveries/webhook-delivery-history-display.test.ts`:

```ts
import { WEBHOOK_DELIVERY_STATUS, type WebhookDeliveryHistoryDto } from '@synapse/shared'
import { describe, expect, it } from 'vitest'
import {
  formatWebhookDeliveryClientSummary,
  formatWebhookDeliveryHistoryBody,
  getWebhookDeliveryHistoryStatusBadgeVariant,
  getWebhookHistoryDisplayName,
} from './webhook-delivery-history-display'

function row(input: Partial<WebhookDeliveryHistoryDto> = {}): WebhookDeliveryHistoryDto {
  return {
    id: 'delivery-1',
    webhookId: 'webhook-1',
    method: 'POST',
    path: '/webhooks/wh_public/***',
    query: {},
    headers: {},
    bodyKind: 'json',
    bodySize: 12,
    receivedAt: '2026-06-07T09:00:00.000Z',
    onlineClientCount: 2,
    sentClientCount: 2,
    failedClientCount: 0,
    acknowledgedClientCount: 1,
    clientReceipts: [],
    status: WEBHOOK_DELIVERY_STATUS.sent,
    webhook: {
      id: 'webhook-1',
      publicId: 'wh_public',
      name: 'GitHub',
    },
    ...input,
  }
}

describe('webhook delivery history display helpers', () => {
  it('uses the delivery-time webhook snapshot name', () => {
    expect(getWebhookHistoryDisplayName(row({
      webhook: {
        id: 'webhook-1',
        publicId: 'wh_public',
        name: 'Old name',
        currentName: 'New name',
      },
    }))).toBe('Old name')
  })

  it('formats compact client and body summaries', () => {
    expect(formatWebhookDeliveryClientSummary(row())).toBe('1/2/2')
    expect(formatWebhookDeliveryHistoryBody(row())).toBe('json · 12 B')
  })

  it('maps delivery status to badge variants', () => {
    expect(getWebhookDeliveryHistoryStatusBadgeVariant(WEBHOOK_DELIVERY_STATUS.delivered)).toBe('default')
    expect(getWebhookDeliveryHistoryStatusBadgeVariant(WEBHOOK_DELIVERY_STATUS.broadcastFailed)).toBe('destructive')
    expect(getWebhookDeliveryHistoryStatusBadgeVariant(WEBHOOK_DELIVERY_STATUS.noOnlineClients)).toBe('secondary')
  })
})
```

- [ ] **Step 6: Run dashboard helper test and confirm failure**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/webhook-deliveries/webhook-delivery-history-display.test.ts
```

Expected: fail because the helper file does not exist.

- [ ] **Step 7: Implement display helpers**

Create `dashboard/src/features/webhook-deliveries/webhook-delivery-history-display.ts`:

```ts
import type { WebhookDeliveryHistoryDto, WebhookDeliveryStatus } from '@synapse/shared'

export type HistoryStatusBadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

export function getWebhookHistoryDisplayName(delivery: Pick<WebhookDeliveryHistoryDto, 'webhook'>) {
  return delivery.webhook.name
}

export function formatWebhookDeliveryClientSummary(
  delivery: Pick<WebhookDeliveryHistoryDto, 'acknowledgedClientCount' | 'sentClientCount' | 'onlineClientCount'>
) {
  return `${delivery.acknowledgedClientCount}/${delivery.sentClientCount}/${delivery.onlineClientCount}`
}

export function formatWebhookDeliveryHistoryBody(
  delivery: Pick<WebhookDeliveryHistoryDto, 'bodyKind' | 'bodySize'>
) {
  return `${delivery.bodyKind} · ${delivery.bodySize} B`
}

export function getWebhookDeliveryHistoryStatusBadgeVariant(
  status: WebhookDeliveryStatus
): HistoryStatusBadgeVariant {
  if (status === 'delivered') return 'default'
  if (status === 'broadcast_failed') return 'destructive'
  if (status === 'received' || status === 'sent') return 'outline'
  return 'secondary'
}

export function formatWebhookDeliveryHistoryDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN')
}
```

- [ ] **Step 8: Run helper tests and commit**

Run:

```bash
pnpm --filter @synapse/shared test
pnpm --filter @synapse/dashboard exec vitest run src/features/webhook-deliveries/webhook-delivery-history-display.test.ts
```

Expected: both pass.

Commit:

```bash
git add shared/src/webhook.ts shared/src/webhook.test.ts dashboard/src/features/webhook-deliveries/webhook-delivery-history-display.ts dashboard/src/features/webhook-deliveries/webhook-delivery-history-display.test.ts
git commit -m "feat(webhooks): add delivery history shared types"
```

---

### Task 2: Soft Delete And Delivery Snapshots

**Files:**

- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260607090000_webhook_delivery_history/migration.sql`
- Modify: `server/src/webhooks/webhook.service.ts`
- Modify: `server/src/webhooks/webhook.service.spec.ts`

- [ ] **Step 1: Write failing service tests for soft delete and active lookup**

In `server/src/webhooks/webhook.service.spec.ts`, add these tests inside `describe("WebhookService", () => { ... })`:

```ts
it("soft-deletes webhooks without deleting delivery history", async () => {
  const prisma = createPrismaMock()
  const tx = {
    userWebhook: {
      findFirst: vi.fn().mockResolvedValue({ id: "webhook-1", publicId: "wh_public", name: "GitHub", enabled: true }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: { create: vi.fn() },
  }
  prisma.user.findUnique.mockResolvedValue({ email: "user@example.com" })
  prisma.$transaction.mockImplementation((callback) => callback(tx))
  const service = new WebhookService(prisma as never, {}, {} as never)

  await expect(service.deleteForUser("user-1", "webhook-1", "203.0.113.13")).resolves.toEqual({ ok: true })

  expect(tx.userWebhook.updateMany).toHaveBeenCalledWith({
    where: { id: "webhook-1", userId: "user-1", deletedAt: null },
    data: {
      deletedAt: expect.any(Date),
      enabled: false,
      secret: null,
    },
  })
  expect(tx.userWebhook.findFirst).toHaveBeenCalledWith({
    where: { id: "webhook-1", userId: "user-1", deletedAt: null },
    select: { id: true, publicId: true, name: true, enabled: true },
  })
  expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ action: "webhook.delete" }),
  }))
})

it("excludes soft-deleted webhooks from the management list", async () => {
  const prisma = createPrismaMock()
  prisma.userWebhook.findMany.mockResolvedValue([])
  const service = new WebhookService(prisma as never)

  await expect(service.listForUser("user-1", "https://synapse.test")).resolves.toEqual([])

  expect(prisma.userWebhook.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { userId: "user-1", deletedAt: null },
  }))
})

it("does not accept public deliveries for deleted webhooks", async () => {
  const harness = createWebhookReceiveHarness()
  harness.prisma.userWebhook.findFirst.mockResolvedValue({
    ...baseWebhook,
    deletedAt: new Date("2026-06-07T10:00:00.000Z"),
    secretHash: hashWebhookSecret("whsec_secret"),
  })

  await expect(harness.receive()).rejects.toThrow(NotFoundException)
  expect(harness.live.broadcastToUser).not.toHaveBeenCalled()
  expect(harness.deliveries).toHaveLength(0)
})
```

- [ ] **Step 2: Write failing service test for delivery snapshots**

Add this test near the existing receive tests:

```ts
it("stores webhook snapshot fields on accepted deliveries", async () => {
  const harness = createWebhookReceiveHarness()

  await expect(harness.receive()).resolves.toMatchObject({
    response: { ok: true, deliveryId: "delivery-1" },
  })

  expect(harness.deliveries).toEqual([
    expect.objectContaining({
      webhookId: "webhook-1",
      webhookPublicId: "wh_public",
      webhookName: "GitHub",
      userId: "user-1",
    }),
  ])
})
```

- [ ] **Step 3: Run WebhookService tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/server test -- src/webhooks/webhook.service.spec.ts
```

Expected: fail because `deletedAt`, soft delete behavior, and snapshot writes are not implemented.

- [ ] **Step 4: Update Prisma schema**

In `server/prisma/schema.prisma`, update the Webhook models to this shape:

```prisma
model UserWebhook {
  id         String            @id @default(cuid())
  userId     String
  user       User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  publicId   String            @unique
  secretHash String
  secret     String?
  name       String            @db.VarChar(80)
  enabled    Boolean           @default(true)
  deletedAt  DateTime?
  createdAt  DateTime          @default(now())
  updatedAt  DateTime          @updatedAt
  deliveries WebhookDelivery[]

  @@index([userId, createdAt])
  @@index([userId, deletedAt, createdAt])
}

model WebhookDelivery {
  id                String      @id @default(cuid())
  webhookId         String
  webhook           UserWebhook @relation(fields: [webhookId], references: [id], onDelete: Restrict)
  userId            String
  webhookPublicId   String
  webhookName       String
  method            String
  path              String
  query             Json
  headers           Json
  bodyKind          String
  bodySize          Int
  bodyPreview       String?
  receivedAt        DateTime    @default(now())
  onlineClientCount Int
  sentClientCount   Int
  failedClientCount Int
  status            String
  error             String?
  receipts          WebhookDeliveryReceipt[]

  @@index([webhookId, receivedAt])
  @@index([userId, receivedAt])
  @@index([status, receivedAt])
}
```

- [ ] **Step 5: Add migration SQL**

Create `server/prisma/migrations/20260607090000_webhook_delivery_history/migration.sql`:

```sql
ALTER TABLE "UserWebhook"
  ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "WebhookDelivery"
  ADD COLUMN "webhookPublicId" TEXT,
  ADD COLUMN "webhookName" TEXT;

UPDATE "WebhookDelivery" AS delivery
SET
  "webhookPublicId" = webhook."publicId",
  "webhookName" = webhook."name"
FROM "UserWebhook" AS webhook
WHERE delivery."webhookId" = webhook."id";

ALTER TABLE "WebhookDelivery"
  ALTER COLUMN "webhookPublicId" SET NOT NULL,
  ALTER COLUMN "webhookName" SET NOT NULL;

DROP INDEX IF EXISTS "UserWebhook_userId_deletedAt_createdAt_idx";
CREATE INDEX "UserWebhook_userId_deletedAt_createdAt_idx"
  ON "UserWebhook"("userId", "deletedAt", "createdAt");

DROP INDEX IF EXISTS "WebhookDelivery_status_receivedAt_idx";
CREATE INDEX "WebhookDelivery_status_receivedAt_idx"
  ON "WebhookDelivery"("status", "receivedAt");

ALTER TABLE "WebhookDelivery"
  DROP CONSTRAINT "WebhookDelivery_webhookId_fkey";

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_webhookId_fkey"
  FOREIGN KEY ("webhookId") REFERENCES "UserWebhook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 6: Implement soft delete and active filtering**

In `server/src/webhooks/webhook.service.ts`:

1. Change `listForUser` query:

```ts
where: { userId, deletedAt: null },
```

2. Replace `deleteForUser` with:

```ts
async deleteForUser(userId: string, id: string, ipAddress = "system"): Promise<{ readonly ok: true }> {
  const actorEmail = await this.getAuditActorEmail(userId)
  const deletedAt = new Date()
  await this.prisma.$transaction(async (tx) => {
    const webhook = await tx.userWebhook.findFirst({
      where: { id, userId, deletedAt: null },
      select: { id: true, publicId: true, name: true, enabled: true },
    })
    if (!webhook) throw new NotFoundException("Webhook not found")
    const result = await tx.userWebhook.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt, enabled: false, secret: null },
    })
    if (result.count === 0) throw new NotFoundException("Webhook not found")
    await this.createWebhookAudit(tx, {
      actorEmail,
      action: "webhook.delete",
      webhook,
      detail: { publicId: webhook.publicId, name: webhook.name, enabled: webhook.enabled },
      ipAddress,
    })
  })
  return { ok: true }
}
```

3. In `findEnabledPublicWebhook`, add `deletedAt: null` to `where`:

```ts
where: { publicId, deletedAt: null },
```

- [ ] **Step 7: Store delivery snapshot fields**

In `receivePublicWebhook`, add these fields to the `webhookDelivery.create({ data })` call:

```ts
webhookPublicId: webhook.publicId,
webhookName: webhook.name,
```

Update local test harness delivery objects only as needed so `createWebhookReceiveHarness()` preserves those fields when storing in `deliveries`.

- [ ] **Step 8: Run service tests and type generation**

Run:

```bash
pnpm --filter @synapse/server prisma:generate
pnpm --filter @synapse/server test -- src/webhooks/webhook.service.spec.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260607090000_webhook_delivery_history/migration.sql server/src/webhooks/webhook.service.ts server/src/webhooks/webhook.service.spec.ts
git commit -m "feat(webhooks): preserve delivery history on delete"
```

---

### Task 3: User And Admin History APIs

**Files:**

- Modify: `server/src/webhooks/webhook.service.ts`
- Modify: `server/src/webhooks/webhook.controller.ts`
- Modify: `server/src/webhooks/webhook.module.ts`
- Modify: `server/src/admin/admin.controller.ts`
- Modify: `server/src/admin/admin.module.ts`
- Modify: `server/src/webhooks/webhook.service.spec.ts`
- Modify: `server/src/webhooks/webhook.controller.spec.ts`
- Modify: `server/src/admin/admin.controller.spec.ts`

- [ ] **Step 1: Write failing service tests for user/admin history**

Add to `server/src/webhooks/webhook.service.spec.ts`:

```ts
it("lists current-user delivery history with filters and webhook metadata", async () => {
  const prisma = createPrismaMock()
  const deliveries = [{
    id: "delivery-1",
    webhookId: "webhook-1",
    webhookPublicId: "wh_public",
    webhookName: "GitHub",
    method: "POST",
    path: "/webhooks/wh_public/***",
    query: { event: "push" },
    headers: { "x-github-event": "push" },
    bodyKind: "json",
    bodySize: 12,
    bodyPreview: "{\"ok\":true}",
    receivedAt: new Date("2026-06-07T09:00:00.000Z"),
    onlineClientCount: 2,
    sentClientCount: 2,
    failedClientCount: 0,
    status: WEBHOOK_DELIVERY_STATUS.delivered,
    error: null,
    receipts: [],
    webhook: {
      id: "webhook-1",
      publicId: "wh_public",
      name: "GitHub current",
      deletedAt: new Date("2026-06-07T10:00:00.000Z"),
    },
  }]
  prisma.webhookDelivery.findMany.mockResolvedValue(deliveries)
  prisma.webhookDelivery.count = vi.fn().mockResolvedValue(1)
  prisma.$transaction.mockImplementation((input) => Array.isArray(input) ? Promise.all(input) : input({}))
  const service = new WebhookService(prisma as never)

  await expect(service.listDeliveryHistoryForUser("user-1", {
    pagination: { page: 1, pageSize: 20, sortBy: "receivedAt", sortOrder: "desc" },
    filters: { webhookId: "webhook-1", status: WEBHOOK_DELIVERY_STATUS.delivered, from: "2026-06-07", to: "2026-06-08" },
  })).resolves.toMatchObject({
    total: 1,
    data: [{
      id: "delivery-1",
      webhook: {
        id: "webhook-1",
        publicId: "wh_public",
        name: "GitHub",
        currentName: "GitHub current",
        deletedAt: "2026-06-07T10:00:00.000Z",
      },
    }],
  })
})

it("lists admin delivery history across users with user summaries", async () => {
  const prisma = createPrismaMock()
  const delivery = {
    id: "delivery-1",
    webhookId: "webhook-1",
    webhookPublicId: "wh_public",
    webhookName: "GitHub",
    method: "POST",
    path: "/webhooks/wh_public/***",
    query: {},
    headers: {},
    bodyKind: "json",
    bodySize: 12,
    bodyPreview: null,
    receivedAt: new Date("2026-06-07T09:00:00.000Z"),
    onlineClientCount: 0,
    sentClientCount: 0,
    failedClientCount: 0,
    status: WEBHOOK_DELIVERY_STATUS.noOnlineClients,
    error: null,
    receipts: [],
    webhook: { id: "webhook-1", publicId: "wh_public", name: "GitHub", deletedAt: null },
    user: { id: "user-1", email: "user@example.com", displayName: "Ada" },
  }
  prisma.webhookDelivery.findMany.mockResolvedValue([delivery])
  prisma.webhookDelivery.count = vi.fn().mockResolvedValue(1)
  prisma.$transaction.mockImplementation((input) => Array.isArray(input) ? Promise.all(input) : input({}))
  const service = new WebhookService(prisma as never)

  await expect(service.listDeliveryHistoryForAdmin({
    pagination: { page: 1, pageSize: 20, sortBy: "receivedAt", sortOrder: "desc" },
    filters: { user: "user@example.com" },
  })).resolves.toMatchObject({
    data: [{ user: { email: "user@example.com", displayName: "Ada" } }],
    total: 1,
  })
})
```

If the existing `createPrismaMock()` lacks `webhookDelivery.count`, add:

```ts
count: vi.fn(),
```

to the `webhookDelivery` mock object.

- [ ] **Step 2: Run service tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/server test -- src/webhooks/webhook.service.spec.ts
```

Expected: fail because history service methods do not exist.

- [ ] **Step 3: Implement history filter types and helpers**

In `server/src/webhooks/webhook.service.ts`, add imports:

```ts
import { BadRequestException, /* keep existing imports */ } from "@nestjs/common"
import { parsePagination, toPrismaArgs, type PaginatedResponse, type PaginationQuery } from "../common/pagination"
```

Add types near the existing record types:

```ts
type WebhookDeliveryHistoryFilters = {
  readonly webhookId?: string
  readonly status?: string
  readonly from?: string
  readonly to?: string
  readonly userId?: string
  readonly user?: string
}

type WebhookDeliveryHistoryOptions = {
  readonly pagination: PaginationQuery
  readonly filters?: WebhookDeliveryHistoryFilters
}
```

Add helper functions near the existing helper section:

```ts
function parseDeliveryHistoryDate(value: string): Date {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new BadRequestException("日期参数无效。")
  return date
}

function buildDeliveryHistoryWhere(
  ownerUserId: string | null,
  filters: WebhookDeliveryHistoryFilters = {},
): Prisma.WebhookDeliveryWhereInput {
  const where: Prisma.WebhookDeliveryWhereInput = {}
  if (ownerUserId) where.userId = ownerUserId
  if (!ownerUserId && filters.userId) where.userId = filters.userId
  if (filters.webhookId) where.webhookId = filters.webhookId
  if (filters.status) {
    if (!webhookStatusValues.has(filters.status)) throw new BadRequestException("Webhook delivery status is invalid.")
    where.status = filters.status
  }
  if (filters.from || filters.to) {
    where.receivedAt = {
      ...(filters.from ? { gte: parseDeliveryHistoryDate(filters.from) } : {}),
      ...(filters.to ? { lte: parseDeliveryHistoryDate(filters.to) } : {}),
    }
  }
  if (!ownerUserId && filters.user) {
    where.user = {
      OR: [
        { email: { contains: filters.user, mode: "insensitive" } },
        { displayName: { contains: filters.user, mode: "insensitive" } },
      ],
    }
  }
  return where
}
```

- [ ] **Step 4: Implement history query methods**

Add public methods to `WebhookService`:

```ts
async listDeliveryHistoryForUser(
  userId: string,
  options: WebhookDeliveryHistoryOptions,
): Promise<PaginatedResponse<WebhookDeliveryHistoryDto>> {
  const where = buildDeliveryHistoryWhere(userId, options.filters)
  const [deliveries, total] = await this.prisma.$transaction([
    this.prisma.webhookDelivery.findMany({
      where,
      ...toPrismaArgs(options.pagination),
      include: deliveryHistoryInclude(false),
    }),
    this.prisma.webhookDelivery.count({ where }),
  ])
  return {
    data: deliveries.map((delivery) => toWebhookDeliveryHistoryDto(delivery, false)),
    total,
    page: options.pagination.page,
    pageSize: options.pagination.pageSize,
  }
}

async listDeliveryHistoryForAdmin(
  options: WebhookDeliveryHistoryOptions,
): Promise<PaginatedResponse<WebhookDeliveryHistoryDto>> {
  const where = buildDeliveryHistoryWhere(null, options.filters)
  const [deliveries, total] = await this.prisma.$transaction([
    this.prisma.webhookDelivery.findMany({
      where,
      ...toPrismaArgs(options.pagination),
      include: deliveryHistoryInclude(true),
    }),
    this.prisma.webhookDelivery.count({ where }),
  ])
  return {
    data: deliveries.map((delivery) => toWebhookDeliveryHistoryDto(delivery, true)),
    total,
    page: options.pagination.page,
    pageSize: options.pagination.pageSize,
  }
}
```

Add include and DTO helpers:

```ts
function deliveryHistoryInclude(includeUser: boolean) {
  return {
    receipts: { orderBy: { sentAt: "asc" as const } },
    webhook: {
      select: {
        id: true,
        publicId: true,
        name: true,
        deletedAt: true,
      },
    },
    ...(includeUser
      ? {
          user: {
            select: {
              id: true,
              email: true,
              displayName: true,
            },
          },
        }
      : {}),
  }
}

function toWebhookDeliveryHistoryDto(
  delivery: DeliveryRecord & {
    readonly webhookPublicId?: string
    readonly webhookName?: string
    readonly webhook?: {
      readonly id: string
      readonly publicId: string
      readonly name: string
      readonly deletedAt: Date | null
    }
    readonly user?: {
      readonly id: string
      readonly email: string
      readonly displayName: string | null
    }
  },
  includeUser: boolean,
): WebhookDeliveryHistoryDto {
  const dto = toWebhookDeliveryDto(delivery)
  return {
    ...dto,
    webhook: {
      id: delivery.webhook?.id ?? delivery.webhookId,
      publicId: delivery.webhookPublicId ?? delivery.webhook?.publicId ?? "-",
      name: delivery.webhookName ?? delivery.webhook?.name ?? "已删除 Webhook",
      ...(delivery.webhook?.name ? { currentName: delivery.webhook.name } : {}),
      ...(delivery.webhook?.deletedAt ? { deletedAt: delivery.webhook.deletedAt.toISOString() } : {}),
    },
    ...(includeUser && delivery.user
      ? {
          user: {
            id: delivery.user.id,
            email: delivery.user.email,
            displayName: delivery.user.displayName,
          },
        }
      : {}),
  }
}
```

Add `WebhookDeliveryHistoryDto` to the shared imports from `@synapse/shared`.

- [ ] **Step 5: Write controller tests**

In `server/src/webhooks/webhook.controller.spec.ts`, import the new controller and add:

```ts
it("lists current-user delivery history with pagination and filters", async () => {
  const service = {
    listDeliveryHistoryForUser: vi.fn().mockResolvedValue({ data: [], total: 0, page: 2, pageSize: 10 }),
  }
  const controller = new WebhookDeliveryDashboardController(service as unknown as WebhookService)

  await expect(controller.list({
    page: "2",
    pageSize: "10",
    sortBy: "receivedAt",
    sortOrder: "desc",
    webhookId: "webhook-1",
    status: "delivered",
    from: "2026-06-07",
    to: "2026-06-08",
  }, createRequest() as never)).resolves.toEqual({ data: [], total: 0, page: 2, pageSize: 10 })

  expect(service.listDeliveryHistoryForUser).toHaveBeenCalledWith("user-1", {
    pagination: { page: 2, pageSize: 10, sortBy: "receivedAt", sortOrder: "desc" },
    filters: {
      webhookId: "webhook-1",
      status: "delivered",
      from: "2026-06-07",
      to: "2026-06-08",
    },
  })
})
```

In `server/src/admin/admin.controller.spec.ts`, update `createController` to accept a Webhook service:

```ts
function createController(
  service: Partial<AdminService>,
  auditLog: Partial<AuditLogService> = {},
  webhooks: { listDeliveryHistoryForAdmin?: ReturnType<typeof vi.fn> } = {},
) {
  return new AdminController(
    service as AdminService,
    { record: vi.fn().mockResolvedValue(undefined), ...auditLog } as AuditLogService,
    webhooks as never,
  )
}
```

Add:

```ts
it("lists admin webhook delivery history and audits the read", async () => {
  const listDeliveryHistoryForAdmin = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 })
  const record = vi.fn().mockResolvedValue(undefined)
  const controller = createController({}, { record }, { listDeliveryHistoryForAdmin })

  await expect(controller.listWebhookDeliveries({
    page: "1",
    pageSize: "20",
    sortBy: "receivedAt",
    sortOrder: "desc",
    user: "user@example.com",
  }, { admin: { email: "admin@example.com" }, ip: "203.0.113.10" } as never))
    .resolves
    .toEqual({ data: [], total: 0, page: 1, pageSize: 20 })

  expect(listDeliveryHistoryForAdmin).toHaveBeenCalledWith({
    pagination: { page: 1, pageSize: 20, sortBy: "receivedAt", sortOrder: "desc" },
    filters: { user: "user@example.com" },
  })
  expect(record).toHaveBeenCalledWith(expect.objectContaining({
    action: "admin.webhook_deliveries.list",
    targetType: "webhook_delivery",
    targetId: "list",
  }))
})
```

- [ ] **Step 6: Implement user history controller**

In `server/src/webhooks/webhook.controller.ts`, add imports:

```ts
import { Query } from "@nestjs/common"
import { parsePagination } from "../common/pagination"
```

Add constants:

```ts
const deliveryHistorySortFields = ["receivedAt", "status", "method"] as const
```

Add controller:

```ts
@UseGuards(UserAuthGuard)
@Controller("/api/dashboard/webhook-deliveries")
export class WebhookDeliveryDashboardController {
  constructor(private readonly webhooks: WebhookService) {}

  @Get()
  list(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedUserRequest) {
    return this.webhooks.listDeliveryHistoryForUser(request.user!.id, {
      pagination: parsePagination(query, { allowedSortFields: deliveryHistorySortFields }),
      filters: readDeliveryHistoryFilters(query),
    })
  }
}
```

Add helper:

```ts
function readDeliveryHistoryFilters(query: Record<string, unknown>) {
  return {
    webhookId: typeof query.webhookId === "string" ? query.webhookId : undefined,
    status: typeof query.status === "string" ? query.status : undefined,
    from: typeof query.from === "string" ? query.from : undefined,
    to: typeof query.to === "string" ? query.to : undefined,
    userId: typeof query.userId === "string" ? query.userId : undefined,
    user: typeof query.user === "string" ? query.user : undefined,
  }
}
```

In `server/src/webhooks/webhook.module.ts`, add `WebhookDeliveryDashboardController` to the controller import and `controllers` array.

- [ ] **Step 7: Implement admin endpoint**

In `server/src/admin/admin.module.ts`, import `WebhookModule` and add it to `imports`:

```ts
import { WebhookModule } from "../webhooks/webhook.module"

@Module({
  imports: [AdminAuthModule, PermissionsModule, LiveModule, WebhookModule],
  // keep the rest
})
```

In `server/src/admin/admin.controller.ts`, import:

```ts
import { WebhookService } from "../webhooks/webhook.service"
```

Add sort fields:

```ts
const webhookDeliverySortFields = ["receivedAt", "status", "method"] as const
```

Update constructor:

```ts
constructor(
  private readonly admin: AdminService,
  private readonly auditLog: AuditLogService,
  private readonly webhooks: WebhookService,
) {}
```

Add method:

```ts
@Get("/webhook-deliveries")
async listWebhookDeliveries(@Query() query: Record<string, unknown>, @Req() request?: AdminRequest) {
  const pagination = parsePagination(query, { allowedSortFields: webhookDeliverySortFields })
  const filters = {
    userId: typeof query.userId === "string" ? query.userId : undefined,
    user: typeof query.user === "string" ? query.user : undefined,
    webhookId: typeof query.webhookId === "string" ? query.webhookId : undefined,
    status: typeof query.status === "string" ? query.status : undefined,
    from: typeof query.from === "string" ? query.from : undefined,
    to: typeof query.to === "string" ? query.to : undefined,
  }
  const result = await this.webhooks.listDeliveryHistoryForAdmin({ pagination, filters })
  await this.recordAdminRead(request, {
    action: "admin.webhook_deliveries.list",
    targetType: "webhook_delivery",
    targetId: "list",
    detail: { page: pagination.page, pageSize: pagination.pageSize, filters },
  })
  return result
}
```

- [ ] **Step 8: Run API tests**

Run:

```bash
pnpm --filter @synapse/server test -- src/webhooks/webhook.service.spec.ts src/webhooks/webhook.controller.spec.ts src/admin/admin.controller.spec.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add server/src/webhooks/webhook.service.ts server/src/webhooks/webhook.controller.ts server/src/webhooks/webhook.module.ts server/src/admin/admin.controller.ts server/src/admin/admin.module.ts server/src/webhooks/webhook.service.spec.ts server/src/webhooks/webhook.controller.spec.ts server/src/admin/admin.controller.spec.ts
git commit -m "feat(webhooks): add delivery history APIs"
```

---

### Task 4: Dashboard API, Route, Sidebar, And Navigation

**Files:**

- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/components/layout/data/sidebar-data.ts`
- Modify: `dashboard/src/components/layout/data/sidebar-data.test.ts`
- Create: `dashboard/src/routes/_authenticated/webhook-deliveries/index.tsx`
- Modify: `dashboard/src/features/webhooks/index.tsx`
- Modify: `dashboard/src/features/webhooks/webhook-cache.test.ts`
- Remove: `dashboard/src/features/webhooks/webhook-deliveries-sheet.tsx`

- [ ] **Step 1: Write failing sidebar tests**

Update `dashboard/src/components/layout/data/sidebar-data.test.ts` expectations:

```ts
expect(collectUrls(data)).toContain('/webhooks')
expect(collectUrls(data)).toContain('/webhook-deliveries')
expect(collectUrls(data)).toContain('/settings')
```

For admin test:

```ts
expect(collectUrls(data)).toContain('/webhook-deliveries')
expect(collectUrls(data)).not.toContain('/webhooks')
```

- [ ] **Step 2: Write navigation helper test**

In `dashboard/src/features/webhooks/webhook-cache.test.ts`, import a new helper:

```ts
import { getWebhookDeliveriesHref, removeDeletedWebhookFromCache } from './index'
```

Add:

```ts
it('builds a filtered history href for a webhook', () => {
  expect(getWebhookDeliveriesHref('webhook-1')).toBe('/webhook-deliveries?webhookId=webhook-1')
  expect(getWebhookDeliveriesHref('webhook/with space')).toBe('/webhook-deliveries?webhookId=webhook%2Fwith+space')
})
```

- [ ] **Step 3: Run dashboard tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/components/layout/data/sidebar-data.test.ts src/features/webhooks/webhook-cache.test.ts
```

Expected: fail because sidebar data and `getWebhookDeliveriesHref` are not updated.

- [ ] **Step 4: Add dashboard API types and methods**

In `dashboard/src/lib/api.ts`, update shared imports:

```ts
import type {
  DashboardWebhookDto,
  DashboardWebhookSecretResult,
  WebhookDeliveryDto,
  WebhookDeliveryHistoryDto,
} from '@synapse/shared'
```

Add query type:

```ts
export type WebhookDeliveryHistoryQuery = PaginationOptions & {
  webhookId?: string
  status?: string
  from?: string
  to?: string
  userId?: string
  user?: string
}
```

Add API methods in `dashboardApi`:

```ts
listWebhookDeliveryHistory: (options: WebhookDeliveryHistoryQuery = {}) =>
  request<PaginatedResponse<WebhookDeliveryHistoryDto>>(
    `${dashboardApiBasePath}/webhook-deliveries${querySuffix(options)}`
  ),
```

Add API methods in `adminApi`:

```ts
listWebhookDeliveryHistory: (options: WebhookDeliveryHistoryQuery = {}) =>
  request<PaginatedResponse<WebhookDeliveryHistoryDto>>(
    `${adminApiBasePath}/webhook-deliveries${querySuffix(options)}`
  ),
```

- [ ] **Step 5: Add route search validation**

Create `dashboard/src/routes/_authenticated/webhook-deliveries/index.tsx`:

```tsx
import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import WebhookDeliveriesPage from '@/features/webhook-deliveries'

const searchSchema = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  webhookId: z.string().optional(),
  status: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  user: z.string().optional(),
  userId: z.string().optional(),
})

export const Route = createFileRoute('/_authenticated/webhook-deliveries/')({
  component: WebhookDeliveriesPage,
  validateSearch: searchSchema,
})
```

- [ ] **Step 6: Update sidebar data**

In `dashboard/src/components/layout/data/sidebar-data.ts`, import `History` from `lucide-react` and add:

```ts
{
  title: 'Webhook 历史',
  url: '/webhook-deliveries',
  icon: History,
}
```

For ordinary users, place it after `Webhooks`. For admins, place it in `adminNavGroup` near `审计日志`.

- [ ] **Step 7: Change Webhook card record navigation**

In `dashboard/src/features/webhooks/index.tsx`, import `useNavigate`:

```ts
import { useNavigate } from '@tanstack/react-router'
```

In `WebhooksPage`, add:

```ts
const navigate = useNavigate()
```

Replace the `deliveriesWebhook` state and `WebhookDeliveriesSheet` usage with navigation:

```ts
onOpenDeliveries={(webhook) => {
  void navigate({ to: '/webhook-deliveries', search: { webhookId: webhook.id } })
}}
```

Export helper near `removeDeletedWebhookFromCache`:

```ts
export function getWebhookDeliveriesHref(webhookId: string) {
  const query = new URLSearchParams({ webhookId })
  return `/webhook-deliveries?${query.toString()}`
}
```

Delete the `WebhookDeliveriesSheet` import and remove the sheet JSX.

- [ ] **Step 8: Run dashboard tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/components/layout/data/sidebar-data.test.ts src/features/webhooks/webhook-cache.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add dashboard/src/lib/api.ts dashboard/src/components/layout/data/sidebar-data.ts dashboard/src/components/layout/data/sidebar-data.test.ts dashboard/src/routes/_authenticated/webhook-deliveries/index.tsx dashboard/src/features/webhooks/index.tsx dashboard/src/features/webhooks/webhook-cache.test.ts
git rm dashboard/src/features/webhooks/webhook-deliveries-sheet.tsx
git commit -m "feat(dashboard): route webhook records to history"
```

---

### Task 5: Dashboard History Page

**Files:**

- Create: `dashboard/src/features/webhook-deliveries/index.tsx`
- Create: `dashboard/src/features/webhook-deliveries/webhook-delivery-history-columns.tsx`
- Create: `dashboard/src/features/webhook-deliveries/webhook-delivery-history-detail-sheet.tsx`
- Modify: `dashboard/src/features/webhook-deliveries/webhook-delivery-history-display.ts`
- Test: `dashboard/src/features/webhook-deliveries/webhook-delivery-history-display.test.ts`

- [ ] **Step 1: Extend display helper tests for query normalization**

In `dashboard/src/features/webhook-deliveries/webhook-delivery-history-display.test.ts`, add:

```ts
import { buildWebhookDeliveryHistoryQuery } from './webhook-delivery-history-display'

it('keeps only meaningful history query values', () => {
  expect(buildWebhookDeliveryHistoryQuery({
    page: 1,
    pageSize: 20,
    sortBy: 'receivedAt',
    sortOrder: 'desc',
    webhookId: 'webhook-1',
    status: '',
    from: '',
    to: '2026-06-08',
    user: ' user@example.com ',
  })).toEqual({
    page: 1,
    pageSize: 20,
    sortBy: 'receivedAt',
    sortOrder: 'desc',
    webhookId: 'webhook-1',
    to: '2026-06-08',
    user: 'user@example.com',
  })
})
```

- [ ] **Step 2: Implement query normalization helper**

Add to `webhook-delivery-history-display.ts`:

```ts
export type WebhookDeliveryHistoryQueryDraft = {
  page: number
  pageSize: number
  sortBy: string
  sortOrder: 'asc' | 'desc'
  webhookId?: string
  status?: string
  from?: string
  to?: string
  user?: string
  userId?: string
}

export function buildWebhookDeliveryHistoryQuery(input: WebhookDeliveryHistoryQueryDraft) {
  return {
    page: input.page,
    pageSize: input.pageSize,
    sortBy: input.sortBy,
    sortOrder: input.sortOrder,
    ...(input.webhookId?.trim() ? { webhookId: input.webhookId.trim() } : {}),
    ...(input.status?.trim() ? { status: input.status.trim() } : {}),
    ...(input.from?.trim() ? { from: input.from.trim() } : {}),
    ...(input.to?.trim() ? { to: input.to.trim() } : {}),
    ...(input.user?.trim() ? { user: input.user.trim() } : {}),
    ...(input.userId?.trim() ? { userId: input.userId.trim() } : {}),
  }
}
```

- [ ] **Step 3: Create table columns**

Create `dashboard/src/features/webhook-deliveries/webhook-delivery-history-columns.tsx`:

```tsx
import type { ReactNode } from 'react'
import type { WebhookDeliveryHistoryDto } from '@synapse/shared'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTableColumnHeader } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  formatWebhookDeliveryClientSummary,
  formatWebhookDeliveryHistoryBody,
  formatWebhookDeliveryHistoryDateTime,
  getWebhookDeliveryHistoryStatusBadgeVariant,
  getWebhookHistoryDisplayName,
} from './webhook-delivery-history-display'
import { getWebhookDeliveryStatusLabel } from '@/features/webhooks/webhook-display'

type BuildColumnsInput = {
  mode: 'user' | 'admin'
  onOpenDetail: (delivery: WebhookDeliveryHistoryDto) => void
}

export function buildWebhookDeliveryHistoryColumns({
  mode,
  onOpenDetail,
}: BuildColumnsInput): ColumnDef<WebhookDeliveryHistoryDto>[] {
  const columns: ColumnDef<WebhookDeliveryHistoryDto>[] = [
    {
      accessorKey: 'receivedAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title='时间' />,
      cell: ({ row }) => formatWebhookDeliveryHistoryDateTime(row.original.receivedAt),
    },
    {
      id: 'webhook',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Webhook' />,
      cell: ({ row }) => (
        <div className='flex min-w-0 flex-col gap-1'>
          <div className='flex min-w-0 items-center gap-2'>
            <span className='truncate font-medium'>{getWebhookHistoryDisplayName(row.original)}</span>
            {row.original.webhook.deletedAt ? <Badge variant='secondary'>已删除</Badge> : null}
          </div>
          <span className='truncate font-mono text-xs text-muted-foreground'>
            {row.original.webhook.publicId}
          </span>
        </div>
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'method',
      header: ({ column }) => <DataTableColumnHeader column={column} title='方法' />,
      cell: ({ row }) => <Badge variant='outline'>{row.original.method}</Badge>,
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title='状态' />,
      cell: ({ row }) => (
        <Badge variant={getWebhookDeliveryHistoryStatusBadgeVariant(row.original.status)}>
          {getWebhookDeliveryStatusLabel(row.original.status)}
        </Badge>
      ),
    },
    {
      id: 'clients',
      header: ({ column }) => <DataTableColumnHeader column={column} title='客户端' />,
      cell: ({ row }) => formatWebhookDeliveryClientSummary(row.original),
      enableSorting: false,
      meta: { thClassName: 'text-right', tdClassName: 'text-right tabular-nums' },
    },
    {
      id: 'body',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Body' />,
      cell: ({ row }) => formatWebhookDeliveryHistoryBody(row.original),
      enableSorting: false,
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <Button variant='ghost' className='h-8 px-2' onClick={() => onOpenDetail(row.original)}>
          详情
        </Button>
      ),
      enableSorting: false,
      enableHiding: false,
      meta: { thClassName: 'text-right', tdClassName: 'text-right' },
    },
  ]

  if (mode === 'admin') {
    columns.splice(1, 0, {
      id: 'user',
      header: ({ column }) => <DataTableColumnHeader column={column} title='用户' />,
      cell: ({ row }) => row.original.user?.email ?? '-',
      enableSorting: false,
    })
  }

  return columns
}
```

- [ ] **Step 4: Create detail sheet**

Create `dashboard/src/features/webhook-deliveries/webhook-delivery-history-detail-sheet.tsx`:

```tsx
import type { WebhookDeliveryHistoryDto } from '@synapse/shared'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  formatWebhookDeliveryHistoryBody,
  formatWebhookDeliveryHistoryDateTime,
  getWebhookDeliveryHistoryStatusBadgeVariant,
} from './webhook-delivery-history-display'
import {
  getWebhookDeliveryStatusLabel,
  getWebhookReceiptStatusLabel,
} from '@/features/webhooks/webhook-display'

type DetailSheetProps = {
  delivery: WebhookDeliveryHistoryDto | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WebhookDeliveryHistoryDetailSheet({
  delivery,
  open,
  onOpenChange,
}: DetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='sm:max-w-xl'>
        <SheetHeader>
          <SheetTitle>{delivery?.webhook.name ?? '详情'}</SheetTitle>
        </SheetHeader>
        {delivery ? (
          <div className='flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 text-sm'>
            <div className='flex flex-wrap items-center gap-2'>
              <Badge variant='outline'>{delivery.method}</Badge>
              <Badge variant={getWebhookDeliveryHistoryStatusBadgeVariant(delivery.status)}>
                {getWebhookDeliveryStatusLabel(delivery.status)}
              </Badge>
              {delivery.webhook.deletedAt ? <Badge variant='secondary'>已删除</Badge> : null}
            </div>
            <DetailField label='时间'>{formatWebhookDeliveryHistoryDateTime(delivery.receivedAt)}</DetailField>
            <DetailField label='Public ID'>{delivery.webhook.publicId}</DetailField>
            <DetailField label='路径'>{delivery.path}</DetailField>
            <DetailField label='客户端'>
              已确认 {delivery.acknowledgedClientCount} / 已发送 {delivery.sentClientCount} / 在线 {delivery.onlineClientCount}
            </DetailField>
            <DetailField label='Body'>{formatWebhookDeliveryHistoryBody(delivery)}</DetailField>
            <JsonBlock label='Query' value={delivery.query} />
            <JsonBlock label='Headers' value={delivery.headers} />
            {delivery.bodyPreview ? (
              <div className='grid gap-1'>
                <span className='text-xs font-medium text-muted-foreground'>Body Preview</span>
                <pre className='max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap'>
                  {delivery.bodyPreview}
                </pre>
              </div>
            ) : null}
            {delivery.clientReceipts.length ? (
              <div className='grid gap-2'>
                <span className='text-xs font-medium text-muted-foreground'>客户端</span>
                <div className='grid gap-2'>
                  {delivery.clientReceipts.map((receipt) => (
                    <div key={receipt.id} className='flex flex-wrap items-center gap-2'>
                      <span>{receipt.deviceName}</span>
                      <Badge variant='outline'>{getWebhookReceiptStatusLabel(receipt.status)}</Badge>
                      <span className='text-muted-foreground'>
                        {formatWebhookDeliveryHistoryDateTime(receipt.acknowledgedAt ?? receipt.sentAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {delivery.error ? <div className='text-destructive'>{delivery.error}</div> : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='grid gap-1'>
      <span className='text-xs font-medium text-muted-foreground'>{label}</span>
      <div className='break-all'>{children}</div>
    </div>
  )
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className='grid gap-1'>
      <span className='text-xs font-medium text-muted-foreground'>{label}</span>
      <pre className='max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap'>
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}
```

- [ ] **Step 5: Create history page**

Create `dashboard/src/features/webhook-deliveries/index.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { useSearch } from '@tanstack/react-router'
import { type SortingState } from '@tanstack/react-table'
import type { WebhookDeliveryHistoryDto } from '@synapse/shared'
import { useQuery } from '@tanstack/react-query'
import { adminApi, dashboardApi } from '@/lib/api'
import { ServerDataTable } from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuthStore } from '@/stores/auth-store'
import { buildWebhookDeliveryHistoryColumns } from './webhook-delivery-history-columns'
import { WebhookDeliveryHistoryDetailSheet } from './webhook-delivery-history-detail-sheet'
import { buildWebhookDeliveryHistoryQuery } from './webhook-delivery-history-display'

const initialPageSize = 20
const allStatusesValue = 'all'

export default function WebhookDeliveriesPage() {
  const search = useSearch({ from: '/_authenticated/webhook-deliveries/' })
  const role = useAuthStore((state) => state.auth.user?.role)
  const mode = role === 'admin' ? 'admin' : 'user'
  const [page, setPage] = useState(search.page ?? 1)
  const [pageSize, setPageSize] = useState(search.pageSize ?? initialPageSize)
  const [sorting, setSorting] = useState<SortingState>([
    { id: search.sortBy ?? 'receivedAt', desc: search.sortOrder !== 'asc' },
  ])
  const [webhookId, setWebhookId] = useState(search.webhookId ?? '')
  const [status, setStatus] = useState(search.status ?? '')
  const [from, setFrom] = useState(search.from ?? '')
  const [to, setTo] = useState(search.to ?? '')
  const [user, setUser] = useState(search.user ?? '')
  const [detail, setDetail] = useState<WebhookDeliveryHistoryDto | null>(null)
  const activeSort = sorting[0]
  const query = buildWebhookDeliveryHistoryQuery({
    page,
    pageSize,
    sortBy: activeSort?.id ?? 'receivedAt',
    sortOrder: activeSort?.desc === false ? 'asc' : 'desc',
    webhookId,
    status,
    from,
    to,
    user: mode === 'admin' ? user : undefined,
  })

  const historyQuery = useQuery({
    queryKey: ['webhook-delivery-history', mode, query],
    queryFn: () =>
      mode === 'admin'
        ? adminApi.listWebhookDeliveryHistory(query)
        : dashboardApi.listWebhookDeliveryHistory(query),
  })

  const columns = useMemo(
    () => buildWebhookDeliveryHistoryColumns({ mode, onOpenDetail: setDetail }),
    [mode]
  )

  return (
    <>
      <Header>
        <h1 className='text-lg font-semibold'>Webhook 历史</h1>
      </Header>
      <Main>
        {historyQuery.isLoading ? (
          <div className='text-muted-foreground'>加载中...</div>
        ) : (
          <ServerDataTable
            columns={columns}
            data={historyQuery.data?.data ?? []}
            page={page}
            pageSize={pageSize}
            total={historyQuery.data?.total ?? 0}
            error={historyQuery.isError ? historyQuery.error : null}
            onRetry={() => void historyQuery.refetch()}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            sorting={sorting}
            onSortingChange={setSorting}
            toolbar={
              <div className='flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between'>
                <div className='flex flex-wrap items-center gap-2'>
                  {mode === 'admin' ? (
                    <Input
                      placeholder='用户'
                      value={user}
                      onChange={(event) => {
                        setUser(event.target.value)
                        setPage(1)
                      }}
                      className='h-8 w-37.5 lg:w-62.5'
                    />
                  ) : null}
                  <Input
                    placeholder='Webhook ID'
                    value={webhookId}
                    onChange={(event) => {
                      setWebhookId(event.target.value)
                      setPage(1)
                    }}
                    className='h-8 w-37.5 lg:w-62.5'
                  />
                  <Select
                    value={status || allStatusesValue}
                    onValueChange={(value) => {
                      setStatus(value === allStatusesValue ? '' : value)
                      setPage(1)
                    }}
                  >
                    <SelectTrigger size='sm' className='w-36'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={allStatusesValue}>全部状态</SelectItem>
                      <SelectItem value='received'>已接收</SelectItem>
                      <SelectItem value='no_online_clients'>无在线端</SelectItem>
                      <SelectItem value='sent'>已发送</SelectItem>
                      <SelectItem value='delivered'>已确认</SelectItem>
                      <SelectItem value='broadcast_failed'>发送失败</SelectItem>
                      <SelectItem value='rejected'>已拒绝</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    type='date'
                    value={from}
                    onChange={(event) => {
                      setFrom(event.target.value)
                      setPage(1)
                    }}
                    className='h-8 w-36'
                  />
                  <Input
                    type='date'
                    value={to}
                    onChange={(event) => {
                      setTo(event.target.value)
                      setPage(1)
                    }}
                    className='h-8 w-36'
                  />
                </div>
              </div>
            }
          />
        )}
        <WebhookDeliveryHistoryDetailSheet
          open={Boolean(detail)}
          delivery={detail}
          onOpenChange={(open) => {
            if (!open) setDetail(null)
          }}
        />
      </Main>
    </>
  )
}
```

- [ ] **Step 6: Run dashboard tests and typecheck**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/features/webhook-deliveries/webhook-delivery-history-display.test.ts
pnpm --filter @synapse/dashboard tsc
```

Expected: pass. If `routeTree.gen.ts` changes during typecheck/build, include that generated file in the commit.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/features/webhook-deliveries dashboard/src/routeTree.gen.ts
git commit -m "feat(dashboard): add webhook delivery history page"
```

---

### Task 6: Release Notes And Full Verification

**Files:**

- Modify: `RELEASE_NOTES_PENDING.md`
- Any generated files changed by earlier verification.

- [ ] **Step 1: Add release note**

Add a bullet under the pending release notes file:

```md
- Webhook 管理新增全局历史入口，用户和管理员都可以查看外部请求的接收、广播和客户端确认状态；删除 Webhook 后，历史记录会继续保留用于排查。
```

- [ ] **Step 2: Run focused server tests**

Run:

```bash
pnpm --filter @synapse/server test -- src/webhooks/webhook.service.spec.ts src/webhooks/webhook.controller.spec.ts src/admin/admin.controller.spec.ts
```

Expected: pass.

- [ ] **Step 3: Run focused dashboard tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/components/layout/data/sidebar-data.test.ts src/features/webhooks/webhook-cache.test.ts src/features/webhook-deliveries/webhook-delivery-history-display.test.ts
```

Expected: pass.

- [ ] **Step 4: Run package typechecks**

Run:

```bash
pnpm --filter @synapse/shared typecheck
pnpm --filter @synapse/server typecheck
pnpm --filter @synapse/dashboard tsc
```

Expected: pass.

- [ ] **Step 5: Review hard UI constraints manually**

Run:

```bash
rg -n "style=\\{\\{|#[0-9A-Fa-f]{3,8}|bg-\\[|text-\\[|from-|to-|gradient|✨|🚀|⚡" dashboard/src/features/webhook-deliveries dashboard/src/features/webhooks dashboard/src/components/layout/data/sidebar-data.ts
```

Expected: no custom color, gradient, emoji heading, or inline style matches in the touched dashboard UI files.

- [ ] **Step 6: Final status and commit**

Run:

```bash
git status --short
```

Expected: only intended files are modified.

Commit:

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note webhook delivery history"
```

If verification changed generated route files, include them:

```bash
git add dashboard/src/routeTree.gen.ts RELEASE_NOTES_PENDING.md
git commit -m "docs: note webhook delivery history"
```

---

## Self-Review Checklist

- Spec coverage: soft delete, deleted history retention, user history API, admin history API, shared DTO, user/admin dashboard route, card navigation, sanitized detail view, tests, and release notes all have tasks.
- No raw payload storage is introduced.
- No new npm dependencies are required.
- Dashboard table uses `ServerDataTable`.
- UI snippets use shadcn components and Tailwind token/layout classes only.
- Route path is one shared `/webhook-deliveries` route for both roles.
- Public Webhook receive path rejects deleted rows with the existing generic not-found behavior.
