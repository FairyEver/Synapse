# Drive Upload Conflict Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit same-name Drive upload conflict handling with replace, keep-both timestamp naming, and cancel behavior.

**Architecture:** Shared Drive contracts define conflict DTOs, conflict policies, and deterministic keep-both naming helpers. The server owns conflict inspection, final race-safe strategy validation, replacement sessions with staging storage keys, and quota-safe completion. Desktop inspects conflicts before local uploads, asks the user for a batch policy, and passes that policy through the existing account upload bridge.

**Tech Stack:** TypeScript, React, Electron IPC, NestJS, Prisma, Vitest, shadcn/Radix UI.

---

## File Structure

- Modify `shared/src/drive.ts`: add upload conflict DTOs, conflict strategy types, local upload conflict policy types, and keep-both filename helper.
- Modify `shared/src/drive.test.ts`: cover keep-both filename generation and type helper behavior.
- Modify `server/src/drive/drive-token.ts`: add replacement staging storage key helper.
- Modify `server/src/drive/drive.service.ts`: add conflict inspection, fail-on-conflict default behavior, keep-both final naming, replace upload sessions, and replacement-safe session failure.
- Modify `server/src/drive/drive.controller.ts`: add conflict inspection endpoint and schemas for upload conflict strategies.
- Modify `server/src/drive/drive.service.spec.ts`: cover service behavior for conflict inspection, keep-both, replace, share retention, publication snapshot retention, quota deltas, and failure safety.
- Modify `server/src/drive/drive.controller.spec.ts`: cover controller parsing and endpoint wiring for conflict inspection and conflict strategy payloads.
- Modify `desktop/src/types/bridge.ts`: expose new shared types on the bridge and extend upload methods.
- Modify `desktop/electron/modules/account/ipc.ts`: validate new conflict inspection and upload policy IPC payloads.
- Modify `desktop/electron/preload.ts` and `desktop/electron/generated/ipc-channels.generated.ts`: expose the new IPC method if generation is not automatic in this workflow.
- Modify `desktop/electron/services/account-service.ts`: call server conflict inspection, pass conflict strategies, and map local upload policies to top-level file upload calls.
- Modify `desktop/electron/services/__tests__/account-service.test.ts`: cover local upload policy mapping and no local path leakage.
- Modify `desktop/electron/modules/account/__tests__/ipc.test.ts`: cover IPC schema for conflict inspection and upload conflict policy.
- Modify `desktop/src/modules/drive/index.tsx`: inspect conflicts before upload, show conflict dialog, pass chosen policy, and keep upload result behavior stable.
- Modify `desktop/src/modules/drive/__tests__/drive-module.test.tsx`: cover file picker, drag upload, cancel, replace, keep-both, and batch conflict dialog behavior.
- Modify `desktop/src/types/bridge.ts` test coverage indirectly through existing preload and IPC tests.
- Modify `RELEASE_NOTES_PENDING.md`: add a user-facing note because upload behavior changes.

## Task 1: Shared Drive Contracts And Naming Helper

**Files:**
- Modify: `shared/src/drive.ts`
- Modify: `shared/src/drive.test.ts`

- [ ] **Step 1: Write failing shared tests**

Add these tests to `shared/src/drive.test.ts` near existing Drive URL helper tests:

```ts
import {
  buildDriveKeepBothName,
} from "./drive"

describe("buildDriveKeepBothName", () => {
  it("adds timestamp before normal extensions", () => {
    expect(buildDriveKeepBothName("report.md", "20260612_143000")).toBe("report_20260612_143000.md")
  })

  it("preserves compound archive extensions", () => {
    expect(buildDriveKeepBothName("archive.tar.gz", "20260612_143000")).toBe("archive_20260612_143000.tar.gz")
  })

  it("handles extensionless names", () => {
    expect(buildDriveKeepBothName("README", "20260612_143000")).toBe("README_20260612_143000")
  })

  it("adds numeric suffix when requested", () => {
    expect(buildDriveKeepBothName("report.md", "20260612_143000", 2)).toBe("report_20260612_143000_2.md")
  })
})
```

- [ ] **Step 2: Run shared tests and verify failure**

Run:

```bash
pnpm --filter @synapse/shared test -- drive.test.ts
```

Expected: FAIL because `buildDriveKeepBothName` is not exported.

- [ ] **Step 3: Add shared types and helper**

Add these exports to `shared/src/drive.ts` after `DriveFolderUploadPrepareResult`:

```ts
export type DriveUploadConflictEntryKind = "file" | "folder"

export interface DriveUploadConflictInspectEntry {
  readonly kind: DriveUploadConflictEntryKind
  readonly name: string
  readonly relativePath?: string | null
}

export interface DriveUploadConflictInspectInput {
  readonly parentId?: string | null
  readonly entries: readonly DriveUploadConflictInspectEntry[]
}

export type DriveUploadConflict =
  | {
      readonly kind: "file"
      readonly name: string
      readonly relativePath: string | null
      readonly existingItemId: string
      readonly existingUpdatedAt: string
      readonly replaceable: true
    }
  | {
      readonly kind: "folder"
      readonly name: string
      readonly relativePath: string | null
      readonly existingItemId: string
      readonly existingUpdatedAt: string
      readonly replaceable: false
      readonly reason: "folder-conflict"
    }

export interface DriveUploadConflictInspectResult {
  readonly conflicts: readonly DriveUploadConflict[]
}

export type DriveUploadConflictStrategy =
  | { readonly mode: "fail" }
  | { readonly mode: "replace"; readonly existingItemId: string }
  | { readonly mode: "keep-both" }

export type DriveLocalUploadConflictPolicy =
  | { readonly mode: "fail" }
  | { readonly mode: "replace-all"; readonly conflicts: readonly DriveUploadConflict[] }
  | { readonly mode: "keep-both-all"; readonly conflicts: readonly DriveUploadConflict[] }
```

Add this helper near other Drive helper functions in `shared/src/drive.ts`:

```ts
const DRIVE_COMPOUND_EXTENSIONS = [".tar.gz", ".tar.bz2", ".tar.xz"] as const

export function buildDriveKeepBothName(name: string, timestamp: string, suffix?: number): string {
  const trimmed = name.trim()
  const numericSuffix = suffix && suffix > 1 ? `_${suffix}` : ""
  const lowerName = trimmed.toLowerCase()
  const compoundExtension = DRIVE_COMPOUND_EXTENSIONS.find((extension) => lowerName.endsWith(extension))
  if (compoundExtension) {
    const base = trimmed.slice(0, -compoundExtension.length)
    return `${base}_${timestamp}${numericSuffix}${trimmed.slice(-compoundExtension.length)}`
  }
  const dotIndex = trimmed.lastIndexOf(".")
  if (dotIndex > 0) {
    return `${trimmed.slice(0, dotIndex)}_${timestamp}${numericSuffix}${trimmed.slice(dotIndex)}`
  }
  return `${trimmed}_${timestamp}${numericSuffix}`
}
```

- [ ] **Step 4: Run shared tests and verify pass**

Run:

```bash
pnpm --filter @synapse/shared test -- drive.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit shared contracts**

Run:

```bash
git add shared/src/drive.ts shared/src/drive.test.ts
git commit -m "feat(drive): add upload conflict contracts"
```

## Task 2: Server Conflict Inspection And Keep-Both Uploads

**Files:**
- Modify: `server/src/drive/drive.service.ts`
- Modify: `server/src/drive/drive.controller.ts`
- Modify: `server/src/drive/drive.service.spec.ts`
- Modify: `server/src/drive/drive.controller.spec.ts`

- [ ] **Step 1: Write failing service tests for inspection and keep-both**

Add these tests near the initial upload tests in `server/src/drive/drive.service.spec.ts`:

```ts
it("inspects same-name upload conflicts in the target folder", async () => {
  const prisma = createPrismaMemory()
  const service = new DriveService(prisma as unknown as PrismaService, storageMock)
  await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
  const existing = await createCompletedUpload(service, "user-1", {
    parentId: null,
    name: "report.md",
    mimeType: "text/markdown",
  })
  const folder = await service.createFolder("user-1", { parentId: null, name: "docs" })

  const result = await service.inspectUploadConflicts("user-1", {
    parentId: null,
    entries: [
      { kind: "file", name: "report.md" },
      { kind: "folder", name: "docs" },
      { kind: "file", name: "unique.md" },
    ],
  })

  expect(result.conflicts).toEqual([
    {
      kind: "file",
      name: "report.md",
      relativePath: null,
      existingItemId: existing.id,
      existingUpdatedAt: existing.updatedAt,
      replaceable: true,
    },
    {
      kind: "folder",
      name: "docs",
      relativePath: null,
      existingItemId: folder.id,
      existingUpdatedAt: folder.updatedAt,
      replaceable: false,
      reason: "folder-conflict",
    },
  ])
})

it("rejects same-name file uploads without an explicit conflict strategy", async () => {
  const prisma = createPrismaMemory()
  const service = new DriveService(prisma as unknown as PrismaService, storageMock)
  await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
  await createCompletedUpload(service, "user-1", {
    parentId: null,
    name: "report.md",
    mimeType: "text/markdown",
  })

  await expect(service.prepareUpload("user-1", {
    parentId: null,
    name: "report.md",
    size: "11",
    mimeType: "text/markdown",
    publicAppUrl: "https://synapse.test",
  })).rejects.toBeInstanceOf(BadRequestException)
})

it("keeps both same-name files with a timestamp-suffixed name", async () => {
  const prisma = createPrismaMemory()
  const service = new DriveService(prisma as unknown as PrismaService, storageMock)
  await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
  await createCompletedUpload(service, "user-1", {
    parentId: null,
    name: "report.md",
    mimeType: "text/markdown",
  })

  const prepared = await service.prepareUpload("user-1", {
    parentId: null,
    name: "report.md",
    size: "11",
    mimeType: "text/markdown",
    publicAppUrl: "https://synapse.test",
    conflictStrategy: { mode: "keep-both" },
  })

  expect(prepared.item.name).toMatch(/^report_20260607_120000(?:_\d+)?\.md$/u)
})
```

- [ ] **Step 2: Run server service tests and verify failure**

Run:

```bash
pnpm --filter @synapse/server test -- drive.service.spec.ts
```

Expected: FAIL because `inspectUploadConflicts` and `conflictStrategy` do not exist.

- [ ] **Step 3: Add controller schemas and endpoint**

In `server/src/drive/drive.controller.ts`, import the new shared types if needed and add schemas after `prepareFolderUploadSchema`:

```ts
const uploadConflictInspectSchema = z.object({
  parentId: z.string().nullable().optional(),
  entries: z.array(z.object({
    kind: z.enum(["file", "folder"]),
    name: z.string().trim().min(1).max(255),
    relativePath: z.string().trim().min(1).max(1024).nullable().optional(),
  }).strict()).min(1).max(1000),
}).strict()

const uploadConflictStrategySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("fail") }).strict(),
  z.object({ mode: z.literal("replace"), existingItemId: z.string().min(1) }).strict(),
  z.object({ mode: z.literal("keep-both") }).strict(),
])
```

Extend `prepareUploadSchema`:

```ts
const prepareUploadSchema = z.object({
  parentId: z.string().nullable().optional(),
  name: z.string().trim().min(1).max(255),
  size: z.string().regex(/^\d+$/u),
  mimeType: z.string().trim().max(255).nullable().optional(),
  conflictStrategy: uploadConflictStrategySchema.optional(),
}).strict()
```

Add an endpoint before `prepareUpload`:

```ts
@Post("/uploads/conflicts/inspect")
inspectUploadConflicts(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
  const parsed = parseBody(uploadConflictInspectSchema, body, "上传冲突检查请求无效。")
  return this.drive.inspectUploadConflicts(request.user!.id, {
    parentId: parsed.parentId ?? null,
    entries: parsed.entries.map((entry) => ({
      kind: entry.kind,
      name: entry.name,
      relativePath: entry.relativePath ?? null,
    })),
  })
}
```

Pass strategy into `prepareUpload`:

```ts
return this.drive.prepareUpload(request.user!.id, {
  parentId: parsed.parentId ?? null,
  name: parsed.name,
  size: parsed.size,
  mimeType: parsed.mimeType ?? null,
  publicAppUrl: resolveRequestPublicAppUrl(request),
  conflictStrategy: parsed.conflictStrategy ?? { mode: "fail" },
})
```

- [ ] **Step 4: Implement service inspection and keep-both naming**

In `server/src/drive/drive.service.ts`, import:

```ts
import {
  buildDriveKeepBothName,
  type DriveUploadConflictInspectInput,
  type DriveUploadConflictInspectResult,
  type DriveUploadConflictStrategy,
} from "@synapse/shared"
```

Add input types near existing Drive service input types:

```ts
type DrivePrepareUploadInput = {
  readonly parentId: string | null
  readonly name: string
  readonly size: string
  readonly mimeType: string | null
  readonly publicAppUrl: string
  readonly conflictStrategy?: DriveUploadConflictStrategy
}
```

Add methods in `DriveService` near `listItems`:

```ts
async inspectUploadConflicts(userId: string, input: DriveUploadConflictInspectInput): Promise<DriveUploadConflictInspectResult> {
  const parentId = input.parentId ?? null
  if (parentId) await this.requireOwnedFolder(userId, parentId)
  const conflicts = []
  for (const entry of input.entries) {
    const name = normalizeDriveName(entry.name)
    const existing = await this.prisma.driveItem.findFirst({
      where: { userId, parentId, name, deletedAt: null, storageStatus: DRIVE_STORAGE_STATUS.active },
      select: { id: true, type: true, updatedAt: true },
    })
    if (!existing) continue
    if (existing.type === DRIVE_ITEM_TYPE.file && entry.kind === "file") {
      conflicts.push({
        kind: "file" as const,
        name,
        relativePath: entry.relativePath ?? null,
        existingItemId: existing.id,
        existingUpdatedAt: existing.updatedAt.toISOString(),
        replaceable: true as const,
      })
      continue
    }
    conflicts.push({
      kind: "folder" as const,
      name,
      relativePath: entry.relativePath ?? null,
      existingItemId: existing.id,
      existingUpdatedAt: existing.updatedAt.toISOString(),
      replaceable: false as const,
      reason: "folder-conflict" as const,
    })
  }
  return { conflicts }
}

private async resolveUploadConflictName(userId: string, parentId: string | null, name: string, strategy: DriveUploadConflictStrategy): Promise<string> {
  const existing = await this.prisma.driveItem.findFirst({
    where: { userId, parentId, name, deletedAt: null, storageStatus: DRIVE_STORAGE_STATUS.active },
    select: { id: true, type: true },
  })
  if (!existing) return name
  if (existing.type !== DRIVE_ITEM_TYPE.file) throw new BadRequestException("目标位置已有同名文件夹。")
  if (strategy.mode === "keep-both") return this.createKeepBothDriveName(userId, parentId, name)
  throw new BadRequestException("目标位置已有同名文件。")
}

private async createKeepBothDriveName(userId: string, parentId: string | null, name: string, now = new Date()): Promise<string> {
  const timestamp = formatDriveKeepBothTimestamp(now)
  for (let suffix = 1; suffix <= 99; suffix += 1) {
    const candidate = buildDriveKeepBothName(name, timestamp, suffix)
    const existing = await this.prisma.driveItem.findFirst({
      where: { userId, parentId, name: candidate, deletedAt: null },
      select: { id: true },
    })
    if (!existing) return candidate
  }
  throw new BadRequestException("无法生成可用文件名。")
}
```

Add a helper outside the class:

```ts
function formatDriveKeepBothTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("")
}
```

Update `prepareUpload` before creating the item:

```ts
const strategy = input.conflictStrategy ?? { mode: "fail" as const }
const name = await this.resolveUploadConflictName(userId, input.parentId, normalizeDriveName(input.name), strategy)
```

- [ ] **Step 5: Add controller tests for inspection wiring**

In `server/src/drive/drive.controller.spec.ts`, add a test near upload controller tests:

```ts
it("parses upload conflict inspection requests", async () => {
  drive.inspectUploadConflicts = vi.fn(async () => ({ conflicts: [] }))
  await controller.inspectUploadConflicts({
    parentId: "folder-1",
    entries: [{ kind: "file", name: "report.md", relativePath: null }],
  }, userRequest)

  expect(drive.inspectUploadConflicts).toHaveBeenCalledWith("user-1", {
    parentId: "folder-1",
    entries: [{ kind: "file", name: "report.md", relativePath: null }],
  })
})
```

Use the controller and request variable names that already exist in this spec file; if the file uses direct module handler calls, add the equivalent assertion to that local structure.

- [ ] **Step 6: Run server tests and verify pass for this task**

Run:

```bash
pnpm --filter @synapse/server test -- drive.service.spec.ts drive.controller.spec.ts
```

Expected: PASS for the new inspection and keep-both tests. Existing unrelated tests should remain unchanged.

- [ ] **Step 7: Commit server inspection and keep-both**

Run:

```bash
git add server/src/drive/drive.service.ts server/src/drive/drive.controller.ts server/src/drive/drive.service.spec.ts server/src/drive/drive.controller.spec.ts
git commit -m "feat(drive): inspect upload conflicts"
```

## Task 3: Server Replace Upload Sessions

**Files:**
- Modify: `server/src/drive/drive-token.ts`
- Modify: `server/src/drive/drive.service.ts`
- Modify: `server/src/drive/drive.service.spec.ts`

- [ ] **Step 1: Write failing replacement tests**

Add these tests near the upload tests in `server/src/drive/drive.service.spec.ts`:

```ts
it("replaces an existing file while keeping the item id and share", async () => {
  const prisma = createPrismaMemory()
  const replacementStorage: DriveStoragePort = {
    ...storageMock,
    headObject: vi.fn(async ({ key }: { key: string }) => ({ key, size: 20n, etag: "new-etag" })),
  }
  const service = new DriveService(prisma as unknown as PrismaService, replacementStorage)
  await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
  const existing = await createCompletedUpload(service, "user-1", {
    parentId: null,
    name: "report.md",
    mimeType: "text/markdown",
  })
  const share = await service.createShare("user-1", existing.id, "https://synapse.test")

  const prepared = await service.prepareUpload("user-1", {
    parentId: null,
    name: "report.md",
    size: "20",
    mimeType: "text/markdown",
    publicAppUrl: "https://synapse.test",
    conflictStrategy: { mode: "replace", existingItemId: existing.id },
  })
  const completed = await service.completeUpload("user-1", prepared.sessionId)

  expect(prepared.item.id).toBe(existing.id)
  expect(completed.id).toBe(existing.id)
  expect(completed.size).toBe("20")
  expect(await service.resolvePublicShareAccess({ shareId: share.shareId, password: share.password ?? undefined }))
    .toMatchObject({ item: expect.objectContaining({ id: existing.id, size: 20n }) })
  const usage = await prisma.driveUsage.findUniqueOrThrow({ where: { userId: "user-1" } })
  expect(usage.usedBytes).toBe(20n)
  expect(usage.reservedBytes).toBe(0n)
})

it("does not update publication deployments when replacing a source file", async () => {
  const prisma = createPrismaMemory()
  const service = new DriveService(prisma as unknown as PrismaService, storageMock)
  await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
  const existing = await createCompletedUpload(service, "user-1", {
    parentId: null,
    name: "page.html",
    mimeType: "text/html",
  })
  const publication = await service.publishPage("user-1", existing.id, "https://synapse.test")
  const originalDeploymentId = publication.currentDeploymentId

  const prepared = await service.prepareUpload("user-1", {
    parentId: null,
    name: "page.html",
    size: "11",
    mimeType: "text/html",
    publicAppUrl: "https://synapse.test",
    conflictStrategy: { mode: "replace", existingItemId: existing.id },
  })
  await service.completeUpload("user-1", prepared.sessionId)
  const publications = await service.listPublications("user-1", "https://synapse.test")

  expect(publications.find((item) => item.id === publication.id)?.currentDeploymentId).toBe(originalDeploymentId)
})

it("keeps the old file active when replacement upload instruction creation fails", async () => {
  const prisma = createPrismaMemory()
  const failingStorage: DriveStoragePort = {
    ...storageMock,
    createUploadInstruction: vi.fn(async () => {
      throw new Error("storage unavailable")
    }),
  }
  const service = new DriveService(prisma as unknown as PrismaService, failingStorage)
  await prisma.user.create({ data: { id: "user-1", email: "user@example.com", passwordHash: "hash" } })
  const existing = await createCompletedUpload(new DriveService(prisma as unknown as PrismaService, storageMock), "user-1", {
    parentId: null,
    name: "report.md",
    mimeType: "text/markdown",
  })

  await expect(service.prepareUpload("user-1", {
    parentId: null,
    name: "report.md",
    size: "20",
    mimeType: "text/markdown",
    publicAppUrl: "https://synapse.test",
    conflictStrategy: { mode: "replace", existingItemId: existing.id },
  })).rejects.toThrow("storage unavailable")

  await expect(service.getItem("user-1", existing.id)).resolves.toMatchObject({
    id: existing.id,
    storageStatus: "active",
    size: "11",
  })
})
```

- [ ] **Step 2: Run replacement tests and verify failure**

Run:

```bash
pnpm --filter @synapse/server test -- drive.service.spec.ts
```

Expected: FAIL because replacement strategy is not implemented.

- [ ] **Step 3: Add replacement storage key helper**

In `server/src/drive/drive-token.ts`, add:

```ts
export function driveReplacementStorageKeyForSession(input: { readonly itemId: string; readonly sessionId: string }): string {
  return `drive-replacements/${input.itemId}/${input.sessionId}`
}
```

Add a focused test in `server/src/drive/drive-token.spec.ts`:

```ts
it("builds replacement staging keys", () => {
  expect(driveReplacementStorageKeyForSession({ itemId: "item-1", sessionId: "session-1" }))
    .toBe("drive-replacements/item-1/session-1")
})
```

- [ ] **Step 4: Implement replacement prepare and completion**

In `server/src/drive/drive.service.ts`, import `driveReplacementStorageKeyForSession`.

Add a helper:

```ts
private async requireReplaceTarget(userId: string, parentId: string | null, name: string, existingItemId: string) {
  const item = await this.prisma.driveItem.findFirst({
    where: {
      id: existingItemId,
      userId,
      parentId,
      name,
      type: DRIVE_ITEM_TYPE.file,
      deletedAt: null,
      storageStatus: DRIVE_STORAGE_STATUS.active,
    },
    include: driveItemWithShares,
  })
  if (!item) throw new BadRequestException("要替换的文件不存在。")
  return item
}
```

In `prepareUpload`, branch before the normal create-item transaction:

```ts
if (strategy.mode === "replace") {
  return this.prepareReplacementUpload(userId, {
    parentId: input.parentId,
    name,
    requestedSize,
    mimeType: input.mimeType ?? null,
    existingItemId: strategy.existingItemId,
  })
}
```

Add `prepareReplacementUpload`:

```ts
private async prepareReplacementUpload(
  userId: string,
  input: {
    readonly parentId: string | null
    readonly name: string
    readonly requestedSize: bigint
    readonly mimeType: string | null
    readonly existingItemId: string
  },
): Promise<DriveUploadPrepareResult> {
  const target = await this.requireReplaceTarget(userId, input.parentId, input.name, input.existingItemId)
  const result = await this.prisma.$transaction(async (tx) => {
    const usage = await ensureUsage(tx, userId)
    if (usage.usedBytes + usage.reservedBytes + input.requestedSize > usage.quotaBytes) {
      throw new BadRequestException("云盘空间不足。")
    }
    const session = await tx.driveUploadSession.create({
      data: {
        userId,
        itemId: target.id,
        storageKey: `pending-replacement/${target.id}`,
        expectedName: input.name,
        expectedSize: input.requestedSize,
        expectedMime: input.mimeType,
        status: DRIVE_UPLOAD_STATUS.pending,
        credentialKind: "presigned_put",
        expiresAt: new Date(Date.now() + driveUploadUrlTtlSeconds * 1000),
      },
    })
    const storageKey = driveReplacementStorageKeyForSession({ itemId: target.id, sessionId: session.id })
    const updatedSession = await tx.driveUploadSession.update({
      where: { id: session.id },
      data: { storageKey },
    })
    await tx.driveUsage.update({
      where: { userId },
      data: { reservedBytes: { increment: input.requestedSize } },
    })
    return { item: target, session: updatedSession }
  })

  try {
    const upload = await this.storage.createUploadInstruction({
      key: result.session.storageKey,
      contentType: input.mimeType ?? undefined,
    })
    return {
      sessionId: result.session.id,
      item: toDriveItemDto(result.item),
      upload: {
        method: upload.method,
        url: upload.url,
        expiresAt: upload.expiresAt.toISOString(),
        headers: upload.headers,
      },
    }
  } catch (error) {
    await this.failUploadSession(userId, result.session.id, result.session.itemId, result.session.expectedSize, DRIVE_UPLOAD_STATUS.failed, new Date(), {
      preserveItem: true,
    })
    throw error
  }
}
```

Update `completeUpload` transaction to detect replacement:

```ts
const oldStorageKey = session.item.storageKey
const replacingExistingObject = oldStorageKey !== null && oldStorageKey !== session.storageKey && session.item.storageStatus === DRIVE_STORAGE_STATUS.active
```

Inside the transaction, for replacement use:

```ts
await tx.driveUsage.update({
  where: { userId },
  data: replacingExistingObject
    ? {
        reservedBytes: { decrement: session.expectedSize },
        usedBytes: { increment: session.expectedSize - session.item.size },
      }
    : {
        reservedBytes: { decrement: session.expectedSize },
        usedBytes: { increment: session.expectedSize },
      },
})
return tx.driveItem.update({
  where: { id: session.itemId },
  data: {
    storageKey: session.storageKey,
    size: session.expectedSize,
    mimeType: session.expectedMime,
    storageStatus: DRIVE_STORAGE_STATUS.active,
    uploadStatus: DRIVE_UPLOAD_STATUS.completed,
  },
  include: driveItemWithShares,
})
```

After the transaction, if `replacingExistingObject && oldStorageKey`, call `this.storage.deleteObject(oldStorageKey)` inside a `try/catch` that logs `logger.warn("Drive replacement old object cleanup failed.", { itemId: item.id })`.

- [ ] **Step 5: Make upload session failure replacement-safe**

Change `failUploadSession` signature:

```ts
private async failUploadSession(
  userId: string,
  sessionId: string,
  itemId: string,
  expectedSize: bigint,
  status: string,
  now = new Date(),
  options: { readonly preserveItem?: boolean } = {},
): Promise<void> {
  const mutations = [
    this.prisma.driveUploadSession.update({
      where: { id: sessionId },
      data: { status, failedAt: now },
    }),
    this.prisma.driveUsage.update({
      where: { userId },
      data: { reservedBytes: { decrement: expectedSize } },
    }),
  ]
  if (!options.preserveItem) {
    mutations.splice(1, 0, this.prisma.driveItem.update({
      where: { id: itemId },
      data: { storageStatus: DRIVE_STORAGE_STATUS.failed, uploadStatus: status },
    }))
  }
  await this.prisma.$transaction(mutations)
}
```

When expiring sessions, preserve active replacement targets:

```ts
const sessions = await this.prisma.driveUploadSession.findMany({
  where: { status: DRIVE_UPLOAD_STATUS.pending, expiresAt: { lte: now } },
  include: { item: { select: { storageStatus: true, storageKey: true } } },
})
for (const session of sessions) {
  const preserveItem = session.item.storageStatus === DRIVE_STORAGE_STATUS.active && session.item.storageKey !== session.storageKey
  await this.failUploadSession(session.userId, session.id, session.itemId, session.expectedSize, DRIVE_UPLOAD_STATUS.expired, now, { preserveItem })
}
```

Update `cancelUpload` with the same replacement-safe detection:

```ts
const session = await this.prisma.driveUploadSession.findFirst({
  where: { id: sessionId, userId, status: DRIVE_UPLOAD_STATUS.pending },
  include: { item: { select: { storageStatus: true, storageKey: true } } },
})
if (!session) throw new NotFoundException("上传会话不存在。")
const preserveItem = session.item.storageStatus === DRIVE_STORAGE_STATUS.active && session.item.storageKey !== session.storageKey
await this.failUploadSession(userId, session.id, session.itemId, session.expectedSize, DRIVE_UPLOAD_STATUS.cancelled, new Date(), { preserveItem })
return { ok: true }
```

- [ ] **Step 6: Run server replacement tests**

Run:

```bash
pnpm --filter @synapse/server test -- drive.service.spec.ts drive-token.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit replacement sessions**

Run:

```bash
git add server/src/drive/drive-token.ts server/src/drive/drive-token.spec.ts server/src/drive/drive.service.ts server/src/drive/drive.service.spec.ts
git commit -m "feat(drive): replace files during upload"
```

## Task 4: Desktop Account Bridge And IPC Policy

**Files:**
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/modules/account/ipc.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts`
- Modify: `desktop/electron/services/account-service.ts`
- Modify: `desktop/electron/services/__tests__/account-service.test.ts`
- Modify: `desktop/electron/modules/account/__tests__/ipc.test.ts`
- Modify: `desktop/electron/__tests__/preload.test.ts`

- [ ] **Step 1: Write failing account service tests**

Add tests near the local upload tests in `desktop/electron/services/__tests__/account-service.test.ts`:

```ts
it("passes replace conflict strategy for matching local file conflicts", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-replace-"))
  const filePath = path.join(dir, "report.md")
  await writeFile(filePath, "hello")
  const fetch = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof globalThis.fetch
  const { service } = await createTestAccountService({ fetch })
  vi.spyOn(service, "prepareDriveUpload").mockResolvedValue(preparedFile("session-file-1", "https://upload.example.test/file-1"))
  vi.spyOn(service, "completeDriveUpload").mockResolvedValue(driveItem({ id: "existing-1", name: "report.md", size: "5" }))
  vi.spyOn(service, "cancelDriveUpload").mockResolvedValue({ ok: true })

  await service.uploadDriveLocalItems({
    parentId: null,
    conflictPolicy: {
      mode: "replace-all",
      conflicts: [{
        kind: "file",
        name: "report.md",
        relativePath: null,
        existingItemId: "existing-1",
        existingUpdatedAt: "2026-06-09T00:00:00.000Z",
        replaceable: true,
      }],
    },
    items: [{ kind: "file", path: filePath, name: "report.md", mimeType: "text/markdown" }],
  })

  expect(service.prepareDriveUpload).toHaveBeenCalledWith({
    parentId: null,
    name: "report.md",
    size: "5",
    mimeType: "text/markdown",
    conflictStrategy: { mode: "replace", existingItemId: "existing-1" },
  })
})

it("passes keep-both conflict strategy for matching local file conflicts", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-keep-both-"))
  const filePath = path.join(dir, "report.md")
  await writeFile(filePath, "hello")
  const fetch = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof globalThis.fetch
  const { service } = await createTestAccountService({ fetch })
  vi.spyOn(service, "prepareDriveUpload").mockResolvedValue(preparedFile("session-file-1", "https://upload.example.test/file-1"))
  vi.spyOn(service, "completeDriveUpload").mockResolvedValue(driveItem({ id: "new-1", name: "report_20260612_143000.md", size: "5" }))
  vi.spyOn(service, "cancelDriveUpload").mockResolvedValue({ ok: true })

  await service.uploadDriveLocalItems({
    parentId: null,
    conflictPolicy: {
      mode: "keep-both-all",
      conflicts: [{
        kind: "file",
        name: "report.md",
        relativePath: null,
        existingItemId: "existing-1",
        existingUpdatedAt: "2026-06-09T00:00:00.000Z",
        replaceable: true,
      }],
    },
    items: [{ kind: "file", path: filePath, name: "report.md", mimeType: "text/markdown" }],
  })

  expect(service.prepareDriveUpload).toHaveBeenCalledWith({
    parentId: null,
    name: "report.md",
    size: "5",
    mimeType: "text/markdown",
    conflictStrategy: { mode: "keep-both" },
  })
})
```

- [ ] **Step 2: Run account service tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/account-service.test.ts
```

Expected: FAIL because `conflictPolicy` and `conflictStrategy` are not supported.

- [ ] **Step 3: Extend bridge types**

In `desktop/src/types/bridge.ts`, import the shared types:

```ts
import type {
  DriveLocalUploadConflictPolicy,
  DriveUploadConflictInspectInput,
  DriveUploadConflictInspectResult,
  DriveUploadConflictStrategy,
} from "@synapse/shared"
```

Extend account methods:

```ts
inspectDriveUploadConflicts: (input: DriveUploadConflictInspectInput) => Promise<DriveUploadConflictInspectResult>
prepareDriveUpload: (input: {
  parentId?: string | null
  name: string
  size: string
  mimeType?: string | null
  conflictStrategy?: DriveUploadConflictStrategy
}) => Promise<DriveUploadPrepareResult>
uploadDriveLocalItems: (input: DriveLocalUploadRequest & { conflictPolicy?: DriveLocalUploadConflictPolicy }) => Promise<DriveLocalUploadResult>
```

Extend `DriveLocalUploadRequest`:

```ts
export type DriveLocalUploadRequest = {
  readonly parentId?: string | null
  readonly conflictPolicy?: DriveLocalUploadConflictPolicy
  readonly items: readonly DriveLocalUploadItem[]
}
```

- [ ] **Step 4: Add IPC schemas and preload method**

In `desktop/electron/modules/account/ipc.ts`, add schemas:

```ts
const driveUploadConflictSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    name: z.string(),
    relativePath: z.string().nullable(),
    existingItemId: z.string(),
    existingUpdatedAt: z.string(),
    replaceable: z.literal(true),
  }).strict(),
  z.object({
    kind: z.literal("folder"),
    name: z.string(),
    relativePath: z.string().nullable(),
    existingItemId: z.string(),
    existingUpdatedAt: z.string(),
    replaceable: z.literal(false),
    reason: z.literal("folder-conflict"),
  }).strict(),
])

const driveUploadConflictPolicySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("fail") }).strict(),
  z.object({ mode: z.literal("replace-all"), conflicts: z.array(driveUploadConflictSchema) }).strict(),
  z.object({ mode: z.literal("keep-both-all"), conflicts: z.array(driveUploadConflictSchema) }).strict(),
])

const driveUploadConflictInspectSchema = z.object({
  parentId: z.string().nullable().optional(),
  entries: z.array(z.object({
    kind: z.enum(["file", "folder"]),
    name: z.string().min(1),
    relativePath: z.string().nullable().optional(),
  })).min(1),
}).strict()
```

Add `conflictStrategy` to `drivePrepareUploadSchema` and `conflictPolicy` to `driveLocalUploadRequestSchema`.

Add IPC method:

```ts
inspectDriveUploadConflicts: {
  kind: "invoke",
  channel: "synapse:account:drive:uploads:conflicts:inspect",
  request: driveUploadConflictInspectSchema,
  response: z.object({ conflicts: z.array(driveUploadConflictSchema) }),
  handler: async (_ctx, input) => accountService.inspectDriveUploadConflicts(driveUploadConflictInspectSchema.parse(input)),
},
```

In `desktop/electron/preload.ts`, add channel mapping and bridge method:

```ts
"inspectDriveUploadConflicts": "synapse:account:drive:uploads:conflicts:inspect",
```

and:

```ts
inspectDriveUploadConflicts: invoke(IPC_CHANNELS.account.inspectDriveUploadConflicts),
```

If `desktop/electron/generated/ipc-channels.generated.ts` is generated by a script in this repo, run the generation command used by `pnpm --filter @synapse/desktop run typecheck`; otherwise add the corresponding generated constant manually.

- [ ] **Step 5: Implement AccountService methods and policy mapping**

In `desktop/electron/services/account-service.ts`, extend `prepareDriveUpload` body:

```ts
...(input.conflictStrategy ? { conflictStrategy: input.conflictStrategy } : {}),
```

Add:

```ts
async inspectDriveUploadConflicts(input: DriveUploadConflictInspectInput): Promise<DriveUploadConflictInspectResult> {
  return this.requestAuthenticatedJson<DriveUploadConflictInspectResult>("POST", `${apiBaseUrl()}/drive/uploads/conflicts/inspect`, {
    parentId: input.parentId ?? null,
    entries: input.entries.map((entry) => ({
      kind: entry.kind,
      name: entry.name,
      relativePath: entry.relativePath ?? null,
    })),
  }, "上传冲突检查失败。")
}
```

Add helper functions near local upload helpers:

```ts
function conflictForLocalFile(policy: DriveLocalUploadConflictPolicy | undefined, name: string, relativePath: string | null) {
  const conflicts = policy?.mode === "replace-all" || policy?.mode === "keep-both-all" ? policy.conflicts : []
  return conflicts.find((conflict) => conflict.kind === "file"
    && conflict.name === name
    && (conflict.relativePath ?? null) === relativePath)
}

function strategyForLocalFile(policy: DriveLocalUploadConflictPolicy | undefined, name: string, relativePath: string | null): DriveUploadConflictStrategy | undefined {
  const conflict = conflictForLocalFile(policy, name, relativePath)
  if (!conflict) return { mode: "fail" }
  if (policy?.mode === "replace-all" && conflict.replaceable) return { mode: "replace", existingItemId: conflict.existingItemId }
  if (policy?.mode === "keep-both-all") return { mode: "keep-both" }
  return { mode: "fail" }
}
```

Update `uploadDriveLocalFile` signature to accept `policy`, and pass:

```ts
conflictStrategy: strategyForLocalFile(policy, item.name, null),
```

For folder uploads in this first implementation, do not map nested file conflicts. A folder upload either creates a new root folder or is blocked by a same-name root folder conflict. Keep calls to `prepareDriveFolderUpload` unchanged except for carrying `conflictPolicy` through the local upload request type. Nested folder merge and nested file replacement are not part of this plan.

- [ ] **Step 6: Run desktop IPC and account tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/account-service.test.ts electron/modules/account/__tests__/ipc.test.ts electron/__tests__/preload.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit desktop bridge**

Run:

```bash
git add desktop/src/types/bridge.ts desktop/electron/modules/account/ipc.ts desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts desktop/electron/services/account-service.ts desktop/electron/services/__tests__/account-service.test.ts desktop/electron/modules/account/__tests__/ipc.test.ts desktop/electron/__tests__/preload.test.ts
git commit -m "feat(drive): pass upload conflict policies"
```

## Task 5: Renderer Conflict Dialog And Upload Flow

**Files:**
- Modify: `desktop/src/modules/drive/index.tsx`
- Modify: `desktop/src/modules/drive/__tests__/drive-module.test.tsx`

- [ ] **Step 1: Write failing renderer tests**

Add tests in `desktop/src/modules/drive/__tests__/drive-module.test.tsx` near existing upload tests:

```ts
it("asks before replacing a same-name selected file", async () => {
  mocks.inspectDriveUploadConflicts.mockResolvedValue({
    conflicts: [{
      kind: "file",
      name: "report.md",
      relativePath: null,
      existingItemId: "existing-1",
      existingUpdatedAt: "2026-06-09T00:00:00.000Z",
      replaceable: true,
    }],
  })
  await render(<DriveModule />)
  const input = document.querySelector('input[type="file"]:not([webkitdirectory])')
  if (!(input instanceof HTMLInputElement)) throw new Error("File input not found")
  const file = new File(["report"], "report.md", { type: "text/markdown" })
  Object.defineProperty(input, "files", { configurable: true, value: [file] })

  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await flushPromises()
  })

  expect(document.body.textContent).toContain("已有同名文件")
  expect(mocks.uploadDriveLocalItems).not.toHaveBeenCalled()

  await clickButtonText("替换")

  expect(mocks.uploadDriveLocalItems).toHaveBeenCalledWith(expect.objectContaining({
    conflictPolicy: {
      mode: "replace-all",
      conflicts: expect.arrayContaining([expect.objectContaining({ existingItemId: "existing-1" })]),
    },
  }))
})

it("keeps both selected file conflicts", async () => {
  mocks.inspectDriveUploadConflicts.mockResolvedValue({
    conflicts: [{
      kind: "file",
      name: "report.md",
      relativePath: null,
      existingItemId: "existing-1",
      existingUpdatedAt: "2026-06-09T00:00:00.000Z",
      replaceable: true,
    }],
  })
  await render(<DriveModule />)
  const input = document.querySelector('input[type="file"]:not([webkitdirectory])')
  if (!(input instanceof HTMLInputElement)) throw new Error("File input not found")
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["report"], "report.md")] })

  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await flushPromises()
  })
  await clickButtonText("保留两者")

  expect(mocks.uploadDriveLocalItems).toHaveBeenCalledWith(expect.objectContaining({
    conflictPolicy: {
      mode: "keep-both-all",
      conflicts: expect.arrayContaining([expect.objectContaining({ name: "report.md" })]),
    },
  }))
})

it("cancels selected file upload conflicts without uploading", async () => {
  mocks.inspectDriveUploadConflicts.mockResolvedValue({
    conflicts: [{
      kind: "file",
      name: "report.md",
      relativePath: null,
      existingItemId: "existing-1",
      existingUpdatedAt: "2026-06-09T00:00:00.000Z",
      replaceable: true,
    }],
  })
  await render(<DriveModule />)
  const input = document.querySelector('input[type="file"]:not([webkitdirectory])')
  if (!(input instanceof HTMLInputElement)) throw new Error("File input not found")
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["report"], "report.md")] })

  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await flushPromises()
  })
  await clickButtonText("取消")

  expect(mocks.uploadDriveLocalItems).not.toHaveBeenCalled()
})
```

Update the test bridge mock setup to include:

```ts
inspectDriveUploadConflicts: mocks.inspectDriveUploadConflicts,
```

and default:

```ts
mocks.inspectDriveUploadConflicts.mockResolvedValue({ conflicts: [] })
```

- [ ] **Step 2: Run renderer tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/drive/__tests__/drive-module.test.tsx
```

Expected: FAIL because the conflict dialog and bridge call are not implemented.

- [ ] **Step 3: Add dialog state and conflict inspection to DriveModule**

In `desktop/src/modules/drive/index.tsx`, import shared types:

```ts
type DriveLocalUploadConflictPolicy,
type DriveUploadConflict,
```

Add state:

```ts
type DriveUploadConflictDialogState = {
  readonly request: DriveLocalUploadRequest
  readonly skipped: number
  readonly conflicts: readonly DriveUploadConflict[]
}

const [uploadConflictDialog, setUploadConflictDialog] = useState<DriveUploadConflictDialogState | null>(null)
```

In `runLocalUpload`, before `setUploadItemCount`:

```ts
const inspectResult = await requireSynapseBridge().account.inspectDriveUploadConflicts({
  parentId: request.parentId ?? null,
  entries: driveUploadConflictInspectEntries(request.items),
})
if (inspectResult.conflicts.length > 0) {
  setUploadConflictDialog({ request, skipped, conflicts: inspectResult.conflicts })
  return
}
await submitLocalUpload(request, skipped, { mode: "fail" })
```

Extract existing upload body into:

```ts
const submitLocalUpload = useCallback(async (
  request: DriveLocalUploadRequest,
  skipped: number,
  conflictPolicy: DriveLocalUploadConflictPolicy,
) => {
  setUploadItemCount(countDriveLocalUploadItems(request.items))
  const result = await requireSynapseBridge().account.uploadDriveLocalItems({ ...request, conflictPolicy })
  toast(uploadResultMessage(withSkipped(result, skipped)))
  await refreshCurrentItemsAfterUpload()
}, [refreshCurrentItemsAfterUpload])
```

Add helper:

```ts
function driveUploadConflictInspectEntries(items: readonly DriveLocalUploadItem[]) {
  return items.map((item) => item.kind === "file"
    ? { kind: "file" as const, name: item.name, relativePath: null }
    : { kind: "folder" as const, name: item.folderName, relativePath: null })
}
```

- [ ] **Step 4: Add the conflict dialog UI**

Render this near the existing dialogs inside `DriveModule`:

```tsx
<DriveUploadConflictDialog
  state={uploadConflictDialog}
  onOpenChange={(open) => {
    if (!open) setUploadConflictDialog(null)
  }}
  onCancel={() => setUploadConflictDialog(null)}
  onKeepBoth={() => {
    if (!uploadConflictDialog) return
    const current = uploadConflictDialog
    setUploadConflictDialog(null)
    void submitLocalUpload(current.request, current.skipped, {
      mode: "keep-both-all",
      conflicts: current.conflicts,
    })
  }}
  onReplace={() => {
    if (!uploadConflictDialog) return
    const current = uploadConflictDialog
    setUploadConflictDialog(null)
    void submitLocalUpload(current.request, current.skipped, {
      mode: "replace-all",
      conflicts: current.conflicts,
    })
  }}
/>
```

Add component:

```tsx
function DriveUploadConflictDialog({
  state,
  onOpenChange,
  onCancel,
  onKeepBoth,
  onReplace,
}: {
  readonly state: DriveUploadConflictDialogState | null
  readonly onOpenChange: (open: boolean) => void
  readonly onCancel: () => void
  readonly onKeepBoth: () => void
  readonly onReplace: () => void
}) {
  const conflicts = state?.conflicts ?? []
  const replaceableConflicts = conflicts.filter((conflict) => conflict.replaceable)
  const blocked = conflicts.length > 0 && replaceableConflicts.length !== conflicts.length
  const preview = conflicts.slice(0, 5)
  const remaining = Math.max(conflicts.length - preview.length, 0)
  const single = conflicts.length === 1
  return (
    <AlertDialog open={state !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{single ? "已有同名文件" : "发现同名文件"}</AlertDialogTitle>
          <AlertDialogDescription>
            {single ? `当前目录已有 ${conflicts[0]?.name ?? "同名文件"}。` : `有 ${conflicts.length} 个文件与当前目录内容重名。`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          {preview.map((conflict) => (
            <div key={`${conflict.kind}:${conflict.relativePath ?? conflict.name}`} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
              <span className="min-w-0 truncate">{conflict.relativePath ?? conflict.name}</span>
              <Badge variant={conflict.replaceable ? "secondary" : "outline"}>{conflict.replaceable ? "可替换" : "文件夹冲突"}</Badge>
            </div>
          ))}
          {remaining > 0 ? <p className="text-sm text-muted-foreground">另有 {remaining} 项</p> : null}
          {blocked ? <p className="text-sm text-muted-foreground">同名文件夹不能替换。</p> : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>取消</AlertDialogCancel>
          <Button type="button" variant="outline" onClick={onKeepBoth} disabled={blocked}>保留两者</Button>
          <AlertDialogAction onClick={onReplace} disabled={blocked}>替换</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

If `AlertDialogAction` does not support `disabled` cleanly in this component set, use a regular `Button` for the primary action inside `AlertDialogFooter` and keep the visual variant consistent.

- [ ] **Step 5: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/drive/__tests__/drive-module.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit renderer conflict dialog**

Run:

```bash
git add desktop/src/modules/drive/index.tsx desktop/src/modules/drive/__tests__/drive-module.test.tsx
git commit -m "feat(drive): confirm upload conflicts"
```

## Task 6: Release Notes And Full Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add a concise user-facing entry to `RELEASE_NOTES_PENDING.md`:

```md
- 云盘上传遇到同名文件时会先询问是替换原文件还是保留两者；替换会保持已有分享链接可用，保留两者会自动给新文件追加时间戳。
```

- [ ] **Step 2: Run focused test suite**

Run:

```bash
pnpm --filter @synapse/shared test -- drive.test.ts
pnpm --filter @synapse/server test -- drive.service.spec.ts drive.controller.spec.ts drive-token.spec.ts
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/account-service.test.ts electron/modules/account/__tests__/ipc.test.ts electron/__tests__/preload.test.ts src/modules/drive/__tests__/drive-module.test.tsx
```

Expected: all commands PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/shared run typecheck
```

Expected: all commands PASS. If a package has no `typecheck` script, record the package-specific message and run the closest existing verification script from that package's `package.json`.

- [ ] **Step 4: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 5: Final commit**

Run:

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note drive upload conflict handling"
```

- [ ] **Step 6: Final status check**

Run:

```bash
git status --short
```

Expected: no unstaged or uncommitted files from this implementation.

## Self-Review

- Spec coverage: The plan covers shared contracts, upload conflict inspection, keep-both timestamp naming, replacement while preserving item identity, share retention, publication snapshot retention, folder conflict blocking, desktop preflight dialog, IPC validation, release notes, and verification.
- Placeholder scan: No unresolved marker text or open-ended implementation placeholders remain. The one conditional note about generated IPC files gives an exact fallback action.
- Type consistency: `DriveUploadConflictStrategy`, `DriveLocalUploadConflictPolicy`, `DriveUploadConflictInspectInput`, and `DriveUploadConflictInspectResult` are introduced in Task 1 and reused consistently by server and desktop tasks.
