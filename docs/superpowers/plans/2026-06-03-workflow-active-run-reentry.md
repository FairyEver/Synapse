# Workflow Active Run Re-entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users reopen an in-progress workflow run from the workflow list or run history after closing the Runner window.

**Architecture:** Add a UI-facing `WorkflowRunListItem` type that represents either an in-memory active run or a terminal snapshot. The main process exposes `workflow.activeRuns()` and changes `workflow.runHistory()` to return active runs merged with terminal snapshots. Renderer list and history views consume that shared model and call the existing `openRunner(workflowId, runId)` entry point.

**Tech Stack:** Electron IPC module registry, TypeScript, React, shadcn/ui, Vitest.

---

## File Structure

- Modify `desktop/src/types/workflow.ts`: add `WorkflowRunListItem`.
- Modify `desktop/src/types/bridge.ts`: update workflow bridge signatures for `activeRuns()` and `runHistory()`.
- Modify `desktop/electron/modules/workflow/ipc.ts`: add schema/helper functions, merge active runs into history, expose `activeRuns`.
- Modify `desktop/electron/preload.ts`: add channel constant and bridge method.
- Regenerate `desktop/electron/generated/ipc-channels.generated.ts`: include the new workflow channel.
- Modify `desktop/src/modules/workflow/components/run-history-dialog.tsx`: consume `WorkflowRunListItem`, render running status, reload on workflow terminal events.
- Modify `desktop/src/modules/workflow/components/workflow-list.tsx`: load active runs and keep active `runId`.
- Modify `desktop/src/modules/workflow/components/workflow-card.tsx`: expose a direct active progress action.
- Modify `desktop/electron/modules/workflow/__tests__/ipc.test.ts`: main-process IPC coverage.
- Modify `desktop/src/modules/workflow/components/__tests__/run-history-dialog.test.tsx`: running history coverage.
- Modify `desktop/src/modules/workflow/components/__tests__/workflow-list.test.tsx`: list re-entry coverage.
- Modify `desktop/src/modules/workflow/components/__tests__/workflow-card.test.tsx`: direct card action coverage.
- Modify `RELEASE_NOTES_PENDING.md`: user-facing release note.

## Task 1: Workflow Run List Type

**Files:**
- Modify: `desktop/src/types/workflow.ts`
- Modify: `desktop/src/types/bridge.ts`

- [ ] **Step 1: Add the shared run list type**

In `desktop/src/types/workflow.ts`, insert this interface after `WorkflowRunStatus`:

```ts
export interface WorkflowRunListItem {
  runId: string
  workflowId: string
  status: WorkflowRunStatus["status"]
  nodeResults: Record<string, NodeRunResult>
  startedAt: number
  endedAt?: number
  durationMs?: number
  error?: string
  params?: Record<string, unknown>
  definition?: WorkflowDefinition
}
```

- [ ] **Step 2: Update the bridge import**

In `desktop/src/types/bridge.ts`, extend the workflow import from:

```ts
import type { WorkflowDefinition, WorkflowMeta, ValidationError, ValidationResult, WorkflowRunSnapshot, WorkflowEvent, WorkflowRunStatus } from "./workflow"
```

to:

```ts
import type {
  WorkflowDefinition,
  WorkflowMeta,
  ValidationError,
  ValidationResult,
  WorkflowEvent,
  WorkflowRunListItem,
  WorkflowRunStatus,
} from "./workflow"
```

- [ ] **Step 3: Update workflow bridge signatures**

In `desktop/src/types/bridge.ts`, replace:

```ts
runHistory: (workflowId: string) => Promise<WorkflowRunSnapshot[]>
```

with:

```ts
activeRuns: () => Promise<WorkflowRunListItem[]>
runHistory: (workflowId: string) => Promise<WorkflowRunListItem[]>
```

- [ ] **Step 4: Run typecheck for the expected failures**

Run:

```bash
pnpm --filter @synapse/desktop exec tsc --noEmit
```

Expected: FAIL because `window.synapse.workflow.activeRuns` is not implemented in `desktop/electron/preload.ts`, `runHistory` call sites still expect snapshots, and workflow IPC has no `activeRuns` channel.

## Task 2: Main Process Active Run IPC

**Files:**
- Modify: `desktop/electron/modules/workflow/__tests__/ipc.test.ts`
- Modify: `desktop/electron/modules/workflow/ipc.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts` through code generation

- [ ] **Step 1: Add failing IPC tests**

Append these tests before the final `})` in `desktop/electron/modules/workflow/__tests__/ipc.test.ts`:

```ts
  it("returns active workflow runs before terminal history snapshots", async () => {
    const activeDefinition = workflowDefinition()
    const runStatuses = new Map<string, WorkflowRunStatus>()
    runStatuses.set("active-run", {
      runId: "active-run",
      workflowId: "workflow-1",
      status: "running",
      nodeResults: {
        "node-1": {
          nodeId: "node-1",
          status: "running",
          input: { variables: {} },
          startedAt: 30,
        },
      },
      startedAt: 30,
      params: { query: "hello" },
      definition: activeDefinition,
    })
    runStatuses.set("other-active-run", {
      runId: "other-active-run",
      workflowId: "workflow-2",
      status: "running",
      nodeResults: {},
      startedAt: 40,
      definition: { ...workflowDefinition(), id: "workflow-2" },
    })
    const snapshots = {
      list: vi.fn(async () => [{
        runId: "terminal-run",
        workflowId: "workflow-1",
        version: "v1",
        status: "completed",
        startedAt: 10,
        endedAt: 20,
        params: {},
        nodeResults: {},
        definition: activeDefinition,
      }]),
    }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const history = await harness.invoke("synapse:workflow:run-history", { workflowId: "workflow-1" })

    expect(history).toEqual([
      expect.objectContaining({
        runId: "active-run",
        workflowId: "workflow-1",
        status: "running",
        startedAt: 30,
        params: { query: "hello" },
        definition: activeDefinition,
      }),
      expect.objectContaining({
        runId: "terminal-run",
        workflowId: "workflow-1",
        status: "completed",
        startedAt: 10,
        endedAt: 20,
      }),
    ])
    expect(JSON.stringify(history)).not.toContain("other-active-run")
  })

  it("lists all active workflow runs and excludes terminal in-memory statuses", async () => {
    const runStatuses = new Map<string, WorkflowRunStatus>()
    runStatuses.set("active-run", {
      runId: "active-run",
      workflowId: "workflow-1",
      status: "running",
      nodeResults: {},
      startedAt: 30,
      definition: workflowDefinition(),
    })
    runStatuses.set("completed-run", {
      runId: "completed-run",
      workflowId: "workflow-1",
      status: "completed",
      nodeResults: {},
      startedAt: 10,
      endedAt: 20,
      definition: workflowDefinition(),
    })
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const activeRuns = await harness.invoke("synapse:workflow:active-runs", undefined)

    expect(activeRuns).toEqual([
      expect.objectContaining({
        runId: "active-run",
        workflowId: "workflow-1",
        status: "running",
      }),
    ])
    expect(JSON.stringify(activeRuns)).not.toContain("completed-run")
  })
```

- [ ] **Step 2: Run IPC tests to verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/modules/workflow/__tests__/ipc.test.ts
```

Expected: FAIL because `synapse:workflow:active-runs` is not registered and `runHistory` only returns snapshots.

- [ ] **Step 3: Add schema and helper functions**

In `desktop/electron/modules/workflow/ipc.ts`, update the type import:

```ts
import type { NodeRunResult, WorkflowDefinition, WorkflowEvent, WorkflowRunListItem, WorkflowRunStatus, WorkflowRunSnapshot } from "../../../src/types/workflow"
```

After `workflowRunStatusSchema`, add:

```ts
const workflowRunListItemSchema: z.ZodType<WorkflowRunListItem> = z.object({
  runId: z.string(),
  workflowId: z.string(),
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  nodeResults: z.record(z.string(), nodeRunResultSchema),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  definition: workflowDefinitionSchema.optional() as z.ZodType<WorkflowDefinition | undefined>,
})
```

After `visibleEngineRejectionError`, add these helpers:

```ts
function runStatusToListItem(status: WorkflowRunStatus): WorkflowRunListItem {
  return {
    runId: status.runId,
    workflowId: status.workflowId,
    status: status.status,
    nodeResults: status.nodeResults,
    startedAt: status.startedAt,
    endedAt: status.endedAt,
    durationMs: status.durationMs,
    error: status.error,
    params: status.params,
    definition: status.definition,
  }
}

function snapshotToListItem(snapshot: WorkflowRunSnapshot): WorkflowRunListItem {
  return {
    runId: snapshot.runId,
    workflowId: snapshot.workflowId,
    status: snapshot.status,
    nodeResults: snapshot.nodeResults,
    startedAt: snapshot.startedAt,
    endedAt: snapshot.endedAt,
    durationMs: snapshot.endedAt ? snapshot.endedAt - snapshot.startedAt : undefined,
    error: snapshot.error,
    params: snapshot.params,
    definition: snapshot.definition,
  }
}

function listActiveRunItems(runStatuses: Map<string, WorkflowRunStatus>, workflowId?: string): WorkflowRunListItem[] {
  return [...runStatuses.values()]
    .filter((status) => status.status === "running")
    .filter((status) => workflowId === undefined || status.workflowId === workflowId)
    .map(runStatusToListItem)
    .sort(compareRunListItems)
}

function compareRunListItems(a: WorkflowRunListItem, b: WorkflowRunListItem): number {
  if (a.status === "running" && b.status !== "running") return -1
  if (a.status !== "running" && b.status === "running") return 1
  return b.startedAt - a.startedAt
}
```

- [ ] **Step 4: Implement activeRuns and merged runHistory**

In the `methods` object in `desktop/electron/modules/workflow/ipc.ts`, replace the `runHistory` method with:

```ts
    activeRuns: {
      channel: "synapse:workflow:active-runs", kind: "invoke", response: z.array(workflowRunListItemSchema),
      handler: (ctx) => {
        const runStatuses = ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")
        return listActiveRunItems(runStatuses)
      },
    },
    runHistory: {
      channel: "synapse:workflow:run-history", kind: "invoke", request: z.object({ workflowId: z.string() }), response: z.array(workflowRunListItemSchema),
      handler: async (ctx, { workflowId }: { workflowId: string }) => {
        const runStatuses = ctx.resolve<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")
        const snapshots = await ctx.resolve<RunSnapshotService>("core.workflow.snapshots").list(workflowId)
        return [
          ...listActiveRunItems(runStatuses, workflowId),
          ...snapshots.map(snapshotToListItem),
        ].sort(compareRunListItems)
      },
    },
```

- [ ] **Step 5: Regenerate IPC channels**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Expected: PASS and `desktop/electron/generated/ipc-channels.generated.ts` contains:

```ts
"activeRuns": "synapse:workflow:active-runs",
```

- [ ] **Step 6: Run IPC tests to verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/modules/workflow/__tests__/ipc.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/types/workflow.ts desktop/src/types/bridge.ts desktop/electron/modules/workflow/ipc.ts desktop/electron/generated/ipc-channels.generated.ts desktop/electron/modules/workflow/__tests__/ipc.test.ts
git commit -m "feat(workflow): expose active run history entries"
```

## Task 3: Preload Bridge Method

**Files:**
- Modify: `desktop/electron/preload.ts`
- Test: `desktop/electron/__tests__/preload.test.ts`

- [ ] **Step 1: Add failing preload test**

In `desktop/electron/__tests__/preload.test.ts`, add this test before `"writes a renderer IPC failure log when bridge invoke rejects"`:

```ts
  it("maps workflow active runs to the workflow IPC channel", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.workflow.activeRuns()

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:workflow:active-runs",
      undefined,
    )
  })
```

- [ ] **Step 2: Run preload test to verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/__tests__/preload.test.ts
```

Expected: FAIL because `activeRuns` is not exposed yet.

- [ ] **Step 3: Add the preload channel constant**

In `desktop/electron/preload.ts`, add this entry inside `IPC_CHANNELS.workflow`:

```ts
    "activeRuns": "synapse:workflow:active-runs",
```

Place it before `runHistory`.

- [ ] **Step 4: Expose the bridge method**

In the `workflow` bridge object in `desktop/electron/preload.ts`, add:

```ts
    activeRuns: () => invoke(IPC_CHANNELS.workflow.activeRuns)(),
```

Place it before `runHistory`.

- [ ] **Step 5: Run preload test to verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/__tests__/preload.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/preload.ts desktop/electron/__tests__/preload.test.ts
git commit -m "feat(workflow): expose active runs to renderer"
```

## Task 4: Run History Shows Active Runs

**Files:**
- Modify: `desktop/src/modules/workflow/components/__tests__/run-history-dialog.test.tsx`
- Modify: `desktop/src/modules/workflow/components/run-history-dialog.tsx`

- [ ] **Step 1: Update test imports**

In `desktop/src/modules/workflow/components/__tests__/run-history-dialog.test.tsx`, replace:

```ts
import type { WorkflowRunSnapshot } from "@/types/workflow"
```

with:

```ts
import type { WorkflowEvent, WorkflowRunListItem } from "@/types/workflow"
```

Rename `createSnapshot` to `createRunItem` and return `WorkflowRunListItem`:

```ts
function createRunItem(patch: Partial<WorkflowRunListItem> = {}): WorkflowRunListItem {
  return {
    runId: "run-1",
    workflowId: "workflow-1",
    startedAt: Date.parse("2026-05-15T00:00:00.000Z"),
    endedAt: Date.parse("2026-05-15T00:00:01.000Z"),
    status: "failed",
    params: {},
    nodeResults: {},
    ...patch,
  }
}
```

Replace existing `createSnapshot(` calls with `createRunItem(`.

- [ ] **Step 2: Add failing running-record test**

Add this test to `RunHistoryDialog`:

```ts
  it("shows running records and opens the active runner", async () => {
    const openRunner = vi.fn()
    window.synapse = {
      workflow: {
        runHistory: vi.fn().mockResolvedValue([
          createRunItem({
            runId: "active-run",
            status: "running",
            endedAt: undefined,
            nodeResults: {
              nodeA: {
                nodeId: "nodeA",
                status: "running",
                input: { variables: {} },
              },
            },
          }),
        ]),
        openRunner,
      },
    } as unknown as Window["synapse"]

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<RunHistoryDialog open workflowId="workflow-1" onClose={vi.fn()} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("执行中")
    expect(document.body.textContent).toContain("1 个节点")
    expect(document.body.textContent).not.toContain("NaN")

    await act(async () => {
      document.body.querySelector('[role="button"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(openRunner).toHaveBeenCalledWith("workflow-1", "active-run")
  })
```

- [ ] **Step 3: Add failing terminal reload test**

Add this test:

```ts
  it("reloads open history when the active run reaches a terminal event", async () => {
    let eventListener: ((event: WorkflowEvent) => void) | undefined
    const runHistory = vi.fn()
      .mockResolvedValueOnce([
        createRunItem({ runId: "active-run", status: "running", endedAt: undefined }),
      ])
      .mockResolvedValueOnce([
        createRunItem({ runId: "active-run", status: "completed", endedAt: Date.parse("2026-05-15T00:00:02.000Z") }),
      ])
    window.synapse = {
      workflow: {
        runHistory,
        openRunner: vi.fn(),
        onEvent: vi.fn((listener) => {
          eventListener = listener
          return vi.fn()
        }),
      },
    } as unknown as Window["synapse"]

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<RunHistoryDialog open workflowId="workflow-1" onClose={vi.fn()} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("执行中")

    await act(async () => {
      eventListener?.({
        type: "workflow:completed",
        runId: "active-run",
        workflowId: "workflow-1",
        result: { status: "completed", nodeResults: {}, durationMs: 2000 },
      })
      await Promise.resolve()
    })

    expect(runHistory).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain("已完成")
  })
```

- [ ] **Step 4: Run tests to verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/workflow/components/__tests__/run-history-dialog.test.tsx
```

Expected: FAIL because `RunHistoryDialog` does not support running records or terminal-event reload.

- [ ] **Step 5: Update RunHistoryDialog types and labels**

In `desktop/src/modules/workflow/components/run-history-dialog.tsx`, change:

```ts
import type { WorkflowRunSnapshot } from "@/types/workflow"
```

to:

```ts
import type { WorkflowEvent, WorkflowRunListItem } from "@/types/workflow"
```

Replace:

```ts
const STATUS_LABEL: Record<string, string> = { completed: "已完成", failed: "失败", cancelled: "已取消" }
```

with:

```ts
const STATUS_LABEL: Record<string, string> = { running: "执行中", completed: "已完成", failed: "失败", cancelled: "已取消" }
```

Replace:

```ts
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "secondary", failed: "destructive", cancelled: "outline",
}
```

with:

```ts
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  running: "default", completed: "secondary", failed: "destructive", cancelled: "outline",
}
```

Change `WorkflowRunSnapshot` usages in state and helpers to `WorkflowRunListItem`.

- [ ] **Step 6: Add event reload effect**

Add this helper near the top of the file:

```ts
function isWorkflowTerminalEvent(event: WorkflowEvent, workflowId: string): boolean {
  return (
    (event.type === "workflow:completed" || event.type === "workflow:failed" || event.type === "workflow:cancelled") &&
    event.workflowId === workflowId
  )
}
```

Inside `RunHistoryDialog`, after the existing load effect, add:

```ts
  useEffect(() => {
    if (!open || !workflowId) return
    const unsubscribe = window.synapse?.workflow.onEvent?.((event) => {
      if (isWorkflowTerminalEvent(event, workflowId)) load()
    })
    return () => { unsubscribe?.() }
  }, [open, workflowId, load])
```

- [ ] **Step 7: Keep running duration empty**

Keep `formatDuration` unchanged, but make sure rendering only shows duration when it returns a string:

```tsx
{duration && (
  <span className="text-xs text-muted-foreground shrink-0">
    {duration}
  </span>
)}
```

This is already the current pattern; preserve it when changing types.

- [ ] **Step 8: Run tests to verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/workflow/components/__tests__/run-history-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/src/modules/workflow/components/run-history-dialog.tsx desktop/src/modules/workflow/components/__tests__/run-history-dialog.test.tsx
git commit -m "feat(workflow): show active runs in history"
```

## Task 5: Workflow List Re-entry

**Files:**
- Modify: `desktop/src/modules/workflow/components/workflow-card.tsx`
- Modify: `desktop/src/modules/workflow/components/workflow-list.tsx`
- Modify: `desktop/src/modules/workflow/components/__tests__/workflow-list.test.tsx`
- Modify: `desktop/src/modules/workflow/components/__tests__/workflow-card.test.tsx`

- [ ] **Step 1: Update WorkflowCard API test**

In `desktop/src/modules/workflow/components/__tests__/workflow-card.test.tsx`, add this test inside `describe("WorkflowCard", ...)`:

```tsx
  it("opens the active run from the progress action", async () => {
    const onOpenActiveRun = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <WorkflowCard
          meta={workflowMeta}
          runState={{ status: "running", runId: "active-run" }}
          running={false}
          onOpen={vi.fn()}
          onRun={vi.fn()}
          onOpenActiveRun={onOpenActiveRun}
          onHistory={vi.fn()}
          onExport={vi.fn()}
          onDelete={vi.fn()}
        />,
      )
    })

    const progressButton = container.querySelector<HTMLButtonElement>('[aria-label="查看进度"]')
    expect(progressButton).toBeTruthy()

    await act(async () => {
      progressButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onOpenActiveRun).toHaveBeenCalledWith("active-run")
  })
```

- [ ] **Step 2: Run WorkflowCard test to verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/workflow/components/__tests__/workflow-card.test.tsx
```

Expected: FAIL because `WorkflowCard` does not accept `onOpenActiveRun` and `runState` is still a string.

- [ ] **Step 3: Update WorkflowCard props and UI**

In `desktop/src/modules/workflow/components/workflow-card.tsx`, replace:

```ts
export type WorkflowCardRunState = WorkflowRunStatus["status"]
```

with:

```ts
export type WorkflowCardRunState = {
  status: WorkflowRunStatus["status"]
  runId?: string
}
```

Update props:

```ts
interface WorkflowCardProps {
  meta: WorkflowMeta
  running?: boolean
  runState?: WorkflowCardRunState
  onOpen: () => void
  onRun: () => void
  onOpenActiveRun: (runId: string) => void
  onHistory: () => void
  onExport: () => void
  onDelete: () => void
}
```

Update badge lookup:

```ts
const badge = runState ? RUN_STATE_BADGE[runState.status] : null
```

Add a progress button before the run button:

```tsx
{runState?.status === "running" && runState.runId ? (
  <Button
    type="button"
    size="icon-sm"
    variant="ghost"
    aria-label="查看进度"
    data-track="workflow-card-open-active-run"
    onClick={(e) => { e.stopPropagation(); onOpenActiveRun(runState.runId!) }}
  >
    <Loader2 className="animate-spin" />
  </Button>
) : null}
```

Keep the existing run button for starting a new run.

- [ ] **Step 4: Update WorkflowList mock test**

In `desktop/src/modules/workflow/components/__tests__/workflow-list.test.tsx`, update the `WorkflowCard` mock to accept and expose active progress:

```tsx
vi.mock("../workflow-card", () => ({
  WorkflowCard: ({
    meta,
    runState,
    onExport,
    onRun,
    onOpenActiveRun,
  }: {
    meta: { id: string }
    runState?: { status: string; runId?: string }
    onExport: () => void
    onRun: () => void
    onOpenActiveRun: (runId: string) => void
  }) => (
    <>
      <button type="button" data-testid={`run-${meta.id}`} onClick={onRun}>run</button>
      {runState?.runId ? (
        <button type="button" data-testid={`open-active-${meta.id}`} onClick={() => onOpenActiveRun(runState.runId!)}>open active</button>
      ) : null}
      <button type="button" data-track="workflow-card-export" onClick={onExport}>export</button>
    </>
  ),
}))
```

Add `workflowActiveRuns` to the hoisted mocks:

```ts
workflowActiveRuns: vi.fn(),
```

Expose it in `window.synapse.workflow`:

```ts
activeRuns: workflowActiveRuns,
```

In `beforeEach`, add:

```ts
workflowActiveRuns.mockResolvedValue([])
```

- [ ] **Step 5: Add failing list active re-entry test**

Add this test:

```tsx
  it("loads active runs and reopens the runner from the workflow card", async () => {
    workflowActiveRuns.mockResolvedValue([{
      runId: "active-run",
      workflowId: "workflow-param",
      status: "running",
      nodeResults: {},
      startedAt: 123,
    }])
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowList onCreate={vi.fn()} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="open-active-workflow-param"]')?.click()
      await Promise.resolve()
    })

    expect(workflowActiveRuns).toHaveBeenCalled()
    expect(workflowOpenRunner).toHaveBeenCalledWith("workflow-param", "active-run")
  })
```

- [ ] **Step 6: Add failing event update test**

Add this test:

```tsx
  it("records active run ids from workflow events and clears them on terminal events", async () => {
    let listener: ((event: { type: string; workflowId?: string; runId: string }) => void) | undefined
    workflowOnEvent.mockImplementation((callback) => {
      listener = callback
      return vi.fn()
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowList onCreate={vi.fn()} />)
    })

    await act(async () => {
      listener?.({ type: "workflow:started", workflowId: "workflow-param", runId: "event-run" })
    })

    expect(container.querySelector('[data-testid="open-active-workflow-param"]')).toBeTruthy()

    await act(async () => {
      listener?.({ type: "workflow:completed", workflowId: "workflow-param", runId: "event-run" })
    })

    expect(container.querySelector('[data-testid="open-active-workflow-param"]')).toBeNull()
  })
```

- [ ] **Step 7: Run list tests to verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/workflow/components/__tests__/workflow-list.test.tsx desktop/src/modules/workflow/components/__tests__/workflow-card.test.tsx
```

Expected: FAIL because list does not call `activeRuns` and card does not expose active progress.

- [ ] **Step 8: Implement active run loading in WorkflowList**

In `desktop/src/modules/workflow/components/workflow-list.tsx`, change:

```ts
const [runStates, setRunStates] = useState<Record<string, WorkflowCardRunState>>({})
```

Keep the same name, but now values are objects.

Add this effect after the event subscription effect:

```ts
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const activeRuns = await requireBridgeDomain("workflow").activeRuns()
        if (cancelled) return
        setRunStates((state) => {
          const next = { ...state }
          for (const run of activeRuns) {
            next[run.workflowId] = { status: "running", runId: run.runId }
            runIdToWfId.current[run.runId] = run.workflowId
          }
          return next
        })
      } catch (err) {
        logger.warn("Workflow active runs load failed.", {
          boundary: "renderer.workflow.list.active-runs",
          ...errorDiagnostic(err),
        })
      }
    })()
    return () => { cancelled = true }
  }, [])
```

Update event handling:

```ts
        if (event.type === "workflow:started") {
          runIdToWfId.current[event.runId] = event.workflowId
          setRunStates((s) => ({ ...s, [event.workflowId]: { status: "running", runId: event.runId } }))
        } else if (event.type === "workflow:completed") {
          const wfId = event.workflowId ?? runIdToWfId.current[event.runId]
          if (wfId) setRunStates((s) => ({ ...s, [wfId]: { status: "completed" } }))
        } else if (event.type === "workflow:failed") {
          const wfId = event.workflowId ?? runIdToWfId.current[event.runId]
          if (wfId) setRunStates((s) => ({ ...s, [wfId]: { status: "failed" } }))
        } else if (event.type === "workflow:cancelled") {
          const wfId = event.workflowId ?? runIdToWfId.current[event.runId]
          if (wfId) setRunStates((s) => ({ ...s, [wfId]: { status: "cancelled" } }))
        }
```

Add this handler:

```ts
  const handleOpenActiveRun = (workflowId: string, runId: string) => {
    openRunner(requireBridgeDomain("workflow"), workflowId, runId)
  }
```

Pass it to `WorkflowCard`:

```tsx
onOpenActiveRun={(runId) => handleOpenActiveRun(meta.id, runId)}
```

- [ ] **Step 9: Run list/card tests to verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/workflow/components/__tests__/workflow-list.test.tsx desktop/src/modules/workflow/components/__tests__/workflow-card.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add desktop/src/modules/workflow/components/workflow-list.tsx desktop/src/modules/workflow/components/workflow-card.tsx desktop/src/modules/workflow/components/__tests__/workflow-list.test.tsx desktop/src/modules/workflow/components/__tests__/workflow-card.test.tsx
git commit -m "feat(workflow): reopen active runs from list"
```

## Task 6: Release Note and Full Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add one bullet under `## 问题修复` in `RELEASE_NOTES_PENDING.md`:

```md
- 工作流运行中即使关闭运行窗口，也可以从工作流列表或运行历史重新打开进度；运行历史会把“执行中”的记录显示在顶部。
```

- [ ] **Step 2: Run focused workflow tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/modules/workflow/__tests__/ipc.test.ts desktop/src/modules/workflow/components/__tests__/run-history-dialog.test.tsx desktop/src/modules/workflow/components/__tests__/workflow-list.test.tsx desktop/src/modules/workflow/components/__tests__/workflow-card.test.tsx desktop/electron/__tests__/preload.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Run desktop tests**

Run:

```bash
pnpm --filter @synapse/desktop run test
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs(workflow): note active run re-entry"
```

## Self-Review

- Spec coverage: active runs appear in history through Task 2 and Task 4; list re-entry is Task 5; Runner behavior remains unchanged by using existing `openRunner` and `runStatus`; no disk running snapshots are introduced.
- Scope: all edits stay in workflow IPC, workflow renderer components, preload bridge, shared workflow/bridge types, tests, and release notes.
- Type consistency: `WorkflowRunListItem` is the single shared renderer-facing type for `activeRuns()` and `runHistory()`. `WorkflowRunSnapshot` remains terminal-only.
- UI rules: no custom colors, no inline styles, no new CSS modules, and no explanatory UI copy beyond “执行中” and “查看进度”.
- Verification: plan includes RED/GREEN focused tests, hard constraints, desktop test suite, and typecheck.
