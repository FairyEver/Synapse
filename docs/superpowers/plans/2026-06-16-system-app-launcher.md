# System App Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `应用` Launchpad module, move low-frequency modules into fixed system app windows, and keep each app window single-instance.

**Architecture:** Add an app definition/manifest registry boundary, with each system app owning pure metadata and its bitmap icon inside its module directory. Electron main process uses pure definitions that do not import PNG assets; renderer uses manifests that include icon URLs. Add a main-process `system-app-window-service` plus `apps` IPC module so the launcher opens `?window=system-app&appId=<id>` child windows.

**Tech Stack:** Electron `BrowserWindow`, React, TypeScript, Vite image imports, shadcn/Radix UI, Tailwind token classes, Vitest.

---

## File Structure

- Create `desktop/src/modules/apps/types.ts`: shared app ids, pure definition types, renderer manifest types, app id parser.
- Create `desktop/src/modules/apps/definitions.ts`: imports first-phase pure system definitions and exposes Electron-safe list/get helpers.
- Create `desktop/src/modules/apps/registry.ts`: imports first-phase renderer manifests and exposes list/get helpers with icon URLs.
- Create `desktop/src/modules/apps/index.tsx`: main-window Launchpad module.
- Create `desktop/src/modules/apps/components/app-launcher-grid.tsx`: pure responsive icon grid.
- Create `desktop/src/modules/apps/system-app-window-app.tsx`: renderer entry for `window=system-app`.
- Create `desktop/src/modules/resource-repository/index.tsx`: wrapper for `SkillsModule`, `RulesModule`, `PromptsModule`.
- Create `desktop/src/modules/resource-repository/app-definition.ts`: Resource Repository pure definition.
- Create `desktop/src/modules/resource-repository/app-manifest.ts`: Resource Repository renderer manifest.
- Create `desktop/src/modules/resource-repository/assets/icon.png`: Resource Repository bitmap icon.
- Modify `desktop/src/modules/database/app-definition.ts`: add Database pure definition.
- Modify `desktop/src/modules/database/app-manifest.ts`: add Database renderer manifest and `assets/icon.png`.
- Modify `desktop/src/modules/editor-scan/app-definition.ts`: add IDE pure definition.
- Modify `desktop/src/modules/editor-scan/app-manifest.ts`: add IDE renderer manifest and `assets/icon.png`.
- Modify `desktop/src/modules/usage-analysis/index.tsx`: export `UsageMonitorModule`; add `app-definition.ts`, `app-manifest.ts`, and `assets/icon.png`.
- Modify `desktop/src/modules/model-price/app-definition.ts`: add Price pure definition.
- Modify `desktop/src/modules/model-price/app-manifest.ts`: add Price renderer manifest and `assets/icon.png`.
- Create `desktop/electron/services/system-app-window-service.ts`: single-instance app window manager.
- Create `desktop/electron/services/__tests__/system-app-window-service.test.ts`: service tests.
- Create `desktop/electron/modules/apps/ipc.ts`: `synapse:apps:open-system-app` IPC descriptor.
- Create `desktop/electron/modules/apps/__tests__/ipc.test.ts`: IPC validation tests.
- Modify `desktop/electron/bootstrap/ipc-registry.ts`: register the apps IPC module.
- Modify `desktop/electron/preload.ts`: add apps IPC channel, `synapse.apps.openSystemApp`, and resource content-open event subscription.
- Modify `desktop/src/types/bridge.ts`: add bridge typing.
- Modify `desktop/src/main.tsx`: route `window=system-app` to `SystemAppWindowApp`.
- Modify `desktop/src/App.tsx`: add `AppsModule`, remove low-frequency tab renders.
- Modify `desktop/config.ts`: update top-level navigation with Chinese comments preserved.
- Modify `desktop/src/__tests__/App.navigation-order.test.ts`: expected top-level order.
- Modify `desktop/src/__tests__/App.workflow-entry.test.tsx`: update visible navigation and app module behavior.
- Add focused renderer tests for registry, launcher, resource wrapper, usage wrapper, and system app window.
- Modify `RELEASE_NOTES_PENDING.md` after implementation.

---

### Task 1: App Types And Registry

**Files:**
- Create: `desktop/src/modules/apps/types.ts`
- Create: `desktop/src/modules/apps/definitions.ts`
- Create: `desktop/src/modules/apps/registry.ts`
- Create: `desktop/src/modules/apps/__tests__/registry.test.ts`

- [ ] **Step 1: Write failing registry tests**

Create `desktop/src/modules/apps/__tests__/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  getSystemAppDefinition,
  listSystemAppDefinitions,
  parseSystemAppId,
} from "../definitions"
import {
  getSystemAppManifest,
  listSystemApps,
} from "../registry"

describe("system app registry", () => {
  it("lists the fixed first-phase system apps in launcher order", () => {
    expect(listSystemApps().map((app) => app.id)).toEqual([
      "resource-repository",
      "database",
      "editor-scan",
      "usage-monitor",
      "model-price",
    ])
  })

  it("marks every system app as fixed", () => {
    for (const app of listSystemApps()) {
      expect(app.type).toBe("system")
      expect(app.removable).toBe(false)
      expect(app.renameable).toBe(false)
      expect(app.iconEditable).toBe(false)
      expect(app.icon).toMatch(/\.png/)
      expect(app.name.length).toBeGreaterThan(0)
      expect(app.windowTitle.length).toBeGreaterThan(0)
    }
  })

  it("exposes pure definitions without icon URLs for Electron", () => {
    const definitions = listSystemAppDefinitions()
    expect(definitions.map((app) => app.id)).toEqual(listSystemApps().map((app) => app.id))
    expect(definitions.every((app) => !("icon" in app))).toBe(true)
    expect(getSystemAppDefinition("model-price")?.windowTitle).toBe("价格管理")
  })

  it("gets and parses known app ids only", () => {
    expect(getSystemAppManifest("database")?.name).toBe("本地数据库")
    expect(getSystemAppManifest("unknown")).toBeNull()
    expect(parseSystemAppId("usage-monitor")).toBe("usage-monitor")
    expect(parseSystemAppId("unknown")).toBeNull()
  })
})
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/__tests__/registry.test.ts
```

Expected: FAIL because `desktop/src/modules/apps/registry.ts` does not exist.

- [ ] **Step 3: Create app types**

Create `desktop/src/modules/apps/types.ts`:

```ts
export const SYSTEM_APP_IDS = [
  "resource-repository",
  "database",
  "editor-scan",
  "usage-monitor",
  "model-price",
] as const

export type SynapseSystemAppId = (typeof SYSTEM_APP_IDS)[number]
export type SynapseAppType = "system"
export type ResourceRepositoryViewId = "skill" | "rule" | "prompt"
export type UsageMonitorViewId = "cc" | "codex"
export type SynapseSystemAppDefaultView = ResourceRepositoryViewId | UsageMonitorViewId

export type SynapseSystemAppDefinition = {
  readonly id: SynapseSystemAppId
  readonly type: "system"
  readonly name: string
  readonly windowTitle: string
  readonly defaultView?: SynapseSystemAppDefaultView
  readonly removable: false
  readonly renameable: false
  readonly iconEditable: false
}

export type SynapseSystemAppManifest = SynapseSystemAppDefinition & {
  readonly icon: string
}

export type SynapseSystemAppOpenOptions = {
  readonly contentOpenRequest?: import("@/app-shell/content-navigation").ContentOpenRequest | null
}

export function isSystemAppId(value: string): value is SynapseSystemAppId {
  return (SYSTEM_APP_IDS as readonly string[]).includes(value)
}
```

- [ ] **Step 4: Add temporary definition and registry implementations**

Create `desktop/src/modules/apps/definitions.ts`:

```ts
import type { SynapseSystemAppDefinition, SynapseSystemAppId } from "./types"
import { isSystemAppId } from "./types"

const systemAppDefinitions: readonly SynapseSystemAppDefinition[] = [
  {
    id: "resource-repository",
    type: "system",
    name: "资源仓库",
    windowTitle: "资源仓库",
    defaultView: "skill",
    removable: false,
    renameable: false,
    iconEditable: false,
  },
  {
    id: "database",
    type: "system",
    name: "本地数据库",
    windowTitle: "本地数据库",
    removable: false,
    renameable: false,
    iconEditable: false,
  },
  {
    id: "editor-scan",
    type: "system",
    name: "IDE 管理",
    windowTitle: "IDE 管理",
    removable: false,
    renameable: false,
    iconEditable: false,
  },
  {
    id: "usage-monitor",
    type: "system",
    name: "用量监控",
    windowTitle: "用量监控",
    defaultView: "cc",
    removable: false,
    renameable: false,
    iconEditable: false,
  },
  {
    id: "model-price",
    type: "system",
    name: "价格管理",
    windowTitle: "价格管理",
    removable: false,
    renameable: false,
    iconEditable: false,
  },
] as const

export function listSystemAppDefinitions(): readonly SynapseSystemAppDefinition[] {
  return systemAppDefinitions
}

export function parseSystemAppId(value: string | null | undefined): SynapseSystemAppId | null {
  return typeof value === "string" && isSystemAppId(value) ? value : null
}

export function getSystemAppDefinition(appId: string): SynapseSystemAppDefinition | null {
  if (!isSystemAppId(appId)) return null
  return systemAppDefinitions.find((app) => app.id === appId) ?? null
}
```

Create `desktop/src/modules/apps/registry.ts`:

```ts
import { listSystemAppDefinitions } from "./definitions"
import type { SynapseSystemAppManifest } from "./types"
import { isSystemAppId } from "./types"

const systemApps: readonly SynapseSystemAppManifest[] = listSystemAppDefinitions().map((app) => ({
  ...app,
  icon: `${app.id}.png`,
}))

export function listSystemApps(): readonly SynapseSystemAppManifest[] {
  return systemApps
}

export function getSystemAppManifest(appId: string): SynapseSystemAppManifest | null {
  if (!isSystemAppId(appId)) return null
  return systemApps.find((app) => app.id === appId) ?? null
}
```

- [ ] **Step 5: Run the registry test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/__tests__/registry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/apps/types.ts desktop/src/modules/apps/definitions.ts desktop/src/modules/apps/registry.ts desktop/src/modules/apps/__tests__/registry.test.ts
git commit -m "feat(apps): add system app registry"
```

---

### Task 2: Module-Owned Manifests And Icon Assets

**Files:**
- Create: `desktop/src/modules/resource-repository/app-definition.ts`
- Create: `desktop/src/modules/resource-repository/app-manifest.ts`
- Create: `desktop/src/modules/resource-repository/assets/icon.png`
- Create: `desktop/src/modules/database/app-definition.ts`
- Create: `desktop/src/modules/database/app-manifest.ts`
- Create: `desktop/src/modules/database/assets/icon.png`
- Create: `desktop/src/modules/editor-scan/app-definition.ts`
- Create: `desktop/src/modules/editor-scan/app-manifest.ts`
- Create: `desktop/src/modules/editor-scan/assets/icon.png`
- Create: `desktop/src/modules/usage-analysis/app-definition.ts`
- Create: `desktop/src/modules/usage-analysis/app-manifest.ts`
- Create: `desktop/src/modules/usage-analysis/assets/icon.png`
- Create: `desktop/src/modules/model-price/app-definition.ts`
- Create: `desktop/src/modules/model-price/app-manifest.ts`
- Create: `desktop/src/modules/model-price/assets/icon.png`
- Modify: `desktop/src/modules/apps/definitions.ts`
- Modify: `desktop/src/modules/apps/registry.ts`
- Test: `desktop/src/modules/apps/__tests__/registry.test.ts`

- [ ] **Step 1: Copy selected icon files into module directories**

Run:

```bash
mkdir -p \
  desktop/src/modules/resource-repository/assets \
  desktop/src/modules/database/assets \
  desktop/src/modules/editor-scan/assets \
  desktop/src/modules/usage-analysis/assets \
  desktop/src/modules/model-price/assets

cp /Users/liyang/.codex/generated_images/019ecf0c-0645-7111-a53e-c264793eb19a/ig_0a6b156e211db92b016a30f21659b88190af4653988b64145a.png desktop/src/modules/resource-repository/assets/icon.png
cp /Users/liyang/.codex/generated_images/019ecf0c-0645-7111-a53e-c264793eb19a/ig_0a6b156e211db92b016a30f1844f2c8190ba52b6180b0cbbe6.png desktop/src/modules/database/assets/icon.png
cp /Users/liyang/.codex/generated_images/019ecf0c-0645-7111-a53e-c264793eb19a/ig_0a6b156e211db92b016a30f28676688190a26fa4c45c5c466b.png desktop/src/modules/editor-scan/assets/icon.png
cp /Users/liyang/.codex/generated_images/019ecf0c-0645-7111-a53e-c264793eb19a/ig_0a6b156e211db92b016a30f2d8b9a881909293fdf7cabc29b0.png desktop/src/modules/usage-analysis/assets/icon.png
cp /Users/liyang/.codex/generated_images/019ecf0c-0645-7111-a53e-c264793eb19a/ig_0a6b156e211db92b016a30f3294fec8190baf45bc07f198de0.png desktop/src/modules/model-price/assets/icon.png
```

Expected: five `icon.png` files exist under the owning module directories.

- [ ] **Step 2: Add module definitions and manifests**

Create `desktop/src/modules/resource-repository/app-definition.ts`:

```ts
import type { SynapseSystemAppDefinition } from "@/modules/apps/types"

export const resourceRepositoryAppDefinition = {
  id: "resource-repository",
  type: "system",
  name: "资源仓库",
  windowTitle: "资源仓库",
  defaultView: "skill",
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
```

Create `desktop/src/modules/resource-repository/app-manifest.ts`:

```ts
import icon from "./assets/icon.png"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { resourceRepositoryAppDefinition } from "./app-definition"

export const resourceRepositoryAppManifest = {
  ...resourceRepositoryAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
```

Create `desktop/src/modules/database/app-definition.ts`:

```ts
import type { SynapseSystemAppDefinition } from "@/modules/apps/types"

export const databaseAppDefinition = {
  id: "database",
  type: "system",
  name: "本地数据库",
  windowTitle: "本地数据库",
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
```

Create `desktop/src/modules/database/app-manifest.ts`:

```ts
import icon from "./assets/icon.png"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { databaseAppDefinition } from "./app-definition"

export const databaseAppManifest = {
  ...databaseAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
```

Create `desktop/src/modules/editor-scan/app-definition.ts`:

```ts
import type { SynapseSystemAppDefinition } from "@/modules/apps/types"

export const editorScanAppDefinition = {
  id: "editor-scan",
  type: "system",
  name: "IDE 管理",
  windowTitle: "IDE 管理",
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
```

Create `desktop/src/modules/editor-scan/app-manifest.ts`:

```ts
import icon from "./assets/icon.png"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { editorScanAppDefinition } from "./app-definition"

export const editorScanAppManifest = {
  ...editorScanAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
```

Create `desktop/src/modules/usage-analysis/app-definition.ts`:

```ts
import type { SynapseSystemAppDefinition } from "@/modules/apps/types"

export const usageMonitorAppDefinition = {
  id: "usage-monitor",
  type: "system",
  name: "用量监控",
  windowTitle: "用量监控",
  defaultView: "cc",
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
```

Create `desktop/src/modules/usage-analysis/app-manifest.ts`:

```ts
import icon from "./assets/icon.png"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { usageMonitorAppDefinition } from "./app-definition"

export const usageMonitorAppManifest = {
  ...usageMonitorAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
```

Create `desktop/src/modules/model-price/app-definition.ts`:

```ts
import type { SynapseSystemAppDefinition } from "@/modules/apps/types"

export const modelPriceAppDefinition = {
  id: "model-price",
  type: "system",
  name: "价格管理",
  windowTitle: "价格管理",
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
```

Create `desktop/src/modules/model-price/app-manifest.ts`:

```ts
import icon from "./assets/icon.png"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { modelPriceAppDefinition } from "./app-definition"

export const modelPriceAppManifest = {
  ...modelPriceAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
```

- [ ] **Step 3: Replace temporary definitions and registry manifests with module-owned files**

Modify `desktop/src/modules/apps/definitions.ts` to:

```ts
import { databaseAppDefinition } from "@/modules/database/app-definition"
import { editorScanAppDefinition } from "@/modules/editor-scan/app-definition"
import { modelPriceAppDefinition } from "@/modules/model-price/app-definition"
import { resourceRepositoryAppDefinition } from "@/modules/resource-repository/app-definition"
import { usageMonitorAppDefinition } from "@/modules/usage-analysis/app-definition"
import type { SynapseSystemAppDefinition, SynapseSystemAppId } from "./types"
import { isSystemAppId } from "./types"

const systemAppDefinitions = [
  resourceRepositoryAppDefinition,
  databaseAppDefinition,
  editorScanAppDefinition,
  usageMonitorAppDefinition,
  modelPriceAppDefinition,
] as const satisfies readonly SynapseSystemAppDefinition[]

export function listSystemAppDefinitions(): readonly SynapseSystemAppDefinition[] {
  return systemAppDefinitions
}

export function parseSystemAppId(value: string | null | undefined): SynapseSystemAppId | null {
  return typeof value === "string" && isSystemAppId(value) ? value : null
}

export function getSystemAppDefinition(appId: string): SynapseSystemAppDefinition | null {
  if (!isSystemAppId(appId)) return null
  return systemAppDefinitions.find((app) => app.id === appId) ?? null
}
```

Modify `desktop/src/modules/apps/registry.ts` to:

```ts
import { databaseAppManifest } from "@/modules/database/app-manifest"
import { editorScanAppManifest } from "@/modules/editor-scan/app-manifest"
import { modelPriceAppManifest } from "@/modules/model-price/app-manifest"
import { resourceRepositoryAppManifest } from "@/modules/resource-repository/app-manifest"
import { usageMonitorAppManifest } from "@/modules/usage-analysis/app-manifest"
import type { SynapseSystemAppManifest } from "./types"
import { isSystemAppId } from "./types"

const systemApps = [
  resourceRepositoryAppManifest,
  databaseAppManifest,
  editorScanAppManifest,
  usageMonitorAppManifest,
  modelPriceAppManifest,
] as const satisfies readonly SynapseSystemAppManifest[]

export function listSystemApps(): readonly SynapseSystemAppManifest[] {
  return systemApps
}

export function getSystemAppManifest(appId: string): SynapseSystemAppManifest | null {
  if (!isSystemAppId(appId)) return null
  return systemApps.find((app) => app.id === appId) ?? null
}
```

- [ ] **Step 4: Run registry and type checks for manifests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/__tests__/registry.test.ts
pnpm --filter @synapse/desktop run typecheck
```

Expected: registry test PASS; typecheck PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/resource-repository/app-definition.ts desktop/src/modules/resource-repository/app-manifest.ts desktop/src/modules/resource-repository/assets/icon.png desktop/src/modules/database/app-definition.ts desktop/src/modules/database/app-manifest.ts desktop/src/modules/database/assets/icon.png desktop/src/modules/editor-scan/app-definition.ts desktop/src/modules/editor-scan/app-manifest.ts desktop/src/modules/editor-scan/assets/icon.png desktop/src/modules/usage-analysis/app-definition.ts desktop/src/modules/usage-analysis/app-manifest.ts desktop/src/modules/usage-analysis/assets/icon.png desktop/src/modules/model-price/app-definition.ts desktop/src/modules/model-price/app-manifest.ts desktop/src/modules/model-price/assets/icon.png desktop/src/modules/apps/definitions.ts desktop/src/modules/apps/registry.ts
git commit -m "feat(apps): add system app manifests"
```

---

### Task 3: Launcher Module UI

**Files:**
- Create: `desktop/src/modules/apps/components/app-launcher-grid.tsx`
- Create: `desktop/src/modules/apps/index.tsx`
- Create: `desktop/src/modules/apps/__tests__/app-launcher.test.tsx`

- [ ] **Step 1: Write failing launcher tests**

Create `desktop/src/modules/apps/__tests__/app-launcher.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppsModule } from "../index"

const openSystemApp = vi.fn()

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({
    apps: {
      openSystemApp,
    },
  }),
}))

describe("AppsModule", () => {
  beforeEach(() => {
    openSystemApp.mockReset()
  })

  it("renders the fixed system apps without management controls", () => {
    render(<AppsModule />)

    expect(screen.getByRole("heading", { name: "应用" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "资源仓库" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "本地数据库" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "IDE 管理" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "用量监控" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "价格管理" })).toBeInTheDocument()

    expect(screen.queryByRole("searchbox")).toBeNull()
    expect(screen.queryByText("删除")).toBeNull()
    expect(screen.queryByText("重命名")).toBeNull()
    expect(screen.queryByText("更换图标")).toBeNull()
  })

  it("opens the clicked app through the bridge", async () => {
    render(<AppsModule />)

    await userEvent.click(screen.getByRole("button", { name: "用量监控" }))

    expect(openSystemApp).toHaveBeenCalledWith("usage-monitor")
  })
})
```

- [ ] **Step 2: Run the failing launcher test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/__tests__/app-launcher.test.tsx
```

Expected: FAIL because `AppsModule` does not exist.

- [ ] **Step 3: Implement launcher grid**

Create `desktop/src/modules/apps/components/app-launcher-grid.tsx`:

```tsx
import type { SynapseSystemAppManifest } from "@/modules/apps/types"

type AppLauncherGridProps = {
  readonly apps: readonly SynapseSystemAppManifest[]
  readonly onOpenApp: (appId: SynapseSystemAppManifest["id"]) => void
}

export function AppLauncherGrid({ apps, onOpenApp }: AppLauncherGridProps) {
  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-x-8 gap-y-10 py-8">
      {apps.map((app) => (
        <button
          key={app.id}
          type="button"
          className="group flex min-h-32 flex-col items-center justify-start gap-3 rounded-lg px-3 py-3 text-center outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => onOpenApp(app.id)}
        >
          <img
            src={app.icon}
            alt=""
            className="size-20 rounded-2xl object-cover"
            draggable={false}
          />
          <span className="text-sm font-medium leading-tight">{app.name}</span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Implement AppsModule**

Create `desktop/src/modules/apps/index.tsx`:

```tsx
import { toast } from "sonner"
import { ModulePage } from "@/components/module-page"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { AppLauncherGrid } from "./components/app-launcher-grid"
import { listSystemApps } from "./registry"
import type { SynapseSystemAppId } from "./types"

export function AppsModule() {
  const openApp = async (appId: SynapseSystemAppId) => {
    try {
      await requireSynapseBridge().apps.openSystemApp(appId)
    } catch {
      toast.error("打开应用失败")
    }
  }

  return (
    <ModulePage title="应用">
      <AppLauncherGrid apps={listSystemApps()} onOpenApp={(appId) => void openApp(appId)} />
    </ModulePage>
  )
}
```

- [ ] **Step 5: Run launcher test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/__tests__/app-launcher.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Scan for forbidden UI styles**

Run:

```bash
rg -n "style=|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|linear-gradient|styled\\." desktop/src/modules/apps
```

Expected: no matches.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/modules/apps/components/app-launcher-grid.tsx desktop/src/modules/apps/index.tsx desktop/src/modules/apps/__tests__/app-launcher.test.tsx
git commit -m "feat(apps): add launcher module"
```

---

### Task 4: Resource Repository And Usage Monitor Wrappers

**Files:**
- Create: `desktop/src/modules/resource-repository/index.tsx`
- Create: `desktop/src/modules/resource-repository/__tests__/resource-repository.test.tsx`
- Modify: `desktop/src/modules/usage-analysis/index.tsx`
- Create: `desktop/src/modules/usage-analysis/__tests__/usage-monitor-module.test.tsx`

- [ ] **Step 1: Write wrapper tests**

Create `desktop/src/modules/resource-repository/__tests__/resource-repository.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ResourceRepositoryModule } from "../index"

vi.mock("@/modules/skills", () => ({
  SkillsModule: ({ pendingContentOpenRequest }: { pendingContentOpenRequest?: { requestId: string } | null }) => (
    <div>技能内容 {pendingContentOpenRequest?.requestId}</div>
  ),
}))
vi.mock("@/modules/rules", () => ({
  RulesModule: ({ pendingContentOpenRequest }: { pendingContentOpenRequest?: { requestId: string } | null }) => (
    <div>规则内容 {pendingContentOpenRequest?.requestId}</div>
  ),
}))
vi.mock("@/modules/prompts", () => ({ PromptsModule: () => <div>提示词内容</div> }))

describe("ResourceRepositoryModule", () => {
  it("defaults to skills and switches between resource tabs", async () => {
    render(<ResourceRepositoryModule />)

    expect(screen.getByText("技能内容")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("tab", { name: "规则" }))
    expect(screen.getByText("规则内容")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("tab", { name: "提示词" }))
    expect(screen.getByText("提示词内容")).toBeInTheDocument()
  })

  it("opens on the requested content type and forwards the pending request", () => {
    render(
      <ResourceRepositoryModule
        initialContentOpenRequest={{
          kind: "detail",
          requestId: "request-1",
          contentType: "rule",
          contentId: "rule-1",
        }}
      />,
    )

    expect(screen.getByText(/规则内容/)).toBeInTheDocument()
    expect(screen.getByText(/request-1/)).toBeInTheDocument()
  })
})
```

Create `desktop/src/modules/usage-analysis/__tests__/usage-monitor-module.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { UsageMonitorModule } from "../index"

vi.mock("../cc/cc-usage-page", () => ({ CcUsagePage: () => <div>CC 内容</div> }))
vi.mock("../codex/codex-usage-page", () => ({ CodexUsagePage: () => <div>Codex 内容</div> }))

describe("UsageMonitorModule", () => {
  it("defaults to CC and switches to Codex", async () => {
    render(<UsageMonitorModule />)

    expect(screen.getByText("CC 内容")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("tab", { name: "Codex" }))
    expect(screen.getByText("Codex 内容")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run failing wrapper tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/resource-repository/__tests__/resource-repository.test.tsx src/modules/usage-analysis/__tests__/usage-monitor-module.test.tsx
```

Expected: FAIL because wrappers are missing.

- [ ] **Step 3: Implement ResourceRepositoryModule**

Create `desktop/src/modules/resource-repository/index.tsx`:

```tsx
import { useEffect, useState } from "react"
import type { ContentOpenRequest } from "@/app-shell/content-navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PromptsModule } from "@/modules/prompts"
import { RulesModule } from "@/modules/rules"
import { SkillsModule } from "@/modules/skills"
import type { ResourceRepositoryViewId } from "@/modules/apps/types"

const RESOURCE_TABS: readonly { readonly id: ResourceRepositoryViewId; readonly label: string }[] = [
  { id: "skill", label: "技能" },
  { id: "rule", label: "规则" },
  { id: "prompt", label: "提示词" },
]

type ResourceRepositoryModuleProps = {
  readonly initialContentOpenRequest?: ContentOpenRequest | null
  readonly onInitialContentOpenRequestConsumed?: (requestId: string) => void
}

function viewFromContentOpenRequest(request: ContentOpenRequest | null | undefined): ResourceRepositoryViewId {
  if (request?.contentType === "rule") return "rule"
  if (request?.contentType === "skill") return "skill"
  return "skill"
}

export function ResourceRepositoryModule({
  initialContentOpenRequest = null,
  onInitialContentOpenRequestConsumed,
}: ResourceRepositoryModuleProps) {
  const [view, setView] = useState<ResourceRepositoryViewId>(() => viewFromContentOpenRequest(initialContentOpenRequest))

  useEffect(() => {
    if (initialContentOpenRequest) {
      setView(viewFromContentOpenRequest(initialContentOpenRequest))
    }
  }, [initialContentOpenRequest])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center border-b bg-background px-3 py-2">
        <Tabs value={view} onValueChange={(next) => setView(next as ResourceRepositoryViewId)}>
          <TabsList>
            {RESOURCE_TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>{tab.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="min-h-0 flex-1">
        <Tabs value={view} className="contents">
          <TabsContent value="skill" className="m-0 h-full data-[state=inactive]:hidden">
            <SkillsModule
              pendingContentOpenRequest={initialContentOpenRequest}
              onPendingContentOpenRequestConsumed={onInitialContentOpenRequestConsumed}
            />
          </TabsContent>
          <TabsContent value="rule" className="m-0 h-full data-[state=inactive]:hidden">
            <RulesModule
              pendingContentOpenRequest={initialContentOpenRequest}
              onPendingContentOpenRequestConsumed={onInitialContentOpenRequestConsumed}
            />
          </TabsContent>
          <TabsContent value="prompt" className="m-0 h-full data-[state=inactive]:hidden">
            <PromptsModule />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add UsageMonitorModule export**

Modify `desktop/src/modules/usage-analysis/index.tsx`:

```tsx
import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CcUsagePage } from "./cc/cc-usage-page"
import { CodexUsagePage } from "./codex/codex-usage-page"
import type { UsageMonitorViewId } from "@/modules/apps/types"

const USAGE_TABS: readonly { readonly id: UsageMonitorViewId; readonly label: string }[] = [
  { id: "cc", label: "CC" },
  { id: "codex", label: "Codex" },
]

export function CcUsageAnalysisModule() {
  return <CcUsagePage />
}

export function CodexUsageAnalysisModule() {
  return <CodexUsagePage />
}

export function UsageMonitorModule() {
  const [view, setView] = useState<UsageMonitorViewId>("cc")

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center border-b bg-background px-3 py-2">
        <Tabs value={view} onValueChange={(next) => setView(next as UsageMonitorViewId)}>
          <TabsList>
            {USAGE_TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>{tab.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="min-h-0 flex-1">
        <Tabs value={view} className="contents">
          <TabsContent value="cc" className="m-0 h-full data-[state=inactive]:hidden">
            <CcUsagePage />
          </TabsContent>
          <TabsContent value="codex" className="m-0 h-full data-[state=inactive]:hidden">
            <CodexUsagePage />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run wrapper tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/resource-repository/__tests__/resource-repository.test.tsx src/modules/usage-analysis/__tests__/usage-monitor-module.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/resource-repository/index.tsx desktop/src/modules/resource-repository/__tests__/resource-repository.test.tsx desktop/src/modules/usage-analysis/index.tsx desktop/src/modules/usage-analysis/__tests__/usage-monitor-module.test.tsx
git commit -m "feat(apps): add system app wrappers"
```

---

### Task 5: System App Window Renderer

**Files:**
- Create: `desktop/src/modules/apps/system-app-window-app.tsx`
- Create: `desktop/src/modules/apps/__tests__/system-app-window-app.test.tsx`
- Modify: `desktop/src/main.tsx`

- [ ] **Step 1: Write failing system app window tests**

Create `desktop/src/modules/apps/__tests__/system-app-window-app.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { requestOpenContentDetail } from "@/app-shell/content-navigation"
import { SystemAppWindowApp } from "../system-app-window-app"

const openSystemApp = vi.fn()

vi.mock("@/modules/resource-repository", () => ({ ResourceRepositoryModule: () => <div>资源仓库窗口</div> }))
vi.mock("@/modules/database", () => ({ DatabaseModule: () => <div>数据库窗口</div> }))
vi.mock("@/modules/editor-scan", () => ({ EditorScanModule: () => <div>IDE 窗口</div> }))
vi.mock("@/modules/usage-analysis", () => ({ UsageMonitorModule: () => <div>用量窗口</div> }))
vi.mock("@/modules/model-price", () => ({ ModelPriceModule: () => <div>价格窗口</div> }))
vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    apps: {
      onContentOpenRequest: () => () => undefined,
      openSystemApp,
    },
  }),
}))

describe("SystemAppWindowApp", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/")
    openSystemApp.mockReset()
  })

  it("renders known system apps from the URL", () => {
    window.history.replaceState({}, "", "/?window=system-app&appId=database")
    render(<SystemAppWindowApp />)
    expect(screen.getByText("数据库窗口")).toBeInTheDocument()
  })

  it("renders a short error for unknown app ids", () => {
    window.history.replaceState({}, "", "/?window=system-app&appId=missing")
    render(<SystemAppWindowApp />)
    expect(screen.getByText("无法打开应用")).toBeInTheDocument()
  })

  it("forwards content open requests from non-resource app windows", () => {
    window.history.replaceState({}, "", "/?window=system-app&appId=editor-scan")
    render(<SystemAppWindowApp />)

    requestOpenContentDetail({
      kind: "detail",
      requestId: "request-1",
      contentType: "skill",
      contentId: "skill-1",
    })

    expect(openSystemApp).toHaveBeenCalledWith("resource-repository", {
      contentOpenRequest: {
        kind: "detail",
        requestId: "request-1",
        contentType: "skill",
        contentId: "skill-1",
      },
    })
  })
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/__tests__/system-app-window-app.test.tsx
```

Expected: FAIL because `system-app-window-app.tsx` does not exist.

- [ ] **Step 3: Implement SystemAppWindowApp**

Create `desktop/src/modules/apps/system-app-window-app.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react"
import {
  subscribeContentOpenRequest,
  type ContentOpenRequest,
} from "@/app-shell/content-navigation"
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { DatabaseModule } from "@/modules/database"
import { EditorScanModule } from "@/modules/editor-scan"
import { ModelPriceModule } from "@/modules/model-price"
import { ResourceRepositoryModule } from "@/modules/resource-repository"
import { UsageMonitorModule } from "@/modules/usage-analysis"
import { parseSystemAppId } from "./definitions"

function parseInitialContentOpenRequest(): ContentOpenRequest | null {
  const raw = new URLSearchParams(window.location.search).get("contentOpenRequest")
  if (!raw) return null
  try {
    return JSON.parse(raw) as ContentOpenRequest
  } catch {
    return null
  }
}

export function SystemAppWindowApp() {
  const appId = useMemo(
    () => parseSystemAppId(new URLSearchParams(window.location.search).get("appId")),
    [],
  )
  const [pendingContentOpenRequest, setPendingContentOpenRequest] =
    useState<ContentOpenRequest | null>(() => parseInitialContentOpenRequest())

  useEffect(() => {
    const bridge = getSynapseBridge()
    if (!bridge) return undefined
    return bridge.apps.onContentOpenRequest((request) => {
      setPendingContentOpenRequest(request)
    })
  }, [])

  useEffect(() => {
    if (appId === "resource-repository") return undefined
    return subscribeContentOpenRequest((request) => {
      void getSynapseBridge()?.apps.openSystemApp("resource-repository", {
        contentOpenRequest: request,
      })
    })
  }, [appId])

  if (!appId) {
    return <SystemAppWindowError />
  }

  if (appId === "resource-repository") {
    return (
      <ResourceRepositoryModule
        initialContentOpenRequest={pendingContentOpenRequest}
        onInitialContentOpenRequestConsumed={(requestId) => {
          setPendingContentOpenRequest((current) => current?.requestId === requestId ? null : current)
        }}
      />
    )
  }
  if (appId === "database") return <DatabaseModule />
  if (appId === "editor-scan") return <EditorScanModule />
  if (appId === "usage-monitor") return <UsageMonitorModule />
  if (appId === "model-price") return <ModelPriceModule />

  return <SystemAppWindowError />
}

function SystemAppWindowError() {
  return (
    <div className="flex h-full items-center justify-center bg-surface p-6">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>无法打开应用</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>应用不存在。</EmptyContent>
      </Empty>
    </div>
  )
}
```

- [ ] **Step 4: Wire renderer bootstrap**

Modify `desktop/src/main.tsx` so the `windowType` branch includes system apps before the default main app branch:

```tsx
  } else if (windowType === "system-app") {
    const { SystemAppWindowApp } = await import("@/modules/apps/system-app-window-app")
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <AppErrorBoundary>
          <AppConfigProvider>
            <RepositoryManagerProvider>
              <IdentityProvider>
                <AppNotificationsProvider>
                  <AccountProvider>
                    <ActiveRepositorySwitchProvider>
                      <SystemAppWindowApp />
                    </ActiveRepositorySwitchProvider>
                  </AccountProvider>
                </AppNotificationsProvider>
              </IdentityProvider>
            </RepositoryManagerProvider>
          </AppConfigProvider>
        </AppErrorBoundary>
      </StrictMode>,
    )
  } else {
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/__tests__/system-app-window-app.test.tsx
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/apps/system-app-window-app.tsx desktop/src/modules/apps/__tests__/system-app-window-app.test.tsx desktop/src/main.tsx
git commit -m "feat(apps): add system app window renderer"
```

---

### Task 6: Main-Process Window Service

**Files:**
- Create: `desktop/electron/services/system-app-window-service.ts`
- Create: `desktop/electron/services/__tests__/system-app-window-service.test.ts`

- [ ] **Step 1: Write failing window service tests**

Create `desktop/electron/services/__tests__/system-app-window-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { createSystemAppWindowService } from "../system-app-window-service"

describe("createSystemAppWindowService", () => {
  it("opens and focuses one window per app id", async () => {
    const window = createWindowMock()
    const createWindow = vi.fn(() => window as never)
    const service = createSystemAppWindowService({ createWindow, baseUrl: () => "app://index.html" })

    await service.open("database")
    await service.open("database")

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
    expect(window.loadURL).toHaveBeenCalledWith("app://index.html?window=system-app&appId=database")
  })

  it("delivers content open requests to an existing resource repository window", async () => {
    const window = createWindowMock()
    const createWindow = vi.fn(() => window as never)
    const service = createSystemAppWindowService({ createWindow, baseUrl: () => "app://index.html" })
    const contentOpenRequest = {
      kind: "detail",
      requestId: "request-1",
      contentType: "skill",
      contentId: "skill-1",
    } as const

    await service.open("resource-repository")
    await service.open("resource-repository", { contentOpenRequest })

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
    expect(window.webContents.send).toHaveBeenCalledWith("synapse:apps:content-open-request", contentOpenRequest)
  })

  it("opens different windows for different app ids", async () => {
    const windows = [createWindowMock(), createWindowMock()]
    const createWindow = vi.fn(() => windows.shift() as never)
    const service = createSystemAppWindowService({ createWindow, baseUrl: () => "app://index.html" })

    await service.open("database")
    await service.open("model-price")

    expect(createWindow).toHaveBeenCalledTimes(2)
  })

  it("removes closed windows so the app can reopen", async () => {
    const first = createWindowMock()
    const second = createWindowMock()
    const createWindow = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
    const service = createSystemAppWindowService({ createWindow, baseUrl: () => "app://index.html" })

    await service.open("database")
    first.emitClosed()
    await service.open("database")

    expect(createWindow).toHaveBeenCalledTimes(2)
  })
})

function createWindowMock() {
  let closedHandler: (() => void) | null = null
  return {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    webContents: {
      send: vi.fn(),
    },
    on: vi.fn((event: string, handler: () => void) => {
      if (event === "closed") closedHandler = handler
    }),
    emitClosed: () => closedHandler?.(),
  }
}
```

- [ ] **Step 2: Run failing service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/system-app-window-service.test.ts
```

Expected: FAIL because service file does not exist.

- [ ] **Step 3: Implement window service**

Create `desktop/electron/services/system-app-window-service.ts`:

```ts
import { BrowserWindow } from "electron"
import path from "node:path"

import { rendererBaseUrl } from "../modules/shared/renderer-base-url"
import { getSystemAppDefinition } from "../../src/modules/apps/definitions"
import type { SynapseSystemAppId, SynapseSystemAppOpenOptions } from "../../src/modules/apps/types"
import { createMainLogger } from "./log-store"

const SYSTEM_APP_CONTENT_OPEN_REQUEST_CHANNEL = "synapse:apps:content-open-request"

type SystemAppWindowLogger = {
  readonly info: (message: string, metadata?: Record<string, unknown>) => void
  readonly warn: (message: string, metadata?: Record<string, unknown>) => void
}

type SystemAppWindowServiceDeps = {
  readonly createWindow: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow
  readonly baseUrl: () => string
  readonly getPreloadPath?: () => string
  readonly logger?: SystemAppWindowLogger
}

const SYSTEM_APP_WINDOW_BOUNDS = {
  width: 1180,
  height: 760,
  minWidth: 960,
  minHeight: 640,
}

function focusWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore()
  window.focus()
}

function resolveSystemAppWindowPreloadPath(baseDir: string): string {
  return path.join(baseDir, "../preload.js")
}

export function createSystemAppWindowService(deps: SystemAppWindowServiceDeps) {
  const windowsByAppId = new Map<SynapseSystemAppId, BrowserWindow>()
  const logger = deps.logger ?? createMainLogger("system-app.window")

  return {
    async open(appId: SynapseSystemAppId, options: SynapseSystemAppOpenOptions = {}): Promise<void> {
      const definition = getSystemAppDefinition(appId)
      if (!definition) {
        logger.warn("Rejected unknown system app window request.", { appId })
        throw new Error("Unknown system app.")
      }

      const existing = windowsByAppId.get(appId)
      if (existing && !existing.isDestroyed()) {
        focusWindow(existing)
        if (options.contentOpenRequest) {
          existing.webContents.send(SYSTEM_APP_CONTENT_OPEN_REQUEST_CHANNEL, options.contentOpenRequest)
        }
        logger.info("Focused existing system app window.", { appId, appType: definition.type })
        return
      }

      const baseUrl = deps.baseUrl()
      const params = new URLSearchParams({ window: "system-app", appId })
      if (options.contentOpenRequest) {
        params.set("contentOpenRequest", JSON.stringify(options.contentOpenRequest))
      }
      const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`
      const window = deps.createWindow({
        ...SYSTEM_APP_WINDOW_BOUNDS,
        title: definition.windowTitle,
        webPreferences: {
          preload: deps.getPreloadPath?.() ?? resolveSystemAppWindowPreloadPath(__dirname),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })

      windowsByAppId.set(appId, window)
      window.on("closed", () => {
        windowsByAppId.delete(appId)
        logger.info("System app window closed.", { appId, appType: definition.type })
      })

      await window.loadURL(url)
      logger.info("Loaded system app window.", { appId, appType: definition.type })
    },
  }
}

export const systemAppWindowService = createSystemAppWindowService({
  createWindow: (options) => new BrowserWindow(options),
  baseUrl: rendererBaseUrl,
  getPreloadPath: () => resolveSystemAppWindowPreloadPath(__dirname),
})
```

- [ ] **Step 4: Run service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/system-app-window-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/system-app-window-service.ts desktop/electron/services/__tests__/system-app-window-service.test.ts
git commit -m "feat(apps): add system app window service"
```

---

### Task 7: Apps IPC And Preload Bridge

**Files:**
- Create: `desktop/electron/modules/apps/ipc.ts`
- Create: `desktop/electron/modules/apps/__tests__/ipc.test.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`

- [ ] **Step 1: Write failing IPC tests**

Create `desktop/electron/modules/apps/__tests__/ipc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { appsIpcModule } from "../ipc"

const systemAppWindowServiceMock = vi.hoisted(() => ({
  open: vi.fn(async () => undefined),
}))

vi.mock("../../../services/system-app-window-service", () => ({
  systemAppWindowService: systemAppWindowServiceMock,
}))

describe("appsIpcModule", () => {
  it("declares open system app channel", () => {
    expect(appsIpcModule.id).toBe("apps")
    expect(appsIpcModule.methods.openSystemApp.channel).toBe("synapse:apps:open-system-app")
  })

  it("validates app ids and opens a valid app", async () => {
    expect(appsIpcModule.methods.openSystemApp.request.safeParse({ appId: "database" }).success).toBe(true)
    expect(appsIpcModule.methods.openSystemApp.request.safeParse({ appId: "missing" }).success).toBe(false)

    await appsIpcModule.methods.openSystemApp.handler({} as never, { appId: "database" })

    expect(systemAppWindowServiceMock.open).toHaveBeenCalledWith("database", undefined)
  })

  it("passes optional content open requests through", async () => {
    const contentOpenRequest = {
      kind: "detail",
      requestId: "request-1",
      contentType: "skill",
      contentId: "skill-1",
    }

    await appsIpcModule.methods.openSystemApp.handler({} as never, {
      appId: "resource-repository",
      options: { contentOpenRequest },
    })

    expect(systemAppWindowServiceMock.open).toHaveBeenCalledWith("resource-repository", {
      contentOpenRequest,
    })
  })
})
```

- [ ] **Step 2: Run failing IPC test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/apps/__tests__/ipc.test.ts
```

Expected: FAIL because `apps/ipc.ts` does not exist.

- [ ] **Step 3: Implement apps IPC module**

Create `desktop/electron/modules/apps/ipc.ts`:

```ts
import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import { systemAppWindowService } from "../../services/system-app-window-service"
import { SYSTEM_APP_IDS } from "../../../src/modules/apps/types"

const systemAppIdSchema = z.enum(SYSTEM_APP_IDS)

const contentOpenRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    requestId: z.string().min(1),
    contentType: z.enum(["rule", "skill"]),
  }).passthrough(),
  z.object({
    kind: z.literal("detail"),
    requestId: z.string().min(1),
    contentType: z.enum(["rule", "skill"]),
    contentId: z.string().min(1),
  }).passthrough(),
  z.object({
    kind: z.literal("edit-overwrite"),
    requestId: z.string().min(1),
    contentType: z.enum(["rule", "skill"]),
    contentId: z.string().min(1),
  }).passthrough(),
])

const openSystemAppRequestSchema = z.object({
  appId: systemAppIdSchema,
  options: z.object({
    contentOpenRequest: contentOpenRequestSchema.optional(),
  }).optional(),
})

type OpenSystemAppRequest = z.infer<typeof openSystemAppRequestSchema>

export const appsIpcModule: IpcModule = {
  id: "apps",
  methods: {
    openSystemApp: {
      channel: "synapse:apps:open-system-app",
      kind: "invoke",
      request: openSystemAppRequestSchema,
      response: z.void(),
      handler: async (_ctx, request: OpenSystemAppRequest) => {
        await systemAppWindowService.open(request.appId, request.options)
      },
    },
  },
  events: {},
}
```

- [ ] **Step 4: Register IPC module with existing module registry**

Modify `desktop/electron/bootstrap/ipc-registry.ts`.

Add the import beside other module imports:

```ts
import { appsIpcModule } from "../modules/apps/ipc"
```

Register it after `automationIpcModule` in `createIpcRegistry`:

```ts
  registry.register(automationIpcModule, ctx)
  registry.register(appsIpcModule, ctx)
  registry.register(workflowIpcModule, ctx)
```

Add it to `registeredIpcModules` after `automationIpcModule`:

```ts
  automationIpcModule,
  appsIpcModule,
  workflowIpcModule,
```

- [ ] **Step 5: Add preload channel and bridge**

Modify `desktop/electron/preload.ts`:

Add to `IPC_CHANNELS`:

```ts
  "apps": {
    "openSystemApp": "synapse:apps:open-system-app",
  },
```

Add to `EVENT_CHANNELS`:

```ts
  apps: {
    contentOpenRequest: "synapse:apps:content-open-request",
  },
```

Add to the exposed bridge object:

```ts
  apps: {
    openSystemApp: (appId, options) => invoke(IPC_CHANNELS.apps.openSystemApp)({ appId, options }),
    onContentOpenRequest: createRawPayloadSubscription(
      subscribe,
      EVENT_CHANNELS.apps.contentOpenRequest,
    ),
  },
```

- [ ] **Step 6: Add bridge type**

Modify `desktop/src/types/bridge.ts` inside `SynapseBridge`:

```ts
  apps: {
    openSystemApp: (
      appId: import("@/modules/apps/types").SynapseSystemAppId,
      options?: import("@/modules/apps/types").SynapseSystemAppOpenOptions,
    ) => Promise<void>
    onContentOpenRequest: (
      listener: (request: import("@/app-shell/content-navigation").ContentOpenRequest) => void,
    ) => () => void
  }
```

- [ ] **Step 7: Run IPC, codegen, and typecheck**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/apps/__tests__/ipc.test.ts
pnpm --filter @synapse/desktop run generate:ipc
pnpm --filter @synapse/desktop run check:ipc-codegen
pnpm --filter @synapse/desktop run typecheck
```

Expected: all PASS. If `generate:ipc` updates `desktop/electron/generated/ipc-channels.generated.ts`, include it in the commit.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/modules/apps/ipc.ts desktop/electron/modules/apps/__tests__/ipc.test.ts desktop/electron/bootstrap/ipc-registry.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/electron/generated/ipc-channels.generated.ts
git commit -m "feat(apps): expose system app window bridge"
```

---

### Task 8: Main Navigation Migration

**Files:**
- Modify: `desktop/config.ts`
- Modify: `desktop/src/App.tsx`
- Modify: `desktop/src/__tests__/App.navigation-order.test.ts`
- Modify: `desktop/src/__tests__/App.workflow-entry.test.tsx`

- [ ] **Step 1: Update navigation order test first**

Modify `desktop/src/__tests__/App.navigation-order.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { APP_NAVIGATION_TABS } from "../../config"

describe("app navigation order", () => {
  it("keeps the primary tabs in the requested left-to-right order", () => {
    expect(APP_NAVIGATION_TABS.map((tab) => tab.id)).toEqual([
      "agent",
      "workflow",
      "drive",
      "automation",
      "apps",
      "settings",
    ])
  })
})
```

- [ ] **Step 2: Run failing navigation test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/__tests__/App.navigation-order.test.ts
```

Expected: FAIL because config still contains low-frequency tabs.

- [ ] **Step 3: Update config**

Modify `desktop/config.ts` navigation block:

```ts
// 顶部导航菜单：定义每个菜单的内部英文标识、中文显示文案和显示顺序，调整这里即可改变主窗口顶部 tab。
export const APP_NAVIGATION_TABS = [
  { id: "agent", label: "对话" },
  { id: "workflow", label: "工作流", requiresWorkflowEntry: true },
  { id: "drive", label: "云盘" },
  { id: "automation", label: "自动化" },
  { id: "apps", label: "应用" },
  { id: "settings", label: "设置" },
] as const
```

Modify default tab:

```ts
// 默认激活的顶部导航菜单：主窗口有内容仓库时默认进入这个 tab。
export const DEFAULT_APP_NAVIGATION_TAB_ID = "apps" satisfies AppNavigationTabId
```

- [ ] **Step 4: Update App.tsx**

Modify imports in `desktop/src/App.tsx`:

```ts
import { AppsModule } from "@/modules/apps"
```

Remove imports for direct top-level low-frequency modules that are no longer rendered directly by `MainApp`:

```ts
import { RulesModule } from "@/modules/rules"
import { SkillsModule } from "@/modules/skills"
import { PromptsModule } from "@/modules/prompts"
import { DatabaseModule } from "@/modules/database"
import { EditorScanModule } from "@/modules/editor-scan"
import { CcUsageAnalysisModule, CodexUsageAnalysisModule } from "@/modules/usage-analysis"
import { ModelPriceModule } from "@/modules/model-price"
```

Remove `TOP_LEVEL_CONTENT_TAB_ORDER`, `CONTENT_TAB_LABELS`, `CONTENT_MODULE_COMPONENTS`, `ContentDialogStateMap`, `ContentDialogHandlerMap`, content dialog state, `pendingContentOpenRequest`, and `handlePendingContentOpenRequestConsumed` from `MainApp`.

Replace the existing `subscribeContentOpenRequest` effect with this bridge handoff:

```tsx
  useEffect(() => {
    return subscribeContentOpenRequest((request) => {
      ensureBodyInteractable()
      void getSynapseBridge()?.apps.openSystemApp("resource-repository", {
        contentOpenRequest: request,
      }).catch((error) => {
        logger.error("Failed to open resource repository app from content request.", {
          contentType: request.contentType,
          kind: request.kind,
          error,
        })
      })
    })
  }, [])
```

Update repository-state polling to remove the `hasContentDialogOpen` guard and dependency:

```tsx
  useEffect(() => {
    if (hasNoRepositories || isActiveRepositoryMissing) {
      return
    }

    const intervalId = window.setInterval(() => {
      void manager.refreshRepositoryStates()
    }, 5000)

    const handleFocus = () => {
      void manager.refreshRepositoryStates()
    }

    window.addEventListener("focus", handleFocus)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener("focus", handleFocus)
    }
  }, [hasNoRepositories, isActiveRepositoryMissing, manager])
```

Add the apps render branch:

```tsx
          {activeTab === "apps" ? (
            <ErrorBoundary fallbackTitle="应用模块出现问题">
              <AppsModule />
            </ErrorBoundary>
          ) : null}
```

Remove direct branches for `database`, `editor-scan`, `usage-cc`, `usage-codex`, and `model-price`.

- [ ] **Step 5: Update App workflow-entry test expectations**

Modify `desktop/src/__tests__/App.workflow-entry.test.tsx` mocks:

```ts
vi.mock("@/modules/apps", () => ({ AppsModule: () => <div>应用模块</div> }))
```

Update expected hidden-workflow labels:

```ts
expect(topNavigationLabels()).toEqual([
  "对话",
  "云盘",
  "自动化",
  "应用",
  "设置",
])
```

Replace tests that open `IDE` or `数据库` from top navigation with one test that opens `应用`:

```tsx
it("opens the Apps module from the top navigation", async () => {
  mocks.getStates.mockResolvedValue({})

  await renderApp()

  await act(async () => {
    findTopNavigationButton("应用").click()
    await Promise.resolve()
  })

  expect(document.body.textContent).toContain("应用模块")
})
```

- [ ] **Step 6: Run focused app navigation tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/__tests__/App.navigation-order.test.ts src/__tests__/App.workflow-entry.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/config.ts desktop/src/App.tsx desktop/src/__tests__/App.navigation-order.test.ts desktop/src/__tests__/App.workflow-entry.test.tsx
git commit -m "feat(apps): move low frequency modules into launcher"
```

---

### Task 9: Release Notes And Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add one bullet under the pending release notes:

```md
- 新增“应用”启动器，把资源仓库、本地数据库、IDE 管理、用量监控和价格管理收纳为系统应用，并以独立窗口打开。
```

- [ ] **Step 2: Run focused test set**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/modules/apps/__tests__/registry.test.ts \
  src/modules/apps/__tests__/app-launcher.test.tsx \
  src/modules/apps/__tests__/system-app-window-app.test.tsx \
  src/modules/resource-repository/__tests__/resource-repository.test.tsx \
  src/modules/usage-analysis/__tests__/usage-monitor-module.test.tsx \
  electron/services/__tests__/system-app-window-service.test.ts \
  electron/modules/apps/__tests__/ipc.test.ts \
  src/__tests__/App.navigation-order.test.ts \
  src/__tests__/App.workflow-entry.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints and typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Scan UI code for forbidden styling**

Run:

```bash
rg -n "style=|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|linear-gradient|styled\\." desktop/src/modules/apps desktop/src/modules/resource-repository desktop/src/modules/usage-analysis/index.tsx
```

Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note system app launcher"
```

- [ ] **Step 6: Manual smoke test**

Run the desktop app:

```bash
pnpm dev:desktop
```

Expected:

- Main header shows `对话 / 工作流 / 云盘 / 自动化 / 应用 / 设置` with workflow still controlled by its existing visibility rule.
- Clicking `应用` shows a responsive icon grid with five apps and no search or management controls.
- Clicking each app opens a new window.
- Clicking the same app again focuses the existing app window.
- `资源仓库` window switches between `技能 / 规则 / 提示词`.
- `用量监控` window switches between `CC / Codex`.

Stop when done:

```bash
pnpm quit:desktop
```

Expected: desktop dev processes stop.

---

## Self-Review

- Spec coverage: The plan covers top navigation, fixed system app registry, module-owned manifests, bitmap icons, pure Launchpad UI, single-instance child windows, grouped resource and usage tabs, IPC/preload, tests, and release notes.
- Placeholder scan: The plan uses concrete file paths, command lines, code snippets, copied icon paths, and expected results. It contains no deferred implementation slots.
- Type consistency: The plan consistently uses `SynapseSystemAppId`, `SynapseSystemAppDefinition`, `SynapseSystemAppManifest`, `SynapseSystemAppOpenOptions`, `parseSystemAppId`, `listSystemAppDefinitions`, `listSystemApps`, `getSystemAppDefinition`, `getSystemAppManifest`, `AppsModule`, `ResourceRepositoryModule`, and `SystemAppWindowApp`.
