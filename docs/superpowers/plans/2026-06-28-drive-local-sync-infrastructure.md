# Drive Local Sync Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first infrastructure slice for Drive local sync: shared DTOs, server Drive change cursors, desktop sync state persistence, IPC boundaries, and a global status surface skeleton.

**Architecture:** This plan intentionally stops before real local watcher and file transfer sync execution. Server Drive mutations emit durable change records. Desktop stores sync bindings and conflict/operation state through DataRepository, exposes IPC for binding lifecycle/status, and renders entry points that can later drive real sync operations.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Electron main IPC, React 19, shadcn/Radix UI, Tailwind tokens, Vitest, TypeScript 6, pnpm monorepo.

---

## Scope Split

The approved design spans several subsystems. This plan covers Phase 1 only:

- Shared Drive sync DTOs.
- Server-side Drive change log and cursor API.
- Change log emission for existing Drive write operations.
- Desktop local sync DataRepository schemas.
- Desktop `DriveSyncService` shell for bindings, conflicts, operations, and snapshots.
- IPC/preload/bridge types for the sync shell.
- Minimal renderer surfaces in Drive rows and a global status entry.
- Release notes and verification.

Real file transfer, local filesystem watcher, conflict resolution file writes, local trash behavior, and folder tree sync are deliberately left for later plans because they need separate TDD cycles and risk review.

## File Structure

### Shared

- Modify `shared/src/drive.ts`
  - Add `DriveChangeType`, `DriveChangeDto`, `DriveChangeListInput`, `DriveChangeListPageDto`.
  - Add desktop-facing sync snapshot types: `DriveSyncBindingDto`, `DriveSyncSnapshotDto`, `DriveSyncConflictDto`, `DriveSyncOperationDto`.
- Modify `shared/src/drive.test.ts`
  - Test the stable type value arrays.

### Server

- Modify `server/prisma/schema.prisma`
  - Add `DriveChange` model and relations from `User` and `DriveItem`.
- Create `server/prisma/migrations/20260628160000_drive_change_log/migration.sql`
  - SQL for `DriveChange`.
- Create `server/src/drive/drive-change-log.ts`
  - Append and list change records.
- Create `server/src/drive/drive-change-log.spec.ts`
  - Unit tests using a mocked Prisma surface.
- Modify `server/src/drive/drive.module.ts`
  - Register `DriveChangeLogService`.
- Modify `server/src/drive/drive.service.ts`
  - Inject optional `DriveChangeLogService`.
  - Emit changes after successful create/upload/rename/move/trash/restore/text edit operations.
- Modify `server/src/drive/drive-lifecycle.service.ts`
  - Emit changes for trash/restore/hide paths if lifecycle owns the database mutation.
- Modify `server/src/drive/drive.controller.ts`
  - Add `GET /api/drive/changes`.
- Modify `server/src/drive/drive.controller.spec.ts`
  - Test query parsing and authenticated scope.
- Modify `server/src/drive/drive.service.spec.ts`
  - Test change emission at service level for representative mutations.

### Desktop Main

- Create `desktop/electron/runtime/data-repo/schemas/drive-sync.ts`
  - DataRepository schemas for `app.drive-sync.bindings`, `app.drive-sync.baseline`, `app.drive-sync.conflicts`, `app.drive-sync.operations`, and `app.drive-sync.settings`.
- Modify `desktop/electron/runtime/data-repo/schemas/index.ts`
  - Export and register the new schemas.
- Modify `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts`
  - Validate schema registration and minimal valid records.
- Create `desktop/electron/services/drive-sync-service.ts`
  - Binding lifecycle and snapshot aggregation shell.
- Create `desktop/electron/services/__tests__/drive-sync-service.test.ts`
  - TDD for binding creation validation, pause/resume/remove, conflict/operation snapshot aggregation.
- Create `desktop/electron/modules/drive-sync/ipc.ts`
  - IPC module wrapping `DriveSyncService`.
- Create `desktop/electron/modules/drive-sync/__tests__/ipc.test.ts`
  - IPC schema validation tests.
- Modify `desktop/electron/bootstrap/ipc-registry.ts`
  - Register `driveSyncIpcModule`.
- Modify `desktop/electron/preload.ts`
  - Add `window.synapse.driveSync`.
- Modify `desktop/src/types/bridge.ts`
  - Add `driveSync` bridge type.
- Modify `desktop/electron/__tests__/preload.test.ts`
  - Assert new preload methods use expected channels.

### Desktop Renderer

- Modify `desktop/src/modules/drive/index.tsx`
  - Add row-level sync status/actions from `window.synapse.driveSync.getSnapshot()`.
  - Show only minimal labels.
- Modify `desktop/src/modules/drive/__tests__/drive-module.test.tsx`
  - Test row status and action entry visibility.
- Add or modify shell status component
  - Prefer existing shell action/status pattern. Locate with `rg "SyncStatusChip|status center|repository.syncSnapshot" desktop/src/app-shell`.
  - Add Drive sync status entry next to existing status center conventions.
- Add renderer test near the chosen shell component.

### Docs

- Modify `RELEASE_NOTES_PENDING.md`
  - Add one user-facing note about Drive sync groundwork only after visible UI/status entry exists.

---

## Task 1: Shared Drive Change And Sync Types

**Files:**
- Modify: `shared/src/drive.ts`
- Modify: `shared/src/drive.test.ts`

- [ ] **Step 1: Write failing shared type/value tests**

Add tests to `shared/src/drive.test.ts`:

```ts
import {
  DRIVE_CHANGE_TYPES,
  DRIVE_SYNC_BINDING_STATUSES,
  DRIVE_SYNC_OPERATION_STATUSES,
} from "./drive"

it("exports stable Drive change types for sync cursors", () => {
  expect(DRIVE_CHANGE_TYPES).toEqual([
    "created",
    "content_updated",
    "renamed",
    "moved",
    "trashed",
    "restored",
    "deleted",
  ])
})

it("exports stable Drive sync status values", () => {
  expect(DRIVE_SYNC_BINDING_STATUSES).toEqual([
    "active",
    "paused",
    "conflict",
    "error",
    "removed",
  ])
  expect(DRIVE_SYNC_OPERATION_STATUSES).toEqual([
    "pending",
    "running",
    "succeeded",
    "retry_wait",
    "conflict",
    "error",
  ])
})
```

- [ ] **Step 2: Run shared tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/shared test -- drive.test.ts
```

Expected: FAIL because `DRIVE_CHANGE_TYPES`, `DRIVE_SYNC_BINDING_STATUSES`, and `DRIVE_SYNC_OPERATION_STATUSES` are not exported.

- [ ] **Step 3: Add shared DTOs**

Append near existing Drive type declarations in `shared/src/drive.ts`:

```ts
export const DRIVE_CHANGE_TYPES = [
  "created",
  "content_updated",
  "renamed",
  "moved",
  "trashed",
  "restored",
  "deleted",
] as const

export type DriveChangeType = typeof DRIVE_CHANGE_TYPES[number]

export interface DriveChangeDto {
  readonly id: string
  readonly sequence: string
  readonly itemId: string
  readonly parentId: string | null
  readonly type: DriveChangeType
  readonly versionId?: string | null
  readonly etag?: string | null
  readonly name?: string | null
  readonly pathHint?: string | null
  readonly actor?: string | null
  readonly occurredAt: string
}

export interface DriveChangeListInput {
  readonly cursor?: string | null
  readonly limit?: number
}

export interface DriveChangeListPageDto {
  readonly items: readonly DriveChangeDto[]
  readonly nextCursor: string | null
  readonly hasMore: boolean
  readonly resyncRequired: boolean
}

export const DRIVE_SYNC_BINDING_STATUSES = [
  "active",
  "paused",
  "conflict",
  "error",
  "removed",
] as const

export type DriveSyncBindingStatus = typeof DRIVE_SYNC_BINDING_STATUSES[number]

export const DRIVE_SYNC_OPERATION_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "retry_wait",
  "conflict",
  "error",
] as const

export type DriveSyncOperationStatus = typeof DRIVE_SYNC_OPERATION_STATUSES[number]

export interface DriveSyncBindingDto {
  readonly id: string
  readonly driveItemId: string
  readonly driveItemName: string
  readonly kind: DriveItemType
  readonly localPath: string
  readonly status: DriveSyncBindingStatus
  readonly remoteCursor: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastSyncedAt: string | null
}

export interface DriveSyncConflictDto {
  readonly id: string
  readonly bindingId: string
  readonly relativePath: string
  readonly type: string
  readonly createdAt: string
}

export interface DriveSyncOperationDto {
  readonly id: string
  readonly bindingId: string
  readonly relativePath: string
  readonly status: DriveSyncOperationStatus
  readonly message: string | null
  readonly updatedAt: string
}

export interface DriveSyncSnapshotDto {
  readonly bindings: readonly DriveSyncBindingDto[]
  readonly conflicts: readonly DriveSyncConflictDto[]
  readonly operations: readonly DriveSyncOperationDto[]
  readonly summary: {
    readonly activeBindingCount: number
    readonly runningOperationCount: number
    readonly conflictCount: number
    readonly errorCount: number
  }
}
```

- [ ] **Step 4: Run shared tests and confirm pass**

Run:

```bash
pnpm --filter @synapse/shared test -- drive.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/drive.ts shared/src/drive.test.ts
git commit -m "feat: add drive sync shared types"
```

---

## Task 2: Server Drive Change Log Storage

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260628160000_drive_change_log/migration.sql`
- Create: `server/src/drive/drive-change-log.ts`
- Create: `server/src/drive/drive-change-log.spec.ts`
- Modify: `server/src/drive/drive.module.ts`

- [ ] **Step 1: Write failing change log service tests**

Create `server/src/drive/drive-change-log.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { DriveChangeLogService } from "./drive-change-log"

describe("DriveChangeLogService", () => {
  it("appends a scoped Drive change record without storage secrets", async () => {
    const prisma = {
      driveChange: {
        create: vi.fn(async ({ data }) => ({
          id: "chg_1",
          sequence: 1n,
          userId: data.userId,
          itemId: data.itemId,
          parentId: data.parentId,
          type: data.type,
          versionId: data.versionId,
          etag: data.etag,
          name: data.name,
          pathHint: data.pathHint,
          actor: data.actor,
          occurredAt: new Date("2026-06-28T08:00:00.000Z"),
        })),
      },
    }
    const service = new DriveChangeLogService(prisma as any)

    const change = await service.append({
      userId: "user-1",
      itemId: "item-1",
      parentId: null,
      type: "content_updated",
      versionId: "version-1",
      etag: "etag-1",
      name: "report.md",
      actor: "user-1",
      pathHint: "/report.md",
    })

    expect(change).toMatchObject({
      id: "chg_1",
      sequence: "1",
      itemId: "item-1",
      type: "content_updated",
      versionId: "version-1",
      etag: "etag-1",
      name: "report.md",
    })
    expect(JSON.stringify(prisma.driveChange.create.mock.calls[0][0].data)).not.toContain("storageKey")
  })

  it("lists changes after a cursor with next cursor metadata", async () => {
    const prisma = {
      driveChange: {
        findMany: vi.fn(async () => [
          {
            id: "chg_2",
            sequence: 2n,
            userId: "user-1",
            itemId: "item-2",
            parentId: null,
            type: "renamed",
            versionId: null,
            etag: null,
            name: "next.md",
            pathHint: null,
            actor: "user-1",
            occurredAt: new Date("2026-06-28T08:01:00.000Z"),
          },
        ]),
      },
    }
    const service = new DriveChangeLogService(prisma as any)

    await expect(service.list("user-1", { cursor: "1", limit: 50 })).resolves.toEqual({
      items: [{
        id: "chg_2",
        sequence: "2",
        itemId: "item-2",
        parentId: null,
        type: "renamed",
        versionId: null,
        etag: null,
        name: "next.md",
        pathHint: null,
        actor: "user-1",
        occurredAt: "2026-06-28T08:01:00.000Z",
      }],
      nextCursor: "2",
      hasMore: false,
      resyncRequired: false,
    })
  })
})
```

- [ ] **Step 2: Run server test and confirm failure**

Run:

```bash
pnpm --filter @synapse/server test -- drive-change-log.spec.ts
```

Expected: FAIL because `drive-change-log.ts` does not exist.

- [ ] **Step 3: Add Prisma model**

Add to `server/prisma/schema.prisma`:

```prisma
model DriveChange {
  id         String    @id @default(cuid())
  sequence   BigInt    @unique @default(autoincrement())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  itemId     String
  item       DriveItem @relation(fields: [itemId], references: [id], onDelete: Restrict)
  parentId   String?
  type       String    @db.VarChar(32)
  versionId  String?
  etag       String?
  name       String?
  pathHint   String?
  actor      String?
  occurredAt DateTime  @default(now())

  @@index([userId, sequence])
  @@index([itemId, sequence])
  @@index([userId, itemId, sequence])
}
```

Add relation fields:

```prisma
model User {
  // existing fields
  driveChanges DriveChange[]
}

model DriveItem {
  // existing fields
  changes DriveChange[]
}
```

- [ ] **Step 4: Add migration SQL**

Create `server/prisma/migrations/20260628160000_drive_change_log/migration.sql`:

```sql
CREATE TABLE "DriveChange" (
    "id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" VARCHAR(32) NOT NULL,
    "versionId" TEXT,
    "etag" TEXT,
    "name" TEXT,
    "pathHint" TEXT,
    "actor" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriveChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriveChange_sequence_key" ON "DriveChange"("sequence");
CREATE INDEX "DriveChange_userId_sequence_idx" ON "DriveChange"("userId", "sequence");
CREATE INDEX "DriveChange_itemId_sequence_idx" ON "DriveChange"("itemId", "sequence");
CREATE INDEX "DriveChange_userId_itemId_sequence_idx" ON "DriveChange"("userId", "itemId", "sequence");

ALTER TABLE "DriveChange"
  ADD CONSTRAINT "DriveChange_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriveChange"
  ADD CONSTRAINT "DriveChange_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "DriveItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 5: Implement change log service**

Create `server/src/drive/drive-change-log.ts`:

```ts
import { Injectable } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import type { DriveChangeDto, DriveChangeListInput, DriveChangeListPageDto, DriveChangeType } from "@synapse/shared"
import { PrismaService } from "../prisma/prisma.service"

type DriveChangePrisma = PrismaService | Prisma.TransactionClient

export type DriveChangeAppendInput = {
  readonly userId: string
  readonly itemId: string
  readonly parentId: string | null
  readonly type: DriveChangeType
  readonly versionId?: string | null
  readonly etag?: string | null
  readonly name?: string | null
  readonly pathHint?: string | null
  readonly actor?: string | null
}

@Injectable()
export class DriveChangeLogService {
  constructor(private readonly prisma: PrismaService) {}

  append(input: DriveChangeAppendInput, client: DriveChangePrisma = this.prisma): Promise<DriveChangeDto> {
    return client.driveChange.create({
      data: {
        userId: input.userId,
        itemId: input.itemId,
        parentId: input.parentId,
        type: input.type,
        versionId: input.versionId ?? null,
        etag: input.etag ?? null,
        name: input.name ?? null,
        pathHint: input.pathHint ?? null,
        actor: input.actor ?? null,
      },
    }).then(toDriveChangeDto)
  }

  async list(userId: string, input: DriveChangeListInput = {}): Promise<DriveChangeListPageDto> {
    const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 100), 500))
    const cursor = parseCursor(input.cursor)
    const rows = await this.prisma.driveChange.findMany({
      where: { userId, sequence: { gt: cursor } },
      orderBy: { sequence: "asc" },
      take: limit + 1,
    })
    const pageRows = rows.slice(0, limit)
    return {
      items: pageRows.map(toDriveChangeDto),
      nextCursor: pageRows.at(-1)?.sequence.toString() ?? input.cursor ?? null,
      hasMore: rows.length > limit,
      resyncRequired: false,
    }
  }
}

function parseCursor(cursor: string | null | undefined): bigint {
  if (!cursor) return 0n
  if (!/^\d+$/u.test(cursor)) return 0n
  return BigInt(cursor)
}

function toDriveChangeDto(change: {
  readonly id: string
  readonly sequence: bigint
  readonly itemId: string
  readonly parentId: string | null
  readonly type: string
  readonly versionId: string | null
  readonly etag: string | null
  readonly name: string | null
  readonly pathHint: string | null
  readonly actor: string | null
  readonly occurredAt: Date
}): DriveChangeDto {
  return {
    id: change.id,
    sequence: change.sequence.toString(),
    itemId: change.itemId,
    parentId: change.parentId,
    type: change.type as DriveChangeType,
    versionId: change.versionId,
    etag: change.etag,
    name: change.name,
    pathHint: change.pathHint,
    actor: change.actor,
    occurredAt: change.occurredAt.toISOString(),
  }
}
```

- [ ] **Step 6: Register service**

Modify `server/src/drive/drive.module.ts`:

```ts
import { DriveChangeLogService } from "./drive-change-log"
```

Add `DriveChangeLogService` to `providers` and `exports`.

- [ ] **Step 7: Run test and Prisma generation**

Run:

```bash
pnpm --filter @synapse/server run prisma:generate
pnpm --filter @synapse/server test -- drive-change-log.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260628160000_drive_change_log/migration.sql server/src/drive/drive-change-log.ts server/src/drive/drive-change-log.spec.ts server/src/drive/drive.module.ts
git commit -m "feat: add drive change log storage"
```

---

## Task 3: Server Change Cursor API

**Files:**
- Modify: `server/src/drive/drive.controller.ts`
- Modify: `server/src/drive/drive.controller.spec.ts`

- [ ] **Step 1: Write failing controller test**

In `server/src/drive/drive.controller.spec.ts`, add a test for `DriveUserController.listChanges`. Use the existing controller test style. The important assertion:

```ts
it("lists Drive changes for the authenticated user", async () => {
  const changes = {
    list: vi.fn(async () => ({
      items: [],
      nextCursor: "42",
      hasMore: false,
      resyncRequired: false,
    })),
  }
  const controller = new DriveUserController({} as any, undefined, undefined, undefined, undefined, changes as any)
  const request = { user: { id: "user-1" } } as any

  await expect(controller.listChanges("41", "50", request)).resolves.toEqual({
    items: [],
    nextCursor: "42",
    hasMore: false,
    resyncRequired: false,
  })
  expect(changes.list).toHaveBeenCalledWith("user-1", { cursor: "41", limit: 50 })
})
```

- [ ] **Step 2: Run controller test and confirm failure**

Run:

```bash
pnpm --filter @synapse/server test -- drive.controller.spec.ts
```

Expected: FAIL because `DriveUserController` does not accept `DriveChangeLogService` and has no `listChanges` method.

- [ ] **Step 3: Add controller dependency and route**

Modify imports:

```ts
import { DriveChangeLogService } from "./drive-change-log"
```

Add optional constructor argument to `DriveUserController` after existing services:

```ts
@Optional() private readonly changes?: DriveChangeLogService,
```

Add method:

```ts
@Get("/changes")
listChanges(
  @Query("cursor") cursor: string | undefined,
  @Query("limit") limit: string | undefined,
  @Req() request: AuthenticatedUserRequest,
) {
  return requireDriveChangeLog(this.changes).list(request.user!.id, {
    cursor: cursor ?? null,
    limit: parseOptionalPositiveInteger(limit, "limit"),
  })
}
```

Add helper near other `require*` helpers:

```ts
function requireDriveChangeLog(service: DriveChangeLogService | undefined): DriveChangeLogService {
  if (!service) throw new Error("Drive change log service is not available.")
  return service
}
```

Use the existing `parseOptionalPositiveInteger` helper if present. If only `parseOptionalNonNegativeInteger` exists, add:

```ts
function parseOptionalPositiveInteger(value: string | undefined, field: string): number | undefined {
  if (value === undefined || value.trim() === "") return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new BadRequestException(`${field} 参数无效。`)
  return parsed
}
```

- [ ] **Step 4: Run controller test**

Run:

```bash
pnpm --filter @synapse/server test -- drive.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/drive/drive.controller.ts server/src/drive/drive.controller.spec.ts
git commit -m "feat: expose drive change cursor api"
```

---

## Task 4: Emit Change Records From Drive Mutations

**Files:**
- Modify: `server/src/drive/drive.service.ts`
- Modify: `server/src/drive/drive-lifecycle.service.ts`
- Modify: `server/src/drive/drive.service.spec.ts`
- Modify: `server/src/drive/drive-lifecycle.service.spec.ts`

- [ ] **Step 1: Write failing service emission tests**

In `server/src/drive/drive.service.spec.ts`, add representative tests for create/upload/rename/move. Use a fake change log:

```ts
it("emits Drive changes for folder create, rename, and move", async () => {
  const prisma = createPrismaMemory()
  const changes = { append: vi.fn(async () => ({ id: "chg", sequence: "1" })) }
  const service = new DriveService(prisma as unknown as PrismaService, storageMock, undefined, undefined, changes as any)
  await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })

  const folder = await service.createFolder("user-1", { parentId: null, name: "Docs" })
  await service.renameItem("user-1", folder.id, "Specs")
  await service.moveItem("user-1", folder.id, null)

  expect(changes.append).toHaveBeenCalledWith(expect.objectContaining({
    userId: "user-1",
    itemId: folder.id,
    parentId: null,
    type: "created",
    name: "Docs",
  }))
  expect(changes.append).toHaveBeenCalledWith(expect.objectContaining({
    userId: "user-1",
    itemId: folder.id,
    type: "renamed",
    name: "Specs",
  }))
  expect(changes.append).toHaveBeenCalledWith(expect.objectContaining({
    userId: "user-1",
    itemId: folder.id,
    type: "moved",
  }))
})

it("emits a content update change when upload completes", async () => {
  const prisma = createPrismaMemory()
  const changes = { append: vi.fn(async () => ({ id: "chg", sequence: "1" })) }
  const service = new DriveService(prisma as unknown as PrismaService, storageMock, undefined, undefined, changes as any)
  await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })

  const prepared = await service.prepareUpload("user-1", {
    parentId: null,
    name: "report.txt",
    size: "11",
    mimeType: "text/plain",
    publicAppUrl: "https://synapse.test",
  })
  const completed = await service.completeUpload("user-1", prepared.sessionId)

  expect(changes.append).toHaveBeenCalledWith(expect.objectContaining({
    userId: "user-1",
    itemId: completed.id,
    parentId: null,
    type: "content_updated",
    name: "report.txt",
  }))
})
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/server test -- drive.service.spec.ts
```

Expected: FAIL because `DriveService` does not accept or call a change log service.

- [ ] **Step 3: Inject optional change log service**

Modify `server/src/drive/drive.service.ts` imports:

```ts
import { DriveChangeLogService } from "./drive-change-log"
```

Modify constructor:

```ts
@Optional() private readonly changes?: DriveChangeLogService,
```

Add helper method inside `DriveService`:

```ts
private async recordDriveChange(input: Parameters<DriveChangeLogService["append"]>[0]): Promise<void> {
  if (!this.changes) return
  await this.changes.append(input)
}
```

- [ ] **Step 4: Emit changes after successful mutations**

After successful DB commits and audits, call:

```ts
await this.recordDriveChange({
  userId,
  itemId: folder.id,
  parentId: folder.parentId,
  type: "created",
  name: folder.name,
  actor: userId,
})
```

Use these mappings:

- `createFolder`: `created`
- `completeUpload`: `content_updated`, with current version id from `findCurrentDriveFileVersionId(result.item)`
- `renameItem`: `renamed`
- `moveItem`: `moved`
- `restoreFileVersion`: `content_updated`
- `updateOwnerFileText`: emitted from `commitTextFileChange` as `content_updated`

The emitted object must not include `storageKey`.

- [ ] **Step 5: Emit lifecycle changes**

Open `server/src/drive/drive-lifecycle.service.ts`. If it owns trash/restore database mutations, inject `DriveChangeLogService` there and emit:

- `trashItem`: `trashed`
- `restoreItem`: `restored`
- hard hide/delete path when applicable: `deleted`

If `DriveLifecycleService` cannot receive `DriveChangeLogService` without a circular provider issue, keep lifecycle unchanged in this task and emit from `DriveService.deleteItem` / `DriveService.restoreItem` wrappers after they resolve.

- [ ] **Step 6: Run server tests**

Run:

```bash
pnpm --filter @synapse/server test -- drive.service.spec.ts drive-lifecycle.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/drive/drive.service.ts server/src/drive/drive-lifecycle.service.ts server/src/drive/drive.service.spec.ts server/src/drive/drive-lifecycle.service.spec.ts
git commit -m "feat: emit drive change records"
```

---

## Task 5: Desktop Drive Sync DataRepository Schemas

**Files:**
- Create: `desktop/electron/runtime/data-repo/schemas/drive-sync.ts`
- Modify: `desktop/electron/runtime/data-repo/schemas/index.ts`
- Modify: `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts`

- [ ] **Step 1: Write failing schema registration tests**

Modify `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts` imports:

```ts
import {
  driveSyncBaselineSchema,
  driveSyncBindingsSchema,
  driveSyncConflictsSchema,
  driveSyncOperationsSchema,
  driveSyncSettingsSchema,
} from "../schemas/drive-sync"
```

Add expected names:

```ts
"app.drive-sync.baseline",
"app.drive-sync.bindings",
"app.drive-sync.conflicts",
"app.drive-sync.operations",
"app.drive-sync.settings",
```

Add backend expectations:

```ts
expect(driveSyncBindingsSchema.backend).toBe("sqlite")
expect(driveSyncBaselineSchema.backend).toBe("sqlite")
expect(driveSyncConflictsSchema.backend).toBe("sqlite")
expect(driveSyncOperationsSchema.backend).toBe("sqlite")
expect(driveSyncSettingsSchema.backend).toBe("json")
```

Add minimal validation expectations:

```ts
expect(driveSyncBindingsSchema.validate({
  id: "binding-1",
  schemaVersion: 1,
  driveItemId: "item-1",
  driveItemName: "Docs",
  kind: "folder",
  localPath: "/tmp/Docs",
  status: "active",
  remoteCursor: null,
  createdAt: "2026-06-28T00:00:00.000Z",
  updatedAt: "2026-06-28T00:00:00.000Z",
  lastSyncedAt: null,
})).toBe(true)
expect(driveSyncBindingsSchema.validate({ id: "bad", schemaVersion: 1 })).toBe(false)
```

- [ ] **Step 2: Run desktop schema test and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/runtime/data-repo/__tests__/schemas.test.ts
```

Expected: FAIL because `schemas/drive-sync.ts` does not exist.

- [ ] **Step 3: Add schemas**

Create `desktop/electron/runtime/data-repo/schemas/drive-sync.ts`:

```ts
import type { NamespaceSchema } from "../types"

export type DriveSyncBindingEntryV1 = {
  readonly id: string
  readonly schemaVersion: 1
  readonly driveItemId: string
  readonly driveItemName: string
  readonly kind: "file" | "folder"
  readonly localPath: string
  readonly status: "active" | "paused" | "conflict" | "error" | "removed"
  readonly remoteCursor: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastSyncedAt: string | null
}

export type DriveSyncBaselineEntryV1 = {
  readonly id: string
  readonly schemaVersion: 1
  readonly bindingId: string
  readonly relativePath: string
  readonly kind: "file" | "folder"
  readonly remoteItemId: string
  readonly remoteVersionId: string | null
  readonly remoteEtag: string | null
  readonly localSize: number | null
  readonly localMtimeMs: number | null
  readonly localHash: string | null
  readonly lastSyncedAt: string
  readonly deletedAt: string | null
}

export type DriveSyncConflictEntryV1 = {
  readonly id: string
  readonly schemaVersion: 1
  readonly bindingId: string
  readonly relativePath: string
  readonly type: string
  readonly createdAt: string
  readonly resolvedAt: string | null
}

export type DriveSyncOperationEntryV1 = {
  readonly id: string
  readonly schemaVersion: 1
  readonly bindingId: string
  readonly relativePath: string
  readonly status: "pending" | "running" | "succeeded" | "retry_wait" | "conflict" | "error"
  readonly message: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export type DriveSyncSettingsEntryV1 = {
  readonly schemaVersion: 1
  readonly enabled: boolean
}

export const driveSyncBindingsSchema: NamespaceSchema<DriveSyncBindingEntryV1> = {
  name: "app.drive-sync.bindings",
  backend: "sqlite",
  currentVersion: 1,
  migrations: [],
  encrypted: false,
  validate: isDriveSyncBindingEntryV1,
}

export const driveSyncBaselineSchema: NamespaceSchema<DriveSyncBaselineEntryV1> = {
  name: "app.drive-sync.baseline",
  backend: "sqlite",
  currentVersion: 1,
  migrations: [],
  encrypted: false,
  validate: isDriveSyncBaselineEntryV1,
}

export const driveSyncConflictsSchema: NamespaceSchema<DriveSyncConflictEntryV1> = {
  name: "app.drive-sync.conflicts",
  backend: "sqlite",
  currentVersion: 1,
  migrations: [],
  encrypted: false,
  validate: isDriveSyncConflictEntryV1,
}

export const driveSyncOperationsSchema: NamespaceSchema<DriveSyncOperationEntryV1> = {
  name: "app.drive-sync.operations",
  backend: "sqlite",
  currentVersion: 1,
  migrations: [],
  encrypted: false,
  validate: isDriveSyncOperationEntryV1,
}

export const driveSyncSettingsSchema: NamespaceSchema<DriveSyncSettingsEntryV1> = {
  name: "app.drive-sync.settings",
  backend: "json",
  currentVersion: 1,
  migrations: [],
  encrypted: false,
  defaults: () => ({ schemaVersion: 1, enabled: true }),
  validate: isDriveSyncSettingsEntryV1,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
}

function isDriveSyncBindingEntryV1(value: unknown): value is DriveSyncBindingEntryV1 {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
    && typeof value.id === "string"
    && typeof value.driveItemId === "string"
    && typeof value.driveItemName === "string"
    && (value.kind === "file" || value.kind === "folder")
    && typeof value.localPath === "string"
    && ["active", "paused", "conflict", "error", "removed"].includes(String(value.status))
    && (typeof value.remoteCursor === "string" || value.remoteCursor === null)
    && isIso(value.createdAt)
    && isIso(value.updatedAt)
    && (isIso(value.lastSyncedAt) || value.lastSyncedAt === null)
}

function isDriveSyncBaselineEntryV1(value: unknown): value is DriveSyncBaselineEntryV1 {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
    && typeof value.id === "string"
    && typeof value.bindingId === "string"
    && typeof value.relativePath === "string"
    && (value.kind === "file" || value.kind === "folder")
    && typeof value.remoteItemId === "string"
    && (typeof value.remoteVersionId === "string" || value.remoteVersionId === null)
    && (typeof value.remoteEtag === "string" || value.remoteEtag === null)
    && (typeof value.localSize === "number" || value.localSize === null)
    && (typeof value.localMtimeMs === "number" || value.localMtimeMs === null)
    && (typeof value.localHash === "string" || value.localHash === null)
    && isIso(value.lastSyncedAt)
    && (isIso(value.deletedAt) || value.deletedAt === null)
}

function isDriveSyncConflictEntryV1(value: unknown): value is DriveSyncConflictEntryV1 {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
    && typeof value.id === "string"
    && typeof value.bindingId === "string"
    && typeof value.relativePath === "string"
    && typeof value.type === "string"
    && isIso(value.createdAt)
    && (isIso(value.resolvedAt) || value.resolvedAt === null)
}

function isDriveSyncOperationEntryV1(value: unknown): value is DriveSyncOperationEntryV1 {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
    && typeof value.id === "string"
    && typeof value.bindingId === "string"
    && typeof value.relativePath === "string"
    && ["pending", "running", "succeeded", "retry_wait", "conflict", "error"].includes(String(value.status))
    && (typeof value.message === "string" || value.message === null)
    && isIso(value.createdAt)
    && isIso(value.updatedAt)
}

function isDriveSyncSettingsEntryV1(value: unknown): value is DriveSyncSettingsEntryV1 {
  return isRecord(value)
    && value.schemaVersion === 1
    && typeof value.enabled === "boolean"
}
```

- [ ] **Step 4: Register schemas**

Modify `desktop/electron/runtime/data-repo/schemas/index.ts`:

```ts
export {
  driveSyncBaselineSchema,
  driveSyncBindingsSchema,
  driveSyncConflictsSchema,
  driveSyncOperationsSchema,
  driveSyncSettingsSchema,
  type DriveSyncBaselineEntryV1,
  type DriveSyncBindingEntryV1,
  type DriveSyncConflictEntryV1,
  type DriveSyncOperationEntryV1,
  type DriveSyncSettingsEntryV1,
} from "./drive-sync"
```

Import the schemas and add them to `allSchemas` near other app namespaces:

```ts
import {
  driveSyncBaselineSchema,
  driveSyncBindingsSchema,
  driveSyncConflictsSchema,
  driveSyncOperationsSchema,
  driveSyncSettingsSchema,
} from "./drive-sync"
```

```ts
driveSyncBindingsSchema,
driveSyncBaselineSchema,
driveSyncConflictsSchema,
driveSyncOperationsSchema,
driveSyncSettingsSchema,
```

- [ ] **Step 5: Run schema tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/runtime/data-repo/__tests__/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/runtime/data-repo/schemas/drive-sync.ts desktop/electron/runtime/data-repo/schemas/index.ts desktop/electron/runtime/data-repo/__tests__/schemas.test.ts
git commit -m "feat: add drive sync local schemas"
```

---

## Task 6: Desktop DriveSyncService Shell

**Files:**
- Create: `desktop/electron/services/drive-sync-service.ts`
- Create: `desktop/electron/services/__tests__/drive-sync-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `desktop/electron/services/__tests__/drive-sync-service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DriveSyncService } from "../drive-sync-service"

function createNamespace<T extends { id: string }>(initial: T[] = []) {
  const rows = new Map(initial.map((item) => [item.id, item]))
  return {
    list: vi.fn(async () => [...rows.values()]),
    get: vi.fn(async (id: string) => rows.get(id) ?? null),
    upsert: vi.fn(async (item: T) => { rows.set(item.id, item) }),
    remove: vi.fn(async (id: string) => { rows.delete(id) }),
  }
}

describe("DriveSyncService", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-28T10:00:00.000Z"))
  })

  it("creates an active binding and returns it in the snapshot", async () => {
    const bindings = createNamespace<any>()
    const conflicts = createNamespace<any>()
    const operations = createNamespace<any>()
    const service = new DriveSyncService({ bindings, conflicts, operations } as any)

    const binding = await service.createBinding({
      driveItemId: "item-1",
      driveItemName: "Docs",
      kind: "folder",
      localPath: "/tmp/Docs",
      remoteCursor: "12",
    })

    expect(binding).toMatchObject({
      driveItemId: "item-1",
      driveItemName: "Docs",
      kind: "folder",
      localPath: "/tmp/Docs",
      status: "active",
      remoteCursor: "12",
      createdAt: "2026-06-28T10:00:00.000Z",
    })
    await expect(service.getSnapshot()).resolves.toMatchObject({
      summary: {
        activeBindingCount: 1,
        runningOperationCount: 0,
        conflictCount: 0,
        errorCount: 0,
      },
    })
  })

  it("pauses, resumes, and removes bindings without deleting files", async () => {
    const bindings = createNamespace<any>()
    const service = new DriveSyncService({
      bindings,
      conflicts: createNamespace<any>(),
      operations: createNamespace<any>(),
    } as any)
    const binding = await service.createBinding({
      driveItemId: "item-1",
      driveItemName: "Docs",
      kind: "folder",
      localPath: "/tmp/Docs",
      remoteCursor: null,
    })

    await expect(service.pauseBinding(binding.id)).resolves.toMatchObject({ status: "paused" })
    await expect(service.resumeBinding(binding.id)).resolves.toMatchObject({ status: "active" })
    await expect(service.removeBinding(binding.id)).resolves.toMatchObject({ status: "removed" })
  })
})
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/drive-sync-service.test.ts
```

Expected: FAIL because `drive-sync-service.ts` does not exist.

- [ ] **Step 3: Implement service shell**

Create `desktop/electron/services/drive-sync-service.ts`:

```ts
import { randomUUID } from "node:crypto"
import type { DriveSyncSnapshotDto } from "@synapse/shared" with { "resolution-mode": "import" }
import type { DataNamespace } from "../runtime/data-repo/types"
import type {
  DriveSyncBindingEntryV1,
  DriveSyncConflictEntryV1,
  DriveSyncOperationEntryV1,
} from "../runtime/data-repo/schemas/drive-sync"

type DriveSyncServiceDeps = {
  readonly bindings: Pick<DataNamespace<DriveSyncBindingEntryV1>, "get" | "list" | "upsert">
  readonly conflicts: Pick<DataNamespace<DriveSyncConflictEntryV1>, "list">
  readonly operations: Pick<DataNamespace<DriveSyncOperationEntryV1>, "list">
}

export type DriveSyncCreateBindingInput = {
  readonly driveItemId: string
  readonly driveItemName: string
  readonly kind: "file" | "folder"
  readonly localPath: string
  readonly remoteCursor?: string | null
}

export class DriveSyncService {
  constructor(private readonly deps: DriveSyncServiceDeps) {}

  async createBinding(input: DriveSyncCreateBindingInput): Promise<DriveSyncBindingEntryV1> {
    const now = new Date().toISOString()
    const binding: DriveSyncBindingEntryV1 = {
      id: randomUUID(),
      schemaVersion: 1,
      driveItemId: input.driveItemId,
      driveItemName: input.driveItemName,
      kind: input.kind,
      localPath: input.localPath,
      status: "active",
      remoteCursor: input.remoteCursor ?? null,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: null,
    }
    await this.deps.bindings.upsert(binding)
    return binding
  }

  async pauseBinding(bindingId: string): Promise<DriveSyncBindingEntryV1> {
    return this.updateBindingStatus(bindingId, "paused")
  }

  async resumeBinding(bindingId: string): Promise<DriveSyncBindingEntryV1> {
    return this.updateBindingStatus(bindingId, "active")
  }

  async removeBinding(bindingId: string): Promise<DriveSyncBindingEntryV1> {
    return this.updateBindingStatus(bindingId, "removed")
  }

  async getSnapshot(): Promise<DriveSyncSnapshotDto> {
    const [bindings, conflicts, operations] = await Promise.all([
      this.deps.bindings.list(),
      this.deps.conflicts.list(),
      this.deps.operations.list(),
    ])
    const activeBindings = bindings.filter((binding) => binding.status === "active")
    const openConflicts = conflicts.filter((conflict) => conflict.resolvedAt === null)
    const runningOperations = operations.filter((operation) => operation.status === "running")
    const errorOperations = operations.filter((operation) => operation.status === "error")
    return {
      bindings: bindings.map((binding) => ({
        id: binding.id,
        driveItemId: binding.driveItemId,
        driveItemName: binding.driveItemName,
        kind: binding.kind,
        localPath: binding.localPath,
        status: binding.status,
        remoteCursor: binding.remoteCursor,
        createdAt: binding.createdAt,
        updatedAt: binding.updatedAt,
        lastSyncedAt: binding.lastSyncedAt,
      })),
      conflicts: openConflicts.map((conflict) => ({
        id: conflict.id,
        bindingId: conflict.bindingId,
        relativePath: conflict.relativePath,
        type: conflict.type,
        createdAt: conflict.createdAt,
      })),
      operations: operations.map((operation) => ({
        id: operation.id,
        bindingId: operation.bindingId,
        relativePath: operation.relativePath,
        status: operation.status,
        message: operation.message,
        updatedAt: operation.updatedAt,
      })),
      summary: {
        activeBindingCount: activeBindings.length,
        runningOperationCount: runningOperations.length,
        conflictCount: openConflicts.length,
        errorCount: errorOperations.length,
      },
    }
  }

  private async updateBindingStatus(
    bindingId: string,
    status: DriveSyncBindingEntryV1["status"],
  ): Promise<DriveSyncBindingEntryV1> {
    const current = await this.deps.bindings.get(bindingId)
    if (!current) throw new Error("同步绑定不存在。")
    const updated: DriveSyncBindingEntryV1 = {
      ...current,
      status,
      updatedAt: new Date().toISOString(),
    }
    await this.deps.bindings.upsert(updated)
    return updated
  }
}
```

- [ ] **Step 4: Run service tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/drive-sync-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/drive-sync-service.ts desktop/electron/services/__tests__/drive-sync-service.test.ts
git commit -m "feat: add drive sync service shell"
```

---

## Task 7: Desktop Drive Sync IPC And Preload

**Files:**
- Create: `desktop/electron/modules/drive-sync/ipc.ts`
- Create: `desktop/electron/modules/drive-sync/__tests__/ipc.test.ts`
- Modify: `desktop/electron/runtime/service-registry/registry.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/__tests__/preload.test.ts`

- [ ] **Step 1: Write failing IPC test**

Create `desktop/electron/modules/drive-sync/__tests__/ipc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { driveSyncIpcModule } from "../ipc"

describe("driveSyncIpcModule", () => {
  it("exposes snapshot and binding lifecycle channels", () => {
    const channels = Object.values(driveSyncIpcModule.methods).map((method) => method.channel).sort()
    expect(channels).toEqual([
      "synapse:drive-sync:bindings:create",
      "synapse:drive-sync:bindings:pause",
      "synapse:drive-sync:bindings:remove",
      "synapse:drive-sync:bindings:resume",
      "synapse:drive-sync:snapshot:get",
    ].sort())
  })

  it("validates create binding input", async () => {
    const createMethod = driveSyncIpcModule.methods.createBinding
    await expect(createMethod.handler(createContext(), {
      driveItemId: "item-1",
      driveItemName: "Docs",
      kind: "folder",
      localPath: "/tmp/Docs",
      remoteCursor: null,
    })).resolves.toMatchObject({ driveItemId: "item-1", status: "active" })
    await expect(createMethod.handler(createContext(), { driveItemId: "item-1" } as any)).rejects.toThrow()
  })
})

function createContext() {
  const service = {
    getSnapshot: vi.fn(async () => ({
      bindings: [],
      conflicts: [],
      operations: [],
      summary: {
        activeBindingCount: 0,
        runningOperationCount: 0,
        conflictCount: 0,
        errorCount: 0,
      },
    })),
    createBinding: vi.fn(async (input) => ({
      id: "binding-1",
      schemaVersion: 1,
      status: "active",
      createdAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
      lastSyncedAt: null,
      ...input,
    })),
    pauseBinding: vi.fn(),
    resumeBinding: vi.fn(),
    removeBinding: vi.fn(),
  }
  return {
    moduleId: "drive-sync",
    resolve: vi.fn(() => service),
  }
}
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/modules/drive-sync/__tests__/ipc.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement IPC module**

Create `desktop/electron/modules/drive-sync/ipc.ts`:

```ts
import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type { DriveSyncService } from "../../services/drive-sync-service"

const bindingIdSchema = z.object({ bindingId: z.string().min(1) }).strict()

const createBindingSchema = z.object({
  driveItemId: z.string().min(1),
  driveItemName: z.string().min(1),
  kind: z.enum(["file", "folder"]),
  localPath: z.string().min(1),
  remoteCursor: z.string().nullable().optional(),
}).strict()

export const driveSyncIpcModule: IpcModule = {
  id: "drive-sync",
  events: {},
  methods: {
    getSnapshot: {
      kind: "invoke",
      channel: "synapse:drive-sync:snapshot:get",
      request: z.void(),
      handler: async (ctx) => resolveDriveSyncService(ctx).getSnapshot(),
    },
    createBinding: {
      kind: "invoke",
      channel: "synapse:drive-sync:bindings:create",
      request: createBindingSchema,
      handler: async (ctx, input) => resolveDriveSyncService(ctx).createBinding(input),
    },
    pauseBinding: {
      kind: "invoke",
      channel: "synapse:drive-sync:bindings:pause",
      request: bindingIdSchema,
      handler: async (ctx, input) => resolveDriveSyncService(ctx).pauseBinding(input.bindingId),
    },
    resumeBinding: {
      kind: "invoke",
      channel: "synapse:drive-sync:bindings:resume",
      request: bindingIdSchema,
      handler: async (ctx, input) => resolveDriveSyncService(ctx).resumeBinding(input.bindingId),
    },
    removeBinding: {
      kind: "invoke",
      channel: "synapse:drive-sync:bindings:remove",
      request: bindingIdSchema,
      handler: async (ctx, input) => resolveDriveSyncService(ctx).removeBinding(input.bindingId),
    },
  },
}

function resolveDriveSyncService(ctx: { readonly resolve: <T>(serviceId: string) => T }): DriveSyncService {
  return ctx.resolve<DriveSyncService>("drive-sync.service")
}
```

Register `drive-sync.service` in `desktop/electron/runtime/service-registry/registry.ts` using the existing registry style. Construct it with the global DataRepository:

```ts
import type { DataRepository } from "../data-repo/types"
import { DriveSyncService } from "../../services/drive-sync-service"
import type {
  DriveSyncBindingEntryV1,
  DriveSyncConflictEntryV1,
  DriveSyncOperationEntryV1,
} from "../data-repo/schemas/drive-sync"

const dataRepository = registry.get<DataRepository>("core.data-repository")
registry.register("drive-sync.service", new DriveSyncService({
  bindings: dataRepository.namespace<DriveSyncBindingEntryV1>("app.drive-sync.bindings"),
  conflicts: dataRepository.namespace<DriveSyncConflictEntryV1>("app.drive-sync.conflicts"),
  operations: dataRepository.namespace<DriveSyncOperationEntryV1>("app.drive-sync.operations"),
}))
```

If the service registry API uses a method name other than `register`, follow the exact pattern used by nearby services in `desktop/electron/runtime/service-registry/registry.ts`.

- [ ] **Step 4: Register IPC module**

Modify `desktop/electron/bootstrap/ipc-registry.ts`:

```ts
import { driveSyncIpcModule } from "../modules/drive-sync/ipc"
```

Add:

```ts
registry.register(driveSyncIpcModule, ctx)
```

Also add `driveSyncIpcModule` to `registeredIpcModules`.

- [ ] **Step 5: Add preload and bridge types**

In `desktop/electron/preload.ts`, add channels and exposed methods following the existing `account`/`git` pattern:

```ts
driveSync: {
  getSnapshot: invoke("synapse:drive-sync:snapshot:get"),
  createBinding: invoke("synapse:drive-sync:bindings:create"),
  pauseBinding: invoke("synapse:drive-sync:bindings:pause"),
  resumeBinding: invoke("synapse:drive-sync:bindings:resume"),
  removeBinding: invoke("synapse:drive-sync:bindings:remove"),
}
```

In `desktop/src/types/bridge.ts`, add:

```ts
driveSync: {
  getSnapshot: () => Promise<DriveSyncSnapshotDto>
  createBinding: (input: {
    driveItemId: string
    driveItemName: string
    kind: "file" | "folder"
    localPath: string
    remoteCursor?: string | null
  }) => Promise<DriveSyncBindingDto>
  pauseBinding: (input: { bindingId: string }) => Promise<DriveSyncBindingDto>
  resumeBinding: (input: { bindingId: string }) => Promise<DriveSyncBindingDto>
  removeBinding: (input: { bindingId: string }) => Promise<DriveSyncBindingDto>
}
```

Import `DriveSyncBindingDto` and `DriveSyncSnapshotDto` from `@synapse/shared`.

- [ ] **Step 6: Add preload test assertions**

In `desktop/electron/__tests__/preload.test.ts`, add calls:

```ts
await bridge.driveSync.getSnapshot()
await bridge.driveSync.createBinding({
  driveItemId: "item-1",
  driveItemName: "Docs",
  kind: "folder",
  localPath: "/tmp/Docs",
  remoteCursor: null,
})
await bridge.driveSync.pauseBinding({ bindingId: "binding-1" })
await bridge.driveSync.resumeBinding({ bindingId: "binding-1" })
await bridge.driveSync.removeBinding({ bindingId: "binding-1" })
```

Assert expected IPC channel names according to the test's current mock style.

- [ ] **Step 7: Run IPC and preload tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/modules/drive-sync/__tests__/ipc.test.ts desktop/electron/__tests__/preload.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/modules/drive-sync desktop/electron/services/drive-sync-service-instance.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/electron/__tests__/preload.test.ts
git commit -m "feat: expose drive sync ipc shell"
```

---

## Task 8: Renderer Status Surfaces

**Files:**
- Modify: `desktop/src/modules/drive/index.tsx`
- Modify: `desktop/src/modules/drive/__tests__/drive-module.test.tsx`
- Modify: existing app shell status component found with `rg "SyncStatusChip|repository.syncSnapshot|status center" desktop/src/app-shell`
- Add or modify corresponding shell test.

- [ ] **Step 1: Write failing Drive row status test**

In `desktop/src/modules/drive/__tests__/drive-module.test.tsx`, mock `window.synapse.driveSync.getSnapshot` to return one binding:

```ts
driveSync: {
  getSnapshot: vi.fn(async () => ({
    bindings: [{
      id: "binding-1",
      driveItemId: "item-1",
      driveItemName: "Docs",
      kind: "folder",
      localPath: "/tmp/Docs",
      status: "active",
      remoteCursor: null,
      createdAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
      lastSyncedAt: null,
    }],
    conflicts: [],
    operations: [],
    summary: {
      activeBindingCount: 1,
      runningOperationCount: 0,
      conflictCount: 0,
      errorCount: 0,
    },
  })),
  pauseBinding: vi.fn(),
  resumeBinding: vi.fn(),
  removeBinding: vi.fn(),
  createBinding: vi.fn(),
}
```

Assert the row for item `item-1` shows `已同步` or `同步` status and exposes `同步设置`.

- [ ] **Step 2: Run Drive module test and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/drive/__tests__/drive-module.test.tsx
```

Expected: FAIL because Drive module does not read sync snapshot.

- [ ] **Step 3: Add Drive snapshot state**

In `desktop/src/modules/drive/index.tsx`, add state:

```ts
const [syncSnapshot, setSyncSnapshot] = useState<DriveSyncSnapshotDto | null>(null)
```

Import `DriveSyncSnapshotDto` from `@synapse/shared`.

Load it near the Drive data load path:

```ts
const loadDriveSyncSnapshot = useCallback(async () => {
  try {
    const bridge = requireSynapseBridge()
    setSyncSnapshot(await bridge.driveSync.getSnapshot())
  } catch {
    setSyncSnapshot(null)
  }
}, [])
```

Call it on mount and after Drive reloads:

```ts
useEffect(() => {
  void loadDriveSyncSnapshot()
}, [loadDriveSyncSnapshot])
```

Build lookup:

```ts
const syncBindingByItemId = useMemo(() => {
  const map = new Map<string, DriveSyncBindingDto>()
  for (const binding of syncSnapshot?.bindings ?? []) {
    map.set(binding.driveItemId, binding)
  }
  return map
}, [syncSnapshot])
```

- [ ] **Step 4: Add minimal row actions**

Where row actions are built, add:

```tsx
const syncBinding = syncBindingByItemId.get(item.id)
```

For unbound items, show menu item label `同步到本机`. It can be disabled or open a placeholder dialog that says `暂未配置本地路径`; do not start filesystem operations in this task.

For bound items, show:

```tsx
<DropdownMenuItem>同步设置</DropdownMenuItem>
<DropdownMenuItem>{syncBinding.status === "paused" ? "继续同步" : "暂停同步"}</DropdownMenuItem>
<DropdownMenuItem>取消同步</DropdownMenuItem>
```

Use existing dropdown components and do not add custom colors or inline styles.

- [ ] **Step 5: Add global status entry**

Locate existing shell status component:

```bash
rg "SyncStatusChip|repository.syncSnapshot|status center" desktop/src/app-shell
```

Add a Drive sync entry that reads `bridge.driveSync.getSnapshot()` and renders:

```text
Drive 同步
```

Badge text rules:

- `有冲突` when `summary.conflictCount > 0`.
- `需要处理` when `summary.errorCount > 0`.
- `同步中` when `summary.runningOperationCount > 0`.
- `已同步` when at least one binding exists and no conflict/error/running operation exists.
- Hide or show `未同步` according to the existing shell density pattern.

- [ ] **Step 6: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/drive/__tests__/drive-module.test.tsx
```

Run the shell test file selected in Step 5.

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/modules/drive/index.tsx desktop/src/modules/drive/__tests__/drive-module.test.tsx desktop/src/app-shell
git commit -m "feat: show drive sync status shell"
```

---

## Task 9: Release Notes And Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add a concise user-facing note:

```md
- 云盘开始接入本地同步基础能力：文件列表和顶部状态区会显示同步状态入口，为后续文件/文件夹双向同步、冲突处理和恢复机制做准备。
```

- [ ] **Step 2: Run targeted verification**

Run:

```bash
pnpm --filter @synapse/shared test -- drive.test.ts
pnpm --filter @synapse/server test -- drive-change-log.spec.ts drive.controller.spec.ts drive.service.spec.ts drive-lifecycle.service.spec.ts
pnpm --filter @synapse/desktop test -- desktop/electron/runtime/data-repo/__tests__/schemas.test.ts desktop/electron/services/__tests__/drive-sync-service.test.ts desktop/electron/modules/drive-sync/__tests__/ipc.test.ts desktop/electron/__tests__/preload.test.ts desktop/src/modules/drive/__tests__/drive-module.test.tsx
pnpm --filter @synapse/server typecheck
pnpm --filter @synapse/desktop typecheck
```

Expected: all commands pass.

- [ ] **Step 3: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note drive sync groundwork"
```

---

## Self-Review Checklist

- Spec coverage:
  - Shared DTOs: Task 1.
  - Server Drive change cursor: Tasks 2 and 3.
  - Change emission from mutations: Task 4.
  - Desktop local state schemas: Task 5.
  - Desktop sync service shell: Task 6.
  - IPC/preload bridge: Task 7.
  - Drive row and top-level status entry: Task 8.
  - Release notes and verification: Task 9.
- Not covered by this Phase 1 plan:
  - Real local watcher.
  - Real upload/download sync execution.
  - Local trash implementation.
  - Conflict resolution file writes.
  - Folder tree initialization.
  - `.gitignore` import UI.
- Placeholder scan:
  - No placeholder markers or unnamed files.
  - Every task has concrete files, commands, and expected outcomes.
- Type consistency:
  - Shared DTO names match desktop service and bridge snippets.
  - Binding status values match DataRepository schemas.
  - Operation status values match shared DTOs and DataRepository schemas.
