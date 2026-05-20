# Install Status Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show which editors have a skill/rule globally installed via compact icon badges on list cards, with click-to-uninstall.

**Architecture:** Main process maintains a global install status cache (Map<contentId, EditorId[]>) built from the existing `scanAll()` infrastructure. Changes are pushed to the renderer via the EventBus domain event system. Renderer holds state in a React Context, consumed by a new `EditorInstallBadges` component rendered at the bottom of each card.

**Tech Stack:** Electron IPC (invoke + domain events), React Context, shadcn Popover, existing `editorScan` service for scan data and `trashScanItem` for uninstall.

---

### Task 1: Add `install-status-cache` domain event type and IPC channels

**Files:**
- Modify: `desktop/electron/runtime/event-bus/types.ts:6-16` (add domain)
- Modify: `desktop/electron/preload.ts:21-195` (add IPC channels)
- Modify: `desktop/electron/preload.ts:197-206` (add event channel)
- Modify: `desktop/electron/preload.ts:307-621` (add bridge namespace)
- Modify: `desktop/src/types/bridge.ts:315-319` (add bridge type)

- [ ] **Step 1: Add "install-status" to EventDomain**

In `desktop/electron/runtime/event-bus/types.ts`, add `"install-status"` to the union:

```typescript
export type EventDomain =
  | "repository"
  | "content"
  | "update"
  | "database"
  | "agent"
  | "connector"
  | "scheduler"
  | "project"
  | "system"
  | "install-status"
```

- [ ] **Step 2: Add IPC channels to preload**

In `desktop/electron/preload.ts`, add to `IPC_CHANNELS`:

```typescript
"install-status": {
  "getAll": "synapse:install-status:get-all",
  "uninstall": "synapse:install-status:uninstall",
},
```

Add to `EVENT_CHANNELS`:

```typescript
installStatus: {
  changed: "synapse:events:install-status",
},
```

- [ ] **Step 3: Add bridge namespace to preload**

In the `synapseBridge` object, add after `editorInstallStatus`:

```typescript
installStatus: {
  getAll: invoke(IPC_CHANNELS["install-status"].getAll),
  uninstall: (payload: { contentId: string; editorId: string }) =>
    invoke(IPC_CHANNELS["install-status"].uninstall)(payload),
  onChanged: createDomainEventPayloadSubscription<InstallStatusChangedEvent>(
    subscribe,
    "install-status",
    "install-status.changed",
  ),
},
```

- [ ] **Step 4: Create the event payload type**

Create `desktop/src/types/install-status.ts`:

```typescript
import type { SynapseEditorId } from "./editor"

export type InstallStatusMap = Record<string, SynapseEditorId[]>

export type InstallStatusChangedEvent = {
  contentId: string
  editors: SynapseEditorId[]
}
```

- [ ] **Step 5: Add bridge type**

In `desktop/src/types/bridge.ts`, add the `installStatus` namespace to `SynapseBridge`:

```typescript
installStatus: {
  getAll: () => Promise<InstallStatusMap>
  uninstall: (payload: { contentId: string; editorId: string }) => Promise<void>
  onChanged: (listener: (payload: InstallStatusChangedEvent) => void) => Unsubscribe
}
```

Add the import at the top:

```typescript
import type { InstallStatusChangedEvent, InstallStatusMap } from "./install-status"
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit --pretty 2>&1 | head -30`

Expected: May have errors about missing IPC module handler (that's Task 2). Bridge and type errors should be clean.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/runtime/event-bus/types.ts desktop/electron/preload.ts desktop/src/types/install-status.ts desktop/src/types/bridge.ts
git commit -m "feat(install-status): add IPC channels, event domain, and bridge types"
```

---

### Task 2: Implement InstallStatusService (main process)

**Files:**
- Create: `desktop/electron/services/install-status-cache-service.ts`
- Create: `desktop/electron/modules/install-status/ipc.ts`
- Modify: `desktop/electron/runtime/ipc/module-registry.ts` (register module)

- [ ] **Step 1: Create the cache service**

Create `desktop/electron/services/install-status-cache-service.ts`:

```typescript
import type { SynapseEditorId } from "../../src/types/editor"
import type { InstallStatusMap } from "../../src/types/install-status"
import type { EditorScanGlobalResult } from "../../src/types/editor-scan"
import { scanAll } from "./editor-scan-service"
import { trashScanItem } from "./editor-scan-service"
import { createMainLogger } from "../runtime/log-store"

const logger = createMainLogger("install-status-cache")

let cache: Map<string, SynapseEditorId[]> = new Map()

async function buildCache(): Promise<void> {
  const scan = await scanAll()
  const next = new Map<string, SynapseEditorId[]>()

  for (const globalEntry of scan.global) {
    if (globalEntry.status !== "detected") continue

    for (const skill of globalEntry.skills) {
      if (!skill.synapseContentId) continue
      const existing = next.get(skill.synapseContentId) ?? []
      existing.push(globalEntry.editorId as SynapseEditorId)
      next.set(skill.synapseContentId, existing)
    }

    for (const rule of globalEntry.rules) {
      if (!rule.synapseContentId) continue
      const existing = next.get(rule.synapseContentId) ?? []
      existing.push(globalEntry.editorId as SynapseEditorId)
      next.set(rule.synapseContentId, existing)
    }
  }

  cache = next
  logger.info(`Cache built. ${cache.size} content items tracked.`)
}

function getAll(): InstallStatusMap {
  const result: InstallStatusMap = {}
  for (const [contentId, editors] of cache) {
    result[contentId] = editors
  }
  return result
}

function getForContent(contentId: string): SynapseEditorId[] {
  return cache.get(contentId) ?? []
}

async function refresh(contentId: string): Promise<SynapseEditorId[]> {
  const scan = await scanAll()
  const editors: SynapseEditorId[] = []

  for (const globalEntry of scan.global) {
    if (globalEntry.status !== "detected") continue

    const foundSkill = globalEntry.skills.find((s) => s.synapseContentId === contentId)
    const foundRule = globalEntry.rules.find((r) => r.synapseContentId === contentId)

    if (foundSkill || foundRule) {
      editors.push(globalEntry.editorId as SynapseEditorId)
    }
  }

  if (editors.length > 0) {
    cache.set(contentId, editors)
  } else {
    cache.delete(contentId)
  }

  return editors
}

export const installStatusCacheService = {
  buildCache,
  getAll,
  getForContent,
  refresh,
}
```

- [ ] **Step 2: Create the IPC module**

Create `desktop/electron/modules/install-status/ipc.ts`:

```typescript
import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type { EventBus } from "../../runtime/event-bus"
import type { AuditSink } from "../../runtime/audit/types"
import type { PermissionGuard } from "../../runtime/permission/types"
import { installStatusCacheService } from "../../services/install-status-cache-service"
import { trashScanItem } from "../../services/editor-scan-service"
import { scanAll } from "../../services/editor-scan-service"
import { createMainLogger } from "../../runtime/log-store"

const logger = createMainLogger("install-status-ipc")

const uninstallSchema = z.object({
  contentId: z.string(),
  editorId: z.string(),
})

export const installStatusIpcModule: IpcModule = {
  id: "install-status",
  methods: {
    getAll: {
      kind: "invoke",
      channel: "synapse:install-status:get-all",
      request: z.any(),
      response: z.any(),
      handler: async () => {
        return installStatusCacheService.getAll()
      },
    },
    uninstall: {
      kind: "invoke",
      channel: "synapse:install-status:uninstall",
      request: uninstallSchema,
      response: z.any(),
      handler: async (ctx, payload: { contentId: string; editorId: string }) => {
        const scan = await scanAll()
        const globalEntry = scan.global.find((e) => e.editorId === payload.editorId)
        if (!globalEntry) {
          throw new Error(`Editor ${payload.editorId} not found in scan`)
        }

        const skill = globalEntry.skills.find((s) => s.synapseContentId === payload.contentId)
        const rule = globalEntry.rules.find((r) => r.synapseContentId === payload.contentId)
        const item = skill ?? rule

        if (!item) {
          throw new Error(`Content ${payload.contentId} not found in editor ${payload.editorId}`)
        }

        await trashScanItem(
          {
            itemType: skill ? "skill" : "rule",
            itemName: item.name,
            itemPath: item.path,
            editorId: payload.editorId,
            scope: "global",
            source: item.synapseContentId ? "synapse" : "external",
            trash: item.trash,
            synapseContentId: item.synapseContentId,
          },
          {
            actor: { kind: "user" },
            auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
            permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
          },
        )

        const editors = await installStatusCacheService.refresh(payload.contentId)
        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        eventBus.emit({
          domain: "install-status",
          type: "install-status.changed",
          payload: { contentId: payload.contentId, editors },
          timestamp: new Date().toISOString(),
        })
      },
    },
  },
  events: {},
}
```

- [ ] **Step 3: Register the IPC module**

Find the module registry file and add the import + registration. Look for where other modules like `editorInstallStatusIpcModule` are registered:

```bash
grep -rn "editorInstallStatusIpcModule\|ipcModules\|registerModule" desktop/electron/runtime/ipc/ --include="*.ts" | head -10
```

Add to the module array:

```typescript
import { installStatusIpcModule } from "../../modules/install-status/ipc"
// ... in the modules array:
installStatusIpcModule,
```

- [ ] **Step 4: Initialize cache on app startup**

Find where the app initializes services (likely in `desktop/electron/main.ts` or a bootstrap file). Add cache initialization after the app is ready:

```typescript
import { installStatusCacheService } from "./services/install-status-cache-service"

// After app ready and services initialized:
await installStatusCacheService.buildCache()
```

- [ ] **Step 5: Emit event after installToEditor succeeds**

In `desktop/electron/modules/content/ipc.ts`, in the `installToEditor` handler (around line 436-448), after the install succeeds, refresh the cache and emit:

```typescript
installToEditor: {
  kind: "invoke",
  channel: "synapse:content:install-to-editor",
  request: anySchema,
  response: anySchema,
  handler: async (ctx, payload: SynapseInstallToEditorPayload) => {
    logger.info(`Handling content.installToEditor request. contentType: ${payload.contentType}, contentId: ${payload.contentId}, editorId: ${payload.editorId}, scope: ${payload.scope}`)
    const result = await contentInstallService.installToEditor(payload, {
      actor: { kind: "user" },
      auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
      permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
    })

    if (payload.scope === "global") {
      const editors = await installStatusCacheService.refresh(payload.contentId)
      const eventBus = ctx.resolve<EventBus>("core.event-bus")
      eventBus.emit({
        domain: "install-status",
        type: "install-status.changed",
        payload: { contentId: payload.contentId, editors },
        timestamp: new Date().toISOString(),
      })
    }

    return result
  },
},
```

Add import at top:

```typescript
import { installStatusCacheService } from "../../services/install-status-cache-service"
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit --pretty 2>&1 | head -40`

Expected: PASS (no type errors)

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/install-status-cache-service.ts desktop/electron/modules/install-status/ipc.ts desktop/electron/modules/content/ipc.ts
git commit -m "feat(install-status): add cache service and IPC module with uninstall support"
```

---

### Task 3: Renderer Context and Hook

**Files:**
- Create: `desktop/src/modules/content/contexts/install-status-context.tsx`

- [ ] **Step 1: Create the context provider and hook**

Create `desktop/src/modules/content/contexts/install-status-context.tsx`:

```typescript
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { SynapseEditorId } from "@/types/editor"
import type { InstallStatusMap } from "@/types/install-status"

type InstallStatusContextValue = {
  statusMap: InstallStatusMap
  uninstall: (contentId: string, editorId: SynapseEditorId) => Promise<void>
}

const InstallStatusContext = createContext<InstallStatusContextValue | null>(null)

function InstallStatusProvider({ children }: { children: ReactNode }) {
  const [statusMap, setStatusMap] = useState<InstallStatusMap>({})

  useEffect(() => {
    window.synapse.installStatus.getAll().then(setStatusMap)

    const unsubscribe = window.synapse.installStatus.onChanged((event) => {
      setStatusMap((prev) => {
        const next = { ...prev }
        if (event.editors.length > 0) {
          next[event.contentId] = event.editors
        } else {
          delete next[event.contentId]
        }
        return next
      })
    })

    return unsubscribe
  }, [])

  async function uninstall(contentId: string, editorId: SynapseEditorId): Promise<void> {
    await window.synapse.installStatus.uninstall({ contentId, editorId })
  }

  return (
    <InstallStatusContext.Provider value={{ statusMap, uninstall }}>
      {children}
    </InstallStatusContext.Provider>
  )
}

function useInstallStatus(contentId: string): SynapseEditorId[] {
  const ctx = useContext(InstallStatusContext)
  if (!ctx) return []
  return ctx.statusMap[contentId] ?? []
}

function useUninstallFromEditor(): (contentId: string, editorId: SynapseEditorId) => Promise<void> {
  const ctx = useContext(InstallStatusContext)
  if (!ctx) return async () => {}
  return ctx.uninstall
}

export { InstallStatusProvider, useInstallStatus, useUninstallFromEditor }
```

- [ ] **Step 2: Mount the provider**

Find where content module providers are mounted. The `ContentBrowserPage` is used by both skills and rules via `createContentModule`. The provider should wrap both. Look for the app shell or module layout that wraps content modules.

Check `desktop/src/app-shell/` for the main layout that renders skill/rule tabs. Add `InstallStatusProvider` there, wrapping the content area:

```typescript
import { InstallStatusProvider } from "@/modules/content/contexts/install-status-context"

// Wrap the content area:
<InstallStatusProvider>
  {/* existing content module rendering */}
</InstallStatusProvider>
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit --pretty 2>&1 | head -30`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/content/contexts/install-status-context.tsx
git commit -m "feat(install-status): add renderer context and hooks"
```

---

### Task 4: EditorInstallBadges UI Component

**Files:**
- Create: `desktop/src/modules/content/components/editor-install-badges.tsx`

- [ ] **Step 1: Create the badges component**

Create `desktop/src/modules/content/components/editor-install-badges.tsx`:

```typescript
import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { SynapseEditorId } from "@/types/editor"
import { useInstallStatus, useUninstallFromEditor } from "@/modules/content/contexts/install-status-context"

const EDITOR_META: Record<string, { abbr: string; label: string }> = {
  "claude-code": { abbr: "CC", label: "Claude Code" },
  "cursor": { abbr: "Cu", label: "Cursor" },
  "codex": { abbr: "Cx", label: "Codex" },
  "windsurf": { abbr: "Ws", label: "Windsurf" },
  "antigravity": { abbr: "Ag", label: "Antigravity" },
}

function EditorBadge({
  contentId,
  editorId,
}: {
  contentId: string
  editorId: SynapseEditorId
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const uninstall = useUninstallFromEditor()
  const meta = EDITOR_META[editorId] ?? { abbr: editorId.slice(0, 2).toUpperCase(), label: editorId }

  async function handleUninstall() {
    setBusy(true)
    try {
      await uninstall(contentId, editorId)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex size-5 items-center justify-center rounded text-[9px] font-bold text-primary-foreground bg-foreground/80 hover:bg-foreground transition-colors"
          title={meta.label}
        >
          {meta.abbr}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start" side="top">
        <div className="flex items-center gap-2 px-1 py-0.5">
          <span className="text-xs font-medium">{meta.label}</span>
          <span className="text-[10px] text-muted-foreground">global</span>
        </div>
        <Separator className="my-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-full justify-start text-xs text-destructive hover:text-destructive"
          disabled={busy}
          onClick={handleUninstall}
        >
          {busy ? "卸载中..." : "卸载"}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function EditorInstallBadges({ contentId }: { contentId: string }) {
  const editors = useInstallStatus(contentId)

  if (editors.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 border-t border-border pt-2 mt-2">
      {editors.map((editorId) => (
        <EditorBadge key={editorId} contentId={contentId} editorId={editorId} />
      ))}
    </div>
  )
}

export { EditorInstallBadges }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit --pretty 2>&1 | head -30`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/content/components/editor-install-badges.tsx
git commit -m "feat(install-status): add EditorInstallBadges component with popover uninstall"
```

---

### Task 5: Integrate badges into ContentListCard

**Files:**
- Modify: `desktop/src/modules/content/components/content-grid.tsx:98-160`

- [ ] **Step 1: Add badges to ContentListCard**

In `desktop/src/modules/content/components/content-grid.tsx`, modify the `ContentListCard` component.

Add import at top:

```typescript
import { EditorInstallBadges } from "@/modules/content/components/editor-install-badges"
```

Change the card layout from a single-row flex to a vertical structure. Replace the `ContentListCard` return JSX:

```typescript
function ContentListCard({
  contentType,
  item,
  onInstallDialogOpenChange,
  onOpen,
}: {
  contentType: SynapseContentType
  item: SynapseContentMeta
  onInstallDialogOpenChange?: (open: boolean) => void
  onOpen: () => void
}) {
  const categoryLabel = getCategoryLabel(contentType, item.category)
  const repoProfileMap = useRepoProfileMap()
  const authorLabel = resolveDisplayName(
    item.createdBy,
    repoProfileMap,
    item.createdByDisplayName,
  )

  return (
    <div
      className="flex flex-col rounded-lg bg-background px-3 py-3 transition-shadow hover:ring-2 hover:ring-muted-foreground/25"
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={onOpen}
        >
          <ContentItemIcon
            contentId={item.id}
            contentType={contentType}
            icon={item.icon}
            iconType={item.iconType}
            iconImage={item.iconImage}
            title={item.title}
            tone={item.iconBg}
          />
          <ContentItemMeta
            author={authorLabel}
            category={categoryLabel}
            className="flex-1"
            description={item.description}
            title={item.title}
          />
        </button>

        <div
          className="shrink-0 self-start"
          onClick={(event) => {
            event.stopPropagation()
          }}
          onKeyDown={(event) => {
            event.stopPropagation()
          }}
        >
          <ContentActionSplitButton
            item={item}
            onInstallDialogOpenChange={onInstallDialogOpenChange}
          />
        </div>
      </div>

      <EditorInstallBadges contentId={item.id} />
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit --pretty 2>&1 | head -30`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/content/components/content-grid.tsx
git commit -m "feat(install-status): integrate badges into content list cards"
```

---

### Task 6: Manual integration test

**Files:** None (testing only)

- [ ] **Step 1: Start the dev server**

Run: `cd /Users/liyang/Documents/code/github/Synapse && pnpm dev`

- [ ] **Step 2: Verify badges appear**

1. Open the Skill tab — cards with globally installed skills should show editor badges at the bottom
2. Open the Rule tab — same behavior for rules
3. Cards without any global installation should have no extra row

- [ ] **Step 3: Test uninstall flow**

1. Click an editor badge on a card
2. Verify popover appears with editor name + "global" + "卸载" button
3. Click "卸载"
4. Verify the badge disappears without page refresh
5. Verify the file was actually removed from the editor's global directory

- [ ] **Step 4: Test install triggers badge update**

1. Use the "安装" button to install a skill/rule to an editor (global scope)
2. Verify the corresponding badge appears on the card without page refresh

- [ ] **Step 5: Fix any issues found during testing**

Address any visual or functional issues. Common things to check:
- Badge alignment with the card content
- Popover positioning (should open upward via `side="top"`)
- Cards without badges should not have extra spacing
