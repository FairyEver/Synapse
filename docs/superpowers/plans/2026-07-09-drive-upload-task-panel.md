# Drive Upload Task Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inspectable Drive upload task panel with per-file statuses, progress events, retry for failed items, and restrained product UI.

**Architecture:** Keep Drive uploads owned by the existing Drive module and Account IPC path. Add a small renderer upload task model, emit account-domain progress events from the main-process local upload loop, and render the current task in the existing shadcn `Sheet` component.

**Tech Stack:** Electron 41 IPC, React 19, TypeScript 6, Vitest, shadcn/Radix, Tailwind CSS 4, existing `sonner` toasts and Drive format helpers.

## Global Constraints

- Use existing shadcn/Radix components and Tailwind theme tokens only.
- Do not add dependencies.
- Do not use inline `style={{...}}`, custom colors, hex/rgb/hsl literals, arbitrary Tailwind colors, nested cards, or decorative gradients.
- Keep UI copy short and operational.
- Do not build a global cross-app upload center.
- Do not persist upload history across app restarts.
- Do not add pause, resume, bandwidth controls, byte speed, or remaining-time estimates.
- Do not expose raw local paths in the upload panel.
- Update `RELEASE_NOTES_PENDING.md` after the user-facing feature is implemented.

---

## File Structure

- Create `desktop/src/modules/drive/drive-upload-task.ts`
  - Pure renderer task model helpers: flatten upload requests, derive counts, apply progress events, build retry requests, generate status labels.
- Create `desktop/src/modules/drive/drive-upload-task-panel.tsx`
  - Right-side `Sheet` UI for upload summary, progress, current item, file rows, and retry action.
- Create `desktop/src/modules/drive/__tests__/drive-upload-task.test.ts`
  - Unit tests for pure upload task helpers.
- Create `desktop/src/modules/drive/__tests__/drive-upload-task-panel.test.tsx`
  - Component tests for panel rendering and retry action.
- Modify `desktop/src/types/bridge.ts`
  - Add upload task id to `DriveLocalUploadRequest`, add `DriveLocalUploadProgressEvent`, expose `account.onDriveLocalUploadProgress`.
- Modify `desktop/electron/modules/account/ipc.ts`
  - Accept `taskId`, define progress event schema, add account event descriptor, emit events through `ctx.resolve<EventBus>("core.event-bus")` from the guarded upload handler.
- Modify `desktop/electron/services/account-service.ts`
  - Add optional progress callback to `uploadDriveLocalItems`, `uploadDriveLocalFile`, and `uploadDriveLocalFolder`.
- Modify `desktop/electron/preload.ts`
  - Add `account.onDriveLocalUploadProgress` subscription through existing account-domain event channel.
- Modify `desktop/src/modules/drive/index.tsx`
  - Replace `uploading`/`uploadItemCount` as primary state with `DriveUploadTask`, subscribe to progress events, render status button and panel.
- Modify `desktop/src/modules/drive/__tests__/drive-module.test.tsx`
  - Cover module integration: status button, panel open, navigation during upload, progress event updates, retry.
- Modify `desktop/electron/modules/account/__tests__/ipc.test.ts`
  - Cover schema, task id forwarding, and event emission through Account IPC.
- Modify `desktop/electron/services/__tests__/account-service.test.ts`
  - Cover service progress callback for file and folder uploads.
- Modify `RELEASE_NOTES_PENDING.md`
  - Add the approved release note under 功能优化.

---

### Task 1: Renderer Upload Task Model

**Files:**
- Create: `desktop/src/modules/drive/drive-upload-task.ts`
- Test: `desktop/src/modules/drive/__tests__/drive-upload-task.test.ts`

**Interfaces:**
- Consumes: `DriveLocalUploadRequest`, `DriveLocalUploadItem`, `DriveLocalUploadProgressEvent`, `DriveLocalUploadResult` from `desktop/src/types/bridge.ts`.
- Produces:
  - `type DriveUploadTask`
  - `type DriveUploadTaskItem`
  - `function createDriveUploadTask(input: CreateDriveUploadTaskInput): DriveUploadTask`
  - `function applyDriveUploadProgressEvent(task: DriveUploadTask, event: DriveLocalUploadProgressEvent): DriveUploadTask`
  - `function finishDriveUploadTask(task: DriveUploadTask, result: DriveLocalUploadResult, finishedAt?: number): DriveUploadTask`
  - `function buildDriveUploadRetryRequest(task: DriveUploadTask): DriveLocalUploadRequest | null`
  - `function getDriveUploadStatusBadge(task: DriveUploadTask | null): { label: string; tone: "neutral" | "destructive"; ariaLabel: string } | null`

- [ ] **Step 1: Write failing tests for flattening upload requests**

Add this file:

```ts
// desktop/src/modules/drive/__tests__/drive-upload-task.test.ts
import { describe, expect, it } from "vitest"
import {
  applyDriveUploadProgressEvent,
  buildDriveUploadRetryRequest,
  createDriveUploadTask,
  finishDriveUploadTask,
  getDriveUploadStatusBadge,
} from "../drive-upload-task"
import type { DriveLocalUploadRequest } from "@/types/bridge"

describe("drive upload task model", () => {
  it("flattens files and folder entries without exposing raw paths as labels", () => {
    const request: DriveLocalUploadRequest = {
      taskId: "upload-task-1",
      parentId: "folder-1",
      items: [
        { kind: "file", path: "/Users/me/Desktop/report.pdf", name: "report.pdf", mimeType: "application/pdf" },
        {
          kind: "folder",
          folderName: "flowcharts",
          files: [
            { path: "/Users/me/Desktop/flowcharts/a.png", relativePath: "a.png", mimeType: "image/png" },
            { path: "/Users/me/Desktop/flowcharts/docs/b.md", relativePath: "docs/b.md", mimeType: "text/markdown" },
          ],
        },
      ],
    }

    const task = createDriveUploadTask({
      id: "upload-task-1",
      destinationPath: "/专利申请/流式图表解析",
      parentId: "folder-1",
      request,
      startedAt: 100,
    })

    expect(task.totalItems).toBe(3)
    expect(task.destinationPath).toBe("/专利申请/流式图表解析")
    expect(task.items.map((item) => item.name)).toEqual(["report.pdf", "a.png", "b.md"])
    expect(task.items.map((item) => item.relativePath)).toEqual([null, "flowcharts/a.png", "flowcharts/docs/b.md"])
    expect(task.items.map((item) => item.localPath)).toEqual([
      "/Users/me/Desktop/report.pdf",
      "/Users/me/Desktop/flowcharts/a.png",
      "/Users/me/Desktop/flowcharts/docs/b.md",
    ])
    expect(task.items.every((item) => item.status === "queued")).toBe(true)
  })

  it("updates counts when progress events arrive", () => {
    const task = createDriveUploadTask({
      id: "upload-task-1",
      destinationPath: "根目录",
      parentId: null,
      request: {
        taskId: "upload-task-1",
        parentId: null,
        items: [
          { kind: "file", path: "/tmp/a.txt", name: "a.txt", mimeType: "text/plain" },
          { kind: "file", path: "/tmp/b.txt", name: "b.txt", mimeType: "text/plain" },
        ],
      },
      startedAt: 100,
    })

    const started = applyDriveUploadProgressEvent(task, {
      type: "item-started",
      taskId: "upload-task-1",
      itemKey: "file:/tmp/a.txt",
    })
    const completed = applyDriveUploadProgressEvent(started, {
      type: "item-completed",
      taskId: "upload-task-1",
      itemKey: "file:/tmp/a.txt",
    })
    const failed = applyDriveUploadProgressEvent(completed, {
      type: "item-failed",
      taskId: "upload-task-1",
      itemKey: "file:/tmp/b.txt",
      message: "上传失败。",
    })

    expect(failed.completedItems).toBe(1)
    expect(failed.failedItems).toBe(1)
    expect(failed.items.map((item) => item.status)).toEqual(["completed", "failed"])
    expect(failed.items[1]?.message).toBe("上传失败。")
  })

  it("retries only failed items against the original parent id", () => {
    const task = createDriveUploadTask({
      id: "upload-task-1",
      destinationPath: "根目录",
      parentId: "folder-1",
      request: {
        taskId: "upload-task-1",
        parentId: "folder-1",
        items: [
          { kind: "file", path: "/tmp/a.txt", name: "a.txt", mimeType: "text/plain" },
          { kind: "file", path: "/tmp/b.txt", name: "b.txt", mimeType: "text/plain" },
        ],
      },
      startedAt: 100,
    })
    const failed = applyDriveUploadProgressEvent(task, {
      type: "item-failed",
      taskId: "upload-task-1",
      itemKey: "file:/tmp/b.txt",
      message: "上传失败。",
    })

    expect(buildDriveUploadRetryRequest(failed)).toEqual({
      parentId: "folder-1",
      items: [{ kind: "file", path: "/tmp/b.txt", name: "b.txt", mimeType: "text/plain" }],
    })
  })

  it("derives status badge copy from active and finished tasks", () => {
    const running = createDriveUploadTask({
      id: "upload-task-1",
      destinationPath: "根目录",
      parentId: null,
      request: {
        taskId: "upload-task-1",
        parentId: null,
        items: [{ kind: "file", path: "/tmp/a.txt", name: "a.txt", mimeType: "text/plain" }],
      },
      startedAt: 100,
    })
    const finished = finishDriveUploadTask(running, { completed: 1, failed: 0, skipped: 0 }, 200)
    const failed = finishDriveUploadTask(running, { completed: 0, failed: 1, skipped: 0, message: "上传失败。" }, 200)

    expect(getDriveUploadStatusBadge(running)?.label).toBe("正在上传 1 项")
    expect(getDriveUploadStatusBadge(finished)?.label).toBe("已上传 1 项")
    expect(getDriveUploadStatusBadge(failed)).toMatchObject({ label: "上传失败 1 项", tone: "destructive" })
    expect(getDriveUploadStatusBadge(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop vitest run desktop/src/modules/drive/__tests__/drive-upload-task.test.ts
```

Expected: FAIL because `../drive-upload-task` does not exist.

- [ ] **Step 3: Implement the upload task model**

Create `desktop/src/modules/drive/drive-upload-task.ts` with these exports and logic:

```ts
import type {
  DriveLocalUploadFileItem,
  DriveLocalUploadFolderItem,
  DriveLocalUploadItem,
  DriveLocalUploadProgressEvent,
  DriveLocalUploadRequest,
  DriveLocalUploadResult,
} from "@/types/bridge"

export type DriveUploadTaskStatus = "running" | "completed" | "failed"
export type DriveUploadTaskItemStatus = "queued" | "preparing" | "uploading" | "completed" | "skipped" | "failed"

export type DriveUploadTaskItem = {
  readonly key: string
  readonly name: string
  readonly relativePath: string | null
  readonly localPath: string
  readonly mimeType: string | null
  readonly status: DriveUploadTaskItemStatus
  readonly message: string | null
  readonly sourceItem: DriveLocalUploadItem
}

export type DriveUploadTask = {
  readonly id: string
  readonly parentId: string | null
  readonly destinationPath: string
  readonly status: DriveUploadTaskStatus
  readonly totalItems: number
  readonly completedItems: number
  readonly failedItems: number
  readonly skippedItems: number
  readonly items: readonly DriveUploadTaskItem[]
  readonly startedAt: number
  readonly finishedAt: number | null
  readonly message: string | null
}

export type CreateDriveUploadTaskInput = {
  readonly id: string
  readonly parentId: string | null
  readonly destinationPath: string
  readonly request: DriveLocalUploadRequest
  readonly startedAt?: number
}

export function createDriveUploadTask(input: CreateDriveUploadTaskInput): DriveUploadTask {
  const items = input.request.items.flatMap(flattenUploadItem)
  return withCounts({
    id: input.id,
    parentId: input.parentId,
    destinationPath: input.destinationPath,
    status: "running",
    totalItems: items.length,
    completedItems: 0,
    failedItems: 0,
    skippedItems: 0,
    items,
    startedAt: input.startedAt ?? Date.now(),
    finishedAt: null,
    message: null,
  })
}

export function applyDriveUploadProgressEvent(
  task: DriveUploadTask,
  event: DriveLocalUploadProgressEvent,
): DriveUploadTask {
  if (event.taskId !== task.id) return task
  if (event.type === "task-finished") return finishDriveUploadTask(task, event.result)
  const nextStatus = event.type === "item-started"
    ? "uploading"
    : event.type === "item-completed"
      ? "completed"
      : event.type === "item-skipped"
        ? "skipped"
        : "failed"
  return withCounts({
    ...task,
    items: task.items.map((item) => (
      item.key === event.itemKey
        ? { ...item, status: nextStatus, message: "message" in event ? event.message ?? null : null }
        : item
    )),
  })
}

export function finishDriveUploadTask(
  task: DriveUploadTask,
  result: DriveLocalUploadResult,
  finishedAt = Date.now(),
): DriveUploadTask {
  const reconciled = withCounts({
    ...task,
    status: result.failed > 0 ? "failed" : "completed",
    finishedAt,
    message: result.message ?? null,
  })
  return {
    ...reconciled,
    completedItems: Math.max(reconciled.completedItems, result.completed),
    failedItems: Math.max(reconciled.failedItems, result.failed),
    skippedItems: Math.max(reconciled.skippedItems, result.skipped),
  }
}

export function buildDriveUploadRetryRequest(task: DriveUploadTask): DriveLocalUploadRequest | null {
  const failedItems = task.items.filter((item) => item.status === "failed")
  if (failedItems.length === 0) return null
  return {
    parentId: task.parentId,
    items: failedItems.map((item) => item.sourceItem),
  }
}

export function getDriveUploadStatusBadge(task: DriveUploadTask | null): {
  readonly label: string
  readonly tone: "neutral" | "destructive"
  readonly ariaLabel: string
} | null {
  if (!task) return null
  if (task.status === "running") {
    const label = `正在上传 ${task.totalItems} 项`
    return { label, tone: "neutral", ariaLabel: label }
  }
  if (task.failedItems > 0) {
    const label = `上传失败 ${task.failedItems} 项`
    return { label, tone: "destructive", ariaLabel: label }
  }
  const label = `已上传 ${task.completedItems} 项`
  return { label, tone: "neutral", ariaLabel: label }
}

function flattenUploadItem(item: DriveLocalUploadItem): DriveUploadTaskItem[] {
  if (item.kind === "file") return [taskItemFromFile(item)]
  return item.files.map((file) => taskItemFromFolderFile(item, file))
}

function taskItemFromFile(item: DriveLocalUploadFileItem): DriveUploadTaskItem {
  return {
    key: `file:${item.path}`,
    name: item.name,
    relativePath: null,
    localPath: item.path,
    mimeType: item.mimeType ?? null,
    status: "queued",
    message: null,
    sourceItem: item,
  }
}

function taskItemFromFolderFile(
  folder: DriveLocalUploadFolderItem,
  file: DriveLocalUploadFolderItem["files"][number],
): DriveUploadTaskItem {
  const name = file.relativePath.split("/").filter(Boolean).at(-1) ?? file.relativePath
  return {
    key: `folder:${folder.folderName}/${file.relativePath}`,
    name,
    relativePath: `${folder.folderName}/${file.relativePath}`,
    localPath: file.path,
    mimeType: file.mimeType ?? null,
    status: "queued",
    message: null,
    sourceItem: {
      kind: "file",
      path: file.path,
      name,
      mimeType: file.mimeType ?? null,
    },
  }
}

function withCounts(task: DriveUploadTask): DriveUploadTask {
  const completedItems = task.items.filter((item) => item.status === "completed").length
  const failedItems = task.items.filter((item) => item.status === "failed").length
  const skippedItems = task.items.filter((item) => item.status === "skipped").length
  return { ...task, completedItems, failedItems, skippedItems }
}
```

- [ ] **Step 4: Run the unit tests**

Run:

```bash
pnpm --filter @synapse/desktop vitest run desktop/src/modules/drive/__tests__/drive-upload-task.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add desktop/src/modules/drive/drive-upload-task.ts desktop/src/modules/drive/__tests__/drive-upload-task.test.ts
git commit -m "feat: add drive upload task model"
```

---

### Task 2: Account Upload Progress Contract

**Files:**
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/modules/account/ipc.ts`
- Modify: `desktop/electron/services/account-service.ts`
- Modify: `desktop/electron/preload.ts`
- Test: `desktop/electron/modules/account/__tests__/ipc.test.ts`
- Test: `desktop/electron/services/__tests__/account-service.test.ts`

**Interfaces:**
- Consumes: `DriveLocalUploadRequest` from Task 1.
- Produces:
  - `DriveLocalUploadRequest.taskId?: string`
  - `type DriveLocalUploadProgressEvent`
  - `account.onDriveLocalUploadProgress(listener): () => void`
  - `AccountService.uploadDriveLocalItems(input, options?: { onProgress?: (event: DriveLocalUploadProgressEvent) => void }): Promise<DriveLocalUploadResult>`

- [ ] **Step 1: Write failing IPC test for task id forwarding and event emission**

Append this test in `desktop/electron/modules/account/__tests__/ipc.test.ts` near the local upload guard tests:

```ts
  it("forwards local drive upload task ids and emits progress events", async () => {
    const uploadDriveLocalItems = vi.fn(async (_request, options?: {
      readonly onProgress?: (event: {
        readonly type: "item-started"
        readonly taskId: string
        readonly itemKey: string
      }) => void
    }) => {
      options?.onProgress?.({ type: "item-started", taskId: "upload-task-1", itemKey: "file:/tmp/report.txt" })
      return { completed: 1, failed: 0, skipped: 0 }
    })
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
    const auditSink = { record: vi.fn() }
    const emitted: unknown[] = []
    const eventBus = { emit: vi.fn((event: unknown) => { emitted.push(event) }) }
    const ctx: IpcHandlerContext = {
      moduleId: "account",
      resolve: ((id: string) => {
        if (id === "core.permission-guard") return permissionGuard
        if (id === "core.audit-sink") return auditSink
        if (id === "core.event-bus") return eventBus
        throw new Error(`unexpected service ${id}`)
      }) as IpcHandlerContext["resolve"],
    }
    vi.mocked(accountService.uploadDriveLocalItems).mockImplementation(uploadDriveLocalItems)

    await expect(accountIpcModule.methods.uploadDriveLocalItems.handler(ctx, {
      taskId: "upload-task-1",
      parentId: null,
      items: [{ kind: "file", path: "/tmp/report.txt", name: "report.txt", mimeType: null }],
    })).resolves.toEqual({ completed: 1, failed: 0, skipped: 0 })

    expect(uploadDriveLocalItems).toHaveBeenCalledWith(
      {
        taskId: "upload-task-1",
        parentId: null,
        items: [{ kind: "file", path: "/tmp/report.txt", name: "report.txt", mimeType: null }],
      },
      { onProgress: expect.any(Function) },
    )
    expect(emitted).toContainEqual(expect.objectContaining({
      domain: "account",
      type: "account.driveLocalUploadProgress",
      payload: { type: "item-started", taskId: "upload-task-1", itemKey: "file:/tmp/report.txt" },
    }))
  })
```

- [ ] **Step 2: Write failing service progress test**

Add this test in `desktop/electron/services/__tests__/account-service.test.ts` beside existing local upload tests:

```ts
  it("reports local file upload progress", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-progress-"))
    const filePath = path.join(dir, "report.txt")
    await writeFile(filePath, "report")
    const fetch = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof globalThis.fetch
    const { service } = await createTestAccountService({ fetch })
    vi.spyOn(service, "prepareDriveUpload").mockResolvedValue({
      sessionId: "session-1",
      upload: { method: "PUT", url: "https://upload.test/report", headers: {} },
    })
    vi.spyOn(service, "completeDriveUpload").mockResolvedValue(
      driveItem({ id: "file-1", name: "report.txt" }),
    )
    vi.spyOn(service, "cancelDriveUpload").mockResolvedValue({ ok: true })
    const events: unknown[] = []

    await service.uploadDriveLocalItems({
      taskId: "upload-task-1",
      parentId: null,
      items: [{ kind: "file", path: filePath, name: "report.txt", mimeType: "text/plain" }],
    }, {
      onProgress: (event) => events.push(event),
    })

    expect(events).toEqual([
      { type: "item-started", taskId: "upload-task-1", itemKey: `file:${filePath}` },
      { type: "item-completed", taskId: "upload-task-1", itemKey: `file:${filePath}` },
    ])
  })
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop vitest run desktop/electron/modules/account/__tests__/ipc.test.ts desktop/electron/services/__tests__/account-service.test.ts
```

Expected: FAIL because `taskId`, progress events, and service options are not implemented.

- [ ] **Step 4: Add bridge types**

Modify `desktop/src/types/bridge.ts`:

```ts
export type DriveLocalUploadRequest = {
  readonly taskId?: string
  readonly parentId?: string | null
  readonly items: DriveLocalUploadItem[]
}

export type DriveLocalUploadProgressEvent =
  | { readonly type: "item-started"; readonly taskId: string; readonly itemKey: string }
  | { readonly type: "item-completed"; readonly taskId: string; readonly itemKey: string }
  | { readonly type: "item-skipped"; readonly taskId: string; readonly itemKey: string; readonly message?: string }
  | { readonly type: "item-failed"; readonly taskId: string; readonly itemKey: string; readonly message?: string }
  | { readonly type: "task-finished"; readonly taskId: string; readonly result: DriveLocalUploadResult }
```

Add to the `account` bridge interface:

```ts
    onDriveLocalUploadProgress: (listener: (event: DriveLocalUploadProgressEvent) => void) => () => void
```

- [ ] **Step 5: Add Account IPC schema and event descriptor**

Modify `desktop/electron/modules/account/ipc.ts`:

```ts
const driveLocalUploadProgressEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("item-started"), taskId: z.string().min(1), itemKey: z.string().min(1) }),
  z.object({ type: z.literal("item-completed"), taskId: z.string().min(1), itemKey: z.string().min(1) }),
  z.object({ type: z.literal("item-skipped"), taskId: z.string().min(1), itemKey: z.string().min(1), message: z.string().optional() }),
  z.object({ type: z.literal("item-failed"), taskId: z.string().min(1), itemKey: z.string().min(1), message: z.string().optional() }),
  z.object({ type: z.literal("task-finished"), taskId: z.string().min(1), result: driveLocalUploadResultSchema }),
])
```

Add `taskId` to `driveLocalUploadRequestSchema`:

```ts
const driveLocalUploadRequestSchema = z.object({
  taskId: z.string().min(1).optional(),
  parentId: z.string().nullable().optional(),
  items: z.array(z.discriminatedUnion("kind", [
    driveLocalUploadFileItemSchema,
    driveLocalUploadFolderItemSchema,
  ])).min(1).max(DRIVE_LOCAL_UPLOAD_MAX_FILES),
}).superRefine((request, ctx) => {
  const fileCount = countDriveLocalUploadRequestFiles(request)
  if (fileCount <= DRIVE_LOCAL_UPLOAD_MAX_FILES) return
  ctx.addIssue({
    code: z.ZodIssueCode.too_big,
    maximum: DRIVE_LOCAL_UPLOAD_MAX_FILES,
    origin: "array",
    inclusive: true,
    path: ["items"],
    message: `local drive upload must include at most ${DRIVE_LOCAL_UPLOAD_MAX_FILES} files`,
  })
})
```

Update the upload handler:

```ts
      handler: async (ctx, input) => {
        const request = driveLocalUploadRequestSchema.parse(input)
        return runGuardedDriveLocalUpload({
          ctx,
          request,
          run: async () => {
            const eventBus = ctx.resolve<EventBus>("core.event-bus")
            const result = await accountService.uploadDriveLocalItems(request, {
              onProgress: (payload) => {
                eventBus.emit({
                  domain: "account",
                  type: "account.driveLocalUploadProgress",
                  payload,
                  timestamp: new Date().toISOString(),
                })
              },
            })
            if (request.taskId) {
              eventBus.emit({
                domain: "account",
                type: "account.driveLocalUploadProgress",
                payload: { type: "task-finished", taskId: request.taskId, result },
                timestamp: new Date().toISOString(),
              })
            }
            return result
          },
        })
      },
```

Add event descriptor:

```ts
    driveLocalUploadProgress: {
      kind: "event",
      channel: "synapse:events:account",
      payload: z.object({
        domain: z.literal("account"),
        type: z.literal("account.driveLocalUploadProgress"),
        payload: driveLocalUploadProgressEventSchema,
        timestamp: z.string(),
      }),
    },
```

- [ ] **Step 6: Add service progress options**

Modify `desktop/electron/services/account-service.ts` by introducing:

```ts
type DriveLocalUploadProgressReporter = {
  readonly taskId?: string
  readonly onProgress?: (event: DriveLocalUploadProgressEvent) => void
}

function driveLocalFileUploadItemKey(item: DriveLocalUploadFileItem): string {
  return `file:${item.path}`
}

function driveLocalFolderUploadItemKey(folderName: string, relativePath: string): string {
  return `folder:${folderName}/${relativePath}`
}
```

Change signatures:

```ts
async uploadDriveLocalItems(
  input: DriveLocalUploadRequest,
  options: { readonly onProgress?: (event: DriveLocalUploadProgressEvent) => void } = {},
): Promise<DriveLocalUploadResult>
```

Inside `uploadDriveLocalItems`, create:

```ts
const progress: DriveLocalUploadProgressReporter = {
  taskId: input.taskId,
  onProgress: options.onProgress,
}
```

Pass `progress` into `uploadDriveLocalFile` and `uploadDriveLocalFolder`.

Emit around each file upload:

```ts
if (progress.taskId) {
  progress.onProgress?.({ type: "item-started", taskId: progress.taskId, itemKey: driveLocalFileUploadItemKey(item) })
}
```

On success:

```ts
if (progress.taskId) {
  progress.onProgress?.({ type: "item-completed", taskId: progress.taskId, itemKey: driveLocalFileUploadItemKey(item) })
}
```

On skip:

```ts
if (progress.taskId) {
  progress.onProgress?.({ type: "item-skipped", taskId: progress.taskId, itemKey: driveLocalFileUploadItemKey(item) })
}
```

On failure:

```ts
if (progress.taskId) {
  progress.onProgress?.({
    type: "item-failed",
    taskId: progress.taskId,
    itemKey: driveLocalFileUploadItemKey(item),
    message: localUploadErrorMessage(error),
  })
}
```

Use `driveLocalFolderUploadItemKey(item.folderName, file.relativePath)` for folder file events.

- [ ] **Step 7: Add preload subscription**

Modify `desktop/electron/preload.ts` account bridge:

```ts
    onDriveLocalUploadProgress: createDomainEventPayloadSubscription<DriveLocalUploadProgressEvent>(
      subscribe,
      "account",
      "account.driveLocalUploadProgress",
    ),
```

Add `DriveLocalUploadProgressEvent` to the type imports from `../src/types/bridge`.

- [ ] **Step 8: Generate IPC constants and run tests**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
pnpm --filter @synapse/desktop vitest run desktop/electron/modules/account/__tests__/ipc.test.ts desktop/electron/services/__tests__/account-service.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

Run:

```bash
git add desktop/src/types/bridge.ts desktop/electron/modules/account/ipc.ts desktop/electron/services/account-service.ts desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts desktop/electron/modules/account/__tests__/ipc.test.ts desktop/electron/services/__tests__/account-service.test.ts
git commit -m "feat: emit drive upload progress events"
```

---

### Task 3: Drive Upload Panel Component

**Files:**
- Create: `desktop/src/modules/drive/drive-upload-task-panel.tsx`
- Test: `desktop/src/modules/drive/__tests__/drive-upload-task-panel.test.tsx`

**Interfaces:**
- Consumes: `DriveUploadTask`, `buildDriveUploadRetryRequest` from Task 1.
- Produces:
  - `function DriveUploadTaskPanel(props: DriveUploadTaskPanelProps): JSX.Element`
  - Props: `open`, `onOpenChange`, `task`, `onRetryFailed`

- [ ] **Step 1: Write failing component tests**

Add:

```tsx
// desktop/src/modules/drive/__tests__/drive-upload-task-panel.test.tsx
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DriveUploadTaskPanel } from "../drive-upload-task-panel"
import { createDriveUploadTask, applyDriveUploadProgressEvent, finishDriveUploadTask } from "../drive-upload-task"

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
})

async function renderPanel(element: React.ReactElement) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(element)
  })
}

describe("DriveUploadTaskPanel", () => {
  it("renders upload summary and file rows", async () => {
    const task = createDriveUploadTask({
      id: "upload-task-1",
      parentId: "folder-1",
      destinationPath: "/专利申请/流式图表解析",
      request: {
        taskId: "upload-task-1",
        parentId: "folder-1",
        items: [
          { kind: "file", path: "/tmp/report.pdf", name: "report.pdf", mimeType: "application/pdf" },
          {
            kind: "folder",
            folderName: "图表",
            files: [{ path: "/tmp/图表/a.png", relativePath: "a.png", mimeType: "image/png" }],
          },
        ],
      },
      startedAt: 100,
    })

    await renderPanel(
      <DriveUploadTaskPanel open onOpenChange={() => undefined} task={task} onRetryFailed={() => undefined} />,
    )

    expect(document.body.textContent).toContain("上传")
    expect(document.body.textContent).toContain("/专利申请/流式图表解析")
    expect(document.body.textContent).toContain("0 / 2 项")
    expect(document.body.textContent).toContain("report.pdf")
    expect(document.body.textContent).toContain("图表/a.png")
    expect(document.body.textContent).toContain("等待中")
  })

  it("shows failure copy and retry action", async () => {
    const running = createDriveUploadTask({
      id: "upload-task-1",
      parentId: null,
      destinationPath: "根目录",
      request: {
        taskId: "upload-task-1",
        parentId: null,
        items: [{ kind: "file", path: "/tmp/report.pdf", name: "report.pdf", mimeType: "application/pdf" }],
      },
      startedAt: 100,
    })
    const failedItem = applyDriveUploadProgressEvent(running, {
      type: "item-failed",
      taskId: "upload-task-1",
      itemKey: "file:/tmp/report.pdf",
      message: "上传失败。",
    })
    const task = finishDriveUploadTask(failedItem, { completed: 0, failed: 1, skipped: 0, message: "上传失败。" }, 200)
    const retry = vi.fn()

    await renderPanel(
      <DriveUploadTaskPanel open onOpenChange={() => undefined} task={task} onRetryFailed={retry} />,
    )

    expect(document.body.textContent).toContain("失败")
    expect(document.body.textContent).toContain("上传失败。")
    const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent === "重试失败项")
    if (!button) throw new Error("Retry button not found")
    await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the component tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop vitest run desktop/src/modules/drive/__tests__/drive-upload-task-panel.test.tsx
```

Expected: FAIL because `drive-upload-task-panel.tsx` does not exist.

- [ ] **Step 3: Implement the component**

Create `desktop/src/modules/drive/drive-upload-task-panel.tsx`:

```tsx
import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { formatDriveBytes } from "@/lib/drive-format"
import { DriveItemIcon } from "./drive-item-icon"
import type { DriveUploadTask, DriveUploadTaskItem, DriveUploadTaskItemStatus } from "./drive-upload-task"

export type DriveUploadTaskPanelProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly task: DriveUploadTask | null
  readonly onRetryFailed: () => void
}

const STATUS_LABELS: Record<DriveUploadTaskItemStatus, string> = {
  queued: "等待中",
  preparing: "准备中",
  uploading: "上传中",
  completed: "已上传",
  skipped: "已跳过",
  failed: "失败",
}

export function DriveUploadTaskPanel({
  onOpenChange,
  onRetryFailed,
  open,
  task,
}: DriveUploadTaskPanelProps) {
  const progress = task && task.totalItems > 0
    ? Math.round(((task.completedItems + task.failedItems + task.skippedItems) / task.totalItems) * 100)
    : 0
  const activeItem = task?.items.find((item) => item.status === "uploading")
    ?? task?.items.find((item) => item.status === "queued")
    ?? null
  const canRetry = Boolean(task && task.failedItems > 0 && task.status !== "running")

  return (
    <Sheet open={open} onOpenChange={onOpenChange} data-track="drive-upload-task-panel">
      <SheetContent className="w-[28rem] sm:max-w-[28rem]" aria-describedby={undefined}>
        <SheetHeader className="border-b">
          <SheetTitle>上传</SheetTitle>
        </SheetHeader>
        {task ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="grid gap-3 border-b px-4 py-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{task.completedItems + task.failedItems + task.skippedItems} / {task.totalItems} 项</span>
                {task.failedItems > 0 ? <span className="text-destructive">失败 {task.failedItems} 项</span> : null}
              </div>
              <Progress value={progress} aria-label="上传进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} />
              <div className="truncate text-xs text-muted-foreground">{task.destinationPath}</div>
              {activeItem ? <CurrentUploadItem item={activeItem} /> : null}
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="divide-y">
                {task.items.map((item) => (
                  <UploadTaskRow key={item.key} item={item} />
                ))}
              </div>
            </ScrollArea>
          </div>
        ) : (
          <div className="px-4 py-3 text-sm text-muted-foreground">暂无上传任务</div>
        )}
        {canRetry ? (
          <SheetFooter className="border-t">
            <Button type="button" size="sm" onClick={onRetryFailed}>
              <RotateCcw data-icon="inline-start" />
              重试失败项
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function CurrentUploadItem({ item }: { readonly item: DriveUploadTaskItem }) {
  return (
    <div className="grid gap-1 rounded-lg border bg-background p-2">
      <div className="truncate text-sm font-medium">{item.name}</div>
      <div className="truncate text-xs text-muted-foreground">{item.relativePath ?? STATUS_LABELS[item.status]}</div>
    </div>
  )
}

function UploadTaskRow({ item }: { readonly item: DriveUploadTaskItem }) {
  return (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 px-4 py-2 text-sm">
      <DriveItemIcon kind="file" />
      <div className="min-w-0">
        <div className="truncate font-medium">{item.name}</div>
        {item.relativePath ? <div className="truncate text-xs text-muted-foreground">{item.relativePath}</div> : null}
        {item.message ? <div className="truncate text-xs text-destructive">{item.message}</div> : null}
      </div>
      <span className={item.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
        {STATUS_LABELS[item.status]}
      </span>
    </div>
  )
}
```

- [ ] **Step 4: Run the component tests**

Run:

```bash
pnpm --filter @synapse/desktop vitest run desktop/src/modules/drive/__tests__/drive-upload-task-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add desktop/src/modules/drive/drive-upload-task-panel.tsx desktop/src/modules/drive/__tests__/drive-upload-task-panel.test.tsx
git commit -m "feat: add drive upload task panel"
```

---

### Task 4: Wire Drive Module Upload Lifecycle

**Files:**
- Modify: `desktop/src/modules/drive/index.tsx`
- Test: `desktop/src/modules/drive/__tests__/drive-module.test.tsx`

**Interfaces:**
- Consumes:
  - Task 1 helpers.
  - Task 2 bridge event `account.onDriveLocalUploadProgress`.
  - Task 3 component `DriveUploadTaskPanel`.
- Produces:
  - Status button in breadcrumb row.
  - Active upload task lifecycle.
  - Retry failed items.

- [ ] **Step 1: Write failing integration tests**

Add tests to `desktop/src/modules/drive/__tests__/drive-module.test.tsx` near existing upload tests:

```tsx
  it("opens an upload task panel with selected file details", async () => {
    await render(<DriveModule />)

    const input = document.querySelector('input[type="file"]:not([webkitdirectory])')
    if (!(input instanceof HTMLInputElement)) throw new Error("File input not found")
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["report"], "report.txt", { type: "text/plain" })],
    })

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })

    expect(document.body.textContent).toContain("正在上传 1 项")
    await clickButtonText("正在上传 1 项")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("report.txt")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("根目录")
  })

  it("updates upload task rows from progress events", async () => {
    const upload = createDeferred<{ completed: number; failed: number; skipped: number }>()
    mocks.uploadDriveLocalItems.mockReturnValueOnce(upload.promise)
    await render(<DriveModule />)

    const input = document.querySelector('input[type="file"]:not([webkitdirectory])')
    if (!(input instanceof HTMLInputElement)) throw new Error("File input not found")
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["report"], "report.txt", { type: "text/plain" })],
    })

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })
    await clickButtonText("正在上传 1 项")

    await act(async () => {
      emitDriveLocalUploadProgress({ type: "item-started", taskId: lastUploadTaskId(), itemKey: "file:/tmp/report.txt" })
      await flushPromises()
    })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("上传中")

    await act(async () => {
      emitDriveLocalUploadProgress({ type: "item-completed", taskId: lastUploadTaskId(), itemKey: "file:/tmp/report.txt" })
      upload.resolve({ completed: 1, failed: 0, skipped: 0 })
      await flushPromises()
    })
    expect(document.body.textContent).toContain("已上传 1 项")
  })
```

Add these test helpers near existing mocks:

```ts
let driveUploadProgressListener: ((event: DriveLocalUploadProgressEvent) => void) | null = null

function emitDriveLocalUploadProgress(event: DriveLocalUploadProgressEvent) {
  if (!driveUploadProgressListener) throw new Error("Upload progress listener not registered")
  driveUploadProgressListener(event)
}

function lastUploadTaskId(): string {
  const input = mocks.uploadDriveLocalItems.mock.calls.at(-1)?.[0] as { taskId?: string } | undefined
  if (!input?.taskId) throw new Error("No upload task id recorded")
  return input.taskId
}
```

Install the mock bridge method:

```ts
onDriveLocalUploadProgress: vi.fn((listener: (event: DriveLocalUploadProgressEvent) => void) => {
  driveUploadProgressListener = listener
  return () => {
    if (driveUploadProgressListener === listener) driveUploadProgressListener = null
  }
}),
```

- [ ] **Step 2: Run integration tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop vitest run desktop/src/modules/drive/__tests__/drive-module.test.tsx
```

Expected: FAIL because the module does not create task ids, subscribe to upload progress, or render the panel.

- [ ] **Step 3: Wire upload task state**

Modify imports in `desktop/src/modules/drive/index.tsx`:

```tsx
import { DriveUploadTaskPanel } from "./drive-upload-task-panel"
import {
  applyDriveUploadProgressEvent,
  buildDriveUploadRetryRequest,
  createDriveUploadTask,
  finishDriveUploadTask,
  getDriveUploadStatusBadge,
  type DriveUploadTask,
} from "./drive-upload-task"
```

Replace:

```tsx
const [uploading, setUploading] = useState(false)
const [uploadItemCount, setUploadItemCount] = useState<number | null>(null)
```

with:

```tsx
const [uploadTask, setUploadTask] = useState<DriveUploadTask | null>(null)
const [uploadPanelOpen, setUploadPanelOpen] = useState(false)
const uploadTaskRef = useRef<DriveUploadTask | null>(null)
```

Keep the ref in sync:

```tsx
useEffect(() => {
  uploadTaskRef.current = uploadTask
}, [uploadTask])
```

Add subscription:

```tsx
useEffect(() => {
  const unsubscribe = requireSynapseBridge().account.onDriveLocalUploadProgress((event) => {
    setUploadTask((current) => current ? applyDriveUploadProgressEvent(current, event) : current)
  })
  return unsubscribe
}, [])
```

Replace `const uploadActionsDisabled = actionsDisabled || uploading` with:

```tsx
const uploadRunning = uploadTask?.status === "running"
const uploadActionsDisabled = actionsDisabled || uploadRunning
```

- [ ] **Step 4: Create task before upload and finish it after result**

Inside `runLocalUpload`, after a non-empty request is built:

```tsx
const taskId = `drive-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`
const requestWithTaskId: DriveLocalUploadRequest = { ...request, taskId }
const nextTask = createDriveUploadTask({
  id: taskId,
  parentId: request.parentId ?? null,
  destinationPath: formatDriveBreadcrumbPath(path),
  request: requestWithTaskId,
})
setUploadTask(nextTask)
setUploadPanelOpen(true)
const result = await requireSynapseBridge().account.uploadDriveLocalItems(requestWithTaskId)
setUploadTask((current) => current?.id === taskId ? finishDriveUploadTask(current, withSkipped(result, skipped)) : current)
toast(uploadResultMessage(withSkipped(result, skipped)))
```

Remove `setUploading`, `setUploadItemCount`, and `countDriveLocalUploadItems` usage from the upload state path. Keep `countDriveLocalUploadItems` only if other code still needs it.

In the catch block:

```tsx
setUploadTask((current) => current?.id === taskId
  ? { ...current, status: "failed", finishedAt: Date.now(), message: errorMessage(rawError, "上传失败") }
  : current)
toast(errorMessage(rawError, "上传失败"))
```

Use a `let taskId: string | null = null` in the callback scope if TypeScript needs the catch block to see it.

- [ ] **Step 5: Replace active status badge with upload status button**

Replace the upload portion of `activeStatusBadge` with the new status helper:

```tsx
const uploadStatusBadge = getDriveUploadStatusBadge(activeView === "files" ? uploadTask : null)
```

Update `DriveViewNavigation` props so it accepts an optional action:

```tsx
<DriveViewNavigation
  path={activePath}
  statusBadge={activeStatusBadge}
  uploadStatusBadge={uploadStatusBadge}
  onUploadStatusClick={() => setUploadPanelOpen(true)}
  onJumpToPath={jumpToPath}
/>
```

Inside `DriveViewNavigation`, render upload status as a small outline `Button` instead of a passive `Badge`:

```tsx
{uploadStatusBadge ? (
  <Button
    type="button"
    size="sm"
    variant={uploadStatusBadge.tone === "destructive" ? "destructive" : "outline"}
    aria-label={uploadStatusBadge.ariaLabel}
    onClick={onUploadStatusClick}
  >
    {uploadStatusBadge.label}
  </Button>
) : null}
```

If the existing destructive `Button` variant is visually too strong for the top row, use `variant="outline"` and `className="text-destructive"` without adding custom colors.

- [ ] **Step 6: Render panel and retry failed items**

Add inside `afterContent`:

```tsx
<DriveUploadTaskPanel
  open={uploadPanelOpen}
  onOpenChange={setUploadPanelOpen}
  task={uploadTask}
  onRetryFailed={() => {
    const retryRequest = uploadTask ? buildDriveUploadRetryRequest(uploadTask) : null
    if (!retryRequest) return
    void runLocalUpload(async () => ({ request: retryRequest, skipped: 0 }))
  }}
/>
```

Make sure retry uses the original `parentId` from the retry request and does not use the currently viewed folder.

- [ ] **Step 7: Run integration tests**

Run:

```bash
pnpm --filter @synapse/desktop vitest run desktop/src/modules/drive/__tests__/drive-module.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

Run:

```bash
git add desktop/src/modules/drive/index.tsx desktop/src/modules/drive/__tests__/drive-module.test.tsx
git commit -m "feat: show drive upload task progress"
```

---

### Task 5: Polish, Release Note, and Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`
- Inspect and possibly modify files touched in Tasks 1-4 only if tests or typecheck require it.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: final verified feature and release note.

- [ ] **Step 1: Add release note**

Add this bullet under `## 功能优化` in `RELEASE_NOTES_PENDING.md`:

```md
- 云盘上传新增任务面板，批量上传时可以查看目标位置、文件列表、整体进度和失败项。
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop vitest run desktop/src/modules/drive/__tests__/drive-upload-task.test.ts desktop/src/modules/drive/__tests__/drive-upload-task-panel.test.tsx desktop/src/modules/drive/__tests__/drive-module.test.tsx desktop/electron/modules/account/__tests__/ipc.test.ts desktop/electron/services/__tests__/account-service.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run IPC codegen check**

Run:

```bash
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: PASS.

- [ ] **Step 5: Inspect final diff for UI discipline**

Run:

```bash
rg -n "style=\\{|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|bg-\\[|text-\\[|shadow-.*border|console\\.log" desktop/src/modules/drive desktop/electron/modules/account desktop/electron/services/account-service.ts
```

Expected: no matches for new code. If matches are from pre-existing code, leave them unchanged and mention them in the final implementation summary.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note drive upload task panel"
```

---

## Self-Review

- Spec coverage: The plan covers the status entry point, right-side Sheet, file statuses, large upload list, renderer task model, account progress events, retry failed items, accessibility labels, tests, and release note.
- Scope check: The plan does not add global upload history, pause/resume, byte speed, remaining time, storage changes, or new dependencies.
- Type consistency: `DriveLocalUploadProgressEvent`, `DriveUploadTask`, `taskId`, `onDriveLocalUploadProgress`, `buildDriveUploadRetryRequest`, and `finishDriveUploadTask` are defined before later tasks consume them.
- Placeholder scan: The task steps use concrete paths, commands, interfaces, and code examples with no open-ended placeholder sections.
