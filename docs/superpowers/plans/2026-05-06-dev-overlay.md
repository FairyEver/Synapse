# Dev Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a frosted-glass "开发中" overlay to Agent and Task Scheduler modules in production builds.

**Architecture:** A shared `<DevOverlay>` component wraps target modules in `App.tsx`. It reads `isPackaged` from the preload bridge to decide whether to render the overlay. The overlay blocks all interaction while keeping the underlying UI visible.

**Tech Stack:** React, Tailwind CSS (backdrop-blur), Lucide icons, Electron preload bridge

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `desktop/src/types/bridge.ts` | Add `isPackaged: boolean` to `SynapseBridge` type |
| Modify | `desktop/src/lib/electron-bridge.ts` | Exclude `isPackaged` from `SynapseBridgeDomain` |
| Modify | `desktop/electron/preload.ts` | Expose `app.isPackaged` via bridge |
| Create | `desktop/src/components/dev-overlay.tsx` | Shared overlay component |
| Modify | `desktop/src/App.tsx` | Wrap Agent and TaskScheduler with `<DevOverlay>` |

---

### Task 1: Add `isPackaged` to Preload Bridge

**Files:**
- Modify: `desktop/src/types/bridge.ts:215-221`
- Modify: `desktop/src/lib/electron-bridge.ts:6`
- Modify: `desktop/electron/preload.ts:296-298`

- [ ] **Step 1: Add `isPackaged` to `SynapseBridge` type**

In `desktop/src/types/bridge.ts`, add `isPackaged` after `versions`:

```typescript
export type SynapseBridge = {
  platform: string
  versions: {
    chrome: string
    electron: string
    node: string
  }
  isPackaged: boolean
  content: {
```

- [ ] **Step 2: Exclude `isPackaged` from `SynapseBridgeDomain`**

In `desktop/src/lib/electron-bridge.ts`, update the exclude union:

```typescript
type SynapseBridgeDomain = Exclude<keyof SynapseBridge, "platform" | "versions" | "isPackaged">
```

- [ ] **Step 3: Expose `isPackaged` in preload bridge**

In `desktop/electron/preload.ts`, add `isPackaged` to the `synapseBridge` object (line 296), after `versions`.

In Electron preload scripts, `app.isPackaged` is not directly accessible (the `app` module belongs to the main process). The existing codebase already uses `process.env.VITE_DEV_SERVER_URL` to distinguish dev from production (see `electron/bootstrap/main-window.ts:75`). Use the same pattern:

```typescript
const synapseBridge: SynapseBridge = {
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },
  isPackaged: !process.env.VITE_DEV_SERVER_URL,
  content: {
```

`VITE_DEV_SERVER_URL` is only set during `pnpm dev`. In production builds it's undefined, so `!undefined` → `true`.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd desktop && npx tsc --noEmit`
Expected: No errors related to `isPackaged`

- [ ] **Step 5: Commit**

```bash
git add desktop/src/types/bridge.ts desktop/src/lib/electron-bridge.ts desktop/electron/preload.ts
git commit -m "feat: expose isPackaged flag via preload bridge"
```

---

### Task 2: Create `<DevOverlay>` Component

**Files:**
- Create: `desktop/src/components/dev-overlay.tsx`

- [ ] **Step 1: Create the component**

Create `desktop/src/components/dev-overlay.tsx`:

```tsx
import { Construction } from "lucide-react"
import { requireSynapseBridge } from "@/lib/electron-bridge"

interface DevOverlayProps {
  children: React.ReactNode
  label?: string
}

function DevOverlay({ children, label = "开发中" }: DevOverlayProps) {
  const isPackaged = requireSynapseBridge().isPackaged

  return (
    <div className="relative h-full">
      {children}
      {isPackaged && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-md">
          <div className="flex flex-col items-center gap-2">
            <Construction className="size-8 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{label}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export { DevOverlay }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd desktop && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add desktop/src/components/dev-overlay.tsx
git commit -m "feat: add DevOverlay component for in-development modules"
```

---

### Task 3: Wrap Modules in App.tsx

**Files:**
- Modify: `desktop/src/App.tsx:329-343`

- [ ] **Step 1: Add import**

Add to the imports section of `App.tsx`:

```typescript
import { DevOverlay } from "@/components/dev-overlay"
```

- [ ] **Step 2: Wrap Agent module**

Change lines 329-333 from:

```tsx
{activeTab === "agent" ? (
  <ErrorBoundary fallbackTitle="Agent 模块出现问题">
    <AgentModule />
  </ErrorBoundary>
) : null}
```

To:

```tsx
{activeTab === "agent" ? (
  <ErrorBoundary fallbackTitle="Agent 模块出现问题">
    <DevOverlay>
      <AgentModule />
    </DevOverlay>
  </ErrorBoundary>
) : null}
```

- [ ] **Step 3: Wrap Task Scheduler module**

Change lines 339-343 from:

```tsx
{activeTab === "task-scheduler" ? (
  <ErrorBoundary fallbackTitle="定时任务模块出现问题">
    <TaskSchedulerModule />
  </ErrorBoundary>
) : null}
```

To:

```tsx
{activeTab === "task-scheduler" ? (
  <ErrorBoundary fallbackTitle="定时任务模块出现问题">
    <DevOverlay>
      <TaskSchedulerModule />
    </DevOverlay>
  </ErrorBoundary>
) : null}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd desktop && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Visual verification in dev mode**

Run: `pnpm dev` and navigate to Agent and Task Scheduler tabs.
Expected: No overlay visible (dev mode), modules render normally.

To test the overlay visually, temporarily hardcode `isPackaged` to `true` in the component, verify the frosted glass effect appears correctly, then revert.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/App.tsx
git commit -m "feat: wrap Agent and TaskScheduler with DevOverlay in production"
```
