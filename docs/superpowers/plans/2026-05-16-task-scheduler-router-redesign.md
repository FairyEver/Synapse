# Task Scheduler Router Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce react-router-dom to the Synapse desktop app, migrate all tab navigation to flat routes, and build a new task-scheduler detail page with real-time run polling.

**Architecture:** Replace the `activeTab` state in `App.tsx` with `MemoryRouter` + flat routes. Each tab maps 1:1 to a route. Add `/task-scheduler/:taskId` as a new detail page with 2s polling for run status. AgentModule stays persistently mounted via CSS hidden pattern.

**Tech Stack:** react-router-dom v7, React, TypeScript, shadcn/ui, Tailwind CSS, Vitest

**Design spec:** `docs/superpowers/specs/2026-05-16-task-scheduler-router-redesign.md`

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `src/app-shell/routes.ts` | Route path constants and `pathnameToTabId` helper |
| `src/app-shell/components/app-router.tsx` | `MemoryRouter` + `Routes` + route definitions |
| `src/app-shell/hooks/use-app-navigate.ts` | Thin hook wrapping `useNavigate` for event subscriber integration |
| `src/modules/task-scheduler/hooks/use-task-run-polling.ts` | Polling hook for run status |
| `src/modules/task-scheduler/pages/task-detail-page.tsx` | Task detail page component |
| `src/modules/task-scheduler/components/task-latest-run.tsx` | Latest run display component |
| `src/modules/task-scheduler/components/task-summary-bar.tsx` | Task summary bar component |

### Modified files

| File | Change |
|------|--------|
| `src/App.tsx` | Replace `activeTab` state + conditional rendering with router-based rendering |
| `src/app-shell/components/app-shell-navigation.tsx` | Derive `value` from `useLocation`, navigate on change |
| `src/modules/task-scheduler/index.tsx` | Extract list-page logic, add `onNavigateToTask` callback |
| `src/modules/task-scheduler/components/task-card.tsx` | Pass through `onRun` that navigates to detail |
| `src/modules/task-scheduler/components/task-card-grid.tsx` | Forward navigate handler |

### Test files

| File | Covers |
|------|--------|
| `src/app-shell/__tests__/routes.test.ts` | `pathnameToTabId` |
| `src/modules/task-scheduler/hooks/__tests__/use-task-run-polling.test.ts` | Polling lifecycle |
| `src/modules/task-scheduler/pages/__tests__/task-detail-page.test.tsx` | Detail page states |

---

## Task 1: Install react-router-dom

**Files:**
- Modify: `desktop/package.json`

- [ ] **Step 1: Install dependency**

```bash
pnpm --filter @synapse/desktop add react-router-dom
```

- [ ] **Step 2: Verify installation**

```bash
pnpm --filter @synapse/desktop exec -- node -e "require('react-router-dom')" 2>&1 || echo "CJS check skipped for ESM"
```

Check that `react-router-dom` appears in `desktop/package.json` dependencies.

- [ ] **Step 3: Commit**

```bash
git add desktop/package.json pnpm-lock.yaml
git commit -m "chore: add react-router-dom dependency"
```

---

## Task 2: Create route constants and helpers

**Files:**
- Create: `src/app-shell/routes.ts`
- Create: `src/app-shell/__tests__/routes.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// src/app-shell/__tests__/routes.test.ts
import { describe, expect, it } from "vitest"
import { pathnameToTabId, TAB_ROUTES } from "../routes"

describe("pathnameToTabId", () => {
  it("maps exact tab routes", () => {
    expect(pathnameToTabId("/rule")).toBe("rule")
    expect(pathnameToTabId("/agent")).toBe("agent")
    expect(pathnameToTabId("/task-scheduler")).toBe("task-scheduler")
    expect(pathnameToTabId("/settings")).toBe("settings")
  })

  it("maps task-scheduler sub-routes to task-scheduler tab", () => {
    expect(pathnameToTabId("/task-scheduler/abc-123")).toBe("task-scheduler")
  })

  it("maps root to rule", () => {
    expect(pathnameToTabId("/")).toBe("rule")
  })

  it("falls back to rule for unknown paths", () => {
    expect(pathnameToTabId("/unknown")).toBe("rule")
  })
})

describe("TAB_ROUTES", () => {
  it("has entries for all known tabs", () => {
    const ids = TAB_ROUTES.map((r) => r.tabId)
    expect(ids).toContain("rule")
    expect(ids).toContain("agent")
    expect(ids).toContain("task-scheduler")
    expect(ids).toContain("settings")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @synapse/desktop exec vitest run src/app-shell/__tests__/routes.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```typescript
// src/app-shell/routes.ts
type TabRoute = {
  readonly tabId: string
  readonly path: string
}

const TAB_ROUTES: readonly TabRoute[] = [
  { tabId: "rule", path: "/rule" },
  { tabId: "skill", path: "/skill" },
  { tabId: "prompt", path: "/prompt" },
  { tabId: "agent", path: "/agent" },
  { tabId: "database", path: "/database" },
  { tabId: "task-scheduler", path: "/task-scheduler" },
  { tabId: "editor-scan", path: "/editor-scan" },
  { tabId: "token-usage", path: "/token-usage" },
  { tabId: "workflow", path: "/workflow" },
  { tabId: "settings", path: "/settings" },
] as const

function pathnameToTabId(pathname: string): string {
  if (pathname === "/") return "rule"
  for (const route of TAB_ROUTES) {
    if (pathname === route.path || pathname.startsWith(route.path + "/")) {
      return route.tabId
    }
  }
  return "rule"
}

function tabIdToPath(tabId: string): string {
  const route = TAB_ROUTES.find((r) => r.tabId === tabId)
  return route?.path ?? "/rule"
}

export { pathnameToTabId, tabIdToPath, TAB_ROUTES }
export type { TabRoute }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @synapse/desktop exec vitest run src/app-shell/__tests__/routes.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app-shell/routes.ts src/app-shell/__tests__/routes.test.ts
git commit -m "feat: add route constants and pathnameToTabId helper"
```

---

## Task 3: Create AppRouter component and migrate App.tsx

This is the largest task. It replaces the `activeTab` state machine in `App.tsx` with `MemoryRouter` + `Routes`.

**Files:**
- Create: `src/app-shell/components/app-router.tsx`
- Modify: `src/App.tsx`
- Modify: `src/app-shell/components/app-shell-navigation.tsx`

- [ ] **Step 1: Create AppRouter**

Create `src/app-shell/components/app-router.tsx`. This component wraps the children in `MemoryRouter` and defines all `<Route>` elements. It also contains the navigation event wiring that was previously in `MainApp`.

```tsx
// src/app-shell/components/app-router.tsx
import { useCallback, useEffect, useRef, type ReactNode } from "react"
import {
  MemoryRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom"

import { createRendererLogger } from "@/app-shell/logging"
import { publishActiveAppTab } from "@/app-shell/navigation"
import { pathnameToTabId } from "@/app-shell/routes"

const logger = createRendererLogger("app-router")

function AppRouterProvider({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/rule"]}>
      <RouteSync />
      {children}
    </MemoryRouter>
  )
}

function RouteSync() {
  const location = useLocation()
  const prevTabRef = useRef<string>("rule")

  useEffect(() => {
    const tabId = pathnameToTabId(location.pathname)
    if (prevTabRef.current !== tabId) {
      logger.info("Top-level tab changed.", {
        from: prevTabRef.current,
        to: tabId,
        source: "route",
      })
      prevTabRef.current = tabId
    }
    publishActiveAppTab(tabId)
  }, [location.pathname])

  return null
}

function useAppNavigate() {
  return useNavigate()
}

export { AppRouterProvider, useAppNavigate }
```

- [ ] **Step 2: Update AppShellNavigation to use router**

Modify `src/app-shell/components/app-shell-navigation.tsx`:

The component currently receives `value` and `onValueChange` props. Change it to derive `value` from `useLocation` and call `navigate` on change. The props interface stays the same shape for the `tabs` list but `value`/`onValueChange` are replaced by internal router usage.

```tsx
// src/app-shell/components/app-shell-navigation.tsx
import { useLocation, useNavigate } from "react-router-dom"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { pathnameToTabId, tabIdToPath } from "@/app-shell/routes"

type AppShellNavigationTab = {
  id: string
  label: string
}

type AppShellNavigationProps = {
  tabs: AppShellNavigationTab[]
}

function AppShellNavigation({ tabs }: AppShellNavigationProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const activeTabId = pathnameToTabId(location.pathname)

  return (
    <nav className="flex justify-center">
      <Tabs
        data-track="app-shell-navigation"
        value={activeTabId}
        onValueChange={(value) => navigate(tabIdToPath(value))}
      >
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </nav>
  )
}

export { AppShellNavigation, type AppShellNavigationTab }
```

- [ ] **Step 3: Rewrite App.tsx to use router**

Major changes to `src/App.tsx`:

1. Wrap `MainApp` in `AppRouterProvider`
2. Remove `activeTab` / `setActiveTabRaw` / `setActiveTab` state
3. Replace conditional tab rendering with `<Routes>` and `<Route>` elements
4. Move event subscriptions (`subscribeOpenAgentSession`, `subscribeOpenSettingsTab`, `subscribeContentOpenRequest`) into a `useRouterEventWiring` effect that uses `useNavigate`
5. Keep AgentModule always mounted with `display: none` when not on `/agent`
6. `AppShellNavigation` no longer receives `value`/`onValueChange` props

Key sections of the rewritten `MainApp`:

- Navigation event wiring: use `useNavigate()` inside `MainApp` (which is now inside `MemoryRouter`).
- AgentModule: render unconditionally, wrap in `<div className={location.pathname === "/agent" ? "contents" : "hidden"}>`.
- Route-based rendering: use `<Routes>` for all modules except Agent.
- `publishActiveAppTab`: handled by `RouteSync` inside `AppRouterProvider`.

The `App` function wraps `MainApp` in `AppRouterProvider` (just above the existing `LicenseGate`).

Detailed implementation:

- Remove `useState<AppTabId>("rule")` and all `setActiveTab` calls
- Remove `activeTabRef`
- Add `const navigate = useNavigate()` and `const location = useLocation()`
- Derive `activeTab` as `pathnameToTabId(location.pathname)` where still needed (e.g., `updateDiagnosticContext`, `publishActiveAppTab`)
- Replace `subscribeOpenSettingsTab` handler: `navigate("/settings")`
- Replace `subscribeOpenAgentSession` handler: `navigate("/agent")` + `setPendingAgentSession(payload)`
- Replace `subscribeContentOpenRequest` handler: `navigate("/" + request.contentType)` + `setPendingContentOpenRequest(request)`
- Replace `bridge.updater.onOpenUpdatePage` handler: `navigate("/settings")` + `requestOpenSettingsAbout()`
- Replace navigation prop: `<AppShellNavigation tabs={tabs} />` (drop `value` and `onValueChange`)
- Replace `<div className={activeTab !== "agent" ? "hidden" : "contents"}>` with `<div className={pathnameToTabId(location.pathname) !== "agent" ? "hidden" : "contents"}>`
- Replace all `{activeTab === "xxx" ? ... : null}` blocks with `<Routes>`:

```tsx
<Routes>
  <Route path="/" element={<Navigate to="/rule" replace />} />
  {CONTENT_TYPE_DEFINITIONS.map((definition) => (
    <Route
      key={definition.id}
      path={`/${definition.id}`}
      element={
        <ErrorBoundary fallbackTitle={`${definition.tabLabel}模块出现问题`}>
          <ContentModuleRoute
            definition={definition}
            dialogHandlers={contentDialogHandlers[definition.id]}
            pendingContentOpenRequest={pendingContentOpenRequest}
            onPendingContentOpenRequestConsumed={handlePendingContentOpenRequestConsumed}
          />
        </ErrorBoundary>
      }
    />
  ))}
  <Route path="/database" element={<ErrorBoundary fallbackTitle="数据库模块出现问题"><DatabaseModule /></ErrorBoundary>} />
  <Route path="/task-scheduler" element={<ErrorBoundary fallbackTitle="定时任务模块出现问题"><TaskSchedulerModule /></ErrorBoundary>} />
  <Route path="/task-scheduler/:taskId" element={<ErrorBoundary fallbackTitle="定时任务模块出现问题"><TaskDetailPage /></ErrorBoundary>} />
  <Route path="/editor-scan" element={<ErrorBoundary fallbackTitle="IDE 模块出现问题"><EditorScanModule /></ErrorBoundary>} />
  <Route path="/token-usage" element={<ErrorBoundary fallbackTitle="Token Usage 模块出现问题"><TokenUsageModule /></ErrorBoundary>} />
  {import.meta.env.DEV ? <Route path="/workflow" element={<ErrorBoundary fallbackTitle="工作流模块出现问题"><WorkflowModule /></ErrorBoundary>} /> : null}
  <Route path="/settings" element={<ErrorBoundary fallbackTitle="设置模块出现问题"><SettingsModule /></ErrorBoundary>} />
</Routes>
```

Note: `TaskDetailPage` is imported but can be a stub initially (returns "TODO") — it will be built in Task 6.

- [ ] **Step 4: Create a stub TaskDetailPage for route registration**

```tsx
// src/modules/task-scheduler/pages/task-detail-page.tsx
import { useParams } from "react-router-dom"

function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>()
  return <div className="p-4 text-sm text-muted-foreground">Task detail: {taskId}</div>
}

export { TaskDetailPage }
```

- [ ] **Step 5: Verify existing tests still pass**

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx
```

The existing tests render `TaskSchedulerModule` directly with `renderToStaticMarkup` which doesn't need a router context. They should still pass. If any tests that use `createRoot` fail because of missing router context, wrap the rendered component in `<MemoryRouter>`.

Also run the broader test suite:

```bash
pnpm --filter @synapse/desktop exec vitest run --reporter=verbose 2>&1 | tail -30
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: migrate app navigation to react-router MemoryRouter"
```

---

## Task 4: Update TaskSchedulerModule list page for navigation

**Files:**
- Modify: `src/modules/task-scheduler/index.tsx`
- Modify: `src/modules/task-scheduler/components/task-card.tsx`
- Modify: `src/modules/task-scheduler/components/task-card-grid.tsx`

- [ ] **Step 1: Add onNavigateToTask to TaskCardGrid and TaskCard**

In `task-card-grid.tsx`, add `onNavigateToTask: (task: ScheduledTask) => void` to `TaskCardGridProps` and pass it through to each `TaskCard`.

In `task-card.tsx`, add `onNavigateToTask: () => void` to `TaskCardProps`. Change the "运行" button's `onClick` to call `onRun()` and then `onNavigateToTask()`.

In `task-card-grid.tsx`:

```tsx
// Add to TaskCardGridProps:
onNavigateToTask: (task: ScheduledTask) => void

// In the map:
<TaskCard
  ...existing props...
  onNavigateToTask={() => onNavigateToTask(task)}
/>
```

In `task-card.tsx`, change the run button handler:

```tsx
// The Play button onClick becomes:
onClick={() => {
  onRun()
  onNavigateToTask()
}}
```

- [ ] **Step 2: Update TaskSchedulerModule to use navigate**

In `src/modules/task-scheduler/index.tsx`:

1. Import `useNavigate` from `react-router-dom`
2. Add `const navigate = useNavigate()`
3. Pass `onNavigateToTask` to `TaskCardGrid`:

```tsx
onNavigateToTask={(task) => navigate(`/task-scheduler/${task.id}`)}
```

4. In `handleRunTask`, **remove** the `requestWatchNextAgentSession` / `cancelWatchNextAgentSession` logic and the `navigate` after run — the card's `onClick` already navigates. Keep `handleRunTask` as a pure fire-and-forget trigger that just calls `runTask` + shows toast.

Actually, re-reading the spec: from the list page, clicking "运行" should: call `runTask(id)` → navigate to `/task-scheduler/:taskId`. The card `onClick` handles both. The `handleRunTask` in index.tsx becomes simpler — it just calls `runTask` and shows toast on failure. The navigation happens via the card.

- [ ] **Step 3: Also add a "task name click" navigation**

In `task-card.tsx`, make the task name `<h3>` clickable to navigate to detail:

```tsx
<h3
  className="cursor-pointer truncate text-sm font-medium hover:underline"
  onClick={onNavigateToTask}
>
  {task.name}
</h3>
```

- [ ] **Step 4: Verify existing tests still pass**

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx
pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler/components/__tests__/task-card.test.tsx
pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler/components/__tests__/task-card-grid.test.tsx
```

If tests fail due to missing `onNavigateToTask` prop, add `onNavigateToTask: vi.fn()` to the test props.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(task-scheduler): navigate to detail page on run"
```

---

## Task 5: Create useTaskRunPolling hook

**Files:**
- Create: `src/modules/task-scheduler/hooks/use-task-run-polling.ts`
- Create: `src/modules/task-scheduler/hooks/__tests__/use-task-run-polling.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// src/modules/task-scheduler/hooks/__tests__/use-task-run-polling.test.ts
/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react-hooks"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ScheduledTask, ScheduledTaskRun } from "@/types/task-scheduler"

const mocks = vi.hoisted(() => ({
  getTask: vi.fn(),
  listRuns: vi.fn(),
  rendererLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => mocks.rendererLogger,
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({
    taskScheduler: {
      getTask: mocks.getTask,
      listRuns: mocks.listRuns,
    },
  }),
}))

import { useTaskRunPolling } from "../use-task-run-polling"

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

function createTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task-1",
    schemaVersion: 2,
    name: "Test",
    scope: { type: "global" },
    trigger: { type: "builtin.interval", config: { everyMinutes: 1, anchor: "created_at" } },
    action: { type: "builtin.command", config: { command: "echo ok" } },
    enabled: true,
    activeDays: [0, 1, 2, 3, 4, 5, 6],
    missedRunPolicy: "skip",
    overlapPolicy: "skip",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    runCount: 0,
    ...overrides,
  }
}

function createRun(overrides: Partial<ScheduledTaskRun> = {}): ScheduledTaskRun {
  return {
    id: "run-1",
    schemaVersion: 2,
    taskId: "task-1",
    startedAt: "2026-01-01T00:01:00.000Z",
    status: "success",
    triggeredBy: "manual",
    ...overrides,
  }
}

describe("useTaskRunPolling", () => {
  it("loads task and latest run on mount", async () => {
    const task = createTask()
    const run = createRun()
    mocks.getTask.mockResolvedValue(task)
    mocks.listRuns.mockResolvedValue([run])

    const { result, waitForNextUpdate } = renderHook(() =>
      useTaskRunPolling({ taskId: "task-1" }),
    )

    expect(result.current.loading).toBe(true)
    await waitForNextUpdate()

    expect(result.current.task).toEqual(task)
    expect(result.current.latestRun).toEqual(run)
    expect(result.current.loading).toBe(false)
  })

  it("starts polling when latest run is running", async () => {
    vi.useFakeTimers()
    const task = createTask()
    const runningRun = createRun({ status: "running" })
    const finishedRun = createRun({ status: "success", finishedAt: "2026-01-01T00:02:00.000Z" })
    mocks.getTask.mockResolvedValue(task)
    mocks.listRuns
      .mockResolvedValueOnce([runningRun])
      .mockResolvedValueOnce([finishedRun])

    const { result, waitForNextUpdate } = renderHook(() =>
      useTaskRunPolling({ taskId: "task-1" }),
    )

    await waitForNextUpdate()
    expect(result.current.latestRun?.status).toBe("running")

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(mocks.listRuns).toHaveBeenCalledTimes(2)
  })

  it("stops polling when run finishes", async () => {
    vi.useFakeTimers()
    const task = createTask()
    const finishedRun = createRun({ status: "success" })
    mocks.getTask.mockResolvedValue(task)
    mocks.listRuns.mockResolvedValue([finishedRun])

    const { result, waitForNextUpdate } = renderHook(() =>
      useTaskRunPolling({ taskId: "task-1" }),
    )

    await waitForNextUpdate()
    expect(result.current.latestRun?.status).toBe("success")

    const callsBefore = mocks.listRuns.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(4000)
    })

    expect(mocks.listRuns.mock.calls.length).toBe(callsBefore)
  })

  it("returns null task when taskId does not exist", async () => {
    mocks.getTask.mockResolvedValue(null)
    mocks.listRuns.mockResolvedValue([])

    const { result, waitForNextUpdate } = renderHook(() =>
      useTaskRunPolling({ taskId: "nonexistent" }),
    )

    await waitForNextUpdate()
    expect(result.current.task).toBeNull()
    expect(result.current.latestRun).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler/hooks/__tests__/use-task-run-polling.test.ts
```

Expected: FAIL — module not found.

Note: if `@testing-library/react-hooks` is not installed, use the raw `renderHook` from `@testing-library/react` instead, or use a manual `act`-based approach consistent with the existing test patterns in the project (which use `createRoot` + `act`). Adjust imports accordingly based on what's available.

- [ ] **Step 3: Write implementation**

```typescript
// src/modules/task-scheduler/hooks/use-task-run-polling.ts
import { useCallback, useEffect, useRef, useState } from "react"

import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { ScheduledTask, ScheduledTaskRun } from "@/types/task-scheduler"

const logger = createRendererLogger("task-scheduler.polling")
const POLL_INTERVAL_MS = 2000

type UseTaskRunPollingInput = {
  taskId: string
}

type UseTaskRunPollingResult = {
  task: ScheduledTask | null
  latestRun: ScheduledTaskRun | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

function useTaskRunPolling({ taskId }: UseTaskRunPollingInput): UseTaskRunPollingResult {
  const [task, setTask] = useState<ScheduledTask | null>(null)
  const [latestRun, setLatestRun] = useState<ScheduledTaskRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const taskIdRef = useRef(taskId)
  taskIdRef.current = taskId

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const fetchLatestRun = useCallback(async () => {
    try {
      const bridge = requireSynapseBridge()
      const runs = await bridge.taskScheduler.listRuns(taskIdRef.current, { limit: 1 })
      const run = runs[0] ?? null
      setLatestRun(run)
      if (run && run.status !== "running") {
        stopPolling()
        const freshTask = await bridge.taskScheduler.getTask(taskIdRef.current)
        if (freshTask) setTask(freshTask)
      }
    } catch (pollError) {
      logger.warn("Run polling failed.", {
        taskId: taskIdRef.current,
        boundary: "renderer.task-scheduler.polling",
        errorName: pollError instanceof Error ? pollError.name : typeof pollError,
      })
    }
  }, [stopPolling])

  const startPolling = useCallback(() => {
    stopPolling()
    timerRef.current = setInterval(() => {
      void fetchLatestRun()
    }, POLL_INTERVAL_MS)
  }, [fetchLatestRun, stopPolling])

  const loadInitial = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const bridge = requireSynapseBridge()
      const [fetchedTask, runs] = await Promise.all([
        bridge.taskScheduler.getTask(taskId),
        bridge.taskScheduler.listRuns(taskId, { limit: 1 }),
      ])
      setTask(fetchedTask)
      const run = runs[0] ?? null
      setLatestRun(run)
      if (run?.status === "running") {
        startPolling()
      }
    } catch (loadError) {
      logger.warn("Initial load failed.", {
        taskId,
        boundary: "renderer.task-scheduler.polling.init",
        errorName: loadError instanceof Error ? loadError.name : typeof loadError,
      })
      setError("加载失败")
    } finally {
      setLoading(false)
    }
  }, [taskId, startPolling])

  useEffect(() => {
    void loadInitial()
    return stopPolling
  }, [loadInitial, stopPolling])

  const refresh = useCallback(async () => {
    stopPolling()
    await loadInitial()
  }, [loadInitial, stopPolling])

  return { task, latestRun, loading, error, refresh }
}

export { useTaskRunPolling }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler/hooks/__tests__/use-task-run-polling.test.ts
```

Expected: PASS (adjust test if `@testing-library/react-hooks` is not available — use the `createRoot` + `act` pattern from existing tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(task-scheduler): add useTaskRunPolling hook"
```

---

## Task 6: Build TaskDetailPage

**Files:**
- Create: `src/modules/task-scheduler/components/task-summary-bar.tsx`
- Create: `src/modules/task-scheduler/components/task-latest-run.tsx`
- Modify: `src/modules/task-scheduler/pages/task-detail-page.tsx` (replace stub)

- [ ] **Step 1: Create TaskSummaryBar**

```tsx
// src/modules/task-scheduler/components/task-summary-bar.tsx
import { Badge } from "@/components/ui/badge"
import type { SynapseAgentProvider } from "@/types/bridge"
import type { SynapseProjectConfig } from "@/types/config"
import type { ScheduledTask } from "@/types/task-scheduler"
import {
  formatTaskNextRun,
  formatTaskScope,
  formatTaskTrigger,
} from "../utils"

type TaskSummaryBarProps = {
  task: ScheduledTask
  projects: readonly SynapseProjectConfig[]
  providers: readonly SynapseAgentProvider[]
}

function TaskSummaryBar({ task, projects }: TaskSummaryBarProps) {
  const statusVariant = !task.enabled
    ? "outline" as const
    : task.lastStatus === "failed" || task.lastStatus === "timeout"
      ? "destructive" as const
      : "secondary" as const
  const statusLabel = !task.enabled
    ? "已停用"
    : task.lastStatus === "failed" || task.lastStatus === "timeout"
      ? "上次失败"
      : "已启用"

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-4">
      <Badge variant={statusVariant}>{statusLabel}</Badge>
      <span className="text-sm text-muted-foreground">{formatTaskTrigger(task)}</span>
      <span className="text-sm text-muted-foreground">下次: {formatTaskNextRun(task)}</span>
      <span className="text-sm text-muted-foreground">范围: {formatTaskScope(task, projects)}</span>
    </div>
  )
}

export { TaskSummaryBar }
```

- [ ] **Step 2: Create TaskLatestRun**

```tsx
// src/modules/task-scheduler/components/task-latest-run.tsx
import { Clock, LoaderCircle, Play, RotateCcw } from "lucide-react"

import { ActionResultView } from "@/action-runtime/action-result-view"
import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import type { ScheduledTask, ScheduledTaskRun } from "@/types/task-scheduler"
import { formatRunStatus, formatTaskDate } from "../utils"

type TaskLatestRunProps = {
  run: ScheduledTaskRun
  task: ScheduledTask | null
}

function TaskLatestRun({ run, task }: TaskLatestRunProps) {
  const isRunning = run.status === "running"
  const hasOutput = run.result || run.error
  const statusVariant = run.status === "failed" || run.status === "timeout"
    ? "destructive" as const
    : "secondary" as const
  const triggerIcon = run.triggeredBy === "manual"
    ? <Play className="size-3" />
    : run.triggeredBy === "missed_run"
      ? <RotateCcw className="size-3" />
      : <Clock className="size-3" />
  const triggerLabel = run.triggeredBy === "manual"
    ? "手动"
    : run.triggeredBy === "missed_run"
      ? "补跑"
      : "计划"

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        {isRunning ? (
          <div className="flex items-center gap-2">
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
            <Badge variant="secondary">运行中</Badge>
          </div>
        ) : (
          <Badge variant={statusVariant}>{formatRunStatus(run)}</Badge>
        )}
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {triggerIcon}
          {triggerLabel}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatTaskDate(run.startedAt, "")}
        </span>
        {run.result?.metrics?.durationMs !== undefined ? (
          <span className="text-xs text-muted-foreground">
            {formatDuration(run.result.metrics.durationMs)}
          </span>
        ) : null}
      </div>

      {isRunning ? (
        <p className="mt-3 text-sm text-muted-foreground">正在执行...</p>
      ) : null}

      {!isRunning && hasOutput ? (
        <>
          <Separator className="my-3" />
          <div className="min-w-0 overflow-hidden">
            {run.result ? (
              <RunResultContent task={task} result={run.result} />
            ) : null}
            {run.error && !run.result?.error ? (
              <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2.5 text-xs break-all whitespace-pre-wrap">
                {run.error}
              </pre>
            ) : null}
          </div>
        </>
      ) : null}

      {!isRunning && !hasOutput ? (
        <p className="mt-3 text-sm text-muted-foreground">无输出</p>
      ) : null}
    </div>
  )
}

function RunResultContent({
  task,
  result,
}: {
  readonly task: ScheduledTask | null
  readonly result: NonNullable<ScheduledTaskRun["result"]>
}) {
  if (task) {
    try {
      const ResultView = rendererActionRegistry.get(task.action.type).ResultView
      if (ResultView) return <ResultView result={result} />
    } catch {
      return <ActionResultView result={result} />
    }
  }
  return <ActionResultView result={result} />
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms % 60_000) / 1000)
  return secs > 0 ? `${mins}m${secs}s` : `${mins}m`
}

export { TaskLatestRun }
```

- [ ] **Step 3: Build the full TaskDetailPage**

Replace the stub in `src/modules/task-scheduler/pages/task-detail-page.tsx`:

```tsx
// src/modules/task-scheduler/pages/task-detail-page.tsx
import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, LoaderCircle, Pencil, Play } from "lucide-react"

import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { Button } from "@/components/ui/button"
import type { SynapseAgentProvider } from "@/types/bridge"
import type { ScheduledTask } from "@/types/task-scheduler"
import { TaskFormDialog } from "../components/task-form-dialog"
import { TaskRunsDialog } from "../components/task-runs-dialog"
import { TaskSummaryBar } from "../components/task-summary-bar"
import { TaskLatestRun } from "../components/task-latest-run"
import type { TaskFormDialogState } from "../types"
import { useTaskRunPolling } from "../hooks/use-task-run-polling"
import { runTask, stopRun, updateTask } from "../hooks/use-task-scheduler"

const logger = createRendererLogger("task-scheduler.detail")

function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const { config } = useAppConfig()
  const { notify, promise } = useAppNotifications()
  const [providers, setProviders] = useState<readonly SynapseAgentProvider[]>([])
  const providerRequestRef = useRef(0)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [runBusy, setRunBusy] = useState(false)
  const [busy, setBusy] = useState(false)

  const { task, latestRun, loading, error, refresh } = useTaskRunPolling({
    taskId: taskId ?? "",
  })

  useEffect(() => {
    const requestId = ++providerRequestRef.current
    void requireSynapseBridge().agent.listProviders().then((list) => {
      if (requestId === providerRequestRef.current) setProviders(list)
    }).catch(() => {})
  }, [])

  const handleRun = useCallback(async () => {
    if (!taskId || runBusy) return
    setRunBusy(true)
    try {
      const run = await runTask(taskId)
      if (run && (run.status === "running" || run.status === "success")) {
        notify({ message: "任务已触发", tone: "success" })
      } else {
        notify({ message: "触发失败", tone: "destructive" })
      }
      await refresh()
    } catch (err) {
      logger.warn("Manual run failed.", {
        taskId,
        boundary: "renderer.task-scheduler.detail.run",
        errorName: err instanceof Error ? err.name : typeof err,
      })
      notify({ message: "触发失败", tone: "destructive" })
    } finally {
      setRunBusy(false)
    }
  }, [taskId, runBusy, notify, refresh])

  const handleStopRun = useCallback(async (runId: string) => {
    setBusy(true)
    try {
      await promise(
        async () => {
          const result = await stopRun(runId)
          if (!result.stopped) throw new Error("Task run was not active")
          return result
        },
        { loading: "正在停止运行...", success: "运行已停止。", error: "停止运行失败。" },
      )
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [promise, refresh])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        <span>加载中</span>
      </div>
    )
  }

  if (error || !task) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-sm text-muted-foreground">{error ?? "任务不存在"}</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/task-scheduler")}>
          返回列表
        </Button>
      </div>
    )
  }

  const isRunning = latestRun?.status === "running"

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Button variant="ghost" size="icon-sm" onClick={() => navigate("/task-scheduler")}>
          <ArrowLeft className="size-4" />
          <span className="sr-only">返回列表</span>
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-base font-medium">{task.name}</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsFormOpen(true)}
          >
            <Pencil className="size-3.5" />
            编辑
          </Button>
          <Button
            size="sm"
            disabled={!task.enabled || runBusy || isRunning}
            onClick={() => void handleRun()}
          >
            {runBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            {isRunning ? "运行中" : "运行"}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          <TaskSummaryBar
            task={task}
            projects={config.global.projects}
            providers={providers}
          />

          <div>
            <h3 className="mb-2 text-sm font-medium">最新运行</h3>
            {latestRun ? (
              <TaskLatestRun run={latestRun} task={task} />
            ) : (
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-sm text-muted-foreground">尚未运行</p>
              </div>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setIsHistoryOpen(true)}
          >
            查看历史记录
          </Button>
        </div>
      </div>

      <TaskFormDialog
        busy={busy}
        open={isFormOpen}
        projects={config.global.projects}
        state={{ mode: "edit", task } as TaskFormDialogState}
        onCreate={async () => {}}
        onOpenChange={setIsFormOpen}
        onUpdate={async (id, patch) => {
          setBusy(true)
          try {
            await updateTask(id, patch)
            await refresh()
            setIsFormOpen(false)
          } finally {
            setBusy(false)
          }
        }}
      />

      <TaskRunsDialog
        busy={busy}
        open={isHistoryOpen}
        task={task}
        onOpenChange={setIsHistoryOpen}
        onStopRun={handleStopRun}
      />
    </div>
  )
}

export { TaskDetailPage }
```

- [ ] **Step 4: Verify the page renders correctly in tests**

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler/ --reporter=verbose 2>&1 | tail -30
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(task-scheduler): build task detail page with run polling"
```

---

## Task 7: Fix loading spinner bug in list page

**Files:**
- Modify: `src/modules/task-scheduler/index.tsx`

- [ ] **Step 1: Fix the loading indicator**

In `src/modules/task-scheduler/index.tsx`, the current loading state at line ~356:

```tsx
// Before (broken — text may be affected by spin):
{loading ? (
  <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
    <LoaderCircle className="h-4 w-4 animate-spin" />
    加载中
  </div>
) : null}
```

Verify this is actually correct — the `animate-spin` is on the `LoaderCircle` only, the text "加载中" is a sibling node. If the text is a direct child of the `LoaderCircle` component somehow, fix it. Otherwise the structure looks correct. The real issue may be elsewhere — check if there are other places where `animate-spin` is applied to a parent.

If the structure is already correct, the "garbled text spinning" the user saw is likely from the task card's running state or the runs dialog. Check `task-card.tsx` for similar issues. In any case, ensure all loading indicators use the pattern:

```tsx
<div className="flex items-center gap-2">
  <LoaderCircle className="size-4 animate-spin" />
  <span>加载中</span>
</div>
```

Where the text is wrapped in a `<span>` to guarantee CSS isolation.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "fix(task-scheduler): isolate spinner animation from text"
```

---

## Task 8: Run full test suite and verify

- [ ] **Step 1: Run all task-scheduler tests**

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler/ --reporter=verbose
```

All tests should pass.

- [ ] **Step 2: Run broader project tests**

```bash
pnpm --filter @synapse/desktop exec vitest run --reporter=verbose 2>&1 | tail -50
```

Fix any failures caused by the router migration (typically: components that were rendered without router context in tests now need `<MemoryRouter>` wrapper).

- [ ] **Step 3: Run TypeScript check**

```bash
pnpm --filter @synapse/desktop run typecheck 2>&1 | tail -20
```

- [ ] **Step 4: Commit any test fixes**

```bash
git add -A
git commit -m "test: fix tests for react-router migration"
```
