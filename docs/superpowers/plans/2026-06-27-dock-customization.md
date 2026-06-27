# Dock Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users customize the bottom Dock's pinned apps and order from Settings, the launcher, and Dock menus.

**Architecture:** Keep Dock layout in `config.global.dockAppIds`, with pure helpers in `desktop/src/modules/apps/dock.ts` and one shared `useDockPreferences` hook for all config writes. Full editing lives in Settings, while launcher and Dock surfaces use shared menu content for pin, unpin, and manage actions.

**Tech Stack:** Electron 41, Vite 8, React 19, TypeScript 6, shadcn/Radix UI, Tailwind CSS 4, dnd-kit, Vitest, pnpm monorepo.

---

## Scope Notes

This plan implements the approved design in `docs/superpowers/specs/2026-06-27-dock-customization-design.md`.

Do not add Dock icon size settings, recent apps, Dock grouping, Dock direct drag sorting, or a new DataRepository namespace. Do not add explanatory UI paragraphs. Use existing shadcn/Radix primitives and Tailwind token classes only.

## File Structure

### Dependencies

- Modify `desktop/package.json`
  - Add `@dnd-kit/core`, `@dnd-kit/sortable`, and `@dnd-kit/utilities`.
- Modify `pnpm-lock.yaml`
  - Let pnpm update the lockfile.

### Dock Model

- Modify `desktop/src/modules/apps/dock.ts`
  - Keep `DEFAULT_DOCK_APP_IDS`.
  - Add `REQUIRED_DOCK_APP_ID = "launcher"`.
  - Change normalization so missing config seeds defaults but existing arrays preserve user intent.
  - Add insert, remove, move, reorder, default restore, and addable-app helpers.
- Modify `desktop/src/modules/apps/__tests__/dock.test.ts`
  - Replace fixed-Dock tests with editable Dock behavior tests.
- Modify `desktop/src/lib/config.ts`
  - Preserve default seeding for missing `dockAppIds`.
  - Preserve user arrays while normalizing existing config.
- Modify `desktop/src/lib/__tests__/config.test.ts`
  - Update tests for the new normalization semantics.

### Settings Navigation

- Modify `desktop/src/modules/settings/types.ts`
  - Add `dock` to `SettingsCategoryId`.
- Modify `desktop/src/modules/settings/data.ts`
  - Add `Dock 栏` after `基础设置`.
- Modify `desktop/src/app-shell/navigation.ts`
  - Add `requestOpenSettingsDock`, `subscribeOpenSettingsDock`, and `consumeRequestedSettingsCategory` support for `dock`.
- Modify `desktop/src/modules/settings/index.tsx`
  - Subscribe to Dock settings requests.
  - Render `DockPanel` for the Dock category.
- Modify `desktop/src/modules/apps/components/system-app-content.tsx`
  - Pass `workflowEntryVisible` into `SettingsModule`.

### Shared Dock Preferences

- Create `desktop/src/modules/apps/hooks/use-dock-preferences.ts`
  - Read config through `useAppConfig`.
  - Expose normalized ids, pinned app manifests, addable app manifests, saving state, and actions.
  - Apply optimistic updates, block concurrent writes, and roll back on failure.
- Create `desktop/src/modules/apps/hooks/__tests__/use-dock-preferences.test.tsx`
  - Test add, remove, move, restore, saving disablement, and rollback.

### Settings Dock Panel

- Create `desktop/src/modules/settings/components/dock-panel.tsx`
  - Render pinned and addable lists.
  - Use `DndContext`, `SortableContext`, and buttons for sorting.
  - Keep copy minimal.
- Create `desktop/src/modules/settings/components/sortable-dock-item.tsx`
  - Render one pinned row and own dnd-kit sortable wiring.
- Create `desktop/src/modules/settings/components/__tests__/dock-panel.test.tsx`
  - Test visible rows and actions through the hook contract.

### Shared Menus

- Create `desktop/src/modules/apps/components/dock-app-menu-items.tsx`
  - Shared menu item content for DropdownMenu and ContextMenu variants.
- Create `desktop/src/modules/apps/components/__tests__/dock-app-menu-items.test.tsx`
  - Test visible actions for pinned, unpinned, removable, and launcher cases.

### Launcher

- Modify `desktop/src/modules/apps/components/app-launcher-grid.tsx`
  - Add hover/focus more button.
  - Add right-click context menu.
  - Keep card click opening the app.
- Modify `desktop/src/modules/apps/components/system-app-content.tsx`
  - Use `useDockPreferences` inside `LauncherContent`.
  - Wire launcher menus to add, remove, and manage Dock.
- Create or modify `desktop/src/modules/apps/components/__tests__/app-launcher-grid.test.tsx`
  - Test card open, menu trigger isolation, pin, unpin, launcher protection, and manage action.

### Bottom Dock

- Modify `desktop/src/app-shell/components/app-shell-dock.tsx`
  - Keep presentational props for left-click switching.
  - Add optional context menu props for remove and manage Dock.
  - Do not read config directly.
- Modify `desktop/src/app-shell/components/__tests__/app-shell-dock.test.tsx`
  - Replace the old no-unpin-affordance assertion with right-click menu tests.
- Modify `desktop/src/App.tsx`
  - Use `useDockPreferences` for normalized Dock ids and actions.
  - Pass remove/manage actions to `AppShellDock`.

### Release Notes

- Modify `RELEASE_NOTES_PENDING.md`
  - Add one user-facing bullet about Dock customization.

## Task 1: Add dnd-kit Dependencies

**Files:**
- Modify: `desktop/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Install dependencies**

Run:

```bash
pnpm --filter @synapse/desktop add @dnd-kit/core@^6.3.1 @dnd-kit/sortable@^10.0.0 @dnd-kit/utilities@^3.2.2
```

Expected: `desktop/package.json` includes the three packages under `dependencies`, and `pnpm-lock.yaml` changes.

- [ ] **Step 2: Verify dependency metadata**

Run:

```bash
pnpm --filter @synapse/desktop exec tsc -p tsconfig.json --noEmit --pretty false
```

Expected: PASS.

- [ ] **Step 3: Commit dependency update**

Run:

```bash
git add desktop/package.json pnpm-lock.yaml
git commit -m "chore: add dock drag dependencies"
```

Expected: commit succeeds.

## Task 2: Implement Editable Dock Model

**Files:**
- Modify: `desktop/src/modules/apps/dock.ts`
- Modify: `desktop/src/modules/apps/__tests__/dock.test.ts`
- Modify: `desktop/src/lib/config.ts`
- Modify: `desktop/src/lib/__tests__/config.test.ts`

- [ ] **Step 1: Replace Dock model tests**

In `desktop/src/modules/apps/__tests__/dock.test.ts`, replace the fixed-Dock behavior tests with this suite shape:

```ts
import { describe, expect, it } from "vitest"
import { WORKFLOW_ENTRY_CHEAT_CODE_NAME } from "@/lib/cheat-codes/names"
import { listSystemApps } from "../registry"
import {
  DEFAULT_DOCK_APP_IDS,
  insertDockAppId,
  listAddableDockApps,
  listDockApps,
  moveDockAppId,
  normalizeDockAppIds,
  removeDockAppId,
  reorderDockAppIds,
  restoreDefaultDockAppIds,
  seedDefaultDockAppIds,
} from "../dock"

describe("app Dock model", () => {
  it("seeds the default Dock for missing config", () => {
    expect(seedDefaultDockAppIds()).toEqual([
      "agent",
      "drive",
      "automation",
      "workflow",
      "terminal",
      "settings",
      "launcher",
    ])
    expect(restoreDefaultDockAppIds()).toEqual(DEFAULT_DOCK_APP_IDS)
  })

  it("normalizes stored Dock ids without restoring removed defaults", () => {
    expect(normalizeDockAppIds(undefined)).toEqual(DEFAULT_DOCK_APP_IDS)
    expect(normalizeDockAppIds([])).toEqual(["launcher"])
    expect(normalizeDockAppIds(["database", "ghost", "database"])).toEqual(["database", "launcher"])
    expect(normalizeDockAppIds(["launcher", "agent"])).toEqual(["launcher", "agent"])
  })

  it("inserts newly pinned apps before launcher", () => {
    expect(insertDockAppId(["agent", "launcher"], "database")).toEqual(["agent", "database", "launcher"])
    expect(insertDockAppId(["launcher", "agent"], "database")).toEqual(["database", "launcher", "agent"])
    expect(insertDockAppId(["agent", "launcher"], "agent")).toEqual(["agent", "launcher"])
  })

  it("does not remove launcher", () => {
    expect(removeDockAppId(["agent", "launcher"], "agent")).toEqual(["launcher"])
    expect(removeDockAppId(["agent", "launcher"], "launcher")).toEqual(["agent", "launcher"])
  })

  it("moves pinned apps with bounds protection", () => {
    expect(moveDockAppId(["agent", "drive", "launcher"], "drive", "up")).toEqual(["drive", "agent", "launcher"])
    expect(moveDockAppId(["agent", "drive", "launcher"], "drive", "down")).toEqual(["agent", "launcher", "drive"])
    expect(moveDockAppId(["agent", "drive", "launcher"], "agent", "up")).toEqual(["agent", "drive", "launcher"])
  })

  it("reorders pinned apps by active and over ids", () => {
    expect(reorderDockAppIds(["agent", "drive", "launcher"], "agent", "launcher")).toEqual(["drive", "launcher", "agent"])
    expect(reorderDockAppIds(["agent", "drive", "launcher"], "missing", "drive")).toEqual(["agent", "drive", "launcher"])
  })

  it("filters hidden workflow from visible Dock without dropping persisted order", () => {
    const dockAppIds = ["workflow", "database", "launcher"] as const

    expect(listDockApps(listSystemApps(), { dockAppIds, workflowEntryVisible: false }).map((app) => app.id))
      .toEqual(["database", "launcher"])
    expect(listDockApps(listSystemApps(), { dockAppIds, workflowEntryVisible: true }).map((app) => app.id))
      .toEqual(["workflow", "database", "launcher"])
  })

  it("lists addable apps from launchable visible apps only", () => {
    expect(listAddableDockApps(listSystemApps(), {
      dockAppIds: ["agent", "launcher"],
      workflowEntryVisible: false,
    }).map((app) => app.id)).not.toContain("workflow")
    expect(listAddableDockApps(listSystemApps(), {
      dockAppIds: ["agent", "launcher"],
      workflowEntryVisible: { [WORKFLOW_ENTRY_CHEAT_CODE_NAME]: true }[WORKFLOW_ENTRY_CHEAT_CODE_NAME],
    }).map((app) => app.id)).toContain("workflow")
  })
})
```

- [ ] **Step 2: Run the failing Dock tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/__tests__/dock.test.ts
```

Expected: FAIL because helper functions do not exist and normalization still returns the fixed default.

- [ ] **Step 3: Implement Dock helpers**

In `desktop/src/modules/apps/dock.ts`, implement the model with these exports and semantics:

```ts
import type { SynapseSystemAppId, SynapseSystemAppManifest } from "./types"
import { isSystemAppId } from "./types"

export const DEFAULT_DOCK_APP_IDS = [
  "agent",
  "drive",
  "automation",
  "workflow",
  "terminal",
  "settings",
  "launcher",
] as const satisfies readonly SynapseSystemAppId[]

export const REQUIRED_DOCK_APP_ID = "launcher" as const satisfies SynapseSystemAppId

export type DockMoveDirection = "up" | "down"

export function seedDefaultDockAppIds(): SynapseSystemAppId[] {
  return [...DEFAULT_DOCK_APP_IDS]
}

export function restoreDefaultDockAppIds(): SynapseSystemAppId[] {
  return seedDefaultDockAppIds()
}

export function normalizeDockAppIds(values: readonly unknown[] | undefined): SynapseSystemAppId[] {
  if (values === undefined) {
    return seedDefaultDockAppIds()
  }

  const next: SynapseSystemAppId[] = []
  for (const value of values) {
    if (typeof value !== "string" || !isSystemAppId(value)) continue
    if (next.includes(value)) continue
    next.push(value)
  }

  if (!next.includes(REQUIRED_DOCK_APP_ID)) {
    next.push(REQUIRED_DOCK_APP_ID)
  }

  return next
}

export function insertDockAppId(values: readonly unknown[] | undefined, appId: SynapseSystemAppId): SynapseSystemAppId[] {
  const current = normalizeDockAppIds(values).filter((value) => value !== appId)
  const launcherIndex = current.indexOf(REQUIRED_DOCK_APP_ID)
  const insertIndex = launcherIndex >= 0 ? launcherIndex : current.length

  return [
    ...current.slice(0, insertIndex),
    appId,
    ...current.slice(insertIndex),
  ]
}

export function removeDockAppId(values: readonly unknown[] | undefined, appId: SynapseSystemAppId): SynapseSystemAppId[] {
  if (appId === REQUIRED_DOCK_APP_ID) {
    return normalizeDockAppIds(values)
  }

  return normalizeDockAppIds(values).filter((value) => value !== appId)
}

export function moveDockAppId(
  values: readonly unknown[] | undefined,
  appId: SynapseSystemAppId,
  direction: DockMoveDirection,
): SynapseSystemAppId[] {
  const current = normalizeDockAppIds(values)
  const index = current.indexOf(appId)
  if (index < 0) return current

  const targetIndex = direction === "up" ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= current.length) return current

  const next = [...current]
  const [item] = next.splice(index, 1)
  next.splice(targetIndex, 0, item)
  return next
}

export function reorderDockAppIds(
  values: readonly unknown[] | undefined,
  activeId: SynapseSystemAppId,
  overId: SynapseSystemAppId,
): SynapseSystemAppId[] {
  const current = normalizeDockAppIds(values)
  const activeIndex = current.indexOf(activeId)
  const overIndex = current.indexOf(overId)
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return current

  const next = [...current]
  const [item] = next.splice(activeIndex, 1)
  next.splice(overIndex, 0, item)
  return next
}

export function listDockApps(
  apps: readonly SynapseSystemAppManifest[],
  options: {
    readonly workflowEntryVisible: boolean
    readonly dockAppIds?: readonly SynapseSystemAppId[]
  },
): readonly SynapseSystemAppManifest[] {
  const appById = new Map(apps.map((app) => [app.id, app]))

  return normalizeDockAppIds(options.dockAppIds)
    .map((appId) => appById.get(appId))
    .filter((app): app is SynapseSystemAppManifest => Boolean(app))
    .filter((app) => app.dock.visibility !== "workflow-entry-enabled" || options.workflowEntryVisible)
}

export function listAddableDockApps(
  apps: readonly SynapseSystemAppManifest[],
  options: {
    readonly workflowEntryVisible: boolean
    readonly dockAppIds?: readonly SynapseSystemAppId[]
  },
): readonly SynapseSystemAppManifest[] {
  const pinned = new Set(normalizeDockAppIds(options.dockAppIds))

  return apps
    .filter((app) => app.id !== REQUIRED_DOCK_APP_ID)
    .filter((app) => app.window.openable)
    .filter((app) => app.dock.visibility !== "workflow-entry-enabled" || options.workflowEntryVisible)
    .filter((app) => !pinned.has(app.id))
}
```

Keep `resolveDefaultDockAppId` in the same file and let it continue calling `listDockApps`.

- [ ] **Step 4: Update config normalization tests**

In `desktop/src/lib/__tests__/config.test.ts`, update the existing `sanitizeSynapseConfig` Dock config test so it expects preserved custom values:

```ts
it("seeds and normalizes Dock app ids in global config", () => {
  expect(createDefaultConfig().global.dockAppIds).toEqual(DEFAULT_DOCK_APP_IDS)

  const config = sanitizeSynapseConfig({
    activeRepoUuid: null,
    repositories: [],
    global: {
      themeMode: "light",
      projects: [],
      dockAppIds: ["database", "ghost", "database"],
    },
  })

  expect(config.global.dockAppIds).toEqual(["database", "launcher"])
})
```

- [ ] **Step 5: Ensure config missing values still seed defaults**

In `desktop/src/lib/config.ts`, keep missing `dockAppIds` calls as:

```ts
dockAppIds: normalizeDockAppIds(Array.isArray(value.dockAppIds) ? value.dockAppIds : undefined),
```

This preserves the distinction:

```text
missing or non-array -> default Dock
array -> cleaned user layout
```

- [ ] **Step 6: Run model and config tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/__tests__/dock.test.ts src/lib/__tests__/config.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Dock model**

Run:

```bash
git add desktop/src/modules/apps/dock.ts desktop/src/modules/apps/__tests__/dock.test.ts desktop/src/lib/config.ts desktop/src/lib/__tests__/config.test.ts
git commit -m "feat: support editable dock model"
```

Expected: commit succeeds.

## Task 3: Add Settings Dock Navigation

**Files:**
- Modify: `desktop/src/app-shell/navigation.ts`
- Modify: `desktop/src/modules/settings/types.ts`
- Modify: `desktop/src/modules/settings/data.ts`
- Modify: `desktop/src/modules/settings/index.tsx`
- Modify: `desktop/src/modules/apps/components/system-app-content.tsx`
- Test: `desktop/src/modules/settings/__tests__/settings-layout.test.tsx` or add focused test if this file does not cover category routing.

- [ ] **Step 1: Write a category routing test**

Add a test that imports `requestOpenSettingsDock`, renders `SettingsModule`, calls the request, and expects the Dock category to become active. Use the existing settings layout test harness pattern. The assertion should look for the category label:

```ts
expect(document.body.textContent).toContain("Dock 栏")
```

and, after request, should expect the Dock panel placeholder text added in Step 4:

```ts
expect(document.body.textContent).toContain("已固定")
```

- [ ] **Step 2: Run the failing settings test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/settings/__tests__/settings-layout.test.tsx
```

Expected: FAIL because the Dock category and request helper do not exist.

- [ ] **Step 3: Extend navigation helpers**

In `desktop/src/app-shell/navigation.ts`, add a Dock event and extend the requested category type:

```ts
const OPEN_SETTINGS_DOCK_EVENT = "synapse:open-settings-dock"
type RequestedSettingsCategory = "account" | "repositories" | "about" | "dock"

function requestOpenSettingsDock(): void {
  requestedSettingsCategory = "dock"
  requestOpenSettingsTab()
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_DOCK_EVENT))
}

function subscribeOpenSettingsDock(listener: () => void): () => void {
  const handleEvent = () => {
    listener()
  }

  window.addEventListener(OPEN_SETTINGS_DOCK_EVENT, handleEvent)

  return () => {
    window.removeEventListener(OPEN_SETTINGS_DOCK_EVENT, handleEvent)
  }
}
```

Export both new functions.

- [ ] **Step 4: Extend settings types and category data**

In `desktop/src/modules/settings/types.ts`, add `dock`:

```ts
type SettingsCategoryId = "account" | "general" | "dock" | "repositories" | "projects" | "claude-code" | "variables" | "troubleshooting" | "about" | "admin"
```

In `desktop/src/modules/settings/data.ts`, import `PanelBottom` from `lucide-react` and add the category after `general`:

```ts
{
  id: "dock",
  icon: PanelBottom,
  label: "Dock 栏",
  description: "固定应用和顺序。",
},
```

- [ ] **Step 5: Add a temporary Dock panel shell**

In `desktop/src/modules/settings/index.tsx`, import `subscribeOpenSettingsDock` and add the subscription:

```ts
useEffect(() => {
  return subscribeOpenSettingsDock(() => {
    setActiveCategory("dock")
  })
}, [setActiveCategory])
```

Add a temporary render block that the real panel replaces in Task 5:

```tsx
{isReady && activeCategory === "dock" ? (
  <SettingsGroup>
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">已固定</h2>
      <p className="text-sm text-muted-foreground">Dock 设置加载中</p>
    </div>
  </SettingsGroup>
) : null}
```

This temporary text is only a construction scaffold and must be removed in Task 5.

- [ ] **Step 6: Pass workflow visibility into SettingsModule**

In `desktop/src/modules/settings/index.tsx`, add props:

```ts
type SettingsModuleProps = {
  readonly workflowEntryVisible?: boolean
}

function SettingsModule({ workflowEntryVisible = false }: SettingsModuleProps) {
```

The temporary Dock block does not use this prop yet, but Task 5 will.

In `desktop/src/modules/apps/components/system-app-content.tsx`, change:

```tsx
if (appId === "settings") return <SettingsModule />
```

to:

```tsx
if (appId === "settings") return <SettingsModule workflowEntryVisible={workflowEntryVisible} />
```

- [ ] **Step 7: Run settings test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/settings/__tests__/settings-layout.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit settings navigation**

Run:

```bash
git add desktop/src/app-shell/navigation.ts desktop/src/modules/settings/types.ts desktop/src/modules/settings/data.ts desktop/src/modules/settings/index.tsx desktop/src/modules/apps/components/system-app-content.tsx desktop/src/modules/settings/__tests__/settings-layout.test.tsx
git commit -m "feat: add dock settings category"
```

Expected: commit succeeds.

## Task 4: Implement Shared Dock Preferences Hook

**Files:**
- Create: `desktop/src/modules/apps/hooks/use-dock-preferences.ts`
- Create: `desktop/src/modules/apps/hooks/__tests__/use-dock-preferences.test.tsx`

- [ ] **Step 1: Write hook tests**

Create `desktop/src/modules/apps/hooks/__tests__/use-dock-preferences.test.tsx` with a jsdom render harness that mocks `useAppConfig` and `useAppNotifications`.

Test these behaviors:

```ts
it("adds apps before launcher", async () => {
  // config.global.dockAppIds starts as ["agent", "launcher"]
  // call result.current.addDockApp("database")
  // expect updateConfig to receive { global: { dockAppIds: ["agent", "database", "launcher"] } }
})

it("does not remove launcher", async () => {
  // call result.current.removeDockApp("launcher")
  // expect updateConfig not to be called
})

it("moves apps and restores defaults", async () => {
  // moveDockApp("drive", "up") writes moved ids
  // restoreDefaultDock writes DEFAULT_DOCK_APP_IDS
})

it("rolls back optimistic ids when saving fails", async () => {
  // updateConfig rejects
  // after promise settles, pinnedAppIds return config ids
})
```

Use actual assertions rather than snapshots.

- [ ] **Step 2: Run the failing hook test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/hooks/__tests__/use-dock-preferences.test.tsx
```

Expected: FAIL because the hook file does not exist.

- [ ] **Step 3: Implement the hook**

Create `desktop/src/modules/apps/hooks/use-dock-preferences.ts`:

```ts
import { useCallback, useMemo, useState } from "react"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import {
  DEFAULT_DOCK_APP_IDS,
  insertDockAppId,
  listAddableDockApps,
  listDockApps,
  moveDockAppId,
  normalizeDockAppIds,
  removeDockAppId,
  reorderDockAppIds,
  restoreDefaultDockAppIds,
  type DockMoveDirection,
} from "@/modules/apps/dock"
import { listSystemApps } from "@/modules/apps/registry"
import type { SynapseSystemAppId } from "@/modules/apps/types"

const logger = createRendererLogger("dock.preferences")

type UseDockPreferencesOptions = {
  readonly workflowEntryVisible: boolean
}

export function useDockPreferences({ workflowEntryVisible }: UseDockPreferencesOptions) {
  const { config, updateConfig } = useAppConfig()
  const { error: notifyError, success } = useAppNotifications()
  const [optimisticDockAppIds, setOptimisticDockAppIds] = useState<readonly SynapseSystemAppId[] | null>(null)
  const [saving, setSaving] = useState(false)

  const savedDockAppIds = useMemo(
    () => normalizeDockAppIds(config.global.dockAppIds),
    [config.global.dockAppIds],
  )
  const dockAppIds = optimisticDockAppIds ?? savedDockAppIds
  const allApps = listSystemApps()
  const pinnedApps = useMemo(
    () => listDockApps(allApps, { dockAppIds, workflowEntryVisible }),
    [allApps, dockAppIds, workflowEntryVisible],
  )
  const addableApps = useMemo(
    () => listAddableDockApps(allApps, { dockAppIds, workflowEntryVisible }),
    [allApps, dockAppIds, workflowEntryVisible],
  )

  const saveDockAppIds = useCallback(async (
    nextDockAppIds: readonly SynapseSystemAppId[],
    messages: { readonly success: string; readonly failure: string },
  ) => {
    if (saving) return false

    setSaving(true)
    setOptimisticDockAppIds([...nextDockAppIds])
    try {
      await updateConfig({ global: { dockAppIds: [...nextDockAppIds] } })
      success(messages.success)
      return true
    } catch (saveError) {
      logger.error("Failed to save Dock preferences.", saveError)
      notifyError(messages.failure)
      return false
    } finally {
      setOptimisticDockAppIds(null)
      setSaving(false)
    }
  }, [notifyError, saving, success, updateConfig])

  const addDockApp = useCallback((appId: SynapseSystemAppId) => (
    saveDockAppIds(insertDockAppId(dockAppIds, appId), {
      success: "Dock 设置已保存",
      failure: "保存 Dock 设置失败",
    })
  ), [dockAppIds, saveDockAppIds])

  const removeDockApp = useCallback((appId: SynapseSystemAppId) => {
    const nextDockAppIds = removeDockAppId(dockAppIds, appId)
    if (nextDockAppIds.join("\u0000") === normalizeDockAppIds(dockAppIds).join("\u0000")) {
      return Promise.resolve(false)
    }
    return saveDockAppIds(nextDockAppIds, {
      success: "Dock 设置已保存",
      failure: "保存 Dock 设置失败",
    })
  }, [dockAppIds, saveDockAppIds])

  const moveDockApp = useCallback((appId: SynapseSystemAppId, direction: DockMoveDirection) => (
    saveDockAppIds(moveDockAppId(dockAppIds, appId, direction), {
      success: "Dock 设置已保存",
      failure: "保存 Dock 设置失败",
    })
  ), [dockAppIds, saveDockAppIds])

  const reorderDockApps = useCallback((activeId: SynapseSystemAppId, overId: SynapseSystemAppId) => (
    saveDockAppIds(reorderDockAppIds(dockAppIds, activeId, overId), {
      success: "Dock 设置已保存",
      failure: "保存 Dock 设置失败",
    })
  ), [dockAppIds, saveDockAppIds])

  const restoreDefaultDock = useCallback(() => (
    saveDockAppIds(restoreDefaultDockAppIds(), {
      success: "Dock 已恢复默认",
      failure: "恢复 Dock 默认设置失败",
    })
  ), [saveDockAppIds])

  return {
    addableApps,
    addDockApp,
    dockAppIds,
    pinnedApps,
    removeDockApp,
    moveDockApp,
    reorderDockApps,
    restoreDefaultDock,
    saving,
    defaultDockAppIds: DEFAULT_DOCK_APP_IDS,
  }
}
```

- [ ] **Step 4: Run hook tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/hooks/__tests__/use-dock-preferences.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit hook**

Run:

```bash
git add desktop/src/modules/apps/hooks/use-dock-preferences.ts desktop/src/modules/apps/hooks/__tests__/use-dock-preferences.test.tsx
git commit -m "feat: add dock preferences hook"
```

Expected: commit succeeds.

## Task 5: Build Dock Settings Panel

**Files:**
- Create: `desktop/src/modules/settings/components/dock-panel.tsx`
- Create: `desktop/src/modules/settings/components/sortable-dock-item.tsx`
- Create: `desktop/src/modules/settings/components/__tests__/dock-panel.test.tsx`
- Modify: `desktop/src/modules/settings/index.tsx`

- [ ] **Step 1: Write panel behavior tests**

Create `desktop/src/modules/settings/components/__tests__/dock-panel.test.tsx` and mock `useDockPreferences`. Cover:

```ts
it("renders pinned and addable app lists", () => {
  // pinnedApps: agent, launcher
  // addableApps: database
  // expect text: 已固定, 可添加, 对话, 应用, 本地数据库
})

it("calls add, remove, move, and restore actions", () => {
  // click 添加 -> addDockApp("database")
  // click 移除 for agent -> removeDockApp("agent")
  // click 上移 / 下移 -> moveDockApp(...)
  // click 恢复默认 -> restoreDefaultDock()
})

it("does not render remove for launcher and disables controls while saving", () => {
  // launcher row has no 移除 button
  // saving true disables action buttons
})
```

- [ ] **Step 2: Run the failing panel test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/settings/components/__tests__/dock-panel.test.tsx
```

Expected: FAIL because `DockPanel` does not exist.

- [ ] **Step 3: Implement sortable row**

Create `desktop/src/modules/settings/components/sortable-dock-item.tsx` with:

```tsx
import { CSS } from "@dnd-kit/utilities"
import { useSortable } from "@dnd-kit/sortable"
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { REQUIRED_DOCK_APP_ID, type DockMoveDirection } from "@/modules/apps/dock"
import type { SynapseSystemAppId, SynapseSystemAppManifest } from "@/modules/apps/types"

type SortableDockItemProps = {
  readonly app: SynapseSystemAppManifest
  readonly disabled: boolean
  readonly isFirst: boolean
  readonly isLast: boolean
  readonly onMove: (appId: SynapseSystemAppId, direction: DockMoveDirection) => void
  readonly onRemove: (appId: SynapseSystemAppId) => void
}

export function SortableDockItem({ app, disabled, isFirst, isLast, onMove, onRemove }: SortableDockItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: app.id, disabled })
  const removable = app.id !== REQUIRED_DOCK_APP_ID

  return (
    <div
      ref={setNodeRef}
      className="flex min-h-12 items-center gap-3 px-3 py-2 data-[dragging=true]:bg-muted"
      data-dragging={isDragging ? "true" : undefined}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        aria-label={`拖动 ${app.name}`}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <img src={app.icon} alt="" className="size-8 shrink-0 object-contain" draggable={false} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{app.name}</span>
      <Button type="button" variant="ghost" size="icon" disabled={disabled || isFirst} aria-label={`上移 ${app.name}`} onClick={() => onMove(app.id, "up")}>
        <ArrowUp />
      </Button>
      <Button type="button" variant="ghost" size="icon" disabled={disabled || isLast} aria-label={`下移 ${app.name}`} onClick={() => onMove(app.id, "down")}>
        <ArrowDown />
      </Button>
      {removable ? (
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onRemove(app.id)}>
          <X data-icon="inline-start" />
          移除
        </Button>
      ) : null}
    </div>
  )
}
```

The inline `style` is allowed here because dnd-kit supplies dynamic runtime transform values.

- [ ] **Step 4: Implement DockPanel**

Create `desktop/src/modules/settings/components/dock-panel.tsx`:

```tsx
import { DndContext, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { Plus, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SettingsGroup } from "@/modules/settings/components/settings-group"
import { SortableDockItem } from "@/modules/settings/components/sortable-dock-item"
import { useDockPreferences } from "@/modules/apps/hooks/use-dock-preferences"
import type { SynapseSystemAppId } from "@/modules/apps/types"

type DockPanelProps = {
  readonly workflowEntryVisible: boolean
}

export function DockPanel({ workflowEntryVisible }: DockPanelProps) {
  const dock = useDockPreferences({ workflowEntryVisible })

  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id) as SynapseSystemAppId
    const overId = event.over ? String(event.over.id) as SynapseSystemAppId : null
    if (!overId || activeId === overId) return
    void dock.reorderDockApps(activeId, overId)
  }

  return (
    <div className="flex flex-col gap-2">
      <SettingsGroup sectionClassName="p-0">
        <div className="px-4 py-3">
          <h2 className="text-sm font-medium">已固定</h2>
        </div>
        <Separator />
        <DndContext onDragEnd={handleDragEnd}>
          <SortableContext items={dock.pinnedApps.map((app) => app.id)} strategy={verticalListSortingStrategy}>
            <div className="divide-y divide-border">
              {dock.pinnedApps.map((app, index) => (
                <SortableDockItem
                  key={app.id}
                  app={app}
                  disabled={dock.saving}
                  isFirst={index === 0}
                  isLast={index === dock.pinnedApps.length - 1}
                  onMove={(appId, direction) => void dock.moveDockApp(appId, direction)}
                  onRemove={(appId) => void dock.removeDockApp(appId)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </SettingsGroup>

      <SettingsGroup sectionClassName="p-0">
        <div className="px-4 py-3">
          <h2 className="text-sm font-medium">可添加</h2>
        </div>
        <Separator />
        {dock.addableApps.length === 0 ? (
          <div className="px-4 py-4 text-sm text-muted-foreground">已全部固定</div>
        ) : (
          <div className="divide-y divide-border">
            {dock.addableApps.map((app) => (
              <div key={app.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
                <img src={app.icon} alt="" className="size-8 shrink-0 object-contain" draggable={false} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{app.name}</span>
                <Button type="button" variant="outline" size="sm" disabled={dock.saving} onClick={() => void dock.addDockApp(app.id)}>
                  <Plus data-icon="inline-start" />
                  添加
                </Button>
              </div>
            ))}
          </div>
        )}
      </SettingsGroup>

      <div className="flex justify-end">
        <Button type="button" variant="outline" disabled={dock.saving} onClick={() => void dock.restoreDefaultDock()}>
          <RotateCcw data-icon="inline-start" />
          恢复默认
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Replace temporary settings render**

In `desktop/src/modules/settings/index.tsx`, import `DockPanel` and replace the temporary Dock block with:

```tsx
{isReady && activeCategory === "dock" ? (
  <DockPanel workflowEntryVisible={workflowEntryVisible} />
) : null}
```

- [ ] **Step 6: Run Dock panel tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/settings/components/__tests__/dock-panel.test.tsx src/modules/settings/__tests__/settings-layout.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit settings panel**

Run:

```bash
git add desktop/src/modules/settings/components/dock-panel.tsx desktop/src/modules/settings/components/sortable-dock-item.tsx desktop/src/modules/settings/components/__tests__/dock-panel.test.tsx desktop/src/modules/settings/index.tsx desktop/src/modules/settings/__tests__/settings-layout.test.tsx
git commit -m "feat: add dock settings panel"
```

Expected: commit succeeds.

## Task 6: Create Shared Menu Items

**Files:**
- Create: `desktop/src/modules/apps/components/dock-app-menu-items.tsx`
- Create: `desktop/src/modules/apps/components/__tests__/dock-app-menu-items.test.tsx`

- [ ] **Step 1: Write menu item tests**

Test the pure helper exported from the menu item module:

```ts
expect(resolveDockAppMenuActions({ pinned: false, removable: true })).toEqual(["open", "pin", "manage"])
expect(resolveDockAppMenuActions({ pinned: true, removable: true })).toEqual(["open", "unpin", "manage"])
expect(resolveDockAppMenuActions({ pinned: true, removable: false })).toEqual(["open", "manage"])
```

- [ ] **Step 2: Run failing menu tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/components/__tests__/dock-app-menu-items.test.tsx
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement menu action resolver and render helpers**

Create `desktop/src/modules/apps/components/dock-app-menu-items.tsx`:

```tsx
import { Pin, PinOff, Settings2, SquareArrowOutUpRight } from "lucide-react"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { ContextMenuItem } from "@/components/ui/context-menu"
import type { SynapseSystemAppId } from "@/modules/apps/types"

type DockAppMenuAction = "open" | "pin" | "unpin" | "manage"

export function resolveDockAppMenuActions(options: {
  readonly pinned: boolean
  readonly removable: boolean
  readonly includePinAction?: boolean
}): DockAppMenuAction[] {
  const actions: DockAppMenuAction[] = ["open"]
  if (options.includePinAction !== false) {
    if (!options.pinned) actions.push("pin")
    if (options.pinned && options.removable) actions.push("unpin")
  } else if (options.pinned && options.removable) {
    actions.push("unpin")
  }
  actions.push("manage")
  return actions
}

type DockAppMenuItemsProps = {
  readonly appId: SynapseSystemAppId
  readonly pinned: boolean
  readonly removable: boolean
  readonly includePinAction?: boolean
  readonly itemKind: "dropdown" | "context"
  readonly onOpen: (appId: SynapseSystemAppId) => void
  readonly onPin: (appId: SynapseSystemAppId) => void
  readonly onUnpin: (appId: SynapseSystemAppId) => void
  readonly onManageDock: () => void
}

export function DockAppMenuItems(props: DockAppMenuItemsProps) {
  const Item = props.itemKind === "dropdown" ? DropdownMenuItem : ContextMenuItem
  const actions = resolveDockAppMenuActions(props)

  return (
    <>
      {actions.includes("open") ? (
        <Item onSelect={() => props.onOpen(props.appId)}>
          <SquareArrowOutUpRight data-icon="inline-start" />
          打开
        </Item>
      ) : null}
      {actions.includes("pin") ? (
        <Item onSelect={() => props.onPin(props.appId)}>
          <Pin data-icon="inline-start" />
          固定到 Dock
        </Item>
      ) : null}
      {actions.includes("unpin") ? (
        <Item onSelect={() => props.onUnpin(props.appId)}>
          <PinOff data-icon="inline-start" />
          从 Dock 移除
        </Item>
      ) : null}
      {actions.includes("manage") ? (
        <Item onSelect={props.onManageDock}>
          <Settings2 data-icon="inline-start" />
          管理 Dock
        </Item>
      ) : null}
    </>
  )
}
```

- [ ] **Step 4: Run menu item tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/components/__tests__/dock-app-menu-items.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit menu items**

Run:

```bash
git add desktop/src/modules/apps/components/dock-app-menu-items.tsx desktop/src/modules/apps/components/__tests__/dock-app-menu-items.test.tsx
git commit -m "feat: add shared dock app menu items"
```

Expected: commit succeeds.

## Task 7: Add Launcher Pin And Manage Menus

**Files:**
- Modify: `desktop/src/modules/apps/components/app-launcher-grid.tsx`
- Modify: `desktop/src/modules/apps/components/system-app-content.tsx`
- Create or modify: `desktop/src/modules/apps/components/__tests__/app-launcher-grid.test.tsx`

- [ ] **Step 1: Write launcher menu tests**

Test:

```ts
it("opens app when the launcher card is clicked", () => {
  expect(onOpenApp).toHaveBeenCalledWith("database")
})

it("opens the app menu without opening the app when the more button is clicked", () => {
  expect(onOpenApp).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain("固定到 Dock")
})

it("calls pin for unpinned apps", () => {
  expect(onPinApp).toHaveBeenCalledWith("database")
})

it("calls unpin for pinned removable apps", () => {
  expect(onUnpinApp).toHaveBeenCalledWith("database")
})

it("does not offer unpin for launcher", () => {
  expect(document.body.textContent).not.toContain("从 Dock 移除")
})

it("calls manage Dock from the menu", () => {
  expect(onManageDock).toHaveBeenCalledTimes(1)
})
```

Use visible labels: `固定到 Dock`, `从 Dock 移除`, and `管理 Dock`.

- [ ] **Step 2: Run failing launcher tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/components/__tests__/app-launcher-grid.test.tsx
```

Expected: FAIL because launcher menus do not exist.

- [ ] **Step 3: Extend AppLauncherGrid props**

In `desktop/src/modules/apps/components/app-launcher-grid.tsx`, add props:

```ts
readonly pinnedAppIds: readonly SynapseSystemAppId[]
readonly disabled?: boolean
readonly onPinApp: (appId: SynapseSystemAppId) => void
readonly onUnpinApp: (appId: SynapseSystemAppId) => void
readonly onManageDock: () => void
```

Render each app button inside `ContextMenu`, and render a `DropdownMenu` trigger button positioned with utility classes inside the card:

```tsx
<ContextMenu>
  <ContextMenuTrigger asChild>
    <button
      type="button"
      className="group relative flex h-36 w-32 flex-col items-center justify-start rounded-md px-3 py-3 text-center outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-background/60 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
      onClick={() => onOpenApp(app.id)}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1 size-7 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            aria-label={`${app.name} 更多操作`}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DockAppMenuItems
            appId={app.id}
            pinned={pinnedAppIds.includes(app.id)}
            removable={app.id !== REQUIRED_DOCK_APP_ID}
            itemKind="dropdown"
            onOpen={onOpenApp}
            onPin={onPinApp}
            onUnpin={onUnpinApp}
            onManageDock={onManageDock}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <img src={app.icon} alt="" className="size-22 shrink-0 object-cover transition-transform duration-150 ease-out group-hover:scale-[1.035] motion-reduce:transition-none motion-reduce:group-hover:scale-100" draggable={false} />
      <span className="mt-3 flex min-w-0 flex-1 items-start">
        <span className="block max-w-full truncate text-sm font-medium leading-tight text-foreground">{app.name}</span>
      </span>
    </button>
  </ContextMenuTrigger>
  <ContextMenuContent>
    <DockAppMenuItems
      appId={app.id}
      pinned={pinnedAppIds.includes(app.id)}
      removable={app.id !== REQUIRED_DOCK_APP_ID}
      itemKind="context"
      onOpen={onOpenApp}
      onPin={onPinApp}
      onUnpin={onUnpinApp}
      onManageDock={onManageDock}
    />
  </ContextMenuContent>
</ContextMenu>
```

Use `REQUIRED_DOCK_APP_ID` to mark launcher as non-removable.

- [ ] **Step 4: Wire LauncherContent**

In `desktop/src/modules/apps/components/system-app-content.tsx`, import:

```ts
import { requestOpenSettingsDock } from "@/app-shell/navigation"
import { useDockPreferences } from "@/modules/apps/hooks/use-dock-preferences"
```

Inside `LauncherContent`, create:

```ts
const dock = useDockPreferences({ workflowEntryVisible })
```

Pass to `AppLauncherGrid`:

```tsx
<AppLauncherGrid
  apps={listLaunchableSystemApps({ workflowEntryVisible })}
  pinnedAppIds={dock.dockAppIds}
  disabled={dock.saving}
  onOpenApp={openApp}
  onPinApp={(appId) => void dock.addDockApp(appId)}
  onUnpinApp={(appId) => void dock.removeDockApp(appId)}
  onManageDock={requestOpenSettingsDock}
/>
```

- [ ] **Step 5: Run launcher tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/components/__tests__/app-launcher-grid.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit launcher menus**

Run:

```bash
git add desktop/src/modules/apps/components/app-launcher-grid.tsx desktop/src/modules/apps/components/system-app-content.tsx desktop/src/modules/apps/components/__tests__/app-launcher-grid.test.tsx
git commit -m "feat: add launcher dock menus"
```

Expected: commit succeeds.

## Task 8: Add Bottom Dock Context Menu

**Files:**
- Modify: `desktop/src/app-shell/components/app-shell-dock.tsx`
- Modify: `desktop/src/app-shell/components/__tests__/app-shell-dock.test.tsx`
- Modify: `desktop/src/App.tsx`

- [ ] **Step 1: Update AppShellDock tests**

In `desktop/src/app-shell/components/__tests__/app-shell-dock.test.tsx`, replace `does not expose drag or unpin affordances` with tests:

```ts
it("opens a context menu for removable Dock apps", async () => {
  const onRemoveApp = vi.fn()
  const onManageDock = vi.fn()
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <AppShellDock
        apps={apps}
        value="agent"
        onValueChange={vi.fn()}
        removableAppIds={["agent", "drive"]}
        onRemoveApp={onRemoveApp}
        onManageDock={onManageDock}
      />,
    )
    await Promise.resolve()
  })

  await act(async () => {
    findButtonByLabel("对话").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))
    await Promise.resolve()
  })

  expect(document.body.textContent).toContain("从 Dock 移除")
  expect(document.body.textContent).toContain("管理 Dock")

  await act(async () => {
    findMenuItemByText("从 Dock 移除").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
  })

  expect(onRemoveApp).toHaveBeenCalledWith("agent")
})

it("does not offer removal for launcher", async () => {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <AppShellDock
        apps={apps}
        value="launcher"
        onValueChange={vi.fn()}
        removableAppIds={["agent", "drive"]}
        onRemoveApp={vi.fn()}
        onManageDock={vi.fn()}
      />,
    )
    await Promise.resolve()
  })

  await act(async () => {
    findButtonByLabel("应用").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))
    await Promise.resolve()
  })

  expect(document.body.textContent).not.toContain("从 Dock 移除")
  expect(document.body.textContent).toContain("管理 Dock")
})
```

Add this helper below `findButtonByLabel`:

```ts
function findMenuItemByText(text: string): HTMLElement {
  const item = Array.from(document.querySelectorAll("[role='menuitem']")).find((element) => element.textContent?.includes(text))

  if (!(item instanceof HTMLElement)) {
    throw new Error(`Menu item not found: ${text}`)
  }

  return item
}
```

Keep existing left-click tests unchanged.

- [ ] **Step 2: Run failing Dock component tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/app-shell/components/__tests__/app-shell-dock.test.tsx
```

Expected: FAIL because context menu props do not exist.

- [ ] **Step 3: Extend AppShellDock props and render ContextMenu**

In `desktop/src/app-shell/components/app-shell-dock.tsx`, add optional props:

```ts
readonly removableAppIds?: readonly SynapseSystemAppId[]
readonly onRemoveApp?: (appId: SynapseSystemAppId) => void
readonly onManageDock?: () => void
```

Wrap each button in `ContextMenu` and use `DockAppMenuItems`:

```tsx
<ContextMenu key={app.id}>
  <ContextMenuTrigger asChild>
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="relative h-12 w-11 hover:bg-transparent active:bg-transparent aria-[current=page]:bg-transparent aria-[current=page]:text-foreground dark:hover:bg-transparent"
      aria-label={app.name}
      aria-current={app.id === value ? "page" : undefined}
      onClick={() => onValueChange(app.id)}
    >
      <img src={app.icon} alt="" className="size-10 object-contain" draggable={false} />
      {app.id === value ? (
        <span
          data-slot="app-shell-dock-active-indicator"
          aria-hidden="true"
          className="absolute bottom-0 left-1/2 size-1 -translate-x-1/2 rounded-full bg-primary"
        />
      ) : null}
    </Button>
  </ContextMenuTrigger>
  <ContextMenuContent>
    <DockAppMenuItems
      appId={app.id}
      pinned={true}
      removable={Boolean(removableAppIds?.includes(app.id))}
      includePinAction={false}
      itemKind="context"
      onOpen={onValueChange}
      onPin={() => undefined}
      onUnpin={(appId) => onRemoveApp?.(appId)}
      onManageDock={() => onManageDock?.()}
    />
  </ContextMenuContent>
</ContextMenu>
```

- [ ] **Step 4: Wire App.tsx**

In `desktop/src/App.tsx`, import:

```ts
import { requestOpenSettingsDock } from "@/app-shell/navigation"
import { REQUIRED_DOCK_APP_ID } from "@/modules/apps/dock"
import { useDockPreferences } from "@/modules/apps/hooks/use-dock-preferences"
```

Use the hook near existing Dock calculations:

```ts
const dockPreferences = useDockPreferences({ workflowEntryVisible })
const dockAppIds = dockPreferences.dockAppIds
const dockApps = useMemo(
  () => listDockApps(listSystemApps(), { workflowEntryVisible, dockAppIds }),
  [dockAppIds, workflowEntryVisible],
)
const removableDockAppIds = useMemo(
  () => dockAppIds.filter((appId) => appId !== REQUIRED_DOCK_APP_ID),
  [dockAppIds],
)
```

Pass props:

```tsx
<AppShellDock
  apps={dockApps}
  value={activeAppId}
  onValueChange={(appId) => setActiveAppId(appId, "dock")}
  removableAppIds={removableDockAppIds}
  onRemoveApp={(appId) => void dockPreferences.removeDockApp(appId)}
  onManageDock={requestOpenSettingsDock}
/>
```

Keep the existing workflow fallback effect unchanged.

- [ ] **Step 5: Run Dock tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/app-shell/components/__tests__/app-shell-dock.test.tsx src/__tests__/App.workflow-entry.test.tsx src/__tests__/App.navigation-order.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit bottom Dock menu**

Run:

```bash
git add desktop/src/app-shell/components/app-shell-dock.tsx desktop/src/app-shell/components/__tests__/app-shell-dock.test.tsx desktop/src/App.tsx
git commit -m "feat: add dock context menu actions"
```

Expected: commit succeeds.

## Task 9: Release Notes And Full Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add this bullet under the appropriate pending release section:

```md
- Dock 支持自定义固定应用和排序，可在设置中管理，也能从启动器或 Dock 菜单快速固定和移除应用。
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/modules/apps/__tests__/dock.test.ts \
  src/modules/apps/hooks/__tests__/use-dock-preferences.test.tsx \
  src/modules/apps/components/__tests__/dock-app-menu-items.test.tsx \
  src/modules/apps/components/__tests__/app-launcher-grid.test.tsx \
  src/modules/settings/components/__tests__/dock-panel.test.tsx \
  src/modules/settings/__tests__/settings-layout.test.tsx \
  src/app-shell/components/__tests__/app-shell-dock.test.tsx \
  src/lib/__tests__/config.test.ts \
  src/__tests__/App.workflow-entry.test.tsx \
  src/__tests__/App.navigation-order.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run hard constraints check**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS. If it flags inline `style` in `sortable-dock-item.tsx`, confirm the check permits dynamic dnd-kit transform style. If it does not, move the dnd-kit style application to the smallest approved local pattern used elsewhere in the project and keep no custom colors.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff --stat HEAD
git diff -- desktop/src/modules/apps/dock.ts desktop/src/modules/settings/components/dock-panel.tsx desktop/src/app-shell/components/app-shell-dock.tsx
```

Expected: changes are scoped to Dock customization, settings category wiring, tests, dependencies, and release notes.

- [ ] **Step 6: Commit release notes and final adjustments**

Run:

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note dock customization"
```

Expected: commit succeeds if only release notes remain. If verification fixes changed source or tests, include those files in the final commit with a message that describes the fix, for example `fix: stabilize dock customization tests`.

## Self-Review Checklist

- Product coverage:
  - Settings has a Dock category and full management.
  - Launcher offers pin, unpin, and manage Dock.
  - Bottom Dock offers unpin and manage Dock through right click.
  - Launcher cannot be removed.
  - Settings can be removed.
  - New pins insert before launcher.
  - Dock direct drag sorting is not implemented.
  - Settings list drag sorting and up/down fallback are implemented.
  - Restore default is immediate and does not show a confirmation dialog.
  - Removing the active app does not switch content.
  - Hidden workflow is filtered from display without destroying stored order.
  - Release notes are updated.
- Test coverage:
  - Pure Dock helpers.
  - Hook save and rollback.
  - Settings panel actions.
  - Launcher menu actions.
  - Dock context menu actions.
  - Config migration and default seeding.
- UI constraints:
  - No hex/rgb/hsl literal colors.
  - No Tailwind arbitrary colors.
  - No card nesting beyond existing `SettingsGroup` surfaces.
  - No explanatory paragraphs in Dock UI.
  - Inline style appears only for dynamic dnd-kit transform and transition values.
