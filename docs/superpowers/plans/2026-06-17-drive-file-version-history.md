# Drive File Version History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add owner-managed Drive file version history with automatic version generation, restore, delete, pinning, quota accounting, cleanup, UI, and MCP support.

**Architecture:** Keep `DriveItem` as the stable current-file pointer and add `DriveFileVersion` as immutable full-copy version metadata. Centralize version creation in a server helper used by upload completion and restore, then expose owner-only API, dashboard UI, desktop bridge, and MCP tools. Historical versions count toward quota and are never exposed through public share links.

**Tech Stack:** Prisma/PostgreSQL, NestJS, TypeScript, Vitest, React, TanStack Query, shadcn/Radix, Electron IPC, Synapse MCP capability registry.

---

## File Structure

- Create `server/prisma/migrations/20260617180000_drive_file_versions/migration.sql`: add `DriveFileVersion` table and initial backfill SQL.
- Modify `server/prisma/schema.prisma`: add `DriveFileVersion` model and relations.
- Modify `shared/src/drive.ts`: add version DTOs, page DTOs, source type, and pin input type.
- Create `server/src/drive/drive-version-history.ts`: version-number allocation, version creation from storage object, restore copy, deletion, cleanup, and DTO mapping helpers.
- Modify `server/src/drive/drive.service.ts`: use the helper in `completeUpload()`, add public service methods for list/download/restore/delete/pin, and remove replaced-object deletion from normal overwrite completion.
- Modify `server/src/drive/drive.types.ts`: keep existing item DTO exports unchanged; place version DTO mapping in `drive-version-history.ts`.
- Modify `server/src/drive/drive.controller.ts`: add owner-only version endpoints and response streaming for version downloads.
- Modify `server/src/drive/drive.service.spec.ts`: add service tests covering version generation, restore, cleanup, quota, and concurrent overwrite.
- Modify `server/src/drive/drive.controller.spec.ts`: add controller routing/schema/auth tests for version endpoints.
- Modify `dashboard/src/lib/api.ts` and `dashboard/src/lib/api.test.ts`: add version API client functions.
- Create `dashboard/src/features/drive-browser/drive-file-versions-dialog.tsx`: focused version history dialog.
- Modify `dashboard/src/features/drive-browser/drive-browser-page.tsx`: pass owner version action into single-file reader.
- Modify `dashboard/src/features/drive-browser/finder/drive-finder.tsx` and related finder action files: add owner file-row `历史版本` action.
- Modify `dashboard/src/features/drive-browser/drive-browser-page.test.ts`: add render/view-model tests for version action and dialog behavior.
- Modify `desktop/electron/services/account-service.ts`: add account methods for version list/download/restore/delete/pin.
- Modify `desktop/electron/modules/account/ipc.ts`: add IPC schemas and handlers.
- Modify `desktop/electron/preload.ts`: expose new bridge methods.
- Modify `desktop/src/types/bridge.ts`: add bridge method types.
- Modify `desktop/electron/__tests__/preload.test.ts`, `desktop/electron/modules/account/__tests__/ipc.test.ts`, and `desktop/electron/services/__tests__/account-service.test.ts`: add bridge tests.
- Modify `desktop/synapse-capabilities/shared/drive-domain.ts` and `desktop/synapse-capabilities/shared/drive-domain.test.ts`: register MCP version tools.
- Modify `desktop/electron/capabilities/drive-dispatcher.ts` and `desktop/electron/capabilities/__tests__/drive-dispatcher.test.ts`: dispatch version tools with permission checks.
- Modify `desktop/resources/templates/skills/synapse-drive-mcp/content.md` and `desktop/resources/templates/skills/synapse-drive-mcp/meta.json` if the capability list is embedded there.
- Modify `docs/reference/capability-naming-matrix.md`: add stable naming rows for version tools.
- Modify `RELEASE_NOTES_PENDING.md`: add one user-facing release note.

---

### Task 1: Schema, Shared DTOs, And Migration

**Files:**
- Create: `server/prisma/migrations/20260617180000_drive_file_versions/migration.sql`
- Modify: `server/prisma/schema.prisma`
- Modify: `shared/src/drive.ts`

- [ ] **Step 1: Add the Prisma model**

In `server/prisma/schema.prisma`, add the relation fields:

```prisma
model User {
  // existing fields remain
  driveFileVersions         DriveFileVersion[]
}

model DriveItem {
  // existing fields remain
  fileVersions        DriveFileVersion[]
}
```

Add the model near the existing Drive models:

```prisma
model DriveFileVersion {
  id                    String    @id @default(cuid())
  itemId                String
  item                  DriveItem @relation(fields: [itemId], references: [id], onDelete: Restrict)
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  versionNumber         Int
  storageKey            String    @unique
  size                  BigInt
  mimeType              String?   @db.VarChar(255)
  etag                  String?
  source                String    @db.VarChar(32)
  createdBy             String?
  restoredFromVersionId String?
  isPinned              Boolean   @default(false)
  deletedAt             DateTime?
  deletePending         Boolean   @default(false)
  createdAt             DateTime  @default(now())

  @@unique([itemId, versionNumber])
  @@index([itemId, deletedAt, versionNumber])
  @@index([userId, createdAt])
  @@index([deletePending])
}
```

- [ ] **Step 2: Add the migration SQL**

Create `server/prisma/migrations/20260617180000_drive_file_versions/migration.sql`:

```sql
CREATE TABLE "DriveFileVersion" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "size" BIGINT NOT NULL,
  "mimeType" VARCHAR(255),
  "etag" TEXT,
  "source" VARCHAR(32) NOT NULL,
  "createdBy" TEXT,
  "restoredFromVersionId" TEXT,
  "isPinned" BOOLEAN NOT NULL DEFAULT false,
  "deletedAt" TIMESTAMP(3),
  "deletePending" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriveFileVersion_pkey" PRIMARY KEY ("id")
);

INSERT INTO "DriveFileVersion" (
  "id",
  "itemId",
  "userId",
  "versionNumber",
  "storageKey",
  "size",
  "mimeType",
  "source",
  "createdAt"
)
SELECT
  'dfv_' || substr(md5("id" || ':' || "storageKey" || ':' || "updatedAt"::text), 1, 24),
  "id",
  "userId",
  1,
  "storageKey",
  "size",
  "mimeType",
  'upload',
  "updatedAt"
FROM "DriveItem"
WHERE "type" = 'file'
  AND "storageStatus" = 'active'
  AND "deletedAt" IS NULL
  AND "storageKey" IS NOT NULL;

CREATE UNIQUE INDEX "DriveFileVersion_storageKey_key" ON "DriveFileVersion"("storageKey");
CREATE UNIQUE INDEX "DriveFileVersion_itemId_versionNumber_key" ON "DriveFileVersion"("itemId", "versionNumber");
CREATE INDEX "DriveFileVersion_itemId_deletedAt_versionNumber_idx" ON "DriveFileVersion"("itemId", "deletedAt", "versionNumber");
CREATE INDEX "DriveFileVersion_userId_createdAt_idx" ON "DriveFileVersion"("userId", "createdAt");
CREATE INDEX "DriveFileVersion_deletePending_idx" ON "DriveFileVersion"("deletePending");

ALTER TABLE "DriveFileVersion"
ADD CONSTRAINT "DriveFileVersion_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "DriveItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DriveFileVersion"
ADD CONSTRAINT "DriveFileVersion_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

The id expression is deterministic for one backfilled version per file and does not require a Postgres UUID extension.

- [ ] **Step 3: Add shared version DTOs**

In `shared/src/drive.ts`, add:

```ts
export type DriveFileVersionSource = "upload" | "online_edit" | "restore"

export interface DriveFileVersionDto {
  readonly id: string
  readonly itemId: string
  readonly versionNumber: number
  readonly size: string
  readonly mimeType: string | null
  readonly source: DriveFileVersionSource
  readonly isCurrent: boolean
  readonly isPinned: boolean
  readonly deletePending: boolean
  readonly restoredFromVersionId: string | null
  readonly createdAt: string
  readonly createdBy: string | null
}

export interface DriveFileVersionListInput {
  readonly offset?: number
  readonly limit?: number
}

export interface DriveFileVersionListPageDto {
  readonly items: readonly DriveFileVersionDto[]
  readonly total: number
  readonly page: DriveBrowserChildrenPageDto
}

export interface DriveFileVersionPinInput {
  readonly isPinned: boolean
}

export interface DriveFileVersionDownloadResultDto {
  readonly itemId: string
  readonly versionId: string
  readonly versionNumber: number
  readonly outputPath: string
}
```

- [ ] **Step 4: Run schema and shared type checks**

Run:

```bash
pnpm --filter @synapse/shared test -- --runInBand
pnpm --filter @synapse/server exec prisma validate
```

Expected:

```text
PASS shared/src/drive.test.ts
Prisma schema loaded from prisma/schema.prisma
The schema at prisma/schema.prisma is valid
```

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260617180000_drive_file_versions/migration.sql shared/src/drive.ts
git commit -m "feat(drive): add file version schema"
```

---

### Task 2: Server Version Creation And Upload Completion

**Files:**
- Create: `server/src/drive/drive-version-history.ts`
- Modify: `server/src/drive/drive.service.ts`
- Modify: `server/src/drive/drive.service.spec.ts`

- [ ] **Step 1: Write failing service tests for automatic versions**

Add these tests to `server/src/drive/drive.service.spec.ts` near existing overwrite tests:

```ts
it("creates a first file version when a new upload completes", async () => {
  const prisma = createPrismaMemory()
  const storage: DriveStoragePort = {
    ...storageMock,
    headObject: vi.fn(async (key) => ({ key, size: 11n, etag: "etag-v1" })),
  }
  const service = new DriveService(prisma as unknown as PrismaService, storage)
  await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })

  const completed = await createCompletedUpload(service, "user-1", {
    parentId: null,
    name: "report.txt",
    mimeType: "text/plain",
  })

  const versions = await prisma.driveFileVersion.findMany({ where: { itemId: completed.id } })
  expect(versions).toHaveLength(1)
  expect(versions[0]).toMatchObject({
    userId: "user-1",
    versionNumber: 1,
    size: 11n,
    mimeType: "text/plain",
    source: "upload",
    etag: "etag-v1",
    deletedAt: null,
  })
  const item = await prisma.driveItem.findUniqueOrThrow({ where: { id: completed.id } })
  expect(item.storageKey).toBe(versions[0]!.storageKey)
})

it("keeps old upload versions and charges full version storage on overwrite", async () => {
  const prisma = createPrismaMemory()
  const copyObject = vi.fn(async () => undefined)
  const deleteObject = vi.fn(async () => undefined)
  const storage: DriveStoragePort = {
    ...storageMock,
    headObject: vi.fn(async (key) => ({ key, size: key.includes("/overwrites/") ? 5n : 11n, etag: key.includes("/overwrites/") ? "etag-v2" : "etag-v1" })),
    copyObject,
    deleteObject,
  }
  const service = new DriveService(prisma as unknown as PrismaService, storage)
  await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
  const first = await createCompletedUpload(service, "user-1", {
    parentId: null,
    name: "report.txt",
    mimeType: "text/plain",
  })

  const prepared = await service.prepareUpload("user-1", {
    parentId: null,
    name: "report.txt",
    size: "5",
    mimeType: "text/markdown",
    publicAppUrl: "https://synapse.test",
  })
  await service.completeUpload("user-1", prepared.sessionId)

  const versions = await prisma.driveFileVersion.findMany({
    where: { itemId: first.id, deletedAt: null },
    orderBy: { versionNumber: "asc" },
  })
  expect(versions.map((version) => version.versionNumber)).toEqual([1, 2])
  expect(versions.map((version) => version.size)).toEqual([11n, 5n])
  const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
  expect(usage.usedBytes).toBe(16n)
  expect(usage.reservedBytes).toBe(0n)
  expect(deleteObject).not.toHaveBeenCalledWith(versions[0]!.storageKey)
})
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/drive/drive.service.spec.ts -t "file version|version storage|same-name files"
```

Expected failures include:

```text
Property 'driveFileVersion' does not exist
expected [] to have a length of 1
```

- [ ] **Step 3: Implement version helper**

Create `server/src/drive/drive-version-history.ts`:

```ts
import { randomUUID } from "node:crypto"
import type { Prisma } from "@prisma/client"
import type { DriveFileVersionDto } from "@synapse/shared"
import { DRIVE_STORAGE_STATUS, DRIVE_UPLOAD_STATUS } from "./drive.constants"
import type { DriveStoragePort } from "./drive-storage"

export const DRIVE_FILE_VERSION_SOURCE = {
  upload: "upload",
  onlineEdit: "online_edit",
  restore: "restore",
} as const

export const driveVersionStorageKey = (itemId: string, versionId: string) =>
  `drive/${itemId}/versions/${versionId}`

type VersionTx = Prisma.TransactionClient

export async function ensureCurrentDriveFileVersion(tx: VersionTx, input: {
  readonly item: {
    readonly id: string
    readonly userId: string
    readonly storageKey: string | null
    readonly size: bigint
    readonly mimeType: string | null
    readonly updatedAt: Date
  }
}): Promise<void> {
  if (!input.item.storageKey) return
  const existing = await tx.driveFileVersion.findFirst({
    where: { itemId: input.item.id, storageKey: input.item.storageKey, deletedAt: null },
    select: { id: true },
  })
  if (existing) return
  await tx.driveFileVersion.create({
    data: {
      itemId: input.item.id,
      userId: input.item.userId,
      versionNumber: await nextDriveFileVersionNumber(tx, input.item.id),
      storageKey: input.item.storageKey,
      size: input.item.size,
      mimeType: input.item.mimeType,
      source: DRIVE_FILE_VERSION_SOURCE.upload,
      createdAt: input.item.updatedAt,
    },
  })
}

export async function createDriveFileVersionFromObject(tx: VersionTx, input: {
  readonly itemId: string
  readonly userId: string
  readonly size: bigint
  readonly mimeType: string | null
  readonly sourceStorageKey: string
  readonly source: string
  readonly etag?: string | null
  readonly restoredFromVersionId?: string | null
  readonly createdBy?: string | null
}): Promise<{ readonly id: string; readonly storageKey: string; readonly versionNumber: number }> {
  const versionId = `dfv_${randomUUID().replace(/-/gu, "")}`
  const storageKey = driveVersionStorageKey(input.itemId, versionId)
  const versionNumber = await nextDriveFileVersionNumber(tx, input.itemId)
  const version = await tx.driveFileVersion.create({
    data: {
      id: versionId,
      itemId: input.itemId,
      userId: input.userId,
      versionNumber,
      storageKey,
      size: input.size,
      mimeType: input.mimeType,
      etag: input.etag ?? null,
      source: input.source,
      createdBy: input.createdBy ?? null,
      restoredFromVersionId: input.restoredFromVersionId ?? null,
    },
  })
  await tx.driveItem.update({
    where: { id: input.itemId },
    data: {
      storageKey,
      size: input.size,
      mimeType: input.mimeType,
      storageStatus: DRIVE_STORAGE_STATUS.active,
      uploadStatus: DRIVE_UPLOAD_STATUS.completed,
    },
  })
  return { id: version.id, storageKey: version.storageKey, versionNumber: version.versionNumber }
}

export async function copyObjectToDriveVersion(storage: DriveStoragePort, input: {
  readonly fromKey: string
  readonly toKey: string
  readonly contentType?: string | null
}): Promise<void> {
  if (input.fromKey === input.toKey) return
  await storage.copyObject({ fromKey: input.fromKey, toKey: input.toKey, contentType: input.contentType ?? null })
}

export function toDriveFileVersionDto(version: {
  readonly id: string
  readonly itemId: string
  readonly versionNumber: number
  readonly size: bigint
  readonly mimeType: string | null
  readonly source: string
  readonly isPinned: boolean
  readonly deletePending: boolean
  readonly restoredFromVersionId: string | null
  readonly createdAt: Date
  readonly createdBy: string | null
  readonly storageKey: string
}, currentStorageKey: string | null): DriveFileVersionDto {
  return {
    id: version.id,
    itemId: version.itemId,
    versionNumber: version.versionNumber,
    size: version.size.toString(),
    mimeType: version.mimeType,
    source: version.source === "restore" || version.source === "online_edit" ? version.source : "upload",
    isCurrent: currentStorageKey === version.storageKey,
    isPinned: version.isPinned,
    deletePending: version.deletePending,
    restoredFromVersionId: version.restoredFromVersionId,
    createdAt: version.createdAt.toISOString(),
    createdBy: version.createdBy,
  }
}

async function nextDriveFileVersionNumber(tx: VersionTx, itemId: string): Promise<number> {
  const latest = await tx.driveFileVersion.findFirst({
    where: { itemId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  })
  return (latest?.versionNumber ?? 0) + 1
}
```

- [ ] **Step 4: Wire upload completion to create durable versions**

In `server/src/drive/drive.service.ts`, import the helper:

```ts
import {
  copyObjectToDriveVersion,
  createDriveFileVersionFromObject,
  DRIVE_FILE_VERSION_SOURCE,
  driveVersionStorageKey,
  ensureCurrentDriveFileVersion,
} from "./drive-version-history"
```

In `completeUpload()`, keep the current idempotency branch and move the first-time completion path into a private `finalizeCompletedUploadVersion()` method. Inside the transaction before creating the new version, ensure the current active object is represented:

```ts
if (isOverwrite) {
  await ensureCurrentDriveFileVersion(tx, { item: session.item })
}
```

Replace the direct `tx.driveItem.update({ data: { storageKey: session.storageKey, ... } })` block in the first-time completion path with:

```ts
const pendingVersionId = `dfv_${randomUUID().replace(/-/gu, "")}`
const durableStorageKey = driveVersionStorageKey(session.itemId, pendingVersionId)
return {
  item: await tx.driveItem.findUniqueOrThrow({
    where: { id: session.itemId },
    include: driveItemWithShares,
  }),
  completedNow: true,
  sourceStorageKey: session.storageKey,
  durableStorageKey,
  pendingVersionId,
  replacedStorageKey,
}
```

After the transaction and before returning, copy `sourceStorageKey` to `durableStorageKey`, then run a second small transaction:

```ts
await copyObjectToDriveVersion(this.storage, {
  fromKey: result.sourceStorageKey,
  toKey: result.durableStorageKey,
  contentType: session.expectedMime,
})

const finalized = await this.prisma.$transaction(async (tx) => {
  await createDriveFileVersionFromObject(tx, {
    itemId: session.itemId,
    userId,
    size: session.expectedSize,
    mimeType: session.expectedMime ?? null,
    sourceStorageKey: result.durableStorageKey,
    source: DRIVE_FILE_VERSION_SOURCE.upload,
    etag: object.etag ?? null,
    createdBy: userId,
  })
  return tx.driveItem.findUniqueOrThrow({
    where: { id: session.itemId },
    include: driveItemWithShares,
  })
})
```

Keep the existing completed-session branch unchanged: a second `completeUpload()` call returns the current item and does not create or charge a duplicate version. The required invariant is: quota is charged once, a completed session returns the current item, and the new version row is created once.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/drive/drive.service.spec.ts -t "first file version|version storage|concurrent overwrite|applies quota once"
```

Expected:

```text
Test Files  1 passed
Tests  4 passed
```

- [ ] **Step 6: Commit**

```bash
git add server/src/drive/drive-version-history.ts server/src/drive/drive.service.ts server/src/drive/drive.service.spec.ts
git commit -m "feat(drive): create versions on upload completion"
```

---

### Task 3: Server Version API Methods And Controller Endpoints

**Files:**
- Modify: `server/src/drive/drive.service.ts`
- Modify: `server/src/drive/drive.controller.ts`
- Modify: `server/src/drive/drive.service.spec.ts`
- Modify: `server/src/drive/drive.controller.spec.ts`

- [ ] **Step 1: Write failing service tests for list, restore, delete, and pin**

Add tests:

```ts
it("restores a historical version by creating a new current version", async () => {
  const prisma = createPrismaMemory()
  const storage: DriveStoragePort = {
    ...storageMock,
    headObject: vi.fn(async (key) => ({ key, size: key.includes("v1-copy") ? 11n : 5n, etag: "etag" })),
    copyObject: vi.fn(async () => undefined),
  }
  const service = new DriveService(prisma as unknown as PrismaService, storage)
  await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
  const first = await createCompletedUpload(service, "user-1", { parentId: null, name: "report.txt", mimeType: "text/plain" })
  const v1 = (await service.listFileVersions("user-1", first.id, { offset: 0, limit: 20 })).items[0]!
  const prepared = await service.prepareUpload("user-1", { parentId: null, name: "report.txt", size: "5", mimeType: "text/markdown", publicAppUrl: "https://synapse.test" })
  await service.completeUpload("user-1", prepared.sessionId)

  const restored = await service.restoreFileVersion("user-1", first.id, v1.id)

  expect(restored).toMatchObject({ id: first.id, size: "11", mimeType: "text/plain" })
  const versions = await service.listFileVersions("user-1", first.id, { offset: 0, limit: 20 })
  expect(versions.items.map((version) => version.versionNumber)).toEqual([3, 2, 1])
  expect(versions.items[0]).toMatchObject({ source: "restore", restoredFromVersionId: v1.id, isCurrent: true })
})

it("rejects deleting the current version and releases quota for a deleted historical version", async () => {
  const prisma = createPrismaMemory()
  const storage: DriveStoragePort = { ...storageMock, deleteObject: vi.fn(async () => undefined) }
  const service = new DriveService(prisma as unknown as PrismaService, storage)
  await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
  const item = await createCompletedUpload(service, "user-1", { parentId: null, name: "report.txt", mimeType: "text/plain" })
  const prepared = await service.prepareUpload("user-1", { parentId: null, name: "report.txt", size: "5", mimeType: "text/plain", publicAppUrl: "https://synapse.test" })
  await service.completeUpload("user-1", prepared.sessionId)
  const versions = await service.listFileVersions("user-1", item.id, { offset: 0, limit: 20 })
  const current = versions.items.find((version) => version.isCurrent)!
  const historical = versions.items.find((version) => !version.isCurrent)!

  await expect(service.deleteFileVersion("user-1", item.id, current.id)).rejects.toThrow("不能删除当前版本。")
  await service.deleteFileVersion("user-1", item.id, historical.id)

  const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
  expect(usage.usedBytes).toBe(5n)
  expect(await service.listFileVersions("user-1", item.id, { offset: 0, limit: 20 })).toMatchObject({ total: 1 })
})

it("updates version pin state", async () => {
  const prisma = createPrismaMemory()
  const service = new DriveService(prisma as unknown as PrismaService, storageMock)
  await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
  const item = await createCompletedUpload(service, "user-1", { parentId: null, name: "report.txt", mimeType: "text/plain" })
  const version = (await service.listFileVersions("user-1", item.id, { offset: 0, limit: 20 })).items[0]!

  const pinned = await service.updateFileVersionPin("user-1", item.id, version.id, true)

  expect(pinned).toMatchObject({ id: version.id, isPinned: true })
})
```

- [ ] **Step 2: Add service methods**

In `server/src/drive/drive.service.ts`, add methods with these signatures:

```ts
async listFileVersions(userId: string, itemId: string, page: { readonly offset?: number; readonly limit?: number }): Promise<DriveFileVersionListPageDto>

async restoreFileVersion(userId: string, itemId: string, versionId: string, auditContext: DriveAuditContext = {}): Promise<DriveItemDto>

async deleteFileVersion(userId: string, itemId: string, versionId: string, auditContext: DriveAuditContext = {}): Promise<{ readonly ok: true }>

async updateFileVersionPin(userId: string, itemId: string, versionId: string, isPinned: boolean, auditContext: DriveAuditContext = {}): Promise<DriveFileVersionDto>

async openFileVersionDownload(userId: string, itemId: string, versionId: string): Promise<{ readonly stream: NodeJS.ReadableStream; readonly fileName: string; readonly size: bigint; readonly contentType: string | null }>
```

Use concrete rules:

```ts
const item = await this.requireOwnedItem(userId, itemId)
if (item.type !== DRIVE_ITEM_TYPE.file) throw new BadRequestException("只能查看文件历史版本。")
const version = await this.prisma.driveFileVersion.findFirst({
  where: { id: versionId, itemId, userId, deletedAt: null },
})
if (!version) throw new NotFoundException("历史版本不存在。")
if (item.storageKey === version.storageKey) throw new BadRequestException("不能删除当前版本。")
```

For restore, call `this.storage.copyObject()` to a new version key, then create the new version in a transaction and update usage by restored size.

For delete, update the row to `deletedAt: new Date()`, decrement usage by `version.size`, then call `deleteStorageObject(itemId, version.storageKey)`. If storage delete fails, leave `deletePending=true` and keep the row deleted so the version is not user-visible.

- [ ] **Step 3: Add controller schemas and endpoints**

In `server/src/drive/drive.controller.ts`, add:

```ts
const versionPageSchema = z.object({
  offset: z.string().optional(),
  limit: z.string().optional(),
}).strict()

const versionPinSchema = z.object({
  isPinned: z.boolean(),
}).strict()
```

Add methods to `DriveUserController`:

```ts
@Get("/items/:id/versions")
listFileVersions(
  @Param("id") id: string,
  @Query("offset") offset: string | undefined,
  @Query("limit") limit: string | undefined,
  @Req() request: AuthenticatedUserRequest,
) {
  return this.drive.listFileVersions(request.user!.id, id, {
    offset: parseOptionalNonNegativeInteger(offset, "offset"),
    limit: parseOptionalNonNegativeInteger(limit, "limit"),
  })
}

@Post("/items/:id/versions/:versionId/restore")
restoreFileVersion(@Param("id") id: string, @Param("versionId") versionId: string, @Req() request: AuthenticatedUserRequest) {
  return this.drive.restoreFileVersion(request.user!.id, id, versionId, driveAuditContext(request))
}

@Patch("/items/:id/versions/:versionId")
updateFileVersion(@Param("id") id: string, @Param("versionId") versionId: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
  const parsed = parseBody(versionPinSchema, body, "历史版本请求无效。")
  return this.drive.updateFileVersionPin(request.user!.id, id, versionId, parsed.isPinned, driveAuditContext(request))
}

@Delete("/items/:id/versions/:versionId")
deleteFileVersion(@Param("id") id: string, @Param("versionId") versionId: string, @Req() request: AuthenticatedUserRequest) {
  return this.drive.deleteFileVersion(request.user!.id, id, versionId, driveAuditContext(request))
}
```

For the download endpoint, follow existing owner direct download response code and call `openFileVersionDownload()`.

- [ ] **Step 4: Add controller tests**

In `server/src/drive/drive.controller.spec.ts`, extend the `drive` mock with:

```ts
listFileVersions: vi.fn(),
restoreFileVersion: vi.fn(),
updateFileVersionPin: vi.fn(),
deleteFileVersion: vi.fn(),
openFileVersionDownload: vi.fn(),
```

Add a test:

```ts
it("routes owner file version operations through authenticated user id", async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [DriveUserController],
    providers: [{ provide: DriveService, useValue: drive }],
  })
    .overrideGuard(UserAuthGuard)
    .useValue({ canActivate: vi.fn((context) => {
      context.switchToHttp().getRequest().user = { id: "user-1" }
      return true
    }) })
    .compile()
  const userApp = moduleRef.createNestApplication()
  await userApp.init()
  try {
    drive.listFileVersions.mockResolvedValue({ items: [], total: 0, page: { offset: 0, limit: 20, hasMore: false, nextOffset: null } })
    drive.restoreFileVersion.mockResolvedValue({ id: "file-1" })
    drive.updateFileVersionPin.mockResolvedValue({ id: "ver-1", isPinned: true })
    drive.deleteFileVersion.mockResolvedValue({ ok: true })

    await request(userApp.getHttpServer()).get("/api/drive/items/file-1/versions?offset=10&limit=5").expect(200)
    await request(userApp.getHttpServer()).post("/api/drive/items/file-1/versions/ver-1/restore").expect(201)
    await request(userApp.getHttpServer()).patch("/api/drive/items/file-1/versions/ver-1").send({ isPinned: true }).expect(200)
    await request(userApp.getHttpServer()).delete("/api/drive/items/file-1/versions/ver-1").expect(200)

    expect(drive.listFileVersions).toHaveBeenCalledWith("user-1", "file-1", { offset: 10, limit: 5 })
    expect(drive.restoreFileVersion).toHaveBeenCalledWith("user-1", "file-1", "ver-1", expect.any(Object))
    expect(drive.updateFileVersionPin).toHaveBeenCalledWith("user-1", "file-1", "ver-1", true, expect.any(Object))
    expect(drive.deleteFileVersion).toHaveBeenCalledWith("user-1", "file-1", "ver-1", expect.any(Object))
  } finally {
    await userApp.close()
  }
})
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/drive/drive.service.spec.ts -t "restores a historical version|releases quota|pin state"
pnpm --filter @synapse/server exec vitest run src/drive/drive.controller.spec.ts -t "file version"
```

Expected:

```text
Test Files  2 passed
```

- [ ] **Step 6: Commit**

```bash
git add server/src/drive/drive.service.ts server/src/drive/drive.controller.ts server/src/drive/drive.service.spec.ts server/src/drive/drive.controller.spec.ts
git commit -m "feat(drive): add file version owner APIs"
```

---

### Task 4: Cleanup, Delete Retry, And Migration Safety

**Files:**
- Modify: `server/src/drive/drive-version-history.ts`
- Modify: `server/src/drive/drive.service.ts`
- Modify: `server/src/drive/drive.service.spec.ts`

- [ ] **Step 1: Add cleanup tests**

Add:

```ts
it("cleanup skips current and pinned versions when count exceeds the limit", async () => {
  const prisma = createPrismaMemory()
  const storage: DriveStoragePort = { ...storageMock, deleteObject: vi.fn(async () => undefined) }
  const service = new DriveService(prisma as unknown as PrismaService, storage)
  await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
  const item = await createCompletedUpload(service, "user-1", { parentId: null, name: "report.txt", mimeType: "text/plain" })
  const v1 = (await service.listFileVersions("user-1", item.id, { offset: 0, limit: 20 })).items[0]!
  await service.updateFileVersionPin("user-1", item.id, v1.id, true)

  for (let index = 0; index < 101; index += 1) {
    const prepared = await service.prepareUpload("user-1", { parentId: null, name: "report.txt", size: "1", mimeType: "text/plain", publicAppUrl: "https://synapse.test" })
    await service.completeUpload("user-1", prepared.sessionId)
  }

  const versions = await service.listFileVersions("user-1", item.id, { offset: 0, limit: 200 })
  expect(versions.total).toBeLessThanOrEqual(100)
  expect(versions.items.some((version) => version.id === v1.id && version.isPinned)).toBe(true)
  expect(versions.items[0]!.isCurrent).toBe(true)
})

it("marks deletePending when historical object deletion fails", async () => {
  const prisma = createPrismaMemory()
  const storage: DriveStoragePort = {
    ...storageMock,
    deleteObject: vi.fn(async () => { throw new Error("cos unavailable") }),
  }
  const service = new DriveService(prisma as unknown as PrismaService, storage)
  await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
  const item = await createCompletedUpload(service, "user-1", { parentId: null, name: "report.txt", mimeType: "text/plain" })
  const prepared = await service.prepareUpload("user-1", { parentId: null, name: "report.txt", size: "5", mimeType: "text/plain", publicAppUrl: "https://synapse.test" })
  await service.completeUpload("user-1", prepared.sessionId)
  const historical = (await service.listFileVersions("user-1", item.id, { offset: 0, limit: 20 })).items.find((version) => !version.isCurrent)!

  await service.deleteFileVersion("user-1", item.id, historical.id)

  const row = await prisma.driveFileVersion.findUniqueOrThrow({ where: { id: historical.id } })
  expect(row.deletedAt).not.toBeNull()
  expect(row.deletePending).toBe(true)
})
```

- [ ] **Step 2: Implement cleanup helper**

In `server/src/drive/drive-version-history.ts`, add:

```ts
export const DRIVE_FILE_VERSION_MAX_COUNT = 100
export const DRIVE_FILE_VERSION_RETENTION_DAYS = 180

export async function listCleanupCandidateVersions(tx: VersionTx, input: {
  readonly itemId: string
  readonly currentStorageKey: string | null
  readonly now: Date
}): Promise<Array<{ readonly id: string; readonly storageKey: string; readonly size: bigint }>> {
  const versions = await tx.driveFileVersion.findMany({
    where: { itemId: input.itemId, deletedAt: null },
    orderBy: { versionNumber: "desc" },
  })
  const cutoff = new Date(input.now.getTime() - DRIVE_FILE_VERSION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const keep = new Set<string>()
  for (const version of versions) {
    if (version.storageKey === input.currentStorageKey || version.isPinned) keep.add(version.id)
  }
  versions.slice(0, DRIVE_FILE_VERSION_MAX_COUNT).forEach((version) => keep.add(version.id))
  return versions
    .filter((version) => !keep.has(version.id))
    .filter((version) => version.createdAt < cutoff || versions.length > DRIVE_FILE_VERSION_MAX_COUNT)
    .map((version) => ({ id: version.id, storageKey: version.storageKey, size: version.size }))
}
```

In `DriveService`, add `cleanupFileVersionsAfterChange(userId, itemId)` that marks candidate rows deleted, decrements usage by candidate sizes, and attempts object deletion. Call it after successful version creation. Never throw cleanup errors back to upload/restore after the current version is committed; record structured warnings.

- [ ] **Step 3: Add retry method for pending deletes**

In `DriveService`, add:

```ts
async retryPendingFileVersionDeletes(limit = 100): Promise<{ readonly attempted: number; readonly deleted: number; readonly failed: number }>
```

It loads `deletePending=true` rows with `deletedAt != null`, calls `this.storage.deleteObject(version.storageKey)`, and sets `deletePending=false` on success.

- [ ] **Step 4: Run cleanup tests**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/drive/drive.service.spec.ts -t "cleanup skips|deletePending"
```

Expected:

```text
Test Files  1 passed
Tests  2 passed
```

- [ ] **Step 5: Commit**

```bash
git add server/src/drive/drive-version-history.ts server/src/drive/drive.service.ts server/src/drive/drive.service.spec.ts
git commit -m "feat(drive): clean old file versions"
```

---

### Task 5: Dashboard Version History UI

**Files:**
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/lib/api.test.ts`
- Create: `dashboard/src/features/drive-browser/drive-file-versions-dialog.tsx`
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.tsx`
- Modify: `dashboard/src/features/drive-browser/finder/drive-finder.tsx`
- Modify: `dashboard/src/features/drive-browser/shared/drive-view-model.ts`
- Modify: `dashboard/src/features/drive-browser/drive-browser-page.test.ts`

- [ ] **Step 1: Add API client tests**

In `dashboard/src/lib/api.test.ts`, add:

```ts
it('calls drive file version endpoints', async () => {
  mockJson({ items: [], total: 0, page: { offset: 0, limit: 20, hasMore: false, nextOffset: null } })
  await driveFileVersionsApi.list('file-1', { offset: 0, limit: 20 })
  expect(fetchMock).toHaveBeenLastCalledWith('/api/drive/items/file-1/versions?offset=0&limit=20', expect.objectContaining({ credentials: 'include' }))

  mockJson({ id: 'file-1' })
  await driveFileVersionsApi.restore('file-1', 'ver-1')
  expect(fetchMock).toHaveBeenLastCalledWith('/api/drive/items/file-1/versions/ver-1/restore', expect.objectContaining({ method: 'POST' }))

  mockJson({ id: 'ver-1', isPinned: true })
  await driveFileVersionsApi.updatePin('file-1', 'ver-1', true)
  expect(fetchMock).toHaveBeenLastCalledWith('/api/drive/items/file-1/versions/ver-1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ isPinned: true }) }))

  mockJson({ ok: true })
  await driveFileVersionsApi.delete('file-1', 'ver-1')
  expect(fetchMock).toHaveBeenLastCalledWith('/api/drive/items/file-1/versions/ver-1', expect.objectContaining({ method: 'DELETE' }))
})
```

- [ ] **Step 2: Add API functions**

In `dashboard/src/lib/api.ts`, export:

```ts
export const driveFileVersionsApi = {
  list: (itemId: string, options: { offset?: number; limit?: number } = {}) =>
    request<DriveFileVersionListPageDto>(
      `/api/drive/items/${encodeURIComponent(itemId)}/versions${querySuffix(options)}`
    ),
  restore: (itemId: string, versionId: string) =>
    request<DriveItemDto>(
      `/api/drive/items/${encodeURIComponent(itemId)}/versions/${encodeURIComponent(versionId)}/restore`,
      { method: 'POST' }
    ),
  updatePin: (itemId: string, versionId: string, isPinned: boolean) =>
    request<DriveFileVersionDto>(
      `/api/drive/items/${encodeURIComponent(itemId)}/versions/${encodeURIComponent(versionId)}`,
      { method: 'PATCH', body: JSON.stringify({ isPinned }) }
    ),
  delete: (itemId: string, versionId: string) =>
    request<{ ok: true }>(
      `/api/drive/items/${encodeURIComponent(itemId)}/versions/${encodeURIComponent(versionId)}`,
      { method: 'DELETE' }
    ),
  downloadUrl: (itemId: string, versionId: string) =>
    `/api/drive/items/${encodeURIComponent(itemId)}/versions/${encodeURIComponent(versionId)}/download`,
}
```

- [ ] **Step 3: Build the dialog**

Create `dashboard/src/features/drive-browser/drive-file-versions-dialog.tsx` with shadcn components already in the project. Use no inline styles and no custom colors.

Core shape:

```tsx
export function DriveFileVersionsDialog({
  itemId,
  open,
  onOpenChange,
  onRestored,
}: {
  readonly itemId: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onRestored?: () => void
}) {
  const query = useQuery({
    queryKey: ['drive-file-versions', itemId],
    queryFn: () => driveFileVersionsApi.list(itemId, { offset: 0, limit: 50 }),
    enabled: open,
  })
  const restoreMutation = useMutation({
    mutationFn: (versionId: string) => driveFileVersionsApi.restore(itemId, versionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drive-file-versions', itemId] })
      onRestored?.()
    },
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>历史版本</DialogTitle>
        </DialogHeader>
        <div className='space-y-2'>
          {query.data?.items.map((version) => (
            <div key={version.id} className='flex items-center justify-between gap-3 rounded-md border p-3'>
              <div className='min-w-0'>
                <div className='truncate text-sm font-medium'>v{version.versionNumber}{version.isCurrent ? ' 当前' : ''}</div>
                <div className='text-xs text-muted-foreground'>{formatDriveBrowserSize({ size: version.size, type: 'file' } as never)} · {new Date(version.createdAt).toLocaleString()}</div>
              </div>
              <div className='flex items-center gap-1'>
                <Button asChild variant='ghost' size='icon' aria-label={`下载 v${version.versionNumber}`}>
                  <a href={driveFileVersionsApi.downloadUrl(itemId, version.id)}><Download /></a>
                </Button>
                <Button variant='ghost' size='icon' aria-label={version.isPinned ? `取消保留 v${version.versionNumber}` : `保留 v${version.versionNumber}`} onClick={() => pinMutation.mutate({ versionId: version.id, isPinned: !version.isPinned })}>
                  <Pin />
                </Button>
                <Button variant='ghost' size='icon' aria-label={`恢复 v${version.versionNumber}`} disabled={version.isCurrent} onClick={() => setRestoreTarget(version)}>
                  <History />
                </Button>
                <Button variant='ghost' size='icon' aria-label={`删除 v${version.versionNumber}`} disabled={version.isCurrent} onClick={() => setDeleteTarget(version)}>
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

Add confirmation dialogs for restore and delete. The delete confirmation text for pinned versions is `该版本已保留，删除后无法恢复。`

- [ ] **Step 4: Add owner-only actions**

In `drive-browser-page.tsx`, hold dialog state when `snapshot.context === 'owner' && snapshot.current.type === 'file'`, and render `DriveFileVersionsDialog`.

In finder actions, add `历史版本` only for owner file rows. Do not show it in share context or for folders.

- [ ] **Step 5: Add UI tests**

In `dashboard/src/features/drive-browser/drive-browser-page.test.ts`, add static markup tests:

```ts
it('shows file version action for owner files but not share files', () => {
  const owner = renderToStaticMarkup(createElement(DriveSingleFileReaderView, { snapshot: createSnapshot({ context: 'owner' }) }))
  const share = renderToStaticMarkup(createElement(DriveSingleFileReaderView, { snapshot: createSnapshot({ context: 'share' }) }))

  expect(owner).toContain('历史版本')
  expect(share).not.toContain('历史版本')
})
```

If the action lives in a client-only dropdown that does not render in static markup, test `getDriveFinderActions()` or the new view-model function instead:

```ts
expect(getDriveVersionAction(createSnapshot({ context: 'owner' }))).toEqual({ itemId: 'file', enabled: true })
expect(getDriveVersionAction(createSnapshot({ context: 'share' }))).toBeNull()
```

- [ ] **Step 6: Run dashboard tests**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/lib/api.test.ts src/features/drive-browser/drive-browser-page.test.ts
```

Expected:

```text
Test Files  2 passed
```

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/lib/api.ts dashboard/src/lib/api.test.ts dashboard/src/features/drive-browser
git commit -m "feat(drive): add file version history UI"
```

---

### Task 6: Desktop Bridge And Account Methods

**Files:**
- Modify: `desktop/electron/services/account-service.ts`
- Modify: `desktop/electron/modules/account/ipc.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/services/__tests__/account-service.test.ts`
- Modify: `desktop/electron/modules/account/__tests__/ipc.test.ts`
- Modify: `desktop/electron/__tests__/preload.test.ts`

- [ ] **Step 1: Add account service tests**

In `desktop/electron/services/__tests__/account-service.test.ts`, add:

```ts
it("calls Drive file version APIs with authenticated requests", async () => {
  const { service, fetchMock } = createLoggedInAccountService()
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ items: [], total: 0, page: { offset: 0, limit: 20, hasMore: false, nextOffset: null } }))
    .mockResolvedValueOnce(jsonResponse({ id: "file-1" }))
    .mockResolvedValueOnce(jsonResponse({ id: "ver-1", isPinned: true }))
    .mockResolvedValueOnce(jsonResponse({ ok: true }))

  await service.listDriveFileVersions({ itemId: "file-1", offset: 0, limit: 20 })
  await service.restoreDriveFileVersion({ itemId: "file-1", versionId: "ver-1" })
  await service.updateDriveFileVersionPin({ itemId: "file-1", versionId: "ver-1", isPinned: true })
  await service.deleteDriveFileVersion({ itemId: "file-1", versionId: "ver-1" })

  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/drive/items/file-1/versions?offset=0&limit=20"), expect.any(Object))
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/drive/items/file-1/versions/ver-1/restore"), expect.objectContaining({ method: "POST" }))
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/drive/items/file-1/versions/ver-1"), expect.objectContaining({ method: "PATCH" }))
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/drive/items/file-1/versions/ver-1"), expect.objectContaining({ method: "DELETE" }))
})
```

- [ ] **Step 2: Add service methods**

In `desktop/electron/services/account-service.ts`, add methods:

```ts
async listDriveFileVersions(input: { readonly itemId: string; readonly offset?: number; readonly limit?: number }): Promise<DriveFileVersionListPageDto> {
  const params = new URLSearchParams()
  if (input.offset !== undefined) params.set("offset", String(input.offset))
  if (input.limit !== undefined) params.set("limit", String(input.limit))
  const query = params.toString()
  return this.authenticatedRequest<DriveFileVersionListPageDto>(`/api/drive/items/${encodeURIComponent(input.itemId)}/versions${query ? `?${query}` : ""}`)
}

async restoreDriveFileVersion(input: { readonly itemId: string; readonly versionId: string }): Promise<DriveItemDto> {
  return this.authenticatedRequest<DriveItemDto>(`/api/drive/items/${encodeURIComponent(input.itemId)}/versions/${encodeURIComponent(input.versionId)}/restore`, { method: "POST" })
}

async updateDriveFileVersionPin(input: { readonly itemId: string; readonly versionId: string; readonly isPinned: boolean }): Promise<DriveFileVersionDto> {
  return this.authenticatedRequest<DriveFileVersionDto>(`/api/drive/items/${encodeURIComponent(input.itemId)}/versions/${encodeURIComponent(input.versionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ isPinned: input.isPinned }),
  })
}

async deleteDriveFileVersion(input: { readonly itemId: string; readonly versionId: string }): Promise<{ ok: true }> {
  return this.authenticatedRequest<{ ok: true }>(`/api/drive/items/${encodeURIComponent(input.itemId)}/versions/${encodeURIComponent(input.versionId)}`, { method: "DELETE" })
}
```

For local download, add `downloadDriveFileVersion({ itemId, versionId, outputPath })` using the existing `downloadDriveFile` pattern and version download URL.

- [ ] **Step 3: Add IPC and bridge types**

In `desktop/src/types/bridge.ts`, add account methods:

```ts
listDriveFileVersions: (input: { itemId: string; offset?: number; limit?: number }) => Promise<DriveFileVersionListPageDto>
restoreDriveFileVersion: (input: { itemId: string; versionId: string }) => Promise<DriveItemDto>
updateDriveFileVersionPin: (input: { itemId: string; versionId: string; isPinned: boolean }) => Promise<DriveFileVersionDto>
deleteDriveFileVersion: (input: { itemId: string; versionId: string }) => Promise<{ ok: true }>
downloadDriveFileVersion: (input: { itemId: string; versionId: string; outputPath: string }) => Promise<DriveFileVersionDownloadResultDto>
```

In `desktop/electron/modules/account/ipc.ts`, add zod schemas and handlers. Use `z.string().min(1)` for ids, `z.number().int().min(0).optional()` for pagination, and `z.boolean()` for `isPinned`.

In `desktop/electron/preload.ts`, add channels and invoke wrappers.

- [ ] **Step 4: Add IPC/preload tests**

Add expectations matching existing account IPC tests:

```ts
expect(accountIpcModule.methods.listDriveFileVersions.request.parse({ itemId: "file-1", offset: 0, limit: 20 })).toEqual({ itemId: "file-1", offset: 0, limit: 20 })
await bridge.account.listDriveFileVersions({ itemId: "file-1" })
await bridge.account.restoreDriveFileVersion({ itemId: "file-1", versionId: "ver-1" })
await bridge.account.updateDriveFileVersionPin({ itemId: "file-1", versionId: "ver-1", isPinned: true })
await bridge.account.deleteDriveFileVersion({ itemId: "file-1", versionId: "ver-1" })
```

- [ ] **Step 5: Run desktop bridge tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/account-service.test.ts electron/modules/account/__tests__/ipc.test.ts electron/__tests__/preload.test.ts
```

Expected:

```text
Test Files  3 passed
```

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/account-service.ts desktop/electron/modules/account/ipc.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/electron/services/__tests__/account-service.test.ts desktop/electron/modules/account/__tests__/ipc.test.ts desktop/electron/__tests__/preload.test.ts
git commit -m "feat(drive): expose file versions to desktop bridge"
```

---

### Task 7: MCP Capability Tools And Built-In Skill

**Files:**
- Modify: `desktop/synapse-capabilities/shared/drive-domain.ts`
- Modify: `desktop/synapse-capabilities/shared/drive-domain.test.ts`
- Modify: `desktop/electron/capabilities/drive-dispatcher.ts`
- Modify: `desktop/electron/capabilities/__tests__/drive-dispatcher.test.ts`
- Modify: `desktop/resources/templates/skills/synapse-drive-mcp/content.md`
- Modify: `docs/reference/capability-naming-matrix.md`

- [ ] **Step 1: Add capability registry tests**

In `desktop/synapse-capabilities/shared/drive-domain.test.ts`, extend the expected list:

```ts
expect(toolNames).toContain("drive_file_version_list")
expect(toolNames).toContain("drive_file_version_download_create")
expect(toolNames).toContain("drive_file_version_restore")
expect(toolNames).toContain("drive_file_version_delete")
expect(toolNames).toContain("drive_file_version_pin_update")
expect(MCP_TOOL_ACTIONS.drive_file_version_restore).toBe("drive.file_version.restore")
```

- [ ] **Step 2: Register tools**

In `desktop/synapse-capabilities/shared/drive-domain.ts`, add capabilities:

```ts
{ id: "drive.file_version.list" as CapabilityId, title: "List file versions", description: "List owner-only historical versions for one Synapse Drive file.", mutates: false },
{ id: "drive.file_version.download_create" as CapabilityId, title: "Download file version", description: "Download a historical Synapse Drive file version to a local path.", mutates: true },
{ id: "drive.file_version.restore" as CapabilityId, title: "Restore file version", description: "Restore a historical Drive file version as a new current version.", mutates: true, risk: "high" },
{ id: "drive.file_version.delete" as CapabilityId, title: "Delete file version", description: "Delete a non-current historical Drive file version.", mutates: true, risk: "high" },
{ id: "drive.file_version.pin_update" as CapabilityId, title: "Pin file version", description: "Update whether a Drive file version is protected from automatic cleanup.", mutates: true },
```

Add `buildDriveTools()` definitions with required fields:

```ts
{
  name: "drive_file_version_restore",
  description: "Restore a historical Drive file version as a new current version. This preserves the selected historical version and creates a new version.",
  inputSchema: {
    type: "object",
    properties: {
      itemId: stringField("Drive file item id."),
      versionId: stringField("Drive file version id."),
    },
    required: ["itemId", "versionId"],
  },
}
```

Repeat for list, download, delete, and pin update with concrete input properties: `itemId`, `versionId`, `outputPath`, `offset`, `limit`, `isPinned`.

- [ ] **Step 3: Add dispatcher tests**

In `desktop/electron/capabilities/__tests__/drive-dispatcher.test.ts`, add:

```ts
it("dispatches drive file version tools", async () => {
  const accountService = createDriveAccountServiceMock()
  accountService.listDriveFileVersions.mockResolvedValue({ items: [], total: 0, page: { offset: 0, limit: 20, hasMore: false, nextOffset: null } })
  accountService.restoreDriveFileVersion.mockResolvedValue(createDriveItem({ id: "file-1", type: "file" }))
  accountService.updateDriveFileVersionPin.mockResolvedValue({ id: "ver-1", itemId: "file-1", versionNumber: 1, size: "11", mimeType: "text/plain", source: "upload", isCurrent: false, isPinned: true, deletePending: false, restoredFromVersionId: null, createdAt: "2026-06-17T00:00:00.000Z", createdBy: null })
  accountService.deleteDriveFileVersion.mockResolvedValue({ ok: true })
  const dispatcher = createDriveCapabilityDispatcher({ accountService })

  await dispatcher.dispatch("drive.file_version.list", { itemId: "file-1" }, createContext())
  await dispatcher.dispatch("drive.file_version.restore", { itemId: "file-1", versionId: "ver-1" }, createContext())
  await dispatcher.dispatch("drive.file_version.pin_update", { itemId: "file-1", versionId: "ver-1", isPinned: true }, createContext())
  await dispatcher.dispatch("drive.file_version.delete", { itemId: "file-1", versionId: "ver-1" }, createContext())

  expect(accountService.restoreDriveFileVersion).toHaveBeenCalledWith({ itemId: "file-1", versionId: "ver-1" })
})
```

Add a separate download test that verifies `authorizeFileWrite()` is used before `downloadDriveFileVersion()`.

- [ ] **Step 4: Implement dispatcher cases**

In `desktop/electron/capabilities/drive-dispatcher.ts`, extend `DriveAccountServicePort` and switch cases:

```ts
case "drive.file_version.list":
  return dispatchDriveRead(deps, action, params, context, async () => ({
    ok: true,
    data: await deps.accountService.listDriveFileVersions({
      itemId: requireString(params, "itemId"),
      offset: optionalNumber(params.offset),
      limit: optionalNumber(params.limit),
    }),
  }))
case "drive.file_version.restore":
  return dispatchDriveMutation(deps, action, params, context, async () => ({
    ok: true,
    data: await deps.accountService.restoreDriveFileVersion({
      itemId: requireString(params, "itemId"),
      versionId: requireString(params, "versionId"),
    }),
  }))
```

Add delete, pin, and download cases. For download, call `authorizeFileWrite(deps, action, versionId, outputPath, context)` before account service download.

- [ ] **Step 5: Update built-in skill and naming matrix**

In `desktop/resources/templates/skills/synapse-drive-mcp/content.md`, add the new tools to Scope and Default Flow. Add Safety rules:

```md
- Historical versions are owner-only. Existing share links always point to current file content.
- Before restoring or deleting a historical version, make sure the user asked for that operation clearly.
- Do not delete historical versions during Drive organization unless the user explicitly asks to clean versions.
```

In `docs/reference/capability-naming-matrix.md`, add rows:

```md
| `drive.file_version.list` | `drive_file_version_list` | `drive.file_version.list` | `driveFileVersionList` |
| `drive.file_version.download_create` | `drive_file_version_download_create` | `drive.file_version.download_create` | `driveFileVersionDownloadCreate` |
| `drive.file_version.restore` | `drive_file_version_restore` | `drive.file_version.restore` | `driveFileVersionRestore` |
| `drive.file_version.delete` | `drive_file_version_delete` | `drive.file_version.delete` | `driveFileVersionDelete` |
| `drive.file_version.pin_update` | `drive_file_version_pin_update` | `drive.file_version.pin_update` | `driveFileVersionPinUpdate` |
```

- [ ] **Step 6: Run MCP tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run synapse-capabilities/shared/drive-domain.test.ts electron/capabilities/__tests__/drive-dispatcher.test.ts
```

Expected:

```text
Test Files  2 passed
```

- [ ] **Step 7: Commit**

```bash
git add desktop/synapse-capabilities/shared/drive-domain.ts desktop/synapse-capabilities/shared/drive-domain.test.ts desktop/electron/capabilities/drive-dispatcher.ts desktop/electron/capabilities/__tests__/drive-dispatcher.test.ts desktop/resources/templates/skills/synapse-drive-mcp/content.md docs/reference/capability-naming-matrix.md
git commit -m "feat(drive): add file version MCP tools"
```

---

### Task 8: Release Note And Full Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Append a user-facing entry:

```md
- 云盘文件支持历史版本：上传覆盖会自动保留旧版本，用户可以查看、下载、恢复、保留或删除历史版本，历史版本占用的空间也会计入云盘配额。
```

- [ ] **Step 2: Run server verification**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/drive/drive.service.spec.ts src/drive/drive.controller.spec.ts
pnpm --filter @synapse/server exec prisma validate
```

Expected:

```text
Test Files  2 passed
The schema at prisma/schema.prisma is valid
```

- [ ] **Step 3: Run desktop/dashboard verification**

Run:

```bash
pnpm --filter @synapse/dashboard exec vitest run src/lib/api.test.ts src/features/drive-browser/drive-browser-page.test.ts
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/account-service.test.ts electron/modules/account/__tests__/ipc.test.ts electron/__tests__/preload.test.ts synapse-capabilities/shared/drive-domain.test.ts electron/capabilities/__tests__/drive-dispatcher.test.ts
```

Expected:

```text
Test Files  7 passed
```

- [ ] **Step 4: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected:

```text
Hard constraints passed
```

- [ ] **Step 5: Inspect for forbidden UI patterns**

Run:

```bash
rg -n "style=\\{\\{|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|bg-\\[|text-\\[|from-|to-|via-|✨|🚀|⚡" dashboard/src/features/drive-browser desktop/src/modules/drive
```

Expected: no matches from new code. Existing unrelated matches must be listed in the implementation summary and left unchanged.

- [ ] **Step 6: Final commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note drive file version history"
```

---

## Self-Review Checklist

- Spec coverage: Tasks cover schema, full-object storage, upload overwrite versions, restore as new version, quota, manual delete, pinning, automatic cleanup, owner-only API, UI, MCP, built-in skill, tests, and release notes.
- Placeholders: This plan avoids open-ended implementation markers and gives exact files, method names, test names, commands, and expected outcomes.
- Type consistency: Shared DTO names are used consistently across server, dashboard, desktop bridge, and MCP dispatcher.
- Scope boundary: Online editing is represented only by the `online_edit` source value and shared service path; no editor UI or editor runtime is included.
