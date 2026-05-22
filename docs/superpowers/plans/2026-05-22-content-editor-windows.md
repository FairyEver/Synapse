# Content Editor Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Rule, Skill, and Prompt create/edit flows from in-page dialogs into dedicated editor windows with a full-window editor layout.

**Architecture:** Extend the existing content window system from detail-only windows to detail/create/edit window kinds. Keep the current content form hooks, validation, icon handling, and Skill attachment logic, but render them inside a new `ContentEditorWindowPage` shell. Use saved `content.changed` events to refresh the main window after saves from standalone windows.

**Tech Stack:** Electron BrowserWindow, React, TypeScript, shadcn/Radix UI, Tailwind token classes, Vitest.

---

## File Structure

- Modify `desktop/src/types/content.ts`: add create/edit window payload and request types.
- Modify `desktop/src/lib/content-window.ts`: build/parse detail/create/edit window query params.
- Add `desktop/src/lib/__tests__/content-window.test.ts`: URL builder/parser tests.
- Modify `desktop/electron/services/content-window-service.ts`: manage detail/create/edit windows and bounds.
- Modify `desktop/electron/services/__tests__/content-window-service.test.ts`: singleton and bounds tests.
- Modify `desktop/electron/modules/content/ipc.ts`: add create/edit open handlers and emit `content.changed` for saved create/update mutations.
- Modify `desktop/electron/modules/content/__tests__/ipc.test.ts`: saved/conflict event tests and new open handlers.
- Modify `desktop/electron/preload.ts`: expose `openCreateWindow` and `openEditWindow`.
- Modify `desktop/src/types/bridge.ts`: type new bridge methods.
- Modify `desktop/src/app-shell/content.ts`: add renderer wrappers for new bridge methods.
- Add editor init payload plumbing keyed by `requestId` so quick-publish create/edit data is not encoded into URLs.
- Modify `desktop/src/App.tsx`: route standalone content windows by request kind.
- Add `desktop/src/modules/content/components/content-window-page.tsx`: small dispatcher for detail vs editor windows.
- Add `desktop/src/modules/content/components/content-editor-window-page.tsx`: shared editor window page.
- Add `desktop/src/modules/content/components/content-editor-window-layout.tsx`: shell layout for left/center/right/action bar.
- Add `desktop/src/modules/content/components/content-editor-fields.tsx`: reusable Rule/Prompt/Skill field sections.
- Modify `desktop/src/modules/content/create-content-module.tsx`: main create opens create window instead of dialog.
- Modify `desktop/src/modules/content/components/content-browser-page.tsx`: edit-overwrite requests open edit windows instead of detail dialog prefill.
- Modify `desktop/src/modules/content/components/content-detail-window-page.tsx`: edit action opens edit window and closes detail only after success.
- Modify `desktop/src/modules/content/__tests__/content-detail-window-architecture.test.ts`: update architecture assertions.
- Modify `desktop/src/modules/content/__tests__/content-browser-page-overwrite.test.ts`: update overwrite routing assertions.
- Add `desktop/src/modules/content/__tests__/content-editor-window-page.test.tsx`: editor save behavior tests.

## Task 1: Window Request Types And URL Parser

**Files:**
- Modify: `desktop/src/types/content.ts`
- Modify: `desktop/src/lib/content-window.ts`
- Create: `desktop/src/lib/__tests__/content-window.test.ts`

- [ ] **Step 1: Add failing URL parser tests**

Add `desktop/src/lib/__tests__/content-window.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  buildContentCreateWindowSearchParams,
  buildContentDetailWindowSearchParams,
  buildContentEditWindowSearchParams,
  parseContentWindowRequest,
} from "@/lib/content-window"

describe("content-window request parsing", () => {
  it("round-trips a detail window request", () => {
    const params = buildContentDetailWindowSearchParams({
      contentType: "rule",
      id: "rule-1",
      title: "Rule One",
      viewMode: "source",
    })

    expect(parseContentWindowRequest(`?${params.toString()}`)).toEqual({
      kind: "detail",
      contentType: "rule",
      id: "rule-1",
      viewMode: "source",
    })
  })

  it("round-trips a create window request", () => {
    const params = buildContentCreateWindowSearchParams({
      contentType: "skill",
      title: "新建 Skill",
    })

    expect(parseContentWindowRequest(`?${params.toString()}`)).toEqual({
      kind: "create",
      contentType: "skill",
    })
  })

  it("round-trips an edit window request", () => {
    const params = buildContentEditWindowSearchParams({
      contentType: "prompt",
      id: "prompt-1",
      origin: "detail",
      title: "编辑提示词",
    })

    expect(parseContentWindowRequest(`?${params.toString()}`)).toEqual({
      kind: "edit",
      contentType: "prompt",
      id: "prompt-1",
      origin: "detail",
    })
  })

  it("rejects content windows without a supported kind", () => {
    expect(parseContentWindowRequest("?synapseWindow=content&windowKind=preview&contentType=rule&id=x")).toBeNull()
  })
})
```

- [ ] **Step 2: Run the focused parser test and confirm it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/content-window.test.ts
```

Expected: FAIL because the new builder functions are not exported.

- [ ] **Step 3: Add content window request types**

In `desktop/src/types/content.ts`, replace the current detail-only window payload/request area with:

```ts
export type SynapseOpenContentDetailWindowPayload = {
  contentType: SynapseContentType
  id: string
  title: string
  viewMode: SynapseContentViewMode
}

export type SynapseOpenContentCreateWindowPayload = {
  contentType: SynapseContentType
  initialValue?: SynapseCreateContentPayload | null
  notices?: SynapseContentWindowNotice[]
  requestId?: string
  sourceLabel?: string | null
  title: string
}

export type SynapseOpenContentEditWindowPayload = {
  contentType: SynapseContentType
  id: string
  prefill?: EditOverwriteRulePrefill | EditOverwriteSkillPrefill | null
  requestId?: string
  origin: "detail" | "external"
  sourceLabel?: string | null
  title: string
}

export type SynapseOpenContentWindowPayload = SynapseOpenContentDetailWindowPayload

export type SynapseContentWindowNotice = {
  id: string
  message: string
}

export type SynapseContentWindowRequest =
  | {
      kind: "detail"
      contentType: SynapseContentType
      id: string
      viewMode: SynapseContentViewMode
    }
  | {
      kind: "create"
      contentType: SynapseContentType
      requestId?: string
    }
  | {
      kind: "edit"
      contentType: SynapseContentType
      id: string
      origin: "detail" | "external"
      requestId?: string
    }
```

Keep the `SynapseOpenContentWindowPayload` alias for existing detail callers during migration.

- [ ] **Step 4: Implement URL builder/parser functions**

In `desktop/src/lib/content-window.ts`, keep `CONTENT_WINDOW_KIND_PARAM`, but change the window discriminator to use `synapseWindow=content` and `windowKind`.

Use this implementation shape:

```ts
const CONTENT_WINDOW_KIND = "content"
const CONTENT_WINDOW_KIND_PARAM = "synapseWindow"

function normalizeWindowKind(value: string | null): "detail" | "create" | "edit" | null {
  if (value === "detail" || value === "create" || value === "edit") {
    return value
  }
  return null
}

function normalizeEditOrigin(value: string | null): "detail" | "external" {
  return value === "external" ? "external" : "detail"
}
```

Export:

```ts
function buildContentDetailWindowSearchParams(payload: SynapseOpenContentDetailWindowPayload): URLSearchParams
function buildContentCreateWindowSearchParams(payload: SynapseOpenContentCreateWindowPayload): URLSearchParams
function buildContentEditWindowSearchParams(payload: SynapseOpenContentEditWindowPayload): URLSearchParams
function buildContentWindowSearchParams(payload: SynapseOpenContentWindowPayload): URLSearchParams
function parseContentWindowRequest(search: string): SynapseContentWindowRequest | null
```

`buildContentWindowSearchParams` should call `buildContentDetailWindowSearchParams` to preserve existing callers.

- [ ] **Step 5: Run parser tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/content-window.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add desktop/src/types/content.ts desktop/src/lib/content-window.ts desktop/src/lib/__tests__/content-window.test.ts
git commit -m "feat: add content editor window requests"
```

## Task 2: Main Process Window Service And IPC

**Files:**
- Modify: `desktop/electron/services/content-window-service.ts`
- Modify: `desktop/electron/services/__tests__/content-window-service.test.ts`
- Modify: `desktop/electron/modules/content/ipc.ts`
- Modify: `desktop/electron/modules/content/__tests__/ipc.test.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/src/app-shell/content.ts`

- [ ] **Step 1: Add failing content window service tests**

Append to `desktop/electron/services/__tests__/content-window-service.test.ts`:

```ts
it("uses one create window per content type", async () => {
  const webContents = { on: vi.fn(), loadURL: vi.fn() }
  const window = {
    webContents,
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    once: vi.fn(),
    on: vi.fn(),
    show: vi.fn(),
  }
  const createWindow = vi.fn(() => window as never)
  const loadWindow = vi.fn(async () => undefined)
  const service = createContentWindowService({
    createWindow,
    createHealthService: vi.fn(() => ({ attach: vi.fn(), detach: vi.fn() })),
    getAppPath: () => "/app",
    getIconPath: () => null,
    getPreloadPath: () => "/preload.js",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    loadWindow,
  })

  await service.openCreateWindow({ contentType: "rule", title: "新建 Rule" })
  await service.openCreateWindow({ contentType: "rule", title: "新建 Rule" })

  expect(createWindow).toHaveBeenCalledTimes(1)
  expect(window.focus).toHaveBeenCalledTimes(1)
})

it("uses one edit window per content item", async () => {
  const webContents = { on: vi.fn(), loadURL: vi.fn() }
  const window = {
    webContents,
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    once: vi.fn(),
    on: vi.fn(),
    show: vi.fn(),
  }
  const createWindow = vi.fn(() => window as never)
  const loadWindow = vi.fn(async () => undefined)
  const service = createContentWindowService({
    createWindow,
    createHealthService: vi.fn(() => ({ attach: vi.fn(), detach: vi.fn() })),
    getAppPath: () => "/app",
    getIconPath: () => null,
    getPreloadPath: () => "/preload.js",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    loadWindow,
  })

  await service.openEditWindow({ contentType: "skill", id: "skill-1", origin: "detail", title: "编辑 Skill" })
  await service.openEditWindow({ contentType: "skill", id: "skill-1", origin: "detail", title: "编辑 Skill" })

  expect(createWindow).toHaveBeenCalledTimes(1)
  expect(window.focus).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run service tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/content-window-service.test.ts
```

Expected: FAIL because `openCreateWindow` and `openEditWindow` do not exist.

- [ ] **Step 3: Implement create/edit window methods**

In `desktop/electron/services/content-window-service.ts`:

- Import the new payload types.
- Add bounds:

```ts
const CONTENT_EDITOR_WINDOW_BOUNDS_BY_TYPE = {
  prompt: { width: 1120, height: 760, minWidth: 960, minHeight: 640 },
  rule: { width: 1120, height: 760, minWidth: 960, minHeight: 640 },
  skill: { width: 1280, height: 820, minWidth: 1120, minHeight: 680 },
} as const
```

- Replace `windowsByContent` with `windowsByKey`.
- Add key helpers:

```ts
function createDetailWindowKey(payload: SynapseOpenContentDetailWindowPayload): string {
  return `detail:${payload.contentType}:${payload.id}`
}

function createCreateWindowKey(payload: SynapseOpenContentCreateWindowPayload): string {
  return `create:${payload.contentType}`
}

function createEditWindowKey(payload: SynapseOpenContentEditWindowPayload): string {
  return `edit:${payload.contentType}:${payload.id}`
}
```

- Add shared `openManagedWindow` that creates BrowserWindow, attaches health, loads window, focuses existing windows, and deletes the correct key on `closed`.
- Keep `openDetailWindow` behavior by delegating to `openManagedWindow`.
- Add `openCreateWindow` and `openEditWindow`.
- When `payload.requestId` is present, store the full payload in a `pendingEditorPayloads` map keyed by request id before loading the window.
- Add `readPendingEditorPayload(requestId)` that returns the stored payload and deletes it after the first read.

- [ ] **Step 4: Add IPC handlers**

In `desktop/electron/modules/content/ipc.ts`:

- Import new payload types.
- Add methods:

```ts
openCreateWindow: {
  kind: "invoke",
  channel: "synapse:content:open-create-window",
  request: unknownRequestSchema,
  response: z.void(),
  handler: async (_ctx, payload: SynapseOpenContentCreateWindowPayload) => {
    await contentWindowService.openCreateWindow(payload)
  },
},
openEditWindow: {
  kind: "invoke",
  channel: "synapse:content:open-edit-window",
  request: unknownRequestSchema,
  response: z.void(),
  handler: async (_ctx, payload: SynapseOpenContentEditWindowPayload) => {
    await contentWindowService.openEditWindow(payload)
  },
},
readEditorInitPayload: {
  kind: "invoke",
  channel: "synapse:content:read-editor-init-payload",
  request: z.object({ requestId: z.string() }),
  response: z.unknown(),
  handler: async (_ctx, payload: { requestId: string }) => {
    return contentWindowService.readPendingEditorPayload(payload.requestId) ?? null
  },
},
```

- [ ] **Step 5: Emit content.changed for create/update**

In `desktop/electron/modules/content/ipc.ts`, add:

```ts
function emitContentChanged(
  eventBus: EventBus,
  operation: SynapseContentMutationOperation,
  result: SynapseContentMutationResult,
): void {
  if (result.status !== "saved") {
    return
  }

  eventBus.emit({
    domain: "content",
    type: "content.changed",
    payload: {
      contentType: result.type,
      contentId: result.id,
      operation,
      latestHistoryDirname: result.latestHistoryDirname,
      modifiedAt: result.modifiedAt,
    },
    timestamp: new Date().toISOString(),
  })
}
```

Call it after saved create and update results:

```ts
emitContentChanged(eventBus, "create", result)
emitContentChanged(eventBus, "update", result)
```

- [ ] **Step 6: Expose bridge methods**

In `desktop/electron/preload.ts`, add channels:

```ts
"openCreateWindow": "synapse:content:open-create-window",
"openEditWindow": "synapse:content:open-edit-window",
"readEditorInitPayload": "synapse:content:read-editor-init-payload",
```

Expose methods:

```ts
openCreateWindow: invoke(IPC_CHANNELS.content.openCreateWindow),
openEditWindow: invoke(IPC_CHANNELS.content.openEditWindow),
readEditorInitPayload: invoke(IPC_CHANNELS.content.readEditorInitPayload),
```

In `desktop/src/types/bridge.ts`, add:

```ts
openCreateWindow: (payload: SynapseOpenContentCreateWindowPayload) => Promise<void>
openEditWindow: (payload: SynapseOpenContentEditWindowPayload) => Promise<void>
readEditorInitPayload: (payload: { requestId: string }) => Promise<SynapseOpenContentCreateWindowPayload | SynapseOpenContentEditWindowPayload | null>
```

In `desktop/src/app-shell/content.ts`, add wrappers:

```ts
async function openContentCreateWindow(payload: SynapseOpenContentCreateWindowPayload): Promise<void> {
  return requireContentBridge().openCreateWindow(payload)
}

async function openContentEditWindow(payload: SynapseOpenContentEditWindowPayload): Promise<void> {
  return requireContentBridge().openEditWindow(payload)
}

async function readContentEditorInitPayload(
  requestId: string,
): Promise<SynapseOpenContentCreateWindowPayload | SynapseOpenContentEditWindowPayload | null> {
  return requireContentBridge().readEditorInitPayload({ requestId })
}
```

Export all three wrappers.

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/content-window-service.test.ts electron/modules/content/__tests__/ipc.test.ts
```

Expected: PASS after test updates.

- [ ] **Step 8: Commit Task 2**

```bash
git add desktop/electron/services/content-window-service.ts desktop/electron/services/__tests__/content-window-service.test.ts desktop/electron/modules/content/ipc.ts desktop/electron/modules/content/__tests__/ipc.test.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/src/app-shell/content.ts
git commit -m "feat: manage content create and edit windows"
```

## Task 3: Editor Window Layout And Field Sections

**Files:**
- Create: `desktop/src/modules/content/components/content-editor-window-layout.tsx`
- Create: `desktop/src/modules/content/components/content-editor-fields.tsx`
- Create: `desktop/src/modules/content/components/content-editor-window-page.tsx`
- Create: `desktop/src/modules/content/components/content-window-page.tsx`
- Modify: `desktop/src/App.tsx`

- [ ] **Step 1: Add failing renderer page test**

Create `desktop/src/modules/content/__tests__/content-editor-window-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContentEditorWindowLayout } from "../components/content-editor-window-layout"

describe("ContentEditorWindowLayout", () => {
  it("renders metadata, body, auxiliary, and footer regions", () => {
    render(
      <ContentEditorWindowLayout
        title="编辑 Rule"
        meta={<label>标题</label>}
        body={<label>正文</label>}
        auxiliary={<label>预览</label>}
        footer={<button type="button">保存</button>}
      />,
    )

    expect(screen.getByRole("heading", { name: "编辑 Rule" })).toBeInTheDocument()
    expect(screen.getByText("标题")).toBeInTheDocument()
    expect(screen.getByText("正文")).toBeInTheDocument()
    expect(screen.getByText("预览")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run layout test and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/content/__tests__/content-editor-window-page.test.tsx
```

Expected: FAIL because `content-editor-window-layout` does not exist.

- [ ] **Step 3: Implement editor layout shell**

Create `desktop/src/modules/content/components/content-editor-window-layout.tsx`:

```tsx
import type { ReactNode } from "react"

type ContentEditorWindowLayoutProps = {
  auxiliary: ReactNode
  body: ReactNode
  footer: ReactNode
  meta: ReactNode
  title: string
}

function ContentEditorWindowLayout({
  auxiliary,
  body,
  footer,
  meta,
  title,
}: ContentEditorWindowLayoutProps) {
  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <header className="border-b px-4 py-3">
        <h1 className="text-base font-medium">{title}</h1>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-[18rem_minmax(0,1fr)_22rem] overflow-hidden">
        <aside className="min-h-0 overflow-auto border-r p-4">
          {meta}
        </aside>
        <section className="min-h-0 overflow-hidden p-4">
          {body}
        </section>
        <aside className="min-h-0 overflow-auto border-l p-4">
          {auxiliary}
        </aside>
      </main>
      <footer className="border-t px-4 py-3">
        {footer}
      </footer>
    </div>
  )
}

export { ContentEditorWindowLayout }
```

This uses only theme token classes and layout utilities.

- [ ] **Step 4: Implement field sections**

Create `desktop/src/modules/content/components/content-editor-fields.tsx`.

Export:

```tsx
export type ContentEditorFieldErrors = Record<string, string | undefined>

export function ContentEditorMetaFields(...)
export function ContentEditorBodyField(...)
export function SkillAttachmentManager(...)
export function ContentPreviewPanel(...)
```

Move field JSX from `RuleCreateDialog`, `PromptCreateDialog`, and `SkillCreateDialog` into these reusable sections without changing labels, validation keys, or handlers.

Use `Field`, `FieldLabel`, `FieldContent`, `FieldError`, `Input`, `Textarea`, `Select`, `ScrollArea`, `Button`, `Label`, `MarkdownViewer`, and `ContentAppearanceFields`.

- [ ] **Step 5: Implement editor page**

Create `desktop/src/modules/content/components/content-editor-window-page.tsx`.

The page should:

- Accept `request: Extract<SynapseContentWindowRequest, { kind: "create" | "edit" }>`.
- Use the existing `useContentCreateForm` with the correct config by content type.
- In create mode, build empty initial values from existing helpers.
- In edit mode, read detail, build initial values, and save with `baseHistoryDirname`.
- For Skill save, call `serializeCreateSkillFiles`.
- Use `ContentEditorWindowLayout`.
- Use `window.close()` only after save success behavior finishes.
- On edit success with `origin === "detail"`, call `openContentDetailWindow` before closing.

- [ ] **Step 6: Add content window dispatcher**

Create `desktop/src/modules/content/components/content-window-page.tsx`:

```tsx
import { ContentDetailWindowPage } from "@/modules/content/components/content-detail-window-page"
import { ContentEditorWindowPage } from "@/modules/content/components/content-editor-window-page"
import type { SynapseContentWindowRequest } from "@/types/content"

function ContentWindowPage({ request }: { request: SynapseContentWindowRequest }) {
  if (request.kind === "detail") {
    return <ContentDetailWindowPage request={request} />
  }

  return <ContentEditorWindowPage request={request} />
}

export { ContentWindowPage }
```

- [ ] **Step 7: Route standalone windows through dispatcher**

In `desktop/src/App.tsx`:

- Replace `ContentDetailWindowPage` import with `ContentWindowPage`.
- Render:

```tsx
<ContentWindowPage request={standaloneContentWindowRequest} />
```

Use fallback title `内容窗口出现问题`.

- [ ] **Step 8: Run focused renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/content/__tests__/content-editor-window-page.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add desktop/src/modules/content/components/content-editor-window-layout.tsx desktop/src/modules/content/components/content-editor-fields.tsx desktop/src/modules/content/components/content-editor-window-page.tsx desktop/src/modules/content/components/content-window-page.tsx desktop/src/modules/content/__tests__/content-editor-window-page.test.tsx desktop/src/App.tsx
git commit -m "feat: add content editor window page"
```

## Task 4: Migrate Main Create And Detail Edit Entrypoints

**Files:**
- Modify: `desktop/src/modules/content/create-content-module.tsx`
- Modify: `desktop/src/modules/content/components/content-browser-page.tsx`
- Modify: `desktop/src/modules/content/components/content-detail-window-page.tsx`
- Modify: `desktop/src/modules/content/__tests__/content-detail-window-architecture.test.ts`
- Modify: `desktop/src/modules/content/__tests__/content-browser-page-overwrite.test.ts`

- [ ] **Step 1: Update architecture tests for new entrypoints**

In `desktop/src/modules/content/__tests__/content-detail-window-architecture.test.ts`, replace the edit dialog assertion with:

```ts
it("opens edit actions in a dedicated editor window", () => {
  const source = readFileSync(detailWindowPageSourcePath, "utf8")
  const layoutSource = readFileSync(join(__dirname, "../components/content-detail-window-layout.tsx"), "utf8")

  expect(source).toContain("openContentEditWindow")
  expect(source).toContain("handleEdit")
  expect(source).toContain("window.close()")
  expect(source).not.toContain("RuleCreateDialog")
  expect(source).not.toContain("PromptCreateDialog")
  expect(source).not.toContain("SkillCreateDialog")
  expect(layoutSource).toContain("canEdit={canEdit}")
  expect(layoutSource).toContain("onEdit={onEdit}")
})
```

In `desktop/src/modules/content/__tests__/content-browser-page-overwrite.test.ts`, replace overwrite dialog expectations with:

```ts
expect(source).toContain("openContentEditWindow")
expect(source).toContain('request.kind === "detail" || request.kind === "edit-overwrite"')
expect(source).not.toContain("setOverwritePrefill")
```

- [ ] **Step 2: Run updated architecture tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/content/__tests__/content-detail-window-architecture.test.ts src/modules/content/__tests__/content-browser-page-overwrite.test.ts
```

Expected: FAIL because old dialog entrypoints still exist.

- [ ] **Step 3: Migrate main create**

In `desktop/src/modules/content/create-content-module.tsx`:

- Remove `CreateDialog` from active render path.
- Keep `CreateDialog` on `ContentModuleConfig` during this task so `rules/index.tsx`, `skills/index.tsx`, and `prompts/index.tsx` keep compiling until Task 6 removes it.
- Import `openContentCreateWindow`.
- In `onCreateClick`, call:

```ts
void openContentCreateWindow({
  contentType: config.contentType,
  title: `新建 ${definition.singularLabel}`,
}).catch((error) => {
  logger.error("Failed to open content create window.", {
    contentType: config.contentType,
    error,
  })
  notifyError(error instanceof Error ? error.message : "打开新建窗口失败。")
})
```

Use `const { error: notifyError } = useAppNotifications()` near the existing notification hook. Do not close or hide the main window.

- [ ] **Step 4: Migrate detail edit**

In `desktop/src/modules/content/components/content-detail-window-page.tsx`:

- Remove `useContentWindowEditState`.
- Remove `RuleCreateDialog`, `PromptCreateDialog`, and `SkillCreateDialog` imports.
- Add `openContentEditWindow`.
- Add per page `handleEdit`:

```ts
const handleEdit = useCallback(async () => {
  const detail = detailState.detail
  if (!detail || !canEditContentDetail(detail)) {
    return
  }

  try {
    await openContentEditWindow({
      contentType: detail.type,
      id: detail.id,
      origin: "detail",
      title: `编辑 ${detail.title}`,
    })
    window.close()
  } catch (error) {
    logger.error("Failed to open content edit window.", {
      contentId: detail.id,
      contentType: detail.type,
      error,
    })
    notifyWarning(error instanceof Error ? error.message : "打开编辑窗口失败。")
  }
}, [detailState.detail, logger, notifyWarning])
```

Use `const { warning: notifyWarning } = useAppNotifications()`.

- [ ] **Step 5: Migrate edit-overwrite**

In `desktop/src/modules/content/components/content-browser-page.tsx`:

- Remove `overwritePrefill` state and render prop plumbing.
- On `request.kind === "edit-overwrite"`, call:

```ts
await openContentEditWindow({
  contentType,
  id: item.id,
  origin: "external",
  prefill: request.prefill,
  requestId: request.requestId,
  sourceLabel: request.sourceLabel,
  title: `编辑 ${item.title}`,
})
```

- Keep the refresh-on-missing behavior.
- Keep `void addRecentlyViewed(contentType, item.id)`.
- The full prefill payload is stored by the main-process pending editor payload map introduced in Task 2.

- [ ] **Step 6: Run focused architecture tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/content/__tests__/content-detail-window-architecture.test.ts src/modules/content/__tests__/content-browser-page-overwrite.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add desktop/src/modules/content/create-content-module.tsx desktop/src/modules/content/components/content-browser-page.tsx desktop/src/modules/content/components/content-detail-window-page.tsx desktop/src/modules/content/__tests__/content-detail-window-architecture.test.ts desktop/src/modules/content/__tests__/content-browser-page-overwrite.test.ts
git commit -m "feat: open content editors from create and edit actions"
```

## Task 5: Save Flows, Conflict Handling, And External Prefill

**Files:**
- Modify: `desktop/src/modules/content/components/content-editor-window-page.tsx`
- Modify: `desktop/src/app-shell/content-navigation.ts`
- Modify: `desktop/src/app-shell/content.ts`
- Modify: `desktop/src/modules/content/components/content-browser-page.tsx`
- Modify: `desktop/src/modules/content/__tests__/content-editor-window-page.test.tsx`

- [ ] **Step 1: Add behavior tests for save outcomes**

Extend `desktop/src/modules/content/__tests__/content-editor-window-page.test.tsx` with tests asserting source strings:

```ts
import { readFile } from "node:fs/promises"

it("keeps edit windows open on conflict and opens detail after saved edit", async () => {
  const source = await readFile(
    new URL("../components/content-editor-window-page.tsx", import.meta.url),
    "utf8",
  )

  expect(source).toContain('result.status === "conflict"')
  expect(source).toContain("openContentDetailWindow")
  expect(source).toContain("window.close()")
})

it("serializes Skill files before saving", async () => {
  const source = await readFile(
    new URL("../components/content-editor-window-page.tsx", import.meta.url),
    "utf8",
  )

  expect(source).toContain("serializeCreateSkillFiles")
})
```

- [ ] **Step 2: Run save behavior tests and confirm failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/content/__tests__/content-editor-window-page.test.tsx
```

Expected: FAIL until the editor page implements these branches.

- [ ] **Step 3: Implement save branches**

In `ContentEditorWindowPage`:

- Build `submitPayload` from prepared form.
- For create:

```ts
const result = await createContent(request.contentType, finalPayload)
if (result.status === "saved") {
  window.close()
  return
}
```

- For edit:

```ts
const result = await updateContent(request.contentType, {
  ...finalPayload,
  id: detail.id,
  baseHistoryDirname: detail.latestHistoryDirname,
})

if (result.status === "conflict") {
  setSubmitError("内容已更新，请刷新后再编辑。")
  return
}

if (request.origin === "detail") {
  await openContentDetailWindow({
    contentType: request.contentType,
    id: result.id,
    title: result.title,
    viewMode: "rendered",
  })
}

window.close()
```

- Keep the window open on thrown errors.

- [ ] **Step 4: Read external prefill from the pending payload store**

In `ContentEditorWindowPage`, when `request.requestId` exists:

```ts
const initPayload = await readContentEditorInitPayload(request.requestId)
```

Use `initPayload.initialValue` for create windows and `initPayload.prefill` for edit windows. Apply Rule overwrite prefill by replacing `content`. Apply Skill overwrite prefill by replacing `content` and `files`.

In `desktop/src/app-shell/content-navigation.ts`, keep the existing `ContentOpenRequest` union so editor scan can continue dispatching the same requests. The main window now turns those requests into `openContentCreateWindow` or `openContentEditWindow` calls that carry `requestId`, `initialValue`, `prefill`, `notices`, and `sourceLabel`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/content/__tests__/content-editor-window-page.test.tsx src/modules/content/__tests__/content-browser-page-overwrite.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add desktop/src/modules/content/components/content-editor-window-page.tsx desktop/src/app-shell/content-navigation.ts desktop/src/app-shell/content.ts desktop/src/modules/content/components/content-browser-page.tsx desktop/src/modules/content/__tests__/content-editor-window-page.test.tsx desktop/src/modules/content/__tests__/content-browser-page-overwrite.test.ts
git commit -m "feat: complete content editor save flows"
```

## Task 6: Remove Obsolete Dialog Plumbing And Verify

**Files:**
- Modify: `desktop/src/modules/rules/index.tsx`
- Modify: `desktop/src/modules/skills/index.tsx`
- Modify: `desktop/src/modules/prompts/index.tsx`
- Modify: `desktop/src/modules/rules/components/rule-detail-dialog.tsx`
- Modify: `desktop/src/modules/skills/components/skill-detail-dialog.tsx`
- Modify: `desktop/src/modules/prompts/components/prompt-detail-dialog.tsx`
- Modify: `desktop/src/modules/content/create-content-module.tsx`

- [ ] **Step 1: Remove create dialog dependency from module config**

In `create-content-module.tsx`, remove `CreateDialog` from `ContentModuleConfig` once main create no longer renders it.

Update `rules/index.tsx`, `skills/index.tsx`, and `prompts/index.tsx` so they no longer pass `CreateDialog`.

- [ ] **Step 2: Remove unused in-page content detail dialog plumbing**

Run:

```bash
rg -n "RuleDetailDialog|SkillDetailDialog|PromptDetailDialog|ContentDetailDialog" desktop/src/modules desktop/src/App.tsx
```

If the only remaining imports are from module index files touched in Step 1, delete those imports and remove the files:

```bash
git rm desktop/src/modules/rules/components/rule-detail-dialog.tsx desktop/src/modules/skills/components/skill-detail-dialog.tsx desktop/src/modules/prompts/components/prompt-detail-dialog.tsx
```

If `ContentDetailDialog` is no longer imported after those removals, delete `desktop/src/modules/content/components/content-detail-dialog.tsx` in the same commit. Keep any file that still has a non-test production import.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run focused content tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/content-window.test.ts electron/services/__tests__/content-window-service.test.ts electron/modules/content/__tests__/ipc.test.ts src/modules/content/__tests__/content-editor-window-page.test.tsx src/modules/content/__tests__/content-detail-window-architecture.test.ts src/modules/content/__tests__/content-browser-page-overwrite.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add desktop/src/modules/content/create-content-module.tsx desktop/src/modules/rules/index.tsx desktop/src/modules/skills/index.tsx desktop/src/modules/prompts/index.tsx desktop/src/modules/rules/components/rule-detail-dialog.tsx desktop/src/modules/skills/components/skill-detail-dialog.tsx desktop/src/modules/prompts/components/prompt-detail-dialog.tsx
git commit -m "refactor: remove content editor dialog plumbing"
```

## Final Verification

- [ ] **Step 1: Run full desktop tests**

```bash
pnpm --filter @synapse/desktop run test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Inspect diff**

```bash
git status --short
git diff --stat HEAD
```

Expected: only files related to content editor windows are changed after the task commits.

## Self-Review Notes

- Spec coverage: create windows, edit windows, detail-close-after-success, save return behavior, singleton behavior, content changed refresh, shadcn layout, and tests are each covered by tasks.
- Placeholder scan: the plan contains no deferred implementation sections.
- Type consistency: `SynapseOpenContentDetailWindowPayload`, `SynapseOpenContentCreateWindowPayload`, `SynapseOpenContentEditWindowPayload`, and `SynapseContentWindowRequest` are introduced in Task 1 and reused consistently in later tasks.
