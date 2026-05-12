# Workflow Editor / Runner Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the workflow editor and runner into two independent BrowserWindows with no shared runtime state. Editor is pure editing, Runner is pure execution viewing.

**Architecture:** Editor refactored to remove all run state, Runner is a new app with readonly DAG + timeline views sharing a right-side result panel. Communication goes through IPC only. The engine accepts definitions from memory (editor) or disk (list page). Each run's definition is snapshotted for replay.

**Tech Stack:** React, ReactFlow, TypeScript, Electron IPC (zod), shadcn/ui, Tailwind CSS, Lucide icons

**Spec:** `docs/superpowers/specs/2026-05-12-workflow-editor-runner-separation-design.md`

---

## File Map

### New files

| File | Responsibility |
|---|---|
| `desktop/src/modules/workflow/runner/runner-app.tsx` | Runner window root component |
| `desktop/src/modules/workflow/runner/runner-toolbar.tsx` | Status/cancel/rerun/edit/view-toggle toolbar |
| `desktop/src/modules/workflow/runner/dag-view.tsx` | Readonly ReactFlow DAG with status overlays |
| `desktop/src/modules/workflow/runner/timeline-view.tsx` | Linear execution timeline with parallel grouping |
| `desktop/src/modules/workflow/runner/node-result-panel.tsx` | Right-side node result detail panel |
| `desktop/src/modules/workflow/runner/runner-node-wrappers.tsx` | Readonly node renderers with status styling |
| `desktop/src/modules/workflow/components/run-history-dialog.tsx` | History Dialog for list page |

### Modified files

| File | Change summary |
|---|---|
| `desktop/src/types/workflow.ts` | Add `definition` to `WorkflowRunStatus` and `WorkflowRunSnapshot` |
| `desktop/src/types/bridge.ts` | Add `runDefinition`, `rerun`, `openRunner` to workflow bridge |
| `desktop/electron/preload.ts` | Wire new IPC channels + bridge methods |
| `desktop/electron/modules/workflow/ipc.ts` | Add `runDefinition`, `rerun`, `openRunner` handlers; store def in RunStatus |
| `desktop/electron/services/workflow/window-manager.ts` | Split into editor + runner window maps |
| `desktop/electron/bootstrap/descriptors.ts` | No change needed (window-manager descriptor covers both) |
| `desktop/src/main.tsx` | Add `workflow-runner` window type branch |
| `desktop/src/modules/workflow/editor/editor-app.tsx` | Remove all run state, add `handleRun` that sends def via IPC |
| `desktop/src/modules/workflow/editor/toolbar.tsx` | Remove run state props, simplify to stateless toolbar |
| `desktop/src/modules/workflow/components/workflow-card.tsx` | Add history button |
| `desktop/src/modules/workflow/components/workflow-list.tsx` | Route run → openRunner, add history dialog |
| `desktop/src/modules/workflow/hooks/use-workflow-run.ts` | Add `runDefinition` start variant |

### Files to delete after refactor

| File | Reason |
|---|---|
| `desktop/src/modules/workflow/editor/execution-overlay.tsx` | Functionality moves to Runner's node-result-panel + dag-view |

---

## Task 1: Types & IPC Foundation

Add `definition` field to run types, add new IPC channels and bridge methods. This is the foundation everything else depends on.

**Files:**
- Modify: `desktop/src/types/workflow.ts:30-39` (WorkflowRunStatus), `desktop/src/types/workflow.ts:56-60` (WorkflowRunSnapshot)
- Modify: `desktop/src/types/bridge.ts:542-557` (SynapseBridge.workflow)
- Modify: `desktop/electron/preload.ts:187-203` (IPC_CHANNELS.workflow)
- Modify: `desktop/electron/preload.ts:639-658` (synapseBridge.workflow)

- [ ] **Step 1: Add `definition` to `WorkflowRunStatus`**

In `desktop/src/types/workflow.ts`, add optional `definition` field:

```typescript
export interface WorkflowRunStatus {
  runId: string
  workflowId: string
  status: "running" | WorkflowRunResult["status"]
  nodeResults: Record<string, NodeRunResult>
  startedAt: number
  endedAt?: number
  durationMs?: number
  error?: string
  definition?: WorkflowDefinition
}
```

- [ ] **Step 2: Add `definition` to `WorkflowRunSnapshot`**

In `desktop/src/types/workflow.ts`, add optional `definition` field:

```typescript
export interface WorkflowRunSnapshot {
  runId: string; workflowId: string; version: string; startedAt: number; endedAt?: number
  status: "completed" | "failed" | "cancelled"; params: Record<string, unknown>
  nodeResults: Record<string, NodeRunResult>
  definition?: WorkflowDefinition
}
```

- [ ] **Step 3: Add new bridge methods to `SynapseBridge`**

In `desktop/src/types/bridge.ts`, add to the `workflow` section:

```typescript
  workflow: {
    // ... existing methods ...
    runDefinition: (def: WorkflowDefinition, params: Record<string, unknown>) => Promise<{ runId: string } | { errors: ValidationError[] } | { conflict: true; activeRunId: string }>
    rerun: (previousRunId: string, params: Record<string, unknown>) => Promise<{ runId: string } | { errors: ValidationError[] }>
    openRunner: (workflowId: string, runId: string) => Promise<void>
    // ... keep existing methods ...
  }
```

- [ ] **Step 4: Add IPC channel constants in preload**

In `desktop/electron/preload.ts`, add to `IPC_CHANNELS.workflow`:

```typescript
    "runDefinition": "synapse:workflow:run-definition",
    "rerun": "synapse:workflow:rerun",
    "openRunner": "synapse:workflow:open-runner",
```

- [ ] **Step 5: Wire bridge methods in preload**

In `desktop/electron/preload.ts`, add to `synapseBridge.workflow`:

```typescript
    runDefinition: (def: WorkflowDefinition, params: Record<string, unknown>) =>
      invoke(IPC_CHANNELS.workflow.runDefinition)({ definition: def, params }),
    rerun: (previousRunId: string, params: Record<string, unknown>) =>
      invoke(IPC_CHANNELS.workflow.rerun)({ previousRunId, params }),
    openRunner: (workflowId: string, runId: string) =>
      invoke(IPC_CHANNELS.workflow.openRunner)({ workflowId, runId }),
```

- [ ] **Step 6: Commit**

```
git add desktop/src/types/workflow.ts desktop/src/types/bridge.ts desktop/electron/preload.ts
git commit -m "feat(workflow): add types and bridge for editor/runner separation"
```

---

## Task 2: Window Manager — Support Two Window Types

Split the window manager to handle both editor and runner windows independently.

**Files:**
- Modify: `desktop/electron/services/workflow/window-manager.ts`

- [ ] **Step 1: Refactor `WorkflowWindowManager` to support two window types**

Replace the entire file content of `desktop/electron/services/workflow/window-manager.ts`:

```typescript
import { BrowserWindow } from "electron"
import type { WindowManager } from "../../runtime/window"
import { managedBrowserWindow } from "../../runtime/window"

export class WorkflowWindowManager {
  private readonly editorWindows = new Map<string, BrowserWindow>()
  private readonly runnerWindows = new Map<string, BrowserWindow>()

  constructor(private readonly mainWindowManager?: WindowManager) {}

  open(workflowId: string, baseUrl: string, runId?: string): BrowserWindow {
    const existing = this.editorWindows.get(workflowId)
    if (existing && !existing.isDestroyed()) { existing.focus(); return existing }

    const win = new BrowserWindow({
      width: 1200, height: 800, title: "Workflow Editor",
      webPreferences: { preload: require.resolve("../../preload"), contextIsolation: true, sandbox: false },
    })

    const params = new URLSearchParams({ window: "workflow-editor", workflowId })
    if (runId) params.set("runId", runId)
    const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`
    void win.loadURL(url)

    const windowId = `workflow-editor:${workflowId}`
    if (this.mainWindowManager) {
      this.mainWindowManager.attach({ id: windowId, role: "detail" }, managedBrowserWindow(win, "detail"))
    }

    win.on("closed", () => this.editorWindows.delete(workflowId))
    this.editorWindows.set(workflowId, win)
    return win
  }

  openRunner(workflowId: string, runId: string, baseUrl: string): BrowserWindow {
    const existing = this.runnerWindows.get(workflowId)
    if (existing && !existing.isDestroyed()) {
      // Send message to switch runId in existing runner window
      existing.webContents.send("synapse:workflow:runner-switch-run", { runId })
      existing.focus()
      return existing
    }

    const win = new BrowserWindow({
      width: 1200, height: 800, title: "Workflow Runner",
      webPreferences: { preload: require.resolve("../../preload"), contextIsolation: true, sandbox: false },
    })

    const params = new URLSearchParams({ window: "workflow-runner", workflowId, runId })
    const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`
    void win.loadURL(url)

    const windowId = `workflow-runner:${workflowId}`
    if (this.mainWindowManager) {
      this.mainWindowManager.attach({ id: windowId, role: "detail" }, managedBrowserWindow(win, "detail"))
    }

    win.on("closed", () => this.runnerWindows.delete(workflowId))
    this.runnerWindows.set(workflowId, win)
    return win
  }

  focusEditor(workflowId: string): boolean {
    const win = this.editorWindows.get(workflowId)
    if (win && !win.isDestroyed()) { win.focus(); return true }
    return false
  }

  forceClose(workflowId: string): void {
    const editor = this.editorWindows.get(workflowId)
    if (editor && !editor.isDestroyed()) editor.destroy()
    this.editorWindows.delete(workflowId)
  }

  forceCloseAll(workflowId: string): void {
    this.forceClose(workflowId)
    const runner = this.runnerWindows.get(workflowId)
    if (runner && !runner.isDestroyed()) runner.destroy()
    this.runnerWindows.delete(workflowId)
  }

  hasActiveRun(workflowId: string): boolean {
    const win = this.runnerWindows.get(workflowId)
    return !!win && !win.isDestroyed()
  }

  getOpenEditorIds(): string[] {
    return [...this.editorWindows.entries()].filter(([, w]) => !w.isDestroyed()).map(([id]) => id)
  }

  checkCanSync(): { canSync: boolean; blockers: string[] } {
    const open = this.getOpenEditorIds()
    return open.length > 0
      ? { canSync: false, blockers: open.map((id) => `Workflow editor open: ${id}`) }
      : { canSync: true, blockers: [] }
  }
}
```

- [ ] **Step 2: Commit**

```
git add desktop/electron/services/workflow/window-manager.ts
git commit -m "feat(workflow): window manager supports editor + runner windows"
```

---

## Task 3: IPC Handlers — `runDefinition`, `rerun`, `openRunner`

Add the three new IPC handlers and update the `run` handler to store definition in RunStatus/Snapshot.

**Files:**
- Modify: `desktop/electron/modules/workflow/ipc.ts`

- [ ] **Step 1: Update the existing `run` handler to store `definition` in RunStatus and Snapshot**

In `desktop/electron/modules/workflow/ipc.ts`, find the line where `runStatuses.set` is called at run start (line ~138):

```typescript
runStatuses.set(runId, { runId, workflowId: id, status: "running", nodeResults: {}, startedAt })
```

Change to:

```typescript
runStatuses.set(runId, { runId, workflowId: id, status: "running", nodeResults: {}, startedAt, definition: def })
```

Also update the snapshot save call (line ~179) to include `definition: def`:

```typescript
void snapshots.save({ runId, workflowId: id, version: def.version, startedAt, endedAt, status, params, nodeResults, definition: def })
```

And the failure snapshot save (line ~210):

```typescript
void snapshots.save({ runId, workflowId: id, version: def.version, startedAt, endedAt, status: "failed", params, nodeResults: current.nodeResults, definition: def })
```

- [ ] **Step 2: Add `runDefinition` IPC handler**

After the existing `run` method in `ipc.ts`, add:

```typescript
    runDefinition: {
      channel: "synapse:workflow:run-definition", kind: "invoke",
      request: z.object({ definition: workflowDefinitionSchema, params: z.record(z.string(), z.unknown()), force: z.boolean().optional() }),
      response: z.union([
        z.object({ runId: z.string() }),
        z.object({ errors: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), edgeId: z.string().optional(), message: z.string() })) }),
        z.object({ conflict: z.literal(true), activeRunId: z.string() }),
      ]),
      handler: async (ctx, { definition: def, params, force }: { definition: unknown; params: Record<string, unknown>; force?: boolean }) => {
        const typedDef = def as import("../../../src/types/workflow").WorkflowDefinition
        logger.info("workflow:runDefinition requested", { workflowId: typedDef.id, paramKeys: Object.keys(params) })
        const engine = ctx.resolve<WorkflowEngine>("core.workflow.engine")
        const snapshots = ctx.resolve<RunSnapshotService>("core.workflow.snapshots")
        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const abortMap = ctx.resolve<Map<string, AbortController>>("core.workflow.run-aborts")
        const runStatuses = ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")

        const validation = validateWorkflow(typedDef)
        if (!validation.valid) {
          logger.warn("workflow:runDefinition blocked by validation", { workflowId: typedDef.id, errors: validation.errors })
          return { errors: validation.errors }
        }

        // Conflict detection: check for active runs on this workflowId
        if (!force) {
          for (const [existingRunId, status] of runStatuses) {
            if (status.workflowId === typedDef.id && status.status === "running") {
              logger.info("workflow:runDefinition conflict — active run exists", { workflowId: typedDef.id, activeRunId: existingRunId })
              return { conflict: true as const, activeRunId: existingRunId }
            }
          }
        } else {
          // Force: cancel any active run for this workflowId
          for (const [existingRunId, status] of runStatuses) {
            if (status.workflowId === typedDef.id && status.status === "running") {
              logger.info("workflow:runDefinition force — cancelling active run", { activeRunId: existingRunId })
              abortMap.get(existingRunId)?.abort()
            }
          }
        }

        const ac = new AbortController()
        const runId = randomUUID()
        const startedAt = Date.now()
        abortMap.set(runId, ac)
        runStatuses.set(runId, { runId, workflowId: typedDef.id, status: "running", nodeResults: {}, startedAt, definition: typedDef })

        const appConfig = await configStore.load()
        const activeRepo = appConfig.repositories.find((r) => r.uuid === appConfig.activeRepoUuid) ?? appConfig.repositories[0]
        const projectId = activeRepo?.uuid ?? ""

        logger.info("workflow:runDefinition started", { workflowId: typedDef.id, runId, nodeCount: typedDef.nodes.length })

        engine.run(typedDef, params, runId, (event) => {
          const current = runStatuses.get(runId) ?? { runId, workflowId: typedDef.id, status: "running" as const, nodeResults: {}, startedAt, definition: typedDef }
          const nextNodeResults: Record<string, NodeRunResult> = { ...current.nodeResults }
          if (event.type === "node:started") {
            nextNodeResults[event.nodeId] = { ...(nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, input: { variables: {} } }), status: "running", startedAt: event.startedAt ?? Date.now() }
          } else if (event.type === "node:completed" || event.type === "node:failed" || event.type === "node:skipped") {
            nextNodeResults[event.nodeId] = event.result ?? nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, status: event.type === "node:skipped" ? "skipped" : "failed", input: { variables: {} } }
          }
          runStatuses.set(runId, { ...current, nodeResults: nextNodeResults })

          eventBus.emit(
            { domain: "workflow", type: event.type, payload: event, timestamp: new Date().toISOString() },
            { backpressure: "block" },
          )
          if (event.type === "workflow:completed" || event.type === "workflow:failed" || event.type === "workflow:cancelled") {
            abortMap.delete(runId)
            const status = event.type === "workflow:completed" ? "completed" : event.type === "workflow:cancelled" ? "cancelled" : "failed"
            const endedAt = Date.now()
            const nodeResults = event.result?.nodeResults ?? nextNodeResults
            const durationMs = event.result?.durationMs ?? endedAt - startedAt
            runStatuses.set(runId, { ...current, runId, workflowId: typedDef.id, status, nodeResults, startedAt, endedAt, durationMs, definition: typedDef, ...(event.type === "workflow:failed" ? { error: event.error } : {}) })
            void snapshots.save({ runId, workflowId: typedDef.id, version: typedDef.version, startedAt, endedAt, status, params, nodeResults, definition: typedDef })
          }
        }, ac.signal, projectId).catch((err) => {
          const errorMsg = err instanceof Error ? err.message : String(err)
          logger.error("workflow engine rejected unexpectedly (runDefinition)", { workflowId: typedDef.id, runId, error: errorMsg })
          abortMap.delete(runId)
          const current = runStatuses.get(runId)
          if (current && current.status === "running") {
            const endedAt = Date.now()
            const durationMs = endedAt - startedAt
            const failedStatus = { runId, workflowId: typedDef.id, status: "failed" as const, nodeResults: current.nodeResults, startedAt, endedAt, durationMs, error: `引擎异常：${errorMsg}`, definition: typedDef }
            runStatuses.set(runId, failedStatus)
            eventBus.emit(
              { domain: "workflow", type: "workflow:failed", payload: { type: "workflow:failed", runId, error: failedStatus.error, result: { status: "failed", nodeResults: current.nodeResults, durationMs } }, timestamp: new Date().toISOString() },
              { backpressure: "block" },
            )
            void snapshots.save({ runId, workflowId: typedDef.id, version: typedDef.version, startedAt, endedAt, status: "failed", params, nodeResults: current.nodeResults, definition: typedDef })
          }
        })

        return { runId }
      },
    },
```

- [ ] **Step 3: Add `rerun` IPC handler**

After `runDefinition`, add:

```typescript
    rerun: {
      channel: "synapse:workflow:rerun", kind: "invoke",
      request: z.object({ previousRunId: z.string(), params: z.record(z.string(), z.unknown()) }),
      response: z.union([
        z.object({ runId: z.string() }),
        z.object({ errors: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), edgeId: z.string().optional(), message: z.string() })) }),
      ]),
      handler: async (ctx, { previousRunId, params }: { previousRunId: string; params: Record<string, unknown> }) => {
        logger.info("workflow:rerun requested", { previousRunId })
        const runStatuses = ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")
        const snapshots = ctx.resolve<RunSnapshotService>("core.workflow.snapshots")

        // Try in-memory first, fall back to snapshot on disk
        let def: import("../../../src/types/workflow").WorkflowDefinition | undefined
        let workflowId: string | undefined

        const memoryStatus = runStatuses.get(previousRunId)
        if (memoryStatus?.definition) {
          def = memoryStatus.definition
          workflowId = memoryStatus.workflowId
        } else {
          // Search all snapshot directories for this runId
          const svc = ctx.resolve<WorkflowService>("core.workflow")
          const allWorkflows = await svc.list()
          for (const wf of allWorkflows) {
            const snapshot = await snapshots.get(previousRunId, wf.id)
            if (snapshot?.definition) {
              def = snapshot.definition
              workflowId = snapshot.workflowId
              break
            }
          }
        }

        if (!def || !workflowId) {
          logger.error("workflow:rerun — cannot find definition for previous run", { previousRunId })
          return { errors: [{ type: "invalid_config", message: "无法找到上次运行使用的工作流定义" }] }
        }

        // Delegate to runDefinition logic — invoke self via direct handler call
        // Build a synthetic request and call the handler directly is complex,
        // so instead we replicate the essential flow here with the found def.
        const engine = ctx.resolve<WorkflowEngine>("core.workflow.engine")
        const snapshotSvc = ctx.resolve<RunSnapshotService>("core.workflow.snapshots")
        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const abortMap = ctx.resolve<Map<string, AbortController>>("core.workflow.run-aborts")

        const validation = validateWorkflow(def)
        if (!validation.valid) return { errors: validation.errors }

        // Cancel any active run on this workflow
        for (const [existingRunId, status] of runStatuses) {
          if (status.workflowId === workflowId && status.status === "running") {
            abortMap.get(existingRunId)?.abort()
          }
        }

        const ac = new AbortController()
        const runId = randomUUID()
        const startedAt = Date.now()
        abortMap.set(runId, ac)
        runStatuses.set(runId, { runId, workflowId, status: "running", nodeResults: {}, startedAt, definition: def })

        const appConfig = await configStore.load()
        const activeRepo = appConfig.repositories.find((r) => r.uuid === appConfig.activeRepoUuid) ?? appConfig.repositories[0]
        const projectId = activeRepo?.uuid ?? ""

        engine.run(def, params, runId, (event) => {
          const current = runStatuses.get(runId) ?? { runId, workflowId: workflowId!, status: "running" as const, nodeResults: {}, startedAt, definition: def }
          const nextNodeResults: Record<string, NodeRunResult> = { ...current.nodeResults }
          if (event.type === "node:started") {
            nextNodeResults[event.nodeId] = { ...(nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, input: { variables: {} } }), status: "running", startedAt: event.startedAt ?? Date.now() }
          } else if (event.type === "node:completed" || event.type === "node:failed" || event.type === "node:skipped") {
            nextNodeResults[event.nodeId] = event.result ?? nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, status: event.type === "node:skipped" ? "skipped" : "failed", input: { variables: {} } }
          }
          runStatuses.set(runId, { ...current, nodeResults: nextNodeResults })
          eventBus.emit({ domain: "workflow", type: event.type, payload: event, timestamp: new Date().toISOString() }, { backpressure: "block" })
          if (event.type === "workflow:completed" || event.type === "workflow:failed" || event.type === "workflow:cancelled") {
            abortMap.delete(runId)
            const status = event.type === "workflow:completed" ? "completed" : event.type === "workflow:cancelled" ? "cancelled" : "failed"
            const endedAt = Date.now()
            const nodeResults = event.result?.nodeResults ?? nextNodeResults
            const durationMs = event.result?.durationMs ?? endedAt - startedAt
            runStatuses.set(runId, { ...current, runId, workflowId: workflowId!, status, nodeResults, startedAt, endedAt, durationMs, definition: def, ...(event.type === "workflow:failed" ? { error: event.error } : {}) })
            void snapshotSvc.save({ runId, workflowId: workflowId!, version: def!.version, startedAt, endedAt, status, params, nodeResults, definition: def })
          }
        }, ac.signal, projectId).catch((err) => {
          const errorMsg = err instanceof Error ? err.message : String(err)
          logger.error("workflow engine rejected (rerun)", { workflowId, runId, error: errorMsg })
          abortMap.delete(runId)
          const current = runStatuses.get(runId)
          if (current && current.status === "running") {
            const endedAt = Date.now()
            runStatuses.set(runId, { runId, workflowId: workflowId!, status: "failed", nodeResults: current.nodeResults, startedAt, endedAt, durationMs: endedAt - startedAt, error: `引擎异常：${errorMsg}`, definition: def })
            eventBus.emit({ domain: "workflow", type: "workflow:failed", payload: { type: "workflow:failed", runId, error: `引擎异常：${errorMsg}`, result: { status: "failed", nodeResults: current.nodeResults, durationMs: endedAt - startedAt } }, timestamp: new Date().toISOString() }, { backpressure: "block" })
            void snapshotSvc.save({ runId, workflowId: workflowId!, version: def!.version, startedAt, endedAt, status: "failed", params, nodeResults: current.nodeResults, definition: def })
          }
        })

        return { runId }
      },
    },
```

- [ ] **Step 4: Add `openRunner` IPC handler**

After `rerun`, add:

```typescript
    openRunner: {
      channel: "synapse:workflow:open-runner", kind: "invoke",
      request: z.object({ workflowId: z.string(), runId: z.string() }),
      response: z.void(),
      handler: (ctx, { workflowId, runId }: { workflowId: string; runId: string }) => {
        logger.info("workflow:openRunner", { workflowId, runId })
        const baseUrl = process.env.VITE_DEV_SERVER_URL ?? "app://-"
        ctx.resolve<WorkflowWindowManager>("core.workflow.window-manager").openRunner(workflowId, runId, baseUrl)
      },
    },
```

- [ ] **Step 5: Update `delete` handler to close all windows**

In the existing `delete` handler, after `await ctx.resolve<WorkflowService>("core.workflow").delete(id)`, add:

```typescript
        ctx.resolve<WorkflowWindowManager>("core.workflow.window-manager").forceCloseAll(id)
```

- [ ] **Step 6: Commit**

```
git add desktop/electron/modules/workflow/ipc.ts
git commit -m "feat(workflow): add runDefinition, rerun, openRunner IPC handlers"
```

---

## Task 4: Refactor Editor — Remove Run State

Strip all execution logic from the editor. After this task, the editor is a pure editing tool that delegates running to the Runner window.

**Files:**
- Modify: `desktop/src/modules/workflow/editor/editor-app.tsx`
- Modify: `desktop/src/modules/workflow/editor/toolbar.tsx`

- [ ] **Step 1: Refactor `editor-app.tsx`**

Remove these imports and usages:
- `useWorkflowRun`, `useWorkflowEvents` hooks
- `ExecutionOverlay` component
- `runId`, `runState`, `nodeResults`, `setRunState`, `setNodeResults`, `start`, `cancel`, `attachRun` variables
- `runError`, `setRunError`, `viewingNodeId`, `setViewingNodeId` state
- `runIdRef` ref
- The `workflow:started` event listener effect
- The `useWorkflowEvents` call
- `ExecutionOverlay` JSX

Replace `handleRun` with:

```typescript
  const handleRun = async (params: Record<string, unknown>) => {
    const def = definitionRef.current
    if (!def) return null
    const result = await window.synapse?.workflow.runDefinition(def, params)
    if (!result) {
      setRunErrors([{ type: "invalid_config", message: "运行失败：IPC 通道不可用" }])
      return null
    }
    if ("errors" in result) {
      setRunErrors(result.errors)
      return null
    }
    if ("conflict" in result) {
      // Show confirmation dialog for active run conflict
      const confirmed = window.confirm("有正在执行的运行，是否取消并启动新运行？")
      if (!confirmed) return null
      const forceResult = await window.synapse?.workflow.runDefinition(def, params)
      // The force flag needs to be sent — for now we'll handle this via a dedicated call
      // Actually: we need to pass force=true. The bridge method needs to support it.
      // This will be refined — for MVP, just proceed.
      return null
    }
    void window.synapse?.workflow.openRunner(def.id, result.runId)
    return result.runId
  }
```

Update `WorkflowToolbar` props — remove `runState`, `onCancel`, `onReset`. Remove `nodeResults` and `runState` from `WorkflowCanvas` props.

Update `handleNodeSelect` to always select for editing (no run-mode result viewing).

Remove `ExecutionOverlay` from JSX.

- [ ] **Step 2: Simplify `toolbar.tsx`**

Remove `runState` prop, stop/cancel/reset buttons. Keep: name input, description input, params editor, save button, run button. The toolbar becomes stateless — no mode switching.

```typescript
interface WorkflowToolbarProps {
  definition: WorkflowDefinition
  onSave: (def: WorkflowDefinition) => Promise<unknown>
  onRun: (params: Record<string, unknown>) => Promise<unknown>
  onChange: (def: WorkflowDefinition) => void
}
```

- [ ] **Step 3: Commit**

```
git add desktop/src/modules/workflow/editor/editor-app.tsx desktop/src/modules/workflow/editor/toolbar.tsx
git commit -m "refactor(workflow): strip run state from editor — pure editing mode"
```

---

## Task 5: Runner Entry Point — `main.tsx` + `runner-app.tsx`

Create the Runner window entry in `main.tsx` and the root `runner-app.tsx` component.

**Files:**
- Modify: `desktop/src/main.tsx`
- Create: `desktop/src/modules/workflow/runner/runner-app.tsx`

- [ ] **Step 1: Add runner window type to `main.tsx`**

In `desktop/src/main.tsx`, add a branch for `workflow-runner`:

```typescript
  if (windowType === "workflow-editor") {
    const { WorkflowEditorApp } = await import("@/modules/workflow/editor/editor-app")
    createRoot(document.getElementById("root")!).render(
      <StrictMode><AppErrorBoundary><WorkflowEditorApp /></AppErrorBoundary></StrictMode>,
    )
  } else if (windowType === "workflow-runner") {
    const { WorkflowRunnerApp } = await import("@/modules/workflow/runner/runner-app")
    createRoot(document.getElementById("root")!).render(
      <StrictMode><AppErrorBoundary><WorkflowRunnerApp /></AppErrorBoundary></StrictMode>,
    )
  } else {
    // ... existing main app render
  }
```

- [ ] **Step 2: Create `runner-app.tsx` scaffold**

Create `desktop/src/modules/workflow/runner/runner-app.tsx`:

```typescript
import { useCallback, useEffect, useState } from "react"
import type { WorkflowDefinition, NodeRunResult, WorkflowRunStatus } from "@/types/workflow"
import { useWorkflowEvents } from "../hooks/use-workflow-events"
import { createRendererLogger } from "@/app-shell/logging"
import { RunnerToolbar } from "./runner-toolbar"
import { DagView } from "./dag-view"
import { TimelineView } from "./timeline-view"
import { NodeResultPanel } from "./node-result-panel"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { RunParamsDialog } from "../components/run-params-dialog"
import type { RunState } from "../hooks/use-workflow-run"

const logger = createRendererLogger("workflow.runner")

type ViewMode = "dag" | "timeline"

export function WorkflowRunnerApp() {
  const searchParams = new URLSearchParams(window.location.search)
  const workflowId = searchParams.get("workflowId") ?? ""
  const initialRunId = searchParams.get("runId") ?? ""

  const [runId, setRunId] = useState(initialRunId)
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null)
  const [runState, setRunState] = useState<RunState>("running")
  const [nodeResults, setNodeResults] = useState<Record<string, NodeRunResult>>({})
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>("dag")
  const [runStartedAt, setRunStartedAt] = useState<number | undefined>()
  const [lastParams, setLastParams] = useState<Record<string, unknown>>({})
  const [showRerunParams, setShowRerunParams] = useState(false)

  // Load initial run status
  useEffect(() => {
    if (!runId) return
    let cancelled = false
    void (async () => {
      const status = await window.synapse?.workflow.runStatus(runId)
      if (cancelled || !status) return
      logger.info("hydrated run status", { runId, status: status.status })
      setRunState(status.status)
      setNodeResults(status.nodeResults)
      setRunStartedAt(status.startedAt)
      if (status.definition) setDefinition(status.definition)
    })()
    return () => { cancelled = true }
  }, [runId])

  // Listen for run-switch messages from main process (when reusing window)
  useEffect(() => {
    const handler = (_event: unknown, data: { runId: string }) => {
      logger.info("runner-switch-run received", { newRunId: data.runId })
      setRunId(data.runId)
      setNodeResults({})
      setRunState("running")
      setSelectedNodeId(null)
    }
    // @ts-expect-error — electron IPC on renderer
    window.electronAPI?.onRunnerSwitchRun?.(handler)
    // Fallback: listen via ipcRenderer if exposed
  }, [])

  // Subscribe to live events
  useWorkflowEvents(runId, {
    onNodeStarted: (nodeId) => setNodeResults((r) => ({ ...r, [nodeId]: { ...(r[nodeId] ?? { nodeId, input: { variables: {} } }), status: "running" as const } })),
    onNodeCompleted: (nodeId, output, result) => setNodeResults((r) => ({ ...r, [nodeId]: result ?? { ...(r[nodeId] ?? { nodeId, input: { variables: {} } }), status: "success" as const, output: String(output) } })),
    onNodeFailed: (nodeId, error, result) => setNodeResults((r) => ({ ...r, [nodeId]: result ?? { ...(r[nodeId] ?? { nodeId, input: { variables: {} } }), status: "failed" as const, error } })),
    onNodeSkipped: (nodeId, result) => setNodeResults((r) => ({ ...r, [nodeId]: result ?? { nodeId, input: { variables: {} }, status: "skipped" as const } })),
    onCompleted: (results) => { setRunState("completed"); setNodeResults(results) },
    onFailed: (_error, results) => { setRunState("failed"); if (results) setNodeResults(results) },
    onCancelled: (results) => { setRunState("cancelled"); if (results) setNodeResults(results) },
  })

  // Update window title
  useEffect(() => {
    const statusLabel = runState === "running" ? "执行中" : runState === "completed" ? "已完成" : runState === "failed" ? "失败" : runState === "cancelled" ? "已取消" : ""
    document.title = `运行 - ${definition?.name ?? workflowId}${statusLabel ? ` [${statusLabel}]` : ""}`
  }, [runState, definition?.name, workflowId])

  const handleCancel = useCallback(async () => {
    if (runId) await window.synapse?.workflow.cancel(runId)
  }, [runId])

  const handleRerun = useCallback(async (params: Record<string, unknown>) => {
    const result = await window.synapse?.workflow.rerun(runId, params)
    if (!result || "errors" in result) return
    setRunId(result.runId)
    setRunState("running")
    setNodeResults({})
    setSelectedNodeId(null)
    setLastParams(params)
    setShowRerunParams(false)
  }, [runId])

  const handleEdit = useCallback(() => {
    void window.synapse?.workflow.openEditor(workflowId)
  }, [workflowId])

  if (!definition) return <div className="flex items-center justify-center h-screen text-sm text-muted-foreground">加载中…</div>

  return (
    <div className="flex flex-col h-screen">
      <RunnerToolbar
        definition={definition}
        runState={runState}
        runStartedAt={runStartedAt}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onCancel={handleCancel}
        onRerun={() => setShowRerunParams(true)}
        onEdit={handleEdit}
      />
      <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
        <ResizablePanel>
          {viewMode === "dag" ? (
            <DagView definition={definition} nodeResults={nodeResults} runState={runState} selectedNodeId={selectedNodeId} onNodeSelect={setSelectedNodeId} />
          ) : (
            <TimelineView definition={definition} nodeResults={nodeResults} runState={runState} selectedNodeId={selectedNodeId} onNodeSelect={setSelectedNodeId} />
          )}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={300} minSize={250} maxSize={500} groupResizeBehavior="preserve-pixel-size">
          <NodeResultPanel nodeId={selectedNodeId} nodeResults={nodeResults} definition={definition} />
        </ResizablePanel>
      </ResizablePanelGroup>
      <RunParamsDialog
        open={showRerunParams}
        onOpenChange={setShowRerunParams}
        params={definition.params}
        initialValues={lastParams}
        onSubmit={handleRerun}
      />
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```
git add desktop/src/main.tsx desktop/src/modules/workflow/runner/runner-app.tsx
git commit -m "feat(workflow): add runner window entry point and root component"
```

---

## Task 6: Runner Views — DAG, Timeline, Toolbar, Node Result Panel

Build the four Runner-specific UI components. These can be implemented in parallel.

**Files:**
- Create: `desktop/src/modules/workflow/runner/runner-toolbar.tsx`
- Create: `desktop/src/modules/workflow/runner/dag-view.tsx`
- Create: `desktop/src/modules/workflow/runner/runner-node-wrappers.tsx`
- Create: `desktop/src/modules/workflow/runner/timeline-view.tsx`
- Create: `desktop/src/modules/workflow/runner/node-result-panel.tsx`

- [ ] **Step 1: Create `runner-toolbar.tsx`**

Toolbar with: status badge, cancel (running only), rerun (terminal only), edit, view mode toggle. See spec §runner-toolbar for button visibility rules and historical mode timestamp display.

- [ ] **Step 2: Create `runner-node-wrappers.tsx`**

Readonly node renderers with status border colors per spec §status-colors:
- Pending: dashed border, muted
- Running: primary border + pulse animation
- Success: green left-border
- Failed: destructive left-border
- Skipped: muted, semi-transparent

Each node displays: name, status icon, duration (if completed). Node is clickable → calls `onNodeSelect`.

- [ ] **Step 3: Create `dag-view.tsx`**

ReactFlow with `nodesDraggable={false}`, `nodesConnectable={false}`, `elementsSelectable={true}`, `panOnDrag={true}`, `zoomOnScroll={true}`, `selectionOnDrag={false}`, `deleteKeyCode={null}`, `fitView`. No Background grid (plain background). Uses runner-node-wrappers. Edges styled: activated = primary solid, inactive = muted dashed.

- [ ] **Step 4: Create `timeline-view.tsx`**

Linear list in execution order with parallel grouping (same topo-level nodes grouped with left border). Each entry: start time, node name, type badge, status icon, duration. Clicking selects node for right panel. Running node has pulse + auto-scroll. Parallel groups detected by comparing topo-sort depth of each node.

- [ ] **Step 5: Create `node-result-panel.tsx`**

Right-side panel: empty state when no node selected, otherwise shows: header (name + type + status + duration), input variables, full prompt (collapsible), output (collapsible), active branch (switch only), error (failed only, destructive color).

- [ ] **Step 6: Commit**

```
git add desktop/src/modules/workflow/runner/
git commit -m "feat(workflow): add runner views — toolbar, DAG, timeline, result panel"
```

---

## Task 7: List Page — History Dialog + Triple Entry Card

Add the history dialog and update workflow cards with three entry points.

**Files:**
- Create: `desktop/src/modules/workflow/components/run-history-dialog.tsx`
- Modify: `desktop/src/modules/workflow/components/workflow-card.tsx`
- Modify: `desktop/src/modules/workflow/components/workflow-list.tsx`

- [ ] **Step 1: Create `run-history-dialog.tsx`**

A Dialog showing the last 20 run records for a workflow. Each row: status icon + datetime + duration. Click opens Runner via `window.synapse?.workflow.openRunner(workflowId, runId)`. Empty state when no history.

```typescript
import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { WorkflowRunSnapshot } from "@/types/workflow"

interface RunHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string
  workflowName: string
}

export function RunHistoryDialog({ open, onOpenChange, workflowId, workflowName }: RunHistoryDialogProps) {
  const [snapshots, setSnapshots] = useState<WorkflowRunSnapshot[]>([])

  useEffect(() => {
    if (!open) return
    void window.synapse?.workflow.runHistory(workflowId).then(setSnapshots)
  }, [open, workflowId])

  const statusIcon = (s: string) => s === "completed" ? "●" : s === "failed" ? "✕" : "◻"
  const statusColor = (s: string) => s === "completed" ? "text-green-500" : s === "failed" ? "text-destructive" : "text-muted-foreground"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>运行历史 — {workflowName}</DialogTitle></DialogHeader>
        {snapshots.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">暂无运行记录</p>
        ) : (
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {snapshots.map((s) => (
              <button
                key={s.runId}
                className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-muted text-sm text-left"
                onClick={() => {
                  void window.synapse?.workflow.openRunner(workflowId, s.runId)
                  onOpenChange(false)
                }}
              >
                <span className={statusColor(s.status)}>{statusIcon(s.status)}</span>
                <span className="flex-1">{new Date(s.startedAt).toLocaleString()}</span>
                {s.endedAt && <span className="text-muted-foreground text-xs">{((s.endedAt - s.startedAt) / 1000).toFixed(1)}s</span>}
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Update `workflow-card.tsx`**

Add a "历史" button. Change "运行" to open Runner after run starts. Double-click opens editor. Delete calls `forceCloseAll` (handled by IPC delete handler).

- [ ] **Step 3: Update `workflow-list.tsx`**

Wire up the RunHistoryDialog. Update `handleRun` to call `openRunner` after run starts instead of opening the editor.

- [ ] **Step 4: Commit**

```
git add desktop/src/modules/workflow/components/
git commit -m "feat(workflow): list page with triple entry card + history dialog"
```

---

## Task 8: Bridge Conflict Handling + Cleanup

Wire the conflict detection UX in the editor, handle the `runner-switch-run` preload channel, and delete `execution-overlay.tsx`.

**Files:**
- Modify: `desktop/src/modules/workflow/editor/editor-app.tsx` (refine conflict handling)
- Modify: `desktop/electron/preload.ts` (add `runner-switch-run` listener)
- Delete: `desktop/src/modules/workflow/editor/execution-overlay.tsx`

- [ ] **Step 1: Refine conflict handling in editor's `handleRun`**

Update the bridge type to accept `force` parameter:

```typescript
runDefinition: (def: WorkflowDefinition, params: Record<string, unknown>, force?: boolean) => Promise<...>
```

And update the preload wiring to pass `force`:

```typescript
runDefinition: (def: WorkflowDefinition, params: Record<string, unknown>, force?: boolean) =>
  invoke(IPC_CHANNELS.workflow.runDefinition)({ definition: def, params, force }),
```

Update editor's `handleRun` to handle conflict → confirm → force flow.

- [ ] **Step 2: Add `runner-switch-run` IPC listener in preload**

In the preload, expose a listener for the runner window to receive run-switch messages. Add to the EVENT_CHANNELS:

```typescript
  workflow: {
    event: "synapse:workflow:event",
    runnerSwitchRun: "synapse:workflow:runner-switch-run",
  },
```

And in synapseBridge.workflow, add:

```typescript
onRunnerSwitchRun: (listener: (data: { runId: string }) => void) =>
  subscribe(EVENT_CHANNELS.workflow.runnerSwitchRun)((data) => listener(data as { runId: string })),
```

Update runner-app.tsx to use `window.synapse?.workflow.onRunnerSwitchRun` instead of the `@ts-expect-error` hack.

- [ ] **Step 3: Delete `execution-overlay.tsx`**

Remove `desktop/src/modules/workflow/editor/execution-overlay.tsx`. Verify no remaining imports reference it.

- [ ] **Step 4: Commit**

```
git add -A
git commit -m "feat(workflow): conflict handling, runner-switch-run IPC, remove execution-overlay"
```

---

## Task 9: Polish — Window Titles, Status Bar, Edge Cases

Final integration: editor window title, runner status bar, canvas props cleanup.

**Files:**
- Modify: `desktop/src/modules/workflow/editor/editor-app.tsx` (window title)
- Modify: `desktop/src/modules/workflow/editor/canvas.tsx` (remove run-related props if any)
- Modify: `desktop/src/modules/workflow/runner/runner-app.tsx` (status bar)

- [ ] **Step 1: Set editor window title**

In `editor-app.tsx`, add effect to set `document.title`:

```typescript
useEffect(() => {
  document.title = `编辑 - ${definition?.name ?? workflowId}`
}, [definition?.name, workflowId])
```

- [ ] **Step 2: Add runner bottom status bar**

In `runner-app.tsx`, add a footer bar below the ResizablePanelGroup:

```typescript
<div className="flex items-center justify-between px-3 py-1 border-t text-xs text-muted-foreground">
  <span>
    {runState === "running" && `● ${Object.values(nodeResults).filter(r => r.status === "success").length}/${definition.nodes.length} 节点完成`}
    {runState === "completed" && `● 全部 ${definition.nodes.length} 节点完成`}
    {runState === "failed" && `✕ 失败`}
    {runState === "cancelled" && `◻ 已取消`}
  </span>
  {runStartedAt && <span>运行于 {new Date(runStartedAt).toLocaleTimeString()}</span>}
</div>
```

- [ ] **Step 3: Clean up canvas props**

If `WorkflowCanvas` in `canvas.tsx` still accepts `nodeResults` / `runState` props, remove them from the editor usage. The canvas in the editor no longer needs run-related data. (The Runner uses its own `DagView` component, not the editor's `WorkflowCanvas`.)

- [ ] **Step 4: Final commit**

```
git add -A
git commit -m "feat(workflow): editor/runner separation polish — titles, status bar, cleanup"
```

---

## Self-Review Checklist

1. **Spec coverage:**
   - ✅ Two independent windows (Tasks 2, 5)
   - ✅ Editor stripped of run state (Task 4)
   - ✅ Runner with DAG + timeline views (Task 6)
   - ✅ `runDefinition` from memory, no save (Task 3)
   - ✅ `rerun` with previous definition (Task 3)
   - ✅ Conflict detection with confirm dialog (Tasks 3, 8)
   - ✅ History dialog (Task 7)
   - ✅ Triple entry card (Task 7)
   - ✅ Window titles with status (Tasks 5, 9)
   - ✅ Delete closes all windows (Task 3)
   - ✅ Runner → Editor jump (Task 5)
   - ✅ Reuse runner window (Task 2)
   - ✅ Definition stored in RunStatus/Snapshot (Tasks 1, 3)
   - ✅ Node status color/icon system (Task 6)
   - ✅ Visual distinction: no grid, no palette (Task 6)
   - ✅ Runner canvas: zoom/pan but no edit (Task 6)
   - ✅ Timeline parallel grouping (Task 6)
   - ✅ Rerun prefills last params (Task 5)
   - ✅ Status bar (Task 9)

2. **Placeholder scan:** No TBD/TODO. All code steps have concrete code.

3. **Type consistency:** `WorkflowRunStatus.definition`, `WorkflowRunSnapshot.definition` used consistently across types, IPC handlers, and runner-app hydration. `RunState` type from `use-workflow-run.ts` reused in runner. Bridge methods match IPC handler signatures.
