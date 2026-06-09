# Drive Drag Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drag-and-drop uploads to the Drive file list and move all local Drive uploads into one non-renderer-blocking main-process upload pipeline.

**Architecture:** Renderer code only collects selected or dropped local items, current `parentId`, and shows lightweight upload state. Account IPC validates and guards one `uploadDriveLocalItems` request, then `AccountService` runs the only prepare/read/PUT/complete upload pipeline using local file reads in the main process. Existing button uploads and new drag uploads both call the same bridge method.

**Tech Stack:** Electron IPC runtime, React, TypeScript, Zod, Vitest, Node `fs/promises`, Node `fs.createReadStream`, existing shadcn/Radix UI components.

---

## File Structure

- Modify `desktop/src/types/bridge.ts`
  - Add shared renderer-visible `DriveLocalUploadItem`, `DriveLocalUploadRequest`, and `DriveLocalUploadResult` types.
  - Add `account.uploadDriveLocalItems()`.
  - Add `account.filePathForDroppedFile()` so Drive extracts local file paths through the account bridge instead of Knowledge Base or Tools namespaces.
- Modify `desktop/electron/modules/account/ipc.ts`
  - Add Zod schemas for the local upload request/result.
  - Add guarded IPC method `uploadDriveLocalItems`.
  - Reuse `PermissionGuard` and `AuditSink` through `ctx.resolve`.
- Modify `desktop/electron/services/account-service.ts`
  - Add the single upload pipeline.
  - Add helpers for local path validation, safe relative paths, folder upload grouping, session cancellation, and stream-based PUT.
  - Keep existing prepare/complete methods as lower-level API calls.
- Modify `desktop/electron/preload.ts`
  - Expose the generated account bridge method after IPC generation.
- Modify `desktop/electron/generated/ipc-channels.generated.ts`
  - Regenerate with `pnpm --filter @synapse/desktop run generate:ipc`.
- Modify `desktop/src/modules/drive/index.tsx`
  - Replace old renderer upload functions with thin request builders.
  - Add drag overlay and lightweight upload state.
- Modify `desktop/src/modules/drive/__tests__/drive-module.test.tsx`
  - Update old upload test so it proves renderer no longer calls `file.arrayBuffer()`.
  - Add drag/drop and lightweight-state tests.
- Modify `desktop/electron/modules/account/__tests__/ipc.test.ts`
  - Add schema and guarded-handler tests.
- Modify `desktop/electron/services/__tests__/account-service.test.ts`
  - Add main-process pipeline tests.
- Modify `desktop/electron/__tests__/preload.test.ts`
  - Add bridge exposure test if generated preload coverage does not already catch the new method.
- Modify `RELEASE_NOTES_PENDING.md`
  - Add a user-facing note under `## 功能优化`.

## Task 1: Add Account IPC Types And Guarded Method

**Files:**
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/modules/account/ipc.ts`
- Modify: `desktop/electron/modules/account/__tests__/ipc.test.ts`

- [ ] **Step 1: Write failing IPC schema tests**

Add tests to `desktop/electron/modules/account/__tests__/ipc.test.ts`:

```ts
import { accountService } from "../../../services/account-service"

it("validates local drive upload requests", () => {
  const requestSchema = accountIpcModule.methods.uploadDriveLocalItems.request
  expect(requestSchema).toBeDefined()
  if (!requestSchema) throw new Error("expected local upload request schema")

  expect(requestSchema.parse({
    parentId: "folder-1",
    items: [
      { kind: "file", path: "/tmp/report.txt", name: "report.txt", mimeType: "text/plain" },
      {
        kind: "folder",
        folderName: "项目A",
        files: [
          { path: "/tmp/项目A/a.md", relativePath: "a.md", mimeType: "text/markdown" },
          { path: "/tmp/项目A/docs/b.md", relativePath: "docs/b.md", mimeType: null },
        ],
      },
    ],
  })).toMatchObject({
    parentId: "folder-1",
    items: [
      { kind: "file", name: "report.txt" },
      { kind: "folder", folderName: "项目A" },
    ],
  })

  expect(() => requestSchema.parse({
    parentId: null,
    items: [{
      kind: "folder",
      folderName: "bad",
      files: [{ path: "/tmp/bad.txt", relativePath: "../bad.txt" }],
    }],
  })).toThrow()
})

it("guards local drive upload file reads and cloud writes", async () => {
  const uploadDriveLocalItems = vi.fn().mockResolvedValue({
    completed: 1,
    failed: 0,
    skipped: 0,
  })
  const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
  const auditSink = { record: vi.fn() }
  const ctx = {
    moduleId: "account",
    resolve: (id: string) => {
      if (id === "core.permission-guard") return permissionGuard
      if (id === "core.audit-sink") return auditSink
      throw new Error(`unexpected service ${id}`)
    },
  }
  vi.mocked(accountService.uploadDriveLocalItems).mockImplementation(uploadDriveLocalItems)

  const handler = accountIpcModule.methods.uploadDriveLocalItems.handler
  await expect(handler(ctx, {
    parentId: null,
    items: [{ kind: "file", path: "/tmp/report.txt", name: "report.txt", mimeType: null }],
  })).resolves.toEqual({ completed: 1, failed: 0, skipped: 0 })

  expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
    action: "fs.read.outside-userdata",
    actor: { kind: "user" },
    resource: "/tmp/report.txt",
    context: { source: "account.driveLocalUpload.read" },
  }))
  expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
    action: "fs.write",
    actor: { kind: "user" },
    resource: "synapse-drive:local-upload",
    context: { source: "account.driveLocalUpload.write" },
  }))
  expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
    action: "fs.write",
    outcome: "allowed",
  }))
})
```

In the existing `vi.mock("../../../services/account-service", ...)` block, add:

```ts
uploadDriveLocalItems: async () => ({ completed: 0, failed: 0, skipped: 0 }),
```

- [ ] **Step 2: Run the failing IPC tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/account/__tests__/ipc.test.ts
```

Expected: FAIL because `uploadDriveLocalItems` does not exist on `accountIpcModule.methods`.

- [ ] **Step 3: Add bridge types**

In `desktop/src/types/bridge.ts`, add these exported types near the existing Drive imports/types:

```ts
export type DriveLocalUploadFileItem = {
  readonly kind: "file"
  readonly path: string
  readonly name: string
  readonly mimeType?: string | null
}

export type DriveLocalUploadFolderItem = {
  readonly kind: "folder"
  readonly folderName: string
  readonly files: Array<{
    readonly path: string
    readonly relativePath: string
    readonly mimeType?: string | null
  }>
}

export type DriveLocalUploadItem = DriveLocalUploadFileItem | DriveLocalUploadFolderItem

export type DriveLocalUploadRequest = {
  readonly parentId?: string | null
  readonly items: DriveLocalUploadItem[]
}

export type DriveLocalUploadResult = {
  readonly completed: number
  readonly failed: number
  readonly skipped: number
  readonly message?: string
}
```

Then add this to `SynapseBridge["account"]`:

```ts
uploadDriveLocalItems: (input: DriveLocalUploadRequest) => Promise<DriveLocalUploadResult>
filePathForDroppedFile: (file: File) => string | null
```

- [ ] **Step 4: Add IPC schemas and guarded method**

In `desktop/electron/modules/account/ipc.ts`, import security types:

```ts
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../runtime/security"
import { sanitizeError } from "../../services/error-sanitize"
```

Replace the existing `IpcModule` import with the combined import above.

Add schemas after `drivePreparedFileUploadSchema`:

```ts
const unsafeRelativePathSegmentPattern = /(^|\/)\.\.($|\/)|^\/|^[A-Za-z]:[\\/]/

const driveLocalUploadRelativePathSchema = z.string().min(1).refine(
  (value) => !unsafeRelativePathSegmentPattern.test(value) && !value.includes("\\"),
  "relativePath must be a safe slash-delimited relative path",
)

const driveLocalUploadFileItemSchema = z.object({
  kind: z.literal("file"),
  path: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().nullable().optional(),
})

const driveLocalUploadFolderItemSchema = z.object({
  kind: z.literal("folder"),
  folderName: z.string().min(1),
  files: z.array(z.object({
    path: z.string().min(1),
    relativePath: driveLocalUploadRelativePathSchema,
    mimeType: z.string().nullable().optional(),
  })).min(1),
})

const driveLocalUploadRequestSchema = z.object({
  parentId: z.string().nullable().optional(),
  items: z.array(z.discriminatedUnion("kind", [
    driveLocalUploadFileItemSchema,
    driveLocalUploadFolderItemSchema,
  ])).min(1),
})

const driveLocalUploadResultSchema = z.object({
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  message: z.string().optional(),
})
```

Add helper functions before `export const accountIpcModule`:

```ts
type DriveLocalUploadRequestForIpc = z.infer<typeof driveLocalUploadRequestSchema>

function driveLocalUploadPaths(request: DriveLocalUploadRequestForIpc): string[] {
  return request.items.flatMap((item) => (
    item.kind === "file"
      ? [item.path]
      : item.files.map((file) => file.path)
  ))
}

async function checkAccountPermission(options: {
  ctx: IpcHandlerContext
  action: PermissionAction
  resource: string
  source: string
}): Promise<void> {
  const actor = { kind: "user" } as const
  const permissionGuard = options.ctx.resolve<PermissionGuard>("core.permission-guard")
  const auditSink = options.ctx.resolve<AuditSink>("core.audit-sink")
  const permission = await permissionGuard.check({
    action: options.action,
    actor,
    resource: options.resource,
    context: { source: options.source },
  })
  if (!permission.allowed) {
    auditSink.record({
      action: options.action,
      actor,
      resource: options.resource,
      outcome: "denied",
      metadata: { source: options.source, reason: permission.reason, policyId: permission.policyId },
    })
    throw new Error(permission.reason)
  }
  auditSink.record({
    action: options.action,
    actor,
    resource: options.resource,
    outcome: "allowed",
    metadata: { source: options.source },
  })
}

async function runGuardedDriveLocalUpload<T>(options: {
  ctx: IpcHandlerContext
  request: DriveLocalUploadRequestForIpc
  run(): Promise<T>
}): Promise<T> {
  const auditSink = options.ctx.resolve<AuditSink>("core.audit-sink")
  const actor = { kind: "user" } as const
  for (const filePath of driveLocalUploadPaths(options.request)) {
    await checkAccountPermission({
      ctx: options.ctx,
      action: "fs.read.outside-userdata",
      resource: filePath,
      source: "account.driveLocalUpload.read",
    })
  }
  await checkAccountPermission({
    ctx: options.ctx,
    action: "fs.write",
    resource: "synapse-drive:local-upload",
    source: "account.driveLocalUpload.write",
  })
  try {
    return await options.run()
  } catch (error) {
    auditSink.record({
      action: "fs.write",
      actor,
      resource: "synapse-drive:local-upload",
      outcome: "failed",
      metadata: {
        source: "account.driveLocalUpload.write",
        errorName: error instanceof Error ? error.name : typeof error,
        error: sanitizeError(String(error)),
        errorLength: String(error).length,
      },
    })
    throw error
  }
}
```

Add method to `accountIpcModule.methods` after `uploadDrivePreparedFile`:

```ts
uploadDriveLocalItems: {
  kind: "invoke",
  channel: "synapse:account:drive:uploads:local-items",
  request: driveLocalUploadRequestSchema,
  response: driveLocalUploadResultSchema,
  handler: async (ctx, input) => {
    const request = driveLocalUploadRequestSchema.parse(input)
    return runGuardedDriveLocalUpload({
      ctx,
      request,
      run: () => accountService.uploadDriveLocalItems(request),
    })
  },
},
```

- [ ] **Step 5: Run IPC tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/account/__tests__/ipc.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/types/bridge.ts desktop/electron/modules/account/ipc.ts desktop/electron/modules/account/__tests__/ipc.test.ts
git commit -m "feat(drive): add guarded local upload ipc"
```

## Task 2: Implement The Single Main-Process Upload Pipeline

**Files:**
- Modify: `desktop/electron/services/account-service.ts`
- Modify: `desktop/electron/services/__tests__/account-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Add imports at the top of `desktop/electron/services/__tests__/account-service.test.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises"
```

Add these tests near the existing prepared upload test:

```ts
it("uploads local drive files from the main process without ArrayBuffer IPC bodies", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-file-"))
  const filePath = path.join(dir, "report.txt")
  await writeFile(filePath, "hello")

  const fetch = vi.fn(async (_url, init) => {
    expect(init?.method).toBe("PUT")
    expect(init?.headers).toMatchObject({ "Content-Type": "text/plain" })
    expect(init?.body).not.toBeInstanceOf(ArrayBuffer)
    return new Response(null, { status: 200 })
  }) as unknown as typeof globalThis.fetch

  const { service } = await createTestAccountService({ fetch })
  vi.spyOn(service, "prepareDriveUpload").mockResolvedValue({
    item: driveItem({ id: "file-1", name: "report.txt", size: "5" }),
    sessionId: "session-file-1",
    upload: {
      expiresAt: "2026-06-09T00:10:00.000Z",
      headers: { "Content-Type": "text/plain" },
      method: "PUT",
      url: "https://upload.example.test/file-1",
    },
  })
  vi.spyOn(service, "completeDriveUpload").mockResolvedValue(driveItem({ id: "file-1", name: "report.txt", size: "5" }))
  vi.spyOn(service, "cancelDriveUpload").mockResolvedValue({ ok: true })

  await expect(service.uploadDriveLocalItems({
    parentId: "folder-1",
    items: [{ kind: "file", path: filePath, name: "report.txt", mimeType: "text/plain" }],
  })).resolves.toEqual({ completed: 1, failed: 0, skipped: 0 })

  expect(service.prepareDriveUpload).toHaveBeenCalledWith({
    parentId: "folder-1",
    name: "report.txt",
    size: "5",
    mimeType: "text/plain",
  })
  expect(service.completeDriveUpload).toHaveBeenCalledWith("session-file-1")
  expect(service.cancelDriveUpload).not.toHaveBeenCalled()
})

it("uploads local drive folders with the selected folder name and relative manifest", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-folder-"))
  const docsDir = path.join(dir, "项目A", "docs")
  await mkdir(docsDir, { recursive: true })
  const firstPath = path.join(dir, "项目A", "a.md")
  const secondPath = path.join(docsDir, "b.md")
  await writeFile(firstPath, "alpha")
  await writeFile(secondPath, "beta")

  const fetch = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof globalThis.fetch
  const { service } = await createTestAccountService({ fetch })
  vi.spyOn(service, "prepareDriveFolderUpload").mockResolvedValue({
    root: driveItem({ id: "folder-root", name: "项目A", type: "folder", size: "0" }),
    entries: [
      preparedFolderEntry("a.md", "session-a", "https://upload.example.test/a"),
      preparedFolderEntry("docs/b.md", "session-b", "https://upload.example.test/b"),
    ],
  })
  vi.spyOn(service, "completeDriveUpload")
    .mockResolvedValueOnce(driveItem({ id: "a", name: "a.md", size: "5" }))
    .mockResolvedValueOnce(driveItem({ id: "b", name: "b.md", size: "4" }))
  vi.spyOn(service, "cancelDriveUpload").mockResolvedValue({ ok: true })

  await expect(service.uploadDriveLocalItems({
    parentId: null,
    items: [{
      kind: "folder",
      folderName: "项目A",
      files: [
        { path: firstPath, relativePath: "a.md", mimeType: "text/markdown" },
        { path: secondPath, relativePath: "docs/b.md", mimeType: null },
      ],
    }],
  })).resolves.toEqual({ completed: 2, failed: 0, skipped: 0 })

  expect(service.prepareDriveFolderUpload).toHaveBeenCalledWith({
    parentId: null,
    folderName: "项目A",
    files: [
      { relativePath: "a.md", size: "5", mimeType: "text/markdown" },
      { relativePath: "docs/b.md", size: "4", mimeType: null },
    ],
  })
})

it("continues local drive uploads after one file fails and cancels the failed session", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-partial-"))
  const firstPath = path.join(dir, "first.txt")
  const secondPath = path.join(dir, "second.txt")
  await writeFile(firstPath, "first")
  await writeFile(secondPath, "second")

  const fetch = vi.fn(async (url) => (
    String(url).includes("first")
      ? new Response("nope", { status: 500 })
      : new Response(null, { status: 200 })
  )) as unknown as typeof globalThis.fetch
  const { service } = await createTestAccountService({ fetch })
  vi.spyOn(service, "prepareDriveUpload")
    .mockResolvedValueOnce(preparedFile("session-first", "https://upload.example.test/first"))
    .mockResolvedValueOnce(preparedFile("session-second", "https://upload.example.test/second"))
  vi.spyOn(service, "completeDriveUpload").mockResolvedValue(driveItem({ id: "second", name: "second.txt", size: "6" }))
  vi.spyOn(service, "cancelDriveUpload").mockResolvedValue({ ok: true })

  await expect(service.uploadDriveLocalItems({
    parentId: null,
    items: [
      { kind: "file", path: firstPath, name: "first.txt", mimeType: null },
      { kind: "file", path: secondPath, name: "second.txt", mimeType: null },
    ],
  })).resolves.toMatchObject({ completed: 1, failed: 1, skipped: 0 })

  expect(service.cancelDriveUpload).toHaveBeenCalledWith("session-first")
  expect(service.completeDriveUpload).toHaveBeenCalledWith("session-second")
})

it("does not leak local paths in local upload summaries or logs", async () => {
  const missingPath = "/tmp/synapse-secret-folder/secret-token.txt"
  const { service } = await createTestAccountService()

  const result = await service.uploadDriveLocalItems({
    parentId: null,
    items: [{ kind: "file", path: missingPath, name: "secret-token.txt", mimeType: null }],
  })

  expect(result).toMatchObject({ completed: 0, failed: 0, skipped: 1 })
  expect(JSON.stringify(result)).not.toContain(missingPath)
  expect(JSON.stringify(accountLogger.warn.mock.calls)).not.toContain(missingPath)
})
```

Add helpers at the bottom of the test file:

```ts
function driveItem(overrides: Partial<DriveItemDto> = {}): DriveItemDto {
  return {
    id: overrides.id ?? "item-1",
    parentId: overrides.parentId ?? null,
    type: overrides.type ?? "file",
    name: overrides.name ?? "report.txt",
    size: overrides.size ?? "0",
    mimeType: overrides.mimeType ?? null,
    storageStatus: overrides.storageStatus ?? "active",
    shared: overrides.shared ?? false,
    activeShareId: overrides.activeShareId ?? null,
    createdAt: overrides.createdAt ?? "2026-06-09T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-09T00:00:00.000Z",
  }
}

function preparedFile(sessionId: string, url: string): DriveUploadPrepareResult {
  return {
    item: driveItem({ id: sessionId, name: `${sessionId}.txt`, size: "1" }),
    sessionId,
    upload: {
      expiresAt: "2026-06-09T00:10:00.000Z",
      headers: {},
      method: "PUT",
      url,
    },
  }
}

function preparedFolderEntry(relativePath: string, sessionId: string, url: string) {
  return {
    relativePath,
    sessionId,
    item: driveItem({ id: sessionId, name: path.basename(relativePath), size: "1" }),
    upload: {
      expiresAt: "2026-06-09T00:10:00.000Z",
      headers: {},
      method: "PUT" as const,
      url,
    },
  }
}
```

Also add type imports:

```ts
import type { DriveItemDto, DriveUploadPrepareResult } from "@synapse/shared"
```

- [ ] **Step 2: Run the failing service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/account-service.test.ts
```

Expected: FAIL because `uploadDriveLocalItems` is not implemented.

- [ ] **Step 3: Add service types and filesystem imports**

In `desktop/electron/services/account-service.ts`, add imports:

```ts
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
```

Add local types near existing account service types:

```ts
type DriveLocalUploadFileItem = {
  readonly kind: "file"
  readonly path: string
  readonly name: string
  readonly mimeType?: string | null
}

type DriveLocalUploadFolderItem = {
  readonly kind: "folder"
  readonly folderName: string
  readonly files: Array<{
    readonly path: string
    readonly relativePath: string
    readonly mimeType?: string | null
  }>
}

type DriveLocalUploadItem = DriveLocalUploadFileItem | DriveLocalUploadFolderItem

type DriveLocalUploadRequest = {
  readonly parentId?: string | null
  readonly items: DriveLocalUploadItem[]
}

type DriveLocalUploadResult = {
  readonly completed: number
  readonly failed: number
  readonly skipped: number
  readonly message?: string
}
```

- [ ] **Step 4: Implement the single upload pipeline**

Add methods to `AccountService` after `uploadDrivePreparedFile()`:

```ts
  async uploadDriveLocalItems(input: DriveLocalUploadRequest): Promise<DriveLocalUploadResult> {
    let completed = 0
    let failed = 0
    let skipped = 0
    let firstError: string | undefined

    for (const item of input.items) {
      if (item.kind === "file") {
        const result = await this.uploadDriveLocalFile(input.parentId ?? null, item)
        completed += result.completed
        failed += result.failed
        skipped += result.skipped
        firstError ??= result.message
        continue
      }

      const result = await this.uploadDriveLocalFolder(input.parentId ?? null, item)
      completed += result.completed
      failed += result.failed
      skipped += result.skipped
      firstError ??= result.message
    }

    return {
      completed,
      failed,
      skipped,
      ...(firstError ? { message: firstError } : {}),
    }
  }

  private async uploadDriveLocalFile(parentId: string | null, item: DriveLocalUploadFileItem): Promise<DriveLocalUploadResult> {
    const fileStat = await safeLocalFileStat(item.path)
    if (!fileStat?.isFile()) {
      logger.warn("Drive local upload skipped.", { operation: "uploadDriveLocalFile", reason: "not-file" })
      return { completed: 0, failed: 0, skipped: 1 }
    }

    const prepared = await this.prepareDriveUpload({
      parentId,
      name: item.name,
      size: String(fileStat.size),
      mimeType: item.mimeType ?? null,
    })

    try {
      await this.putPreparedUploadFromPath(prepared.upload, item.path)
      await this.completeDriveUpload(prepared.sessionId)
      return { completed: 1, failed: 0, skipped: 0 }
    } catch (error) {
      await this.cancelDriveUpload(prepared.sessionId).catch((cancelError) => {
        logger.warn("Drive local upload cancel failed.", {
          operation: "uploadDriveLocalFile",
          errorName: cancelError instanceof Error ? cancelError.name : typeof cancelError,
        })
      })
      return {
        completed: 0,
        failed: 1,
        skipped: 0,
        message: errorMessage(error, "上传失败"),
      }
    }
  }

  private async uploadDriveLocalFolder(parentId: string | null, item: DriveLocalUploadFolderItem): Promise<DriveLocalUploadResult> {
    const files: Array<{ path: string; relativePath: string; size: string; mimeType: string | null }> = []
    let skipped = 0

    for (const file of item.files) {
      if (!isSafeDriveRelativePath(file.relativePath)) {
        skipped += 1
        logger.warn("Drive local upload skipped.", { operation: "uploadDriveLocalFolder", reason: "invalid-relative-path" })
        continue
      }
      const fileStat = await safeLocalFileStat(file.path)
      if (!fileStat?.isFile()) {
        skipped += 1
        logger.warn("Drive local upload skipped.", { operation: "uploadDriveLocalFolder", reason: "not-file" })
        continue
      }
      files.push({
        path: file.path,
        relativePath: file.relativePath,
        size: String(fileStat.size),
        mimeType: file.mimeType ?? null,
      })
    }

    if (files.length === 0) return { completed: 0, failed: 0, skipped }

    const prepared = await this.prepareDriveFolderUpload({
      parentId,
      folderName: item.folderName,
      files: files.map((file) => ({
        relativePath: file.relativePath,
        size: file.size,
        mimeType: file.mimeType,
      })),
    })

    const preparedByPath = new Map(prepared.entries.map((entry) => [entry.relativePath, entry]))
    let completed = 0
    let failed = 0
    let firstError: string | undefined

    for (const file of files) {
      const preparedEntry = preparedByPath.get(file.relativePath)
      if (!preparedEntry) {
        failed += 1
        firstError ??= "上传文件不存在"
        continue
      }
      try {
        await this.putPreparedUploadFromPath(preparedEntry.upload, file.path)
        await this.completeDriveUpload(preparedEntry.sessionId)
        completed += 1
      } catch (error) {
        failed += 1
        firstError ??= errorMessage(error, "上传失败")
        await this.cancelDriveUpload(preparedEntry.sessionId).catch((cancelError) => {
          logger.warn("Drive local upload cancel failed.", {
            operation: "uploadDriveLocalFolder",
            errorName: cancelError instanceof Error ? cancelError.name : typeof cancelError,
          })
        })
      }
    }

    return {
      completed,
      failed,
      skipped,
      ...(firstError ? { message: firstError } : {}),
    }
  }

  private async putPreparedUploadFromPath(upload: DriveUploadPrepareResult["upload"], filePath: string): Promise<void> {
    const init: RequestInit & { duplex: "half" } = {
      method: upload.method,
      headers: upload.headers,
      body: createReadStream(filePath) as unknown as BodyInit,
      duplex: "half",
    }
    const response = await this.fetchImpl(upload.url, init)
    if (!response.ok) throw await createHttpError(upload.method, upload.url, response, "上传失败。")
  }
```

Add helpers near `errorMessage()`:

```ts
async function safeLocalFileStat(filePath: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(filePath)
  } catch {
    return null
  }
}

function isSafeDriveRelativePath(value: string): boolean {
  if (!value || value.includes("\\")) return false
  if (path.isAbsolute(value)) return false
  return value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
}
```

- [ ] **Step 5: Run service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/account-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/account-service.ts desktop/electron/services/__tests__/account-service.test.ts
git commit -m "feat(drive): upload local files from main process"
```

## Task 3: Regenerate IPC And Expose The Bridge

**Files:**
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts`
- Modify: `desktop/electron/__tests__/preload.test.ts`

- [ ] **Step 1: Run IPC generation**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Expected: `desktop/electron/generated/ipc-channels.generated.ts` includes:

```ts
"uploadDriveLocalItems": "synapse:account:drive:uploads:local-items"
```

- [ ] **Step 2: Expose preload method**

In `desktop/electron/preload.ts`, add this to the `account` bridge object near other Drive upload methods:

```ts
uploadDriveLocalItems: invoke(IPC_CHANNELS.account.uploadDriveLocalItems),
filePathForDroppedFile: (file: File) => webUtils.getPathForFile(file) || null,
```

- [ ] **Step 3: Add preload test**

In `desktop/electron/__tests__/preload.test.ts`, extend the `electronMock` object:

```ts
webUtils: {
  getPathForFile: vi.fn(() => ""),
},
```

Then expose it in `vi.mock("electron", ...)`:

```ts
webUtils: electronMock.webUtils,
```

Add an assertion near existing account upload bridge tests:

```ts
await bridge.account.uploadDriveLocalItems({
  parentId: null,
  items: [{ kind: "file", path: "/tmp/report.txt", name: "report.txt", mimeType: null }],
})
expect(ipcRenderer.invoke).toHaveBeenCalledWith(
  "synapse:account:drive:uploads:local-items",
  {
    parentId: null,
    items: [{ kind: "file", path: "/tmp/report.txt", name: "report.txt", mimeType: null }],
  },
)

const file = new File(["report"], "report.txt", { type: "text/plain" })
expect(bridge.account.filePathForDroppedFile(file)).toBe(null)
```

- [ ] **Step 4: Run preload and codegen checks**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/__tests__/preload.test.ts
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts desktop/electron/__tests__/preload.test.ts
git commit -m "feat(drive): expose local upload bridge"
```

## Task 4: Replace Renderer Upload Logic With Unified Request Builders

**Files:**
- Modify: `desktop/src/modules/drive/index.tsx`
- Modify: `desktop/src/modules/drive/__tests__/drive-module.test.tsx`

- [ ] **Step 1: Update renderer mocks and write failing button tests**

In `desktop/src/modules/drive/__tests__/drive-module.test.tsx`, replace upload mocks with:

```ts
uploadDriveLocalItems: vi.fn(),
filePathForDroppedFile: vi.fn(),
```

Add these to the mocked bridge:

```ts
uploadDriveLocalItems: mocks.uploadDriveLocalItems,
filePathForDroppedFile: mocks.filePathForDroppedFile,
```

Set defaults in `beforeEach`:

```ts
mocks.uploadDriveLocalItems.mockResolvedValue({ completed: 1, failed: 0, skipped: 0 })
mocks.filePathForDroppedFile.mockReturnValue("/tmp/report.txt")
```

Replace the old selected file upload test with:

```ts
it("uploads selected files through the unified local upload bridge without reading file bodies", async () => {
  await render(<DriveModule />)

  const input = document.querySelector('input[type="file"]:not([webkitdirectory])')
  if (!(input instanceof HTMLInputElement)) throw new Error("File input not found")
  const file = new File(["report"], "report.txt", { type: "text/plain" })
  const arrayBuffer = vi.fn(async () => new TextEncoder().encode("report").buffer)
  Object.defineProperty(file, "arrayBuffer", { configurable: true, value: arrayBuffer })
  mocks.filePathForDroppedFile.mockReturnValueOnce("/tmp/report.txt")
  Object.defineProperty(input, "files", { configurable: true, value: [file] })

  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await flushPromises()
  })

  expect(mocks.uploadDriveLocalItems).toHaveBeenCalledWith({
    parentId: null,
    items: [{ kind: "file", path: "/tmp/report.txt", name: "report.txt", mimeType: "text/plain" }],
  })
  expect(arrayBuffer).not.toHaveBeenCalled()
  expect(mocks.prepareDriveUpload).not.toHaveBeenCalled()
  expect(mocks.uploadDrivePreparedFile).not.toHaveBeenCalled()
  expect(mocks.completeDriveUpload).not.toHaveBeenCalled()
  expect(mocks.toast).toHaveBeenCalledWith("已上传 1 个文件")
})
```

Add a selected folder test:

```ts
it("normalizes selected folders into one unified local upload request", async () => {
  await render(<DriveModule />)

  const input = document.querySelector('input[type="file"][webkitdirectory]')
  if (!(input instanceof HTMLInputElement)) throw new Error("Folder input not found")
  const first = new File(["a"], "a.md", { type: "text/markdown" })
  const second = new File(["b"], "b.md", { type: "" })
  Object.defineProperty(first, "webkitRelativePath", { value: "项目A/a.md" })
  Object.defineProperty(second, "webkitRelativePath", { value: "项目A/docs/b.md" })
  mocks.filePathForDroppedFile
    .mockReturnValueOnce("/tmp/项目A/a.md")
    .mockReturnValueOnce("/tmp/项目A/docs/b.md")
  Object.defineProperty(input, "files", { configurable: true, value: [first, second] })

  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await flushPromises()
  })

  expect(mocks.uploadDriveLocalItems).toHaveBeenCalledWith({
    parentId: null,
    items: [{
      kind: "folder",
      folderName: "项目A",
      files: [
        { path: "/tmp/项目A/a.md", relativePath: "a.md", mimeType: "text/markdown" },
        { path: "/tmp/项目A/docs/b.md", relativePath: "docs/b.md", mimeType: null },
      ],
    }],
  })
})
```

- [ ] **Step 2: Run failing renderer button tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/drive/__tests__/drive-module.test.tsx
```

Expected: FAIL because renderer still calls old upload functions.

- [ ] **Step 3: Implement renderer request builders**

In `desktop/src/modules/drive/index.tsx`, import bridge upload types:

```ts
import type { DriveLocalUploadItem, DriveLocalUploadResult } from "@/types/bridge"
```

Replace `UploadResult` helpers and old `uploadFiles` / `uploadFolder` functions with:

```ts
type DriveUploadUiResult = DriveLocalUploadResult

function uploadResultMessage(result: DriveUploadUiResult): string {
  if (result.failed === 0 && result.skipped === 0) return `已上传 ${result.completed} 个文件`
  const skipped = result.skipped > 0 ? `，跳过 ${result.skipped} 个` : ""
  return result.message
    ? `上传完成 ${result.completed} 个，失败 ${result.failed} 个${skipped}：${result.message}`
    : `上传完成 ${result.completed} 个，失败 ${result.failed} 个${skipped}`
}

function localPathForFile(file: File): string | null {
  return requireSynapseBridge().account.filePathForDroppedFile(file)
}

function buildFileUploadItems(files: readonly File[]): { items: DriveLocalUploadItem[]; unresolvedCount: number } {
  const items: DriveLocalUploadItem[] = []
  let unresolvedCount = 0
  for (const file of files) {
    const filePath = localPathForFile(file)
    if (!filePath) {
      unresolvedCount += 1
      continue
    }
    items.push({ kind: "file", path: filePath, name: file.name, mimeType: file.type || null })
  }
  return { items, unresolvedCount }
}

function buildFolderUploadItems(files: readonly File[]): { items: DriveLocalUploadItem[]; unresolvedCount: number } {
  const grouped = new Map<string, Extract<DriveLocalUploadItem, { kind: "folder" }>>()
  let unresolvedCount = 0
  for (const file of files) {
    const filePath = localPathForFile(file)
    const fullRelativePath = readRelativeFilePath(file)
    const [folderName, ...rest] = fullRelativePath.split("/").filter(Boolean)
    const relativePath = rest.join("/") || file.name
    if (!filePath || !folderName || !isSafeDriveRelativePath(relativePath)) {
      unresolvedCount += 1
      continue
    }
    const folder = grouped.get(folderName) ?? { kind: "folder", folderName, files: [] }
    folder.files.push({ path: filePath, relativePath, mimeType: file.type || null })
    grouped.set(folderName, folder)
  }
  return { items: Array.from(grouped.values()), unresolvedCount }
}

function isSafeDriveRelativePath(value: string): boolean {
  if (!value || value.includes("\\")) return false
  return value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
}
```

- [ ] **Step 4: Wire button handlers to unified bridge**

Add state to `DriveModule`:

```ts
const [uploadingCount, setUploadingCount] = useState(0)
```

Add one upload runner:

```ts
const runLocalUpload = useCallback(async (items: DriveLocalUploadItem[], unresolvedCount = 0) => {
  if (actionsDisabled || items.length === 0) {
    if (unresolvedCount > 0) toast(`跳过 ${unresolvedCount} 个无法读取的文件`)
    return
  }
  setUploadingCount((count) => count + items.length)
  try {
    const result = await requireSynapseBridge().account.uploadDriveLocalItems({ parentId, items })
    toast(uploadResultMessage({ ...result, skipped: result.skipped + unresolvedCount }))
    await loadItems()
  } catch (rawError) {
    toast(errorMessage(rawError, "上传失败"))
  } finally {
    setUploadingCount((count) => Math.max(0, count - items.length))
  }
}, [actionsDisabled, loadItems, parentId])
```

Update `handleFileSelected`:

```ts
const { items: uploadItems, unresolvedCount } = buildFileUploadItems(files)
await runLocalUpload(uploadItems, unresolvedCount)
```

Update `handleFolderSelected`:

```ts
const { items: uploadItems, unresolvedCount } = buildFolderUploadItems(files)
await runLocalUpload(uploadItems, unresolvedCount)
```

Pass `uploadingCount` to `ModulePage` actions with a compact text element:

```tsx
{uploadingCount > 0 ? (
  <span className="text-sm text-muted-foreground">正在上传 {uploadingCount} 项</span>
) : null}
```

- [ ] **Step 5: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/drive/__tests__/drive-module.test.tsx
```

Expected: PASS for existing and updated button tests.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/drive/index.tsx desktop/src/modules/drive/__tests__/drive-module.test.tsx
git commit -m "feat(drive): route button uploads through local pipeline"
```

## Task 5: Add Drag-And-Drop Upload UI

**Files:**
- Modify: `desktop/src/modules/drive/index.tsx`
- Modify: `desktop/src/modules/drive/__tests__/drive-module.test.tsx`

- [ ] **Step 1: Write failing drag/drop tests**

Add helper in `drive-module.test.tsx`:

```ts
function externalFileDragEvent(type: string, files: File[] = []): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files,
      types: ["Files"],
      dropEffect: "none",
      preventDefault: vi.fn(),
    },
  })
  return event
}
```

Add tests:

```ts
it("shows a current-directory drop overlay while dragging files over the list", async () => {
  mocks.listDriveItems
    .mockResolvedValueOnce([createDriveItem({ id: "folder-1", name: "1", type: "folder" })])
    .mockResolvedValueOnce([])
  await render(<DriveModule />)
  await flushAct()
  await clickText("1")
  await flushAct()

  const dropTarget = document.querySelector<HTMLElement>('[aria-label="云盘文件列表"]')
  if (!dropTarget) throw new Error("Drop target not found")

  await act(async () => {
    dropTarget.dispatchEvent(externalFileDragEvent("dragover"))
    await Promise.resolve()
  })

  expect(dropTarget.textContent).toContain("松开上传到 1")
  expect(dropTarget.textContent).not.toContain("松开上传到 根目录")
})

it("uploads dropped files to the current directory through the unified bridge", async () => {
  mocks.listDriveItems
    .mockResolvedValueOnce([createDriveItem({ id: "folder-1", name: "项目", type: "folder" })])
    .mockResolvedValueOnce([])
  await render(<DriveModule />)
  await flushAct()
  await clickText("项目")
  await flushAct()

  const file = new File(["report"], "report.txt", { type: "text/plain" })
  mocks.filePathForDroppedFile.mockReturnValueOnce("/tmp/report.txt")
  const dropTarget = document.querySelector<HTMLElement>('[aria-label="云盘文件列表"]')
  if (!dropTarget) throw new Error("Drop target not found")

  await act(async () => {
    dropTarget.dispatchEvent(externalFileDragEvent("drop", [file]))
    await flushPromises()
  })

  expect(mocks.uploadDriveLocalItems).toHaveBeenCalledWith({
    parentId: "folder-1",
    items: [{ kind: "file", path: "/tmp/report.txt", name: "report.txt", mimeType: "text/plain" }],
  })
})

it("keeps the upload overlay visible when dragging over children", async () => {
  mocks.listDriveItems.mockResolvedValue([createDriveItem({ id: "file-1", name: "brief.md", type: "file" })])
  await render(<DriveModule />)
  await flushAct()
  const dropTarget = document.querySelector<HTMLElement>('[aria-label="云盘文件列表"]')
  const child = getTableRow("brief.md")
  if (!dropTarget) throw new Error("Drop target not found")

  await act(async () => {
    dropTarget.dispatchEvent(externalFileDragEvent("dragover"))
    const leave = externalFileDragEvent("dragleave")
    Object.defineProperty(leave, "relatedTarget", { value: child })
    dropTarget.dispatchEvent(leave)
    await Promise.resolve()
  })

  expect(dropTarget.textContent).toContain("松开上传到 根目录")
})
```

- [ ] **Step 2: Run failing drag/drop tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/drive/__tests__/drive-module.test.tsx
```

Expected: FAIL because no file-list drop target or overlay exists.

- [ ] **Step 3: Add drop state and handlers**

In `DriveModule`, add:

```ts
const [isDraggingUpload, setIsDraggingUpload] = useState(false)
```

Add helpers:

```ts
function hasExternalDraggedFiles(dataTransfer: DataTransfer | null | undefined): boolean {
  return Array.from(dataTransfer?.types ?? []).includes("Files") || (dataTransfer?.files.length ?? 0) > 0
}
```

Add callbacks:

```ts
const handleFileListDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
  if (actionsDisabled || !hasExternalDraggedFiles(event.dataTransfer)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = "copy"
  setIsDraggingUpload(true)
}, [actionsDisabled])

const handleFileListDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
  const relatedTarget = event.relatedTarget
  if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return
  setIsDraggingUpload(false)
}, [])

const handleFileListDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
  event.preventDefault()
  setIsDraggingUpload(false)
  if (actionsDisabled || !hasExternalDraggedFiles(event.dataTransfer)) return
  const files = Array.from(event.dataTransfer.files)
  const { items: uploadItems, unresolvedCount } = buildFileUploadItems(files)
  await runLocalUpload(uploadItems, unresolvedCount)
}, [actionsDisabled, runLocalUpload])
```

Pass these to `DriveFileList`.

- [ ] **Step 4: Render A-style overlay**

Update `DriveFileList` props:

```ts
readonly currentDirectoryName: string
readonly isDraggingUpload: boolean
readonly onDragOver: (event: React.DragEvent<HTMLDivElement>) => void
readonly onDragLeave: (event: React.DragEvent<HTMLDivElement>) => void
readonly onDrop: (event: React.DragEvent<HTMLDivElement>) => void
```

Wrap list content:

```tsx
<div
  className="relative flex min-h-full flex-col gap-3"
  aria-label="云盘文件列表"
  onDragOver={onDragOver}
  onDragLeave={onDragLeave}
  onDrop={onDrop}
>
  {/* existing toolbar/table content */}
  {isDraggingUpload ? (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border border-dashed border-border bg-background/80 text-sm text-muted-foreground">
      松开上传到 {currentDirectoryName}
    </div>
  ) : null}
</div>
```

Use existing token classes only. Do not add hex, rgb, hsl, gradients, or permanent explanatory copy.

- [ ] **Step 5: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/drive/__tests__/drive-module.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/drive/index.tsx desktop/src/modules/drive/__tests__/drive-module.test.tsx
git commit -m "feat(drive): support drag upload in file list"
```

## Task 6: Finish Verification And Release Notes

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update pending release notes**

Under `## 功能优化` in `RELEASE_NOTES_PENDING.md`, add:

```md
- 云盘上传改为统一的本地上传管线，点击选择和拖拽上传都会在后台处理文件读取与上传；文件列表区域现在可以直接拖入文件或文件夹上传到当前目录。
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/drive/__tests__/drive-module.test.tsx electron/modules/account/__tests__/ipc.test.ts electron/services/__tests__/account-service.test.ts electron/__tests__/preload.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run generated IPC and hard-constraint checks**

Run:

```bash
pnpm --filter @synapse/desktop run check:ipc-codegen
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note drive drag upload improvement"
```

## Self-Review

- Spec coverage: The plan covers drag upload, current-directory targeting, folder structure preservation, all upload entrances sharing one pipeline, renderer no longer reading full file bodies, lightweight upload status, permission/audit checks, and release notes.
- Placeholder scan: No task depends on undefined future decisions. Each implementation step names files, functions, commands, and expected outcomes.
- Type consistency: The plan uses `DriveLocalUploadRequest`, `DriveLocalUploadItem`, `DriveLocalUploadResult`, and `uploadDriveLocalItems` consistently across renderer types, IPC, preload, and service.
